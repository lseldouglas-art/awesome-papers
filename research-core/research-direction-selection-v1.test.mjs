import test from "node:test";
import assert from "node:assert/strict";

import {
  assertValidResearchDirectionSelection,
  buildResearchDirectionSelection,
  validateResearchDirectionSelection,
} from "./research-direction-selection-v1.js";

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
  assert.match(decision.narrowedBrief.evidenceBoundary, /第二轮检索假设/);
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
