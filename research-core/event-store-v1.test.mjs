import test from "node:test";
import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  ResearchEngineError,
  dispatchCommand,
  replayEvents,
  sha256,
} from "./event-engine-v1.js";
import { EventStoreError, NdjsonEventStore } from "./event-store-v1.js";
import {
  ARTIFACT_STATES,
  EXECUTION_STATES,
  REVIEW_RESEARCH_MACHINE_V1,
} from "./review-research-machine-v1.js";

const machine = REVIEW_RESEARCH_MACHINE_V1;
const human = { id: "human-pi", role: "human_researcher", kind: "human" };
const system = { id: "migration", role: "system_migrator", kind: "system" };

function tempFilePath() {
  return join(tmpdir(), `research-events-${process.pid}-${randomUUID()}.ndjson`);
}

async function unlinkIfPresent(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function cleanupStoreFiles(filePath) {
  await unlinkIfPresent(filePath);
  await unlinkIfPresent(`${filePath}.lock`);
}

function command(projectId, type, expectedVersion, extra = {}) {
  return {
    type,
    commandId:
      extra.commandId ??
      `${type.toLowerCase()}-${expectedVersion}-${extra.nodeId ?? "project"}`,
    projectId,
    expectedVersion,
    occurredAt:
      extra.occurredAt ??
      new Date(Date.UTC(2026, 7, 10, 2, 0, expectedVersion)).toISOString(),
    actor: human,
    ...extra,
  };
}

function projectCreatedEvents(projectId) {
  return dispatchCommand(
    machine,
    [],
    command(projectId, "CREATE_PROJECT", 0, {
      completionProfileId: "evidence_brief",
    }),
  ).newEvents;
}

function readyNodeEvents(projectId, existingEvents, commandId = "ready-capture") {
  return dispatchCommand(
    machine,
    existingEvents,
    command(projectId, "READY_NODE", existingEvents.length, {
      commandId,
      nodeId: "capture_intent",
    }),
  ).newEvents;
}

test("restart loads the same hash chain and replays the same state", async () => {
  const filePath = tempFilePath();
  const projectId = `restart-${randomUUID()}`;
  try {
    const created = projectCreatedEvents(projectId);
    const ready = readyNodeEvents(projectId, created);
    const expectedEvents = [...created, ...ready];

    const firstProcess = new NdjsonEventStore({ filePath, projectId });
    assert.deepEqual(
      await firstProcess.append({ expectedVersion: 0, events: created }),
      {
        previousVersion: 0,
        currentVersion: 1,
        appendedCount: 1,
        lastEventHash: created[0].hash,
      },
    );
    await firstProcess.append({ expectedVersion: 1, events: ready });

    const restartedProcess = new NdjsonEventStore({ filePath, projectId });
    const loadedEvents = await restartedProcess.load();
    assert.deepEqual(loadedEvents, expectedEvents);
    assert.deepEqual(
      await restartedProcess.replay(machine),
      replayEvents(machine, projectId, expectedEvents),
    );
  } finally {
    await cleanupStoreFiles(filePath);
  }
});

test("append enforces expectedVersion without changing the log on conflict", async () => {
  const filePath = tempFilePath();
  const projectId = `conflict-${randomUUID()}`;
  try {
    const created = projectCreatedEvents(projectId);
    const ready = readyNodeEvents(projectId, created);
    const store = new NdjsonEventStore({ filePath, projectId });
    await store.append({ expectedVersion: 0, events: created });

    await assert.rejects(
      store.append({ expectedVersion: 0, events: ready }),
      (error) =>
        error instanceof EventStoreError &&
        error.code === "EXPECTED_VERSION_MISMATCH" &&
        error.details.currentVersion === 1,
    );
    assert.deepEqual(await store.load(), created);
  } finally {
    await cleanupStoreFiles(filePath);
  }
});

test("two store instances serialize a competing append to one winner", async () => {
  const filePath = tempFilePath();
  const projectId = `single-writer-${randomUUID()}`;
  try {
    const created = projectCreatedEvents(projectId);
    const candidateA = readyNodeEvents(projectId, created, "ready-a");
    const candidateB = readyNodeEvents(projectId, created, "ready-b");
    const storeA = new NdjsonEventStore({ filePath, projectId });
    const storeB = new NdjsonEventStore({ filePath, projectId });
    await storeA.append({ expectedVersion: 0, events: created });

    const outcomes = await Promise.allSettled([
      storeA.append({ expectedVersion: 1, events: candidateA }),
      storeB.append({ expectedVersion: 1, events: candidateB }),
    ]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.code, "EXPECTED_VERSION_MISMATCH");
    const persisted = await storeA.load();
    assert.equal(persisted.length, 2);
    assert.ok(
      [candidateA[0].eventId, candidateB[0].eventId].includes(persisted[1].eventId),
    );
  } finally {
    await cleanupStoreFiles(filePath);
  }
});

test("load fails closed when persisted event content breaks the hash chain", async () => {
  const filePath = tempFilePath();
  const projectId = `tamper-${randomUUID()}`;
  try {
    const created = projectCreatedEvents(projectId);
    const store = new NdjsonEventStore({ filePath, projectId });
    await store.append({ expectedVersion: 0, events: created });

    const persisted = JSON.parse((await readFile(filePath, "utf8")).trimEnd());
    persisted.payload.completionProfileId = "audited_review";
    await writeFile(filePath, `${JSON.stringify(persisted)}\n`, "utf8");

    const restarted = new NdjsonEventStore({ filePath, projectId });
    await assert.rejects(
      restarted.load(),
      (error) =>
        error instanceof ResearchEngineError && error.code === "EVENT_HASH_MISMATCH",
    );
  } finally {
    await cleanupStoreFiles(filePath);
  }
});

test("load rejects a partial final NDJSON record", async () => {
  const filePath = tempFilePath();
  const projectId = `partial-${randomUUID()}`;
  try {
    const created = projectCreatedEvents(projectId);
    await writeFile(filePath, JSON.stringify(created[0]), "utf8");

    const store = new NdjsonEventStore({ filePath, projectId });
    await assert.rejects(
      store.load(),
      (error) =>
        error instanceof EventStoreError && error.code === "TRUNCATED_NDJSON",
    );
  } finally {
    await cleanupStoreFiles(filePath);
  }
});

test("a crash after a complete line resumes the unfinished command before replay", async () => {
  const filePath = tempFilePath();
  const projectId = `batch-recovery-${randomUUID()}`;
  try {
    const created = projectCreatedEvents(projectId);
    const sourceRef = "fixture://batch-recovery";
    const imported = dispatchCommand(
      machine,
      created,
      command(projectId, "IMPORT_LEGACY_CHECKPOINT", created.length, {
        actor: system,
        commandId: "import-batch-recovery",
        artifacts: [
          {
            id: "batch-evidence",
            type: "ClaimEvidenceMap",
            lineageId: "batch-evidence",
            version: 1,
            contentHash: sha256("batch-evidence"),
            status: ARTIFACT_STATES.ACCEPTED,
            producedByNodeId: "synthesize_claims",
            inputArtifactRefs: [],
            sourceRef,
          },
        ],
        nodes: [
          {
            nodeId: "synthesize_claims",
            state: EXECUTION_STATES.ACCEPTED,
            artifactIds: ["batch-evidence"],
            sourceRef,
          },
        ],
        gates: [],
      }),
    ).newEvents;
    const baseline = [...created, ...imported];
    const correction = command(
      projectId,
      "RECORD_HUMAN_CORRECTION",
      baseline.length,
      {
        commandId: "recover-correction-batch",
        correctionId: "recover-correction",
        reason: "The imported evidence boundary changed.",
        artifactIds: ["batch-evidence"],
        focusNodeId: "extract_evidence",
      },
    );
    const fullBatch = dispatchCommand(machine, baseline, correction).newEvents;
    assert.equal(fullBatch.length > 1, true);

    const store = new NdjsonEventStore({ filePath, projectId });
    await store.append({ expectedVersion: 0, events: baseline });
    await writeFile(filePath, `${JSON.stringify(fullBatch[0])}\n`, {
      encoding: "utf8",
      flag: "a",
    });

    const interrupted = await store.load();
    assert.equal(interrupted.length, baseline.length + 1);
    await assert.rejects(
      store.replay(machine),
      (error) =>
        error instanceof ResearchEngineError && error.code === "INCOMPLETE_COMMAND",
    );

    const resumed = dispatchCommand(machine, interrupted, correction);
    assert.equal(resumed.resumed, true);
    await store.append({
      expectedVersion: interrupted.length,
      events: resumed.newEvents,
    });
    const recovered = await store.replay(machine);
    assert.equal(recovered.inFlightCommands[correction.commandId], undefined);
    assert.equal(recovered.focusNodeId, "extract_evidence");
  } finally {
    await cleanupStoreFiles(filePath);
  }
});
