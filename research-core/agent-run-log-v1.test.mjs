import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AGENT_RUN_EVENT_TYPES,
  AGENT_RUN_LOG_GENESIS_HASH,
  AgentRunLog,
  AgentRunLogError,
  createModelInvocationReceipt,
  deriveCurrentStatus,
  deriveProjectRuntimeProvenance,
  projectRuntimeProvenanceAllowsFormal,
  validateModelInvocationReceipt,
  verifyAgentRunEventChain,
} from "./agent-run-log-v1.js";

const actor = {
  id: "research-agent-runtime",
  role: "research_orchestrator",
  kind: "agent",
};

function tempFilePath() {
  return join(tmpdir(), `agent-run-log-${process.pid}-${randomUUID()}.ndjson`);
}

async function unlinkIfPresent(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function cleanupLog(filePath) {
  await unlinkIfPresent(filePath);
  await unlinkIfPresent(`${filePath}.lock`);
}

function eventFactory() {
  let index = 0;
  return (type, extra = {}) => {
    index += 1;
    return {
      eventId: `runtime-event-${String(index).padStart(2, "0")}`,
      type,
      occurredAt: new Date(Date.UTC(2026, 7, 12, 2, 0, index)).toISOString(),
      actor,
      payload: {},
      ...extra,
    };
  };
}

function completedRunEvents() {
  const makeEvent = eventFactory();
  const workOrderId = "work-order-1";
  const runId = "agent-run-1";
  const toolCallId = "tool-call-1";
  return [
    makeEvent(AGENT_RUN_EVENT_TYPES.WORK_ORDER_CREATED, {
      workOrderId,
      payload: {
        nodeId: "clarify_question",
        roleTemplateId: "research_orchestrator",
        objective: "Clarify the bounded research question.",
      },
    }),
    makeEvent(AGENT_RUN_EVENT_TYPES.WORK_ORDER_STARTED, { workOrderId }),
    makeEvent(AGENT_RUN_EVENT_TYPES.RUN_CREATED, {
      workOrderId,
      runId,
      payload: { model: "test-provider/test-model", budget: { maxToolCalls: 3 } },
    }),
    makeEvent(AGENT_RUN_EVENT_TYPES.RUN_AWAITING_APPROVAL, { runId }),
    makeEvent(AGENT_RUN_EVENT_TYPES.RUN_STARTED, { runId }),
    makeEvent(AGENT_RUN_EVENT_TYPES.TOOL_REQUESTED, {
      runId,
      toolCallId,
      payload: {
        toolId: "research.search",
        toolVersion: "1.0.0",
        inputSummaryHash: "a".repeat(64),
      },
    }),
    makeEvent(AGENT_RUN_EVENT_TYPES.TOOL_AWAITING_APPROVAL, {
      runId,
      toolCallId,
      payload: { risk: "R1" },
    }),
    makeEvent(AGENT_RUN_EVENT_TYPES.TOOL_APPROVED, {
      runId,
      toolCallId,
      payload: { approvedBy: "human-researcher" },
    }),
    makeEvent(AGENT_RUN_EVENT_TYPES.TOOL_STARTED, { runId, toolCallId }),
    makeEvent(AGENT_RUN_EVENT_TYPES.TOOL_COMPLETED, {
      runId,
      toolCallId,
      payload: { outputArtifactRefs: ["sha256:example"] },
    }),
    makeEvent(AGENT_RUN_EVENT_TYPES.RUN_USAGE_UPDATED, {
      runId,
      payload: { inputTokens: 120, outputTokens: 48, toolCalls: 1 },
    }),
    makeEvent(AGENT_RUN_EVENT_TYPES.RUN_PAUSED, {
      runId,
      payload: { checkpointRef: "pi-session:checkpoint-1" },
    }),
    makeEvent(AGENT_RUN_EVENT_TYPES.RUN_RESUMED, { runId }),
    makeEvent(AGENT_RUN_EVENT_TYPES.RUN_COMPLETED, {
      runId,
      payload: { outputArtifactRefs: ["sha256:result"] },
    }),
    makeEvent(AGENT_RUN_EVENT_TYPES.WORK_ORDER_COMPLETED, { workOrderId }),
  ];
}

function receiptBackedCompletedRunEvents({ projectId, runtime }) {
  const makeEvent = eventFactory();
  const workOrderId = "receipt-order-1";
  const runId = "receipt-run-1";
  const events = [
    makeEvent(AGENT_RUN_EVENT_TYPES.WORK_ORDER_CREATED, { workOrderId }),
    makeEvent(AGENT_RUN_EVENT_TYPES.WORK_ORDER_STARTED, { workOrderId }),
    makeEvent(AGENT_RUN_EVENT_TYPES.RUN_CREATED, {
      workOrderId,
      runId,
      payload: { runtime },
    }),
    makeEvent(AGENT_RUN_EVENT_TYPES.RUN_STARTED, { runId }),
  ];
  const completed = makeEvent(AGENT_RUN_EVENT_TYPES.RUN_COMPLETED, { runId });
  const usage = {
    input: 120,
    output: 48,
    totalTokens: 168,
    cost: 0.0042,
    secretDiagnostic: "must-not-persist",
  };
  completed.payload = {
    runtime,
    usage,
    stopReason: "stop",
    modelInvocationReceipt: createModelInvocationReceipt({
      projectId,
      workOrderId,
      runId,
      runtime,
      usage,
      stopReason: "stop",
      startedAt: events.at(-1).occurredAt,
      completedAt: completed.occurredAt,
    }),
  };
  events.push(
    completed,
    makeEvent(AGENT_RUN_EVENT_TYPES.WORK_ORDER_COMPLETED, { workOrderId }),
  );
  return events;
}

test("appends, reloads, verifies, and derives work-order/run/tool status", async () => {
  const filePath = tempFilePath();
  const projectId = `agent-project-${randomUUID()}`;
  try {
    const log = new AgentRunLog({ filePath, projectId });
    const rawEvents = completedRunEvents();
    const receipt = await log.append({ expectedVersion: 0, events: rawEvents });

    assert.equal(receipt.appendedCount, rawEvents.length);
    assert.equal(receipt.currentVersion, rawEvents.length);
    assert.equal(receipt.events[0].previousHash, AGENT_RUN_LOG_GENESIS_HASH);
    assert.equal(verifyAgentRunEventChain(receipt.events, projectId), true);

    const restarted = new AgentRunLog({ filePath, projectId });
    const loaded = await restarted.load();
    const status = await restarted.deriveCurrentStatus();
    assert.equal(loaded.length, rawEvents.length);
    assert.equal(status.status, "completed");
    assert.equal(status.currentRunId, "agent-run-1");
    assert.equal(status.workOrders["work-order-1"].status, "completed");
    assert.equal(status.runs["agent-run-1"].status, "completed");
    assert.equal(status.runs["agent-run-1"].checkpointRef, "pi-session:checkpoint-1");
    assert.deepEqual(status.runs["agent-run-1"].usage, {
      inputTokens: 120,
      outputTokens: 48,
      toolCalls: 1,
    });
    assert.equal(status.toolCalls["tool-call-1"].status, "completed");
    assert.deepEqual(status.activeRunIds, []);
    assert.deepEqual(status.activeToolCallIds, []);
  } finally {
    await cleanupLog(filePath);
  }
});

test("optimistic concurrency lets only one competing append win", async () => {
  const filePath = tempFilePath();
  const projectId = `agent-concurrency-${randomUUID()}`;
  const makeEvent = eventFactory();
  try {
    const logA = new AgentRunLog({ filePath, projectId });
    const logB = new AgentRunLog({ filePath, projectId });
    await logA.append({
      expectedVersion: 0,
      events: [
        makeEvent(AGENT_RUN_EVENT_TYPES.WORK_ORDER_CREATED, {
          workOrderId: "competing-order",
        }),
      ],
    });

    const outcomes = await Promise.allSettled([
      logA.append({
        expectedVersion: 1,
        events: [
          makeEvent(AGENT_RUN_EVENT_TYPES.WORK_ORDER_STARTED, {
            eventId: "competing-start-a",
            workOrderId: "competing-order",
          }),
        ],
      }),
      logB.append({
        expectedVersion: 1,
        events: [
          makeEvent(AGENT_RUN_EVENT_TYPES.WORK_ORDER_STARTED, {
            eventId: "competing-start-b",
            workOrderId: "competing-order",
          }),
        ],
      }),
    ]);

    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const rejection = outcomes.find((outcome) => outcome.status === "rejected");
    assert.equal(rejection.reason.code, "EXPECTED_VERSION_MISMATCH");
    assert.equal((await logA.load()).length, 2);
  } finally {
    await cleanupLog(filePath);
  }
});

test("rejects an invalid lifecycle transition without changing the log", async () => {
  const filePath = tempFilePath();
  const projectId = `agent-transition-${randomUUID()}`;
  const makeEvent = eventFactory();
  try {
    const log = new AgentRunLog({ filePath, projectId });
    await log.append({
      expectedVersion: 0,
      events: [
        makeEvent(AGENT_RUN_EVENT_TYPES.WORK_ORDER_CREATED, {
          workOrderId: "order-without-run",
        }),
      ],
    });

    await assert.rejects(
      log.append({
        expectedVersion: 1,
        events: [
          makeEvent(AGENT_RUN_EVENT_TYPES.RUN_STARTED, {
            runId: "missing-run",
          }),
        ],
      }),
      (error) => error instanceof AgentRunLogError && error.code === "UNKNOWN_RUN",
    );
    assert.equal((await log.load()).length, 1);
  } finally {
    await cleanupLog(filePath);
  }
});

test("load detects tampering with a persisted runtime event", async () => {
  const filePath = tempFilePath();
  const projectId = `agent-tamper-${randomUUID()}`;
  const makeEvent = eventFactory();
  try {
    const log = new AgentRunLog({ filePath, projectId });
    await log.append({
      expectedVersion: 0,
      events: [
        makeEvent(AGENT_RUN_EVENT_TYPES.WORK_ORDER_CREATED, {
          workOrderId: "tampered-order",
          payload: { objective: "Original objective" },
        }),
      ],
    });

    const persisted = JSON.parse((await readFile(filePath, "utf8")).trimEnd());
    persisted.payload.objective = "Silently changed objective";
    await writeFile(filePath, `${JSON.stringify(persisted)}\n`, "utf8");

    await assert.rejects(
      log.load(),
      (error) =>
        error instanceof AgentRunLogError && error.code === "EVENT_HASH_MISMATCH",
    );
  } finally {
    await cleanupLog(filePath);
  }
});

test("deriveCurrentStatus fails when a run completes with an active tool call", async () => {
  const filePath = tempFilePath();
  const projectId = `agent-active-tool-${randomUUID()}`;
  const makeEvent = eventFactory();
  try {
    const log = new AgentRunLog({ filePath, projectId });
    const incomplete = [
      makeEvent(AGENT_RUN_EVENT_TYPES.WORK_ORDER_CREATED, { workOrderId: "order-1" }),
      makeEvent(AGENT_RUN_EVENT_TYPES.WORK_ORDER_STARTED, { workOrderId: "order-1" }),
      makeEvent(AGENT_RUN_EVENT_TYPES.RUN_CREATED, {
        workOrderId: "order-1",
        runId: "run-1",
      }),
      makeEvent(AGENT_RUN_EVENT_TYPES.RUN_STARTED, { runId: "run-1" }),
      makeEvent(AGENT_RUN_EVENT_TYPES.TOOL_REQUESTED, {
        runId: "run-1",
        toolCallId: "tool-1",
        payload: { toolId: "research.fetch", toolVersion: "1.0.0" },
      }),
      makeEvent(AGENT_RUN_EVENT_TYPES.RUN_COMPLETED, { runId: "run-1" }),
    ];

    await assert.rejects(
      log.append({ expectedVersion: 0, events: incomplete }),
      (error) =>
        error instanceof AgentRunLogError && error.code === "RUN_TOOLS_INCOMPLETE",
    );
    assert.deepEqual(await log.load(), []);
  } finally {
    await cleanupLog(filePath);
  }
});

test("a tool lifecycle cannot be reassigned to another run", async () => {
  const filePath = tempFilePath();
  const projectId = `agent-tool-run-mismatch-${randomUUID()}`;
  const makeEvent = eventFactory();
  try {
    const log = new AgentRunLog({ filePath, projectId });
    const events = [
      makeEvent(AGENT_RUN_EVENT_TYPES.WORK_ORDER_CREATED, { workOrderId: "order-1" }),
      makeEvent(AGENT_RUN_EVENT_TYPES.WORK_ORDER_STARTED, { workOrderId: "order-1" }),
      makeEvent(AGENT_RUN_EVENT_TYPES.RUN_CREATED, {
        workOrderId: "order-1",
        runId: "run-1",
      }),
      makeEvent(AGENT_RUN_EVENT_TYPES.RUN_STARTED, { runId: "run-1" }),
      makeEvent(AGENT_RUN_EVENT_TYPES.RUN_CREATED, {
        workOrderId: "order-1",
        runId: "run-2",
      }),
      makeEvent(AGENT_RUN_EVENT_TYPES.RUN_STARTED, { runId: "run-2" }),
      makeEvent(AGENT_RUN_EVENT_TYPES.TOOL_REQUESTED, {
        runId: "run-1",
        toolCallId: "tool-1",
        payload: { toolId: "research.fetch", toolVersion: "1.0.0" },
      }),
      makeEvent(AGENT_RUN_EVENT_TYPES.TOOL_STARTED, {
        runId: "run-2",
        toolCallId: "tool-1",
      }),
    ];

    await assert.rejects(
      log.append({ expectedVersion: 0, events }),
      (error) =>
        error instanceof AgentRunLogError && error.code === "TOOL_RUN_MISMATCH",
    );
    assert.deepEqual(await log.load(), []);
  } finally {
    await cleanupLog(filePath);
  }
});

test("standalone derivation accepts an empty project log", () => {
  assert.deepEqual(deriveCurrentStatus([], { projectId: "empty-project" }), {
    projectId: "empty-project",
    version: 0,
    lastEventHash: AGENT_RUN_LOG_GENESIS_HASH,
    status: "idle",
    currentRunId: null,
    activeRunIds: [],
    activeToolCallIds: [],
    workOrders: {},
    runs: {},
    toolCalls: {},
  });
});

test("persists a sanitized live invocation receipt and derives formal runtime provenance", async () => {
  const filePath = tempFilePath();
  const projectId = `agent-live-receipt-${randomUUID()}`;
  const runtime = {
    mode: "live",
    provider: "openai",
    modelId: "gpt-5-mini",
    adapter: "PiRuntimeAdapterV1",
    piVersion: "0.84.1",
  };
  try {
    const log = new AgentRunLog({ filePath, projectId });
    await log.append({
      expectedVersion: 0,
      events: receiptBackedCompletedRunEvents({ projectId, runtime }),
    });
    const status = await log.deriveCurrentStatus();
    const provenance = deriveProjectRuntimeProvenance(status);
    const receipt = provenance.receipts[0];

    assert.deepEqual(validateModelInvocationReceipt(receipt), []);
    assert.deepEqual(receipt.usage, {
      cost: 0.0042,
      input: 120,
      output: 48,
      totalTokens: 168,
    });
    assert.equal(receipt.usage.secretDiagnostic, undefined);
    assert.equal(receipt.stopReason, "stop");
    assert.equal(receipt.invocationClass, "live_provider");
    assert.equal(provenance.formalEligible, true);
    assert.equal(provenance.liveProviderRunCount, 1);
    assert.equal(projectRuntimeProvenanceAllowsFormal(provenance), true);
    assert.equal(
      projectRuntimeProvenanceAllowsFormal(provenance, {
        projectId: "another-project",
      }),
      false,
    );
    assert.match(provenance.provenanceHash, /^[a-f0-9]{64}$/);
  } finally {
    await cleanupLog(filePath);
  }
});

test("guided, incomplete, and historical receipt-less runs fail closed", async () => {
  const projectId = "guided-project";
  const guidedRuntime = {
    mode: "guided",
    provider: "research-workbench-guided",
    modelId: "guided-research-v1",
    adapter: "PiRuntimeAdapterV1",
    piVersion: "0.84.1",
  };
  const events = receiptBackedCompletedRunEvents({
    projectId,
    runtime: guidedRuntime,
  });
  const filePath = tempFilePath();
  try {
    const log = new AgentRunLog({ filePath, projectId });
    await log.append({ expectedVersion: 0, events });
    const provenance = deriveProjectRuntimeProvenance(await log.deriveCurrentStatus());
    assert.equal(provenance.formalEligible, false);
    assert.equal(provenance.receipts[0].invocationClass, "guided_faux");
    assert.ok(
      provenance.blockers.some((blocker) => blocker.code === "agent_run_not_live_provider"),
    );

    const legacyLog = new AgentRunLog({
      filePath: `${filePath}.legacy`,
      projectId: "legacy-project",
    });
    await legacyLog.append({ expectedVersion: 0, events: completedRunEvents() });
    const legacyStatus = await legacyLog.deriveCurrentStatus();
    const legacy = deriveProjectRuntimeProvenance(legacyStatus);
    assert.equal(legacy.formalEligible, false);
    assert.ok(
      legacy.blockers.some(
        (blocker) => blocker.code === "model_invocation_receipt_missing",
      ),
    );

    const incomplete = deriveProjectRuntimeProvenance({
      projectId: "incomplete-project",
      version: 4,
      lastEventHash: "f".repeat(64),
      runs: {
        "active-run": {
          id: "active-run",
          workOrderId: "active-order",
          status: "running",
        },
      },
    });
    assert.equal(incomplete.formalEligible, false);
    assert.ok(
      incomplete.blockers.some(
        (blocker) => blocker.code === "agent_run_not_completed",
      ),
    );
  } finally {
    await cleanupLog(filePath);
    await cleanupLog(`${filePath}.legacy`);
  }
});

test("a nominal live runtime with zero provider usage cannot become formal", async () => {
  const projectId = "zero-token-live-project";
  const runtime = {
    mode: "live",
    provider: "anthropic",
    modelId: "claude-haiku-4-5",
    adapter: "PiRuntimeAdapter",
    piVersion: "0.84.1",
  };
  const events = receiptBackedCompletedRunEvents({ projectId, runtime });
  const completed = events.find((event) => event.type === AGENT_RUN_EVENT_TYPES.RUN_COMPLETED);
  completed.payload.usage = {
    input: 0,
    output: 0,
    totalTokens: 0,
    cost: 0,
  };
  completed.payload.stopReason = "error";
  completed.payload.modelInvocationReceipt = createModelInvocationReceipt({
    projectId,
    workOrderId: completed.payload.modelInvocationReceipt.workOrderId,
    runId: completed.runId,
    runtime,
    usage: completed.payload.usage,
    stopReason: "error",
    startedAt: events.find((event) => event.type === AGENT_RUN_EVENT_TYPES.RUN_STARTED).occurredAt,
    completedAt: completed.occurredAt,
  });
  const filePath = tempFilePath();
  try {
    const log = new AgentRunLog({ filePath, projectId });
    await log.append({ expectedVersion: 0, events });
    const provenance = deriveProjectRuntimeProvenance(await log.deriveCurrentStatus());
    assert.equal(provenance.formalEligible, false);
    assert.equal(provenance.liveProviderRunCount, 0);
    assert.ok(provenance.blockers.some((blocker) => blocker.code === "agent_run_not_live_provider"));
  } finally {
    await cleanupLog(filePath);
  }
});
