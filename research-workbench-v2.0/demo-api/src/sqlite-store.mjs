import Database from 'better-sqlite3';
import { readFileSync, lstatSync, unlinkSync } from 'node:fs';
import { mkdir, open, readFile, rename, unlink, chmod, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DomainError, requireThat } from './errors.mjs';
import { migrateState } from './progress.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fresh = () => ({ schemaVersion: 2, projects: {}, receipts: {}, events: [], modelCalls: [] });
const json = value => JSON.stringify(value);
const parse = value => JSON.parse(value);
const own = (target, key, value) => Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${json(key)}:${canonical(value[key])}`).join(',')}}`;
  return json(value);
}
const hash = value => createHash('sha256').update(value).digest('hex');
const equalJSON = (a, b) => canonical(parse(a)) === canonical(parse(b));
function validate(state) {
  requireThat(object(state) && [1, 2].includes(state.schemaVersion) && object(state.projects) && object(state.receipts)
    && Array.isArray(state.events) && (state.modelCalls === undefined || Array.isArray(state.modelCalls)),
  'store_corrupt', '本机数据结构无法识别，已停止写入并保留原文件。', 503);
  for (const project of Object.values(state.projects)) {
    requireThat(object(project) && object(project.artifacts), 'store_corrupt', '本机课题缺少成果记录，已停止写入。', 503);
    for (const artifact of Object.values(project.artifacts)) {
      requireThat(object(artifact) && Array.isArray(artifact.revisions) && artifact.revisions.length > 0,
        'store_corrupt', '成果缺少历史版本，已停止写入。', 503);
    }
  }
}

// All object maps are stored one entity per row. This includes future kernel collections
// without putting a whole project, its materials, or its runs in a single JSON value.
// Artifact and research-item revisions are separate immutable rows. Arrays retain order.
const definitions = {
  root_properties: ['name', 'payload'],
  projects: ['id', 'position', 'payload'],
  collections: ['project_id', 'name', 'kind', 'position'],
  entities: ['project_id', 'collection', 'id', 'position', 'has_revisions', 'payload'],
  revisions: ['project_id', 'collection', 'entity_id', 'id', 'position', 'payload'],
  sequences: ['project_id', 'collection', 'position', 'payload'],
  events: ['position', 'payload'],
  receipts: ['id', 'position', 'payload'],
  model_calls: ['position', 'payload'],
};
const keys = {
  root_properties: ['name'], projects: ['id'], collections: ['project_id', 'name'],
  entities: ['project_id', 'collection', 'id'], revisions: ['project_id', 'collection', 'entity_id', 'id'],
  sequences: ['project_id', 'collection', 'position'], events: ['position'], receipts: ['id'], model_calls: ['position'],
};
const keyFor = (table, row) => json(keys[table].map(key => row[key]));
function flatten(state) {
  validate(state);
  const tables = Object.fromEntries(Object.keys(definitions).map(name => [name, []]));
  for (const [name, value] of Object.entries(state)) if (!['projects', 'events', 'receipts', 'modelCalls'].includes(name)) {
    tables.root_properties.push({ name, payload: json(value) });
  }
  for (const [position, [id, project]] of Object.entries(state.projects).entries()) {
    const payload = {};
    for (const [propertyPosition, [name, value]] of Object.entries(project).entries()) {
      if (!object(value) && !Array.isArray(value)) { own(payload, name, value); continue; }
      tables.collections.push({ project_id: id, name, kind: Array.isArray(value) ? 'array' : 'object', position: propertyPosition });
      if (Array.isArray(value)) {
        value.forEach((item, index) => tables.sequences.push({ project_id: id, collection: name, position: index, payload: json(item) }));
        continue;
      }
      for (const [entityPosition, [entityId, entity]] of Object.entries(value).entries()) {
        const revisions = object(entity) && Array.isArray(entity.revisions) ? entity.revisions : null;
        const rest = revisions ? Object.fromEntries(Object.entries(entity).filter(([key]) => key !== 'revisions')) : entity;
        tables.entities.push({ project_id: id, collection: name, id: entityId, position: entityPosition, has_revisions: revisions ? 1 : 0, payload: json(rest) });
        if (revisions) {
          const seen = new Set();
          revisions.forEach((revision, index) => {
            requireThat(object(revision) && typeof revision.id === 'string' && !seen.has(revision.id),
              'store_corrupt', '历史版本标识缺失或重复，已停止写入。', 503);
            seen.add(revision.id);
            tables.revisions.push({ project_id: id, collection: name, entity_id: entityId, id: revision.id, position: index, payload: json(revision) });
          });
        }
      }
    }
    tables.projects.push({ id, position, payload: json(payload) });
  }
  state.events.forEach((event, position) => tables.events.push({ position, payload: json(event) }));
  Object.entries(state.receipts).forEach(([id, receipt], position) => tables.receipts.push({ id, position, payload: json(receipt) }));
  // schemaVersion 1 did not have model calls; initialization upgrades it explicitly.
  (state.modelCalls ?? []).forEach((call, position) => tables.model_calls.push({ position, payload: json(call) }));
  return tables;
}
function createSchema(db) {
  db.exec(`
    CREATE TABLE storage_metadata (name TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)));
    CREATE TABLE root_properties (name TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)));
    CREATE TABLE projects (id TEXT PRIMARY KEY, position INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)));
    CREATE TABLE collections (project_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('object','array')), position INTEGER NOT NULL, PRIMARY KEY(project_id,name));
    CREATE TABLE entities (project_id TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL, position INTEGER NOT NULL, has_revisions INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(project_id,collection,id));
    CREATE TABLE revisions (project_id TEXT NOT NULL, collection TEXT NOT NULL, entity_id TEXT NOT NULL, id TEXT NOT NULL, position INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(project_id,collection,entity_id,id), UNIQUE(project_id,collection,entity_id,position));
    CREATE TABLE sequences (project_id TEXT NOT NULL, collection TEXT NOT NULL, position INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(project_id,collection,position));
    CREATE TABLE events (position INTEGER PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)));
    CREATE TABLE receipts (id TEXT PRIMARY KEY, position INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)));
    CREATE TABLE model_calls (position INTEGER PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)));
    CREATE VIEW artifacts AS SELECT project_id,id,position,payload FROM entities WHERE collection='artifacts';
    CREATE VIEW research_tasks AS SELECT project_id,id,position,payload FROM entities WHERE collection='researchTasks';
    CREATE VIEW tool_runs AS SELECT project_id,id,position,payload FROM entities WHERE collection='toolRuns';
  `);
  for (const table of ['revisions', 'events', 'receipts']) for (const action of ['UPDATE', 'DELETE']) {
    db.exec(`CREATE TRIGGER ${table}_immutable_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT, 'immutable_history'); END;`);
  }
  for (const action of ['UPDATE', 'DELETE']) {
    db.exec(`CREATE TRIGGER evidence_snapshot_immutable_${action.toLowerCase()} BEFORE ${action} ON entities WHEN OLD.collection IN ('accesses','decisions') BEGIN SELECT RAISE(ABORT, 'immutable_history'); END;`);
    db.exec(`CREATE TRIGGER project_history_immutable_${action.toLowerCase()} BEFORE ${action} ON sequences WHEN OLD.collection IN ('metadataHistory','researchEvents') BEGIN SELECT RAISE(ABORT, 'immutable_history'); END;`);
  }
}
function immutable(table, row) {
  return ['revisions', 'events', 'receipts'].includes(table)
    || table === 'entities' && ['accesses', 'decisions'].includes(row.collection)
    || table === 'sequences' && ['metadataHistory', 'researchEvents'].includes(row.collection);
}
function syncRows(db, tables) {
  for (const [table, columns] of Object.entries(definitions)) {
    const existing = new Map(db.prepare(`SELECT * FROM ${table}`).all().map(row => [keyFor(table, row), row]));
    const desired = new Map(tables[table].map(row => [keyFor(table, row), row]));
    requireThat(desired.size === tables[table].length, 'store_corrupt', '数据记录标识重复，已停止写入。', 503);
    const insert = db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(key => `@${key}`).join(',')})`);
    const changeColumns = columns.filter(column => !keys[table].includes(column));
    const where = keys[table].map(column => `${column}=@${column}`).join(' AND ');
    const update = db.prepare(`UPDATE ${table} SET ${changeColumns.map(column => `${column}=@${column}`).join(',')} WHERE ${where}`);
    const remove = db.prepare(`DELETE FROM ${table} WHERE ${where}`);
    for (const [key, before] of existing) {
      const after = desired.get(key);
      // JSON key ordering is not a historical content change.
      const changed = after && columns.some(column => column === 'payload' ? !equalJSON(before[column], after[column]) : before[column] !== after[column]);
      requireThat(!(immutable(table, before) && (!after || changed)), 'immutable_history', '历史版本、访问快照、决定或事件不能覆盖或删除，请追加新记录。', 409);
      if (!after) remove.run(before);
      else if (changed) update.run(after);
    }
    for (const [key, row] of desired) if (!existing.has(key)) insert.run(row);
  }
}
function readDatabase(db) {
  const state = {};
  for (const row of db.prepare('SELECT * FROM root_properties').all()) own(state, row.name, parse(row.payload));
  state.projects = {}; state.events = []; state.receipts = {}; state.modelCalls = [];
  for (const row of db.prepare('SELECT * FROM projects ORDER BY position').all()) own(state.projects, row.id, parse(row.payload));
  for (const row of db.prepare('SELECT * FROM collections ORDER BY project_id,position').all()) {
    const project = state.projects[row.project_id];
    requireThat(project, 'store_corrupt', '本机数据的课题关联已损坏，已停止写入。', 503);
    own(project, row.name, row.kind === 'array' ? [] : {});
  }
  for (const row of db.prepare('SELECT * FROM entities ORDER BY project_id,collection,position').all()) {
    const collection = state.projects[row.project_id]?.[row.collection];
    requireThat(object(collection), 'store_corrupt', '本机数据的内容关联已损坏，已停止写入。', 503);
    const entity = parse(row.payload);
    if (row.has_revisions) entity.revisions = [];
    own(collection, row.id, entity);
  }
  for (const row of db.prepare('SELECT * FROM revisions ORDER BY project_id,collection,entity_id,position').all()) {
    const revisions = state.projects[row.project_id]?.[row.collection]?.[row.entity_id]?.revisions;
    requireThat(Array.isArray(revisions) && revisions.length === row.position, 'store_corrupt', '本机数据的历史关联已损坏，已停止写入。', 503);
    revisions.push(parse(row.payload));
  }
  for (const row of db.prepare('SELECT * FROM sequences ORDER BY project_id,collection,position').all()) {
    const sequence = state.projects[row.project_id]?.[row.collection];
    requireThat(Array.isArray(sequence) && sequence.length === row.position, 'store_corrupt', '本机数据的记录顺序已损坏，已停止写入。', 503);
    sequence.push(parse(row.payload));
  }
  for (const row of db.prepare('SELECT * FROM events ORDER BY position').all()) state.events.push(parse(row.payload));
  for (const row of db.prepare('SELECT * FROM receipts ORDER BY position').all()) own(state.receipts, row.id, parse(row.payload));
  for (const row of db.prepare('SELECT * FROM model_calls ORDER BY position').all()) state.modelCalls.push(parse(row.payload));
  validate(state);
  return state;
}
async function exists(path) {
  try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function writeExclusive(path, bytes) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
function deadWriter(path, reclaim = false) {
  // Only a confirmed absent PID authorizes reclaim. EPERM, unknown failures,
  // partial writes, symlinks, and PID reuse are all treated as a live lock.
  try {
    const originalStat = lstatSync(path);
    if (!originalStat.isFile()) return false;
    const original = readFileSync(path), record = parse(original.toString('utf8'));
    if (!object(record) || !Number.isSafeInteger(record.pid) || record.pid <= 0 || record.pid > 2147483647
      || typeof record.startedAt !== 'string' || !Number.isFinite(Date.parse(record.startedAt))) return false;
    try { process.kill(record.pid, 0); return false; }
    catch (error) { if (error.code !== 'ESRCH') return false; }
    // Re-read the exact bytes and inode immediately before removing this one file.
    // Keep this sequence synchronous so concurrent initializations in this process
    // cannot replace the lock between its final verification and unlink.
    const currentStat = lstatSync(path);
    if (!currentStat.isFile() || currentStat.ino !== originalStat.ino || currentStat.dev !== originalStat.dev
      || !readFileSync(path).equals(original)) return false;
    if (reclaim) unlinkSync(path);
    return true;
  } catch { return false; }
}
async function recoverWriter(path, directory) {
  const locked = () => new DomainError('store_locked', 503, '数据目录正在使用，或无法确认 writer.lock 对应进程已退出，请保留锁文件并检查进程。');
  if (!deadWriter(path)) throw locked();
  // A compare-then-unlink alone is not safe across processes: two restarts can
  // both observe the old lock before one replaces it. Serialize that short repair
  // with a native SQLite transaction. Its OS lock disappears if recovery crashes;
  // there is no second stale PID lock requiring manual cleanup.
  const guardPath = join(directory, 'writer-recovery.sqlite');
  let guard;
  try {
    try { await writeExclusive(guardPath, Buffer.alloc(0)); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (!lstatSync(guardPath).isFile()) throw locked();
    guard = new Database(guardPath, { timeout: 0 });
    // No schema is needed for an OS-backed SQLite lock. Concurrent CREATE TABLE
    // statements can both fail their read-to-write lock upgrades before this guard.
    guard.exec('BEGIN EXCLUSIVE');
    if (!deadWriter(path, true)) throw locked();
    try { return await open(path, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw locked(); throw error; }
  } catch (error) {
    if (error.code?.startsWith('SQLITE_')) throw locked();
    throw error;
  } finally {
    if (guard?.open) {
      if (guard.inTransaction) guard.exec('ROLLBACK');
      guard.close();
    }
  }
}
const counts = state => ({ projects: Object.keys(state.projects).length,
  artifacts: Object.values(state.projects).reduce((n, p) => n + Object.keys(p.artifacts).length, 0),
  artifactRevisions: Object.values(state.projects).reduce((n, p) => n + Object.values(p.artifacts).reduce((m, a) => m + a.revisions.length, 0), 0),
  events: state.events.length, receipts: Object.keys(state.receipts).length, modelCalls: state.modelCalls?.length ?? 0 });

/** Callback-compatible replacement for LocalStore; one process owns writer.lock. */
export class SqliteStore {
  #tail = Promise.resolve();
  #closed = false;
  #db;
  constructor(directory) {
    this.directory = resolve(directory);
    this.filename = join(this.directory, 'workspace.sqlite');
    this.legacyFilename = join(this.directory, 'workspace.json');
    this.lockfile = join(this.directory, 'writer.lock');
    this.storage = 'sqlite';
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try { this.lock = await open(this.lockfile, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      this.lock = await recoverWriter(this.lockfile, this.directory);
    }
    try {
      await this.lock.writeFile(json({ pid: process.pid, startedAt: new Date().toISOString(), storage: 'sqlite', lockId: randomUUID() }));
      await this.lock.sync();
      if (!await exists(this.filename)) await this.#initializeDatabase();
      this.#db = new Database(this.filename, { fileMustExist: true });
      requireThat(this.#db.pragma('quick_check', { simple: true }) === 'ok', 'store_corrupt', '本机数据库校验失败，已停止写入并保留原文件。', 503);
      const metadata = Object.fromEntries(this.#db.prepare('SELECT * FROM storage_metadata').all().map(row => [row.name, parse(row.payload)]));
      requireThat(metadata.formatVersion === 1 && metadata.initialized === true, 'store_corrupt', '本机数据库初始化不完整，已停止写入。', 503);
      const report = metadata.migrationReport;
      if (report?.sourceSha256 && await exists(this.legacyFilename)) {
        requireThat(hash(await readFile(this.legacyFilename)) === report.sourceSha256, 'legacy_source_changed',
          '迁移后旧 JSON 文件又有修改，请先核对两份数据；没有用旧文件覆盖数据库。', 503);
      }
      readDatabase(this.#db);
      await chmod(this.filename, 0o600);
      this.#db.pragma('journal_mode = WAL');
      this.#db.pragma('synchronous = FULL');
      this.#db.pragma('busy_timeout = 5000');
      return this;
    } catch (error) {
      await this.close();
      if (error.code?.startsWith('SQLITE_') || error instanceof SyntaxError) throw new DomainError('store_corrupt', 503, '本机数据库无法读取，已停止写入并保留原文件。');
      throw error;
    }
  }
  async #initializeDatabase() {
    const original = await exists(this.legacyFilename) ? await readFile(this.legacyFilename) : null;
    let state;
    if (original) {
      try { state = parse(original.toString('utf8')); } catch { throw new DomainError('store_corrupt', 503, '旧 JSON 文件无法解析，已停止迁移并保留原文件。'); }
      validate(state);
    } else state = fresh();
    const sourceSchemaVersion = state.schemaVersion;
    const importId = randomUUID();
    const sourceBackup = original ? join(this.directory, `workspace-before-sqlite-${importId}.json`) : null;
    if (sourceBackup) await writeExclusive(sourceBackup, original);
    if (state.schemaVersion === 1) state = migrateState(state);
    // schemaVersion 2 installations always recorded modelCalls; tolerate its absence in
    // old handcrafted exports without manufacturing calls or historical evidence.
    state.modelCalls ??= [];
    const tables = flatten(state);
    const report = { format: 'research-workbench-sqlite-migration', version: 1, importId,
      createdAt: new Date().toISOString(), source: original ? 'workspace.json' : 'new_workspace',
      sourceSchemaVersion, destinationSchemaVersion: 2, sourceSha256: original ? hash(original) : null,
      sourceBackup, stateSha256: hash(canonical(state)), counts: counts(state), exactRoundTripVerified: false };
    const staging = join(this.directory, `workspace-import-${importId}.sqlite`);
    // An interrupted/failed staging database is deliberately kept at its exact named path.
    // It never becomes workspace.sqlite until import and round-trip checks both pass.
    await writeExclusive(staging, Buffer.alloc(0));
    const db = new Database(staging);
    try {
      db.pragma('synchronous = FULL');
      db.transaction(() => {
        createSchema(db);
        syncRows(db, tables);
        const restored = readDatabase(db);
        requireThat(canonical(restored) === canonical(state), 'migration_mismatch', '迁移核对不一致，原文件和迁移副本均保留，未启用新数据库。', 503);
        report.exactRoundTripVerified = true;
        const insert = db.prepare('INSERT INTO storage_metadata(name,payload) VALUES (?,?)');
        for (const [name, value] of Object.entries({ formatVersion: 1, initialized: true, migrationReport: report })) insert.run(name, json(value));
      }).immediate();
      requireThat(db.pragma('integrity_check', { simple: true }) === 'ok', 'migration_mismatch', '迁移数据库完整性检查失败，未启用新数据库。', 503);
    } finally { db.close(); }
    await writeExclusive(join(this.directory, `sqlite-migration-${importId}.json`), json(report));
    await rename(staging, this.filename);
    await syncDirectory(this.directory);
  }
  #serial(work) {
    requireThat(!this.#closed && this.#db, 'store_closed', '本机数据服务已经关闭或尚未初始化。', 503);
    const result = this.#tail.then(work);
    this.#tail = result.catch(() => {});
    return result;
  }
  #persist(state) {
    const tables = flatten(state);
    // Awaiting application callbacks happens before opening the SQLite transaction.
    // Only the synchronous row diff and durable commit are inside the transaction.
    this.#db.transaction(() => syncRows(this.#db, tables)).immediate();
  }
  read(select = state => state) { return this.#serial(() => structuredClone(select(readDatabase(this.#db)))); }
  update(mutate) {
    return this.#serial(async () => {
      const state = readDatabase(this.#db);
      const result = await mutate(state);
      this.#persist(state);
      return structuredClone(result);
    });
  }
  transact(requestId, fingerprintInput, mutate) {
    requireThat(typeof requestId === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(requestId), 'invalid_request_id',
      '写入请求需要 8–128 位字母、数字、下划线或连字符组成的 X-Request-Id。');
    const fingerprint = hash(canonical(fingerprintInput));
    return this.#serial(async () => {
      const state = readDatabase(this.#db);
      const previous = Object.hasOwn(state.receipts, requestId) ? state.receipts[requestId] : null;
      if (previous) {
        requireThat(previous.fingerprint === fingerprint, 'request_id_conflict', '此请求编号已用于不同操作，请保留原请求或使用新编号。', 409);
        return structuredClone(previous.result);
      }
      const result = await mutate(state);
      own(state.receipts, requestId, { fingerprint, result, at: new Date().toISOString() });
      state.events.push({ requestId, actor: 'local_user', operation: fingerprintInput.operation,
        projectId: fingerprintInput.projectId ?? result?.id ?? null, at: new Date().toISOString(),
        resultRevisionId: result?.revision?.id ?? (result?.artifactId ? result.id : null), previousRevisionId: result?.previousRevisionId ?? null });
      this.#persist(state);
      return structuredClone(result);
    });
  }
  migrationReport() {
    return this.#serial(() => parse(this.#db.prepare("SELECT payload FROM storage_metadata WHERE name='migrationReport'").get().payload));
  }
  backup(destination = join(this.directory, `workspace-backup-${randomUUID()}.sqlite`)) {
    return this.#serial(async () => {
      const path = resolve(destination);
      await writeExclusive(path, Buffer.alloc(0));
      try {
        await this.#db.backup(path);
        await chmod(path, 0o600);
        const handle = await open(path, 'r');
        try { await handle.sync(); } finally { await handle.close(); }
        const state = readDatabase(this.#db);
        return { format: 'research-workbench-sqlite-backup', path, createdAt: new Date().toISOString(), stateSha256: hash(canonical(state)), counts: counts(state) };
      } catch (error) {
        // Keep the failed named backup for inspection; never treat it as successful.
        throw new DomainError('backup_failed', 503, `备份未完成，请保留并检查此文件：${path}`, { cause: error.code ?? 'unknown' });
      }
    });
  }
  exportSnapshot(destination = join(this.directory, `workspace-export-${randomUUID()}.json`)) {
    return this.#serial(async () => {
      const state = readDatabase(this.#db), path = resolve(destination);
      await writeExclusive(path, json(state));
      return { format: 'research-workbench-state', path, stateSha256: hash(canonical(state)), counts: counts(state) };
    });
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await this.#tail;
    try { if (this.#db?.open) this.#db.close(); }
    finally {
      if (this.lock) {
        await this.lock.close();
        await unlink(this.lockfile); // One exact lock owned by this instance only.
        this.lock = null;
      }
    }
  }
}
