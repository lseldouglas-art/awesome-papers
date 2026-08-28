const DEFAULT_CLAIM_LABELS = Object.freeze({
  sampleObservation: "当前20篇综述样本",
  externalReviewCheck: "立题前核查近两年同题综述",
  researchOpportunityInference: "候选选题判断",
});

const DECISION_CHAIN_THEME_GROUPS = Object.freeze([
  Object.freeze({
    id: "risk_detection",
    label: "风险识别、早诊与人群分层",
    themeIds: Object.freeze([
      "prevention_epidemiology",
      "early_detection_screening",
      "early_onset",
    ]),
  }),
  Object.freeze({
    id: "treatment_decision",
    label: "治疗决策与支持管理",
    themeIds: Object.freeze([
      "local_treatment",
      "perioperative_treatment",
      "systemic_treatment",
      "targeted_therapy",
      "immunotherapy",
      "advanced_metastatic",
      "toxicity_supportive",
    ]),
  }),
  Object.freeze({
    id: "stratification_monitoring",
    label: "分层、机制验证与结局监测",
    themeIds: Object.freeze([
      "biomarkers_molecular",
      "resistance_microenvironment",
      "survivorship_quality_of_life",
      "ai_digital",
      "multiomics",
    ]),
  }),
]);

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function text(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function joinChineseSentences(items) {
  const sentences = list(items)
    .map((item) => text(item).replace(/[。；;]+$/g, ""))
    .filter(Boolean);
  return sentences.length ? `${sentences.join("；")}。` : "";
}

function splitBoundarySentences(value) {
  return text(value)
    .split(/(?<=。)/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function normalizedDistribution(items, fallbackItems = []) {
  const source = list(items).length ? list(items) : list(fallbackItems);
  return source.map((item, index) => ({
    id: text(item?.id, item?.key, item?.label) || `distribution-${index + 1}`,
    label: text(item?.label, item?.year, item?.journal, item?.theme) || "未知",
    count: finiteNumber(item?.count),
    sourceIds: list(item?.sourceIds),
  }));
}

function distributionFromRows(rows, keySelector) {
  const counts = new Map();
  list(rows).forEach((row) => {
    const keys = list(keySelector(row));
    keys.forEach((key) => {
      const label = text(String(key ?? ""));
      if (!label) return;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    });
  });
  return [...counts.entries()]
    .map(([label, count]) => ({ id: label, label, count, sourceIds: [] }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "zh-CN"));
}

function normalizedRow(source, index) {
  return {
    sourceId: text(source?.sourceId, source?.id) || `source-${index + 1}`,
    pmid: text(source?.pmid, source?.locator?.pmid),
    title: text(source?.title) || "题名未返回",
    year: text(String(source?.year ?? "")) || "年份未知",
    journal: text(source?.journal) || "期刊未报告",
    accessLevel: text(source?.accessLevel) || "unknown",
    sourceSnapshotHash: text(source?.sourceSnapshotHash, source?.contentHash),
    relevance: source?.relevance ?? null,
    themeIds: list(source?.themeIds ?? source?.abstractAnalysis?.themeIds),
    titlePatternIds: list(source?.titlePatternIds).length
      ? list(source?.titlePatternIds)
      : list(source?.titlePatternId ? [source.titlePatternId] : []),
    locator: source?.locator ?? null,
    includedInDerivedAnalysis: source?.includedInDerivedAnalysis,
    exclusionReason: text(source?.exclusionReason, source?.relevance?.boundary),
  };
}

function normalizedLedger({ contract, landscape, sources }) {
  const contractRows = list(contract?.ledger?.rows);
  if (contract && typeof contract === "object") {
    const screeningRows = contractRows.map(normalizedRow);
    return {
      screeningRows,
      rows: screeningRows.filter((row) => row.includedInDerivedAnalysis === true),
      excludedRows: screeningRows.filter((row) => row.includedInDerivedAnalysis !== true),
    };
  }
  const fallbackRows = list(sources ?? landscape?.sources).map(normalizedRow);
  return { screeningRows: fallbackRows, rows: fallbackRows, excludedRows: [] };
}

function normalizedReviewDirections(synthesis, themeDistribution, analyzedCount, externalReviewReceipts) {
  const proposals = list(synthesis?.professorReport?.studentReviewDirections);
  const seenIds = new Set();
  return proposals.map((proposal, index) => {
    const id = text(proposal?.id);
    if (!id || seenIds.has(id)) return null;
    seenIds.add(id);
    const externalReviewReceipt = externalReviewReceipts.get(id) ?? null;
    const externalReviewVerified = Boolean(externalReviewReceipt);
    const reviewPlan = proposal?.reviewPlan && typeof proposal.reviewPlan === "object"
      ? proposal.reviewPlan
      : proposal?.studyPlan && typeof proposal.studyPlan === "object"
        ? proposal.studyPlan
        : {};
    const themeRow = list(themeDistribution).find((item) => item.id === proposal?.themeId);
    const coverageCount = finiteNumber(
      proposal?.existingCoverage?.count,
      finiteNumber(themeRow?.count, list(proposal?.sourceIds).length),
    );
    const coverageTotal = finiteNumber(proposal?.existingCoverage?.total, analyzedCount);
    const coverageShare = coverageTotal > 0 ? coverageCount / coverageTotal : 0;
    const coverageSignal = coverageShare >= 0.2 ? "较高" : coverageShare > 0 ? "较低" : "未知";
    const organization = list(reviewPlan?.organization).length
      ? list(reviewPlan.organization)
      : list(reviewPlan?.executionSteps).length
        ? list(reviewPlan.executionSteps)
        : list(proposal?.outline);
    const outline = list(proposal?.outline).length ? list(proposal.outline) : organization;
    const coreOutcomes = list(reviewPlan?.coreOutcomes).length
      ? list(reviewPlan.coreOutcomes)
      : list(proposal?.coreOutcomes);
    const rawDiscardConditions = list(proposal?.discardConditions).length
      ? list(proposal.discardConditions)
      : list(proposal?.abandonConditions).length
        ? list(proposal.abandonConditions)
        : [
            "近两年已有范围、评价轴与结局框架高度重合的高质量综述，且无法说明更新价值。",
            "窄检索后的可用文献量不足，或范围过宽且无法形成可复核的纳入排除标准。",
            "关键人群、比较条件或核心结局不能被稳定定义。",
          ];
    const discardConditions = [...new Set(rawDiscardConditions.map((condition) => {
      const value = text(condition);
      if (/不足\s*50|超过\s*100|多于\s*100|少于\s*50/i.test(value)) {
        return "窄检索后问题范围仍无法形成可操作、可复核且能在目标周期内完成的筛选框架。";
      }
      return value;
    }).filter(Boolean))];
    const competitionRisk = externalReviewVerified
      ? text(
          externalReviewReceipt?.competitionRisk,
          externalReviewReceipt?.verdict?.competitionRisk,
          proposal?.existingCoverage?.competitionRisk,
          proposal?.competitionRisk,
          "待判",
        )
      : "待核查";
    const coverageInterpretation = coverageTotal > 0
      ? `当前分层样本覆盖 ${coverageCount}/${coverageTotal}；这是样本内主题覆盖信号，不能代表同题综述数量或竞争风险。`
      : "当前账本尚未形成可计算的样本覆盖度；同题综述仍待另行核查。";
    const incrementalValueHypothesis = text(
      proposal?.incrementalValueHypothesis,
      proposal?.whyPotentiallyValuable,
      "待把人群边界、评价轴和核心结局转化为可与既有综述逐项比较的增量假设。",
    );
    return {
      id,
      themeId: proposal?.themeId ?? null,
      theme: text(proposal?.theme, themeRow?.label),
      rank: finiteNumber(proposal?.rank, index + 1),
      priority: text(proposal?.priority) || `第 ${finiteNumber(proposal?.rank, index + 1)} 顺位核查`,
      portfolioRole: text(proposal?.portfolioRole),
      displayTitle: text(proposal?.suggestedTitle) || `候选综述方向 ${index + 1}`,
      recommendedQuestion: text(proposal?.recommendedQuestion, proposal?.reviewQuestion, proposal?.suggestedTitle),
      whyPotentiallyValuable: text(proposal?.whyPotentiallyValuable),
      whyNotFullyReviewed: text(proposal?.whyNotFullyReviewed)
        || "需逐篇比较近两年同题综述是否采用相同人群、比较轴与核心结局；若已充分回答，本方向不成立。",
      incrementalValueHypothesis,
      noveltyStatus: text(proposal?.noveltyStatus) || "以同题综述比较结果判断新增价值",
      existingCoverage: {
        count: coverageCount,
        total: coverageTotal,
        competitionRisk,
        coverageSignal,
        interpretation: coverageInterpretation,
      },
      competitionRisk,
      externalReviewVerified,
      coverageSignal,
      outline,
      workload: proposal?.workload ?? null,
      reviewPlan: {
        reviewType: text(reviewPlan?.reviewType, reviewPlan?.studyDesign),
        populationAndComparison: text(
          reviewPlan?.populationAndComparison,
          proposal?.scopeDefinition,
          proposal?.picoPcc,
          proposal?.pico,
          proposal?.pcc,
        ) || "第二轮需冻结人群或研究对象、核心概念或干预、比较条件、结局与研究场景。",
        coreOutcomes,
        organization,
      },
      scopeDefinition: text(
        reviewPlan?.populationAndComparison,
        proposal?.scopeDefinition,
        proposal?.picoPcc,
        proposal?.pico,
        proposal?.pcc,
      ) || "第二轮需冻结人群或研究对象、核心概念或干预、比较条件、结局与研究场景。",
      coreOutcomes,
      organization,
      discardConditions,
      abandonConditions: discardConditions,
      verificationGate: text(proposal?.verificationGate, reviewPlan?.decisionGate),
      sourceIds: list(proposal?.sourceIds),
      representativeSourceIds: list(proposal?.representativeSourceIds),
    };
  }).filter(Boolean)
    .sort((left, right) => left.rank - right.rank || left.id.localeCompare(right.id))
    .slice(0, 5);
}

function evenlyAllocatedSamplingWindows(contract) {
  const counts = list(contract?.ledger?.samplingMetadata?.windows)
    .map((window) => list(window?.selectedPmids).length)
    .filter((count) => count > 0);
  return counts.length > 1 && new Set(counts).size === 1;
}

function verifiedExternalReviewReceipts() {
  // The current backend report contract deliberately permits only
  // `not_performed` with zero receipts. Keep every direction pending until a
  // later backend contract version defines and validates a direction-bound
  // receipt; caller-authored source IDs, locators, or booleans cannot upgrade UI.
  return new Map();
}

function reportContractFrom({ researchReport, landscape }) {
  return researchReport
    ?? landscape?.researchReport
    ?? landscape?.synthesis?.researchReport
    ?? null;
}

export function buildResearchReviewReportModel({
  landscape = null,
  researchReport = null,
  selectedDirectionId = "",
  lockedDirection = null,
} = {}) {
  const contract = reportContractFrom({ researchReport, landscape });
  const synthesis = landscape?.synthesis ?? contract?.derivedAnalysis?.reviewSynthesis ?? {};
  const professorReport = synthesis?.professorReport ?? {};
  const ledger = normalizedLedger({ contract, landscape, sources: landscape?.sources });
  const rows = ledger.rows;
  const analyzedCount = finiteNumber(
    contract?.ledger?.analyzedRowCount,
    finiteNumber(synthesis?.analyzedSourceCount, rows.length),
  );
  const ledgerIntegrity = {
    status: rows.length === analyzedCount && analyzedCount > 0 ? "passed" : "blocked",
    includedRowCount: rows.length,
    declaredAnalyzedRowCount: analyzedCount,
    boundary: rows.length === analyzedCount && analyzedCount > 0
      ? "当前分析分母与逐条纳入账本一致。"
      : `逐篇纳入记录为 ${rows.length} 篇，但报告声明分析 ${analyzedCount} 篇；在重新生成报告前不得继续选题或导出。`,
  };
  const externalReviewReceipts = verifiedExternalReviewReceipts(contract);
  const derived = contract?.derivedAnalysis ?? {};
  const fallbackYears = normalizedDistribution(landscape?.yearDistribution);
  const yearDistribution = normalizedDistribution(
    derived?.yearDistribution,
    fallbackYears.length ? fallbackYears : distributionFromRows(rows, (row) => [row?.year]),
  ).sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
  const journalDistribution = normalizedDistribution(
    derived?.journalDistribution,
    distributionFromRows(rows, (row) => [row?.journal]),
  );
  const themeDistribution = normalizedDistribution(
    derived?.themeDistribution,
    list(synthesis?.themeCoverage),
  );
  const titlePatternDistribution = normalizedDistribution(
    derived?.titlePatternDistribution,
    distributionFromRows(rows, (row) => row?.titlePatternIds),
  );
  const directions = normalizedReviewDirections(synthesis, themeDistribution, analyzedCount, externalReviewReceipts);
  const externalReviewVerificationCount = directions.filter((direction) => direction.externalReviewVerified).length;
  const externalReviewVerified = directions.length > 0
    && externalReviewVerificationCount === directions.length;
  const claimLabels = {
    sampleObservation: analyzedCount === 20
      ? DEFAULT_CLAIM_LABELS.sampleObservation
      : `当前${analyzedCount}篇综述样本`,
    externalReviewCheck: externalReviewVerificationCount === 0
      ? DEFAULT_CLAIM_LABELS.externalReviewCheck
      : externalReviewVerified
        ? "已完成近两年同题综述比较"
        : `继续比较其余同题综述（已完成 ${externalReviewVerificationCount}/${directions.length}）`,
    researchOpportunityInference: DEFAULT_CLAIM_LABELS.researchOpportunityInference,
  };
  const themeById = new Map(themeDistribution.map((item) => [item.id, item]));
  const mappedThemeIds = new Set(DECISION_CHAIN_THEME_GROUPS.flatMap((group) => group.themeIds));
  const mappedDecisionStructure = DECISION_CHAIN_THEME_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    items: group.themeIds.map((id) => themeById.get(id)).filter(Boolean),
  })).filter((group) => group.items.length);
  const unmappedThemes = themeDistribution.filter((item) => !mappedThemeIds.has(item.id));
  const decisionStructure = [
    ...mappedDecisionStructure,
    ...(unmappedThemes.length ? [{
      id: "unmapped_themes",
      label: "未映射主题（需校正分类）",
      items: unmappedThemes,
    }] : []),
  ];
  const leadingJournalCount = journalDistribution[0]?.count ?? 0;
  const recognizedTitleCount = titlePatternDistribution
    .filter((item) => !/其他|未知|未分类/.test(item.label))
    .reduce((total, item) => total + item.count, 0);
  const metadataPatternInsights = [
    {
      id: "journal_dispersion",
      title: "期刊来源高度分散，不能据此建立“成功选题期刊公式”",
      conclusion: journalDistribution.length
        ? `当前 ${analyzedCount} 篇样本分布于 ${journalDistribution.length} 种期刊，单一期刊最高仅 ${leadingJournalCount} 篇。期刊名只能说明来源分散，不能代理选题质量、录用概率或证据等级。`
        : "当前账本未形成可计算的期刊分布，不能据此判断选题成功特征。",
      sourceIds: rows.map((row) => row.sourceId),
    },
    {
      id: "title_pattern_limit",
      title: "题名结构自动分类的解释力有限，不能直接反推写作模板",
      conclusion: titlePatternDistribution.length
        ? `仅 ${recognizedTitleCount}/${analyzedCount} 篇进入当前预设的明确题名结构，其余题名需要人工编码问题对象、比较轴与结局。可用结论是题名应显式表达研究问题，而不是照搬高频措辞。`
        : "当前账本未形成可解释的题名结构分布，应回到逐篇题名人工编码。",
      sourceIds: rows.map((row) => row.sourceId),
    },
  ];
  const leadingDirection = directions[0] ?? null;
  const opportunityThesis = leadingDirection
    ? `当前样本中“${leadingDirection.theme || leadingDirection.displayTitle}”覆盖 ${leadingDirection.existingCoverage.count}/${leadingDirection.existingCoverage.total}。优先任务不是把低频误写为空白，而是核查“${leadingDirection.displayTitle}”所设定的人群、比较、结局与验证层级能否构成区别于近两年同题综述的评价框架。`
    : "当前样本尚未形成可追溯的综述候选；应先修订研究对象和检索范围。";
  const lockedBindingMatches = Boolean(
    lockedDirection?.bindingVerified === true
    || (
      lockedDirection?.reportBinding
      && !researchReportBindingStatus(contract?.binding, lockedDirection.reportBinding).stale
    ),
  );
  const lockedProposal = lockedDirection?.id && lockedBindingMatches
    ? directions.find((direction) => direction.id === lockedDirection.id) ?? null
    : null;
  const lockedCoverage = lockedProposal?.existingCoverage ?? lockedDirection?.existingCoverage ?? {};
  const lockedExternalReviewVerified = lockedProposal?.externalReviewVerified === true;
  const lockedCoverageCount = finiteNumber(lockedCoverage?.count);
  const lockedCoverageTotal = finiteNumber(lockedCoverage?.total, analyzedCount);
  const lockedCoverageSignal = text(
    lockedProposal?.coverageSignal,
    lockedDirection?.coverageSignal,
    lockedDirection?.existingCoverage?.coverageSignal,
  ) || (lockedCoverageTotal > 0 && lockedCoverageCount / lockedCoverageTotal >= 0.2 ? "较高" : lockedCoverageCount > 0 ? "较低" : "未知");
  const normalizedLockedDirection = lockedDirection && lockedBindingMatches
    ? {
        ...lockedProposal,
        ...lockedDirection,
        displayTitle: text(
          lockedProposal?.displayTitle,
          lockedDirection?.displayTitle,
          lockedDirection?.direction,
          lockedDirection?.recommendedQuestion,
        ),
        priority: text(lockedDirection?.priority, lockedProposal?.priority),
        whyPotentiallyValuable: text(
          lockedDirection?.whyPotentiallyValuable,
          lockedDirection?.whySuitable,
          lockedProposal?.whyPotentiallyValuable,
        ),
        incrementalValueHypothesis: text(
          lockedDirection?.incrementalValueHypothesis,
          lockedProposal?.incrementalValueHypothesis,
        ),
        whyNotFullyReviewed: text(
          lockedDirection?.whyNotFullyReviewed,
          lockedProposal?.whyNotFullyReviewed,
        ),
        existingCoverage: {
          ...lockedCoverage,
          count: lockedCoverageCount,
          total: lockedCoverageTotal,
          competitionRisk: lockedExternalReviewVerified
            ? text(lockedDirection?.competitionRisk, lockedProposal?.competitionRisk, "待核查")
            : "待核查",
          coverageSignal: lockedCoverageSignal,
          interpretation: lockedCoverageTotal > 0
            ? `当前分层样本覆盖 ${lockedCoverageCount}/${lockedCoverageTotal}；这是样本内主题覆盖信号，不能代表同题综述数量或竞争风险。`
            : "当前账本尚未形成可计算的样本覆盖度；同题综述仍待另行核查。",
        },
        competitionRisk: lockedExternalReviewVerified
          ? text(lockedDirection?.competitionRisk, lockedProposal?.competitionRisk, "待核查")
          : "待核查",
        externalReviewVerified: lockedExternalReviewVerified,
        coverageSignal: lockedCoverageSignal,
        outline: list(lockedDirection?.outline).length
          ? list(lockedDirection.outline)
          : list(lockedProposal?.outline).length
            ? list(lockedProposal.outline)
            : list(lockedDirection?.studyPlan?.executionSteps),
        organization: list(lockedDirection?.reviewPlan?.organization).length
          ? list(lockedDirection.reviewPlan.organization)
          : list(lockedProposal?.organization).length
            ? list(lockedProposal.organization)
            : list(lockedDirection?.studyPlan?.executionSteps),
        scopeDefinition: text(
          lockedDirection?.reviewPlan?.populationAndComparison,
          lockedDirection?.studyPlan?.populationAndComparison,
          lockedDirection?.scopeDefinition,
          lockedProposal?.scopeDefinition,
        ),
        coreOutcomes: list(lockedDirection?.reviewPlan?.coreOutcomes).length
          ? list(lockedDirection.reviewPlan.coreOutcomes)
          : list(lockedDirection?.studyPlan?.coreOutcomes).length
            ? list(lockedDirection.studyPlan.coreOutcomes)
            : list(lockedProposal?.coreOutcomes),
        reviewPlan: lockedDirection?.reviewPlan ?? lockedProposal?.reviewPlan ?? null,
        workload: lockedDirection?.workload ?? lockedProposal?.workload ?? null,
        discardConditions: list(lockedDirection?.discardConditions ?? lockedDirection?.abandonConditions).length
          ? list(lockedDirection?.discardConditions ?? lockedDirection?.abandonConditions)
          : list(lockedProposal?.discardConditions),
        verificationGate: text(
          lockedDirection?.verificationGate,
          lockedDirection?.studyPlan?.decisionGate,
          lockedDirection?.boundary,
          lockedProposal?.verificationGate,
        ),
      }
    : null;
  const selectedDirection = normalizedLockedDirection
    ?? (selectedDirectionId
      ? directions.find((item) => item.id === selectedDirectionId) ?? null
      : null);
  const relevanceGate = contract?.relevanceGate ?? null;
  const technicalBoundaryPattern = /reportHash|sourceSetHash|数字签名|可信根|事件库|版本库|内容指纹|来源集绑定|哈希/i;
  const contractBoundarySentences = splitBoundarySentences(contract?.boundary);
  const publicReportBoundaryParts = [
    ...contractBoundarySentences.filter((sentence) => !technicalBoundaryPattern.test(sentence)),
    text(contract?.ledger?.samplingMetadata?.boundary),
    text(professorReport?.boundary),
    text(synthesis?.boundary),
    text(landscape?.stageBrief?.evidenceBoundary),
  ].filter(Boolean);
  const technicalIntegrityBoundary = contractBoundarySentences
    .filter((sentence) => technicalBoundaryPattern.test(sentence))
    .join(" ");
  const reportBoundary = [...new Set(publicReportBoundaryParts)].join(" ")
    || "当前结论仅来自分层抽取的 PubMed 题名与可用摘要，不是全量文献计量、全文质量评价或研究空白定论。";

  return {
    contract,
    binding: contract?.binding ?? null,
    claimLabels,
    rows,
    screeningRows: ledger.screeningRows,
    excludedRows: ledger.excludedRows,
    screeningRowCount: ledger.screeningRows.length,
    analyzedCount,
    abstractAvailableCount: finiteNumber(synthesis?.abstractAvailableCount, rows.filter((row) => row.accessLevel === "abstract_only").length),
    periodLabel: text(professorReport?.periodLabel, landscape?.reviewWindow?.from && landscape?.reviewWindow?.to
      ? `${landscape.reviewWindow.from}—${landscape.reviewWindow.to}`
      : "") || "当前检索窗口",
    executiveSummary: text(professorReport?.executiveSummary, synthesis?.summaries?.coverage),
    developmentStatus: list(professorReport?.developmentStatus),
    majorProblems: list(professorReport?.majorProblems).slice(0, 4),
    newcomerGuide: list(professorReport?.newcomerGuide).slice(0, 4),
    trendInsights: list(professorReport?.trendInsights).slice(0, 4),
    selectionPatterns: list(professorReport?.selectionPatterns).slice(0, 4),
    researcherIdeas: list(professorReport?.researcherIdeas),
    yearDistribution,
    journalDistribution,
    themeDistribution,
    titlePatternDistribution,
    decisionStructure,
    decisionStructureComplete: unmappedThemes.length === 0,
    unmappedThemes,
    metadataPatternInsights,
    opportunityThesis,
    stratifiedAllocation: evenlyAllocatedSamplingWindows(contract),
    directions,
    selectedDirection,
    relevanceGate,
    ledgerIntegrity,
    lockedSelectionStale: Boolean(lockedDirection?.id && !lockedBindingMatches),
    externalReviewVerified,
    externalReviewVerificationCount,
    reportBoundary,
    technicalIntegrityBoundary,
    evidenceBoundary: text(professorReport?.traceability?.accessBoundary, landscape?.stageBrief?.evidenceBoundary, reportBoundary),
  };
}

function representativeSourceLists(items, validSourceIds) {
  return list(items).map((item) => {
    const preferred = list(item?.representativeSourceIds).length
      ? list(item.representativeSourceIds)
      : list(item?.sourceIds);
    return [...new Set(preferred.filter((sourceId) => validSourceIds.has(sourceId)))];
  });
}

function appendFairSourceIds(result, items, validSourceIds, {
  limit = 8,
  startRound = 0,
  maxRounds = Number.POSITIVE_INFINITY,
} = {}) {
  const sourceLists = representativeSourceLists(items, validSourceIds);
  const availableRounds = sourceLists.reduce((maximum, sourceIds) => Math.max(maximum, sourceIds.length), 0);
  const endRound = Math.min(availableRounds, startRound + maxRounds);
  for (let round = startRound; round < endRound && result.length < limit; round += 1) {
    for (const sourceIds of sourceLists) {
      const sourceId = sourceIds[round];
      if (sourceId && !result.includes(sourceId)) result.push(sourceId);
      if (result.length >= limit) break;
    }
  }
  return result;
}

export function researchReportChapterEvidenceRows(model, chapterId, selectedDirectionId = "") {
  if (!model) return [];
  const validSourceIds = new Set(list(model.rows).map((row) => row.sourceId));
  const sourceIds = [];
  if (chapterId === "landscape") {
    appendFairSourceIds(sourceIds, model.majorProblems, validSourceIds, { maxRounds: 1 });
    appendFairSourceIds(sourceIds, model.developmentStatus, validSourceIds);
    appendFairSourceIds(sourceIds, model.majorProblems, validSourceIds, { startRound: 1 });
  } else if (chapterId === "trends") {
    appendFairSourceIds(sourceIds, [
      ...list(model.trendInsights),
      ...list(model.selectionPatterns),
    ], validSourceIds);
  } else if (chapterId === "opportunities") {
    const selected = list(model.directions).find((direction) => direction.id === selectedDirectionId);
    appendFairSourceIds(sourceIds, selected ? [selected] : list(model.directions), validSourceIds);
  } else if (chapterId === "plan") {
    appendFairSourceIds(sourceIds, model.selectedDirection ? [model.selectedDirection] : [], validSourceIds);
  }
  const selectedIds = new Set(sourceIds);
  return list(model.rows).filter((row) => selectedIds.has(row.sourceId));
}

function roundFacts(round) {
  const landscape = round?.reviewLandscape ?? round ?? null;
  const contract = landscape?.researchReport ?? landscape?.synthesis?.researchReport ?? null;
  const synthesis = landscape?.synthesis ?? contract?.derivedAnalysis?.reviewSynthesis ?? {};
  const themes = list(synthesis?.themeCoverage);
  return {
    question: text(round?.question, landscape?.question),
    sampledCount: finiteNumber(
      contract?.ledger?.analyzedRowCount,
      finiteNumber(landscape?.sampledCount, finiteNumber(synthesis?.analyzedSourceCount)),
    ),
    abstractCount: finiteNumber(landscape?.abstractAvailableCount, finiteNumber(synthesis?.abstractAvailableCount)),
    themeCount: themes.length,
    topTheme: text(themes[0]?.label) || "尚未形成稳定主题",
  };
}

export function reportChapterIdForKey(activeChapter, key) {
  const chapterIds = ["landscape", "trends", "opportunities", "plan"];
  const currentIndex = Math.max(0, chapterIds.indexOf(activeChapter));
  if (key === "ArrowRight") return chapterIds[(currentIndex + 1) % chapterIds.length];
  if (key === "ArrowLeft") return chapterIds[(currentIndex - 1 + chapterIds.length) % chapterIds.length];
  if (key === "Home") return chapterIds[0];
  if (key === "End") return chapterIds.at(-1);
  return null;
}

export function buildScopingRoundComparison(firstRound, secondRound) {
  if (!firstRound || !secondRound) return null;
  return {
    first: roundFacts(firstRound),
    second: roundFacts(secondRound),
    boundary: "两轮比较只说明研究问题和分层样本结构如何收窄，不证明选题创新、疗效或临床价值。",
  };
}

export function researchReportBindingStatus(binding, currentBinding = null) {
  if (!currentBinding) return { checked: false, stale: false, mismatches: [] };
  const fields = [
    "projectId",
    "sourceSetHash",
    "reportRevision",
    "frozenSourceManifestHash",
    "derivedAnalysisHash",
    "reportHash",
  ];
  const mismatches = fields.filter((field) => {
    const expected = binding?.[field];
    const current = currentBinding?.[field];
    if (expected === null && current === null) return false;
    if (expected === undefined || expected === "" || current === undefined || current === "") return true;
    return String(expected) !== String(current);
  });
  return {
    checked: true,
    stale: mismatches.length > 0,
    mismatches,
  };
}

export function buildMentorBrief(model, {
  selectedDirection = null,
  selectionReason = "",
  deferredReason = "",
} = {}) {
  const direction = selectedDirection ?? model?.selectedDirection;
  const lines = [
    "# 综述选题导师简报",
    "",
    `研究窗口：${model?.periodLabel ?? "当前检索窗口"}`,
    `分析范围：${model?.claimLabels?.sampleObservation ?? "当前分层综述样本"}`,
    `样本数量：${model?.analyzedCount ?? 0} 篇`,
    "",
    "## 当前判断",
    model?.executiveSummary || "当前样本尚不足以形成稳定判断。",
    "",
    "## 主要问题",
    ...list(model?.majorProblems).map((item, index) => `${index + 1}. ${text(item?.title)}：${text(item?.conclusion, item?.value)}`),
    "",
    "## 当前选择",
    direction?.displayTitle || direction?.direction || "尚未选择方向",
    direction?.recommendedQuestion ? `建议问题：${direction.recommendedQuestion}` : "",
    direction?.priority ? `核查优先级：${direction.priority}` : "",
    `同题综述比较：${direction?.externalReviewVerified ? `已完成；竞争风险${direction?.competitionRisk ?? "待判"}` : "立题前逐篇比较近两年同范围综述、协议与伞状综述"}`,
    direction?.existingCoverage?.interpretation ? `当前样本覆盖（${direction?.coverageSignal ?? "未知"}）：${direction.existingCoverage.interpretation}` : "",
    direction?.whyNotFullyReviewed ? `竞争性判断：${direction.whyNotFullyReviewed}` : "",
    direction?.incrementalValueHypothesis ? `候选增量：${direction.incrementalValueHypothesis}` : "",
    direction?.scopeDefinition ? `PICO/PCC 边界：${direction.scopeDefinition}` : "",
    list(direction?.coreOutcomes).length ? `核心结局：${list(direction.coreOutcomes).join("、")}` : "",
    list(direction?.organization ?? direction?.outline).length
      ? `文献组织：${list(direction?.organization ?? direction?.outline).join(" → ")}`
      : "",
    direction?.workload?.targetCoreLiterature ? `文献量目标：${direction.workload.targetCoreLiterature}` : "",
    direction?.workload?.timeline ? `时间估计：${direction.workload.timeline}` : "",
    direction?.workload?.difficulty ? `难度估计：${direction.workload.difficulty}` : "",
    direction?.verificationGate ? `继续推进条件：${direction.verificationGate}` : "",
    list(direction?.discardConditions ?? direction?.abandonConditions).length
      ? `放弃或降级条件：${joinChineseSentences(direction?.discardConditions ?? direction?.abandonConditions)}`
      : "",
    text(selectionReason) ? `本轮采用理由：${text(selectionReason)}` : "",
    text(deferredReason) ? `其余方向暂缓理由：${text(deferredReason)}` : "",
    "",
    "## 证据边界",
    `立题前核查：${model?.claimLabels?.externalReviewCheck ?? "比较近两年同题综述"}`,
    model?.reportBoundary || "当前仅为题名与摘要级判断。",
  ];
  return lines.filter((line, index) => line || lines[index - 1] !== "").join("\n").trim();
}

export { DEFAULT_CLAIM_LABELS };
