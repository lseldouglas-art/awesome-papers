import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DomainError, requireThat } from './errors.mjs';
import { migrateState } from './progress.mjs';

const fresh = () => ({ schemaVersion: 2, projects: {}, receipts: {}, events: [], modelCalls: [] });
// Object key ordering must not turn a retried JSON request into a second operation.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export class LocalStore {
  #tail = Promise.resolve();
  #closed = false;
  constructor(directory) {
    this.directory = resolve(directory);
    this.filename = join(this.directory, 'workspace.json');
    this.lockfile = join(this.directory, 'writer.lock');
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    // A lock left after an unexpected kill is intentionally not stolen automatically.
    // A human can inspect its PID and remove this one named file after stopping the process.
    try { this.lock = await open(this.lockfile, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw new DomainError('store_locked', 503, '数据目录正在使用或留有中断锁，请检查 writer.lock 中的进程。');
      throw error;
    }
    try {
      await this.lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      await this.lock.sync();
      try {
        const state = await this.#read();
        if (state.schemaVersion === 1) {
          // Back up the exact bytes before any migration; never overwrite an earlier backup.
          const original = await readFile(this.filename);
          const backup = await open(join(this.directory, `workspace-before-v2-${randomUUID()}.json`), 'wx', 0o600);
          try { await backup.writeFile(original); await backup.sync(); } finally { await backup.close(); }
          await this.#persist(migrateState(state));
        }
      }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await this.#persist(fresh());
      }
      return this;
    } catch (error) { await this.close(); throw error; }
  }
  async #read() {
    const raw = await readFile(this.filename, 'utf8');
    let state;
    try { state = JSON.parse(raw); } catch { throw new DomainError('store_corrupt', 503, '本地数据无法解析，已停止写入，请保留原文件。'); }
    requireThat([1, 2].includes(state?.schemaVersion) && state.projects && state.receipts && Array.isArray(state.events),
      'store_corrupt', '本地数据结构无法识别，已停止写入。', 503);
    return state;
  }
  async #persist(state) {
    const temp = join(this.directory, `snapshot-${randomUUID()}.tmp`);
    const handle = await open(temp, 'wx', 0o600);
    let renamed = false;
    try {
      await handle.writeFile(JSON.stringify(state));
      await handle.sync();
      await handle.close();
      await rename(temp, this.filename);
      renamed = true;
      const directory = await open(this.directory, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally {
      await handle.close().catch(() => {});
      if (!renamed) await unlink(temp).catch(() => {}); // One exact temporary file only.
    }
  }
  #serial(work) {
    requireThat(!this.#closed, 'store_closed', '本地数据服务已经关闭。', 503);
    const result = this.#tail.then(work);
    this.#tail = result.catch(() => {});
    return result;
  }
  read(select = s => s) { return this.#serial(async () => structuredClone(select(await this.#read()))); }
  update(mutate) { return this.#serial(async () => { const state = await this.#read(); const result = await mutate(state); await this.#persist(state); return structuredClone(result); }); }
  transact(requestId, fingerprintInput, mutate) {
    requireThat(typeof requestId === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(requestId),
      'invalid_request_id', '写入请求需要 8–128 位字母、数字、下划线或连字符组成的 X-Request-Id。');
    const fingerprint = createHash('sha256').update(canonical(fingerprintInput)).digest('hex');
    return this.#serial(async () => {
      const state = await this.#read();
      const previous = Object.hasOwn(state.receipts, requestId) ? state.receipts[requestId] : null;
      if (previous) {
        requireThat(previous.fingerprint === fingerprint, 'request_id_conflict', '此请求编号已用于不同操作，请保留原请求或使用新编号。', 409);
        return structuredClone(previous.result);
      }
      const result = await mutate(state);
      Object.defineProperty(state.receipts, requestId, { value: { fingerprint, result, at: new Date().toISOString() }, enumerable: true, writable: true, configurable: true });
      state.events.push({ requestId, actor: 'local_user', operation: fingerprintInput.operation, projectId: fingerprintInput.projectId ?? result?.id ?? null, at: new Date().toISOString(),
        resultRevisionId: result?.revision?.id ?? (result?.artifactId ? result.id : null), previousRevisionId: result?.previousRevisionId ?? null });
      // State and retry receipt share one atomic durable snapshot.
      await this.#persist(state);
      return structuredClone(result);
    });
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await this.#tail;
    if (this.lock) {
      await this.lock.close();
      await unlink(this.lockfile);
      this.lock = null;
    }
  }
}
