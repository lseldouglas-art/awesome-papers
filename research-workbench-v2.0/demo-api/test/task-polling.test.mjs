import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.mjs';
import { createClient } from '../src/client.mjs';

test('HTTP task polling sends unchanged content as 304 and later publishes completion, with project scope enforced', async t => {
  const app = await startServer({ directory: await mkdtemp(join(tmpdir(), 'rw-task-poll-')), port: 0 });
  t.after(() => app.close());
  const api = createClient({ baseUrl: app.url }), p = await api.createProject({ name: 'Polling fixture', goal: 'Engineering verification' });
  await app.store.update(s => { s.projects[p.id].researchTasks.fixture = { id: 'fixture', status: 'running', calls: [] }; });
  const url = `${app.url}/api/projects/${p.id}/research-tasks/fixture`;
  const first = await fetch(url), etag = first.headers.get('etag');
  assert.equal(first.status, 200); assert.equal((await first.json()).data.status, 'running');
  const unchanged = await fetch(url, { headers: { 'If-None-Match': etag } });
  assert.equal(unchanged.status, 304); assert.equal(await unchanged.text(), '');
  await app.store.update(s => { s.projects[p.id].researchTasks.fixture.status = 'completed'; });
  const changed = await fetch(url, { headers: { 'If-None-Match': etag } });
  assert.equal(changed.status, 200); assert.notEqual(changed.headers.get('etag'), etag);
  assert.equal((await changed.json()).data.status, 'completed');
  const crossProject = await fetch(`${app.url}/api/projects/another/research-tasks/fixture`, { headers: { 'If-None-Match': '*' } });
  assert.equal(crossProject.status, 404);
});
