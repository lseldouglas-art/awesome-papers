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
  assert.match(decision.narrowedBrief.question, /^肺癌：.*分子标志物/);
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
