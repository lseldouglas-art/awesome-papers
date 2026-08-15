import assert from "node:assert/strict";
import test from "node:test";

import { sha256 } from "./event-engine-v1.js";
import {
  authoritativeExportFile,
  createAuthoritativeExportManifest,
  createAuthorSignoffContents,
  publicExportManifest,
  resolveSignedExportAuthority,
  verifyAuthoritativeExportManifest,
} from "./export-authority-v1.js";

const finalRecord = {
  id: "source-1",
  sourceId: "source-1",
  provider: "pubmed",
  pmid: "12345678",
  title: "Traceable source",
  accessLevel: "abstract_only",
  locator: { pmid: "12345678" },
};
const finalRun = {
  purpose: "finalLibrary",
  nodeId: "freeze_library",
  protocolArtifactId: "frozen-search-1",
  protocolContentHash: "f".repeat(64),
  queryId: "focused:core",
  query: "traceable source",
  queryHash: sha256("traceable source"),
  receipt: {
    receiptHash: "e".repeat(64),
    records: [finalRecord],
  },
};
const libraryManifest = {
  id: "library-manifest-1",
  type: "LibraryManifest",
  version: 1,
  freshness: "current",
  contentHash: "d".repeat(64),
  content: {
    retrievalRunPurpose: "finalLibrary",
    protocolArtifactId: finalRun.protocolArtifactId,
    protocolContentHash: finalRun.protocolContentHash,
    queryId: finalRun.queryId,
    query: finalRun.query,
    queryHash: finalRun.queryHash,
    retrievalReceiptHash: finalRun.receipt.receiptHash,
    sourceCount: 1,
    sourceIds: [finalRecord.sourceId],
  },
};
const project = {
  id: "export-authority-test",
  title: "唯一导出权威链",
  question: "作者究竟签署了哪些字节？",
  constraints: ["不补写未知信息"],
  sourceMaterials: [finalRecord],
  retrievalRuns: { finalLibrary: finalRun },
};

const audited = {
  id: "audited-1",
  type: "AuditedManuscript",
  version: 1,
  contentHash: "a".repeat(64),
  producedAt: "2026-08-13T01:00:00.000Z",
  content: {
    title: "审计正文",
    abstract: "摘要。",
    sections: [{ title: "结果", content: "受限结果。" }],
    conclusion: "有限结论。",
    disclosedLimitations: ["只访问摘要。"],
  },
};

function authorityArtifacts() {
  const delivery = {
    id: "delivery-1",
    type: "DeliveryBundle",
    version: 1,
    contentHash: "b".repeat(64),
    content: {},
  };
  const manifestContent = createAuthoritativeExportManifest({
    id: "manifest-1",
    version: 1,
    project,
    artifacts: [libraryManifest, audited],
    deliveryBundleId: delivery.id,
    generatedAt: "2026-08-13T02:00:00.000Z",
  });
  const manifest = {
    id: "manifest-1",
    type: "ExportManifest",
    version: 1,
    status: "accepted",
    freshness: "current",
    contentHash: sha256(manifestContent),
    content: manifestContent,
  };
  const gate = { id: "gate-1", fingerprint: "c".repeat(64) };
  const contents = createAuthorSignoffContents({
    manifestArtifact: manifest,
    deliveryBundleArtifact: delivery,
    humanActor: { id: "author-1", role: "author", kind: "human" },
    gate,
    reason: "作者逐文件核对并签署当前唯一版本。",
    decidedAt: "2026-08-13T03:00:00.000Z",
    authorApprovalId: "approval-1",
    signedDeliveryId: "signed-1",
  });
  return [
    libraryManifest,
    audited,
    delivery,
    manifest,
    {
      id: "approval-1",
      type: "AuthorApproval",
      version: 1,
      status: "accepted",
      freshness: "current",
      contentHash: sha256(contents.authorApproval),
      content: contents.authorApproval,
    },
    {
      id: "signed-1",
      type: "SignedDelivery",
      version: 1,
      status: "accepted",
      freshness: "current",
      contentHash: sha256(contents.signedDelivery),
      content: contents.signedDelivery,
    },
  ];
}

test("manifest persists exact Markdown, JSON, and BibTeX bytes with strict hashes and sizes", () => {
  const { manifestArtifact } = resolveSignedExportAuthority(authorityArtifacts());
  assert.deepEqual(
    manifestArtifact.content.files.map((file) => file.format).sort(),
    ["bibtex", "json", "markdown", "markdown"],
  );
  for (const descriptor of publicExportManifest(manifestArtifact.content).files) {
    const file = authoritativeExportFile(manifestArtifact.content, descriptor.fileName);
    assert.equal(file.bytes.byteLength, descriptor.byteLength);
    assert.equal(file.sha256, descriptor.sha256);
  }
});

test("content-level tampering and signoff rebinding fail closed", () => {
  const artifacts = authorityArtifacts();
  const manifest = artifacts.find((artifact) => artifact.type === "ExportManifest");
  manifest.content.files[0].contentBase64 = Buffer.from("tampered", "utf8").toString("base64");
  assert.throws(
    () => verifyAuthoritativeExportManifest(manifest.content),
    (error) => error.code === "EXPORT_BYTES_MISMATCH",
  );

  const rebound = authorityArtifacts();
  const reboundSigned = rebound.find((artifact) => artifact.type === "SignedDelivery");
  reboundSigned.content.exportManifestContentHash = "d".repeat(64);
  reboundSigned.contentHash = sha256(reboundSigned.content);
  assert.throws(
    () => resolveSignedExportAuthority(rebound),
    (error) => error.code === "SIGNED_EXPORT_BINDING_MISMATCH",
  );
});

test("final-library authority is part of the manifest fingerprint and cannot be rewritten", () => {
  const artifacts = authorityArtifacts();
  const manifest = artifacts.find((artifact) => artifact.type === "ExportManifest");
  manifest.content.finalLibraryAuthority.retrievalReceiptHash = "0".repeat(64);
  assert.throws(
    () => verifyAuthoritativeExportManifest(manifest.content),
    (error) => error.code === "EXPORT_MANIFEST_FINGERPRINT_MISMATCH",
  );
});

test("a newly current LibraryManifest invalidates previously signed export bytes", () => {
  const artifacts = authorityArtifacts();
  artifacts.push({
    ...libraryManifest,
    id: "library-manifest-2",
    version: 2,
    contentHash: "0".repeat(64),
  });
  assert.throws(
    () => resolveSignedExportAuthority(artifacts),
    (error) => error.code === "SIGNED_EXPORT_LIBRARY_BINDING_MISMATCH",
  );
});

test("export bytes cannot be frozen without an exact final library and current manifest", () => {
  assert.throws(
    () =>
      createAuthoritativeExportManifest({
        id: "manifest-without-library",
        version: 1,
        project: { ...project, retrievalRuns: {} },
        artifacts: [audited],
        deliveryBundleId: "delivery-1",
        generatedAt: "2026-08-13T02:00:00.000Z",
      }),
    (error) => error.code === "FINAL_LIBRARY_AUTHORITY_MISSING",
  );
});

test("an authority marker cannot disguise live signed bytes as simulation", () => {
  const artifacts = authorityArtifacts();
  const signed = artifacts.find((artifact) => artifact.type === "SignedDelivery");
  signed.content.authority = {
    class: "simulation",
    authoritative: false,
    finality: "non_authoritative",
    runtimeMode: "guided",
    inheritance: "rebuild_in_live_run",
  };
  signed.contentHash = sha256(signed.content);
  assert.throws(
    () => resolveSignedExportAuthority(artifacts),
    (error) => error.code === "SIGNED_EXPORT_BINDING_MISMATCH",
  );
});

test("unsigned manifest is never a signed export authority", () => {
  const artifacts = authorityArtifacts().filter(
    (artifact) => artifact.type !== "SignedDelivery",
  );
  assert.throws(
    () => resolveSignedExportAuthority(artifacts),
    (error) => error.code === "EXPORT_NOT_SIGNED",
  );
});

test("a guided simulation signoff resolves only as restricted authority", () => {
  const artifacts = authorityArtifacts();
  const signed = artifacts.find((artifact) => artifact.type === "SignedDelivery");
  signed.content.status = "simulation_signed";
  signed.content.authority = {
    class: "simulation",
    authoritative: false,
    finality: "non_authoritative",
    runtimeMode: "guided",
    inheritance: "rebuild_in_live_run",
  };
  signed.contentHash = sha256(signed.content);
  const authority = resolveSignedExportAuthority(artifacts);
  assert.equal(authority.authorityClass, "simulation");
  assert.equal(authority.restrictedOnly, true);
});

test("signed export authority rejects stale, superseded, rejected, or metadata-free authority artifacts", () => {
  const cases = [
    { type: "ExportManifest", field: "freshness", value: "stale" },
    { type: "AuthorApproval", field: "status", value: "superseded" },
    { type: "SignedDelivery", field: "status", value: "rejected" },
    { type: "ExportManifest", field: "freshness", value: undefined },
    { type: "AuthorApproval", field: "status", value: undefined },
  ];
  for (const invalid of cases) {
    const artifacts = authorityArtifacts();
    const artifact = artifacts.find((candidate) => candidate.type === invalid.type);
    if (invalid.value === undefined) delete artifact[invalid.field];
    else artifact[invalid.field] = invalid.value;
    assert.throws(
      () => resolveSignedExportAuthority(artifacts),
      (error) =>
        error.code === "SIGNED_EXPORT_ARTIFACT_NOT_CURRENT_ACCEPTED" &&
        error.details.artifactType === invalid.type,
      `${invalid.type}.${invalid.field}=${String(invalid.value)} must fail closed`,
    );
  }
});

test("all three authority artifacts must match sha256(content)", () => {
  for (const type of ["ExportManifest", "AuthorApproval", "SignedDelivery"]) {
    const artifacts = authorityArtifacts();
    const artifact = artifacts.find((candidate) => candidate.type === type);
    artifact.content = { ...artifact.content, unpersistedMutation: type };
    assert.throws(
      () => resolveSignedExportAuthority(artifacts),
      (error) =>
        error.code === "SIGNED_EXPORT_ARTIFACT_CONTENT_HASH_MISMATCH" &&
        error.details.artifactType === type,
      `${type} must fail when content and contentHash diverge`,
    );
  }
});

test("forged signer kind or signing time cannot become export authority even with recomputed hashes", () => {
  const forgeries = [
    (content) => ({
      ...content,
      signedBy: { id: "agent:forged", role: "author", kind: "agent" },
    }),
    (content) => ({ ...content, signedAt: "not-an-iso-timestamp" }),
  ];
  for (const forge of forgeries) {
    const artifacts = authorityArtifacts();
    for (const type of ["AuthorApproval", "SignedDelivery"]) {
      const artifact = artifacts.find((candidate) => candidate.type === type);
      artifact.content = forge(artifact.content);
      artifact.contentHash = sha256(artifact.content);
    }
    assert.throws(
      () => resolveSignedExportAuthority(artifacts),
      (error) => error.code === "SIGNED_EXPORT_SIGNOFF_INVALID",
    );
  }
});

test("AuthorApproval and SignedDelivery must agree on every common signoff field", () => {
  const divergentValues = {
    projectId: "other-project",
    gateId: "other-gate",
    gateFingerprint: "0".repeat(64),
    deliveryBundleId: "other-delivery",
    exportManifestId: "other-manifest",
    exportManifestVersion: 2,
    exportManifestContentHash: "1".repeat(64),
    manifestFingerprint: "2".repeat(64),
    reason: "A different signoff reason.",
    signedBy: { id: "author-2", role: "author", kind: "human" },
    signedAt: "2026-08-13T03:01:00.000Z",
  };
  for (const [field, value] of Object.entries(divergentValues)) {
    const artifacts = authorityArtifacts();
    const signed = artifacts.find((artifact) => artifact.type === "SignedDelivery");
    signed.content = { ...signed.content, [field]: value };
    signed.contentHash = sha256(signed.content);
    assert.throws(
      () => resolveSignedExportAuthority(artifacts),
      (error) => error.code === "SIGNED_EXPORT_BINDING_MISMATCH",
      `${field} divergence must fail closed`,
    );
  }
});
