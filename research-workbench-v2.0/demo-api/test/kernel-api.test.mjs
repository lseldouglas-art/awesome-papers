import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.mjs';
import { createClient } from '../src/client.mjs';
import { createQuestionComparison } from '../src/kernel.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'rw2-kernel-api-'));
  let server = await startServer({ directory, port: 0 });
  let api = createClient({ baseUrl: server.url });
  t.after(async () => { if (server) await server.close(); });
  const p = await api.createProject({ name: '连续研究集成测试', goal: '先了解睡眠与慢性疼痛' });
  const state = () => api.request(`/api/projects/${p.id}/research-state`);
  const call = async (command, body = {}, requestId) => api.command(p.id, command, { baseStateVersion: (await state()).version, ...body }, { requestId });
  const restart = async () => { await server.close(); server = null; server = await startServer({ directory, port: 0 }); api = createClient({ baseUrl: server.url }); };
  return { p, directory, state, call, restart, get api() { return api; }, get server() { return server; } };
}

test('HTTP chosen question, brief, exact export, restart, revision impact and restore keep human decision', async t => {
  const f = await fixture(t), one = await f.call('create-question', { text: '成年人睡眠与疼痛的关系？', scope: '已有观察资料' });
  await f.call('decide-question', { itemId: one.id, itemRevisionId: one.revisionId, choice: 'adopt' });
  const brief = await f.call('compose-brief');
  const before = await f.api.exportRevision(f.p.id, brief.artifactId, brief.revisionId);
  assert.equal(before.revision.adoptionContext.currentQuestion.id, one.id);
  await f.call('set-position', { artifactId: brief.artifactId, blockId: 'current-question' });
  await f.restart();
  assert.equal((await f.state()).currentQuestion.id, one.id); assert.equal((await f.state()).position.artifactId, brief.artifactId);
  assert.deepEqual(await f.api.exportRevision(f.p.id, brief.artifactId, brief.revisionId), before);
  const revised = await f.call('revise-question', { itemId: one.id, baseRevisionId: one.revisionId, text: '青少年睡眠与疼痛的关系？', scope: '青少年' });
  assert.equal((await f.state()).currentQuestion.revisionId, one.revisionId);
  assert.ok((await f.state()).impacts.some(i => i.artifactId === brief.artifactId && i.status === 'needs_review'));
  await f.call('decide-question', { itemId: one.id, itemRevisionId: revised.revisionId, choice: 'adopt' });
  const a = await f.api.request(`/api/projects/${f.p.id}/artifacts/${brief.artifactId}`);
  await f.api.command(f.p.id, 'restore-progress', { artifactId: a.id, revisionId: brief.revisionId, baseVersion: a.draft.version });
  assert.equal((await f.state()).currentQuestion.revisionId, revised.revisionId);
  assert.deepEqual(await f.api.exportRevision(f.p.id, brief.artifactId, brief.revisionId), before);
});

test('HTTP idempotency returns original choice without duplicate decisions and rejects changed receipt body', async t => {
  const f = await fixture(t), one = await f.call('create-question', { text: '待比较的用户问题' });
  const body = { baseStateVersion: (await f.state()).version, itemId: one.id, itemRevisionId: one.revisionId, choice: 'adopt' };
  const requestId = 'test-choice-stable';
  const first = await f.api.command(f.p.id, 'decide-question', body, { requestId });
  assert.deepEqual(await f.api.command(f.p.id, 'decide-question', body, { requestId }), first);
  await f.restart();
  assert.deepEqual(await f.api.command(f.p.id, 'decide-question', body, { requestId }), first);
  assert.equal((await f.state()).decisionHistory.length, 1);
  await assert.rejects(f.api.command(f.p.id, 'decide-question', { ...body, choice: 'reject' }, { requestId }), e => e.code === 'request_id_conflict');
  await assert.rejects(f.api.command(f.p.id, 'decide-question', body), e => e.code === 'research_state_conflict');
});

test('HTTP cross-project item, source, artifact and evidence cannot be used in decisions or comparison', async t => {
  const f = await fixture(t), other = await f.api.createProject({ name: '另一个课题' });
  const one = await f.call('create-question', { text: '只属于第一个课题' });
  const otherState = await f.api.request(`/api/projects/${other.id}/research-state`);
  await assert.rejects(f.api.command(other.id, 'decide-question', { baseStateVersion: otherState.version, itemId: one.id, itemRevisionId: one.revisionId, choice: 'adopt' }), e => e.code === 'not_found');
  const brief = await f.call('compose-brief');
  await assert.rejects(f.api.request(`/api/projects/${other.id}/artifacts/${brief.artifactId}`), e => e.code === 'not_found');
  await assert.rejects(f.api.command(other.id, 'set-position', { artifactId: brief.artifactId }), e => e.code === 'not_found');
  assert.equal((await f.state()).currentQuestion, null);
  assert.equal((await f.api.request(`/api/projects/${other.id}/research-state`)).questions.length, 0);
});

test('HTTP natural intent is explicit, targeted, immutable and does not treat a question as adoption', async t => {
  const f = await fixture(t), one = await f.call('create-question', { text: '用什么方法了解这个方向？' });
  const target = { itemId: one.id, itemRevisionId: one.revisionId };
  for (const text of ['可以采用这个吗？', '不要采用这个', '如果采用这个']) {
    const output = await f.api.command(f.p.id, 'research-intent', { text, target }); assert.equal(output.handled, false);
  }
  assert.equal((await f.state()).decisionHistory.length, 0);
  const explored = await f.api.command(f.p.id, 'research-intent', { text: '先深入这个', target });
  assert.equal(explored.handled, true); assert.equal((await f.state()).currentQuestion, null);
  assert.equal((await f.state()).exploration.id, one.id);
  const chosen = await f.api.command(f.p.id, 'research-intent', { text: '采用这个', target });
  assert.equal(chosen.handled, true); assert.equal((await f.state()).currentQuestion.id, one.id);
  assert.equal((await f.state()).decisionHistory.at(-1).intent.text, '采用这个');
  await f.api.command(f.p.id, 'research-intent', { text: '暂时保留未决' });
  const output = await f.call('compose-brief');
  const exported = await f.api.exportRevision(f.p.id, output.artifactId, output.revisionId);
  assert.equal(exported.revision.adoptionContext.currentQuestion, null);
  assert.match(exported.revision.blocks.find(b => b.id === 'actual-choices').text, /暂时保留未决/);
});

test('HTTP comparison sources and decision dependencies survive restart without synthetic execution claims', async t => {
  const f = await fixture(t), artifact = Object.values(f.p.artifacts)[0];
  const attached = await f.api.command(f.p.id, 'attach-material', { artifactId: artifact.id, baseVersion: artifact.draft.version,
    title: '明确标记的工程材料', contentLevel: 'abstract', text: '测试材料报告一个关联。另一项测试结果不同。' });
  const result = await f.server.store.update(s => createQuestionComparison(s.projects[f.p.id], { explanation: '工程测试的比较', questions: [{ question: '关联在不同人群中是否一致？', scope: '测试范围',
    rationale: '比较观察结果', supporting: [{ text: '材料有一个关联', status: 'reported', citations: [{ accessId: attached.accessId, quote: '测试材料报告一个关联。' }] }],
    conflicting: [{ text: '另一结果不同', status: 'reported', citations: [{ accessId: attached.accessId, quote: '另一项测试结果不同。' }] }], unknowns: ['真实人群尚未提供'] }] },
  { accessIds: [attached.accessId], operationId: 'fixture-only', inputArtifactId: artifact.id, inputRevisionId: artifact.headRevisionId }));
  // Store update returns no application result on some implementations; read the
  // saved candidate identity rather than assuming a transport return convention.
  const one = (await f.state()).questions[0];
  assert.equal(one.evidence.length, 2); assert.equal(one.evidence[1].relation, 'contradicts'); assert.equal(one.evidence[0].level, 'abstract');
  await f.call('decide-question', { itemId: one.id, itemRevisionId: one.revisionId, choice: 'adopt' });
  const brief = await f.call('compose-brief'); const before = await f.api.exportRevision(f.p.id, brief.artifactId, brief.revisionId);
  assert.match(before.revision.blocks.find(b => b.id === 'contradictions').text, /另一结果不同/);
  assert.match(before.revision.blocks.find(b => b.id === 'contradictions').text, /访问层级：摘要/);
  assert.match(before.revision.blocks.find(b => b.id === 'key-evidence').text, /访问层级：摘要/);
  assert.equal(before.accesses[0].level, 'abstract');
  assert.equal(before.accesses[0].text, '测试材料报告一个关联。另一项测试结果不同。');
  await f.restart();
  assert.deepEqual(await f.api.exportRevision(f.p.id, brief.artifactId, brief.revisionId), before);
  assert.equal((await f.state()).questions[0].evidence[0].verification, 'program_located_not_human_reviewed');
});
