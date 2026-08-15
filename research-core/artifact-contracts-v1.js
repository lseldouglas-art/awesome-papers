import {
  LITERATURE_LANDSCAPE_CONTENT_VALIDATORS,
} from "./research-literature-landscape-contracts-v1.js";
import { createHash } from "node:crypto";
import {
  AUTHOR_APPROVAL_SCHEMA_VERSION,
  EXPORT_MANIFEST_SCHEMA_VERSION,
  SIGNED_DELIVERY_SCHEMA_VERSION,
  verifyAuthoritativeExportManifest,
} from "./export-authority-v1.js";
import { validateManuscriptAssemblyContent } from "./manuscript-authority-v1.js";

export const RESEARCH_ARTIFACT_SCHEMA_VERSION = "1.0.0";

export const EVIDENCE_ACCESS_LEVELS = Object.freeze([
  "title_only",
  "abstract_only",
  "full_text",
  "full_text_and_supplement",
]);

export const EVIDENCE_RELATIONS = Object.freeze([
  "supports",
  "partially_supports",
  "contradicts",
  "context_only",
  "unclear",
]);

export const CONCLUSION_CONFIDENCE_LEVELS = Object.freeze([
  "provisional",
  "bounded",
  "convergent",
]);

export const OUTLINE_STRESS_TEST_VERDICTS = Object.freeze([
  "pass",
  "revision_required",
  "fail",
]);

export const REVIEW_FINDING_SEVERITIES = Object.freeze([
  "blocker",
  "warning",
  "note",
]);

export const CLAIM_SENTENCE_KINDS = Object.freeze([
  "factual",
  "interpretation",
  "transition",
]);

export const CITATION_INTENT_PURPOSES = Object.freeze([
  "support",
  "comparison",
  "limitation",
  "counterevidence",
  "context",
]);

export const CLAIM_VERIFICATION_VERDICTS = Object.freeze([
  "direct_support",
  "partial_support",
  "unsupported",
  "contradicted",
]);

export const MANUSCRIPT_AUDIT_VERDICTS = Object.freeze([
  "pass",
  "revision_required",
  "fail",
  "simulation_only",
]);

export const DELIVERY_EXPORT_FORMATS = Object.freeze([
  "markdown",
  "json",
  "bibtex",
  "docx",
  "pdf",
  "ro_crate",
]);

export const PUBMED_SEARCH_FIELDS = Object.freeze([
  "all_fields",
  "title_abstract",
  "mesh_terms",
  "publication_type",
  "language",
  "publication_date",
]);

export const SEARCH_METHOD_ARTIFACT_TYPES = Object.freeze([
  "OrientationConceptMatrix",
  "OrientationSearchProtocol",
  "OrientationCalibrationReport",
  "FrozenOrientationSearchProtocol",
  "FocusedConceptMatrix",
  "FocusedSearchProtocol",
  "FocusedCalibrationReport",
  "FrozenSearchProtocol",
]);

const DELIVERY_EXPORT_REQUIREMENTS = Object.freeze({
  markdown: { extensions: [".md", ".markdown"], mediaTypes: ["text/markdown"] },
  json: { extensions: [".json"], mediaTypes: ["application/json"] },
  bibtex: {
    extensions: [".bib"],
    mediaTypes: ["application/x-bibtex", "text/x-bibtex"],
  },
  docx: {
    extensions: [".docx"],
    mediaTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  },
  pdf: { extensions: [".pdf"], mediaTypes: ["application/pdf"] },
  ro_crate: {
    extensions: [".json"],
    mediaTypes: ["application/ld+json", "application/json"],
  },
});

export class ResearchArtifactContractError extends Error {
  constructor(code, issues) {
    super(`${code}: ${issues.join("; ")}`);
    this.name = "ResearchArtifactContractError";
    this.code = code;
    this.issues = [...issues];
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isSimulationAuthority(value) {
  return (
    isPlainObject(value) &&
    value.class === "simulation" &&
    value.authoritative === false &&
    value.finality === "non_authoritative" &&
    value.runtimeMode === "guided" &&
    value.inheritance === "rebuild_in_live_run"
  );
}

function addAuthorityMetadataIssues(issues, value, path = "authority") {
  if (!isPlainObject(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  if (!new Set(["simulation", "authoritative"]).has(value.class)) {
    issues.push(`${path}.class must be simulation or authoritative`);
    return;
  }
  if (value.class === "simulation") {
    if (value.authoritative !== false) {
      issues.push(`${path}.authoritative must be false for simulation`);
    }
    if (value.finality !== "non_authoritative") {
      issues.push(`${path}.finality must equal non_authoritative for simulation`);
    }
    if (value.runtimeMode !== "guided") {
      issues.push(`${path}.runtimeMode must equal guided for simulation`);
    }
    if (value.inheritance !== "rebuild_in_live_run") {
      issues.push(
        `${path}.inheritance must equal rebuild_in_live_run for simulation`,
      );
    }
  } else {
    if (value.authoritative !== true) {
      issues.push(`${path}.authoritative must be true for authoritative content`);
    }
    if (value.finality !== "authoritative") {
      issues.push(`${path}.finality must equal authoritative`);
    }
    if (value.runtimeMode !== "live") {
      issues.push(`${path}.runtimeMode must equal live for authoritative content`);
    }
    if (value.inheritance !== "final") {
      issues.push(`${path}.inheritance must equal final for authoritative content`);
    }
  }
  if (value.label !== undefined) addTextIssue(issues, value.label, `${path}.label`);
  if (value.boundary !== undefined) {
    addTextIssue(issues, value.boundary, `${path}.boundary`);
  }
}

function addTextIssue(issues, value, path) {
  if (!hasText(value)) issues.push(`${path} must be a non-empty string`);
}

function addStringArrayIssues(issues, value, path, { allowEmpty = true } = {}) {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return;
  }
  if (!allowEmpty && value.length === 0) {
    issues.push(`${path} must not be empty`);
  }
  value.forEach((item, index) => addTextIssue(issues, item, `${path}[${index}]`));
  if (new Set(value).size !== value.length) {
    issues.push(`${path} must not contain duplicates`);
  }
}

function addSchemaVersionIssue(issues, value) {
  if (value !== RESEARCH_ARTIFACT_SCHEMA_VERSION) {
    issues.push(
      `schemaVersion must equal ${RESEARCH_ARTIFACT_SCHEMA_VERSION}`,
    );
  }
}

function addPositiveIntegerIssue(issues, value, path) {
  if (!Number.isInteger(value) || value < 1) {
    issues.push(`${path} must be a positive integer`);
  }
}

function addTimestampIssue(issues, value, path) {
  if (!value || Number.isNaN(Date.parse(value))) {
    issues.push(`${path} must be an ISO timestamp`);
  }
}

function addStrictIsoTimestampIssue(issues, value, path) {
  if (
    !hasText(value) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    Number.isNaN(Date.parse(value))
  ) {
    issues.push(`${path} must be an ISO timestamp`);
  }
}

function addSha256Issue(issues, value, path) {
  if (!/^[a-f0-9]{64}$/i.test(value ?? "")) {
    issues.push(`${path} must be a SHA-256 hash`);
  }
}

function addEnumIssue(issues, value, allowed, path) {
  if (!allowed.includes(value)) {
    issues.push(`${path} must be one of ${allowed.join(", ")}`);
  }
}

function addVersionedArtifactHeaderIssues(issues, value) {
  addSchemaVersionIssue(issues, value.schemaVersion);
  addTextIssue(issues, value.id, "id");
  addPositiveIntegerIssue(issues, value.version, "version");
}

function addHumanActorIssues(issues, value, path) {
  if (!isPlainObject(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  addTextIssue(issues, value.id, `${path}.id`);
  addTextIssue(issues, value.role, `${path}.role`);
  if (value.kind !== "human") {
    issues.push(`${path}.kind must equal human`);
  }
}

function addUniqueObjectIdIssues(issues, values, path) {
  const seen = new Set();
  values.forEach((value, index) => {
    if (!hasText(value?.id)) return;
    if (seen.has(value.id)) {
      issues.push(`${path} must not contain duplicate id ${value.id}`);
    }
    seen.add(value.id);
  });
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function addSearchMethodFingerprintIssues(issues, value, path) {
  if (!isPlainObject(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  addTextIssue(issues, value.artifactId, `${path}.artifactId`);
  addTextIssue(issues, value.artifactType, `${path}.artifactType`);
  addPositiveIntegerIssue(issues, value.version, `${path}.version`);
  addSha256Issue(issues, value.contentHash, `${path}.contentHash`);
}

function addSearchMethodFingerprintArrayIssues(
  issues,
  value,
  path,
  { allowEmpty = false } = {},
) {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return;
  }
  if (!allowEmpty && value.length === 0) {
    issues.push(`${path} must not be empty`);
  }
  const artifactIds = new Set();
  value.forEach((fingerprint, index) => {
    addSearchMethodFingerprintIssues(issues, fingerprint, `${path}[${index}]`);
    if (!hasText(fingerprint?.artifactId)) return;
    if (artifactIds.has(fingerprint.artifactId)) {
      issues.push(`${path} must not repeat artifactId ${fingerprint.artifactId}`);
    }
    artifactIds.add(fingerprint.artifactId);
  });
}

function addSearchTimeRangeIssues(issues, value, path) {
  if (!isPlainObject(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  addEnumIssue(
    issues,
    value.basis,
    ["publication_date", "entry_date", "none"],
    `${path}.basis`,
  );
  for (const key of ["from", "to"]) {
    if (value[key] !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value[key] ?? "")) {
      issues.push(`${path}.${key} must be null or an ISO calendar date`);
    }
  }
  if (value.basis === "none" && (value.from !== null || value.to !== null)) {
    issues.push(`${path} with basis none must use null from and to`);
  }
  if (
    ["publication_date", "entry_date"].includes(value.basis) &&
    value.from === null &&
    value.to === null
  ) {
    issues.push(`${path} requires from or to when a date basis is selected`);
  }
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(value.from ?? "") &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.to ?? "") &&
    value.from > value.to
  ) {
    issues.push(`${path}.from must not be later than ${path}.to`);
  }
}

function addExecutableQueryIssues(issues, value, path = "query") {
  addTextIssue(issues, value?.[path], path);
  addSha256Issue(issues, value?.queryHash, "queryHash");
  if (
    hasText(value?.[path]) &&
    /^[a-f0-9]{64}$/i.test(value?.queryHash ?? "") &&
    value.queryHash.toLowerCase() !== sha256Text(value[path])
  ) {
    issues.push(`queryHash does not match ${path}`);
  }
}

function addSearchMethodCommonIssues(issues, value) {
  addVersionedArtifactHeaderIssues(issues, value);
  if (value.provider !== "pubmed") {
    issues.push("provider must equal pubmed");
  }
  if (value.database !== "PubMed") {
    issues.push("database must equal PubMed");
  }
  addStrictIsoTimestampIssue(issues, value.createdAt, "createdAt");
  if (!Array.isArray(value.fields) || value.fields.length === 0) {
    issues.push("fields must be a non-empty array");
  } else {
    const seen = new Set();
    value.fields.forEach((field, index) => {
      addEnumIssue(issues, field, PUBMED_SEARCH_FIELDS, `fields[${index}]`);
      if (seen.has(field)) issues.push(`fields must not repeat ${field}`);
      seen.add(field);
    });
  }
  addSearchTimeRangeIssues(issues, value.timeRange, "timeRange");
  addStringArrayIssues(issues, value.languages, "languages", { allowEmpty: false });
  addStringArrayIssues(issues, value.inclusionCriteria, "inclusionCriteria", {
    allowEmpty: false,
  });
  addStringArrayIssues(issues, value.exclusionCriteria, "exclusionCriteria", {
    allowEmpty: false,
  });
  addStringArrayIssues(issues, value.stopRules, "stopRules", { allowEmpty: false });
  addSearchMethodFingerprintArrayIssues(
    issues,
    value.upstreamArtifactFingerprints,
    "upstreamArtifactFingerprints",
  );
  addExecutableQueryIssues(issues, value);
}

function addConceptGroupIssues(issues, value, path) {
  if (!isPlainObject(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  addTextIssue(issues, value.id, `${path}.id`);
  addTextIssue(issues, value.label, `${path}.label`);
  addTextIssue(issues, value.rationale, `${path}.rationale`);
  addStringArrayIssues(issues, value.terms, `${path}.terms`, { allowEmpty: false });
}

function validateConceptMatrix(value, kind) {
  const issues = [];
  if (!isPlainObject(value)) return [`${kind} concept matrix must be an object`];
  addSearchMethodCommonIssues(issues, value);
  if (!Array.isArray(value.conceptGroups) || value.conceptGroups.length === 0) {
    issues.push("conceptGroups must be a non-empty array");
  } else {
    addUniqueObjectIdIssues(issues, value.conceptGroups, "conceptGroups");
    value.conceptGroups.forEach((group, index) =>
      addConceptGroupIssues(issues, group, `conceptGroups[${index}]`),
    );
  }
  addStringArrayIssues(issues, value.sentinelSourceIds, "sentinelSourceIds", {
    allowEmpty: false,
  });
  for (const [index, sourceId] of (value.sentinelSourceIds ?? []).entries()) {
    if (hasText(sourceId) && /^sentinel:/i.test(sourceId.trim())) {
      issues.push(
        `sentinelSourceIds[${index}] must identify a real pre-registered source, not a sentinel:* placeholder`,
      );
    }
  }
  if (kind === "focused") {
    addTextIssue(issues, value.focusedRelation, "focusedRelation");
  }
  return issues;
}

export function validateOrientationConceptMatrix(value) {
  return validateConceptMatrix(value, "orientation");
}

export function validateFocusedConceptMatrix(value) {
  return validateConceptMatrix(value, "focused");
}

function addQueryVariantIssues(issues, value, path) {
  if (!isPlainObject(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  addTextIssue(issues, value.id, `${path}.id`);
  addTextIssue(issues, value.purpose, `${path}.purpose`);
  addTextIssue(issues, value.query, `${path}.query`);
  addSha256Issue(issues, value.queryHash, `${path}.queryHash`);
  if (
    hasText(value.query) &&
    /^[a-f0-9]{64}$/i.test(value.queryHash ?? "") &&
    value.queryHash.toLowerCase() !== sha256Text(value.query)
  ) {
    issues.push(`${path}.queryHash does not match ${path}.query`);
  }
}

function validateSearchProtocol(value, kind) {
  const issues = [];
  if (!isPlainObject(value)) return [`${kind} search protocol must be an object`];
  addSearchMethodCommonIssues(issues, value);
  addSearchMethodFingerprintIssues(
    issues,
    value.conceptMatrixFingerprint,
    "conceptMatrixFingerprint",
  );
  addTextIssue(issues, value.accessPolicy, "accessPolicy");
  addTextIssue(issues, value.samplingRule, "samplingRule");
  const hasRevisionFingerprint = value.previousProtocolFingerprint !== undefined;
  const hasHumanRevision = value.humanRevision !== undefined;
  if (hasRevisionFingerprint !== hasHumanRevision) {
    issues.push(
      "previousProtocolFingerprint and humanRevision must be declared together",
    );
  }
  if (hasRevisionFingerprint) {
    addSearchMethodFingerprintIssues(
      issues,
      value.previousProtocolFingerprint,
      "previousProtocolFingerprint",
    );
    if (!isPlainObject(value.humanRevision)) {
      issues.push("humanRevision must be an object");
    } else {
      addHumanActorIssues(issues, value.humanRevision.revisedBy, "humanRevision.revisedBy");
      addStrictIsoTimestampIssue(
        issues,
        value.humanRevision.revisedAt,
        "humanRevision.revisedAt",
      );
      addTextIssue(issues, value.humanRevision.reason, "humanRevision.reason");
      addTextIssue(
        issues,
        value.humanRevision.previousQuery,
        "humanRevision.previousQuery",
      );
      addSha256Issue(
        issues,
        value.humanRevision.previousQueryHash,
        "humanRevision.previousQueryHash",
      );
      if (
        hasText(value.humanRevision.previousQuery) &&
        /^[a-f0-9]{64}$/i.test(value.humanRevision.previousQueryHash ?? "") &&
        value.humanRevision.previousQueryHash.toLowerCase() !==
          sha256Text(value.humanRevision.previousQuery)
      ) {
        issues.push(
          "humanRevision.previousQueryHash does not match humanRevision.previousQuery",
        );
      }
    }
  }
  if (kind === "orientation") {
    addTextIssue(issues, value.queryId, "queryId");
  } else {
    addTextIssue(issues, value.primaryQueryId, "primaryQueryId");
    if (!Array.isArray(value.queryVariants) || value.queryVariants.length < 2) {
      issues.push("queryVariants must contain at least two executable variants");
    } else {
      const ids = new Set();
      const queries = new Set();
      const hashes = new Set();
      value.queryVariants.forEach((variant, index) => {
        const path = `queryVariants[${index}]`;
        addQueryVariantIssues(issues, variant, path);
        for (const [field, seen, candidate] of [
          ["id", ids, variant?.id],
          ["query", queries, variant?.query],
          ["queryHash", hashes, variant?.queryHash?.toLowerCase?.()],
        ]) {
          if (!hasText(candidate)) continue;
          if (seen.has(candidate)) issues.push(`queryVariants must not repeat ${field} ${candidate}`);
          seen.add(candidate);
        }
      });
      const primary = value.queryVariants.find(
        (variant) => variant?.id === value.primaryQueryId,
      );
      if (!primary) {
        issues.push("primaryQueryId must identify one queryVariants item");
      } else if (primary.query !== value.query || primary.queryHash !== value.queryHash) {
        issues.push("query and queryHash must equal the primary query variant");
      }
    }
  }
  return issues;
}

export function validateOrientationSearchProtocol(value) {
  return validateSearchProtocol(value, "orientation");
}

export function validateFocusedSearchProtocol(value) {
  return validateSearchProtocol(value, "focused");
}

function addRetrievalRunReferenceIssues(issues, value, path) {
  if (!isPlainObject(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  for (const field of [
    "purpose",
    "nodeId",
    "protocolArtifactId",
    "queryId",
    "query",
  ]) {
    addTextIssue(issues, value[field], `${path}.${field}`);
  }
  for (const field of ["protocolContentHash", "queryHash", "receiptHash"]) {
    addSha256Issue(issues, value[field], `${path}.${field}`);
  }
  if (
    hasText(value.query) &&
    /^[a-f0-9]{64}$/i.test(value.queryHash ?? "") &&
    value.queryHash.toLowerCase() !== sha256Text(value.query)
  ) {
    issues.push(`${path}.queryHash does not match ${path}.query`);
  }
}

function addNoiseAssessmentIssues(issues, value, path) {
  if (!isPlainObject(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  addTextIssue(issues, value.id, `${path}.id`);
  addTextIssue(issues, value.description, `${path}.description`);
  if (!Number.isInteger(value.count) || value.count < 0) {
    issues.push(`${path}.count must be an integer >= 0`);
  }
}

function addSentinelCheckIssues(issues, value, path) {
  if (!isPlainObject(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  addTextIssue(issues, value.sourceId, `${path}.sourceId`);
  if (typeof value.retrieved !== "boolean") {
    issues.push(`${path}.retrieved must be a boolean`);
  }
  addTextIssue(issues, value.note, `${path}.note`);
}

function validateCalibrationReport(value, kind) {
  const issues = [];
  if (!isPlainObject(value)) return [`${kind} calibration report must be an object`];
  addSearchMethodCommonIssues(issues, value);
  addSearchMethodFingerprintIssues(
    issues,
    value.protocolFingerprint,
    "protocolFingerprint",
  );
  if (!Array.isArray(value.retrievalRunRefs) || value.retrievalRunRefs.length === 0) {
    issues.push("retrievalRunRefs must be a non-empty array");
  } else {
    const receiptHashes = new Set();
    value.retrievalRunRefs.forEach((reference, index) => {
      addRetrievalRunReferenceIssues(issues, reference, `retrievalRunRefs[${index}]`);
      const receiptHash = reference?.receiptHash?.toLowerCase?.();
      if (!hasText(receiptHash)) return;
      if (receiptHashes.has(receiptHash)) {
        issues.push(`retrievalRunRefs must not repeat receiptHash ${receiptHash}`);
      }
      receiptHashes.add(receiptHash);
    });
  }
  addStringArrayIssues(issues, value.sampleSourceIds, "sampleSourceIds", {
    allowEmpty: false,
  });
  addPositiveIntegerIssue(issues, value.checkedCount, "checkedCount");
  if (
    Array.isArray(value.sampleSourceIds) &&
    Number.isInteger(value.checkedCount) &&
    value.checkedCount !== value.sampleSourceIds.length
  ) {
    issues.push("checkedCount must equal sampleSourceIds.length");
  }
  if (!Array.isArray(value.noiseAssessment) || value.noiseAssessment.length === 0) {
    issues.push("noiseAssessment must be a non-empty array");
  } else {
    addUniqueObjectIdIssues(issues, value.noiseAssessment, "noiseAssessment");
    value.noiseAssessment.forEach((entry, index) =>
      addNoiseAssessmentIssues(issues, entry, `noiseAssessment[${index}]`),
    );
  }
  if (!Array.isArray(value.sentinelChecks) || value.sentinelChecks.length === 0) {
    issues.push("sentinelChecks must be a non-empty array");
  } else {
    const sourceIds = new Set();
    value.sentinelChecks.forEach((check, index) => {
      addSentinelCheckIssues(issues, check, `sentinelChecks[${index}]`);
      if (!hasText(check?.sourceId)) return;
      if (sourceIds.has(check.sourceId)) {
        issues.push(`sentinelChecks must not repeat sourceId ${check.sourceId}`);
      }
      sourceIds.add(check.sourceId);
    });
  }
  addEnumIssue(
    issues,
    value.revisionDecision,
    ["keep", "revise", "reject"],
    "revisionDecision",
  );
  if (
    value.revisionDecision === "keep" &&
    Array.isArray(value.sentinelChecks) &&
    value.sentinelChecks.some((check) => check?.retrieved !== true)
  ) {
    issues.push(
      "revisionDecision keep requires every sentinelChecks item to be successfully retrieved",
    );
  }
  addQueryVariantIssues(issues, value.selectedQuery, "selectedQuery");
  addTextIssue(issues, value.stopReason, "stopReason");
  if (
    isPlainObject(value.selectedQuery) &&
    (value.selectedQuery.query !== value.query ||
      value.selectedQuery.queryHash !== value.queryHash)
  ) {
    issues.push("query and queryHash must equal selectedQuery");
  }
  if (
    Array.isArray(value.retrievalRunRefs) &&
    isPlainObject(value.selectedQuery) &&
    !value.retrievalRunRefs.some(
      (reference) =>
        reference?.queryId === value.selectedQuery.id &&
        reference?.query === value.selectedQuery.query &&
        reference?.queryHash === value.selectedQuery.queryHash,
    )
  ) {
    issues.push("selectedQuery must identify an actually referenced retrieval run");
  }
  return issues;
}

export function validateOrientationCalibrationReport(value) {
  return validateCalibrationReport(value, "orientation");
}

export function validateFocusedCalibrationReport(value) {
  return validateCalibrationReport(value, "focused");
}

function validateFrozenProtocol(value, kind) {
  const issues = [];
  if (!isPlainObject(value)) return [`frozen ${kind} search protocol must be an object`];
  addSearchMethodCommonIssues(issues, value);
  addSearchMethodFingerprintIssues(
    issues,
    value.parentProtocolFingerprint,
    "parentProtocolFingerprint",
  );
  addSearchMethodFingerprintIssues(
    issues,
    value.calibrationFingerprint,
    "calibrationFingerprint",
  );
  addRetrievalRunReferenceIssues(
    issues,
    value.selectedExecution,
    "selectedExecution",
  );
  addStrictIsoTimestampIssue(issues, value.frozenAt, "frozenAt");
  addTextIssue(issues, value.freezeReason, "freezeReason");
  if (
    isPlainObject(value.selectedExecution) &&
    (value.selectedExecution.query !== value.query ||
      value.selectedExecution.queryHash !== value.queryHash)
  ) {
    issues.push("query and queryHash must equal selectedExecution");
  }
  return issues;
}

export function validateFrozenOrientationSearchProtocol(value) {
  return validateFrozenProtocol(value, "orientation");
}

export function validateFrozenSearchProtocol(value) {
  return validateFrozenProtocol(value, "focused");
}

function hasSourceLocator(locator) {
  return ["pmid", "doi", "url", "repositoryId"].some((key) =>
    hasText(locator?.[key]),
  );
}

function isLivePubMedContent(value) {
  return (
    isPlainObject(value) &&
    (value.retrievalMode === "live_pubmed" || value.provider === "pubmed")
  );
}

function addPubMedProviderIssue(issues, value) {
  if (value !== "pubmed") {
    issues.push("provider must equal pubmed for live PubMed retrieval");
  }
}

function addPubMedLocatorIssue(issues, value, path) {
  if (
    !isPlainObject(value) ||
    (!hasText(value.pmid) && !hasText(value.url))
  ) {
    issues.push(`${path} must include a non-empty pmid or url`);
  }
}

function addPubMedSourceRecordIssues(issues, value, path) {
  if (!isPlainObject(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  addTextIssue(issues, value.sourceId, `${path}.sourceId`);
  addTextIssue(issues, value.title, `${path}.title`);
  addEnumIssue(
    issues,
    value.accessLevel,
    EVIDENCE_ACCESS_LEVELS,
    `${path}.accessLevel`,
  );
  addSha256Issue(
    issues,
    value.sourceSnapshotHash,
    `${path}.sourceSnapshotHash`,
  );
  addPubMedLocatorIssue(issues, value.locator, `${path}.locator`);
}

export function validateLiveSearchRunSnapshot(value) {
  if (!isLivePubMedContent(value)) return [];

  const issues = [];
  addPubMedProviderIssue(issues, value.provider);
  if (value.executionStatus !== "completed_live_search") {
    issues.push(
      "executionStatus must equal completed_live_search for live PubMed retrieval",
    );
  }
  addTextIssue(issues, value.query, "query");
  addStrictIsoTimestampIssue(issues, value.executedAt, "executedAt");
  addPositiveIntegerIssue(issues, value.resultCount, "resultCount");
  addSha256Issue(issues, value.receiptHash, "receiptHash");

  if (!Array.isArray(value.records)) {
    issues.push("records must be an array");
  } else {
    if (value.records.length === 0) {
      issues.push("records must not be empty");
    }
    value.records.forEach((record, index) =>
      addPubMedSourceRecordIssues(issues, record, `records[${index}]`),
    );
  }

  return issues;
}

export function validateLiveSourceSnapshot(value) {
  if (!isLivePubMedContent(value)) return [];

  const issues = [];
  addPubMedProviderIssue(issues, value.provider);
  addPubMedSourceRecordIssues(issues, value, "source");
  return issues;
}

export function validateLiveCorpusManifest(value) {
  if (!isLivePubMedContent(value)) return [];

  const issues = [];
  addPubMedProviderIssue(issues, value.provider);
  addPositiveIntegerIssue(issues, value.sourceCount, "sourceCount");
  addStringArrayIssues(issues, value.sourceIds, "sourceIds", {
    allowEmpty: false,
  });
  if (
    Array.isArray(value.sourceIds) &&
    Number.isInteger(value.sourceCount) &&
    value.sourceCount >= 1 &&
    value.sourceCount !== value.sourceIds.length
  ) {
    issues.push("sourceCount must equal sourceIds.length");
  }
  addSha256Issue(
    issues,
    value.retrievalReceiptHash,
    "retrievalReceiptHash",
  );
  return issues;
}

export function validateEvidenceExcerpt(value) {
  const issues = [];
  if (!isPlainObject(value)) return ["evidence excerpt must be an object"];

  addSchemaVersionIssue(issues, value.schemaVersion);
  addTextIssue(issues, value.id, "id");
  addTextIssue(issues, value.sourceId, "sourceId");
  addTextIssue(issues, value.claimId, "claimId");
  if (!EVIDENCE_ACCESS_LEVELS.includes(value.accessLevel)) {
    issues.push(`accessLevel must be one of ${EVIDENCE_ACCESS_LEVELS.join(", ")}`);
  }
  if (!EVIDENCE_RELATIONS.includes(value.relation)) {
    issues.push(`relation must be one of ${EVIDENCE_RELATIONS.join(", ")}`);
  }
  if (!isPlainObject(value.locator) || !hasSourceLocator(value.locator)) {
    issues.push("locator must include at least one of pmid, doi, url, or repositoryId");
  }
  addStringArrayIssues(issues, value.extractedFacts, "extractedFacts", {
    allowEmpty: false,
  });
  addStringArrayIssues(issues, value.limitations, "limitations");
  addStringArrayIssues(issues, value.unknowns, "unknowns");
  if (!/^[a-f0-9]{64}$/i.test(value.sourceSnapshotHash ?? "")) {
    issues.push("sourceSnapshotHash must be a SHA-256 hash");
  }

  return issues;
}

export function assertValidEvidenceExcerpt(value) {
  const issues = validateEvidenceExcerpt(value);
  if (issues.length > 0) {
    throw new ResearchArtifactContractError("INVALID_EVIDENCE_EXCERPT", issues);
  }
  return value;
}

export function validateResearchConclusionCard(value) {
  const issues = [];
  if (!isPlainObject(value)) return ["research conclusion card must be an object"];

  addSchemaVersionIssue(issues, value.schemaVersion);
  addTextIssue(issues, value.id, "id");
  addTextIssue(issues, value.questionId, "questionId");
  if (!Number.isInteger(value.version) || value.version < 1) {
    issues.push("version must be a positive integer");
  }
  addTextIssue(issues, value.claim, "claim");
  addTextIssue(issues, value.scope, "scope");
  addTextIssue(issues, value.producerId, "producerId");
  if (!CONCLUSION_CONFIDENCE_LEVELS.includes(value.confidence)) {
    issues.push(
      `confidence must be one of ${CONCLUSION_CONFIDENCE_LEVELS.join(", ")}`,
    );
  }
  addStringArrayIssues(
    issues,
    value.supportingEvidenceIds,
    "supportingEvidenceIds",
    { allowEmpty: false },
  );
  addStringArrayIssues(issues, value.counterEvidenceIds, "counterEvidenceIds");
  addStringArrayIssues(issues, value.uncertainties, "uncertainties", {
    allowEmpty: false,
  });
  addTextIssue(issues, value.accessBoundary, "accessBoundary");
  addTextIssue(issues, value.nextQuestion, "nextQuestion");

  return issues;
}

export function assertValidResearchConclusionCard(value) {
  const issues = validateResearchConclusionCard(value);
  if (issues.length > 0) {
    throw new ResearchArtifactContractError(
      "INVALID_RESEARCH_CONCLUSION_CARD",
      issues,
    );
  }
  return value;
}

export function validateEvidenceVerificationReport(value) {
  const issues = [];
  if (!isPlainObject(value)) return ["evidence verification report must be an object"];

  addSchemaVersionIssue(issues, value.schemaVersion);
  addTextIssue(issues, value.id, "id");
  addStringArrayIssues(issues, value.conclusionCardIds, "conclusionCardIds", {
    allowEmpty: false,
  });
  if (value.status !== "verified") {
    issues.push("status must equal verified");
  }
  if (!new Set(["pass", "partial", "fail"]).has(value.verdict)) {
    issues.push("verdict must be pass, partial, or fail");
  }
  addTextIssue(issues, value.producerId, "producerId");
  addTextIssue(issues, value.verifierId, "verifierId");
  if (hasText(value.producerId) && value.producerId === value.verifierId) {
    issues.push("verification verifier must be independent from the producer");
  }
  addStringArrayIssues(issues, value.limitations, "limitations");
  if (value.verdict === "partial" && value.limitations?.length === 0) {
    issues.push("partial verification requires limitations");
  }

  return issues;
}

export function assertValidEvidenceVerificationReport(value) {
  const issues = validateEvidenceVerificationReport(value);
  if (issues.length > 0) {
    throw new ResearchArtifactContractError(
      "INVALID_EVIDENCE_VERIFICATION_REPORT",
      issues,
    );
  }
  return value;
}

export function validateDecisionReceipt(value) {
  const issues = [];
  if (!isPlainObject(value)) return ["decision receipt must be an object"];

  addSchemaVersionIssue(issues, value.schemaVersion);
  addTextIssue(issues, value.id, "id");
  addTextIssue(issues, value.decision, "decision");
  addTextIssue(issues, value.reason, "reason");
  addTextIssue(issues, value.reversibleScope, "reversibleScope");
  addStringArrayIssues(issues, value.explicitDefaults, "explicitDefaults");
  if (!value.decidedAt || Number.isNaN(Date.parse(value.decidedAt))) {
    issues.push("decidedAt must be an ISO timestamp");
  }
  if (!isPlainObject(value.decidedBy)) {
    issues.push("decidedBy must be an object");
  } else {
    addTextIssue(issues, value.decidedBy.id, "decidedBy.id");
    addTextIssue(issues, value.decidedBy.role, "decidedBy.role");
    if (value.decidedBy.kind !== "human") {
      issues.push("decidedBy.kind must equal human");
    }
  }
  if (!Array.isArray(value.artifactFingerprints) || value.artifactFingerprints.length === 0) {
    issues.push("artifactFingerprints must be a non-empty array");
  } else {
    value.artifactFingerprints.forEach((fingerprint, index) => {
      const path = `artifactFingerprints[${index}]`;
      if (!isPlainObject(fingerprint)) {
        issues.push(`${path} must be an object`);
        return;
      }
      addTextIssue(issues, fingerprint.artifactId, `${path}.artifactId`);
      if (!Number.isInteger(fingerprint.version) || fingerprint.version < 1) {
        issues.push(`${path}.version must be a positive integer`);
      }
      if (!/^[a-f0-9]{64}$/i.test(fingerprint.contentHash ?? "")) {
        issues.push(`${path}.contentHash must be a SHA-256 hash`);
      }
    });
  }

  return issues;
}

export function assertValidDecisionReceipt(value) {
  const issues = validateDecisionReceipt(value);
  if (issues.length > 0) {
    throw new ResearchArtifactContractError("INVALID_DECISION_RECEIPT", issues);
  }
  return value;
}

export function validateEvidenceDrivenOutline(value) {
  const issues = [];
  if (!isPlainObject(value)) return ["evidence-driven outline must be an object"];

  addVersionedArtifactHeaderIssues(issues, value);
  addTextIssue(issues, value.questionId, "questionId");
  addTextIssue(
    issues,
    value.evidenceBoundaryDecisionId,
    "evidenceBoundaryDecisionId",
  );
  addTextIssue(issues, value.claimEvidenceMapId, "claimEvidenceMapId");
  addTextIssue(issues, value.producerId, "producerId");
  addStringArrayIssues(issues, value.excludedTopics, "excludedTopics");

  if (!Array.isArray(value.sections) || value.sections.length === 0) {
    issues.push("sections must be a non-empty array");
  } else {
    addUniqueObjectIdIssues(issues, value.sections, "sections");
    value.sections.forEach((section, index) => {
      const path = `sections[${index}]`;
      if (!isPlainObject(section)) {
        issues.push(`${path} must be an object`);
        return;
      }
      addTextIssue(issues, section.id, `${path}.id`);
      addTextIssue(issues, section.title, `${path}.title`);
      addTextIssue(issues, section.purpose, `${path}.purpose`);
      addStringArrayIssues(issues, section.claimIds, `${path}.claimIds`, {
        allowEmpty: false,
      });
      addStringArrayIssues(
        issues,
        section.supportingEvidenceIds,
        `${path}.supportingEvidenceIds`,
        { allowEmpty: false },
      );
      addStringArrayIssues(
        issues,
        section.counterEvidenceIds,
        `${path}.counterEvidenceIds`,
      );
      addStringArrayIssues(issues, section.limitations, `${path}.limitations`);
    });
  }

  return issues;
}

export function assertValidEvidenceDrivenOutline(value) {
  const issues = validateEvidenceDrivenOutline(value);
  if (issues.length > 0) {
    throw new ResearchArtifactContractError(
      "INVALID_EVIDENCE_DRIVEN_OUTLINE",
      issues,
    );
  }
  return value;
}

export function validateOutlineStressTest(value) {
  const issues = [];
  if (!isPlainObject(value)) return ["outline stress test must be an object"];

  addVersionedArtifactHeaderIssues(issues, value);
  addTextIssue(issues, value.outlineId, "outlineId");
  addTextIssue(issues, value.outlineProducerId, "outlineProducerId");
  addTextIssue(issues, value.verifierId, "verifierId");
  if (
    hasText(value.outlineProducerId) &&
    value.outlineProducerId === value.verifierId
  ) {
    issues.push("outline verifier must be independent from the outline producer");
  }
  addEnumIssue(
    issues,
    value.verdict,
    OUTLINE_STRESS_TEST_VERDICTS,
    "verdict",
  );
  addStringArrayIssues(
    issues,
    value.reviewedSectionIds,
    "reviewedSectionIds",
    { allowEmpty: false },
  );

  if (!Array.isArray(value.findings)) {
    issues.push("findings must be an array");
  } else {
    addUniqueObjectIdIssues(issues, value.findings, "findings");
    value.findings.forEach((finding, index) => {
      const path = `findings[${index}]`;
      if (!isPlainObject(finding)) {
        issues.push(`${path} must be an object`);
        return;
      }
      addTextIssue(issues, finding.id, `${path}.id`);
      addTextIssue(issues, finding.targetRef, `${path}.targetRef`);
      addEnumIssue(
        issues,
        finding.severity,
        REVIEW_FINDING_SEVERITIES,
        `${path}.severity`,
      );
      addTextIssue(issues, finding.message, `${path}.message`);
      addTextIssue(
        issues,
        finding.recommendedAction,
        `${path}.recommendedAction`,
      );
      if (typeof finding.resolved !== "boolean") {
        issues.push(`${path}.resolved must be a boolean`);
      }
    });

    const unresolved = value.findings.filter(
      (finding) => isPlainObject(finding) && finding.resolved === false,
    );
    const unresolvedBlockers = unresolved.filter(
      (finding) => finding.severity === "blocker",
    );
    if (value.verdict === "pass" && unresolvedBlockers.length > 0) {
      issues.push("a passing outline stress test cannot retain unresolved blockers");
    }
    if (
      ["revision_required", "fail"].includes(value.verdict) &&
      unresolved.length === 0
    ) {
      issues.push(`${value.verdict} requires at least one unresolved finding`);
    }
  }

  return issues;
}

export function assertValidOutlineStressTest(value) {
  const issues = validateOutlineStressTest(value);
  if (issues.length > 0) {
    throw new ResearchArtifactContractError("INVALID_OUTLINE_STRESS_TEST", issues);
  }
  return value;
}

export function validateFrozenWritingPlan(value) {
  const issues = [];
  if (!isPlainObject(value)) return ["frozen writing plan must be an object"];

  addVersionedArtifactHeaderIssues(issues, value);
  addTextIssue(issues, value.outlineId, "outlineId");
  addTextIssue(issues, value.outlineStressTestId, "outlineStressTestId");
  addTextIssue(issues, value.outlineDecisionId, "outlineDecisionId");
  addHumanActorIssues(issues, value.approvedBy, "approvedBy");
  addTimestampIssue(issues, value.approvedAt, "approvedAt");
  addStringArrayIssues(issues, value.excludedTopics, "excludedTopics");

  if (!Array.isArray(value.claimUnitPlans) || value.claimUnitPlans.length === 0) {
    issues.push("claimUnitPlans must be a non-empty array");
  } else {
    addUniqueObjectIdIssues(issues, value.claimUnitPlans, "claimUnitPlans");
    value.claimUnitPlans.forEach((plan, index) => {
      const path = `claimUnitPlans[${index}]`;
      if (!isPlainObject(plan)) {
        issues.push(`${path} must be an object`);
        return;
      }
      addTextIssue(issues, plan.id, `${path}.id`);
      addTextIssue(issues, plan.sectionId, `${path}.sectionId`);
      addTextIssue(issues, plan.claimId, `${path}.claimId`);
      addTextIssue(issues, plan.purpose, `${path}.purpose`);
      addStringArrayIssues(
        issues,
        plan.allowedEvidenceIds,
        `${path}.allowedEvidenceIds`,
        { allowEmpty: false },
      );
      addStringArrayIssues(
        issues,
        plan.prohibitedMoves,
        `${path}.prohibitedMoves`,
      );
    });
  }

  return issues;
}

export function assertValidFrozenWritingPlan(value) {
  const issues = validateFrozenWritingPlan(value);
  if (issues.length > 0) {
    throw new ResearchArtifactContractError("INVALID_FROZEN_WRITING_PLAN", issues);
  }
  return value;
}

function addCitationIntentIssues(issues, value, path) {
  if (!isPlainObject(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  addTextIssue(issues, value.id, `${path}.id`);
  addTextIssue(issues, value.evidenceId, `${path}.evidenceId`);
  addEnumIssue(
    issues,
    value.purpose,
    CITATION_INTENT_PURPOSES,
    `${path}.purpose`,
  );
}

function addClaimSentenceIssues(
  issues,
  value,
  path,
  { requirePassingVerification = false, verificationResultId = null } = {},
) {
  if (!isPlainObject(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  addTextIssue(issues, value.id, `${path}.id`);
  addTextIssue(issues, value.text, `${path}.text`);
  addEnumIssue(issues, value.kind, CLAIM_SENTENCE_KINDS, `${path}.kind`);
  if (!Array.isArray(value.citationIntents)) {
    issues.push(`${path}.citationIntents must be an array`);
  } else {
    addUniqueObjectIdIssues(
      issues,
      value.citationIntents,
      `${path}.citationIntents`,
    );
    value.citationIntents.forEach((intent, index) =>
      addCitationIntentIssues(
        issues,
        intent,
        `${path}.citationIntents[${index}]`,
      ),
    );
    if (CLAIM_SENTENCE_KINDS.includes(value.kind) && value.citationIntents.length === 0) {
      issues.push(
        `${path}.${value.kind} sentence requires at least one citation intent; sentence labels cannot bypass verification`,
      );
    }
  }

  if (
    !requirePassingVerification ||
    !CLAIM_SENTENCE_KINDS.includes(value.kind)
  ) {
    return;
  }
  if (!isPlainObject(value.verification)) {
    issues.push(`${path}.${value.kind} sentence requires a verification result`);
    return;
  }
  addTextIssue(issues, value.verification.resultId, `${path}.verification.resultId`);
  if (
    hasText(verificationResultId) &&
    value.verification.resultId !== verificationResultId
  ) {
    issues.push(
      `${path}.verification.resultId must equal ${verificationResultId}`,
    );
  }
  if (value.verification.verdict !== "direct_support") {
    issues.push(
      `${path}.${value.kind} sentence must have direct_support before acceptance`,
    );
  }
  addStringArrayIssues(
    issues,
    value.verification.verifiedEvidenceIds,
    `${path}.verification.verifiedEvidenceIds`,
    { allowEmpty: false },
  );
}

export function validateClaimUnitDraft(value) {
  const issues = [];
  if (!isPlainObject(value)) return ["claim-unit draft must be an object"];

  addVersionedArtifactHeaderIssues(issues, value);
  addTextIssue(issues, value.writingPlanId, "writingPlanId");
  addTextIssue(issues, value.claimUnitPlanId, "claimUnitPlanId");
  addTextIssue(issues, value.claimId, "claimId");
  addTextIssue(issues, value.producerId, "producerId");
  addStringArrayIssues(issues, value.boundaries, "boundaries");
  if (!Array.isArray(value.sentences) || value.sentences.length === 0) {
    issues.push("sentences must be a non-empty array");
  } else {
    addUniqueObjectIdIssues(issues, value.sentences, "sentences");
    value.sentences.forEach((sentence, index) =>
      addClaimSentenceIssues(issues, sentence, `sentences[${index}]`),
    );
  }

  return issues;
}

export function assertValidClaimUnitDraft(value) {
  const issues = validateClaimUnitDraft(value);
  if (issues.length > 0) {
    throw new ResearchArtifactContractError("INVALID_CLAIM_UNIT_DRAFT", issues);
  }
  return value;
}

export function validateClaimVerificationResult(value) {
  const issues = [];
  if (!isPlainObject(value)) return ["claim verification result must be an object"];

  addVersionedArtifactHeaderIssues(issues, value);
  addTextIssue(issues, value.claimUnitDraftId, "claimUnitDraftId");
  addTextIssue(issues, value.draftProducerId, "draftProducerId");
  addTextIssue(issues, value.verifierId, "verifierId");
  if (hasText(value.draftProducerId) && value.draftProducerId === value.verifierId) {
    issues.push("claim verifier must be independent from the draft producer");
  }
  if (value.status !== "verified") {
    issues.push("status must equal verified");
  }
  addStringArrayIssues(issues, value.limitations, "limitations");

  if (!Array.isArray(value.sentenceResults) || value.sentenceResults.length === 0) {
    issues.push("sentenceResults must be a non-empty array");
  } else {
    const resultIds = new Set();
    value.sentenceResults.forEach((result, index) => {
      const path = `sentenceResults[${index}]`;
      if (!isPlainObject(result)) {
        issues.push(`${path} must be an object`);
        return;
      }
      addTextIssue(issues, result.sentenceId, `${path}.sentenceId`);
      if (hasText(result.sentenceId) && resultIds.has(result.sentenceId)) {
        issues.push(`sentenceResults must not repeat ${result.sentenceId}`);
      }
      resultIds.add(result.sentenceId);
      addEnumIssue(
        issues,
        result.verdict,
        CLAIM_VERIFICATION_VERDICTS,
        `${path}.verdict`,
      );
      addStringArrayIssues(
        issues,
        result.citationIntentIds,
        `${path}.citationIntentIds`,
      );
      addStringArrayIssues(
        issues,
        result.verifiedEvidenceIds,
        `${path}.verifiedEvidenceIds`,
      );
      addTextIssue(issues, result.rationale, `${path}.rationale`);
      if (!isPlainObject(result.verificationReceipt)) {
        issues.push(`${path}.verificationReceipt must be an object`);
      } else {
        if (result.verificationReceipt.toolId !== "citation_verify") {
          issues.push(`${path}.verificationReceipt.toolId must equal citation_verify`);
        }
        addSha256Issue(
          issues,
          result.verificationReceipt.receiptHash,
          `${path}.verificationReceipt.receiptHash`,
        );
        addSha256Issue(
          issues,
          result.verificationReceipt.claimHash,
          `${path}.verificationReceipt.claimHash`,
        );
        addTextIssue(
          issues,
          result.verificationReceipt.method,
          `${path}.verificationReceipt.method`,
        );
        if (
          !result.verificationReceipt.checkedAt ||
          Number.isNaN(Date.parse(result.verificationReceipt.checkedAt))
        ) {
          issues.push(`${path}.verificationReceipt.checkedAt must be an ISO timestamp`);
        }
        if (!Array.isArray(result.verificationReceipt.sourceRefs) || result.verificationReceipt.sourceRefs.length === 0) {
          issues.push(`${path}.verificationReceipt.sourceRefs must be a non-empty array`);
        } else {
          result.verificationReceipt.sourceRefs.forEach((sourceRef, sourceIndex) => {
            const sourcePath = `${path}.verificationReceipt.sourceRefs[${sourceIndex}]`;
            if (!isPlainObject(sourceRef)) {
              issues.push(`${sourcePath} must be an object`);
              return;
            }
            addTextIssue(issues, sourceRef.sourceId, `${sourcePath}.sourceId`);
            addSha256Issue(
              issues,
              sourceRef.sourceSnapshotHash,
              `${sourcePath}.sourceSnapshotHash`,
            );
            addTextIssue(issues, sourceRef.accessLevel, `${sourcePath}.accessLevel`);
          });
        }
      }
      if (
        ["direct_support", "partial_support", "contradicted"].includes(
          result.verdict,
        ) &&
        result.verifiedEvidenceIds?.length === 0
      ) {
        issues.push(`${path}.${result.verdict} requires verified evidence`);
      }
      if (
        result.verdict !== "direct_support" &&
        !hasText(result.requiredRevision)
      ) {
        issues.push(`${path}.${result.verdict} requires requiredRevision`);
      }
    });
  }

  return issues;
}

export function assertValidClaimVerificationResult(value) {
  const issues = validateClaimVerificationResult(value);
  if (issues.length > 0) {
    throw new ResearchArtifactContractError(
      "INVALID_CLAIM_VERIFICATION_RESULT",
      issues,
    );
  }
  return value;
}

export function validateAcceptedClaimUnit(value) {
  const issues = [];
  if (!isPlainObject(value)) return ["accepted claim unit must be an object"];

  addVersionedArtifactHeaderIssues(issues, value);
  addTextIssue(issues, value.sourceDraftId, "sourceDraftId");
  addTextIssue(issues, value.verificationResultId, "verificationResultId");
  addTextIssue(issues, value.writingPlanId, "writingPlanId");
  addTextIssue(issues, value.claimId, "claimId");
  addTextIssue(issues, value.producerId, "producerId");
  addHumanActorIssues(issues, value.acceptedBy, "acceptedBy");
  addTimestampIssue(issues, value.acceptedAt, "acceptedAt");
  addStringArrayIssues(issues, value.boundaries, "boundaries");

  if (!Array.isArray(value.sentences) || value.sentences.length === 0) {
    issues.push("sentences must be a non-empty array");
  } else {
    addUniqueObjectIdIssues(issues, value.sentences, "sentences");
    value.sentences.forEach((sentence, index) =>
      addClaimSentenceIssues(issues, sentence, `sentences[${index}]`, {
        requirePassingVerification: true,
        verificationResultId: value.verificationResultId,
      }),
    );
  }

  return issues;
}

export function assertValidAcceptedClaimUnit(value) {
  const issues = validateAcceptedClaimUnit(value);
  if (issues.length > 0) {
    throw new ResearchArtifactContractError("INVALID_ACCEPTED_CLAIM_UNIT", issues);
  }
  return value;
}

function addManuscriptSectionIssues(
  issues,
  sections,
  acceptedClaimUnitIds,
  path = "sections",
) {
  if (!Array.isArray(sections) || sections.length === 0) {
    issues.push(`${path} must be a non-empty array`);
    return;
  }
  addUniqueObjectIdIssues(issues, sections, path);
  const acceptedIds = new Set(acceptedClaimUnitIds ?? []);
  const usedIds = [];
  sections.forEach((section, index) => {
    const sectionPath = `${path}[${index}]`;
    if (!isPlainObject(section)) {
      issues.push(`${sectionPath} must be an object`);
      return;
    }
    addTextIssue(issues, section.id, `${sectionPath}.id`);
    addTextIssue(issues, section.title, `${sectionPath}.title`);
    addTextIssue(issues, section.content, `${sectionPath}.content`);
    addStringArrayIssues(
      issues,
      section.claimUnitIds,
      `${sectionPath}.claimUnitIds`,
      { allowEmpty: false },
    );
    for (const claimUnitId of section.claimUnitIds ?? []) {
      usedIds.push(claimUnitId);
      if (!acceptedIds.has(claimUnitId)) {
        issues.push(
          `${sectionPath}.claimUnitIds references unaccepted unit ${claimUnitId}`,
        );
      }
    }
  });
  if (new Set(usedIds).size !== usedIds.length) {
    issues.push(`${path} must not reuse an accepted claim unit`);
  }
  for (const acceptedId of acceptedIds) {
    if (!usedIds.includes(acceptedId)) {
      issues.push(`${path} does not include accepted claim unit ${acceptedId}`);
    }
  }
}

export function validateManuscriptDraft(value) {
  const issues = [];
  if (!isPlainObject(value)) return ["manuscript draft must be an object"];

  addVersionedArtifactHeaderIssues(issues, value);
  addTextIssue(issues, value.writingPlanId, "writingPlanId");
  addTextIssue(issues, value.producerId, "producerId");
  addTextIssue(issues, value.title, "title");
  addTextIssue(issues, value.abstract, "abstract");
  addTextIssue(issues, value.conclusion, "conclusion");
  addStringArrayIssues(
    issues,
    value.acceptedClaimUnitIds,
    "acceptedClaimUnitIds",
    { allowEmpty: false },
  );
  addStringArrayIssues(issues, value.limitations, "limitations", {
    allowEmpty: false,
  });
  addStringArrayIssues(issues, value.newFactualClaims, "newFactualClaims");
  if (Array.isArray(value.newFactualClaims) && value.newFactualClaims.length > 0) {
    issues.push("newFactualClaims must be empty; new facts require a claim-unit review");
  }
  addManuscriptSectionIssues(
    issues,
    value.sections,
    value.acceptedClaimUnitIds,
  );
  validateManuscriptAssemblyContent(value).forEach((issue) =>
    issues.push(`assembly: ${issue}`),
  );

  return issues;
}

export function assertValidManuscriptDraft(value) {
  const issues = validateManuscriptDraft(value);
  if (issues.length > 0) {
    throw new ResearchArtifactContractError("INVALID_MANUSCRIPT_DRAFT", issues);
  }
  return value;
}

export function validateManuscriptAudit(value) {
  const issues = [];
  if (!isPlainObject(value)) return ["manuscript audit must be an object"];

  addVersionedArtifactHeaderIssues(issues, value);
  addTextIssue(issues, value.manuscriptDraftId, "manuscriptDraftId");
  addTextIssue(issues, value.manuscriptProducerId, "manuscriptProducerId");
  addTextIssue(issues, value.auditorId, "auditorId");
  if (
    hasText(value.manuscriptProducerId) &&
    value.manuscriptProducerId === value.auditorId
  ) {
    issues.push("manuscript auditor must be independent from the manuscript producer");
  }
  const simulation = isSimulationAuthority(value.authority);
  if (value.status !== (simulation ? "simulation_reviewed" : "audited")) {
    issues.push(
      simulation
        ? "status must equal simulation_reviewed for simulation"
        : "status must equal audited",
    );
  }
  addEnumIssue(
    issues,
    value.verdict,
    MANUSCRIPT_AUDIT_VERDICTS,
    "verdict",
  );
  if (value.verdict === "simulation_only") {
    addAuthorityMetadataIssues(issues, value.authority);
  } else if (simulation) {
    issues.push("simulation manuscript audit verdict must equal simulation_only");
  } else if (value.authority !== undefined) {
    addAuthorityMetadataIssues(issues, value.authority);
  }
  addStringArrayIssues(
    issues,
    value.checkedClaimUnitIds,
    "checkedClaimUnitIds",
    { allowEmpty: false },
  );
  addSha256Issue(
    issues,
    value.draftAssemblyFingerprint,
    "draftAssemblyFingerprint",
  );
  addStringArrayIssues(
    issues,
    value.disclosedLimitations,
    "disclosedLimitations",
    { allowEmpty: false },
  );

  if (!Array.isArray(value.findings)) {
    issues.push("findings must be an array");
  } else {
    addUniqueObjectIdIssues(issues, value.findings, "findings");
    value.findings.forEach((finding, index) => {
      const path = `findings[${index}]`;
      if (!isPlainObject(finding)) {
        issues.push(`${path} must be an object`);
        return;
      }
      addTextIssue(issues, finding.id, `${path}.id`);
      addTextIssue(issues, finding.targetRef, `${path}.targetRef`);
      addTextIssue(issues, finding.category, `${path}.category`);
      addEnumIssue(
        issues,
        finding.severity,
        REVIEW_FINDING_SEVERITIES,
        `${path}.severity`,
      );
      addTextIssue(issues, finding.message, `${path}.message`);
      if (typeof finding.resolved !== "boolean") {
        issues.push(`${path}.resolved must be a boolean`);
      }
    });
  }

  if (!Array.isArray(value.rightsChecks)) {
    issues.push("rightsChecks must be an array");
  } else {
    addUniqueObjectIdIssues(issues, value.rightsChecks, "rightsChecks");
    value.rightsChecks.forEach((check, index) => {
      const path = `rightsChecks[${index}]`;
      if (!isPlainObject(check)) {
        issues.push(`${path} must be an object`);
        return;
      }
      addTextIssue(issues, check.id, `${path}.id`);
      addTextIssue(issues, check.materialId, `${path}.materialId`);
      addEnumIssue(
        issues,
        check.status,
        ["cleared", "not_applicable", "blocked"],
        `${path}.status`,
      );
      addTextIssue(issues, check.note, `${path}.note`);
    });
  }

  const unresolved = (value.findings ?? []).filter(
    (finding) => isPlainObject(finding) && finding.resolved === false,
  );
  const unresolvedBlockers = unresolved.filter(
    (finding) => finding.severity === "blocker",
  );
  const blockedRights = (value.rightsChecks ?? []).filter(
    (check) => isPlainObject(check) && check.status === "blocked",
  );
  if (
    value.verdict === "pass" &&
    (unresolvedBlockers.length > 0 || blockedRights.length > 0)
  ) {
    issues.push("a passing manuscript audit cannot retain blockers or blocked rights");
  }
  if (
    ["revision_required", "fail"].includes(value.verdict) &&
    unresolved.length === 0 &&
    blockedRights.length === 0
  ) {
    issues.push(`${value.verdict} requires an unresolved finding or blocked right`);
  }
  if (value.verdict === "simulation_only" && unresolved.length === 0) {
    issues.push("simulation_only requires an unresolved authority-boundary finding");
  }

  return issues;
}

export function assertValidManuscriptAudit(value) {
  const issues = validateManuscriptAudit(value);
  if (issues.length > 0) {
    throw new ResearchArtifactContractError("INVALID_MANUSCRIPT_AUDIT", issues);
  }
  return value;
}

export function validateAuditedManuscript(value) {
  const issues = [];
  if (!isPlainObject(value)) return ["audited manuscript must be an object"];

  addVersionedArtifactHeaderIssues(issues, value);
  addTextIssue(issues, value.manuscriptDraftId, "manuscriptDraftId");
  addTextIssue(issues, value.manuscriptAuditId, "manuscriptAuditId");
  addTextIssue(issues, value.producerId, "producerId");
  addTextIssue(issues, value.auditorId, "auditorId");
  if (hasText(value.producerId) && value.producerId === value.auditorId) {
    issues.push("audited manuscript must retain an independent auditor");
  }
  const simulation = isSimulationAuthority(value.authority);
  if (simulation) {
    addAuthorityMetadataIssues(issues, value.authority);
    if (value.auditVerdict !== "simulation_only") {
      issues.push("simulation audited manuscript auditVerdict must equal simulation_only");
    }
  } else {
    if (value.authority !== undefined) {
      addAuthorityMetadataIssues(issues, value.authority);
    }
    if (value.auditVerdict !== "pass") {
      issues.push("auditVerdict must equal pass");
    }
  }
  addTextIssue(issues, value.title, "title");
  addTextIssue(issues, value.abstract, "abstract");
  addTextIssue(issues, value.conclusion, "conclusion");
  addStringArrayIssues(
    issues,
    value.acceptedClaimUnitIds,
    "acceptedClaimUnitIds",
    { allowEmpty: false },
  );
  addStringArrayIssues(
    issues,
    value.disclosedLimitations,
    "disclosedLimitations",
    { allowEmpty: false },
  );
  addSha256Issue(
    issues,
    value.draftAssemblyFingerprint,
    "draftAssemblyFingerprint",
  );
  addStringArrayIssues(issues, value.unresolvedIssueIds, "unresolvedIssueIds");
  if (
    !simulation &&
    Array.isArray(value.unresolvedIssueIds) &&
    value.unresolvedIssueIds.length > 0
  ) {
    issues.push("unresolvedIssueIds must be empty before a manuscript is audited");
  }
  addManuscriptSectionIssues(
    issues,
    value.sections,
    value.acceptedClaimUnitIds,
  );

  return issues;
}

export function assertValidAuditedManuscript(value) {
  const issues = validateAuditedManuscript(value);
  if (issues.length > 0) {
    throw new ResearchArtifactContractError("INVALID_AUDITED_MANUSCRIPT", issues);
  }
  return value;
}

export function validateDeliveryBundle(value) {
  const issues = [];
  if (!isPlainObject(value)) return ["delivery bundle must be an object"];

  addVersionedArtifactHeaderIssues(issues, value);
  addTextIssue(issues, value.auditedManuscriptId, "auditedManuscriptId");
  addTextIssue(issues, value.manuscriptAuditId, "manuscriptAuditId");
  addTextIssue(issues, value.preparedBy, "preparedBy");
  addStringArrayIssues(issues, value.limitations, "limitations", {
    allowEmpty: false,
  });
  const simulation = isSimulationAuthority(value.authority);
  if (simulation) {
    addAuthorityMetadataIssues(issues, value.authority);
    if (value.authorSignoffStatus !== "simulation_pending") {
      issues.push(
        "authorSignoffStatus must equal simulation_pending for simulation",
      );
    }
  } else {
    if (value.authority !== undefined) {
      addAuthorityMetadataIssues(issues, value.authority);
    }
    if (value.authorSignoffStatus !== "pending") {
      issues.push("authorSignoffStatus must equal pending");
    }
  }
  addSha256Issue(issues, value.manifestHash, "manifestHash");
  addTextIssue(issues, value.exportManifestId, "exportManifestId");
  addSha256Issue(
    issues,
    value.exportManifestFingerprint,
    "exportManifestFingerprint",
  );
  if (
    hasText(value.manifestHash) &&
    hasText(value.exportManifestFingerprint) &&
    value.manifestHash !== value.exportManifestFingerprint
  ) {
    issues.push("manifestHash must equal exportManifestFingerprint");
  }

  if (
    !Array.isArray(value.artifactFingerprints) ||
    value.artifactFingerprints.length === 0
  ) {
    issues.push("artifactFingerprints must be a non-empty array");
  } else {
    const artifactIds = new Set();
    const roles = new Set();
    const fingerprintsByRole = new Map();
    value.artifactFingerprints.forEach((fingerprint, index) => {
      const path = `artifactFingerprints[${index}]`;
      if (!isPlainObject(fingerprint)) {
        issues.push(`${path} must be an object`);
        return;
      }
      addTextIssue(issues, fingerprint.artifactId, `${path}.artifactId`);
      addTextIssue(issues, fingerprint.role, `${path}.role`);
      addPositiveIntegerIssue(issues, fingerprint.version, `${path}.version`);
      addSha256Issue(issues, fingerprint.contentHash, `${path}.contentHash`);
      if (hasText(fingerprint.artifactId) && artifactIds.has(fingerprint.artifactId)) {
        issues.push(`artifactFingerprints must not repeat ${fingerprint.artifactId}`);
      }
      artifactIds.add(fingerprint.artifactId);
      if (hasText(fingerprint.role)) {
        if (roles.has(fingerprint.role)) {
          issues.push(`artifactFingerprints must not repeat role ${fingerprint.role}`);
        }
        roles.add(fingerprint.role);
        fingerprintsByRole.set(fingerprint.role, fingerprint);
      }
    });
    if (!roles.has("audited_manuscript")) {
      issues.push("artifactFingerprints must include audited_manuscript");
    }
    if (!roles.has("manuscript_audit")) {
      issues.push("artifactFingerprints must include manuscript_audit");
    }
    if (
      fingerprintsByRole.get("audited_manuscript")?.artifactId !==
      value.auditedManuscriptId
    ) {
      issues.push(
        "the audited_manuscript fingerprint must match auditedManuscriptId",
      );
    }
    if (
      fingerprintsByRole.get("manuscript_audit")?.artifactId !==
      value.manuscriptAuditId
    ) {
      issues.push("the manuscript_audit fingerprint must match manuscriptAuditId");
    }
  }

  if (!Array.isArray(value.exports) || value.exports.length === 0) {
    issues.push("exports must be a non-empty array");
  } else {
    addUniqueObjectIdIssues(issues, value.exports, "exports");
    const fileNames = new Set();
    const formats = new Set();
    value.exports.forEach((file, index) => {
      const path = `exports[${index}]`;
      if (!isPlainObject(file)) {
        issues.push(`${path} must be an object`);
        return;
      }
      addTextIssue(issues, file.id, `${path}.id`);
      addEnumIssue(
        issues,
        file.format,
        DELIVERY_EXPORT_FORMATS,
        `${path}.format`,
      );
      addTextIssue(issues, file.fileName, `${path}.fileName`);
      addTextIssue(issues, file.mediaType, `${path}.mediaType`);
      addSha256Issue(issues, file.contentHash, `${path}.contentHash`);
      addPositiveIntegerIssue(issues, file.byteLength, `${path}.byteLength`);
      const requirement = DELIVERY_EXPORT_REQUIREMENTS[file.format];
      if (
        requirement &&
        hasText(file.fileName) &&
        !requirement.extensions.some((extension) =>
          file.fileName.toLowerCase().endsWith(extension),
        )
      ) {
        issues.push(
          `${path}.fileName must use ${requirement.extensions.join(" or ")} for ${file.format}`,
        );
      }
      if (
        requirement &&
        hasText(file.mediaType) &&
        !requirement.mediaTypes.includes(file.mediaType.toLowerCase())
      ) {
        issues.push(
          `${path}.mediaType must match ${file.format} (${requirement.mediaTypes.join(" or ")})`,
        );
      }
      if (hasText(file.fileName) && fileNames.has(file.fileName)) {
        issues.push(`exports must not repeat fileName ${file.fileName}`);
      }
      fileNames.add(file.fileName);
      if (DELIVERY_EXPORT_FORMATS.includes(file.format)) formats.add(file.format);
    });
    if (!["markdown", "docx", "pdf"].some((format) => formats.has(format))) {
      issues.push("exports must include a human-readable manuscript format");
    }
    if (!["json", "ro_crate"].some((format) => formats.has(format))) {
      issues.push("exports must include a machine-readable research format");
    }
  }

  return issues;
}

export function assertValidDeliveryBundle(value) {
  const issues = validateDeliveryBundle(value);
  if (issues.length > 0) {
    throw new ResearchArtifactContractError("INVALID_DELIVERY_BUNDLE", issues);
  }
  return value;
}

export function validateExportManifest(value) {
  const issues = [];
  try {
    verifyAuthoritativeExportManifest(value);
  } catch (error) {
    issues.push(error?.message ?? "export manifest is invalid");
  }
  if (value?.schemaVersion !== EXPORT_MANIFEST_SCHEMA_VERSION) {
    issues.push(`schemaVersion must equal ${EXPORT_MANIFEST_SCHEMA_VERSION}`);
  }
  const simulation = isSimulationAuthority(value?.authority);
  if (simulation) {
    addAuthorityMetadataIssues(issues, value.authority);
    if (value.status !== "simulation_pending_signoff") {
      issues.push("status must equal simulation_pending_signoff for simulation");
    }
  } else if (value?.authority !== undefined) {
    addAuthorityMetadataIssues(issues, value.authority);
  }
  return issues;
}

export function assertValidExportManifest(value) {
  const issues = validateExportManifest(value);
  if (issues.length > 0) {
    throw new ResearchArtifactContractError("INVALID_EXPORT_MANIFEST", issues);
  }
  return value;
}

function validateSignoffBinding(value, expectedSchemaVersion, kind) {
  const issues = [];
  if (!isPlainObject(value)) return [`${kind} must be an object`];
  if (value.schemaVersion !== expectedSchemaVersion) {
    issues.push(`schemaVersion must equal ${expectedSchemaVersion}`);
  }
  addTextIssue(issues, value.id, "id");
  addPositiveIntegerIssue(issues, value.version, "version");
  addTextIssue(issues, value.projectId, "projectId");
  addTextIssue(issues, value.gateId, "gateId");
  addSha256Issue(issues, value.gateFingerprint, "gateFingerprint");
  addTextIssue(issues, value.deliveryBundleId, "deliveryBundleId");
  addTextIssue(issues, value.exportManifestId, "exportManifestId");
  addPositiveIntegerIssue(issues, value.exportManifestVersion, "exportManifestVersion");
  addSha256Issue(issues, value.exportManifestContentHash, "exportManifestContentHash");
  addSha256Issue(issues, value.manifestFingerprint, "manifestFingerprint");
  addTextIssue(issues, value.reason, "reason");
  addHumanActorIssues(issues, value.signedBy, "signedBy");
  addStrictIsoTimestampIssue(issues, value.signedAt, "signedAt");
  return issues;
}

export function validateAuthorApproval(value) {
  const issues = validateSignoffBinding(
    value,
    AUTHOR_APPROVAL_SCHEMA_VERSION,
    "author approval",
  );
  addTextIssue(issues, value?.responsibilityStatement, "responsibilityStatement");
  if (value?.authority !== undefined) {
    addAuthorityMetadataIssues(issues, value.authority);
  }
  return issues;
}

export function assertValidAuthorApproval(value) {
  const issues = validateAuthorApproval(value);
  if (issues.length > 0) {
    throw new ResearchArtifactContractError("INVALID_AUTHOR_APPROVAL", issues);
  }
  return value;
}

export function validateSignedDelivery(value) {
  const issues = validateSignoffBinding(
    value,
    SIGNED_DELIVERY_SCHEMA_VERSION,
    "signed delivery",
  );
  addTextIssue(issues, value?.authorApprovalId, "authorApprovalId");
  const simulation = isSimulationAuthority(value?.authority);
  if (simulation) {
    addAuthorityMetadataIssues(issues, value.authority);
    if (value.status !== "simulation_signed") {
      issues.push("status must equal simulation_signed for simulation");
    }
  } else {
    if (value?.authority !== undefined) {
      addAuthorityMetadataIssues(issues, value.authority);
    }
    if (value?.status !== "signed") issues.push("status must equal signed");
  }
  return issues;
}

export function assertValidSignedDelivery(value) {
  const issues = validateSignedDelivery(value);
  if (issues.length > 0) {
    throw new ResearchArtifactContractError("INVALID_SIGNED_DELIVERY", issues);
  }
  return value;
}

export function validateEvidenceBriefBundle(value) {
  const issues = [];
  if (!isPlainObject(value)) return ["evidence brief bundle must be an object"];

  addSchemaVersionIssue(issues, value.schemaVersion);
  addTextIssue(issues, value.id, "id");
  addTextIssue(issues, value.researchQuestion, "researchQuestion");
  addTextIssue(issues, value.currentResearchPeriod, "currentResearchPeriod");
  if (/\bG[0-9]+\b/i.test(value.currentResearchPeriod ?? "")) {
    issues.push("currentResearchPeriod must use natural-language research wording");
  }
  addStringArrayIssues(issues, value.boundaries, "boundaries", {
    allowEmpty: false,
  });
  if (!isPlainObject(value.nextStepOrUserDecision)) {
    issues.push("nextStepOrUserDecision must be an object");
  } else {
    if (!["next_step", "human_decision"].includes(value.nextStepOrUserDecision.kind)) {
      issues.push("nextStepOrUserDecision.kind must be next_step or human_decision");
    }
    addTextIssue(
      issues,
      value.nextStepOrUserDecision.prompt,
      "nextStepOrUserDecision.prompt",
    );
  }

  if (!Array.isArray(value.evidenceExcerpts) || value.evidenceExcerpts.length === 0) {
    issues.push("evidenceExcerpts must be a non-empty array");
  }
  if (!Array.isArray(value.conclusionCards) || value.conclusionCards.length === 0) {
    issues.push("conclusionCards must be a non-empty array");
  }
  if (
    !Array.isArray(value.verificationReports) ||
    value.verificationReports.length === 0
  ) {
    issues.push("verificationReports must be a non-empty array");
  }

  const evidenceById = new Map();
  for (const evidence of value.evidenceExcerpts ?? []) {
    validateEvidenceExcerpt(evidence).forEach((issue) =>
      issues.push(`evidenceExcerpts.${evidence?.id ?? "unknown"}: ${issue}`),
    );
    if (hasText(evidence?.id) && evidenceById.has(evidence.id)) {
      issues.push(`duplicate evidence id: ${evidence.id}`);
    }
    if (hasText(evidence?.id)) evidenceById.set(evidence.id, evidence);
  }

  const conclusionIds = new Set();
  for (const card of value.conclusionCards ?? []) {
    validateResearchConclusionCard(card).forEach((issue) =>
      issues.push(`conclusionCards.${card?.id ?? "unknown"}: ${issue}`),
    );
    if (hasText(card?.id) && conclusionIds.has(card.id)) {
      issues.push(`duplicate conclusion card id: ${card.id}`);
    }
    if (hasText(card?.id)) conclusionIds.add(card.id);

    for (const evidenceId of card?.supportingEvidenceIds ?? []) {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) {
        issues.push(`conclusion ${card.id} references unknown supporting evidence ${evidenceId}`);
        continue;
      }
      if (!["supports", "partially_supports"].includes(evidence.relation)) {
        issues.push(`supporting evidence ${evidenceId} has incompatible relation ${evidence.relation}`);
      }
      if (evidence.claimId !== card.id) {
        issues.push(`evidence ${evidenceId} is linked to ${evidence.claimId}, not ${card.id}`);
      }
    }
    for (const evidenceId of card?.counterEvidenceIds ?? []) {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) {
        issues.push(`conclusion ${card.id} references unknown counterevidence ${evidenceId}`);
        continue;
      }
      if (evidence.relation !== "contradicts") {
        issues.push(`counterevidence ${evidenceId} must have relation contradicts`);
      }
      if (evidence.claimId !== card.id) {
        issues.push(`evidence ${evidenceId} is linked to ${evidence.claimId}, not ${card.id}`);
      }
    }
  }

  const verificationByConclusionId = new Map();
  for (const report of value.verificationReports ?? []) {
    validateEvidenceVerificationReport(report).forEach((issue) =>
      issues.push(`verificationReports.${report?.id ?? "unknown"}: ${issue}`),
    );
    for (const conclusionId of report?.conclusionCardIds ?? []) {
      if (!conclusionIds.has(conclusionId)) {
        issues.push(`verification report ${report.id} references unknown conclusion ${conclusionId}`);
        continue;
      }
      if (verificationByConclusionId.has(conclusionId)) {
        issues.push(`conclusion ${conclusionId} has more than one active verification report`);
      }
      verificationByConclusionId.set(conclusionId, report);
    }
  }
  for (const card of value.conclusionCards ?? []) {
    const report = verificationByConclusionId.get(card.id);
    if (!report) {
      issues.push(`conclusion ${card.id} lacks an independent verification report`);
      continue;
    }
    if (report.producerId !== card.producerId) {
      issues.push(`verification report ${report.id} does not identify conclusion producer ${card.producerId}`);
    }
    if (report.status !== "verified" || report.verdict === "fail") {
      issues.push(`conclusion ${card.id} is not eligible for a user brief`);
    }
  }

  if (value.decisionReceipt !== null && value.decisionReceipt !== undefined) {
    validateDecisionReceipt(value.decisionReceipt).forEach((issue) =>
      issues.push(`decisionReceipt: ${issue}`),
    );
  }

  return issues;
}

export function assertValidEvidenceBriefBundle(value) {
  const issues = validateEvidenceBriefBundle(value);
  if (issues.length > 0) {
    throw new ResearchArtifactContractError("INVALID_EVIDENCE_BRIEF_BUNDLE", issues);
  }
  return value;
}

const RESEARCH_ARTIFACT_CONTENT_VALIDATORS = Object.freeze({
  ...LITERATURE_LANDSCAPE_CONTENT_VALIDATORS,
  OrientationConceptMatrix: validateOrientationConceptMatrix,
  OrientationSearchProtocol: validateOrientationSearchProtocol,
  OrientationCalibrationReport: validateOrientationCalibrationReport,
  FrozenOrientationSearchProtocol: validateFrozenOrientationSearchProtocol,
  FocusedConceptMatrix: validateFocusedConceptMatrix,
  FocusedSearchProtocol: validateFocusedSearchProtocol,
  FocusedCalibrationReport: validateFocusedCalibrationReport,
  FrozenSearchProtocol: validateFrozenSearchProtocol,
  SearchRunSnapshot: validateLiveSearchRunSnapshot,
  FocusedSearchRunSnapshot: validateLiveSearchRunSnapshot,
  OrientationSourceSnapshot: validateLiveSourceSnapshot,
  SourceSnapshot: validateLiveSourceSnapshot,
  OrientationCorpusManifest: validateLiveCorpusManifest,
  LibraryManifest: validateLiveCorpusManifest,
  EvidenceRecord: validateEvidenceExcerpt,
  ResearchConclusionCard: validateResearchConclusionCard,
  EvidenceVerificationReport: validateEvidenceVerificationReport,
  EvidenceBriefBundle: validateEvidenceBriefBundle,
  EvidenceDrivenOutline: validateEvidenceDrivenOutline,
  OutlineStressTest: validateOutlineStressTest,
  FrozenWritingPlan: validateFrozenWritingPlan,
  ClaimUnitDraft: validateClaimUnitDraft,
  ClaimVerificationResult: validateClaimVerificationResult,
  AcceptedClaimUnit: validateAcceptedClaimUnit,
  ManuscriptDraft: validateManuscriptDraft,
  ManuscriptAudit: validateManuscriptAudit,
  AuditedManuscript: validateAuditedManuscript,
  DeliveryBundle: validateDeliveryBundle,
  ExportManifest: validateExportManifest,
  AuthorApproval: validateAuthorApproval,
  SignedDelivery: validateSignedDelivery,
});

export function researchArtifactContentNeedsValidation(artifactType) {
  return Object.hasOwn(RESEARCH_ARTIFACT_CONTENT_VALIDATORS, artifactType);
}

export function validateResearchArtifactContent(artifactType, content) {
  const validator = RESEARCH_ARTIFACT_CONTENT_VALIDATORS[artifactType];
  return validator ? validator(content) : [];
}
