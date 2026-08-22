import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  dispatchTrustedCommand,
  getRuntimeUserProjection,
  sha256,
} from "./event-engine-v1.js";
import { NdjsonEventStore } from "./event-store-v1.js";
import { ContentAddressedArtifactStore } from "./content-addressed-artifact-store-v1.js";
import {
  AGENT_RUN_EVENT_TYPES,
  AgentRunLog,
  createModelInvocationReceipt,
  deriveProjectRuntimeProvenance,
} from "./agent-run-log-v1.js";
import {
  buildWorkOrder,
  createGateDecisionArtifacts,
  createGuidedCandidates,
  createGuidedReviewCandidate,
} from "./research-agent-work-order-v1.js";
import {
  assertValidQueryPreviewSelection,
  assertValidRetrievalRun,
  buildRetrievalRequests,
  createRetrievalRun,
  retrievalPurposeForNode,
  runLiveRetrieval,
  shouldRunLiveRetrieval,
} from "./research-live-retrieval-v1.js";
import { enforceCitationVerification } from "./citation-verification-v1.js";
import { assertValidResearchDirectionSelection } from "./research-direction-selection-v1.js";
import { assertValidManuscriptAuthorityChain } from "./manuscript-authority-v1.js";
import { assertValidSearchMethodAuthorityChain } from "./research-search-method-authority-v1.js";
import {
  createAuthoritativeExportManifest,
  verifyAuthoritativeExportManifest,
} from "./export-authority-v1.js";
import {
  ARTIFACT_STATES,
  EXECUTION_STATES,
  GATE_STATES,
  LEASE_STATES,
  REVIEW_RESEARCH_MACHINE_V1,
} from "./review-research-machine-v1.js";

const DEFAULT_LEASE_DURATION_MS = 5 * 60 * 1_000;
const DEFAULT_MAX_STEPS = 100;
const WRITE_CONFLICT_RETRIES = 5;
const SYSTEM_ACTOR = Object.freeze({
  id: "research-agent-service",
  role: "research_runtime",
  kind: "system",
});

export class ResearchAgentServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ResearchAgentServiceError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new ResearchAgentServiceError(code, message, details);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function contractType(contract) {
  return contract.split("@")[0].replace(/\[\]$/, "");
}

function isArrayContract(contract) {
  return contract.split("@")[0].endsWith("[]");
}

function hardDependencyIds(machine, nodeId) {
  return machine.edges
    .filter(
      (edge) => edge.type === "hard_dependency" && edge.target === nodeId,
    )
    .map((edge) => edge.source);
}

function isHumanRole(role) {
  return role === "human_researcher" || role === "author" || role?.startsWith("human_");
}

function openBlockers(runtimeNode) {
  return Object.values(runtimeNode?.blockers ?? {}).filter(
    (blocker) => blocker.status !== "resolved",
  );
}

function actorSnapshot(actor) {
  if (!actor?.id || !actor?.role || !actor?.kind) {
    fail("INVALID_ACTOR", "actor requires id, role, and kind.");
  }
  if (!["human", "agent", "system"].includes(actor.kind)) {
    fail("INVALID_ACTOR", `Unsupported actor kind: ${actor.kind}`);
  }
  return { id: actor.id, role: actor.role, kind: actor.kind };
}

function nowIso(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    fail("INVALID_CLOCK", "The service clock must return a valid date.");
  }
  return date.toISOString();
}

function normalizeSourceMaterial(
  material,
  index,
  projectId,
  { trustedRetrievalReceipt = false } = {},
) {
  if (!material || typeof material !== "object") {
    fail("INVALID_SOURCE_MATERIAL", `sourceMaterials[${index}] must be an object.`);
  }
  const id = hasText(material.id) ? material.id.trim() : `source:${projectId}:${index + 1}`;
  const title = hasText(material.title) ? material.title.trim() : `来源材料 ${index + 1}`;
  const text = material.text ?? material.abstract ?? null;
  if (text !== null && typeof text !== "string") {
    fail("INVALID_SOURCE_MATERIAL", `sourceMaterials[${index}].text must be a string or null.`);
  }
  const accessLevel = material.accessLevel ?? (hasText(text) ? "abstract_only" : "title_only");
  if (
    !["unknown", "title_only", "abstract_only", "full_text", "full_text_and_supplement"].includes(
      accessLevel,
    )
  ) {
    fail(
      "INVALID_SOURCE_MATERIAL",
      `sourceMaterials[${index}].accessLevel is unsupported.`,
    );
  }
  const locator =
    material.locator && typeof material.locator === "object"
      ? structuredClone(material.locator)
      : { repositoryId: `project:${projectId}:materials` };
  const fingerprintPayload = { id, title, text, accessLevel, locator };
  const expectedSourceSnapshotHash = sha256(fingerprintPayload);
  const sourceSnapshotHash = material.sourceSnapshotHash ?? expectedSourceSnapshotHash;
  if (!/^[a-f0-9]{64}$/i.test(sourceSnapshotHash)) {
    fail(
      "INVALID_SOURCE_MATERIAL",
      `sourceMaterials[${index}].sourceSnapshotHash must be SHA-256.`,
    );
  }
  if (
    !trustedRetrievalReceipt &&
    material.sourceSnapshotHash !== undefined &&
    sourceSnapshotHash.toLowerCase() !== expectedSourceSnapshotHash
  ) {
    fail(
      "SOURCE_SNAPSHOT_HASH_MISMATCH",
      `sourceMaterials[${index}].sourceSnapshotHash does not match the supplied material content.`,
    );
  }
  return {
    id,
    sourceId: id,
    provider: hasText(material.provider) ? material.provider.trim() : null,
    pmid: hasText(material.pmid) ? material.pmid.trim() : null,
    doi: hasText(material.doi) ? material.doi.trim() : null,
    title,
    text,
    abstract: hasText(material.abstract) ? material.abstract : null,
    journal: hasText(material.journal) ? material.journal.trim() : null,
    year: hasText(material.year) ? material.year.trim() : null,
    accessLevel,
    locator,
    sourceSnapshotHash: sourceSnapshotHash.toLowerCase(),
    limitations: Array.isArray(material.limitations)
      ? material.limitations.map(String)
      : [],
  };
}

function normalizeProjectInput(input, machine) {
  if (!input || typeof input !== "object") {
    fail("INVALID_PROJECT", "Project input is required.");
  }
  if (input.liveRetrieval !== undefined && input.liveRetrieval !== null) {
    fail(
      "EXTERNAL_LIVE_RETRIEVAL_FORBIDDEN",
      "项目输入不能携带自报 PubMed 回执；真实来源只能由 Harness 调用受控 Gateway 后写入。",
    );
  }
  if (input.retrievalRuns !== undefined && input.retrievalRuns !== null) {
    fail(
      "EXTERNAL_RETRIEVAL_RUNS_FORBIDDEN",
      "项目输入不能携带自报正式检索运行；正式回执只能由 Harness 受控执行后写入。",
    );
  }
  if (!hasText(input.id) || !hasText(input.title) || !hasText(input.question)) {
    fail("INVALID_PROJECT", "Project id, title, and question are required.");
  }
  const completionProfileId = input.completionProfileId ?? "evidence_brief";
  if (!machine.completionProfiles.some((profile) => profile.id === completionProfileId)) {
    fail("UNKNOWN_COMPLETION_PROFILE", `Unknown completion profile: ${completionProfileId}`);
  }
  const owner = actorSnapshot(input.owner);
  if (owner.kind !== "human") {
    fail("HUMAN_OWNER_REQUIRED", "A project owner must be a human actor.");
  }
  let queryPreviewSelection = null;
  if (input.queryPreviewSelection !== undefined && input.queryPreviewSelection !== null) {
    queryPreviewSelection = structuredClone(input.queryPreviewSelection);
    try {
      assertValidQueryPreviewSelection(queryPreviewSelection);
    } catch (error) {
      fail(error.code ?? "INVALID_QUERY_PREVIEW_SELECTION", error.message, error.details);
    }
    if (
      queryPreviewSelection.question.trim() !== input.question.trim() ||
      (hasText(input.searchQuery) &&
        queryPreviewSelection.query.trim() !== input.searchQuery.trim())
    ) {
      fail(
        "QUERY_PREVIEW_SELECTION_MISMATCH",
        "预检选择必须绑定当前研究问题与检索式。",
      );
    }
  }
  let scopingDecision = null;
  let scopingRounds = [];
  if (input.scopingDecision !== undefined && input.scopingDecision !== null) {
    scopingDecision = structuredClone(input.scopingDecision);
    try {
      assertValidResearchDirectionSelection(scopingDecision);
    } catch (error) {
      fail(error.code ?? "INVALID_RESEARCH_DIRECTION_SELECTION", error.message, error.details);
    }
    if (!Array.isArray(input.scopingRounds) || input.scopingRounds.length !== 2) {
      fail(
        "INVALID_SCOPING_ROUNDS",
        "已选择研究方向的项目必须同时保留首轮与第二轮调查。",
      );
    }
    scopingRounds = input.scopingRounds.map((round, index) => {
      if (!round || typeof round !== "object" || round.round !== index + 1) {
        fail("INVALID_SCOPING_ROUNDS", "调查轮次必须按首轮、第二轮连续记录。");
      }
      const previewSelection = structuredClone(round.previewSelection);
      try {
        assertValidQueryPreviewSelection(previewSelection);
      } catch (error) {
        fail(error.code ?? "INVALID_QUERY_PREVIEW_SELECTION", error.message, error.details);
      }
      if (
        !hasText(round.question) ||
        !hasText(round.query) ||
        previewSelection.question.trim() !== round.question.trim() ||
        previewSelection.query.trim() !== round.query.trim()
      ) {
        fail("INVALID_SCOPING_ROUNDS", "每轮调查必须绑定同一轮的研究问题、检索式与预检回执。");
      }
      return {
        round: index + 1,
        role: index === 0 ? "orientation" : "focused",
        question: round.question.trim(),
        query: round.query.trim(),
        previewSelection,
      };
    });
    const scopingMismatches = [
      scopingRounds[0].previewSelection.planHash !== scopingDecision.sourcePreviewPlanHash
        ? "first_round_plan" : null,
      scopingRounds[0].question.normalize("NFKC") !== scopingDecision.sourceQuestion.normalize("NFKC")
        ? "first_round_question" : null,
      scopingRounds[1].question !== input.question.trim()
        ? "second_round_question" : null,
      scopingRounds[1].previewSelection.selectionHash !== queryPreviewSelection?.selectionHash
        ? "second_round_preview" : null,
      scopingDecision.narrowedBrief.question.trim().normalize("NFKC") !== input.question.trim().normalize("NFKC")
        ? "narrowed_question" : null,
    ].filter(Boolean);
    if (scopingMismatches.length > 0) {
      fail(
        "SCOPING_DECISION_MISMATCH",
        `方向决定、两轮调查与最终研究问题没有绑定到同一条选择链（${scopingMismatches.join("、")}）。`,
      );
    }
  } else if (input.scopingRounds !== undefined && input.scopingRounds !== null) {
    fail("SCOPING_DECISION_REQUIRED", "调查轮次不能脱离研究者方向决定单独写入。");
  }
  const project = {
    id: input.id.trim(),
    title: input.title.trim(),
    question: input.question.trim(),
    completionProfileId,
    researchOwnerId: owner.id,
    constraints: Array.isArray(input.constraints) ? input.constraints.map(String) : [],
    researchMode: input.researchMode === "live_pubmed" ? "live_pubmed" : "guided_materials",
    searchQuery: hasText(input.searchQuery) ? input.searchQuery.trim() : null,
    searchLimit: Number.isInteger(input.searchLimit) ? input.searchLimit : 8,
    liveRetrieval: null,
    retrievalRuns: queryPreviewSelection
      ? { previewSelection: queryPreviewSelection }
      : {},
    scopingDecision,
    scopingRounds,
    sourceMaterials: (input.sourceMaterials ?? []).map((material, index) =>
      normalizeSourceMaterial(material, index, input.id.trim()),
    ),
  };
  return { project, owner };
}

function normalizedRetrievalRuns(project) {
  const runs =
    project?.retrievalRuns && typeof project.retrievalRuns === "object"
      ? structuredClone(project.retrievalRuns)
      : {};
  if (project?.liveRetrieval?.receiptHash && !runs.legacyBootstrap) {
    runs.legacyBootstrap = {
      schemaVersion: "research-legacy-retrieval-bootstrap/v1",
      authority: "legacy_single_receipt",
      reusableForFormalNodes: [],
      receipt: structuredClone(project.liveRetrieval),
    };
  }
  return runs;
}

function projectWithRetrievalRun(project, run) {
  const retrievalRuns = normalizedRetrievalRuns(project);
  if (run.purpose === "focusedCalibration") {
    const existing = Array.isArray(retrievalRuns.focusedCalibration)
      ? retrievalRuns.focusedCalibration
      : [];
    const byQueryId = new Map(existing.map((item) => [item.queryId, item]));
    byQueryId.set(run.queryId, structuredClone(run));
    retrievalRuns.focusedCalibration = [...byQueryId.values()];
  } else {
    retrievalRuns[run.purpose] = structuredClone(run);
  }
  const activeRuns =
    run.purpose === "focusedCalibration"
      ? retrievalRuns.focusedCalibration
      : [retrievalRuns[run.purpose]];
  const records = [...new Map(
    activeRuns
      .flatMap((item) => item?.receipt?.records ?? [])
      .map((record) => [record.sourceId ?? record.id, record]),
  ).values()];
  return {
    ...structuredClone(project),
    liveRetrieval: null,
    retrievalRuns,
    sourceMaterials: records.map((material, index) =>
      normalizeSourceMaterial(material, index, project.id, {
        trustedRetrievalReceipt: true,
      }),
    ),
  };
}

function retrievalRunsForPurpose(project, purpose) {
  const runs = normalizedRetrievalRuns(project);
  if (purpose === "focusedCalibration") {
    return Array.isArray(runs.focusedCalibration)
      ? runs.focusedCalibration
      : [];
  }
  return runs[purpose] ? [runs[purpose]] : [];
}

function exactRetrievalRun(project, request) {
  return retrievalRunsForPurpose(project, request.purpose).find(
    (run) =>
      run?.purpose === request.purpose &&
      run?.nodeId === request.nodeId &&
      run?.protocolArtifactId === request.protocolArtifactId &&
      run?.protocolContentHash === request.protocolContentHash &&
      run?.queryId === request.queryId &&
      run?.queryHash === request.queryHash,
  ) ?? null;
}

const FORMAL_RETRIEVAL_REVISION_TARGETS = Object.freeze({
  run_pilot_search: Object.freeze({
    protocolType: "OrientationSearchProtocol",
    resumeNodeId: "run_pilot_search",
    resetPurposes: ["pilot", "orientationCorpus", "focusedCalibration", "finalLibrary"],
  }),
  build_orientation_corpus: Object.freeze({
    protocolType: "OrientationSearchProtocol",
    resumeNodeId: "run_pilot_search",
    resetPurposes: ["pilot", "orientationCorpus", "focusedCalibration", "finalLibrary"],
  }),
  calibrate_focused_search: Object.freeze({
    protocolType: "FocusedSearchProtocol",
    resumeNodeId: "calibrate_focused_search",
    resetPurposes: ["focusedCalibration", "finalLibrary"],
  }),
  freeze_library: Object.freeze({
    protocolType: "FocusedSearchProtocol",
    resumeNodeId: "calibrate_focused_search",
    resetPurposes: ["focusedCalibration", "finalLibrary"],
  }),
});

function failureRetryClass(code, details = {}) {
  if (code === "PUBMED_NO_RESULTS") return "protocol_revision_required";
  const status = Number(details?.status);
  if (
    code === "PUBMED_TIMEOUT" ||
    status === 429 ||
    status >= 500 ||
    new Set([
      "PUBMED_SEARCH_FAILED",
      "PUBMED_FETCH_FAILED",
      "PUBMED_RETRIEVAL_FAILED",
      "PUBMED_GATEWAY_UNAVAILABLE",
    ]).has(code)
  ) {
    return "same_protocol_retry";
  }
  return "human_review_required";
}

function sanitizeFailureDetails(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    return structuredClone(value);
  } catch {
    return { serializationWarning: "原始工具错误详情无法安全持久化。" };
  }
}

function invalidateRetrievalPurposes(
  project,
  resetPurposes,
  { revisionId, revisedProtocolArtifactId, invalidatedAt } = {},
) {
  const reset = new Set(resetPurposes);
  const retrievalRuns = normalizedRetrievalRuns(project);
  const archived = Array.isArray(project?.retrievalRunHistory)
    ? structuredClone(project.retrievalRunHistory)
    : [];
  for (const purpose of reset) {
    const current = purpose === "focusedCalibration"
      ? Array.isArray(retrievalRuns.focusedCalibration)
        ? retrievalRuns.focusedCalibration
        : []
      : retrievalRuns[purpose]
        ? [retrievalRuns[purpose]]
        : [];
    archived.push(...current.map((run) => ({
      ...structuredClone(run),
      authority: "historical_only",
      invalidatedBy: {
        reason: "formal_protocol_revision",
        revisionId: revisionId ?? null,
        revisedProtocolArtifactId: revisedProtocolArtifactId ?? null,
        invalidatedAt: invalidatedAt ?? null,
      },
    })));
    delete retrievalRuns[purpose];
  }
  const remainingFormalRuns = [
    retrievalRuns.pilot,
    retrievalRuns.orientationCorpus,
    ...(Array.isArray(retrievalRuns.focusedCalibration)
      ? retrievalRuns.focusedCalibration
      : []),
    retrievalRuns.finalLibrary,
  ].filter(Boolean);
  const records = [...new Map(
    remainingFormalRuns
      .flatMap((run) => run.receipt?.records ?? [])
      .map((record) => [record.sourceId ?? record.id, record]),
  ).values()];
  return {
    ...structuredClone(project),
    retrievalRuns,
    retrievalRunHistory: archived,
    sourceMaterials: records.map((material, index) =>
      normalizeSourceMaterial(material, index, project.id, {
        trustedRetrievalReceipt: true,
      }),
    ),
  };
}

function revisedProtocolContent({ previous, artifactId, version, revisedQuery, actor, reason, revisedAt }) {
  const content = {
    ...structuredClone(previous.content),
    id: artifactId,
    version,
    createdAt: revisedAt,
    query: revisedQuery,
    queryHash: sha256(revisedQuery),
    previousProtocolFingerprint: {
      artifactId: previous.id,
      artifactType: previous.type,
      version: previous.version,
      contentHash: previous.contentHash,
    },
    humanRevision: {
      revisedBy: { id: actor.id, role: actor.role, kind: "human" },
      revisedAt,
      reason,
      previousQuery: previous.content?.query ?? previous.content?.selectedQuery ?? null,
      previousQueryHash: previous.content?.queryHash ?? null,
    },
  };
  if (previous.type === "FocusedSearchProtocol") {
    const primaryId = previous.content?.primaryQueryId ?? "focused:core";
    const previousVariants = Array.isArray(previous.content?.queryVariants)
      ? previous.content.queryVariants
      : [];
    const primaryIndex = Math.max(
      0,
      previousVariants.findIndex((variant) => variant.id === primaryId),
    );
    const variants = previousVariants.length > 0
      ? previousVariants.map((variant, index) => {
          const nextQuery = index === primaryIndex
            ? revisedQuery
            : `(${revisedQuery}) AND hasabstract`;
          return {
            ...structuredClone(variant),
            query: nextQuery,
            queryHash: sha256(nextQuery),
          };
        })
      : [
          {
            id: primaryId,
            purpose: "核心检索",
            query: revisedQuery,
            queryHash: sha256(revisedQuery),
          },
          {
            id: "focused:abstract-available",
            purpose: "摘要可读性校准",
            query: `(${revisedQuery}) AND hasabstract`,
            queryHash: sha256(`(${revisedQuery}) AND hasabstract`),
          },
        ];
    content.primaryQueryId = variants[primaryIndex]?.id ?? primaryId;
    content.queryVariants = variants;
  }
  return content;
}

function currentSearchAuthorityArtifacts(artifacts) {
  const all = Array.isArray(artifacts) ? artifacts : [];
  const byId = new Map(all.map((artifact) => [artifact.id, artifact]));
  const selected = new Map(
    all
      .filter(
        (artifact) =>
          artifact.freshness !== "stale" &&
          artifact.status !== ARTIFACT_STATES.SUPERSEDED,
      )
      .map((artifact) => [artifact.id, artifact]),
  );
  // A human revision is authoritative only if its immutable previous protocol
  // can still be resolved. Keep just that ancestry in the validation view;
  // unrelated stale calibration/frozen artifacts remain historical-only.
  let changed = true;
  while (changed) {
    changed = false;
    for (const artifact of [...selected.values()]) {
      const previousId = artifact.content?.previousProtocolFingerprint?.artifactId;
      if (!hasText(previousId) || selected.has(previousId) || !byId.has(previousId)) continue;
      selected.set(previousId, byId.get(previousId));
      changed = true;
    }
  }
  return [...selected.values()];
}

function projectSnapshotArtifactId(projectId) {
  return `artifact:${projectId}:capture_intent:ResearchIntent:1:v1`;
}

function criteriaProofs(node, artifactIds) {
  return node.acceptanceCriteria.map((criterion) => ({
    criterion,
    passed: true,
    proofArtifactIds: [...artifactIds],
  }));
}

function runtimeMode(runtimeAdapter) {
  return runtimeAdapter.describeRuntime?.().mode ?? "custom";
}

function revisionRequestForNode(state, nodeId) {
  const correctionId = state.nodeExecutions[nodeId]?.staleByCorrectionId;
  if (!correctionId) return null;
  const correction = [...state.corrections]
    .reverse()
    .find((item) => item.id === correctionId);
  if (!correction || correction.focusNodeId !== nodeId) return null;
  return {
    correctionId: correction.id,
    reason: correction.reason,
    requestedBy: structuredClone(correction.correctedBy),
    requestedAt: correction.correctedAt,
    sourceGateId: correction.sourceGateId ?? null,
    sourceGateFingerprint: correction.sourceGateFingerprint ?? null,
    amendmentTargetNodeId: correction.amendmentTargetNodeId ?? nodeId,
    artifactIds: [...(correction.artifactIds ?? [])],
  };
}

function contentHashFromStoreResult(result) {
  const hash = result?.hash ?? result?.contentHash ?? result?.address?.replace(/^sha256:/, "");
  if (!/^[a-f0-9]{64}$/i.test(hash ?? "")) {
    fail("INVALID_ARTIFACT_STORE_RESULT", "Artifact Store did not return a SHA-256 hash.");
  }
  return hash.toLowerCase();
}

/**
 * Project-scoped orchestration over the canonical event engine.
 *
 * The service deliberately keeps no mutable project document. Project facts,
 * node states, gates, leases, and artifact manifests are recovered from the
 * event log; artifact bodies are recovered through the hashes in those events.
 */
export class ResearchAgentServiceV1 {
  constructor({
    dataDir,
    machine = REVIEW_RESEARCH_MACHINE_V1,
    artifactStore = null,
    piRuntimeAdapter,
    toolGateway = null,
    now = () => new Date(),
    idFactory = () => randomUUID(),
    leaseDurationMs = DEFAULT_LEASE_DURATION_MS,
    onAgentEvent = null,
    onToolAudit = null,
  } = {}) {
    if (!hasText(dataDir)) {
      fail("INVALID_SERVICE_CONFIGURATION", "dataDir must be a non-empty string.");
    }
    if (!piRuntimeAdapter || typeof piRuntimeAdapter.execute !== "function") {
      fail(
        "INVALID_SERVICE_CONFIGURATION",
        "piRuntimeAdapter with an execute(workOrder) method is required.",
      );
    }
    if (!Number.isInteger(leaseDurationMs) || leaseDurationMs < 1_000) {
      fail(
        "INVALID_SERVICE_CONFIGURATION",
        "leaseDurationMs must be an integer of at least 1000 milliseconds.",
      );
    }
    this.dataDir = resolve(dataDir);
    this.eventsDir = join(this.dataDir, "events");
    this.agentRunsDir = join(this.dataDir, "agent-runs");
    this.machine = machine;
    this.artifactStore =
      artifactStore ??
      new ContentAddressedArtifactStore({ rootDir: join(this.dataDir, "artifacts") });
    this.piRuntimeAdapter = piRuntimeAdapter;
    this.toolGateway = toolGateway;
    this.now = now;
    this.idFactory = idFactory;
    this.leaseDurationMs = leaseDurationMs;
    this.onAgentEvent = onAgentEvent;
    this.onToolAudit = onToolAudit;
    this.eventStores = new Map();
    this.agentRunLogs = new Map();
    this.activeExecutions = new Map();
    this.activeProjectRuns = new Set();
  }

  async createProject(input) {
    const { project, owner } = normalizeProjectInput(input, this.machine);
    let state = await this.#loadState(project.id);
    if (!state.created) {
      state = await this.#dispatch(
        project.id,
        "CREATE_PROJECT",
        owner,
        { completionProfileId: project.completionProfileId },
      );
    } else {
      if (state.researchOwnerId !== owner.id) {
        fail("PROJECT_EXISTS", `Project ${project.id} belongs to another research owner.`);
      }
      const existingProject = await this.#projectSnapshot(state, { required: false });
      if (existingProject && sha256(existingProject) !== sha256(project)) {
        fail("PROJECT_EXISTS", `Project ${project.id} already has a different persisted intent.`);
      }
    }

    await this.#completeCaptureIntent(project, owner);
    return this.getProject(project.id);
  }

  async getProject(projectId) {
    const state = await this.#loadState(projectId);
    if (!state.created) fail("PROJECT_NOT_FOUND", `Unknown project: ${projectId}`);
    const artifacts = await this.#hydrateArtifacts(state);
    const project = await this.#projectSnapshot(state, { artifacts });
    const projection = {
      ...getRuntimeUserProjection(this.machine, state),
      boundary: this.#boundary(state, artifacts),
    };
    const agentRunStatus = await (await this.#agentRunLog(projectId)).deriveCurrentStatus();
    const runtimeProvenance = deriveProjectRuntimeProvenance(agentRunStatus);
    return {
      project,
      state,
      artifacts,
      projection,
      agentRunStatus,
      runtimeProvenance,
    };
  }

  async getProjectProjection(projectId) {
    return this.getProject(projectId);
  }

  async getAgentRunStatus(projectId) {
    return (await this.#agentRunLog(projectId)).deriveCurrentStatus();
  }

  async getProjectRuntimeProvenance(projectId) {
    return deriveProjectRuntimeProvenance(await this.getAgentRunStatus(projectId));
  }

  async #persistProjectSnapshot({ projectId, updatedProject, sourceRef, reason } = {}) {
    let state = await this.#loadState(projectId);
    if (!state.created) fail("PROJECT_NOT_FOUND", `Unknown project: ${projectId}`);
    const latestCapture = (await this.#hydrateArtifacts(state))
      .filter(
        (artifact) =>
          artifact.producedByNodeId === "capture_intent" &&
          artifact.content?.projectSnapshot,
      )
      .sort((left, right) => right.version - left.version)[0];
    const oldArtifactId = latestCapture?.id ?? projectSnapshotArtifactId(projectId);
    const oldArtifact = state.artifacts[oldArtifactId];
    if (!oldArtifact || oldArtifact.status !== ARTIFACT_STATES.ACCEPTED) {
      fail("PROJECT_SNAPSHOT_MISSING", "当前项目没有可升级的研究意图快照。");
    }
    const node = this.machine.nodes.find((candidate) => candidate.id === "capture_intent");
    const order = buildWorkOrder({
      machine: this.machine,
      state,
      node,
      project: updatedProject,
      inputArtifacts: [],
      runtimeMode: "deterministic",
      createdAt: nowIso(this.now),
    });
    const output = order.requiredOutputs[0];
    const candidate = createGuidedCandidates(order)[0];
    const content = { ...candidate.content, projectSnapshot: updatedProject };
    const contentHash = await this.#putContent(content);
    const artifactId = output.artifactId;
    await this.#dispatch(projectId, "IMPORT_LEGACY_CHECKPOINT", SYSTEM_ACTOR, {
      sourceRef,
      artifacts: [
        {
          id: artifactId,
          type: output.type,
          lineageId: output.lineageId,
          version: output.version,
          contentHash,
          status: ARTIFACT_STATES.ACCEPTED,
          inputArtifactRefs: [oldArtifactId],
          sourceRef,
          producedByNodeId: node.id,
          producedByActorId: SYSTEM_ACTOR.id,
          producedByActorRole: SYSTEM_ACTOR.role,
        },
      ],
      nodes: [
        {
          nodeId: node.id,
          state: EXECUTION_STATES.ACCEPTED,
          stale: false,
          artifactIds: [artifactId],
          sourceRef,
          reason,
        },
      ],
      gates: [],
    });
    return this.getProject(projectId);
  }

  async #attachRetrievalRuns({ projectId, runs } = {}) {
    if (!Array.isArray(runs) || runs.length === 0) {
      return this.getProject(projectId);
    }
    const current = await this.getProject(projectId);
    let updatedProject = current.project;
    for (const run of runs) {
      try {
        assertValidRetrievalRun(run);
      } catch (error) {
        fail(error.code ?? "INVALID_RETRIEVAL_RUN", error.message, error.details);
      }
      const existing = exactRetrievalRun(updatedProject, run);
      if (existing) {
        if (existing.receipt.receiptHash !== run.receipt.receiptHash) {
          fail(
            "RETRIEVAL_RUN_ALREADY_FROZEN",
            "同一协议查询已经冻结另一份检索回执。",
          );
        }
        continue;
      }
      updatedProject = projectWithRetrievalRun(updatedProject, run);
    }
    if (sha256(updatedProject) === sha256(current.project)) return current;
    const receiptHashes = runs.map((run) => run.receipt.receiptHash);
    return this.#persistProjectSnapshot({
      projectId,
      updatedProject,
      sourceRef: `pubmed-retrieval-runs:${sha256(receiptHashes)}`,
      reason: "按当前冻结检索协议持久化本轮 PubMed 回执。",
    });
  }

  async updateQueryPreviewSelection({ projectId, selection } = {}) {
    const current = await this.getProject(projectId);
    if (current.project.researchMode !== "live_pubmed") {
      fail("LIVE_RETRIEVAL_NOT_ENABLED", "当前项目没有启用 PubMed 真实研究模式。");
    }
    const activeNode = this.#currentNode(current.state);
    const clarify = current.state.nodeExecutions.clarify_question;
    if (
      activeNode?.id !== "clarify_question" ||
      clarify?.state !== EXECUTION_STATES.BLOCKED
    ) {
      fail(
        "QUERY_PREVIEW_UPDATE_NOT_ALLOWED",
        "只有暂停在研究问题澄清步骤的项目才能更新预检选择。",
      );
    }
    const formalPurposes = ["pilot", "orientationCorpus", "focusedCalibration", "finalLibrary"];
    if (formalPurposes.some((purpose) => retrievalRunsForPurpose(current.project, purpose).length > 0)) {
      fail("FORMAL_RETRIEVAL_ALREADY_STARTED", "正式检索开始后不能回写建项预检。 ");
    }
    const nextSelection = structuredClone(selection);
    try {
      assertValidQueryPreviewSelection(nextSelection);
    } catch (error) {
      fail(error.code ?? "INVALID_QUERY_PREVIEW_SELECTION", error.message, error.details);
    }
    if (nextSelection.question.trim() !== current.project.question.trim()) {
      fail("QUERY_PREVIEW_SELECTION_MISMATCH", "预检选择必须绑定当前研究问题。");
    }
    const retrievalRuns = normalizedRetrievalRuns(current.project);
    if (retrievalRuns.previewSelection?.selectionHash === nextSelection.selectionHash) {
      return current;
    }
    retrievalRuns.previewSelection = nextSelection;
    const updatedProject = {
      ...structuredClone(current.project),
      searchQuery: nextSelection.query.trim(),
      retrievalRuns,
    };
    return this.#persistProjectSnapshot({
      projectId,
      updatedProject,
      sourceRef: `pubmed-query-preview:${nextSelection.selectionHash}`,
      reason: "更新同一项目的受控 PubMed 预检选择；不产生正式研究来源。",
    });
  }

  async ensureLiveRetrieval({
    projectId,
    nodeId = null,
    signal,
  } = {}) {
    const current = await this.getProject(projectId);
    if (current.project.researchMode !== "live_pubmed") return current;
    const activeNode = this.#currentNode(current.state);
    const resolvedNodeId = nodeId ?? activeNode?.id;
    const node = this.machine.nodes.find((candidate) => candidate.id === resolvedNodeId);
    if (!node || !retrievalPurposeForNode(node)) {
      fail("RETRIEVAL_NODE_NOT_CURRENT", "当前步骤不是可执行的正式检索步骤。");
    }
    if (activeNode?.id !== node.id) {
      fail("RETRIEVAL_NODE_NOT_CURRENT", "只能执行当前状态机步骤对应的正式检索。");
    }
    const inputs = await this.#inputArtifacts(current.state, node);
    let requests;
    try {
      requests = buildRetrievalRequests({ node, inputArtifacts: inputs });
    } catch (error) {
      fail(error.code ?? "INVALID_RETRIEVAL_PROTOCOL", error.message, error.details);
    }
    let result = current;
    for (const request of requests) {
      const existing = exactRetrievalRun(result.project, request);
      if (existing) {
        assertValidRetrievalRun(existing, { purpose: request.purpose });
        continue;
      }
      const receipt = await runLiveRetrieval({
        gateway: this.toolGateway,
        project: result.project,
        node,
        request,
        signal,
        now: this.now,
      });
      result = await this.#attachRetrievalRuns({
        projectId,
        runs: [createRetrievalRun({ request, receipt })],
      });
    }
    return result;
  }

  describeRuntime() {
    return {
      service: "ResearchAgentServiceV1",
      machine: {
        id: this.machine.id,
        version: this.machine.version,
      },
      agent: this.piRuntimeAdapter.describeRuntime?.() ?? {
        adapter: this.piRuntimeAdapter.constructor?.name ?? "custom",
        mode: "custom",
      },
      persistence: {
        events: "project-scoped NDJSON hash chains",
        artifacts: "content-addressed immutable JSON",
        agentRuns: "project-scoped NDJSON lifecycle log",
      },
    };
  }

  async listProjects() {
    let entries;
    try {
      entries = await readdir(this.eventsDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    const projectIds = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".ndjson")) continue;
      const source = await readFile(join(this.eventsDir, entry.name), "utf8");
      const firstLine = source.split("\n", 1)[0];
      if (!hasText(firstLine)) continue;
      let firstEvent;
      try {
        firstEvent = JSON.parse(firstLine);
      } catch (error) {
        fail("INVALID_PROJECT_INDEX", `Cannot parse event log ${entry.name}.`, {
          cause: error?.message,
        });
      }
      if (hasText(firstEvent.projectId)) projectIds.push(firstEvent.projectId);
    }
    const projects = [];
    for (const projectId of [...new Set(projectIds)].sort()) {
      try {
        const result = await this.getProject(projectId);
        projects.push({
          id: projectId,
          title: result.project.title,
          question: result.project.question,
          researchMode: result.project.researchMode ?? "guided_materials",
          searchQuery: result.project.searchQuery ?? null,
          liveRetrieval: result.project.liveRetrieval ?? null,
          completionProfileId: result.state.completionProfileId,
          revision: result.state.revision,
          phase: result.projection.phase,
          activity: result.projection.activity,
          state: result.projection.state,
          complete: result.projection.complete,
          boundary: result.projection.boundary,
          agentRunStatus: result.agentRunStatus.status,
          loadable: true,
        });
      } catch (error) {
        projects.push({
          id: projectId,
          title: "需要恢复的历史研究",
          question: "历史运行在项目快照写入前中断；原事件记录仍保留。",
          researchMode: "unknown",
          completionProfileId: "evidence_brief",
          revision: null,
          phase: "question_formation",
          activity: "历史记录恢复",
          state: "failed",
          complete: false,
          boundary: null,
          agentRunStatus: "unavailable",
          loadable: false,
          loadError: {
            code: error?.code ?? "PROJECT_SNAPSHOT_INCOMPLETE",
            message: error?.message ?? String(error),
          },
        });
      }
    }
    return projects.sort((left, right) => Number(right.loadable) - Number(left.loadable));
  }

  async runUntilBoundary(projectId, { maxSteps = DEFAULT_MAX_STEPS, signal } = {}) {
    if (!Number.isInteger(maxSteps) || maxSteps < 1) {
      fail("INVALID_MAX_STEPS", "maxSteps must be a positive integer.");
    }
    if (this.activeProjectRuns.has(projectId)) {
      fail("PROJECT_RUN_ACTIVE", `Project ${projectId} is already running.`);
    }
    this.activeProjectRuns.add(projectId);
    try {
      for (let step = 0; step < maxSteps; step += 1) {
        if (signal?.aborted) {
          return this.getProject(projectId);
        }
        let state = await this.#loadState(projectId);
        if (!state.created) fail("PROJECT_NOT_FOUND", `Unknown project: ${projectId}`);
        const artifacts = await this.#hydrateArtifacts(state);
        const immediateBoundary = this.#boundary(state, artifacts);
        if (
          ["complete", "blocked", "cancelled", "human_gate", "human_review"].includes(
            immediateBoundary.type,
          )
        ) {
          return this.getProject(projectId);
        }

        const node = this.#nextRunnableNode(state);
        if (!node) return this.getProject(projectId);
        const runtimeNode = state.nodeExecutions[node.id];

        if (node.kind === "human_gate") {
          if (
            [EXECUTION_STATES.DRAFT, EXECUTION_STATES.REVISION].includes(
              runtimeNode.state,
            )
          ) {
            await this.#dispatch(projectId, "READY_NODE", SYSTEM_ACTOR, {
              nodeId: node.id,
            });
            state = await this.#loadState(projectId);
          }
          const current = state.nodeExecutions[node.id];
          if (current.state === EXECUTION_STATES.READY) {
            const inputs = this.#inputArtifactManifests(state, node);
            await this.#dispatch(projectId, "REQUEST_GATE", SYSTEM_ACTOR, {
              nodeId: node.id,
              gateId: this.#id(`gate:${node.id}`),
              artifactIds: inputs.map((artifact) => artifact.id),
            });
          }
          return this.getProject(projectId);
        }

        if (node.kind === "input") {
          const project = await this.#projectSnapshot(state, { artifacts });
          const owner = {
            id: state.researchOwnerId,
            role: "human_researcher",
            kind: "human",
          };
          await this.#completeCaptureIntent(project, owner);
          continue;
        }

        try {
          await this.#advanceAgentNode(projectId, node, signal);
        } catch (error) {
          const latest = await this.#loadState(projectId);
          const latestRuntime = latest.nodeExecutions[node.id];
          if (
            ![
              EXECUTION_STATES.BLOCKED,
              EXECUTION_STATES.CANCELLED,
              EXECUTION_STATES.ACCEPTED,
            ].includes(latestRuntime.state)
          ) {
            await this.#addFailureBlocker(projectId, node, error);
          }
          return this.getProject(projectId);
        }
      }

      const result = await this.getProject(projectId);
      result.projection.boundary = {
        type: "step_budget",
        maxSteps,
        message: "本轮自动推进达到步骤预算，可安全继续运行。",
      };
      return result;
    } finally {
      this.activeProjectRuns.delete(projectId);
    }
  }

  async gateDecision({
    projectId,
    gateId = null,
    actor,
    decision,
    reason,
    gateFingerprint = null,
  } = {}) {
    const human = actorSnapshot(actor);
    if (human.kind !== "human") fail("HUMAN_REQUIRED", "Gate decisions require a human.");
    const state = await this.#loadState(projectId);
    this.#assertOwnerOrSystem(state, human, { humanOnly: true });
    const gate = gateId
      ? state.gates[gateId]
      : Object.values(state.gates)
          .filter((item) => item.status === GATE_STATES.PENDING)
          .at(-1);
    if (!gate) fail("PENDING_GATE_NOT_FOUND", "No pending gate was found.");
    const node = this.machine.nodes.find((candidate) => candidate.id === gate.nodeId);
    const artifacts = await this.#hydrateArtifacts(state);
    const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
    const inputArtifacts = gate.artifactRefs.map((ref) => byId.get(ref.artifactId));
    if (inputArtifacts.some((artifact) => !artifact)) {
      fail("GATE_INPUT_CONTENT_MISSING", "A gate input could not be loaded from Artifact Store.");
    }
    if (
      node.id === "approve_claim_units" &&
      ["approved", "accepted_risk"].includes(decision)
    ) {
      const failedSentences = inputArtifacts
        .filter((artifact) => artifact.type === "ClaimVerificationResult")
        .flatMap((artifact) =>
          (artifact.content?.sentenceResults ?? [])
            .filter((result) => result.verdict !== "direct_support")
            .map((result) => ({
              artifactId: artifact.id,
              sentenceId: result.sentenceId,
              verdict: result.verdict,
              requiredRevision: result.requiredRevision,
            })),
        );
      if (failedSentences.length > 0) {
        fail(
          "CLAIM_VERIFICATION_NOT_PASSED",
          "仍有事实句未获得直接支持，不能进入全文；请按逐句核查结果修订或删除后再提交。",
          { failedSentences },
        );
      }
    }
    const project = await this.#projectSnapshot(state, { artifacts });
    const decidedAt = nowIso(this.now);
    const generated = createGateDecisionArtifacts({
      project,
      node,
      gate,
      decision,
      reason,
      state,
      inputArtifacts,
      humanActor: human,
      decidedAt,
    });
    const decisionArtifacts = [];
    for (const artifact of generated) {
      const contentHash = await this.#putContent(artifact.content);
      decisionArtifacts.push({ ...artifact, contentHash });
    }
    await this.#dispatch(
      projectId,
      "DECIDE_GATE",
      human,
      {
        gateId: gate.id,
        gateFingerprint: gateFingerprint ?? gate.fingerprint,
        decision,
        reason,
        decisionArtifacts,
        correctionId:
          decision === GATE_STATES.AMENDMENT_REQUESTED
            ? this.#id(`gate-amendment:${node.id}`)
            : null,
      },
      { trustedNow: decidedAt },
    );
    return this.getProject(projectId);
  }

  async manualReview({
    projectId,
    nodeId,
    actor,
    decision,
    reason,
    limitations = null,
  } = {}) {
    const human = actorSnapshot(actor);
    if (human.kind !== "human") fail("HUMAN_REQUIRED", "Manual review requires a human.");
    let state = await this.#loadState(projectId);
    this.#assertOwnerOrSystem(state, human, { humanOnly: true });
    const node = this.machine.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) fail("UNKNOWN_NODE", `Unknown node: ${nodeId}`);
    if (!isHumanRole(node.reviewerRole)) {
      fail("HUMAN_REVIEW_NOT_REQUIRED", `${nodeId} does not declare a human reviewer.`);
    }
    if (human.role !== node.reviewerRole) {
      fail("REVIEWER_ROLE_MISMATCH", `Expected reviewer role ${node.reviewerRole}.`);
    }
    const runtimeNode = state.nodeExecutions[nodeId];
    if (runtimeNode.state !== EXECUTION_STATES.REVIEW) {
      fail("INVALID_NODE_STATE", `${nodeId} is not awaiting review.`);
    }
    if (!hasText(reason)) fail("MISSING_REVIEW_REASON", "Manual review requires a reason.");

    const accepts =
      decision === "accepted" ||
      decision === "approved" ||
      decision === "accepted_with_limitations";
    if (!accepts && !["revision_requested", "rejected"].includes(decision)) {
      fail("INVALID_REVIEW_DECISION", `Unsupported manual review decision: ${decision}`);
    }
    const verdict = accepts
      ? decision === "accepted_with_limitations"
        ? "partial"
        : "pass"
      : "fail";
    const reviewLimitations = limitations ?? reason;
    for (const artifactId of runtimeNode.submittedArtifactIds) {
      state = await this.#loadState(projectId);
      if (state.artifacts[artifactId].status !== ARTIFACT_STATES.CANDIDATE) continue;
      await this.#dispatch(projectId, "VERIFY_ARTIFACT", human, {
        artifactId,
        verdict,
        limitations: verdict === "pass" ? null : reviewLimitations,
      });
    }
    if (accepts) {
      await this.#dispatch(projectId, "ACCEPT_NODE", human, {
        nodeId,
        artifactIds: [...runtimeNode.submittedArtifactIds],
        criteriaProofs: criteriaProofs(node, runtimeNode.submittedArtifactIds),
      });
    } else {
      await this.#dispatch(projectId, "ADD_BLOCKER", human, {
        nodeId,
        blocker: {
          id: this.#id(`manual-review:${nodeId}`),
          reason,
          owner: human.id,
          resolveWhen: "研究者确认修订要求已落实并允许重新执行。",
        },
      });
    }
    return this.getProject(projectId);
  }

  async pauseProject({ projectId, nodeId = null, actor, reason } = {}) {
    const principal = actorSnapshot(actor);
    const state = await this.#loadState(projectId);
    this.#assertOwnerOrSystem(state, principal);
    const node = nodeId
      ? this.machine.nodes.find((candidate) => candidate.id === nodeId)
      : this.#currentNode(state);
    if (!node) fail("NO_ACTIVE_NODE", "No active node can be paused.");
    const runtimeNode = state.nodeExecutions[node.id];
    if (
      node.kind === "human_gate" &&
      runtimeNode.state === EXECUTION_STATES.REVIEW
    ) {
      fail("ALREADY_AT_HUMAN_BOUNDARY", "A pending human gate is already safely paused.");
    }
    if (!hasText(reason)) fail("MISSING_REASON", "Pausing work requires a reason.");
    const blockerId = this.#id(`pause:${node.id}`);
    await this.#dispatch(projectId, "ADD_BLOCKER", principal, {
      nodeId: node.id,
      blocker: {
        id: blockerId,
        reason,
        owner: state.researchOwnerId,
        resolveWhen: "研究者明确恢复该步骤。",
      },
    });
    this.#abortActiveExecution(projectId, node.id);
    const result = await this.getProject(projectId);
    return { ...result, blockerId };
  }

  async resumeProject({
    projectId,
    nodeId = null,
    blockerId = null,
    actor,
    resolution = "研究者恢复执行。",
  } = {}) {
    const principal = actorSnapshot(actor);
    let state = await this.#loadState(projectId);
    this.#assertOwnerOrSystem(state, principal);
    const node = nodeId
      ? this.machine.nodes.find((candidate) => candidate.id === nodeId)
      : this.#currentNode(state);
    if (!node) fail("NO_ACTIVE_NODE", "No paused node was found.");
    const blockers = openBlockers(state.nodeExecutions[node.id]).filter(
      (blocker) => !blockerId || blocker.id === blockerId,
    );
    if (blockers.length === 0) fail("OPEN_BLOCKER_NOT_FOUND", "No matching blocker was found.");
    const revisionRequired = blockers.find(
      (blocker) => blocker.retryClass === "protocol_revision_required",
    );
    if (revisionRequired) {
      fail(
        "RETRIEVAL_PROTOCOL_REVISION_REQUIRED",
        "该正式检索已确认零结果，不能按原协议重复执行；请先由研究者修订检索协议。",
        {
          blockerId: revisionRequired.id,
          code: revisionRequired.code ?? null,
          protocolFingerprint: revisionRequired.protocolFingerprint ?? null,
        },
      );
    }
    for (const blocker of blockers) {
      await this.#dispatch(projectId, "RESOLVE_BLOCKER", principal, {
        nodeId: node.id,
        blockerId: blocker.id,
        resolution,
      });
    }
    state = await this.#loadState(projectId);
    if (
      state.nodeExecutions[node.id].state === EXECUTION_STATES.BLOCKED &&
      openBlockers(state.nodeExecutions[node.id]).length === 0
    ) {
      await this.#dispatch(projectId, "READY_NODE", SYSTEM_ACTOR, {
        nodeId: node.id,
      });
    }
    return this.getProject(projectId);
  }

  async reviseCurrentRetrievalProtocol({
    projectId,
    actor,
    revisedQuery,
    reason,
    blockerId = null,
    explicitRevision = false,
  } = {}) {
    const principal = actorSnapshot(actor);
    if (principal.kind !== "human") {
      fail(
        "HUMAN_REQUIRED",
        "只有项目研究者可以修订正式检索协议；Agent 不能自行改变研究方法。",
      );
    }
    if (!hasText(revisedQuery) || revisedQuery.trim().length < 3) {
      fail("INVALID_SEARCH_QUERY", "修订后的 PubMed 检索式至少需要 3 个字符。");
    }
    if (!hasText(reason) || reason.trim().length < 8) {
      fail("MISSING_REVISION_REASON", "正式检索协议修订需要至少 8 个字符的理由。");
    }
    const current = await this.getProject(projectId);
    this.#assertOwnerOrSystem(current.state, principal);
    if (current.project.researchMode !== "live_pubmed") {
      fail("LIVE_RETRIEVAL_NOT_ENABLED", "当前项目没有启用 PubMed 正式检索。");
    }
    if (current.projection.boundary.type !== "blocked") {
      fail(
        "RETRIEVAL_PROTOCOL_REVISION_NOT_ALLOWED",
        "只有停在正式检索失败边界的项目才能修订检索协议。",
      );
    }
    const blockedNodeId = current.projection.boundary.nodeId;
    const target = FORMAL_RETRIEVAL_REVISION_TARGETS[blockedNodeId];
    if (!target) {
      fail(
        "RETRIEVAL_PROTOCOL_REVISION_NOT_ALLOWED",
        "当前阻塞步骤不是正式 PubMed 检索节点。",
      );
    }
    const blockers = current.projection.boundary.blockers.filter(
      (blocker) => !blockerId || blocker.id === blockerId,
    );
    if (blockers.length !== 1) {
      fail(
        blockers.length === 0 ? "OPEN_BLOCKER_NOT_FOUND" : "AMBIGUOUS_RETRIEVAL_BLOCKER",
        blockers.length === 0
          ? "没有找到要修订的正式检索阻塞记录。"
          : "存在多个阻塞记录，请明确 blockerId。",
      );
    }
    const blocker = blockers[0];
    if (
      blocker.code !== "PUBMED_NO_RESULTS" &&
      explicitRevision !== true
    ) {
      fail(
        "EXPLICIT_PROTOCOL_REVISION_REQUIRED",
        "该故障可以先按原协议重试；若仍要改变研究方法，必须明确设置 explicitRevision。",
        { code: blocker.code ?? null, retryClass: blocker.retryClass ?? null },
      );
    }
    const producerNodeId = this.machine.nodes.find(
      (node) => node.outputs.some((contract) => contractType(contract) === target.protocolType),
    )?.id;
    const protocols = current.artifacts
      .filter(
        (artifact) =>
          artifact.type === target.protocolType &&
          artifact.status === ARTIFACT_STATES.ACCEPTED &&
          artifact.freshness !== "stale",
      )
      .sort((left, right) => right.version - left.version);
    const previous = protocols[0];
    if (!previous || !producerNodeId) {
      fail(
        "RETRIEVAL_PROTOCOL_TARGET_INVALID",
        `当前项目缺少可修订的 ${target.protocolType}。`,
      );
    }
    const normalizedQuery = revisedQuery.trim();
    const previousQuery = previous.content?.query ?? previous.content?.selectedQuery;
    if (normalizedQuery === previousQuery) {
      fail(
        "RETRIEVAL_PROTOCOL_QUERY_UNCHANGED",
        "修订后的检索式必须不同于当前协议；原式重试请使用 resumeProject。",
      );
    }
    const version = previous.version + 1;
    const artifactId = `artifact:${projectId}:${producerNodeId}:${target.protocolType}:1:v${version}`;
    if (artifactId === previous.id || current.state.artifacts[artifactId]) {
      fail(
        "RETRIEVAL_PROTOCOL_VERSION_CONFLICT",
        "检索协议修订版本已经存在；请刷新项目后基于当前版本再次修订。",
        { artifactId, previousArtifactId: previous.id, version },
      );
    }
    const revisedAt = nowIso(this.now);
    const content = revisedProtocolContent({
      previous,
      artifactId,
      version,
      revisedQuery: normalizedQuery,
      actor: principal,
      reason: reason.trim(),
      revisedAt,
    });
    const contentHash = await this.#putContent(content);
    const correctionId = this.#id(`protocol-revision:${blockedNodeId}`);
    const inputArtifactRefs = [
      ...new Set([...(previous.inputArtifactRefs ?? []), previous.id]),
    ];
    await this.#dispatch(
      projectId,
      "REVISE_RETRIEVAL_PROTOCOL",
      principal,
      {
        blockedNodeId,
        resumeNodeId: target.resumeNodeId,
        blockerId: blocker.id,
        previousArtifactId: previous.id,
        correctionId,
        reason: reason.trim(),
        explicitRevision: explicitRevision === true,
        content,
        artifact: {
          id: artifactId,
          type: previous.type,
          lineageId: previous.lineageId,
          version,
          contentHash,
          status: ARTIFACT_STATES.ACCEPTED,
          inputArtifactRefs,
          sourceRef: `human-protocol-revision:${correctionId}`,
          producedByNodeId: previous.producedByNodeId,
          producedByActorId: principal.id,
          producedByActorRole: principal.role,
        },
      },
      { trustedNow: revisedAt },
    );
    const afterCorrection = await this.getProject(projectId);
    const updatedProject = invalidateRetrievalPurposes(
      afterCorrection.project,
      target.resetPurposes,
      {
        revisionId: correctionId,
        revisedProtocolArtifactId: artifactId,
        invalidatedAt: revisedAt,
      },
    );
    updatedProject.protocolRevisions = [
      ...(Array.isArray(updatedProject.protocolRevisions)
        ? updatedProject.protocolRevisions
        : []),
      {
        id: correctionId,
        blockedNodeId,
        resumeNodeId: target.resumeNodeId,
        previousProtocolArtifactId: previous.id,
        revisedProtocolArtifactId: artifactId,
        previousQuery,
        revisedQuery: normalizedQuery,
        reason: reason.trim(),
        revisedAt,
        revisedBy: { id: principal.id, role: principal.role, kind: "human" },
        resetPurposes: [...target.resetPurposes],
      },
    ];
    await this.#persistProjectSnapshot({
      projectId,
      updatedProject,
      sourceRef: `formal-protocol-revision:${correctionId}`,
      reason: "按研究者明确决定保存新版正式检索协议并失效其下游检索回执。",
    });
    return this.getProject(projectId);
  }

  async cancelNode({ projectId, nodeId = null, actor, reason } = {}) {
    const principal = actorSnapshot(actor);
    const state = await this.#loadState(projectId);
    this.#assertOwnerOrSystem(state, principal);
    const node = nodeId
      ? this.machine.nodes.find((candidate) => candidate.id === nodeId)
      : this.#currentNode(state);
    if (!node) fail("NO_ACTIVE_NODE", "No active node can be cancelled.");
    await this.#dispatch(projectId, "CANCEL_NODE", principal, {
      nodeId: node.id,
      reason,
    });
    this.#abortActiveExecution(projectId, node.id);
    return this.getProject(projectId);
  }

  async pause(input) {
    return this.pauseProject(input);
  }

  async resume(input) {
    return this.resumeProject(input);
  }

  async cancel(input) {
    return this.cancelNode(input);
  }

  async #eventStore(projectId) {
    if (!hasText(projectId)) fail("INVALID_PROJECT_ID", "projectId is required.");
    let store = this.eventStores.get(projectId);
    if (store) return store;
    await mkdir(this.eventsDir, { recursive: true, mode: 0o700 });
    const fileName = `${sha256(projectId)}.ndjson`;
    store = new NdjsonEventStore({
      filePath: join(this.eventsDir, fileName),
      projectId,
    });
    this.eventStores.set(projectId, store);
    return store;
  }

  async #agentRunLog(projectId) {
    let log = this.agentRunLogs.get(projectId);
    if (log) return log;
    await mkdir(this.agentRunsDir, { recursive: true, mode: 0o700 });
    log = new AgentRunLog({
      filePath: join(this.agentRunsDir, `${sha256(projectId)}.ndjson`),
      projectId,
    });
    this.agentRunLogs.set(projectId, log);
    return log;
  }

  async #appendAgentRunEvents(projectId, events) {
    const log = await this.#agentRunLog(projectId);
    for (let attempt = 0; attempt < WRITE_CONFLICT_RETRIES; attempt += 1) {
      const existing = await log.load();
      try {
        await log.append({ expectedVersion: existing.length, events });
        return;
      } catch (error) {
        if (error?.code !== "EXPECTED_VERSION_MISMATCH") throw error;
      }
    }
    fail("AGENT_RUN_LOG_CONFLICT", "Could not append the Agent run lifecycle.");
  }

  #agentRunEvent(type, actor, extra = {}) {
    return {
      eventId: this.#id(`agent-run-event:${type.replaceAll(".", "-")}`),
      type,
      occurredAt: nowIso(this.now),
      actor: actorSnapshot(actor),
      payload: {},
      ...extra,
    };
  }

  async #startAgentRun(projectId, workOrder, actor) {
    const runId = this.#id(`run:${workOrder.nodeId}`);
    const lifecycle = {
      projectId,
      workOrderId: workOrder.id,
      runId,
      startedAt: null,
      actor: actorSnapshot(actor),
      tools: new Map(),
      tail: Promise.resolve(),
      terminal: false,
    };
    const openingEvents = [
      this.#agentRunEvent(AGENT_RUN_EVENT_TYPES.WORK_ORDER_CREATED, actor, {
        workOrderId: workOrder.id,
        payload: {
          nodeId: workOrder.nodeId,
          roleTemplateId: workOrder.role,
          objective: workOrder.objective,
          contextSnapshotHash: workOrder.contextSnapshotHash,
          requiredOutputs: workOrder.requiredOutputs.map((output) => ({
            artifactId: output.artifactId,
            type: output.type,
            version: output.version,
          })),
        },
      }),
      this.#agentRunEvent(AGENT_RUN_EVENT_TYPES.WORK_ORDER_STARTED, actor, {
        workOrderId: workOrder.id,
      }),
      this.#agentRunEvent(AGENT_RUN_EVENT_TYPES.RUN_CREATED, actor, {
        workOrderId: workOrder.id,
        runId,
        payload: {
          runtime: this.piRuntimeAdapter.describeRuntime?.() ?? { mode: "custom" },
          budget: workOrder.budget,
        },
      }),
    ];
    const runStartedEvent = this.#agentRunEvent(
      AGENT_RUN_EVENT_TYPES.RUN_STARTED,
      actor,
      { runId },
    );
    lifecycle.startedAt = runStartedEvent.occurredAt;
    await this.#appendAgentRunEvents(projectId, [...openingEvents, runStartedEvent]);
    return lifecycle;
  }

  #queueLifecycle(lifecycle, operation) {
    const queued = lifecycle.tail.then(operation, operation);
    lifecycle.tail = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  async #ensureToolStarted(lifecycle, event) {
    const toolCallId = event.toolCallId;
    if (!hasText(toolCallId)) return;
    if (lifecycle.tools.has(toolCallId)) return;
    const toolName = event.toolName ?? "unknown_tool";
    lifecycle.tools.set(toolCallId, { status: "running", toolName });
    await this.#appendAgentRunEvents(lifecycle.projectId, [
      this.#agentRunEvent(AGENT_RUN_EVENT_TYPES.TOOL_REQUESTED, lifecycle.actor, {
        runId: lifecycle.runId,
        toolCallId,
        payload: {
          toolId: toolName,
          toolVersion: "1.0.0",
          inputSummaryHash: sha256({
            workOrderId: lifecycle.workOrderId,
            toolCallId,
            toolName,
          }),
        },
      }),
      this.#agentRunEvent(AGENT_RUN_EVENT_TYPES.TOOL_STARTED, lifecycle.actor, {
        runId: lifecycle.runId,
        toolCallId,
      }),
    ]);
  }

  async #finishTool(lifecycle, event, status) {
    await this.#ensureToolStarted(lifecycle, event);
    const tool = lifecycle.tools.get(event.toolCallId);
    if (!tool || ["completed", "failed", "cancelled"].includes(tool.status)) return;
    tool.status = status;
    const eventType =
      status === "completed"
        ? AGENT_RUN_EVENT_TYPES.TOOL_COMPLETED
        : status === "cancelled"
          ? AGENT_RUN_EVENT_TYPES.TOOL_CANCELLED
          : AGENT_RUN_EVENT_TYPES.TOOL_FAILED;
    await this.#appendAgentRunEvents(lifecycle.projectId, [
      this.#agentRunEvent(eventType, lifecycle.actor, {
        runId: lifecycle.runId,
        toolCallId: event.toolCallId,
        payload: {
          toolId: tool.toolName,
          durationMs: event.durationMs ?? null,
          resultSummaryHash: sha256(event.details ?? {
            isError: event.isError ?? status !== "completed",
          }),
        },
      }),
    ]);
  }

  #recordAgentEvent(lifecycle, event) {
    return this.#queueLifecycle(lifecycle, async () => {
      if (event.type === "tool_started") {
        await this.#ensureToolStarted(lifecycle, event);
      } else if (event.type === "tool_completed") {
        await this.#finishTool(lifecycle, event, "completed");
      } else if (event.type === "tool_failed") {
        await this.#finishTool(lifecycle, event, "failed");
      }
      await this.onAgentEvent?.(event);
    });
  }

  #recordToolAudit(lifecycle, event) {
    return this.#queueLifecycle(lifecycle, async () => {
      await this.#finishTool(lifecycle, event, "completed");
      await this.onToolAudit?.(event);
    });
  }

  async #finishAgentRun(lifecycle, status, payload = {}) {
    if (lifecycle.terminal) return;
    await lifecycle.tail;
    const closingToolEvents = [];
    for (const [toolCallId, tool] of lifecycle.tools) {
      if (["completed", "failed", "cancelled"].includes(tool.status)) continue;
      tool.status = status === "completed" ? "failed" : "cancelled";
      closingToolEvents.push(
        this.#agentRunEvent(
          status === "completed"
            ? AGENT_RUN_EVENT_TYPES.TOOL_FAILED
            : AGENT_RUN_EVENT_TYPES.TOOL_CANCELLED,
          lifecycle.actor,
          {
            runId: lifecycle.runId,
            toolCallId,
            payload: {
              toolId: tool.toolName,
              resultSummaryHash: sha256({ reason: "run_terminated" }),
            },
          },
        ),
      );
    }
    const runType =
      status === "completed"
        ? AGENT_RUN_EVENT_TYPES.RUN_COMPLETED
        : status === "cancelled"
          ? AGENT_RUN_EVENT_TYPES.RUN_CANCELLED
          : AGENT_RUN_EVENT_TYPES.RUN_FAILED;
    const workOrderType =
      status === "completed"
        ? AGENT_RUN_EVENT_TYPES.WORK_ORDER_COMPLETED
        : status === "cancelled"
          ? AGENT_RUN_EVENT_TYPES.WORK_ORDER_CANCELLED
          : AGENT_RUN_EVENT_TYPES.WORK_ORDER_FAILED;
    const terminalAt = nowIso(this.now);
    const terminalPayload =
      typeof payload === "function" ? payload(terminalAt) : payload;
    await this.#appendAgentRunEvents(lifecycle.projectId, [
      ...closingToolEvents,
      this.#agentRunEvent(runType, lifecycle.actor, {
        runId: lifecycle.runId,
        occurredAt: terminalAt,
        payload: terminalPayload,
      }),
      this.#agentRunEvent(workOrderType, lifecycle.actor, {
        workOrderId: lifecycle.workOrderId,
        payload: terminalPayload,
      }),
    ]);
    lifecycle.terminal = true;
  }

  async #executeRuntimeWorkOrder(projectId, workOrder, actor, controller) {
    const lifecycle = await this.#startAgentRun(projectId, workOrder, actor);
    try {
      const runtimeResult = await this.piRuntimeAdapter.execute(workOrder, {
        signal: controller.signal,
        onEvent: (event) => this.#recordAgentEvent(lifecycle, event),
        onToolAudit: (event) => this.#recordToolAudit(lifecycle, event),
      });
      const verifiedCandidates = await enforceCitationVerification({
        workOrder,
        candidates: runtimeResult.candidates,
        gateway: this.toolGateway,
        onReceipt: (event) => this.#recordToolAudit(lifecycle, event),
      });
      const result = { ...runtimeResult, candidates: verifiedCandidates };
      if (result.usage && Object.keys(result.usage).length > 0) {
        await this.#appendAgentRunEvents(projectId, [
          this.#agentRunEvent(AGENT_RUN_EVENT_TYPES.RUN_USAGE_UPDATED, actor, {
            runId: lifecycle.runId,
            payload: {
              ...result.usage,
              turnCount: result.turnCount ?? null,
              toolCallCount: result.toolCallCount ?? null,
            },
          }),
        ]);
      }
      await this.#finishAgentRun(lifecycle, "completed", (completedAt) => ({
        candidateArtifactIds: result.candidates.map((candidate) => candidate.artifactId),
        runtime: result.runtime ?? null,
        stopReason: result.stopReason ?? null,
        usage: result.usage ?? null,
        turnCount: result.turnCount ?? null,
        toolCallCount: result.toolCallCount ?? null,
        modelInvocationReceipt: createModelInvocationReceipt({
          projectId,
          workOrderId: lifecycle.workOrderId,
          runId: lifecycle.runId,
          runtime: result.runtime,
          usage: result.usage,
          stopReason: result.stopReason,
          startedAt: lifecycle.startedAt,
          completedAt,
        }),
      }));
      return { result, runId: lifecycle.runId };
    } catch (error) {
      await this.#finishAgentRun(
        lifecycle,
        controller.signal.aborted ? "cancelled" : "failed",
        {
          errorCode: error?.code ?? null,
          errorMessage: error?.message ?? String(error),
        },
      );
      throw error;
    }
  }

  async #loadState(projectId) {
    const store = await this.#eventStore(projectId);
    return store.replay(this.machine);
  }

  async #dispatch(
    projectId,
    type,
    actor,
    payload,
    { commandId = this.#id(`command:${type.toLowerCase()}`), trustedNow = nowIso(this.now) } = {},
  ) {
    const authenticatedActor = actorSnapshot(actor);
    const store = await this.#eventStore(projectId);
    for (let attempt = 0; attempt < WRITE_CONFLICT_RETRIES; attempt += 1) {
      const events = await store.load();
      const result = dispatchTrustedCommand(
        this.machine,
        events,
        {
          type,
          commandId,
          projectId,
          expectedVersion: events.length,
          ...payload,
        },
        { authenticatedActor, trustedNow },
      );
      if (result.newEvents.length === 0) return result.state;
      try {
        await store.append({
          expectedVersion: events.length,
          events: result.newEvents,
        });
        return result.state;
      } catch (error) {
        if (error?.code !== "EXPECTED_VERSION_MISMATCH") throw error;
      }
    }
    fail("EVENT_WRITE_CONFLICT", `Could not append ${type} after concurrent updates.`);
  }

  async #putContent(content) {
    if (typeof this.artifactStore.put !== "function") {
      fail("INVALID_ARTIFACT_STORE", "Artifact Store must implement put(content).");
    }
    const result = await this.artifactStore.put(content);
    const hash = contentHashFromStoreResult(result);
    if (sha256(content) !== hash) {
      fail(
        "ARTIFACT_HASH_ADAPTER_MISMATCH",
        "Artifact Store canonical hash differs from the event engine content hash.",
      );
    }
    return hash;
  }

  async #readContent(contentHash) {
    if (!/^[a-f0-9]{64}$/i.test(contentHash ?? "")) {
      fail("INVALID_CONTENT_HASH", "Artifact manifest contains an invalid content hash.");
    }
    if (typeof this.artifactStore.read === "function") {
      return this.artifactStore.read(`sha256:${contentHash.toLowerCase()}`);
    }
    if (typeof this.artifactStore.get === "function") {
      return this.artifactStore.get(contentHash.toLowerCase());
    }
    fail("INVALID_ARTIFACT_STORE", "Artifact Store must implement read(address) or get(hash).");
  }

  async #hydrateArtifacts(state) {
    const artifacts = [];
    for (const artifact of Object.values(state.artifacts)) {
      artifacts.push({
        ...structuredClone(artifact),
        content: await this.#readContent(artifact.contentHash),
      });
    }
    return artifacts;
  }

  async #projectSnapshot(state, { artifacts = null, required = true } = {}) {
    const hydrated = artifacts ?? (await this.#hydrateArtifacts(state));
    const captureArtifacts = hydrated
      .filter(
        (artifact) =>
          artifact.producedByNodeId === "capture_intent" &&
          artifact.content?.projectSnapshot,
      )
      .sort((left, right) => right.version - left.version);
    const snapshot = captureArtifacts[0]?.content?.projectSnapshot;
    if (!snapshot && required) {
      fail(
        "PROJECT_SNAPSHOT_MISSING",
        "The authoritative capture_intent artifact has no project snapshot.",
      );
    }
    if (!snapshot) return null;
    const normalized = structuredClone(snapshot);
    normalized.retrievalRuns = normalizedRetrievalRuns(normalized);
    return normalized;
  }

  async #completeCaptureIntent(project, owner) {
    const node = this.machine.nodes.find((candidate) => candidate.id === "capture_intent");
    if (!node) fail("CAPTURE_NODE_MISSING", "Machine has no capture_intent node.");
    for (let step = 0; step < 10; step += 1) {
      let state = await this.#loadState(project.id);
      const runtimeNode = state.nodeExecutions[node.id];
      if (runtimeNode.state === EXECUTION_STATES.ACCEPTED) return state;
      if (runtimeNode.state === EXECUTION_STATES.BLOCKED) {
        fail("CAPTURE_INTENT_BLOCKED", "capture_intent is blocked and requires resolution.");
      }
      if ([EXECUTION_STATES.DRAFT, EXECUTION_STATES.REVISION].includes(runtimeNode.state)) {
        await this.#dispatch(project.id, "READY_NODE", SYSTEM_ACTOR, { nodeId: node.id });
        continue;
      }
      if (runtimeNode.state === EXECUTION_STATES.READY) {
        await this.#dispatch(project.id, "START_NODE", owner, { nodeId: node.id });
        continue;
      }
      if (runtimeNode.state === EXECUTION_STATES.RUNNING) {
        const existing = Object.values(state.artifacts).filter(
          (artifact) =>
            artifact.producedByNodeId === node.id &&
            artifact.status === ARTIFACT_STATES.CANDIDATE,
        );
        let artifactIds = existing.map((artifact) => artifact.id);
        if (artifactIds.length === 0) {
          const order = buildWorkOrder({
            machine: this.machine,
            state,
            node,
            project,
            inputArtifacts: [],
            runtimeMode: "deterministic",
            createdAt: nowIso(this.now),
          });
          const candidates = createGuidedCandidates(order).map((candidate) => ({
            ...candidate,
            content: { ...candidate.content, projectSnapshot: project },
          }));
          for (const candidate of candidates) {
            const spec = order.requiredOutputs.find(
              (output) => output.artifactId === candidate.artifactId,
            );
            const contentHash = await this.#putContent(candidate.content);
            await this.#dispatch(project.id, "PRODUCE_ARTIFACT", owner, {
              nodeId: node.id,
              artifact: {
                id: spec.artifactId,
                type: spec.type,
                lineageId: spec.lineageId,
                version: spec.version,
                content: candidate.content,
                contentHash,
                inputArtifactRefs: [],
                sourceRef: `project:${project.id}:intent`,
              },
            });
            artifactIds.push(spec.artifactId);
          }
        }
        await this.#dispatch(project.id, "SUBMIT_NODE", owner, {
          nodeId: node.id,
          artifactIds,
        });
        continue;
      }
      if (runtimeNode.state === EXECUTION_STATES.REVIEW) {
        const reviewer = { ...SYSTEM_ACTOR, role: node.reviewerRole ?? "intake_reviewer" };
        for (const artifactId of runtimeNode.submittedArtifactIds) {
          state = await this.#loadState(project.id);
          if (state.artifacts[artifactId].status === ARTIFACT_STATES.CANDIDATE) {
            await this.#dispatch(project.id, "VERIFY_ARTIFACT", reviewer, {
              artifactId,
              verdict: "pass",
            });
          }
        }
        await this.#dispatch(project.id, "ACCEPT_NODE", reviewer, {
          nodeId: node.id,
          artifactIds: [...runtimeNode.submittedArtifactIds],
          criteriaProofs: criteriaProofs(node, runtimeNode.submittedArtifactIds),
        });
        continue;
      }
      fail("INVALID_CAPTURE_STATE", `Cannot complete capture_intent from ${runtimeNode.state}.`);
    }
    fail("CAPTURE_STEP_LIMIT", "capture_intent did not converge within its step budget.");
  }

  #profileNodes(state) {
    const profile = this.machine.completionProfiles.find(
      (candidate) => candidate.id === state.completionProfileId,
    );
    if (!profile) return [];
    const included = new Set([profile.terminalNodeId]);
    const pending = [profile.terminalNodeId];
    while (pending.length > 0) {
      const target = pending.pop();
      for (const dependencyId of hardDependencyIds(this.machine, target)) {
        if (!included.has(dependencyId)) {
          included.add(dependencyId);
          pending.push(dependencyId);
        }
      }
    }
    return this.machine.nodes.filter((node) => included.has(node.id));
  }

  #dependenciesAccepted(state, node) {
    return hardDependencyIds(this.machine, node.id).every((dependencyId) => {
      const dependency = state.nodeExecutions[dependencyId];
      return dependency.state === EXECUTION_STATES.ACCEPTED && dependency.stale !== true;
    });
  }

  #nextRunnableNode(state) {
    return (
      this.#profileNodes(state).find((node) => {
        const runtimeNode = state.nodeExecutions[node.id];
        if (
          runtimeNode.state === EXECUTION_STATES.ACCEPTED &&
          runtimeNode.stale !== true
        ) {
          return false;
        }
        if (
          [EXECUTION_STATES.BLOCKED, EXECUTION_STATES.CANCELLED].includes(
            runtimeNode.state,
          )
        ) {
          return true;
        }
        if (runtimeNode.state === EXECUTION_STATES.REVIEW) return true;
        return this.#dependenciesAccepted(state, node);
      }) ?? null
    );
  }

  #currentNode(state) {
    const nodes = this.#profileNodes(state);
    const priorities = [
      EXECUTION_STATES.RUNNING,
      EXECUTION_STATES.REVIEW,
      EXECUTION_STATES.BLOCKED,
      EXECUTION_STATES.READY,
      EXECUTION_STATES.REVISION,
      EXECUTION_STATES.DRAFT,
    ];
    for (const status of priorities) {
      const node = nodes.find(
        (candidate) => state.nodeExecutions[candidate.id].state === status,
      );
      if (node) return node;
    }
    return null;
  }

  #inputArtifactManifests(state, node) {
    const dependencyIds = hardDependencyIds(this.machine, node.id);
    const directArtifactIds = new Set(
      dependencyIds.flatMap(
        (dependencyId) => state.nodeExecutions[dependencyId].acceptedArtifactIds,
      ),
    );
    const acceptedCurrent = Object.values(state.artifacts).filter(
      (artifact) =>
        artifact.status === ARTIFACT_STATES.ACCEPTED &&
        artifact.freshness !== "stale",
    );
    const selected = [];
    for (const contract of node.inputs) {
      const type = contractType(contract);
      const allOfType = acceptedCurrent.filter((artifact) => artifact.type === type);
      const direct = allOfType.filter((artifact) => directArtifactIds.has(artifact.id));
      const pool = direct.length > 0 ? direct : allOfType;
      const newestByLineage = new Map();
      for (const artifact of pool) {
        const current = newestByLineage.get(artifact.lineageId);
        if (!current || artifact.version > current.version) {
          newestByLineage.set(artifact.lineageId, artifact);
        }
      }
      const current = [...newestByLineage.values()];
      if (current.length === 0) {
        fail(
          "MISSING_INPUT_ARTIFACT",
          `${node.id} requires an accepted current ${type} artifact.`,
        );
      }
      if (!isArrayContract(contract) && current.length !== 1) {
        fail(
          "AMBIGUOUS_INPUT_ARTIFACT",
          `${node.id} has ${current.length} eligible ${type} artifacts for a singular input.`,
          { nodeId: node.id, type, artifactIds: current.map((artifact) => artifact.id) },
        );
      }
      selected.push(...(isArrayContract(contract) ? current : [current[0]]));
    }
    return [...new Map(selected.map((artifact) => [artifact.id, artifact])).values()];
  }

  async #inputArtifacts(state, node) {
    const manifests = this.#inputArtifactManifests(state, node);
    const hydrated = [];
    for (const artifact of manifests) {
      hydrated.push({
        ...structuredClone(artifact),
        content: await this.#readContent(artifact.contentHash),
      });
    }
    return hydrated;
  }

  async #advanceAgentNode(projectId, node, signal) {
    let state = await this.#loadState(projectId);
    let runtimeNode = state.nodeExecutions[node.id];
    if (runtimeNode.state === EXECUTION_STATES.BLOCKED) return;
    if (
      [EXECUTION_STATES.DRAFT, EXECUTION_STATES.REVISION].includes(runtimeNode.state)
    ) {
      await this.#dispatch(projectId, "READY_NODE", SYSTEM_ACTOR, { nodeId: node.id });
      state = await this.#loadState(projectId);
      runtimeNode = state.nodeExecutions[node.id];
    }
    if (runtimeNode.state === EXECUTION_STATES.REVIEW) {
      if (isHumanRole(node.reviewerRole)) return;
      await this.#runAgentReview(projectId, node, signal);
      return;
    }
    if (![EXECUTION_STATES.READY, EXECUTION_STATES.RUNNING].includes(runtimeNode.state)) {
      return;
    }

    const executor = {
      id: `agent:${node.executorRole ?? "research_worker"}`,
      role: node.executorRole ?? "research_worker",
      kind: "agent",
    };
    let lease = runtimeNode.activeLeaseId
      ? state.workLeases[runtimeNode.activeLeaseId]
      : null;
    if (lease && [LEASE_STATES.CLAIMED, LEASE_STATES.RUNNING].includes(lease.status)) {
      if (Date.parse(nowIso(this.now)) >= Date.parse(lease.expiresAt)) {
        await this.#dispatch(projectId, "EXPIRE_WORK", SYSTEM_ACTOR, {
          leaseId: lease.id,
        });
        return;
      }
      if (lease.claimedBy.actorId !== executor.id) {
        fail("FOREIGN_ACTIVE_LEASE", `Node ${node.id} is held by ${lease.claimedBy.actorId}.`);
      }
    }
    if (!lease) {
      const claimedAt = nowIso(this.now);
      const leaseId = this.#id(`lease:${node.id}`);
      await this.#dispatch(
        projectId,
        "CLAIM_WORK",
        executor,
        {
          nodeId: node.id,
          leaseId,
          expiresAt: new Date(Date.parse(claimedAt) + this.leaseDurationMs).toISOString(),
        },
        { trustedNow: claimedAt },
      );
      state = await this.#loadState(projectId);
      lease = state.workLeases[leaseId];
    }
    if (lease.status === LEASE_STATES.CLAIMED) {
      await this.#dispatch(projectId, "START_NODE", executor, {
        nodeId: node.id,
        leaseId: lease.id,
      });
    }
    state = await this.#loadState(projectId);
    runtimeNode = state.nodeExecutions[node.id];

    const recoverableArtifacts = Object.values(state.artifacts).filter(
      (artifact) =>
        artifact.producedByNodeId === node.id &&
        artifact.producedUnderLeaseId === lease.id &&
        [ARTIFACT_STATES.CANDIDATE, ARTIFACT_STATES.VERIFIED].includes(artifact.status),
    );
    const requiredTypes = new Set(node.outputs.map(contractType));
    if (
      requiredTypes.size > 0 &&
      [...requiredTypes].every((type) =>
        recoverableArtifacts.some((artifact) => artifact.type === type),
      )
    ) {
      await this.#dispatch(projectId, "SUBMIT_NODE", executor, {
        nodeId: node.id,
        leaseId: lease.id,
        artifactIds: recoverableArtifacts.map((artifact) => artifact.id),
      });
      return;
    }

    const inputs = await this.#inputArtifacts(state, node);
    const allArtifacts = await this.#hydrateArtifacts(state);
    let project = await this.#projectSnapshot(state, { artifacts: allArtifacts });
    const mode = runtimeMode(this.piRuntimeAdapter);
    let workOrder = buildWorkOrder({
      machine: this.machine,
      state,
      node,
      project,
      inputArtifacts: inputs,
      runtimeMode: mode,
      createdAt: nowIso(this.now),
      revisionRequest: revisionRequestForNode(state, node.id),
    });
    let retrievalProject = null;
    let currentRetrievalRuns = [];
    if (shouldRunLiveRetrieval(project, node)) {
      let requests;
      try {
        requests = buildRetrievalRequests({ node, inputArtifacts: inputs });
      } catch (error) {
        fail(error.code ?? "INVALID_RETRIEVAL_PROTOCOL", error.message, error.details);
      }
      for (const request of requests) {
        const existing = exactRetrievalRun(project, request);
        if (existing) {
          try {
            assertValidRetrievalRun(existing, { purpose: request.purpose });
          } catch (error) {
            fail(error.code ?? "INVALID_RETRIEVAL_RUN", error.message, error.details);
          }
          continue;
        }
        const receipt = await runLiveRetrieval({
          gateway: this.toolGateway,
          project,
          node,
          request,
          signal,
          now: this.now,
        });
        const run = createRetrievalRun({ request, receipt });
        // A focused calibration may contain multiple independent queries. Persist
        // every successful immutable run immediately so a later query failure or
        // process crash can resume without repeating already completed retrieval.
        const attached = await this.#attachRetrievalRuns({ projectId, runs: [run] });
        state = attached.state;
        project = attached.project;
      }
      currentRetrievalRuns = requests.map((request) => {
        const run = exactRetrievalRun(project, request);
        if (!run) {
          fail("RETRIEVAL_RUN_NOT_PERSISTED", "正式检索回执没有完成持久化。");
        }
        return run;
      });
      retrievalProject = {
        ...structuredClone(project),
        currentRetrievalRuns: structuredClone(currentRetrievalRuns),
      };
      workOrder = buildWorkOrder({
        machine: this.machine,
        state,
        node,
        project: retrievalProject,
        inputArtifacts: inputs,
        runtimeMode: mode,
        createdAt: workOrder.createdAt,
        revisionRequest: revisionRequestForNode(state, node.id),
      });
    }
    if (mode === "guided") {
      workOrder.guidedCandidates = createGuidedCandidates(workOrder);
    }
    const controller = new AbortController();
    const relayAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", relayAbort, { once: true });
    this.activeExecutions.set(projectId, {
      nodeId: node.id,
      workOrderId: workOrder.id,
      controller,
    });
    let result;
    try {
      ({ result } = await this.#executeRuntimeWorkOrder(
        projectId,
        workOrder,
        executor,
        controller,
      ));
    } finally {
      signal?.removeEventListener("abort", relayAbort);
      if (this.activeExecutions.get(projectId)?.workOrderId === workOrder.id) {
        this.activeExecutions.delete(projectId);
      }
    }

    const candidateById = new Map(
      result.candidates.map((candidate) => [candidate.artifactId, candidate]),
    );
    if (node.id === "prepare_delivery") {
      const manifestOutput = workOrder.requiredOutputs.find(
        (output) => output.type === "ExportManifest",
      );
      const deliveryOutput = workOrder.requiredOutputs.find(
        (output) => output.type === "DeliveryBundle",
      );
      const authoritativeManifest = createAuthoritativeExportManifest({
        id: manifestOutput.artifactId,
        version: manifestOutput.version,
        project: workOrder.project,
        artifacts: inputs,
        deliveryBundleId: deliveryOutput.artifactId,
        generatedAt: workOrder.createdAt,
        runtimeProvenance: (await this.getProject(projectId)).runtimeProvenance,
      });
      verifyAuthoritativeExportManifest(authoritativeManifest);
      const manifestCandidate = candidateById.get(manifestOutput.artifactId);
      const manifestAuthority = manifestCandidate.content?.authority;
      manifestCandidate.content = manifestAuthority
        ? {
            ...authoritativeManifest,
            status: manifestCandidate.content.status,
            authority: manifestAuthority,
            displayNotice: manifestCandidate.content.displayNotice,
          }
        : authoritativeManifest;
      const deliveryCandidate = candidateById.get(deliveryOutput.artifactId);
      deliveryCandidate.content = {
        ...deliveryCandidate.content,
        manifestHash: authoritativeManifest.manifestFingerprint,
        exportManifestId: authoritativeManifest.id,
        exportManifestFingerprint: authoritativeManifest.manifestFingerprint,
        exports: authoritativeManifest.files.map((file) => ({
          id: file.id,
          format: file.format,
          fileName: file.fileName,
          mediaType: file.mediaType,
          byteLength: file.byteLength,
          contentHash: file.sha256,
        })),
      };
    }
    if (node.id === "assemble_manuscript") {
      const draftOutput = workOrder.requiredOutputs.find(
        (output) => output.type === "ManuscriptDraft",
      );
      const draftCandidate = candidateById.get(draftOutput?.artifactId);
      assertValidManuscriptAuthorityChain({
        acceptedClaimUnits: inputs.filter(
          (artifact) => artifact.type === "AcceptedClaimUnit",
        ),
        manuscriptDraft: draftCandidate?.content,
      });
    }
    if (node.id === "audit_manuscript") {
      const draftArtifact = inputs.find(
        (artifact) => artifact.type === "ManuscriptDraft",
      );
      const auditOutput = workOrder.requiredOutputs.find(
        (output) => output.type === "ManuscriptAudit",
      );
      const auditedOutput = workOrder.requiredOutputs.find(
        (output) => output.type === "AuditedManuscript",
      );
      assertValidManuscriptAuthorityChain({
        manuscriptDraft: draftArtifact?.content,
        manuscriptAudit: candidateById.get(auditOutput?.artifactId)?.content,
        auditedManuscript: candidateById.get(auditedOutput?.artifactId)?.content,
      });
    }
    if (
      workOrder.requiredOutputs.some((output) =>
        [
          "OrientationConceptMatrix",
          "OrientationSearchProtocol",
          "OrientationCalibrationReport",
          "FrozenOrientationSearchProtocol",
          "FocusedConceptMatrix",
          "FocusedSearchProtocol",
          "FocusedCalibrationReport",
          "FrozenSearchProtocol",
        ].includes(output.type),
      )
    ) {
      try {
        assertValidSearchMethodAuthorityChain({
          // Historical methods remain in the append-only artifact graph for
          // audit, but only current, non-superseded methods may authorize new
          // calibration/freeze outputs after a human protocol revision.
          artifacts: currentSearchAuthorityArtifacts(allArtifacts),
          candidateContents: result.candidates.map((candidate) => {
            const output = workOrder.requiredOutputs.find(
              (item) => item.artifactId === candidate.artifactId,
            );
            return {
              id: candidate.artifactId,
              type: candidate.type,
              version: output?.version ?? candidate.content?.version ?? 1,
              content: candidate.content,
            };
          }),
          retrievalRuns: project.retrievalRuns,
        });
      } catch (error) {
        fail(error.code ?? "INVALID_SEARCH_METHOD_AUTHORITY_CHAIN", error.message, {
          issues: error.issues ?? [],
        });
      }
    }
    const producedIds = [];
    for (const output of workOrder.requiredOutputs) {
      const candidate = candidateById.get(output.artifactId);
      if (!candidate) {
        fail("AGENT_OUTPUT_MISSING", `Agent omitted ${output.type} / ${output.artifactId}.`);
      }
      const boundRun = retrievalProject
        ? output.type === "FocusedSearchRunSnapshot"
          ? currentRetrievalRuns[output.slot - 1] ?? currentRetrievalRuns[0]
          : currentRetrievalRuns[0]
        : null;
      const candidateContent = boundRun
        ? {
            ...candidate.content,
            retrievalMode: "live_pubmed",
            provider: "pubmed",
            retrievalRunPurpose: boundRun.purpose,
            retrievalProtocolArtifactId: boundRun.protocolArtifactId,
            retrievalProtocolContentHash: boundRun.protocolContentHash,
            retrievalQueryId: boundRun.queryId,
            retrievalQueryHash: boundRun.queryHash,
            retrievalReceiptHash: boundRun.receipt.receiptHash,
            retrievalRunBindings: currentRetrievalRuns.map((run) => ({
              purpose: run.purpose,
              protocolArtifactId: run.protocolArtifactId,
              protocolContentHash: run.protocolContentHash,
              queryId: run.queryId,
              queryHash: run.queryHash,
              receiptHash: run.receipt.receiptHash,
            })),
          }
        : candidate.content;
      const contentHash = await this.#putContent(candidateContent);
      await this.#dispatch(projectId, "PRODUCE_ARTIFACT", executor, {
        nodeId: node.id,
        leaseId: lease.id,
        artifact: {
          id: output.artifactId,
          type: output.type,
          lineageId: output.lineageId,
          version: output.version,
          content: candidateContent,
          contentHash,
          inputArtifactRefs: inputs.map((artifact) => artifact.id),
          sourceRef: `work-order:${workOrder.id}`,
        },
      });
      producedIds.push(output.artifactId);
    }
    await this.#dispatch(projectId, "SUBMIT_NODE", executor, {
      nodeId: node.id,
      leaseId: lease.id,
      artifactIds: producedIds,
    });
  }

  async #runAgentReview(projectId, node, signal) {
    let state = await this.#loadState(projectId);
    const runtimeNode = state.nodeExecutions[node.id];
    const targetArtifacts = await Promise.all(
      runtimeNode.submittedArtifactIds.map(async (artifactId) => ({
        ...structuredClone(state.artifacts[artifactId]),
        content: await this.#readContent(state.artifacts[artifactId].contentHash),
      })),
    );
    if (targetArtifacts.some((artifact) => artifact.status === ARTIFACT_STATES.REJECTED)) {
      await this.#addReviewBlocker(projectId, node, "已有候选产物未通过独立核查。");
      return;
    }
    const project = await this.#projectSnapshot(state);
    const mode = runtimeMode(this.piRuntimeAdapter);
    const createdAt = nowIso(this.now);
    const reviewPayload = {
      id: `review-order:${projectId}:${node.id}:${state.revision + 1}`,
      projectId,
      nodeId: node.id,
      reviewedNodeId: node.id,
      phaseId: node.phaseId,
      userLabel: `${node.userLabel} · 独立核查`,
      role: node.reviewerRole ?? "independent_reviewer",
      reviewerRole: node.reviewerRole ?? "independent_reviewer",
      objective: `独立核查 ${node.userLabel} 的候选产物是否满足全部验收条件。`,
      inputArtifacts: targetArtifacts,
      requiredOutputs: [
        {
          contract: "ReviewVerdict@1",
          type: "ReviewVerdict",
          slot: 1,
          lineageId: `review:${projectId}:${node.id}`,
          version: 1,
          artifactId: `review-verdict:${projectId}:${node.id}:${state.revision + 1}`,
        },
      ],
      acceptanceCriteria: [...node.acceptanceCriteria],
      allowedToolIds: ["inspect_work_order", "artifact_read", "submit_artifacts"],
      budget: { maxTurns: 4, maxToolCalls: 6, maxSources: 0 },
      runtimeMode: mode,
      project: {
        id: project.id,
        title: project.title,
        question: project.question,
        researchMode: project.researchMode ?? "guided_materials",
        searchQuery: project.searchQuery ?? null,
      },
      recentRunEvents: [],
      createdAt,
    };
    const reviewOrder = {
      ...reviewPayload,
      contextSnapshotHash: sha256(reviewPayload),
    };
    if (mode === "guided") {
      reviewOrder.guidedCandidates = [
        createGuidedReviewCandidate({ reviewOrder, targetArtifacts }),
      ];
    }
    const reviewer = {
      id: `agent:${reviewOrder.role}`,
      role: reviewOrder.role,
      kind: "agent",
    };
    const controller = new AbortController();
    const relayAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", relayAbort, { once: true });
    this.activeExecutions.set(projectId, {
      nodeId: node.id,
      workOrderId: reviewOrder.id,
      controller,
    });
    let result;
    try {
      ({ result } = await this.#executeRuntimeWorkOrder(
        projectId,
        reviewOrder,
        reviewer,
        controller,
      ));
    } finally {
      signal?.removeEventListener("abort", relayAbort);
      if (this.activeExecutions.get(projectId)?.workOrderId === reviewOrder.id) {
        this.activeExecutions.delete(projectId);
      }
    }
    const review = result.candidates[0]?.content;
    const criteriaByName = new Map(
      (review?.criteria ?? []).map((criterion) => [criterion.criterion, criterion]),
    );
    const passes =
      review?.verdict === "pass" &&
      node.acceptanceCriteria.every(
        (criterion) => criteriaByName.get(criterion)?.passed === true,
      );
    if (!passes) {
      for (const artifact of targetArtifacts) {
        state = await this.#loadState(projectId);
        if (state.artifacts[artifact.id].status !== ARTIFACT_STATES.CANDIDATE) continue;
        await this.#dispatch(projectId, "VERIFY_ARTIFACT", reviewer, {
          artifactId: artifact.id,
          verdict: "fail",
          limitations:
            review?.limitations?.join("；") ?? "独立核查没有证明全部验收条件。",
        });
      }
      await this.#addReviewBlocker(
        projectId,
        node,
        review?.limitations?.join("；") ?? "独立核查未通过。",
      );
      return;
    }
    for (const artifact of targetArtifacts) {
      state = await this.#loadState(projectId);
      if (state.artifacts[artifact.id].status !== ARTIFACT_STATES.CANDIDATE) continue;
      await this.#dispatch(projectId, "VERIFY_ARTIFACT", reviewer, {
        artifactId: artifact.id,
        verdict: "pass",
        limitations: review.limitations?.join("；") ?? null,
      });
    }
    await this.#dispatch(projectId, "ACCEPT_NODE", reviewer, {
      nodeId: node.id,
      artifactIds: targetArtifacts.map((artifact) => artifact.id),
      criteriaProofs: node.acceptanceCriteria.map((criterion) => ({
        criterion,
        passed: true,
        proofArtifactIds: targetArtifacts.map((artifact) => artifact.id),
      })),
    });
  }

  async #addReviewBlocker(projectId, node, reason) {
    const state = await this.#loadState(projectId);
    if (state.nodeExecutions[node.id].state === EXECUTION_STATES.BLOCKED) return;
    await this.#dispatch(projectId, "ADD_BLOCKER", SYSTEM_ACTOR, {
      nodeId: node.id,
      blocker: {
        id: this.#id(`review-failed:${node.id}`),
        reason,
        owner: state.researchOwnerId,
        resolveWhen: "候选产物完成修订并重新进入独立核查。",
      },
    });
  }

  async #addFailureBlocker(projectId, node, error) {
    const state = await this.#loadState(projectId);
    if (
      [EXECUTION_STATES.ACCEPTED, EXECUTION_STATES.CANCELLED].includes(
        state.nodeExecutions[node.id].state,
      )
    ) {
      return;
    }
    const code = hasText(error?.code) ? error.code : "AGENT_EXECUTION_FAILED";
    const details = sanitizeFailureDetails(error?.details);
    const retryClass = failureRetryClass(code, details);
    let failedRequest = null;
    let protocolFingerprint = null;
    if (retrievalPurposeForNode(node)) {
      try {
        const inputs = await this.#inputArtifacts(state, node);
        const requests = buildRetrievalRequests({ node, inputArtifacts: inputs });
        failedRequest = requests.find((request) => request.query === details.query)
          ?? requests[0]
          ?? null;
        const protocol = inputs.find(
          (artifact) => artifact.id === failedRequest?.protocolArtifactId,
        );
        if (protocol) {
          protocolFingerprint = {
            artifactId: protocol.id,
            artifactType: protocol.type,
            version: protocol.version,
            contentHash: protocol.contentHash,
          };
        }
      } catch {
        // The original execution error remains authoritative even when its
        // method context cannot be reconstructed for diagnostic display.
      }
    }
    const resolveWhen = retryClass === "protocol_revision_required"
      ? "研究者修订正式检索协议并说明方法学理由后重新执行。"
      : retryClass === "same_protocol_retry"
        ? "工具恢复后按相同协议与查询重试；不得改写既有成功回执。"
        : "检查失败原因、输入和工具状态后由研究者决定重试或显式修订协议。";
    await this.#dispatch(projectId, "ADD_BLOCKER", SYSTEM_ACTOR, {
      nodeId: node.id,
      blocker: {
        id: this.#id(`agent-failed:${node.id}`),
        reason: `Agent 执行失败：${error?.message ?? String(error)}`,
        owner: state.researchOwnerId,
        resolveWhen,
        code,
        retryClass,
        stage: node.id,
        details,
        protocolFingerprint,
        failedRequest: failedRequest
          ? {
              purpose: failedRequest.purpose,
              queryId: failedRequest.queryId,
              query: failedRequest.query,
              queryHash: failedRequest.queryHash,
            }
          : null,
        failedAt: nowIso(this.now),
      },
    });
  }

  #boundary(state, artifacts) {
    const profile = this.machine.completionProfiles.find(
      (candidate) => candidate.id === state.completionProfileId,
    );
    const terminal = profile
      ? this.machine.nodes.find((node) => node.id === profile.terminalNodeId)
      : null;
    if (
      terminal &&
      state.nodeExecutions[terminal.id].state === EXECUTION_STATES.ACCEPTED &&
      state.nodeExecutions[terminal.id].stale !== true
    ) {
      return { type: "complete", nodeId: terminal.id };
    }
    for (const node of this.#profileNodes(state)) {
      const runtimeNode = state.nodeExecutions[node.id];
      if (runtimeNode.state === EXECUTION_STATES.CANCELLED) {
        return {
          type: "cancelled",
          nodeId: node.id,
          reason: runtimeNode.cancellationReason ?? null,
        };
      }
      const blockers = openBlockers(runtimeNode);
      if (runtimeNode.state === EXECUTION_STATES.BLOCKED && blockers.length > 0) {
        return { type: "blocked", nodeId: node.id, blockers };
      }
      if (node.kind === "human_gate" && runtimeNode.state === EXECUTION_STATES.REVIEW) {
        const gate = Object.values(state.gates)
          .filter(
            (candidate) =>
              candidate.nodeId === node.id && candidate.status === GATE_STATES.PENDING,
          )
          .at(-1);
        if (gate) {
          const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
          return {
            type: "human_gate",
            nodeId: node.id,
            gateId: gate.id,
            fingerprint: gate.fingerprint,
            inputs: gate.artifactRefs.map((ref) => byId.get(ref.artifactId)),
          };
        }
      }
      if (
        node.kind !== "human_gate" &&
        runtimeNode.state === EXECUTION_STATES.REVIEW &&
        isHumanRole(node.reviewerRole)
      ) {
        const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
        return {
          type: "human_review",
          nodeId: node.id,
          reviewerRole: node.reviewerRole,
          artifacts: runtimeNode.submittedArtifactIds.map((id) => byId.get(id)),
        };
      }
    }
    return { type: "runnable", nodeId: this.#nextRunnableNode(state)?.id ?? null };
  }

  #assertOwnerOrSystem(state, actor, { humanOnly = false } = {}) {
    if (actor.kind === "system" && !humanOnly) return;
    if (actor.kind !== "human" || actor.id !== state.researchOwnerId) {
      fail("UNAUTHORIZED_PRINCIPAL", "Only the research owner or runtime can control this project.");
    }
  }

  #abortActiveExecution(projectId, nodeId) {
    const active = this.activeExecutions.get(projectId);
    if (!active || active.nodeId !== nodeId) return;
    active.controller.abort();
    this.piRuntimeAdapter.abort?.(active.workOrderId);
  }

  #id(prefix) {
    const suffix = this.idFactory(prefix);
    if (!hasText(suffix)) fail("INVALID_ID_FACTORY", "idFactory must return a non-empty string.");
    return `${prefix}:${suffix}`;
  }
}

export const ResearchAgentService = ResearchAgentServiceV1;

export const RESEARCH_AGENT_SERVICE_INFO = Object.freeze({
  service: "ResearchAgentServiceV1",
  version: 1,
  authoritativeState: "canonical event engine",
  artifactContent: "content-addressed store",
});
