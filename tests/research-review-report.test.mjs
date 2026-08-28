import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import {
  buildMentorBrief,
  buildResearchReviewReportModel,
  buildScopingRoundComparison,
  reportChapterIdForKey,
  researchReportChapterEvidenceRows,
  researchReportBindingStatus,
} from "../src/components/research-review-report-model.js";
import {
  firstRoundCheckpointFrom,
  loadScopingDraft,
  restoredFirstRoundState,
  saveScopingDraft,
} from "../src/components/research-scoping-draft.js";
import { buildResearchWorkbenchDirectionSelectionPayload } from "../src/research-agent-workbench-model.js";
import { buildResearchDirectionSelection } from "../research-core/research-direction-selection-v1.js";
import { assertResearchReportSelectionBinding } from "../research-core/research-report-contract-v1.js";

const gastricReport = JSON.parse(readFileSync(
  new URL("../research-core/fixtures/gastric-cancer-review-ledger-2021-2026.v1.json", import.meta.url),
  "utf8",
));

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function landscapeFromReport(report = gastricReport) {
  const synthesis = report.derivedAnalysis.reviewSynthesis;
  return {
    status: report.relevanceGate.status === "passed" ? "ready" : "blocked",
    sampledCount: report.ledger.analyzedRowCount,
    abstractAvailableCount: synthesis.abstractAvailableCount,
    sources: report.ledger.rows.filter((row) => row.includedInDerivedAnalysis === true),
    synthesis,
    researchReport: report,
    reviewWindow: synthesis.reviewWindow,
  };
}

function previewFromReport(report = gastricReport) {
  return {
    planHash: "d".repeat(64),
    question: report.question,
    candidates: [{
      id: "gastric-review-scan",
      status: "ready",
      query: report.ledger.samplingMetadata.baseQuery,
    }],
    reviewLandscape: {
      ...landscapeFromReport(report),
      selectedCandidateId: "gastric-review-scan",
    },
  };
}

test("four-chapter model normalizes contract label objects and uses review proposals as the only candidate content", () => {
  const landscape = landscapeFromReport();
  const proposalIds = gastricReport.derivedAnalysis.reviewSynthesis.professorReport.studentReviewDirections
    .map((proposal) => proposal.id);
  const selectedId = proposalIds[1];
  const model = buildResearchReviewReportModel({ landscape, selectedDirectionId: selectedId });
  assert.deepEqual(model.claimLabels, {
    sampleObservation: "当前20篇综述样本",
    externalReviewCheck: "立题前核查近两年同题综述",
    researchOpportunityInference: "候选选题判断",
  });
  assert.equal(model.stratifiedAllocation, true);
  assert.ok(model.directions.length >= 3 && model.directions.length <= 5);
  assert.deepEqual(model.directions.map((direction) => direction.id), proposalIds);
  assert.equal(new Set(model.directions.map((direction) => direction.id)).size, model.directions.length);
  assert.equal(model.selectedDirection.id, selectedId);
  for (const direction of model.directions) {
    assert.match(direction.id, /^review_proposal_/);
    assert.ok(direction.priority);
    assert.equal(direction.competitionRisk, "待核查");
    assert.match(direction.coverageSignal, /较高|较低|未知/);
    assert.ok(direction.incrementalValueHypothesis);
    assert.ok(direction.discardConditions.length >= 1);
    assert.ok(direction.organization.length >= 1);
    assert.notEqual(direction.scopeDefinition, direction.displayTitle);
    assert.doesNotMatch(direction.discardConditions.join(" "), /不足\s*50|超过\s*100|少于\s*50|多于\s*100/);
  }
  assert.equal(model.rows.length, gastricReport.ledger.analyzedRowCount);
  assert.equal(model.externalReviewVerified, false);
  assert.match(model.opportunityThesis, /当前样本中/);
  assert.match(
    model.opportunityThesis,
    new RegExp(`${model.directions[0].existingCoverage.count}/${model.directions[0].existingCoverage.total}`),
  );
  assert.equal(model.metadataPatternInsights.length, 2);
  assert.match(model.metadataPatternInsights[1].conclusion, /4\/20/);
  assert.equal(model.decisionStructure.length, 3);
  assert.equal(model.decisionStructureComplete, true);
  assert.deepEqual(model.unmappedThemes, []);
  const groupedThemeIds = model.decisionStructure.flatMap((group) => group.items.map((item) => item.id));
  for (const theme of model.themeDistribution) {
    assert.equal(
      groupedThemeIds.filter((themeId) => themeId === theme.id).length,
      1,
      `visible theme ${theme.id} must enter exactly one decision-chain group`,
    );
  }
  assert.ok(model.decisionStructure.find((group) => group.id === "treatment_decision")
    .items.some((item) => item.id === "systemic_treatment"));
  assert.ok(model.decisionStructure.find((group) => group.id === "risk_detection")
    .items.some((item) => item.id === "early_onset"));
  assert.match(model.reportBoundary, /题名摘要级/);
  assert.match(model.reportBoundary, /不能替代全文系统综述/);
  assert.doesNotMatch(model.reportBoundary, /reportHash|数字签名|可信根|事件库|版本库/);
  assert.match(model.technicalIntegrityBoundary, /reportHash|数字签名/);
  const brief = buildMentorBrief(model);
  assert.match(brief, /题名摘要级|题名与摘要级/);
  assert.match(brief, /同题综述比较：立题前逐篇比较/);
  assert.match(brief, /当前样本覆盖/);
  assert.match(brief, /候选增量/);
  assert.match(brief, /放弃或降级条件/);
  assert.match(brief, /立题前核查：立题前核查近两年同题综述/);
  assert.doesNotMatch(brief, /reportHash|sourceSetHash|数字签名|可信根|事件库|版本库|内容指纹/);
  assert.doesNotMatch(brief, /PMID\s+\d{6,}/);
  assert.equal(buildResearchReviewReportModel({ landscape }).selectedDirection, null);
});

test("opaque or caller-authored external review objects cannot upgrade any candidate competition status", () => {
  const report = structuredClone(gastricReport);
  const directionId = report.derivedAnalysis.reviewSynthesis.professorReport.studentReviewDirections[0].id;
  report.externalReviewCheck = { sourceIds: ["opaque-nonlocatable"] };
  report.externalReviewVerification = {
    schemaVersion: "research-external-review-verification/v1",
    status: "verified",
    receipts: [{
      schemaVersion: "research-external-review-verification-receipt/v1",
      status: "verified",
      directionId,
      verifiedAt: "2026-08-27T08:00:00.000Z",
      method: "同题综述定向核查",
      query: "gastric cancer review",
      contentHash: "a".repeat(64),
      sources: [{ sourceId: "opaque-nonlocatable" }],
    }],
  };
  const model = buildResearchReviewReportModel({ landscape: landscapeFromReport(report) });
  assert.equal(model.externalReviewVerified, false);
  assert.equal(model.externalReviewVerificationCount, 0);
  assert.ok(model.directions.every((direction) => direction.externalReviewVerified === false));
  assert.ok(model.directions.every((direction) => direction.competitionRisk === "待核查"));
});

test("every current oncology theme maps to exactly one decision-chain group and unknown themes remain explicit", () => {
  const oncologyThemeIds = [
    "early_detection_screening",
    "early_onset",
    "biomarkers_molecular",
    "targeted_therapy",
    "systemic_treatment",
    "immunotherapy",
    "perioperative_treatment",
    "local_treatment",
    "advanced_metastatic",
    "resistance_microenvironment",
    "toxicity_supportive",
    "survivorship_quality_of_life",
    "ai_digital",
    "prevention_epidemiology",
  ];
  const report = structuredClone(gastricReport);
  report.derivedAnalysis.themeDistribution = oncologyThemeIds.map((id) => ({
    id,
    label: id,
    count: 1,
    sourceIds: [report.ledger.rows[0].sourceId],
  }));
  const mappedModel = buildResearchReviewReportModel({ landscape: landscapeFromReport(report) });
  const groupedIds = mappedModel.decisionStructure.flatMap((group) => group.items.map((item) => item.id));
  assert.equal(mappedModel.decisionStructureComplete, true);
  for (const themeId of oncologyThemeIds) {
    assert.equal(groupedIds.filter((candidate) => candidate === themeId).length, 1);
  }

  report.derivedAnalysis.themeDistribution.push({
    id: "future_unmapped_theme",
    label: "未来新增主题",
    count: 1,
    sourceIds: [report.ledger.rows[0].sourceId],
  });
  const unmappedModel = buildResearchReviewReportModel({ landscape: landscapeFromReport(report) });
  assert.equal(unmappedModel.decisionStructureComplete, false);
  assert.deepEqual(unmappedModel.unmappedThemes.map((item) => item.id), ["future_unmapped_theme"]);
  assert.ok(unmappedModel.decisionStructure.find((group) => group.id === "unmapped_themes")
    .items.some((item) => item.id === "future_unmapped_theme"));
});

test("each chapter opens a bounded representative evidence subset while retaining the complete ledger separately", () => {
  const landscape = landscapeFromReport();
  const selectedDirectionId = gastricReport.derivedAnalysis.reviewSynthesis.professorReport.studentReviewDirections[0].id;
  const model = buildResearchReviewReportModel({ landscape, selectedDirectionId });
  for (const chapterId of ["landscape", "trends", "opportunities", "plan"]) {
    const rows = researchReportChapterEvidenceRows(model, chapterId, selectedDirectionId);
    assert.ok(rows.length > 0 && rows.length <= 8, `${chapterId} should expose a bounded evidence subset`);
    assert.ok(rows.every((row) => model.rows.some((candidate) => candidate.sourceId === row.sourceId)));
  }
  const landscapeSourceIds = new Set(researchReportChapterEvidenceRows(model, "landscape").map((row) => row.sourceId));
  for (const problem of model.majorProblems) {
    assert.ok(
      problem.representativeSourceIds.some((sourceId) => landscapeSourceIds.has(sourceId)),
      `visible major problem ${problem.id} must retain direct evidence`,
    );
  }
  const trendSourceIds = new Set(researchReportChapterEvidenceRows(model, "trends").map((row) => row.sourceId));
  for (const insight of model.trendInsights) {
    assert.ok(
      insight.representativeSourceIds.some((sourceId) => trendSourceIds.has(sourceId)),
      `visible trend ${insight.id} must retain direct evidence`,
    );
  }
  const unselectedModel = buildResearchReviewReportModel({ landscape });
  const opportunitySourceIds = new Set(
    researchReportChapterEvidenceRows(unselectedModel, "opportunities").map((row) => row.sourceId),
  );
  for (const direction of unselectedModel.directions) {
    assert.ok(
      direction.representativeSourceIds.some((sourceId) => opportunitySourceIds.has(sourceId)),
      `visible direction ${direction.id} must retain direct evidence`,
    );
  }
  const brief = buildMentorBrief(model);
  assert.doesNotMatch(brief, /。；/);
});

test("real gastric fixture keeps render IDs, client payload, report binding, and API selection on one review proposal", () => {
  const preview = previewFromReport();
  const model = buildResearchReviewReportModel({ landscape: preview.reviewLandscape });
  const selectedDirectionId = model.directions[0].id;
  const payload = buildResearchWorkbenchDirectionSelectionPayload({
    queryPreview: preview,
    selectedDirectionId,
    selectionReason: "该方向最能降低当前综述问题的不确定性。",
    deferredReason: "其余方向等待同题综述核查后再比较。",
  });
  assert.ok(payload);
  assert.equal(payload.selectedDirectionId, selectedDirectionId);
  assert.deepEqual(payload.reportBinding, gastricReport.binding);
  assert.doesNotThrow(() => assertResearchReportSelectionBinding(payload, gastricReport));
  const selection = buildResearchDirectionSelection({
    preview,
    selectedDirectionId: payload.selectedDirectionId,
    selectionReason: payload.selectionReason,
    deferredReason: payload.deferredReason,
    actor: { id: "doctoral-researcher", kind: "human", role: "researcher" },
    selectedAt: "2026-08-27T08:00:00.000Z",
  });
  assert.equal(selection.selectedDirection.id, selectedDirectionId);
  assert.equal(selection.selectedDirection.directionKind, "review_topic");
  const rebound = buildResearchReviewReportModel({
    landscape: preview.reviewLandscape,
    lockedDirection: {
      ...selection.selectedDirection,
      reportBinding: selection.reportBinding,
    },
  }).selectedDirection;
  assert.equal(rebound.id, selectedDirectionId);
  assert.ok(rebound.existingCoverage?.interpretation);
  assert.ok(rebound.incrementalValueHypothesis);
  assert.ok(rebound.discardConditions.length >= 1);
});

test("analysis denominator and evidence rows exclude screening records not admitted to derived analysis", () => {
  const report = structuredClone(gastricReport);
  report.ledger.rows.push({
    ...report.ledger.rows[0],
    sourceId: "pubmed:excluded-fixture",
    pmid: "00000000",
    title: "Unrelated screening record",
    includedInDerivedAnalysis: false,
    relevance: { status: "not_relevant", boundary: "题名与摘要未命中冻结研究对象。" },
  });
  report.ledger.rowCount += 1;
  const model = buildResearchReviewReportModel({ landscape: landscapeFromReport(report) });
  assert.equal(model.analyzedCount, 20);
  assert.equal(model.claimLabels.sampleObservation, "当前20篇综述样本");
  assert.equal(model.rows.length, 20);
  assert.equal(model.screeningRows.length, 21);
  assert.equal(model.excludedRows.length, 1);
  assert.equal(model.rows.some((row) => row.sourceId === "pubmed:excluded-fixture"), false);
});

test("binding check fails closed for project, source set, report revision, frozen manifest, derived analysis, and report content hash mismatches", () => {
  const binding = {
    projectId: "p1",
    sourceSetHash: "s1",
    reportRevision: 3,
    frozenSourceManifestHash: "m1",
    derivedAnalysisHash: "d1",
    reportHash: "h1",
  };
  assert.equal(researchReportBindingStatus(binding, binding).stale, false);
  for (const field of ["projectId", "sourceSetHash", "reportRevision", "frozenSourceManifestHash", "derivedAnalysisHash", "reportHash"]) {
    const current = { ...binding, [field]: `${binding[field]}-changed` };
    const status = researchReportBindingStatus(binding, current);
    assert.equal(status.stale, true);
    assert.deepEqual(status.mismatches, [field]);
  }
  assert.equal(researchReportBindingStatus(binding, {
    projectId: "p1",
    reportRevision: 3,
    frozenSourceManifestHash: "m1",
    derivedAnalysisHash: "d1",
    reportHash: "h1",
  }).stale, true);
});

test("relevance and ledger integrity failures disable report actions with a recoverable explanation", async (t) => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  t.after(() => vite.close());
  const { ResearchReviewReport } = await vite.ssrLoadModule("/src/components/ResearchReviewReport.jsx");
  const selectedDirectionId = gastricReport.derivedAnalysis.reviewSynthesis.professorReport.studentReviewDirections[0].id;
  for (const failure of ["relevance", "ledger"]) {
    const report = structuredClone(gastricReport);
    if (failure === "relevance") report.relevanceGate.status = "blocked";
    if (failure === "ledger") report.ledger.analyzedRowCount += 1;
    const storage = memoryStorage();
    storage.setItem(`${failure}:chapter`, "opportunities");
    globalThis.localStorage = storage;
    const markup = renderToStaticMarkup(React.createElement(ResearchReviewReport, {
      landscape: landscapeFromReport(report),
      selectedDirectionId,
      onDirectionSelect() {},
      onPrimaryAction() {},
      storageKey: failure,
    }));
    assert.match(markup, failure === "relevance" ? /当前样本与研究问题的相关性不足/ : /纳入记录数量与报告分析分母不一致/);
    assert.match(markup, /rawb-report-export[^>]*disabled/);
    assert.match(markup, /type="radio"[^>]*disabled/);
    assert.match(markup, /rawb-report-primary[^>]*disabled/);
  }
  delete globalThis.localStorage;
});

test("chapter keyboard navigation follows the accessible tab order", () => {
  assert.equal(reportChapterIdForKey("landscape", "ArrowRight"), "trends");
  assert.equal(reportChapterIdForKey("landscape", "ArrowLeft"), "plan");
  assert.equal(reportChapterIdForKey("opportunities", "Home"), "landscape");
  assert.equal(reportChapterIdForKey("trends", "End"), "plan");
  assert.equal(reportChapterIdForKey("trends", "Enter"), null);
});

test("two-round comparison reports sample structure without claiming novelty", () => {
  const landscape = landscapeFromReport();
  const narrowedLandscape = structuredClone(landscape);
  narrowedLandscape.sampledCount = 12;
  narrowedLandscape.researchReport.ledger.analyzedRowCount = 12;
  const comparison = buildScopingRoundComparison(
    { question: "胃癌研究现状", reviewLandscape: landscape },
    { question: "胃癌局部治疗的适应证与结局标准化", reviewLandscape: narrowedLandscape },
  );
  assert.equal(comparison.first.sampledCount, 20);
  assert.equal(comparison.second.sampledCount, 12);
  assert.match(comparison.boundary, /不证明选题创新/);
});

test("scoping draft persistence keeps the first-round checkpoint and decision reasons across refresh", () => {
  const storage = memoryStorage();
  const checkpoint = firstRoundCheckpointFrom({
    queryPlan: { planHash: "plan" },
    queryCalibration: { calibrationHash: "calibration" },
    queryPreview: { planHash: "preview", reviewLandscape: landscapeFromReport() },
    selectedQueryId: "query-1",
    createForm: { question: "胃癌研究现状", searchQuery: "gastric cancer" },
    directionDecision: {
      selectedDirectionId: "review_proposal_prevention_epidemiology",
      selectionReason: "该方向最能降低当前决策不确定性。",
      deferredReason: "其余方向等待竞争综述核查。",
    },
  });
  const draft = {
    createOpen: true,
    createStep: "strategy",
    scopingRound: 2,
    directionDecision: {
      selectedDirectionId: "review_proposal_prevention_epidemiology",
      selectionReason: "该方向最能降低当前决策不确定性。",
      deferredReason: "其余方向等待竞争综述核查。",
    },
    directionSelection: { decisionHash: "decision", roundOneCheckpoint: checkpoint },
  };
  assert.equal(saveScopingDraft(draft, storage), true);
  const restoredDraft = loadScopingDraft(storage);
  assert.deepEqual(restoredDraft.directionDecision, draft.directionDecision);
  const restored = restoredFirstRoundState(restoredDraft.directionSelection);
  assert.equal(restored.createStep, "review");
  assert.equal(restored.queryPreview.planHash, "preview");
  assert.equal(restored.selectedQueryId, "query-1");
  assert.deepEqual(restored.directionDecision, draft.directionDecision);
});

test("rendered report accepts object claim labels, exposes one chapter CTA and one evidence entry, and blocks stale actions", async (t) => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  t.after(() => vite.close());
  const { ResearchReviewReport } = await vite.ssrLoadModule("/src/components/ResearchReviewReport.jsx");
  const landscape = landscapeFromReport();
  const selectedDirectionId = buildResearchReviewReportModel({ landscape }).directions[0].id;
  const storage = memoryStorage();
  globalThis.localStorage = storage;
  t.after(() => { delete globalThis.localStorage; });

  const markup = renderToStaticMarkup(React.createElement(ResearchReviewReport, {
    landscape,
    selectedDirectionId,
    selectionReason: "采用理由充分。",
    deferredReason: "其余方向暂缓。",
    onDirectionSelect() {},
    onSelectionReasonChange() {},
    onDeferredReasonChange() {},
    onPrimaryAction() {},
    storageKey: "render-test",
  }));
  assert.match(markup, /本轮分析 20 篇近五年综述/);
  assert.match(markup, /领域图景与综述选题/);
  assert.match(markup, /这个领域，目前能确定什么/);
  assert.doesNotMatch(markup, /rawb-report-workflow/);
  assert.doesNotMatch(markup, /rawb-report-claim-legend/);
  assert.match(markup, /rawb-report-scope-summary/);
  assert.match(markup, /用途：领域扫描与综述选题/);
  assert.doesNotMatch(markup, /\[object Object\]/);
  assert.equal((markup.match(/rawb-report-primary/g) ?? []).length, 1);
  assert.equal((markup.match(/rawb-report-evidence-entry/g) ?? []).length, 1);

  storage.setItem("opportunities-test:chapter", "opportunities");
  const opportunitiesMarkup = renderToStaticMarkup(React.createElement(ResearchReviewReport, {
    landscape,
    selectedDirectionId,
    onDirectionSelect() {},
    onPrimaryAction() {},
    storageKey: "opportunities-test",
  }));
  assert.match(opportunitiesMarkup, /下一步，哪些研究问题最值得继续验证/);
  assert.match(opportunitiesMarkup, /建议顺位/);
  assert.match(opportunitiesMarkup, /候选题目/);
  assert.match(opportunitiesMarkup, /为什么值得写/);
  assert.match(opportunitiesMarkup, /先比较近两年同题综述/);
  assert.doesNotMatch(opportunitiesMarkup, /竞争风险(?:高|中|低)/);
  assert.match(opportunitiesMarkup, /文献组织主线/);
  assert.match(opportunitiesMarkup, /可行性与工作量/);
  assert.doesNotMatch(opportunitiesMarkup, /样本内覆盖信号/);
  assert.doesNotMatch(opportunitiesMarkup, /放弃或降级条件/);
  assert.match(opportunitiesMarkup, /选题调研优化建议/);
  assert.match(opportunitiesMarkup, new RegExp(`value="${selectedDirectionId}"`));

  storage.setItem("trends-test:chapter", "trends");
  const trendsMarkup = renderToStaticMarkup(React.createElement(ResearchReviewReport, {
    landscape,
    selectedDirectionId,
    storageKey: "trends-test",
  }));
  assert.match(trendsMarkup, /近五年，研究重点如何变化/);
  assert.match(trendsMarkup, /rawb-report-trend-columns/);
  assert.match(trendsMarkup, /近五年的结构性演变/);
  assert.match(trendsMarkup, /从当前样本中直接得到的选题结论/);
  assert.match(trendsMarkup, /不代表全领域发文量/);
  assert.doesNotMatch(trendsMarkup, /rawb-report-analysis-grid/);

  storage.setItem("plan-test:chapter", "plan");
  assert.ok(buildResearchReviewReportModel({ landscape, selectedDirectionId }).selectedDirection);
  const planMarkup = renderToStaticMarkup(React.createElement(ResearchReviewReport, {
    landscape,
    firstRound: { question: "胃癌研究现状", reviewLandscape: landscape },
    secondRound: { question: "胃癌局部治疗的适应证与结局标准化", reviewLandscape: landscape },
    selectedDirectionId,
    selectionReason: "采用理由充分。",
    deferredReason: "其余方向暂缓。",
    onDirectionSelect() {},
    onSelectionReasonChange() {},
    onDeferredReasonChange() {},
    onPrimaryAction() {},
    storageKey: "plan-test",
  }));
  assert.match(planMarkup, /范围定义与 PICO \/ PCC/);
  assert.match(planMarkup, /候选综述方向/);
  assert.match(planMarkup, /首要核查/);
  assert.match(planMarkup, /核心结局/);
  assert.match(planMarkup, /文献组织思路/);
  assert.match(planMarkup, /工作量、执行与降级条件/);

  storage.setItem("stale-test:chapter", "opportunities");
  const staleMarkup = renderToStaticMarkup(React.createElement(ResearchReviewReport, {
    landscape,
    selectedDirectionId,
    onDirectionSelect() {},
    onPrimaryAction() {},
    storageKey: "stale-test",
    currentBinding: { ...gastricReport.binding, sourceSetHash: "f".repeat(64) },
  }));
  assert.match(staleMarkup, /本报告使用的证据版本已不是当前版本/);
  assert.match(staleMarkup, /旧报告只供追溯/);
  assert.match(staleMarkup, /rawb-report-export[^>]*disabled/);
  assert.match(staleMarkup, /type="radio"[^>]*disabled/);
  assert.match(staleMarkup, /rawb-report-primary[^>]*disabled/);
});

test("responsive report CSS includes 390px, 200% zoom, focus, local overflow, and reduced-motion safeguards", () => {
  const css = readFileSync(new URL("../src/components/research-review-report.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 460px\)/);
  assert.match(css, /\.rawb-four-chapter-report\s*\{[\s\S]*?width:\s*100%/);
  assert.match(css, /\.rawb-report-trend-columns\s*\{[\s\S]*?grid-template-columns/);
  assert.match(css, /\.rawb-report-opportunity-list__header/);
  assert.match(css, /\.rawb-report-evidence__table-wrap\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation-duration:\s*0\.01ms\s*!important/);
});
