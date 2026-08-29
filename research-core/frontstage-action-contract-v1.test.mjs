import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFrontstageActionContract,
  frontstageContractHasPublicTechnicalLanguage,
} from "./frontstage-action-contract-v1.js";

const version = 42;
const materialVersion = "m".repeat(64);

function derive(overrides = {}) {
  return buildFrontstageActionContract({
    project: { id: "research-1", status: "idle", version, researchMode: "guided_materials" },
    ...overrides,
  });
}

function ids(contract) {
  return contract.availableActions.map((action) => action.id);
}

const truthTable = [
  {
    name: "pending gate",
    input: { status: "awaiting_gate", pendingGate: { id: "gate-1", fingerprint: materialVersion, userLabel: "确认研究范围" } },
    primary: "gate.open",
    actions: ["gate.open", "gate.approve", "gate.amend"],
    attention: "required",
  },
  {
    name: "human review",
    input: { status: "awaiting_review", pendingReview: { nodeId: "review-1", materialFingerprint: materialVersion, userLabel: "核对证据摘要", artifacts: [{ artifactId: "a-1" }] } },
    primary: "review.open",
    actions: ["review.open", "review.accept", "review.revise"],
    attention: "required",
  },
  {
    name: "PubMed preflight pause",
    input: { project: { id: "research-1", status: "paused", version, researchMode: "live_pubmed" }, currentBlocker: { id: "pause:clarify_question:1", nodeId: "clarify_question", reason: "PubMed 真实检索未完成：零结果" } },
    primary: "retrieval.preflight.open",
    actions: ["retrieval.preflight.open", "retrieval.preflight.retry"],
    attention: "required",
  },
  {
    name: "protocol revision required",
    input: { status: "blocked", currentBlocker: { id: "b-1", retryClass: "protocol_revision_required" } },
    primary: "retrieval.protocol.open",
    actions: ["retrieval.protocol.open", "retrieval.protocol.revise"],
    attention: "required",
  },
  {
    name: "same protocol retry",
    input: { status: "blocked", currentBlocker: { id: "b-2", retryClass: "same_protocol_retry" } },
    primary: "recovery.open",
    actions: ["recovery.open", "recovery.retry_same_protocol"],
    attention: "required",
  },
  {
    name: "ordinary pause",
    input: { status: "paused", currentBlocker: { id: "pause:node:1" } },
    primary: "project.resume",
    actions: ["project.resume", "project.cancel"],
    attention: "optional",
  },
  {
    name: "running",
    input: { status: "running" },
    primary: null,
    actions: ["project.pause", "project.cancel"],
    attention: "in_progress",
  },
  {
    name: "completed",
    input: { status: "completed" },
    primary: "brief.view",
    actions: ["brief.view"],
    attention: "none",
  },
  {
    name: "cancelled",
    input: { status: "cancelled" },
    primary: "project.restart",
    actions: ["project.restart"],
    attention: "optional",
  },
  {
    name: "idle",
    input: { status: "idle" },
    primary: "project.run",
    actions: ["project.run"],
    attention: "optional",
  },
  {
    name: "unknown blocker",
    input: { status: "blocked", currentBlocker: { id: "b-unknown", reason: "unknown" } },
    primary: "blocker.open",
    actions: ["blocker.open"],
    attention: "required",
  },
];

for (const row of truthTable) {
  test(`frontstage action truth table: ${row.name}`, () => {
    const contract = derive(row.input);
    assert.equal(contract.frontstageAction.schemaVersion, "research-frontstage-action/v1");
    assert.equal(contract.frontstageAction.binding.projectRevision, version);
    assert.equal(contract.frontstageAction.primaryActionId, row.primary);
    assert.equal(contract.frontstageAction.attention, row.attention);
    assert.deepEqual(ids(contract), row.actions);
    assert.equal(frontstageContractHasPublicTechnicalLanguage(contract), false);
    if (row.primary) {
      assert.equal(
        contract.availableActions.some((action) => action.id === row.primary && action.enabled),
        true,
      );
    }
  });
}

test("human-review-required offers both conservative recovery choices", () => {
  const contract = derive({
    status: "blocked",
    currentBlocker: { id: "b-review", retryClass: "human_review_required" },
  });
  assert.equal(contract.frontstageAction.primaryActionId, "recovery.open");
  assert.deepEqual(ids(contract), [
    "recovery.open",
    "recovery.retry_same_protocol",
    "recovery.revise_protocol",
  ]);
});

test("unknown blockers fail closed and never expose a mutation command", () => {
  const contract = derive({ status: "blocked", currentBlocker: { id: "b-unknown" } });
  assert.equal(contract.availableActions.length, 1);
  assert.equal(contract.availableActions[0].interaction, "navigate");
  assert.equal(contract.availableActions[0].command, null);
});

test("missing project revision disables every mutation while keeping inspection available", () => {
  const contract = buildFrontstageActionContract({
    status: "awaiting_gate",
    project: { id: "research-no-version" },
    pendingGate: { id: "gate-1", fingerprint: materialVersion },
  });
  assert.equal(contract.frontstageAction.binding.projectRevision, null);
  assert.equal(contract.availableActions.find((action) => action.id === "gate.open").enabled, true);
  assert.equal(contract.availableActions.find((action) => action.id === "gate.approve").enabled, false);
  assert.equal(contract.availableActions.find((action) => action.id === "gate.amend").enabled, false);
});

test("raw result boundary and authoritative revision can be consumed without server formatting", () => {
  const contract = buildFrontstageActionContract({
    result: {
      project: { id: "research-result" },
      state: { revision: version },
      authoritativeProjectStatus: { status: "awaiting_gate", projectRevision: version },
      projection: {
        boundary: { type: "human_gate", gateId: "gate-from-boundary", nodeId: "approve_scope", fingerprint: materialVersion },
      },
    },
  });
  assert.equal(contract.frontstageAction.primaryActionId, "gate.open");
  assert.equal(contract.availableActions.find((action) => action.id === "gate.approve").binding.gateId, "gate-from-boundary");
});

test("untrusted labels containing internal terminology are not reflected in researcher copy", () => {
  const contract = derive({
    status: "awaiting_gate",
    pendingGate: { id: "gate-1", fingerprint: materialVersion, userLabel: "Agent 状态机 hash" },
  });
  assert.equal(frontstageContractHasPublicTechnicalLanguage(contract), false);
  assert.match(contract.frontstageAction.nextDecision, /当前研究范围/);
});
