import { referenceNumbers } from '../../shared/material-scope.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { requireThat } from './errors.mjs';
import { executeCommand, getProject, getRevision, exportRevision } from './domain.mjs';
import { inheritArtifactContext, isLegacyResultIndexEvidence } from './kernel.mjs';
import { noteLabels, readableArtifactBlocks } from './artifact-content.mjs';

export { noteLabels } from './artifact-content.mjs';
const uid = prefix => `${prefix}_${randomUUID()}`;
const now = () => new Date().toISOString();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function artifactOf(p, id) {
  requireThat(typeof id === 'string' && Object.hasOwn(p.artifacts, id), 'not_found', '成果不存在或不属于当前课题。', 404);
  return p.artifacts[id];
}
export function upgradeProject(p, legacy = true) {
  p.researchResults ??= {};
  p.searches ??= {};
  p.researchTasks ??= {};
  for (const a of Object.values(p.artifacts)) {
    if (a.draft) continue;
    const latest = a.revisions.at(-1);
    requireThat(latest && Array.isArray(latest.blocks), 'store_corrupt', '旧课题缺少保存内容，已停止升级。', 503);
    a.legacyRevisionIds = legacy ? a.revisions.map(r => r.id) : [];
    a.checkpoints = [];
    const notes = Object.fromEntries(Object.keys(noteLabels).map(key => [key, p.example ? '' : latest.blocks.find(b => b.id === key && b.type === 'paragraph')?.text ?? '']));
    a.draft = { version: 1, notes, sourceAccessIds: [...latest.sourceAccessIds], resultId: null, updatedAt: now() };
    a.templateId = 'field-understanding-v1';
  }
  return p;
}
export function migrateState(state) {
  requireThat(state && object(state.projects) && object(state.receipts) && Array.isArray(state.events), 'store_corrupt', '本机记录结构不完整，已停止升级。', 503);
  for (const p of Object.values(state.projects)) upgradeProject(p);
  state.modelCalls ??= [];
  state.schemaVersion = 2;
  return state;
}
export function checkDraft(a, version) {
  requireThat(version === a.draft.version, 'draft_conflict', '已有另一份修改，请对照后保留你的内容。', 409, { currentVersion: a.draft.version });
}
export function currentBlocks(p, a) {
  const result = a.draft.resultId ? p.researchResults[a.draft.resultId] : null;
  return readableArtifactBlocks(result?.blocks ?? (p.example ? a.revisions[0].blocks : []), a.draft.notes);
}
export function currentPayload(p, a) {
  const result = p.researchResults[a.draft.resultId];
  return { blocks: currentBlocks(p, a), sourceAccessIds: a.draft.sourceAccessIds, notes: a.draft.notes, resultId: a.draft.resultId,
    ...(result?.adoptionContext ? { adoptionContext: structuredClone(result.adoptionContext) } : {}),
    ...(result?.dependencies ? { dependencies: structuredClone(result.dependencies) } : {}),
    projectContext: { name: p.name, goal: p.goal, originalGoal: p.originalGoal, conditions: p.conditions } };
}
export function capture(p, a, operationId, reason = 'anchor') {
  const content = currentPayload(p, a), contentHash = hash(content);
  const existing = a.revisions.find(r => r.contentHash === contentHash);
  if (existing && reason !== 'restore_checkpoint') return existing;
  const revision = { id: uid('revision'), artifactId: a.id, number: a.revisions.length + 1, previousRevisionId: a.headRevisionId,
    createdAt: now(), operationId, reason, contentHash, ...structuredClone(content) };
  a.revisions.push(revision); a.headRevisionId = revision.id;
  inheritArtifactContext(p, a, revision);
  return revision;
}
export function checkpoint(p, a, operationId, name, type, extra = {}) {
  const revision = capture(p, a, operationId, type === 'restore' ? 'restore_checkpoint' : 'checkpoint');
  if (type === 'restore') revision.restoredFromRevisionId = extra.restoredFromRevisionId;
  const previous = a.checkpoints.at(-1);
  if (previous?.revisionId === revision.id && type === 'manual') return previous;
  const result = { id: uid('progress'), revisionId: revision.id, name, type, createdAt: now(), ...extra };
  a.checkpoints.push(result);
  return result;
}
function validateNotes(notes) {
  requireThat(object(notes) && Object.keys(notes).length === 4 && Object.keys(notes).every(k => Object.hasOwn(noteLabels, k)), 'fixed_framework', '只能修改个人认识，标题和研究框架保持固定。');
  for (const value of Object.values(notes)) requireThat(typeof value === 'string' && value.length <= 100000, 'invalid_input', '个人记录需要是不超过 100000 字符的文本。');
}
function targetFor(p, a, body, operationId) {
  const t = body.target;
  requireThat(object(t) && t.artifactId === a.id, 'invalid_target', '请选择本课题中的原文位置。');
  if (t.revisionId) { getRevision(p, a.id, t.revisionId); return t; }
  checkDraft(a, body.baseVersion);
  const revision = capture(p, a, operationId);
  return { artifactId: a.id, revisionId: revision.id, blockId: t.blockId };
}
export function progressCommand(state, projectId, name, body, operationId) {
  const p = upgradeProject(getProject(state, projectId));
  const a = body.artifactId ? artifactOf(p, body.artifactId) : null;
  requireThat(a, 'invalid_input', '需要明确的当前成果。');
  let result;
  switch (name) {
    case 'save-notes': {
      requireThat(Object.keys(body).every(k => ['artifactId', 'baseVersion', 'notes'].includes(k)), 'fixed_framework', '标题、结构与 AI 内容不能通过个人记录接口修改。');
      validateNotes(body.notes); checkDraft(a, body.baseVersion);
      if (!same(a.draft.notes, body.notes)) { a.draft.notes = structuredClone(body.notes); a.draft.version++; a.draft.updatedAt = now(); }
      result = { version: a.draft.version, updatedAt: a.draft.updatedAt }; break;
    }
    case 'checkpoint': {
      checkDraft(a, body.baseVersion);
      requireThat(body.name === undefined || (typeof body.name === 'string' && body.name.length <= 120), 'invalid_input', '进展名称最多 120 字符。');
      result = checkpoint(p, a, operationId, body.name?.trim() || '保留当前进展', 'manual'); break;
    }
    case 'capture-current': {
      checkDraft(a, body.baseVersion); result = { revisionId: capture(p, a, operationId, 'export').id }; break;
    }
    case 'restore-progress': {
      checkDraft(a, body.baseVersion);
      const old = getRevision(p, a.id, body.revisionId);
      const before = capture(p, a, operationId, 'before_restore');
      const notes = old.notes ?? Object.fromEntries(Object.keys(noteLabels).map(key => [key, p.example ? '' : old.blocks.find(b => b.id === key)?.text ?? '']));
      validateNotes(notes);
      a.draft = { ...a.draft, notes: structuredClone(notes), sourceAccessIds: [...old.sourceAccessIds], resultId: old.resultId ?? null, version: a.draft.version + 1, updatedAt: now() };
      if (old.projectContext && (p.goal !== old.projectContext.goal || p.conditions !== old.projectContext.conditions)) {
        executeCommand(state, projectId, 'update-project', { name: p.name, goal: old.projectContext.goal, conditions: old.projectContext.conditions, baseVersion: p.metadataVersion }, operationId);
      }
      // Project identity and its original intent remain unchanged; restore the working context.
      result = checkpoint(p, a, operationId, '从历史恢复研究进展', 'restore', { restoredFromRevisionId: old.id, beforeRevisionId: before.id }); break;
    }
    case 'attach-material': {
      checkDraft(a, body.baseVersion);
      const source = executeCommand(state, projectId, 'import-source', body, operationId);
      const access = executeCommand(state, projectId, 'record-access', { sourceId: source.id, level: source.contentLevel }, operationId);
      access.method = 'user_provided_content';
      a.draft.sourceAccessIds.push(access.id); a.draft.version++; a.draft.updatedAt = now(); result = { sourceId: source.id, accessId: access.id }; break;
    }
    case 'attach-existing-materials': {
      checkDraft(a, body.baseVersion);
      requireThat(Array.isArray(body.accessIds) && body.accessIds.every(id => typeof id === 'string'), 'invalid_input', '请选择本课题已经保存的实际访问记录。');
      const requested = [...new Set(body.accessIds)];
      // Validate the whole selection first: a mixed valid/foreign selection must
      // not partially attach material, even before the storage transaction commits.
      for (const id of requested) {
        requireThat(Object.hasOwn(p.accesses, id), 'not_found', '实际访问记录不存在或不属于当前课题。', 404);
        requireThat(typeof p.accesses[id].sourceId === 'string' && Object.hasOwn(p.sources, p.accesses[id].sourceId), 'not_found', '实际访问记录对应的材料不属于当前课题。', 404);
      }
      const linked = new Set(a.draft.sourceAccessIds), addedAccessIds = requested.filter(id => !linked.has(id));
      if (addedAccessIds.length) {
        a.draft.sourceAccessIds.push(...addedAccessIds); a.draft.version++; a.draft.updatedAt = now();
      }
      result = { artifactId: a.id, accessIds: [...a.draft.sourceAccessIds], addedAccessIds, version: a.draft.version, updatedAt: a.draft.updatedAt }; break;
    }
    case 'annotate-current': {
      result = executeCommand(state, projectId, 'add-annotation', { text: body.text, target: targetFor(p, a, body, operationId) }, operationId); break;
    }
    case 'record-message': {
      result = executeCommand(state, projectId, 'append-message', { conversationId: body.conversationId, text: body.text,
        ...(body.target ? { target: targetFor(p, a, body, operationId) } : {}) }, operationId); break;
    }
    case 'adopt-result': {
      checkDraft(a, body.baseVersion);
      const research = p.researchResults[body.resultId];
      requireThat(research && research.artifactId === a.id && research.kind === 'brief', 'not_found', '本课题没有这份领域简报。', 404);
      if (a.draft.resultId === research.id) return { adopted: true, resultId: research.id };
      capture(p, a, operationId, 'before_adopt');
      a.draft.resultId = research.id;
      a.draft.sourceAccessIds = [...new Set([...a.draft.sourceAccessIds, ...research.accessIds])];
      a.draft.version++; a.draft.updatedAt = now();
      result = checkpoint(p, a, operationId, '根据反馈更新简报', 'adopt', { resultId: research.id });
      research.adoptedAt = now(); break;
    }
    default: requireThat(false, 'not_implemented', '尚未提供这个操作。', 404);
  }
  p.updatedAt = now();
  return result;
}
export function exportProgress(p, artifactId, revisionId) {
  const a = artifactOf(p, artifactId), revision = getRevision(p, artifactId, revisionId);
  const out = exportRevision(p, artifactId, revisionId);
  // Derived startup indexes remain in the current graph and research state.
  // They must not retroactively enlarge a previously saved revision's export.
  out.evidence = out.evidence.filter(evidence => !isLegacyResultIndexEvidence(p, evidence));
  const numbers = referenceNumbers(p);
  out.sources = out.sources.map(source => ({ ...source, referenceNumber: numbers[source.id] }));
  const result = revision.resultId ? p.researchResults[revision.resultId] : null;
  if (result) { out.research = structuredClone({ framework: result.framework ?? null, dimensions: result.dimensions ?? null, materialCoverage: result.materialCoverage ?? null, searchScope: result.searchScope ?? null, blocks: result.blocks, citations: result.citations, materialManifest: result.materialManifest ?? null, paperNotes: result.paperNotes ?? null, accessIds: result.accessIds, provenance: result.provenance, searchId: result.searchId }); out.search = structuredClone(p.searches[result.searchId] ?? null); }
  if (result && ['questions', 'research_brief', 'research_branch', 'topic_library', 'topic_review'].includes(result.kind)) {
    Object.assign(out.research, structuredClone({ kind: result.kind, adoptionContext: result.adoptionContext, dependencies: result.dependencies, questionRefs: result.questionRefs, decisionSnapshots: result.decisionSnapshots, unknowns: result.unknowns }));
  }
  if (result?.inputContext) out.research.inputContext = structuredClone(result.inputContext);
  if (result?.branchQuestion) out.research.branchQuestion = structuredClone(result.branchQuestion);
  if (result?.library) Object.assign(out.research, structuredClone({ library: result.library, topicSections: result.topicSections, paperTitle: result.paperTitle, outline: result.outline, reviewAccessIds: result.reviewAccessIds, reviewResultId: result.reviewResultId }));
  if (result?.proposal) out.research.proposal = structuredClone(result.proposal);
  out.checkpoint = structuredClone(a.checkpoints.find(c => c.revisionId === revisionId) ?? null);
  return out;
}
