import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  assertValidResearchDirectionSelection,
  buildResearchDirectionSelection,
  validateResearchDirectionSelection,
} from "./research-direction-selection-v1.js";
import { buildResearchReportContract } from "./research-report-contract-v1.js";

function previewFixture() {
  return {
    planHash: "a".repeat(64),
    question: "肺癌研究现状",
    candidates: [{ status: "ready", query: "lung neoplasms" }],
    reviewLandscape: {
      query: "lung neoplasms AND review[Publication Type]",
      synthesis: {
        directionReport: {
          directions: [
            {
              id: "direction_biomarker",
              themeId: "biomarkers_molecular",
              direction: "分子分型与生物标志物",
              recommendedQuestion: "肺癌分子标志物对治疗反应预测的证据现状如何？",
              whySuitable: "摘要明确报告患者选择仍不确定。",
              sourceIds: ["pubmed:1"],
              studyPlan: {
                studyDesign: "系统综述或前瞻性验证研究",
                populationAndComparison: "按标志物状态分层的肺癌人群",
                coreOutcomes: ["治疗反应", "总生存期"],
              },
            },
            {
              id: "direction_local",
              direction: "局部治疗",
              recommendedQuestion: "肺癌局部治疗的比较效果如何？",
            },
          ],
        },
      },
    },
  };
}

function reviewPreviewFixture() {
  const preview = previewFixture();
  preview.question = "胃癌研究现状";
  preview.candidates = [{ status: "ready", query: "stomach neoplasms" }];
  preview.reviewLandscape.researchReport = buildResearchReportContract({
    question: preview.question,
    records: [{
      sourceId: "pubmed:gastric-1",
      title: "Biomarkers in gastric cancer: a systematic review",
      abstract: "This systematic review evaluates biomarkers in gastric cancer and reports heterogeneous thresholds.",
      year: "2025",
    }],
    subjectConcepts: [{
      conceptId: "subject:gastric",
      sourceTerm: "胃癌",
      role: "subject",
      mappedTerms: ["gastric cancer", "stomach cancer"],
      meshTerms: ["Stomach Neoplasms"],
    }],
    reportRevision: 1,
  });
  preview.reviewLandscape.synthesis = preview.reviewLandscape.researchReport
    .derivedAnalysis.reviewSynthesis;
  return preview;
}

test("a human direction decision is hash-bound and produces a bounded narrower question", () => {
  const decision = buildResearchDirectionSelection({
    preview: previewFixture(),
    selectedDirectionId: "direction_biomarker",
    selectionReason: "更贴近本轮可获得的数据与团队能力。",
    deferredReason: "先保留为备选，等待第二轮范围比较。",
    actor: { id: "researcher-1", role: "human_researcher", kind: "human" },
    selectedAt: "2026-08-22T08:00:00.000Z",
  });

  assert.equal(decision.selectedDirection.direction, "分子分型与生物标志物");
  assert.equal(decision.deferredDirections.length, 1);
  assert.equal(decision.narrowedBrief.question, "肺癌：肺癌分子标志物对治疗反应预测的证据现状如何?");
  assert.match(decision.narrowedBrief.suggestedQuery, /lung neoplasms.*biomarker/is);
  assert.deepEqual(decision.narrowedBrief.focusMapping, {
    conceptId: "biomarkers_molecular",
    sourceTerm: "分子分型与生物标志物",
    role: "selected_direction",
    meshTerms: ["Biomarkers"],
    mappedTerms: ["biomarker", "molecular", "genomic", "mutation"],
    wildcardTerms: [],
    proximityTerms: [],
  });
  assert.match(decision.narrowedBrief.evidenceBoundary, /第二轮同题综述窄检索假设/);
  assert.match(decision.decisionHash, /^[a-f0-9]{64}$/);
  assert.doesNotThrow(() => assertValidResearchDirectionSelection(decision));
});

test("explicit orientation-title variants still narrow to the selected direction", () => {
  const variants = ["肺癌的研究进展如何？", "肺癌研究概况？", "肺癌趋势"];
  for (const question of variants) {
    const preview = previewFixture();
    preview.question = question;
    const decision = buildResearchDirectionSelection({
      preview,
      selectedDirectionId: "direction_biomarker",
      selectionReason: "这个方向值得优先校准。",
      deferredReason: "其他方向本轮暂缓。",
      actor: { id: "researcher-1", role: "human_researcher", kind: "human" },
      selectedAt: "2026-08-23T00:05:00.000Z",
    });
    assert.match(decision.narrowedBrief.question, /^肺癌：肺癌分子标志物/);
  }
});

test("an already structured research question is not diluted by a generic direction template", () => {
  const preview = previewFixture();
  preview.question = "在接受同一一线 PD-1/PD-L1 抑制剂方案的 IV 期非小细胞肺癌成人中，治疗前血浆 sPD-L1 加入组织 PD-L1 TPS 与预设临床变量模型后，能否改善 12 个月无进展生存风险预测的校准、区分度与临床净获益？";
  preview.reviewLandscape.synthesis.directionReport.directions[0].recommendedQuestion =
    "在分子标志物中，哪些可重复验证的标志物能够预测获益与风险？";

  const decision = buildResearchDirectionSelection({
    preview,
    selectedDirectionId: "direction_biomarker",
    selectionReason: "保留研究者已经冻结的具体人群、比较条件与结局。",
    deferredReason: "其他方向本轮暂缓。",
    actor: { id: "researcher-1", role: "human_researcher", kind: "human" },
    selectedAt: "2026-08-23T00:10:00.000Z",
  });

  assert.equal(decision.narrowedBrief.question, preview.question.normalize("NFKC"));
  assert.doesNotMatch(decision.narrowedBrief.question, /哪些可重复验证/);
  assert.match(decision.narrowedBrief.suggestedQuery, /lung neoplasms.*biomarker/is);
  assert.doesNotThrow(() => assertValidResearchDirectionSelection(decision));
});

test("non-orientation wording remains researcher-authored even when it mentions research status", () => {
  const preview = previewFixture();
  preview.question = "在肺癌研究现状仍不确定的情况下，sPD-L1 能否改善风险预测？";
  const expected = preview.question.normalize("NFKC").trim();
  const decision = buildResearchDirectionSelection({
    preview,
    selectedDirectionId: "direction_biomarker",
    selectionReason: "保留研究者明确提出的问题。",
    deferredReason: "其他方向本轮暂缓。",
    actor: { id: "researcher-1", role: "human_researcher", kind: "human" },
    selectedAt: "2026-08-23T00:15:00.000Z",
  });
  assert.equal(decision.narrowedBrief.question, expected);
});

test("a missing recommendation preserves specific questions and keeps the broad-topic fallback", () => {
  const specificPreview = previewFixture();
  specificPreview.question = "sPD-L1 是否与 12 个月无进展生存风险相关？";
  specificPreview.reviewLandscape.synthesis.directionReport.directions[0].recommendedQuestion = "";
  const specificDecision = buildResearchDirectionSelection({
    preview: specificPreview,
    selectedDirectionId: "direction_biomarker",
    selectionReason: "保留具体问题。",
    deferredReason: "其他方向本轮暂缓。",
    actor: { id: "researcher-1", role: "human_researcher", kind: "human" },
    selectedAt: "2026-08-23T00:20:00.000Z",
  });
  assert.equal(
    specificDecision.narrowedBrief.question,
    specificPreview.question.normalize("NFKC").trim(),
  );

  const broadPreview = previewFixture();
  broadPreview.reviewLandscape.synthesis.directionReport.directions[0].recommendedQuestion = "";
  const broadDecision = buildResearchDirectionSelection({
    preview: broadPreview,
    selectedDirectionId: "direction_biomarker",
    selectionReason: "保留旧的宽主题后备路径。",
    deferredReason: "其他方向本轮暂缓。",
    actor: { id: "researcher-1", role: "human_researcher", kind: "human" },
    selectedAt: "2026-08-23T00:25:00.000Z",
  });
  assert.equal(
    broadDecision.narrowedBrief.question,
    "肺癌研究现状；第二轮聚焦：分子分型与生物标志物",
  );
});

test("direction decisions reject invented candidates and tampering", () => {
  assert.throws(() => buildResearchDirectionSelection({
    preview: previewFixture(),
    selectedDirectionId: "invented",
    selectionReason: "理由足够明确。",
    deferredReason: "其他方向本轮暂缓。",
    actor: { id: "researcher-1", role: "human_researcher", kind: "human" },
  }), /实际存在/);

  const decision = buildResearchDirectionSelection({
    preview: previewFixture(),
    selectedDirectionId: "direction_local",
    selectionReason: "更符合当前研究目标。",
    deferredReason: "其他方向本轮暂缓。",
    actor: { id: "researcher-1", role: "human_researcher", kind: "human" },
  });
  decision.selectionReason = "事后篡改";
  assert.match(validateResearchDirectionSelection(decision).join("; "), /decisionHash/);
});

test("the current workbench selects review topics before legacy original-research directions", () => {
  const preview = reviewPreviewFixture();
  const decision = buildResearchDirectionSelection({
    preview,
    selectedDirectionId: "review_proposal_biomarkers_molecular",
    selectionReason: "问题边界与团队综述能力匹配。",
    deferredReason: "其他题目先完成同题综述核查。",
    actor: { id: "researcher-1", role: "human_researcher", kind: "human" },
    selectedAt: "2026-08-27T08:00:00.000Z",
  });
  assert.equal(decision.selectedDirection.directionKind, "review_topic");
  assert.match(decision.selectedDirection.suggestedTitle, /^胃癌[:：].*生物标志物/);
  assert.deepEqual(decision.selectedDirection.outline, ["标志物用途与检测平台", "阈值、采样时间和人群差异", "开发队列与独立外部验证", "预测价值、临床净获益与实施门槛"]);
  assert.match(decision.narrowedBrief.reviewType, /系统综述/);
  assert.match(decision.narrowedBrief.verificationGate, /近两年同题综述/);
  assert.doesNotMatch(decision.narrowedBrief.reviewType, /前瞻性|随机试验|队列/);
  assert.deepEqual(decision.reportBinding, preview.reviewLandscape.researchReport.binding);
  assert.doesNotThrow(() => assertValidResearchDirectionSelection(decision, {
    researchReport: preview.reviewLandscape.researchReport,
  }));
  assert.throws(() => buildResearchDirectionSelection({
    preview,
    selectedDirectionId: "direction_biomarker",
    selectionReason: "尝试选择旧的原始研究方向。",
    deferredReason: "其他题目暂缓。",
    actor: { id: "researcher-1", role: "human_researcher", kind: "human" },
  }), /实际存在/);
});

test("a non-oncology review proposal never appends neoplasm-specific focus terms", () => {
  const researchReport = buildResearchReportContract({
    question: "2型糖尿病胰岛素抵抗的研究现状",
    records: [{
      sourceId: "pubmed:diabetes-1",
      title: "Mechanisms of insulin resistance in type 2 diabetes: a review",
      abstract: "This review examines pathways underlying insulin resistance in type 2 diabetes and clinical outcomes.",
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
  const proposal = researchReport.derivedAnalysis.reviewSynthesis.professorReport.studentReviewDirections[0];
  const preview = {
    planHash: "b".repeat(64),
    question: "2型糖尿病胰岛素抵抗的研究现状",
    candidates: [{ status: "ready", query: '"type 2 diabetes"[Title/Abstract] AND "insulin resistance"[Title/Abstract]' }],
    reviewLandscape: {
      researchReport,
      synthesis: researchReport.derivedAnalysis.reviewSynthesis,
    },
  };
  const decision = buildResearchDirectionSelection({
    preview,
    selectedDirectionId: proposal.id,
    selectionReason: "采用通用机制证据综述框架。",
    deferredReason: "其他通用主题留待下一轮比较。",
    actor: { id: "researcher-1", role: "human_researcher", kind: "human" },
  });
  assert.equal(decision.selectedDirection.directionKind, "review_topic");
  assert.doesNotMatch(decision.narrowedBrief.suggestedQuery, /Neoplasm|Drug Resistance/i);
  assert.doesNotMatch(JSON.stringify(decision), /肿瘤微环境|肿瘤耐药/);
});

test("the frozen gastric early-onset proposal produces a genuinely narrower second-round query", async () => {
  const researchReport = JSON.parse(await readFile(
    new URL("./fixtures/gastric-cancer-review-ledger-2021-2026.v1.json", import.meta.url),
    "utf8",
  ));
  const proposal = researchReport.derivedAnalysis.reviewSynthesis.professorReport
    .studentReviewDirections.find((item) => item.themeId === "early_onset");
  assert.ok(proposal, "the audited gastric portfolio should contain the early-onset proposal");
  const sourceQuery = '"gastric cancer"[Title/Abstract] AND review[Publication Type]';
  const preview = {
    planHash: "c".repeat(64),
    question: "胃癌研究现状",
    candidates: [{ id: "orientation", status: "ready", query: sourceQuery }],
    reviewLandscape: {
      selectedCandidateId: "orientation",
      researchReport,
      synthesis: researchReport.derivedAnalysis.reviewSynthesis,
    },
  };
  const decision = buildResearchDirectionSelection({
    preview,
    selectedDirectionId: proposal.id,
    selectionReason: "定义与年龄界值具有明确的核查价值。",
    deferredReason: "其余候选留待同题综述竞争比较后再定。",
    actor: { id: "researcher-1", role: "human_researcher", kind: "human" },
  });
  assert.equal(decision.selectedDirection.id, proposal.id);
  assert.equal(decision.narrowedBrief.focusMapping.conceptId, "early_onset");
  assert.notEqual(decision.narrowedBrief.suggestedQuery, sourceQuery);
  assert.match(decision.narrowedBrief.suggestedQuery, /early-onset|EOGC/i);
});

test("non-gastric early-onset selection remains subject-bound and never appends EOGC", () => {
  const researchReport = buildResearchReportContract({
    question: "乳腺癌研究现状",
    records: [{
      sourceId: "pubmed:breast-early-onset",
      title: "Early-onset breast cancer and surgical management: a review",
      abstract: "This review compares young-onset breast cancer definitions, surgery, treatment pathways, and long-term outcomes.",
      year: "2025",
    }],
    subjectConcepts: [{
      conceptId: "subject:breast-cancer",
      sourceTerm: "乳腺癌",
      role: "subject",
      mappedTerms: ["breast cancer"],
    }],
  });
  const proposal = researchReport.derivedAnalysis.reviewSynthesis.professorReport
    .studentReviewDirections.find((item) => item.themeId === "early_onset");
  assert.ok(proposal);
  const sourceQuery = '"breast cancer"[Title/Abstract] AND review[Publication Type]';
  const preview = {
    planHash: "d".repeat(64),
    question: "乳腺癌研究现状",
    candidates: [{ id: "orientation", status: "ready", query: sourceQuery }],
    reviewLandscape: {
      selectedCandidateId: "orientation",
      researchReport,
      synthesis: researchReport.derivedAnalysis.reviewSynthesis,
    },
  };
  const decision = buildResearchDirectionSelection({
    preview,
    selectedDirectionId: proposal.id,
    selectionReason: "优先核查早发人群定义与年龄界值。",
    deferredReason: "其他方向待同题综述比较后再定。",
    actor: { id: "researcher-1", role: "human_researcher", kind: "human" },
  });
  assert.equal(decision.selectedDirection.taxonomyProfile, "oncology_generic_v1");
  assert.equal(decision.selectedDirection.subjectLabel, "乳腺癌");
  assert.equal(decision.narrowedBrief.taxonomyProfile, "oncology_generic_v1");
  assert.match(decision.narrowedBrief.suggestedQuery, /breast cancer.*early-onset/is);
  assert.doesNotMatch(decision.narrowedBrief.suggestedQuery, /EOGC/i);
  assert.equal(decision.narrowedBrief.focusMapping.mappedTerms.includes("EOGC"), false);
  assert.doesNotMatch(JSON.stringify(decision), /胃癌|保胃|前哨/);
  assert.doesNotThrow(() => assertValidResearchDirectionSelection(decision, { researchReport }));
});
