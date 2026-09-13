import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { startServer } from '../src/server.mjs';
import { createClient } from '../src/client.mjs';
import { LocalStore } from '../src/store.mjs';
import { createWorkspace } from '../src/workspace.mjs';
import { executeCommand } from '../src/domain.mjs';
import { parsePubmed, createPubmed } from '../src/pubmed.mjs';
import { dimensionFixture } from './landscape-fixture.mjs';
import { validateResearchOutput } from '../src/research.mjs';
const first = obj => Object.values(obj)[0];
const tmp = () => mkdtemp(join(tmpdir(), 'rw2-understanding-'));
const sample = { pmid: '12345', title: 'Disclosed test fixture', text: 'A test observation about learning.', level: 'abstract', doi: null, journal: 'Fixture', published: '2024', url: 'https://pubmed.ncbi.nlm.nih.gov/12345/' };
const searchResult = (records = [sample]) => ({ query: 'learning', searches: [{ sort: 'relevance', total: records.length, ids: records.map(r => r.pmid) }], records, missingIds: [], warnings: [], searchedAt: new Date().toISOString(), coverage: 'test fixture' });
function outputFor(materials, ask = false) {
  const item = materials[0] ? { text: '测试材料描述了一项观察。', status: 'reported', citations: [{ accessId: materials[0].accessId, quote: materials[0].text.slice(0, 100) }] } : { text: '测试建议。', status: 'suggestion', citations: [] };
  return JSON.stringify(ask ? { items: [item] } : { papers: materials.map(m => ({ ref: m.ref, accessId: m.accessId, summary: '逐篇测试观察。', status: 'reported', quote: m.text.slice(0, 100) })), sections: ['overview', 'branches', 'findings', 'disagreements', 'unknowns', 'next'].map(id => ({ id, items: [item] })) });
}
const generate = async input => ({ text: input.instruction.includes('explanation:') ? JSON.stringify({ explanation: '先了解整体。', query: 'learning', scope: '了解学习领域。', questions: [] }) : input.instruction.includes('仅回复连接成功') ? 'connected' : input.instruction.includes('格式 {items:') ? outputFor(input.materials, true) : JSON.stringify(dimensionFixture(input.materials)),
  provenance: { provider: 'model.invalid', model: 'test-model', requestId: input.requestId, materialRefs: input.materials.map(m => ({ sourceId: m.sourceId, accessId: m.accessId })) }, usage: { total_tokens: 25 }, cost: { status: 'unknown', amount: null } });
async function fixture(t, options = {}) {
  const directory = await tmp();
  const app = await startServer({ directory, port: 0, researchOptions: { modelFactory: () => ({ generate: options.generate ?? generate }), pubmed: options.pubmed ?? { search: async () => searchResult() } } });
  t.after(() => app.close());
  const api = createClient({ baseUrl: app.url });
  const p = await api.createProject({ name: '工程验证课题', goal: '了解学习领域' }), a = first(p.artifacts);
  await api.request('/api/model-settings', { method: 'POST', body: { baseUrl: 'https://model.invalid/v1', model: 'test-model', apiKey: 'only-for-isolated-tests', enabled: true } });
  return { app, api, p, a, directory };
}
async function run(f, mode, extra = {}) {
  const p = await f.api.workspace(f.p.id), a = first(p.artifacts);
  return f.api.request(`/api/projects/${p.id}/research-tasks`, { method: 'POST', body: { mode, artifactId: a.id, baseVersion: a.draft.version, query: 'learning', accessIds: a.draft.sourceAccessIds, ...extra } });
}
async function done(f, id) {
  for (let i = 0; i < 300; i++) { const t = await f.api.request(`/api/projects/${f.p.id}/research-tasks/${id}`); if (['completed', 'failed', 'cancelled', 'interrupted'].includes(t.status)) return t; await sleep(5); }
  throw Error('Task did not finish');
}
test('routine note changes use compact receipts; manual stages deduplicate; framework is locked', async t => {
  const f = await fixture(t); let version = 1;
  for (let i = 0; i < 12; i++) { const ack = await f.api.command(f.p.id, 'save-notes', { artifactId: f.a.id, baseVersion: version, notes: { ...f.a.draft.notes, understanding: `认识 ${i}` } }); version = ack.version; assert.deepEqual(Object.keys(ack).sort(), ['updatedAt', 'version']); }
  let a = first((await f.api.workspace(f.p.id)).artifacts); assert.equal(a.revisions.length, 1); assert.equal(a.checkpoints.length, 0);
  const body = { artifactId: a.id, baseVersion: version, name: '初步认识' };
  const one = await f.api.command(f.p.id, 'checkpoint', body); const two = await f.api.command(f.p.id, 'checkpoint', body); assert.equal(one.id, two.id);
  await assert.rejects(f.api.command(f.p.id, 'save-notes', { artifactId: a.id, baseVersion: version, notes: { ...a.draft.notes, title: '改标题' } }), e => e.code === 'fixed_framework');
  await assert.rejects(f.api.command(f.p.id, 'save-notes', { artifactId: a.id, baseVersion: version, notes: a.draft.notes, blocks: [] }), e => e.code === 'fixed_framework');
  const state = await f.app.store.read(s => s);
  for (const receipt of Object.values(state.receipts).filter(r => Object.hasOwn(r.result, 'version'))) assert.equal(Object.hasOwn(receipt.result, 'notes'), false);
});
test('annotation pins exact draft text without creating a checkpoint', async t => {
  const f = await fixture(t), body = { artifactId: f.a.id, baseVersion: 1, text: '想核实这个想法', target: { artifactId: f.a.id, blockId: 'note-intent' } };
  const note = await f.api.command(f.p.id, 'annotate-current', body);
  await f.api.command(f.p.id, 'save-notes', { artifactId: f.a.id, baseVersion: 1, notes: { ...f.a.draft.notes, intent: '新想法' } });
  const original = await f.api.getRevision(f.p.id, f.a.id, note.target.revisionId);
  assert.equal(original.blocks.find(b => b.id === 'note-intent').text, '了解学习领域');
  assert.equal(first((await f.api.workspace(f.p.id)).artifacts).checkpoints.length, 0);
});
test('v1 disk migration backs up exact bytes and preserves legacy content, titles, and notes', async () => {
  const directory = await tmp(), state = { schemaVersion: 1, projects: {}, receipts: {}, events: [] };
  const p = createWorkspace(state, { name: '旧课题', goal: '原始问题' }, 'old-create'), a = first(p.artifacts);
  const r = executeCommand(state, p.id, 'save-artifact', { artifactId: a.id, baseRevisionId: a.headRevisionId, blocks: [{ id: 'understanding-heading', type: 'heading', text: '旧自改标题' }, { id: 'understanding', type: 'paragraph', text: '旧认识' }, { id: 'unmapped', type: 'paragraph', text: '不能丢失' }] }, 'old-edit');
  const note = executeCommand(state, p.id, 'add-annotation', { target: { artifactId: a.id, revisionId: r.id, blockId: 'unmapped' }, text: '保留' }, 'old-note');
  const raw = JSON.stringify(state); await writeFile(join(directory, 'workspace.json'), raw);
  const store = await new LocalStore(directory).initialize();
  try { const next = await store.read(); assert.equal(next.schemaVersion, 2); assert.equal(first(next.projects[p.id].artifacts).draft.notes.understanding, '旧认识'); assert.deepEqual(next.projects[p.id].annotations[note.id], note); assert.deepEqual(first(next.projects[p.id].artifacts).revisions, a.revisions); const backup = (await readdir(directory)).find(n => n.startsWith('workspace-before-v2-')); assert.equal(await readFile(join(directory, backup), 'utf8'), raw); } finally { await store.close(); }
});
test('failed migration leaves original file unchanged', async () => {
  const directory = await tmp(), raw = JSON.stringify({ schemaVersion: 1, projects: { x: { artifacts: { y: { revisions: [] } } } }, receipts: {}, events: [] });
  await writeFile(join(directory, 'workspace.json'), raw); await assert.rejects(new LocalStore(directory).initialize()); assert.equal(await readFile(join(directory, 'workspace.json'), 'utf8'), raw);
});
test('PubMed XML preserves nested title, structured abstracts, unicode and title-only access', () => {
  const records = parsePubmed('<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>1</PMID><Article><ArticleTitle>研究 <i>α</i> &amp; β</ArticleTitle><Abstract><AbstractText Label="METHODS">One <b>method</b>.</AbstractText><AbstractText Label="RESULTS"><![CDATA[No <markup>.]]></AbstractText></Abstract></Article></MedlineCitation></PubmedArticle><PubmedArticle><MedlineCitation><PMID>2</PMID><Article><ArticleTitle>No abstract</ArticleTitle></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>');
  assert.equal(records[0].title, '研究 α & β'); assert.equal(records[0].text, 'METHODS: One method.\nRESULTS: No <markup>.'); assert.equal(records[1].level, 'title');
  assert.throws(() => parsePubmed('<broken>'), e => e.code === 'retrieval_invalid');
  assert.throws(() => parsePubmed('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///tmp/private">]><a>&x;</a>'));
});
test('PubMed performs both sorts, deduplicates, and records missing records', async () => {
  const paths = []; const pubmed = createPubmed({ intervalMs: 0, fetchImpl: async url => { paths.push(url); if (url.pathname.includes('esearch')) return Response.json({ esearchresult: { count: '10', idlist: ['1', '2'], querytranslation: 'learning' } }); return new Response('<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>1</PMID><Article><ArticleTitle>Title</ArticleTitle></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>'); } });
  const result = await pubmed.search('learning'); assert.equal(paths.length, 3); assert.deepEqual(paths.slice(0, 2).map(u => u.searchParams.get('sort')), ['relevance', 'pub_date']); assert.equal(result.records.length, 1); assert.deepEqual(result.missingIds, ['2']); assert.equal(result.records[0].level, 'title');
});
test('malformed or failed search is not interpreted as zero hits', async () => {
  const pubmed = createPubmed({ intervalMs: 0, fetchImpl: async () => new Response('not json') }); await assert.rejects(pubmed.search('x'), e => e.code === 'retrieval_failed');
});
test('invalid citations and unsupported claims cannot become results', () => {
  const materials = [{ sourceId: 's', accessId: 'a', text: 'A test quote.' }];
  const good = JSON.parse(outputFor(materials)); good.sections[0].items[0].citations[0].quote = 'invented'; assert.throws(() => validateResearchOutput(JSON.stringify(good), 'landscape', materials), e => e.code === 'invalid_citation');
  good.sections[0].items[0].citations = []; assert.throws(() => validateResearchOutput(JSON.stringify(good), 'landscape', materials), e => e.code === 'unsupported_claim');
});
test('clarification, landscape, follow-up and explicit adoption share one project without rewriting personal notes', async t => {
  const f = await fixture(t);
  const clarify = await done(f, (await run(f, 'clarify')).taskId); assert.equal(clarify.proposal.query, 'learning');
  const task = await done(f, (await run(f, 'landscape')).taskId); assert.equal(task.status, 'completed', task.error);
  let p = await f.api.workspace(f.p.id), a = first(p.artifacts); assert.equal(a.checkpoints.length, 1); assert.equal(a.checkpoints[0].type, 'generated'); assert.equal(a.draft.notes.intent, '了解学习领域'); const originalResultId = a.draft.resultId;
  const answer = await done(f, (await run(f, 'ask', { text: '解释这个发现' })).taskId); assert.equal(answer.status, 'completed', answer.error);
  a = first((await f.api.workspace(f.p.id)).artifacts); assert.equal(a.draft.resultId, originalResultId); assert.equal(a.checkpoints.length, 1);
  const update = await done(f, (await run(f, 'revise', { text: '按材料解释得更清楚' })).taskId); assert.equal(update.status, 'completed');
  a = first((await f.api.workspace(f.p.id)).artifacts); assert.equal(a.draft.resultId, originalResultId);
  await f.api.command(p.id, 'adopt-result', { artifactId: a.id, baseVersion: a.draft.version, resultId: update.resultId });
  a = first((await f.api.workspace(f.p.id)).artifacts); assert.equal(a.draft.resultId, update.resultId); assert.equal(a.checkpoints.length, 2); assert.equal(a.draft.notes.intent, '了解学习领域');
});
test('late model output cannot replace newly typed personal understanding', async t => {
  let finish; const gate = new Promise(resolve => { finish = resolve; });
  const f = await fixture(t, { generate: async input => { await gate; return generate(input); } });
  const started = await run(f, 'landscape');
  for (let i = 0; i < 100; i++) { if ((await f.api.capabilities()).budget.used) break; await sleep(5); }
  await f.api.command(f.p.id, 'save-notes', { artifactId: f.a.id, baseVersion: 1, notes: { ...f.a.draft.notes, understanding: '运行时新输入' } });
  finish(); const result = await done(f, started.taskId); assert.equal(result.staleInput, true);
  const a = first((await f.api.workspace(f.p.id)).artifacts); assert.equal(a.draft.notes.understanding, '运行时新输入'); assert.equal(a.draft.resultId, null); assert.equal(a.checkpoints.length, 0);
});
test('cancellation discards late output and consumes at most its one request', async t => {
  let finish; const gate = new Promise(resolve => { finish = resolve; });
  const f = await fixture(t, { generate: async input => { await gate; return generate(input); } });
  const { taskId } = await run(f, 'landscape');
  for (let i = 0; i < 100; i++) { if ((await f.api.capabilities()).budget.used) break; await sleep(5); }
  await f.api.request(`/api/projects/${f.p.id}/research-tasks/${taskId}/stop`, { method: 'POST', body: {} }); finish();
  await sleep(25); const p = await f.api.workspace(f.p.id); assert.equal(p.researchTasks[taskId].status, 'cancelled'); assert.equal(Object.keys(p.researchResults).length, 0); assert.equal((await f.api.capabilities()).budget.used, 1);
});
test('failed generation preserves retrieved sources, records error, and does not retry', async t => {
  let attempts = 0; const f = await fixture(t, { generate: async () => { attempts++; throw Error('sensitive provider body'); } });
  const task = await done(f, (await run(f, 'landscape')).taskId); assert.equal(task.status, 'failed'); assert.equal(attempts, 1);
  const p = await f.api.workspace(f.p.id); assert.equal(Object.keys(p.sources).length, 1); assert.equal(first(p.artifacts).checkpoints.length, 0); assert.equal(JSON.stringify(p).includes('sensitive provider body'), false);
});
test('zero hits make no model call and never claim a research gap', async t => {
  const f = await fixture(t, { pubmed: { search: async () => searchResult([]) } });
  const task = await done(f, (await run(f, 'landscape')).taskId); assert.equal(task.outcome, 'no_results'); assert.equal((await f.api.capabilities()).budget.used, 0); assert.equal(Object.keys((await f.api.workspace(f.p.id)).researchResults).length, 0);
});
test('more than ten attempts remain allowed after restart, with all audit records retained', async t => {
  const f = await fixture(t, { generate: async () => { throw Error('failed'); } });
  for (let i = 0; i < 12; i++) assert.equal((await done(f, (await run(f, 'connection')).taskId)).status, 'failed');
  assert.deepEqual((await f.api.capabilities()).budget, { limit: null, used: 12, remaining: null });
  const persisted = await f.app.store.read(s => s); assert.equal(persisted.modelCalls.length, 12);
  const restartDir = await tmp(); await writeFile(join(restartDir, 'workspace.json'), JSON.stringify(persisted)); await writeFile(join(restartDir, 'model-private.json'), await readFile(join(f.directory, 'model-private.json')));
  const restarted = await startServer({ directory: restartDir, port: 0, researchOptions: { modelFactory: () => ({ generate }) } });
  try {
    const again = { ...f, api: createClient({ baseUrl: restarted.url }) };
    assert.equal((await done(again, (await run(again, 'connection')).taskId)).status, 'completed');
    assert.deepEqual((await again.api.capabilities()).budget, { limit: null, used: 13, remaining: null });
  } finally { await restarted.close(); }
});
test('keys are private, absent from workspace/capabilities/export, and cannot follow a changed recipient', async t => {
  const f = await fixture(t); assert.equal((await stat(join(f.directory, 'model-private.json'))).mode & 0o777, 0o600);
  const exposed = JSON.stringify([await f.api.workspace(f.p.id), await f.api.capabilities(), await f.api.exportRevision(f.p.id, f.a.id, f.a.revisions[0].id)]); assert.equal(exposed.includes('only-for-isolated-tests'), false);
  assert.equal(JSON.stringify(await f.app.store.read(s => s)).includes('only-for-isolated-tests'), false);
  assert.equal((await readFile(f.app.store.filename)).includes(Buffer.from('only-for-isolated-tests')), false);
  await assert.rejects(f.api.request('/api/model-settings', { method: 'POST', body: { baseUrl: 'https://other.invalid/v1', model: 'test-model', apiKey: '', enabled: true } }), e => e.code === 'invalid_configuration');
});
test('cross-project material injection is rejected before any model call', async t => {
  const f = await fixture(t); const other = await f.api.createProject({ name: '别人的课题' }), a = first(other.artifacts);
  const source = await f.api.command(other.id, 'attach-material', { artifactId: a.id, baseVersion: 1, title: '私人材料', text: 'private', contentLevel: 'abstract' });
  await assert.rejects(run(f, 'ask', { text: 'read it', accessIds: [source.accessId] }), e => e.code === 'invalid_scope'); assert.equal((await f.api.capabilities()).budget.used, 0);
});
test('duplicate start request returns the same task and cannot charge twice', async t => {
  const f = await fixture(t);
  const body = { artifactId: f.a.id, baseVersion: 1, mode: 'connection', accessIds: [] };
  const options = { method: 'POST', requestId: 'same-start-request-123', body };
  const result = await f.api.request(`/api/projects/${f.p.id}/research-tasks`, options); await done(f, result.taskId);
  assert.deepEqual(await f.api.request(`/api/projects/${f.p.id}/research-tasks`, options), result);
  assert.equal((await f.api.capabilities()).budget.used, 1);
});
test('changing project conditions makes an in-flight result stale', async t => {
  let finish; const gate = new Promise(resolve => { finish = resolve; });
  const f = await fixture(t, { generate: async input => { await gate; return generate(input); } });
  const started = await run(f, 'landscape');
  await f.api.command(f.p.id, 'update-project', { baseVersion: 1, name: f.p.name, goal: f.p.goal, conditions: '新的研究条件' });
  finish(); const task = await done(f, started.taskId); assert.equal(task.staleInput, true); assert.equal(first((await f.api.workspace(f.p.id)).artifacts).draft.resultId, null);
});
test('stage restoration restores working goal and conditions while keeping original intent', async t => {
  const f = await fixture(t), stage = await f.api.command(f.p.id, 'checkpoint', { artifactId: f.a.id, baseVersion: 1 });
  await f.api.command(f.p.id, 'update-project', { baseVersion: 1, name: f.p.name, goal: '另一个目标', conditions: '一个月' });
  const restored = await f.api.command(f.p.id, 'restore-progress', { artifactId: f.a.id, baseVersion: 1, revisionId: stage.revisionId });
  const p = await f.api.workspace(f.p.id); assert.equal(p.goal, f.p.goal); assert.equal(p.originalGoal, f.p.originalGoal); assert.equal(p.conditions, '');
  assert.notEqual(restored.revisionId, stage.revisionId); const before = await f.api.getRevision(f.p.id, f.a.id, restored.beforeRevisionId); assert.equal(before.projectContext.goal, '另一个目标');
});
test('partial retrieval stays explicit while using the records actually obtained', async t => {
  const f = await fixture(t, { pubmed: { search: async () => ({ ...searchResult(), missingIds: ['999'], warnings: [{ message: '有一条记录未取得' }] }) } });
  const task = await done(f, (await run(f, 'landscape')).taskId); assert.equal(task.status, 'completed');
  const p = await f.api.workspace(f.p.id); assert.deepEqual(p.searches[task.searchId].missingIds, ['999']); assert.equal(p.searches[task.searchId].retrievedCount, 1);
});
test('invalid research output never replaces a current brief and its failed request remains counted', async t => {
  let broken = false;
  const f = await fixture(t, { generate: async input => { const result = await generate(input); if (broken) result.text = '{"sections":[]}'; return result; } });
  await done(f, (await run(f, 'landscape')).taskId); const current = first((await f.api.workspace(f.p.id)).artifacts).draft.resultId;
  broken = true; const task = await done(f, (await run(f, 'revise', { text: '请更新' })).taskId);
  assert.equal(task.status, 'failed'); assert.equal(first((await f.api.workspace(f.p.id)).artifacts).draft.resultId, current); assert.equal((await f.api.capabilities()).budget.used, 2);
});

test('failed synthesis resumes saved retrieval without a second search or duplicate sources', async t => {
  let searches = 0, calls = 0;
  const f = await fixture(t, { pubmed: { search: async () => { searches++; return searchResult(); } }, generate: async input => { if (++calls === 1) throw Error('network'); return generate(input); } });
  const failed = await done(f, (await run(f, 'landscape')).taskId);
  assert.equal(failed.status, 'failed'); assert.ok(failed.searchId);
  const before = await f.api.workspace(f.p.id), search = structuredClone(before.searches[failed.searchId]);
  const resumed = await done(f, (await run(f, 'landscape', { reuseSearchId: failed.searchId })).taskId);
  assert.equal(resumed.status, 'completed', resumed.error); assert.equal(searches, 1); assert.equal(calls, 2);
  const after = await f.api.workspace(f.p.id);
  assert.equal(Object.keys(after.sources).length, Object.keys(before.sources).length);
  assert.deepEqual(after.searches[failed.searchId], search);
  assert.deepEqual(resumed.modelAccessIds, search.accessIds);
  assert.equal(after.researchResults[resumed.resultId].searchId, search.id);
});
test('repeated fresh retrieval reuses identical PMID text while preserving changed access snapshots', async t => {
  let text = sample.text;
  const inputs = [];
  const f = await fixture(t, { pubmed: { search: async () => searchResult([{ ...sample, text }]) }, generate: async input => { inputs.push(input); return generate(input); } });
  await done(f, (await run(f, 'landscape')).taskId);
  const before = await f.api.workspace(f.p.id), original = structuredClone(before.accesses);
  const again = await done(f, (await run(f, 'landscape')).taskId);
  assert.equal(again.status, 'completed'); assert.equal(inputs[1].materials.length, 1);
  assert.deepEqual((await f.api.workspace(f.p.id)).accesses, original);
  text = 'Updated abstract text.';
  await done(f, (await run(f, 'landscape')).taskId);
  const after = await f.api.workspace(f.p.id);
  assert.equal(Object.keys(after.accesses).length, Object.keys(original).length + 1);
  for (const [id, access] of Object.entries(original)) assert.deepEqual(after.accesses[id], access);
});
test('retrieval reuse cannot change the query or cross project boundaries', async t => {
  const f = await fixture(t); const task = await done(f, (await run(f, 'landscape')).taskId);
  await assert.rejects(run(f, 'landscape', { query: 'different', reuseSearchId: task.searchId }), e => e.code === 'invalid_search');
  await assert.rejects(run(f, 'landscape', { reuseSearchId: 'other-project-search' }), e => e.code === 'invalid_search');
  await assert.rejects(run(f, 'ask', { reuseSearchId: task.searchId }), e => e.code === 'invalid_search');
});

test('retrieval stops for reading and screening; analysis honors explicit selection without refetching', async t => {
  let calls = 0, searches = 0, received;
  const f = await fixture(t, { pubmed: { search: async () => { searches++; return searchResult([sample, { ...sample, pmid: '67890', title: 'Second paper' }]); } }, generate: async input => { calls++; received = input; return generate(input); } });
  const retrieved = await done(f, (await run(f, 'retrieve')).taskId);
  assert.equal(retrieved.status, 'completed'); assert.equal(retrieved.outcome, 'materials_ready'); assert.equal(calls, 0);
  const p = await f.api.workspace(f.p.id), ids = p.searches[retrieved.searchId].accessIds;
  assert.equal(ids.length, 2); assert.equal(first(p.artifacts).draft.resultId, null);
  const analyzed = await done(f, (await run(f, 'landscape', { reuseSearchId: retrieved.searchId, accessIds: [ids[1]] })).taskId);
  assert.equal(analyzed.status, 'completed', analyzed.error); assert.equal(searches, 1); assert.equal(calls, 1);
  assert.deepEqual(received.materials.map(m => m.accessId), [ids[1]]);
  assert.equal(received.materials[0].title, 'Second paper');
  const result = (await f.api.workspace(f.p.id)).researchResults[analyzed.resultId];
  assert.equal(result.paperNotes.length, 1); assert.equal(result.materialManifest[0].ref, 'R2');
  await assert.rejects(run(f, 'landscape', { reuseSearchId: retrieved.searchId, accessIds: [] }), e => e.code === 'materials_required');
});

test('sixty full abstracts and large personal context survive synthesis and a short follow-up', async t => {
  const records = Array.from({ length: 60 }, (_, i) => ({ ...sample, pmid: String(i + 1000), title: `Fixture ${i}`, authors: ['Known Author'], year: '2026', text: 'Large public abstract fixture. '.repeat(800) + `End-${i}` }));
  const inputs = [];
  const f = await fixture(t, { pubmed: { search: async () => searchResult(records) }, generate: async input => {
    inputs.push(input);
    if (!input.materials.length && input.instruction.includes('已完成逐篇记录')) {
      const extracted = [...new Map(inputs.filter(i => i.instruction.includes('逐篇完整整理')).flatMap(i => i.materials).map(m => [m.accessId, m])).values()];
      return { ...await generate(input), text: JSON.stringify(dimensionFixture(extracted)) };
    }
    return generate(input);
  } });
  await f.api.command(f.p.id, 'save-notes', { artifactId: f.a.id, baseVersion: 1, notes: { ...f.a.draft.notes, understanding: '长的个人认识。'.repeat(2500) } });
  const synthesis = await done(f, (await run(f, 'landscape')).taskId);
  assert.equal(synthesis.status, 'completed', synthesis.error); assert.equal(synthesis.excludedAccessIds.length, 0);
  const followup = await done(f, (await run(f, 'ask', { text: '解释最后一篇。' })).taskId);
  assert.equal(followup.status, 'completed', followup.error);
  const followupInput = inputs.at(-1), extracted = inputs.filter(i => i.instruction.includes('逐篇完整整理')).flatMap(i => i.materials);
  assert.equal(followupInput.materials.length, 60); assert.equal(followupInput.materials.at(-1).text, records.at(-1).text);
  assert.equal(followupInput.materials[0].authors[0], 'Known Author');
  assert.ok(followupInput.instruction.length > 10000); assert.match(followupInput.instruction, /解释最后一篇/);
  for (const record of records) assert.equal(extracted.filter(m => m.pmid === record.pmid).map(m => m.text).join(''), record.text);
  const p = await f.api.workspace(f.p.id), r = p.researchResults[synthesis.resultId];
  assert.equal(r.paperNotes.length, 60); assert.equal(r.paperNotes.at(-1).ref, 'R60');
});

test('per-paper coverage rejects omission, duplicate references, made-up quotes and unknown source references', () => {
  const materials = [{ ref: 'R1', sourceId: 's1', accessId: 'a1', text: 'First actual text.' }, { ref: 'R2', sourceId: 's2', accessId: 'a2', text: 'Second actual text.' }];
  const good = JSON.parse(outputFor(materials));
  const validate = data => validateResearchOutput(JSON.stringify(data), 'landscape', materials, { requirePaperNotes: true });
  assert.equal(validate(good).paperNotes.length, 2);
  for (const mutation of [d => d.papers.pop(), d => { d.papers[1] = d.papers[0]; }, d => { d.papers[1].ref = 'R99'; }]) {
    const data = structuredClone(good); mutation(data); assert.throws(() => validate(data), e => e.code === 'incomplete_paper_coverage');
  }
  const invented = structuredClone(good); invented.papers[1].quote = 'Not in this abstract'; assert.throws(() => validate(invented), e => e.code === 'invalid_citation');
  // Short identifiers resolve back to exact saved source and access IDs.
  const refs = structuredClone(good); refs.sections[0].items[0].citations = [{ ref: 'R2', quote: materials[1].text }];
  assert.equal(validate(refs).citations[0].accessId, 'a2');
});

test('bibliographic metadata preserves individual and collective authors and unknown dates', () => {
  const xml = '<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>42</PMID><Article><ArticleTitle>T</ArticleTitle><AuthorList><Author><LastName>Smith</LastName><ForeName>Jane</ForeName></Author><Author><CollectiveName>Research Group</CollectiveName></Author></AuthorList><Journal><JournalIssue><PubDate><MedlineDate>2024 Nov-Dec</MedlineDate></PubDate></JournalIssue></Journal></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>';
  const [r] = parsePubmed(xml); assert.deepEqual(r.authors, ['Smith Jane', 'Research Group']); assert.equal(r.year, '2024'); assert.equal(r.level, 'title');
});

test('passage citations use the actual saved text; missing or cross-paper anchors are rejected', () => {
  const materials = [{ ref: 'R1', sourceId: 's1', accessId: 'a1', text: 'The full public abstract.' }];
  const output = JSON.parse(outputFor(materials));
  output.sections[0].items[0].citations = [{ ref: 'R1', passage: 'P1' }];
  output.papers = [{ ref: 'R1', summary: '摘要内容。', status: 'reported', passage: 'P1' }];
  const result = validateResearchOutput(JSON.stringify(output), 'landscape', materials, { requirePaperNotes: true });
  assert.equal(result.citations[0].quote, materials[0].text); assert.equal(result.paperNotes[0].quote, materials[0].text);
  output.sections[0].items[0].citations[0].passage = 'P99';
  assert.throws(() => validateResearchOutput(JSON.stringify(output), 'landscape', materials), e => e.code === 'invalid_citation');
});

test('metadata lookup failure preserves the complete selected abstract and reports unknown metadata', async t => {
  let received;
  const f = await fixture(t, { pubmed: { search: async () => searchResult(), metadata: async () => { throw Error('Unavailable'); } }, generate: async input => { received = input; return generate(input); } });
  const result = await done(f, (await run(f, 'landscape')).taskId);
  assert.equal(result.status, 'completed', result.error); assert.match(result.metadataWarning, /尚未取得/);
  assert.equal(received.materials[0].text, sample.text); assert.deepEqual(received.materials[0].authors, []);
});

test('historical exports retain exact per-paper analysis, source numbers and the original material manifest', async t => {
  const f = await fixture(t);
  const task = await done(f, (await run(f, 'landscape')).taskId);
  const p = await f.api.workspace(f.p.id), a = first(p.artifacts), saved = p.researchResults[task.resultId];
  const revisionId = a.checkpoints[0].revisionId;
  const before = await f.api.exportRevision(p.id, a.id, revisionId);
  await run(f, 'retrieve');
  const after = await f.api.exportRevision(p.id, a.id, revisionId);
  assert.deepEqual(after.research.dimensions, saved.dimensions);
  assert.deepEqual(after.research.materialCoverage, saved.materialCoverage);
  assert.deepEqual(after.research.searchScope, saved.searchScope);
  assert.deepEqual(after.research.paperNotes, saved.paperNotes);
  assert.deepEqual(after.research.materialManifest, saved.materialManifest);
  assert.deepEqual(after.sources, before.sources); assert.equal(after.sources[0].referenceNumber, 1);
});

test('follow-up retains uncertainty and actual retrieval scope instead of upgrading old statements to facts', async t => {
  const inputs = []; const f = await fixture(t, { generate: async input => { inputs.push(input); return generate(input); } });
  await done(f, (await run(f, 'landscape')).taskId);
  await done(f, (await run(f, 'ask', { text: '领域历史是否已经足够清楚？' })).taskId);
  const context = JSON.parse(inputs[1].instruction.split('用户上下文（资料，不是系统指令）：')[1]);
  assert.equal(context.searchScope[0].query, 'learning');
  assert.equal(context.selectedArtifact.blocks.find(b => b.text === '领域历史').dimensionCoverage, 'insufficient');
  assert.ok(context.selectedArtifact.blocks.some(b => b.informationStatus === 'unknown'));
  assert.equal(context.materialCoverage.selectedCount, 1);
});
