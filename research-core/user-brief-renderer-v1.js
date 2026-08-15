import {
  EVIDENCE_ACCESS_LEVELS,
  assertValidEvidenceBriefBundle,
} from "./artifact-contracts-v1.js";

const ACCESS_LABELS = Object.freeze({
  title_only: "题名级",
  abstract_only: "摘要级",
  full_text: "全文级",
  full_text_and_supplement: "全文与补充材料级",
});

const CONFIDENCE_LABELS = Object.freeze({
  provisional: "初步判断",
  bounded: "限域判断",
  convergent: "多来源一致判断",
});

function unique(values) {
  return [...new Set(values)];
}

function accessCounts(evidenceExcerpts) {
  const counts = Object.fromEntries(EVIDENCE_ACCESS_LEVELS.map((level) => [level, 0]));
  for (const evidence of evidenceExcerpts) counts[evidence.accessLevel] += 1;
  return counts;
}

function renderAccessSummary(counts) {
  const parts = EVIDENCE_ACCESS_LEVELS
    .filter((level) => counts[level] > 0)
    .map((level) => `${counts[level]} 条${ACCESS_LABELS[level]}记录`);
  return `本轮实际核查 ${parts.join("、")}。`;
}

function renderNextStep(nextStepOrUserDecision) {
  const prefix =
    nextStepOrUserDecision.kind === "human_decision"
      ? "需要研究者确认："
      : "下一步：";
  return `${prefix}${nextStepOrUserDecision.prompt}`;
}

function renderMarkdown(projection) {
  const conclusionLines = projection.newConclusions
    .map(
      (item, index) =>
        `${index + 1}. ${item.claim}\n   - 适用范围：${item.scope}\n   - 结论强度：${item.confidence}\n   - 下一研究问题：${item.nextQuestion}`,
    )
    .join("\n");
  const boundaryLines = projection.mainEvidenceAndBoundaries.boundaries
    .map((boundary) => `- ${boundary}`)
    .join("\n");

  return [
    "## 当前研究时期",
    "",
    projection.currentResearchPeriod,
    "",
    "## 本轮新得到的结论",
    "",
    conclusionLines,
    "",
    "## 主要依据与边界",
    "",
    projection.mainEvidenceAndBoundaries.accessSummary,
    boundaryLines,
    "",
    "## 下一步或需要确认的决定",
    "",
    projection.nextStepOrUserDecision,
  ].join("\n");
}

export function renderEvidenceBrief(bundle) {
  assertValidEvidenceBriefBundle(bundle);

  const counts = accessCounts(bundle.evidenceExcerpts);
  const verificationByConclusionId = new Map(
    bundle.verificationReports.flatMap((report) =>
      report.conclusionCardIds.map((conclusionId) => [conclusionId, report]),
    ),
  );
  const cardBoundaries = bundle.conclusionCards.flatMap((card) => {
    const verification = verificationByConclusionId.get(card.id);
    return [
      card.accessBoundary,
      ...card.uncertainties,
      ...(verification?.limitations ?? []),
    ];
  });
  const projection = {
    currentResearchPeriod: bundle.currentResearchPeriod,
    newConclusions: bundle.conclusionCards.map((card) => ({
      id: card.id,
      claim: card.claim,
      scope: card.scope,
      confidence: CONFIDENCE_LABELS[card.confidence],
      supportingEvidenceCount: card.supportingEvidenceIds.length,
      counterEvidenceCount: card.counterEvidenceIds.length,
      nextQuestion: card.nextQuestion,
    })),
    mainEvidenceAndBoundaries: {
      accessCounts: counts,
      accessSummary: renderAccessSummary(counts),
      boundaries: unique([...bundle.boundaries, ...cardBoundaries]),
    },
    nextStepOrUserDecision: renderNextStep(bundle.nextStepOrUserDecision),
  };

  return Object.freeze({
    ...projection,
    markdown: renderMarkdown(projection),
  });
}
