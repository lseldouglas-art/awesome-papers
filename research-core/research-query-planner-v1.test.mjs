import assert from "node:assert/strict";
import test from "node:test";

import {
  generatePubMedQueryPlan,
  generatePubMedQueryCandidates,
  inferResearchSubjectConcepts,
  previewPubMedQueryPlan,
} from "./research-query-planner-v1.js";

function gatewayFor(searchImpl) {
  return {
    searchPubMed: searchImpl,
    async fetchPubMed({ resultIds }) {
      return {
        fetchedAt: "2026-08-13T01:00:01.000Z",
        records: resultIds.map((pmid) => ({
          sourceId: `pubmed:${pmid}`,
          pmid,
          title: `Sleep and postoperative recovery review ${pmid}`,
          abstract: pmid === "1"
            ? "A systematic review and meta-analysis of sleep and postoperative recovery evidence."
            : "A scoping review of sleep and recovery after surgery.",
          journal: "Journal of Bounded Reviews",
          year: pmid === "1" ? "2026" : "2025",
          accessLevel: "abstract_only",
          locator: { pmid, url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` },
        })),
      };
    },
  };
}

test("a Chinese question produces a professional MeSH/free-text matrix with comparable paths", () => {
  const plan = generatePubMedQueryCandidates({ question: "围术期睡眠与术后恢复有什么关系？" });
  assert.deepEqual(plan.candidates.map((candidate) => candidate.id), [
    "matrix_abc",
    "matrix_ab",
    "matrix_bc",
    "matrix_ac",
  ]);
  assert.match(plan.candidates[0].query, /sleep/);
  assert.match(plan.candidates[0].query, /postoperative/);
  assert.match(plan.candidates[0].query, /\[Mesh\]/);
  assert.match(plan.candidates[0].query, /\[Title\/Abstract\]/);
  assert.notEqual(plan.candidates[0].query, plan.candidates[1].query);
  assert.ok(plan.mappings.some((mapping) => mapping.sourceTerm === "睡眠"));
  assert.ok(plan.conceptGroups.every((group) => group.roleLabel));
});

test("recognized compound concepts are not split into misleading unknown fragments", () => {
  const plan = generatePubMedQueryCandidates({
    question: "围术期睡眠质量与术后恢复之间有什么关系？",
  });
  assert.ok(plan.mappings.some((mapping) => mapping.sourceTerm === "睡眠质量"));
  assert.equal(plan.unknownChinese.includes("质量"), false);
  assert.match(plan.candidates[0].query, /"sleep quality"\[Title\/Abstract\]/);
});

test("query planning is a no-retrieval human confirmation step with a rolling five-year review contract", () => {
  const plan = generatePubMedQueryPlan({
    question: "睡眠与术后恢复有什么关系？",
    now: () => new Date("2026-08-15T00:00:00.000Z"),
  });
  assert.equal(plan.schemaVersion, "research-query-plan/v2");
  assert.equal(plan.reviewWindow.from, "2021/08/15");
  assert.equal(plan.reviewWindow.to, "2026/08/15");
  assert.match(plan.reviewWindow.publicationTypeClause, /systematic\[sb\]/);
  assert.match(plan.reviewWindow.publicationTypeClause, /NOT guideline\[Publication Type\]/i);
  assert.match(plan.accessBoundary, /不访问 PubMed/);
  assert.match(plan.planHash, /^[a-f0-9]{64}$/);
});

test("unknown Chinese is disclosed instead of silently invented", () => {
  const plan = generatePubMedQueryCandidates({ question: "星际草本波动是否改变月相恢复？" });
  assert.equal(plan.candidates.length, 3);
  assert.equal(plan.mappings.length, 1);
  assert.ok(plan.unknownChinese.length > 0);
  assert.ok(plan.candidates.every((candidate) => !candidate.query.includes("lunar medicine")));
});

test("specific cancer and fatigue concepts are preserved instead of collapsing to generic cancer", () => {
  const plan = generatePubMedQueryCandidates({
    question: "针灸是否能改善乳腺癌患者化疗相关疲乏？",
  });
  assert.ok(plan.mappings.some((mapping) => mapping.sourceTerm === "乳腺癌"));
  assert.ok(plan.mappings.some((mapping) => mapping.sourceTerm === "化疗相关疲乏"));
  assert.ok(plan.mappings.some((mapping) => mapping.sourceTerm === "针灸"));
  assert.match(plan.candidates[0].query, /breast cancer/);
  assert.match(plan.candidates[0].query, /chemotherapy-related fatigue/);
  assert.equal(plan.unknownChinese.length, 0);
});

test("gastric cancer landscape uses one complete specialty concept instead of generic cancer", () => {
  const plan = generatePubMedQueryCandidates({ question: "胃癌的研究现状" });
  assert.deepEqual(plan.mappings.map((mapping) => mapping.sourceTerm), ["胃癌"]);
  assert.equal(plan.topicComplexity.type, "single_concept");
  assert.equal(plan.searchIntent.id, "field_landscape");
  assert.deepEqual(plan.searchIntent.sourceTerms, ["研究现状"]);
  assert.equal(plan.unknownChinese.length, 0);
  assert.deepEqual(plan.candidates.map((candidate) => candidate.id), [
    "single_comprehensive",
    "single_new_literature",
    "single_title_focus",
  ]);
  const query = plan.candidates[0].query;
  assert.match(query, /"Stomach Neoplasms"\[Mesh\]/);
  assert.match(query, /"gastric cancer"\[Title\/Abstract\]/);
  assert.match(query, /"stomach cancer"\[Title\/Abstract\]/);
  assert.match(query, /"gastric adenocarcinoma"\[Title\/Abstract\]/);
  assert.match(query, /"gastric tumour"\[Title\/Abstract\]/);
  assert.match(query, /\[Title\/Abstract:~[3-5]\]/);
  assert.doesNotMatch(query, /"Neoplasms"\[Mesh\]/);
  assert.doesNotMatch(query, /(?:^| OR )(?:neoplasm|cancer)\[Title\/Abstract\]/);
  assert.doesNotMatch(query, /\bGC\b|现状/);
});

test("lung cancer landscape produces a professional specialty query instead of a two-term starter", () => {
  const plan = generatePubMedQueryCandidates({ question: "肺癌的研究现状" });
  assert.deepEqual(plan.mappings.map((mapping) => mapping.sourceTerm), ["肺癌"]);
  assert.equal(plan.topicComplexity.type, "single_concept");
  assert.equal(plan.searchIntent.id, "field_landscape");
  assert.equal(plan.unknownChinese.length, 0);
  assert.deepEqual(plan.candidates.map((candidate) => candidate.label), [
    "推荐检索式",
    "补充新文献",
    "题名高精度抽查",
  ]);

  const concept = plan.conceptGroups[0];
  assert.deepEqual(concept.meshTerms, [
    "Lung Neoplasms",
    "Carcinoma, Bronchogenic",
    "Carcinoma, Non-Small-Cell Lung",
    "Small Cell Lung Carcinoma",
    "Adenocarcinoma of Lung",
  ]);
  assert.ok(concept.freeTextTerms.length >= 24);

  const query = plan.candidates[0].query;
  assert.match(query, /"Lung Neoplasms"\[Mesh\]/);
  assert.match(query, /"Carcinoma, Non-Small-Cell Lung"\[Mesh\]/);
  assert.match(query, /"Small Cell Lung Carcinoma"\[Mesh\]/);
  assert.match(query, /"pulmonary cancer"\[Title\/Abstract\]/);
  assert.match(query, /NSCLC\[Title\/Abstract\]/);
  assert.match(query, /SCLC\[Title\/Abstract\]/);
  assert.match(query, /"lung adenocarcinoma"\[Title\/Abstract\]/);
  assert.match(query, /"lung squamous cell carcinoma"\[Title\/Abstract\]/);
  assert.match(query, /"lung cancer"\[Title\/Abstract:~3\]/);
  assert.doesNotMatch(query, /(?:^|\s)LC\[Title\/Abstract\]/);
  assert.doesNotMatch(query, /现状/);
  assert.ok(query.length <= 2000);
});

test("unlisted cancers remain fully unknown instead of collapsing to generic neoplasms", () => {
  const plan = generatePubMedQueryCandidates({ question: "胰腺癌的研究现状" });
  assert.equal(plan.mappings.length, 0);
  assert.ok(plan.unknownChinese.includes("胰腺癌"));
  assert.ok(plan.candidates.every((candidate) => !candidate.query.includes('"Neoplasms"[Mesh]')));
});

test("compound cancer-fatigue concepts win over generic cancer terms", () => {
  for (const question of ["癌症相关疲乏的研究现状", "肿瘤相关疲乏的研究现状"]) {
    const plan = generatePubMedQueryCandidates({ question });
    assert.deepEqual(plan.mappings.map((mapping) => mapping.sourceTerm), ["癌因性疲乏"]);
    assert.equal(plan.unknownChinese.length, 0);
    assert.match(plan.candidates[0].query, /cancer-related fatigue/);
  }
});

test("progression and incidence-trend wording is not silently deleted as research intent", () => {
  for (const question of ["进展期胃癌的治疗", "胃癌发病趋势"]) {
    const plan = generatePubMedQueryCandidates({ question });
    assert.equal(plan.searchIntent, null);
    assert.ok(plan.unknownChinese.length > 0);
    assert.ok(plan.mappings.some((mapping) => mapping.sourceTerm === "胃癌"));
  }
});

test("preview executes every candidate and returns real counts and unfiltered samples", async () => {
  const calls = [];
  const gateway = gatewayFor(async ({ query, limit }) => {
    calls.push({ query, limit });
    return {
      query,
      total: query.includes(" OR ") ? 42 : 7,
      resultIds: query.includes(" OR ") ? ["1", "2", "3"] : ["4", "5"],
      executedAt: "2026-08-13T01:00:00.000Z",
    };
  });
  const preview = await previewPubMedQueryPlan({
    gateway,
    question: "睡眠与术后恢复有什么关系？",
    now: () => new Date("2026-08-13T01:00:02.000Z"),
  });
  assert.equal(calls.length, preview.candidates.length);
  assert.ok(preview.candidates.every((candidate) => candidate.total === 42 || candidate.total === 7));
  assert.equal(preview.candidates[0].samples[0].noiseStatus, "unreviewed");
  assert.match(preview.accessBoundary, /不会建立项目/);
  assert.match(preview.planHash, /^[a-f0-9]{64}$/);
});

test("confirmed strategy adds a five-year PubMed review landscape and bounded stage brief", async () => {
  const calls = [];
  const preview = await previewPubMedQueryPlan({
    gateway: gatewayFor(async ({ query, limit }) => {
      calls.push({ query, limit });
      return {
        query,
        total: query.includes("Date - Publication") ? 18 : 64,
        resultIds: ["1", "2"],
        executedAt: "2026-08-15T01:00:00.000Z",
      };
    }),
    question: "睡眠与术后恢复有什么关系？",
    candidateQueries: [
      { id: "confirmed", label: "已确认策略", query: "sleep[Title/Abstract] AND recovery[Title/Abstract]" },
    ],
    reviewScanCandidateId: "confirmed",
    reviewWindowYears: 5,
    reviewSampleLimit: 20,
    now: () => new Date("2026-08-15T01:00:02.000Z"),
  });
  assert.equal(calls.length, 7);
  assert.match(calls[1].query, /review\[Publication Type\]/);
  assert.match(calls[1].query, /2021\/08\/15/);
  assert.equal(preview.reviewLandscape.status, "ready");
  assert.equal(preview.reviewLandscape.total, 18);
  assert.deepEqual(preview.reviewLandscape.yearDistribution.map((item) => item.label), ["2026", "2025"]);
  assert.equal(preview.reviewLandscape.synthesis.schemaVersion, "research-review-synthesis/v1");
  assert.equal(preview.reviewLandscape.synthesis.analysisLevel, "title_abstract");
  assert.equal(preview.reviewLandscape.synthesis.analyzedSourceCount, 2);
  assert.ok(preview.reviewLandscape.synthesis.methodSignals.length > 0);
  assert.ok(preview.reviewLandscape.sources.every((source) => source.abstractAnalysis));
  assert.equal(preview.reviewLandscape.samplingStrategy.id, "method_focused_rolling_windows");
  assert.equal(preview.reviewLandscape.samplingStrategy.buckets.length, 5);
  assert.match(preview.reviewLandscape.samplingStrategy.boundary, /不承诺得到相同顺序/);
  assert.match(preview.reviewLandscape.stageBrief.evidenceBoundary, /不是全量文献计量/);
});

test("zero-result and failed candidates remain explicit in the same plan", async () => {
  const preview = await previewPubMedQueryPlan({
    gateway: gatewayFor(async ({ query }) => {
      if (query === "broken query") throw Object.assign(new Error("offline"), { code: "PUBMED_SEARCH_FAILED" });
      return { query, total: 0, resultIds: [], executedAt: "2026-08-13T01:00:00.000Z" };
    }),
    question: "未知研究问题是否相关？",
    candidateQueries: [
      { id: "zero", label: "零结果", query: "zero query" },
      { id: "broken", label: "失败", query: "broken query" },
    ],
  });
  assert.equal(preview.candidates[0].status, "zero_results");
  assert.equal(preview.candidates[1].status, "failed");
  assert.equal(preview.candidates[1].error.code, "PUBMED_SEARCH_FAILED");
});

test("legacy subject concepts are derived only when the research object is explicit", () => {
  const gastric = inferResearchSubjectConcepts({ question: "胃癌的研究现状" });
  assert.equal(gastric.status, "derived");
  assert.deepEqual(gastric.concepts.map((concept) => concept.sourceTerm), ["胃癌"]);
  assert.equal(gastric.concepts.every((concept) => concept.role === "subject"), true);

  const unknown = inferResearchSubjectConcepts({ question: "罕见未知综合征的研究现状" });
  assert.equal(unknown.status, "unresolved");
  assert.deepEqual(unknown.concepts, []);
  assert.match(unknown.reason, /请重新确认研究对象/);
});

test("a zero-related review scan is API-ready blocked data and exposes no synthesis directions", async () => {
  const gateway = {
    async searchPubMed({ query }) {
      return {
        provider: "pubmed",
        query,
        total: 1,
        resultIds: ["999"],
        executedAt: "2026-08-27T00:00:00.000Z",
      };
    },
    async fetchPubMed() {
      return {
        provider: "pubmed",
        fetchedAt: "2026-08-27T00:00:01.000Z",
        records: [{
          sourceId: "pubmed:999",
          pmid: "999",
          title: "Sleep after orthopedic surgery: a systematic review",
          abstract: "This review evaluates postoperative sleep after joint replacement.",
          accessLevel: "abstract_only",
          locator: { pmid: "999", url: "https://pubmed.ncbi.nlm.nih.gov/999/" },
        }],
      };
    },
  };
  const preview = await previewPubMedQueryPlan({
    gateway,
    question: "胃癌的研究现状",
    candidateQueries: [{ id: "gastric", label: "胃癌检索", query: '"gastric cancer"[Title]' }],
    reviewScanCandidateId: "gastric",
    now: () => new Date("2026-08-27T00:00:02.000Z"),
  });
  assert.equal(preview.reviewLandscape.status, "relevance_blocked");
  assert.equal(preview.reviewLandscape.researchReport.relevanceGate.status, "blocked");
  assert.equal(preview.reviewLandscape.researchReport.relevanceGate.relevantCount, 0);
  assert.equal(preview.reviewLandscape.synthesis, null);
  assert.equal(preview.reviewLandscape.directionReport, undefined);
});
