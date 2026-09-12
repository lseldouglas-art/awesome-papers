import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace } from '../src/workspace.mjs';
import { executeCommand } from '../src/domain.mjs';
import { upgradeProject, progressCommand, exportProgress } from '../src/progress.mjs';
import { ensureKernel, researchState, kernelCommand, registerResearchResult, createQuestionComparison, composeResearchBrief, resolveResearchIntent, markProjectContextChange, inheritArtifactContext } from '../src/kernel.mjs';

function fixture() {
  const state = { projects: {}, receipts: {}, events: [] };
  const p = ensureKernel(upgradeProject(createWorkspace(state, { name: '睡眠与慢性疼痛', goal: '先了解睡眠与慢性疼痛，还没有题目' }, 'setup')));
  const a = Object.values(p.artifacts)[0];
  const source = executeCommand(state, p.id, 'import-source', { title: '工程测试摘要（非科研结论）', contentLevel: 'abstract', text: '测试摘要报告睡眠与疼痛的关联。摘要未报告长期效果。' }, 'source');
  const access = executeCommand(state, p.id, 'record-access', { sourceId: source.id, level: 'abstract' }, 'access');
  const call = (name, body = {}, request = name) => kernelCommand(state, p.id, name, { baseStateVersion: p.researchKernel.version, ...body }, request);
  const comparison = () => createQuestionComparison(p, { explanation: '供比较的工程测试问题', questions: [
    { question: '如何描述睡眠与疼痛的关联？', scope: '成人观察资料', rationale: '已有观察需要明确对象', unknowns: ['长期效果摘要未报告'], feasibility: { known: ['已有公开摘要'], unknown: ['纵向数据能否取得'] },
      supporting: [{ text: '测试材料直接报告关联', status: 'reported', citations: [{ accessId: access.id, quote: '测试摘要报告睡眠与疼痛的关联。' }] }], conflicting: [] },
    { question: '长期方向能否在现有材料中明确？', scope: '纵向证据', rationale: '需要了解证据边界', unknowns: ['没有纵向资料'], feasibility: { known: [], unknown: ['数据来源'] }, supporting: [], conflicting: [] }
  ] }, { operationId: 'comparison', inputArtifactId: a.id, inputRevisionId: a.headRevisionId, accessIds: [access.id] });
  const decide = (id, choice, body = {}) => call('decide-question', { itemId: id, itemRevisionId: p.researchItems[id].headRevisionId, choice, ...body });
  return { state, p, a, source, access, call, comparison, decide };
}

test('exploration, keep and rejecting another candidate preserve separately adopted question', () => {
  const { p, comparison, decide } = fixture(); const { questionIds: [one, two] } = comparison();
  const adopted = decide(one, 'adopt');
  decide(two, 'explore'); decide(two, 'keep'); decide(two, 'reject'); decide(one, 'reject');
  const current = researchState(p);
  assert.equal(current.currentQuestion.id, one); assert.equal(current.currentQuestion.decisionId, adopted.decision.id);
  assert.equal(current.exploration, null); assert.equal(Object.keys(p.decisions).length, 5);
  assert.deepEqual(adopted.decision.intent.kind, 'button_action'); assert.equal(adopted.decision.intent.text, null);
  assert.ok(p.researchEvents.every(e => e.actor !== 'model' || e.type === 'question_comparison_generated'));
});

test('revising adopted question keeps adopted revision and preserves source snapshots; stale choices conflict', () => {
  const { p, access, comparison, decide, call } = fixture(); const { questionIds: [id] } = comparison();
  decide(id, 'adopt'); const before = researchState(p).currentQuestion, originalItem = structuredClone(p.researchItems[id].revisions[0]);
  const brief = call('compose-brief');
  call('revise-question', { itemId: id, baseRevisionId: before.revisionId, text: '改为青少年睡眠与疼痛的关联？', scope: '青少年' });
  assert.equal(researchState(p).currentQuestion.revisionId, before.revisionId);
  assert.equal(researchState(p).questions[0].text, '改为青少年睡眠与疼痛的关联？');
  assert.deepEqual(p.researchItems[id].revisions[0], originalItem);
  assert.equal(p.accesses[access.id].level, 'abstract');
  assert.ok(researchState(p).impacts.some(i => i.artifactId === brief.artifactId && i.status === 'needs_review'));
  assert.throws(() => call('decide-question', { itemId: id, itemRevisionId: before.revisionId, choice: 'adopt' }), e => e.code === 'revision_conflict');
  decide(id, 'adopt'); assert.notEqual(researchState(p).currentQuestion.revisionId, before.revisionId);
});

test('display-only rename leaves dependent artifacts without new scientific impact', () => {
  const { p, comparison, decide, call } = fixture(); const { questionIds: [id] } = comparison(); decide(id, 'adopt'); call('compose-brief');
  const before = structuredClone(p.researchImpacts), current = researchState(p).currentQuestion;
  call('revise-question', { itemId: id, baseRevisionId: current.revisionId, text: current.text, title: '更方便找的名称' });
  assert.deepEqual(p.researchImpacts, before);
  assert.equal(researchState(p).currentQuestion.text, current.text);
});

test('brief distinguishes the current adoption from past adoption after revision and switching questions', () => {
  const { p, comparison, decide, call } = fixture(); const { questionIds: [one, two] } = comparison();
  const first = decide(one, 'adopt').decision;
  const original = call('compose-brief'), oldResult = structuredClone(p.researchResults[original.resultId]);
  const oldExport = exportProgress(p, original.artifactId, original.revisionId);
  call('revise-question', { itemId: one, baseRevisionId: p.researchItems[one].headRevisionId, text: '改为青少年的长期关系？', scope: '青少年纵向资料' });
  assert.equal(researchState(p).currentQuestion.decisionId, first.id);
  assert.equal(researchState(p).questions.find(q => q.id === one).isAdopted, false);
  const revised = call('compose-brief'), revisedChoices = p.researchResults[revised.resultId].blocks.find(b => b.id === 'actual-choices').text;
  assert.match(revisedChoices, /^当前采用：如何描述睡眠与疼痛的关联？/);
  assert.doesNotMatch(revisedChoices, /当前采用：改为青少年/);
  const second = decide(two, 'adopt').decision, historicalDecisions = structuredClone(p.decisions);
  const switched = call('compose-brief'), choiceText = p.researchResults[switched.resultId].blocks.find(b => b.id === 'actual-choices').text;
  assert.match(choiceText, /曾经采用：如何描述睡眠与疼痛的关联？/);
  assert.match(choiceText, /当前采用：长期方向能否在现有材料中明确？/);
  assert.equal((choiceText.match(/当前采用：/g) ?? []).length, 1);
  assert.equal(researchState(p).currentQuestion.decisionId, second.id);
  assert.equal(researchState(p).questions.filter(q => q.isAdopted).length, 1);
  assert.deepEqual(p.decisions, historicalDecisions); assert.deepEqual(p.researchResults[original.resultId], oldResult);
  assert.deepEqual(exportProgress(p, original.artifactId, original.revisionId), oldExport);
});

test('undecided brief is deterministic records only and never fabricates a adopted question', () => {
  const { p, call } = fixture(); call('create-question', { text: '用户自己的问题', scope: '尚未细化' }); call('decide-question', { choice: 'defer', userText: '先保留未决' });
  const output = call('compose-brief'), a = p.artifacts[output.artifactId], result = p.researchResults[output.resultId];
  assert.equal(a.kind, 'research_brief'); assert.equal(output.undecided, true); assert.equal(result.adoptionContext.currentQuestion, null);
  assert.match(result.blocks.find(b => b.id === 'current-question').text, /保留未决/);
  assert.match(result.blocks.find(b => b.id === 'actual-choices').text, /用户原话：先保留未决/);
  assert.equal(result.provenance.actor, 'local_program'); assert.equal(Object.keys(p.researchTasks ?? {}).length, 0);
  assert.equal(result.blocks.find(b => b.id === 'original-intent').text, p.originalGoal);
});

test('brief captures immutable decisions, access level and dependencies through later changes and restoration', () => {
  const { state, p, comparison, decide, call } = fixture(); const { questionIds: [one, two] } = comparison();
  decide(one, 'adopt', { userText: '我选择这个问题，先从已有资料开始' });
  const brief = call('compose-brief'); const before = structuredClone(p.artifacts[brief.artifactId].revisions[0]);
  const oldExport = exportProgress(p, brief.artifactId, brief.revisionId);
  decide(two, 'adopt');
  const a = p.artifacts[brief.artifactId];
  progressCommand(state, p.id, 'restore-progress', { artifactId: a.id, revisionId: brief.revisionId, baseVersion: a.draft.version }, 'restore');
  assert.equal(researchState(p).currentQuestion.id, two);
  assert.deepEqual(a.revisions[0], before);
  assert.deepEqual(exportProgress(p, brief.artifactId, brief.revisionId), oldExport);
  assert.equal(before.adoptionContext.currentQuestion.id, one); assert.ok(before.dependencies.length > 0);
});

test('foreign access, invalid quote and unreported supportive claim fail before candidate creation', () => {
  const { p, access } = fixture();
  for (const evidence of [{ accessId: 'foreign', quote: 'x', relation: 'supports' }, { accessId: access.id, quote: '虚构摘录', relation: 'supports' },
    { accessId: access.id, quote: '', relation: 'supports', informationStatus: 'not_reported' }]) {
    const before = structuredClone(p);
    assert.throws(() => createQuestionComparison(p, { questions: [{ text: '可以研究什么？', evidence: [evidence] }] }));
    assert.deepEqual(p, before);
  }
});

test('verified contradictions stay separate and new full text cannot change original access evidence', () => {
  const { state, p, access, source } = fixture();
  const output = createQuestionComparison(p, { questions: [{ question: '长期效果是否已报告？', supporting: [], conflicting: [
    { text: '这份摘要未报告长期效果，不能视为无效', status: 'unknown', citations: [{ accessId: access.id, quote: '摘要未报告长期效果。' }] }
  ], unknowns: ['长期效果未知'] }] }, { accessIds: [access.id] });
  const before = structuredClone(researchState(p).questions[0].evidence[0]);
  source.text += '后续提供了正文材料。'; source.contentLevel = 'full_text';
  executeCommand(state, p.id, 'record-access', { sourceId: source.id, level: 'full_text' }, 'fulltext');
  const evidence = researchState(p).questions[0].evidence[0];
  assert.deepEqual(evidence, before); assert.equal(evidence.relation, 'context'); assert.equal(evidence.level, 'abstract');
  assert.equal(evidence.informationStatus, 'unknown'); assert.ok(output.resultId);
});

test('explicit user intent routes with target only and preserves the original expression', () => {
  const { p, comparison } = fixture(); const { questionIds: [id] } = comparison();
  for (const value of ['这个可以采用吗？', '不要采用这个', '如果采用这个', '我想问这个问题']) assert.equal(resolveResearchIntent(p, value, { itemId: id }), null);
  assert.equal(resolveResearchIntent(p, '采用这个'), null);
  const intent = resolveResearchIntent(p, '先深入这个', { itemId: id });
  assert.equal(intent.command, 'decide-question'); assert.equal(intent.body.choice, 'explore'); assert.equal(intent.body.userText, '先深入这个');
  assert.equal(resolveResearchIntent(p, '暂时保留未决').body.choice, 'defer');
});

test('messages and optimistic state checks cannot be bypassed to impersonate a human choice', () => {
  const { p, comparison, call } = fixture(); const { questionIds: [id] } = comparison();
  p.messages.fake = { id: 'fake', role: 'assistant', text: '已经采用' };
  const body = { itemId: id, itemRevisionId: p.researchItems[id].headRevisionId, choice: 'adopt' };
  assert.throws(() => call('decide-question', { ...body, intentMessageId: 'fake' }), e => e.code === 'invalid_intent');
  assert.equal(Object.keys(p.decisions).length, 0);
  assert.throws(() => call('decide-question', { ...body, baseStateVersion: 0 }), e => e.code === 'research_state_conflict');
  assert.equal(researchState(p).currentQuestion, null);
});

test('legacy landscape registration is idempotent and does not invent adoption or verification', () => {
  const { p, a, access } = fixture();
  const result = { id: 'old-result', artifactId: a.id, kind: 'brief', accessIds: [access.id], blocks: [{ id: 'research-branches-0', type: 'paragraph', text: '睡眠与疼痛的关系', informationStatus: 'inference' },
    { id: 'research-gaps-0', type: 'paragraph', text: '长期效果未知', informationStatus: 'unknown' }], citations: [{ blockId: 'research-branches-0', accessId: access.id, quote: '测试摘要报告睡眠与疼痛的关联。' }] };
  p.researchResults[result.id] = result;
  const one = registerResearchResult(p, result, 'legacy'), before = structuredClone(p);
  assert.deepEqual(registerResearchResult(p, result, 'again'), one); assert.deepEqual(p, before);
  assert.equal(researchState(p).directions.length, 1); assert.equal(researchState(p).claims.length, 1); assert.equal(researchState(p).currentQuestion, null);
  assert.equal(researchState(p).directions[0].origin.revisionId, null);
  assert.equal(researchState(p).directions[0].evidence[0].relation, 'context');
});

test('position persists per project without conflicting with research decisions and validates anchors', () => {
  const { p, a, call } = fixture(); const version = p.researchKernel.version;
  call('set-position', { artifactId: a.id, blockId: 'note-understanding' });
  assert.equal(researchState(p).version, version); assert.equal(researchState(p).position.artifactId, a.id);
  assert.throws(() => call('set-position', { artifactId: 'foreign' }), e => e.code === 'not_found');
  assert.throws(() => call('set-position', { artifactId: a.id, blockId: 'foreign' }), e => e.code === 'anchor_not_found');
  const reopened = structuredClone(p); assert.deepEqual(researchState(reopened).position, researchState(p).position);
  const revisions = structuredClone(a.revisions), decisions = structuredClone(p.decisions);
  call('set-position', { artifactId: a.id, revisionId: a.revisions[0].id });
  call('set-position', { artifactId: a.id, revisionId: null });
  assert.equal(researchState(structuredClone(p)).position.revisionId, null);
  assert.deepEqual(a.revisions, revisions); assert.deepEqual(p.decisions, decisions);
});

test('context rename is harmless, goal change marks known dependencies and resolving impact keeps history', () => {
  const { state, p, comparison, decide, call } = fixture(); const { questionIds: [id] } = comparison(); decide(id, 'adopt'); const brief = call('compose-brief');
  let previous = structuredClone(p);
  executeCommand(state, p.id, 'update-project', { name: '显示名称', goal: p.goal, conditions: p.conditions, baseVersion: p.metadataVersion }, 'rename');
  assert.deepEqual(markProjectContextChange(p, previous, 'rename'), []);
  previous = structuredClone(p);
  executeCommand(state, p.id, 'update-project', { name: p.name, goal: '现在只考虑青少年', conditions: p.conditions, baseVersion: p.metadataVersion }, 'goal');
  // A harmless intermediate rename changed metadata version, but the artifact
  // still depends on the last substantively different context.
  markProjectContextChange(p, previous, 'goal');
  const impacts = researchState(p).impacts.filter(i => i.artifactId === brief.artifactId);
  assert.ok(impacts.length > 0);
  const original = structuredClone(p.artifacts[brief.artifactId].revisions[0]);
  call('resolve-impact', { impactId: impacts[0].id, choice: 'keep' });
  assert.equal(p.researchImpacts[impacts[0].id].status, 'kept');
  call('resolve-impact', { impactId: impacts[0].id, choice: 'defer' });
  assert.equal(p.researchImpacts[impacts[0].id].resolutions.length, 2);
  assert.deepEqual(p.artifacts[brief.artifactId].revisions[0], original);
});

test('a captured or restored artifact inherits the original inputs and exposes stale dependencies again', () => {
  const { p, comparison, decide, call } = fixture(); const { questionIds: [one, two] } = comparison();
  decide(one, 'adopt'); const saved = call('compose-brief'), a = p.artifacts[saved.artifactId], old = structuredClone(a.revisions[0]);
  decide(two, 'adopt');
  for (const impact of Object.values(p.researchImpacts)) call('resolve-impact', { impactId: impact.id, choice: 'keep' });
  const restored = { ...structuredClone(old), id: 'new-restored-version', number: 2, previousRevisionId: old.id, operationId: 'restore' };
  a.revisions.push(restored); a.headRevisionId = restored.id;
  inheritArtifactContext(p, a, restored);
  assert.equal(restored.adoptionContext.currentQuestion.id, one);
  assert.ok(restored.dependencies.every(d => d.from.revisionId === restored.id));
  assert.ok(researchState(p).impacts.some(i => i.artifactRevisionId === restored.id && i.status === 'needs_review'));
  assert.deepEqual(a.revisions[0], old); assert.equal(researchState(p).currentQuestion.id, two);
});

test('late comparison saves its original task choice and context instead of claiming it used a new decision', () => {
  const { p, comparison, decide } = fixture(); const { questionIds: [one, two] } = comparison();
  decide(one, 'adopt'); const prior = researchState(p), frozen = { version: prior.version, currentQuestion: prior.currentQuestion, exploration: prior.exploration, decisionIds: prior.decisionHistory.map(d => d.id), undecided: false };
  const context = { name: p.name, goal: p.goal, originalGoal: p.originalGoal, conditions: p.conditions, metadataVersion: p.metadataVersion };
  decide(two, 'adopt');
  const late = createQuestionComparison(p, { questions: [{ question: '旧输入生成的待比较问题', unknowns: ['仍需结合新选择重看'] }] }, { adoptionContext: frozen, projectContext: context });
  const result = p.researchResults[late.resultId];
  assert.equal(result.adoptionContext.currentQuestion.id, one); assert.equal(researchState(p).currentQuestion.id, two);
  assert.ok(result.dependencies.some(d => d.to.type === 'research_choice' && d.to.revisionId === prior.currentQuestion.decisionId));
  assert.ok(researchState(p).impacts.some(i => i.artifactId === late.artifactId && i.status === 'needs_review'));
});
