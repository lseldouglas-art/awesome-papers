import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ResearchEngineError,
  dispatchCommand,
  sha256,
} from "./event-engine-v1.js";
import { REVIEW_RESEARCH_MACHINE_V1 } from "./review-research-machine-v1.js";
import {
  DEFAULT_EVIDENCE_BRIEF_INPUT,
  runNetworkPharmacologyEvidenceBriefSlice,
} from "../scripts/run-research-evidence-brief-demo.mjs";

const human = {
  id: "human-researcher",
  role: "human_researcher",
  kind: "human",
};

function command(type, events, extra = {}) {
  return {
    type,
    commandId: `typed-${type.toLowerCase()}-${events.length}`,
    projectId: "typed-content-contract-test",
    expectedVersion: events.length,
    occurredAt: new Date(Date.UTC(2026, 7, 11, 2, events.length)).toISOString(),
    actor: human,
    ...extra,
  };
}

function dispatch(machine, events, nextCommand) {
  const result = dispatchCommand(machine, events, nextCommand);
  events.push(...result.newEvents);
  return result;
}

function runningTypedInputNode() {
  const machine = structuredClone(REVIEW_RESEARCH_MACHINE_V1);
  machine.nodes.find((node) => node.id === "capture_intent").outputs = [
    "ResearchConclusionCard@1",
  ];
  const events = [];
  dispatch(
    machine,
    events,
    command("CREATE_PROJECT", events, { completionProfileId: "evidence_brief" }),
  );
  dispatch(machine, events, command("READY_NODE", events, { nodeId: "capture_intent" }));
  dispatch(machine, events, command("START_NODE", events, { nodeId: "capture_intent" }));
  return { machine, events };
}

test("the runnable vertical slice validates real sources and stops at a pending human gate", () => {
  const result = runNetworkPharmacologyEvidenceBriefSlice();

  assert.equal(result.contractValidation, "passed");
  assert.equal(result.input.evidenceRecordCount, 13);
  assert.equal(result.input.verifiedEvidenceRecordSnapshotCount, 13);
  assert.equal(
    result.input.snapshotMeaning,
    "workspace evidence-record files, not original article files",
  );
  assert.deepEqual(result.input.accessCounts, {
    abstract_only: 10,
    full_text_and_supplement: 3,
  });
  assert.equal(result.eventLog.eventCount, 44);
  assert.equal(result.eventLog.hashChainValid, true);
  assert.equal(result.registeredConclusion.status, "accepted");
  assert.equal(
    result.registeredConclusion.contentHash,
    result.registeredConclusion.expectedContentHash,
  );
  assert.equal(result.independentVerification.status, "accepted");
  assert.equal(result.independentVerification.independent, true);
  assert.equal(result.humanGate.status, "pending");
  assert.equal(result.humanGate.decisionRecorded, false);
  assert.equal(result.userProjection.needsUserDecision, true);
});

test("the runnable slice is deterministic for the same evidence package", () => {
  const first = runNetworkPharmacologyEvidenceBriefSlice();
  const second = runNetworkPharmacologyEvidenceBriefSlice();
  assert.deepEqual(first, second);
});

test("an explicit researcher acceptance records a fingerprint-bound decision receipt", () => {
  const pending = runNetworkPharmacologyEvidenceBriefSlice();
  const approved = runNetworkPharmacologyEvidenceBriefSlice({
    humanDecision: {
      decision: "approved",
      reason: "研究者接受当前受限证据边界。",
      gateFingerprint: pending.humanGate.fingerprint,
    },
  });

  assert.equal(approved.humanGate.status, "approved");
  assert.equal(approved.humanGate.decisionRecorded, true);
  assert.equal(approved.eventLog.eventCount, 46);
  assert.equal(approved.eventLog.hashChainValid, true);
  assert.equal(
    approved.humanGate.decisionReceipt.decidedBy.actorId,
    "human-researcher",
  );
  assert.deepEqual(approved.humanGate.decisionReceipt.decisionArtifactIds, [
    "NP-LIT3-EVIDENCE-BOUNDARY-DECISION-DEMO-001",
  ]);
});

test("a researcher amendment request records the gate decision without accepting an output", () => {
  const pending = runNetworkPharmacologyEvidenceBriefSlice();
  const amended = runNetworkPharmacologyEvidenceBriefSlice({
    humanDecision: {
      decision: "amendment_requested",
      reason: "需要进一步限定结论适用范围。",
      gateFingerprint: pending.humanGate.fingerprint,
    },
  });

  assert.equal(amended.humanGate.status, "amendment_requested");
  assert.equal(amended.humanGate.decisionRecorded, true);
  assert.equal(amended.eventLog.eventCount, 52);
  assert.deepEqual(
    amended.humanGate.decisionReceipt.decisionArtifactIds,
    [],
  );
});

test("a changed source snapshot fails before any research event is accepted", () => {
  const bundle = JSON.parse(readFileSync(DEFAULT_EVIDENCE_BRIEF_INPUT, "utf8"));
  bundle.evidenceExcerpts[0].sourceSnapshotHash = "f".repeat(64);
  assert.throws(
    () => runNetworkPharmacologyEvidenceBriefSlice({ bundle }),
    /Source snapshot hash mismatch/,
  );
});

test("PRODUCE_ARTIFACT rejects a typed conclusion card that violates its content contract", () => {
  const { machine, events } = runningTypedInputNode();
  const invalidCard = {
    schemaVersion: "1.0.0",
    id: "invalid-card",
    questionId: "question-1",
    version: 1,
    claim: "A claim without a declared scope must not be accepted.",
    producerId: human.id,
    confidence: "bounded",
    supportingEvidenceIds: ["evidence-1"],
    counterEvidenceIds: [],
    uncertainties: ["Scope is intentionally missing."],
    accessBoundary: "Abstract only.",
    nextQuestion: "What is the valid scope?",
  };

  assert.throws(
    () =>
      dispatchCommand(
        machine,
        events,
        command("PRODUCE_ARTIFACT", events, {
          nodeId: "capture_intent",
          artifact: {
            id: invalidCard.id,
            type: "ResearchConclusionCard",
            lineageId: invalidCard.id,
            version: 1,
            content: invalidCard,
            inputArtifactRefs: [],
          },
        }),
      ),
    (error) =>
      error instanceof ResearchEngineError &&
      error.code === "ARTIFACT_CONTENT_CONTRACT_VIOLATION" &&
      error.details.issues.some((issue) => issue.includes("scope")),
  );
});

test("typed scientific artifacts cannot bypass content validation with only a hash", () => {
  const { machine, events } = runningTypedInputNode();
  assert.throws(
    () =>
      dispatchCommand(
        machine,
        events,
        command("PRODUCE_ARTIFACT", events, {
          nodeId: "capture_intent",
          artifact: {
            id: "hash-only-card",
            type: "ResearchConclusionCard",
            lineageId: "hash-only-card",
            version: 1,
            contentHash: sha256("opaque content"),
            inputArtifactRefs: [],
          },
        }),
      ),
    (error) =>
      error instanceof ResearchEngineError &&
      error.code === "MISSING_VALIDATABLE_ARTIFACT_CONTENT",
  );
});
