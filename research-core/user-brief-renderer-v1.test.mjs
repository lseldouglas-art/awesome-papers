import test from "node:test";
import assert from "node:assert/strict";

import { RESEARCH_ARTIFACT_SCHEMA_VERSION } from "./artifact-contracts-v1.js";
import { renderEvidenceBrief } from "./user-brief-renderer-v1.js";

function networkPharmacologyBundle() {
  const accessLevels = [
    ...Array(3).fill("full_text_and_supplement"),
    ...Array(10).fill("abstract_only"),
  ];
  const evidenceExcerpts = accessLevels.map((accessLevel, index) => ({
    schemaVersion: RESEARCH_ARTIFACT_SCHEMA_VERSION,
    id: `evidence-${index + 1}`,
    sourceId: `PMID:${41000000 + index}`,
    claimId: "conclusion-1",
    locator: { pmid: String(41000000 + index) },
    accessLevel,
    relation: "partially_supports",
    extractedFacts: ["The accessed material contains a bounded evidence-chain observation."],
    limitations: accessLevel === "abstract_only" ? ["Only the abstract was accessed."] : [],
    unknowns:
      accessLevel === "abstract_only"
        ? ["摘要未报告的精确实验细节保持未知。"]
        : [],
    sourceSnapshotHash: String(index + 1).padStart(64, "0"),
  }));

  return {
    schemaVersion: RESEARCH_ARTIFACT_SCHEMA_VERSION,
    id: "network-pharmacology-brief-v1",
    researchQuestion: "网络药理学能否建立连续的动物机制证据链？",
    currentResearchPeriod: "文献调研：正在确认经过核查的证据边界",
    evidenceExcerpts,
    conclusionCards: [
      {
        schemaVersion: RESEARCH_ARTIFACT_SCHEMA_VERSION,
        id: "conclusion-1",
        questionId: "network-pharmacology-question",
        version: 1,
        claim: "在本轮13篇高相关候选中，尚不能确认任何一篇完成连续的动物机制证明。",
        scope: "本轮主动筛出的13篇高相关候选，不代表整个领域的比例。",
        producerId: "evidence-synthesizer",
        confidence: "bounded",
        supportingEvidenceIds: evidenceExcerpts.map((item) => item.id),
        counterEvidenceIds: [],
        uncertainties: ["10篇仅访问摘要，摘要未报告的信息保持未知。"],
        accessBoundary: "3篇取得全文和补充材料，10篇停在摘要级。",
        nextQuestion: "哪些匹配体系中的靶点干预实验能补齐连续机制链？",
      },
    ],
    verificationReports: [
      {
        schemaVersion: RESEARCH_ARTIFACT_SCHEMA_VERSION,
        id: "verification-1",
        conclusionCardIds: ["conclusion-1"],
        status: "verified",
        verdict: "pass",
        producerId: "evidence-synthesizer",
        verifierId: "independent-evidence-reviewer",
        limitations: ["不能据此估计整个网络药理学领域的研究比例。"],
      },
    ],
    boundaries: ["候选来自主动高相关检索，不是随机抽样。"],
    nextStepOrUserDecision: {
      kind: "human_decision",
      prompt: "是否接受当前证据边界，并据此进入论文论证结构设计？",
    },
    decisionReceipt: null,
  };
}

test("the renderer returns the four mandatory user-brief fields", () => {
  const rendered = renderEvidenceBrief(networkPharmacologyBundle());
  assert.deepEqual(Object.keys(rendered), [
    "currentResearchPeriod",
    "newConclusions",
    "mainEvidenceAndBoundaries",
    "nextStepOrUserDecision",
    "markdown",
  ]);
  assert.equal(rendered.newConclusions.length, 1);
  assert.equal(rendered.newConclusions[0].confidence, "限域判断");
});

test("the renderer derives access boundaries from actual evidence records", () => {
  const rendered = renderEvidenceBrief(networkPharmacologyBundle());
  assert.equal(rendered.mainEvidenceAndBoundaries.accessCounts.abstract_only, 10);
  assert.equal(
    rendered.mainEvidenceAndBoundaries.accessCounts.full_text_and_supplement,
    3,
  );
  assert.match(rendered.mainEvidenceAndBoundaries.accessSummary, /10 条摘要级记录/);
  assert.match(rendered.mainEvidenceAndBoundaries.accessSummary, /3 条全文与补充材料级记录/);
});

test("the renderer is deterministic and never invents a timestamp", () => {
  const bundle = networkPharmacologyBundle();
  const first = renderEvidenceBrief(bundle);
  const second = renderEvidenceBrief(structuredClone(bundle));
  assert.deepEqual(first, second);
  assert.doesNotMatch(first.markdown, /生成时间|generated at/i);
});

test("the markdown is independently readable without opening a file", () => {
  const { markdown } = renderEvidenceBrief(networkPharmacologyBundle());
  assert.match(markdown, /## 当前研究时期/);
  assert.match(markdown, /## 本轮新得到的结论/);
  assert.match(markdown, /## 主要依据与边界/);
  assert.match(markdown, /## 下一步或需要确认的决定/);
  assert.match(markdown, /需要研究者确认/);
});
