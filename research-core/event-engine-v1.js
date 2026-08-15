import { createHash } from "node:crypto";

import {
  ARTIFACT_FRESHNESS,
  ARTIFACT_STATES,
  EXECUTION_STATES,
  GATE_STATES,
  LEASE_STATES,
} from "./review-research-machine-v1.js";
import {
  researchArtifactContentNeedsValidation,
  validateResearchArtifactContent,
} from "./artifact-contracts-v1.js";

export const GENESIS_HASH = "0".repeat(64);

export class ResearchEngineError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ResearchEngineError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new ResearchEngineError(code, message, details);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function stableStringify(value) {
  if (value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  const content = typeof value === "string" ? value : stableStringify(value);
  return createHash("sha256").update(content).digest("hex");
}

function nodeById(machine, nodeId) {
  return machine.nodes.find((node) => node.id === nodeId) ?? null;
}

function hardDependencyIds(machine, nodeId) {
  return machine.edges
    .filter(
      (edge) =>
        edge.type === "hard_dependency" && edge.target === nodeId,
    )
    .map((edge) => edge.source);
}

function hardDependencyAncestorIds(machine, nodeId) {
  const ancestors = new Set();
  const pending = [...hardDependencyIds(machine, nodeId)];
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (ancestors.has(candidate)) continue;
    ancestors.add(candidate);
    pending.push(...hardDependencyIds(machine, candidate));
  }
  return ancestors;
}

function assertNode(machine, nodeId) {
  const node = nodeById(machine, nodeId);
  if (!node) fail("UNKNOWN_NODE", `Unknown node: ${nodeId}`, { nodeId });
  return node;
}

function assertActor(command) {
  const actor = command.actor;
  if (!actor?.id || !actor?.role || !actor?.kind) {
    fail("INVALID_ACTOR", "Commands require actor id, role, and kind.");
  }
  if (!new Set(["human", "agent", "system"]).has(actor.kind)) {
    fail("INVALID_ACTOR", `Unsupported actor kind: ${actor.kind}`);
  }
}

function assertCommandEnvelope(command) {
  if (!command?.type) fail("INVALID_COMMAND", "Command type is required.");
  if (!command.commandId) fail("INVALID_COMMAND", "commandId is required.");
  if (!command.projectId) fail("INVALID_COMMAND", "projectId is required.");
  if (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 0) {
    fail("INVALID_COMMAND", "expectedVersion must be a non-negative integer.");
  }
  if (!command.occurredAt || Number.isNaN(Date.parse(command.occurredAt))) {
    fail("INVALID_COMMAND", "occurredAt must be an ISO timestamp.");
  }
  assertActor(command);
}

function hasValidRecordedTime(receipt) {
  const exact =
    receipt?.decidedAt && !Number.isNaN(Date.parse(receipt.decidedAt));
  const dayPrecision =
    receipt?.decidedAtPrecision === "day" &&
    /^\d{4}-\d{2}-\d{2}$/.test(receipt?.decidedOn ?? "");
  return Boolean(exact || dayPrecision);
}

export function createEmptyProjectState(machine, projectId) {
  return {
    projectId,
    workflowId: machine.id,
    workflowVersion: machine.version,
    revision: 0,
    created: false,
    status: "new",
    researchOwnerId: null,
    completionProfileId: null,
    focusNodeId: null,
    nodeExecutions: Object.fromEntries(
      machine.nodes.map((node) => [
        node.id,
        {
          state: EXECUTION_STATES.DRAFT,
          stale: false,
          startedBy: null,
          submittedArtifactIds: [],
          acceptedArtifactIds: [],
          activeLeaseId: null,
          blockers: {},
        },
      ]),
    ),
    artifacts: {},
    gates: {},
    workLeases: {},
    corrections: [],
    retrievalProtocolRevisions: [],
    acceptedRisks: [],
    processedCommands: {},
    inFlightCommands: {},
    lastEventHash: GENESIS_HASH,
  };
}

function cloneState(state) {
  return structuredClone(state);
}

function applyCommonEventFields(next, event) {
  next.revision = event.sequence;
  next.lastEventHash = event.hash;
  if (event.commandEventIndex === 1) {
    next.inFlightCommands[event.commandId] = {
      requestHash: event.commandRequestHash,
      firstSequence: event.sequence,
      eventCount: event.commandEventCount,
    };
  }
  if (event.commandEventIndex === event.commandEventCount) {
    delete next.inFlightCommands[event.commandId];
    next.processedCommands[event.commandId] = event.commandRequestHash;
  }
  return next;
}

export function evolve(machine, state, event) {
  const next = cloneState(state);
  const payload = event.payload ?? {};

  switch (event.type) {
    case "ProjectCreated":
      next.created = true;
      next.status = "active";
      next.researchOwnerId = payload.researchOwnerId;
      next.completionProfileId = payload.completionProfileId;
      break;

    case "CompletionProfileChanged":
      next.completionProfileId = payload.toCompletionProfileId;
      break;

    case "NodeReadied":
      next.nodeExecutions[payload.nodeId].state = EXECUTION_STATES.READY;
      next.nodeExecutions[payload.nodeId].stale = false;
      delete next.nodeExecutions[payload.nodeId].staleReason;
      // Keep staleByCorrectionId until the replacement version is accepted.
      // The work order needs this immutable link to receive the researcher's
      // amendment reason while the node is READY/RUNNING/REVIEW.
      break;

    case "NodeStarted":
      next.nodeExecutions[payload.nodeId].state = EXECUTION_STATES.RUNNING;
      next.nodeExecutions[payload.nodeId].startedBy = payload.startedBy;
      next.nodeExecutions[payload.nodeId].activeLeaseId = payload.leaseId ?? null;
      break;

    case "NodeSubmittedForReview":
      next.nodeExecutions[payload.nodeId].state = EXECUTION_STATES.REVIEW;
      next.nodeExecutions[payload.nodeId].submittedArtifactIds = [
        ...payload.artifactIds,
      ];
      break;

    case "NodeAccepted":
      next.nodeExecutions[payload.nodeId].state = EXECUTION_STATES.ACCEPTED;
      next.nodeExecutions[payload.nodeId].stale = false;
      delete next.nodeExecutions[payload.nodeId].staleReason;
      delete next.nodeExecutions[payload.nodeId].staleByCorrectionId;
      next.nodeExecutions[payload.nodeId].acceptedArtifactIds = [
        ...payload.artifactIds,
      ];
      break;

    case "NodeRevisionRequested":
      next.nodeExecutions[payload.nodeId].state = EXECUTION_STATES.REVISION;
      break;

    case "NodeCancelled":
      next.nodeExecutions[payload.nodeId].state = EXECUTION_STATES.CANCELLED;
      next.nodeExecutions[payload.nodeId].activeLeaseId = null;
      next.nodeExecutions[payload.nodeId].cancelledBy = payload.cancelledBy;
      next.nodeExecutions[payload.nodeId].cancelledAt = event.occurredAt;
      next.nodeExecutions[payload.nodeId].cancellationReason = payload.reason;
      break;

    case "NodeMarkedStale":
      next.nodeExecutions[payload.nodeId].state = EXECUTION_STATES.REVISION;
      next.nodeExecutions[payload.nodeId].stale = true;
      next.nodeExecutions[payload.nodeId].staleReason = payload.reason;
      next.nodeExecutions[payload.nodeId].staleByCorrectionId =
        payload.correctionId ?? null;
      break;

    case "BlockerAdded":
      next.nodeExecutions[payload.nodeId].blockers[payload.blocker.id] = {
        ...payload.blocker,
        status: "open",
        addedAt: event.occurredAt,
      };
      next.nodeExecutions[payload.nodeId].state = EXECUTION_STATES.BLOCKED;
      break;

    case "BlockerResolved": {
      const blocker = next.nodeExecutions[payload.nodeId].blockers[payload.blockerId];
      blocker.status = "resolved";
      blocker.resolvedBy = payload.resolvedBy;
      blocker.resolvedAt = event.occurredAt;
      blocker.resolution = payload.resolution;
      break;
    }

    case "WorkLeaseClaimed":
      next.workLeases[payload.lease.id] = cloneState(payload.lease);
      next.nodeExecutions[payload.lease.nodeId].activeLeaseId = payload.lease.id;
      break;

    case "WorkLeaseStarted":
      next.workLeases[payload.leaseId].status = LEASE_STATES.RUNNING;
      next.workLeases[payload.leaseId].startedAt = event.occurredAt;
      break;

    case "WorkLeaseReleased": {
      const lease = next.workLeases[payload.leaseId];
      lease.status = LEASE_STATES.RELEASED;
      lease.releasedAt = event.occurredAt;
      lease.releaseReason = payload.reason;
      if (next.nodeExecutions[lease.nodeId].activeLeaseId === lease.id) {
        next.nodeExecutions[lease.nodeId].activeLeaseId = null;
      }
      break;
    }

    case "WorkLeaseExpired": {
      const lease = next.workLeases[payload.leaseId];
      lease.status = LEASE_STATES.EXPIRED;
      lease.expiredAt = event.occurredAt;
      if (next.nodeExecutions[lease.nodeId].activeLeaseId === lease.id) {
        next.nodeExecutions[lease.nodeId].activeLeaseId = null;
      }
      break;
    }

    case "ArtifactProduced":
    case "HumanDecisionArtifactRecorded":
    case "LegacyArtifactImported": {
      const artifact = cloneState(payload.artifact);
      artifact.freshness ??= ARTIFACT_FRESHNESS.CURRENT;
      next.artifacts[payload.artifact.id] = artifact;
      break;
    }

    case "ArtifactVerified":
      next.artifacts[payload.artifactId].status = ARTIFACT_STATES.VERIFIED;
      next.artifacts[payload.artifactId].verification = {
        verdict: payload.verdict,
        limitations: payload.limitations,
        verifiedBy: payload.verifiedBy,
        verifiedAt: event.occurredAt,
      };
      break;

    case "ArtifactRejected":
      next.artifacts[payload.artifactId].status = ARTIFACT_STATES.REJECTED;
      next.artifacts[payload.artifactId].verification = {
        verdict: "fail",
        limitations: payload.limitations,
        verifiedBy: payload.verifiedBy,
        verifiedAt: event.occurredAt,
      };
      break;

    case "ArtifactAccepted":
      next.artifacts[payload.artifactId].status = ARTIFACT_STATES.ACCEPTED;
      next.artifacts[payload.artifactId].acceptedBy = payload.acceptedBy;
      next.artifacts[payload.artifactId].acceptedAt = event.occurredAt;
      break;

    case "ArtifactSuperseded":
      next.artifacts[payload.artifactId].status = ARTIFACT_STATES.SUPERSEDED;
      next.artifacts[payload.artifactId].supersededBy = payload.supersededBy;
      next.artifacts[payload.artifactId].supersededReason = payload.reason;
      break;

    case "ArtifactMarkedStale":
      next.artifacts[payload.artifactId].freshness = ARTIFACT_FRESHNESS.STALE;
      next.artifacts[payload.artifactId].staleReason = payload.reason;
      next.artifacts[payload.artifactId].staleByCorrectionId =
        payload.correctionId ?? null;
      break;

    case "GateRequested":
    case "LegacyGateImported":
      next.gates[payload.gate.id] = cloneState(payload.gate);
      if (next.nodeExecutions[payload.gate.nodeId]) {
        next.nodeExecutions[payload.gate.nodeId].state = EXECUTION_STATES.REVIEW;
      }
      break;

    case "HumanDecisionRecorded": {
      const gate = next.gates[payload.gateId];
      gate.status = payload.decision;
      gate.decidedBy = payload.decidedBy;
      gate.decidedAt = event.occurredAt;
      gate.reason = payload.reason;
      gate.decisionArtifactIds = [...(payload.decisionArtifactIds ?? [])];
      if (payload.decision === GATE_STATES.ACCEPTED_RISK) {
        next.acceptedRisks.push({
          gateId: gate.id,
          reason: payload.reason,
          decidedAt: event.occurredAt,
        });
      }
      if (
        payload.decision === GATE_STATES.APPROVED ||
        payload.decision === GATE_STATES.ACCEPTED_RISK
      ) {
        next.nodeExecutions[gate.nodeId].state = EXECUTION_STATES.ACCEPTED;
        next.nodeExecutions[gate.nodeId].acceptedArtifactIds = [
          ...(payload.decisionArtifactIds ?? []),
        ];
      } else {
        next.nodeExecutions[gate.nodeId].state = EXECUTION_STATES.REVISION;
      }
      break;
    }

    case "GateInvalidated": {
      const gate = next.gates[payload.gateId];
      gate.previousStatus = gate.status;
      gate.status = GATE_STATES.INVALIDATED;
      gate.invalidatedAt = event.occurredAt;
      gate.invalidationReason = payload.reason;
      if (next.nodeExecutions[gate.nodeId]) {
        next.nodeExecutions[gate.nodeId].state =
          EXECUTION_STATES.REVISION;
      }
      break;
    }

    case "LegacyNodeCheckpointImported":
      next.nodeExecutions[payload.nodeId].state = payload.state;
      next.nodeExecutions[payload.nodeId].stale = Boolean(payload.stale);
      next.nodeExecutions[payload.nodeId].checkpointSource = payload.sourceRef;
      next.nodeExecutions[payload.nodeId].acceptedArtifactIds = [
        ...(payload.artifactIds ?? []),
      ];
      break;

    case "HumanCorrectionRecorded":
      next.corrections.push(cloneState(payload.correction));
      break;

    case "ProjectFocusSet":
      next.focusNodeId = payload.nodeId;
      break;

    case "RetrievalProtocolRevised": {
      const previous = next.artifacts[payload.previousArtifactId];
      previous.status = ARTIFACT_STATES.SUPERSEDED;
      previous.supersededBy = payload.artifact.id;
      previous.supersededReason = payload.reason;
      previous.freshness = ARTIFACT_FRESHNESS.STALE;
      previous.staleReason = payload.reason;
      previous.staleByCorrectionId = payload.correctionId;

      const artifact = cloneState(payload.artifact);
      artifact.freshness = ARTIFACT_FRESHNESS.CURRENT;
      next.artifacts[artifact.id] = artifact;

      const producerRuntime = next.nodeExecutions[artifact.producedByNodeId];
      producerRuntime.acceptedArtifactIds = producerRuntime.acceptedArtifactIds.map(
        (artifactId) => artifactId === previous.id ? artifact.id : artifactId,
      );

      next.corrections.push(cloneState(payload.correction));
      next.retrievalProtocolRevisions.push(cloneState(payload.revision));
      next.focusNodeId = payload.resumeNodeId;
      const blockedRuntime = next.nodeExecutions[payload.blockedNodeId];
      const blocker = blockedRuntime.blockers[payload.blockerId];
      blocker.status = "resolved";
      blocker.resolvedBy = payload.correction.correctedBy;
      blocker.resolvedAt = payload.correction.correctedAt;
      blocker.resolution = payload.reason;
      for (const nodeId of payload.affectedNodeIds) {
        const runtimeNode = next.nodeExecutions[nodeId];
        if (!runtimeNode || runtimeNode.state === EXECUTION_STATES.CANCELLED) continue;
        runtimeNode.state = EXECUTION_STATES.REVISION;
        runtimeNode.stale = true;
        runtimeNode.staleReason = payload.reason;
        runtimeNode.activeLeaseId = null;
      }
      for (const artifactId of payload.affectedArtifactIds) {
        const affected = next.artifacts[artifactId];
        if (!affected || affected.id === artifact.id) continue;
        affected.freshness = ARTIFACT_FRESHNESS.STALE;
        affected.staleReason = payload.reason;
        affected.staleByCorrectionId = payload.correctionId;
      }
      for (const gateId of payload.affectedGateIds) {
        const gate = next.gates[gateId];
        if (!gate || gate.status === GATE_STATES.INVALIDATED) continue;
        gate.previousStatus = gate.status;
        gate.status = GATE_STATES.INVALIDATED;
        gate.invalidatedAt = payload.correction.correctedAt;
        gate.invalidationReason = payload.reason;
      }
      break;
    }

    default:
      fail("UNKNOWN_EVENT", `Unknown event type: ${event.type}`);
  }

  return applyCommonEventFields(next, event);
}

function assertProjectCreated(state) {
  if (!state.created) fail("PROJECT_NOT_CREATED", "Create the project first.");
}

function unresolvedBlockers(runtimeNode) {
  return Object.values(runtimeNode.blockers ?? {}).filter(
    (blocker) => blocker.status !== "resolved",
  );
}

function assertRunningLeaseForAgent(state, runtimeNode, command) {
  if (command.actor.kind !== "agent") return null;
  const lease = state.workLeases[command.leaseId];
  if (
    !lease ||
    runtimeNode.activeLeaseId !== lease.id ||
    lease.status !== LEASE_STATES.RUNNING ||
    lease.claimedBy.actorId !== command.actor.id
  ) {
    fail(
      "LEASE_FENCE_MISMATCH",
      "Agent work must carry the current running lease fencing token.",
    );
  }
  if (Date.parse(command.occurredAt) >= Date.parse(lease.expiresAt)) {
    fail("LEASE_EXPIRED", `Lease ${lease.id} has expired.`);
  }
  return lease;
}

function assertDependenciesAccepted(machine, state, nodeId) {
  const missing = hardDependencyIds(machine, nodeId).filter((dependencyId) => {
    const dependency = state.nodeExecutions[dependencyId];
    return dependency.state !== EXECUTION_STATES.ACCEPTED || dependency.stale;
  });
  if (missing.length > 0) {
    fail("DEPENDENCY_NOT_ACCEPTED", "Hard dependencies are not accepted.", {
      nodeId,
      missing,
    });
  }
}

function ensureArtifactRefs(
  state,
  artifactIds,
  allowedStatuses,
  { allowEmpty = false } = {},
) {
  if (!Array.isArray(artifactIds) || (!allowEmpty && artifactIds.length === 0)) {
    fail("MISSING_ARTIFACT_REFS", "At least one artifact reference is required.");
  }
  return artifactIds.map((artifactId) => {
    const artifact = state.artifacts[artifactId];
    if (!artifact) fail("UNKNOWN_ARTIFACT", `Unknown artifact: ${artifactId}`);
    if (artifact.freshness === ARTIFACT_FRESHNESS.STALE) {
      fail("STALE_ARTIFACT", `Artifact ${artifactId} must be revalidated first.`);
    }
    if (!allowedStatuses.includes(artifact.status)) {
      fail(
        "INVALID_ARTIFACT_STATUS",
        `Artifact ${artifactId} is ${artifact.status}; expected ${allowedStatuses.join(", ")}.`,
      );
    }
    return artifact;
  });
}

function artifactManifestHash(artifact) {
  return sha256({
    id: artifact.id,
    type: artifact.type,
    lineageId: artifact.lineageId,
    version: artifact.version,
    contentHash: artifact.contentHash,
    inputArtifactRefs: [...(artifact.inputArtifactRefs ?? [])].sort(),
    sourceRef: artifact.sourceRef ?? null,
    locator: artifact.locator ?? null,
  });
}

function artifactFingerprint(artifacts) {
  return sha256(
    artifacts
      .map((artifact) => ({
        artifactId: artifact.id,
        contentHash: artifact.contentHash,
        manifestHash: artifact.manifestHash,
        version: artifact.version,
      }))
      .sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
  );
}

function contractType(contract) {
  return contract.split("@")[0].replace(/\[\]$/, "");
}

function assertArtifactsMatchContracts(artifacts, contracts, label) {
  const expectedTypes = new Set(contracts.map(contractType));
  const actualTypes = new Set(artifacts.map((artifact) => artifact.type));
  const unexpected = [...actualTypes].filter((type) => !expectedTypes.has(type));
  const missing = [...expectedTypes].filter((type) => !actualTypes.has(type));
  if (unexpected.length > 0 || missing.length > 0) {
    fail("ARTIFACT_CONTRACT_MISMATCH", `${label} does not match the workflow contract.`, {
      expectedTypes: [...expectedTypes],
      actualTypes: [...actualTypes],
      missing,
      unexpected,
    });
  }
}

function assertGateInputsAreAcceptedDependencyOutputs(
  machine,
  state,
  node,
  artifacts,
) {
  const dependencyIds = hardDependencyIds(machine, node.id);
  const allowedArtifactIds = new Set(
    dependencyIds.flatMap(
      (nodeId) => state.nodeExecutions[nodeId].acceptedArtifactIds ?? [],
    ),
  );
  const invalid = artifacts
    .map((artifact) => artifact.id)
    .filter((artifactId) => !allowedArtifactIds.has(artifactId));
  if (invalid.length > 0) {
    fail(
      "GATE_INPUT_NOT_ACCEPTED",
      "Gate inputs must be current accepted outputs of its direct dependencies.",
      { nodeId: node.id, invalid, allowedArtifactIds: [...allowedArtifactIds] },
    );
  }
}

function assertSameArtifactIds(actualIds, expectedIds, label) {
  if (
    !Array.isArray(actualIds) ||
    new Set(actualIds).size !== actualIds.length ||
    actualIds.length !== expectedIds.length ||
    [...actualIds].sort().some((id, index) => id !== [...expectedIds].sort()[index])
  ) {
    fail("ARTIFACT_SET_MISMATCH", `${label} must reference the exact artifact set.`);
  }
}

function normalizeProofs(node, criteriaProofs, state, allowedProofArtifactIds) {
  if (!Array.isArray(criteriaProofs)) {
    fail("MISSING_CRITERIA_PROOFS", "Acceptance criteria require proofs.");
  }
  const byCriterion = new Map(
    criteriaProofs.map((proof) => [proof.criterion, proof]),
  );
  for (const criterion of node.acceptanceCriteria) {
    const proof = byCriterion.get(criterion);
    if (!proof?.passed) {
      fail("CRITERION_NOT_PASSED", `Criterion not passed: ${criterion}`);
    }
    const invalidProofIds = (proof.proofArtifactIds ?? []).filter(
      (artifactId) => !allowedProofArtifactIds.has(artifactId),
    );
    if (invalidProofIds.length > 0) {
      fail(
        "CRITERIA_PROOF_OUT_OF_SCOPE",
        "Criterion proofs must come from this node's submitted outputs or declared inputs.",
        { criterion, invalidProofIds },
      );
    }
    ensureArtifactRefs(state, proof.proofArtifactIds, [
      ARTIFACT_STATES.VERIFIED,
      ARTIFACT_STATES.ACCEPTED,
    ]);
  }
  if (byCriterion.size !== node.acceptanceCriteria.length) {
    fail("CRITERIA_MISMATCH", "Criteria proofs must match the node contract exactly.");
  }
  return criteriaProofs;
}

function dependentArtifactIds(state, rootArtifactIds, excludedArtifactIds = []) {
  const affected = new Set(rootArtifactIds);
  const excluded = new Set(excludedArtifactIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const artifact of Object.values(state.artifacts)) {
      if (affected.has(artifact.id) || excluded.has(artifact.id)) continue;
      if ((artifact.inputArtifactRefs ?? []).some((ref) => affected.has(ref))) {
        affected.add(artifact.id);
        changed = true;
      }
    }
  }
  return [...affected];
}

function assertArtifactGraphAcyclic(artifacts) {
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const visiting = new Set();
  const visited = new Set();
  function visit(artifactId) {
    if (visiting.has(artifactId)) {
      fail("ARTIFACT_LINEAGE_CYCLE", `Artifact dependency cycle at ${artifactId}.`);
    }
    if (visited.has(artifactId)) return;
    visiting.add(artifactId);
    for (const inputId of byId.get(artifactId)?.inputArtifactRefs ?? []) {
      if (byId.has(inputId)) visit(inputId);
    }
    visiting.delete(artifactId);
    visited.add(artifactId);
  }
  for (const artifactId of byId.keys()) visit(artifactId);
}

function dependentNodeIds(machine, rootNodeIds) {
  const affected = new Set(rootNodeIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of machine.edges) {
      if (
        edge.type === "hard_dependency" &&
        affected.has(edge.source) &&
        !affected.has(edge.target)
      ) {
        affected.add(edge.target);
        changed = true;
      }
    }
  }
  return [...affected];
}

function staleEventSpecs(
  machine,
  state,
  artifactIds,
  reason,
  correctionId = null,
  {
    markRootsStale = true,
    excludeArtifactIds = [],
    excludeGateIds = [],
  } = {},
) {
  const allAffectedArtifactIds = dependentArtifactIds(
    state,
    artifactIds,
    excludeArtifactIds,
  );
  const rootArtifactIds = new Set(artifactIds);
  const affectedArtifactIds = allAffectedArtifactIds.filter(
    (artifactId) => markRootsStale || !rootArtifactIds.has(artifactId),
  ).filter(
    (artifactId) =>
      state.artifacts[artifactId]?.freshness !== ARTIFACT_FRESHNESS.STALE,
  );
  const specs = affectedArtifactIds.map((artifactId) => ({
    type: "ArtifactMarkedStale",
    aggregateId: artifactId,
    artifactRefs: [artifactId],
    payload: { artifactId, reason, correctionId },
  }));

  const artifactNodeIds = new Set(
    affectedArtifactIds
      .map((artifactId) => state.artifacts[artifactId]?.producedByNodeId)
      .filter(Boolean),
  );
  const rootNodeIds = artifactIds
    .map((artifactId) => state.artifacts[artifactId]?.producedByNodeId)
    .filter(Boolean);
  const workflowNodeIds = dependentNodeIds(machine, rootNodeIds).filter(
    (nodeId) => markRootsStale || !rootNodeIds.includes(nodeId),
  );
  const affectedNodeIds = new Set([...artifactNodeIds, ...workflowNodeIds]);
  for (const nodeId of affectedNodeIds) {
    const runtimeNode = state.nodeExecutions[nodeId];
    if (
      !runtimeNode ||
      runtimeNode.state === EXECUTION_STATES.DRAFT ||
      runtimeNode.state === EXECUTION_STATES.CANCELLED ||
      (runtimeNode.state === EXECUTION_STATES.REVISION && runtimeNode.stale)
    ) {
      continue;
    }
    specs.push({
      type: "NodeMarkedStale",
      aggregateId: nodeId,
      artifactRefs: affectedArtifactIds.filter(
        (artifactId) => state.artifacts[artifactId]?.producedByNodeId === nodeId,
      ),
      payload: { nodeId, reason, correctionId },
    });
  }

  const excludedGates = new Set(excludeGateIds);
  for (const gate of Object.values(state.gates)) {
    if (
      !excludedGates.has(gate.id) &&
      gate.status !== GATE_STATES.INVALIDATED &&
      gate.artifactRefs.some((ref) => allAffectedArtifactIds.includes(ref.artifactId))
    ) {
      specs.push({
        type: "GateInvalidated",
        aggregateId: gate.id,
        artifactRefs: gate.artifactRefs.map((ref) => ref.artifactId),
        payload: { gateId: gate.id, reason, correctionId },
      });
    }
  }

  return specs;
}

function importedArtifact(raw, command) {
  if (
    !raw.id ||
    !raw.type ||
    !raw.lineageId ||
    !Number.isInteger(raw.version) ||
    raw.version < 1
  ) {
    fail(
      "INVALID_LEGACY_ARTIFACT",
      "Imported artifacts require id, type, lineageId, and a positive version.",
    );
  }
  if (!raw.contentHash || !/^[a-f0-9]{64}$/i.test(raw.contentHash)) {
    fail("INVALID_CONTENT_HASH", `Invalid content hash for ${raw.id}.`);
  }
  if (!Object.values(ARTIFACT_STATES).includes(raw.status)) {
    fail("INVALID_ARTIFACT_STATUS", `Invalid imported status for ${raw.id}.`);
  }
  if (!raw.sourceRef) {
    fail("MISSING_SOURCE_REF", `Imported artifact ${raw.id} requires sourceRef.`);
  }
  const legacyStaleStatus = raw.status === ARTIFACT_STATES.STALE;
  const status = legacyStaleStatus
    ? raw.previousStatus ?? ARTIFACT_STATES.CANDIDATE
    : raw.status;
  const freshness = legacyStaleStatus
    ? ARTIFACT_FRESHNESS.STALE
    : raw.freshness ?? ARTIFACT_FRESHNESS.CURRENT;
  if (!Object.values(ARTIFACT_FRESHNESS).includes(freshness)) {
    fail("INVALID_ARTIFACT_FRESHNESS", `Invalid freshness for ${raw.id}.`);
  }
  const artifact = {
    ...raw,
    status,
    freshness,
    inputArtifactRefs: [...(raw.inputArtifactRefs ?? [])],
    importedBy: command.actor.id,
    importedAt: command.occurredAt,
  };
  const computedManifestHash = artifactManifestHash(artifact);
  if (raw.manifestHash && raw.manifestHash !== computedManifestHash) {
    fail("MANIFEST_HASH_MISMATCH", `Invalid manifest hash for ${raw.id}.`);
  }
  artifact.manifestHash = computedManifestHash;
  return artifact;
}

export function decide(machine, state, command) {
  switch (command.type) {
    case "CREATE_PROJECT": {
      if (state.created) fail("PROJECT_EXISTS", "Project already exists.");
      const profile = machine.completionProfiles.find(
        (item) => item.id === command.completionProfileId,
      );
      if (!profile) {
        fail("UNKNOWN_COMPLETION_PROFILE", "Unknown completion profile.");
      }
      const researchOwnerId =
        command.actor.kind === "human"
          ? command.actor.id
          : command.researchOwnerId;
      if (!researchOwnerId) {
        fail(
          "MISSING_RESEARCH_OWNER",
          "A system-created project must designate its human research owner.",
        );
      }
      return [
        {
          type: "ProjectCreated",
          aggregateId: command.projectId,
          artifactRefs: [],
          payload: {
            completionProfileId: command.completionProfileId,
            workflowId: machine.id,
            workflowVersion: machine.version,
            researchOwnerId,
          },
        },
      ];
    }

    case "CHANGE_COMPLETION_PROFILE": {
      assertProjectCreated(state);
      if (
        command.actor.kind !== "human" ||
        command.actor.id !== state.researchOwnerId
      ) {
        fail(
          "UNAUTHORIZED_PRINCIPAL",
          "Only the designated human research owner can change the research target.",
        );
      }
      const profile = machine.completionProfiles.find(
        (item) => item.id === command.completionProfileId,
      );
      if (!profile) {
        fail("UNKNOWN_COMPLETION_PROFILE", "Unknown completion profile.");
      }
      if (!command.reason) {
        fail(
          "MISSING_DECISION_REASON",
          "Changing the research target requires a recorded reason.",
        );
      }
      if (state.completionProfileId === command.completionProfileId) {
        fail(
          "COMPLETION_PROFILE_UNCHANGED",
          "The requested completion profile is already active.",
        );
      }
      return [
        {
          type: "CompletionProfileChanged",
          aggregateId: command.projectId,
          artifactRefs: [],
          payload: {
            fromCompletionProfileId: state.completionProfileId,
            toCompletionProfileId: command.completionProfileId,
            reason: command.reason,
            changedBy: {
              actorId: command.actor.id,
              actorRole: command.actor.role,
              actorKind: command.actor.kind,
            },
          },
        },
      ];
    }

    case "READY_NODE": {
      assertProjectCreated(state);
      assertNode(machine, command.nodeId);
      const runtimeNode = state.nodeExecutions[command.nodeId];
      if (
        ![
          EXECUTION_STATES.DRAFT,
          EXECUTION_STATES.REVISION,
          EXECUTION_STATES.BLOCKED,
        ].includes(runtimeNode.state)
      ) {
        fail("INVALID_NODE_STATE", `Cannot ready node from ${runtimeNode.state}.`);
      }
      if (unresolvedBlockers(runtimeNode).length > 0) {
        fail("OPEN_BLOCKERS", "Resolve blockers before readying the node.");
      }
      assertDependenciesAccepted(machine, state, command.nodeId);
      return [
        {
          type: "NodeReadied",
          aggregateId: command.nodeId,
          artifactRefs: [],
          payload: { nodeId: command.nodeId },
        },
      ];
    }

    case "CLAIM_WORK": {
      assertProjectCreated(state);
      if (command.actor.kind !== "agent") {
        fail("AGENT_REQUIRED", "Only an execution agent needs a work lease.");
      }
      const node = assertNode(machine, command.nodeId);
      const runtimeNode = state.nodeExecutions[node.id];
      if (runtimeNode.state !== EXECUTION_STATES.READY) {
        fail("INVALID_NODE_STATE", "Only ready work can be claimed.");
      }
      if (node.executorRole && command.actor.role !== node.executorRole) {
        fail("EXECUTOR_ROLE_MISMATCH", `Expected executor role ${node.executorRole}.`);
      }
      if (!command.leaseId || state.workLeases[command.leaseId]) {
        fail("INVALID_LEASE", "A new unique leaseId is required.");
      }
      if (runtimeNode.activeLeaseId) {
        fail("WORK_ALREADY_CLAIMED", `Node ${node.id} already has a lease.`);
      }
      if (
        !command.expiresAt ||
        Number.isNaN(Date.parse(command.expiresAt)) ||
        Date.parse(command.expiresAt) <= Date.parse(command.occurredAt)
      ) {
        fail("INVALID_LEASE_EXPIRY", "Lease expiry must be later than claim time.");
      }
      const lease = {
        id: command.leaseId,
        nodeId: node.id,
        status: LEASE_STATES.CLAIMED,
        claimedBy: {
          actorId: command.actor.id,
          actorRole: command.actor.role,
          actorKind: command.actor.kind,
        },
        claimedAt: command.occurredAt,
        expiresAt: command.expiresAt,
      };
      return [
        {
          type: "WorkLeaseClaimed",
          aggregateId: lease.id,
          artifactRefs: [],
          payload: { lease },
        },
      ];
    }

    case "START_NODE": {
      assertProjectCreated(state);
      const node = assertNode(machine, command.nodeId);
      const runtimeNode = state.nodeExecutions[command.nodeId];
      if (runtimeNode.state !== EXECUTION_STATES.READY) {
        fail("INVALID_NODE_STATE", "Only ready nodes can start.");
      }
      if (unresolvedBlockers(runtimeNode).length > 0) {
        fail("OPEN_BLOCKERS", "Resolve blockers before starting the node.");
      }
      assertDependenciesAccepted(machine, state, command.nodeId);
      if (node.executorRole && command.actor.role !== node.executorRole) {
        fail("EXECUTOR_ROLE_MISMATCH", `Expected executor role ${node.executorRole}.`);
      }
      let lease = null;
      if (command.actor.kind === "agent") {
        lease = state.workLeases[command.leaseId];
        if (
          !lease ||
          lease.nodeId !== node.id ||
          lease.claimedBy.actorId !== command.actor.id ||
          lease.status !== LEASE_STATES.CLAIMED
        ) {
          fail("VALID_LEASE_REQUIRED", "The agent must hold this node's active lease.");
        }
        if (Date.parse(command.occurredAt) >= Date.parse(lease.expiresAt)) {
          fail("LEASE_EXPIRED", `Lease ${lease.id} has expired.`);
        }
      }
      const specs = [];
      if (lease) {
        specs.push({
          type: "WorkLeaseStarted",
          aggregateId: lease.id,
          artifactRefs: [],
          payload: { leaseId: lease.id },
        });
      }
      specs.push(
        {
          type: "NodeStarted",
          aggregateId: command.nodeId,
          artifactRefs: [],
          payload: {
            nodeId: command.nodeId,
            leaseId: lease?.id ?? null,
            startedBy: {
              actorId: command.actor.id,
              actorRole: command.actor.role,
              actorKind: command.actor.kind,
            },
          },
        },
      );
      return specs;
    }

    case "RELEASE_WORK": {
      assertProjectCreated(state);
      const lease = state.workLeases[command.leaseId];
      if (!lease) fail("UNKNOWN_LEASE", `Unknown lease: ${command.leaseId}`);
      if (lease.status !== LEASE_STATES.CLAIMED) {
        fail("LEASE_ALREADY_STARTED", "Running work must be submitted or expired, not silently released.");
      }
      if (
        command.actor.kind !== "system" &&
        lease.claimedBy.actorId !== command.actor.id
      ) {
        fail("LEASE_OWNER_MISMATCH", "Only the lease owner can release it.");
      }
      if (!command.reason) fail("MISSING_REASON", "Lease release requires a reason.");
      return [
        {
          type: "WorkLeaseReleased",
          aggregateId: lease.id,
          artifactRefs: [],
          payload: { leaseId: lease.id, reason: command.reason },
        },
      ];
    }

    case "EXPIRE_WORK": {
      assertProjectCreated(state);
      if (command.actor.kind !== "system") {
        fail("SYSTEM_REQUIRED", "Lease expiry is recorded by the runtime clock.");
      }
      const lease = state.workLeases[command.leaseId];
      if (!lease) fail("UNKNOWN_LEASE", `Unknown lease: ${command.leaseId}`);
      if (![LEASE_STATES.CLAIMED, LEASE_STATES.RUNNING].includes(lease.status)) {
        fail("LEASE_NOT_ACTIVE", `Lease ${lease.id} is ${lease.status}.`);
      }
      if (Date.parse(command.occurredAt) < Date.parse(lease.expiresAt)) {
        fail("LEASE_NOT_EXPIRED", `Lease ${lease.id} has not reached expiry.`);
      }
      const specs = [
        {
          type: "WorkLeaseExpired",
          aggregateId: lease.id,
          artifactRefs: [],
          payload: { leaseId: lease.id },
        },
      ];
      if (lease.status === LEASE_STATES.RUNNING) {
        specs.push({
          type: "BlockerAdded",
          aggregateId: lease.nodeId,
          artifactRefs: [],
          payload: {
            nodeId: lease.nodeId,
            blocker: {
              id: `lease-expired:${lease.id}`,
              reason: "执行租约过期，需确认工作是否完整保存",
              owner: state.researchOwnerId,
              resolveWhen: "确认恢复点并重新分配执行者",
            },
          },
        });
      }
      return specs;
    }

    case "PRODUCE_ARTIFACT": {
      assertProjectCreated(state);
      const node = assertNode(machine, command.nodeId);
      const runtimeNode = state.nodeExecutions[command.nodeId];
      if (runtimeNode.state !== EXECUTION_STATES.RUNNING) {
        fail("INVALID_NODE_STATE", "Artifacts can only be produced by a running node.");
      }
      if (runtimeNode.startedBy?.actorId !== command.actor.id) {
        fail("ACTOR_MISMATCH", "Only the node executor can produce its artifact.");
      }
      const activeLease = assertRunningLeaseForAgent(state, runtimeNode, command);
      if (state.artifacts[command.artifact?.id]) {
        fail("ARTIFACT_EXISTS", `Artifact already exists: ${command.artifact.id}`);
      }
      const hasProvidedHash = typeof command.artifact?.contentHash === "string";
      const hasContent = Object.prototype.hasOwnProperty.call(
        command.artifact ?? {},
        "content",
      );
      if (!hasProvidedHash && (!hasContent || command.artifact.content === undefined)) {
        fail("MISSING_ARTIFACT_CONTENT", "Provide artifact content or a content hash.");
      }
      if (
        hasProvidedHash &&
        !/^[a-f0-9]{64}$/i.test(command.artifact.contentHash)
      ) {
        fail("INVALID_CONTENT_HASH", "Artifact contentHash must be a SHA-256 hash.");
      }
      if (
        hasProvidedHash &&
        hasContent &&
        command.artifact.contentHash.toLowerCase() !== sha256(command.artifact.content)
      ) {
        fail(
          "ARTIFACT_CONTENT_HASH_MISMATCH",
          "Artifact contentHash does not match its normalized content.",
          { artifactId: command.artifact.id },
        );
      }
      if (researchArtifactContentNeedsValidation(command.artifact?.type)) {
        if (!hasContent || command.artifact.content === undefined) {
          fail(
            "MISSING_VALIDATABLE_ARTIFACT_CONTENT",
            `${command.artifact.type} requires content so its scientific contract can be validated.`,
          );
        }
        const contentIssues = validateResearchArtifactContent(
          command.artifact.type,
          command.artifact.content,
        );
        if (contentIssues.length > 0) {
          fail(
            "ARTIFACT_CONTENT_CONTRACT_VIOLATION",
            `${command.artifact.type} content does not satisfy its scientific contract.`,
            {
              artifactType: command.artifact.type,
              issues: contentIssues,
            },
          );
        }
        if (command.artifact.content.id !== command.artifact.id) {
          fail(
            "ARTIFACT_CONTENT_ID_MISMATCH",
            "Structured research content id must equal its artifact id.",
            {
              artifactId: command.artifact.id,
              contentId: command.artifact.content.id,
            },
          );
        }
        if (
          command.artifact.type === "ResearchConclusionCard" &&
          command.artifact.content.producerId !== command.actor.id
        ) {
          fail(
            "ARTIFACT_CONTENT_ACTOR_MISMATCH",
            "A conclusion card must identify its actual producing actor.",
          );
        }
        if (
          command.artifact.type === "EvidenceVerificationReport" &&
          command.artifact.content.verifierId !== command.actor.id
        ) {
          fail(
            "ARTIFACT_CONTENT_ACTOR_MISMATCH",
            "An evidence verification report must identify its actual verifier.",
          );
        }
      }
      const artifact = {
        id: command.artifact?.id,
        type: command.artifact?.type,
        lineageId: command.artifact?.lineageId,
        version: command.artifact?.version,
        contentHash:
          command.artifact?.contentHash ?? sha256(command.artifact?.content),
        status: ARTIFACT_STATES.CANDIDATE,
        freshness: ARTIFACT_FRESHNESS.CURRENT,
        producedByNodeId: command.nodeId,
        producedByActorId: command.actor.id,
        producedByActorRole: command.actor.role,
        producedUnderLeaseId: activeLease?.id ?? null,
        producedAt: command.occurredAt,
        inputArtifactRefs: [...(command.artifact?.inputArtifactRefs ?? [])],
        sourceRef: command.artifact?.sourceRef ?? null,
        locator: command.artifact?.locator ?? null,
      };
      if (!artifact.id || !artifact.type || !artifact.lineageId) {
        fail("INVALID_ARTIFACT", "Artifact id, type, and lineageId are required.");
      }
      if (!Number.isInteger(artifact.version) || artifact.version < 1) {
        fail("INVALID_ARTIFACT", "Artifact version must be a positive integer.");
      }
      const lineageArtifacts = Object.values(state.artifacts).filter(
        (item) => item.lineageId === artifact.lineageId,
      );
      if (lineageArtifacts.some((item) => item.version === artifact.version)) {
        fail(
          "ARTIFACT_VERSION_EXISTS",
          `Version ${artifact.version} already exists in lineage ${artifact.lineageId}.`,
        );
      }
      if (
        lineageArtifacts.length > 0 &&
        artifact.version <= Math.max(...lineageArtifacts.map((item) => item.version))
      ) {
        fail("ARTIFACT_VERSION_NOT_NEWER", "A new artifact version must advance its lineage.");
      }
      const inputArtifacts = ensureArtifactRefs(state, artifact.inputArtifactRefs, [
        ARTIFACT_STATES.VERIFIED,
        ARTIFACT_STATES.ACCEPTED,
      ], { allowEmpty: node.kind === "input" });
      if (artifact.type === "ResearchConclusionCard") {
        const acceptedEvidenceIds = new Set(
          inputArtifacts
            .filter((inputArtifact) => inputArtifact.type === "EvidenceRecord")
            .map((inputArtifact) => inputArtifact.id),
        );
        const contentEvidenceIds = [
          ...command.artifact.content.supportingEvidenceIds,
          ...command.artifact.content.counterEvidenceIds,
        ];
        const unboundEvidenceIds = contentEvidenceIds.filter(
          (evidenceId) => !acceptedEvidenceIds.has(evidenceId),
        );
        if (unboundEvidenceIds.length > 0) {
          fail(
            "UNBOUND_CONCLUSION_EVIDENCE",
            "Conclusion evidence ids must be accepted EvidenceRecord inputs.",
            { unboundEvidenceIds },
          );
        }
      }
      if (artifact.type === "EvidenceVerificationReport") {
        const inputConclusionArtifacts = inputArtifacts.filter(
          (inputArtifact) => inputArtifact.type === "ResearchConclusionCard",
        );
        const inputConclusionIds = new Set(
          inputConclusionArtifacts.map((inputArtifact) => inputArtifact.id),
        );
        const reportConclusionIds = command.artifact.content.conclusionCardIds;
        if (
          inputConclusionIds.size !== reportConclusionIds.length ||
          reportConclusionIds.some((conclusionId) => !inputConclusionIds.has(conclusionId))
        ) {
          fail(
            "VERIFICATION_TARGET_MISMATCH",
            "Verification report targets must equal its conclusion-card inputs.",
          );
        }
        if (
          inputConclusionArtifacts.some(
            (inputArtifact) =>
              inputArtifact.producedByActorId !== command.artifact.content.producerId,
          )
        ) {
          fail(
            "VERIFICATION_PRODUCER_MISMATCH",
            "Verification report must identify the actual conclusion producer.",
          );
        }
      }
      if (node.kind !== "input") {
        assertArtifactsMatchContracts(
          inputArtifacts,
          node.inputs,
          `Inputs for ${node.id}`,
        );
      }
      const allowedOutput = node.outputs.some(
        (output) => output.split("@")[0].replace("[]", "") === artifact.type,
      );
      if (!allowedOutput) {
        fail("OUTPUT_TYPE_NOT_DECLARED", `${artifact.type} is not declared by ${node.id}.`);
      }
      artifact.manifestHash = artifactManifestHash(artifact);
      return [
        {
          type: "ArtifactProduced",
          aggregateId: artifact.id,
          artifactRefs: artifact.inputArtifactRefs,
          payload: { artifact, leaseId: activeLease?.id ?? null },
        },
      ];
    }

    case "SUBMIT_NODE": {
      assertProjectCreated(state);
      assertNode(machine, command.nodeId);
      const runtimeNode = state.nodeExecutions[command.nodeId];
      if (runtimeNode.state !== EXECUTION_STATES.RUNNING) {
        fail("INVALID_NODE_STATE", "Only running nodes can enter review.");
      }
      const activeLease = assertRunningLeaseForAgent(state, runtimeNode, command);
      const artifacts = ensureArtifactRefs(state, command.artifactIds, [
        ARTIFACT_STATES.CANDIDATE,
        ARTIFACT_STATES.VERIFIED,
      ]);
      if (artifacts.some((artifact) => artifact.producedByNodeId !== command.nodeId)) {
        fail("ARTIFACT_NODE_MISMATCH", "Submitted artifacts must come from this node.");
      }
      assertArtifactsMatchContracts(
        artifacts,
        nodeById(machine, command.nodeId).outputs,
        `Outputs submitted by ${command.nodeId}`,
      );
      const specs = [
        {
          type: "NodeSubmittedForReview",
          aggregateId: command.nodeId,
          artifactRefs: [...command.artifactIds],
          payload: {
            nodeId: command.nodeId,
            artifactIds: [...command.artifactIds],
            leaseId: activeLease?.id ?? null,
          },
        },
      ];
      if (activeLease) {
        specs.push({
          type: "WorkLeaseReleased",
          aggregateId: activeLease.id,
          artifactRefs: [],
          payload: {
            leaseId: activeLease.id,
            reason: "submitted_for_review",
          },
        });
      }
      return specs;
    }

    case "VERIFY_ARTIFACT": {
      assertProjectCreated(state);
      const artifact = state.artifacts[command.artifactId];
      if (!artifact) fail("UNKNOWN_ARTIFACT", `Unknown artifact: ${command.artifactId}`);
      if (artifact.status !== ARTIFACT_STATES.CANDIDATE) {
        fail("INVALID_ARTIFACT_STATUS", "Only candidate artifacts can be verified.");
      }
      if (artifact.producedByActorId === command.actor.id) {
        fail("SELF_REVIEW", "An artifact producer cannot verify the same artifact.");
      }
      const node = assertNode(machine, artifact.producedByNodeId);
      const runtimeNode = state.nodeExecutions[node.id];
      if (
        runtimeNode.state !== EXECUTION_STATES.REVIEW ||
        !runtimeNode.submittedArtifactIds.includes(artifact.id)
      ) {
        fail(
          "ARTIFACT_NOT_SUBMITTED",
          "Only an artifact in its node's current review set can be verified.",
        );
      }
      if (node.reviewerRole && command.actor.role !== node.reviewerRole) {
        fail("REVIEWER_ROLE_MISMATCH", `Expected reviewer role ${node.reviewerRole}.`);
      }
      if (!new Set(["pass", "partial", "fail"]).has(command.verdict)) {
        fail("INVALID_VERDICT", "Verdict must be pass, partial, or fail.");
      }
      if (command.verdict === "partial" && !command.limitations) {
        fail("MISSING_LIMITATIONS", "Partial verification requires limitations.");
      }
      return [
        {
          type: command.verdict === "fail" ? "ArtifactRejected" : "ArtifactVerified",
          aggregateId: command.artifactId,
          artifactRefs: [command.artifactId],
          payload: {
            artifactId: command.artifactId,
            verdict: command.verdict,
            limitations: command.limitations ?? null,
            verifiedBy: {
              actorId: command.actor.id,
              actorRole: command.actor.role,
              actorKind: command.actor.kind,
            },
          },
        },
      ];
    }

    case "ACCEPT_NODE": {
      assertProjectCreated(state);
      const node = assertNode(machine, command.nodeId);
      if (node.kind === "human_gate") {
        fail("GATE_REQUIRES_HUMAN_DECISION", "Use REQUEST_GATE and DECIDE_GATE.");
      }
      const runtimeNode = state.nodeExecutions[command.nodeId];
      if (runtimeNode.state !== EXECUTION_STATES.REVIEW) {
        fail("INVALID_NODE_STATE", "Only reviewed nodes can be accepted.");
      }
      if (node.reviewerRole && command.actor.role !== node.reviewerRole) {
        fail("REVIEWER_ROLE_MISMATCH", `Expected reviewer role ${node.reviewerRole}.`);
      }
      if (runtimeNode.startedBy?.actorId === command.actor.id) {
        fail("SELF_REVIEW", "The node executor cannot accept their own node.");
      }
      assertSameArtifactIds(
        command.artifactIds,
        runtimeNode.submittedArtifactIds,
        `Acceptance for ${command.nodeId}`,
      );
      const allowedProofArtifactIds = new Set([
        ...runtimeNode.submittedArtifactIds,
        ...runtimeNode.submittedArtifactIds.flatMap(
          (artifactId) => state.artifacts[artifactId]?.inputArtifactRefs ?? [],
        ),
      ]);
      normalizeProofs(
        node,
        command.criteriaProofs,
        state,
        allowedProofArtifactIds,
      );
      const artifacts = ensureArtifactRefs(state, command.artifactIds, [
        ARTIFACT_STATES.VERIFIED,
        ARTIFACT_STATES.ACCEPTED,
      ]);
      if (artifacts.some((artifact) => artifact.producedByNodeId !== command.nodeId)) {
        fail("ARTIFACT_NODE_MISMATCH", "Accepted artifacts must come from this node.");
      }
      assertArtifactsMatchContracts(
        artifacts,
        node.outputs,
        `Outputs accepted for ${command.nodeId}`,
      );
      const specs = artifacts
        .filter((artifact) => artifact.status !== ARTIFACT_STATES.ACCEPTED)
        .map((artifact) => ({
          type: "ArtifactAccepted",
          aggregateId: artifact.id,
          artifactRefs: [artifact.id],
          payload: {
            artifactId: artifact.id,
            acceptedBy: {
              actorId: command.actor.id,
              actorRole: command.actor.role,
              actorKind: command.actor.kind,
            },
          },
        }));
      specs.push({
        type: "NodeAccepted",
        aggregateId: command.nodeId,
        artifactRefs: [...command.artifactIds],
        payload: {
          nodeId: command.nodeId,
          artifactIds: [...command.artifactIds],
          criteriaProofs: command.criteriaProofs,
        },
      });
      return specs;
    }

    case "ADD_BLOCKER": {
      assertProjectCreated(state);
      assertNode(machine, command.nodeId);
      if (
        [
          EXECUTION_STATES.ACCEPTED,
          EXECUTION_STATES.SUPERSEDED,
          EXECUTION_STATES.CANCELLED,
        ].includes(state.nodeExecutions[command.nodeId].state)
      ) {
        fail(
          "INVALID_NODE_STATE",
          "Accepted or closed work must be amended before adding a blocker.",
        );
      }
      const blocker = command.blocker;
      if (!blocker?.id || !blocker.reason || !blocker.owner || !blocker.resolveWhen) {
        fail("INVALID_BLOCKER", "Blockers require id, reason, owner, and resolveWhen.");
      }
      if (state.nodeExecutions[command.nodeId].blockers[blocker.id]) {
        fail("BLOCKER_EXISTS", `Blocker already exists: ${blocker.id}`);
      }
      const runtimeNode = state.nodeExecutions[command.nodeId];
      const activeLease = runtimeNode.activeLeaseId
        ? state.workLeases[runtimeNode.activeLeaseId]
        : null;
      if (
        activeLease &&
        [LEASE_STATES.CLAIMED, LEASE_STATES.RUNNING].includes(activeLease.status)
      ) {
        const isResearchOwner =
          command.actor.kind === "human" &&
          command.actor.id === state.researchOwnerId;
        const isRuntime = command.actor.kind === "system";
        const isLeaseOwner = activeLease.claimedBy.actorId === command.actor.id;
        if (!isResearchOwner && !isRuntime && !isLeaseOwner) {
          fail(
            "LEASE_OWNER_MISMATCH",
            "Only the research owner, runtime, or lease owner can block active work.",
          );
        }
      }
      const specs = [];
      if (
        activeLease &&
        [LEASE_STATES.CLAIMED, LEASE_STATES.RUNNING].includes(activeLease.status)
      ) {
        specs.push({
          type: "WorkLeaseReleased",
          aggregateId: activeLease.id,
          artifactRefs: [],
          payload: {
            leaseId: activeLease.id,
            reason: `blocked:${blocker.id}`,
          },
        });
      }
      specs.push(
        {
          type: "BlockerAdded",
          aggregateId: command.nodeId,
          artifactRefs: [],
          payload: { nodeId: command.nodeId, blocker },
        },
      );
      return specs;
    }

    case "RESOLVE_BLOCKER": {
      assertProjectCreated(state);
      const blocker = state.nodeExecutions[command.nodeId]?.blockers[command.blockerId];
      if (!blocker) fail("UNKNOWN_BLOCKER", `Unknown blocker: ${command.blockerId}`);
      if (blocker.status === "resolved") fail("BLOCKER_RESOLVED", "Blocker is already resolved.");
      if (!command.resolution) fail("MISSING_RESOLUTION", "Resolution is required.");
      return [
        {
          type: "BlockerResolved",
          aggregateId: command.nodeId,
          artifactRefs: [],
          payload: {
            nodeId: command.nodeId,
            blockerId: command.blockerId,
            resolution: command.resolution,
            resolvedBy: {
              actorId: command.actor.id,
              actorRole: command.actor.role,
              actorKind: command.actor.kind,
            },
          },
        },
      ];
    }

    case "CANCEL_NODE": {
      assertProjectCreated(state);
      const node = assertNode(machine, command.nodeId);
      const runtimeNode = state.nodeExecutions[node.id];
      if (
        [
          EXECUTION_STATES.ACCEPTED,
          EXECUTION_STATES.SUPERSEDED,
          EXECUTION_STATES.CANCELLED,
        ].includes(runtimeNode.state)
      ) {
        fail(
          "INVALID_NODE_STATE",
          `Cannot cancel node from ${runtimeNode.state}.`,
        );
      }
      if (!command.reason) {
        fail("MISSING_REASON", "Cancelling research work requires a reason.");
      }

      const activeLease = runtimeNode.activeLeaseId
        ? state.workLeases[runtimeNode.activeLeaseId]
        : null;
      const isResearchOwner =
        command.actor.kind === "human" &&
        command.actor.id === state.researchOwnerId;
      const isRuntime = command.actor.kind === "system";
      const isLeaseOwner =
        activeLease?.claimedBy?.actorId === command.actor.id &&
        [LEASE_STATES.CLAIMED, LEASE_STATES.RUNNING].includes(
          activeLease.status,
        );
      if (!isResearchOwner && !isRuntime && !isLeaseOwner) {
        fail(
          "UNAUTHORIZED_NODE_CANCELLATION",
          "Only the research owner, runtime, or active lease owner can cancel work.",
        );
      }

      const specs = [];
      if (isLeaseOwner || (activeLease && isResearchOwner) || (activeLease && isRuntime)) {
        if (
          ![LEASE_STATES.CLAIMED, LEASE_STATES.RUNNING].includes(
            activeLease.status,
          )
        ) {
          fail("LEASE_NOT_ACTIVE", `Lease ${activeLease.id} is ${activeLease.status}.`);
        }
        specs.push({
          type: "WorkLeaseReleased",
          aggregateId: activeLease.id,
          artifactRefs: [],
          payload: {
            leaseId: activeLease.id,
            reason: `node_cancelled:${command.reason}`,
          },
        });
      }

      for (const gate of Object.values(state.gates)) {
        if (gate.nodeId === node.id && gate.status === GATE_STATES.PENDING) {
          specs.push({
            type: "GateInvalidated",
            aggregateId: gate.id,
            artifactRefs: gate.artifactRefs.map((ref) => ref.artifactId),
            payload: {
              gateId: gate.id,
              reason: `node_cancelled:${command.reason}`,
            },
          });
        }
      }

      specs.push({
        type: "NodeCancelled",
        aggregateId: node.id,
        artifactRefs: [],
        payload: {
          nodeId: node.id,
          reason: command.reason,
          cancelledLeaseId: activeLease?.id ?? null,
          cancelledBy: {
            actorId: command.actor.id,
            actorRole: command.actor.role,
            actorKind: command.actor.kind,
          },
        },
      });
      return specs;
    }

    case "REQUEST_GATE": {
      assertProjectCreated(state);
      const node = assertNode(machine, command.nodeId);
      if (node.kind !== "human_gate") {
        fail("NOT_HUMAN_GATE", `${command.nodeId} is not a human gate.`);
      }
      if (state.gates[command.gateId]) fail("GATE_EXISTS", `Gate already exists: ${command.gateId}`);
      const runtimeNode = state.nodeExecutions[command.nodeId];
      if (runtimeNode.state !== EXECUTION_STATES.READY) {
        fail("INVALID_NODE_STATE", "A gate must be ready before it is requested.");
      }
      assertDependenciesAccepted(machine, state, command.nodeId);
      const artifacts = ensureArtifactRefs(state, command.artifactIds, [
        ARTIFACT_STATES.VERIFIED,
        ARTIFACT_STATES.ACCEPTED,
      ]);
      assertArtifactsMatchContracts(
        artifacts,
        node.inputs,
        `Gate inputs for ${command.nodeId}`,
      );
      assertGateInputsAreAcceptedDependencyOutputs(
        machine,
        state,
        node,
        artifacts,
      );
      const artifactRefs = artifacts.map((artifact) => ({
        artifactId: artifact.id,
        contentHash: artifact.contentHash,
        manifestHash: artifact.manifestHash,
        version: artifact.version,
      }));
      const gate = {
        id: command.gateId,
        nodeId: command.nodeId,
        status: GATE_STATES.PENDING,
        artifactRefs,
        fingerprint: artifactFingerprint(artifacts),
        requestedBy: {
          actorId: command.actor.id,
          actorRole: command.actor.role,
          actorKind: command.actor.kind,
        },
        requestedAt: command.occurredAt,
      };
      return [
        {
          type: "GateRequested",
          aggregateId: gate.id,
          artifactRefs: [...command.artifactIds],
          payload: { gate },
        },
      ];
    }

    case "DECIDE_GATE": {
      assertProjectCreated(state);
      if (command.actor.kind !== "human") {
        fail("HUMAN_REQUIRED", "Only a human can decide a research gate.");
      }
      const gate = state.gates[command.gateId];
      if (!gate) fail("UNKNOWN_GATE", `Unknown gate: ${command.gateId}`);
      const gateNode = assertNode(machine, gate.nodeId);
      if (command.actor.id !== state.researchOwnerId) {
        fail("UNAUTHORIZED_PRINCIPAL", "Only the designated research owner can decide this gate.");
      }
      if (!(gateNode.approverRoles ?? []).includes(command.actor.role)) {
        fail(
          "APPROVER_ROLE_MISMATCH",
          `Gate ${gate.id} requires one of: ${(gateNode.approverRoles ?? []).join(", ")}.`,
        );
      }
      if (gate.status !== GATE_STATES.PENDING) {
        fail("GATE_NOT_PENDING", `Gate is ${gate.status}, not pending.`);
      }
      if (command.gateFingerprint !== gate.fingerprint) {
        fail("GATE_FINGERPRINT_MISMATCH", "The decision does not target the requested artifact versions.");
      }
      for (const ref of gate.artifactRefs) {
        const current = state.artifacts[ref.artifactId];
        if (
          !current ||
          current.version !== ref.version ||
          current.contentHash !== ref.contentHash ||
          current.manifestHash !== ref.manifestHash ||
          ![ARTIFACT_STATES.VERIFIED, ARTIFACT_STATES.ACCEPTED].includes(
            current.status,
          )
        ) {
          fail(
            "GATE_TARGET_INVALID",
            "A requested artifact changed or is no longer eligible for approval.",
            { artifactId: ref.artifactId },
          );
        }
      }
      if (!command.reason) fail("MISSING_DECISION_REASON", "Human decisions require a reason.");
      if (
        ![
          GATE_STATES.APPROVED,
          GATE_STATES.REJECTED,
          GATE_STATES.AMENDMENT_REQUESTED,
          GATE_STATES.ACCEPTED_RISK,
        ].includes(command.decision)
      ) {
        fail("INVALID_GATE_DECISION", `Unsupported decision: ${command.decision}`);
      }
      const accepts =
        command.decision === GATE_STATES.APPROVED ||
        command.decision === GATE_STATES.ACCEPTED_RISK;
      let decisionArtifacts = [];
      if (accepts) {
        if (!Array.isArray(command.decisionArtifacts)) {
          fail(
            "MISSING_DECISION_ARTIFACTS",
            "An approving decision must record the gate's declared outputs.",
          );
        }
        const ids = command.decisionArtifacts.map((artifact) => artifact.id);
        if (new Set(ids).size !== ids.length) {
          fail("DUPLICATE_ARTIFACT_ID", "Decision artifacts need unique ids.");
        }
        const lineageVersions = command.decisionArtifacts.map(
          (artifact) => `${artifact.lineageId}@${artifact.version}`,
        );
        if (new Set(lineageVersions).size !== lineageVersions.length) {
          fail(
            "ARTIFACT_VERSION_EXISTS",
            "Decision artifacts contain a duplicate lineage version.",
          );
        }
        decisionArtifacts = command.decisionArtifacts.map((raw) => {
          if (state.artifacts[raw.id]) {
            fail("ARTIFACT_EXISTS", `Artifact already exists: ${raw.id}`);
          }
          if (
            Object.values(state.artifacts).some(
              (artifact) =>
                artifact.lineageId === raw.lineageId &&
                artifact.version === raw.version,
            )
          ) {
            fail(
              "ARTIFACT_VERSION_EXISTS",
              `Version ${raw.version} exists in lineage ${raw.lineageId}.`,
            );
          }
          if (!raw.id || !raw.type || !raw.lineageId) {
            fail(
              "INVALID_ARTIFACT",
              "Decision artifact id, type, and lineageId are required.",
            );
          }
          if (!Number.isInteger(raw.version) || raw.version < 1) {
            fail("INVALID_ARTIFACT", "Decision artifact version must be positive.");
          }
          const hasHash = typeof raw.contentHash === "string";
          if (hasHash && !/^[a-f0-9]{64}$/i.test(raw.contentHash)) {
            fail("INVALID_CONTENT_HASH", `Invalid content hash for ${raw.id}.`);
          }
          if (
            !hasHash &&
            (!Object.prototype.hasOwnProperty.call(raw, "content") ||
              raw.content === undefined)
          ) {
            fail("MISSING_ARTIFACT_CONTENT", `Decision artifact ${raw.id} needs content.`);
          }
          const hasContent = Object.prototype.hasOwnProperty.call(raw, "content");
          if (
            hasHash &&
            hasContent &&
            raw.contentHash.toLowerCase() !== sha256(raw.content)
          ) {
            fail(
              "ARTIFACT_CONTENT_HASH_MISMATCH",
              `Decision artifact ${raw.id} content does not match its hash.`,
            );
          }
          if (researchArtifactContentNeedsValidation(raw.type)) {
            if (!hasContent || raw.content === undefined) {
              fail(
                "MISSING_VALIDATABLE_ARTIFACT_CONTENT",
                `${raw.type} requires content so its scientific contract can be validated.`,
              );
            }
            const contentIssues = validateResearchArtifactContent(raw.type, raw.content);
            if (contentIssues.length > 0) {
              fail(
                "ARTIFACT_CONTENT_CONTRACT_VIOLATION",
                `${raw.type} content does not satisfy its scientific contract.`,
                { artifactType: raw.type, issues: contentIssues },
              );
            }
            if (raw.content.id !== raw.id) {
              fail(
                "ARTIFACT_CONTENT_ID_MISMATCH",
                "Structured decision content id must equal its artifact id.",
                { artifactId: raw.id, contentId: raw.content.id },
              );
            }
            if (
              raw.type === "FrozenWritingPlan" &&
              (raw.content.approvedBy?.id !== command.actor.id ||
                raw.content.approvedBy?.role !== command.actor.role ||
                raw.content.approvedBy?.kind !== "human")
            ) {
              fail(
                "ARTIFACT_CONTENT_ACTOR_MISMATCH",
                "A frozen writing plan must identify the human who approved this gate.",
              );
            }
            if (
              raw.type === "AcceptedClaimUnit" &&
              (raw.content.acceptedBy?.id !== command.actor.id ||
                raw.content.acceptedBy?.role !== command.actor.role ||
                raw.content.acceptedBy?.kind !== "human")
            ) {
              fail(
                "ARTIFACT_CONTENT_ACTOR_MISMATCH",
                "An accepted claim unit must identify the human who approved this gate.",
              );
            }
            if (
              ["AuthorApproval", "SignedDelivery"].includes(raw.type) &&
              (raw.content.signedBy?.id !== command.actor.id ||
                raw.content.signedBy?.role !== command.actor.role ||
                raw.content.signedBy?.kind !== "human")
            ) {
              fail(
                "ARTIFACT_CONTENT_ACTOR_MISMATCH",
                "Author sign-off artifacts must identify the human who approved this gate.",
              );
            }
            if (
              ["AuthorApproval", "SignedDelivery"].includes(raw.type) &&
              (raw.content.gateId !== gate.id ||
                raw.content.gateFingerprint !== gate.fingerprint)
            ) {
              fail(
                "ARTIFACT_CONTENT_GATE_MISMATCH",
                "Author sign-off artifacts must bind the exact pending gate fingerprint.",
              );
            }
          }
          const artifact = {
            id: raw.id,
            type: raw.type,
            lineageId: raw.lineageId,
            version: raw.version,
            contentHash: raw.contentHash ?? sha256(raw.content),
            status: ARTIFACT_STATES.ACCEPTED,
            freshness: ARTIFACT_FRESHNESS.CURRENT,
            producedByNodeId: gate.nodeId,
            producedByActorId: command.actor.id,
            producedByActorRole: command.actor.role,
            producedAt: command.occurredAt,
            inputArtifactRefs: gate.artifactRefs.map((ref) => ref.artifactId),
            sourceRef: raw.sourceRef ?? `gate:${gate.id}`,
            locator: raw.locator ?? null,
            acceptedBy: {
              actorId: command.actor.id,
              actorRole: command.actor.role,
              actorKind: command.actor.kind,
            },
            acceptedAt: command.occurredAt,
            acceptedRisk:
              command.decision === GATE_STATES.ACCEPTED_RISK
                ? { reason: command.reason }
                : null,
          };
          artifact.manifestHash = artifactManifestHash(artifact);
          return artifact;
        });
        assertArtifactsMatchContracts(
          decisionArtifacts,
          gateNode.outputs,
          `Decision outputs for ${gate.nodeId}`,
        );
      } else if ((command.decisionArtifacts ?? []).length > 0) {
        fail(
          "UNEXPECTED_DECISION_ARTIFACTS",
          "Rejected or amended gates cannot emit accepted decision outputs.",
        );
      }
      const specs = [];
      if (accepts) {
        for (const ref of gate.artifactRefs) {
          if (state.artifacts[ref.artifactId].status !== ARTIFACT_STATES.ACCEPTED) {
            specs.push({
              type: "ArtifactAccepted",
              aggregateId: ref.artifactId,
              artifactRefs: [ref.artifactId],
              payload: {
                artifactId: ref.artifactId,
                acceptedBy: {
                  actorId: command.actor.id,
                  actorRole: command.actor.role,
                  actorKind: command.actor.kind,
                },
              },
            });
          }
        }
        for (const artifact of decisionArtifacts) {
          specs.push({
            type: "HumanDecisionArtifactRecorded",
            aggregateId: artifact.id,
            artifactRefs: [...artifact.inputArtifactRefs],
            payload: { artifact },
          });
        }
      }
      specs.push({
        type: "HumanDecisionRecorded",
        aggregateId: gate.id,
        artifactRefs: gate.artifactRefs.map((ref) => ref.artifactId),
        payload: {
          gateId: gate.id,
          decision: command.decision,
          reason: command.reason,
          decisionArtifactIds: decisionArtifacts.map((artifact) => artifact.id),
          decidedBy: {
            actorId: command.actor.id,
            actorRole: command.actor.role,
            actorKind: command.actor.kind,
          },
        },
      });
      if (command.decision === GATE_STATES.AMENDMENT_REQUESTED) {
        const amendmentTargetNodeId = gateNode.amendmentTargetNodeId;
        if (
          !amendmentTargetNodeId ||
          !hardDependencyAncestorIds(machine, gateNode.id).has(amendmentTargetNodeId)
        ) {
          fail(
            "INVALID_AMENDMENT_TARGET",
            `Gate ${gateNode.id} has no valid upstream amendment target.`,
          );
        }
        const correctionId =
          command.correctionId ?? `gate-amendment:${gate.id}:${gate.fingerprint}`;
        if (state.corrections.some((item) => item.id === correctionId)) {
          fail("CORRECTION_EXISTS", `Correction already exists: ${correctionId}`);
        }
        const artifactIds = gate.artifactRefs.map((ref) => ref.artifactId);
        specs.push({
          type: "HumanCorrectionRecorded",
          aggregateId: correctionId,
          artifactRefs: artifactIds,
          payload: {
            correction: {
              id: correctionId,
              reason: command.reason,
              correctedBy: {
                actorId: command.actor.id,
                actorRole: command.actor.role,
              },
              correctedAt: command.occurredAt,
              artifactIds,
              focusNodeId: amendmentTargetNodeId,
              amendmentTargetNodeId,
              sourceGateId: gate.id,
              sourceGateFingerprint: gate.fingerprint,
            },
          },
        });
        specs.push(
          ...staleEventSpecs(
            machine,
            state,
            artifactIds,
            command.reason,
            correctionId,
            { excludeGateIds: [gate.id] },
          ),
        );
        specs.push({
          type: "ProjectFocusSet",
          aggregateId: command.projectId,
          artifactRefs: [],
          payload: { nodeId: amendmentTargetNodeId },
        });
      }
      return specs;
    }

    case "SUPERSEDE_ARTIFACT": {
      assertProjectCreated(state);
      const oldArtifact = state.artifacts[command.artifactId];
      const newArtifact = state.artifacts[command.supersededBy];
      if (!oldArtifact || !newArtifact) {
        fail("UNKNOWN_ARTIFACT", "Both old and replacement artifacts must exist.");
      }
      if (
        ![
          ARTIFACT_STATES.CANDIDATE,
          ARTIFACT_STATES.VERIFIED,
          ARTIFACT_STATES.ACCEPTED,
        ].includes(oldArtifact.status)
      ) {
        fail(
          "ARTIFACT_NOT_SUPERSEDABLE",
          `Artifact ${oldArtifact.id} is ${oldArtifact.status}.`,
        );
      }
      if (oldArtifact.lineageId !== newArtifact.lineageId) {
        fail("LINEAGE_MISMATCH", "Replacement artifacts must share a lineage.");
      }
      if (newArtifact.version <= oldArtifact.version) {
        fail("VERSION_NOT_NEWER", "Replacement artifact version must be newer.");
      }
      if (![ARTIFACT_STATES.VERIFIED, ARTIFACT_STATES.ACCEPTED].includes(newArtifact.status)) {
        fail("REPLACEMENT_NOT_VERIFIED", "Replacement artifact must be verified or accepted.");
      }
      if (!command.reason) fail("MISSING_REASON", "Supersession requires a reason.");
      return [
        {
          type: "ArtifactSuperseded",
          aggregateId: oldArtifact.id,
          artifactRefs: [oldArtifact.id, newArtifact.id],
          payload: {
            artifactId: oldArtifact.id,
            supersededBy: newArtifact.id,
            reason: command.reason,
          },
        },
        ...staleEventSpecs(
          machine,
          state,
          [oldArtifact.id],
          command.reason,
          null,
          {
            markRootsStale: false,
            excludeArtifactIds: [newArtifact.id],
          },
        ),
      ];
    }

    case "RECORD_HUMAN_CORRECTION": {
      assertProjectCreated(state);
      if (command.actor.kind !== "human") {
        fail("HUMAN_REQUIRED", "Only a human can record a research correction.");
      }
      if (command.actor.id !== state.researchOwnerId) {
        fail("UNAUTHORIZED_PRINCIPAL", "Only the research owner can change the research course.");
      }
      if (!command.correctionId || !command.reason) {
        fail("INVALID_CORRECTION", "Correction id and reason are required.");
      }
      if (state.corrections.some((item) => item.id === command.correctionId)) {
        fail("CORRECTION_EXISTS", `Correction already exists: ${command.correctionId}`);
      }
      assertNode(machine, command.focusNodeId);
      ensureArtifactRefs(state, command.artifactIds, [
        ARTIFACT_STATES.CANDIDATE,
        ARTIFACT_STATES.VERIFIED,
        ARTIFACT_STATES.ACCEPTED,
      ]);
      const specs = [
        {
          type: "HumanCorrectionRecorded",
          aggregateId: command.correctionId,
          artifactRefs: [...command.artifactIds],
          payload: {
            correction: {
              id: command.correctionId,
              reason: command.reason,
              correctedBy: {
                actorId: command.actor.id,
                actorRole: command.actor.role,
              },
              correctedAt: command.occurredAt,
              artifactIds: [...command.artifactIds],
              focusNodeId: command.focusNodeId,
            },
          },
        },
        ...staleEventSpecs(
          machine,
          state,
          command.artifactIds,
          command.reason,
          command.correctionId,
        ),
        {
          type: "ProjectFocusSet",
          aggregateId: command.projectId,
          artifactRefs: [],
          payload: { nodeId: command.focusNodeId },
        },
      ];
      return specs;
    }

    case "REVISE_RETRIEVAL_PROTOCOL": {
      assertProjectCreated(state);
      if (
        command.actor.kind !== "human" ||
        command.actor.id !== state.researchOwnerId
      ) {
        fail(
          "UNAUTHORIZED_PROTOCOL_REVISION",
          "Only the designated human research owner can revise a formal retrieval protocol.",
        );
      }
      const blockedNode = assertNode(machine, command.blockedNodeId);
      const blockedRuntime = state.nodeExecutions[blockedNode.id];
      if (blockedRuntime.state !== EXECUTION_STATES.BLOCKED) {
        fail(
          "RETRIEVAL_PROTOCOL_REVISION_NOT_ALLOWED",
          "A formal retrieval protocol can only be revised at its blocked retrieval node.",
        );
      }
      const blocker = blockedRuntime.blockers[command.blockerId];
      if (!blocker || blocker.status === "resolved") {
        fail("OPEN_BLOCKER_NOT_FOUND", "The protocol revision must target an open blocker.");
      }
      if (!command.reason || !command.correctionId) {
        fail(
          "INVALID_PROTOCOL_REVISION",
          "A protocol revision requires an attributable correction id and reason.",
        );
      }
      if (
        blocker.code !== "PUBMED_NO_RESULTS" &&
        command.explicitRevision !== true
      ) {
        fail(
          "EXPLICIT_PROTOCOL_REVISION_REQUIRED",
          "A non-empty-result failure requires an explicit human request before changing the frozen method.",
        );
      }
      if (state.corrections.some((item) => item.id === command.correctionId)) {
        fail("CORRECTION_EXISTS", `Correction already exists: ${command.correctionId}`);
      }
      const previous = state.artifacts[command.previousArtifactId];
      if (
        !previous ||
        previous.type !== command.artifact?.type ||
        previous.lineageId !== command.artifact?.lineageId ||
        previous.status !== ARTIFACT_STATES.ACCEPTED ||
        previous.freshness === ARTIFACT_FRESHNESS.STALE
      ) {
        fail(
          "RETRIEVAL_PROTOCOL_TARGET_INVALID",
          "The revision must replace the current accepted protocol in the same lineage.",
        );
      }
      const producerRuntime = state.nodeExecutions[previous.producedByNodeId];
      if (!producerRuntime?.acceptedArtifactIds?.includes(previous.id)) {
        fail(
          "RETRIEVAL_PROTOCOL_TARGET_INVALID",
          "The revised protocol must be the accepted output of its producer node.",
        );
      }
      const artifact = command.artifact;
      if (
        !artifact?.id ||
        state.artifacts[artifact.id] ||
        !Number.isInteger(artifact.version) ||
        artifact.version <= previous.version ||
        artifact.producedByActorId !== command.actor.id ||
        artifact.producedByActorRole !== command.actor.role ||
        artifact.producedByNodeId !== previous.producedByNodeId ||
        artifact.status !== ARTIFACT_STATES.ACCEPTED ||
        artifact.contentHash !== sha256(command.content)
      ) {
        fail(
          "INVALID_PROTOCOL_REVISION_ARTIFACT",
          "The revised protocol must be a newer, content-addressed, human-produced accepted artifact.",
        );
      }
      if (
        Object.values(state.artifacts).some(
          (candidate) =>
            candidate.lineageId === artifact.lineageId &&
            candidate.version === artifact.version,
        )
      ) {
        fail(
          "ARTIFACT_VERSION_EXISTS",
          `Version ${artifact.version} exists in lineage ${artifact.lineageId}.`,
        );
      }
      if (researchArtifactContentNeedsValidation(artifact.type)) {
        const issues = validateResearchArtifactContent(artifact.type, command.content);
        if (issues.length > 0) {
          fail(
            "ARTIFACT_CONTENT_CONTRACT_VIOLATION",
            `${artifact.type} content does not satisfy its scientific contract.`,
            { artifactType: artifact.type, issues },
          );
        }
      }
      const inputArtifacts = ensureArtifactRefs(
        state,
        artifact.inputArtifactRefs,
        [ARTIFACT_STATES.ACCEPTED],
      );
      if (!inputArtifacts.some((candidate) => candidate.id === previous.id)) {
        fail(
          "PROTOCOL_REVISION_LINEAGE_MISSING",
          "The revised protocol must explicitly reference the previous protocol artifact.",
        );
      }
      if (command.content?.id !== artifact.id) {
        fail(
          "ARTIFACT_CONTENT_ID_MISMATCH",
          "The revised protocol content id must equal its artifact id.",
        );
      }
      if (command.content?.version !== artifact.version) {
        fail(
          "ARTIFACT_CONTENT_VERSION_MISMATCH",
          "The revised protocol content version must equal its artifact version.",
        );
      }
      const resumeNode = assertNode(machine, command.resumeNodeId);
      const affectedNodeIds = dependentNodeIds(machine, [resumeNode.id]);
      const affectedNodeSet = new Set(affectedNodeIds);
      const affectedArtifactIds = Object.values(state.artifacts)
        .filter(
          (candidate) =>
            candidate.id === previous.id ||
            affectedNodeSet.has(candidate.producedByNodeId),
        )
        .map((candidate) => candidate.id);
      const affectedArtifactIdSet = new Set(affectedArtifactIds);
      const affectedGateIds = Object.values(state.gates)
        .filter(
          (gate) =>
            gate.status !== GATE_STATES.INVALIDATED &&
            gate.artifactRefs.some((ref) => affectedArtifactIdSet.has(ref.artifactId)),
        )
        .map((gate) => gate.id);
      const protocolTypes = new Set([
        "OrientationSearchProtocol",
        "FrozenOrientationSearchProtocol",
        "FocusedSearchProtocol",
        "FrozenSearchProtocol",
      ]);
      const invalidatedProtocolFingerprints = affectedArtifactIds
        .map((artifactId) => state.artifacts[artifactId])
        .filter((candidate) => protocolTypes.has(candidate?.type))
        .map((candidate) => ({
          artifactId: candidate.id,
          artifactType: candidate.type,
          version: candidate.version,
          contentHash: candidate.contentHash,
        }));
      const normalizedArtifact = {
        ...artifact,
        freshness: ARTIFACT_FRESHNESS.CURRENT,
        inputArtifactRefs: [...(artifact.inputArtifactRefs ?? [])],
        sourceRef: artifact.sourceRef ?? `human-protocol-revision:${command.correctionId}`,
        locator: artifact.locator ?? null,
        acceptedBy: {
          actorId: command.actor.id,
          actorRole: command.actor.role,
          actorKind: command.actor.kind,
        },
        acceptedAt: command.occurredAt,
      };
      normalizedArtifact.manifestHash = artifactManifestHash(normalizedArtifact);
      return [
        {
          type: "RetrievalProtocolRevised",
          aggregateId: normalizedArtifact.id,
          artifactRefs: [previous.id, ...(normalizedArtifact.inputArtifactRefs ?? [])],
          payload: {
            previousArtifactId: previous.id,
            artifact: normalizedArtifact,
            content: command.content,
            blockedNodeId: blockedNode.id,
            resumeNodeId: resumeNode.id,
            affectedNodeIds,
            affectedArtifactIds,
            affectedGateIds,
            blockerId: blocker.id,
            reason: command.reason,
            correctionId: command.correctionId,
            correction: {
              id: command.correctionId,
              reason: command.reason,
              correctedBy: {
                actorId: command.actor.id,
                actorRole: command.actor.role,
              },
              correctedAt: command.occurredAt,
              artifactIds: [previous.id, normalizedArtifact.id],
              focusNodeId: resumeNode.id,
            },
            revision: {
              id: command.correctionId,
              blockedNodeId: blockedNode.id,
              resumeNodeId: resumeNode.id,
              previousProtocolFingerprint: {
                artifactId: previous.id,
                artifactType: previous.type,
                version: previous.version,
                contentHash: previous.contentHash,
              },
              revisedProtocolFingerprint: {
                artifactId: normalizedArtifact.id,
                artifactType: normalizedArtifact.type,
                version: normalizedArtifact.version,
                contentHash: normalizedArtifact.contentHash,
              },
              invalidatedProtocolFingerprints,
              revisedQuery: command.content.query,
              revisedAt: command.occurredAt,
              revisedBy: {
                actorId: command.actor.id,
                actorRole: command.actor.role,
              },
              reason: command.reason,
            },
          },
        },
      ];
    }

    case "IMPORT_LEGACY_CHECKPOINT": {
      assertProjectCreated(state);
      if (command.actor.kind !== "system") {
        fail("SYSTEM_REQUIRED", "Only a system migration can import a legacy checkpoint.");
      }
      const specs = [];
      const incomingArtifacts = command.artifacts ?? [];
      const incomingIds = incomingArtifacts.map((artifact) => artifact.id);
      if (new Set(incomingIds).size !== incomingIds.length) {
        fail("DUPLICATE_ARTIFACT_ID", "A migration batch contains duplicate artifact ids.");
      }
      const lineageVersions = new Set(
        Object.values(state.artifacts).map(
          (artifact) => `${artifact.lineageId}@${artifact.version}`,
        ),
      );
      for (const artifact of incomingArtifacts) {
        const key = `${artifact.lineageId}@${artifact.version}`;
        if (lineageVersions.has(key)) {
          fail("ARTIFACT_VERSION_EXISTS", `Duplicate lineage version: ${key}`);
        }
        lineageVersions.add(key);
      }
      const normalizedIncomingArtifacts = incomingArtifacts.map((rawArtifact) => {
        if (state.artifacts[rawArtifact.id]) {
          fail("ARTIFACT_EXISTS", `Artifact already exists: ${rawArtifact.id}`);
        }
        return importedArtifact(rawArtifact, command);
      });
      assertArtifactGraphAcyclic([
        ...Object.values(state.artifacts),
        ...normalizedIncomingArtifacts,
      ]);
      for (const artifact of normalizedIncomingArtifacts) {
        specs.push({
          type: "LegacyArtifactImported",
          aggregateId: artifact.id,
          artifactRefs: artifact.inputArtifactRefs,
          payload: { artifact },
        });
      }
      const availableArtifactIds = new Set([
        ...Object.keys(state.artifacts),
        ...normalizedIncomingArtifacts.map((artifact) => artifact.id),
      ]);
      for (const artifact of normalizedIncomingArtifacts) {
        for (const inputId of artifact.inputArtifactRefs ?? []) {
          if (!availableArtifactIds.has(inputId)) {
            fail(
              "UNKNOWN_ARTIFACT",
              `Imported artifact ${artifact.id} has unknown input ${inputId}.`,
            );
          }
        }
      }
      const availableArtifactsById = new Map([
        ...Object.values(state.artifacts).map((artifact) => [artifact.id, artifact]),
        ...normalizedIncomingArtifacts.map((artifact) => [artifact.id, artifact]),
      ]);
      const incomingCheckpointsByNode = new Map(
        (command.nodes ?? []).map((checkpoint) => [checkpoint.nodeId, checkpoint]),
      );
      for (const checkpoint of command.nodes ?? []) {
        const checkpointNode = assertNode(machine, checkpoint.nodeId);
        if (!Object.values(EXECUTION_STATES).includes(checkpoint.state)) {
          fail("INVALID_NODE_STATE", `Invalid checkpoint state: ${checkpoint.state}`);
        }
        if (!checkpoint.sourceRef) {
          fail("MISSING_SOURCE_REF", `Checkpoint ${checkpoint.nodeId} requires sourceRef.`);
        }
        if ((checkpoint.artifactIds ?? []).some((id) => !availableArtifactIds.has(id))) {
          fail("UNKNOWN_ARTIFACT", `Checkpoint ${checkpoint.nodeId} references an unknown artifact.`);
        }
        if (
          checkpointNode.kind === "human_gate" &&
          checkpoint.state === EXECUTION_STATES.ACCEPTED
        ) {
          const receipt = checkpoint.decisionReceipt;
          const inputArtifacts = (checkpoint.inputArtifactIds ?? []).map(
            (artifactId) => availableArtifactsById.get(artifactId),
          );
          const decisionArtifacts = (checkpoint.artifactIds ?? []).map(
            (artifactId) => availableArtifactsById.get(artifactId),
          );
          if (
            inputArtifacts.length === 0 ||
            inputArtifacts.some((artifact) => !artifact) ||
            decisionArtifacts.length === 0 ||
            decisionArtifacts.some((artifact) => !artifact)
          ) {
            fail(
              "MISSING_GATE_ARTIFACTS",
              `Accepted legacy gate ${checkpoint.nodeId} needs complete input and decision artifacts.`,
            );
          }
          assertArtifactsMatchContracts(
            inputArtifacts,
            checkpointNode.inputs,
            `Legacy gate inputs for ${checkpoint.nodeId}`,
          );
          assertArtifactsMatchContracts(
            decisionArtifacts,
            checkpointNode.outputs,
            `Legacy gate outputs for ${checkpoint.nodeId}`,
          );
          const dependencyAcceptedIds = new Set(
            hardDependencyIds(machine, checkpoint.nodeId).flatMap((nodeId) =>
              incomingCheckpointsByNode.get(nodeId)?.artifactIds ??
              state.nodeExecutions[nodeId].acceptedArtifactIds ??
              [],
            ),
          );
          const invalidInputs = inputArtifacts
            .map((artifact) => artifact.id)
            .filter((artifactId) => !dependencyAcceptedIds.has(artifactId));
          if (invalidInputs.length > 0) {
            fail(
              "GATE_INPUT_NOT_ACCEPTED",
              `Legacy gate ${checkpoint.nodeId} does not target accepted dependency outputs.`,
              { invalidInputs },
            );
          }
          if (
            decisionArtifacts.some(
              (artifact) => artifact.producedByNodeId !== checkpoint.nodeId,
            )
          ) {
            fail(
              "ARTIFACT_NODE_MISMATCH",
              `Legacy gate outputs must be produced by ${checkpoint.nodeId}.`,
            );
          }
          const inputFingerprint = artifactFingerprint(inputArtifacts);
          if (
            !receipt?.decidedBy?.actorId ||
            receipt.decidedBy.actorId !== state.researchOwnerId ||
            receipt.decidedBy.actorKind !== "human" ||
            !(checkpointNode.approverRoles ?? []).includes(
              receipt.decidedBy.actorRole,
            ) ||
            !hasValidRecordedTime(receipt) ||
            !receipt.reason ||
            !receipt.sourceRef ||
            receipt.fingerprint !== inputFingerprint
          ) {
            fail(
              "MISSING_GATE_DECISION_RECEIPT",
              `Accepted legacy gate ${checkpoint.nodeId} needs an attributable human receipt.`,
            );
          }
        }
        specs.push({
          type: "LegacyNodeCheckpointImported",
          aggregateId: checkpoint.nodeId,
          artifactRefs: [...(checkpoint.artifactIds ?? [])],
          payload: { ...checkpoint },
        });
      }
      for (const rawGate of command.gates ?? []) {
        if (state.gates[rawGate.id]) fail("GATE_EXISTS", `Gate already exists: ${rawGate.id}`);
        assertNode(machine, rawGate.nodeId);
        if (!Object.values(GATE_STATES).includes(rawGate.status)) {
          fail("INVALID_GATE_STATUS", `Invalid gate status: ${rawGate.status}`);
        }
        if (
          !rawGate.sourceRef ||
          !rawGate.requestedBy?.actorId ||
          !rawGate.requestedAt ||
          Number.isNaN(Date.parse(rawGate.requestedAt))
        ) {
          fail("INVALID_LEGACY_GATE", `Imported gate ${rawGate.id} lacks provenance.`);
        }
        if (!Array.isArray(rawGate.artifactIds) || rawGate.artifactIds.length === 0) {
          fail("MISSING_ARTIFACT_REFS", `Imported gate ${rawGate.id} needs artifacts.`);
        }
        const refs = rawGate.artifactIds.map((artifactId) => {
          const artifact =
            state.artifacts[artifactId] ??
            normalizedIncomingArtifacts.find((item) => item.id === artifactId);
          if (!artifact) fail("UNKNOWN_ARTIFACT", `Unknown gate artifact: ${artifactId}`);
          return {
            artifactId,
            contentHash: artifact.contentHash,
            manifestHash:
              artifact.manifestHash ?? artifactManifestHash(artifact),
            version: artifact.version,
          };
        });
        const fingerprint = sha256(
          refs.sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
        );
        if (
          [
            GATE_STATES.APPROVED,
            GATE_STATES.REJECTED,
            GATE_STATES.AMENDMENT_REQUESTED,
            GATE_STATES.ACCEPTED_RISK,
          ].includes(rawGate.status)
        ) {
          const receipt = rawGate.decisionReceipt;
          if (
            !receipt?.decidedBy?.actorId ||
            receipt.decidedBy.actorKind !== "human" ||
            !hasValidRecordedTime(receipt) ||
            !receipt.reason ||
            receipt.fingerprint !== fingerprint
          ) {
            fail(
              "MISSING_GATE_DECISION_RECEIPT",
              `Imported decision ${rawGate.id} is not tied to its exact target.`,
            );
          }
        }
        const gate = {
          id: rawGate.id,
          nodeId: rawGate.nodeId,
          status: rawGate.status,
          artifactRefs: refs,
          fingerprint,
          requestedBy: rawGate.requestedBy,
          requestedAt: rawGate.requestedAt,
          sourceRef: rawGate.sourceRef,
          legacyWorkflowLabel: rawGate.legacyWorkflowLabel ?? null,
          decisionReceipt: rawGate.decisionReceipt ?? null,
        };
        specs.push({
          type: "LegacyGateImported",
          aggregateId: gate.id,
          artifactRefs: rawGate.artifactIds,
          payload: { gate },
        });
      }
      return specs;
    }

    default:
      fail("UNKNOWN_COMMAND", `Unknown command type: ${command.type}`);
  }
}

function eventBody(event) {
  const { hash, ...body } = event;
  return body;
}

export function commandRequestHash(command) {
  const { expectedVersion: _expectedVersion, ...identity } = command;
  return sha256(identity);
}

export function verifyEventChain(
  events,
  expectedProjectId = null,
  { expectedHeadHash = null, requireCompleteCommand = false } = {},
) {
  let previousHash = GENESIS_HASH;
  const eventIds = new Set();
  let activeCommand = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const expectedSequence = index + 1;
    if (event.sequence !== expectedSequence) {
      fail("EVENT_SEQUENCE_MISMATCH", `Expected event sequence ${expectedSequence}.`);
    }
    if (
      !event.eventId ||
      !event.projectId ||
      !event.aggregateId ||
      !event.commandId ||
      !event.type ||
      !event.actorId ||
      !event.actorRole ||
      !event.actorKind ||
      !event.occurredAt ||
      !Number.isInteger(event.workflowVersion) ||
      !Number.isInteger(event.commandEventIndex) ||
      !Number.isInteger(event.commandEventCount) ||
      event.commandEventIndex < 1 ||
      event.commandEventCount < event.commandEventIndex ||
      !/^[a-f0-9]{64}$/i.test(event.commandRequestHash ?? "") ||
      !Array.isArray(event.artifactRefs)
    ) {
      fail("INVALID_EVENT_ENVELOPE", `Invalid event envelope at sequence ${event.sequence}.`);
    }
    if (event.previousHash !== previousHash) {
      fail("EVENT_CHAIN_BROKEN", `Broken previous hash at sequence ${event.sequence}.`);
    }
    if (sha256(eventBody(event)) !== event.hash) {
      fail("EVENT_HASH_MISMATCH", `Invalid event hash at sequence ${event.sequence}.`);
    }
    if (expectedProjectId && event.projectId !== expectedProjectId) {
      fail("PROJECT_MISMATCH", `Unexpected project at sequence ${event.sequence}.`);
    }
    if (eventIds.has(event.eventId)) {
      fail("DUPLICATE_EVENT_ID", `Duplicate event id: ${event.eventId}`);
    }
    if (!activeCommand) {
      if (event.commandEventIndex !== 1) {
        fail("COMMAND_BATCH_BROKEN", `Command batch starts at ${event.commandEventIndex}.`);
      }
      activeCommand = {
        commandId: event.commandId,
        requestHash: event.commandRequestHash,
        eventCount: event.commandEventCount,
        nextIndex: 1,
      };
    }
    if (
      activeCommand.commandId !== event.commandId ||
      activeCommand.requestHash !== event.commandRequestHash ||
      activeCommand.eventCount !== event.commandEventCount ||
      activeCommand.nextIndex !== event.commandEventIndex
    ) {
      fail("COMMAND_BATCH_BROKEN", `Broken command batch at sequence ${event.sequence}.`);
    }
    activeCommand.nextIndex += 1;
    if (event.commandEventIndex === event.commandEventCount) {
      activeCommand = null;
    }
    eventIds.add(event.eventId);
    previousHash = event.hash;
  }
  if (requireCompleteCommand && activeCommand) {
    fail(
      "INCOMPLETE_COMMAND",
      `Command ${activeCommand.commandId} is missing committed events.`,
    );
  }
  if (expectedHeadHash && previousHash !== expectedHeadHash) {
    fail("TRUSTED_HEAD_MISMATCH", "The event log does not match its trusted head hash.", {
      expectedHeadHash,
      actualHeadHash: previousHash,
    });
  }
  return true;
}

export function auditEventLog(
  machine,
  projectId,
  events,
  { trustedHeadHash = null } = {},
) {
  verifyEventChain(events, projectId, {
    expectedHeadHash: trustedHeadHash,
    requireCompleteCommand: true,
  });
  const state = replayEvents(machine, projectId, events);
  return {
    valid: true,
    eventCount: events.length,
    headHash: events.at(-1)?.hash ?? GENESIS_HASH,
    state,
  };
}

function validateEventSemantics(machine, state, event) {
  const payload = event.payload ?? {};
  const systemOnly = new Set([
    "LegacyArtifactImported",
    "LegacyNodeCheckpointImported",
    "LegacyGateImported",
  ]);
  if (systemOnly.has(event.type) && event.actorKind !== "system") {
    fail("SYSTEM_REQUIRED", `${event.type} must be emitted by a trusted migration adapter.`);
  }

  if (event.type === "CompletionProfileChanged") {
    if (
      event.actorKind !== "human" ||
      event.actorId !== state.researchOwnerId ||
      payload.changedBy?.actorId !== event.actorId ||
      payload.changedBy?.actorRole !== event.actorRole ||
      payload.changedBy?.actorKind !== "human" ||
      payload.fromCompletionProfileId !== state.completionProfileId ||
      !payload.reason ||
      !machine.completionProfiles.some(
        (profile) => profile.id === payload.toCompletionProfileId,
      )
    ) {
      fail(
        "UNAUTHORIZED_COMPLETION_PROFILE_CHANGE",
        "A completion-profile change must be an exact decision by the research owner.",
      );
    }
  }

  if (event.type === "NodeStarted") {
    const node = assertNode(machine, payload.nodeId);
    if (node.executorRole && event.actorRole !== node.executorRole) {
      fail("EXECUTOR_ROLE_MISMATCH", `Expected executor role ${node.executorRole}.`);
    }
    if (state.nodeExecutions[node.id].state !== EXECUTION_STATES.READY) {
      fail("INVALID_NODE_STATE", `NodeStarted cannot follow ${state.nodeExecutions[node.id].state}.`);
    }
    if (event.actorKind === "agent") {
      const lease = state.workLeases[payload.leaseId];
      if (
        !lease ||
        lease.nodeId !== node.id ||
        lease.status !== LEASE_STATES.RUNNING ||
        lease.claimedBy.actorId !== event.actorId
      ) {
        fail("VALID_LEASE_REQUIRED", "An agent NodeStarted event requires its running lease.");
      }
    }
  }

  if (event.type === "WorkLeaseClaimed") {
    const lease = payload.lease;
    if (
      event.actorKind !== "agent" ||
      lease?.claimedBy?.actorId !== event.actorId ||
      lease?.claimedBy?.actorRole !== event.actorRole ||
      lease?.status !== LEASE_STATES.CLAIMED
    ) {
      fail("INVALID_LEASE_EVENT", "A lease claim must identify its execution agent.");
    }
  }

  if (event.type === "WorkLeaseStarted") {
    const lease = state.workLeases[payload.leaseId];
    if (
      !lease ||
      lease.status !== LEASE_STATES.CLAIMED ||
      lease.claimedBy.actorId !== event.actorId
    ) {
      fail("INVALID_LEASE_EVENT", "Only the lease owner can start claimed work.");
    }
  }

  if (event.type === "WorkLeaseReleased") {
    const lease = state.workLeases[payload.leaseId];
    const isResearchOwner =
      event.actorKind === "human" && event.actorId === state.researchOwnerId;
    if (
      !lease ||
      (event.actorKind !== "system" &&
        !isResearchOwner &&
        lease.claimedBy.actorId !== event.actorId)
    ) {
      fail(
        "INVALID_LEASE_EVENT",
        "Only the research owner, lease owner, or runtime may release work.",
      );
    }
  }

  if (event.type === "WorkLeaseExpired" && event.actorKind !== "system") {
    fail("SYSTEM_REQUIRED", "Only the runtime clock can expire a work lease.");
  }

  if (event.type === "RetrievalProtocolRevised") {
    const artifact = payload.artifact;
    const previous = state.artifacts[payload.previousArtifactId];
    const blocker = state.nodeExecutions[payload.blockedNodeId]?.blockers?.[
      payload.blockerId
    ];
    if (
      event.actorKind !== "human" ||
      event.actorId !== state.researchOwnerId ||
      artifact?.producedByActorId !== event.actorId ||
      artifact?.producedByActorRole !== event.actorRole ||
      !previous ||
      previous.lineageId !== artifact?.lineageId ||
      !blocker ||
      blocker.status === "resolved" ||
      payload.correction?.correctedBy?.actorId !== event.actorId ||
      payload.revision?.revisedBy?.actorId !== event.actorId
    ) {
      fail(
        "INVALID_PROTOCOL_REVISION_EVENT",
        "A retrieval protocol revision must preserve exact human, blocker, and lineage authority.",
      );
    }
  }

  if (event.type === "HumanCorrectionRecorded") {
    const correction = payload.correction;
    const sourceGate = correction?.sourceGateId
      ? state.gates[correction.sourceGateId]
      : null;
    const sourceGateNode = sourceGate
      ? assertNode(machine, sourceGate.nodeId)
      : null;
    const attributedToOwner =
      event.actorKind === "human" &&
      event.actorId === state.researchOwnerId &&
      correction?.correctedBy?.actorId === event.actorId &&
      correction?.correctedBy?.actorRole === event.actorRole;
    const validSourceGateAmendment =
      !correction?.sourceGateId ||
      (sourceGate &&
        sourceGate.status === GATE_STATES.AMENDMENT_REQUESTED &&
        sourceGate.fingerprint === correction.sourceGateFingerprint &&
        sourceGateNode?.amendmentTargetNodeId === correction.amendmentTargetNodeId &&
        correction.focusNodeId === correction.amendmentTargetNodeId &&
        hardDependencyAncestorIds(machine, sourceGate.nodeId).has(
          correction.amendmentTargetNodeId,
        ));
    if (
      !correction?.id ||
      !correction.reason ||
      !attributedToOwner ||
      !nodeById(machine, correction.focusNodeId) ||
      !validSourceGateAmendment
    ) {
      fail(
        "INVALID_HUMAN_CORRECTION_EVENT",
        "A human correction must preserve its owner, reason, focus, and source-gate authority.",
      );
    }
  }

  if (event.type === "ArtifactProduced") {
    const artifact = payload.artifact;
    const runtimeNode = state.nodeExecutions[artifact?.producedByNodeId];
    if (
      !runtimeNode ||
      runtimeNode.state !== EXECUTION_STATES.RUNNING ||
      artifact.producedByActorId !== event.actorId
    ) {
      fail("INVALID_ARTIFACT_EVENT", "Artifact production must match its running node.");
    }
    if (event.actorKind === "agent") {
      const lease = state.workLeases[payload.leaseId];
      if (
        !lease ||
        runtimeNode.activeLeaseId !== lease.id ||
        lease.status !== LEASE_STATES.RUNNING ||
        lease.claimedBy.actorId !== event.actorId ||
        Date.parse(event.occurredAt) >= Date.parse(lease.expiresAt)
      ) {
        fail("LEASE_FENCE_MISMATCH", "Artifact event crossed its active lease fence.");
      }
    }
  }

  if (event.type === "NodeSubmittedForReview" && event.actorKind === "agent") {
    const runtimeNode = state.nodeExecutions[payload.nodeId];
    const lease = state.workLeases[payload.leaseId];
    if (
      !runtimeNode ||
      runtimeNode.state !== EXECUTION_STATES.RUNNING ||
      runtimeNode.activeLeaseId !== lease?.id ||
      lease?.status !== LEASE_STATES.RUNNING ||
      lease?.claimedBy?.actorId !== event.actorId ||
      Date.parse(event.occurredAt) >= Date.parse(lease.expiresAt)
    ) {
      fail("LEASE_FENCE_MISMATCH", "Submission event crossed its active lease fence.");
    }
  }

  if (event.type === "LegacyNodeCheckpointImported") {
    const node = assertNode(machine, payload.nodeId);
    if (
      node.kind === "human_gate" &&
      payload.state === EXECUTION_STATES.ACCEPTED
    ) {
      const receipt = payload.decisionReceipt;
      const inputArtifacts = (payload.inputArtifactIds ?? []).map(
        (artifactId) => state.artifacts[artifactId],
      );
      const decisionArtifacts = (payload.artifactIds ?? []).map(
        (artifactId) => state.artifacts[artifactId],
      );
      if (
        inputArtifacts.length === 0 ||
        inputArtifacts.some((artifact) => !artifact) ||
        decisionArtifacts.length === 0 ||
        decisionArtifacts.some((artifact) => !artifact)
      ) {
        fail(
          "MISSING_GATE_ARTIFACTS",
          `Accepted legacy gate ${node.id} lacks complete materials.`,
        );
      }
      assertArtifactsMatchContracts(
        inputArtifacts,
        node.inputs,
        `Legacy gate inputs for ${node.id}`,
      );
      assertArtifactsMatchContracts(
        decisionArtifacts,
        node.outputs,
        `Legacy gate outputs for ${node.id}`,
      );
      assertGateInputsAreAcceptedDependencyOutputs(
        machine,
        state,
        node,
        inputArtifacts,
      );
      if (
        receipt?.decidedBy?.actorId !== state.researchOwnerId ||
        receipt?.decidedBy?.actorKind !== "human" ||
        !(node.approverRoles ?? []).includes(receipt?.decidedBy?.actorRole) ||
        !hasValidRecordedTime(receipt) ||
        !receipt?.reason ||
        !receipt?.sourceRef ||
        receipt?.fingerprint !== artifactFingerprint(inputArtifacts)
      ) {
        fail(
          "MISSING_GATE_DECISION_RECEIPT",
          `Accepted legacy gate ${node.id} lacks a valid human receipt.`,
        );
      }
    }
  }

  if (event.type === "LegacyGateImported") {
    const gate = payload.gate;
    if (
      [
        GATE_STATES.APPROVED,
        GATE_STATES.REJECTED,
        GATE_STATES.AMENDMENT_REQUESTED,
        GATE_STATES.ACCEPTED_RISK,
      ].includes(gate.status)
    ) {
      const receipt = gate.decisionReceipt;
      if (
        receipt?.decidedBy?.actorKind !== "human" ||
        !hasValidRecordedTime(receipt) ||
        !receipt?.reason ||
        receipt?.fingerprint !== gate.fingerprint
      ) {
        fail(
          "MISSING_GATE_DECISION_RECEIPT",
          `Imported gate ${gate.id} lacks an exact human decision receipt.`,
        );
      }
    }
  }

  if (event.type === "NodeAccepted") {
    const node = assertNode(machine, payload.nodeId);
    if (node.kind === "human_gate") {
      fail("FORBIDDEN_GATE_EVENT", "A human gate cannot be accepted by NodeAccepted.");
    }
    if (node.reviewerRole && event.actorRole !== node.reviewerRole) {
      fail("REVIEWER_ROLE_MISMATCH", `Expected reviewer role ${node.reviewerRole}.`);
    }
    if (state.nodeExecutions[node.id].state !== EXECUTION_STATES.REVIEW) {
      fail("INVALID_NODE_STATE", `NodeAccepted cannot follow ${state.nodeExecutions[node.id].state}.`);
    }
  }

  if (event.type === "NodeCancelled") {
    const node = assertNode(machine, payload.nodeId);
    const runtimeNode = state.nodeExecutions[node.id];
    const cancelledLease = payload.cancelledLeaseId
      ? state.workLeases[payload.cancelledLeaseId]
      : null;
    const isResearchOwner =
      event.actorKind === "human" && event.actorId === state.researchOwnerId;
    const isRuntime = event.actorKind === "system";
    const isLeaseOwner =
      cancelledLease?.claimedBy?.actorId === event.actorId &&
      cancelledLease.status === LEASE_STATES.RELEASED &&
      cancelledLease.releasedAt === event.occurredAt &&
      cancelledLease.releaseReason === `node_cancelled:${payload.reason}`;
    if (
      !runtimeNode ||
      [
        EXECUTION_STATES.ACCEPTED,
        EXECUTION_STATES.SUPERSEDED,
        EXECUTION_STATES.CANCELLED,
      ].includes(runtimeNode.state)
    ) {
      fail(
        "INVALID_NODE_STATE",
        `NodeCancelled cannot follow ${runtimeNode?.state ?? "unknown"}.`,
      );
    }
    if (!isResearchOwner && !isRuntime && !isLeaseOwner) {
      fail(
        "UNAUTHORIZED_NODE_CANCELLATION",
        `Unauthorized cancellation event for ${node.id}.`,
      );
    }
    if (
      payload.cancelledBy?.actorId !== event.actorId ||
      payload.cancelledBy?.actorRole !== event.actorRole ||
      payload.cancelledBy?.actorKind !== event.actorKind ||
      !payload.reason
    ) {
      fail(
        "INVALID_NODE_CANCELLATION",
        `Cancellation event for ${node.id} lacks exact attribution or reason.`,
      );
    }
    if (
      runtimeNode.activeLeaseId ||
      (payload.cancelledLeaseId && !cancelledLease) ||
      cancelledLease &&
      (cancelledLease.nodeId !== node.id ||
        cancelledLease.status !== LEASE_STATES.RELEASED ||
        cancelledLease.releasedAt !== event.occurredAt ||
        cancelledLease.releaseReason !== `node_cancelled:${payload.reason}`)
    ) {
      fail(
        "INVALID_NODE_CANCELLATION",
        `Cancellation event for ${node.id} did not release its active lease first.`,
      );
    }
  }

  if (
    event.type === "HumanDecisionRecorded" ||
    event.type === "HumanDecisionArtifactRecorded"
  ) {
    const nodeId =
      event.type === "HumanDecisionRecorded"
        ? state.gates[payload.gateId]?.nodeId
        : payload.artifact?.producedByNodeId;
    const node = assertNode(machine, nodeId);
    if (
      event.actorKind !== "human" ||
      event.actorId !== state.researchOwnerId ||
      !(node.approverRoles ?? []).includes(event.actorRole)
    ) {
      fail("UNAUTHORIZED_HUMAN_DECISION", `Unauthorized decision event for ${node.id}.`);
    }
  }

  if (event.type === "ArtifactAccepted") {
    const artifact = state.artifacts[payload.artifactId];
    if (!artifact) fail("UNKNOWN_ARTIFACT", `Unknown artifact: ${payload.artifactId}`);
    const producerNode = assertNode(machine, artifact.producedByNodeId);
    const isOwnerDecision =
      event.actorKind === "human" && event.actorId === state.researchOwnerId;
    const isIndependentAcceptance =
      producerNode.kind !== "human_gate" &&
      producerNode.reviewerRole === event.actorRole;
    if (!isOwnerDecision && !isIndependentAcceptance) {
      fail("UNAUTHORIZED_ARTIFACT_ACCEPTANCE", `Unauthorized acceptance of ${artifact.id}.`);
    }
  }
}

export function replayEvents(machine, projectId, events) {
  verifyEventChain(events, projectId);
  const incompatible = events.find(
    (event) => event.workflowVersion !== machine.version,
  );
  if (incompatible) {
    fail(
      "WORKFLOW_VERSION_MISMATCH",
      `Event ${incompatible.eventId} targets workflow version ${incompatible.workflowVersion}.`,
    );
  }
  return events.reduce((state, event) => {
    validateEventSemantics(machine, state, event);
    return evolve(machine, state, event);
  }, createEmptyProjectState(machine, projectId));
}

function finalizeEvent(
  machine,
  state,
  command,
  requestHash,
  spec,
  offset,
  eventCount,
  previousHash,
) {
  const body = {
    eventId: `${command.commandId}:${String(offset + 1).padStart(2, "0")}`,
    projectId: command.projectId,
    aggregateId: spec.aggregateId,
    sequence: state.revision + offset + 1,
    workflowVersion: machine.version,
    actorId: command.actor.id,
    actorRole: command.actor.role,
    actorKind: command.actor.kind,
    occurredAt: command.occurredAt,
    sourceContext: command.sourceContext ?? null,
    commandId: command.commandId,
    commandRequestHash: requestHash,
    commandEventIndex: offset + 1,
    commandEventCount: eventCount,
    causationId: command.causationId ?? null,
    correlationId: command.correlationId ?? command.commandId,
    type: spec.type,
    payload: spec.payload ?? {},
    artifactRefs: spec.artifactRefs ?? [],
    previousHash,
  };
  return { ...body, hash: sha256(body) };
}

function materializeEvents(machine, state, command, requestHash, specs) {
  let previousHash = state.lastEventHash;
  return specs.map((spec, index) => {
    const event = finalizeEvent(
      machine,
      state,
      command,
      requestHash,
      spec,
      index,
      specs.length,
      previousHash,
    );
    previousHash = event.hash;
    return event;
  });
}

export function dispatchCommand(machine, existingEvents, command) {
  assertCommandEnvelope(command);
  const state = replayEvents(machine, command.projectId, existingEvents);
  const requestHash = commandRequestHash(command);
  if (state.processedCommands[command.commandId]) {
    if (state.processedCommands[command.commandId] !== requestHash) {
      fail(
        "IDEMPOTENCY_KEY_REUSE",
        "This commandId was already used for a different command payload.",
        { commandId: command.commandId },
      );
    }
    return { duplicate: true, newEvents: [], state };
  }

  const inFlightEntries = Object.entries(state.inFlightCommands);
  if (inFlightEntries.length > 0) {
    const inFlight = state.inFlightCommands[command.commandId];
    if (!inFlight) {
      fail(
        "INCOMPLETE_COMMAND",
        `Command ${inFlightEntries[0][0]} must be recovered before new work is accepted.`,
      );
    }
    if (inFlight.requestHash !== requestHash) {
      fail(
        "IDEMPOTENCY_KEY_REUSE",
        "This commandId was already used for a different command payload.",
        { commandId: command.commandId },
      );
    }
    const baseEventCount = inFlight.firstSequence - 1;
    const baseEvents = existingEvents.slice(0, baseEventCount);
    const baseState = replayEvents(machine, command.projectId, baseEvents);
    if (command.expectedVersion !== baseState.revision) {
      fail(
        "EXPECTED_VERSION_MISMATCH",
        `Recovery must use the original expected version ${baseState.revision}.`,
        {
          expectedVersion: command.expectedVersion,
          currentVersion: state.revision,
          recoveryBaseVersion: baseState.revision,
        },
      );
    }
    const specs = decide(machine, baseState, command);
    const fullBatch = materializeEvents(
      machine,
      baseState,
      command,
      requestHash,
      specs,
    );
    const persistedPrefix = existingEvents.slice(baseEventCount);
    if (
      persistedPrefix.length >= fullBatch.length ||
      persistedPrefix.some(
        (event, index) => event.hash !== fullBatch[index]?.hash,
      )
    ) {
      fail(
        "COMMAND_RECOVERY_MISMATCH",
        "Persisted command events do not match deterministic recovery.",
      );
    }
    const newEvents = fullBatch.slice(persistedPrefix.length);
    const allEvents = [...existingEvents, ...newEvents];
    return {
      duplicate: false,
      resumed: true,
      newEvents,
      state: replayEvents(machine, command.projectId, allEvents),
    };
  }
  if (command.expectedVersion !== state.revision) {
    fail(
      "EXPECTED_VERSION_MISMATCH",
      `Expected version ${command.expectedVersion}, current version is ${state.revision}.`,
      { expectedVersion: command.expectedVersion, currentVersion: state.revision },
    );
  }
  const specs = decide(machine, state, command);
  const newEvents = materializeEvents(machine, state, command, requestHash, specs);
  const allEvents = [...existingEvents, ...newEvents];
  const nextState = replayEvents(machine, command.projectId, allEvents);
  return { duplicate: false, newEvents, state: nextState };
}

export function dispatchTrustedCommand(
  machine,
  existingEvents,
  command,
  { authenticatedActor, trustedNow } = {},
) {
  if (
    !authenticatedActor?.id ||
    !authenticatedActor?.role ||
    !authenticatedActor?.kind
  ) {
    fail("UNAUTHENTICATED_COMMAND", "A trusted adapter must provide the authenticated actor.");
  }
  if (!trustedNow || Number.isNaN(Date.parse(trustedNow))) {
    fail("UNTRUSTED_CLOCK", "A trusted adapter must provide its current time.");
  }
  const priorEvent = existingEvents.find(
    (event) => event.commandId === command.commandId,
  );
  if (priorEvent && priorEvent.actorId !== authenticatedActor.id) {
    fail(
      "UNAUTHORIZED_PRINCIPAL",
      "A command retry must use the originally authenticated principal.",
    );
  }
  const actor = priorEvent
    ? {
        id: priorEvent.actorId,
        role: priorEvent.actorRole,
        kind: priorEvent.actorKind,
      }
    : authenticatedActor;
  const occurredAt = priorEvent
    ? priorEvent.occurredAt
    : new Date(trustedNow).toISOString();
  return dispatchCommand(machine, existingEvents, {
    ...command,
    actor,
    occurredAt,
  });
}

export function getRuntimeUserProjection(machine, state) {
  const profile = machine.completionProfiles.find(
    (item) => item.id === state.completionProfileId,
  );
  const terminalIndex = profile
    ? machine.nodes.findIndex((item) => item.id === profile.terminalNodeId)
    : machine.nodes.length - 1;
  const eligibleNodes = machine.nodes.slice(0, terminalIndex + 1);
  const terminalNode = eligibleNodes.at(-1);
  const terminalRuntime = state.nodeExecutions[terminalNode.id];
  const complete =
    terminalRuntime.state === EXECUTION_STATES.ACCEPTED &&
    terminalRuntime.stale !== true;

  let node = complete ? terminalNode : null;
  if (!node && state.focusNodeId) {
    const focused = nodeById(machine, state.focusNodeId);
    const focusedRuntime = focused ? state.nodeExecutions[focused.id] : null;
    if (
      focused &&
      eligibleNodes.some((item) => item.id === focused.id) &&
      (focusedRuntime.state !== EXECUTION_STATES.ACCEPTED || focusedRuntime.stale)
    ) {
      node = focused;
    }
  }
  if (!node) {
    const statePriority = [
      EXECUTION_STATES.BLOCKED,
      EXECUTION_STATES.REVISION,
      EXECUTION_STATES.RUNNING,
      EXECUTION_STATES.REVIEW,
      EXECUTION_STATES.READY,
      EXECUTION_STATES.CANCELLED,
      EXECUTION_STATES.DRAFT,
    ];
    for (const executionState of statePriority) {
      node = eligibleNodes.find(
        (candidate) =>
          state.nodeExecutions[candidate.id].state === executionState,
      );
      if (node) break;
    }
  }
  node ??= terminalNode;
  const phase = machine.phases.find((item) => item.id === node.phaseId);
  const runtimeNode = state.nodeExecutions[node.id];
  const nodeGates = Object.values(state.gates).filter(
    (gate) => gate.nodeId === node.id,
  );
  const currentGate = nodeGates.at(-1) ?? null;
  const acceptedRisk = currentGate?.status === GATE_STATES.ACCEPTED_RISK;
  return {
    phase: `${phase.userLabel}（第${phase.order}阶段，共${machine.phases.length}阶段）`,
    activity: node.userLabel,
    status: complete
      ? "本次研究目标已经完成"
      : runtimeNode.state === EXECUTION_STATES.CANCELLED
        ? "这一步已取消，当前研究不会自动继续"
        : node.userStatus,
    state: runtimeNode.state,
    complete,
    completionProfile: profile?.userLabel ?? null,
    gateStatus: currentGate?.status ?? null,
    acceptedRiskCount: state.acceptedRisks.length,
    needsUserDecision:
      node.kind === "human_gate" &&
      runtimeNode.state === EXECUTION_STATES.REVIEW &&
      currentGate?.status === GATE_STATES.PENDING,
    limitation:
      runtimeNode.state === EXECUTION_STATES.CANCELLED
        ? runtimeNode.cancellationReason
          ? `取消原因：${runtimeNode.cancellationReason}`
          : "这一步已经取消。"
        : runtimeNode.stale === true
        ? "上游信息已经变化，这一步必须重新核查。"
        : currentGate?.status === GATE_STATES.INVALIDATED
          ? "此前的决定对象已经变化，需要基于新版本重新判断。"
          : acceptedRisk
            ? "这一步是在保留明确风险的前提下继续，风险不会被隐藏。"
            : state.acceptedRisks.length > 0
              ? `当前研究仍保留 ${state.acceptedRisks.length} 项已接受风险。`
        : null,
  };
}
