import assert from "node:assert/strict";
import test from "node:test";

import { calibratePubMedQueryStrategy } from "./research-query-calibration-v1.js";
import {
  compilePubMedConceptMatrix,
  generatePromptDrivenPubMedQueryPlan,
} from "./research-query-strategy-agent-v1.js";

const MODEL_OUTPUT = Object.freeze({
  concepts: [
    {
      sourceTerm: "围术期",
      role: "context",
      preferredTerms: ["perioperative care"],
      meshTerms: ["Perioperative Care"],
      synonyms: ["perioperative period"],
      wildcardTerms: ["perioperat*", "bad*"],
      proximityTerms: [{ phrase: "perioperative surgical", distance: 4 }],
    },
    {
      sourceTerm: "睡眠",
      role: "phenomenon",
      preferredTerms: ["sleep quality"],
      meshTerms: ["Sleep", "Sleep Wake Disorders"],
      synonyms: ["sleep disturbance", "poor sleep"],
      wildcardTerms: ["insomni*"],
      proximityTerms: [{ phrase: "sleep quality", distance: 3 }],
    },
    {
      sourceTerm: "术后恢复",
      role: "subject",
      preferredTerms: ["postoperative recovery"],
      meshTerms: ["Convalescence"],
      synonyms: ["recovery after surgery"],
      wildcardTerms: ["postoperat*", "recover*"],
      proximityTerms: [{ phrase: "postoperative recovery", distance: 4 }],
    },
  ],
  qualityNotes: ["保留围术期、睡眠和恢复三个概念组。"],
});

function fakeModel(output = MODEL_OUTPUT) {
  return {
    configured: true,
    descriptor: { mode: "live_model", provider: "test", modelId: "test-model" },
    prompts: [],
    async completeJson(prompt) {
      this.prompts.push(prompt);
      return structuredClone(output);
    },
  };
}

test("完整 Prompt 输出被编译为四条完整 PubMed 矩阵路径", () => {
  const matrix = compilePubMedConceptMatrix(MODEL_OUTPUT.concepts);
  assert.deepEqual(matrix.candidates.map((candidate) => candidate.id), [
    "matrix_abc",
    "matrix_ab",
    "matrix_bc",
    "matrix_ac",
  ]);
  assert.match(matrix.candidates[0].query, /"Perioperative Care"\[Mesh\]/);
  assert.match(matrix.candidates[0].query, /perioperat\*\[Title\/Abstract\]/);
  assert.match(matrix.candidates[0].query, /"sleep quality"\[Title\/Abstract:~3\]/);
  assert.doesNotMatch(matrix.candidates[0].query, /bad\*/);
  assert.doesNotMatch(matrix.candidates[0].query, /TITLE-ABS-KEY|\bW\/\d|NEAR\//);
  assert.equal(matrix.candidates[0].includedConceptIds.length, 3);
  assert.equal(matrix.candidates[1].includedConceptIds.length, 2);
});

test("单一概念 Prompt 输出被编译为完整语义群且排除歧义缩写", () => {
  const matrix = compilePubMedConceptMatrix([
    {
      sourceTerm: "胃癌",
      preferredTerms: ["gastric cancer"],
      meshTerms: ["Stomach Neoplasms"],
      synonyms: ["stomach cancer"],
      abbreviations: ["GC"],
      narrowerTerms: ["gastric adenocarcinoma"],
      spellingVariants: ["gastric tumour", "gastric tumor"],
      proximityTerms: [
        { phrase: "cancer stomach", distance: 2 },
        { phrase: "adenocarcinoma stomach", distance: 9 },
      ],
      excludedAmbiguities: ["GC"],
    },
  ]);
  assert.deepEqual(matrix.candidates.map((candidate) => candidate.id), [
    "single_comprehensive",
    "single_new_literature",
    "single_title_focus",
  ]);
  assert.equal(matrix.topicComplexity.type, "single_concept");
  assert.equal(matrix.conceptGroups[0].role, "subject");
  assert.ok(matrix.candidates.every((candidate) => candidate.includedConceptIds[0] === "concept_A"));
  assert.match(matrix.candidates[0].query, /"Stomach Neoplasms"\[Mesh\]/);
  assert.match(matrix.candidates[0].query, /"cancer stomach"\[Title\/Abstract:~3\]/);
  assert.match(matrix.candidates[0].query, /"adenocarcinoma stomach"\[Title\/Abstract:~5\]/);
  assert.doesNotMatch(matrix.candidates[0].query, /\bGC\b/);
  assert.doesNotMatch(matrix.candidates[1].query, /\[Mesh\]/);
  assert.match(matrix.candidates[2].query, /"gastric cancer"\[Title\]/);
  assert.doesNotMatch(matrix.candidates[2].query, /Title\/Abstract|\[Mesh\]/);
});

test("工作台如实区分实时 Prompt 扩词与确定性原则基线", async () => {
  const model = fakeModel();
  const live = await generatePromptDrivenPubMedQueryPlan({
    question: "围术期睡眠质量与术后恢复有什么关系？",
    model,
    now: () => new Date("2026-08-16T00:00:00.000Z"),
  });
  assert.equal(live.promptExecution.status, "completed");
  assert.equal(live.candidates.length, 4);
  assert.equal(model.prompts.length, 1);
  assert.match(model.prompts[0], /同义词、近义词、亚型\/下位词、缩写、英美拼写变体/);
  assert.match(model.prompts[0], /单一概念主题只返回 1 个完整语义群/);
  assert.match(model.prompts[0], /复合概念主题返回 2–3 个核心概念组/);

  const guided = await generatePromptDrivenPubMedQueryPlan({
    question: "围术期睡眠质量与术后恢复有什么关系？",
    model: {
      configured: false,
      descriptor: { mode: "guided_rule", provider: null, modelId: null },
    },
    now: () => new Date("2026-08-16T00:00:00.000Z"),
  });
  assert.equal(guided.promptExecution.status, "baseline_completed");
  assert.match(guided.planner.claim, /检索 Agent 已完成专业词群扩展/);
  assert.match(guided.promptExecution.boundary, /未调用实时模型.*词群仍需人工确认/);
  assert.doesNotMatch(JSON.stringify(guided), /钟教授|钟澄/);
});

test("单一概念前 100 篇反馈只把零概念命中记录列为潜在噪声", async () => {
  const noModel = {
    configured: false,
    descriptor: { mode: "guided_rule", provider: null, modelId: null },
  };
  const plan = await generatePromptDrivenPubMedQueryPlan({
    question: "胃癌的研究现状",
    model: noModel,
    now: () => new Date("2026-08-16T00:00:00.000Z"),
  });
  const records = Array.from({ length: 100 }, (_, index) => ({
    sourceId: `pubmed:${20000000 + index}`,
    pmid: String(20000000 + index),
    title: index < 80 ? `Gastric cancer review ${index}` : `Unrelated clinical topic ${index}`,
    abstract: index < 80 ? "Evidence about stomach cancer and gastric adenocarcinoma." : "Evidence about another field.",
    accessLevel: "abstract_only",
  }));
  const calibration = await calibratePubMedQueryStrategy({
    gateway: {
      async searchPubMed() {
        return {
          total: 100,
          resultIds: records.map((record) => record.pmid),
          executedAt: "2026-08-16T01:00:00.000Z",
        };
      },
      async fetchPubMed() {
        return { records, fetchedAt: "2026-08-16T01:00:01.000Z" };
      },
    },
    question: plan.question,
    plan,
    selectedCandidateId: "single_comprehensive",
    model: noModel,
    now: () => new Date("2026-08-16T01:00:02.000Z"),
  });
  assert.equal(calibration.feedback.expectedConceptCount, 1);
  assert.equal(calibration.feedback.potentialNoiseMaxMatchedConcepts, 0);
  assert.equal(calibration.feedback.potentialNoiseCount, 20);
  assert.match(calibration.feedback.potentialNoiseDefinition, /未字面命中当前单一概念组/);
});

test("前 100 篇反馈先读取真实题名摘要，再执行第二轮 Prompt", async () => {
  const initialModel = fakeModel();
  const plan = await generatePromptDrivenPubMedQueryPlan({
    question: "围术期睡眠质量与术后恢复有什么关系？",
    model: initialModel,
    now: () => new Date("2026-08-16T00:00:00.000Z"),
  });
  const calls = [];
  const records = Array.from({ length: 100 }, (_, index) => ({
    sourceId: `pubmed:${10000000 + index}`,
    pmid: String(10000000 + index),
    title: index < 70
      ? `Perioperative sleep quality and postoperative recovery study ${index}`
      : `Unrelated clinical topic ${index}`,
    abstract: index < 80 ? "Sleep disturbance during perioperative care may relate to recovery after surgery." : null,
    accessLevel: index < 80 ? "abstract_only" : "title_only",
  }));
  const gateway = {
    async searchPubMed({ query, limit }) {
      calls.push({ kind: "search", query, limit });
      return {
        total: 812,
        resultIds: records.map((record) => record.pmid),
        executedAt: "2026-08-16T01:00:00.000Z",
      };
    },
    async fetchPubMed({ resultIds }) {
      calls.push({ kind: "fetch", count: resultIds.length });
      return { records, fetchedAt: "2026-08-16T01:00:01.000Z" };
    },
  };
  const revisionModel = fakeModel();
  const calibration = await calibratePubMedQueryStrategy({
    gateway,
    question: plan.question,
    plan,
    selectedCandidateId: "matrix_abc",
    model: revisionModel,
    now: () => new Date("2026-08-16T01:00:02.000Z"),
  });

  assert.equal(calls[0].limit, 100);
  assert.equal(calls[1].count, 100);
  assert.equal(calibration.feedback.sampledCount, 100);
  assert.equal(calibration.feedback.abstractAvailableCount, 80);
  assert.equal(calibration.revision.status, "completed");
  assert.equal(calibration.revisedPlan.candidates.length, 4);
  assert.equal(calibration.sources.length, 12);
  assert.equal(revisionModel.prompts.length, 1);
  assert.match(revisionModel.prompts[0], /当前排序前 100 条题名与可用摘要/);
  assert.match(calibration.accessBoundary, /未访问全文/);
});
