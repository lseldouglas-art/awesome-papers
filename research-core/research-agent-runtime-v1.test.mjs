import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { validateResearchArtifactContent } from "./artifact-contracts-v1.js";
import { ContentAddressedArtifactStore } from "./content-addressed-artifact-store-v1.js";
import { sha256 } from "./event-engine-v1.js";
import {
  PiRuntimeAdapter,
  createPiContextRuntime,
} from "./pi-runtime-adapter-v1.js";
import {
  buildWorkOrder,
  createGateDecisionArtifacts,
  createGuidedCandidates,
  createGuidedReviewCandidate,
} from "./research-agent-work-order-v1.js";
import { enforceCitationVerification } from "./citation-verification-v1.js";
import { ResearchToolGateway } from "./research-tool-gateway-v1.js";
import { REVIEW_RESEARCH_MACHINE_V1 } from "./review-research-machine-v1.js";

const project = {
  id: "project-agent-test",
  title: "可核查综述",
  question: "当前材料能够支持怎样的有限结论？",
  completionProfileId: "audited_review",
  researchOwnerId: "researcher-local",
  constraints: ["摘要未报告的信息保持未知"],
  sourceMaterials: [
    {
      id: "source-1",
      title: "A bounded abstract",
      text: "The retrieved abstract reports a partial association within a limited sample.",
      accessLevel: "abstract_only",
      sourceSnapshotHash: "a".repeat(64),
      locator: { pmid: "12345678" },
      limitations: ["Only the abstract was available."],
    },
  ],
};

function node(nodeId) {
  return REVIEW_RESEARCH_MACHINE_V1.nodes.find((item) => item.id === nodeId);
}

function artifact(type, id, content, version = 1) {
  return {
    id,
    type,
    version,
    lineageId: `lineage:${id}`,
    content,
    contentHash: sha256(content),
    status: "accepted",
  };
}

function orderFor(nodeId, inputArtifacts = [], projectOverride = project) {
  const state = { revision: 0, artifacts: {} };
  return buildWorkOrder({
    machine: REVIEW_RESEARCH_MACHINE_V1,
    state,
    node: node(nodeId),
    project: projectOverride,
    inputArtifacts,
    runtimeMode: "guided",
    createdAt: "2026-08-12T00:00:00.000Z",
  });
}

function guidedArtifacts(nodeId, inputArtifacts = [], projectOverride = project) {
  const order = orderFor(nodeId, inputArtifacts, projectOverride);
  return createGuidedCandidates(order).map((candidate) =>
    artifact(candidate.type, candidate.artifactId, candidate.content),
  );
}

function assertContracts(artifacts) {
  for (const item of artifacts) {
    assert.deepEqual(
      validateResearchArtifactContent(item.type, item.content),
      [],
      `${item.type} should satisfy its registered scientific contract`,
    );
  }
}

test("search-method candidates use only pre-registered preview sentinels", () => {
  const previewSourceId = "pubmed:12345678";
  const searchProject = {
    ...project,
    researchMode: "live_pubmed",
    searchQuery: "fatigue AND acupuncture",
    retrievalRuns: {
      previewSelection: {
        schemaVersion: "research-query-preview-selection/v1",
        candidateStatus: "ready",
        samples: [{ sourceId: previewSourceId }],
        sampleSourceIds: [previewSourceId],
      },
    },
  };
  const workOrder = buildWorkOrder({
    machine: REVIEW_RESEARCH_MACHINE_V1,
    state: { revision: 0, artifacts: {} },
    node: node("design_orientation_search"),
    project: searchProject,
    inputArtifacts: [],
    runtimeMode: "guided",
    createdAt: "2026-08-12T00:00:00.000Z",
  });
  const matrix = createGuidedCandidates(workOrder).find(
    (candidate) => candidate.type === "OrientationConceptMatrix",
  );
  assert.deepEqual(matrix.content.sentinelSourceIds, [previewSourceId]);
  assert.equal(
    matrix.content.sentinelSourceIds.some((sourceId) => sourceId.startsWith("sentinel:")),
    false,
  );

  const missingPreviewOrder = buildWorkOrder({
    machine: REVIEW_RESEARCH_MACHINE_V1,
    state: { revision: 0, artifacts: {} },
    node: node("design_orientation_search"),
    project: { ...searchProject, retrievalRuns: {} },
    inputArtifacts: [],
    runtimeMode: "guided",
    createdAt: "2026-08-12T00:00:00.000Z",
  });
  const missingPreviewMatrix = createGuidedCandidates(missingPreviewOrder).find(
    (candidate) => candidate.type === "OrientationConceptMatrix",
  );
  assert.deepEqual(missingPreviewMatrix.content.sentinelSourceIds, []);
  assert.match(
    validateResearchArtifactContent(
      missingPreviewMatrix.type,
      missingPreviewMatrix.content,
    ).join("\n"),
    /sentinelSourceIds must not be empty/,
  );
});

test("guided Pi mode runs the actual Agent tool loop and submits typed candidates", async () => {
  const gateway = new ResearchToolGateway({
    fetchFn: async () => {
      throw new Error("network should not be used by the guided intake plan");
    },
  });
  const adapter = new PiRuntimeAdapter({ gateway, forceMode: "guided" });
  const order = orderFor("capture_intent");
  order.guidedCandidates = createGuidedCandidates(order);
  const events = [];
  const toolEvents = [];

  const result = await adapter.execute(order, {
    onEvent: (event) => events.push(event),
    onToolAudit: (event) => toolEvents.push(event),
  });

  assert.equal(result.runtime.adapter, "PiRuntimeAdapter");
  assert.equal(result.runtime.mode, "guided");
  assert.equal(result.runtime.piVersion, "0.84.1");
  assert.ok(events.some((event) => event.type === "agent_started"));
  assert.ok(events.some((event) => event.type === "tool_completed"));
  assert.deepEqual(
    toolEvents.map((event) => event.toolName),
    ["inspect_work_order", "submit_artifacts"],
  );
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.type),
    ["ResearchIntent"],
  );
  assert.equal(result.turnCount, 2);
  assert.equal(result.toolCallCount, 2);
  assert.equal(result.stopReason, "toolUse");
  assert.ok(result.usage.totalTokens > 0);
});

test("Pi context runtime inherits current provider auth without exposing secrets in provenance", async () => {
  const secret = "oauth-access-token-must-not-be-recorded";
  const model = {
    id: "gpt-context-test",
    name: "Context Test",
    api: "context-test-api",
    provider: "openai-codex",
    baseUrl: "https://default.invalid",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  };
  let authCalls = 0;
  const providerCalls = [];
  const faux = fauxProvider({
    provider: model.provider,
    api: model.api,
    models: [{ id: model.id, name: model.name }],
  });
  const provider = {
    ...faux.provider,
    streamSimple(requestModel, context, options) {
      providerCalls.push({ requestModel, context, options });
      return faux.provider.streamSimple(requestModel, context, options);
    },
  };
  faux.setResponses([
    fauxAssistantMessage([
      fauxText("先读取工作单。"),
      fauxToolCall("inspect_work_order", {}, { id: "pi-context-inspect" }),
    ], { stopReason: "toolUse" }),
    fauxAssistantMessage([
      fauxToolCall(
        "submit_artifacts",
        { artifacts: createGuidedCandidates(orderFor("capture_intent")) },
        { id: "pi-context-submit" },
      ),
    ], { stopReason: "toolUse" }),
  ]);
  const modelRegistry = {
    hasConfiguredAuth(candidate) {
      return candidate === model;
    },
    getProvider(providerId) {
      return providerId === model.provider ? provider : undefined;
    },
    async getApiKeyAndHeaders(candidate) {
      authCalls += 1;
      assert.equal(candidate, model);
      return {
        ok: true,
        apiKey: secret,
        headers: {
          Authorization: `Bearer ${secret}`,
          "X-Pi-Auth": "oauth",
        },
        baseUrl: "https://oauth-context.invalid",
        env: { PI_PROVIDER_SESSION: "ephemeral" },
      };
    },
  };
  const contextRuntime = createPiContextRuntime({ model, modelRegistry });
  assert.ok(contextRuntime);
  const adapter = new PiRuntimeAdapter({
    gateway: new ResearchToolGateway(),
    env: {},
    forceMode: "auto",
    piContextRuntime: contextRuntime,
  });
  const order = orderFor("capture_intent");

  const result = await adapter.execute(order);

  assert.equal(authCalls, 2);
  assert.equal(providerCalls.length, 2);
  assert.equal(providerCalls[0].requestModel.baseUrl, "https://oauth-context.invalid");
  assert.equal(providerCalls[0].options.apiKey, secret);
  assert.equal(providerCalls[0].options.headers.Authorization, `Bearer ${secret}`);
  assert.equal(providerCalls[0].options.env.PI_PROVIDER_SESSION, "ephemeral");
  assert.equal(providerCalls[1].options.apiKey, secret);
  assert.deepEqual(result.runtime, {
    mode: "live",
    provider: "openai-codex",
    modelId: "gpt-context-test",
    source: "pi_context",
    adapter: "PiRuntimeAdapter",
    piVersion: "0.84.1",
  });
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(adapter.describeRuntime(), {
    adapter: "PiRuntimeAdapter",
    piVersion: "0.84.1",
    mode: "live",
    liveConfigured: true,
    provider: "openai-codex",
    modelId: "gpt-context-test",
    runtimeSource: "pi_context",
    supportedProviders: ["openai", "anthropic", "current_pi_context"],
  });
});

test("Pi runtime enforces typed work-order budgets", async () => {
  const adapter = new PiRuntimeAdapter({
    gateway: new ResearchToolGateway(),
    forceMode: "guided",
  });
  const order = orderFor("capture_intent");
  order.guidedCandidates = createGuidedCandidates(order);
  order.budget = { maxTurns: 1, maxToolCalls: 1, maxSources: 0 };

  await assert.rejects(
    adapter.execute(order),
    (error) => error.code === "AGENT_TURN_BUDGET_EXCEEDED",
  );
});

test("tool gateway reads immutable artifacts and preserves PubMed access boundaries", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "research-artifact-gateway-"));
  const store = new ContentAddressedArtifactStore({ rootDir });
  const saved = await store.put({ claim: "bounded" });
  const xml = `<?xml version="1.0"?><PubmedArticleSet><PubmedArticle><MedlineCitation>
    <PMID>12345678</PMID><Article><Journal><Title>Journal</Title></Journal>
    <ArticleTitle>Bounded source</ArticleTitle><Abstract><AbstractText>Only an abstract is visible.</AbstractText></Abstract>
    </Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="doi">10.1/example</ArticleId></ArticleIdList></PubmedData>
  </PubmedArticle></PubmedArticleSet>`;
  const gateway = new ResearchToolGateway({
    artifactStore: store,
    now: () => new Date("2026-08-12T00:00:00.000Z"),
    fetchFn: async () => ({ ok: true, status: 200, text: async () => xml }),
  });

  assert.deepEqual(await gateway.readArtifact({ contentHash: saved.hash }), {
    claim: "bounded",
  });
  const fetched = await gateway.fetchPubMed({ resultIds: ["12345678"] });
  assert.equal(fetched.records[0].accessLevel, "abstract_only");
  assert.match(fetched.accessBoundary, /摘要/);
});

test("guided content forms a valid evidence-to-audited-writing artifact chain", async () => {
  const evidence = artifact(
    "EvidenceRecord",
    "evidence-1",
    {
      schemaVersion: "1.0.0",
      id: "evidence-1",
      sourceId: "source-1",
      claimId: "conclusion-1",
      locator: { pmid: "12345678" },
      accessLevel: "abstract_only",
      relation: "partially_supports",
      extractedFacts: ["The abstract reports a bounded association."],
      limitations: ["Abstract only."],
      unknowns: ["Full methods are unknown."],
      sourceSnapshotHash: "a".repeat(64),
    },
  );
  const boundary = artifact("EvidenceBoundaryDecision", "boundary-1", { id: "boundary-1" });
  const claimMap = artifact("ClaimEvidenceMap", "claim-map-1", {
    id: "claim-map-1",
    claims: [{ claimId: "conclusion-1", evidenceIds: [evidence.id] }],
  });

  const outlines = guidedArtifacts("derive_outline", [boundary, claimMap]);
  assertContracts(outlines);
  const stressTests = guidedArtifacts("stress_test_outline", [outlines[0], claimMap]);
  assertContracts(stressTests);

  const outlineGate = {
    id: "gate-outline",
    fingerprint: "b".repeat(64),
    artifactRefs: [...outlines, ...stressTests].map((item) => ({ artifactId: item.id })),
  };
  const outlineDecisions = createGateDecisionArtifacts({
    project,
    node: node("approve_outline"),
    gate: outlineGate,
    decision: "approved",
    reason: "研究者确认此结构只使用当前核查材料。",
    state: { artifacts: {} },
    inputArtifacts: [...outlines, ...stressTests],
    humanActor: { id: "researcher-local", role: "human_researcher", kind: "human" },
    decidedAt: "2026-08-12T01:00:00.000Z",
  }).map((item) => artifact(item.type, item.id, item.content, item.version));
  assertContracts(outlineDecisions);
  const plan = outlineDecisions.find((item) => item.type === "FrozenWritingPlan");

  const drafts = guidedArtifacts("write_claim_units", [plan, claimMap]);
  assertContracts(drafts);
  const snapshot = artifact("SourceSnapshot", "snapshot-1", {
    id: "snapshot-1",
    sourceId: "source-1",
    title: project.sourceMaterials[0].title,
    text: project.sourceMaterials[0].text,
    abstract: project.sourceMaterials[0].text,
    accessLevel: "abstract_only",
    sourceSnapshotHash: "a".repeat(64),
    locator: { pmid: "12345678" },
  });
  const verificationOrder = orderFor("verify_claim_units", [...drafts, snapshot, evidence]);
  const verificationCandidates = await enforceCitationVerification({
    workOrder: verificationOrder,
    candidates: createGuidedCandidates(verificationOrder),
    gateway: new ResearchToolGateway({
      now: () => new Date("2026-08-12T01:30:00.000Z"),
    }),
  });
  const verifications = verificationCandidates.map((candidate) =>
    artifact(candidate.type, candidate.artifactId, candidate.content),
  );
  assertContracts(verifications);

  const unitGate = {
    id: "gate-units",
    fingerprint: "c".repeat(64),
    artifactRefs: [...drafts, ...verifications].map((item) => ({ artifactId: item.id })),
  };
  const acceptedUnits = createGateDecisionArtifacts({
    project,
    node: node("approve_claim_units"),
    gate: unitGate,
    decision: "approved",
    reason: "研究者逐句确认事实句均获得直接支持。",
    state: { artifacts: {} },
    inputArtifacts: [...drafts, ...verifications],
    humanActor: { id: "researcher-local", role: "human_researcher", kind: "human" },
    decidedAt: "2026-08-12T02:00:00.000Z",
  }).map((item) => artifact(item.type, item.id, item.content, item.version));
  assertContracts(acceptedUnits);

  const manuscript = guidedArtifacts("assemble_manuscript", [...acceptedUnits, plan]);
  assertContracts(manuscript);
  const audits = guidedArtifacts("audit_manuscript", [manuscript[0], ...verifications]);
  assertContracts(audits);
  const audit = audits.find((item) => item.type === "ManuscriptAudit");
  const audited = audits.find((item) => item.type === "AuditedManuscript");
  assert.equal(audit.content.status, "simulation_reviewed");
  assert.equal(audit.content.verdict, "simulation_only");
  assert.equal(audit.content.authority.authoritative, false);
  assert.equal(audited.content.auditVerdict, "simulation_only");
  assert.equal(audited.content.title, manuscript[0].content.title);
  assert.equal(audited.content.abstract, manuscript[0].content.abstract);
  assert.equal(audited.content.conclusion, manuscript[0].content.conclusion);
  const finalRun = {
    purpose: "finalLibrary",
    nodeId: "freeze_library",
    protocolArtifactId: "frozen-search-1",
    protocolContentHash: "f".repeat(64),
    queryId: "focused:core",
    query: "bounded association",
    queryHash: sha256("bounded association"),
    receipt: {
      receiptHash: "e".repeat(64),
      records: [{ sourceId: project.sourceMaterials[0].id }],
    },
  };
  const deliveryProject = {
    ...project,
    researchMode: "live_pubmed",
    retrievalRuns: { finalLibrary: finalRun },
  };
  const library = artifact("LibraryManifest", "library-manifest-1", {
    retrievalMode: "live_pubmed",
    provider: "pubmed",
    retrievalRunPurpose: "finalLibrary",
    protocolArtifactId: finalRun.protocolArtifactId,
    protocolContentHash: finalRun.protocolContentHash,
    queryId: finalRun.queryId,
    query: finalRun.query,
    queryHash: finalRun.queryHash,
    retrievalReceiptHash: finalRun.receipt.receiptHash,
    sourceCount: 1,
    sourceIds: [project.sourceMaterials[0].id],
  });
  const delivery = guidedArtifacts(
    "prepare_delivery",
    [audited, audit, library],
    deliveryProject,
  );
  assertContracts(delivery);
  const bundle = delivery.find((item) => item.type === "DeliveryBundle");
  const manifest = delivery.find((item) => item.type === "ExportManifest");
  assert.equal(bundle.content.authorSignoffStatus, "simulation_pending");
  assert.equal(bundle.content.authority.inheritance, "rebuild_in_live_run");
  assert.equal(manifest.content.status, "simulation_pending_signoff");
  assert.equal(manifest.content.authority.class, "simulation");
});

test("guided independent review rejects a claim result without a citation receipt", () => {
  const target = artifact("ClaimVerificationResult", "verification-without-receipt", {
    schemaVersion: "1.0.0",
    id: "verification-without-receipt",
    version: 1,
    claimUnitDraftId: "draft:1",
    draftProducerId: "agent:claim_unit_writer",
    verifierId: "agent:citation_verifier",
    status: "verified",
    limitations: [],
    sentenceResults: [
      {
        sentenceId: "sentence:1",
        verdict: "direct_support",
        citationIntentIds: ["intent:1"],
        verifiedEvidenceIds: ["evidence:1"],
        rationale: "Agent self-reported support.",
        requiredRevision: null,
      },
    ],
  });
  const reviewOrder = {
    reviewedNodeId: "verify_claim_units",
    role: "independent_evidence_reviewer",
    acceptanceCriteria: ["每个事实句都有工具回执"],
    project: { researchMode: "guided_materials" },
    createdAt: "2026-08-12T03:00:00.000Z",
    requiredOutputs: [{ artifactId: "review:1", type: "ReviewVerdict" }],
  };

  const review = createGuidedReviewCandidate({ reviewOrder, targetArtifacts: [target] });
  assert.equal(review.content.verdict, "fail");
  assert.match(review.content.limitations.join(" "), /citation_verify/);
});
