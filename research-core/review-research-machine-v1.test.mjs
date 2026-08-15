import test from "node:test";
import assert from "node:assert/strict";

import {
  ARTIFACT_FRESHNESS,
  ARTIFACT_STATES,
  EXECUTION_STATES,
  GATE_STATES,
  LEASE_STATES,
  REVIEW_RESEARCH_MACHINE_V1,
  getUserProgress,
  validateResearchMachine,
} from "./review-research-machine-v1.js";

test("the canonical review research machine is structurally valid", () => {
  assert.deepEqual(validateResearchMachine(REVIEW_RESEARCH_MACHINE_V1), []);
});

test("user-facing phase labels do not expose internal G-stage codes", () => {
  for (const phase of REVIEW_RESEARCH_MACHINE_V1.phases) {
    assert.doesNotMatch(phase.userLabel, /\bG[0-9]+\b/i);
  }
  for (const node of REVIEW_RESEARCH_MACHINE_V1.nodes) {
    assert.doesNotMatch(node.userLabel, /\bG[0-9]+\b/i);
    assert.doesNotMatch(node.userStatus, /\bG[0-9]+\b/i);
  }
});

test("the user projection describes the current research period in plain language", () => {
  const runtime = {
    nodes: Object.fromEntries(
      REVIEW_RESEARCH_MACHINE_V1.nodes.map((node) => [
        node.id,
        { state: EXECUTION_STATES.ACCEPTED },
      ]),
    ),
  };
  runtime.nodes.calibrate_search.state = EXECUTION_STATES.RUNNING;
  runtime.nodes.freeze_library.state = EXECUTION_STATES.DRAFT;

  const projection = getUserProgress(REVIEW_RESEARCH_MACHINE_V1, runtime);

  assert.equal(projection.phase, "文献调研（第2阶段，共5阶段）");
  assert.equal(projection.step, "检查检索是否靠谱");
  assert.equal(projection.needsUserDecision, false);
});

test("the workflow can stop after a verified evidence brief without forcing a paper", () => {
  const profile = REVIEW_RESEARCH_MACHINE_V1.completionProfiles.find(
    (item) => item.id === "evidence_brief",
  );
  assert.equal(profile.terminalNodeId, "approve_evidence_boundary");
});

test("large-scale screening is abstract-first and does not require full text to complete", () => {
  const policy = REVIEW_RESEARCH_MACHINE_V1.screeningPolicy;
  const extractNode = REVIEW_RESEARCH_MACHINE_V1.nodes.find(
    (node) => node.id === "extract_evidence",
  );

  assert.equal(policy.largeScaleDefault, "title_abstract_primary");
  assert.equal(policy.fullTextIsCompletionPrerequisite, false);
  assert.equal(policy.accessLevelMustBeExplicit, true);
  assert.match(extractNode.insufficientEvidenceAction, /继续筛选/);
  assert.match(extractNode.insufficientEvidenceAction, /仅在用户要求或关键主张/);
});

test("every research delivery requires an inline user brief and files cannot replace it", () => {
  const policy = REVIEW_RESEARCH_MACHINE_V1.deliveryPolicy;

  assert.equal(policy.inlineUserBriefRequired, true);
  assert.equal(policy.fileLinksCanReplaceBrief, false);
  assert.deepEqual(policy.requiredBriefFields, [
    "current_research_period",
    "new_conclusions",
    "main_evidence_and_boundaries",
    "next_step_or_user_decision",
  ]);
});

test("independent evidence review is agent-owned while the evidence boundary remains human-owned", () => {
  const verifier = REVIEW_RESEARCH_MACHINE_V1.nodes.find(
    (node) => node.id === "verify_evidence",
  );
  const boundaryGate = REVIEW_RESEARCH_MACHINE_V1.nodes.find(
    (node) => node.id === "approve_evidence_boundary",
  );
  const directDependencies = REVIEW_RESEARCH_MACHINE_V1.edges
    .filter(
      (edge) =>
        edge.type === "hard_dependency" &&
        edge.target === "approve_evidence_boundary",
    )
    .map((edge) => edge.source)
    .sort();

  assert.equal(verifier.executorRole, "independent_evidence_verifier");
  assert.equal(verifier.reviewerRole, "independent_evidence_reviewer");
  assert.notEqual(verifier.executorRole, verifier.reviewerRole);
  assert.equal(boundaryGate.kind, "human_gate");
  assert.deepEqual(boundaryGate.approverRoles, ["human_researcher"]);
  assert.deepEqual(directDependencies, ["synthesize_claims", "verify_evidence"]);
});

test("outline stress testing is independent while the outline decision remains human-owned", () => {
  const verifier = REVIEW_RESEARCH_MACHINE_V1.nodes.find(
    (node) => node.id === "stress_test_outline",
  );
  const outlineGate = REVIEW_RESEARCH_MACHINE_V1.nodes.find(
    (node) => node.id === "approve_outline",
  );
  const verifierDependencies = REVIEW_RESEARCH_MACHINE_V1.edges
    .filter(
      (edge) =>
        edge.type === "hard_dependency" &&
        edge.target === "stress_test_outline",
    )
    .map((edge) => edge.source)
    .sort();
  const gateDependencies = REVIEW_RESEARCH_MACHINE_V1.edges
    .filter(
      (edge) =>
        edge.type === "hard_dependency" && edge.target === "approve_outline",
    )
    .map((edge) => edge.source)
    .sort();

  assert.equal(verifier.executorRole, "outline_verifier");
  assert.equal(verifier.reviewerRole, "independent_outline_reviewer");
  assert.notEqual(verifier.executorRole, verifier.reviewerRole);
  assert.deepEqual(verifierDependencies, ["derive_outline", "synthesize_claims"]);
  assert.equal(outlineGate.kind, "human_gate");
  assert.deepEqual(outlineGate.approverRoles, ["human_researcher"]);
  assert.deepEqual(gateDependencies, ["derive_outline", "stress_test_outline"]);
});

test("critical scientific gates remain human-owned", () => {
  const gates = REVIEW_RESEARCH_MACHINE_V1.nodes.filter(
    (node) => node.kind === "human_gate",
  );
  assert.deepEqual(
    gates.map((node) => node.id),
    [
      "approve_scope",
      "approve_review_angle",
      "approve_evidence_boundary",
      "approve_outline",
      "approve_claim_units",
      "author_signoff",
    ],
  );
  assert.equal(gates.every((node) => Boolean(node.humanAuthority)), true);
});

test("execution, artifact, lease, and human-decision lifecycles stay separate", () => {
  assert.equal(EXECUTION_STATES.ACCEPTED, "accepted");
  assert.equal(ARTIFACT_STATES.STALE, "stale");
  assert.equal(ARTIFACT_FRESHNESS.STALE, "stale");
  assert.equal(LEASE_STATES.CLAIMED, "claimed");
  assert.equal(GATE_STATES.PENDING, "pending");
  assert.equal(GATE_STATES.INVALIDATED, "invalidated");
  assert.equal("PENDING" in EXECUTION_STATES, false);
  assert.equal("STALE" in EXECUTION_STATES, false);
});

test("a changed source snapshot invalidates evidence extraction, not only final citation checks", () => {
  const rule = REVIEW_RESEARCH_MACHINE_V1.stalePropagation.find(
    (item) => item.changed === "SourceSnapshot",
  );
  assert.equal(rule.staleFrom, "extract_evidence");
});

test("the event contract is append-only and replayable", () => {
  assert.equal(REVIEW_RESEARCH_MACHINE_V1.eventPolicy.storage, "append_only");
  assert.equal(REVIEW_RESEARCH_MACHINE_V1.eventPolicy.stateSource, "replayable_events");
  assert.ok(
    REVIEW_RESEARCH_MACHINE_V1.eventPolicy.requiredFields.includes("previousHash"),
  );
});
