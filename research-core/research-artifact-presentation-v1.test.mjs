import assert from "node:assert/strict";
import test from "node:test";

import {
  buildResearchBundle,
  buildResearchExportSet,
  buildResearchOutputProjection,
  manuscriptToMarkdown,
  projectSourcesToBibtex,
  sha256ExportBytes,
} from "./research-artifact-presentation-v1.js";
import {
  createModelInvocationReceipt,
  deriveProjectRuntimeProvenance,
} from "./agent-run-log-v1.js";

const hash = "a".repeat(64);
const project = {
  id: "research-demo",
  title: "睡眠与术后恢复",
  question: "现有证据是否支持睡眠质量与术后恢复有关？",
  constraints: ["摘要未报告的信息保持未知"],
  sourceMaterials: [
    {
      id: "source-1",
      title: "睡眠与恢复研究",
      accessLevel: "abstract_only",
      locator: { pmid: "12345678", url: "https://pubmed.ncbi.nlm.nih.gov/12345678/" },
    },
  ],
};

function retrievalRun(purpose, queryId, receiptHashCharacter, nodeId) {
  return {
    schemaVersion: "research-retrieval-run/v1",
    purpose,
    nodeId,
    protocolArtifactId: `artifact:${purpose}:protocol`,
    protocolContentHash: receiptHashCharacter.repeat(64),
    queryId,
    query: `query for ${queryId}`,
    queryHash: receiptHashCharacter.repeat(64),
    receipt: {
      provider: "pubmed",
      executedAt: "2026-08-12T08:00:00.000Z",
      fetchedAt: "2026-08-12T08:00:01.000Z",
      total: 10,
      records: [{ sourceId: `pubmed:${queryId}` }],
      receiptHash: receiptHashCharacter.repeat(64),
      accessBoundary: "仅访问 PubMed 题录与可用摘要。",
    },
  };
}

function artifact(type, content, extras = {}) {
  return {
    id: `artifact:${type}`,
    type,
    version: 1,
    contentHash: hash,
    status: "accepted",
    freshness: "current",
    producedByNodeId: "research-node",
    producedByActorId: "agent:researcher",
    producedAt: "2026-08-12T10:00:00.000Z",
    inputArtifactRefs: [],
    content,
    ...extras,
  };
}

const artifacts = [
  artifact("ResearchIntent", { summary: "内部研究意图" }),
  artifact("AppraisalRecord", {
    sourceId: "source-1",
    appraisal: "可进入候选证据池，仍需独立核查。",
    riskFlags: ["abstract_only"],
  }),
  artifact("EvidenceRecord", {
    sourceId: "source-1",
    accessLevel: "abstract_only",
    relation: "partially_supports",
    extractedFacts: ["摘要报告睡眠质量与恢复指标存在相关。"],
    limitations: ["只访问摘要。"],
    unknowns: ["效应量摘要未报告。"],
    sourceSnapshotHash: hash,
    locator: { pmid: "12345678" },
  }),
  artifact("ResearchConclusionCard", {
    claim: "当前摘要级材料支持有限关联判断，不能形成强因果结论。",
    confidence: "bounded",
    scope: "仅限当前用户材料。",
    accessBoundary: "仅访问摘要。",
    uncertainties: ["缺少全文方法学核查。"],
    nextQuestion: "全文是否报告已校正效应量？",
    supportingEvidenceIds: ["artifact:EvidenceRecord"],
    counterEvidenceIds: [],
  }),
  artifact("AuditedManuscript", {
    title: "睡眠与术后恢复证据综述",
    abstract: "整理当前可见证据并保留边界。",
    conclusion: "当前只能形成有限判断。",
    disclosedLimitations: ["尚未完成系统数据库检索。"],
    auditVerdict: "pass",
    sections: [{ title: "结果", content: "当前证据支持有限关联。" }],
  }),
  artifact("DeliveryBundle", {
    authorSignoffStatus: "pending",
    limitations: ["作者仍需签署。"],
    exports: [],
    manifestHash: hash,
  }),
  artifact("ExportManifest", { id: "manifest-placeholder" }),
  artifact("AuthorApproval", {
    reason: "研究者已核对经审计稿与限制。",
  }),
  artifact("SignedDelivery", {
    reason: "研究者确认此版本可交付。",
  }),
];

function liveRuntimeProvenance() {
  const runtime = {
    mode: "live",
    provider: "openai",
    modelId: "gpt-5-mini",
    adapter: "PiRuntimeAdapterV1",
    piVersion: "0.84.1",
  };
  const startedAt = "2026-08-12T09:59:58.000Z";
  const completedAt = "2026-08-12T09:59:59.000Z";
  const receipt = createModelInvocationReceipt({
    projectId: project.id,
    workOrderId: "formal-order",
    runId: "formal-run",
    runtime,
    usage: { input: 100, output: 20, totalTokens: 120 },
    stopReason: "stop",
    startedAt,
    completedAt,
  });
  return deriveProjectRuntimeProvenance({
    projectId: project.id,
    version: 7,
    lastEventHash: hash,
    runs: {
      "formal-run": {
        id: "formal-run",
        workOrderId: "formal-order",
        status: "completed",
        startedAt,
        finishedAt: completedAt,
        terminalPayload: {
          runtime,
          usage: { input: 100, output: 20, totalTokens: 120 },
          stopReason: "stop",
          modelInvocationReceipt: receipt,
        },
      },
    },
  });
}

test("research output projection hides internal workflow objects and exposes useful groups", () => {
  const result = buildResearchOutputProjection({ project, artifacts });

  assert.deepEqual(
    result.groups.map((group) => group.label),
    ["研究结论", "来源与证据", "写作稿件", "质量审计与交付"],
  );
  assert.equal(result.internalWorkflow.count, 5);
  assert.equal(result.internalWorkflow.hiddenByDefault, true);
  assert.equal(result.internalWorkflow.typeCounts.ResearchIntent, 1);
  assert.equal(result.internalWorkflow.typeCounts.AppraisalRecord, 1);
  assert.equal(result.internalWorkflow.typeCounts.AuthorApproval, 1);
  assert.equal(result.internalWorkflow.typeCounts.SignedDelivery, 1);
  assert.equal(result.internalWorkflow.typeCounts.ExportManifest, 1);

  const delivery = result.items.find((item) => item.type === "DeliveryBundle");
  assert.equal(delivery.details.authorSignoffStatus, "signed");
  assert.equal(delivery.details.authorSignoffReason, "研究者确认此版本可交付。");

  const evidence = result.items.find((item) => item.type === "EvidenceRecord");
  assert.equal(evidence.title, "来源证据：睡眠与恢复研究");
  assert.equal(evidence.details.accessLabel, "题名与摘要");
  assert.equal(evidence.details.appraisal, "可进入候选证据池，仍需独立核查。");
  assert.equal(evidence.traceability.contentHash, hash);
  assert.equal(evidence.traceability.locator.pmid, "12345678");
});

test("research output projection never promotes stale or rejected artifacts", () => {
  const invalidConclusion = artifact(
    "ResearchConclusionCard",
    { claim: "这条旧结论已失效。" },
    {
      id: "artifact:stale-conclusion",
      freshness: "stale",
      status: "accepted",
    },
  );
  const rejectedEvidence = artifact(
    "EvidenceRecord",
    { sourceId: "source-1", extractedFacts: ["未通过核查。"] },
    {
      id: "artifact:rejected-evidence",
      status: "rejected",
    },
  );
  const result = buildResearchOutputProjection({
    project,
    artifacts: [...artifacts, invalidConclusion, rejectedEvidence],
  });

  assert.equal(result.items.some((item) => item.id === invalidConclusion.id), false);
  assert.equal(result.items.some((item) => item.id === rejectedEvidence.id), false);
  assert.equal(result.internalWorkflow.typeCounts.ResearchConclusionCard, 1);
  assert.equal(result.internalWorkflow.typeCounts.EvidenceRecord, 1);
});

test("only real deliverables advertise download actions", () => {
  const result = buildResearchOutputProjection({ project, artifacts });
  const manuscript = result.items.find((item) => item.type === "AuditedManuscript");
  const bundle = result.items.find((item) => item.type === "DeliveryBundle");
  const conclusion = result.items.find((item) => item.type === "ResearchConclusionCard");

  assert.match(manuscript.downloadUrl, /restricted-draft\.md$/);
  assert.match(manuscript.actions[0].label, /受限草稿/);
  assert.match(bundle.downloadUrl, /research-bundle\.json$/);
  assert.match(bundle.actions[1].href, /references\.bib$/);
  assert.equal(conclusion.downloadUrl, null);
  assert.equal(result.usableArtifacts.length, 2);

  const formal = buildResearchOutputProjection({
    project,
    artifacts,
    contentMaturity: { formalResearchComplete: true },
    runtimeProvenance: liveRuntimeProvenance(),
  });
  assert.match(
    formal.items.find((item) => item.type === "AuditedManuscript").downloadUrl,
    /manuscript\.md$/,
  );
});

test("markdown and JSON bundle contain readable research content", () => {
  const manuscript = artifacts.find((item) => item.type === "AuditedManuscript");
  const markdown = manuscriptToMarkdown(manuscript.content);
  assert.match(markdown, /^# 睡眠与术后恢复证据综述/m);
  assert.match(markdown, /## 摘要/);
  assert.match(markdown, /## 结果/);
  assert.match(markdown, /## 研究边界与限制/);

  const bundle = buildResearchBundle({ project, artifacts });
  assert.equal(bundle.project.question, project.question);
  assert.equal(bundle.generatedAt, "2026-08-12T10:00:00.000Z");
  assert.deepEqual(bundle, buildResearchBundle({ project, artifacts }));
  assert.ok(bundle.researchOutputs.some((group) => group.label === "研究结论"));
  assert.equal(bundle.internalWorkflow.hiddenByDefault, true);
  assert.equal(bundle.project.searchQuery, null);
  assert.equal(bundle.sources[0].pmid, "12345678");
  assert.equal(bundle.sources[0].accessLevel, "abstract_only");
});

test("research bundle separates preview, staged retrieval runs, and legacy bootstrap", () => {
  const stagedProject = {
    ...project,
    researchMode: "live_pubmed",
    retrievalRuns: {
      previewSelection: {
        candidateId: "candidate-wide",
        candidateStatus: "ready",
        query: "preview query",
        total: 24,
        executedAt: "2026-08-12T07:59:00.000Z",
        planHash: "1".repeat(64),
        selectionHash: "2".repeat(64),
        samples: [{ sourceId: "pubmed:preview" }],
      },
      pilot: retrievalRun("pilot", "pilot", "3", "run_pilot_search"),
      orientationCorpus: retrievalRun(
        "orientationCorpus",
        "orientation",
        "4",
        "build_orientation_corpus",
      ),
      focusedCalibration: [
        retrievalRun("focusedCalibration", "focused-core", "5", "calibrate_focused_search"),
        retrievalRun("focusedCalibration", "focused-broadened", "6", "calibrate_focused_search"),
      ],
      finalLibrary: retrievalRun("finalLibrary", "final", "7", "freeze_library"),
      legacyBootstrap: {
        authority: "legacy_single_receipt",
        receipt: { receiptHash: "8".repeat(64) },
      },
    },
  };
  const bundle = buildResearchBundle({ project: stagedProject, artifacts });

  assert.deepEqual(
    bundle.retrievalRuns.map((run) => run.purpose),
    ["pilot", "orientationCorpus", "focusedCalibration", "focusedCalibration", "finalLibrary"],
  );
  assert.equal(bundle.retrieval.purpose, "finalLibrary");
  assert.equal(bundle.retrieval.receiptHash, "7".repeat(64));
  assert.equal(bundle.retrievalAuthority.finalLibraryReady, true);
  assert.equal(bundle.retrievalAuthority.previewSelection.sampledCount, 1);
  assert.match(bundle.retrievalAuthority.previewSelection.boundary, /不进入正式文献库/);
  assert.deepEqual(bundle.retrievalAuthority.legacyBootstrap.reusableForFormalNodes, []);
  assert.match(bundle.retrievalAuthority.legacyBootstrap.boundary, /不能证明分阶段真实检索/);
});

test("export manifest fingerprints the exact Markdown, JSON, and BibTeX bytes", () => {
  const result = buildResearchExportSet({
    project,
    artifacts,
    contentMaturity: {
      code: "formal_live_audited",
      label: "正式审计成果",
      boundary: "作者已签署当前证据边界。",
      formalResearchComplete: true,
    },
    runtimeProvenance: liveRuntimeProvenance(),
    humanDecisions: [{ nodeId: "author_signoff", decision: "approved" }],
    auditVersion: "1.0.0",
  });
  assert.equal(result.formalResearchComplete, true);
  assert.deepEqual(
    result.files.map((file) => file.format).sort(),
    ["bibtex", "json", "markdown"],
  );
  for (const file of result.files) {
    const manifestItem = result.manifest.files.find((item) => item.id === file.id);
    assert.ok(manifestItem);
    assert.equal(manifestItem.byteLength, Buffer.byteLength(file.body, "utf8"));
    assert.equal(manifestItem.contentHash, sha256ExportBytes(file.body));
  }
  const markdown = result.files.find((file) => file.format === "markdown");
  assert.doesNotMatch(markdown.body, /受限研究草稿/);
  const bibtex = result.files.find((file) => file.format === "bibtex");
  assert.equal(bibtex.body, projectSourcesToBibtex(project));
  const json = JSON.parse(result.files.find((file) => file.format === "json").body);
  assert.equal(json.formalResearchComplete, true);
  assert.equal(json.humanDecisions[0].nodeId, "author_signoff");
  assert.match(result.manifest.manifestHash, /^[a-f0-9]{64}$/);
});

test("export set cannot label an unsigned project as formal", () => {
  const unsigned = artifacts.filter((item) => item.type !== "SignedDelivery");
  const result = buildResearchExportSet({
    project,
    artifacts: unsigned,
    contentMaturity: { formalResearchComplete: true },
    runtimeProvenance: liveRuntimeProvenance(),
  });
  assert.equal(result.formalResearchComplete, false);
  const markdown = result.files.find((file) => file.format === "markdown");
  assert.equal(markdown.fileName, "restricted-draft.md");
  assert.match(markdown.body, /不可作为正式签署版本/);
});

test("global formal maturity cannot elevate guided or missing project provenance", () => {
  const contentMaturity = { formalResearchComplete: true };
  const missing = buildResearchExportSet({ project, artifacts, contentMaturity });
  assert.equal(missing.formalResearchComplete, false);

  const guidedRuntime = {
    mode: "guided",
    provider: "research-workbench-guided",
    modelId: "guided-research-v1",
    adapter: "PiRuntimeAdapterV1",
    piVersion: "0.84.1",
  };
  const startedAt = "2026-08-12T09:59:58.000Z";
  const completedAt = "2026-08-12T09:59:59.000Z";
  const receipt = createModelInvocationReceipt({
    projectId: project.id,
    workOrderId: "guided-order",
    runId: "guided-run",
    runtime: guidedRuntime,
    startedAt,
    completedAt,
  });
  const guidedProvenance = deriveProjectRuntimeProvenance({
    projectId: project.id,
    version: 6,
    lastEventHash: hash,
    runs: {
      "guided-run": {
        id: "guided-run",
        workOrderId: "guided-order",
        status: "completed",
        startedAt,
        finishedAt: completedAt,
        terminalPayload: {
          runtime: guidedRuntime,
          usage: null,
          stopReason: null,
          modelInvocationReceipt: receipt,
        },
      },
    },
  });
  const guided = buildResearchExportSet({
    project,
    artifacts,
    contentMaturity,
    runtimeProvenance: guidedProvenance,
  });
  assert.equal(guided.formalResearchComplete, false);
  assert.equal(
    guided.files.find((file) => file.format === "markdown").fileName,
    "restricted-draft.md",
  );
});
