import test from 'node:test';
import { get as httpGet } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.mjs';
import { LocalStore } from '../src/store.mjs';
import { createClient } from '../src/client.mjs';
const temp = () => mkdtemp(join(tmpdir(), 'rw2-test-'));
const first = object => Object.values(object)[0];
async function fixture(t) {
  const directory = await temp(); const server = await startServer({ directory, port: 0 });
  t.after(() => server.close()); const api = createClient({ baseUrl: server.url });
  const p = await api.createProject({ example: true }); const a = first(p.artifacts);
  return { directory, server, api, p, a, r: a.revisions[0] };
}
test('HTTP workspace reopens after store closes; model capability is false', async () => {
  const directory = await temp(); let app = await startServer({ directory, port: 0 });
  let api = createClient({ baseUrl: app.url });
  const p = await api.createProject({ name: '测试课题', goal: '原始模糊需求' });
  assert.equal(p.originalGoal, '原始模糊需求'); assert.equal((await api.capabilities()).models.configured, false);
  await app.close(); app = await startServer({ directory, port: 0 }); api = createClient({ baseUrl: app.url });
  try { assert.deepEqual(await api.workspace(p.id), p); assert.equal((await api.listProjects()).length, 1); } finally { await app.close(); }
});
test('concurrent personal edits conflict and idempotent saves do not create history', async t => {
  const { api, p, a } = await fixture(t);
  const body = value => ({ artifactId: a.id, baseVersion: 1, notes: { ...a.draft.notes, understanding: value } });
  const results = await Promise.allSettled(['one', 'two'].map(v => api.command(p.id, 'save-notes', body(v))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  const command = { ...body('三'), baseVersion: 2 }, opts = { requestId: 'stable-request-123' };
  const ack = await api.command(p.id, 'save-notes', command, opts);
  assert.deepEqual(await api.command(p.id, 'save-notes', command, opts), ack);
  const current = first((await api.workspace(p.id)).artifacts);
  assert.equal(current.revisions.length, 1); assert.equal(current.checkpoints.length, 0);
  assert.equal(current.draft.notes.understanding, '三');
  await assert.rejects(api.command(p.id, 'save-notes', { ...command, notes: { ...command.notes, understanding: '别的' } }, opts), e => e.code === 'request_id_conflict');
});
test('old exports and anchors remain exact; stage restore preserves the previous draft', async t => {
  const { api, p, a, r } = await fixture(t);
  const note = await api.command(p.id, 'add-annotation', { target: { artifactId: a.id, revisionId: r.id, blockId: 'question' }, text: '检查问题边界' });
  const before = await api.exportRevision(p.id, a.id, r.id);
  const n = { ...a.draft.notes, understanding: '新的个人认识' };
  await api.command(p.id, 'save-notes', { artifactId: a.id, baseVersion: 1, notes: n });
  const stage = await api.command(p.id, 'checkpoint', { artifactId: a.id, baseVersion: 2, name: '初步认识' });
  const staged = await api.exportRevision(p.id, a.id, stage.revisionId);
  await api.command(p.id, 'save-notes', { artifactId: a.id, baseVersion: 2, notes: { ...n, understanding: '更新后的认识' } });
  await api.command(p.id, 'resolve-annotation', { annotationId: note.id, baseVersion: 1, status: 'resolved' });
  assert.deepEqual(await api.exportRevision(p.id, a.id, r.id), before);
  assert.deepEqual(await api.exportRevision(p.id, a.id, stage.revisionId), staged);
  const restored = await api.command(p.id, 'restore-progress', { artifactId: a.id, baseVersion: 3, revisionId: stage.revisionId });
  const current = first((await api.workspace(p.id)).artifacts);
  assert.equal(current.draft.notes.understanding, '新的个人认识');
  assert.equal((await api.getRevision(p.id, a.id, restored.beforeRevisionId)).notes.understanding, '更新后的认识');
  assert.equal(current.checkpoints.length, 2);
});
test('material attachment is atomic and does not create a stage version', async t => {
  const { api, p, a, r } = await fixture(t); const before = await api.exportRevision(p.id, a.id, r.id);
  const added = await api.command(p.id, 'attach-material', { artifactId: a.id, baseVersion: 1, title: '人工材料', text: '用户提供的摘要', contentLevel: 'abstract' });
  const current = await api.workspace(p.id), access = current.accesses[added.accessId];
  assert.equal(access.level, 'abstract'); assert.equal(access.verification, 'not_checked'); assert.equal(access.method, 'user_provided_content');
  assert.deepEqual(await api.exportRevision(p.id, a.id, r.id), before);
  assert.equal(first(current.artifacts).checkpoints.length, 0);
  await assert.rejects(api.command(p.id, 'attach-material', { artifactId: a.id, baseVersion: 1, title: '过时请求', text: 'text', contentLevel: 'abstract' }), e => e.status === 409);
  assert.equal(Object.keys((await api.workspace(p.id)).sources).length, 2);
});
test('project goal changes preserve original intent and reject stale edits', async t => {
  const { api, p } = await fixture(t);
  await api.command(p.id, 'update-project', { name: '新名称', goal: '改变方向', conditions: '两个月', baseVersion: 1 });
  const updated = await api.workspace(p.id);
  assert.equal(updated.originalGoal, p.goal); assert.equal(updated.metadataHistory[0].goal, p.goal); assert.equal(updated.goal, '改变方向');
  await assert.rejects(api.command(p.id, 'update-project', { name: '过时名称', goal: 'x', baseVersion: 1 }), e => e.status === 409);
});
test('cross-project anchors and fake model replies rejected; failed commands do not mutate', async t => {
  const { api, p, a, r } = await fixture(t); const other = await api.createProject({ name: '另外一个项目' });
  await assert.rejects(api.command(other.id, 'add-annotation', { target: { artifactId: a.id, revisionId: r.id, blockId: 'question' }, text: '越界' }), e => e.status === 404);
  await assert.rejects(api.command(p.id, 'append-message', { conversationId: first(p.conversations).id, role: 'assistant', text: '伪造模型' }), e => e.code === 'invalid_actor');
  await assert.rejects(api.command(p.id, 'create-task', {}), e => e.code === 'not_implemented');
  await assert.rejects(api.command(p.id, 'save-artifact', { artifactId: a.id, baseRevisionId: r.id, blocks: [{ id: 'x', type: 'paragraph', text: 'a' }, { id: 'x', type: 'paragraph', text: 'b' }] }), e => e.code === 'client_upgrade_required');
  assert.deepEqual(await api.workspace(p.id), p);
});
test('loopback API rejects foreign origin, host, content type and malformed JSON', async t => {
  const { server } = await fixture(t);
  for (const headers of [{ Origin: 'https://other.example' }, { Host: 'other.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    // Node fetch normalizes Host; a raw HTTP request exercises the actual header.
    const status = await new Promise((resolve, reject) => { httpGet(`${server.url}/api/projects`, { headers }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject); });
    assert.equal(status, 403, JSON.stringify(headers));
  }
  assert.equal((await fetch(`${server.url}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await fetch(`${server.url}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' })).status, 400);
});
test('one disk writer; corrupt files preserved rather than replaced', async () => {
  const directory = await temp(); const store = await new LocalStore(directory).initialize();
  await assert.rejects(new LocalStore(directory).initialize(), e => e.code === 'store_locked');
  assert.equal((await stat(join(directory, 'workspace.json'))).mode & 0o777, 0o600);
  await store.close(); await writeFile(join(directory, 'workspace.json'), '{broken');
  await assert.rejects(new LocalStore(directory).initialize(), e => e.code === 'store_corrupt');
  assert.equal(await readFile(join(directory, 'workspace.json'), 'utf8'), '{broken');
});
test('special request IDs are safe and idempotent', async () => {
  const directory = await temp(); const store = await new LocalStore(directory).initialize();
  try { const result = await store.transact('__proto__', { operation: 'check' }, () => ({ saved: true })); assert.deepEqual(await store.transact('__proto__', { operation: 'check' }, () => { throw Error('must not run'); }), result); } finally { await store.close(); }
});
