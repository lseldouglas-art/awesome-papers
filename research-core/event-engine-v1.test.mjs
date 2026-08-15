import test from "node:test";
import assert from "node:assert/strict";

import {
  GENESIS_HASH,
  ResearchEngineError,
  auditEventLog,
  dispatchCommand,
  dispatchTrustedCommand,
  getRuntimeUserProjection,
  replayEvents,
  sha256,
  verifyEventChain,
} from "./event-engine-v1.js";
import {
  ARTIFACT_FRESHNESS,
  ARTIFACT_STATES,
  EXECUTION_STATES,
  GATE_STATES,
  REVIEW_RESEARCH_MACHINE_V1,
} from "./review-research-machine-v1.js";

const machine = REVIEW_RESEARCH_MACHINE_V1;
const projectId = "engine-test-project";
const human = { id: "human-pi", role: "human_researcher", kind: "human" };
const system = { id: "migration", role: "system_migrator", kind: "system" };

function command(type, expectedVersion, extra = {}) {
  return {
    type,
    commandId: `${type.toLowerCase()}-${expectedVersion}-${extra.nodeId ?? extra.gateId ?? "project"}`,
    projectId,
    expectedVersion,
    occurredAt: new Date(Date.UTC(2026, 7, 10, 1, 0, expectedVersion)).toISOString(),
    actor: extra.actor ?? human,
    ...extra,
  };
}

function dispatch(events, nextCommand) {
  const result = dispatchCommand(machine, events, nextCommand);
  events.push(...result.newEvents);
  return result;
}

function createdEvents() {
  const events = [];
  dispatch(
    events,
    command("CREATE_PROJECT", 0, { completionProfileId: "evidence_brief" }),
  );
  return events;
}

test("events are hash chained and replay to the same state", () => {
  const events = createdEvents();
  dispatch(events, command("READY_NODE", events.length, { nodeId: "capture_intent" }));

  assert.equal(events[0].previousHash, GENESIS_HASH);
  assert.equal(verifyEventChain(events, projectId), true);
  const stateA = replayEvents(machine, projectId, events);
  const stateB = replayEvents(machine, projectId, JSON.parse(JSON.stringify(events)));
  assert.deepEqual(stateA, stateB);
  assert.equal(stateA.nodeExecutions.capture_intent.state, EXECUTION_STATES.READY);
});

test("only the human research owner can explicitly extend the research target", () => {
  const events = createdEvents();
  const agent = {
    id: "research-orchestrator",
    role: "research_orchestrator",
    kind: "agent",
  };

  assert.throws(
    () =>
      dispatchCommand(
        machine,
        events,
        command("CHANGE_COMPLETION_PROFILE", events.length, {
          actor: agent,
          completionProfileId: "evidence_outline",
          reason: "Continue to an evidence-driven outline.",
        }),
      ),
    (error) =>
      error instanceof ResearchEngineError &&
      error.code === "UNAUTHORIZED_PRINCIPAL",
  );

  dispatch(
    events,
    command("CHANGE_COMPLETION_PROFILE", events.length, {
      completionProfileId: "evidence_outline",
      reason: "The researcher explicitly chose to enter the next step.",
    }),
  );

  const state = replayEvents(machine, projectId, events);
  assert.equal(state.completionProfileId, "evidence_outline");
  assert.equal(events.at(-1).type, "CompletionProfileChanged");
  assert.equal(events.at(-1).payload.fromCompletionProfileId, "evidence_brief");
  assert.equal(events.at(-1).payload.toCompletionProfileId, "evidence_outline");
});

test("optimistic concurrency rejects a stale expected version", () => {
  const events = createdEvents();
  assert.throws(
    () =>
      dispatchCommand(
        machine,
        events,
        command("READY_NODE", 0, { nodeId: "capture_intent" }),
      ),
    (error) =>
      error instanceof ResearchEngineError &&
      error.code === "EXPECTED_VERSION_MISMATCH",
  );
});

test("a repeated command id is idempotent even with an old expected version", () => {
  const events = createdEvents();
  const repeated = { ...command("READY_NODE", events.length, { nodeId: "capture_intent" }), commandId: "same-command" };
  const first = dispatchCommand(machine, events, repeated);
  events.push(...first.newEvents);
  const second = dispatchCommand(machine, events, repeated);
  assert.equal(second.duplicate, true);
  assert.deepEqual(second.newEvents, []);
});

test("an idempotency key cannot be reused for a different payload", () => {
  const events = createdEvents();
  const original = {
    ...command("READY_NODE", events.length, { nodeId: "capture_intent" }),
    commandId: "one-logical-command",
  };
  dispatch(events, original);

  assert.throws(
    () =>
      dispatchCommand(machine, events, {
        ...original,
        nodeId: "clarify_question",
      }),
    (error) =>
      error instanceof ResearchEngineError &&
      error.code === "IDEMPOTENCY_KEY_REUSE",
  );
});

test("tampering with an event is detected", () => {
  const events = createdEvents();
  const tampered = structuredClone(events);
  tampered[0].payload.completionProfileId = "audited_review";
  assert.throws(
    () => verifyEventChain(tampered, projectId),
    (error) => error instanceof ResearchEngineError && error.code === "EVENT_HASH_MISMATCH",
  );
});

test("a validly rehashed forbidden gate event is rejected by semantic replay", () => {
  const events = createdEvents();
  const body = {
    eventId: "forged-signoff:01",
    projectId,
    aggregateId: "author_signoff",
    sequence: events.length + 1,
    workflowVersion: machine.version,
    actorId: "agent-forger",
    actorRole: "human_researcher",
    actorKind: "agent",
    occurredAt: "2026-08-10T03:00:00.000Z",
    sourceContext: null,
    commandId: "forged-signoff",
    commandRequestHash: sha256("forged-command"),
    commandEventIndex: 1,
    commandEventCount: 1,
    causationId: null,
    correlationId: "forged-signoff",
    type: "NodeAccepted",
    payload: {
      nodeId: "author_signoff",
      artifactIds: [],
      criteriaProofs: [],
    },
    artifactRefs: [],
    previousHash: events.at(-1).hash,
  };
  const forged = { ...body, hash: sha256(body) };
  const forgedEvents = [...events, forged];
  assert.equal(verifyEventChain(forgedEvents, projectId), true);
  assert.throws(
    () => replayEvents(machine, projectId, forgedEvents),
    (error) =>
      error instanceof ResearchEngineError &&
      error.code === "FORBIDDEN_GATE_EVENT",
  );
});

test("an audit can be pinned to a separately trusted event-log head", () => {
  const events = createdEvents();
  assert.equal(
    auditEventLog(machine, projectId, events, {
      trustedHeadHash: events.at(-1).hash,
    }).valid,
    true,
  );
  assert.throws(
    () =>
      auditEventLog(machine, projectId, events, {
        trustedHeadHash: sha256("a different trusted head"),
      }),
    (error) =>
      error instanceof ResearchEngineError &&
      error.code === "TRUSTED_HEAD_MISMATCH",
  );
});

test("the first research artifact can be produced without an upstream artifact", () => {
  const events = createdEvents();
  dispatch(events, command("READY_NODE", events.length, { nodeId: "capture_intent" }));
  dispatch(events, command("START_NODE", events.length, { nodeId: "capture_intent" }));
  dispatch(
    events,
    command("PRODUCE_ARTIFACT", events.length, {
      nodeId: "capture_intent",
      artifact: {
        id: "intent-1",
        type: "ResearchIntent",
        lineageId: "intent",
        version: 1,
        content: { question: "What can the present evidence support?" },
        inputArtifactRefs: [],
      },
    }),
  );

  const state = replayEvents(machine, projectId, events);
  assert.equal(state.artifacts["intent-1"].status, ARTIFACT_STATES.CANDIDATE);
  assert.match(state.artifacts["intent-1"].manifestHash, /^[a-f0-9]{64}$/);
});

test("an artifact cannot bind normalized content to a different content hash", () => {
  const events = createdEvents();
  dispatch(events, command("READY_NODE", events.length, { nodeId: "capture_intent" }));
  dispatch(events, command("START_NODE", events.length, { nodeId: "capture_intent" }));

  assert.throws(
    () =>
      dispatchCommand(
        machine,
        events,
        command("PRODUCE_ARTIFACT", events.length, {
          nodeId: "capture_intent",
          artifact: {
            id: "intent-wrong-hash",
            type: "ResearchIntent",
            lineageId: "intent-wrong-hash",
            version: 1,
            content: { question: "What can the evidence support?" },
            contentHash: sha256({ question: "different content" }),
            inputArtifactRefs: [],
          },
        }),
      ),
    (error) =>
      error instanceof ResearchEngineError &&
      error.code === "ARTIFACT_CONTENT_HASH_MISMATCH",
  );
});

test("downstream research artifacts cannot omit their declared evidence inputs", () => {
  const events = createdEvents();
  const sourceRef = "fixture://downstream-input";
  dispatch(
    events,
    command("IMPORT_LEGACY_CHECKPOINT", events.length, {
      actor: system,
      artifacts: [],
      nodes: [
        { nodeId: "capture_intent", state: EXECUTION_STATES.ACCEPTED, sourceRef },
        { nodeId: "clarify_question", state: EXECUTION_STATES.READY, sourceRef },
      ],
      gates: [],
    }),
  );
  const questionModeler = {
    id: "question-modeler",
    role: "question_modeler",
    kind: "agent",
  };
  assert.throws(
    () =>
      dispatchCommand(
        machine,
        events,
        command("START_NODE", events.length, {
          actor: questionModeler,
          nodeId: "clarify_question",
        }),
      ),
    (error) =>
      error instanceof ResearchEngineError &&
      error.code === "VALID_LEASE_REQUIRED",
  );
  dispatch(
    events,
    command("CLAIM_WORK", events.length, {
      actor: questionModeler,
      nodeId: "clarify_question",
      leaseId: "question-modeler-lease",
      expiresAt: "2026-08-10T04:00:00.000Z",
    }),
  );
  dispatch(
    events,
    command("START_NODE", events.length, {
      actor: questionModeler,
      nodeId: "clarify_question",
      leaseId: "question-modeler-lease",
    }),
  );

  assert.throws(
    () =>
      dispatchCommand(
        machine,
        events,
        command("PRODUCE_ARTIFACT", events.length, {
          actor: questionModeler,
          nodeId: "clarify_question",
          leaseId: "question-modeler-lease",
          artifact: {
            id: "question-without-intent",
            type: "ResearchQuestionCandidate",
            lineageId: "question-without-intent",
            version: 1,
            content: { question: "unsupported" },
            inputArtifactRefs: [],
          },
        }),
      ),
    (error) =>
      error instanceof ResearchEngineError &&
      error.code === "MISSING_ARTIFACT_REFS",
  );
});

test("an expired running agent lease blocks the node until recovery is confirmed", () => {
  const events = createdEvents();
  const sourceRef = "fixture://lease-expiry";
  dispatch(
    events,
    command("IMPORT_LEGACY_CHECKPOINT", events.length, {
      actor: system,
      artifacts: [],
      nodes: [
        { nodeId: "capture_intent", state: EXECUTION_STATES.ACCEPTED, sourceRef },
        { nodeId: "clarify_question", state: EXECUTION_STATES.READY, sourceRef },
      ],
      gates: [],
    }),
  );
  const agent = { id: "lease-agent", role: "question_modeler", kind: "agent" };
  dispatch(
    events,
    command("CLAIM_WORK", events.length, {
      actor: agent,
      nodeId: "clarify_question",
      leaseId: "lease-that-expires",
      expiresAt: "2026-08-10T02:00:00.000Z",
    }),
  );
  dispatch(
    events,
    command("START_NODE", events.length, {
      actor: agent,
      nodeId: "clarify_question",
      leaseId: "lease-that-expires",
    }),
  );
  assert.throws(
    () =>
      dispatchTrustedCommand(
        machine,
        events,
        command("PRODUCE_ARTIFACT", events.length, {
          actor: agent,
          occurredAt: "2026-08-10T01:00:00.000Z",
          nodeId: "clarify_question",
          leaseId: "lease-that-expires",
          artifact: {
            id: "late-artifact",
            type: "ResearchQuestionCandidate",
            lineageId: "late-artifact",
            version: 1,
            content: { result: "too late" },
            inputArtifactRefs: [],
          },
        }),
        {
          authenticatedActor: agent,
          trustedNow: "2026-08-10T02:00:01.000Z",
        },
      ),
    (error) =>
      error instanceof ResearchEngineError && error.code === "LEASE_EXPIRED",
  );
  dispatch(
    events,
    command("EXPIRE_WORK", events.length, {
      actor: system,
      leaseId: "lease-that-expires",
      occurredAt: "2026-08-10T02:00:01.000Z",
    }),
  );

  const state = replayEvents(machine, projectId, events);
  assert.equal(state.workLeases["lease-that-expires"].status, "expired");
  assert.equal(state.nodeExecutions.clarify_question.state, EXECUTION_STATES.BLOCKED);
  assert.equal(state.nodeExecutions.clarify_question.activeLeaseId, null);
  assert.equal(
    state.nodeExecutions.clarify_question.blockers[
      "lease-expired:lease-that-expires"
    ].status,
    "open",
  );
});

test("adding a blocker atomically releases active work so the node can be reclaimed", () => {
  const events = createdEvents();
  const sourceRef = "fixture://blocker-release";
  dispatch(
    events,
    command("IMPORT_LEGACY_CHECKPOINT", events.length, {
      actor: system,
      artifacts: [],
      nodes: [
        { nodeId: "capture_intent", state: EXECUTION_STATES.ACCEPTED, sourceRef },
        { nodeId: "clarify_question", state: EXECUTION_STATES.READY, sourceRef },
      ],
      gates: [],
    }),
  );
  const agent = { id: "blocking-agent", role: "question_modeler", kind: "agent" };
  dispatch(
    events,
    command("CLAIM_WORK", events.length, {
      actor: agent,
      nodeId: "clarify_question",
      leaseId: "blocker-lease-1",
      expiresAt: "2026-08-10T05:00:00.000Z",
    }),
  );
  dispatch(
    events,
    command("START_NODE", events.length, {
      actor: agent,
      nodeId: "clarify_question",
      leaseId: "blocker-lease-1",
    }),
  );

  const blocked = dispatch(
    events,
    command("ADD_BLOCKER", events.length, {
      actor: agent,
      nodeId: "clarify_question",
      blocker: {
        id: "needs-input",
        reason: "A user answer is required before continuing.",
        owner: human.id,
        resolveWhen: "The missing scope answer is recorded.",
      },
    }),
  );
  assert.deepEqual(
    blocked.newEvents.map((event) => event.type),
    ["WorkLeaseReleased", "BlockerAdded"],
  );

  let state = replayEvents(machine, projectId, events);
  assert.equal(state.workLeases["blocker-lease-1"].status, "released");
  assert.equal(state.nodeExecutions.clarify_question.activeLeaseId, null);
  assert.equal(state.nodeExecutions.clarify_question.state, EXECUTION_STATES.BLOCKED);
  assert.equal(
    state.nodeExecutions.clarify_question.blockers["needs-input"].addedAt,
    blocked.newEvents.at(-1).occurredAt,
  );

  dispatch(
    events,
    command("RESOLVE_BLOCKER", events.length, {
      nodeId: "clarify_question",
      blockerId: "needs-input",
      resolution: "The researcher supplied the missing scope answer.",
    }),
  );
  dispatch(
    events,
    command("READY_NODE", events.length, { nodeId: "clarify_question" }),
  );
  dispatch(
    events,
    command("CLAIM_WORK", events.length, {
      actor: agent,
      nodeId: "clarify_question",
      leaseId: "blocker-lease-2",
      expiresAt: "2026-08-10T06:00:00.000Z",
    }),
  );

  state = replayEvents(machine, projectId, events);
  assert.equal(
    state.nodeExecutions.clarify_question.activeLeaseId,
    "blocker-lease-2",
  );
  assert.equal(state.workLeases["blocker-lease-2"].status, "claimed");
});

test("an active lease owner can atomically cancel work and the user projection shows it", () => {
  const events = createdEvents();
  const sourceRef = "fixture://lease-owner-cancellation";
  dispatch(
    events,
    command("IMPORT_LEGACY_CHECKPOINT", events.length, {
      actor: system,
      artifacts: [],
      nodes: [
        { nodeId: "capture_intent", state: EXECUTION_STATES.ACCEPTED, sourceRef },
        { nodeId: "clarify_question", state: EXECUTION_STATES.READY, sourceRef },
      ],
      gates: [],
    }),
  );
  const agent = { id: "cancelling-agent", role: "question_modeler", kind: "agent" };
  dispatch(
    events,
    command("CLAIM_WORK", events.length, {
      actor: agent,
      nodeId: "clarify_question",
      leaseId: "cancel-lease",
      expiresAt: "2026-08-10T05:00:00.000Z",
    }),
  );
  dispatch(
    events,
    command("START_NODE", events.length, {
      actor: agent,
      nodeId: "clarify_question",
      leaseId: "cancel-lease",
    }),
  );

  const cancelled = dispatch(
    events,
    command("CANCEL_NODE", events.length, {
      actor: agent,
      nodeId: "clarify_question",
      reason: "The work order was explicitly stopped.",
    }),
  );
  assert.deepEqual(
    cancelled.newEvents.map((event) => event.type),
    ["WorkLeaseReleased", "NodeCancelled"],
  );

  const state = replayEvents(machine, projectId, events);
  assert.equal(state.workLeases["cancel-lease"].status, "released");
  assert.equal(state.nodeExecutions.clarify_question.activeLeaseId, null);
  assert.equal(state.nodeExecutions.clarify_question.state, EXECUTION_STATES.CANCELLED);
  assert.equal(
    state.nodeExecutions.clarify_question.cancellationReason,
    "The work order was explicitly stopped.",
  );
  const projection = getRuntimeUserProjection(machine, state);
  assert.equal(projection.state, EXECUTION_STATES.CANCELLED);
  assert.match(projection.status, /已取消/);
  assert.match(projection.limitation, /explicitly stopped/);
});

test("only the research owner, runtime, or active lease owner can cancel a node", () => {
  const unrelatedAgent = {
    id: "unrelated-agent",
    role: "question_modeler",
    kind: "agent",
  };
  const unrelatedHuman = {
    id: "different-human",
    role: "human_researcher",
    kind: "human",
  };

  for (const actor of [unrelatedAgent, unrelatedHuman]) {
    const events = createdEvents();
    assert.throws(
      () =>
        dispatchCommand(
          machine,
          events,
          command("CANCEL_NODE", events.length, {
            actor,
            commandId: `unauthorized-cancel-${actor.id}`,
            nodeId: "capture_intent",
            reason: "This principal does not own the research project.",
          }),
        ),
      (error) =>
        error instanceof ResearchEngineError &&
        error.code === "UNAUTHORIZED_NODE_CANCELLATION",
    );
  }

  const ownerEvents = createdEvents();
  dispatch(
    ownerEvents,
    command("CANCEL_NODE", ownerEvents.length, {
      nodeId: "capture_intent",
      reason: "The researcher chose not to continue.",
    }),
  );
  assert.equal(
    replayEvents(machine, projectId, ownerEvents).nodeExecutions.capture_intent.state,
    EXECUTION_STATES.CANCELLED,
  );

  const runtimeEvents = createdEvents();
  dispatch(
    runtimeEvents,
    command("CANCEL_NODE", runtimeEvents.length, {
      actor: system,
      nodeId: "capture_intent",
      reason: "The runtime kill switch stopped this node.",
    }),
  );
  assert.equal(
    replayEvents(machine, projectId, runtimeEvents).nodeExecutions.capture_intent.state,
    EXECUTION_STATES.CANCELLED,
  );
});

test("agents cannot decide a human gate and a gate binds exact artifact versions", () => {
  const events = createdEvents();
  const sourceRef = "fixture://scope";
  dispatch(
    events,
    command("IMPORT_LEGACY_CHECKPOINT", events.length, {
      actor: system,
      artifacts: [
        {
          id: "question-1",
          type: "ResearchQuestionCandidate",
          lineageId: "question",
          version: 1,
          contentHash: sha256("question-v1"),
          status: ARTIFACT_STATES.VERIFIED,
          producedByNodeId: "clarify_question",
          inputArtifactRefs: [],
          sourceRef,
        },
        {
          id: "boundary-1",
          type: "ScopeBoundary",
          lineageId: "boundary",
          version: 1,
          contentHash: sha256("boundary-v1"),
          status: ARTIFACT_STATES.VERIFIED,
          producedByNodeId: "clarify_question",
          inputArtifactRefs: [],
          sourceRef,
        },
      ],
      nodes: [
        { nodeId: "capture_intent", state: EXECUTION_STATES.ACCEPTED, sourceRef },
        {
          nodeId: "clarify_question",
          state: EXECUTION_STATES.ACCEPTED,
          artifactIds: ["question-1", "boundary-1"],
          sourceRef,
        },
        { nodeId: "approve_scope", state: EXECUTION_STATES.READY, sourceRef },
      ],
      gates: [],
    }),
  );
  dispatch(
    events,
    command("REQUEST_GATE", events.length, {
      actor: { id: "agent-orchestrator", role: "research_orchestrator", kind: "agent" },
      gateId: "scope-gate",
      nodeId: "approve_scope",
      artifactIds: ["question-1", "boundary-1"],
    }),
  );
  const state = replayEvents(machine, projectId, events);

  assert.throws(
    () =>
      dispatchCommand(
        machine,
        events,
        command("DECIDE_GATE", events.length, {
          actor: { id: "agent-orchestrator", role: "human_researcher", kind: "agent" },
          gateId: "scope-gate",
          gateFingerprint: state.gates["scope-gate"].fingerprint,
          decision: GATE_STATES.APPROVED,
          reason: "agent must not approve",
        }),
      ),
    (error) => error instanceof ResearchEngineError && error.code === "HUMAN_REQUIRED",
  );

  assert.throws(
    () =>
      dispatchCommand(
        machine,
        events,
        command("DECIDE_GATE", events.length, {
          gateId: "scope-gate",
          gateFingerprint: sha256("wrong version"),
          decision: GATE_STATES.APPROVED,
          reason: "wrong fingerprint",
        }),
      ),
    (error) =>
      error instanceof ResearchEngineError &&
      error.code === "GATE_FINGERPRINT_MISMATCH",
  );

  assert.throws(
    () =>
      dispatchCommand(
        machine,
        events,
        command("DECIDE_GATE", events.length, {
          actor: { id: "human-pi", role: "unrelated_human_role", kind: "human" },
          gateId: "scope-gate",
          gateFingerprint: state.gates["scope-gate"].fingerprint,
          decision: GATE_STATES.APPROVED,
          reason: "wrong role",
          decisionArtifacts: [],
        }),
      ),
    (error) =>
      error instanceof ResearchEngineError &&
      error.code === "APPROVER_ROLE_MISMATCH",
  );

  const amendment = dispatch(
    events,
    command("DECIDE_GATE", events.length, {
      gateId: "scope-gate",
      gateFingerprint: state.gates["scope-gate"].fingerprint,
      decision: GATE_STATES.AMENDMENT_REQUESTED,
      reason: "Narrow the question and make the observable outcome explicit.",
      correctionId: "scope-amendment-1",
    }),
  );
  assert.equal(amendment.newEvents[0].type, "HumanDecisionRecorded");
  assert.ok(amendment.newEvents.some((event) => event.type === "HumanCorrectionRecorded"));
  assert.ok(amendment.newEvents.some((event) => event.type === "ArtifactMarkedStale"));
  assert.equal(amendment.newEvents.at(-1).type, "ProjectFocusSet");
  const amendedState = replayEvents(machine, projectId, events);
  assert.equal(amendedState.gates["scope-gate"].status, GATE_STATES.AMENDMENT_REQUESTED);
  assert.equal(amendedState.focusNodeId, "clarify_question");
  assert.equal(amendedState.corrections.at(-1).sourceGateId, "scope-gate");
  assert.equal(amendedState.corrections.at(-1).amendmentTargetNodeId, "clarify_question");
  assert.equal(amendedState.nodeExecutions.clarify_question.stale, true);
  assert.equal(
    amendedState.nodeExecutions.clarify_question.staleByCorrectionId,
    "scope-amendment-1",
  );
  assert.equal(amendedState.artifacts["question-1"].freshness, ARTIFACT_FRESHNESS.STALE);
});

test("a human gate rejects type-correct materials that were not accepted by its dependency", () => {
  const events = createdEvents();
  const sourceRef = "fixture://wrong-gate-origin";
  dispatch(
    events,
    command("IMPORT_LEGACY_CHECKPOINT", events.length, {
      actor: system,
      artifacts: [
        {
          id: "misplaced-question",
          type: "ResearchQuestionCandidate",
          lineageId: "misplaced-question",
          version: 1,
          contentHash: sha256("type-correct but wrong producer"),
          status: ARTIFACT_STATES.VERIFIED,
          producedByNodeId: "capture_intent",
          inputArtifactRefs: [],
          sourceRef,
        },
        {
          id: "misplaced-boundary",
          type: "ScopeBoundary",
          lineageId: "misplaced-boundary",
          version: 1,
          contentHash: sha256("type-correct boundary but wrong producer"),
          status: ARTIFACT_STATES.VERIFIED,
          producedByNodeId: "capture_intent",
          inputArtifactRefs: [],
          sourceRef,
        },
      ],
      nodes: [
        {
          nodeId: "capture_intent",
          state: EXECUTION_STATES.ACCEPTED,
          artifactIds: ["misplaced-question", "misplaced-boundary"],
          sourceRef,
        },
        {
          nodeId: "clarify_question",
          state: EXECUTION_STATES.ACCEPTED,
          artifactIds: [],
          sourceRef,
        },
        { nodeId: "approve_scope", state: EXECUTION_STATES.READY, sourceRef },
      ],
      gates: [],
    }),
  );

  assert.throws(
    () =>
      dispatchCommand(
        machine,
        events,
        command("REQUEST_GATE", events.length, {
          actor: {
            id: "gate-runner",
            role: "research_orchestrator",
            kind: "agent",
          },
          gateId: "wrong-origin-scope-gate",
          nodeId: "approve_scope",
          artifactIds: ["misplaced-question", "misplaced-boundary"],
        }),
      ),
    (error) =>
      error instanceof ResearchEngineError &&
      error.code === "GATE_INPUT_NOT_ACCEPTED",
  );
});

test("different independent agents can accept evidence verification before a human-only boundary gate stays pending", () => {
  const events = createdEvents();
  const sourceRef = "fixture://independent-evidence-review";
  const verifier = {
    id: "independent-verifier-a",
    role: "independent_evidence_verifier",
    kind: "agent",
  };
  const reviewer = {
    id: "independent-reviewer-b",
    role: "independent_evidence_reviewer",
    kind: "agent",
  };
  const gateRunner = {
    id: "evidence-boundary-gate-runner",
    role: "research_orchestrator",
    kind: "agent",
  };

  dispatch(
    events,
    command("IMPORT_LEGACY_CHECKPOINT", events.length, {
      actor: system,
      artifacts: [
        {
          id: "independent-review-claim-map",
          type: "ClaimEvidenceMap",
          lineageId: "independent-review-claim-map",
          version: 1,
          contentHash: sha256("claim-map"),
          status: ARTIFACT_STATES.ACCEPTED,
          producedByNodeId: "synthesize_claims",
          producedByActorId: "evidence-synthesizer",
          producedByActorRole: "evidence_synthesizer",
          inputArtifactRefs: [],
          sourceRef,
        },
        {
          id: "independent-review-conclusion-card",
          type: "ResearchConclusionCard",
          lineageId: "independent-review-conclusion-card",
          version: 1,
          contentHash: sha256("conclusion-card"),
          status: ARTIFACT_STATES.ACCEPTED,
          producedByNodeId: "synthesize_claims",
          producedByActorId: "evidence-synthesizer",
          producedByActorRole: "evidence_synthesizer",
          inputArtifactRefs: [],
          sourceRef,
        },
      ],
      nodes: [
        {
          nodeId: "synthesize_claims",
          state: EXECUTION_STATES.ACCEPTED,
          artifactIds: [
            "independent-review-claim-map",
            "independent-review-conclusion-card",
          ],
          sourceRef,
        },
      ],
      gates: [],
    }),
  );

  dispatch(
    events,
    command("READY_NODE", events.length, {
      actor: verifier,
      nodeId: "verify_evidence",
    }),
  );
  dispatch(
    events,
    command("CLAIM_WORK", events.length, {
      actor: verifier,
      nodeId: "verify_evidence",
      leaseId: "independent-evidence-review-lease",
      expiresAt: "2026-08-11T00:00:00.000Z",
    }),
  );
  dispatch(
    events,
    command("START_NODE", events.length, {
      actor: verifier,
      nodeId: "verify_evidence",
      leaseId: "independent-evidence-review-lease",
    }),
  );
  dispatch(
    events,
    command("PRODUCE_ARTIFACT", events.length, {
      actor: verifier,
      nodeId: "verify_evidence",
      leaseId: "independent-evidence-review-lease",
      artifact: {
        id: "independent-evidence-verification-report",
        type: "EvidenceVerificationReport",
        lineageId: "independent-evidence-verification-report",
        version: 1,
        content: {
          schemaVersion: "1.0.0",
          id: "independent-evidence-verification-report",
          conclusionCardIds: ["independent-review-conclusion-card"],
          status: "verified",
          verdict: "pass",
          producerId: "evidence-synthesizer",
          verifierId: verifier.id,
          limitations: ["The bounded conclusion still requires a human decision."],
        },
        inputArtifactRefs: [
          "independent-review-claim-map",
          "independent-review-conclusion-card",
        ],
        sourceRef,
      },
    }),
  );
  dispatch(
    events,
    command("SUBMIT_NODE", events.length, {
      actor: verifier,
      nodeId: "verify_evidence",
      leaseId: "independent-evidence-review-lease",
      artifactIds: ["independent-evidence-verification-report"],
    }),
  );
  dispatch(
    events,
    command("VERIFY_ARTIFACT", events.length, {
      actor: reviewer,
      artifactId: "independent-evidence-verification-report",
      verdict: "pass",
    }),
  );
  const verificationNode = machine.nodes.find(
    (node) => node.id === "verify_evidence",
  );
  dispatch(
    events,
    command("ACCEPT_NODE", events.length, {
      actor: reviewer,
      nodeId: "verify_evidence",
      artifactIds: ["independent-evidence-verification-report"],
      criteriaProofs: verificationNode.acceptanceCriteria.map((criterion) => ({
        criterion,
        passed: true,
        proofArtifactIds: ["independent-evidence-verification-report"],
      })),
    }),
  );

  dispatch(
    events,
    command("READY_NODE", events.length, {
      actor: gateRunner,
      nodeId: "approve_evidence_boundary",
    }),
  );
  dispatch(
    events,
    command("REQUEST_GATE", events.length, {
      actor: gateRunner,
      gateId: "pending-evidence-boundary",
      nodeId: "approve_evidence_boundary",
      artifactIds: [
        "independent-evidence-verification-report",
        "independent-review-conclusion-card",
      ],
    }),
  );

  const state = replayEvents(machine, projectId, events);
  assert.equal(
    state.nodeExecutions.verify_evidence.state,
    EXECUTION_STATES.ACCEPTED,
  );
  assert.equal(
    state.artifacts["independent-evidence-verification-report"].acceptedBy
      .actorId,
    reviewer.id,
  );
  assert.equal(
    state.gates["pending-evidence-boundary"].status,
    GATE_STATES.PENDING,
  );
  assert.equal(
    state.nodeExecutions.approve_evidence_boundary.state,
    EXECUTION_STATES.REVIEW,
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "HumanDecisionRecorded" &&
        event.aggregateId === "pending-evidence-boundary",
    ),
    false,
  );
});

test("an accepted legacy human gate requires an exact material fingerprint", () => {
  const events = createdEvents();
  const sourceRef = "fixture://legacy-gate-without-fingerprint";

  assert.throws(
    () =>
      dispatchCommand(
        machine,
        events,
        command("IMPORT_LEGACY_CHECKPOINT", events.length, {
          actor: system,
          artifacts: [
            {
              id: "legacy-question",
              type: "ResearchQuestionCandidate",
              lineageId: "legacy-question",
              version: 1,
              contentHash: sha256("legacy-question"),
              status: ARTIFACT_STATES.VERIFIED,
              producedByNodeId: "clarify_question",
              inputArtifactRefs: [],
              sourceRef,
            },
            {
              id: "legacy-boundary",
              type: "ScopeBoundary",
              lineageId: "legacy-boundary",
              version: 1,
              contentHash: sha256("legacy-boundary"),
              status: ARTIFACT_STATES.VERIFIED,
              producedByNodeId: "clarify_question",
              inputArtifactRefs: [],
              sourceRef,
            },
            {
              id: "legacy-brief",
              type: "ResearchBrief",
              lineageId: "legacy-brief",
              version: 1,
              contentHash: sha256("legacy-brief"),
              status: ARTIFACT_STATES.ACCEPTED,
              producedByNodeId: "approve_scope",
              inputArtifactRefs: ["legacy-question", "legacy-boundary"],
              sourceRef,
            },
            {
              id: "legacy-scope-decision",
              type: "ScopeDecision",
              lineageId: "legacy-scope-decision",
              version: 1,
              contentHash: sha256("legacy-scope-decision"),
              status: ARTIFACT_STATES.ACCEPTED,
              producedByNodeId: "approve_scope",
              inputArtifactRefs: ["legacy-question", "legacy-boundary"],
              sourceRef,
            },
          ],
          nodes: [
            { nodeId: "capture_intent", state: EXECUTION_STATES.ACCEPTED, sourceRef },
            {
              nodeId: "clarify_question",
              state: EXECUTION_STATES.ACCEPTED,
              artifactIds: ["legacy-question", "legacy-boundary"],
              sourceRef,
            },
            {
              nodeId: "approve_scope",
              state: EXECUTION_STATES.ACCEPTED,
              inputArtifactIds: ["legacy-question", "legacy-boundary"],
              artifactIds: ["legacy-brief", "legacy-scope-decision"],
              sourceRef,
              decisionReceipt: {
                decidedBy: {
                  actorId: human.id,
                  actorRole: human.role,
                  actorKind: human.kind,
                },
                decidedOn: "2026-08-09",
                decidedAtPrecision: "day",
                reason: "The human approved these exact materials.",
                sourceRef,
              },
            },
          ],
          gates: [],
        }),
      ),
    (error) =>
      error instanceof ResearchEngineError &&
      error.code === "MISSING_GATE_DECISION_RECEIPT",
  );
});

test("an interrupted multi-event command resumes instead of becoming a false duplicate", () => {
  const events = createdEvents();
  const sourceRef = "fixture://recover-gate";
  dispatch(
    events,
    command("IMPORT_LEGACY_CHECKPOINT", events.length, {
      actor: system,
      artifacts: [
        {
          id: "recover-question",
          type: "ResearchQuestionCandidate",
          lineageId: "recover-question",
          version: 1,
          contentHash: sha256("question"),
          status: ARTIFACT_STATES.VERIFIED,
          producedByNodeId: "clarify_question",
          inputArtifactRefs: [],
          sourceRef,
        },
        {
          id: "recover-boundary",
          type: "ScopeBoundary",
          lineageId: "recover-boundary",
          version: 1,
          contentHash: sha256("boundary"),
          status: ARTIFACT_STATES.VERIFIED,
          producedByNodeId: "clarify_question",
          inputArtifactRefs: [],
          sourceRef,
        },
      ],
      nodes: [
        { nodeId: "capture_intent", state: EXECUTION_STATES.ACCEPTED, sourceRef },
        {
          nodeId: "clarify_question",
          state: EXECUTION_STATES.ACCEPTED,
          artifactIds: ["recover-question", "recover-boundary"],
          sourceRef,
        },
        { nodeId: "approve_scope", state: EXECUTION_STATES.READY, sourceRef },
      ],
      gates: [],
    }),
  );
  dispatch(
    events,
    command("REQUEST_GATE", events.length, {
      actor: { id: "gate-runner", role: "research_orchestrator", kind: "agent" },
      gateId: "recover-scope-gate",
      nodeId: "approve_scope",
      artifactIds: ["recover-question", "recover-boundary"],
    }),
  );
  const preDecision = replayEvents(machine, projectId, events);
  const approve = command("DECIDE_GATE", events.length, {
    commandId: "approve-recover-scope",
    gateId: "recover-scope-gate",
    gateFingerprint: preDecision.gates["recover-scope-gate"].fingerprint,
    decision: GATE_STATES.APPROVED,
    reason: "The exact question and boundary are approved.",
    decisionArtifacts: [
      {
        id: "recover-brief",
        type: "ResearchBrief",
        lineageId: "recover-brief",
        version: 1,
        content: { decision: "approved" },
      },
      {
        id: "recover-scope-decision",
        type: "ScopeDecision",
        lineageId: "recover-scope-decision",
        version: 1,
        content: { boundary: "approved" },
      },
    ],
  });
  const full = dispatchCommand(machine, events, approve);
  assert.equal(full.newEvents.length > 1, true);

  events.push(full.newEvents[0]);
  const interrupted = replayEvents(machine, projectId, events);
  assert.equal(interrupted.gates["recover-scope-gate"].status, GATE_STATES.PENDING);
  assert.equal(Boolean(interrupted.inFlightCommands[approve.commandId]), true);

  const resumed = dispatchCommand(machine, events, approve);
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.newEvents.length, full.newEvents.length - 1);
  events.push(...resumed.newEvents);
  const recovered = replayEvents(machine, projectId, events);
  assert.equal(recovered.gates["recover-scope-gate"].status, GATE_STATES.APPROVED);
  assert.equal(recovered.artifacts["recover-brief"].status, ARTIFACT_STATES.ACCEPTED);
  assert.equal(recovered.inFlightCommands[approve.commandId], undefined);
});

test("a human correction keeps history while marking affected artifacts and gates stale", () => {
  const events = createdEvents();
  const sourceRef = "fixture://legacy";
  dispatch(
    events,
    command("IMPORT_LEGACY_CHECKPOINT", events.length, {
      actor: system,
      artifacts: [
        {
          id: "evidence-1",
          type: "ClaimEvidenceMap",
          lineageId: "evidence",
          version: 1,
          contentHash: sha256("evidence-v1"),
          status: ARTIFACT_STATES.ACCEPTED,
          producedByNodeId: "synthesize_claims",
          inputArtifactRefs: [],
          sourceRef,
        },
        {
          id: "outline-1",
          type: "EvidenceDrivenOutline",
          lineageId: "outline",
          version: 1,
          contentHash: sha256("outline-v1"),
          status: ARTIFACT_STATES.VERIFIED,
          producedByNodeId: "derive_outline",
          inputArtifactRefs: ["evidence-1"],
          sourceRef,
        },
      ],
      nodes: [
        {
          nodeId: "synthesize_claims",
          state: EXECUTION_STATES.ACCEPTED,
          sourceRef,
          artifactIds: ["evidence-1"],
        },
        {
          nodeId: "derive_outline",
          state: EXECUTION_STATES.ACCEPTED,
          sourceRef,
          artifactIds: ["outline-1"],
        },
      ],
      gates: [
        {
          id: "outline-gate",
          nodeId: "approve_outline",
          status: GATE_STATES.PENDING,
          artifactIds: ["outline-1"],
          requestedBy: { actorId: "legacy-agent", actorRole: "orchestrator", actorKind: "agent" },
          requestedAt: "2026-08-10T00:00:00.000Z",
          sourceRef,
        },
      ],
    }),
  );
  const preCorrectionCount = events.length;
  dispatch(
    events,
    command("RECORD_HUMAN_CORRECTION", events.length, {
      correctionId: "correction-1",
      reason: "The outline was created before the evidence boundary was complete.",
      artifactIds: ["evidence-1"],
      focusNodeId: "extract_evidence",
    }),
  );

  const state = replayEvents(machine, projectId, events);
  assert.equal(state.artifacts["evidence-1"].freshness, ARTIFACT_FRESHNESS.STALE);
  assert.equal(state.artifacts["outline-1"].freshness, ARTIFACT_FRESHNESS.STALE);
  assert.equal(state.gates["outline-gate"].status, GATE_STATES.INVALIDATED);
  assert.equal(state.focusNodeId, "extract_evidence");
  assert.equal(events.length > preCorrectionCount, true);
  assert.equal(events.some((event) => event.type === "LegacyArtifactImported"), true);
});

test("superseding a version preserves it as superseded while invalidating its dependants", () => {
  const events = createdEvents();
  const sourceRef = "fixture://supersession";
  dispatch(
    events,
    command("IMPORT_LEGACY_CHECKPOINT", events.length, {
      actor: system,
      artifacts: [
        {
          id: "map-v1",
          type: "ClaimEvidenceMap",
          lineageId: "claim-map",
          version: 1,
          contentHash: sha256("map-v1"),
          status: ARTIFACT_STATES.ACCEPTED,
          producedByNodeId: "synthesize_claims",
          inputArtifactRefs: [],
          sourceRef,
        },
        {
          id: "map-v2",
          type: "ClaimEvidenceMap",
          lineageId: "claim-map",
          version: 2,
          contentHash: sha256("map-v2"),
          status: ARTIFACT_STATES.VERIFIED,
          producedByNodeId: "synthesize_claims",
          inputArtifactRefs: ["map-v1"],
          sourceRef,
        },
        {
          id: "outline-from-v1",
          type: "EvidenceDrivenOutline",
          lineageId: "outline",
          version: 1,
          contentHash: sha256("outline"),
          status: ARTIFACT_STATES.VERIFIED,
          producedByNodeId: "derive_outline",
          inputArtifactRefs: ["map-v1"],
          sourceRef,
        },
        {
          id: "rejected-from-v1",
          type: "OutlineStressTest",
          lineageId: "rejected-outline-test",
          version: 1,
          contentHash: sha256("rejected-outline-test"),
          status: ARTIFACT_STATES.REJECTED,
          producedByNodeId: "stress_test_outline",
          inputArtifactRefs: ["map-v1"],
          sourceRef,
        },
      ],
      nodes: [],
      gates: [
        {
          id: "gate-on-v1",
          nodeId: "approve_evidence_boundary",
          status: GATE_STATES.PENDING,
          artifactIds: ["map-v1"],
          requestedBy: {
            actorId: "legacy-agent",
            actorRole: "research_orchestrator",
            actorKind: "agent",
          },
          requestedAt: "2026-08-10T00:00:00.000Z",
          sourceRef,
        },
      ],
    }),
  );
  dispatch(
    events,
    command("SUPERSEDE_ARTIFACT", events.length, {
      commandId: "supersede-map-v1",
      artifactId: "map-v1",
      supersededBy: "map-v2",
      reason: "A newer verified evidence map replaces the prior version.",
    }),
  );

  const state = replayEvents(machine, projectId, events);
  assert.equal(state.artifacts["map-v1"].status, ARTIFACT_STATES.SUPERSEDED);
  assert.equal(state.artifacts["map-v2"].status, ARTIFACT_STATES.VERIFIED);
  assert.equal(state.artifacts["map-v2"].freshness, ARTIFACT_FRESHNESS.CURRENT);
  assert.equal(state.artifacts["outline-from-v1"].status, ARTIFACT_STATES.VERIFIED);
  assert.equal(
    state.artifacts["outline-from-v1"].freshness,
    ARTIFACT_FRESHNESS.STALE,
  );
  assert.equal(state.artifacts["rejected-from-v1"].status, ARTIFACT_STATES.REJECTED);
  assert.equal(
    state.artifacts["rejected-from-v1"].freshness,
    ARTIFACT_FRESHNESS.STALE,
  );
  assert.equal(state.gates["gate-on-v1"].status, GATE_STATES.INVALIDATED);
  assert.equal(state.gates["gate-on-v1"].previousStatus, GATE_STATES.PENDING);
});
