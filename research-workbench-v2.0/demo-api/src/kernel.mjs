import {editTemplates} from './research-templates.mjs';
import { editTopicWorkspace } from './topic-library-workflow.mjs';
import { RELEVANCE_VERSION, topicRelations } from '../../shared/topic-relevance.mjs';
import { topicClassifications } from '../../shared/topic-library-workflow.mjs';
import { randomUUID } from 'node:crypto';
import { requireThat } from './errors.mjs';
import { getProject, getRevision } from './domain.mjs';
import { readableArtifactBlocks } from './artifact-content.mjs';
import { parentReference } from '../../shared/research-path.mjs';
import { assessmentText, normalizeAssessment } from '../../shared/question-assessment.mjs';
import {continuityCommands,applyContinuityCommand,linkContinuityOutput} from './continuity.mjs';
import {resolveResearchRef,continuitySnapshot,sameRef} from '../../shared/research-continuity.mjs';

// The research kernel has no model, transport or storage dependency. Choices belong
// to the researcher; model results can only create proposed research content.
const uid = prefix => `${prefix}_${randomUUID()}`;
const now = () => new Date().toISOString();
const clone = value => structuredClone(value);
const own = (map, key) => typeof key === 'string' && Object.hasOwn(map, key);
const list = value => Array.isArray(value) ? value : [];
const optionalText = value => typeof value === 'string' ? value : '';
const choices = ['explore', 'adopt', 'keep', 'reject', 'defer'];
const choiceLabels = { explore: '先深入', adopt: '当前采用', keep: '暂保留', reject: '排除', defer: '保留未决' };
const accessLabels = { title: '题名', abstract: '摘要', excerpt: '片段', full_text: '全文文本' };
const node = (type, id, revisionId = id) => ({ type, id, revisionId });
const itemNode = (item, revisionId = item.headRevisionId) => node('research_item', item.id, revisionId);
const sameNode = (a, b) => a.type === b.type && a.id === b.id && a.revisionId === b.revisionId;
const text = (value, label) => { requireThat(typeof value === 'string' && value.trim(), 'invalid_input', `${label}需要填写文本。`); return value; };
function find(map, id, label) { requireThat(own(map, id), 'not_found', `${label}不存在或不属于当前课题。`, 404); return map[id]; }
function revisionOf(item, id = item.headRevisionId) { const revision = item.revisions.find(r => r.id === id); requireThat(revision, 'not_found', '研究内容版本不存在。', 404); return revision; }

export function ensureKernel(p) {
  p.researchItems ??= {};
  p.dependencies ??= {};
  p.researchImpacts ??= {};
  p.researchEvents ??= [];
  p.kernelRegistrations ??= {};
  p.researchResults ??= {};
  p.researchKernel ??= { version: 1, currentQuestion: null, exploration: null, choices: {}, position: null };
  return p;
}
function emit(p, type, actor, operationId, target, detail = {}) {
  const event = { id: uid('event'), projectId: p.id, type, actor, operationId: operationId ?? null, target: clone(target), detail: clone(detail), at: now() };
  p.researchEvents.push(event); return event;
}
function changed(p) { p.researchKernel.version++; p.updatedAt = now(); }
function checkState(p, version) { requireThat(version === p.researchKernel.version, 'research_state_conflict', '研究内容或选择已有更新，请保留你的输入并重新查看。', 409, { currentVersion: p.researchKernel.version }); }
function link(p, from, to, relation = 'uses') {
  const existing = Object.values(p.dependencies).find(d => sameNode(d.from, from) && sameNode(d.to, to) && d.relation === relation);
  if (existing) return existing;
  const dependency = { id: uid('dependency'), from: clone(from), to: clone(to), relation, createdAt: now() };
  p.dependencies[dependency.id] = dependency; return dependency;
}
function addItem(p, kind, content, context = {}) {
  const item = { id: uid(kind), kind, title: content.title ?? '', createdAt: now(), origin: clone(context.origin ?? null), revisions: [] };
  const revision = { id: uid('item_revision'), number: 1, previousRevisionId: null, createdAt: now(), actor: context.actor ?? 'model', operationId: context.operationId ?? null,
    text: content.text, title: content.title ?? '', scope: content.scope ?? '', rationale: content.rationale ?? '', unknowns: clone(content.unknowns ?? []), feasibility: clone(content.feasibility ?? { known: [], unknown: [] }),
    informationStatus: content.informationStatus ?? (context.actor === 'local_user' ? 'user_provided' : 'suggestion'), evidenceIds: [], ...clone(content) };
  item.revisions.push(revision); item.headRevisionId = revision.id; p.researchItems[item.id] = item;
  return { item, revision };
}
function evidenceInput(p, entry, allowedAccessIds) {
  const access = find(p.accesses, entry.accessId, '实际访问记录');
  if (allowedAccessIds) requireThat(allowedAccessIds.includes(access.id), 'scope_mismatch', '引用不在本次研究任务读取的材料内。');
  const quote = optionalText(entry.quote), relation = entry.relation ?? 'context', informationStatus = entry.informationStatus ?? 'reported';
  requireThat(['supports', 'contradicts', 'context'].includes(relation), 'invalid_evidence', '依据关系不在支持范围。');
  requireThat(['reported', 'not_reported', 'unknown'].includes(informationStatus), 'invalid_evidence', '依据的信息状态无效。');
  requireThat(!quote || access.text.includes(quote), 'quote_outside_access', '摘录必须出自本次实际访问快照。');
  requireThat(informationStatus === 'reported' ? quote.trim().length > 0 : relation === 'context', 'invalid_evidence', '材料未报告或未知不能作为支持或否定依据。');
  return { access, quote, relation, informationStatus, interpretation: optionalText(entry.interpretation ?? entry.text), passage: entry.passage ?? null, ref: entry.ref ?? null };
}
function addEvidence(p, target, validated, operationId, actor = 'model') {
  const { access, quote, relation, informationStatus, interpretation, passage, ref } = validated;
  const start = quote ? access.text.indexOf(quote) : null;
  const evidence = { id: uid('evidence'), target: clone(target), accessId: access.id, sourceId: access.sourceId, level: access.level, relation, informationStatus,
    quote, interpretation, passage, ref, start, end: start === null ? null : start + quote.length, recordedAt: now(), actor, operationId: operationId ?? null, verification: 'program_located_not_human_reviewed' };
  p.evidence[evidence.id] = evidence;
  return evidence;
}
function sourceAnchor(p, evidence) {
  const access = p.accesses[evidence.accessId], source = access ? p.sources[access.sourceId] : null;
  return { ...clone(evidence), sourceTitle: source?.title ?? '材料身份未知', level: access?.level ?? 'unknown', sourceUrl: source?.url ?? null,
    verification: evidence.verification ?? 'not_checked', anchor: { sourceId: evidence.sourceId, accessId: evidence.accessId, passage: evidence.passage, start: evidence.start, end: evidence.end } };
}
// Startup indexing enriches the live graph; it is not evidence that existed in
// the saved historical artifact. Recognize the first v0.6 indexer's exact graph
// signature too, without rewriting those already persisted records.
export function isLegacyResultIndexEvidence(p, evidence) {
  const target = evidence.target ?? {}, registration = p.kernelRegistrations?.[target.resultId];
  const item = p.researchItems?.[target.itemId];
  const generatedIndex = ['model', 'local_program'].includes(evidence.actor) && registration?.itemIds?.includes(target.itemId)
    && item?.origin?.resultId === target.resultId && item.revisions.some(r => r.id === target.itemRevisionId);
  return Boolean(generatedIndex && (evidence.derivation?.kind === 'research_result_index'
    && evidence.derivation.mode === 'legacy_enrichment' && evidence.derivation.sourceResultId === target.resultId
    || evidence.operationId === 'index-existing-results'));
}
function projectItem(p, item, revisionId = item.headRevisionId) {
  const revision = revisionOf(item, revisionId), decisionId = p.researchKernel.choices[item.id], decision = p.decisions[decisionId];
  return { id: item.id, itemId: item.id, kind: item.kind, revisionId: revision.id, version: revision.number, latestRevisionId: item.headRevisionId,
    text: revision.text, title: revision.title || item.title, scope: revision.scope, rationale: revision.rationale, unknowns: clone(revision.unknowns), feasibility: clone(revision.feasibility),
    informationStatus: revision.informationStatus, proposal: clone(revision.proposal ?? null), ...(revision.assessment ? { assessment:clone(revision.assessment), assessmentNeedsReview:revision.assessmentNeedsReview ?? false } : {}), evidence: revision.evidenceIds.map(id => sourceAnchor(p, find(p.evidence, id, '依据'))), origin: clone(item.origin),
    evidenceNeedsReview: revision.evidenceNeedsReview ?? false, proposalNeedsReview: revision.proposalNeedsReview ?? false,
    supporting: clone(revision.supporting ?? []), conflicting: clone(revision.conflicting ?? []), choice: decision?.choice ?? null, decisionId: decision?.id ?? null,
    isAdopted: p.researchKernel.currentQuestion?.itemId === item.id && p.researchKernel.currentQuestion?.revisionId === revision.id };
}
function projectionOfRef(p, ref) {
  if (!ref) return null;
  const projection = projectItem(p, find(p.researchItems, ref.itemId, '研究内容'), ref.revisionId), decision = p.decisions[ref.decisionId];
  return { ...projection, latestCandidateChoice: projection.choice, choice: decision?.choice ?? null, decisionId: ref.decisionId, intent: clone(decision?.intent ?? null) };
}
function adoptionSnapshot(p) {
  return { version: p.researchKernel.version, currentQuestion: projectionOfRef(p, p.researchKernel.currentQuestion), exploration: projectionOfRef(p, p.researchKernel.exploration),
    decisionIds: [...new Set([...Object.values(p.researchKernel.choices), ...[p.researchKernel.currentQuestion?.decisionId, p.researchKernel.exploration?.decisionId,
      !p.researchKernel.currentQuestion ? p.researchKernel.undecidedDecisionId : null].filter(Boolean)])], undecided: !p.researchKernel.currentQuestion };
}
export function researchState(project) {
  const p = ensureKernel(project), k = p.researchKernel;
  const items = Object.values(p.researchItems), accesses = Object.values(p.accesses), levels = {};
  for (const access of accesses) levels[access.level ?? 'unknown'] = (levels[access.level ?? 'unknown'] ?? 0) + 1;
  return { projectId: p.id, version: k.version, goal: p.goal, originalGoal: p.originalGoal, conditions: p.conditions,
    currentQuestion: projectionOfRef(p, k.currentQuestion), exploration: projectionOfRef(p, k.exploration),
    questions: items.filter(i => i.kind === 'question').map(i => projectItem(p, i)), directions: items.filter(i => i.kind === 'direction').map(i => projectItem(p, i)), claims: items.filter(i => i.kind === 'claim').map(i => projectItem(p, i)),
    artifacts: Object.values(p.artifacts).map(a => ({ id: a.id, kind: a.kind, title: a.title, revisionId: a.headRevisionId, draftVersion: a.draft?.version ?? null, resultId: a.draft?.resultId ?? null,
      createdAt: a.createdAt, needsReview: Object.values(p.researchImpacts).some(i => i.artifactId === a.id && i.status === 'needs_review') })),
    impacts: clone(Object.values(p.researchImpacts)), position: clone(k.position), positions: clone(k.positions ?? {}),
    decisionHistory: Object.values(p.decisions).map(d => clone(d)),
    continuity: continuitySnapshot(p, k.position?.artifactId),
    materialScope: { sourceCount: Object.keys(p.sources).length, accessCount: accesses.length, levels },
    unknowns: [...new Set([k.currentQuestion,k.exploration].filter(Boolean).flatMap(ref => revisionOf(p.researchItems[ref.itemId],ref.revisionId).unknowns ?? []))] };
}

// Legacy results are indexed with explicit origin; no absent human decision is
// reconstructed from an old generated result or the position of an artifact.
export function registerResearchResult(project, result, operationId) {
  const p = ensureKernel(project);
  const legacyEnrichment = operationId === 'index-existing-results', indexActor = legacyEnrichment ? 'local_program' : 'model';
  requireThat(result && typeof result.id === 'string', 'invalid_input', '研究结果需要稳定标识。');
  const a = find(p.artifacts, result.artifactId, '成果');
  if (own(p.kernelRegistrations, result.id)) {
    // A model proposal may be registered before the user adopts its contents.
    // Link any subsequently saved occurrences without rewriting its provenance.
    for (const saved of a.revisions.filter(r => r.resultId === result.id)) {
      for (const itemId of p.kernelRegistrations[result.id].itemIds) {
        const item = p.researchItems[itemId];
        if (item) link(p, node('artifact', a.id, saved.id), itemNode(item, item.revisions[0].id));
      }
    }
    return clone(p.kernelRegistrations[result.id]);
  }
  const actualRevision = a.revisions.find(r => r.resultId === result.id);
  const registrations = [], allowed = list(result.accessIds);
  const prepared = list(result.blocks).filter(b => b.type !== 'heading' && typeof b.text === 'string' && b.text.trim()).map(block => ({ block,
    citations: list(result.citations).filter(c => c.blockId === block.id).map(c => evidenceInput(p, { ...c, relation: c.relation ?? 'context' }, allowed)) }));
  for (const { block, citations } of prepared) {
    const isDirection = block.type === 'candidate' || /^research-branches-\d+$/.test(block.id);
    const kind = isDirection ? 'direction' : 'claim';
    const { item, revision } = addItem(p, kind, { text: block.text, title: block.headline ?? '', ...(block.recordAnchor?{recordAnchor:clone(block.recordAnchor)}:{}), informationStatus: block.informationStatus ?? 'unknown', unknowns: block.informationStatus === 'unknown' ? [block.text] : [] },
      { operationId, actor: indexActor, origin: { resultId: result.id, artifactId: a.id, revisionId: actualRevision?.id ?? null, blockId: block.id, framework: result.framework ?? null } });
    if(block.recordAnchor?.ref&&resolveResearchRef(p,block.recordAnchor.ref))link(p,itemNode(item),block.recordAnchor.ref);
    for (const c of citations) {
      const evidence = addEvidence(p, { itemId: item.id, itemRevisionId: revision.id, artifactId: a.id, revisionId: actualRevision?.id ?? null, resultId: result.id, blockId: block.id }, c, operationId, indexActor);
      evidence.derivation = { kind: 'research_result_index', mode: legacyEnrichment ? 'legacy_enrichment' : 'result_generation', sourceResultId: result.id, indexActor: 'local_program', contentOrigin: 'saved_model_result' };
      revision.evidenceIds.push(evidence.id); link(p, itemNode(item), node('access', c.access.id));
    }
    if (actualRevision) link(p, node('artifact', a.id, actualRevision.id), itemNode(item));
    registrations.push(item.id);
  }
  p.kernelRegistrations[result.id] = { resultId: result.id, itemIds: registrations };
  emit(p, 'research_result_indexed', indexActor, operationId, { resultId: result.id, artifactId: a.id }, { itemIds: registrations, humanAdoption: false, modelCalled: false, legacyEnrichment });
  changed(p); return clone(p.kernelRegistrations[result.id]);
}
function createArtifact(p, kind, title, blocks, accessIds, context, extra = {}) {
  const existing = context.artifactId ? find(p.artifacts, context.artifactId, '成果') : null;
  requireThat(!existing || existing.kind === kind, 'artifact_kind_conflict', '不能用不同类型的成果覆盖当前内容。');
  const a = existing ?? { id: uid('artifact'), kind, title, createdAt: now(), revisions: [], checkpoints: [], legacyRevisionIds: [], templateId: `research-${kind}-v1` };
  const snapshot = clone(context.adoptionContext ?? adoptionSnapshot(p));
  for (const ref of [snapshot.currentQuestion, snapshot.exploration].filter(Boolean)) revisionOf(find(p.researchItems, ref.itemId ?? ref.id, '研究内容'), ref.revisionId);
  snapshot.decisionIds.forEach(id => find(p.decisions, id, '用户决定'));
  const projectContext = clone(context.projectContext ?? { name: p.name, goal: p.goal, originalGoal: p.originalGoal, conditions: p.conditions, metadataVersion: p.metadataVersion });
  const workingAccessIds = [...new Set([...(a.draft?.sourceAccessIds ?? []), ...accessIds])];
  const notes = clone(a.draft?.notes ?? { intent: '', understanding: '', unknown: '', next: '' });
  const resultId = uid('result'), result = { id: resultId, artifactId: a.id, kind, blocks: clone(blocks), citations: clone(extra.citations ?? []), accessIds: [...accessIds], createdAt: now(),
    taskId: context.taskId ?? null, provenance: clone(context.provenance ?? { actor: 'local_program', kind: 'deterministic_record_assembly' }), inputRevisionId: context.inputRevisionId ?? null, adoptionContext: snapshot, ...clone(extra) };
  p.researchResults[resultId] = result;
  const revision = { id: uid('revision'), artifactId: a.id, number: a.revisions.length + 1, previousRevisionId: a.headRevisionId ?? null, createdAt: now(), operationId: context.operationId ?? null,
    reason: 'research_composition', resultId, blocks: readableArtifactBlocks(blocks, notes), sourceAccessIds: [...workingAccessIds], notes,
    projectContext, adoptionContext: clone(snapshot) };
  a.revisions.push(revision); a.headRevisionId = revision.id;
  a.draft = { version: (a.draft?.version ?? 0) + 1, notes: clone(revision.notes), sourceAccessIds: [...workingAccessIds], resultId, updatedAt: now() };
  a.checkpoints ??= []; a.checkpoints.push({ id: uid('progress'), revisionId: revision.id, name: kind === 'questions' ? '比较候选问题' : '整理课题工作简报', type: 'generated', createdAt: now(), scientificAdoption: false });
  p.artifacts[a.id] = a;
  const from = node('artifact', a.id, revision.id);
  link(p, from, node('project_context', p.id, String(projectContext.metadataVersion ?? p.metadataVersion)));
  link(p, from, node('research_choice', p.id, snapshot.currentQuestion?.decisionId ?? 'undecided'));
  for (const accessId of accessIds) link(p, from, node('access', accessId));
  for (const decisionId of snapshot.decisionIds) link(p, from, node('decision', decisionId));
  if (snapshot.currentQuestion) link(p, from, node('research_item', snapshot.currentQuestion.id, snapshot.currentQuestion.revisionId));
  return { artifact: a, revision, result };
}
function snapshotDependencies(p, artifact, revision, result) {
  const dependencies = Object.values(p.dependencies).filter(d => sameNode(d.from, node('artifact', artifact.id, revision.id)));
  revision.dependencies = clone(dependencies); result.dependencies = clone(dependencies);
}
export function inheritArtifactContext(project, artifact, revision) {
  const p = ensureKernel(project), result = revision.resultId ? p.researchResults[revision.resultId] : null;
  if (!result?.adoptionContext) return revision;
  revision.adoptionContext ??= clone(result.adoptionContext);
  const from = node('artifact', artifact.id, revision.id);
  for (const dependency of result.dependencies ?? []) link(p, from, dependency.to, dependency.relation);
  revision.dependencies = clone(Object.values(p.dependencies).filter(d => sameNode(d.from, from)));
  for (const dependency of revision.dependencies) {
    const target = dependency.to;
    if (target.type === 'research_choice' && target.revisionId !== (p.researchKernel.currentQuestion?.decisionId ?? 'undecided')) {
      markAffected(p, target, revision.operationId, '此保存内容沿用了此前采用的问题；当前选择已经不同，请重看适用范围。');
    } else if (target.type === 'research_item' && p.researchItems[target.id]) {
      const item = p.researchItems[target.id], original = revisionOf(item, target.revisionId), latest = revisionOf(item);
      if (original.text !== latest.text || original.scope !== latest.scope) markAffected(p, target, revision.operationId, '此保存内容引用了较早的问题内容或范围，请重看是否仍适用。');
    } else if (target.type === 'project_context') {
      const original = p.metadataHistory.find(h => String(h.version) === target.revisionId);
      if (original && (original.goal !== p.goal || original.conditions !== p.conditions)) markAffected(p, target, revision.operationId, '此保存内容沿用了较早的目标或现实条件，请重看是否仍适用。');
    }
  }
  return revision;
}
function normalizeQuestion(p, value, allowedAccessIds) {
  text(value?.question ?? value?.text, '候选问题');
  for (const field of ['evidence', 'supporting', 'conflicting', 'unknowns']) requireThat(value[field] === undefined || Array.isArray(value[field]), 'invalid_input', '候选问题的依据与未知项需要是列表。');
  const evidence = list(value.evidence).map(e => evidenceInput(p, e, allowedAccessIds));
  for (const [field, relation] of [['supporting', 'supports'], ['conflicting', 'contradicts']]) {
    for (const statement of list(value[field])) {
      text(statement.text, '比较说明');
      requireThat(['reported', 'inference', 'unknown', 'suggestion'].includes(statement.status), 'invalid_evidence', '比较说明需要明确的信息状态。');
      requireThat(!['reported', 'inference'].includes(statement.status) || list(statement.citations).length, 'unsupported_claim', '研究发现或综合解释需要实际来源。');
      for (const c of list(statement.citations)) evidence.push(evidenceInput(p, { ...c, relation: ['unknown', 'suggestion'].includes(statement.status) ? 'context' : relation,
        informationStatus: statement.status === 'unknown' ? 'unknown' : 'reported', interpretation: statement.text }, allowedAccessIds));
    }
  }
  const assessment = value.assessment === undefined ? null : normalizeAssessment(value.assessment);
  requireThat(value.assessment === undefined || assessment, 'invalid_input', '选题预估需要正数区间、假设与依据。');
  return { content: { text: value.question ?? value.text, title: optionalText(value.title), scope: optionalText(value.scope), rationale: optionalText(value.rationale), unknowns: list(value.unknowns).map(v => text(v, '未知项')),
    feasibility: clone(value.feasibility ?? { known: [], unknown: [] }), proposal: clone(value.proposal ?? null), ...(assessment ? {assessment} : {}), supporting: clone(list(value.supporting)), conflicting: clone(list(value.conflicting)), informationStatus: 'suggestion' }, evidence };
}
export function createQuestionComparison(project, inputValidated, context = {}) {
  const p = ensureKernel(project);
  if (context.baseStateVersion !== undefined) checkState(p, context.baseStateVersion);
  requireThat(inputValidated && Array.isArray(inputValidated.questions), 'invalid_input', '候选比较需要问题列表。');
  if (context.artifactId) requireThat(find(p.artifacts, context.artifactId, '成果').kind === 'questions', 'artifact_kind_conflict', '候选比较不能覆盖领域认识。');
  if (context.inputArtifactId) getRevision(p, context.inputArtifactId, context.inputRevisionId);
  const allowedAccessIds = context.accessIds ?? null;
  if (allowedAccessIds) allowedAccessIds.forEach(id => find(p.accesses, id, '实际访问记录'));
  const prepared = inputValidated.questions.map(q => normalizeQuestion(p, q, allowedAccessIds));
  const blocks = [{ id: 'questions-heading', type: 'heading', text: '候选问题比较' }, { id: 'questions-explanation', type: 'paragraph', text: optionalText(inputValidated.explanation) || '这些问题供你比较；深入、保留、采用和排除分别记录。', owner: 'model' }];
  const questions = [], citations = [];
  for (const { content, evidence } of prepared) {
    const { item, revision } = addItem(p, 'question', content, { operationId: context.operationId, actor: 'model', origin: { taskId: context.taskId ?? null, inputArtifactId: context.inputArtifactId ?? context.artifactId ?? null, inputRevisionId: context.inputRevisionId ?? null } });
    blocks.push({ id: item.id, type: 'candidate', text: content.text, owner: 'model', informationStatus: 'suggestion', itemId: item.id, itemRevisionId: revision.id });
    if (content.assessment) blocks.push({id:`${item.id}-assessment`,type:'paragraph',text:assessmentText(content.assessment),owner:'model',informationStatus:'suggestion'});
    for (const [suffix, label, value] of [['scope', '研究范围', content.scope], ['rationale', '为何值得了解', content.rationale], ['unknowns', '尚不清楚', content.unknowns.join('\n')]]) {
      if (value) blocks.push({ id: `${item.id}-${suffix}`, type: 'paragraph', text: `${label}：${value}`, owner: 'model' });
    }
    for (const [field, label] of [['supporting', '支持与背景依据'], ['conflicting', '相反或不同依据']]) {
      content[field].forEach((statement, index) => blocks.push({ id: `${item.id}-${field}-${index}`, type: 'paragraph', text: `${label}：${statement.text}`, informationStatus: statement.status, owner: 'model' }));
    }
    const feasibilityText = typeof content.feasibility === 'string' ? content.feasibility : [...list(content.feasibility.known), ...list(content.feasibility.unknown).map(v => `待核查：${v}`)].join('\n');
    if (feasibilityText) blocks.push({ id: `${item.id}-feasibility`, type: 'paragraph', text: `现实条件与可行性：${feasibilityText}`, owner: 'model' });
    if (content.proposal) for (const [key, label] of [['paperTitle', '论文工作题目'], ['design', '拟议研究设计'], ['primaryOutcome', '主要结局'], ['analysisPlan', '分析路径'], ['noveltyCheck', '创新性核查'], ['contribution', '预期贡献'], ['dataRequirements', '所需数据与条件']]) {
      const value = content.proposal[key];
      if (value) blocks.push({ id: `${item.id}-proposal-${key}`, type: 'paragraph', text: `${label}：${Array.isArray(value) ? value.join('；') : value}`, informationStatus: 'suggestion', owner: 'model' });
    }
    for (const e of evidence) {
      const entry = addEvidence(p, { itemId: item.id, itemRevisionId: revision.id }, e, context.operationId);
      revision.evidenceIds.push(entry.id); link(p, itemNode(item), node('access', entry.accessId));
      citations.push({ blockId: item.id, accessId: entry.accessId, sourceId: entry.sourceId, quote: entry.quote, ref: entry.ref, passage: entry.passage, relation: entry.relation, evidenceId: entry.id });
    }
    questions.push({ item, revision });
  }
  if (!questions.length) blocks.push({ id: 'questions-empty', type: 'paragraph', text: '本次材料尚不足以形成候选问题，当前保留未决。', informationStatus: 'unknown' });
  if (inputValidated.next) blocks.push({ id: 'questions-next', type: 'paragraph', text: String(inputValidated.next), informationStatus: 'suggestion', owner: 'model' });
  const accessIds = [...new Set([...(allowedAccessIds ?? []), ...citations.map(c => c.accessId)])];
  // artifactId identifies an existing comparison only. The landscape input is
  // inputArtifactId, to prevent changing its type or replacing its contents.
  const { artifact, revision, result } = createArtifact(p, 'questions', '候选问题比较', blocks, accessIds, context,
    { citations, inputContext: context.inputArtifactId ? { artifactId: context.inputArtifactId, revisionId: context.inputRevisionId, basis: 'recorded_task_input' } : null,
      questionRefs: questions.map(q => ({ itemId: q.item.id, revisionId: q.revision.id })), explanation: inputValidated.explanation ?? '', next: inputValidated.next ?? '' });
  for (const q of questions) {
    q.item.origin = { ...q.item.origin, artifactId: artifact.id, revisionId: revision.id, resultId: result.id, blockId: q.item.id };
    link(p, node('artifact', artifact.id, revision.id), itemNode(q.item));
    for (const evidenceId of q.revision.evidenceIds) Object.assign(p.evidence[evidenceId].target, { artifactId: artifact.id, revisionId: revision.id, blockId: q.item.id, resultId: result.id });
  }
  if (context.inputArtifactId && context.inputRevisionId) {
    getRevision(p, context.inputArtifactId, context.inputRevisionId);
    link(p, node('artifact', artifact.id, revision.id), node('artifact', context.inputArtifactId, context.inputRevisionId));
  }
  snapshotDependencies(p, artifact, revision, result);
  inheritArtifactContext(p, artifact, revision);
  p.kernelRegistrations[result.id] = { resultId: result.id, itemIds: questions.map(q => q.item.id) };
  emit(p, 'question_comparison_generated', 'model', context.operationId, { artifactId: artifact.id, revisionId: revision.id, resultId: result.id }, { questionIds: questions.map(q => q.item.id), humanAdoption: false });
  changed(p);
  return { artifactId: artifact.id, revisionId: revision.id, resultId: result.id, questionIds: questions.map(q => q.item.id) };
}

function markAffected(p, cause, operationId, explanation) {
  const visited = new Set(), pending = [cause];
  while (pending.length) {
    const current = pending.shift(), key = JSON.stringify(current);
    if (visited.has(key)) continue; visited.add(key);
    for (const dependency of Object.values(p.dependencies).filter(d => sameNode(d.to, current))) {
      pending.push(dependency.from);
      const resolved = resolveResearchRef(p,dependency.from);
      const a = p.artifacts[resolved?.artifactId];
      if (!a) continue;
      const exists = Object.values(p.researchImpacts).some(i => sameRef(i.target??node('artifact',i.artifactId,i.artifactRevisionId),dependency.from) && sameNode(i.cause, cause));
      if (exists) continue;
      const impact = { id: uid('impact'), artifactId: a.id, artifactRevisionId: dependency.from.revisionId, target:clone(dependency.from), targetTitle:resolved.title, cause: clone(cause), explanation, status: 'needs_review', createdAt: now(), operationId, resolutions: [] };
      p.researchImpacts[impact.id] = impact;
    }
  }
}
export function markProjectContextChange(project, previous, operationId) {
  const p = ensureKernel(project);
  if (previous.goal === p.goal && previous.conditions === p.conditions && (!Object.hasOwn(previous, 'researcherProfileVersion') || previous.researcherProfileVersion === p.researcherProfile?.version)) return [];
  const beforeIds = new Set(Object.keys(p.researchImpacts));
  const equivalentVersions = [previous.metadataVersion, ...list(p.metadataHistory).filter(h => h.goal === previous.goal && h.conditions === previous.conditions).map(h => h.version)];
  for (const version of new Set(equivalentVersions)) markAffected(p, node('project_context', p.id, String(version)), operationId, '当前目标或现实条件已修改，请重看引用旧条件的成果。');
  changed(p); emit(p, 'research_context_changed', 'local_user', operationId, { projectId: p.id }, { fromVersion: previous.metadataVersion, toVersion: p.metadataVersion });
  return Object.values(p.researchImpacts).filter(i => !beforeIds.has(i.id));
}
function userIntent(p, body, command, target, operationId) {
  if (body.intentMessageId) {
    const message = find(p.messages, body.intentMessageId, '用户消息');
    requireThat(message.role === 'user', 'invalid_intent', '选择必须来自实际用户消息或当前按钮操作。');
    if (body.userText !== undefined) requireThat(body.userText === message.text, 'invalid_intent', '用户消息原文不能被替换。');
    return { kind: 'message', messageId: message.id, text: message.text, command, target: clone(target) };
  }
  requireThat(body.userText === undefined || typeof body.userText === 'string', 'invalid_intent', '用户表达必须是原始文本。');
  const intent = { id: uid('intent'), kind: body.userText ? 'user_text' : 'button_action', text: body.userText ?? null, command, choice: body.choice ?? null, target: clone(target), actor: 'local_user', operationId, createdAt: now() };
  // Button action is evidence of a choice, not fabricated conversational speech.
  return intent;
}
export function composeResearchBrief(project, body, operationId) {
  const p = ensureKernel(project); checkState(p, body.baseStateVersion);
  if (body.artifactId) requireThat(find(p.artifacts, body.artifactId, '成果').kind === 'research_brief', 'artifact_kind_conflict', '请选择课题工作简报，原领域认识不会被覆盖。');
  const prior = body.artifactId ? parentReference(p, p.artifacts[body.artifactId]) : null;
  const inputId = body.inputArtifactId ?? prior?.artifactId;
  const inputArtifact = inputId ? find(p.artifacts, inputId, '输入成果') : null;
  requireThat(!inputArtifact || inputArtifact.id !== body.artifactId, 'invalid_scope', '简报不能以自身作为来源。');
  const inputRevision = inputArtifact ? getRevision(p, inputId, body.inputRevisionId ?? (body.inputArtifactId ? inputArtifact.headRevisionId : prior.revisionId)) : null;
  const inputResult = inputRevision?.resultId ? p.researchResults[inputRevision.resultId] : null;
  const inputContext = inputArtifact ? { artifactId: inputId, revisionId: inputRevision.id, resultId: inputResult?.id ?? null, basis: 'explicit_input' } : null;
  const current = projectionOfRef(p, p.researchKernel.currentQuestion), exploration = projectionOfRef(p, p.researchKernel.exploration);
  const reference = current ?? exploration, decisions = adoptionSnapshot(p).decisionIds.map(id => p.decisions[id]);
  const sourceBlocks = list(inputResult?.blocks), sourceUnknowns = sourceBlocks.filter(b => /^research-gaps-\d+$/.test(b.id)).map(b => b.text);
  const original = p.originalGoal || '原始意图尚未记录', unknowns = reference ? reference.unknowns : inputResult ? sourceUnknowns : researchState(p).unknowns;
  const feasibility = reference?.feasibility ?? { known: [], unknown: [] };
  const feasibilityText = typeof feasibility === 'string' ? feasibility : [...list(feasibility.known), ...list(feasibility.unknown).map(v => `待核查：${v}`)].join('\n');
  const blocks = [], citations = [];
  const section = (key, label, content) => { blocks.push({ id: `${key}-heading`, type: 'heading', text: label }); blocks.push({ id: key, type: 'paragraph', text: content, owner: 'local_program' }); };
  section('original-intent', '原始研究意图', original);
  section('current-goal', '当前目标与现实条件', [p.goal || '当前目标尚未记录', p.conditions || '现实条件尚未记录'].join('\n'));
  section('current-question', '当前研究问题', current ? `${current.text}${current.scope ? `\n研究范围：${current.scope}` : ''}` : '当前保留未决，尚未采用研究问题。');
  // Preserve the original statements and their exact citations; this is record
  // assembly, never a fresh model interpretation or a scientific adoption.
  const inherited = sourceBlocks.filter(b => b.type !== 'heading' && (/^research-overview-\d+$/.test(b.id) || b.analysisRole === 'comparison'));
  if (!inherited.length && inputResult) inherited.push(...sourceBlocks.filter(b => b.type !== 'heading' && !b.id.startsWith('note-')));
  if (inherited.length) {
    blocks.push({ id: 'inherited-understanding-heading', type: 'heading', text: '已经形成的领域认识' });
    for (const b of inherited) {
      const id = `inherited-${b.id}`;
      blocks.push({ ...clone(b), id, inheritedFrom: { ...inputContext, blockId: b.id } });
      citations.push(...list(inputResult.citations).filter(c => c.blockId === b.id).map(c => ({ ...clone(c), blockId: id })));
    }
  }
  if (!current && exploration) section('exploration-context', '当前深入的方向或问题', `${exploration.text}${exploration.scope ? `\n探索范围：${exploration.scope}` : ''}\n这次深入由你明确选择，尚未采用为研究问题。`);
  section('actual-choices', '已经表达的取舍', decisions.length ? decisions.map(d => {
    const i = p.researchItems[d.target.itemId], r = i && revisionOf(i, d.target.itemRevisionId);
    const label = d.choice === 'adopt' ? d.id === current?.decisionId ? '当前采用' : '曾经采用' : choiceLabels[d.choice];
    return `${label}：${r?.text ?? '整体问题选择'}${d.intent?.text ? `\n用户原话：${d.intent.text}` : ''}`;
  }).join('\n\n') : '尚未记录候选问题的取舍。');
  section('key-evidence', !current && exploration ? '探索中的参考依据（尚未采用问题）' : '关键依据', reference?.evidence?.filter(e => e.relation !== 'contradicts').length ? reference.evidence.filter(e => e.relation !== 'contradicts').map(e => `${e.interpretation || e.quote}\n来源：${e.sourceTitle}；访问层级：${accessLabels[e.level] ?? '未知'}`).join('\n\n') : '当前参考范围尚无关联的支持或背景依据。');
  section('contradictions', '分歧与相反依据', reference?.evidence?.some(e => e.relation === 'contradicts') ? reference.evidence.filter(e => e.relation === 'contradicts').map(e => `${e.interpretation || e.quote}\n来源：${e.sourceTitle}；访问层级：${accessLabels[e.level] ?? '未知'}`).join('\n\n') : '当前记录尚未关联相反依据；这不表示不存在分歧。');
  section('unknowns', '尚不清楚的内容', unknowns.length ? unknowns.join('\n') : '未知项尚未整理；没有记录不表示已经明确。');
  section('conditions', '已知条件与可行性待核查', feasibilityText || '可行性尚未核查。');
  const nextText = typeof body.next === 'string' && body.next.trim() ? body.next : current ? '结合当前问题与未知项，选择下一项需要补查或讨论的工作。' : exploration ? '围绕正在深入的方向与未知项继续补查或讨论，研究问题仍可保留未决。' : '继续比较候选问题、补充材料，或暂时保留未决。';
  section('next', '下一项工作', nextText);
  for (const e of reference?.evidence ?? []) citations.push({ blockId: e.relation === 'contradicts' ? 'contradictions' : 'key-evidence', accessId: e.accessId, sourceId: e.sourceId, quote: e.quote, ref: e.ref, passage: e.passage, evidenceId: e.id, relation: e.relation });
  const accessIds = [...new Set(citations.map(c => c.accessId))];
  if (!reference?.evidence?.length && inherited.length) {
    blocks.find(b => b.id === 'key-evidence').text = '关键研究依据随上方领域认识逐条保留，可点击文献编号查看原文。尚未采用具体问题，因此没有把领域依据认定为某一选题的支持证据。';
  }
  const workingIds = [...new Set([...(inputRevision?.sourceAccessIds ?? []), ...accessIds])];
  const composed = createArtifact(p, 'research_brief', '课题工作简报', blocks, workingIds, { artifactId: body.artifactId, operationId },
    { citations, referenceContext: current ? 'adopted_question' : exploration ? 'explicit_exploration' : null,
      inputContext,
      userNextText: typeof body.next === 'string' ? body.next : null, unknowns: clone(unknowns), decisionSnapshots: clone(decisions),
      materialManifest: accessIds.map(id => { const a = p.accesses[id], s = p.sources[a.sourceId]; return { accessId: id, sourceId: a.sourceId, title: s.title, level: a.level, text: a.text }; }) });
  composed.result.accessIds = accessIds;
  if (inputContext) link(p, node('artifact', composed.artifact.id, composed.revision.id), node('artifact', inputContext.artifactId, inputContext.revisionId));
  for (const decision of decisions) {
    if (decision.target.itemId) link(p, node('artifact', composed.artifact.id, composed.revision.id), node('research_item', decision.target.itemId, decision.target.itemRevisionId));
  }
  snapshotDependencies(p, composed.artifact, composed.revision, composed.result);
  p.kernelRegistrations[composed.result.id] = { resultId: composed.result.id, itemIds: [] };
  emit(p, 'research_brief_composed', 'local_program', operationId, { artifactId: composed.artifact.id, revisionId: composed.revision.id }, { adoptionContext: composed.revision.adoptionContext, modelCalled: false });
  changed(p); return { artifactId: composed.artifact.id, revisionId: composed.revision.id, resultId: composed.result.id, undecided: !current };
}

function openResearchBranch(state, p, body, operationId) {
  checkState(p, body.baseStateVersion);
  const parent = find(p.artifacts, body.inputArtifactId, '上一步成果');
  requireThat(body.baseInputVersion === parent.draft.version, 'draft_conflict', '上一步内容已更新，请重新查看后进入分支。', 409);
  const saved = getRevision(p, parent.id, body.inputRevisionId);
  requireThat(saved.resultId === parent.draft.resultId && JSON.stringify(saved.notes) === JSON.stringify(parent.draft.notes), 'revision_conflict', '输入快照与当前内容不同，请重新保存后进入分支。', 409);
  const item = find(p.researchItems, body.itemId, '研究问题'), revision = revisionOf(item, body.itemRevisionId);
  requireThat(['question', 'direction'].includes(item.kind) && body.itemRevisionId === item.headRevisionId, 'revision_conflict', '请从当前候选版本进入探索。', 409);
  const selectedIds = body.accessIds ?? saved.sourceAccessIds;
  requireThat(Array.isArray(selectedIds) && new Set(selectedIds).size === selectedIds.length && selectedIds.every(id => saved.sourceAccessIds.includes(id) && own(p.accesses, id)), 'invalid_scope', '探索材料必须来自上一步实际保存的材料。');
  const existing = Object.values(p.artifacts).find(a => a.kind === 'research_branch' && a.lineage?.artifactId === parent.id && a.branchQuestion?.itemId === item.id && a.branchQuestion?.revisionId === revision.id);
  if (existing) return { artifactId: existing.id, revisionId: existing.headRevisionId, resultId: existing.draft.resultId, reused: true };
  kernelCommand(state, p.id, 'decide-question', { baseStateVersion: p.researchKernel.version, itemId: item.id, itemRevisionId: revision.id, choice: 'explore' }, operationId);
  const q = projectItem(p, item), inputContext = { artifactId: parent.id, revisionId: saved.id, resultId: saved.resultId, basis: 'topic_click' };
  const blocks = [
    { id: 'branch-question-heading', type: 'heading', text: '研究命题' },
    { id: 'branch-question', type: 'paragraph', text: q.text, informationStatus: 'suggestion' },
    { id: 'branch-rationale-heading', type: 'heading', text: '提出这一问题的理由' },
    { id: 'branch-rationale', type: 'paragraph', text: q.rationale || '从上一步所选内容进入，接下来需要结合材料论证具体问题。', informationStatus: 'suggestion' },
  ];
  const proposal = q.proposal;
  if (q.assessment) blocks.push({id:'branch-assessment-heading',type:'heading',text:'价值、可行性与投入预估'}, {id:'branch-assessment',type:'paragraph',text:assessmentText(q.assessment),informationStatus:'suggestion'});
  if (q.proposalNeedsReview) blocks.push({ id: 'branch-design-review', type: 'paragraph', text: '问题表达或范围已修订；以下设计保留此前版本，适用性需要重新论证。', informationStatus: 'unknown' });
  for (const [key, label] of [['design', '拟议研究设计'], ['primaryOutcome', '主要结局'], ['analysisPlan', '分析路径'], ['noveltyCheck', '创新性核查'], ['contribution', '预期贡献']]) {
    if (proposal?.[key]) blocks.push({ id: `branch-${key}-heading`, type: 'heading', text: label }, { id: `branch-${key}`, type: 'paragraph', text: proposal[key], informationStatus: 'suggestion' });
  }
  blocks.push({ id: 'branch-unknowns-heading', type: 'heading', text: '开展前需要明确' }, { id: 'branch-unknowns', type: 'paragraph', text: [...q.unknowns, ...list(proposal?.dataRequirements)].join('\n') || '需要确认数据来源、研究对象、主要结局与已有研究的区别。', informationStatus: 'unknown' });
  const citations = q.evidence.filter(e => selectedIds.includes(e.accessId)).map(e => ({ blockId: 'branch-rationale', accessId: e.accessId, sourceId: e.sourceId, quote: e.quote, ref: e.ref, passage: e.passage, evidenceId: e.id }));
  const result = createArtifact(p, 'research_branch', (!q.proposalNeedsReview && proposal?.paperTitle) || q.title || q.text.split(/[：:。！？\n]/)[0], blocks, selectedIds, { operationId, inputRevisionId: saved.id },
    { citations, inputContext, branchQuestion: { itemId: item.id, revisionId: revision.id }, proposal: clone(proposal), continuation: 'ready_for_investigation' });
  result.artifact.lineage = clone(inputContext); result.artifact.branchQuestion = { itemId: item.id, revisionId: revision.id };
  result.artifact.checkpoints.at(-1).name = '进入选题探索';
  link(p, node('artifact', result.artifact.id, result.revision.id), node('artifact', parent.id, saved.id));
  link(p, node('artifact', result.artifact.id, result.revision.id), itemNode(item, revision.id));
  snapshotDependencies(p, result.artifact, result.revision, result.result);
  emit(p, 'research_branch_opened', 'local_user', operationId, { artifactId: result.artifact.id }, { inputContext, itemId: item.id, itemRevisionId: revision.id, modelCalled: false });
  changed(p);
  return { artifactId: result.artifact.id, revisionId: result.revision.id, resultId: result.result.id, reused: false };
}

export function saveBranchInvestigation(project, task, parsed, provenance) {
  const p = ensureKernel(project), a = find(p.artifacts, task.artifactId, '探索页面');
  requireThat(a.kind === 'research_branch', 'artifact_kind_conflict', '论证结果需要对应探索页面。');
  const original = p.researchResults[task.input.resultId];
  const answer = { id: uid('result'), artifactId: a.id, taskId: task.id, kind: 'answer', ...clone(parsed), createdAt: now(), provenance: clone(provenance),
    accessIds: task.input.materials.map(m => m.accessId), inputRevisionId: task.input.revisionId, adoptionContext: clone(task.input.adoptionContext) };
  p.researchResults[answer.id] = answer;
  // A late answer remains reviewable without replacing newer notes, choices or content.
  if (task.staleInput) return { resultId: answer.id, applied: false };
  const baseBlocks = (original?.blocks ?? []).filter(b => !b.id.startsWith('investigation-'));
  const blocks = [...baseBlocks, { id: 'investigation-heading', type: 'heading', text: '选题论证与研究路径' }, ...parsed.blocks.map(b => ({ ...clone(b), id: `investigation-${b.id}` }))];
  const citations = [...(original?.citations ?? []).filter(c => !c.blockId.startsWith('investigation-')), ...parsed.citations.map(c => ({ ...clone(c), blockId: `investigation-${c.blockId}` }))];
  const composed = createArtifact(p, 'research_branch', a.title, blocks, answer.accessIds, { artifactId: a.id, operationId: task.requestId, taskId: task.id,
    inputRevisionId: task.input.revisionId, adoptionContext: task.input.adoptionContext, provenance },
    { citations, inputContext: clone(a.lineage), branchQuestion: clone(a.branchQuestion), proposal: clone(original?.proposal ?? null), investigationResultId: answer.id });
  link(p, node('artifact', a.id, composed.revision.id), node('artifact', a.lineage.artifactId, a.lineage.revisionId));
  link(p, node('artifact', a.id, composed.revision.id), node('research_item', a.branchQuestion.itemId, a.branchQuestion.revisionId));
  snapshotDependencies(p, composed.artifact, composed.revision, composed.result);
  a.checkpoints.at(-1).name = '选题论证与研究路径';
  emit(p, 'branch_investigation_saved', 'model', task.requestId, { artifactId: a.id, revisionId: composed.revision.id }, { answerResultId: answer.id });
  changed(p); return { resultId: answer.id, outputArtifactId: a.id, applied: true };
}

// A topic library owns screening decisions; AI relevance never changes them.
function openTopicLibrary(p, body, operationId) {
  checkState(p, body.baseStateVersion);
  const parent = find(p.artifacts, body.inputArtifactId, '选题页面');
  requireThat(parent.kind === 'research_branch' && parent.draft.version === body.baseInputVersion, 'draft_conflict', '请从当前选题页面建立专题文献库。', 409);
  const saved = getRevision(p, parent.id, body.inputRevisionId);
  requireThat(saved.resultId === parent.draft.resultId && JSON.stringify(saved.sourceAccessIds) === JSON.stringify(parent.draft.sourceAccessIds), 'revision_conflict', '材料范围已变化，请刷新后入库。', 409);
  const existing = Object.values(p.artifacts).find(a => a.kind === 'topic_library' && a.lineage?.artifactId === parent.id);
  if (existing) return { artifactId: existing.id, revisionId: existing.headRevisionId, resultId: existing.draft.resultId, reused: true };
  const library = { questionRef: clone(parent.branchQuestion), entries: saved.sourceAccessIds.map(accessId => ({ accessId, decision: 'pending', reason: '', actor: null })), searchIds: Object.values(p.searches).filter(x => x.accessIds.some(id => saved.sourceAccessIds.includes(id))).map(x => x.id) };
  const inputContext = { artifactId: parent.id, revisionId: saved.id, resultId: saved.resultId, basis: 'user_open_topic_library' };
  const made = createArtifact(p, 'topic_library', '专题文献库', [{ id: 'library-heading', type: 'heading', text: '围绕当前选题整理文献' }], saved.sourceAccessIds, { operationId, inputRevisionId: saved.id }, { library, inputContext, branchQuestion: clone(parent.branchQuestion) });
  made.artifact.lineage = clone(inputContext); made.artifact.branchQuestion = clone(parent.branchQuestion);
  made.artifact.checkpoints.at(-1).name = '建立专题文献库';
  link(p, node('artifact', made.artifact.id, made.revision.id), node('artifact', parent.id, saved.id));
  link(p, node('artifact', made.artifact.id, made.revision.id), node('research_item', parent.branchQuestion.itemId, parent.branchQuestion.revisionId));
  snapshotDependencies(p, made.artifact, made.revision, made.result);
  emit(p, 'topic_library_created', 'local_user', operationId, { artifactId: made.artifact.id }, { inputContext, count: library.entries.length, modelCalled: false });
  changed(p); return { artifactId: made.artifact.id, revisionId: made.revision.id, resultId: made.result.id };
}
function updateTopicLibrary(p, body, operationId, policy = null) {
  const a = find(p.artifacts, body.artifactId, '专题文献库');
  requireThat(a.kind === 'topic_library' && body.baseVersion === a.draft.version, 'draft_conflict', '文献库已更新，请刷新后保留筛选。', 409);
  const previous = p.researchResults[a.draft.resultId], library = clone(previous.library);
  const added = body.addAccessIds ?? [];
  const parent = p.artifacts[a.lineage.artifactId];
  requireThat(Array.isArray(added) && new Set(added).size === added.length && added.every(id => p.accesses[id] && (a.draft.sourceAccessIds.includes(id) || parent.draft.sourceAccessIds.includes(id))), 'invalid_scope', '只能加入本选题已有的实际材料。');
  for (const id of [...new Set([...a.draft.sourceAccessIds, ...added])]) if (!library.entries.some(e => e.accessId === id)) library.entries.push({ accessId: id, decision: 'pending', reason: '', actor: null });
  requireThat(Array.isArray(body.decisions ?? []) && new Set((body.decisions ?? []).map(x=>x.accessId)).size === (body.decisions ?? []).length, 'invalid_input', '筛选决定不能重复。');
  for (const decision of body.decisions ?? []) {
    const entry = library.entries.find(e=>e.accessId===decision.accessId);
    requireThat(entry && ['included','excluded','pending'].includes(decision.decision) && typeof (decision.reason ?? '') === 'string', 'invalid_input', '请选择本库材料并明确纳入、排除或待判断。');
    Object.assign(entry, { decision: decision.decision, reason: decision.reason ?? '', actor: policy?'local_program':'local_user', policyId:policy?.id??null, at: now(), operationId });
  }
  const ids = library.entries.map(e=>e.accessId);
  library.searchIds = Object.values(p.searches).filter(x=>x.accessIds.some(id=>ids.includes(id))).map(x=>x.id);
  const { id, artifactId, createdAt, kind, ...extra } = previous;
  const made = createArtifact(p, 'topic_library', a.title, previous.blocks, ids, { artifactId: a.id, operationId }, { ...clone(extra), library });
  made.artifact.checkpoints.at(-1).name = '保存文献筛选'; snapshotDependencies(p,a,made.revision,made.result);
  emit(p,'topic_library_screened',policy?'local_program':'local_user',operationId,{artifactId:a.id,revisionId:made.revision.id},{decisions:clone(body.decisions??[]),addedAccessIds:added,modelCalled:false,...(policy?{policyId:policy.id}:{})});
  changed(p); return {artifactId:a.id,revisionId:made.revision.id,resultId:made.result.id};
}
// Executes the researcher's chosen grade policy. A later individual decision
// remains an exception until the researcher explicitly applies the policy again.
export function applyTopicScreeningPolicy(p,a,operationId,{explicit=false,accessIds=a.draft.sourceAccessIds}={}) {
  const w=a.topicWorkspace;
  w.screeningPolicy??={id:uid('grade_policy'),includeRelations:[],excludeD:true,at:now()};
  const policy=w.screeningPolicy,result=p.researchResults[a.draft.resultId],classes=topicClassifications(w,result.paperNotes),entries=result.library.entries;
  const decisions=[];
  for(const accessId of accessIds){
    const note=classes[accessId],entry=entries.find(e=>e.accessId===accessId);
    if(!note||note.criteriaVersion!==RELEVANCE_VERSION)continue;
    if(!explicit&&entry?.actor==='local_user'&&entry.at>=policy.at)continue;
    const priorPolicy=entry?.policyId?(w.policyChanges??[]).find(c=>c.policyId===entry.policyId&&c.before.some(e=>e.accessId===accessId))?.before.find(e=>e.accessId===accessId):null;
    const restoring=priorPolicy&&note.relationship!=='unrelated'&&(policy.actor!=='local_user'||entry.decision==='excluded');
    const decision=note.relationship==='unclear'?(restoring?priorPolicy.decision:null):note.relationship==='unrelated'?'excluded':policy.includeRelations.includes(note.relationship)?'included':explicit||policy.actor==='local_user'&&entry?.policyId?'pending':restoring?priorPolicy.decision:null;
    if(!decision||entry?.decision===decision)continue;
    decisions.push({accessId,decision,reason:restoring&&!explicit?priorPolicy.reason??'恢复此前取舍。':decision==='excluded'?`D · 不相关；${note.summary??note.reason}`:decision==='included'?`按所选等级纳入：${topicRelations[note.relationship]}`:'未选入当前纳入等级，保留待取舍。'});
  }
  if(!decisions.length)return {artifactId:a.id,changed:0};
  const before=decisions.map(d=>clone(entries.find(e=>e.accessId===d.accessId)??{accessId:d.accessId,decision:'pending',reason:''}));
  const updated=updateTopicLibrary(p,{artifactId:a.id,baseVersion:a.draft.version,decisions},operationId,policy);
  w.policyChanges??=[];w.policyChanges.push({id:uid('grade_change'),operationId,policyId:policy.id,at:now(),before,decisions:clone(decisions),explicit});
  return {...updated,changed:decisions.length};
}
export function saveTopicReview(project, task, parsed, provenance) {
  const p = ensureKernel(project), a = find(p.artifacts, task.artifactId, '专题文献库');
  requireThat(a.kind === 'topic_library', 'artifact_kind_conflict', '专题分析需要对应文献库。');
  const original = p.researchResults[task.input.resultId];
  const report = { id: uid('result'), artifactId:a.id, taskId:task.id, kind:'topic_review', ...clone(parsed), accessIds:task.input.materials.map(m=>m.accessId), inputRevisionId:task.input.revisionId, createdAt:now(), provenance:clone(provenance), adoptionContext:clone(task.input.adoptionContext), library:clone(original.library) };
  p.researchResults[report.id] = report;
  if (task.staleInput) return {resultId:report.id,applied:false};
  const library = clone(original.library);
  for (const id of a.draft.sourceAccessIds) if (!library.entries.some(e=>e.accessId===id)) library.entries.push({accessId:id,decision:'pending',reason:'',actor:null});
  // A narrower new review changes the synthesis scope, not prior per-paper work.
  const paperNotes=[...new Map([...(original.paperNotes??[]),...parsed.paperNotes.map(note=>({...note,reviewResultId:report.id}))].map(note=>[note.accessId,clone(note)])).values()];
  const made=createArtifact(p,'topic_library',a.title,parsed.blocks,a.draft.sourceAccessIds,{artifactId:a.id,operationId:task.requestId,taskId:task.id,inputRevisionId:task.input.revisionId,adoptionContext:task.input.adoptionContext,provenance},{...clone(parsed),paperNotes,library,inputContext:clone(a.lineage),branchQuestion:clone(a.branchQuestion),reviewResultId:report.id,reviewAccessIds:report.accessIds});
  link(p,node('artifact',a.id,made.revision.id),node('artifact',a.lineage.artifactId,a.lineage.revisionId));
  link(p,node('artifact',a.id,made.revision.id),node('research_item',a.branchQuestion.itemId,a.branchQuestion.revisionId));
  snapshotDependencies(p,a,made.revision,made.result);a.checkpoints.at(-1).name='专题证据分析';
  emit(p,'topic_review_saved','model',task.requestId,{artifactId:a.id,revisionId:made.revision.id},{reviewResultId:report.id,screeningUnchanged:true});
  changed(p);return {resultId:report.id,outputArtifactId:a.id,applied:true};
}

export function recordOutputDependencies(p,ref,snapshot) { return linkContinuityOutput(p,ref,snapshot,{link}); }
export const kernelCommands = new Set([...continuityCommands,'update-research-templates', 'create-question', 'decide-question', 'revise-question', 'compose-brief', 'open-branch', 'open-topic-library', 'update-topic-library', 'update-topic-workspace', 'resolve-impact', 'set-position']);
export function kernelCommand(state, projectId, name, body, operationId) {
  requireThat(kernelCommands.has(name), 'unknown_command', '不支持此研究操作。', 404);
  const p = ensureKernel(getProject(state, projectId)), k = p.researchKernel, eventStart = p.researchEvents.length;
  let result;
  if(continuityCommands.has(name)) result=applyContinuityCommand(p,name,body,operationId,{checkState,find,addItem,link,markAffected,emit,changed,userIntent,uid,now});
  else if(name==='update-research-templates') result=editTemplates(p,find(p.artifacts,body.artifactId,'研究页面'),body,operationId);
  else if (name === 'compose-brief') result = composeResearchBrief(p, body, operationId);
  else if (name === 'open-branch') result = openResearchBranch(state, p, body, operationId);
  else if (name === 'open-topic-library') result = openTopicLibrary(p, body, operationId);
  else if (name === 'update-topic-library') result = updateTopicLibrary(p, body, operationId);
  else if (name === 'update-topic-workspace') {
    const a=find(p.artifacts,body.artifactId,'专题文献库');
    result=editTopicWorkspace(p,a,body,operationId);
    if(body.action==='screening-policy') result={...result,...applyTopicScreeningPolicy(p,a,operationId,{explicit:true})};
    if(body.action==='override'&&body.relationship==='unrelated')result={...result,...applyTopicScreeningPolicy(p,a,operationId,{explicit:true,accessIds:[body.accessId]})};
    if(body.action==='undo-screening-policy') {
      const change=a.topicWorkspace.policyChanges.find(c=>c.id===body.changeId),entries=p.researchResults[a.draft.resultId].library.entries;
      const decisions=change.before.filter(e=>entries.find(current=>current.accessId===e.accessId)?.operationId===change.operationId);
      if(decisions.length)result={...result,...updateTopicLibrary(p,{artifactId:a.id,baseVersion:a.draft.version,decisions},operationId)};
      change.undoneAt=now();
    }
    if(body.action==='restore') {
      const snapshot=a.topicWorkspace.snapshots.find(s=>s.id===body.snapshotId);
      const decisions=a.draft.sourceAccessIds.map(accessId=>snapshot.decisions.find(e=>e.accessId===accessId)??{accessId,decision:'pending',reason:'保留在恢复范围之外，待重新判断'});
      result={...result,...updateTopicLibrary(p,{artifactId:a.id,baseVersion:a.draft.version,decisions},operationId)};
    }
  }
  else if (name === 'set-position') {
    const a = find(p.artifacts, body.artifactId, '成果'), revision = body.revisionId ? getRevision(p, a.id, body.revisionId) : null;
    const blocks = revision?.blocks ?? p.researchResults[a.draft?.resultId]?.blocks ?? a.revisions.at(-1).blocks;
    requireThat(!body.blockId || blocks.some(b => b.id === body.blockId) || ['note-intent', 'note-understanding', 'note-unknown', 'note-next'].includes(body.blockId), 'anchor_not_found', '阅读位置不属于这份成果。', 404);
    const position = { artifactId: a.id, revisionId: revision?.id ?? null, blockId: body.blockId ?? null, updatedAt: now() };
    // A delayed paragraph-position save from the page being left must not
    // replace a newer explicit navigation to another artifact.
    if (!body.passive || !k.position || k.position.artifactId === a.id) k.position = position;
    k.positions ??= {}; k.positions[a.id] = clone(position); result = clone(position);
  } else {
    checkState(p, body.baseStateVersion);
    if (name === 'create-question') {
      text(body.text, '研究问题'); requireThat(body.scope === undefined || typeof body.scope === 'string', 'invalid_input', '研究范围需要文本。');
      const intent = userIntent(p, body, name, { projectId }, operationId);
      const { item, revision } = addItem(p, 'question', { text: body.text, scope: body.scope ?? '', informationStatus: 'user_provided' }, { actor: 'local_user', operationId, origin: { intent } });
      emit(p, 'question_created', 'local_user', operationId, itemNode(item), { intent }); changed(p); result = projectItem(p, item, revision.id);
    } else if (name === 'decide-question') {
      requireThat(choices.includes(body.choice), 'invalid_input', '选择需要是深入、采用、保留、排除或未决。');
      const item = body.itemId ? find(p.researchItems, body.itemId, '研究问题') : null;
      requireThat(item || body.choice === 'defer', 'invalid_input', '请明确这次选择对应的问题。');
      requireThat(!item || ['question', 'direction'].includes(item.kind), 'invalid_input', '请选择一个问题或研究方向。');
      requireThat(!item || item.kind === 'question' || ['explore', 'keep', 'reject'].includes(body.choice), 'invalid_input', '研究方向可以先深入；形成明确问题后再采用。');
      const revision = item ? revisionOf(item, body.itemRevisionId) : null;
      requireThat(!item || body.itemRevisionId === item.headRevisionId, 'revision_conflict', '这个候选已有新版本，请重新查看再选择。', 409, { currentRevisionId: item?.headRevisionId });
      const target = item ? { itemId: item.id, itemRevisionId: revision.id } : { projectId };
      const intent = userIntent(p, body, name, target, operationId);
      const oldCurrent = clone(k.currentQuestion), supersedesId = item ? k.choices[item.id] ?? null : k.undecidedDecisionId ?? null;
      const decision = { id: uid('decision'), category: 'research_question', target, choice: body.choice, intent, intentMessageId: intent.messageId ?? null,
        supersedesId, actor: 'local_user', createdAt: now(), operationId, baseStateVersion: body.baseStateVersion };
      p.decisions[decision.id] = decision;
      if (item) k.choices[item.id] = decision.id;
      if (body.choice === 'explore') k.exploration = { itemId: item.id, revisionId: revision.id, decisionId: decision.id };
      if (body.choice === 'adopt') k.currentQuestion = { itemId: item.id, revisionId: revision.id, decisionId: decision.id };
      if (body.choice === 'defer' && !item) { k.currentQuestion = null; k.undecidedDecisionId = decision.id; }
      if (JSON.stringify(oldCurrent) !== JSON.stringify(k.currentQuestion)) markAffected(p, node('research_choice', p.id, oldCurrent?.decisionId ?? 'undecided'), operationId, '当前采用的问题已变化，请重看依赖此前选择的成果。');
      if (item) {
        link(p, node('decision', decision.id), itemNode(item, revision.id));
        // A take on one candidate does not replace the separately adopted slot.
        if (body.choice === 'reject' && k.exploration?.itemId === item.id) k.exploration = null;
      }
      emit(p, 'research_question_decided', 'local_user', operationId, target, { decisionId: decision.id, choice: body.choice, intent, previousCurrentQuestion: oldCurrent, currentQuestion: k.currentQuestion });
      changed(p); result = { decision: clone(decision), currentQuestion: projectionOfRef(p, k.currentQuestion), exploration: projectionOfRef(p, k.exploration), version: k.version };
    } else if (name === 'revise-question') {
      const item = find(p.researchItems, body.itemId, '研究问题'); requireThat(item.kind === 'question', 'invalid_input', '此接口修改研究问题。');
      requireThat(body.baseRevisionId === item.headRevisionId, 'revision_conflict', '研究问题已有新版本，请保留输入并重新查看。', 409, { currentRevisionId: item.headRevisionId });
      const previous = revisionOf(item); text(body.text, '研究问题');
      for (const field of ['scope', 'title']) requireThat(body[field] === undefined || typeof body[field] === 'string', 'invalid_input', '范围和显示名称需要文本。');
      const nextScope = body.scope ?? previous.scope, nextTitle = body.title ?? previous.title;
      if (body.text === previous.text && nextScope === previous.scope && nextTitle === previous.title) return projectItem(p, item);
      const intent = userIntent(p, body, name, itemNode(item), operationId);
      const revision = { ...clone(previous), id: uid('item_revision'), number: previous.number + 1, previousRevisionId: previous.id, createdAt: now(), actor: 'local_user', operationId,
        text: body.text, scope: nextScope, title: nextTitle, change: { text: body.text !== previous.text, scope: nextScope !== previous.scope, title: nextTitle !== previous.title }, intent };
      if (revision.change.text || revision.change.scope) revision.evidenceNeedsReview = revision.evidenceIds.length > 0;
      if ((revision.change.text || revision.change.scope) && revision.proposal) revision.proposalNeedsReview = true;
      if ((revision.change.text || revision.change.scope) && revision.assessment) revision.assessmentNeedsReview = true;
      item.revisions.push(revision); item.headRevisionId = revision.id; item.title = nextTitle;
      for (const evidenceId of revision.evidenceIds) link(p, itemNode(item), node('access', p.evidence[evidenceId].accessId));
      if (revision.change.text || revision.change.scope) markAffected(p, itemNode(item, previous.id), operationId, '所引用的问题内容或范围已修改，请检查这份成果是否仍适用。');
      emit(p, 'research_question_revised', 'local_user', operationId, itemNode(item), { previousRevisionId: previous.id, change: revision.change, intent, adoptionUnchanged: true }); changed(p); result = projectItem(p, item);
    } else if (name === 'resolve-impact') {
      const impact = find(p.researchImpacts, body.impactId, '影响提示');
      requireThat(['keep', 'defer', 'updated'].includes(body.choice), 'invalid_input', '请选择保留、暂缓或更新完成。');
      if (body.choice === 'updated') {
        const oldTarget=impact.target??node('artifact',impact.artifactId,impact.artifactRevisionId);
        const updated=body.updatedTarget??node('artifact',impact.artifactId,body.updatedArtifactRevisionId);
        requireThat(updated.type===oldTarget.type&&updated.id===oldTarget.id&&updated.revisionId!==oldTarget.revisionId&&resolveResearchRef(p,updated), 'invalid_input', '更新完成需要关联同一成果实际保存的新版本。');
      }
      const intent = userIntent(p, body, name, { impactId: impact.id }, operationId);
      const resolution = { id: uid('resolution'), choice: body.choice, previousStatus: impact.status, actor: 'local_user', intent, createdAt: now(), operationId,
        updatedArtifactRevisionId: body.updatedArtifactRevisionId ?? null, updatedTarget:body.updatedTarget?clone(body.updatedTarget):null };
      impact.resolutions.push(resolution); impact.status = { keep: 'kept', defer: 'deferred', updated: 'updated' }[body.choice];
      emit(p, 'research_impact_resolved', 'local_user', operationId, { impactId: impact.id }, resolution); changed(p); result = clone(impact);
    }
  }
  state.events ??= [];
  for (const event of p.researchEvents.slice(eventStart)) if (!state.events.some(e => e.id === event.id)) state.events.push(clone(event));
  return result;
}

// Ambiguous speech remains a question to the assistant. Only an explicit target
// plus an exact, affirmative choice maps to a deterministic command.
export function resolveResearchIntent(project, value, target = null) {
  const p = ensureKernel(project), input = optionalText(value).trim();
  if (!input || /[?？]|不要|不想|不是|是否|能否|可以吗|怎么样|如果/.test(input)) return null;
  if (/^(先|暂时)?(保留未决|不定题|暂不定题)[。！!]?$/u.test(input)) return { command: 'decide-question', body: { choice: 'defer', baseStateVersion: p.researchKernel.version, userText: value } };
  const itemId = target?.itemId ?? (typeof target === 'string' ? target : null);
  if (!itemId || !own(p.researchItems, itemId)) return null;
  const item = p.researchItems[itemId];
  const patterns = [['explore', /^(先)?(深入|了解|看看)(这个|该)?(问题|方向|候选)?[。！!]?$/u], ['adopt', /^(我)?(就)?(采用|选择|选定)(这个|该)?(问题|题目|候选)?[。！!]?$/u],
    ['keep', /^(先|暂时)?(保留|留着)(这个|该)?(问题|方向|候选)?[。！!]?$/u], ['reject', /^(先)?(排除|放弃)(这个|该)?(问题|方向|候选)?[。！!]?$/u]];
  const match = patterns.find(([, expression]) => expression.test(input));
  if (!match || (item.kind === 'direction' && match[0] === 'adopt')) return null;
  return { command: 'decide-question', body: { itemId, itemRevisionId: target?.itemRevisionId ?? target?.revisionId ?? item.headRevisionId, choice: match[0], baseStateVersion: p.researchKernel.version, userText: value } };
}
