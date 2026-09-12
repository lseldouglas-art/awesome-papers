import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtemp, readFile, writeFile, stat, copyFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { SqliteStore } from '../src/sqlite-store.mjs';
import { LocalStore } from '../src/store.mjs';
import { createWorkspace } from '../src/workspace.mjs';
import { executeCommand, exportRevision } from '../src/domain.mjs';
import { upgradeProject, progressCommand, exportProgress } from '../src/progress.mjs';

const temp = () => mkdtemp(join(tmpdir(), 'rw2-sqlite-'));
const first = map => Object.values(map)[0];
const sha256 = value => createHash('sha256').update(value).digest('hex');
function fixtureState(schemaVersion = 2) {
  const state = { schemaVersion, projects: {}, receipts: {}, events: [], ...(schemaVersion === 2 ? { modelCalls: [] } : {}) };
  const p = createWorkspace(state, { example: true }, 'fixture-request');
  if (schemaVersion === 2) upgradeProject(p, false);
  const a = first(p.artifacts);
  executeCommand(state, p.id, 'add-annotation', { text: '保持旧定位', target: { artifactId: a.id, revisionId: a.revisions[0].id, blockId: 'question' } }, 'fixture-annotation');
  state.events.push({ requestId: 'historic-request', actor: 'local_user', operation: 'historical', at: '2026-09-01T10:00:00Z' });
  state.receipts['historic-request'] = { fingerprint: 'legacy-fingerprint', result: { id: p.id }, at: '2026-09-01T10:00:00Z' };
  return state;
}
async function populated(t, state = fixtureState()) {
  const directory = await temp();
  await writeFile(join(directory, 'workspace.json'), JSON.stringify(state, null, 2));
  const store = await new SqliteStore(directory).initialize();
  t.after(() => store.close());
  return { directory, store, state, p: first(state.projects), a: first(first(state.projects).artifacts) };
}

test('SQLite imports schema 2 byte backup and all source, anchor, event, receipt data exactly', async t => {
  const { store, state, directory } = await populated(t);
  assert.deepEqual(await store.read(), state);
  const report = await store.migrationReport();
  const original = await readFile(join(directory, 'workspace.json'));
  assert.deepEqual(await readFile(report.sourceBackup), original);
  assert.equal(report.sourceSha256, sha256(original));
  assert.equal(report.exactRoundTripVerified, true);
  assert.equal(report.counts.projects, 1);
  assert.equal(report.counts.artifactRevisions, 1);
  for (const path of [store.filename, report.sourceBackup]) assert.equal((await stat(path)).mode & 0o777, 0o600);
  const db = new Database(store.filename, { readonly: true });
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM artifacts').get().n, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM revisions').get().n, 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM entities WHERE collection='accesses'").get().n, 1);
    assert.equal(JSON.parse(db.prepare('SELECT payload FROM projects').get().payload).artifacts, undefined);
  } finally { db.close(); }
});

test('schema 1 migration preserves every old exported revision and original bytes', async t => {
  const old = fixtureState(1), p = first(old.projects), a = first(p.artifacts);
  const before = exportRevision(p, a.id, a.revisions[0].id);
  const { store, directory } = await populated(t, old);
  const imported = await store.read();
  assert.equal(imported.schemaVersion, 2);
  assert.deepEqual(exportRevision(imported.projects[p.id], a.id, a.revisions[0].id), before);
  assert.deepEqual(imported.projects[p.id].artifacts[a.id].legacyRevisionIds, [a.revisions[0].id]);
  assert.deepEqual(imported.receipts, old.receipts);
  assert.deepEqual(imported.events, old.events);
  assert.deepEqual(imported.modelCalls, []);
  assert.equal(JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8')).schemaVersion, 1);
});

test('fresh SQLite state survives reopen and uses the same writer lock as JSON store', async () => {
  const directory = await temp(); let store = await new SqliteStore(directory).initialize();
  const p = await store.transact('create-request', { operation: 'create-project' }, state => upgradeProject(createWorkspace(state, { name: '睡眠与慢性疼痛', goal: '了解领域' }, 'create-request'), false));
  await assert.rejects(new SqliteStore(directory).initialize(), error => error.code === 'store_locked');
  await assert.rejects(new LocalStore(directory).initialize(), error => error.code === 'store_locked');
  const before = await store.read();
  await store.close();
  store = await new SqliteStore(directory).initialize();
  try {
    assert.deepEqual(await store.read(), before);
    assert.equal((await store.read(s => s.projects[p.id])).name, p.name);
  } finally { await store.close(); }
  const legacyDirectory = await temp(), legacy = await new LocalStore(legacyDirectory).initialize();
  try { await assert.rejects(new SqliteStore(legacyDirectory).initialize(), error => error.code === 'store_locked'); }
  finally { await legacy.close(); }
});

test('invalid JSON and malformed legacy state never silently create an empty database', async () => {
  for (const content of ['{broken', '{"schemaVersion":2,"projects":[],"receipts":{},"events":[]}', '{"schemaVersion":2,"projects":{"broken":{}},"receipts":{},"events":[]}']) {
    const directory = await temp();
    await writeFile(join(directory, 'workspace.json'), content);
    await assert.rejects(new SqliteStore(directory).initialize(), error => error.code === 'store_corrupt');
    assert.equal(await readFile(join(directory, 'workspace.json'), 'utf8'), content);
    assert.equal((await readdir(directory)).includes('workspace.sqlite'), false);
    assert.equal((await readdir(directory)).includes('writer.lock'), false);
  }
});

test('corrupt or uninitialized SQLite is retained rather than replaced from JSON', async () => {
  for (const content of ['not sqlite', '']) {
    const directory = await temp();
    await writeFile(join(directory, 'workspace.sqlite'), content);
    await writeFile(join(directory, 'workspace.json'), JSON.stringify(fixtureState()));
    await assert.rejects(new SqliteStore(directory).initialize(), error => error.code === 'store_corrupt');
    assert.equal(await readFile(join(directory, 'workspace.sqlite'), 'utf8'), content);
  }
});

test('new writes to a stale JSON installation are detected on SQLite reopen', async t => {
  const { store, directory } = await populated(t);
  await store.close();
  const changed = fixtureState();
  await writeFile(join(directory, 'workspace.json'), JSON.stringify(changed));
  await assert.rejects(new SqliteStore(directory).initialize(), error => error.code === 'legacy_source_changed');
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8')), changed);
});

test('async mutator throw and a late immutable violation roll back all rows and retry receipt', async t => {
  const { store, p, a } = await populated(t), before = await store.read();
  await assert.rejects(store.transact('fail-request', { operation: 'change', projectId: p.id }, async state => {
    state.projects[p.id].name = '不可保存';
    await Promise.resolve();
    throw new Error('deliberate callback failure');
  }), /deliberate callback failure/);
  assert.deepEqual(await store.read(), before);
  await assert.rejects(store.transact('immutable-request', { operation: 'change', projectId: p.id }, state => {
    // projects is synchronized before revisions, so this tests a real SQL rollback.
    state.projects[p.id].name = '回滚这项已经写入事务的值';
    state.projects[p.id].artifacts[a.id].revisions[0].blocks[0].text = '覆盖历史';
    return { changed: true };
  }), error => error.code === 'immutable_history');
  assert.deepEqual(await store.read(), before);
});

test('transaction idempotency survives reopen, key reordering, and special property IDs', async () => {
  const directory = await temp(); let store = await new SqliteStore(directory).initialize();
  const body = { operation: 'create', content: { first: 1, second: 2 } };
  const response = await store.transact('__proto__', body, () => ({ saved: true }));
  await store.close(); store = await new SqliteStore(directory).initialize();
  try {
    assert.deepEqual(await store.transact('__proto__', { content: { second: 2, first: 1 }, operation: 'create' }, () => { throw Error('must not rerun'); }), response);
    await assert.rejects(store.transact('__proto__', { operation: 'different' }, () => null), error => error.code === 'request_id_conflict');
    const state = await store.read();
    assert.equal(state.events.length, 1);
    assert.equal(Object.hasOwn(state.receipts, '__proto__'), true);
  } finally { await store.close(); }
});

test('source accesses, decisions, events and research-item histories are immutable', async t => {
  const { store, p } = await populated(t);
  await store.update(state => {
    state.projects[p.id].decisions.d1 = { id: 'd1', choice: 'keep', actor: 'local_user' };
    state.projects[p.id].researchItems = { q1: { id: 'q1', kind: 'question', revisions: [{ id: 'qv1', text: '问题', number: 1 }] } };
    state.projects[p.id].researchEvents = [{ id: 'e1', kind: 'created' }];
  });
  const before = await store.read();
  const mutations = [
    state => { first(state.projects[p.id].accesses).text = '改写旧访问'; },
    state => { state.projects[p.id].decisions.d1.choice = 'adopt'; },
    state => { state.events.pop(); },
    state => { delete state.receipts['historic-request']; },
    state => { state.projects[p.id].researchItems.q1.revisions[0].text = '覆盖'; },
    state => { state.projects[p.id].researchItems.q1.revisions = []; },
    state => { state.projects[p.id].researchEvents[0].kind = 'changed'; },
  ];
  for (const mutate of mutations) {
    await assert.rejects(store.update(mutate), error => error.code === 'immutable_history');
    assert.deepEqual(await store.read(), before);
  }
  await store.update(state => {
    state.projects[p.id].researchItems.q1.revisions.push({ id: 'qv2', text: '追加', number: 2 });
    state.projects[p.id].researchEvents.push({ id: 'e2', kind: 'revised' });
  });
  assert.equal((await store.read(state => state.projects[p.id].researchItems.q1.revisions)).length, 2);
});

test('SQL triggers protect immutable rows even when callback layer is bypassed', async t => {
  const { store } = await populated(t), db = new Database(store.filename);
  try {
    assert.throws(() => db.prepare("UPDATE revisions SET payload='{}'").run(), /immutable_history/);
    assert.throws(() => db.prepare('DELETE FROM events').run(), /immutable_history/);
    assert.throws(() => db.prepare("UPDATE entities SET payload='{}' WHERE collection='accesses'").run(), /immutable_history/);
  } finally { db.close(); }
});

test('unchanged entities and revisions are not rewritten during task progress saves', async t => {
  const { store, p } = await populated(t), db = new Database(store.filename);
  try {
    db.exec('CREATE TABLE test_row_updates(collection TEXT); CREATE TRIGGER test_entity_updates AFTER UPDATE ON entities BEGIN INSERT INTO test_row_updates VALUES(NEW.collection); END;');
    await store.update(state => {
      state.projects[p.id].researchTasks.r1 = { id: 'r1', status: 'running', input: { materialIds: ['x'] } };
      state.projects[p.id].toolRuns = { t1: { id: 't1', status: 'running' } };
      state.modelCalls.push({ id: 'm1', status: 'running' });
    });
    await store.update(state => {
      state.projects[p.id].researchTasks.r1.status = 'completed';
      state.projects[p.id].toolRuns.t1.status = 'completed';
      state.modelCalls[0].status = 'completed';
    });
    assert.deepEqual(db.prepare('SELECT collection FROM test_row_updates ORDER BY collection').all().map(r => r.collection), ['researchTasks', 'toolRuns']);
    assert.equal((await store.read(state => state.modelCalls[0])).status, 'completed');
  } finally { db.close(); }
});

test('concurrent drafts, checkpoints, restore and precise exports behave as the JSON store did', async t => {
  const { store, p, a } = await populated(t);
  const old = await store.read(state => exportProgress(state.projects[p.id], a.id, a.revisions[0].id));
  const change = value => store.transact(`notes-${value}`, { operation: 'save-notes', value }, state => progressCommand(state, p.id, 'save-notes', { artifactId: a.id, baseVersion: 1, notes: { ...a.draft.notes, understanding: value } }, `notes-${value}`));
  const results = await Promise.allSettled([change('first'), change('second')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'draft_conflict');
  const checkpoint = await store.update(state => progressCommand(state, p.id, 'checkpoint', { artifactId: a.id, baseVersion: 2, name: '理解' }, 'checkpoint-id'));
  const saved = await store.read(state => exportProgress(state.projects[p.id], a.id, checkpoint.revisionId));
  await store.update(state => progressCommand(state, p.id, 'save-notes', { artifactId: a.id, baseVersion: 2, notes: { ...a.draft.notes, understanding: '下一版' } }, 'next-note'));
  await store.update(state => progressCommand(state, p.id, 'restore-progress', { artifactId: a.id, baseVersion: 3, revisionId: checkpoint.revisionId }, 'restore-id'));
  assert.deepEqual(await store.read(state => exportProgress(state.projects[p.id], a.id, a.revisions[0].id)), old);
  assert.deepEqual(await store.read(state => exportProgress(state.projects[p.id], a.id, checkpoint.revisionId)), saved);
  assert.equal((await store.read(state => state.projects[p.id].artifacts[a.id].draft.notes)).understanding, 'first');
});

test('consistent SQLite backup and JSON export restore exact content and never overwrite a path', async t => {
  const { store, p } = await populated(t);
  await store.update(state => { state.projects[p.id].name = '备份时的名字'; });
  const before = await store.read();
  const backup = await store.backup();
  const exported = await store.exportSnapshot();
  assert.equal((await stat(backup.path)).mode & 0o777, 0o600);
  assert.equal((await stat(exported.path)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(exported.path, 'utf8')), before);
  await assert.rejects(store.backup(backup.path), error => error.code === 'EEXIST');
  await assert.rejects(store.exportSnapshot(exported.path), error => error.code === 'EEXIST');
  await store.update(state => { state.projects[p.id].name = '备份之后的名字'; });
  const restoredDirectory = await temp();
  await copyFile(backup.path, join(restoredDirectory, 'workspace.sqlite'));
  const restored = await new SqliteStore(restoredDirectory).initialize();
  try { assert.deepEqual(await restored.read(), before); } finally { await restored.close(); }
});

test('process death inside a WAL transaction does not expose partial project or event changes', async t => {
  const { store, directory } = await populated(t), before = await store.read();
  await store.close();
  const source = `import Database from 'better-sqlite3';
    const db = new Database(process.argv[1]);
    db.exec('BEGIN IMMEDIATE');
    db.prepare("UPDATE projects SET payload=json_set(payload,'$.name','uncommitted')").run();
    db.prepare("INSERT INTO events(position,payload) VALUES(999,'{}')").run();
    process.stdout.write('transaction-open');
    setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, store.filename], { cwd: new URL('../..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.stdout.once('data', resolve);
    child.once('exit', code => reject(Error(`child exited before opening transaction: ${code}`)));
  });
  child.kill('SIGKILL');
  assert.equal((await exited)[1], 'SIGKILL');
  const reopened = await new SqliteStore(directory).initialize();
  try { assert.deepEqual(await reopened.read(), before); } finally { await reopened.close(); }
});

test('a killed SQLite writer can reopen autonomously while keeping its saved task input', async () => {
  const directory = await temp();
  const source = `import { SqliteStore } from './demo-api/src/sqlite-store.mjs';
    import { createWorkspace } from './demo-api/src/workspace.mjs';
    import { upgradeProject } from './demo-api/src/progress.mjs';
    const store = await new SqliteStore(process.argv[1]).initialize();
    await store.update(state => {
      const project = upgradeProject(createWorkspace(state, {name:'restart fixture'}, 'restart-create'), false);
      project.researchTasks.t1 = {id:'t1',status:'running',input:{text:'saved task input'}};
    });
    process.stdout.write('saved');
    setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, directory], { cwd: new URL('../..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  await new Promise((resolve, reject) => {
    child.once('error', reject); child.stdout.once('data', resolve);
    child.once('exit', code => reject(Error(`child exited before saving: ${code}`)));
  });
  const staleBytes = await readFile(join(directory, 'writer.lock'));
  assert.equal(JSON.parse(staleBytes).pid, child.pid);
  child.kill('SIGKILL'); await exited;
  const reopened = await new SqliteStore(directory).initialize();
  try {
    assert.equal(first((await reopened.read()).projects).researchTasks.t1.input.text, 'saved task input');
    assert.equal(JSON.parse(await readFile(join(directory, 'writer.lock'))).pid, process.pid);
    assert.equal((await stat(join(directory, 'writer.lock'))).mode & 0o777, 0o600);
  } finally { await reopened.close(); }
});

test('old-schema dead PID locks are reclaimable; malformed and live locks stay untouched', async () => {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await once(child, 'exit');
  const directory = await temp();
  // This is the exact schema previously written by LocalStore.
  await writeFile(join(directory, 'writer.lock'), JSON.stringify({ pid: child.pid, startedAt: '2026-09-01T10:00:00Z' }), { mode: 0o600 });
  const store = await new SqliteStore(directory).initialize();
  await store.close();
  for (const content of ['{partial', '{}', JSON.stringify({ pid: child.pid, startedAt: 'unknown' }),
    JSON.stringify({ pid: 0, startedAt: '2026-09-01T10:00:00Z' }),
    JSON.stringify({ pid: -1, startedAt: '2026-09-01T10:00:00Z' }),
    JSON.stringify({ pid: process.pid, startedAt: '2026-09-01T10:00:00Z' })]) {
    const blockedDirectory = await temp(), path = join(blockedDirectory, 'writer.lock');
    await writeFile(path, content);
    await assert.rejects(new SqliteStore(blockedDirectory).initialize(), error => error.code === 'store_locked');
    assert.equal(await readFile(path, 'utf8'), content);
  }
});

test('permission-denied process inspection never reclaims the writer lock', async t => {
  const directory = await temp(), path = join(directory, 'writer.lock');
  const content = JSON.stringify({ pid: 54321, startedAt: '2026-09-01T10:00:00Z' });
  await writeFile(path, content);
  t.mock.method(process, 'kill', () => { const error = new Error('operation not permitted'); error.code = 'EPERM'; throw error; });
  await assert.rejects(new SqliteStore(directory).initialize(), error => error.code === 'store_locked');
  assert.equal(await readFile(path, 'utf8'), content);
});

test('two simultaneous restarts of a confirmed dead writer still acquire only one writer', async () => {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await once(child, 'exit');
  const directory = await temp();
  await writeFile(join(directory, 'writer.lock'), JSON.stringify({ pid: child.pid, startedAt: '2026-09-01T10:00:00Z' }));
  const results = await Promise.allSettled([new SqliteStore(directory).initialize(), new SqliteStore(directory).initialize()]);
  try {
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'store_locked');
  } finally { for (const result of results) if (result.status === 'fulfilled') await result.value.close(); }
});

test('separate processes racing to recover a stale writer cannot remove the new live lock', async () => {
  const gone = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' }); await once(gone, 'exit');
  const directory = await temp();
  await writeFile(join(directory, 'writer.lock'), JSON.stringify({ pid: gone.pid, startedAt: '2026-09-01T10:00:00Z' }));
  const source = `import { SqliteStore } from './demo-api/src/sqlite-store.mjs';
    let store;
    process.on('message', async message => {
      if (message === 'start') {
        try { store = await new SqliteStore(process.argv[1]).initialize(); process.send({status:'acquired',pid:process.pid}); }
        catch (error) { process.send({status:'blocked',code:error.code}); }
      } else if (message === 'close') { if(store) await store.close(); process.exit(0); }
    });
    process.send({status:'ready'});`;
  const children = [0, 1].map(() => spawn(process.execPath, ['--input-type=module', '-e', source, directory], { cwd: new URL('../..', import.meta.url), stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }));
  try {
    await Promise.all(children.map(child => once(child, 'message')));
    const replies = children.map(child => once(child, 'message'));
    children.forEach(child => child.send('start'));
    const results = (await Promise.all(replies)).map(([message]) => message);
    assert.equal(results.filter(r => r.status === 'acquired').length, 1);
    assert.equal(results.find(r => r.status === 'blocked').code, 'store_locked');
    const acquired = results.find(r => r.status === 'acquired');
    assert.equal(JSON.parse(await readFile(join(directory, 'writer.lock'))).pid, acquired.pid);
    const exits = children.map(child => once(child, 'exit')); children.forEach(child => child.send('close')); await Promise.all(exits);
  } finally { children.forEach(child => { if (child.exitCode === null) child.kill('SIGKILL'); }); }
});
