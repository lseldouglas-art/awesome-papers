import { sha256 } from "./event-engine-v1.js";
import {
  ResearchArtifactContractError,
  SEARCH_METHOD_ARTIFACT_TYPES,
  validateResearchArtifactContent,
} from "./artifact-contracts-v1.js";
import { assertValidRetrievalRun } from "./research-live-retrieval-v1.js";

const EXPECTED_CALIBRATION_BINDINGS = Object.freeze({
  OrientationCalibrationReport: Object.freeze({
    protocolType: "OrientationSearchProtocol",
    purpose: "pilot",
    nodeId: "run_pilot_search",
  }),
  FocusedCalibrationReport: Object.freeze({
    protocolType: "FocusedSearchProtocol",
    purpose: "focusedCalibration",
    nodeId: "calibrate_focused_search",
  }),
});

const EXPECTED_FROZEN_BINDINGS = Object.freeze({
  FrozenOrientationSearchProtocol: Object.freeze({
    protocolType: "OrientationSearchProtocol",
    calibrationType: "OrientationCalibrationReport",
    purpose: "pilot",
    nodeId: "run_pilot_search",
  }),
  FrozenSearchProtocol: Object.freeze({
    protocolType: "FocusedSearchProtocol",
    calibrationType: "FocusedCalibrationReport",
    purpose: "focusedCalibration",
    nodeId: "calibrate_focused_search",
  }),
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeArtifact(value, { candidate = false } = {}) {
  if (!isPlainObject(value)) return null;
  const content = value.content;
  const id = value.id ?? value.artifactId ?? content?.id;
  const type = value.type ?? value.artifactType;
  const version = value.version ?? content?.version;
  const computedHash = content === undefined ? null : sha256(content);
  const contentHash = value.contentHash ?? computedHash;
  return {
    id,
    type,
    version,
    lineageId: value.lineageId ?? null,
    producedByActorId: value.producedByActorId ?? null,
    producedByActorRole: value.producedByActorRole ?? null,
    contentHash,
    content,
    candidate,
    suppliedContentHash: value.contentHash ?? null,
  };
}

function normalizeCandidateContents(candidateContents) {
  if (candidateContents === undefined || candidateContents === null) return [];
  if (Array.isArray(candidateContents)) {
    return candidateContents.map((candidate) =>
      normalizeArtifact(candidate, { candidate: true }),
    );
  }
  if (!isPlainObject(candidateContents)) return [null];
  return Object.entries(candidateContents).map(([artifactId, candidate]) =>
    normalizeArtifact(
      isPlainObject(candidate) && Object.hasOwn(candidate, "content")
        ? { artifactId, ...candidate }
        : {
            artifactId,
            type: candidate?.type,
            version: candidate?.version,
            content: candidate?.content ?? candidate,
          },
      { candidate: true },
    ),
  );
}

function collectRetrievalRuns(value, output = [], seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return output;
  seen.add(value);
  if (
    isPlainObject(value) &&
    hasText(value.schemaVersion) &&
    hasText(value.purpose) &&
    isPlainObject(value.receipt)
  ) {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectRetrievalRuns(item, output, seen));
    return output;
  }
  Object.values(value).forEach((item) => collectRetrievalRuns(item, output, seen));
  return output;
}

function fingerprintKey(value) {
  return [
    value?.artifactId,
    value?.artifactType,
    value?.version,
    value?.contentHash?.toLowerCase?.(),
  ].join("|");
}

function runReferenceFromRun(run) {
  return {
    purpose: run.purpose,
    nodeId: run.nodeId,
    protocolArtifactId: run.protocolArtifactId,
    protocolContentHash: run.protocolContentHash,
    queryId: run.queryId,
    query: run.query,
    queryHash: run.queryHash,
    receiptHash: run.receipt?.receiptHash,
  };
}

function exactRunReferenceMatch(reference, run) {
  const actual = runReferenceFromRun(run);
  return Object.keys(actual).every((key) => reference?.[key] === actual[key]);
}

function exactReferenceMatch(left, right) {
  return [
    "purpose",
    "nodeId",
    "protocolArtifactId",
    "protocolContentHash",
    "queryId",
    "query",
    "queryHash",
    "receiptHash",
  ].every((field) => left?.[field] === right?.[field]);
}

function sameJson(left, right) {
  return sha256(left) === sha256(right);
}

function addInheritedMethodIssues(issues, child, parent, path) {
  if (!parent) return;
  for (const field of [
    "provider",
    "database",
    "fields",
    "timeRange",
    "languages",
    "inclusionCriteria",
    "exclusionCriteria",
    "stopRules",
  ]) {
    if (!sameJson(child.content?.[field], parent.content?.[field])) {
      issues.push(`${path}.${field} must equal the bound parent artifact`);
    }
  }
}

function queryDescriptors(protocol) {
  if (protocol?.type === "FocusedSearchProtocol") {
    return protocol.content?.queryVariants ?? [];
  }
  return [
    {
      id: protocol?.content?.queryId,
      query: protocol?.content?.query,
      queryHash: protocol?.content?.queryHash,
    },
  ];
}

function containsFingerprint(content, fingerprint) {
  const expected = fingerprintKey(fingerprint);
  return (content?.upstreamArtifactFingerprints ?? []).some(
    (candidate) => fingerprintKey(candidate) === expected,
  );
}

function addFingerprintResolutionIssues(
  issues,
  fingerprint,
  registry,
  path,
  { expectedType = null } = {},
) {
  if (!isPlainObject(fingerprint) || !hasText(fingerprint.artifactId)) return null;
  const artifact = registry.get(fingerprint.artifactId);
  if (!artifact) {
    issues.push(`${path} references unavailable artifact ${fingerprint.artifactId}`);
    return null;
  }
  for (const [field, actual, expected] of [
    ["artifactType", artifact.type, fingerprint.artifactType],
    ["version", artifact.version, fingerprint.version],
    ["contentHash", artifact.contentHash?.toLowerCase?.(), fingerprint.contentHash?.toLowerCase?.()],
  ]) {
    if (actual !== expected) {
      issues.push(`${path}.${field} does not match artifact ${fingerprint.artifactId}`);
    }
  }
  if (expectedType && artifact.type !== expectedType) {
    issues.push(`${path} must reference ${expectedType}`);
  }
  return artifact;
}

function addProtocolBindingIssues(issues, protocol, matrixType, registry) {
  const fingerprint = protocol.content?.conceptMatrixFingerprint;
  const matrix = addFingerprintResolutionIssues(
    issues,
    fingerprint,
    registry,
    `${protocol.id}.conceptMatrixFingerprint`,
    { expectedType: matrixType },
  );
  if (!containsFingerprint(protocol.content, fingerprint)) {
    issues.push(
      `${protocol.id}.conceptMatrixFingerprint must appear in upstreamArtifactFingerprints`,
    );
  }
  addInheritedMethodIssues(issues, protocol, matrix, protocol.id);
  const previousFingerprint = protocol.content?.previousProtocolFingerprint;
  const humanRevision = protocol.content?.humanRevision;
  if (previousFingerprint !== undefined || humanRevision !== undefined) {
    const previous = addFingerprintResolutionIssues(
      issues,
      previousFingerprint,
      registry,
      `${protocol.id}.previousProtocolFingerprint`,
      { expectedType: protocol.type },
    );
    if (previous) {
      if (!Number.isInteger(protocol.version) || protocol.version !== previous.version + 1) {
        issues.push(`${protocol.id}.version must be exactly one greater than the previous protocol`);
      }
      if (
        hasText(protocol.lineageId) &&
        hasText(previous.lineageId) &&
        protocol.lineageId !== previous.lineageId
      ) {
        issues.push(`${protocol.id} must preserve the previous protocol lineageId`);
      }
      if (!sameJson(protocol.content?.conceptMatrixFingerprint, previous.content?.conceptMatrixFingerprint)) {
        issues.push(`${protocol.id}.conceptMatrixFingerprint must equal the previous protocol`);
      }
      addInheritedMethodIssues(issues, protocol, previous, protocol.id);
      if (
        humanRevision?.previousQuery !== previous.content?.query ||
        humanRevision?.previousQueryHash !== previous.content?.queryHash
      ) {
        issues.push(`${protocol.id}.humanRevision must bind the exact previous query`);
      }
      if (
        protocol.content?.query === previous.content?.query ||
        protocol.content?.queryHash === previous.content?.queryHash
      ) {
        issues.push(`${protocol.id} human revision must change query and queryHash`);
      }
    }
    if (
      !isPlainObject(humanRevision?.revisedBy) ||
      humanRevision.revisedBy.kind !== "human"
    ) {
      issues.push(`${protocol.id}.humanRevision.revisedBy must be a human actor`);
    }
    if (
      hasText(protocol.producedByActorId) &&
      protocol.producedByActorId !== humanRevision?.revisedBy?.id
    ) {
      issues.push(`${protocol.id}.humanRevision.revisedBy must equal the producing actor`);
    }
    if (
      hasText(protocol.producedByActorRole) &&
      protocol.producedByActorRole !== humanRevision?.revisedBy?.role
    ) {
      issues.push(`${protocol.id}.humanRevision.revisedBy role must equal the producing actor role`);
    }
  } else if (
    matrix &&
    (protocol.content?.query !== matrix.content?.query ||
      protocol.content?.queryHash !== matrix.content?.queryHash)
  ) {
    issues.push(`${protocol.id}.query and queryHash must equal the concept matrix`);
  }
}

function addCalibrationBindingIssues(issues, report, registry, runs) {
  const binding = EXPECTED_CALIBRATION_BINDINGS[report.type];
  const fingerprint = report.content?.protocolFingerprint;
  const protocol = addFingerprintResolutionIssues(
    issues,
    fingerprint,
    registry,
    `${report.id}.protocolFingerprint`,
    { expectedType: binding.protocolType },
  );
  if (!containsFingerprint(report.content, fingerprint)) {
    issues.push(`${report.id}.protocolFingerprint must appear in upstreamArtifactFingerprints`);
  }
  addInheritedMethodIssues(issues, report, protocol, report.id);
  const matrix = protocol
    ? registry.get(protocol.content?.conceptMatrixFingerprint?.artifactId)
    : null;
  const declaredSentinels = new Set(matrix?.content?.sentinelSourceIds ?? []);
  for (const [index, reference] of (report.content?.retrievalRunRefs ?? []).entries()) {
    const path = `${report.id}.retrievalRunRefs[${index}]`;
    if (reference?.purpose !== binding.purpose) {
      issues.push(`${path}.purpose must equal ${binding.purpose}`);
    }
    if (reference?.nodeId !== binding.nodeId) {
      issues.push(`${path}.nodeId must equal ${binding.nodeId}`);
    }
    if (
      isPlainObject(fingerprint) &&
      (reference?.protocolArtifactId !== fingerprint.artifactId ||
        reference?.protocolContentHash !== fingerprint.contentHash)
    ) {
      issues.push(`${path} must bind the report protocol fingerprint`);
    }
    const matchingRun = runs.find((run) => exactRunReferenceMatch(reference, run));
    if (!matchingRun) {
      issues.push(`${path} does not match a supplied, valid retrieval run`);
      continue;
    }
    if (matchingRun.purpose !== binding.purpose || matchingRun.nodeId !== binding.nodeId) {
      issues.push(`${path} uses a retrieval run from another purpose or node`);
    }
    if (
      protocol &&
      !queryDescriptors(protocol).some(
        (query) =>
          query.id === matchingRun.queryId &&
          query.query === matchingRun.query &&
          query.queryHash === matchingRun.queryHash,
      )
    ) {
      issues.push(`${path} query is not declared by the bound protocol`);
    }
  }
  const retrievedSourceIds = new Set(
    runs
      .filter(
        (run) =>
          run.protocolArtifactId === fingerprint?.artifactId &&
          run.protocolContentHash === fingerprint?.contentHash,
      )
      .flatMap((run) => run.receipt?.records ?? [])
      .map((record) => record?.sourceId ?? record?.id)
      .filter(hasText),
  );
  const checkedSentinels = new Set(
    (report.content?.sentinelChecks ?? [])
      .map((check) => check?.sourceId)
      .filter(hasText),
  );
  for (const sourceId of declaredSentinels) {
    if (!checkedSentinels.has(sourceId)) {
      issues.push(
        `${report.id}.sentinelChecks must cover declared concept-matrix sentinel: ${sourceId}`,
      );
    }
  }
  for (const sourceId of report.content?.sampleSourceIds ?? []) {
    if (!retrievedSourceIds.has(sourceId)) {
      issues.push(`${report.id}.sampleSourceIds includes source not present in bound runs: ${sourceId}`);
    }
  }
  for (const check of report.content?.sentinelChecks ?? []) {
    if (!declaredSentinels.has(check?.sourceId)) {
      issues.push(
        `${report.id}.sentinelChecks references a source not declared by the concept matrix: ${check?.sourceId}`,
      );
    }
    const actuallyRetrieved = retrievedSourceIds.has(check?.sourceId);
    if (typeof check?.retrieved === "boolean" && check.retrieved !== actuallyRetrieved) {
      issues.push(
        `${report.id}.sentinelChecks must exactly reflect the bound retrieval runs: ${check?.sourceId}`,
      );
    }
  }
  if (
    report.content?.revisionDecision === "keep" &&
    (report.content?.sentinelChecks ?? []).some((check) => check?.retrieved !== true)
  ) {
    issues.push(`${report.id} cannot keep a protocol after an unretrieved or failed sentinel`);
  }
}

function addFrozenBindingIssues(issues, frozen, registry, runs) {
  const binding = EXPECTED_FROZEN_BINDINGS[frozen.type];
  const parentFingerprint = frozen.content?.parentProtocolFingerprint;
  const calibrationFingerprint = frozen.content?.calibrationFingerprint;
  const parent = addFingerprintResolutionIssues(
    issues,
    parentFingerprint,
    registry,
    `${frozen.id}.parentProtocolFingerprint`,
    { expectedType: binding.protocolType },
  );
  const calibration = addFingerprintResolutionIssues(
    issues,
    calibrationFingerprint,
    registry,
    `${frozen.id}.calibrationFingerprint`,
    { expectedType: binding.calibrationType },
  );
  for (const [name, fingerprint] of [
    ["parentProtocolFingerprint", parentFingerprint],
    ["calibrationFingerprint", calibrationFingerprint],
  ]) {
    if (!containsFingerprint(frozen.content, fingerprint)) {
      issues.push(`${frozen.id}.${name} must appear in upstreamArtifactFingerprints`);
    }
  }
  const selected = frozen.content?.selectedExecution;
  if (selected?.purpose !== binding.purpose) {
    issues.push(`${frozen.id}.selectedExecution.purpose must equal ${binding.purpose}`);
  }
  if (selected?.nodeId !== binding.nodeId) {
    issues.push(`${frozen.id}.selectedExecution.nodeId must equal ${binding.nodeId}`);
  }
  if (
    isPlainObject(parentFingerprint) &&
    (selected?.protocolArtifactId !== parentFingerprint.artifactId ||
      selected?.protocolContentHash !== parentFingerprint.contentHash)
  ) {
    issues.push(`${frozen.id}.selectedExecution must bind parentProtocolFingerprint`);
  }
  if (!runs.some((run) => exactRunReferenceMatch(selected, run))) {
    issues.push(`${frozen.id}.selectedExecution does not match a supplied, valid retrieval run`);
  }
  addInheritedMethodIssues(issues, frozen, parent, frozen.id);
  if (
    calibration &&
    !(calibration.content?.retrievalRunRefs ?? []).some(
      (reference) => exactReferenceMatch(reference, selected),
    )
  ) {
    issues.push(`${frozen.id}.selectedExecution must be one of the calibration retrieval runs`);
  }
  const calibratedQuery = calibration?.content?.selectedQuery;
  if (calibration?.content?.revisionDecision !== "keep") {
    issues.push(`${frozen.id} requires calibration revisionDecision keep`);
  }
  if (
    (calibration?.content?.sentinelChecks ?? []).some(
      (check) => check?.retrieved !== true,
    )
  ) {
    issues.push(
      `${frozen.id} cannot freeze a protocol with an unretrieved or failed sentinel`,
    );
  }
  if (
    calibratedQuery &&
    (selected?.queryId !== calibratedQuery.id ||
      selected?.query !== calibratedQuery.query ||
      selected?.queryHash !== calibratedQuery.queryHash)
  ) {
    issues.push(`${frozen.id}.selectedExecution must equal the calibrated selectedQuery`);
  }
}

export function validateSearchMethodAuthorityChain({
  artifacts = [],
  candidateContents = [],
  retrievalRuns = [],
} = {}) {
  const issues = [];
  if (!Array.isArray(artifacts)) {
    return ["artifacts must be an array"];
  }
  const normalized = [
    ...artifacts.map((artifact) => normalizeArtifact(artifact)),
    ...normalizeCandidateContents(candidateContents),
  ];
  if (normalized.some((artifact) => artifact === null)) {
    issues.push("artifacts and candidateContents must contain artifact descriptors");
  }
  const registry = new Map();
  for (const [index, artifact] of normalized.entries()) {
    if (!artifact) continue;
    const path = `artifacts[${index}]`;
    if (!hasText(artifact.id)) issues.push(`${path}.id is required`);
    if (!hasText(artifact.type)) issues.push(`${path}.type is required`);
    if (!Number.isInteger(artifact.version) || artifact.version < 1) {
      issues.push(`${path}.version must be a positive integer`);
    }
    if (!/^[a-f0-9]{64}$/i.test(artifact.contentHash ?? "")) {
      issues.push(`${path}.contentHash must be SHA-256`);
    }
    if (artifact.content === undefined) {
      issues.push(`${path}.content is required for authority-chain validation`);
    } else if (
      /^[a-f0-9]{64}$/i.test(artifact.contentHash ?? "") &&
      artifact.contentHash.toLowerCase() !== sha256(artifact.content)
    ) {
      issues.push(`${path}.contentHash does not match content`);
    }
    if (hasText(artifact.id) && registry.has(artifact.id)) {
      issues.push(`artifact id ${artifact.id} is duplicated`);
    } else if (hasText(artifact.id)) {
      registry.set(artifact.id, artifact);
    }
    if (SEARCH_METHOD_ARTIFACT_TYPES.includes(artifact.type)) {
      for (const issue of validateResearchArtifactContent(artifact.type, artifact.content)) {
        issues.push(`${artifact.id ?? path}: ${issue}`);
      }
    }
  }

  for (const artifact of normalized.filter(Boolean)) {
    if (!SEARCH_METHOD_ARTIFACT_TYPES.includes(artifact.type)) continue;
    for (const [index, fingerprint] of (
      artifact.content?.upstreamArtifactFingerprints ?? []
    ).entries()) {
      addFingerprintResolutionIssues(
        issues,
        fingerprint,
        registry,
        `${artifact.id}.upstreamArtifactFingerprints[${index}]`,
      );
    }
  }

  const runs = collectRetrievalRuns(retrievalRuns);
  runs.forEach((run, index) => {
    try {
      assertValidRetrievalRun(run);
    } catch (error) {
      issues.push(`retrievalRuns[${index}]: ${error.message}`);
    }
  });

  for (const artifact of normalized.filter(Boolean)) {
    if (artifact.type === "OrientationSearchProtocol") {
      addProtocolBindingIssues(issues, artifact, "OrientationConceptMatrix", registry);
    } else if (artifact.type === "FocusedSearchProtocol") {
      addProtocolBindingIssues(issues, artifact, "FocusedConceptMatrix", registry);
    } else if (EXPECTED_CALIBRATION_BINDINGS[artifact.type]) {
      addCalibrationBindingIssues(issues, artifact, registry, runs);
    } else if (EXPECTED_FROZEN_BINDINGS[artifact.type]) {
      addFrozenBindingIssues(issues, artifact, registry, runs);
    }
  }
  return issues;
}

export function assertValidSearchMethodAuthorityChain(input = {}) {
  const issues = validateSearchMethodAuthorityChain(input);
  if (issues.length > 0) {
    throw new ResearchArtifactContractError(
      "INVALID_SEARCH_METHOD_AUTHORITY_CHAIN",
      issues,
    );
  }
  return input;
}

export function createSearchMethodArtifactFingerprint(artifact) {
  const normalized = normalizeArtifact(artifact, { candidate: true });
  if (
    !normalized ||
    !hasText(normalized.id) ||
    !hasText(normalized.type) ||
    !Number.isInteger(normalized.version) ||
    normalized.version < 1 ||
    normalized.content === undefined
  ) {
    throw new ResearchArtifactContractError(
      "INVALID_SEARCH_METHOD_FINGERPRINT_SOURCE",
      ["artifact requires id/type/version/content"],
    );
  }
  if (
    normalized.suppliedContentHash &&
    normalized.suppliedContentHash.toLowerCase() !== sha256(normalized.content)
  ) {
    throw new ResearchArtifactContractError(
      "INVALID_SEARCH_METHOD_FINGERPRINT_SOURCE",
      ["artifact contentHash does not match content"],
    );
  }
  return Object.freeze({
    artifactId: normalized.id,
    artifactType: normalized.type,
    version: normalized.version,
    contentHash: sha256(normalized.content),
  });
}

export function createRetrievalRunReference(run) {
  assertValidRetrievalRun(run);
  return Object.freeze(runReferenceFromRun(run));
}
