import assert from "node:assert/strict";
import test from "node:test";

import {
  generatePubMedQueryCandidates,
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
          title: `Sample ${pmid}`,
          abstract: "A bounded abstract for calibration.",
          accessLevel: "abstract_only",
          locator: { pmid, url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` },
        })),
      };
    },
  };
}

test("a Chinese question produces two transparent and comparable PubMed candidates", () => {
  const plan = generatePubMedQueryCandidates({ question: "围术期睡眠与术后恢复有什么关系？" });
  assert.equal(plan.candidates.length, 2);
  assert.match(plan.candidates[0].query, /sleep/);
  assert.match(plan.candidates[0].query, /postoperative/);
  assert.notEqual(plan.candidates[0].query, plan.candidates[1].query);
  assert.ok(plan.mappings.some((mapping) => mapping.sourceTerm === "睡眠"));
});

test("unknown Chinese is disclosed instead of silently invented", () => {
  const plan = generatePubMedQueryCandidates({ question: "星际草本波动是否改变月相恢复？" });
  assert.equal(plan.candidates.length, 2);
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
  assert.equal(calls.length, 2);
  assert.deepEqual(preview.candidates.map((candidate) => candidate.total), [42, 7]);
  assert.equal(preview.candidates[0].samples[0].noiseStatus, "unreviewed");
  assert.match(preview.accessBoundary, /不会建立项目/);
  assert.match(preview.planHash, /^[a-f0-9]{64}$/);
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
