import assert from "node:assert/strict";
import test from "node:test";

import {
  createModelInvocationReceipt,
  deriveProjectRuntimeProvenance,
} from "./agent-run-log-v1.js";
import {
  createAuthoritativeExportManifest,
  createAuthorSignoffContents,
} from "./export-authority-v1.js";
import { sha256 } from "./event-engine-v1.js";
import {
  evaluateResearchFormalAuthority,
  validateFinalLibraryAuthority,
} from "./research-formal-authority-v1.js";

const NOW = "2026-08-13T01:00:00.000Z";

function record() {
  const body = {
    id: "pubmed:123",
    sourceId: "pubmed:123",
    provider: "pubmed",
    pmid: "123",
    doi: null,
    title: "A bounded abstract",
    text: "A bounded abstract reports an association.",
    abstract: "A bounded abstract reports an association.",
    journal: "Journal",
    year: "2025",
    accessLevel: "abstract_only",
    locator: { pmid: "123", url: "https://pubmed.ncbi.nlm.nih.gov/123/" },
    limitations: ["当前仅访问 PubMed 题名与摘要。"],
  };
  const hashBody = {
    sourceId: body.sourceId,
    provider: body.provider,
    pmid: body.pmid,
    doi: body.doi,
    title: body.title,
    abstract: body.abstract,
    journal: body.journal,
    year: body.year,
    accessLevel: body.accessLevel,
    locator: body.locator,
  };
  return { ...body, sourceSnapshotHash: sha256(hashBody) };
}

function finalRun(projectId) {
  const source = record();
  const receiptBody = {
    provider: "pubmed",
    query: "sleep AND recovery",
    executedAt: NOW,
    fetchedAt: "2026-08-13T01:00:01.000Z",
    total: 1,
    resultIds: ["123"],
    records: [source],
    accessBoundary: "题名与摘要层级。",
  };
  return {
    schemaVersion: "research-retrieval-run/v1",
    purpose: "finalLibrary",
    nodeId: "freeze_library",
    protocolArtifactId: `artifact:${projectId}:frozen-search`,
    protocolContentHash: "a".repeat(64),
    queryId: "focused:core",
    query: receiptBody.query,
    queryHash: sha256(receiptBody.query),
    receipt: { ...receiptBody, receiptHash: sha256(receiptBody) },
  };
}

function liveProvenance(projectId) {
  const runtime = {
    mode: "live",
    provider: "openai",
    modelId: "gpt-5-mini",
    adapter: "PiRuntimeAdapterV1",
    piVersion: "0.84.1",
  };
  const workOrderId = "work-order-1";
  const runId = "run-1";
  const startedAt = NOW;
  const completedAt = "2026-08-13T01:00:02.000Z";
  const usage = { input: 10, output: 5, totalTokens: 15 };
  const receipt = createModelInvocationReceipt({
    projectId,
    workOrderId,
    runId,
    runtime,
    usage,
    stopReason: "stop",
    startedAt,
    completedAt,
  });
  return deriveProjectRuntimeProvenance({
    projectId,
    version: 1,
    lastEventHash: "e".repeat(64),
    runs: {
      [runId]: {
        id: runId,
        workOrderId,
        status: "completed",
        startedAt,
        finishedAt: completedAt,
        terminalPayload: {
          runtime,
          usage,
          stopReason: "stop",
          modelInvocationReceipt: receipt,
        },
      },
    },
  });
}

function signedArtifacts(project, libraryManifest) {
  const audited = {
    id: "audited-1",
    type: "AuditedManuscript",
    version: 1,
    contentHash: "b".repeat(64),
    content: {
      title: "Bounded review",
      abstract: "Bounded abstract.",
      conclusion: "Bounded conclusion.",
      sections: [],
      disclosedLimitations: ["Abstract only."],
    },
  };
  const delivery = {
    id: "delivery-1",
    type: "DeliveryBundle",
    version: 1,
    contentHash: "c".repeat(64),
    content: {},
  };
  const manifestContent = createAuthoritativeExportManifest({
    id: "export-manifest-1",
    version: 1,
    project,
    artifacts: [libraryManifest, audited],
    deliveryBundleId: delivery.id,
    generatedAt: NOW,
  });
  const manifest = {
    id: "export-manifest-1",
    type: "ExportManifest",
    version: 1,
    status: "accepted",
    freshness: "current",
    contentHash: sha256(manifestContent),
    content: manifestContent,
  };
  const signoff = createAuthorSignoffContents({
    manifestArtifact: manifest,
    deliveryBundleArtifact: delivery,
    humanActor: { id: "author", role: "author", kind: "human" },
    gate: { id: "gate-1", fingerprint: "d".repeat(64) },
    reason: "作者确认最终文献库与唯一导出字节。",
    decidedAt: "2026-08-13T02:00:00.000Z",
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
      contentHash: sha256(signoff.authorApproval),
      content: signoff.authorApproval,
    },
    {
      id: "signed-1",
      type: "SignedDelivery",
      version: 1,
      status: "accepted",
      freshness: "current",
      contentHash: sha256(signoff.signedDelivery),
      content: signoff.signedDelivery,
    },
  ];
}

function authorityFixture() {
  const projectId = "formal-authority-project";
  const run = finalRun(projectId);
  const project = {
    id: projectId,
    title: "Formal authority",
    question: "Does sleep affect recovery?",
    constraints: [],
    researchMode: "live_pubmed",
    sourceMaterials: run.receipt.records,
    retrievalRuns: { finalLibrary: run },
  };
  const manifestContent = {
    schemaVersion: "1.0.0",
    id: "library-manifest-1",
    version: 1,
    retrievalMode: "live_pubmed",
    provider: "pubmed",
    retrievalRunPurpose: "finalLibrary",
    protocolArtifactId: run.protocolArtifactId,
    protocolContentHash: run.protocolContentHash,
    queryId: run.queryId,
    query: run.query,
    queryHash: run.queryHash,
    retrievalReceiptHash: run.receipt.receiptHash,
    executedAt: run.receipt.executedAt,
    sourceCount: 1,
    sourceIds: ["pubmed:123"],
    accessCounts: { abstract_only: 1 },
    frozen: true,
  };
  const libraryManifest = {
    id: "library-manifest-1",
    type: "LibraryManifest",
    version: 1,
    freshness: "current",
    contentHash: sha256(manifestContent),
    content: manifestContent,
  };
  return {
    project,
    libraryManifest,
    artifacts: signedArtifacts(project, libraryManifest),
    runtimeProvenance: liveProvenance(projectId),
  };
}

test("formal authority requires the exact final-library run, manifest, live provenance, and signed bytes", () => {
  const fixture = authorityFixture();
  assert.deepEqual(
    validateFinalLibraryAuthority({
      project: fixture.project,
      artifacts: fixture.artifacts,
    }),
    [],
  );
  const result = evaluateResearchFormalAuthority({
    ...fixture,
    workflowComplete: true,
  });
  assert.equal(result.formalResearchComplete, true);
  assert.equal(result.code, "live_pubmed_audited_signed");
});

test("a pilot, legacy receipt, stale manifest, or drifted library manifest cannot become formal", () => {
  const fixture = authorityFixture();
  for (const mutate of [
    (copy) => {
      copy.project.retrievalRuns = { pilot: copy.project.retrievalRuns.finalLibrary };
    },
    (copy) => {
      copy.project.retrievalRuns = { legacyBootstrap: { receipt: copy.project.retrievalRuns.finalLibrary.receipt } };
    },
    (copy) => {
      copy.artifacts[0].freshness = "stale";
    },
    (copy) => {
      copy.artifacts[0].content.retrievalReceiptHash = "f".repeat(64);
      copy.artifacts[0].contentHash = sha256(copy.artifacts[0].content);
    },
  ]) {
    const copy = structuredClone(fixture);
    mutate(copy);
    const result = evaluateResearchFormalAuthority({
      ...copy,
      workflowComplete: true,
    });
    assert.equal(result.formalResearchComplete, false);
    assert.ok(result.issues.length > 0);
  }
});
