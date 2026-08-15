import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  replayEvents,
  sha256,
  verifyEventChain,
} from "../event-engine-v1.js";
import {
  ARTIFACT_FRESHNESS,
  ARTIFACT_STATES,
  EXECUTION_STATES,
  GATE_STATES,
  REVIEW_RESEARCH_MACHINE_V1,
} from "../review-research-machine-v1.js";
import {
  LITERATURE_STAGE_3_EVIDENCE_RECORDS,
  NETWORK_PHARMACOLOGY_MILESTONES_V1,
  NETWORK_PHARMACOLOGY_PROJECT_ID,
  NETWORK_PHARMACOLOGY_REPLAY_V1,
  NETWORK_PHARMACOLOGY_REVISION_DAY,
  NETWORK_PHARMACOLOGY_SOURCE_DAY,
  Q4_FULL_TEXT_CANDIDATE_PMIDS,
  buildNetworkPharmacologyReplayV1,
} from "./network-pharmacology-replay-v1.js";

const machine = REVIEW_RESEARCH_MACHINE_V1;
const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));

test("the 19 source milestones produce a deterministic, hash-chained replay", () => {
  const first = buildNetworkPharmacologyReplayV1();
  const second = buildNetworkPharmacologyReplayV1();

  assert.deepEqual(first.events, second.events);
  assert.equal(
    verifyEventChain(first.events, NETWORK_PHARMACOLOGY_PROJECT_ID),
    true,
  );
  assert.deepEqual(
    replayEvents(machine, NETWORK_PHARMACOLOGY_PROJECT_ID, first.events),
    first.state,
  );
  assert.deepEqual(first, NETWORK_PHARMACOLOGY_REPLAY_V1);

  assert.deepEqual(
    NETWORK_PHARMACOLOGY_MILESTONES_V1.map(
      (item) => item.milestoneSequence,
    ),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
  );
  assert.deepEqual(
    NETWORK_PHARMACOLOGY_MILESTONES_V1.map((item) => item.sourceSequence),
    [
      12,
      13,
      13,
      13,
      15,
      16,
      17,
      18,
      19,
      20,
      23,
      24,
      24,
      28,
      29,
      29,
      30,
      31,
      31,
    ],
  );
  assert.deepEqual(
    NETWORK_PHARMACOLOGY_MILESTONES_V1.map((item) => item.sourceDate),
    [
      ...Array(17).fill(NETWORK_PHARMACOLOGY_SOURCE_DAY),
      NETWORK_PHARMACOLOGY_REVISION_DAY,
      NETWORK_PHARMACOLOGY_REVISION_DAY,
    ],
  );

  let previousSourceSequence = -1;
  for (const event of first.events) {
    assert.match(event.occurredAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(event.occurredAt.includes("T"), false);
    assert.equal(event.sourceContext.occurredOn, event.occurredAt);
    assert.equal(event.sourceContext.occurredAtPrecision, "day");
    assert.equal(Number.isInteger(event.sourceContext.sourceSequence), true);
    assert.equal(event.sourceContext.sourceSequence >= previousSourceSequence, true);
    previousSourceSequence = event.sourceContext.sourceSequence;
  }

  for (const milestoneSequence of NETWORK_PHARMACOLOGY_MILESTONES_V1.map(
    (item) => item.milestoneSequence,
  )) {
    assert.equal(
      first.events.some(
        (event) =>
          event.sourceContext.milestoneSequence === milestoneSequence,
      ),
      true,
    );
  }
});

test("every source hash in the replay still matches its real workspace file", () => {
  const { events, state } = NETWORK_PHARMACOLOGY_REPLAY_V1;
  const refs = [
    ...Object.values(state.artifacts).map((artifact) => artifact.sourceRef),
    ...Object.values(state.gates).map((gate) => gate.sourceRef),
    ...Object.values(state.nodeExecutions).map(
      (execution) => execution.checkpointSource,
    ),
    ...events.map((event) => event.payload?.decisionReceipt?.sourceRef),
  ].filter((ref) => ref?.path && ref?.sha256);
  const hashesByPath = new Map();

  for (const ref of refs) {
    if (hashesByPath.has(ref.path)) {
      assert.equal(hashesByPath.get(ref.path), ref.sha256);
    } else {
      hashesByPath.set(ref.path, ref.sha256);
    }
  }

  for (const [path, expectedHash] of hashesByPath) {
    const actualHash = sha256(
      readFileSync(resolve(workspaceRoot, path), "utf8"),
    );
    assert.equal(actualHash, expectedHash, path);
  }
});

test("accepted legacy human gates retain real, day-precision decision receipts", () => {
  const { events, state } = NETWORK_PHARMACOLOGY_REPLAY_V1;
  const expected = new Map([
    [
      "approve_scope",
      {
        decidedOn: "2026-08-09",
        sourceSequence: 4,
        inputArtifactIds: [
          "NP-HIST-QUESTION-CANDIDATE-001",
          "NP-HIST-SCOPE-BOUNDARY-001",
        ],
        outputArtifactIds: [
          "NP-HIST-RESEARCH-BRIEF-001",
          "NP-HIST-SCOPE-DECISION-001",
        ],
        dependencyNodeId: "clarify_question",
      },
    ],
    [
      "approve_review_angle",
      {
        decidedOn: "2026-08-10",
        sourceSequence: 12,
        inputArtifactIds: [
          "NP-G1-20260810-v8",
          "NP-HIST-REVIEW-ANGLE-CANDIDATE-001",
        ],
        outputArtifactIds: [
          "NP-HIST-REVIEW-ANGLE-DECISION-001",
          "NP-HIST-FOCUSED-BRIEF-001",
        ],
        dependencyNodeId: "profile_landscape",
      },
    ],
  ]);

  for (const [nodeId, source] of expected) {
    const checkpointEvent = events.find(
      (event) =>
        event.type === "LegacyNodeCheckpointImported" &&
        event.payload.nodeId === nodeId,
    );
    const receipt = checkpointEvent?.payload.decisionReceipt;
    assert.equal(receipt.decidedBy.actorId, "human-researcher");
    assert.equal(receipt.decidedBy.actorKind, "human");
    assert.equal(receipt.decidedBy.actorRole, "human_researcher");
    assert.equal(receipt.decidedOn, source.decidedOn);
    assert.equal(receipt.decidedAtPrecision, "day");
    assert.equal(receipt.sourceSequence, source.sourceSequence);
    assert.equal("decidedAt" in receipt, false);
    assert.equal(receipt.sourceRef.sourceSequence, source.sourceSequence);
    assert.match(receipt.reason, /user explicitly/i);
    assert.match(receipt.fingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      [...checkpointEvent.payload.inputArtifactIds].sort(),
      [...source.inputArtifactIds].sort(),
    );
    assert.deepEqual(
      [...checkpointEvent.payload.artifactIds].sort(),
      [...source.outputArtifactIds].sort(),
    );
    assert.deepEqual(
      [...state.nodeExecutions[source.dependencyNodeId].acceptedArtifactIds].sort(),
      [...source.inputArtifactIds].sort(),
    );
    for (const artifactId of source.outputArtifactIds) {
      assert.equal(state.artifacts[artifactId].producedByNodeId, nodeId);
      assert.equal(state.artifacts[artifactId].status, ARTIFACT_STATES.ACCEPTED);
    }
  }
});

test("the current user projection asks the researcher to confirm the argument route", () => {
  const { projection, state } = NETWORK_PHARMACOLOGY_REPLAY_V1;

  assert.deepEqual(projection, {
    phase: "论证结构（第3阶段，共5阶段）",
    activity: "确认论文论证路线",
    status: "需要你确认接下来按什么逻辑写",
    state: EXECUTION_STATES.REVIEW,
    complete: false,
    completionProfile: "得到有证据支撑的论文结构",
    gateStatus: GATE_STATES.PENDING,
    acceptedRiskCount: 0,
    needsUserDecision: true,
    limitation: null,
  });
  assert.equal(state.completionProfileId, "evidence_outline");
  assert.equal(
    state.nodeExecutions.design_focused_search.state,
    EXECUTION_STATES.ACCEPTED,
  );
  assert.equal(
    state.nodeExecutions.calibrate_focused_search.state,
    EXECUTION_STATES.ACCEPTED,
  );
  assert.equal(
    state.nodeExecutions.freeze_library.state,
    EXECUTION_STATES.ACCEPTED,
  );
  assert.equal(state.nodeExecutions.freeze_library.stale, false);
  for (const nodeId of [
    "extract_evidence",
    "seek_counterevidence",
    "synthesize_claims",
    "verify_evidence",
  ]) {
    assert.equal(
      state.nodeExecutions[nodeId].state,
      EXECUTION_STATES.ACCEPTED,
      nodeId,
    );
    assert.equal(state.nodeExecutions[nodeId].stale, false, nodeId);
  }
  assert.equal(
    state.nodeExecutions.approve_evidence_boundary.state,
    EXECUTION_STATES.ACCEPTED,
  );
  assert.equal(
    state.nodeExecutions.derive_outline.state,
    EXECUTION_STATES.ACCEPTED,
  );
  assert.equal(
    state.nodeExecutions.stress_test_outline.state,
    EXECUTION_STATES.ACCEPTED,
  );
  assert.equal(
    state.nodeExecutions.approve_outline.state,
    EXECUTION_STATES.REVIEW,
  );
});

test("old gates retain history while only the revised outline gate is pending", () => {
  const { events, state } = NETWORK_PHARMACOLOGY_REPLAY_V1;
  const oldGate = state.gates["NP-G2-DEC-PENDING-001"];
  const returnedOutlineGate = state.gates["NP-ARGUMENT-OUTLINE-GATE-001"];

  assert.equal(oldGate.status, GATE_STATES.INVALIDATED);
  assert.match(oldGate.invalidationReason, /before focused-search calibration/);
  assert.equal(
    events.some(
      (event) =>
        event.type === "GateInvalidated" &&
        event.aggregateId === "NP-G2-DEC-PENDING-001" &&
        event.sourceContext.sourceSequence === 15,
    ),
    true,
  );
  assert.deepEqual(
    Object.values(state.gates)
      .filter((gate) => gate.status === GATE_STATES.PENDING)
      .map((gate) => gate.id),
    ["NP-ARGUMENT-OUTLINE-GATE-002"],
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "HumanDecisionRecorded" &&
        event.aggregateId === "NP-G2-DEC-PENDING-001",
    ),
    false,
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "HumanDecisionRecorded" &&
        event.aggregateId === "NP-LIT3-EVIDENCE-BOUNDARY-PENDING-001",
    ),
    true,
  );
  assert.equal(
    state.gates["NP-LIT3-EVIDENCE-BOUNDARY-PENDING-001"].status,
    GATE_STATES.APPROVED,
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "HumanDecisionRecorded" &&
        event.aggregateId === "NP-ARGUMENT-OUTLINE-GATE-001",
    ),
    true,
  );
  assert.equal(returnedOutlineGate.status, GATE_STATES.INVALIDATED);
  assert.equal(
    returnedOutlineGate.previousStatus,
    GATE_STATES.AMENDMENT_REQUESTED,
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "HumanDecisionRecorded" &&
        event.aggregateId === "NP-ARGUMENT-OUTLINE-GATE-002",
    ),
    false,
  );
});

test("the frozen stage-three materials keep strict lineage through the approved evidence boundary", () => {
  const { events, state } = NETWORK_PHARMACOLOGY_REPLAY_V1;
  const recordArtifacts = LITERATURE_STAGE_3_EVIDENCE_RECORDS.map((record) =>
    state.artifacts[`NP-LIT3-EVIDENCE-PMID-${record.pmid}`],
  );

  assert.equal(recordArtifacts.length, 13);
  assert.equal(recordArtifacts.every(Boolean), true);
  assert.equal(
    recordArtifacts.every(
      (artifact) =>
        artifact.type === "EvidenceRecord" &&
        artifact.status === ARTIFACT_STATES.ACCEPTED &&
        artifact.producedByNodeId === "extract_evidence" &&
        artifact.humanInclusionDecision === "not_made",
    ),
    true,
  );
  for (const record of LITERATURE_STAGE_3_EVIDENCE_RECORDS) {
    const artifact = state.artifacts[`NP-LIT3-EVIDENCE-PMID-${record.pmid}`];
    assert.equal(artifact.contentHash, record.sha256, record.pmid);
    assert.equal(artifact.sourceRef.sha256, record.sha256, record.pmid);
    assert.equal(artifact.sourceRef.accessLevel, record.accessLevel, record.pmid);
  }

  const outputsByNode = new Map([
    [
      "freeze_library",
      ["NP-LIT3-LIBRARY-MANIFEST-001", "NP-LIT3-SOURCE-SNAPSHOT-001"],
    ],
    [
      "extract_evidence",
      [
        ...recordArtifacts.map((artifact) => artifact.id),
        "NP-LIT3-APPRAISAL-001",
      ],
    ],
    [
      "seek_counterevidence",
      ["NP-LIT3-COUNTEREVIDENCE-001", "NP-LIT3-COVERAGE-GAPS-001"],
    ],
    [
      "synthesize_claims",
      ["NP-LIT3-CLAIM-EVIDENCE-MAP-001", "NP-LIT3-CONCLUSION-CARDS-001"],
    ],
    ["verify_evidence", ["NP-LIT3-EVIDENCE-VERIFICATION-001"]],
  ]);
  for (const [nodeId, expectedIds] of outputsByNode) {
    assert.deepEqual(
      [...state.nodeExecutions[nodeId].acceptedArtifactIds].sort(),
      [...expectedIds].sort(),
      nodeId,
    );
    for (const artifactId of expectedIds) {
      assert.equal(state.artifacts[artifactId].producedByNodeId, nodeId);
      assert.equal(state.artifacts[artifactId].status, ARTIFACT_STATES.ACCEPTED);
    }
  }

  const verification = state.artifacts["NP-LIT3-EVIDENCE-VERIFICATION-001"];
  assert.equal(verification.producedByActorRole, "independent_evidence_verifier");
  assert.equal(verification.acceptedBy.actorKind, "agent");
  assert.equal(
    verification.acceptedBy.actorRole,
    "independent_evidence_reviewer",
  );
  assert.notEqual(
    verification.producedByActorId,
    verification.acceptedBy.actorId,
  );
  assert.equal(verification.humanApprovalEffect, "none");

  const gate = state.gates["NP-LIT3-EVIDENCE-BOUNDARY-PENDING-001"];
  assert.equal(gate.status, GATE_STATES.APPROVED);
  assert.deepEqual(
    gate.artifactRefs.map((ref) => ref.artifactId).sort(),
    [
      "NP-LIT3-CONCLUSION-CARDS-001",
      "NP-LIT3-EVIDENCE-VERIFICATION-001",
    ],
  );
  const directDependencyOutputs = new Set(
    ["synthesize_claims", "verify_evidence"].flatMap(
      (nodeId) => state.nodeExecutions[nodeId].acceptedArtifactIds,
    ),
  );
  assert.equal(
    gate.artifactRefs.every((ref) => directDependencyOutputs.has(ref.artifactId)),
    true,
  );

  for (const event of events.filter(
    (item) => item.sourceContext?.sourceSequence >= 23,
  )) {
    assert.equal(
      event.occurredAt,
      event.sourceContext.sourceSequence === 31
        ? NETWORK_PHARMACOLOGY_REVISION_DAY
        : NETWORK_PHARMACOLOGY_SOURCE_DAY,
    );
    assert.equal(event.sourceContext.occurredAtPrecision, "day");
    assert.equal(
      [23, 24, 28, 29, 30, 31].includes(
        event.sourceContext.sourceSequence,
      ),
      true,
    );
  }
});

test("the evidence boundary approval is a real day-precision human decision from source event 28", () => {
  const { events, state } = NETWORK_PHARMACOLOGY_REPLAY_V1;
  const gateId = "NP-LIT3-EVIDENCE-BOUNDARY-PENDING-001";
  const decisionEvent = events.find(
    (event) =>
      event.type === "HumanDecisionRecorded" &&
      event.aggregateId === gateId,
  );
  const profileChange = events.find(
    (event) => event.type === "CompletionProfileChanged",
  );
  const decisionArtifact =
    state.artifacts["NP-LIT3-EVIDENCE-BOUNDARY-DECISION-001"];

  assert.ok(decisionEvent);
  assert.equal(decisionEvent.actorId, "human-researcher");
  assert.equal(decisionEvent.actorRole, "human_researcher");
  assert.equal(decisionEvent.actorKind, "human");
  assert.equal(decisionEvent.occurredAt, NETWORK_PHARMACOLOGY_SOURCE_DAY);
  assert.equal(decisionEvent.sourceContext.sourceSequence, 28);
  assert.equal(decisionEvent.sourceContext.milestoneSequence, 14);
  assert.equal(decisionEvent.sourceContext.occurredAtPrecision, "day");
  assert.equal(decisionEvent.payload.decision, GATE_STATES.APPROVED);
  assert.deepEqual(decisionEvent.payload.decisionArtifactIds, [
    "NP-LIT3-EVIDENCE-BOUNDARY-DECISION-001",
  ]);
  assert.deepEqual(decisionEvent.payload.decidedBy, {
    actorId: "human-researcher",
    actorRole: "human_researcher",
    actorKind: "human",
  });

  assert.equal(decisionArtifact.type, "EvidenceBoundaryDecision");
  assert.equal(decisionArtifact.status, ARTIFACT_STATES.ACCEPTED);
  assert.equal(
    decisionArtifact.producedByNodeId,
    "approve_evidence_boundary",
  );
  assert.equal(decisionArtifact.acceptedBy.actorKind, "human");
  assert.equal(decisionArtifact.sourceRef.sourceSequence, 28);
  assert.equal(decisionArtifact.sourceRef.locator, "event-28");
  assert.deepEqual([...decisionArtifact.inputArtifactRefs].sort(), [
    "NP-LIT3-CONCLUSION-CARDS-001",
    "NP-LIT3-EVIDENCE-VERIFICATION-001",
  ]);

  assert.ok(profileChange);
  assert.equal(profileChange.actorKind, "human");
  assert.equal(profileChange.sourceContext.sourceSequence, 28);
  assert.equal(profileChange.payload.fromCompletionProfileId, "evidence_brief");
  assert.equal(profileChange.payload.toCompletionProfileId, "evidence_outline");
  assert.equal(profileChange.payload.changedBy.actorId, "human-researcher");
  assert.equal(state.completionProfileId, "evidence_outline");
});

test("the researcher returned outline v1 for amendment without approving manuscript writing", () => {
  const { events, state } = NETWORK_PHARMACOLOGY_REPLAY_V1;
  const outlineV1 = state.artifacts["NP-ARGUMENT-OUTLINE-001"];
  const stressTestV1 =
    state.artifacts["NP-ARGUMENT-OUTLINE-STRESS-TEST-001"];
  const gateV1 = state.gates["NP-ARGUMENT-OUTLINE-GATE-001"];
  const amendmentEvent = events.find(
    (event) =>
      event.type === "HumanDecisionRecorded" &&
      event.aggregateId === "NP-ARGUMENT-OUTLINE-GATE-001",
  );
  const correctionEvent = events.find(
    (event) =>
      event.type === "HumanCorrectionRecorded" &&
      event.aggregateId === "NP-OUTLINE-CORRECTION-EVENT-30",
  );

  assert.equal(
    outlineV1.contentHash,
    "191aa2d9f8affd0939ee276efe0b4b25fd3d79081a872ed4e70c44949022c5fc",
  );
  assert.equal(
    outlineV1.sourceRef.sha256,
    "9fc37977bf80a0b0d7eea8652c21cf54f2d333a39aa0b02dda144e4b76ffa7f8",
  );
  assert.equal(
    stressTestV1.contentHash,
    "30878dae37afa2215d3c52ec24fa37f4503f7cac9237ee2eea836be0a2c3032d",
  );
  assert.equal(
    stressTestV1.sourceRef.sha256,
    "31140f4ead806f52af08e770256bed4013c9ba78ca96bcc7ef2c7d1fef41d431",
  );

  assert.ok(amendmentEvent);
  assert.equal(amendmentEvent.actorId, "human-researcher");
  assert.equal(amendmentEvent.actorRole, "human_researcher");
  assert.equal(amendmentEvent.actorKind, "human");
  assert.equal(amendmentEvent.occurredAt, NETWORK_PHARMACOLOGY_SOURCE_DAY);
  assert.equal(amendmentEvent.sourceContext.sourceSequence, 30);
  assert.equal(amendmentEvent.sourceContext.milestoneSequence, 17);
  assert.equal(
    amendmentEvent.payload.decision,
    GATE_STATES.AMENDMENT_REQUESTED,
  );
  assert.deepEqual(amendmentEvent.payload.decisionArtifactIds, []);

  assert.ok(correctionEvent);
  assert.equal(correctionEvent.actorKind, "human");
  assert.equal(correctionEvent.sourceContext.sourceSequence, 30);
  assert.equal(correctionEvent.sourceContext.milestoneSequence, 17);
  assert.equal(
    correctionEvent.payload.correction.focusNodeId,
    "derive_outline",
  );
  assert.deepEqual(correctionEvent.payload.correction.artifactIds, [
    "NP-ARGUMENT-OUTLINE-001",
    "NP-ARGUMENT-OUTLINE-STRESS-TEST-001",
  ]);
  assert.equal(correctionEvent.payload.correction.sourceGateId, gateV1.id);
  assert.equal(
    correctionEvent.payload.correction.sourceGateFingerprint,
    amendmentEvent.payload.gateFingerprint ?? gateV1.fingerprint,
  );
  assert.equal(
    correctionEvent.payload.correction.amendmentTargetNodeId,
    "derive_outline",
  );

  assert.equal(gateV1.status, GATE_STATES.INVALIDATED);
  assert.equal(gateV1.previousStatus, GATE_STATES.AMENDMENT_REQUESTED);
  assert.equal(outlineV1.status, ARTIFACT_STATES.SUPERSEDED);
  assert.equal(outlineV1.freshness, ARTIFACT_FRESHNESS.STALE);
  assert.equal(outlineV1.supersededBy, "NP-ARGUMENT-OUTLINE-002");
  assert.equal(
    outlineV1.staleByCorrectionId,
    "NP-OUTLINE-CORRECTION-EVENT-30",
  );
  assert.equal(stressTestV1.status, ARTIFACT_STATES.SUPERSEDED);
  assert.equal(stressTestV1.freshness, ARTIFACT_FRESHNESS.STALE);
  assert.equal(
    stressTestV1.supersededBy,
    "NP-ARGUMENT-OUTLINE-STRESS-TEST-002",
  );
  assert.equal(
    stressTestV1.staleByCorrectionId,
    "NP-OUTLINE-CORRECTION-EVENT-30",
  );
  assert.equal(
    Object.values(state.artifacts).some((artifact) =>
      ["OutlineDecision", "FrozenWritingPlan"].includes(artifact.type),
    ),
    false,
  );
});

test("outline v2 and its independent review retain content and source hashes, lineage, reviewer separation, and a new pending human gate", () => {
  const { events, state } = NETWORK_PHARMACOLOGY_REPLAY_V1;
  const outline = state.artifacts["NP-ARGUMENT-OUTLINE-002"];
  const stressTest =
    state.artifacts["NP-ARGUMENT-OUTLINE-STRESS-TEST-002"];
  const expected = new Map([
    [
      outline.id,
      {
        type: "EvidenceDrivenOutline",
        lineageId: "NP-ARGUMENT-OUTLINE",
        contentHash: "ed1906ef4425d7a02e96bd94dd60a4312dc5c6b8a69a1c20e427b805d345c9ac",
        sourceHash: "285c16574b0b48bc7dfafc922535e162bf62d296fd88e378e5e0bd9326d84a0a",
        nodeId: "derive_outline",
        producerRole: "argument_architect",
        reviewerRole: "method_reviewer",
        inputs: [
          "NP-LIT3-CLAIM-EVIDENCE-MAP-001",
          "NP-LIT3-EVIDENCE-BOUNDARY-DECISION-001",
        ],
      },
    ],
    [
      stressTest.id,
      {
        type: "OutlineStressTest",
        lineageId: "NP-ARGUMENT-OUTLINE-STRESS-TEST",
        contentHash: "28d699300cf3f726889750a33054654272b40123a4e80dcf1cfe7a1eb44e1c1d",
        sourceHash: "9b32562c518c525622f05b5737bd7498c1f697b17b9d4d036f8caf53929cd094",
        nodeId: "stress_test_outline",
        producerRole: "outline_verifier",
        reviewerRole: "independent_outline_reviewer",
        inputs: [
          "NP-ARGUMENT-OUTLINE-002",
          "NP-LIT3-CLAIM-EVIDENCE-MAP-001",
        ],
      },
    ],
  ]);

  for (const [artifactId, spec] of expected) {
    const artifact = state.artifacts[artifactId];
    assert.equal(artifact.type, spec.type);
    assert.equal(artifact.lineageId, spec.lineageId);
    assert.equal(artifact.version, 2);
    assert.equal(artifact.contentHash, spec.contentHash);
    assert.equal(artifact.sourceRef.sha256, spec.sourceHash);
    assert.equal(artifact.status, ARTIFACT_STATES.ACCEPTED);
    assert.equal(artifact.freshness, ARTIFACT_FRESHNESS.CURRENT);
    assert.equal(artifact.producedByNodeId, spec.nodeId);
    assert.equal(artifact.producedByActorRole, spec.producerRole);
    assert.equal(artifact.verification.verdict, "pass");
    assert.equal(
      artifact.verification.verifiedBy.actorRole,
      spec.reviewerRole,
    );
    assert.equal(artifact.verification.verifiedBy.actorKind, "agent");
    assert.equal(artifact.acceptedBy.actorId, artifact.verification.verifiedBy.actorId);
    assert.notEqual(
      artifact.producedByActorId,
      artifact.verification.verifiedBy.actorId,
    );
    assert.deepEqual([...artifact.inputArtifactRefs].sort(), [...spec.inputs].sort());
    assert.equal(artifact.sourceRef.sourceSequence, 31);
    assert.equal(artifact.sourceRef.milestoneSequence, 18);
    assert.equal(artifact.sourceRef.occurredOn, NETWORK_PHARMACOLOGY_REVISION_DAY);
    assert.equal(artifact.sourceRef.occurredAtPrecision, "day");
    assert.deepEqual(state.nodeExecutions[spec.nodeId].acceptedArtifactIds, [
      artifactId,
    ]);
    assert.equal(
      events.some(
        (event) =>
          event.type === "ArtifactVerified" &&
          event.aggregateId === artifactId &&
          event.actorId === artifact.producedByActorId,
      ),
      false,
    );
  }
  assert.notEqual(outline.producedByActorId, stressTest.producedByActorId);

  const pendingGates = Object.values(state.gates).filter(
    (gate) => gate.status === GATE_STATES.PENDING,
  );
  assert.deepEqual(
    pendingGates.map((gate) => gate.id),
    ["NP-ARGUMENT-OUTLINE-GATE-002"],
  );
  const outlineGate = pendingGates[0];
  assert.equal(outlineGate.nodeId, "approve_outline");
  assert.deepEqual(
    outlineGate.artifactRefs.map((ref) => ref.artifactId).sort(),
    ["NP-ARGUMENT-OUTLINE-002", "NP-ARGUMENT-OUTLINE-STRESS-TEST-002"],
  );
  const directDependencyIds = machine.edges
    .filter(
      (edge) =>
        edge.type === "hard_dependency" && edge.target === "approve_outline",
    )
    .map((edge) => edge.source);
  const directDependencyOutputs = new Set(
    directDependencyIds.flatMap(
      (nodeId) => state.nodeExecutions[nodeId].acceptedArtifactIds,
    ),
  );
  assert.equal(
    outlineGate.artifactRefs.every((ref) =>
      directDependencyOutputs.has(ref.artifactId),
    ),
    true,
  );
  const gateRequest = events.find(
    (event) =>
      event.type === "GateRequested" &&
      event.aggregateId === "NP-ARGUMENT-OUTLINE-GATE-002",
  );
  assert.equal(gateRequest.occurredAt, NETWORK_PHARMACOLOGY_REVISION_DAY);
  assert.equal(gateRequest.sourceContext.sourceSequence, 31);
  assert.equal(gateRequest.sourceContext.milestoneSequence, 19);
  assert.equal(gateRequest.sourceContext.occurredAtPrecision, "day");
  assert.equal(
    events.some(
      (event) =>
        event.type === "HumanDecisionRecorded" &&
        event.aggregateId === "NP-ARGUMENT-OUTLINE-GATE-002",
    ),
    false,
  );
});

test("the old G2 package is stale or superseded without erasing its review history", () => {
  const { state } = NETWORK_PHARMACOLOGY_REPLAY_V1;

  for (const artifactId of [
    "NP-G2-PROTOCOL-001",
    "NP-G2-OUTLINE-001",
    "NP-G2-CHART-001",
    "NP-G2-20260810-v1",
  ]) {
    assert.equal(
      state.artifacts[artifactId].status,
      ARTIFACT_STATES.CANDIDATE,
    );
    assert.equal(
      state.artifacts[artifactId].freshness,
      ARTIFACT_FRESHNESS.STALE,
    );
    assert.equal(
      state.artifacts[artifactId].staleByCorrectionId,
      "NP-CORRECTION-EVENT-15",
    );
  }

  assert.equal(
    state.artifacts["NP-G2-BRIEF-001"].status,
    ARTIFACT_STATES.SUPERSEDED,
  );
  assert.equal(
    state.artifacts["NP-G2-BRIEF-001"].supersededBy,
    "NP-STAGE2-READER-REPORT-001",
  );
  assert.equal(
    state.artifacts["NP-STAGE2-READER-REPORT-001"].status,
    ARTIFACT_STATES.VERIFIED,
  );

  assert.equal(
    state.artifacts["NP-G2-REVIEW-001"].status,
    ARTIFACT_STATES.VERIFIED,
  );
  assert.equal(
    state.artifacts["NP-G2-REVIEW-001"].humanApprovalEffect,
    "none",
  );
  assert.equal(
    state.artifacts["NP-G2-REVIEW-APPLICABILITY-001"].status,
    ARTIFACT_STATES.VERIFIED,
  );
  assert.equal(
    state.artifacts["NP-G2-REVIEW-APPLICABILITY-001"].freshness,
    ARTIFACT_FRESHNESS.STALE,
  );
});

test("the accepted v7 search facts do not promote the 13 Q4 papers", () => {
  const { state } = NETWORK_PHARMACOLOGY_REPLAY_V1;

  for (const artifactId of [
    "NP-STAGE2-FOCUSED-PROTOCOL-V7",
    "NP-STAGE2-SEARCH-RUN-V7",
    "NP-STAGE2-CALIBRATION-V7",
  ]) {
    assert.equal(state.artifacts[artifactId].status, ARTIFACT_STATES.ACCEPTED);
  }
  assert.match(
    state.artifacts["NP-STAGE2-SEARCH-RUN-V7"].sourceRef.acceptanceMeaning,
    /immutable execution snapshot/,
  );

  const candidates = Q4_FULL_TEXT_CANDIDATE_PMIDS.map(
    (pmid) => state.artifacts[`PMID-${pmid}`],
  );
  assert.equal(candidates.length, 13);
  assert.equal(candidates.every(Boolean), true);
  assert.equal(
    candidates.every(
      (artifact) =>
        artifact.status === ARTIFACT_STATES.CANDIDATE &&
        artifact.freshness === ARTIFACT_FRESHNESS.CURRENT,
    ),
    true,
  );
  assert.equal(
    candidates.every(
      (artifact) =>
        artifact.evidenceUse === "abstract_screening_candidate_with_reported_limits" &&
        artifact.humanInclusionDecision === "not_made",
    ),
    true,
  );
  assert.equal(
    candidates.some(
      (artifact) =>
        artifact.status === ARTIFACT_STATES.ACCEPTED ||
        artifact.status === ARTIFACT_STATES.VERIFIED,
    ),
    false,
  );
});

test("canonical G1 authority and product-policy history remain orthogonal", () => {
  const { state } = NETWORK_PHARMACOLOGY_REPLAY_V1;

  assert.equal(
    state.artifacts["NP-G1-LIB-002"].status,
    ARTIFACT_STATES.ACCEPTED,
  );
  assert.equal(
    state.artifacts["NP-G1-20260810-v8"].status,
    ARTIFACT_STATES.ACCEPTED,
  );
  assert.equal(
    state.artifacts["NP-G1-LIB-001"].status,
    ARTIFACT_STATES.SUPERSEDED,
  );
  assert.equal(
    state.artifacts["NP-G1-20260810-v7"].status,
    ARTIFACT_STATES.SUPERSEDED,
  );

  assert.equal(
    state.artifacts["NP-PRODUCT-DIRECTION-001"].status,
    ARTIFACT_STATES.SUPERSEDED,
  );
  assert.equal(
    state.artifacts["NP-PRODUCT-DIRECTION-002"].status,
    ARTIFACT_STATES.ACCEPTED,
  );
  assert.equal(
    state.artifacts["NP-RESEARCH-POLICY-001"].status,
    ARTIFACT_STATES.ACCEPTED,
  );
  assert.equal(
    state.artifacts["NP-ARCHITECTURE-DECISION-001"].status,
    ARTIFACT_STATES.ACCEPTED,
  );
  assert.equal(
    state.artifacts["REVIEW-RESEARCH-MACHINE-V1"].status,
    ARTIFACT_STATES.VERIFIED,
  );

  assert.equal(
    state.artifacts["NP-G2-20260810-v1"].status ===
      ARTIFACT_STATES.ACCEPTED,
    false,
  );
  assert.equal(
    state.gates["NP-G2-DEC-PENDING-001"].status === GATE_STATES.APPROVED,
    false,
  );
});
