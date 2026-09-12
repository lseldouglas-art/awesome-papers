import { randomUUID } from 'node:crypto';
import { requireThat } from './errors.mjs';

const id = prefix => `${prefix}_${randomUUID()}`;
const now = () => new Date().toISOString();
function text(value, label, max = 100000, empty = false) {
  requireThat(typeof value === 'string' && (empty || value.trim().length > 0) && value.length <= max,
    'invalid_input', `${label}必须是${empty ? '可为空的' : '非空'}文本，且不超过 ${max} 个字符。`);
  return value;
}
function list(value, label, max = 500) {
  requireThat(Array.isArray(value) && value.length <= max, 'invalid_input', `${label}必须是最多 ${max} 项的列表。`);
  return value;
}
function choice(value, values, label) {
  requireThat(values.includes(value), 'invalid_input', `${label}不在支持范围。`, 400, { allowed: values });
  return value;
}
function get(map, key, label) {
  requireThat(typeof key === 'string' && Object.hasOwn(map, key), 'not_found', `${label}不存在或不属于当前项目。`, 404);
  return map[key];
}
export const getProject = (state, key) => get(state.projects, key, '项目');
export function createProject(state, body) {
  const project = { id: id('project'), name: text(body.name, '项目名称', 200), goal: text(body.goal ?? '', '当前目标', 10000, true),
    originalGoal: text(body.goal ?? '', '原始意图', 10000, true), conditions: '', metadataVersion: 1, metadataHistory: [],
    createdAt: now(), updatedAt: now(), artifacts: {}, sources: {}, accesses: {}, scopes: {}, evidence: {}, annotations: {},
    conversations: {}, messages: {}, decisions: {}, currentDecisions: {}, tasks: {}, steps: {} };
  state.projects[project.id] = project;
  return project;
}
export function getRevision(project, artifactId, revisionId) {
  const artifact = get(project.artifacts, artifactId, '成果');
  const revision = artifact.revisions.find(r => r.id === revisionId);
  requireThat(revision, 'not_found', '所选成果版本不存在。', 404);
  return revision;
}
function validateBlocks(blocks) {
  list(blocks, '内容块');
  const seen = new Set();
  for (const block of blocks) {
    requireThat(block && typeof block === 'object', 'invalid_input', '内容块必须是对象。');
    text(block.id, '内容块标识', 100);
    requireThat(!seen.has(block.id), 'duplicate_block', '内容块标识不能重复。'); seen.add(block.id);
    choice(block.type, ['heading', 'paragraph', 'candidate', 'table'], '内容类型');
    if (block.type !== 'table') text(block.text, '内容', 100000, true);
    else {
      const columns = list(block.columns, '表格列', 50);
      const columnIds = new Set();
      for (const column of columns) {
        text(column.id, '列标识', 100); text(column.label, '列名', 200);
        requireThat(!columnIds.has(column.id), 'duplicate_column', '表格列标识不能重复。'); columnIds.add(column.id);
      }
      const rows = list(block.rows, '表格行', 1000); const rowIds = new Set();
      for (const row of rows) {
        text(row.id, '行标识', 100);
        requireThat(!rowIds.has(row.id), 'duplicate_row', '表格行标识不能重复。'); rowIds.add(row.id);
        requireThat(row.cells && typeof row.cells === 'object' && !Array.isArray(row.cells), 'invalid_input', '表格单元格必须是对象。');
        requireThat(Object.keys(row.cells).every(k => columnIds.has(k)) && columns.every(c => Object.hasOwn(row.cells, c.id)), 'invalid_input', '单元格必须与列标识对应。');
        Object.values(row.cells).forEach(v => text(v, '单元格', 10000, true));
      }
    }
  }
  return structuredClone(blocks);
}
function accessRefs(project, value = []) {
  const refs = list(value, '实际访问记录');
  requireThat(new Set(refs).size === refs.length, 'invalid_input', '实际访问记录不能重复。');
  refs.forEach(ref => get(project.accesses, ref, '实际访问记录'));
  return [...refs];
}
function checkHead(artifact, base) {
  requireThat(base === artifact.headRevisionId, 'revision_conflict', '内容已有新版本，请保留本地修改并比较后重新保存。', 409,
    { currentRevisionId: artifact.headRevisionId, submittedRevisionId: base ?? null });
}
function appendRevision(project, artifact, body, operationId, restoredFromRevisionId = null) {
  const revision = { id: id('revision'), artifactId: artifact.id, number: artifact.revisions.length + 1,
    previousRevisionId: artifact.headRevisionId ?? null, restoredFromRevisionId, createdAt: now(), operationId,
    blocks: validateBlocks(body.blocks), sourceAccessIds: accessRefs(project, body.sourceAccessIds) };
  artifact.revisions.push(revision); artifact.headRevisionId = revision.id;
  return revision;
}
function locate(project, target) {
  requireThat(target && typeof target === 'object', 'invalid_input', '需要明确的成果内容位置。');
  const revision = getRevision(project, target.artifactId, target.revisionId);
  const block = revision.blocks.find(b => b.id === target.blockId);
  requireThat(block, 'anchor_not_found', '内容位置不属于所选版本。', 404);
  let originalText = block.text;
  if (block.type === 'table') {
    const row = block.rows.find(r => r.id === target.rowId);
    requireThat(row && Object.hasOwn(row.cells, target.columnId), 'anchor_not_found', '表格位置不属于所选版本。', 404);
    originalText = row.cells[target.columnId];
  } else requireThat(!target.rowId && !target.columnId, 'invalid_input', '非表格内容不能包含单元格位置。');
  return { revision, originalText };
}
function userMessage(project, messageId) {
  const message = get(project.messages, messageId, '用户消息');
  requireThat(message.role === 'user', 'invalid_intent', '此操作需要实际用户意图。');
  return message;
}

export const commandNames = ['attach-source', 'update-project', 'create-artifact', 'save-artifact', 'restore-artifact', 'import-source', 'record-access', 'record-scope',
  'add-evidence', 'add-annotation', 'resolve-annotation', 'create-conversation', 'append-message', 'make-decision', 'create-task', 'stop-task', 'record-step'];

export function executeCommand(state, projectId, name, body, operationId) {
  const p = getProject(state, projectId);
  requireThat(commandNames.includes(name), 'unknown_command', '不支持此操作。', 404);
  let result;
  switch (name) {
    case 'attach-source': {
      const artifact = get(p.artifacts, body.artifactId, '成果'); checkHead(artifact, body.baseRevisionId);
      const source = executeCommand(state, projectId, 'import-source', body, operationId);
      const access = executeCommand(state, projectId, 'record-access', { sourceId: source.id, level: source.contentLevel }, operationId);
      access.method = 'user_provided_content';
      const previous = artifact.revisions.at(-1);
      const revision = appendRevision(p, artifact, { blocks: previous.blocks, sourceAccessIds: [...previous.sourceAccessIds, access.id] }, operationId);
      result = { source, access, revision }; break;
    }
    case 'update-project': {
      requireThat(body.baseVersion === p.metadataVersion, 'metadata_conflict', '课题信息已有更新，请保留修改并重新打开。', 409);
      p.metadataHistory.push({ name: p.name, goal: p.goal, conditions: p.conditions, version: p.metadataVersion, at: now(), operationId });
      p.name = text(body.name, '项目名称', 200);
      p.goal = text(body.goal, '当前目标', 10000, true);
      p.conditions = text(body.conditions ?? '', '现实条件', 10000, true);
      p.metadataVersion++;
      result = { name: p.name, goal: p.goal, conditions: p.conditions, metadataVersion: p.metadataVersion }; break;
    }
    case 'create-artifact': {
      const artifact = { id: id('artifact'), kind: choice(body.kind, ['brief', 'questions', 'evidence_table', 'plan', 'outline', 'manuscript', 'journal_shortlist'], '成果形式'),
        title: text(body.title, '成果名称', 200), createdAt: now(), revisions: [] };
      const revision = appendRevision(p, artifact, body, operationId);
      p.artifacts[artifact.id] = artifact; result = { artifact, revision }; break;
    }
    case 'save-artifact': {
      const artifact = get(p.artifacts, body.artifactId, '成果'); checkHead(artifact, body.baseRevisionId);
      result = appendRevision(p, artifact, { ...body, sourceAccessIds: body.sourceAccessIds ?? artifact.revisions.at(-1).sourceAccessIds }, operationId); break;
    }
    case 'restore-artifact': {
      const artifact = get(p.artifacts, body.artifactId, '成果'); checkHead(artifact, body.baseRevisionId);
      const old = getRevision(p, artifact.id, body.restoreRevisionId);
      result = appendRevision(p, artifact, old, operationId, old.id); break;
    }
    case 'import-source': {
      const source = { id: id('source'), title: text(body.title, '材料题名', 1000), text: text(body.text ?? '', '材料内容', 500000, true),
        contentLevel: choice(body.contentLevel, ['title', 'abstract', 'excerpt', 'full_text'], '提供内容层级'),
        origin: 'user_text', importedAt: now(), provenance: 'provided_by_local_user' };
      requireThat(source.contentLevel === 'title' || source.text.trim(), 'invalid_input', '非题名级材料需要提供内容。');
      p.sources[source.id] = source; result = source; break;
    }
    case 'record-access': {
      const source = get(p.sources, body.sourceId, '材料');
      const level = choice(body.level, ['title', 'abstract', 'excerpt', 'full_text'], '实际访问层级');
      requireThat(level === 'title' || level === source.contentLevel || (level === 'excerpt' && source.contentLevel !== 'title'),
        'access_level_mismatch', '提供的材料不足以支持这一访问层级。');
      const sourceText = level === 'title' ? source.title : source.text;
      const start = body.start ?? 0, end = body.end ?? sourceText.length;
      requireThat(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= sourceText.length, 'invalid_input', '实际读取范围无效。');
      requireThat(level !== 'full_text' || (start === 0 && end === sourceText.length), 'access_level_mismatch', '局部读取全文应记录为 excerpt。');
      const access = { id: id('access'), sourceId: source.id, level, text: sourceText.slice(start, end), start, end,
        recordedAt: now(), actor: 'local_user', method: 'user_declared_read', verification: 'not_checked' };
      p.accesses[access.id] = access; result = access; break;
    }
    case 'record-scope': {
      const sourceIds = [...new Set(list(body.sourceIds ?? [], '材料范围'))]; sourceIds.forEach(ref => get(p.sources, ref, '材料'));
      const accessIds = accessRefs(p, body.accessIds);
      requireThat(accessIds.every(ref => sourceIds.includes(p.accesses[ref].sourceId)), 'scope_mismatch', '读取记录必须属于所选材料范围。');
      const scope = { id: id('scope'), label: text(body.label, '范围名称', 200), intent: text(body.intent, '本次用途', 2000),
        mode: choice(body.mode ?? 'provided', ['provided', 'discovery'], '范围类型'), sourceIds, accessIds, createdAt: now(),
        externalPermission: 'not_granted' };
      p.scopes[scope.id] = scope; result = scope; break;
    }
    case 'add-evidence': {
      const { revision } = locate(p, body.target);
      const access = get(p.accesses, body.accessId, '实际访问记录');
      requireThat(revision.sourceAccessIds.includes(access.id), 'scope_mismatch', '此版本未记录使用该材料，请先保存相应材料范围。');
      const informationStatus = choice(body.informationStatus ?? 'reported', ['reported', 'not_reported', 'unknown'], '信息状态');
      const relation = choice(body.relation, ['supports', 'contradicts', 'context'], '依据关系');
      const quote = text(body.quote ?? '', '来源摘录', 100000, true);
      requireThat(!quote || access.text.includes(quote), 'quote_outside_access', '摘录必须出自实际访问记录。');
      requireThat(informationStatus === 'reported' ? quote.trim().length > 0 : relation === 'context',
        'invalid_evidence', '已报告信息需要实际摘录；未报告或未知不能作为支持或否定依据。');
      const evidence = { id: id('evidence'), target: structuredClone(body.target), sourceId: access.sourceId, accessId: access.id,
        informationStatus, relation, quote, interpretation: text(body.interpretation ?? '', '依据解释', 10000, true),
        recordedAt: now(), actor: 'local_user' };
      p.evidence[evidence.id] = evidence; result = evidence; break;
    }
    case 'add-annotation': {
      const { originalText } = locate(p, body.target);
      const annotation = { id: id('annotation'), target: structuredClone(body.target), originalText,
        text: text(body.text, '批注', 10000), status: 'open', version: 1, createdAt: now(), actor: 'local_user', history: [] };
      p.annotations[annotation.id] = annotation; result = annotation; break;
    }
    case 'resolve-annotation': {
      const annotation = get(p.annotations, body.annotationId, '批注');
      requireThat(body.baseVersion === annotation.version, 'annotation_conflict', '批注状态已变化，请刷新后继续。', 409, { currentVersion: annotation.version });
      const status = choice(body.status, ['open', 'resolved'], '批注状态');
      annotation.history.push({ from: annotation.status, to: status, at: now(), operationId });
      annotation.status = status; annotation.version++; result = annotation; break;
    }
    case 'create-conversation': {
      const conversation = { id: id('conversation'), title: text(body.title, '对话名称', 200), messageIds: [], createdAt: now() };
      p.conversations[conversation.id] = conversation; result = conversation; break;
    }
    case 'append-message': {
      const conversation = get(p.conversations, body.conversationId, '对话');
      requireThat(body.role === undefined || body.role === 'user', 'invalid_actor', '此接口仅记录本地用户消息，不能伪造模型回复。');
      if (body.target) locate(p, body.target);
      const message = { id: id('message'), conversationId: conversation.id, role: 'user', text: text(body.text, '消息'),
        target: body.target ? structuredClone(body.target) : null, createdAt: now() };
      p.messages[message.id] = message; conversation.messageIds.push(message.id); result = message; break;
    }
    case 'make-decision': {
      locate(p, body.target);
      const intent = userMessage(p, body.intentMessageId);
      const category = text(body.category, '决定范围', 100);
      const key = `${body.target.artifactId}:${category}`;
      const decision = { id: id('decision'), category, target: structuredClone(body.target),
        choice: choice(body.choice, ['explore', 'adopt', 'keep', 'reject'], '用户选择'),
        intentMessageId: intent.id, supersedesId: p.currentDecisions[key] ?? null, actor: 'local_user', createdAt: now() };
      p.decisions[decision.id] = decision; p.currentDecisions[key] = decision.id; result = decision; break;
    }
    case 'create-task': {
      const scope = get(p.scopes, body.scopeId, '本次材料范围');
      const intent = userMessage(p, body.intentMessageId);
      if (body.target) locate(p, body.target);
      const task = { id: id('task'), purpose: text(body.purpose, '任务目的', 2000), scopeId: scope.id, intentMessageId: intent.id,
        target: body.target ? structuredClone(body.target) : null, status: 'planned', createdAt: now(),
        runs: [], cost: { status: 'unknown', amount: null }, execution: 'not_started' };
      p.tasks[task.id] = task; result = task; break;
    }
    case 'stop-task': {
      const task = get(p.tasks, body.taskId, '任务');
      requireThat(task.status === 'planned', 'task_conflict', '此任务当前不能取消。', 409);
      task.status = 'cancelled'; task.cancelledAt = now(); result = task; break;
    }
    case 'record-step': {
      const resultRefs = list(body.resultRefs, '本步成果', 50);
      resultRefs.forEach(ref => getRevision(p, ref.artifactId, ref.revisionId));
      requireThat(resultRefs.length > 0, 'invalid_input', '本步记录需要关联实际保存的成果。');
      const feedback = body.feedbackMessageId ? userMessage(p, body.feedbackMessageId) : null;
      const step = { id: id('step'), purpose: text(body.purpose, '步骤目的', 2000), resultRefs: structuredClone(resultRefs),
        explanation: text(body.explanation, '结果解释', 20000), explanationOrigin: 'local_user_record',
        feedbackMessageId: feedback?.id ?? null, status: feedback ? 'feedback_recorded' : 'awaiting_feedback', createdAt: now() };
      p.steps[step.id] = step; result = step; break;
    }
  }
  p.updatedAt = now();
  return result;
}

export function exportRevision(project, artifactId, revisionId) {
  const artifact = get(project.artifacts, artifactId, '成果');
  const revision = getRevision(project, artifactId, revisionId);
  const accesses = revision.sourceAccessIds.map(ref => get(project.accesses, ref, '实际访问记录'));
  return { format: 'research-workbench-revision', schemaVersion: 1, projectId: project.id,
    artifact: { id: artifact.id, kind: artifact.kind, title: artifact.title }, revision,
    accesses, sources: [...new Set(accesses.map(a => a.sourceId))].map(ref => {
      const { id: sourceId, title, origin, contentLevel } = pSource(project, ref);
      return { id: sourceId, title, origin, contentLevel };
    }), evidence: Object.values(project.evidence).filter(e => e.target.artifactId === artifactId && e.target.revisionId === revisionId),
    annotations: Object.values(project.annotations).filter(a => a.target.artifactId === artifactId && a.target.revisionId === revisionId)
      .map(a => ({ id: a.id, target: a.target, originalText: a.originalText, text: a.text, createdAt: a.createdAt, actor: a.actor })) };
}
const pSource = (project, ref) => get(project.sources, ref, '材料');
