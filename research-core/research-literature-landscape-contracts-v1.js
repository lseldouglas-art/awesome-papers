export const LITERATURE_LANDSCAPE_SCHEMA_VERSION = "1.0.0";

export const LANDSCAPE_ARTIFACT_TYPES = Object.freeze([
  "LiteratureLandscape",
  "ClusterMap",
  "TagAssignment",
  "UnclassifiedBucket",
  "IdeaCandidate",
  "IdeaDecisionLedger",
]);

export const IDEA_CANDIDATE_STATUSES = Object.freeze([
  "unvalidated_hypothesis",
  "selected_for_recheck",
  "rejected",
  "deferred",
]);

const ACCESS_LEVELS = Object.freeze([
  "unknown",
  "title_only",
  "abstract_only",
  "full_text",
  "full_text_and_supplement",
]);

const DECISIONS = Object.freeze(["selected", "rejected", "deferred", "reopened"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function text(issues, value, path) {
  if (!hasText(value)) issues.push(`${path} must be a non-empty string`);
}

function integer(issues, value, path, { minimum = 0 } = {}) {
  if (!Number.isInteger(value) || value < minimum) {
    issues.push(`${path} must be an integer >= ${minimum}`);
  }
}

function numberRange(issues, value, path, minimum, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    issues.push(`${path} must be a finite number from ${minimum} to ${maximum}`);
  }
}

function sha256(issues, value, path) {
  if (!/^[a-f0-9]{64}$/i.test(value ?? "")) {
    issues.push(`${path} must be a SHA-256 hash`);
  }
}

function timestampOrNull(issues, value, path) {
  if (value !== null && (!hasText(value) || Number.isNaN(Date.parse(value)))) {
    issues.push(`${path} must be null or an ISO timestamp`);
  }
}

function actorOrNull(issues, value, path) {
  if (value === null || value === undefined) return;
  if (!isObject(value)) {
    issues.push(`${path} must be null or an actor object`);
    return;
  }
  text(issues, value.id, `${path}.id`);
  text(issues, value.role, `${path}.role`);
  if (!["human", "agent", "system"].includes(value.kind)) {
    issues.push(`${path}.kind must be human, agent, or system`);
  }
}

function stringArray(issues, value, path, { allowEmpty = true } = {}) {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return;
  }
  if (!allowEmpty && value.length === 0) issues.push(`${path} must not be empty`);
  value.forEach((item, index) => text(issues, item, `${path}[${index}]`));
  if (new Set(value).size !== value.length) issues.push(`${path} must not contain duplicates`);
}

function objectArray(issues, value, path, validator, { allowEmpty = true } = {}) {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return;
  }
  if (!allowEmpty && value.length === 0) issues.push(`${path} must not be empty`);
  value.forEach((item, index) => validator(issues, item, `${path}[${index}]`));
}

function header(issues, value, expectedType) {
  if (!isObject(value)) {
    issues.push(`${expectedType} must be an object`);
    return false;
  }
  if (value.schemaVersion !== LITERATURE_LANDSCAPE_SCHEMA_VERSION) {
    issues.push(`schemaVersion must equal ${LITERATURE_LANDSCAPE_SCHEMA_VERSION}`);
  }
  if (value.type !== expectedType) issues.push(`type must equal ${expectedType}`);
  text(issues, value.id, "id");
  text(issues, value.projectId, "projectId");
  integer(issues, value.version, "version", { minimum: 1 });
  timestampOrNull(issues, value.generatedAt, "generatedAt");
  return true;
}

function method(issues, value, path = "method") {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  if (value.kind !== "transparent_rule_based_heuristic") {
    issues.push(`${path}.kind must equal transparent_rule_based_heuristic`);
  }
  if (value.claimStatus !== "heuristic_only") {
    issues.push(`${path}.claimStatus must equal heuristic_only`);
  }
  text(issues, value.description, `${path}.description`);
  stringArray(issues, value.limitations, `${path}.limitations`, { allowEmpty: false });
}

function sourceRef(issues, value, path) {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  text(issues, value.sourceId, `${path}.sourceId`);
  text(issues, value.title, `${path}.title`);
  if (!ACCESS_LEVELS.includes(value.accessLevel)) {
    issues.push(`${path}.accessLevel must be one of ${ACCESS_LEVELS.join(", ")}`);
  }
  sha256(issues, value.sourceSnapshotHash, `${path}.sourceSnapshotHash`);
  if (!["provided", "derived_from_visible_fields"].includes(value.snapshotHashOrigin)) {
    issues.push(`${path}.snapshotHashOrigin must be provided or derived_from_visible_fields`);
  }
  if (!isObject(value.locator)) {
    issues.push(`${path}.locator must be an object`);
  } else if (!["pmid", "doi", "url", "repositoryId"].some((key) => hasText(value.locator[key]))) {
    issues.push(`${path}.locator must include pmid, doi, url, or repositoryId`);
  }
  stringArray(issues, value.evidenceRecordIds, `${path}.evidenceRecordIds`);
}

function uniqueIds(issues, values, path) {
  if (!Array.isArray(values)) return;
  const ids = values.map((value) => value?.id).filter(hasText);
  if (new Set(ids).size !== ids.length) issues.push(`${path} must not contain duplicate ids`);
}

function tagRef(issues, value, path) {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  text(issues, value.tagId, `${path}.tagId`);
  text(issues, value.label, `${path}.label`);
  text(issues, value.dimension, `${path}.dimension`);
  text(issues, value.ruleId, `${path}.ruleId`);
  stringArray(issues, value.matchedTerms, `${path}.matchedTerms`, { allowEmpty: false });
}

function controversy(issues, value, path) {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  text(issues, value.id, `${path}.id`);
  if (!["recorded_relation_conflict", "counterevidence_present"].includes(value.kind)) {
    issues.push(`${path}.kind must be recorded_relation_conflict or counterevidence_present`);
  }
  stringArray(issues, value.sourceIds, `${path}.sourceIds`, { allowEmpty: false });
  stringArray(issues, value.supportingEvidenceRecordIds, `${path}.supportingEvidenceRecordIds`);
  stringArray(issues, value.contradictingEvidenceRecordIds, `${path}.contradictingEvidenceRecordIds`, {
    allowEmpty: false,
  });
  text(issues, value.boundary, `${path}.boundary`);
}

export function validateLiteratureLandscape(value) {
  const issues = [];
  if (!header(issues, value, "LiteratureLandscape")) return issues;
  method(issues, value.method);
  sha256(issues, value.sourceSetHash, "sourceSetHash");
  integer(issues, value.sourceCount, "sourceCount");
  integer(issues, value.taggedSourceCount, "taggedSourceCount");
  integer(issues, value.unclassifiedSourceCount, "unclassifiedSourceCount");
  numberRange(issues, value.unclassifiedRate, "unclassifiedRate", 0, 1);
  objectArray(issues, value.sourceRefs, "sourceRefs", sourceRef);
  objectArray(issues, value.controversies, "controversies", controversy);
  stringArray(issues, value.tagAssignmentIds, "tagAssignmentIds");
  stringArray(issues, value.ideaCandidateIds, "ideaCandidateIds");
  text(issues, value.clusterMapId, "clusterMapId");
  text(issues, value.unclassifiedBucketId, "unclassifiedBucketId");
  text(issues, value.ideaDecisionLedgerId, "ideaDecisionLedgerId");
  text(issues, value.interpretationBoundary, "interpretationBoundary");
  if (!Array.isArray(value.revisionHistory)) {
    issues.push("revisionHistory must be an array");
  } else {
    value.revisionHistory.forEach((item, index) => {
      const path = `revisionHistory[${index}]`;
      if (!isObject(item)) {
        issues.push(`${path} must be an object`);
        return;
      }
      integer(issues, item.version, `${path}.version`, { minimum: 1 });
      sha256(issues, item.sourceSetHash, `${path}.sourceSetHash`);
      sha256(issues, item.tagAssignmentHash, `${path}.tagAssignmentHash`);
      numberRange(issues, item.unclassifiedRate, `${path}.unclassifiedRate`, 0, 1);
      stringArray(issues, item.candidateIds, `${path}.candidateIds`);
      timestampOrNull(issues, item.changedAt, `${path}.changedAt`);
      actorOrNull(issues, item.changedBy, `${path}.changedBy`);
      text(issues, item.reason, `${path}.reason`);
    });
  }
  if (
    Number.isInteger(value.sourceCount) &&
    Number.isInteger(value.taggedSourceCount) &&
    Number.isInteger(value.unclassifiedSourceCount) &&
    value.sourceCount !== value.taggedSourceCount + value.unclassifiedSourceCount
  ) {
    issues.push("sourceCount must equal taggedSourceCount + unclassifiedSourceCount");
  }
  if (Array.isArray(value.sourceRefs) && value.sourceRefs.length !== value.sourceCount) {
    issues.push("sourceRefs.length must equal sourceCount");
  }
  return issues;
}

export function validateClusterMap(value) {
  const issues = [];
  if (!header(issues, value, "ClusterMap")) return issues;
  method(issues, value.method);
  if (value.mapKind !== "overlapping_rule_groups") {
    issues.push("mapKind must equal overlapping_rule_groups");
  }
  if (!Array.isArray(value.clusters)) {
    issues.push("clusters must be an array");
  } else {
    uniqueIds(issues, value.clusters, "clusters");
    value.clusters.forEach((cluster, index) => {
      const path = `clusters[${index}]`;
      if (!isObject(cluster)) {
        issues.push(`${path} must be an object`);
        return;
      }
      text(issues, cluster.id, `${path}.id`);
      text(issues, cluster.tagId, `${path}.tagId`);
      text(issues, cluster.label, `${path}.label`);
      text(issues, cluster.dimension, `${path}.dimension`);
      integer(issues, cluster.sourceCount, `${path}.sourceCount`, { minimum: 1 });
      stringArray(issues, cluster.sourceIds, `${path}.sourceIds`, { allowEmpty: false });
      objectArray(issues, cluster.sourceRefs, `${path}.sourceRefs`, sourceRef, { allowEmpty: false });
      stringArray(issues, cluster.matchedTerms, `${path}.matchedTerms`, { allowEmpty: false });
      stringArray(issues, cluster.controversyIds, `${path}.controversyIds`);
      text(issues, cluster.interpretationBoundary, `${path}.interpretationBoundary`);
      if (Array.isArray(cluster.sourceIds) && cluster.sourceIds.length !== cluster.sourceCount) {
        issues.push(`${path}.sourceIds.length must equal sourceCount`);
      }
    });
  }
  return issues;
}

export function validateTagAssignment(value) {
  const issues = [];
  if (!header(issues, value, "TagAssignment")) return issues;
  method(issues, value.method);
  sourceRef(issues, value.sourceRef, "sourceRef");
  if (isObject(value.sourceRef) && value.sourceId !== value.sourceRef.sourceId) {
    issues.push("sourceId must equal sourceRef.sourceId");
  }
  text(issues, value.sourceId, "sourceId");
  objectArray(issues, value.tags, "tags", tagRef, { allowEmpty: false });
  uniqueIds(
    issues,
    Array.isArray(value.tags) ? value.tags.map((item) => ({ id: item.tagId })) : value.tags,
    "tags",
  );
  text(issues, value.assignmentBoundary, "assignmentBoundary");
  return issues;
}

export function validateUnclassifiedBucket(value) {
  const issues = [];
  if (!header(issues, value, "UnclassifiedBucket")) return issues;
  method(issues, value.method);
  integer(issues, value.totalSourceCount, "totalSourceCount");
  integer(issues, value.sourceCount, "sourceCount");
  numberRange(issues, value.rate, "rate", 0, 1);
  stringArray(issues, value.sourceIds, "sourceIds");
  objectArray(issues, value.sourceRefs, "sourceRefs", sourceRef);
  if (Array.isArray(value.sourceIds) && value.sourceIds.length !== value.sourceCount) {
    issues.push("sourceIds.length must equal sourceCount");
  }
  if (Array.isArray(value.sourceRefs) && value.sourceRefs.length !== value.sourceCount) {
    issues.push("sourceRefs.length must equal sourceCount");
  }
  if (
    Number.isInteger(value.totalSourceCount) &&
    value.totalSourceCount > 0 &&
    typeof value.rate === "number" &&
    Math.abs(value.rate - value.sourceCount / value.totalSourceCount) > 1e-12
  ) {
    issues.push("rate must equal sourceCount / totalSourceCount");
  }
  if (value.totalSourceCount === 0 && value.rate !== 0) {
    issues.push("rate must equal 0 when totalSourceCount is 0");
  }
  objectArray(issues, value.reasons, "reasons", (target, item, path) => {
    if (!isObject(item)) {
      target.push(`${path} must be an object`);
      return;
    }
    text(target, item.sourceId, `${path}.sourceId`);
    text(target, item.reason, `${path}.reason`);
  });
  text(issues, value.nextAction, "nextAction");
  return issues;
}

export function validateIdeaCandidate(value) {
  const issues = [];
  if (!header(issues, value, "IdeaCandidate")) return issues;
  method(issues, value.method);
  if (!IDEA_CANDIDATE_STATUSES.includes(value.status)) {
    issues.push(`status must be one of ${IDEA_CANDIDATE_STATUSES.join(", ")}`);
  }
  if (!isObject(value.anchor)) {
    issues.push("anchor must be an object");
  } else {
    text(issues, value.anchor.tagId, "anchor.tagId");
    text(issues, value.anchor.label, "anchor.label");
    stringArray(issues, value.anchor.sourceIds, "anchor.sourceIds", { allowEmpty: false });
  }
  if (!Array.isArray(value.componentPool) || value.componentPool.length === 0) {
    issues.push("componentPool must be a non-empty array");
  } else {
    value.componentPool.forEach((item, index) => {
      const path = `componentPool[${index}]`;
      if (!isObject(item)) {
        issues.push(`${path} must be an object`);
        return;
      }
      text(issues, item.kind, `${path}.kind`);
      text(issues, item.value, `${path}.value`);
      stringArray(issues, item.sourceIds, `${path}.sourceIds`, { allowEmpty: false });
    });
  }
  text(issues, value.relationshipRationale, "relationshipRationale");
  if (!isObject(value.targetScale)) {
    issues.push("targetScale must be an object");
  } else {
    text(issues, value.targetScale.kind, "targetScale.kind");
    text(issues, value.targetScale.description, "targetScale.description");
  }
  if (value.rejectionReason !== null && !hasText(value.rejectionReason)) {
    issues.push("rejectionReason must be null or a non-empty string");
  }
  if (value.status === "rejected" && !hasText(value.rejectionReason)) {
    issues.push("rejected candidates require rejectionReason");
  }
  text(issues, value.recheckQuery, "recheckQuery");
  objectArray(issues, value.sourceRefs, "sourceRefs", sourceRef, { allowEmpty: false });
  stringArray(issues, value.evidenceRecordIds, "evidenceRecordIds");
  stringArray(issues, value.tagIds, "tagIds", { allowEmpty: false });
  text(issues, value.validationBoundary, "validationBoundary");
  return issues;
}

export function validateIdeaDecisionLedger(value) {
  const issues = [];
  if (!header(issues, value, "IdeaDecisionLedger")) return issues;
  stringArray(issues, value.candidateIds, "candidateIds");
  stringArray(issues, value.pendingCandidateIds, "pendingCandidateIds");
  if (!Array.isArray(value.entries)) {
    issues.push("entries must be an array");
  } else {
    uniqueIds(issues, value.entries, "entries");
    value.entries.forEach((entry, index) => {
      const path = `entries[${index}]`;
      if (!isObject(entry)) {
        issues.push(`${path} must be an object`);
        return;
      }
      text(issues, entry.id, `${path}.id`);
      text(issues, entry.candidateId, `${path}.candidateId`);
      if (!DECISIONS.includes(entry.decision)) {
        issues.push(`${path}.decision must be one of ${DECISIONS.join(", ")}`);
      }
      text(issues, entry.reason, `${path}.reason`);
      if (!isObject(entry.decidedBy)) {
        issues.push(`${path}.decidedBy must be an object`);
      } else {
        text(issues, entry.decidedBy.id, `${path}.decidedBy.id`);
        text(issues, entry.decidedBy.role, `${path}.decidedBy.role`);
        if (entry.decidedBy.kind !== "human") {
          issues.push(`${path}.decidedBy.kind must equal human`);
        }
      }
      if (!hasText(entry.decidedAt) || Number.isNaN(Date.parse(entry.decidedAt))) {
        issues.push(`${path}.decidedAt must be an ISO timestamp`);
      }
      stringArray(issues, entry.sourceIds, `${path}.sourceIds`, { allowEmpty: false });
    });
  }
  text(issues, value.decisionBoundary, "decisionBoundary");
  return issues;
}

export const LITERATURE_LANDSCAPE_CONTENT_VALIDATORS = Object.freeze({
  LiteratureLandscape: validateLiteratureLandscape,
  ClusterMap: validateClusterMap,
  TagAssignment: validateTagAssignment,
  UnclassifiedBucket: validateUnclassifiedBucket,
  IdeaCandidate: validateIdeaCandidate,
  IdeaDecisionLedger: validateIdeaDecisionLedger,
});

export function validateLiteratureLandscapeContent(type, value) {
  const validator = LITERATURE_LANDSCAPE_CONTENT_VALIDATORS[type];
  return validator ? validator(value) : [];
}

export class LiteratureLandscapeContractError extends Error {
  constructor(type, issues) {
    super(`${type} contract violation: ${issues.join("; ")}`);
    this.name = "LiteratureLandscapeContractError";
    this.code = "INVALID_LITERATURE_LANDSCAPE_ARTIFACT";
    this.artifactType = type;
    this.issues = [...issues];
  }
}

export function assertValidLiteratureLandscapeContent(type, value) {
  const issues = validateLiteratureLandscapeContent(type, value);
  if (issues.length > 0) throw new LiteratureLandscapeContractError(type, issues);
  return value;
}

export function validateLiteratureLandscapeBuild(value) {
  const issues = [];
  if (!isObject(value)) return ["literature landscape build must be an object"];
  const singular = [
    ["LiteratureLandscape", value.literatureLandscape],
    ["ClusterMap", value.clusterMap],
    ["UnclassifiedBucket", value.unclassifiedBucket],
    ["IdeaDecisionLedger", value.ideaDecisionLedger],
  ];
  singular.forEach(([type, content]) => {
    validateLiteratureLandscapeContent(type, content).forEach((issue) =>
      issues.push(`${type}: ${issue}`),
    );
  });
  const arrays = [
    ["TagAssignment", value.tagAssignments],
    ["IdeaCandidate", value.ideaCandidates],
  ];
  arrays.forEach(([type, contents]) => {
    if (!Array.isArray(contents)) {
      issues.push(`${type} collection must be an array`);
      return;
    }
    contents.forEach((content, index) => {
      validateLiteratureLandscapeContent(type, content).forEach((issue) =>
        issues.push(`${type}[${index}]: ${issue}`),
      );
    });
  });

  const candidates = value.ideaCandidates ?? [];
  const assignments = value.tagAssignments ?? [];
  const candidateIds = new Set(candidates.map((item) => item.id));
  const assignmentIds = new Set(assignments.map((item) => item.id));
  const landscapeSourceIds = new Set(
    (value.literatureLandscape?.sourceRefs ?? []).map((item) => item.sourceId),
  );
  if (candidateIds.size !== candidates.length) issues.push("IdeaCandidate collection must not contain duplicate ids");
  if (assignmentIds.size !== assignments.length) issues.push("TagAssignment collection must not contain duplicate ids");
  const landscape = value.literatureLandscape;
  for (const id of landscape?.ideaCandidateIds ?? []) {
    if (!candidateIds.has(id)) issues.push(`LiteratureLandscape references unknown candidate ${id}`);
  }
  for (const id of landscape?.tagAssignmentIds ?? []) {
    if (!assignmentIds.has(id)) issues.push(`LiteratureLandscape references unknown assignment ${id}`);
  }
  if (landscape?.clusterMapId !== value.clusterMap?.id) {
    issues.push("LiteratureLandscape.clusterMapId must reference clusterMap.id");
  }
  if (landscape?.unclassifiedBucketId !== value.unclassifiedBucket?.id) {
    issues.push("LiteratureLandscape.unclassifiedBucketId must reference unclassifiedBucket.id");
  }
  if (landscape?.ideaDecisionLedgerId !== value.ideaDecisionLedger?.id) {
    issues.push("LiteratureLandscape.ideaDecisionLedgerId must reference ideaDecisionLedger.id");
  }
  for (const id of value.ideaDecisionLedger?.candidateIds ?? []) {
    if (!candidateIds.has(id)) issues.push(`IdeaDecisionLedger references unknown candidate ${id}`);
  }
  const ledgerCandidateIds = new Set(value.ideaDecisionLedger?.candidateIds ?? []);
  for (const id of candidateIds) {
    if (!ledgerCandidateIds.has(id)) issues.push(`IdeaDecisionLedger omits candidate ${id}`);
  }
  const assignmentBySourceId = new Map(assignments.map((item) => [item.sourceId, item]));
  for (const sourceId of value.unclassifiedBucket?.sourceIds ?? []) {
    if (assignmentBySourceId.has(sourceId)) {
      issues.push(`source ${sourceId} cannot be both classified and unclassified`);
    }
    if (!landscapeSourceIds.has(sourceId)) {
      issues.push(`UnclassifiedBucket references unknown source ${sourceId}`);
    }
  }
  for (const assignment of assignments) {
    if (!landscapeSourceIds.has(assignment.sourceId)) {
      issues.push(`TagAssignment references unknown source ${assignment.sourceId}`);
    }
  }
  for (const candidate of candidates) {
    const candidateSourceIds = new Set((candidate.sourceRefs ?? []).map((ref) => ref.sourceId));
    for (const sourceId of candidate.anchor?.sourceIds ?? []) {
      if (!candidateSourceIds.has(sourceId)) {
        issues.push(`IdeaCandidate ${candidate.id} anchor references a source absent from sourceRefs: ${sourceId}`);
      }
    }
    for (const component of candidate.componentPool ?? []) {
      for (const sourceId of component.sourceIds ?? []) {
        if (!candidateSourceIds.has(sourceId)) {
          issues.push(`IdeaCandidate ${candidate.id} component references a source absent from sourceRefs: ${sourceId}`);
        }
      }
    }
    for (const sourceId of candidateSourceIds) {
      if (!landscapeSourceIds.has(sourceId)) {
        issues.push(`IdeaCandidate ${candidate.id} references unknown source ${sourceId}`);
      }
    }
  }
  for (const entry of value.ideaDecisionLedger?.entries ?? []) {
    const candidate = candidates.find((item) => item.id === entry.candidateId);
    if (!candidate) {
      issues.push(`IdeaDecisionLedger entry ${entry.id} references unknown candidate ${entry.candidateId}`);
      continue;
    }
    const candidateSourceIds = new Set((candidate.sourceRefs ?? []).map((ref) => ref.sourceId));
    for (const sourceId of entry.sourceIds ?? []) {
      if (!candidateSourceIds.has(sourceId)) {
        issues.push(`IdeaDecisionLedger entry ${entry.id} references a source outside candidate ${entry.candidateId}: ${sourceId}`);
      }
    }
  }
  return issues;
}

export function assertValidLiteratureLandscapeBuild(value) {
  const issues = validateLiteratureLandscapeBuild(value);
  if (issues.length > 0) throw new LiteratureLandscapeContractError("LandscapeBuild", issues);
  return value;
}
