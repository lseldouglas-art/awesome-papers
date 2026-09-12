import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspace } from '../src/workspace.mjs';
import { currentBlocks, exportProgress, progressCommand, upgradeProject } from '../src/progress.mjs';
import { ensureKernel, createQuestionComparison, kernelCommand, researchState } from '../src/kernel.mjs';
import { SqliteStore } from '../src/sqlite-store.mjs';
import { ResearchApplication } from '../src/research-application.mjs';

function fixture() {
  const state = { schemaVersion: 2, projects: {}, receipts: {}, events: [], modelCalls: [] };
  const p = ensureKernel(upgradeProject(createWorkspace(state, { name: '工程测试：工作简报快照', goal: '先了解已有材料，保留题目未决' }, 'create')));
  const initial = Object.values(p.artifacts)[0];
  const attach = text => progressCommand(state, p.id, 'attach-material', { artifactId: initial.id, baseVersion: initial.draft.version,
    title: '明确标记的工程测试摘要', contentLevel: 'abstract', text }, 'attach');
  const one = attach('第一份工程摘要报告一项关联。'), two = attach('第二份工程摘要尚未用于简报依据。');
  const command = (name, body = {}) => kernelCommand(state, p.id, name, { baseStateVersion: p.researchKernel.version, ...body }, name);
  const progress = (artifact, name, body = {}) => progressCommand(state, p.id, name, { artifactId: artifact.id, baseVersion: artifact.draft.version, ...body }, name);
  const compare = () => createQuestionComparison(p, { questions: [one, two].map((access, index) => ({ question: `工程问题${index + 1}？`, scope: `范围${index + 1}`,
    unknowns: [`只属于问题${index + 1}的未知`], feasibility: { known: [`条件${index + 1}`], unknown: [`待核查${index + 1}`] }, supporting: [{ text: `工程材料${index + 1}仅供测试`, status: 'reported',
      citations: [{ accessId: access.accessId, quote: p.accesses[access.accessId].text }] }], conflicting: [] })) }, { accessIds: [one.accessId, two.accessId], operationId: 'compare' });
  return { state, p, one, two, command, progress, compare };
}

test('updating an undecided brief retains working materials and readable notes, supports asking, and restores the exact snapshot', async t => {
  const f = fixture(), initial = f.command('compose-brief'), a = f.p.artifacts[initial.artifactId];
  const oldExport = exportProgress(f.p, a.id, initial.revisionId);
  f.progress(a, 'attach-existing-materials', { accessIds: [f.one.accessId, f.two.accessId] });
  const notes = { intent: '我仍未定题', understanding: '工程测试：这份认识必须留在自动历史中。', unknown: '还需补查', next: '接着讨论' };
  f.progress(a, 'save-notes', { notes });
  const updated = f.command('compose-brief', { artifactId: a.id }), result = f.p.researchResults[updated.resultId];
  const revision = a.revisions.find(r => r.id === updated.revisionId), sources = [f.one.accessId, f.two.accessId];
  assert.deepEqual(a.draft.sourceAccessIds, sources); assert.deepEqual(revision.sourceAccessIds, sources);
  assert.deepEqual(result.accessIds, []); assert.deepEqual(result.dependencies.filter(d => d.to.type === 'access'), []);
  assert.deepEqual(revision.blocks, currentBlocks(f.p, a)); assert.equal(revision.blocks.find(b => b.id === 'note-understanding').text, notes.understanding);
  assert.ok(!result.blocks.some(b => b.id === 'note-understanding')); assert.deepEqual(exportProgress(f.p, a.id, initial.revisionId), oldExport);

  const directory = await mkdtemp(join(tmpdir(), 'rw2-brief-snapshot-')), store = await new SqliteStore(directory).initialize();
  let calls = 0;
  const service = await new ResearchApplication(store, { modelFactory: () => ({ generate: async input => {
    calls++;
    return { text: JSON.stringify({ items: [{ text: '工程回答只验证所选材料可继续使用。', status: 'inference', citations: [{ ref: input.materials[0].ref, passage: 'P1' }] }] }),
      provenance: { provider: 'test.invalid', model: 'engineering-fixture' }, usage: null, cost: { status: 'not_applicable', amount: 0 } };
  } }) }).initialize();
  t.after(async () => { await service.close(); await store.close(); });
  await store.update(s => Object.assign(s, structuredClone(f.state)));
  await service.settings.save({ baseUrl: 'https://test.invalid/v1', model: 'engineering-fixture', apiKey: 'fixture', enabled: true });
  const started = await service.start(f.p.id, { mode: 'ask', artifactId: a.id, baseVersion: a.draft.version, text: '继续解释两份工作材料', accessIds: sources }, 'ask-after-update');
  await service.running.get(started.taskId)?.promise;
  const task = await store.read(s => s.projects[f.p.id].researchTasks[started.taskId]);
  assert.equal(task.status, 'completed', task.error); assert.deepEqual(task.input.materials.map(m => m.accessId), sources); assert.equal(calls, 1);

  const exported = exportProgress(f.p, a.id, updated.revisionId);
  f.progress(a, 'save-notes', { notes: { ...notes, understanding: '后来改过的认识' } });
  f.progress(a, 'restore-progress', { revisionId: updated.revisionId });
  assert.deepEqual(a.draft.notes, notes); assert.deepEqual(a.draft.sourceAccessIds, sources);
  assert.deepEqual(a.revisions.at(-1).blocks, revision.blocks);
  assert.deepEqual(exportProgress(f.p, a.id, updated.revisionId), exported);
  assert.deepEqual(exportProgress(f.p, a.id, initial.revisionId), oldExport);
});

test('updating an adopted brief keeps uncited working material without claiming it as evidence', () => {
  const f = fixture(), comparison = f.compare(), id = comparison.questionIds[0];
  f.command('decide-question', { itemId: id, itemRevisionId: f.p.researchItems[id].headRevisionId, choice: 'adopt' });
  const initial = f.command('compose-brief'), a = f.p.artifacts[initial.artifactId], oldResult = structuredClone(f.p.researchResults[initial.resultId]);
  const oldExport = exportProgress(f.p, a.id, initial.revisionId);
  f.progress(a, 'attach-existing-materials', { accessIds: [f.two.accessId] });
  const updated = f.command('compose-brief', { artifactId: a.id }), result = f.p.researchResults[updated.resultId];
  assert.deepEqual(a.draft.sourceAccessIds, [f.one.accessId, f.two.accessId]);
  assert.deepEqual(result.accessIds, [f.one.accessId]); assert.deepEqual(result.materialManifest.map(m => m.accessId), [f.one.accessId]);
  assert.deepEqual(result.dependencies.filter(d => d.to.type === 'access').map(d => d.to.id), [f.one.accessId]);
  assert.deepEqual(f.p.researchResults[initial.resultId], oldResult); assert.deepEqual(exportProgress(f.p, a.id, initial.revisionId), oldExport);
});

test('an undecided brief uses only the explicit exploration version and keeps adoption undecided', () => {
  const f = fixture(), comparison = f.compare(), id = comparison.questionIds[0], revisionId = f.p.researchItems[id].headRevisionId;
  const explored = f.command('decide-question', { itemId: id, itemRevisionId: revisionId, choice: 'explore' });
  f.command('revise-question', { itemId: id, baseRevisionId: revisionId, text: '后来修订但尚未选择探索的新表达', scope: '另一个范围' });
  const choicesBefore = structuredClone(f.p.decisions), output = f.command('compose-brief'), result = f.p.researchResults[output.resultId];
  assert.equal(researchState(f.p).currentQuestion, null); assert.equal(result.adoptionContext.currentQuestion, null); assert.equal(result.referenceContext, 'explicit_exploration');
  assert.match(result.blocks.find(b => b.id === 'current-question').text, /保留未决/);
  assert.match(result.blocks.find(b => b.id === 'exploration-context').text, /工程问题1？[\s\S]*尚未采用/);
  assert.match(result.blocks.find(b => b.id === 'key-evidence-heading').text, /探索中的参考依据/);
  assert.deepEqual(result.accessIds, [f.one.accessId]); assert.deepEqual(result.unknowns, ['只属于问题1的未知']);
  assert.match(result.blocks.find(b => b.id === 'conditions').text, /条件1/); assert.doesNotMatch(result.blocks.find(b => b.id === 'conditions').text, /条件2/);
  assert.ok(result.dependencies.some(d => d.to.type === 'research_item' && d.to.id === id && d.to.revisionId === revisionId));
  assert.ok(result.dependencies.some(d => d.to.type === 'decision' && d.to.id === explored.decision.id));
  assert.deepEqual(f.p.decisions, choicesBefore);
});
