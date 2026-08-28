import assert from "node:assert/strict";
import test from "node:test";

import { analyzeReviewAbstracts } from "./research-review-synthesis-v1.js";

const RECORDS = [
  {
    sourceId: "pubmed:101",
    pmid: "101",
    year: "2026",
    title: "Immunotherapy for non-small cell lung cancer: a systematic review and meta-analysis",
    abstract: "We searched PubMed, Embase, and Cochrane databases and assessed risk of bias. Findings suggest immune checkpoint inhibitors may improve survival. However, substantial heterogeneity and limited evidence remain. Further prospective randomized trials are needed.",
  },
  {
    sourceId: "pubmed:102",
    pmid: "102",
    year: "2025",
    title: "Neoadjuvant immunotherapy and biomarkers in resectable lung cancer: systematic review",
    abstract: "This systematic review followed PRISMA and was registered in PROSPERO. Risk of bias and certainty of evidence were assessed. Results indicate promising pathological response after neoadjuvant immunotherapy. Patient selection biomarkers remain unclear and longer follow-up is needed.",
  },
  {
    sourceId: "pubmed:103",
    pmid: "103",
    year: "2024",
    title: "Targeted therapy and acquired resistance in metastatic lung cancer",
    abstract: "This review summarizes EGFR and KRAS targeted therapy. Resistance mechanisms remain a major challenge and results across studies are inconsistent. Additional high-quality prospective studies are warranted.",
  },
  {
    sourceId: "pubmed:104",
    pmid: "104",
    year: "2023",
    title: "Low-dose CT screening for lung cancer: a scoping review",
    abstract: "We searched MEDLINE and Embase for screening and early detection studies. Real-world evidence is limited and health disparities affect implementation. Standardization of nodule management is needed.",
  },
  {
    sourceId: "pubmed:105",
    pmid: "105",
    year: "2022",
    title: "Quality of life after lung cancer treatment",
    abstract: null,
  },
];

test("review synthesis converts title and abstract samples into traceable topic, method, gap, and question intelligence", () => {
  const synthesis = analyzeReviewAbstracts(RECORDS, {
    reviewWindow: { years: 5, from: "2021/08/17", to: "2026/08/17" },
  });

  assert.equal(synthesis.schemaVersion, "research-review-synthesis/v1");
  assert.equal(synthesis.analysisLevel, "title_abstract");
  assert.equal(synthesis.analyzedSourceCount, 5);
  assert.equal(synthesis.abstractAvailableCount, 4);
  assert.equal(synthesis.titleOnlyCount, 1);

  const immunotherapy = synthesis.themeCoverage.find((item) => item.id === "immunotherapy");
  assert.equal(immunotherapy.count, 2);
  assert.deepEqual(immunotherapy.sourceIds, ["pubmed:101", "pubmed:102"]);
  assert.ok(synthesis.themeCoverage.some((item) => item.id === "early_detection_screening"));
  assert.ok(synthesis.temporalSignals.some((item) => item.id === "immunotherapy"));

  assert.ok(synthesis.methodVisibility.moreCompleteCount >= 2);
  assert.ok(synthesis.methodSignals.some((item) => item.id === "risk_of_bias" && item.count === 2));
  assert.match(synthesis.methodVisibility.boundary, /摘要未报告不能写成没有实施/);

  const heterogeneity = synthesis.gapClusters.find((item) => item.id === "heterogeneity");
  assert.equal(heterogeneity.count, 1);
  assert.deepEqual(heterogeneity.sourceIds, ["pubmed:101"]);
  assert.ok(heterogeneity.evidenceExcerpts[0].text.includes("heterogeneity"));

  assert.ok(synthesis.breakthroughCandidates.length >= 3);
  assert.ok(synthesis.breakthroughCandidates.every((candidate) => candidate.sourceIds.length > 0));
  assert.ok(synthesis.breakthroughCandidates.some((candidate) => /分子分型与生物标志物/.test(candidate.question)));
  assert.match(synthesis.breakthroughCandidates[0].basis, /不是已证实的研究空白/);

  assert.match(synthesis.directionReport.executiveSummary, /可验证方向/);
  assert.equal(synthesis.directionReport.directions.length, synthesis.breakthroughCandidates.length);
  assert.ok(synthesis.directionReport.directions.every((direction) => (
    direction.sourceIds.length > 0
    && direction.studyPlan.studyDesign
    && direction.studyPlan.populationAndComparison
    && direction.studyPlan.coreOutcomes.length >= 3
    && direction.studyPlan.executionSteps.length >= 3
    && /下一轮窄检索/.test(direction.studyPlan.decisionGate)
  )));
  const biomarkerDirection = synthesis.directionReport.directions.find((direction) => direction.direction === "分子分型与生物标志物");
  assert.match(biomarkerDirection.studyPlan.studyDesign, /系统综述/);
  assert.doesNotMatch(biomarkerDirection.studyPlan.studyDesign, /前瞻性|随机试验|队列/);
  assert.ok(biomarkerDirection.studyPlan.coreOutcomes.includes("临床净获益"));
  assert.match(synthesis.directionReport.boundary, /选题假设，不是研究空白定论或临床建议/);

  assert.equal(synthesis.professorReport.schemaVersion, "research-professor-report/v1");
  assert.match(synthesis.professorReport.executiveSummary, /5 篇/);
  assert.ok(synthesis.professorReport.developmentStatus.every((item) => item.sourceIds.length > 0));
  assert.ok(synthesis.professorReport.studentReviewDirections.length >= 3);
  assert.ok(synthesis.professorReport.studentReviewDirections.length <= 5);
  assert.ok(synthesis.professorReport.studentReviewDirections.every((direction) => (
    direction.suggestedTitle
    && direction.sourceIds.length > 0
    && direction.outline.length >= 4
    && /50–100/.test(direction.workload.targetCoreLiterature)
    && /10–12 周/.test(direction.workload.timeline)
    && /下一轮窄检索/.test(direction.verificationGate)
  )));
  assert.equal(synthesis.professorReport.traceability.sourceIds.length, 5);
  const maturity = synthesis.professorReport.developmentStatus.find((item) => item.id === "review_maturity");
  assert.match(maturity.conclusion, /不能据此判断领域成熟度/);
  assert.doesNotMatch(maturity.conclusion, /领域已经存在较多/);
  assert.ok(synthesis.professorReport.studentReviewDirections.every((direction) => (
    direction.noveltyStatus === "unverified_pending_same_topic_review_search"
    && direction.existingCoverage.competitionStatus === "unverified_pending_same_topic_review_search"
    && /不能据此给出竞争风险等级/.test(direction.existingCoverage.interpretation)
    && /创新度与可发表性均为未知/.test(direction.whyPotentiallyValuable)
  )));
  assert.match(synthesis.professorReport.traceability.journalMetricPolicy, /核验/);
  assert.match(synthesis.professorReport.boundary, /题名摘要/);

  const first = synthesis.sourceAnalyses.find((item) => item.sourceId === "pubmed:101");
  assert.match(first.conclusionExcerpt, /improve survival/);
  assert.match(first.gapExcerpt, /heterogeneity/);
  assert.ok(first.methodSignalLabels.includes("报告数据库检索"));

  const titleOnly = synthesis.sourceAnalyses.find((item) => item.sourceId === "pubmed:105");
  assert.equal(titleOnly.methodVisibility, "abstract_unavailable");
  assert.match(titleOnly.boundary, /保持未知/);
  assert.match(synthesis.boundary, /不是全量文献计量、全文质量评价或研究空白定论/);
});

test("evidence indexes remain complete while representative indexes are capped for display", () => {
  const records = Array.from({ length: 13 }, (_, index) => ({
    sourceId: `pubmed:${index + 1}`,
    year: String(2022 + (index % 5)),
    title: `Immunotherapy review ${index + 1}`,
    abstract: "This systematic review evaluates immunotherapy evidence and reports substantial heterogeneity.",
  }));
  const synthesis = analyzeReviewAbstracts(records, { taxonomyProfile: "oncology_v1" });
  const theme = synthesis.themeCoverage.find((item) => item.id === "immunotherapy");
  assert.equal(theme.count, 13);
  assert.equal(theme.sourceIds.length, 13);
  assert.equal(theme.representativeSourceIds.length, 8);
  const gap = synthesis.gapClusters.find((item) => item.id === "heterogeneity");
  assert.equal(gap.count, 13);
  assert.equal(gap.sourceIds.length, 13);
  assert.equal(gap.representativeSourceIds.length, 8);
  assert.equal(synthesis.breakthroughCandidates[0].sourceIds.length, 13);
});

test("clinical limitations are not mislabeled as limited evidence", () => {
  const clinicalOnly = analyzeReviewAbstracts([{
    sourceId: "pubmed:clinical-limit",
    title: "Treatment options in gastric cancer",
    abstract: "Patients have limited treatment options and poor survival after progression.",
    year: "2025",
  }]);
  assert.equal(clinicalOnly.gapClusters.some((item) => item.id === "limited_evidence"), false);

  const evidenceLimited = analyzeReviewAbstracts([{
    sourceId: "pubmed:evidence-limit",
    title: "Treatment evidence in gastric cancer",
    abstract: "Available evidence is limited and only a few studies report long-term outcomes.",
    year: "2025",
  }]);
  assert.equal(evidenceLimited.gapClusters.find((item) => item.id === "limited_evidence")?.count, 1);
});

test("disease-specific lung tokens do not leak into the generic theme classifier", () => {
  const synthesis = analyzeReviewAbstracts([{
    sourceId: "pubmed:lung-token-only",
    title: "LDCT pulmonary nodules, lobectomy, EGFR, ALK and KRAS: an overview",
    abstract: "This overview describes these named tokens without a broader category label.",
    year: "2025",
  }]);
  const classified = new Set(synthesis.themeCoverage.map((item) => item.id));
  assert.equal(classified.has("early_detection_screening"), false);
  assert.equal(classified.has("biomarkers_molecular"), false);
  assert.equal(classified.has("targeted_therapy"), false);
  assert.equal(classified.has("local_treatment"), false);
});

test("biological heterogeneity is not mislabeled as statistical heterogeneity analysis", () => {
  const synthesis = analyzeReviewAbstracts([{
    sourceId: "pubmed:biological-heterogeneity",
    title: "Molecular heterogeneity in gastric cancer",
    abstract: "This review describes intratumoral molecular heterogeneity and clonal diversity in gastric cancer.",
    year: "2025",
  }]);
  assert.equal(synthesis.methodSignals.some((item) => item.id === "heterogeneity_analysis"), false);
});

test("background words do not become core topic codes", () => {
  const synthesis = analyzeReviewAbstracts([{
    sourceId: "pubmed:background-words",
    title: "Advanced workflows for evidence synthesis",
    abstract: "Radiation exposure is discussed as a risk factor. Mortality and incidence are background measures. This mechanism can reduce fatigue at work.",
    year: "2025",
  }]);
  const classified = new Set(synthesis.themeCoverage.map((item) => item.id));
  assert.equal(classified.has("advanced_metastatic"), false);
  assert.equal(classified.has("resistance_microenvironment"), false);
  assert.equal(classified.has("local_treatment"), false);
  assert.equal(classified.has("prevention_epidemiology"), false);
  assert.equal(classified.has("toxicity_supportive"), false);
});

test("method and gap classifiers do not promote domain vocabulary into review-method claims", () => {
  const synthesis = analyzeReviewAbstracts([{
    sourceId: "pubmed:false-method-signals",
    title: "Tumor grade and intratumoral diversity in a national database",
    abstract: "Prospects and limitations are discussed. Heterogeneous studies of intratumoral diversity describe biological subtypes.",
    year: "2025",
  }], { taxonomyProfile: "oncology_v1" });
  assert.equal(synthesis.methodSignals.some((item) => item.id === "certainty_assessment"), false);
  assert.equal(synthesis.methodSignals.some((item) => item.id === "database_search"), false);
  assert.equal(synthesis.gapClusters.some((item) => item.id === "heterogeneity"), false);
  assert.equal(synthesis.problemClusters.some((item) => item.id === "implementation_translation"), false);
});
