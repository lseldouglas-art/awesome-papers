import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";
import { sha256 } from "./event-engine-v1.js";

const execFileAsync = promisify(execFile);

import {
  RESEARCH_CLAIM_LABELS,
  assertArtifactResearchReportBinding,
  assertResearchReportBinding,
  assertResearchReportSelectionBinding,
  bindArtifactToResearchReport,
  buildResearchReportContract,
  evaluateResearchSubjectRelevance,
} from "./research-report-contract-v1.js";
import { RESEARCH_REVIEW_CLASSIFIER_VERSION } from "./research-review-synthesis-v1.js";

const GASTRIC_SUBJECT = [{
  conceptId: "subject:gastric",
  sourceTerm: "胃癌",
  role: "subject",
  meshTerms: ["Stomach Neoplasms"],
  mappedTerms: ["gastric cancer", "stomach cancer", "gastric adenocarcinoma"],
}];

const RECORDS = [
  {
    sourceId: "pubmed:1",
    pmid: "1",
    title: "Biomarkers for early detection of gastric cancer: a systematic review",
    abstract: "This systematic review evaluates gastric cancer biomarkers and reports that external validation remains limited.",
    journal: "Journal A",
    year: "2025",
    accessLevel: "abstract_only",
    locator: { pmid: "1" },
  },
  {
    sourceId: "pubmed:2",
    pmid: "2",
    title: "Immunotherapy in gastric adenocarcinoma: a scoping review",
    abstract: "Gastric adenocarcinoma immunotherapy evidence remains heterogeneous.",
    journal: "Journal B",
    year: "2024",
    accessLevel: "abstract_only",
    locator: { pmid: "2" },
  },
];

test("the subject relevance gate blocks a zero-related source set and reports the exact rows", () => {
  const result = evaluateResearchSubjectRelevance({
    subjectConcepts: GASTRIC_SUBJECT,
    records: [{
      sourceId: "pubmed:9",
      title: "Sleep after orthopedic surgery",
      abstract: "A review of postoperative sleep in joint replacement.",
    }],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.relevantCount, 0);
  assert.deepEqual(result.rows.map((row) => row.status), ["not_relevant"]);
  assert.ok(result.blockedArtifactTypes.includes("finalLibrary"));
  assert.ok(result.blockedArtifactTypes.includes("EvidenceRecord"));
  assert.ok(result.blockedArtifactTypes.includes("research_direction"));
});

test("the report ledger recomputes every distribution from the same bound source set", () => {
  const report = buildResearchReportContract({
    projectId: "project:gastric",
    question: "胃癌的研究现状",
    records: RECORDS,
    subjectConcepts: GASTRIC_SUBJECT,
    reportRevision: 3,
    generatedAt: "2026-08-27T00:00:00.000Z",
    reviewWindow: { years: 5, from: "2021-08-27", to: "2026-08-26" },
  });
  assert.equal(report.relevanceGate.status, "passed");
  assert.equal(report.ledger.rowCount, 2);
  assert.equal(report.ledger.analyzedRowCount, 2);
  assert.equal(report.binding.projectId, "project:gastric");
  assert.equal(report.binding.reportRevision, 3);
  assert.equal(report.binding.authority, "project_bound_report");
  assert.notEqual(report.binding.authority, "formal_project");
  assert.equal(report.binding.sourceSetHash, report.ledger.sourceSetHash);
  assert.deepEqual(report.derivedAnalysis.yearDistribution, [
    { label: "2024", count: 1 },
    { label: "2025", count: 1 },
  ]);
  const themeCounts = new Map(report.derivedAnalysis.themeDistribution.map((item) => [item.id, item]));
  for (const [themeId, item] of themeCounts) {
    const expected = report.ledger.rows.filter((row) => row.themeIds.includes(themeId));
    assert.equal(item.count, expected.length);
    assert.deepEqual(item.sourceIds, expected.map((row) => row.sourceId));
  }
  assert.equal(report.claimLabels.sampleObservation.id, RESEARCH_CLAIM_LABELS.sampleObservation.id);
  assert.match(report.derivedAnalysis.boundary, /不外推/);
  assertResearchReportBinding(report, {
    projectId: "project:gastric",
    sourceSetHash: report.binding.sourceSetHash,
    reportRevision: 3,
  });
});

test("report and artifact bindings fail closed when project, source set, or revision changes", () => {
  const report = buildResearchReportContract({
    projectId: "project:gastric",
    question: "胃癌的研究现状",
    records: RECORDS,
    subjectConcepts: GASTRIC_SUBJECT,
    reportRevision: 2,
  });
  assert.throws(
    () => assertResearchReportBinding(report, { projectId: "project:other" }),
    /projectId binding mismatch/,
  );
  const content = bindArtifactToResearchReport({ id: "evidence:1" }, report);
  assertArtifactResearchReportBinding(content, report);
  assert.throws(
    () => assertArtifactResearchReportBinding({
      ...content,
      reportBinding: { ...content.reportBinding, reportRevision: 1 },
    }, report),
    /artifact report binding mismatch/,
  );

  const selection = { reportBinding: structuredClone(report.binding) };
  assertResearchReportSelectionBinding(selection, report);
  assert.throws(() => assertResearchReportSelectionBinding({
    reportBinding: { ...selection.reportBinding, projectId: "project:other" },
  }, report), /projectId binding mismatch/);
  assert.throws(() => assertResearchReportSelectionBinding({
    reportBinding: { ...selection.reportBinding, sourceSetHash: "f".repeat(64) },
  }, report), /sourceSetHash binding mismatch/);
  assert.throws(() => assertResearchReportSelectionBinding({
    reportBinding: { ...selection.reportBinding, reportRevision: 1 },
  }, report), /reportRevision binding mismatch/);
  assert.throws(() => assertResearchReportSelectionBinding({
    reportBinding: { ...selection.reportBinding, reportHash: "e".repeat(64) },
  }, report), /reportHash binding mismatch/);
});

test("report integrity rejects content, inclusion, identifier, and aggregate tampering", () => {
  const report = buildResearchReportContract({
    projectId: "project:gastric-tamper",
    question: "胃癌的研究现状",
    records: RECORDS,
    subjectConcepts: GASTRIC_SUBJECT,
    reportRevision: 1,
  });
  const mutations = [
    (copy) => { copy.ledger.rows[0].title = "Tampered title"; },
    (copy) => { copy.ledger.rows[0].pmid = "999"; },
    (copy) => { copy.ledger.rows[0].sourceSnapshotHash = "a".repeat(64); },
    (copy) => { copy.ledger.rows[0].includedInDerivedAnalysis = false; },
    (copy) => { copy.derivedAnalysis.analyzedSourceIds.reverse(); },
    (copy) => { copy.derivedAnalysis.yearDistribution[0].count += 1; },
    (copy) => { copy.derivedAnalysis.themeDistribution[0].sourceIds = []; },
    (copy) => { copy.derivedAnalysis.reviewSynthesis.professorReport.executiveSummary = "Tampered professor conclusion"; },
    (copy) => {
      copy.externalReviewVerification = {
        schemaVersion: "research-external-review-verification/v1",
        status: "verified",
        receipts: [{ sourceIds: ["pubmed:1"], locators: ["https://example.invalid"] }],
      };
    },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(report);
    mutate(copy);
    delete copy.binding.reportHash;
    copy.binding.reportHash = sha256(copy);
    assert.throws(() => assertResearchReportBinding(copy));
  }
});

test("non-oncology subjects use a generic taxonomy and never inherit oncology resistance templates", () => {
  const report = buildResearchReportContract({
    question: "2型糖尿病胰岛素抵抗的研究现状",
    records: [{
      sourceId: "pubmed:diabetes-1",
      title: "Mechanisms of insulin resistance in type 2 diabetes: a review",
      abstract: "This review examines pathways underlying insulin resistance in type 2 diabetes and discusses clinical outcomes.",
      year: "2025",
    }],
    subjectConcepts: [{
      conceptId: "subject:diabetes",
      sourceTerm: "糖尿病",
      role: "subject",
      mappedTerms: ["type 2 diabetes", "diabetes mellitus"],
      meshTerms: ["Diabetes Mellitus"],
    }],
  });
  assert.equal(report.derivedAnalysis.reviewSynthesis.taxonomyProfile, "generic_safe_v1");
  assert.equal(report.ledger.taxonomyProfile, "generic_safe_v1");
  assert.equal(report.derivedAnalysis.themeDistribution.some((item) => item.id === "resistance_microenvironment"), false);
  assert.doesNotMatch(JSON.stringify(report.derivedAnalysis.reviewSynthesis.professorReport), /肿瘤微环境|肿瘤耐药/);
  assert.ok(report.derivedAnalysis.reviewSynthesis.professorReport.studentReviewDirections.every(
    (proposal) => proposal.id.startsWith("review_proposal_generic_"),
  ));
});

test("generic problem synthesis never leaks gastric or oncology-specific labels", () => {
  const report = buildResearchReportContract({
    question: "2型糖尿病实施与代表性的研究现状",
    records: [
      {
        sourceId: "pubmed:diabetes-rural",
        title: "Representation in type 2 diabetes validation cohorts: a review",
        abstract: "Rural adults with type 2 diabetes are underrepresented, and external validation remains limited.",
        year: "2025",
      },
      {
        sourceId: "pubmed:diabetes-ai",
        title: "Artificial intelligence rehabilitation pathways in type 2 diabetes: a review",
        abstract: "Clinical implementation challenges remain for artificial intelligence rehabilitation pathways in type 2 diabetes.",
        year: "2025",
      },
    ],
    subjectConcepts: [{
      conceptId: "subject:diabetes",
      sourceTerm: "糖尿病",
      role: "subject",
      mappedTerms: ["type 2 diabetes", "diabetes mellitus"],
      meshTerms: ["Diabetes Mellitus"],
    }],
  });
  const problems = report.derivedAnalysis.reviewSynthesis.professorReport.majorProblems;
  assert.ok(problems.some((item) => item.title === "样本人群代表性与外部适用性待核"));
  assert.ok(problems.some((item) => item.title === "从研究证据到实际实施仍有障碍"));
  assert.doesNotMatch(JSON.stringify(problems), /胃癌|早诊|东亚|拉美|非洲|肿瘤/);
  assert.ok(problems.every((item) => (
    item.sourceIds.length > 0
    && item.supportingEvidence.length > 0
    && item.supportingEvidence.every((evidence) => item.sourceIds.includes(evidence.sourceId))
  )));
});

test("non-gastric cancers use generic oncology problems without gastric-specific leakage", () => {
  const cases = [
    {
      label: "乳腺癌",
      term: "breast cancer",
      abstract: "Breast cancer has limited treatment options at advanced stages.",
    },
    {
      label: "肺癌",
      term: "lung cancer",
      abstract: "Artificial intelligence for lung cancer still requires external validation before implementation.",
    },
    {
      label: "结直肠癌",
      term: "colorectal cancer",
      abstract: "Rural adults with colorectal cancer are underrepresented in validation cohorts.",
    },
  ];
  for (const [index, item] of cases.entries()) {
    const report = buildResearchReportContract({
      question: `${item.label}研究现状`,
      records: [{
        sourceId: `pubmed:other-cancer-${index + 1}`,
        title: `${item.term}: a review`,
        abstract: item.abstract,
        year: "2025",
      }],
      subjectConcepts: [{
        conceptId: `subject:other-cancer-${index + 1}`,
        sourceTerm: item.label,
        role: "subject",
        mappedTerms: [item.term],
      }],
    });
    assert.equal(report.ledger.taxonomyProfile, "oncology_generic_v1");
    assert.equal(report.derivedAnalysis.reviewSynthesis.taxonomyProfile, "oncology_generic_v1");
    assert.doesNotMatch(
      JSON.stringify(report.derivedAnalysis.reviewSynthesis.professorReport.majorProblems),
      /胃癌|胃早诊|东亚|拉美|非洲|保胃|前哨/,
    );
  }
  for (const [index, item] of [
    { label: "乳腺癌", term: "breast cancer" },
    { label: "结直肠癌", term: "colorectal cancer" },
  ].entries()) {
    const report = buildResearchReportContract({
      question: `${item.label}研究现状`,
      records: [{
        sourceId: `pubmed:other-cancer-plan-${index + 1}`,
        title: `Early-onset ${item.term} and surgical management: a review`,
        abstract: `This review compares young-onset ${item.term} definitions, surgery, treatment pathways, and long-term outcomes.`,
        year: "2025",
      }],
      subjectConcepts: [{
        conceptId: `subject:other-cancer-plan-${index + 1}`,
        sourceTerm: item.label,
        role: "subject",
        mappedTerms: [item.term],
      }],
    });
    const proposals = report.derivedAnalysis.reviewSynthesis.professorReport.studentReviewDirections;
    const earlyOnset = proposals.find((proposal) => proposal.themeId === "early_onset");
    const localTreatment = proposals.find((proposal) => proposal.themeId === "local_treatment");
    assert.ok(earlyOnset);
    assert.ok(localTreatment);
    assert.equal(earlyOnset.taxonomyProfile, "oncology_generic_v1");
    assert.equal(localTreatment.taxonomyProfile, "oncology_generic_v1");
    assert.match(earlyOnset.suggestedTitle, new RegExp(`^${item.label}[:：]`));
    assert.doesNotMatch(
      JSON.stringify([earlyOnset.suggestedTitle, earlyOnset.reviewPlan, localTreatment.suggestedTitle, localTreatment.reviewPlan]),
      /胃癌|EOGC|保胃|前哨|限定可切除胃/,
    );
  }
});

test("the checked-in gastric fixture is a 20-row, all-relevant, hash-bound auditable ledger", async () => {
  const fixture = JSON.parse(await readFile(
    new URL("./fixtures/gastric-cancer-review-ledger-2021-2026.v1.json", import.meta.url),
    "utf8",
  ));
  assertResearchReportBinding(fixture, {
    projectId: "fixture:gastric-cancer-review-landscape-2021-2026",
    reportRevision: 1,
  });
  assert.equal(fixture.binding.authority, "frozen_pubmed_fixture");
  assert.match(fixture.binding.frozenSourceManifestHash, /^[a-f0-9]{64}$/);
  assert.match(fixture.binding.derivedAnalysisHash, /^[a-f0-9]{64}$/);
  assert.match(fixture.binding.reportHash, /^[a-f0-9]{64}$/);
  assert.equal(fixture.ledger.rowCount, 20);
  assert.equal(fixture.relevanceGate.relevantCount, 20);
  assert.equal(fixture.ledger.classifierVersion, RESEARCH_REVIEW_CLASSIFIER_VERSION);
  assert.equal(fixture.ledger.taxonomyProfile, "gastric_oncology_v1");
  assert.equal(fixture.derivedAnalysis.classifierVersion, RESEARCH_REVIEW_CLASSIFIER_VERSION);
  assert.equal(new Set(fixture.ledger.rows.map((row) => row.pmid)).size, 20);
  assert.deepEqual(
    fixture.ledger.samplingMetadata.windows.map((window) => window.totalHits),
    [546, 571, 510, 632, 591],
  );
  assert.equal(fixture.derivedAnalysis.yearDistribution.reduce((sum, item) => sum + item.count, 0), 20);
  assert.equal("publicationTrend" in fixture.derivedAnalysis, false);
  assert.equal("totalHitsByWindow" in fixture.derivedAnalysis, false);
  assert.match(fixture.derivedAnalysis.boundary, /不外推为全领域发文趋势/);
  for (const theme of fixture.derivedAnalysis.themeDistribution) {
    const expectedIds = fixture.ledger.rows
      .filter((row) => row.includedInDerivedAnalysis && row.themeIds.includes(theme.id))
      .map((row) => row.sourceId);
    assert.equal(theme.count, expectedIds.length);
    assert.deepEqual(theme.sourceIds, expectedIds);
  }
  for (const row of fixture.ledger.rows) {
    assert.match(row.sourceSnapshotHash, /^[a-f0-9]{64}$/);
    assert.equal("abstract" in row, false);
    assert.deepEqual(row.themeIds, row.classifierAudit.themes.map((signal) => signal.id));
    assert.deepEqual(row.methodSignalIds, row.classifierAudit.methods.map((signal) => signal.id));
    assert.deepEqual(row.gapSignalIds, row.classifierAudit.gaps.map((signal) => signal.id));
    assert.deepEqual(row.problemSignalIds, row.classifierAudit.problems.map((signal) => signal.id));
    assert.ok(row.classifierAudit.themes.every((signal) => (
      signal.matches.length > 0
      && signal.matches.every((match) => ["title", "objective", "conclusion"].includes(match.field) && match.term)
    )));
  }
  const aiReview = fixture.ledger.rows.find((row) => row.pmid === "39928093");
  assert.ok(aiReview.themeIds.includes("ai_digital"));
  assert.ok(aiReview.themeIds.includes("early_detection_screening"));
  assert.equal(aiReview.themeIds.includes("toxicity_supportive"), false);
  const expectedActualThemeSignals = [
    ["37649615", "early_detection_screening"],
    ["38176660", "prevention_epidemiology"],
    ["41044644", "biomarkers_molecular"],
    ["37245017", "systemic_treatment"],
    ["36240980", "prevention_epidemiology"],
  ];
  for (const [pmid, themeId] of expectedActualThemeSignals) {
    const row = fixture.ledger.rows.find((item) => item.pmid === pmid);
    assert.ok(row.themeIds.includes(themeId), `${pmid} should include ${themeId}`);
    const audit = row.classifierAudit.themes.find((item) => item.id === themeId);
    assert.ok(audit?.matches?.length > 0, `${pmid} should audit ${themeId}`);
  }
  const earlyDetectionTrend = fixture.derivedAnalysis.reviewSynthesis.temporalSignals
    .find((item) => item.id === "early_detection_screening");
  assert.ok(earlyDetectionTrend.recentCount > 0);
  assert.match(fixture.derivedAnalysis.reviewSynthesis.themeCodingBoundary, /核心目的|核心摘要/);
  assert.match(fixture.derivedAnalysis.reviewSynthesis.themeCodingBoundary, /不等于.*未涉及/);
  assert.deepEqual(
    fixture.derivedAnalysis.reviewSynthesis.unclassifiedThemeSources.sourceIds,
    ["pubmed:40319897", "pubmed:41499132"],
  );
  assert.match(fixture.derivedAnalysis.reviewSynthesis.unclassifiedThemeSources.boundary, /不等于摘要没有涉及/);
  assert.doesNotMatch(
    JSON.stringify(fixture.derivedAnalysis.reviewSynthesis.temporalSignals),
    /近期样本未见/,
  );
  assert.equal(fixture.derivedAnalysis.reviewSynthesis.methodSignals.some((item) => item.id === "heterogeneity_analysis"), false);
  assert.equal(fixture.derivedAnalysis.reviewSynthesis.gapClusters.some((item) => item.id === "limited_evidence"), false);
  const proposals = fixture.derivedAnalysis.reviewSynthesis.professorReport.studentReviewDirections;
  assert.ok(proposals.length >= 3 && proposals.length <= 5);
  assert.equal(new Set(proposals.map((proposal) => proposal.id)).size, proposals.length);
  assert.ok(proposals.every((proposal) => (
    proposal.id.startsWith("review_proposal_")
    && proposal.suggestedTitle.includes("胃癌")
    && proposal.priority
    && proposal.existingCoverage.competitionStatus === "unverified_pending_same_topic_review_search"
    && proposal.existingCoverage.sampleCoverageSignal
    && proposal.incrementalValueHypothesis
    && proposal.whyNotFullyReviewed
    && proposal.reviewPlan
    && proposal.workload
    && proposal.discardConditions.length >= 2
  )));
  assert.ok(fixture.derivedAnalysis.reviewSynthesis.problemClusters.length >= 3);
  assert.ok(fixture.derivedAnalysis.reviewSynthesis.professorReport.majorProblems.length >= 3);
  const majorProblems = new Map(
    fixture.derivedAnalysis.reviewSynthesis.professorReport.majorProblems
      .map((problem) => [problem.id, problem]),
  );
  const professorReport = fixture.derivedAnalysis.reviewSynthesis.professorReport;
  assert.match(professorReport.executiveSummary, /并列出现的代表性领域问题/);
  assert.doesNotMatch(professorReport.executiveSummary, /最常见的领域问题信号是/);
  assert.match(professorReport.majorProblemOrderingBoundary, /不.*科研优先级|没有科研优先级/);
  assert.ok(professorReport.majorProblems.every(
    (problem) => problem.displayRole === "representative_problem_not_priority_rank",
  ));
  const expectedProblemEvidence = [
    ["domain_problem_treatment_sequence", "pubmed:35319717", /optimal sequencing/i],
    ["domain_problem_local_treatment_long_term", "pubmed:35319717", /long-term outcomes/i],
    ["domain_problem_east_asia_transferability", "pubmed:35319717", /rare outside of East Asia/i],
    ["domain_problem_latin_africa_representation", "pubmed:36240980", /underrepresented/i],
    ["domain_problem_immunotherapy_benefit_resistance", "pubmed:38600020", /durable responses/i],
    ["domain_problem_multiomics_biomarker_translation", "pubmed:38892067", /multi-omics/i],
    ["domain_problem_microbiome_definition_translation", "pubmed:38886045", /conceptual haziness/i],
  ];
  for (const [problemId, sourceId, evidencePattern] of expectedProblemEvidence) {
    const problem = majorProblems.get(problemId);
    assert.ok(problem, `missing concrete problem ${problemId}`);
    assert.ok(problem.sourceIds.includes(sourceId));
    const evidence = problem.supportingEvidence.find((item) => item.sourceId === sourceId);
    assert.ok(evidence, `missing ${sourceId} evidence for ${problemId}`);
    assert.match(evidence.excerpt, evidencePattern);
  }
  assert.ok([...majorProblems.values()].every((problem) => (
    problem.supportingEvidence.length > 0
    && problem.supportingEvidence.every((evidence) => problem.sourceIds.includes(evidence.sourceId))
  )));
  assert.ok(new Set(proposals.map((proposal) => proposal.incrementalValueHypothesis)).size >= 3);
  assert.ok(new Set(proposals.map((proposal) => proposal.whyNotFullyReviewed)).size >= 3);
  assert.ok(proposals.every((proposal) => (
    !proposal.problemBasis?.supportingEvidence
    || (
      proposal.problemBasis.sourceIds.includes(proposal.problemBasis.supportingEvidence.sourceId)
      && proposal.sourceIds.includes(proposal.problemBasis.supportingEvidence.sourceId)
      && proposal.problemBasis.supportingEvidence.field === "abstract"
      && proposal.problemBasis.supportingEvidence.excerpt
    )
  )));
  const immunotherapyProposal = proposals.find((proposal) => proposal.themeId === "immunotherapy");
  assert.equal(immunotherapyProposal.problemBasis.supportingEvidence.sourceId, "pubmed:38600020");
  assert.ok(immunotherapyProposal.sourceIds.includes("pubmed:38600020"));
  assert.match(fixture.ledger.reproducibility.statement, /不保存完整出版商摘要/);
  assert.match(fixture.ledger.reproducibility.offlineLimit, /不能声称离线重放/);
  assert.match(fixture.ledger.samplingMetadata.refetchVerification.hashPolicy, /阻断/);
  assert.match(fixture.ledger.samplingMetadata.boundary, /不是随机样本/);
  assert.match(fixture.ledger.samplingMetadata.boundary, /不承诺得到相同顺序/);
  assert.match(fixture.boundary, /内容指纹而非数字签名/);
});

test("the checked-in fixture supports honest clean-clone integrity verification without hidden XML", async () => {
  const script = new URL("./scripts/build-gastric-review-ledger-fixture.mjs", import.meta.url);
  const { stdout } = await execFileAsync(process.execPath, [script.pathname, "--verify-only"]);
  assert.match(stdout, /verified sealed fixture integrity/);
  assert.match(stdout, /raw title\/abstract classifier replay was not performed/);
});
