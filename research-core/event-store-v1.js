import { open, readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";

import {
  GENESIS_HASH,
  auditEventLog,
  replayEvents,
  verifyEventChain,
} from "./event-engine-v1.js";

const DEFAULT_LOCK_TIMEOUT_MS = 2_000;
const DEFAULT_LOCK_RETRY_MS = 10;

export class EventStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "EventStoreError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new EventStoreError(code, message, details);
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

function validateConstructorOptions(options) {
  if (!options || typeof options !== "object") {
    fail("INVALID_STORE_CONFIGURATION", "Event store options are required.");
  }
  if (typeof options.filePath !== "string" || options.filePath.trim() === "") {
    fail("INVALID_STORE_CONFIGURATION", "filePath must be a non-empty string.");
  }
  if (typeof options.projectId !== "string" || options.projectId.trim() === "") {
    fail("INVALID_STORE_CONFIGURATION", "projectId must be a non-empty string.");
  }
  for (const [name, value, minimum] of [
    ["lockTimeoutMs", options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS, 0],
    ["lockRetryMs", options.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS, 1],
  ]) {
    if (!Number.isInteger(value) || value < minimum) {
      fail(
        "INVALID_STORE_CONFIGURATION",
        `${name} must be an integer greater than or equal to ${minimum}.`,
      );
    }
  }
}

function serializeEventBatch(events) {
  if (!Array.isArray(events)) {
    fail("INVALID_EVENT_BATCH", "events must be an array.");
  }

  return events.map((event, index) => {
    let line;
    try {
      line = JSON.stringify(event);
    } catch (error) {
      throw new EventStoreError(
        "INVALID_EVENT_RECORD",
        `Event at batch index ${index} is not JSON serializable.`,
        { index, cause: error?.message },
      );
    }
    if (line === undefined) {
      fail(
        "INVALID_EVENT_RECORD",
        `Event at batch index ${index} is not a JSON value.`,
        { index },
      );
    }

    const parsed = JSON.parse(line);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail(
        "INVALID_EVENT_RECORD",
        `Event at batch index ${index} must be a JSON object.`,
        { index },
      );
    }
    return { event: parsed, line };
  });
}

/**
 * A project-scoped, append-only NDJSON event store.
 *
 * The adjacent `.lock` file enforces a single reader/writer critical section
 * across store instances and processes. A process-local queue preserves call
 * order for operations issued through the same instance.
 */
export class NdjsonEventStore {
  constructor(options) {
    validateConstructorOptions(options);
    this.filePath = resolve(options.filePath);
    this.projectId = options.projectId;
    this.lockPath = `${this.filePath}.lock`;
    this.lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    this.lockRetryMs = options.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS;
    this.operationTail = Promise.resolve();
  }

  async load() {
    return this.#enqueue(() => this.#withLock(() => this.#loadUnlocked()));
  }

  async append({ expectedVersion, events } = {}) {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      fail(
        "INVALID_EXPECTED_VERSION",
        "expectedVersion must be a non-negative integer.",
        { expectedVersion },
      );
    }

    // Capture the exact JSON representation before this operation can wait in
    // the queue, so caller mutations cannot change bytes after validation.
    const serializedBatch = serializeEventBatch(events);

    return this.#enqueue(() =>
      this.#withLock(async () => {
        const existingEvents = await this.#loadUnlocked();
        const currentVersion = existingEvents.length;
        if (currentVersion !== expectedVersion) {
          fail(
            "EXPECTED_VERSION_MISMATCH",
            `Expected version ${expectedVersion}, current version is ${currentVersion}.`,
            { expectedVersion, currentVersion },
          );
        }

        const appendedEvents = serializedBatch.map((record) => record.event);
        const candidateEvents = [...existingEvents, ...appendedEvents];
        verifyEventChain(candidateEvents, this.projectId, {
          requireCompleteCommand: true,
        });

        if (serializedBatch.length > 0) {
          const payload = `${serializedBatch.map((record) => record.line).join("\n")}\n`;
          const dataHandle = await open(this.filePath, "a", 0o600);
          try {
            await dataHandle.writeFile(payload, "utf8");
            await dataHandle.sync();
          } finally {
            await dataHandle.close();
          }
        }

        return {
          previousVersion: currentVersion,
          currentVersion: candidateEvents.length,
          appendedCount: appendedEvents.length,
          lastEventHash: candidateEvents.at(-1)?.hash ?? GENESIS_HASH,
        };
      }),
    );
  }

  async replay(machine, { allowIncomplete = false } = {}) {
    const events = await this.load();
    verifyEventChain(events, this.projectId, {
      requireCompleteCommand: !allowIncomplete,
    });
    return replayEvents(machine, this.projectId, events);
  }

  async audit(machine, { trustedHeadHash = null } = {}) {
    const events = await this.load();
    return auditEventLog(machine, this.projectId, events, { trustedHeadHash });
  }

  #enqueue(operation) {
    const execution = this.operationTail.then(operation, operation);
    this.operationTail = execution.then(
      () => undefined,
      () => undefined,
    );
    return execution;
  }

  async #loadUnlocked() {
    let source;
    try {
      source = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }

    if (source.length === 0) return [];
    if (!source.endsWith("\n")) {
      fail(
        "TRUNCATED_NDJSON",
        "The event log does not end at an NDJSON record boundary.",
        { filePath: this.filePath },
      );
    }

    const lines = source.slice(0, -1).split("\n");
    const events = lines.map((line, index) => {
      if (line.trim() === "") {
        fail("INVALID_NDJSON", `Blank NDJSON record at line ${index + 1}.`, {
          line: index + 1,
        });
      }
      let event;
      try {
        event = JSON.parse(line);
      } catch (error) {
        throw new EventStoreError(
          "INVALID_NDJSON",
          `Invalid JSON at line ${index + 1}.`,
          { line: index + 1, cause: error?.message },
        );
      }
      if (event === null || typeof event !== "object" || Array.isArray(event)) {
        fail("INVALID_EVENT_RECORD", `NDJSON line ${index + 1} is not an event object.`, {
          line: index + 1,
        });
      }
      return event;
    });

    verifyEventChain(events, this.projectId);
    return events;
  }

  async #withLock(operation) {
    const lockHandle = await this.#acquireLock();
    try {
      return await operation();
    } finally {
      await lockHandle.close();
      await unlinkIfPresent(this.lockPath);
    }
  }

  async #acquireLock() {
    const startedAt = Date.now();
    while (true) {
      let lockHandle;
      try {
        lockHandle = await open(this.lockPath, "wx", 0o600);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const waitedMs = Date.now() - startedAt;
        if (waitedMs >= this.lockTimeoutMs) {
          fail(
            "EVENT_STORE_BUSY",
            `Timed out waiting for the event store writer lock after ${waitedMs}ms.`,
            { lockPath: this.lockPath, waitedMs },
          );
        }
        await delay(this.lockRetryMs);
        continue;
      }

      try {
        await lockHandle.writeFile(
          `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`,
          "utf8",
        );
        await lockHandle.sync();
        return lockHandle;
      } catch (error) {
        await lockHandle.close();
        await unlinkIfPresent(this.lockPath);
        throw error;
      }
    }
  }
}
