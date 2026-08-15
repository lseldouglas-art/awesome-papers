import { sha256 } from "./event-engine-v1.js";
import { assessMethodFit, validateMethodPack } from "./method-pack-interface-v1.js";
import { validateIdeaCandidate } from "./research-literature-landscape-contracts-v1.js";

export const IDEA_VALIDATION_SCHEMA_VERSION = "research.idea-validation/v1";

export const IDEA_VALIDATION_ARTIFACT_TYPES = Object.freeze([
  "IdeaValidationPlan",
  "IdeaValidationProtocol",
  "IdeaValidationResult",
  "IdeaValidationDecision",
]);

export const IDEA_VALIDATION_INTERFACE_V1 = Object.freeze({
  schemaVersion: IDEA_VALIDATION_SCHEMA_VERSION,
  purpose:
    "把人工选中的科研想法连接到最小可判定验证，并把外部执行结果或失败边界回流为可审计的领域认识。",
  separationRule: Object.freeze({
    evidenceVerification:
      "只判断来源是否支持一条既有主张，不产生新的实验或分析观察。",
    ideaValidation:
      "用预先冻结的最小实验、分析、模拟、复现或用户任务检验候选想法，只接收外部执行结果。",
  }),
  invariants: Object.freeze([
    "想法验证不能替代来源—主张证据核查，来源核查也不能替代想法验证",
    "候选想法必须先由真实研究者选择，再进入方法适配",
    "阈值、对照、失败标准、替代解释和终止或修改路径必须在外部执行前冻结",
    "运行时不得生成、推测或补写实验与分析数据",
    "没有外部结果时只能阻塞，不能形成支持性结论",
    "质量控制失败优先于阈值结果，且不能被正常观察覆盖",
    "单次最小验证最多产生有边界的继续信号，不能把候选标为已经成立",
    "最终继续、修改或终止决定必须由真实研究者签署",
  ]),
});

const RESULT_ATTESTATION = "externally_supplied_not_generated_by_research_runtime";
const COMPARATORS = new Set(["lt", "lte", "gt", "gte", "eq", "between", "outside"]);
const DECISION_ACTIONS = new Set(["continue", "modify", "terminate", "await_more_results"]);

export class IdeaValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "IdeaValidationError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new IdeaValidationError(code, message, details);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isTimestamp(value) {
  return hasText(value) && !Number.isNaN(Date.parse(value));
}

function nowIso(value) {
  const result = value ?? new Date().toISOString();
  if (!isTimestamp(result)) fail("INVALID_TIMESTAMP", "now must be an ISO timestamp");
  return result;
}

function unique(values) {
  return [...new Set(values)];
}

function stableId(prefix, value) {
  return `${prefix}-${sha256(value).slice(0, 16)}`;
}

function issueText(issues, value, path) {
  if (!hasText(value)) issues.push(`${path} must be a non-empty string`);
}

function issueArray(issues, value, path, { nonEmpty = false } = {}) {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return false;
  }
  if (nonEmpty && value.length === 0) issues.push(`${path} must not be empty`);
  return true;
}

function issueHeader(issues, value, type) {
  if (!isObject(value)) {
    issues.push(`${type} must be an object`);
    return false;
  }
  if (value.schemaVersion !== IDEA_VALIDATION_SCHEMA_VERSION) {
    issues.push(`schemaVersion must equal ${IDEA_VALIDATION_SCHEMA_VERSION}`);
  }
  if (value.type !== type) issues.push(`type must equal ${type}`);
  issueText(issues, value.id, "id");
  issueText(issues, value.projectId, "projectId");
  if (!Number.isInteger(value.version) || value.version < 1) {
    issues.push("version must be an integer >= 1");
  }
  if (!isTimestamp(value.createdAt)) issues.push("createdAt must be an ISO timestamp");
  return true;
}

function issueHash(issues, value, path) {
  if (!/^[a-f0-9]{64}$/i.test(value ?? "")) issues.push(`${path} must be a SHA-256 hash`);
}

function issueHumanReceipt(issues, receipt, path, expected = {}) {
  if (!isObject(receipt)) {
    issues.push(`${path} must be a human receipt object`);
    return;
  }
  issueText(issues, receipt.id, `${path}.id`);
  issueText(issues, receipt.subjectType, `${path}.subjectType`);
  issueText(issues, receipt.subjectId, `${path}.subjectId`);
  issueHash(issues, receipt.subjectHash, `${path}.subjectHash`);
  issueText(issues, receipt.decision, `${path}.decision`);
  issueText(issues, receipt.reason, `${path}.reason`);
  if (!isTimestamp(receipt.decidedAt)) issues.push(`${path}.decidedAt must be an ISO timestamp`);
  if (!isObject(receipt.decidedBy) || receipt.decidedBy.kind !== "human") {
    issues.push(`${path}.decidedBy.kind must be human`);
  } else {
    issueText(issues, receipt.decidedBy.id, `${path}.decidedBy.id`);
    issueText(issues, receipt.decidedBy.role, `${path}.decidedBy.role`);
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (receipt[key] !== expectedValue) issues.push(`${path}.${key} must equal ${expectedValue}`);
  }
}

function assertNoIssues(type, issues) {
  if (issues.length > 0) {
    fail("INVALID_IDEA_VALIDATION_ARTIFACT", `${type} contract violation: ${issues.join("; ")}`, {
      type,
      issues,
    });
  }
}

function assertCandidate(candidate) {
  const issues = validateIdeaCandidate(candidate);
  if (issues.length > 0) {
    fail("INVALID_IDEA_CANDIDATE", `IdeaCandidate contract violation: ${issues.join("; ")}`, {
      issues,
    });
  }
}

function assertPack(pack) {
  const issues = validateMethodPack(pack);
  if (issues.length > 0) {
    fail("INVALID_METHOD_PACK", `method pack contract violation: ${issues.join("; ")}`, { issues });
  }
}

function claimRule(pack, intendedClaimType) {
  return pack.scientificContract.minimumEvidenceForClaims.find(
    (item) => item.claimType === intendedClaimType,
  );
}

function evidenceOutput(pack, componentId) {
  return pack.scientificContract.evidenceOutputs.find((item) => item.id === componentId);
}

function planHashInput(plan) {
  const { planFingerprint: _fingerprint, ...rest } = plan;
  return rest;
}

function protocolHashInput(protocol) {
  return {
    projectId: protocol.projectId,
    candidateId: protocol.candidateId,
    planId: protocol.planId,
    planFingerprint: protocol.planFingerprint,
    methodPack: protocol.methodPack,
    objective: protocol.objective,
    minimalityRationale: protocol.minimalityRationale,
    experimentalUnit: protocol.experimentalUnit,
    primaryEndpoint: protocol.primaryEndpoint,
    decisionThresholds: protocol.decisionThresholds,
    controls: protocol.controls,
    failureCriteria: protocol.failureCriteria,
    methodPackStoppingRules: protocol.methodPackStoppingRules,
    stopRules: protocol.stopRules,
    alternativeExplanations: protocol.alternativeExplanations,
    evidenceCollectionPlan: protocol.evidenceCollectionPlan,
    modificationPaths: protocol.modificationPaths,
    terminationPath: protocol.terminationPath,
    retestPath: protocol.retestPath,
    executionAdapter: protocol.executionAdapter,
    executionBoundary: protocol.executionBoundary,
  };
}

function resultHashInput(result) {
  const { resultFingerprint: _fingerprint, ...rest } = result;
  return rest;
}

function decisionHashInput(decision) {
  const { decisionFingerprint: _fingerprint, ...rest } = decision;
  return rest;
}

export function validateIdeaValidationPlan(value) {
  const issues = [];
  if (!issueHeader(issues, value, "IdeaValidationPlan")) return issues;
  issueText(issues, value.candidateId, "candidateId");
  issueHash(issues, value.candidateFingerprint, "candidateFingerprint");
  if (value.validationKind !== "idea_minimal_test") {
    issues.push("validationKind must equal idea_minimal_test");
  }
  if (!["planned", "blocked"].includes(value.status)) {
    issues.push("status must be planned or blocked");
  }
  if (!isObject(value.methodPack)) {
    issues.push("methodPack must be an object");
  } else {
    for (const key of ["id", "version", "category", "maturity"]) {
      issueText(issues, value.methodPack[key], `methodPack.${key}`);
    }
  }
  if (!isObject(value.targetClaim)) {
    issues.push("targetClaim must be an object");
  } else {
    issueText(issues, value.targetClaim.claimType, "targetClaim.claimType");
    issueText(issues, value.targetClaim.proposition, "targetClaim.proposition");
    issueText(issues, value.targetClaim.scope, "targetClaim.scope");
    issueArray(issues, value.targetClaim.minimumEvidenceComponentIds, "targetClaim.minimumEvidenceComponentIds", {
      nonEmpty: true,
    });
    issueArray(issues, value.targetClaim.cannotEstablish, "targetClaim.cannotEstablish", { nonEmpty: true });
  }
  if (!isObject(value.methodFit)) issues.push("methodFit must be an object");
  issueArray(issues, value.blockers, "blockers");
  issueArray(issues, value.humanReleasePoints, "humanReleasePoints", { nonEmpty: true });
  if (value.status === "planned" && value.blockers?.length !== 0) {
    issues.push("planned status requires no blockers");
  }
  if (value.status === "planned") {
    issueHumanReceipt(issues, value.selectionReceipt, "selectionReceipt", {
      subjectType: "IdeaCandidate",
      subjectId: value.candidateId,
      subjectHash: value.candidateFingerprint,
      decision: "selected_for_idea_validation",
    });
  }
  issueText(issues, value.planningBoundary, "planningBoundary");
  issueHash(issues, value.planFingerprint, "planFingerprint");
  if (isObject(value) && value.planFingerprint !== sha256(planHashInput(value))) {
    issues.push("planFingerprint does not match plan content");
  }
  return issues;
}

export function assertValidIdeaValidationPlan(value) {
  const issues = validateIdeaValidationPlan(value);
  assertNoIssues("IdeaValidationPlan", issues);
  return value;
}

export function createIdeaValidationPlan({
  candidate,
  methodPack,
  validationQuestion,
  availability = {},
  selectionReceipt = null,
  now,
}) {
  assertCandidate(candidate);
  assertPack(methodPack);
  if (!isObject(validationQuestion)) fail("INVALID_VALIDATION_QUESTION", "validationQuestion is required");
  for (const key of ["questionType", "intendedClaimType", "proposition", "scope"]) {
    if (!hasText(validationQuestion[key])) {
      fail("INVALID_VALIDATION_QUESTION", `validationQuestion.${key} is required`);
    }
  }

  const createdAt = nowIso(now);
  const candidateFingerprint = sha256(candidate);
  const fit = assessMethodFit(methodPack, validationQuestion, availability);
  const minimumRule = claimRule(methodPack, validationQuestion.intendedClaimType);
  const minimumEvidenceComponentIds = unique([
    ...(minimumRule?.requiredEvidenceComponents ?? []),
    ...(validationQuestion.requiredEvidenceComponents ?? []),
  ]);
  const blockers = [...fit.blockers];

  if (candidate.status === "rejected") blockers.push("候选想法已经被人工拒绝，不能进入验证");
  if (candidate.status === "deferred") blockers.push("候选想法处于延后状态，必须先重新选择");

  if (selectionReceipt === null) {
    blockers.push("缺少真实研究者的候选想法选择记录");
  } else {
    const receiptIssues = [];
    issueHumanReceipt(receiptIssues, selectionReceipt, "selectionReceipt", {
      subjectType: "IdeaCandidate",
      subjectId: candidate.id,
      subjectHash: candidateFingerprint,
      decision: "selected_for_idea_validation",
    });
    if (receiptIssues.length > 0) {
      fail("INVALID_HUMAN_SELECTION", receiptIssues.join("; "), { issues: receiptIssues });
    }
  }

  if (minimumEvidenceComponentIds.length === 0) {
    blockers.push("方法包没有为目标结论声明最小证据组件");
  }

  const cannotEstablish = unique(
    minimumEvidenceComponentIds.flatMap((componentId) =>
      evidenceOutput(methodPack, componentId)?.cannotEstablish ?? [],
    ),
  );
  const id = stableId("idea-validation-plan", {
    candidateId: candidate.id,
    candidateVersion: candidate.version,
    methodPackId: methodPack.identity.id,
    methodPackVersion: methodPack.identity.version,
    intendedClaimType: validationQuestion.intendedClaimType,
  });
  const plan = {
    schemaVersion: IDEA_VALIDATION_SCHEMA_VERSION,
    type: "IdeaValidationPlan",
    id,
    projectId: candidate.projectId,
    version: 1,
    createdAt,
    candidateId: candidate.id,
    candidateVersion: candidate.version,
    candidateFingerprint,
    candidateStatusAtPlanning: candidate.status,
    validationKind: "idea_minimal_test",
    status: blockers.length === 0 ? "planned" : "blocked",
    methodPack: {
      id: methodPack.identity.id,
      version: methodPack.identity.version,
      category: methodPack.identity.category,
      maturity: methodPack.identity.maturity,
    },
    targetClaim: {
      claimType: validationQuestion.intendedClaimType,
      proposition: validationQuestion.proposition,
      scope: validationQuestion.scope,
      minimumEvidenceComponentIds,
      cannotEstablish:
        cannotEstablish.length > 0
          ? cannotEstablish
          : ["超出当前方法包证据合同的任何结论"],
    },
    methodFit: {
      status: fit.fit,
      blockers: [...fit.blockers],
      warnings: [...fit.warnings],
      supportedEvidenceComponentIds: [...fit.supportedEvidenceComponents],
      humanReleaseRequired: fit.humanReleaseRequired,
    },
    blockers,
    selectionReceipt,
    humanReleasePoints: [
      {
        id: "candidate-selection",
        stage: "before_method_planning",
        required: true,
        state: selectionReceipt ? "recorded" : "missing",
        reason: "真实研究者决定该候选是否值得消耗验证资源",
      },
      {
        id: "protocol-release",
        stage: "before_external_execution",
        required: fit.humanReleaseRequired,
        state: "pending",
        reason: "冻结阈值、对照、失败标准和安全或伦理边界",
      },
      {
        id: "result-interpretation",
        stage: "after_external_result_import",
        required: true,
        state: "pending",
        reason: "真实研究者选择继续、修改、终止或等待更多结果",
      },
    ],
    planningBoundary:
      "本计划只声明要检验什么以及最少需要哪些证据；它不核查文献引文，也不生成实验、分析或模拟结果。",
  };
  plan.planFingerprint = sha256(planHashInput(plan));
  return assertValidIdeaValidationPlan(plan);
}

function validateProtocolSpec(protocolSpec, pack, plan) {
  if (!isObject(protocolSpec)) fail("INVALID_PROTOCOL_SPEC", "protocolSpec is required");
  for (const key of [
    "objective",
    "minimalityRationale",
    "experimentalUnit",
    "terminationPath",
    "retestPath",
    "executionAdapterId",
  ]) {
    if (!hasText(protocolSpec[key])) fail("INVALID_PROTOCOL_SPEC", `protocolSpec.${key} is required`);
  }
  for (const key of [
    "decisionThresholds",
    "controls",
    "failureCriteria",
    "stopRules",
    "additionalAlternativeExplanations",
    "evidenceCollectionPlan",
    "modificationPaths",
  ]) {
    if (!Array.isArray(protocolSpec[key]) || protocolSpec[key].length === 0) {
      fail("INVALID_PROTOCOL_SPEC", `protocolSpec.${key} must be a non-empty array`);
    }
  }
  if (!isObject(protocolSpec.primaryEndpoint)) {
    fail("INVALID_PROTOCOL_SPEC", "protocolSpec.primaryEndpoint is required");
  }
  for (const key of ["id", "label", "measurement", "unit", "analysisMethod"]) {
    if (!hasText(protocolSpec.primaryEndpoint[key])) {
      fail("INVALID_PROTOCOL_SPEC", `protocolSpec.primaryEndpoint.${key} is required`);
    }
  }
  const metricIds = new Set();
  for (const threshold of protocolSpec.decisionThresholds) {
    if (!isObject(threshold)) fail("INVALID_PROTOCOL_SPEC", "each decision threshold must be an object");
    for (const key of ["id", "metricId", "comparator", "unit", "rationale", "onPass", "onFail"]) {
      if (!hasText(threshold[key])) fail("INVALID_PROTOCOL_SPEC", `threshold.${key} is required`);
    }
    if (!COMPARATORS.has(threshold.comparator)) {
      fail("INVALID_PROTOCOL_SPEC", `unsupported comparator: ${threshold.comparator}`);
    }
    if (metricIds.has(threshold.metricId)) {
      fail("INVALID_PROTOCOL_SPEC", `duplicate threshold metricId: ${threshold.metricId}`);
    }
    metricIds.add(threshold.metricId);
    if (["between", "outside"].includes(threshold.comparator)) {
      if (!Array.isArray(threshold.boundary) || threshold.boundary.length !== 2) {
        fail("INVALID_PROTOCOL_SPEC", `threshold ${threshold.id} requires a two-value boundary`);
      }
      if (!threshold.boundary.every((item) => Number.isFinite(item))) {
        fail("INVALID_PROTOCOL_SPEC", `threshold ${threshold.id} boundary must be numeric`);
      }
    } else if (!Number.isFinite(threshold.boundary)) {
      fail("INVALID_PROTOCOL_SPEC", `threshold ${threshold.id} boundary must be numeric`);
    }
  }

  const coveredControls = new Set(protocolSpec.controls.map((item) => item?.methodControl));
  const missingControls = pack.qualityContract.controls.filter((item) => !coveredControls.has(item));
  if (missingControls.length > 0) {
    fail("CONTROL_COVERAGE_INCOMPLETE", "all method-pack controls must be operationalized", {
      missingControls,
    });
  }
  for (const control of protocolSpec.controls) {
    for (const key of ["id", "label", "methodControl", "role", "acceptanceCriterion", "failureAction"]) {
      if (!hasText(control?.[key])) fail("INVALID_PROTOCOL_SPEC", `control.${key} is required`);
    }
  }

  const coveredEvidence = new Set(
    protocolSpec.evidenceCollectionPlan.map((item) => item?.componentId),
  );
  const missingEvidence = plan.targetClaim.minimumEvidenceComponentIds.filter(
    (item) => !coveredEvidence.has(item),
  );
  if (missingEvidence.length > 0) {
    fail("EVIDENCE_COLLECTION_INCOMPLETE", "protocol does not collect every minimum evidence component", {
      missingEvidence,
    });
  }
  for (const item of protocolSpec.evidenceCollectionPlan) {
    for (const key of ["componentId", "collectionMethod", "sourceArtifactType", "completionCriterion"]) {
      if (!hasText(item?.[key])) fail("INVALID_PROTOCOL_SPEC", `evidenceCollectionPlan.${key} is required`);
    }
  }
  const adapter = pack.executionAdapters.find((item) => item.id === protocolSpec.executionAdapterId);
  if (!adapter) {
    fail("UNKNOWN_EXECUTION_ADAPTER", `unknown execution adapter: ${protocolSpec.executionAdapterId}`);
  }
  return adapter;
}

export function validateIdeaValidationProtocol(value) {
  const issues = [];
  if (!issueHeader(issues, value, "IdeaValidationProtocol")) return issues;
  for (const key of ["candidateId", "planId", "objective", "minimalityRationale", "experimentalUnit"]) {
    issueText(issues, value[key], key);
  }
  issueHash(issues, value.planFingerprint, "planFingerprint");
  if (!["awaiting_human_release", "ready_for_external_execution", "blocked"].includes(value.status)) {
    issues.push("invalid protocol status");
  }
  if (!isObject(value.primaryEndpoint)) issues.push("primaryEndpoint must be an object");
  for (const key of [
    "decisionThresholds",
    "controls",
    "failureCriteria",
    "methodPackStoppingRules",
    "stopRules",
    "alternativeExplanations",
    "evidenceCollectionPlan",
    "modificationPaths",
  ]) {
    issueArray(issues, value[key], key, { nonEmpty: true });
  }
  issueText(issues, value.terminationPath, "terminationPath");
  issueText(issues, value.retestPath, "retestPath");
  issueText(issues, value.executionBoundary, "executionBoundary");
  if (typeof value.executionAllowed !== "boolean") issues.push("executionAllowed must be boolean");
  if (value.executionAllowed !== (value.status === "ready_for_external_execution")) {
    issues.push("executionAllowed must be true only for ready_for_external_execution");
  }
  if (value.releaseRequired && value.status === "ready_for_external_execution") {
    issueHumanReceipt(issues, value.humanReleaseReceipt, "humanReleaseReceipt", {
      subjectType: "IdeaValidationProtocol",
      subjectId: value.id,
      subjectHash: value.protocolFingerprint,
      decision: "release_external_execution",
    });
  }
  issueHash(issues, value.protocolFingerprint, "protocolFingerprint");
  if (isObject(value) && value.protocolFingerprint !== sha256(protocolHashInput(value))) {
    issues.push("protocolFingerprint does not match preregistered scientific content");
  }
  return issues;
}

export function assertValidIdeaValidationProtocol(value) {
  const issues = validateIdeaValidationProtocol(value);
  assertNoIssues("IdeaValidationProtocol", issues);
  return value;
}

export function createIdeaValidationProtocol({ plan, methodPack, protocolSpec, now }) {
  assertValidIdeaValidationPlan(plan);
  assertPack(methodPack);
  if (plan.status !== "planned") {
    fail("PLAN_BLOCKED", "a blocked validation plan cannot produce an executable protocol", {
      blockers: plan.blockers,
    });
  }
  if (
    plan.methodPack.id !== methodPack.identity.id ||
    plan.methodPack.version !== methodPack.identity.version
  ) {
    fail("METHOD_PACK_MISMATCH", "method pack does not match the frozen validation plan");
  }
  const adapter = validateProtocolSpec(protocolSpec, methodPack, plan);
  const createdAt = nowIso(now);
  const id = stableId("idea-validation-protocol", {
    planId: plan.id,
    planFingerprint: plan.planFingerprint,
    objective: protocolSpec.objective,
  });
  const releaseRequired = plan.methodFit.humanReleaseRequired || adapter.requiresHumanRelease;
  const protocol = {
    schemaVersion: IDEA_VALIDATION_SCHEMA_VERSION,
    type: "IdeaValidationProtocol",
    id,
    projectId: plan.projectId,
    version: 1,
    createdAt,
    candidateId: plan.candidateId,
    planId: plan.id,
    planFingerprint: plan.planFingerprint,
    methodPack: { ...plan.methodPack },
    objective: protocolSpec.objective,
    minimalityRationale: protocolSpec.minimalityRationale,
    experimentalUnit: protocolSpec.experimentalUnit,
    primaryEndpoint: structuredClone(protocolSpec.primaryEndpoint),
    decisionThresholds: structuredClone(protocolSpec.decisionThresholds),
    controls: structuredClone(protocolSpec.controls),
    failureCriteria: structuredClone(protocolSpec.failureCriteria),
    methodPackStoppingRules: [...methodPack.workflowContract.stoppingRules],
    stopRules: structuredClone(protocolSpec.stopRules),
    alternativeExplanations: unique([
      ...methodPack.uncertaintyContract.alternativeExplanations,
      ...protocolSpec.additionalAlternativeExplanations,
    ]),
    evidenceCollectionPlan: structuredClone(protocolSpec.evidenceCollectionPlan),
    modificationPaths: structuredClone(protocolSpec.modificationPaths),
    terminationPath: protocolSpec.terminationPath,
    retestPath: protocolSpec.retestPath,
    executionAdapter: { ...adapter },
    releaseRequired,
    status: releaseRequired ? "awaiting_human_release" : "ready_for_external_execution",
    executionAllowed: !releaseRequired,
    humanReleaseReceipt: null,
    executionBoundary:
      "本协议只冻结外部执行设计并导入结果；科研运行时本身不执行实验，也不生成、插补或猜测观察值。",
  };
  protocol.protocolFingerprint = sha256(protocolHashInput(protocol));
  return assertValidIdeaValidationProtocol(protocol);
}

export function releaseIdeaValidationProtocol({ protocol, releaseReceipt }) {
  assertValidIdeaValidationProtocol(protocol);
  if (!protocol.releaseRequired) return protocol;
  if (protocol.status !== "awaiting_human_release") {
    fail("PROTOCOL_NOT_AWAITING_RELEASE", "protocol is not awaiting human release");
  }
  const issues = [];
  issueHumanReceipt(issues, releaseReceipt, "releaseReceipt", {
    subjectType: "IdeaValidationProtocol",
    subjectId: protocol.id,
    subjectHash: protocol.protocolFingerprint,
    decision: "release_external_execution",
  });
  if (issues.length > 0) fail("INVALID_HUMAN_RELEASE", issues.join("; "), { issues });
  return assertValidIdeaValidationProtocol({
    ...protocol,
    version: protocol.version + 1,
    status: "ready_for_external_execution",
    executionAllowed: true,
    humanReleaseReceipt: structuredClone(releaseReceipt),
  });
}

function validateExternalResult(externalResult, protocol) {
  const issues = [];
  if (!isObject(externalResult)) return ["externalResult must be an object"];
  if (externalResult.originAttestation !== RESULT_ATTESTATION) {
    issues.push(`originAttestation must equal ${RESULT_ATTESTATION}`);
  }
  if (externalResult.protocolFingerprint !== protocol.protocolFingerprint) {
    issues.push("protocolFingerprint does not match the released protocol");
  }
  if (!isObject(externalResult.executor) || !["human", "external_system"].includes(externalResult.executor.kind)) {
    issues.push("executor.kind must be human or external_system");
  } else {
    issueText(issues, externalResult.executor.id, "executor.id");
    issueText(issues, externalResult.executor.role, "executor.role");
  }
  for (const key of ["sourceLocator", "protocolVersion", "validationType", "startTime", "endTime"]) {
    issueText(issues, externalResult[key], key);
  }
  if (!isTimestamp(externalResult.startTime)) issues.push("startTime must be an ISO timestamp");
  if (!isTimestamp(externalResult.endTime)) issues.push("endTime must be an ISO timestamp");
  issueHash(issues, externalResult.inputHash, "inputHash");
  issueHash(issues, externalResult.outputHash, "outputHash");
  if (!isObject(externalResult.parameterSet)) issues.push("parameterSet must be an object");
  issueArray(issues, externalResult.deviations, "deviations");
  if (issueArray(issues, externalResult.observations, "observations", { nonEmpty: true })) {
    const seen = new Set();
    externalResult.observations.forEach((observation, index) => {
      const path = `observations[${index}]`;
      issueText(issues, observation?.metricId, `${path}.metricId`);
      issueText(issues, observation?.unit, `${path}.unit`);
      issueText(issues, observation?.evidenceLocator, `${path}.evidenceLocator`);
      if (!Number.isFinite(observation?.value)) issues.push(`${path}.value must be finite`);
      if (seen.has(observation?.metricId)) issues.push(`${path}.metricId must be unique`);
      seen.add(observation?.metricId);
    });
  }
  if (issueArray(issues, externalResult.evidenceComponents, "evidenceComponents", { nonEmpty: true })) {
    externalResult.evidenceComponents.forEach((component, index) => {
      const path = `evidenceComponents[${index}]`;
      issueText(issues, component?.componentId, `${path}.componentId`);
      if (!["observed", "not_observed", "not_assessed"].includes(component?.status)) {
        issues.push(`${path}.status is invalid`);
      }
      issueText(issues, component?.summary, `${path}.summary`);
      issueText(issues, component?.evidenceLocator, `${path}.evidenceLocator`);
    });
  }
  if (issueArray(issues, externalResult.qualityChecks, "qualityChecks", { nonEmpty: true })) {
    externalResult.qualityChecks.forEach((check, index) => {
      const path = `qualityChecks[${index}]`;
      issueText(issues, check?.controlId, `${path}.controlId`);
      if (!["pass", "fail", "not_assessed"].includes(check?.status)) {
        issues.push(`${path}.status is invalid`);
      }
      issueText(issues, check?.details, `${path}.details`);
      issueText(issues, check?.evidenceLocator, `${path}.evidenceLocator`);
    });
  }
  return issues;
}

function thresholdPass(comparator, observed, boundary) {
  switch (comparator) {
    case "lt": return observed < boundary;
    case "lte": return observed <= boundary;
    case "gt": return observed > boundary;
    case "gte": return observed >= boundary;
    case "eq": return observed === boundary;
    case "between": return observed >= boundary[0] && observed <= boundary[1];
    case "outside": return observed < boundary[0] || observed > boundary[1];
    default: return false;
  }
}

function blockedResult(protocol, reasonCode, reason, createdAt) {
  const result = {
    schemaVersion: IDEA_VALIDATION_SCHEMA_VERSION,
    type: "IdeaValidationResult",
    id: stableId("idea-validation-result", { protocolId: protocol.id, reasonCode }),
    projectId: protocol.projectId,
    version: 1,
    createdAt,
    candidateId: protocol.candidateId,
    planId: protocol.planId,
    protocolId: protocol.id,
    protocolFingerprint: protocol.protocolFingerprint,
    status: "blocked",
    outcome: "inconclusive",
    blockReason: { code: reasonCode, message: reason },
    externalResultSnapshotHash: null,
    externalProvenance: null,
    observations: [],
    evidenceComponentAssessments: [],
    qualityAssessments: [],
    thresholdAssessments: [],
    deviations: [],
    ideaEstablished: false,
    interpretationBoundary:
      "没有可接受的外部执行结果；不能推断阈值、效应、阴性结果或候选想法成立。",
  };
  result.resultFingerprint = sha256(resultHashInput(result));
  return assertValidIdeaValidationResult(result);
}

export function validateIdeaValidationResult(value) {
  const issues = [];
  if (!issueHeader(issues, value, "IdeaValidationResult")) return issues;
  for (const key of ["candidateId", "planId", "protocolId"]) issueText(issues, value[key], key);
  issueHash(issues, value.protocolFingerprint, "protocolFingerprint");
  if (!["blocked", "completed", "incomplete", "failed_quality_control"].includes(value.status)) {
    issues.push("invalid result status");
  }
  if (!["supports_continuation", "fails_minimum_test", "inconclusive"].includes(value.outcome)) {
    issues.push("invalid result outcome");
  }
  for (const key of [
    "observations",
    "evidenceComponentAssessments",
    "qualityAssessments",
    "thresholdAssessments",
    "deviations",
  ]) {
    issueArray(issues, value[key], key);
  }
  if (value.status === "blocked") {
    if (!isObject(value.blockReason)) issues.push("blocked result requires blockReason");
    if (value.observations?.length !== 0) issues.push("blocked result must not contain observations");
    if (value.externalResultSnapshotHash !== null) {
      issues.push("blocked result must not contain an external snapshot hash");
    }
  } else {
    issueHash(issues, value.externalResultSnapshotHash, "externalResultSnapshotHash");
    if (!isObject(value.externalProvenance)) issues.push("non-blocked result requires externalProvenance");
  }
  if (value.ideaEstablished !== false) issues.push("ideaEstablished must remain false");
  issueText(issues, value.interpretationBoundary, "interpretationBoundary");
  issueHash(issues, value.resultFingerprint, "resultFingerprint");
  if (isObject(value) && value.resultFingerprint !== sha256(resultHashInput(value))) {
    issues.push("resultFingerprint does not match result content");
  }
  return issues;
}

export function assertValidIdeaValidationResult(value) {
  const issues = validateIdeaValidationResult(value);
  assertNoIssues("IdeaValidationResult", issues);
  return value;
}

export function recordIdeaValidationResult({ protocol, externalResult = null, now }) {
  assertValidIdeaValidationProtocol(protocol);
  const createdAt = nowIso(now);
  if (protocol.status !== "ready_for_external_execution" || !protocol.executionAllowed) {
    return blockedResult(
      protocol,
      "PROTOCOL_NOT_RELEASED",
      "协议尚未由真实研究者放行；外部结果未被导入。",
      createdAt,
    );
  }
  if (externalResult === null || externalResult === undefined) {
    return blockedResult(
      protocol,
      "EXTERNAL_RESULT_MISSING",
      "尚未收到可追溯的外部执行结果。",
      createdAt,
    );
  }
  const externalIssues = validateExternalResult(externalResult, protocol);
  if (externalIssues.length > 0) {
    fail("INVALID_EXTERNAL_RESULT", externalIssues.join("; "), { issues: externalIssues });
  }

  const observationsByMetric = new Map(
    externalResult.observations.map((item) => [item.metricId, item]),
  );
  const thresholdAssessments = protocol.decisionThresholds.map((threshold) => {
    const observation = observationsByMetric.get(threshold.metricId);
    if (!observation) {
      return {
        thresholdId: threshold.id,
        metricId: threshold.metricId,
        status: "not_evaluable",
        observedValue: null,
        boundary: threshold.boundary,
        comparator: threshold.comparator,
      };
    }
    return {
      thresholdId: threshold.id,
      metricId: threshold.metricId,
      status: thresholdPass(threshold.comparator, observation.value, threshold.boundary)
        ? "pass"
        : "fail",
      observedValue: observation.value,
      boundary: threshold.boundary,
      comparator: threshold.comparator,
    };
  });

  const qualityByControl = new Map(
    externalResult.qualityChecks.map((item) => [item.controlId, item]),
  );
  const qualityAssessments = protocol.controls.map((control) => {
    const recorded = qualityByControl.get(control.id);
    return recorded
      ? { ...structuredClone(recorded), requiredControlLabel: control.label }
      : {
          controlId: control.id,
          requiredControlLabel: control.label,
          status: "not_assessed",
          details: "外部结果未报告该必需对照",
          evidenceLocator: null,
        };
  });
  const evidenceByComponent = new Map(
    externalResult.evidenceComponents.map((item) => [item.componentId, item]),
  );
  const evidenceComponentAssessments = protocol.evidenceCollectionPlan.map((planned) => {
    const recorded = evidenceByComponent.get(planned.componentId);
    return recorded
      ? structuredClone(recorded)
      : {
          componentId: planned.componentId,
          status: "not_assessed",
          summary: "外部结果未报告该最小证据组件",
          evidenceLocator: null,
        };
  });

  const qualityFailed = qualityAssessments.some((item) => item.status !== "pass");
  const evidenceIncomplete = evidenceComponentAssessments.some((item) => item.status !== "observed");
  const thresholdIncomplete = thresholdAssessments.some((item) => item.status === "not_evaluable");
  const thresholdFailed = thresholdAssessments.some((item) => item.status === "fail");
  let status = "completed";
  let outcome = thresholdFailed ? "fails_minimum_test" : "supports_continuation";
  if (qualityFailed) {
    status = "failed_quality_control";
    outcome = "inconclusive";
  } else if (evidenceIncomplete || thresholdIncomplete) {
    status = "incomplete";
    outcome = "inconclusive";
  }

  const result = {
    schemaVersion: IDEA_VALIDATION_SCHEMA_VERSION,
    type: "IdeaValidationResult",
    id: stableId("idea-validation-result", {
      protocolId: protocol.id,
      protocolFingerprint: protocol.protocolFingerprint,
      externalResultSnapshotHash: sha256(externalResult),
    }),
    projectId: protocol.projectId,
    version: 1,
    createdAt,
    candidateId: protocol.candidateId,
    planId: protocol.planId,
    protocolId: protocol.id,
    protocolFingerprint: protocol.protocolFingerprint,
    status,
    outcome,
    blockReason: null,
    externalResultSnapshotHash: sha256(externalResult),
    externalProvenance: {
      originAttestation: externalResult.originAttestation,
      sourceLocator: externalResult.sourceLocator,
      protocolVersion: externalResult.protocolVersion,
      parameterSet: structuredClone(externalResult.parameterSet),
      validationType: externalResult.validationType,
      executor: structuredClone(externalResult.executor),
      startTime: externalResult.startTime,
      endTime: externalResult.endTime,
      inputHash: externalResult.inputHash,
      outputHash: externalResult.outputHash,
    },
    observations: structuredClone(externalResult.observations),
    evidenceComponentAssessments,
    qualityAssessments,
    thresholdAssessments,
    deviations: structuredClone(externalResult.deviations),
    ideaEstablished: false,
    interpretationBoundary:
      outcome === "supports_continuation"
        ? "外部最小验证达到预设门槛，只支持继续复现或升级验证；不代表候选想法、因果机制或临床价值已经成立。"
        : "该结果只记录最小验证失败或不可判定的边界；不得改写成支持性结论。",
  };
  result.resultFingerprint = sha256(resultHashInput(result));
  return assertValidIdeaValidationResult(result);
}

function recommendationFor(result) {
  if (result.outcome === "supports_continuation") return "continue";
  if (result.outcome === "fails_minimum_test") return "modify";
  if (result.status === "blocked") return "await_more_results";
  return "modify";
}

function allowedActionsFor(result) {
  if (result.outcome === "supports_continuation") {
    return ["continue", "modify", "terminate"];
  }
  if (result.outcome === "fails_minimum_test") return ["modify", "terminate"];
  return ["modify", "terminate", "await_more_results"];
}

function feedbackFor(plan, protocol, result, decidedAction) {
  const knowledgeStatus =
    result.outcome === "supports_continuation"
      ? "bounded_signal_only"
      : result.outcome === "fails_minimum_test"
        ? "minimum_test_failed"
        : "uncertainty_recorded";
  const nextPath = decidedAction === "terminate"
    ? protocol.terminationPath
    : decidedAction === "modify"
      ? protocol.modificationPaths.map((item) => item.action).join("；")
      : decidedAction === "continue"
        ? protocol.retestPath
        : "等待同一冻结协议的可追溯外部结果";
  return {
    type: "DomainKnowledgeFeedback",
    candidateId: plan.candidateId,
    candidateStatusAfterFeedback: "unvalidated_hypothesis",
    knowledgeStatus,
    sourceResultId: result.id,
    sourceResultFingerprint: result.resultFingerprint,
    proposedUpdate:
      knowledgeStatus === "bounded_signal_only"
        ? "记录最小验证达到预设门槛，并保留为需要独立复现或更强方法检验的有边界信号。"
        : knowledgeStatus === "minimum_test_failed"
          ? "记录候选未达到预设最小门槛，带着失败条件和替代解释回到领域图谱复核。"
          : "记录当前结果缺失、质量失败或证据不完整，不形成正向或阴性科研结论。",
    claimsAllowed:
      knowledgeStatus === "bounded_signal_only"
        ? ["在冻结协议和当前外部结果范围内达到预设最小门槛"]
        : knowledgeStatus === "minimum_test_failed"
          ? ["在冻结协议和当前外部结果范围内未达到预设最小门槛"]
          : ["当前最小验证不可判定"],
    prohibitedClaims: unique([
      "候选想法已经成立",
      "已经证明因果机制",
      "已经证明临床有效或可推广",
      ...plan.targetClaim.cannotEstablish,
    ]),
    alternativeExplanations: [...protocol.alternativeExplanations],
    recheckQuery: null,
    nextPath,
    applicationBoundary:
      "这是供领域认识层消费的结构化反馈，不会自动篡改原 IdeaCandidate 或把其状态升级为已成立。",
  };
}

export function validateIdeaValidationDecision(value) {
  const issues = [];
  if (!issueHeader(issues, value, "IdeaValidationDecision")) return issues;
  for (const key of ["candidateId", "planId", "protocolId", "resultId"]) issueText(issues, value[key], key);
  issueHash(issues, value.resultFingerprint, "resultFingerprint");
  if (!["awaiting_human_decision", "decided"].includes(value.status)) {
    issues.push("invalid decision status");
  }
  if (!DECISION_ACTIONS.has(value.recommendedAction)) issues.push("invalid recommendedAction");
  issueArray(issues, value.allowedActions, "allowedActions", { nonEmpty: true });
  if (value.status === "decided") {
    if (!DECISION_ACTIONS.has(value.action)) issues.push("invalid decided action");
    if (!value.allowedActions?.includes(value.action)) issues.push("action is not allowed for this result");
    issueHumanReceipt(issues, value.decisionReceipt, "decisionReceipt", {
      subjectType: "IdeaValidationResult",
      subjectId: value.resultId,
      subjectHash: value.resultFingerprint,
      decision: value.action,
    });
  } else if (value.action !== null || value.decisionReceipt !== null) {
    issues.push("awaiting decision must not contain an action or receipt");
  }
  if (!isObject(value.domainKnowledgeFeedback)) issues.push("domainKnowledgeFeedback is required");
  if (value.domainKnowledgeFeedback?.candidateStatusAfterFeedback !== "unvalidated_hypothesis") {
    issues.push("domain feedback must keep candidateStatusAfterFeedback as unvalidated_hypothesis");
  }
  issueHash(issues, value.decisionFingerprint, "decisionFingerprint");
  if (isObject(value) && value.decisionFingerprint !== sha256(decisionHashInput(value))) {
    issues.push("decisionFingerprint does not match decision content");
  }
  return issues;
}

export function assertValidIdeaValidationDecision(value) {
  const issues = validateIdeaValidationDecision(value);
  assertNoIssues("IdeaValidationDecision", issues);
  return value;
}

export function createIdeaValidationDecision({
  plan,
  protocol,
  result,
  decisionReceipt = null,
  now,
}) {
  assertValidIdeaValidationPlan(plan);
  assertValidIdeaValidationProtocol(protocol);
  assertValidIdeaValidationResult(result);
  if (
    plan.id !== protocol.planId ||
    plan.id !== result.planId ||
    protocol.id !== result.protocolId ||
    plan.candidateId !== result.candidateId
  ) {
    fail("VALIDATION_CHAIN_MISMATCH", "plan, protocol, and result do not form one validation chain");
  }

  const allowedActions = allowedActionsFor(result);
  let action = null;
  if (decisionReceipt !== null) {
    action = decisionReceipt.decision;
    if (!allowedActions.includes(action)) {
      fail("DECISION_NOT_ALLOWED", `decision ${action} is not allowed for result ${result.outcome}`, {
        allowedActions,
      });
    }
    const issues = [];
    issueHumanReceipt(issues, decisionReceipt, "decisionReceipt", {
      subjectType: "IdeaValidationResult",
      subjectId: result.id,
      subjectHash: result.resultFingerprint,
      decision: action,
    });
    if (issues.length > 0) fail("INVALID_HUMAN_DECISION", issues.join("; "), { issues });
  }
  const decidedAction = action ?? recommendationFor(result);
  const decision = {
    schemaVersion: IDEA_VALIDATION_SCHEMA_VERSION,
    type: "IdeaValidationDecision",
    id: stableId("idea-validation-decision", {
      resultId: result.id,
      resultFingerprint: result.resultFingerprint,
    }),
    projectId: result.projectId,
    version: 1,
    createdAt: nowIso(now),
    candidateId: result.candidateId,
    planId: plan.id,
    protocolId: protocol.id,
    resultId: result.id,
    resultFingerprint: result.resultFingerprint,
    status: decisionReceipt ? "decided" : "awaiting_human_decision",
    recommendedAction: recommendationFor(result),
    allowedActions,
    action,
    decisionReceipt: decisionReceipt ? structuredClone(decisionReceipt) : null,
    domainKnowledgeFeedback: feedbackFor(plan, protocol, result, decidedAction),
  };
  decision.decisionFingerprint = sha256(decisionHashInput(decision));
  return assertValidIdeaValidationDecision(decision);
}

export function ideaValidationBuildToArtifacts({ plan, protocol = null, result = null, decision = null }) {
  assertValidIdeaValidationPlan(plan);
  const contents = [plan];
  if (protocol) contents.push(assertValidIdeaValidationProtocol(protocol));
  if (result) contents.push(assertValidIdeaValidationResult(result));
  if (decision) contents.push(assertValidIdeaValidationDecision(decision));
  return contents.map((content) => ({
    type: content.type,
    id: content.id,
    projectId: content.projectId,
    version: content.version,
    content: structuredClone(content),
    contentHash: sha256(content),
  }));
}

export const EXTERNAL_RESULT_ORIGIN_ATTESTATION = RESULT_ATTESTATION;
