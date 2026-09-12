import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.mjs';
import { createClient } from '../src/client.mjs';

test('HTTP explicit saved-output recovery preserves failed call, is idempotent after restart, and never bills again', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'rw2-local-revalidation-api-'));
  let calls = 0;
  const modelFactory = () => ({ generate: async input => {
    calls++;
    return { text: JSON.stringify({ items: [{ text: '工程材料报告关联，不构成因果证据。', status: 'reported', citations: [{ ref: input.materials[0].ref, passage: 'P1' }] }] }) + '\n``说明：工程测试尾注。',
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 }, cost: { status: 'unknown', amount: null }, provenance: { provider: 'fixture.invalid', model: 'fixture' } };
  } });
  let app = await startServer({ directory, port: 0, researchOptions: { modelFactory } });
  t.after(async () => { if (app) await app.close(); });
  let api = createClient({ baseUrl: app.url });
  await app.research.settings.save({ baseUrl: 'https://fixture.invalid/v1', model: 'fixture', apiKey: 'engineering-fixture-only', enabled: true });
  const p = await api.createProject({ name: '明确标记的工程恢复测试' }), a = Object.values(p.artifacts)[0];
  await api.command(p.id, 'attach-material', { artifactId: a.id, baseVersion: a.draft.version, title: '工程材料', text: '工程记录报告关联，未提供因果证据。', contentLevel: 'abstract' });
  const current = await api.workspace(p.id), draft = current.artifacts[a.id].draft;
  // Seed a historical failure using the pre-v0.9 strict transport behavior.
  const legacyInvoke = app.research.invokeModel.bind(app.research);
  app.research.invokeModel = async (...args) => { const result = await legacyInvoke(...args); return { ...result, text: await app.store.read(s => s.modelCalls.at(-1).outputText) }; };
  const start = await api.request(`/api/projects/${p.id}/research-tasks`, { method: 'POST', body: { mode: 'ask', artifactId: a.id, baseVersion: draft.version, accessIds: draft.sourceAccessIds, text: '解释工程资料' } });
  await app.research.running.get(start.taskId)?.promise;
  const failed = (await api.workspace(p.id)).researchTasks[start.taskId];
  assert.equal(failed.status, 'failed'); assert.equal(calls, 1);
  const originalCalls = await api.request('/api/model-calls');
  const path = `/api/projects/${p.id}/research-tasks/${start.taskId}/revalidate`, body = { extractLeadingJson: true }, requestId = 'explicit-local-recovery';
  const recovered = await api.request(path, { method: 'POST', body, requestId });
  await app.research.running.get(recovered.taskId)?.promise;
  const after = await api.workspace(p.id), task = after.researchTasks[recovered.taskId];
  assert.equal(task.status, 'completed', task.error); assert.equal(task.calls.length, 0); assert.equal(calls, 1);
  assert.deepEqual(after.researchTasks[start.taskId], failed);
  assert.deepEqual(await api.request('/api/model-calls'), originalCalls);
  assert.equal(after.researchState.currentQuestion, null);
  assert.equal(after.researchResults[task.resultId].citations[0].quote, '工程记录报告关联，未提供因果证据。');
  await app.close(); app = null;
  app = await startServer({ directory, port: 0, researchOptions: { modelFactory } }); api = createClient({ baseUrl: app.url });
  assert.deepEqual(await api.request(path, { method: 'POST', body, requestId }), recovered);
  assert.equal(calls, 1);
  const other = await api.createProject({ name: '另一个工程课题' });
  await assert.rejects(api.request(`/api/projects/${other.id}/research-tasks/${start.taskId}/revalidate`, { method: 'POST', body }));
  assert.equal(calls, 1);
});
