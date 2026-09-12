import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspace } from '../src/workspace.mjs';
import { progressCommand, upgradeProject, exportProgress } from '../src/progress.mjs';
import { ensureKernel, composeResearchBrief } from '../src/kernel.mjs';
import { SqliteStore } from '../src/sqlite-store.mjs';

function fixtureState() {
  const state = { schemaVersion: 2, projects: {}, receipts: {}, events: [], modelCalls: [] };
  const p = ensureKernel(upgradeProject(createWorkspace(state, { name: '工程测试：未决课题', goal: '继续了解候选问题' }, 'create')));
  const landscape = Object.values(p.artifacts)[0];
  const attach = (project, artifact, text) => progressCommand(state, project.id, 'attach-material', { artifactId: artifact.id, baseVersion: artifact.draft.version, title: '明确标记的工程材料', text, contentLevel: 'abstract' }, 'material');
  const one = attach(p, landscape, '第一份测试摘要。未报告长期验证。');
  const two = attach(p, landscape, '第二份测试摘要。仅测试材料关联。');
  const brief = composeResearchBrief(p, { baseStateVersion: p.researchKernel.version }, 'brief');
  const a = p.artifacts[brief.artifactId];
  const other = ensureKernel(upgradeProject(createWorkspace(state, { name: '另一个工程课题' }, 'other')));
  const foreign = attach(other, Object.values(other.artifacts)[0], '只能属于另一个课题的访问记录。');
  const command = (accessIds, baseVersion = a.draft.version) => progressCommand(state, p.id, 'attach-existing-materials', { artifactId: a.id, baseVersion, accessIds }, 'link');
  return { state, p, a, landscape, one, two, other, foreign, command };
}

async function sqliteFixture(t) {
  const f = fixtureState(), directory = await mkdtemp(join(tmpdir(), 'rw2-existing-materials-'));
  let store = await new SqliteStore(directory).initialize();
  await store.update(state => { Object.assign(state, structuredClone(f.state)); });
  t.after(async () => { if (store) await store.close(); });
  const transact = (body, requestId = 'link-existing') => store.transact(requestId, { operation: 'attach-existing-materials', projectId: f.p.id, body }, state => progressCommand(state, f.p.id, 'attach-existing-materials', body, requestId));
  return { ...f, directory, transact, get store() { return store; }, restart: async () => { await store.close(); store = null; store = await new SqliteStore(directory).initialize(); } };
}

test('existing accesses link into an undecided brief without changing original sources, snapshots or history', () => {
  const f = fixtureState();
  assert.equal(f.a.draft.sourceAccessIds.length, 0);
  const sources = structuredClone(f.p.sources), accesses = structuredClone(f.p.accesses), history = structuredClone(f.a.revisions), checkpoints = structuredClone(f.a.checkpoints);
  const notes = structuredClone(f.a.draft.notes), exported = exportProgress(f.p, f.a.id, f.a.headRevisionId), version = f.a.draft.version;
  const result = f.command([f.one.accessId, f.one.accessId, f.two.accessId]);
  assert.deepEqual(result.addedAccessIds, [f.one.accessId, f.two.accessId]); assert.deepEqual(result.accessIds, result.addedAccessIds);
  assert.equal(result.version, version + 1); assert.equal(f.p.researchKernel.currentQuestion, null);
  assert.deepEqual(f.p.sources, sources); assert.deepEqual(f.p.accesses, accesses); assert.deepEqual(f.a.revisions, history); assert.deepEqual(f.a.checkpoints, checkpoints); assert.deepEqual(f.a.draft.notes, notes);
  assert.deepEqual(exportProgress(f.p, f.a.id, f.a.headRevisionId), exported);
  assert.equal(f.state.modelCalls.length, 0); assert.equal(Object.keys(f.p.researchTasks).length, 0);
});

test('deduplicated existing selection and empty selection do not bump draft version or update timestamp', () => {
  const f = fixtureState(); f.command([f.one.accessId]); const draft = structuredClone(f.a.draft);
  assert.deepEqual(f.command([f.one.accessId, f.one.accessId]).addedAccessIds, []);
  assert.deepEqual(f.a.draft, draft); assert.deepEqual(f.command([]).addedAccessIds, []); assert.deepEqual(f.a.draft, draft);
  const added = f.command([f.two.accessId, f.one.accessId, f.two.accessId]);
  assert.deepEqual(added.addedAccessIds, [f.two.accessId]); assert.deepEqual(added.accessIds, [f.one.accessId, f.two.accessId]);
});

test('mixed local and foreign access is rejected before any partial mutation', () => {
  const f = fixtureState(), before = structuredClone(f.state);
  assert.throws(() => f.command([f.one.accessId, f.foreign.accessId]), error => error.code === 'not_found');
  assert.deepEqual(f.state, before);
  assert.throws(() => progressCommand(f.state, f.p.id, 'attach-existing-materials', { artifactId: Object.values(f.other.artifacts)[0].id, baseVersion: 1, accessIds: [f.one.accessId] }, 'foreign-artifact'), error => error.code === 'not_found');
  assert.deepEqual(f.state, before);
});

test('stale draft revisions and invalid reference shapes preserve all existing data', () => {
  const f = fixtureState(); f.command([f.one.accessId]); const before = structuredClone(f.state);
  assert.throws(() => f.command([f.two.accessId], 1), error => error.code === 'draft_conflict');
  assert.deepEqual(f.state, before);
  for (const value of [null, 'access-id', {}, [null], [17], ['__proto__'], ['missing']]) {
    assert.throws(() => f.command(value), error => ['invalid_input', 'not_found'].includes(error.code)); assert.deepEqual(f.state, before);
  }
});

test('SQLite receipts deduplicate linking across restart and changed receipt payload is rejected', async t => {
  const f = await sqliteFixture(t), body = { artifactId: f.a.id, baseVersion: f.a.draft.version, accessIds: [f.one.accessId, f.two.accessId] };
  const first = await f.transact(body);
  assert.deepEqual(await f.transact(body), first); await f.restart(); assert.deepEqual(await f.transact(body), first);
  const p = await f.store.read(s => s.projects[f.p.id]);
  assert.equal(p.artifacts[f.a.id].draft.version, f.a.draft.version + 1); assert.deepEqual(p.artifacts[f.a.id].draft.sourceAccessIds, body.accessIds);
  assert.deepEqual(p.accesses, f.p.accesses); assert.deepEqual(p.sources, f.p.sources);
  await assert.rejects(f.transact({ ...body, accessIds: [f.one.accessId] }), error => error.code === 'request_id_conflict');
  await assert.rejects(f.transact(body, 'fresh-stale-request'), error => error.code === 'draft_conflict');
});

test('failed SQLite transaction rolls back linking, draft version, and receipt together', async t => {
  const f = await sqliteFixture(t), before = await f.store.read(), body = { artifactId: f.a.id, baseVersion: f.a.draft.version, accessIds: [f.one.accessId] };
  await assert.rejects(f.store.transact('rollback-link', { operation: 'test-rollback', body }, state => {
    progressCommand(state, f.p.id, 'attach-existing-materials', body, 'rollback-link'); throw new Error('injected transaction failure');
  }), /injected transaction failure/);
  assert.deepEqual(await f.store.read(), before);
  await assert.rejects(f.transact({ ...body, accessIds: [f.one.accessId, f.foreign.accessId] }, 'foreign-rollback'), error => error.code === 'not_found');
  assert.deepEqual(await f.store.read(), before);
  await f.restart(); assert.deepEqual(await f.store.read(), before);
});
