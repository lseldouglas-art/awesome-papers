import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PiRuntimeAdapter } from "./pi-runtime-adapter-v1.js";
import { ResearchAgentServiceV1 } from "./research-agent-service-v1.js";
import { ResearchToolGateway } from "./research-tool-gateway-v1.js";
import { REVIEW_RESEARCH_MACHINE_V1 } from "./review-research-machine-v1.js";
import {
  authoritativeExportFile,
  resolveSignedExportAuthority,
} from "./export-authority-v1.js";
import { sha256 } from "./event-engine-v1.js";

const ownerId = "full-flow-researcher";

function steadyClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 7, 12, 8, 0, tick++));
}

function serviceAt(dataDir, now = steadyClock()) {
  const fetchFn = async (url) => {
    const requestUrl = new URL(url);
    if (requestUrl.pathname.endsWith("/esearch.fcgi")) {
      return new Response(
        JSON.stringify({ esearchresult: { count: "1", idlist: ["12345678"] } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (requestUrl.pathname.endsWith("/efetch.fcgi")) {
      return new Response(
        [
          "<?xml version=\"1.0\"?><PubmedArticleSet><PubmedArticle><MedlineCitation>",
          "<PMID>12345678</PMID><Article><ArticleTitle>A bounded abstract for the complete flow</ArticleTitle>",
          "<Abstract><AbstractText>The abstract reports a limited association in the retrieved sample and does not establish causality.</AbstractText></Abstract>",
          "<Journal><Title>Fixture Journal</Title><JournalIssue><PubDate><Year>2026</Year></PubDate></JournalIssue></Journal>",
          "</Article></MedlineCitation></PubmedArticle></PubmedArticleSet>",
        ].join(""),
        { status: 200, headers: { "Content-Type": "application/xml" } },
      );
    }
    return new Response("not found", { status: 404 });
  };
  const toolGateway = new ResearchToolGateway({
    now,
    fetchFn,
    minIntervalMs: 0,
    retryCount: 0,
  });
  return new ResearchAgentServiceV1({
    dataDir,
    now,
    toolGateway,
    piRuntimeAdapter: new PiRuntimeAdapter({ gateway: toolGateway, forceMode: "guided" }),
  });
}

test("canonical guided Pi flow reaches audited delivery through every human boundary", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "research-agent-full-flow-"));
  const service = serviceAt(dataDir);
  const projectId = "full-evidence-to-audited-review";
  const question = "当前材料能支持怎样的有限研究判断？";
  const query = "bounded abstract AND complete flow";
  const previewBody = {
    schemaVersion: "research-query-preview-selection/v1",
    planHash: sha256({ question, query, candidateId: "complete-flow-preview" }),
    candidateId: "complete-flow-preview",
    candidateStatus: "ready",
    question,
    query,
    total: 1,
    executedAt: "2026-08-12T07:59:00.000Z",
    samples: [
      {
        sourceId: "pubmed:12345678",
        pmid: "12345678",
        title: "A bounded abstract for the complete flow",
        abstractSnippet: "A pre-registered title-and-abstract sentinel.",
        accessLevel: "abstract_only",
        locator: {
          pmid: "12345678",
          url: "https://pubmed.ncbi.nlm.nih.gov/12345678/",
        },
      },
    ],
    sampleSourceIds: ["pubmed:12345678"],
    subjectConcepts: [{
      conceptId: "subject:complete-flow",
      sourceTerm: "完整流程证据",
      role: "core_entity",
      mappedTerms: ["bounded abstract", "complete flow"],
      meshTerms: [],
    }],
  };
  await service.createProject({
    id: projectId,
    title: "证据到审计综述",
    question,
    completionProfileId: "audited_review",
    owner: { id: ownerId, role: "human_researcher", kind: "human" },
    constraints: ["摘要未报告的信息保持未知", "不形成个体临床建议"],
    researchMode: "live_pubmed",
    searchQuery: query,
    queryPreviewSelection: {
      ...previewBody,
      selectionHash: sha256(previewBody),
    },
    sourceMaterials: [],
  });

  const visitedHumanBoundaries = [];
  let result = null;
  for (let turn = 0; turn < 30; turn += 1) {
    result = await service.runUntilBoundary(projectId);
    const boundary = result.projection.boundary;
    if (boundary.type === "complete") break;
    assert.notEqual(boundary.type, "blocked", JSON.stringify(boundary));
    assert.notEqual(boundary.type, "cancelled", JSON.stringify(boundary));

    if (boundary.type === "human_gate") {
      const node = REVIEW_RESEARCH_MACHINE_V1.nodes.find(
        (candidate) => candidate.id === boundary.nodeId,
      );
      visitedHumanBoundaries.push(boundary.nodeId);
      result = await service.gateDecision({
        projectId,
        gateId: boundary.gateId,
        gateFingerprint: boundary.fingerprint,
        actor: {
          id: ownerId,
          role: node.approverRoles[0],
          kind: "human",
        },
        decision: "approved",
        reason: `研究者确认 ${node.userLabel} 的材料版本与边界。`,
      });
      continue;
    }

    if (boundary.type === "human_review") {
      visitedHumanBoundaries.push(`review:${boundary.nodeId}`);
      result = await service.manualReview({
        projectId,
        nodeId: boundary.nodeId,
        actor: { id: ownerId, role: boundary.reviewerRole, kind: "human" },
        decision: "accepted",
        reason: `研究者逐项核对 ${boundary.nodeId} 的候选产物并接受当前版本。`,
      });
      continue;
    }

    assert.fail(`Unexpected boundary: ${JSON.stringify(boundary)}`);
  }

  assert.equal(result?.projection.boundary.type, "complete");
  assert.deepEqual(
    [
      result.project.retrievalRuns.pilot,
      result.project.retrievalRuns.orientationCorpus,
      ...result.project.retrievalRuns.focusedCalibration,
      result.project.retrievalRuns.finalLibrary,
    ].map((run) => run.purpose),
    ["pilot", "orientationCorpus", "focusedCalibration", "focusedCalibration", "finalLibrary"],
  );
  assert.deepEqual(visitedHumanBoundaries, [
    "approve_scope",
    "approve_review_angle",
    "approve_evidence_boundary",
    "approve_outline",
    "approve_claim_units",
    "review:audit_manuscript",
    "review:prepare_delivery",
    "author_signoff",
  ]);

  const artifactTypes = new Set(result.artifacts.map((artifact) => artifact.type));
  for (const type of [
    "EvidenceRecord",
    "ResearchConclusionCard",
    "EvidenceVerificationReport",
    "EvidenceDrivenOutline",
    "FrozenWritingPlan",
    "ClaimUnitDraft",
    "ClaimVerificationResult",
    "AcceptedClaimUnit",
    "ManuscriptDraft",
    "ManuscriptAudit",
    "AuditedManuscript",
    "DeliveryBundle",
    "ExportManifest",
    "AuthorApproval",
    "SignedDelivery",
  ]) {
    assert.equal(artifactTypes.has(type), true, `missing ${type}`);
  }
  assert.ok(Object.keys(result.agentRunStatus.workOrders).length > 10);
  assert.ok(Object.keys(result.agentRunStatus.runs).length > 10);
  assert.ok(Object.keys(result.agentRunStatus.toolCalls).length > 10);
  const authority = resolveSignedExportAuthority(result.artifacts);
  const manifest = authority.manifestArtifact.content;
  assert.equal(authority.authorityClass, "simulation");
  assert.equal(authority.restrictedOnly, true);
  assert.equal(authority.signedArtifact.content.status, "simulation_signed");
  assert.equal(authority.signedArtifact.content.authority.authoritative, false);
  assert.equal(
    authority.approvalArtifact.content.authority.inheritance,
    "rebuild_in_live_run",
  );
  assert.match(
    authority.approvalArtifact.content.responsibilityStatement,
    /不确认科学审计通过/,
  );
  const audit = result.artifacts.find((artifact) => artifact.type === "ManuscriptAudit");
  const audited = result.artifacts.find(
    (artifact) => artifact.type === "AuditedManuscript",
  );
  const delivery = result.artifacts.find(
    (artifact) => artifact.type === "DeliveryBundle",
  );
  assert.equal(audit.content.verdict, "simulation_only");
  assert.equal(audited.content.auditVerdict, "simulation_only");
  assert.equal(delivery.content.authorSignoffStatus, "simulation_pending");
  assert.equal(authority.signedArtifact.content.manifestFingerprint, manifest.manifestFingerprint);
  for (const descriptor of manifest.files) {
    const file = authoritativeExportFile(manifest, descriptor.fileName);
    assert.equal(file.bytes.byteLength, descriptor.byteLength);
    assert.equal(file.sha256, descriptor.sha256);
  }

  const restarted = serviceAt(dataDir);
  const recovered = await restarted.getProject(projectId);
  assert.equal(recovered.projection.boundary.type, "complete");
  assert.deepEqual(
    recovered.artifacts.map((artifact) => artifact.contentHash),
    result.artifacts.map((artifact) => artifact.contentHash),
  );
  assert.equal(recovered.agentRunStatus.status, "completed");
});
