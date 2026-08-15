import { createHash } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { canonicalizeJsonContent } from "./content-addressed-artifact-store-v1.js";

export const AGENT_RUN_LOG_SCHEMA_VERSION = "research.agent-run-log/v1";
export const AGENT_RUN_LOG_GENESIS_HASH = "0".repeat(64);
export const MODEL_INVOCATION_RECEIPT_SCHEMA_VERSION =
  "research.model-invocation-receipt/v1";
export const PROJECT_RUNTIME_PROVENANCE_SCHEMA_VERSION =
  "research.project-runtime-provenance/v1";

export const AGENT_RUN_EVENT_TYPES = Object.freeze({
  WORK_ORDER_CREATED: "work_order.created",
  WORK_ORDER_STARTED: "work_order.started",
  WORK_ORDER_COMPLETED: "work_order.completed",
  WORK_ORDER_FAILED: "work_order.failed",
  WORK_ORDER_CANCELLED: "work_order.cancelled",

  RUN_CREATED: "run.created",
  RUN_AWAITING_APPROVAL: "run.awaiting_approval",
  RUN_STARTED: "run.started",
  RUN_PAUSED: "run.paused",
  RUN_RESUMED: "run.resumed",
  RUN_USAGE_UPDATED: "run.usage_updated",
  RUN_COMPLETED: "run.completed",
  RUN_FAILED: "run.failed",
  RUN_CANCELLED: "run.cancelled",

  TOOL_REQUESTED: "tool.requested",
  TOOL_AWAITING_APPROVAL: "tool.awaiting_approval",
  TOOL_APPROVED: "tool.approved",
  TOOL_STARTED: "tool.started",
  TOOL_COMPLETED: "tool.completed",
  TOOL_FAILED: "tool.failed",
  TOOL_DENIED: "tool.denied",
  TOOL_CANCELLED: "tool.cancelled",
});

const EVENT_TYPES = new Set(Object.values(AGENT_RUN_EVENT_TYPES));
const ACTOR_KINDS = new Set(["human", "agent", "system", "tool"]);
const TERMINAL_RUN_STATES = new Set(["completed", "failed", "cancelled"]);
const TERMINAL_TOOL_STATES = new Set([
  "completed",
  "failed",
  "denied",
  "cancelled",
]);
const DEFAULT_LOCK_TIMEOUT_MS = 2_000;
const DEFAULT_LOCK_RETRY_MS = 10;

export class AgentRunLogError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AgentRunLogError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new AgentRunLogError(code, message, details);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function eventHash(eventWithoutHash) {
  return sha256Hex(canonicalizeJsonContent(eventWithoutHash));
}

function normalizedRuntime(runtime = {}) {
  return {
    mode: hasText(runtime?.mode) ? runtime.mode.trim() : "unknown",
    provider: hasText(runtime?.provider) ? runtime.provider.trim() : null,
    modelId: hasText(runtime?.modelId) ? runtime.modelId.trim() : null,
    adapter: hasText(runtime?.adapter) ? runtime.adapter.trim() : null,
    piVersion: hasText(runtime?.piVersion) ? runtime.piVersion.trim() : null,
  };
}

function sanitizedUsage(usage = {}) {
  return Object.fromEntries(
    ["input", "output", "cacheRead", "cacheWrite", "totalTokens", "cost"]
      .filter((key) => Number.isFinite(usage?.[key]) && usage[key] >= 0)
      .map((key) => [key, Number(usage[key])]),
  );
}

function receiptHashInput(receipt) {
  const { receiptHash: _receiptHash, ...body } = receipt;
  return body;
}

function isKnownSimulatedRuntime(runtime) {
  const identity = `${runtime.provider ?? ""}/${runtime.modelId ?? ""}/${runtime.adapter ?? ""}`
    .toLowerCase();
  return ["guided", "faux", "fake", "mock", "simulated", "test-provider"].some(
    (token) => identity.includes(token),
  );
}

function isCompleteLiveRuntime(runtime) {
  return (
    runtime.mode === "live" &&
    [runtime.provider, runtime.modelId, runtime.adapter, runtime.piVersion].every(hasText) &&
    !isKnownSimulatedRuntime(runtime)
  );
}

function hasProvenLiveUsage(usage, stopReason) {
  return (
    Number.isFinite(usage?.totalTokens) &&
    usage.totalTokens > 0 &&
    hasText(stopReason) &&
    !["error", "aborted", "cancelled"].includes(stopReason.trim().toLowerCase())
  );
}

function invocationClassForRuntime(runtime) {
  if (isCompleteLiveRuntime(runtime)) return "live_provider";
  if (runtime.mode === "guided" || isKnownSimulatedRuntime(runtime)) {
    return "guided_faux";
  }
  return "missing_or_unverified_provenance";
}

export function createModelInvocationReceipt({
  projectId,
  workOrderId,
  runId,
  runtime,
  usage = {},
  stopReason = null,
  startedAt,
  completedAt,
} = {}) {
  for (const [key, value] of Object.entries({ projectId, workOrderId, runId })) {
    if (!hasText(value)) fail("INVALID_MODEL_INVOCATION_RECEIPT", `${key} is required.`);
  }
  for (const [key, value] of Object.entries({ startedAt, completedAt })) {
    if (!hasText(value) || Number.isNaN(Date.parse(value))) {
      fail("INVALID_MODEL_INVOCATION_RECEIPT", `${key} must be an ISO timestamp.`);
    }
  }
  const capturedRuntime = normalizedRuntime(runtime);
  const receipt = {
    schemaVersion: MODEL_INVOCATION_RECEIPT_SCHEMA_VERSION,
    projectId,
    workOrderId,
    runId,
    invocationClass: invocationClassForRuntime(capturedRuntime),
    runtime: capturedRuntime,
    usage: sanitizedUsage(usage),
    stopReason: hasText(stopReason) ? stopReason.trim() : null,
    startedAt,
    completedAt,
    verificationBoundary:
      "由受信科研运行时在运行完成时写入并受项目哈希链保护；不包含密钥，也不独立替代供应商账单或请求回执。",
  };
  receipt.receiptHash = sha256Hex(canonicalizeJsonContent(receiptHashInput(receipt)));
  return Object.freeze(receipt);
}

export function validateModelInvocationReceipt(receipt) {
  const issues = [];
  if (!isPlainObject(receipt)) return ["receipt must be an object"];
  if (receipt.schemaVersion !== MODEL_INVOCATION_RECEIPT_SCHEMA_VERSION) {
    issues.push(`schemaVersion must equal ${MODEL_INVOCATION_RECEIPT_SCHEMA_VERSION}`);
  }
  for (const key of ["projectId", "workOrderId", "runId", "invocationClass"]) {
    if (!hasText(receipt[key])) issues.push(`${key} is required`);
  }
  const allowedClasses = new Set([
    "guided_faux",
    "live_provider",
    "missing_or_unverified_provenance",
  ]);
  if (!allowedClasses.has(receipt.invocationClass)) {
    issues.push("invocationClass is not supported");
  }
  if (!isPlainObject(receipt.runtime)) {
    issues.push("runtime must be an object");
  } else {
    const normalized = normalizedRuntime(receipt.runtime);
    if (receipt.runtime.mode !== normalized.mode) issues.push("runtime.mode is invalid");
    for (const key of ["provider", "modelId", "adapter", "piVersion"]) {
      if (receipt.runtime[key] !== normalized[key]) issues.push(`runtime.${key} is invalid`);
    }
    if (receipt.invocationClass !== invocationClassForRuntime(normalized)) {
      issues.push("invocationClass does not match runtime provenance");
    }
  }
  if (!isPlainObject(receipt.usage)) {
    issues.push("usage must be an object");
  } else {
    const allowedUsageKeys = new Set([
      "input",
      "output",
      "cacheRead",
      "cacheWrite",
      "totalTokens",
      "cost",
    ]);
    for (const [key, value] of Object.entries(receipt.usage)) {
      if (!allowedUsageKeys.has(key)) issues.push(`usage.${key} is not allowed`);
      if (!Number.isFinite(value) || value < 0) issues.push(`usage.${key} is invalid`);
    }
  }
  for (const key of ["startedAt", "completedAt"]) {
    if (!hasText(receipt[key]) || Number.isNaN(Date.parse(receipt[key]))) {
      issues.push(`${key} must be an ISO timestamp`);
    }
  }
  if (
    hasText(receipt.startedAt) &&
    hasText(receipt.completedAt) &&
    Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)
  ) {
    issues.push("completedAt cannot precede startedAt");
  }
  if (receipt.stopReason !== null && !hasText(receipt.stopReason)) {
    issues.push("stopReason must be null or non-empty text");
  }
  if (!hasText(receipt.verificationBoundary)) issues.push("verificationBoundary is required");
  if (!/^[a-f0-9]{64}$/.test(receipt.receiptHash ?? "")) {
    issues.push("receiptHash must be a SHA-256 hash");
  } else if (
    receipt.receiptHash !== sha256Hex(canonicalizeJsonContent(receiptHashInput(receipt)))
  ) {
    issues.push("receiptHash does not match receipt content");
  }
  return issues;
}

function provenanceHashInput(provenance) {
  const { provenanceHash: _provenanceHash, ...body } = provenance;
  return body;
}

function provenanceBlocker(code, message, runId = null) {
  return { code, runId, message };
}

export function deriveProjectRuntimeProvenance(agentRunStatus = {}) {
  if (!isPlainObject(agentRunStatus)) {
    fail("INVALID_AGENT_RUN_STATUS", "Agent-run status must be an object.");
  }
  const projectId = hasText(agentRunStatus.projectId)
    ? agentRunStatus.projectId
    : null;
  const runs = isPlainObject(agentRunStatus.runs)
    ? Object.values(agentRunStatus.runs).sort((left, right) =>
        String(left?.id ?? "").localeCompare(String(right?.id ?? "")),
      )
    : [];
  const receipts = [];
  const blockers = [];

  if (runs.length === 0) {
    blockers.push(
      provenanceBlocker(
        "no_authoritative_agent_runs",
        "项目尚无可由 Agent 运行哈希链核验的权威模型运行。",
      ),
    );
  }

  for (const run of runs) {
    const runId = hasText(run?.id) ? run.id : null;
    if (run?.status !== "completed") {
      blockers.push(
        provenanceBlocker(
          "agent_run_not_completed",
          `Agent run ${runId ?? "unknown"} is ${run?.status ?? "unknown"}, not completed.`,
          runId,
        ),
      );
    }
    const receipt = run?.terminalPayload?.modelInvocationReceipt;
    if (!isPlainObject(receipt)) {
      blockers.push(
        provenanceBlocker(
          "model_invocation_receipt_missing",
          `Agent run ${runId ?? "unknown"} has no persisted model invocation receipt.`,
          runId,
        ),
      );
      continue;
    }
    const receiptIssues = validateModelInvocationReceipt(receipt);
    if (receiptIssues.length > 0) {
      blockers.push(
        provenanceBlocker(
          "model_invocation_receipt_invalid",
          `Agent run ${runId ?? "unknown"} receipt is invalid: ${receiptIssues.join("; ")}`,
          runId,
        ),
      );
      continue;
    }
    if (
      receipt.projectId !== projectId ||
      receipt.runId !== runId ||
      receipt.workOrderId !== run?.workOrderId ||
      receipt.startedAt !== run?.startedAt ||
      receipt.completedAt !== run?.finishedAt ||
      canonicalizeJsonContent(receipt.runtime) !==
        canonicalizeJsonContent(normalizedRuntime(run?.terminalPayload?.runtime)) ||
      canonicalizeJsonContent(receipt.usage) !==
        canonicalizeJsonContent(sanitizedUsage(run?.terminalPayload?.usage)) ||
      receipt.stopReason !==
        (hasText(run?.terminalPayload?.stopReason)
          ? run.terminalPayload.stopReason.trim()
          : null)
    ) {
      blockers.push(
        provenanceBlocker(
          "model_invocation_receipt_mismatch",
          `Agent run ${runId ?? "unknown"} receipt does not match its authoritative run record.`,
          runId,
        ),
      );
      continue;
    }
    receipts.push(receipt);
    if (
      receipt.invocationClass !== "live_provider" ||
      !hasProvenLiveUsage(receipt.usage, receipt.stopReason)
    ) {
      blockers.push(
        provenanceBlocker(
          "agent_run_not_live_provider",
          `Agent run ${runId ?? "unknown"} lacks a successful live provider invocation with non-zero token usage.`,
          runId,
        ),
      );
    }
  }

  const completedRunCount = runs.filter((run) => run?.status === "completed").length;
  const liveProviderRunCount = receipts.filter(
    (receipt) =>
      receipt.invocationClass === "live_provider" &&
      hasProvenLiveUsage(receipt.usage, receipt.stopReason),
  ).length;
  const provenance = {
    schemaVersion: PROJECT_RUNTIME_PROVENANCE_SCHEMA_VERSION,
    projectId,
    source: "agent_run_hash_chain",
    sourceVersion: Number.isInteger(agentRunStatus.version)
      ? agentRunStatus.version
      : 0,
    sourceLastEventHash: hasText(agentRunStatus.lastEventHash)
      ? agentRunStatus.lastEventHash
      : AGENT_RUN_LOG_GENESIS_HASH,
    totalRunCount: runs.length,
    completedRunCount,
    liveProviderRunCount,
    receiptCount: receipts.length,
    allRunsLiveProvider:
      runs.length > 0 && liveProviderRunCount === runs.length && blockers.length === 0,
    formalEligible:
      runs.length > 0 && liveProviderRunCount === runs.length && blockers.length === 0,
    modes: [...new Set(receipts.map((receipt) => receipt.runtime.mode))].sort(),
    providers: [...new Set(receipts.map((receipt) => receipt.runtime.provider))].sort(),
    modelIds: [...new Set(receipts.map((receipt) => receipt.runtime.modelId))].sort(),
    receipts,
    blockers,
    boundary:
      "正式内容资格仅由该项目 Agent 运行日志中的全部持久化运行回执推导；guided/faux、未完成、缺失或不匹配的回执均会封闭正式资格，服务器当前全局模型配置不参与推导。",
  };
  provenance.provenanceHash = sha256Hex(
    canonicalizeJsonContent(provenanceHashInput(provenance)),
  );
  return provenance;
}

export function validateProjectRuntimeProvenance(provenance) {
  const issues = [];
  if (!isPlainObject(provenance)) return ["provenance must be an object"];
  if (provenance.schemaVersion !== PROJECT_RUNTIME_PROVENANCE_SCHEMA_VERSION) {
    issues.push(`schemaVersion must equal ${PROJECT_RUNTIME_PROVENANCE_SCHEMA_VERSION}`);
  }
  if (provenance.source !== "agent_run_hash_chain") {
    issues.push("source must equal agent_run_hash_chain");
  }
  if (!hasText(provenance.projectId)) issues.push("projectId is required");
  if (!Array.isArray(provenance.receipts)) issues.push("receipts must be an array");
  if (!Array.isArray(provenance.blockers)) issues.push("blockers must be an array");
  for (const key of ["modes", "providers", "modelIds"]) {
    if (!Array.isArray(provenance[key])) issues.push(`${key} must be an array`);
  }
  for (const key of [
    "sourceVersion",
    "totalRunCount",
    "completedRunCount",
    "liveProviderRunCount",
    "receiptCount",
  ]) {
    if (!Number.isInteger(provenance[key]) || provenance[key] < 0) {
      issues.push(`${key} must be a non-negative integer`);
    }
  }
  if (!/^[a-f0-9]{64}$/.test(provenance.sourceLastEventHash ?? "")) {
    issues.push("sourceLastEventHash must be a SHA-256 hash");
  }
  if (!/^[a-f0-9]{64}$/.test(provenance.provenanceHash ?? "")) {
    issues.push("provenanceHash must be a SHA-256 hash");
  } else if (
    provenance.provenanceHash !==
    sha256Hex(canonicalizeJsonContent(provenanceHashInput(provenance)))
  ) {
    issues.push("provenanceHash does not match provenance content");
  }
  if (Array.isArray(provenance.receipts)) {
    const runIds = new Set();
    for (const receipt of provenance.receipts) {
      issues.push(...validateModelInvocationReceipt(receipt).map((issue) => `receipt: ${issue}`));
      if (receipt?.projectId !== provenance.projectId) {
        issues.push("receipt projectId does not match provenance projectId");
      }
      if (runIds.has(receipt?.runId)) issues.push("receipt runIds must be unique");
      runIds.add(receipt?.runId);
    }
    if (provenance.receiptCount !== provenance.receipts.length) {
      issues.push("receiptCount does not match receipts");
    }
    const expectedLiveCount = provenance.receipts.filter(
      (receipt) =>
        receipt?.invocationClass === "live_provider" &&
        hasProvenLiveUsage(receipt?.usage, receipt?.stopReason),
    ).length;
    if (provenance.liveProviderRunCount !== expectedLiveCount) {
      issues.push("liveProviderRunCount does not match receipts");
    }
    for (const [key, runtimeKey] of [
      ["modes", "mode"],
      ["providers", "provider"],
      ["modelIds", "modelId"],
    ]) {
      const expected = [
        ...new Set(provenance.receipts.map((receipt) => receipt?.runtime?.[runtimeKey])),
      ].sort();
      if (canonicalizeJsonContent(provenance[key]) !== canonicalizeJsonContent(expected)) {
        issues.push(`${key} does not match receipts`);
      }
    }
  }
  if (provenance.completedRunCount > provenance.totalRunCount) {
    issues.push("completedRunCount cannot exceed totalRunCount");
  }
  if (provenance.receiptCount > provenance.totalRunCount) {
    issues.push("receiptCount cannot exceed totalRunCount");
  }
  const shouldBeFormal =
    provenance.totalRunCount > 0 &&
    provenance.completedRunCount === provenance.totalRunCount &&
    provenance.liveProviderRunCount === provenance.totalRunCount &&
    provenance.receiptCount === provenance.totalRunCount &&
    Array.isArray(provenance.blockers) &&
    provenance.blockers.length === 0;
  if (provenance.formalEligible !== shouldBeFormal) {
    issues.push("formalEligible does not match run provenance counts and blockers");
  }
  if (provenance.allRunsLiveProvider !== shouldBeFormal) {
    issues.push("allRunsLiveProvider does not match run provenance counts and blockers");
  }
  if (!hasText(provenance.boundary)) issues.push("boundary is required");
  return issues;
}

export function projectRuntimeProvenanceAllowsFormal(
  provenance,
  { projectId = null } = {},
) {
  return (
    validateProjectRuntimeProvenance(provenance).length === 0 &&
    (!hasText(projectId) || provenance.projectId === projectId) &&
    provenance.formalEligible === true &&
    provenance.allRunsLiveProvider === true
  );
}

function cloneJson(value, label) {
  try {
    return JSON.parse(canonicalizeJsonContent(value));
  } catch (error) {
    throw new AgentRunLogError(
      "INVALID_EVENT_RECORD",
      `${label} must contain only normalized JSON values.`,
      { cause: error?.message },
    );
  }
}

function assertActor(actor) {
  if (!isPlainObject(actor) || !hasText(actor.id) || !hasText(actor.role)) {
    fail("INVALID_EVENT_ACTOR", "Event actor requires non-empty id and role.");
  }
  if (!ACTOR_KINDS.has(actor.kind)) {
    fail(
      "INVALID_EVENT_ACTOR",
      `Event actor kind must be one of: ${[...ACTOR_KINDS].join(", ")}.`,
    );
  }
}

function eventFamily(type) {
  if (type.startsWith("work_order.")) return "work_order";
  if (type.startsWith("run.")) return "run";
  if (type.startsWith("tool.")) return "tool";
  return null;
}

function validateRawEvent(raw, projectId, index) {
  if (!isPlainObject(raw)) {
    fail("INVALID_EVENT_RECORD", `Event at batch index ${index} must be an object.`, {
      index,
    });
  }
  if (!hasText(raw.eventId)) {
    fail("INVALID_EVENT_RECORD", `eventId is required at batch index ${index}.`, {
      index,
    });
  }
  if (!EVENT_TYPES.has(raw.type)) {
    fail("UNKNOWN_EVENT_TYPE", `Unknown agent-run event type: ${raw.type}.`, {
      index,
      type: raw.type,
    });
  }
  if (!hasText(raw.occurredAt) || Number.isNaN(Date.parse(raw.occurredAt))) {
    fail("INVALID_EVENT_TIME", `occurredAt must be an ISO-compatible timestamp.`, {
      index,
    });
  }
  if (raw.projectId !== undefined && raw.projectId !== projectId) {
    fail("PROJECT_ID_MISMATCH", `Event ${raw.eventId} targets another project.`, {
      expectedProjectId: projectId,
      actualProjectId: raw.projectId,
    });
  }
  assertActor(raw.actor);
  if (raw.payload !== undefined && !isPlainObject(raw.payload)) {
    fail("INVALID_EVENT_PAYLOAD", `Event ${raw.eventId} payload must be an object.`);
  }

  const family = eventFamily(raw.type);
  if (family === "work_order" && !hasText(raw.workOrderId)) {
    fail("MISSING_WORK_ORDER_ID", `Event ${raw.eventId} requires workOrderId.`);
  }
  if ((family === "run" || family === "tool") && !hasText(raw.runId)) {
    fail("MISSING_RUN_ID", `Event ${raw.eventId} requires runId.`);
  }
  if (raw.type === AGENT_RUN_EVENT_TYPES.RUN_CREATED && !hasText(raw.workOrderId)) {
    fail("MISSING_WORK_ORDER_ID", `Event ${raw.eventId} requires workOrderId.`);
  }
  if (family === "tool" && !hasText(raw.toolCallId)) {
    fail("MISSING_TOOL_CALL_ID", `Event ${raw.eventId} requires toolCallId.`);
  }
  if (raw.type === AGENT_RUN_EVENT_TYPES.TOOL_REQUESTED) {
    if (!hasText(raw.payload?.toolId) || !hasText(raw.payload?.toolVersion)) {
      fail(
        "INVALID_TOOL_REQUEST",
        `Event ${raw.eventId} requires payload.toolId and payload.toolVersion.`,
      );
    }
  }
}

function materializeEvent(raw, projectId, sequence, previousHash) {
  const body = {
    schemaVersion: AGENT_RUN_LOG_SCHEMA_VERSION,
    eventId: raw.eventId,
    projectId,
    sequence,
    type: raw.type,
    occurredAt: raw.occurredAt,
    actor: raw.actor,
    workOrderId: raw.workOrderId ?? null,
    runId: raw.runId ?? null,
    toolCallId: raw.toolCallId ?? null,
    correlationId: raw.correlationId ?? raw.runId ?? raw.workOrderId ?? raw.eventId,
    causationId: raw.causationId ?? null,
    payload: raw.payload ?? {},
    previousHash,
  };
  return { ...body, hash: eventHash(body) };
}

function validatePersistedEnvelope(event, index) {
  if (!isPlainObject(event)) {
    fail("INVALID_EVENT_RECORD", `Log event at index ${index} must be an object.`);
  }
  if (event.schemaVersion !== AGENT_RUN_LOG_SCHEMA_VERSION) {
    fail(
      "SCHEMA_VERSION_MISMATCH",
      `Event ${event.eventId ?? index} uses unsupported schema ${event.schemaVersion}.`,
    );
  }
  validateRawEvent(event, event.projectId, index);
  if (!Number.isInteger(event.sequence) || event.sequence < 1) {
    fail("INVALID_EVENT_SEQUENCE", `Event ${event.eventId} has an invalid sequence.`);
  }
  for (const field of ["previousHash", "hash"]) {
    if (!/^[a-f0-9]{64}$/.test(event[field] ?? "")) {
      fail("INVALID_EVENT_HASH", `Event ${event.eventId} has invalid ${field}.`);
    }
  }
}

export function verifyAgentRunEventChain(events, projectId = null) {
  if (!Array.isArray(events)) {
    fail("INVALID_EVENT_LOG", "Agent-run event log must be an array.");
  }
  const expectedProjectId = projectId ?? events[0]?.projectId ?? null;
  const eventIds = new Set();
  let previousHash = AGENT_RUN_LOG_GENESIS_HASH;

  events.forEach((event, index) => {
    validatePersistedEnvelope(event, index);
    if (expectedProjectId && event.projectId !== expectedProjectId) {
      fail("PROJECT_ID_MISMATCH", `Event ${event.eventId} targets another project.`, {
        expectedProjectId,
        actualProjectId: event.projectId,
      });
    }
    if (event.sequence !== index + 1) {
      fail(
        "INVALID_EVENT_SEQUENCE",
        `Event ${event.eventId} has sequence ${event.sequence}; expected ${index + 1}.`,
      );
    }
    if (eventIds.has(event.eventId)) {
      fail("DUPLICATE_EVENT_ID", `Duplicate eventId: ${event.eventId}.`);
    }
    eventIds.add(event.eventId);
    if (event.previousHash !== previousHash) {
      fail("EVENT_CHAIN_BROKEN", `Event ${event.eventId} does not follow the prior hash.`);
    }
    const { hash, ...body } = event;
    const actualHash = eventHash(body);
    if (hash !== actualHash) {
      fail("EVENT_HASH_MISMATCH", `Event ${event.eventId} content hash is invalid.`, {
        expectedHash: hash,
        actualHash,
      });
    }
    previousHash = hash;
  });

  return true;
}

function assertTransition(entityType, entityId, currentStatus, allowedStatuses, nextStatus) {
  if (!allowedStatuses.includes(currentStatus)) {
    fail(
      `INVALID_${entityType.toUpperCase()}_TRANSITION`,
      `${entityType} ${entityId} cannot transition from ${currentStatus} to ${nextStatus}.`,
      { entityId, currentStatus, nextStatus },
    );
  }
}

function requireEntity(map, id, entityType) {
  const entity = map.get(id);
  if (!entity) {
    fail(`UNKNOWN_${entityType.toUpperCase()}`, `Unknown ${entityType}: ${id}.`, {
      entityId: id,
    });
  }
  return entity;
}

function requireToolCallForRun(toolCalls, event) {
  const tool = requireEntity(toolCalls, event.toolCallId, "tool_call");
  if (tool.runId !== event.runId) {
    fail(
      "TOOL_RUN_MISMATCH",
      `Tool call ${tool.id} belongs to run ${tool.runId}, not ${event.runId}.`,
      { toolCallId: tool.id, expectedRunId: tool.runId, actualRunId: event.runId },
    );
  }
  return tool;
}

function updateEntity(entity, event, status) {
  entity.status = status;
  entity.updatedAt = event.occurredAt;
  entity.lastSequence = event.sequence;
  entity.lastEventId = event.eventId;
}

function deriveProjectStatus(runs, workOrders) {
  const orderedRuns = [...runs.values()].sort((a, b) => b.lastSequence - a.lastSequence);
  const priority = ["running", "awaiting_approval", "paused", "created"];
  const currentRun =
    priority
      .map((status) => orderedRuns.find((run) => run.status === status))
      .find(Boolean) ?? orderedRuns[0] ?? null;

  if (currentRun) {
    return { status: currentRun.status, currentRunId: currentRun.id };
  }

  const orderedWorkOrders = [...workOrders.values()].sort(
    (a, b) => b.lastSequence - a.lastSequence,
  );
  const currentWorkOrder =
    orderedWorkOrders.find((order) => order.status === "running") ??
    orderedWorkOrders.find((order) => order.status === "queued") ??
    orderedWorkOrders[0] ??
    null;
  return {
    status: currentWorkOrder?.status ?? "idle",
    currentRunId: null,
  };
}

export function deriveCurrentStatus(events, { projectId = null } = {}) {
  verifyAgentRunEventChain(events, projectId);
  const workOrders = new Map();
  const runs = new Map();
  const toolCalls = new Map();

  for (const event of events) {
    switch (event.type) {
      case AGENT_RUN_EVENT_TYPES.WORK_ORDER_CREATED: {
        if (workOrders.has(event.workOrderId)) {
          fail("WORK_ORDER_EXISTS", `Work order already exists: ${event.workOrderId}.`);
        }
        workOrders.set(event.workOrderId, {
          id: event.workOrderId,
          status: "queued",
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt,
          lastSequence: event.sequence,
          lastEventId: event.eventId,
          payload: event.payload,
          runIds: [],
        });
        break;
      }
      case AGENT_RUN_EVENT_TYPES.WORK_ORDER_STARTED: {
        const order = requireEntity(workOrders, event.workOrderId, "work_order");
        assertTransition("work_order", order.id, order.status, ["queued"], "running");
        updateEntity(order, event, "running");
        break;
      }
      case AGENT_RUN_EVENT_TYPES.WORK_ORDER_COMPLETED: {
        const order = requireEntity(workOrders, event.workOrderId, "work_order");
        assertTransition("work_order", order.id, order.status, ["running"], "completed");
        const orderRuns = order.runIds.map((runId) => runs.get(runId));
        if (
          orderRuns.length === 0 ||
          !orderRuns.some((run) => run?.status === "completed") ||
          orderRuns.some((run) => run && !TERMINAL_RUN_STATES.has(run.status))
        ) {
          fail(
            "WORK_ORDER_RUNS_INCOMPLETE",
            `Work order ${order.id} cannot complete before its runs are terminal and one succeeds.`,
          );
        }
        updateEntity(order, event, "completed");
        break;
      }
      case AGENT_RUN_EVENT_TYPES.WORK_ORDER_FAILED:
      case AGENT_RUN_EVENT_TYPES.WORK_ORDER_CANCELLED: {
        const order = requireEntity(workOrders, event.workOrderId, "work_order");
        const nextStatus =
          event.type === AGENT_RUN_EVENT_TYPES.WORK_ORDER_FAILED ? "failed" : "cancelled";
        assertTransition(
          "work_order",
          order.id,
          order.status,
          ["queued", "running"],
          nextStatus,
        );
        updateEntity(order, event, nextStatus);
        order.terminalPayload = event.payload;
        break;
      }

      case AGENT_RUN_EVENT_TYPES.RUN_CREATED: {
        if (runs.has(event.runId)) fail("RUN_EXISTS", `Run already exists: ${event.runId}.`);
        const order = requireEntity(workOrders, event.workOrderId, "work_order");
        if (!new Set(["queued", "running"]).has(order.status)) {
          fail("WORK_ORDER_CLOSED", `Run ${event.runId} targets closed work order ${order.id}.`);
        }
        const run = {
          id: event.runId,
          workOrderId: order.id,
          status: "created",
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt,
          lastSequence: event.sequence,
          lastEventId: event.eventId,
          payload: event.payload,
          usage: {},
          toolCallIds: [],
        };
        runs.set(run.id, run);
        order.runIds.push(run.id);
        break;
      }
      case AGENT_RUN_EVENT_TYPES.RUN_AWAITING_APPROVAL: {
        const run = requireEntity(runs, event.runId, "run");
        assertTransition("run", run.id, run.status, ["created"], "awaiting_approval");
        updateEntity(run, event, "awaiting_approval");
        break;
      }
      case AGENT_RUN_EVENT_TYPES.RUN_STARTED: {
        const run = requireEntity(runs, event.runId, "run");
        assertTransition(
          "run",
          run.id,
          run.status,
          ["created", "awaiting_approval"],
          "running",
        );
        updateEntity(run, event, "running");
        run.startedAt ??= event.occurredAt;
        break;
      }
      case AGENT_RUN_EVENT_TYPES.RUN_PAUSED: {
        const run = requireEntity(runs, event.runId, "run");
        assertTransition("run", run.id, run.status, ["running"], "paused");
        updateEntity(run, event, "paused");
        run.pausedAt = event.occurredAt;
        run.checkpointRef = event.payload.checkpointRef ?? null;
        break;
      }
      case AGENT_RUN_EVENT_TYPES.RUN_RESUMED: {
        const run = requireEntity(runs, event.runId, "run");
        assertTransition("run", run.id, run.status, ["paused"], "running");
        updateEntity(run, event, "running");
        run.resumedAt = event.occurredAt;
        break;
      }
      case AGENT_RUN_EVENT_TYPES.RUN_USAGE_UPDATED: {
        const run = requireEntity(runs, event.runId, "run");
        if (TERMINAL_RUN_STATES.has(run.status)) {
          fail("RUN_CLOSED", `Cannot update usage for terminal run ${run.id}.`);
        }
        run.usage = { ...run.usage, ...event.payload };
        run.updatedAt = event.occurredAt;
        run.lastSequence = event.sequence;
        run.lastEventId = event.eventId;
        break;
      }
      case AGENT_RUN_EVENT_TYPES.RUN_COMPLETED:
      case AGENT_RUN_EVENT_TYPES.RUN_FAILED:
      case AGENT_RUN_EVENT_TYPES.RUN_CANCELLED: {
        const run = requireEntity(runs, event.runId, "run");
        const nextStatus = event.type.slice("run.".length);
        const allowed =
          nextStatus === "completed"
            ? ["running"]
            : ["created", "awaiting_approval", "running", "paused"];
        assertTransition("run", run.id, run.status, allowed, nextStatus);
        if (
          nextStatus === "completed" &&
          run.toolCallIds.some(
            (toolCallId) => !TERMINAL_TOOL_STATES.has(toolCalls.get(toolCallId)?.status),
          )
        ) {
          fail(
            "RUN_TOOLS_INCOMPLETE",
            `Run ${run.id} cannot complete with an active tool call.`,
          );
        }
        updateEntity(run, event, nextStatus);
        run.finishedAt = event.occurredAt;
        run.terminalPayload = event.payload;
        break;
      }

      case AGENT_RUN_EVENT_TYPES.TOOL_REQUESTED: {
        if (toolCalls.has(event.toolCallId)) {
          fail("TOOL_CALL_EXISTS", `Tool call already exists: ${event.toolCallId}.`);
        }
        const run = requireEntity(runs, event.runId, "run");
        if (run.status !== "running") {
          fail("RUN_NOT_RUNNING", `Tool call ${event.toolCallId} requires a running run.`);
        }
        const toolCall = {
          id: event.toolCallId,
          runId: run.id,
          workOrderId: run.workOrderId,
          toolId: event.payload.toolId,
          toolVersion: event.payload.toolVersion,
          status: "requested",
          requestedAt: event.occurredAt,
          updatedAt: event.occurredAt,
          lastSequence: event.sequence,
          lastEventId: event.eventId,
          requestPayload: event.payload,
        };
        toolCalls.set(toolCall.id, toolCall);
        run.toolCallIds.push(toolCall.id);
        break;
      }
      case AGENT_RUN_EVENT_TYPES.TOOL_AWAITING_APPROVAL: {
        const tool = requireToolCallForRun(toolCalls, event);
        assertTransition("tool_call", tool.id, tool.status, ["requested"], "awaiting_approval");
        updateEntity(tool, event, "awaiting_approval");
        break;
      }
      case AGENT_RUN_EVENT_TYPES.TOOL_APPROVED: {
        const tool = requireToolCallForRun(toolCalls, event);
        assertTransition(
          "tool_call",
          tool.id,
          tool.status,
          ["requested", "awaiting_approval"],
          "approved",
        );
        updateEntity(tool, event, "approved");
        tool.approvalPayload = event.payload;
        break;
      }
      case AGENT_RUN_EVENT_TYPES.TOOL_STARTED: {
        const tool = requireToolCallForRun(toolCalls, event);
        assertTransition(
          "tool_call",
          tool.id,
          tool.status,
          ["requested", "approved"],
          "running",
        );
        updateEntity(tool, event, "running");
        tool.startedAt = event.occurredAt;
        break;
      }
      case AGENT_RUN_EVENT_TYPES.TOOL_COMPLETED: {
        const tool = requireToolCallForRun(toolCalls, event);
        assertTransition("tool_call", tool.id, tool.status, ["running"], "completed");
        updateEntity(tool, event, "completed");
        tool.finishedAt = event.occurredAt;
        tool.resultPayload = event.payload;
        break;
      }
      case AGENT_RUN_EVENT_TYPES.TOOL_FAILED:
      case AGENT_RUN_EVENT_TYPES.TOOL_DENIED:
      case AGENT_RUN_EVENT_TYPES.TOOL_CANCELLED: {
        const tool = requireToolCallForRun(toolCalls, event);
        const nextStatus = event.type.slice("tool.".length);
        assertTransition(
          "tool_call",
          tool.id,
          tool.status,
          ["requested", "awaiting_approval", "approved", "running"],
          nextStatus,
        );
        updateEntity(tool, event, nextStatus);
        tool.finishedAt = event.occurredAt;
        tool.resultPayload = event.payload;
        break;
      }
      default:
        fail("UNKNOWN_EVENT_TYPE", `Unknown agent-run event type: ${event.type}.`);
    }
  }

  const projectStatus = deriveProjectStatus(runs, workOrders);
  const runValues = [...runs.values()];
  const toolValues = [...toolCalls.values()];
  return {
    projectId: projectId ?? events[0]?.projectId ?? null,
    version: events.length,
    lastEventHash: events.at(-1)?.hash ?? AGENT_RUN_LOG_GENESIS_HASH,
    status: projectStatus.status,
    currentRunId: projectStatus.currentRunId,
    activeRunIds: runValues
      .filter((run) => !TERMINAL_RUN_STATES.has(run.status))
      .map((run) => run.id),
    activeToolCallIds: toolValues
      .filter((tool) => !TERMINAL_TOOL_STATES.has(tool.status))
      .map((tool) => tool.id),
    workOrders: Object.fromEntries(workOrders),
    runs: Object.fromEntries(runs),
    toolCalls: Object.fromEntries(toolCalls),
  };
}

function validateConstructorOptions(options) {
  if (!options || typeof options !== "object") {
    fail("INVALID_LOG_CONFIGURATION", "Agent-run log options are required.");
  }
  if (!hasText(options.filePath)) {
    fail("INVALID_LOG_CONFIGURATION", "filePath must be a non-empty string.");
  }
  if (!hasText(options.projectId)) {
    fail("INVALID_LOG_CONFIGURATION", "projectId must be a non-empty string.");
  }
  for (const [name, value, minimum] of [
    ["lockTimeoutMs", options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS, 0],
    ["lockRetryMs", options.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS, 1],
  ]) {
    if (!Number.isInteger(value) || value < minimum) {
      fail(
        "INVALID_LOG_CONFIGURATION",
        `${name} must be an integer greater than or equal to ${minimum}.`,
      );
    }
  }
}

async function unlinkIfPresent(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export class AgentRunLog {
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
      );
    }
    if (!Array.isArray(events)) {
      fail("INVALID_EVENT_BATCH", "events must be an array.");
    }
    const capturedEvents = events.map((event, index) => {
      const captured = cloneJson(event, `Event at batch index ${index}`);
      validateRawEvent(captured, this.projectId, index);
      return captured;
    });

    return this.#enqueue(() =>
      this.#withLock(async () => {
        const existingEvents = await this.#loadUnlocked();
        if (existingEvents.length !== expectedVersion) {
          fail(
            "EXPECTED_VERSION_MISMATCH",
            `Expected version ${expectedVersion}, current version is ${existingEvents.length}.`,
            { expectedVersion, currentVersion: existingEvents.length },
          );
        }

        const knownEventIds = new Set(existingEvents.map((event) => event.eventId));
        let previousHash =
          existingEvents.at(-1)?.hash ?? AGENT_RUN_LOG_GENESIS_HASH;
        const appendedEvents = capturedEvents.map((raw, index) => {
          if (knownEventIds.has(raw.eventId)) {
            fail("DUPLICATE_EVENT_ID", `Duplicate eventId: ${raw.eventId}.`);
          }
          knownEventIds.add(raw.eventId);
          const event = materializeEvent(
            raw,
            this.projectId,
            existingEvents.length + index + 1,
            previousHash,
          );
          previousHash = event.hash;
          return event;
        });
        const candidateEvents = [...existingEvents, ...appendedEvents];
        verifyAgentRunEventChain(candidateEvents, this.projectId);
        deriveCurrentStatus(candidateEvents, { projectId: this.projectId });

        if (appendedEvents.length > 0) {
          const payload = `${appendedEvents
            .map((event) => canonicalizeJsonContent(event))
            .join("\n")}\n`;
          const dataHandle = await open(this.filePath, "a", 0o600);
          try {
            await dataHandle.writeFile(payload, "utf8");
            await dataHandle.sync();
          } finally {
            await dataHandle.close();
          }
        }

        return {
          previousVersion: existingEvents.length,
          currentVersion: candidateEvents.length,
          appendedCount: appendedEvents.length,
          lastEventHash:
            candidateEvents.at(-1)?.hash ?? AGENT_RUN_LOG_GENESIS_HASH,
          events: appendedEvents,
        };
      }),
    );
  }

  async deriveCurrentStatus() {
    const events = await this.load();
    return deriveCurrentStatus(events, { projectId: this.projectId });
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
        "Agent-run log does not end at an NDJSON record boundary.",
      );
    }

    const events = source
      .slice(0, -1)
      .split("\n")
      .map((line, index) => {
        if (line.trim() === "") {
          fail("INVALID_NDJSON", `Blank NDJSON record at line ${index + 1}.`);
        }
        try {
          return JSON.parse(line);
        } catch (error) {
          throw new AgentRunLogError(
            "INVALID_NDJSON",
            `Invalid JSON at line ${index + 1}.`,
            { line: index + 1, cause: error?.message },
          );
        }
      });
    verifyAgentRunEventChain(events, this.projectId);
    deriveCurrentStatus(events, { projectId: this.projectId });
    return events;
  }

  async #withLock(operation) {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
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
      let handle;
      try {
        handle = await open(this.lockPath, "wx", 0o600);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const waitedMs = Date.now() - startedAt;
        if (waitedMs >= this.lockTimeoutMs) {
          fail(
            "AGENT_RUN_LOG_BUSY",
            `Timed out waiting for the agent-run log writer lock after ${waitedMs}ms.`,
            { lockPath: this.lockPath, waitedMs },
          );
        }
        await delay(this.lockRetryMs);
        continue;
      }

      try {
        await handle.writeFile(
          `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`,
          "utf8",
        );
        await handle.sync();
        return handle;
      } catch (error) {
        await handle.close();
        await unlinkIfPresent(this.lockPath);
        throw error;
      }
    }
  }
}
