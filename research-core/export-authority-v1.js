import { createHash } from "node:crypto";

import {
  buildResearchBundle,
  manuscriptToMarkdown,
  projectSourcesToBibtex,
} from "./research-artifact-presentation-v1.js";

export const EXPORT_MANIFEST_SCHEMA_VERSION = "research.export-manifest/v1";
export const AUTHOR_APPROVAL_SCHEMA_VERSION = "research.author-approval/v1";
export const SIGNED_DELIVERY_SCHEMA_VERSION = "research.signed-delivery/v1";

export class ExportAuthorityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ExportAuthorityError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new ExportAuthorityError(code, message, details);
}

function sha256Bytes(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  return createHash("sha256").update(bytes).digest("hex");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Artifact content hashes use the same canonical JSON representation as the
// event engine. Keep this local to avoid an export-authority -> event-engine ->
// artifact-contracts -> export-authority module cycle.
function stableStringify(value) {
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

function artifactContentHash(content) {
  return sha256Bytes(typeof content === "string" ? content : stableStringify(content));
}

function assertCurrentAcceptedAuthorityArtifact(artifact, type) {
  if (
    artifact?.type !== type ||
    artifact.freshness !== "current" ||
    artifact.status !== "accepted"
  ) {
    fail(
      "SIGNED_EXPORT_ARTIFACT_NOT_CURRENT_ACCEPTED",
      `${type} must be both current and accepted before it can carry signed export authority.`,
      {
        artifactId: artifact?.id ?? null,
        artifactType: artifact?.type ?? null,
        freshness: artifact?.freshness ?? null,
        status: artifact?.status ?? null,
      },
    );
  }
  const computedContentHash = artifactContentHash(artifact.content);
  if (
    typeof artifact.contentHash !== "string" ||
    artifact.contentHash !== computedContentHash
  ) {
    fail(
      "SIGNED_EXPORT_ARTIFACT_CONTENT_HASH_MISMATCH",
      `${type} content does not match its persisted contentHash.`,
      {
        artifactId: artifact.id,
        artifactType: type,
        expectedContentHash: artifact.contentHash ?? null,
        computedContentHash,
      },
    );
  }
  return artifact;
}

function isStrictIsoTimestamp(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    !Number.isNaN(Date.parse(value))
  );
}

function assertValidSignoffIdentity(artifact, schemaVersion) {
  const content = artifact.content ?? {};
  const actor = content.signedBy;
  if (
    content.schemaVersion !== schemaVersion ||
    content.id !== artifact.id ||
    content.version !== artifact.version ||
    !actor ||
    actor.kind !== "human" ||
    typeof actor.id !== "string" ||
    actor.id.trim().length === 0 ||
    typeof actor.role !== "string" ||
    actor.role.trim().length === 0 ||
    !isStrictIsoTimestamp(content.signedAt)
  ) {
    fail(
      "SIGNED_EXPORT_SIGNOFF_INVALID",
      `${artifact.type} has an invalid signer identity, signing time, schema, or artifact identity.`,
      { artifactId: artifact.id, artifactType: artifact.type },
    );
  }
}

function sameValue(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function canonicalFinalLibraryAuthority(value = {}) {
  return {
    retrievalRunPurpose: value.retrievalRunPurpose,
    protocolArtifactId: value.protocolArtifactId,
    protocolContentHash: value.protocolContentHash,
    queryId: value.queryId,
    queryHash: value.queryHash,
    retrievalReceiptHash: value.retrievalReceiptHash,
    libraryManifestId: value.libraryManifestId,
    libraryManifestVersion: value.libraryManifestVersion,
    libraryManifestContentHash: value.libraryManifestContentHash,
    sourceCount: value.sourceCount,
    sourceIds: value.sourceIds,
  };
}

function canonicalManifestFingerprint(manifest) {
  return sha256Bytes(
    JSON.stringify({
      schemaVersion: manifest.schemaVersion,
      projectId: manifest.projectId,
      deliveryBundleId: manifest.deliveryBundleId,
      generatedAt: manifest.generatedAt,
      finalLibraryAuthority: canonicalFinalLibraryAuthority(
        manifest.finalLibraryAuthority,
      ),
      files: manifest.files.map(
        ({ id, role, format, fileName, mediaType, byteLength, sha256 }) => ({
          id,
          role,
          format,
          fileName,
          mediaType,
          byteLength,
          sha256,
        }),
      ),
    }),
  );
}

function encodedFile({ id, role, format, fileName, mediaType, body }) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
  return {
    id,
    role,
    format,
    fileName,
    mediaType,
    byteLength: bytes.byteLength,
    sha256: sha256Bytes(bytes),
    encoding: "base64",
    contentBase64: bytes.toString("base64"),
  };
}

function latest(artifacts, type) {
  return (artifacts ?? []).filter((artifact) => artifact.type === type).at(-1) ?? null;
}

function latestCurrent(artifacts, type) {
  return (artifacts ?? [])
    .filter(
      (artifact) =>
        artifact.type === type &&
        artifact.freshness !== "stale" &&
        !["rejected", "superseded"].includes(artifact.status),
    )
    .at(-1) ?? null;
}

function finalLibraryAuthorityBinding(project, artifacts) {
  const run = project?.retrievalRuns?.finalLibrary;
  const libraryManifest = latestCurrent(artifacts, "LibraryManifest");
  if (!run || run.purpose !== "finalLibrary" || run.nodeId !== "freeze_library") {
    fail(
      "FINAL_LIBRARY_AUTHORITY_MISSING",
      "A finalLibrary retrieval run is required before export bytes can be frozen.",
    );
  }
  if (!libraryManifest?.content || !libraryManifest.contentHash) {
    fail(
      "FINAL_LIBRARY_MANIFEST_MISSING",
      "A current LibraryManifest is required before export bytes can be frozen.",
    );
  }
  const content = libraryManifest.content;
  const receipt = run.receipt ?? {};
  const sourceIds = Array.isArray(receipt.records)
    ? receipt.records.map((record) => record?.sourceId ?? record?.id ?? null)
    : [];
  const exactBindings = [
    [content.retrievalRunPurpose, "finalLibrary"],
    [content.protocolArtifactId, run.protocolArtifactId],
    [content.protocolContentHash, run.protocolContentHash],
    [content.queryId, run.queryId],
    [content.query, run.query],
    [content.queryHash, run.queryHash],
    [content.retrievalReceiptHash, receipt.receiptHash],
    [content.sourceCount, sourceIds.length],
  ];
  const sourcesMatch =
    Array.isArray(content.sourceIds) &&
    content.sourceIds.length === sourceIds.length &&
    content.sourceIds.every((sourceId, index) => sourceId === sourceIds[index]);
  if (exactBindings.some(([actual, expected]) => actual !== expected) || !sourcesMatch) {
    fail(
      "FINAL_LIBRARY_BINDING_MISMATCH",
      "LibraryManifest does not bind the exact finalLibrary retrieval run.",
    );
  }
  return {
    retrievalRunPurpose: "finalLibrary",
    protocolArtifactId: run.protocolArtifactId,
    protocolContentHash: run.protocolContentHash,
    queryId: run.queryId,
    queryHash: run.queryHash,
    retrievalReceiptHash: receipt.receiptHash,
    libraryManifestId: libraryManifest.id,
    libraryManifestVersion: libraryManifest.version,
    libraryManifestContentHash: libraryManifest.contentHash,
    sourceCount: sourceIds.length,
    sourceIds,
  };
}

/**
 * Creates the sole authoritative download manifest. The exact UTF-8 bytes are
 * embedded in the immutable manifest, so serving never needs to re-render a
 * manuscript, bundle, or bibliography after author sign-off.
 */
export function createAuthoritativeExportManifest({
  id,
  version,
  project,
  artifacts,
  deliveryBundleId,
  generatedAt,
  runtimeProvenance = null,
} = {}) {
  const finalLibraryAuthority = finalLibraryAuthorityBinding(project, artifacts);
  const audited = latest(artifacts, "AuditedManuscript");
  if (!audited) fail("AUDITED_MANUSCRIPT_MISSING", "An audited manuscript is required.");
  const files = [
    encodedFile({
      id: `${id}:markdown`,
      role: "formal_manuscript",
      format: "markdown",
      fileName: "audited-manuscript.md",
      mediaType: "text/markdown",
      body: manuscriptToMarkdown(audited.content),
    }),
    encodedFile({
      id: `${id}:restricted-markdown`,
      role: "restricted_manuscript",
      format: "markdown",
      fileName: "restricted-draft.md",
      mediaType: "text/markdown",
      body:
        "> 受限草稿：只有逐项目实时模型证明完整时，正式 Markdown 才可作为签署研究稿；本文件始终保留受限标识。\n\n" +
        manuscriptToMarkdown(audited.content),
    }),
  ];
  const bibliography = projectSourcesToBibtex(project);
  if (bibliography) {
    files.push(
      encodedFile({
        id: `${id}:bibtex`,
        role: "references",
        format: "bibtex",
        fileName: "references.bib",
        mediaType: "application/x-bibtex",
        body: bibliography,
      }),
    );
  }
  const bundle = {
    ...buildResearchBundle({
      project,
      artifacts,
      contentMaturity: {
        code: "audited_pending_author_signoff",
        label: "经审计、待作者签署",
        formalResearchComplete: false,
      },
      runtimeProvenance,
    }),
    deliveryAuthority: {
      deliveryBundleId,
      exportManifestId: id,
      authorSignoffStatus: "pending_at_manifest_freeze",
    },
  };
  files.push(
    encodedFile({
      id: `${id}:json`,
      role: "machine_readable_research_bundle",
      format: "json",
      fileName: "research-bundle.json",
      mediaType: "application/json",
      body: `${JSON.stringify(bundle, null, 2)}\n`,
    }),
  );
  const manifest = {
    schemaVersion: EXPORT_MANIFEST_SCHEMA_VERSION,
    id,
    version,
    projectId: project.id,
    deliveryBundleId,
    finalLibraryAuthority,
    generatedAt,
    status: "pending_author_signoff",
    files,
  };
  return { ...manifest, manifestFingerprint: canonicalManifestFingerprint(manifest) };
}

export function verifyAuthoritativeExportManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== EXPORT_MANIFEST_SCHEMA_VERSION) {
    fail("INVALID_EXPORT_MANIFEST", "Export manifest schema is invalid.");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    fail("INVALID_EXPORT_MANIFEST", "Export manifest must contain files.");
  }
  const finalLibrary = manifest.finalLibraryAuthority;
  if (
    !finalLibrary ||
    finalLibrary.retrievalRunPurpose !== "finalLibrary" ||
    !finalLibrary.protocolArtifactId ||
    !/^[a-f0-9]{64}$/i.test(finalLibrary.protocolContentHash ?? "") ||
    !finalLibrary.queryId ||
    !/^[a-f0-9]{64}$/i.test(finalLibrary.queryHash ?? "") ||
    !/^[a-f0-9]{64}$/i.test(finalLibrary.retrievalReceiptHash ?? "") ||
    !finalLibrary.libraryManifestId ||
    !Number.isInteger(finalLibrary.libraryManifestVersion) ||
    finalLibrary.libraryManifestVersion < 1 ||
    !/^[a-f0-9]{64}$/i.test(finalLibrary.libraryManifestContentHash ?? "") ||
    !Number.isInteger(finalLibrary.sourceCount) ||
    finalLibrary.sourceCount < 1 ||
    !Array.isArray(finalLibrary.sourceIds) ||
    finalLibrary.sourceIds.length !== finalLibrary.sourceCount
  ) {
    fail("INVALID_EXPORT_MANIFEST", "Export manifest lacks a valid final-library authority binding.");
  }
  const ids = new Set();
  const names = new Set();
  for (const file of manifest.files) {
    if (!file?.id || ids.has(file.id) || !file?.fileName || names.has(file.fileName)) {
      fail("INVALID_EXPORT_MANIFEST", "Export file ids and names must be unique.");
    }
    ids.add(file.id);
    names.add(file.fileName);
    if (file.encoding !== "base64" || typeof file.contentBase64 !== "string") {
      fail("INVALID_EXPORT_MANIFEST", `Export ${file.id} has no embedded base64 bytes.`);
    }
    const bytes = Buffer.from(file.contentBase64, "base64");
    if (bytes.toString("base64") !== file.contentBase64) {
      fail("EXPORT_BYTES_INVALID", `Export ${file.id} is not canonical base64.`);
    }
    if (bytes.byteLength !== file.byteLength || sha256Bytes(bytes) !== file.sha256) {
      fail("EXPORT_BYTES_MISMATCH", `Export ${file.id} does not match its hash and size.`);
    }
  }
  if (canonicalManifestFingerprint(manifest) !== manifest.manifestFingerprint) {
    fail("EXPORT_MANIFEST_FINGERPRINT_MISMATCH", "Export manifest fingerprint is invalid.");
  }
  return manifest;
}

export function authoritativeExportFile(manifest, fileName) {
  verifyAuthoritativeExportManifest(manifest);
  const file = manifest.files.find((candidate) => candidate.fileName === fileName);
  if (!file) fail("EXPORT_FILE_NOT_FOUND", `The signed manifest has no ${fileName}.`);
  return { ...file, bytes: Buffer.from(file.contentBase64, "base64") };
}

export function createAuthorSignoffContents({
  manifestArtifact,
  deliveryBundleArtifact,
  humanActor,
  gate,
  reason,
  decidedAt,
  authorApprovalId,
  signedDeliveryId,
  version = 1,
} = {}) {
  verifyAuthoritativeExportManifest(manifestArtifact?.content);
  const manifestBinding = {
    exportManifestId: manifestArtifact.id,
    exportManifestVersion: manifestArtifact.version,
    exportManifestContentHash: manifestArtifact.contentHash,
    manifestFingerprint: manifestArtifact.content.manifestFingerprint,
  };
  const common = {
    projectId: manifestArtifact.content.projectId,
    gateId: gate.id,
    gateFingerprint: gate.fingerprint,
    deliveryBundleId: deliveryBundleArtifact.id,
    ...manifestBinding,
    reason,
    signedBy: humanActor,
    signedAt: decidedAt,
  };
  return {
    authorApproval: {
      schemaVersion: AUTHOR_APPROVAL_SCHEMA_VERSION,
      id: authorApprovalId,
      version,
      ...common,
      responsibilityStatement:
        "作者确认下载字节、研究边界、署名责任和未决限制，并对这一唯一版本负责。",
    },
    signedDelivery: {
      schemaVersion: SIGNED_DELIVERY_SCHEMA_VERSION,
      id: signedDeliveryId,
      version,
      ...common,
      authorApprovalId,
      status: "signed",
      authority: {
        class: "authoritative",
        authoritative: true,
        finality: "authoritative",
        runtimeMode: "live",
        inheritance: "final",
      },
    },
  };
}

export function resolveSignedExportAuthority(artifacts = []) {
  const manifestArtifact = latest(artifacts, "ExportManifest");
  const approvalArtifact = latest(artifacts, "AuthorApproval");
  const signedArtifact = latest(artifacts, "SignedDelivery");
  if (!manifestArtifact || !approvalArtifact || !signedArtifact) {
    fail("EXPORT_NOT_SIGNED", "No complete signed export authority exists.");
  }
  assertCurrentAcceptedAuthorityArtifact(manifestArtifact, "ExportManifest");
  assertCurrentAcceptedAuthorityArtifact(approvalArtifact, "AuthorApproval");
  assertCurrentAcceptedAuthorityArtifact(signedArtifact, "SignedDelivery");
  assertValidSignoffIdentity(approvalArtifact, AUTHOR_APPROVAL_SCHEMA_VERSION);
  assertValidSignoffIdentity(signedArtifact, SIGNED_DELIVERY_SCHEMA_VERSION);
  verifyAuthoritativeExportManifest(manifestArtifact.content);
  const libraryManifest = latestCurrent(artifacts, "LibraryManifest");
  const libraryBinding = manifestArtifact.content.finalLibraryAuthority;
  if (
    !libraryManifest ||
    libraryBinding.libraryManifestId !== libraryManifest.id ||
    libraryBinding.libraryManifestVersion !== libraryManifest.version ||
    libraryBinding.libraryManifestContentHash !== libraryManifest.contentHash
  ) {
    fail(
      "SIGNED_EXPORT_LIBRARY_BINDING_MISMATCH",
      "Signed export bytes do not bind the current LibraryManifest.",
    );
  }
  for (const artifact of [approvalArtifact, signedArtifact]) {
    const content = artifact.content ?? {};
    if (
      content.exportManifestId !== manifestArtifact.id ||
      content.exportManifestVersion !== manifestArtifact.version ||
      content.exportManifestContentHash !== manifestArtifact.contentHash ||
      content.manifestFingerprint !== manifestArtifact.content.manifestFingerprint
    ) {
      fail("SIGNED_EXPORT_BINDING_MISMATCH", `${artifact.type} does not bind the current export manifest.`);
    }
  }
  const approval = approvalArtifact.content;
  const signed = signedArtifact.content;
  const commonSignoffFields = [
    "projectId",
    "gateId",
    "gateFingerprint",
    "deliveryBundleId",
    "exportManifestId",
    "exportManifestVersion",
    "exportManifestContentHash",
    "manifestFingerprint",
    "reason",
    "signedBy",
    "signedAt",
  ];
  const divergentField = commonSignoffFields.find(
    (field) => !sameValue(approval[field], signed[field]),
  );
  if (
    divergentField ||
    approval.projectId !== manifestArtifact.content.projectId ||
    approval.deliveryBundleId !== manifestArtifact.content.deliveryBundleId
  ) {
    fail(
      "SIGNED_EXPORT_BINDING_MISMATCH",
      divergentField
        ? `AuthorApproval and SignedDelivery diverge at ${divergentField}.`
        : "Author sign-off does not bind the export manifest project and delivery bundle.",
      { divergentField: divergentField ?? null },
    );
  }
  const status = signedArtifact.content.status;
  const authority = signedArtifact.content.authority ?? null;
  const authoritative =
    status === "signed" &&
    (authority === null ||
      (authority.class === "authoritative" &&
        authority.authoritative === true &&
        authority.finality === "authoritative" &&
        authority.runtimeMode === "live" &&
        authority.inheritance === "final"));
  const simulation =
    status === "simulation_signed" &&
    authority?.class === "simulation" &&
    authority.authoritative === false &&
    authority.finality === "non_authoritative" &&
    authority.runtimeMode === "guided" &&
    authority.inheritance === "rebuild_in_live_run";
  if (
    signedArtifact.content.authorApprovalId !== approvalArtifact.id ||
    (!authoritative && !simulation)
  ) {
    fail("SIGNED_EXPORT_BINDING_MISMATCH", "Signed delivery does not bind author approval.");
  }
  return {
    manifestArtifact,
    approvalArtifact,
    signedArtifact,
    authorityClass: simulation ? "simulation" : "authoritative",
    restrictedOnly: simulation,
  };
}

export function publicExportManifest(manifest) {
  verifyAuthoritativeExportManifest(manifest);
  return {
    schemaVersion: manifest.schemaVersion,
    id: manifest.id,
    version: manifest.version,
    projectId: manifest.projectId,
    deliveryBundleId: manifest.deliveryBundleId,
    generatedAt: manifest.generatedAt,
    status: manifest.status,
    manifestFingerprint: manifest.manifestFingerprint,
    files: manifest.files.map(
      ({ id, role, format, fileName, mediaType, byteLength, sha256 }) => ({
        id,
        role,
        format,
        fileName,
        mediaType,
        byteLength,
        sha256,
        contentHash: sha256,
      }),
    ),
  };
}
