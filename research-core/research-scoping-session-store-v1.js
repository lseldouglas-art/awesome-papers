import { open, readFile, stat, unlink } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { sha256 } from "./event-engine-v1.js";

const SESSION_SCHEMA = "research-scoping-session/v1";
const IDENTITY_SCHEMA = "research-scoping-session-identity/v1";
const GENESIS_HASH = "0".repeat(64);
const DEFAULT_LOCK_TIMEOUT_MS = 2_000;
const DEFAULT_LOCK_RETRY_MS = 10;
const STALE_LOCK_AGE_MS = 2 * 60 * 1000;

export const SCOPING_SESSION_STAGES = Object.freeze({
  FIRST_PLAN: "first_plan",
  FIRST_CALIBRATION: "first_calibration",
  FIRST_PREVIEW: "first_preview",
  DIRECTION_SELECTED: "direction_selected",
  SECOND_PLAN: "second_plan",
  SECOND_CALIBRATION: "second_calibration",
  COMPLETE: "complete",
});

const TRANSITIONS = Object.freeze({
  FIRST_PLAN_GENERATED: { from: null, to: SCOPING_SESSION_STAGES.FIRST_PLAN, field: "plan" },
  FIRST_CALIBRATION_COMPLETED: {
    from: SCOPING_SESSION_STAGES.FIRST_PLAN,
    to: SCOPING_SESSION_STAGES.FIRST_CALIBRATION,
    field: "calibration",
  },
  FIRST_PREVIEW_COMPLETED: {
    from: SCOPING_SESSION_STAGES.FIRST_CALIBRATION,
    to: SCOPING_SESSION_STAGES.FIRST_PREVIEW,
    field: "preview",
  },
  DIRECTION_SELECTED: {
    from: SCOPING_SESSION_STAGES.FIRST_PREVIEW,
    to: SCOPING_SESSION_STAGES.DIRECTION_SELECTED,
    field: "directionSelection",
  },
  SECOND_PLAN_GENERATED: {
    from: SCOPING_SESSION_STAGES.DIRECTION_SELECTED,
    to: SCOPING_SESSION_STAGES.SECOND_PLAN,
    field: "plan",
  },
  SECOND_CALIBRATION_COMPLETED: {
    from: SCOPING_SESSION_STAGES.SECOND_PLAN,
    to: SCOPING_SESSION_STAGES.SECOND_CALIBRATION,
    field: "calibration",
  },
  SECOND_PREVIEW_COMPLETED: {
    from: SCOPING_SESSION_STAGES.SECOND_CALIBRATION,
    to: SCOPING_SESSION_STAGES.COMPLETE,
    field: "preview",
  },
});

export class ResearchScopingSessionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ResearchScopingSessionError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new ResearchScopingSessionError(code, message, details);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function unlinkIfPresent(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function assertSessionId(sessionId) {
  if (typeof sessionId !== "string" || !/^scoping-[0-9a-f-]{36}$/i.test(sessionId)) {
    fail("INVALID_SCOPING_SESSION_ID", "建项前调查会话编号无效。");
  }
}

function identityFor(snapshot) {
  return {
    schemaVersion: IDENTITY_SCHEMA,
    id: snapshot.id,
    revision: snapshot.revision,
    revisionHash: snapshot.revisionHash,
    stage: snapshot.stage,
  };
}

function emptySnapshot(sessionId) {
  return {
    schemaVersion: SESSION_SCHEMA,
    id: sessionId,
    revision: 0,
    revisionHash: GENESIS_HASH,
    stage: null,
    createdAt: null,
    updatedAt: null,
    firstRound: { plan: null, calibration: null, preview: null },
    directionSelection: null,
    secondRound: { plan: null, calibration: null, preview: null },
  };
}

function applyRecord(snapshot, record) {
  const transition = TRANSITIONS[record.eventType];
  if (!transition) {
    fail("INVALID_SCOPING_SESSION_EVENT", `未知的建项前调查修订类型：${record.eventType}`);
  }
  if (snapshot.stage !== transition.from || record.stage !== transition.to) {
    fail(
      "INVALID_SCOPING_SESSION_SEQUENCE",
      `建项前调查修订顺序无效：${snapshot.stage ?? "start"} → ${record.stage}。`,
      { revision: record.revision, eventType: record.eventType },
    );
  }
  const round = record.eventType.startsWith("FIRST_") ? snapshot.firstRound : snapshot.secondRound;
  if (record.eventType === "DIRECTION_SELECTED") {
    snapshot.directionSelection = structuredClone(record.payload);
  } else {
    round[transition.field] = structuredClone(record.payload);
  }
  snapshot.revision = record.revision;
  snapshot.revisionHash = record.hash;
  snapshot.stage = record.stage;
  snapshot.createdAt ??= record.recordedAt;
  snapshot.updatedAt = record.recordedAt;
  return snapshot;
}

function parseRecords(source, sessionId) {
  if (!source) return [];
  if (!source.endsWith("\n")) {
    fail("TRUNCATED_SCOPING_SESSION", "建项前调查记录没有停在完整修订边界。", { sessionId });
  }
  return source.slice(0, -1).split("\n").map((line, index) => {
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      fail("INVALID_SCOPING_SESSION_NDJSON", `建项前调查第 ${index + 1} 条修订无法解析。`, {
        sessionId,
        cause: error?.message,
      });
    }
    return record;
  });
}

function replayRecords(sessionId, records) {
  const snapshot = emptySnapshot(sessionId);
  for (const [index, record] of records.entries()) {
    const expectedRevision = index + 1;
    if (
      record?.schemaVersion !== SESSION_SCHEMA
      || record.sessionId !== sessionId
      || record.revision !== expectedRevision
      || record.previousHash !== snapshot.revisionHash
    ) {
      fail("INVALID_SCOPING_SESSION_CHAIN", `建项前调查第 ${expectedRevision} 条修订链不完整。`, {
        sessionId,
        revision: expectedRevision,
      });
    }
    const unsigned = { ...record };
    delete unsigned.hash;
    if (!/^[a-f0-9]{64}$/i.test(record.hash ?? "") || sha256(unsigned) !== record.hash) {
      fail("INVALID_SCOPING_SESSION_HASH", `建项前调查第 ${expectedRevision} 条修订指纹不一致。`, {
        sessionId,
        revision: expectedRevision,
      });
    }
    applyRecord(snapshot, record);
  }
  return snapshot;
}

export class ResearchScopingSessionStoreV1 {
  constructor({ rootDir, now = () => new Date(), idFactory = () => `scoping-${randomUUID()}` } = {}) {
    if (typeof rootDir !== "string" || rootDir.trim() === "") {
      fail("INVALID_SCOPING_STORE_CONFIGURATION", "建项前调查存储目录不能为空。");
    }
    this.rootDir = resolve(rootDir);
    this.now = now;
    this.idFactory = idFactory;
    this.operationTails = new Map();
  }

  async createFirstPlan(plan) {
    const sessionId = this.idFactory();
    assertSessionId(sessionId);
    return this.#append({
      sessionId,
      expectedRevision: 0,
      eventType: "FIRST_PLAN_GENERATED",
      payload: plan,
    });
  }

  async append({ sessionId, expectedRevision, eventType, payload }) {
    assertSessionId(sessionId);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      fail("INVALID_SCOPING_SESSION_REVISION", "建项前调查修订号必须是正整数。");
    }
    return this.#append({ sessionId, expectedRevision, eventType, payload });
  }

  async load(sessionId) {
    assertSessionId(sessionId);
    return this.#enqueue(sessionId, async () => {
      let source;
      try {
        source = await readFile(this.#filePath(sessionId), "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") {
          fail("SCOPING_SESSION_NOT_FOUND", "建项前调查会话不存在；请从研究问题重新开始。");
        }
        throw error;
      }
      const snapshot = replayRecords(sessionId, parseRecords(source, sessionId));
      return { ...structuredClone(snapshot), identity: identityFor(snapshot) };
    });
  }

  async #append({ sessionId, expectedRevision, eventType, payload }) {
    if (!TRANSITIONS[eventType]) {
      fail("INVALID_SCOPING_SESSION_EVENT", `未知的建项前调查修订类型：${eventType}`);
    }
    return this.#enqueue(sessionId, async () => {
      await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
      return this.#withLock(sessionId, async () => {
        const filePath = this.#filePath(sessionId);
        let source = "";
        try {
          source = await readFile(filePath, "utf8");
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        const records = parseRecords(source, sessionId);
        const snapshot = replayRecords(sessionId, records);
        if (snapshot.revision !== expectedRevision) {
          fail(
            "SCOPING_SESSION_REVISION_MISMATCH",
            `建项前调查已经更新（提交修订 ${expectedRevision}，当前修订 ${snapshot.revision}）；请恢复最新记录后继续。`,
            { sessionId, expectedRevision, currentRevision: snapshot.revision },
          );
        }
        const transition = TRANSITIONS[eventType];
        if (snapshot.stage !== transition.from) {
          fail(
            "SCOPING_SESSION_STAGE_MISMATCH",
            `当前调查处于 ${snapshot.stage ?? "start"}，不能执行 ${eventType}。`,
            { sessionId, currentStage: snapshot.stage, eventType },
          );
        }
        const recordedAtValue = this.now();
        const recordedAt = (recordedAtValue instanceof Date
          ? recordedAtValue
          : new Date(recordedAtValue)).toISOString();
        const unsigned = {
          schemaVersion: SESSION_SCHEMA,
          sessionId,
          revision: snapshot.revision + 1,
          previousHash: snapshot.revisionHash,
          eventType,
          stage: transition.to,
          recordedAt,
          payload: structuredClone(payload),
        };
        const record = { ...unsigned, hash: sha256(unsigned) };
        const handle = await open(filePath, "a", 0o600);
        try {
          await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        applyRecord(snapshot, record);
        return { ...structuredClone(snapshot), identity: identityFor(snapshot) };
      });
    });
  }

  #filePath(sessionId) {
    return join(this.rootDir, `${sha256(sessionId)}.ndjson`);
  }

  #enqueue(sessionId, operation) {
    const previous = this.operationTails.get(sessionId) ?? Promise.resolve();
    const execution = previous.then(operation, operation);
    const tail = execution.then(
      () => undefined,
      () => undefined,
    );
    this.operationTails.set(sessionId, tail);
    void tail.finally(() => {
      if (this.operationTails.get(sessionId) === tail) {
        this.operationTails.delete(sessionId);
      }
    });
    return execution;
  }

  async #withLock(sessionId, operation) {
    const lockPath = `${this.#filePath(sessionId)}.lock`;
    const startedAt = Date.now();
    let lockHandle;
    while (!lockHandle) {
      try {
        lockHandle = await open(lockPath, "wx", 0o600);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        if (await this.#recoverStaleLock(lockPath)) continue;
        if (Date.now() - startedAt >= DEFAULT_LOCK_TIMEOUT_MS) {
          fail("SCOPING_SESSION_BUSY", "建项前调查正在被另一请求更新，请稍后重试。", { sessionId });
        }
        await delay(DEFAULT_LOCK_RETRY_MS);
      }
    }
    try {
      await lockHandle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`);
      await lockHandle.sync();
      return await operation();
    } finally {
      await lockHandle.close();
      await unlinkIfPresent(lockPath);
    }
  }

  async #recoverStaleLock(lockPath) {
    let raw;
    let metadata;
    try {
      [raw, metadata] = await Promise.all([
        readFile(lockPath, "utf8"),
        stat(lockPath),
      ]);
    } catch (error) {
      if (error?.code === "ENOENT") return true;
      throw error;
    }
    let record = null;
    try {
      record = JSON.parse(raw);
    } catch {
      // A recent malformed lock may still be in the short write window. Only
      // age can make it recoverable; otherwise concurrent access fails closed.
    }
    const acquiredAtMs = Date.parse(record?.acquiredAt ?? "");
    const ageMs = Date.now() - (Number.isFinite(acquiredAtMs) ? acquiredAtMs : metadata.mtimeMs);
    let ownerAlive = true;
    if (Number.isInteger(record?.pid) && record.pid > 0) {
      try {
        process.kill(record.pid, 0);
      } catch (error) {
        if (error?.code === "ESRCH") ownerAlive = false;
        else if (error?.code !== "EPERM") throw error;
      }
    }
    if (ownerAlive && ageMs < STALE_LOCK_AGE_MS) return false;

    // Re-read the bytes before unlinking so a changed lock is never removed as
    // though it were the stale record we inspected.
    let current;
    try {
      current = await readFile(lockPath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return true;
      throw error;
    }
    if (current !== raw) return false;
    await unlinkIfPresent(lockPath);
    return true;
  }
}
