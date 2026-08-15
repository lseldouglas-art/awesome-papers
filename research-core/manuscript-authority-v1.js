import { createHash } from "node:crypto";

export const MANUSCRIPT_ASSEMBLY_METHOD =
  "deterministic_accepted_claim_units_v1";

export class ManuscriptAuthorityError extends Error {
  constructor(code, issues) {
    super(`${code}: ${issues.join("; ")}`);
    this.name = "ManuscriptAuthorityError";
    this.code = code;
    this.issues = [...issues];
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableStringify(value) {
  if (value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : stableStringify(value))
    .digest("hex");
}

function equal(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function uniqueText(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

function artifactContentHash(artifact) {
  return artifact?.contentHash ?? sha256(artifact?.content);
}

function sentenceProjection(sentence) {
  return {
    id: sentence.id,
    text: sentence.text,
    kind: sentence.kind,
    textHash: sha256(sentence.text),
  };
}

function unitProjection(artifact) {
  return {
    artifactId: artifact.id,
    artifactVersion: artifact.version,
    contentHash: artifactContentHash(artifact),
    sentences: (artifact.content?.sentences ?? []).map(sentenceProjection),
  };
}

function unitText(artifact) {
  return (artifact.content?.sentences ?? [])
    .map((sentence) => sentence.text)
    .join(" ");
}

function assemblyCore({ acceptedClaimUnits, draftId }) {
  const acceptedUnitFingerprints = acceptedClaimUnits.map(unitProjection);
  const acceptedText = acceptedClaimUnits.map(unitText).join(" ");
  const sections = acceptedClaimUnits.map((artifact, index) => ({
    id: `${draftId}:accepted-claim:${index + 1}`,
    title: `已接受主张 ${index + 1}`,
    content: unitText(artifact),
    claimUnitIds: [artifact.id],
  }));
  return {
    acceptedClaimUnitIds: acceptedClaimUnits.map((artifact) => artifact.id),
    acceptedUnitFingerprints,
    acceptedText,
    sections,
    limitations: uniqueText(
      acceptedClaimUnits.flatMap((artifact) => artifact.content?.boundaries ?? []),
    ),
  };
}

function assemblyFingerprintPayload(content) {
  return {
    method: content.assembly?.method,
    acceptedUnitFingerprints: content.assembly?.acceptedUnitFingerprints,
    abstract: content.abstract,
    conclusion: content.conclusion,
    sections: content.sections,
    limitations: content.limitations,
  };
}

export function createDeterministicManuscriptDraft({
  id,
  version,
  writingPlanId,
  producerId,
  title,
  acceptedClaimUnits,
  schemaVersion = "1.0.0",
} = {}) {
  if (!Array.isArray(acceptedClaimUnits) || acceptedClaimUnits.length === 0) {
    throw new ManuscriptAuthorityError("ACCEPTED_CLAIM_UNITS_REQUIRED", [
      "at least one AcceptedClaimUnit is required for deterministic assembly",
    ]);
  }
  const core = assemblyCore({ acceptedClaimUnits, draftId: id });
  if (core.acceptedText.trim().length === 0) {
    throw new ManuscriptAuthorityError("ACCEPTED_CLAIM_TEXT_REQUIRED", [
      "accepted claim units contain no sentence text",
    ]);
  }
  const content = {
    schemaVersion,
    id,
    version,
    writingPlanId,
    producerId,
    title,
    abstract: core.acceptedText,
    conclusion: core.acceptedText,
    acceptedClaimUnitIds: core.acceptedClaimUnitIds,
    limitations:
      core.limitations.length > 0
        ? core.limitations
        : ["未登记额外边界；正式使用前必须由研究者复核。"],
    newFactualClaims: [],
    sections: core.sections,
    assembly: {
      method: MANUSCRIPT_ASSEMBLY_METHOD,
      acceptedUnitFingerprints: core.acceptedUnitFingerprints,
      fingerprint: null,
    },
  };
  content.assembly.fingerprint = sha256(assemblyFingerprintPayload(content));
  return content;
}

export function validateManuscriptAssemblyContent(content) {
  const issues = [];
  if (!isPlainObject(content?.assembly)) {
    return ["assembly must be an object"];
  }
  if (content.assembly.method !== MANUSCRIPT_ASSEMBLY_METHOD) {
    issues.push(`assembly.method must equal ${MANUSCRIPT_ASSEMBLY_METHOD}`);
  }
  if (
    !Array.isArray(content.assembly.acceptedUnitFingerprints) ||
    content.assembly.acceptedUnitFingerprints.length === 0
  ) {
    issues.push("assembly.acceptedUnitFingerprints must be a non-empty array");
  } else {
    const ids = [];
    for (const [index, item] of content.assembly.acceptedUnitFingerprints.entries()) {
      const path = `assembly.acceptedUnitFingerprints[${index}]`;
      if (!isPlainObject(item)) {
        issues.push(`${path} must be an object`);
        continue;
      }
      ids.push(item.artifactId);
      if (typeof item.artifactId !== "string" || !item.artifactId.trim()) {
        issues.push(`${path}.artifactId must be a non-empty string`);
      }
      if (!Number.isInteger(item.artifactVersion) || item.artifactVersion < 1) {
        issues.push(`${path}.artifactVersion must be a positive integer`);
      }
      if (!/^[a-f0-9]{64}$/i.test(item.contentHash ?? "")) {
        issues.push(`${path}.contentHash must be a SHA-256 hash`);
      }
      if (!Array.isArray(item.sentences) || item.sentences.length === 0) {
        issues.push(`${path}.sentences must be a non-empty array`);
      } else {
        for (const [sentenceIndex, sentence] of item.sentences.entries()) {
          const sentencePath = `${path}.sentences[${sentenceIndex}]`;
          if (sha256(sentence?.text ?? "") !== sentence?.textHash) {
            issues.push(`${sentencePath}.textHash must match exact sentence text`);
          }
        }
      }
    }
    if (!equal(ids, content.acceptedClaimUnitIds)) {
      issues.push(
        "assembly.acceptedUnitFingerprints ids must exactly equal acceptedClaimUnitIds",
      );
    }
  }
  const expectedFingerprint = sha256(assemblyFingerprintPayload(content));
  if (content.assembly.fingerprint !== expectedFingerprint) {
    issues.push("assembly.fingerprint must match exact manuscript assembly fields");
  }
  return issues;
}

export function validateManuscriptAuthorityChain({
  acceptedClaimUnits = null,
  manuscriptDraft,
  manuscriptAudit = null,
  auditedManuscript = null,
} = {}) {
  const issues = [];
  if (!isPlainObject(manuscriptDraft)) return ["manuscriptDraft must be an object"];
  issues.push(...validateManuscriptAssemblyContent(manuscriptDraft));

  if (Array.isArray(acceptedClaimUnits)) {
    const expected = createDeterministicManuscriptDraft({
      id: manuscriptDraft.id,
      version: manuscriptDraft.version,
      writingPlanId: manuscriptDraft.writingPlanId,
      producerId: manuscriptDraft.producerId,
      title: manuscriptDraft.title,
      acceptedClaimUnits,
      schemaVersion: manuscriptDraft.schemaVersion,
    });
    for (const field of [
      "abstract",
      "conclusion",
      "acceptedClaimUnitIds",
      "limitations",
      "newFactualClaims",
      "sections",
      "assembly",
    ]) {
      if (!equal(manuscriptDraft[field], expected[field])) {
        issues.push(`manuscriptDraft.${field} must be deterministically derived from AcceptedClaimUnit inputs`);
      }
    }
  }

  if (manuscriptAudit) {
    if (manuscriptAudit.manuscriptDraftId !== manuscriptDraft.id) {
      issues.push("manuscriptAudit.manuscriptDraftId must equal manuscriptDraft.id");
    }
    if (manuscriptAudit.manuscriptProducerId !== manuscriptDraft.producerId) {
      issues.push("manuscriptAudit.manuscriptProducerId must equal manuscriptDraft.producerId");
    }
    if (!equal(manuscriptAudit.checkedClaimUnitIds, manuscriptDraft.acceptedClaimUnitIds)) {
      issues.push("manuscriptAudit.checkedClaimUnitIds must exactly equal draft acceptedClaimUnitIds");
    }
    if (manuscriptAudit.draftAssemblyFingerprint !== manuscriptDraft.assembly?.fingerprint) {
      issues.push("manuscriptAudit.draftAssemblyFingerprint must equal draft assembly fingerprint");
    }
  }

  if (auditedManuscript) {
    if (!manuscriptAudit) {
      issues.push("manuscriptAudit is required when validating auditedManuscript");
    } else {
      if (auditedManuscript.manuscriptAuditId !== manuscriptAudit.id) {
        issues.push("auditedManuscript.manuscriptAuditId must equal manuscriptAudit.id");
      }
      if (auditedManuscript.auditorId !== manuscriptAudit.auditorId) {
        issues.push("auditedManuscript.auditorId must equal manuscriptAudit.auditorId");
      }
      if (auditedManuscript.auditVerdict !== manuscriptAudit.verdict) {
        issues.push("auditedManuscript.auditVerdict must equal manuscriptAudit.verdict");
      }
      if (!equal(auditedManuscript.disclosedLimitations, manuscriptAudit.disclosedLimitations)) {
        issues.push("auditedManuscript.disclosedLimitations must equal manuscriptAudit.disclosedLimitations");
      }
      const unresolvedFindingIds = (manuscriptAudit.findings ?? [])
        .filter((finding) => finding?.resolved === false)
        .map((finding) => finding.id);
      if (!equal(auditedManuscript.unresolvedIssueIds, unresolvedFindingIds)) {
        issues.push("auditedManuscript.unresolvedIssueIds must exactly equal unresolved audit findings");
      }
    }
    if (auditedManuscript.manuscriptDraftId !== manuscriptDraft.id) {
      issues.push("auditedManuscript.manuscriptDraftId must equal manuscriptDraft.id");
    }
    if (auditedManuscript.producerId !== manuscriptDraft.producerId) {
      issues.push("auditedManuscript.producerId must equal manuscriptDraft.producerId");
    }
    if (auditedManuscript.draftAssemblyFingerprint !== manuscriptDraft.assembly?.fingerprint) {
      issues.push("auditedManuscript.draftAssemblyFingerprint must equal draft assembly fingerprint");
    }
    for (const field of [
      "title",
      "abstract",
      "conclusion",
      "acceptedClaimUnitIds",
      "sections",
    ]) {
      if (!equal(auditedManuscript[field], manuscriptDraft[field])) {
        issues.push(`auditedManuscript.${field} must exactly equal manuscriptDraft.${field}`);
      }
    }
    const auditLimitations = manuscriptAudit?.disclosedLimitations ?? [];
    const draftLimitations = manuscriptDraft.limitations ?? [];
    if (
      draftLimitations.some((limitation) => !auditLimitations.includes(limitation))
    ) {
      issues.push(
        "manuscriptAudit.disclosedLimitations must preserve every draft limitation",
      );
    }
  }
  return issues;
}

export function assertValidManuscriptAuthorityChain(input) {
  const issues = validateManuscriptAuthorityChain(input);
  if (issues.length > 0) {
    throw new ManuscriptAuthorityError("INVALID_MANUSCRIPT_AUTHORITY_CHAIN", issues);
  }
  return input;
}
