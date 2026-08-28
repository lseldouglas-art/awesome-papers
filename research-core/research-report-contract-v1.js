import { sha256 } from "./event-engine-v1.js";
import {
  RESEARCH_REVIEW_CLASSIFIER_VERSION,
  analyzeReviewAbstracts,
} from "./research-review-synthesis-v1.js";

export const RESEARCH_REPORT_SCHEMA_VERSION = "research-report-contract/v1";
export const RESEARCH_REVIEW_LEDGER_SCHEMA_VERSION = "research-review-ledger/v1";
export const SUBJECT_RELEVANCE_RULE_VERSION = "research-subject-relevance/v1";

export const RESEARCH_CLAIM_LABELS = Object.freeze({
  sampleObservation: Object.freeze({
    id: "sample_observation",
    label: "分层样本观察",
    authority: "descriptive_sample_only",
    boundary: "只描述当前逐条账本中的样本，不代表全领域发文量、成熟度或临床有效性。",
  }),
  externalReviewCheck: Object.freeze({
    id: "external_review_check",
    label: "外部综述待核查",
    authority: "not_performed",
    boundary: "必须绑定可定位的外部综述或指南；未核查全文时只能报告题名摘要级信息。",
  }),
  researchOpportunityInference: Object.freeze({
    id: "research_opportunity_inference",
    label: "研究机会推断",
    authority: "hypothesis_for_recheck",
    boundary: "这是待第二轮窄检索证伪的选题假设，不是研究空白、创新性或可行性定论。",
  }),
});

const TITLE_PATTERN_RULES = Object.freeze([
  { id: "umbrella_review", label: "伞状综述", pattern: /\b(?:umbrella review|overview of reviews)\b/i },
  { id: "scoping_review", label: "范围综述", pattern: /\bscoping review\b/i },
  { id: "systematic_meta", label: "系统综述与 Meta 分析", pattern: /\b(?:systematic review.{0,35}meta-analysis|meta-analysis.{0,35}systematic review)\b/i },
  { id: "meta_analysis", label: "Meta 分析", pattern: /\bmeta-analysis\b/i },
  { id: "systematic_review", label: "系统综述", pattern: /\bsystematic review\b/i },
  { id: "narrative_review", label: "叙述性或一般综述", pattern: /\b(?:narrative review|review|overview|update)\b/i },
]);

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clean(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsTerm(haystack, term) {
  const normalizedTerm = clean(term).toLowerCase();
  if (!normalizedTerm) return false;
  if (/^[\x00-\x7F]+$/.test(normalizedTerm)) {
    const expression = escapeRegExp(normalizedTerm).replace(/\s+/g, "\\s+");
    return new RegExp(`(?<![\\p{L}\\p{N}_])${expression}(?![\\p{L}\\p{N}_])`, "iu").test(haystack);
  }
  return haystack.includes(normalizedTerm);
}

function sourceIdFor(record, index = 0) {
  if (hasText(record?.sourceId)) return record.sourceId.trim();
  if (hasText(record?.id)) return record.id.trim();
  if (hasText(record?.pmid)) return `pubmed:${record.pmid.trim()}`;
  return `source:unknown:${index + 1}`;
}

function sourceSnapshotHashFor(record, index = 0) {
  if (/^[a-f0-9]{64}$/i.test(record?.sourceSnapshotHash ?? "")) {
    return record.sourceSnapshotHash.toLowerCase();
  }
  return sha256({
    sourceId: sourceIdFor(record, index),
    title: clean(record?.title),
    abstract: hasText(record?.abstract ?? record?.text)
      ? clean(record.abstract ?? record.text)
      : null,
    journal: hasText(record?.journal) ? clean(record.journal) : null,
    year: hasText(record?.year) ? clean(record.year) : null,
    accessLevel: record?.accessLevel ?? (hasText(record?.abstract ?? record?.text) ? "abstract_only" : "title_only"),
    locator: record?.locator ?? null,
  });
}

function normalizeSubjectConcepts(subjectConcepts) {
  return asArray(subjectConcepts)
    .map((concept, index) => ({
      id: hasText(concept?.conceptId) ? concept.conceptId.trim() : `subject:${index + 1}`,
      sourceTerm: clean(concept?.sourceTerm),
      role: hasText(concept?.role) ? concept.role.trim() : "core_entity",
      terms: [...new Set([
        ...asArray(concept?.mappedTerms),
        ...asArray(concept?.freeTextTerms),
      ].map(clean).filter(Boolean))],
      meshTerms: [...new Set(asArray(concept?.meshTerms).map(clean).filter(Boolean))],
    }))
    .filter((concept) => concept.terms.length > 0 || concept.meshTerms.length > 0);
}

function normalizedRecord(record, index) {
  const abstract = hasText(record?.abstract ?? record?.text)
    ? clean(record.abstract ?? record.text)
    : null;
  const accessLevel = record?.accessLevel ?? (abstract ? "abstract_only" : "title_only");
  return {
    sourceId: sourceIdFor(record, index),
    pmid: hasText(record?.pmid ?? record?.locator?.pmid)
      ? clean(record.pmid ?? record.locator.pmid)
      : null,
    doi: hasText(record?.doi ?? record?.locator?.doi)
      ? clean(record.doi ?? record.locator.doi)
      : null,
    title: clean(record?.title) || `题名未返回 ${index + 1}`,
    abstract,
    journal: hasText(record?.journal) ? clean(record.journal) : null,
    year: hasText(record?.year) ? clean(record.year) : null,
    accessLevel,
    locator: record?.locator && typeof record.locator === "object"
      ? structuredClone(record.locator)
      : null,
    sourceSnapshotHash: sourceSnapshotHashFor(record, index),
  };
}

function relevanceForRecord(record, concepts) {
  const fields = [
    { id: "title", value: record.title.toLowerCase() },
    { id: "abstract", value: (record.abstract ?? "").toLowerCase() },
  ];
  const matches = concepts.flatMap((concept) => {
    const terms = [...new Set([...concept.terms, ...concept.meshTerms])];
    const matched = fields.flatMap((field) => terms
      .filter((term) => containsTerm(field.value, term))
      .map((term) => ({ field: field.id, term })));
    return matched.length > 0
      ? [{ conceptId: concept.id, sourceTerm: concept.sourceTerm, role: concept.role, matched }]
      : [];
  });
  const allConceptsMatched = concepts.length > 0 && matches.length === concepts.length;
  return {
    status: allConceptsMatched ? "relevant" : "not_relevant",
    matches,
    ruleVersion: SUBJECT_RELEVANCE_RULE_VERSION,
    boundary: allConceptsMatched
      ? "相关性来自题名与当前可见摘要对全部冻结研究对象概念组的透明词项命中；它不代表纳入资格、研究质量或结论支持。"
      : "题名与当前可见摘要未同时命中全部冻结研究对象概念组；在人工处置、修订词群或检索式前不得进入最终文献库。",
  };
}

export function sourceSetHashForRecords(records = []) {
  return sha256(asArray(records).map((record, index) => ({
    sourceId: sourceIdFor(record, index),
    sourceSnapshotHash: sourceSnapshotHashFor(record, index),
  })));
}

export function evaluateResearchSubjectRelevance({ records = [], subjectConcepts = [] } = {}) {
  const normalized = asArray(records).map(normalizedRecord);
  const concepts = normalizeSubjectConcepts(subjectConcepts);
  const rows = normalized.map((record) => ({
    sourceId: record.sourceId,
    title: record.title,
    ...relevanceForRecord(record, concepts),
  }));
  const relevantCount = rows.filter((row) => row.status === "relevant").length;
  const unresolved = concepts.length === 0;
  return {
    schemaVersion: SUBJECT_RELEVANCE_RULE_VERSION,
    status: !unresolved && relevantCount > 0 ? "passed" : "blocked",
    threshold: { minimumRelevantSources: 1, policy: "zero_relevant_blocks" },
    totalCount: rows.length,
    relevantCount,
    notRelevantCount: rows.length - relevantCount,
    subjectConcepts: concepts,
    rows,
    blockedArtifactTypes: ["finalLibrary", "LibraryManifest", "EvidenceRecord", "ResearchConclusionCard", "research_direction"],
    reason: unresolved
      ? "没有冻结可审计的研究对象词群，不能执行相关性门禁。"
      : relevantCount === 0
        ? "当前来源中没有一篇在题名或可见摘要命中研究对象词群。"
        : "至少一篇来源命中已冻结研究对象词群；仍需后续题名摘要筛选决定逐篇纳入。",
    boundary: "这是防止完全错题来源进入证据链的最低硬门禁，不替代双人筛选、全文评价或纳入排除判断。",
  };
}

function distribution(values, { unknown = "未知" } = {}) {
  const counts = new Map();
  asArray(values).forEach((value) => {
    const label = hasText(value) ? clean(value) : unknown;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function titlePatternFor(title) {
  return TITLE_PATTERN_RULES.find((rule) => rule.pattern.test(title))
    ?? { id: "other_title", label: "其他题名结构" };
}

function assertReportRevision(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError("reportRevision must be an integer >= 1");
  }
}

function reportHashFor(report) {
  const cloned = structuredClone(report);
  if (cloned?.binding) delete cloned.binding.reportHash;
  return sha256(cloned);
}

function frozenSourceManifestHashFor(report) {
  const rows = asArray(report?.ledger?.rows);
  const metadata = report?.ledger?.samplingMetadata;
  return sha256({
    schemaVersion: "research-frozen-source-manifest/v1",
    retrievalSourceSetHash: report?.ledger?.retrievalSourceSetHash ?? null,
    samplingRoot: metadata ? {
      schemaVersion: metadata.schemaVersion ?? null,
      database: metadata.database ?? null,
      query: metadata.query ?? metadata.baseQuery ?? null,
      executedOn: metadata.executedOn ?? null,
      receiptHash: metadata.receiptHash ?? null,
      windows: metadata.windows ?? metadata.strategy?.buckets ?? null,
      sourceDocuments: metadata.sourceDocuments ?? null,
    } : null,
    rows: rows.map((row) => ({
      rowNumber: row.rowNumber,
      sourceId: row.sourceId,
      pmid: row.pmid,
      doi: row.doi,
      title: row.title,
      journal: row.journal,
      year: row.year,
      accessLevel: row.accessLevel,
      locator: row.locator,
      sourceSnapshotHash: row.sourceSnapshotHash,
      relevanceStatus: row.relevance?.status ?? null,
      includedInDerivedAnalysis: row.includedInDerivedAnalysis,
      themeIds: row.themeIds,
      methodSignalIds: row.methodSignalIds,
      gapSignalIds: row.gapSignalIds,
      problemSignalIds: row.problemSignalIds,
      titlePatternId: row.titlePatternId,
    })),
  });
}

function derivedAnalysisHashFor(report) {
  return sha256({
    schemaVersion: "research-derived-analysis-manifest/v1",
    question: report?.question ?? null,
    claimLabels: report?.claimLabels ?? null,
    relevanceGate: report?.relevanceGate ?? null,
    externalReviewVerification: report?.externalReviewVerification ?? null,
    derivedAnalysis: report?.derivedAnalysis ?? null,
    boundary: report?.boundary ?? null,
  });
}

function sameDerivedValue(left, right) {
  return sha256(left) === sha256(right);
}

function taxonomyProfileForConcepts(concepts) {
  const conceptText = asArray(concepts)
    .flatMap((concept) => [concept.sourceTerm, ...concept.terms, ...concept.meshTerms])
    .map(clean)
    .join(" ");
  const oncology = /(?:癌|肿瘤|瘤|\b(?:cancer|carcinoma|neoplasm|tumou?r|sarcoma|leukemia|lymphoma|melanoma)\b)/i
    .test(conceptText);
  if (!oncology) return "generic_safe_v1";
  return /(?:胃癌|胃肿瘤|\b(?:gastric|stomach)\s+(?:cancer|carcinoma|neoplasm|tumou?r|adenocarcinoma)s?\b)/i
    .test(conceptText)
    ? "gastric_oncology_v1"
    : "oncology_generic_v1";
}

export function buildResearchReportContract({
  projectId = null,
  question,
  records = [],
  subjectConcepts = [],
  reportRevision = 1,
  generatedAt = null,
  reviewWindow = null,
  samplingMetadata = null,
  bindingAuthority = projectId ? "project_bound_report" : "preproject_preview",
} = {}) {
  assertReportRevision(reportRevision);
  const normalized = asArray(records).map(normalizedRecord);
  const relevanceGate = evaluateResearchSubjectRelevance({
    records: normalized,
    subjectConcepts,
  });
  const relevanceBySource = new Map(relevanceGate.rows.map((row) => [row.sourceId, row]));
  const included = normalized.filter((record) => relevanceBySource.get(record.sourceId)?.status === "relevant");
  const labeledSubjectConcepts = relevanceGate.subjectConcepts.filter((concept) => concept.role === "subject");
  const subjectLabel = (labeledSubjectConcepts.length > 0 ? labeledSubjectConcepts : relevanceGate.subjectConcepts)
    .map((concept) => concept.sourceTerm)
    .filter(Boolean)
    .join("、") || null;
  const synthesis = included.length > 0
    ? analyzeReviewAbstracts(included, {
        reviewWindow,
        subjectLabel,
        taxonomyProfile: taxonomyProfileForConcepts(relevanceGate.subjectConcepts),
      })
    : null;
  const analysisBySource = new Map(asArray(synthesis?.sourceAnalyses).map((item) => [item.sourceId, item]));
  const rows = normalized.map((record, index) => {
    const relevance = relevanceBySource.get(record.sourceId);
    const analysis = analysisBySource.get(record.sourceId);
    const titlePattern = titlePatternFor(record.title);
    return {
      rowNumber: index + 1,
      sourceId: record.sourceId,
      pmid: record.pmid,
      doi: record.doi,
      title: record.title,
      year: record.year,
      journal: record.journal,
      accessLevel: record.accessLevel,
      locator: record.locator,
      sourceSnapshotHash: record.sourceSnapshotHash,
      relevance: structuredClone(relevance),
      includedInDerivedAnalysis: relevance?.status === "relevant",
      themeIds: asArray(analysis?.themeIds),
      methodSignalIds: asArray(analysis?.methodSignalIds),
      gapSignalIds: asArray(analysis?.gapSignalIds),
      problemSignalIds: asArray(analysis?.problemSignalIds),
      titlePatternId: titlePattern.id,
      classifierAudit: analysis?.classifierAudit
        ? structuredClone(analysis.classifierAudit)
        : { themes: [], methods: [], gaps: [], problems: [] },
    };
  });
  const retrievalSourceSetHash = sourceSetHashForRecords(normalized);
  const sourceSetHash = sourceSetHashForRecords(included);
  const binding = {
    projectId: hasText(projectId) ? projectId.trim() : null,
    sourceSetHash,
    reportRevision,
    authority: bindingAuthority,
  };
  const includedRows = rows.filter((row) => row.includedInDerivedAnalysis);
  const report = {
    schemaVersion: RESEARCH_REPORT_SCHEMA_VERSION,
    binding,
    question: hasText(question) ? question.trim() : null,
    generatedAt: hasText(generatedAt) ? new Date(generatedAt).toISOString() : null,
    claimLabels: structuredClone(RESEARCH_CLAIM_LABELS),
    externalReviewVerification: {
      schemaVersion: "research-external-review-verification/v1",
      status: "not_performed",
      receipts: [],
      boundary: "当前合同不接受调用方自报的全局核查布尔值。只有未来按 directionId 绑定、含检索方法、时间、可解析定位符和来源快照哈希的独立回执，才能升级单个候选；本轮全部保持待核查。",
    },
    relevanceGate,
    ledger: {
      schemaVersion: RESEARCH_REVIEW_LEDGER_SCHEMA_VERSION,
      rowCount: rows.length,
      analyzedRowCount: includedRows.length,
      classifierVersion: RESEARCH_REVIEW_CLASSIFIER_VERSION,
      taxonomyProfile: synthesis?.taxonomyProfile ?? taxonomyProfileForConcepts(relevanceGate.subjectConcepts),
      rows,
      sourceSetHash,
      retrievalSourceSetHash,
      samplingMetadata: samplingMetadata && typeof samplingMetadata === "object"
        ? structuredClone(samplingMetadata)
        : null,
      reproducibility: {
        mode: "metadata_hash_and_refetch_verification",
        statement: "公开账本不保存完整出版商摘要；保留定位符、访问层级、逐条快照哈希、分类器版本、命中字段与匹配词。重取题名摘要后必须先校验快照哈希，来源变化时阻断并要求新修订。",
        offlineLimit: "没有同一哈希的题名摘要快照时，只能重算冻结分类结果的聚合，不能声称离线重放原文分类。",
      },
      boundary: "逐条账本用于审计并可在重取同一快照后验证当前样本；命中总数与20篇分层样本必须分开解释，样本主题分布不能替代全领域文献计量。",
    },
    derivedAnalysis: {
      schemaVersion: "research-review-derived-analysis/v1",
      classifierVersion: RESEARCH_REVIEW_CLASSIFIER_VERSION,
      sourceSetHash,
      reportRevision,
      analyzedSourceIds: includedRows.map((row) => row.sourceId),
      yearDistribution: distribution(includedRows.map((row) => row.year)),
      journalDistribution: distribution(includedRows.map((row) => row.journal)),
      themeDistribution: asArray(synthesis?.themeCoverage).map((theme) => {
        const sourceIds = includedRows
          .filter((row) => row.themeIds.includes(theme.id))
          .map((row) => row.sourceId);
        return {
          id: theme.id,
          label: theme.label,
          count: sourceIds.length,
          sourceIds,
        };
      }),
      titlePatternDistribution: distribution(
        includedRows.map((row) => TITLE_PATTERN_RULES.find((rule) => rule.id === row.titlePatternId)?.label ?? "其他题名结构"),
      ),
      reviewSynthesis: synthesis,
      boundary: "年份、期刊、主题和题名结构均由同一逐条账本复算；时间变化仅描述当前分层样本，不外推为全领域发文趋势。",
    },
    boundary: "这是题名摘要级、来源集绑定的科研简报合同。reportHash 是内容指纹而非数字签名；可信性必须依赖项目事件库、冻结检索回执或版本库中的独立可信根。它不能替代全文系统综述、临床指南、研究空白定论或作者责任确认。",
  };
  report.binding.frozenSourceManifestHash = frozenSourceManifestHashFor(report);
  report.binding.derivedAnalysisHash = derivedAnalysisHashFor(report);
  report.binding.reportHash = reportHashFor(report);
  assertResearchReportBinding(report, binding);
  return report;
}

export function assertResearchReportBinding(report, expected = {}) {
  if (!report || report.schemaVersion !== RESEARCH_REPORT_SCHEMA_VERSION) {
    throw new TypeError(`research report must use ${RESEARCH_REPORT_SCHEMA_VERSION}`);
  }
  const binding = report.binding;
  if (!binding || typeof binding !== "object") {
    throw new TypeError("research report binding is required");
  }
  assertReportRevision(binding.reportRevision);
  if (!/^[a-f0-9]{64}$/i.test(binding.sourceSetHash ?? "")) {
    throw new TypeError("research report sourceSetHash must be SHA-256");
  }
  if (!/^[a-f0-9]{64}$/i.test(binding.reportHash ?? "")) {
    throw new TypeError("research report reportHash must be SHA-256");
  }
  if (!/^[a-f0-9]{64}$/i.test(binding.frozenSourceManifestHash ?? "")) {
    throw new TypeError("research report frozenSourceManifestHash must be SHA-256");
  }
  if (!/^[a-f0-9]{64}$/i.test(binding.derivedAnalysisHash ?? "")) {
    throw new TypeError("research report derivedAnalysisHash must be SHA-256");
  }
  if (expected.projectId !== undefined && binding.projectId !== expected.projectId) {
    throw new TypeError("research report projectId binding mismatch");
  }
  if (expected.sourceSetHash !== undefined && binding.sourceSetHash !== expected.sourceSetHash) {
    throw new TypeError("research report sourceSetHash binding mismatch");
  }
  if (expected.reportRevision !== undefined && binding.reportRevision !== expected.reportRevision) {
    throw new TypeError("research report reportRevision binding mismatch");
  }
  if (expected.reportHash !== undefined && binding.reportHash !== expected.reportHash) {
    throw new TypeError("research report reportHash binding mismatch");
  }
  if (
    expected.frozenSourceManifestHash !== undefined
    && binding.frozenSourceManifestHash !== expected.frozenSourceManifestHash
  ) {
    throw new TypeError("research report frozenSourceManifestHash binding mismatch");
  }
  if (expected.derivedAnalysisHash !== undefined && binding.derivedAnalysisHash !== expected.derivedAnalysisHash) {
    throw new TypeError("research report derivedAnalysisHash binding mismatch");
  }
  if (report.ledger?.sourceSetHash !== binding.sourceSetHash) {
    throw new TypeError("research report ledger sourceSetHash binding mismatch");
  }
  if (
    report.derivedAnalysis?.sourceSetHash !== binding.sourceSetHash ||
    report.derivedAnalysis?.reportRevision !== binding.reportRevision
  ) {
    throw new TypeError("research report derived analysis binding mismatch");
  }
  const rows = asArray(report.ledger?.rows);
  const includedRows = rows.filter((row) => row.includedInDerivedAnalysis === true);
  if (
    report.externalReviewVerification?.status !== "not_performed"
    || asArray(report.externalReviewVerification?.receipts).length !== 0
  ) {
    throw new TypeError("research report external review verification must remain fail-closed without direction-bound receipts");
  }
  if (report.ledger?.rowCount !== rows.length) {
    throw new TypeError("research report ledger rowCount mismatch");
  }
  if (report.ledger?.analyzedRowCount !== includedRows.length) {
    throw new TypeError("research report ledger analyzedRowCount mismatch");
  }
  const relevanceRows = asArray(report.relevanceGate?.rows);
  const relevantCount = relevanceRows.filter((row) => row.status === "relevant").length;
  if (
    report.relevanceGate?.totalCount !== rows.length
    || relevanceRows.length !== rows.length
    || report.relevanceGate?.relevantCount !== relevantCount
    || report.relevanceGate?.notRelevantCount !== rows.length - relevantCount
  ) {
    throw new TypeError("research report relevance gate counts mismatch");
  }
  const expectedGateStatus = asArray(report.relevanceGate?.subjectConcepts).length > 0 && relevantCount > 0
    ? "passed"
    : "blocked";
  if (report.relevanceGate?.status !== expectedGateStatus) {
    throw new TypeError("research report relevance gate status mismatch");
  }
  for (const row of rows) {
    const relevanceRow = relevanceRows.find((item) => item.sourceId === row.sourceId);
    if (!relevanceRow || relevanceRow.title !== row.title || relevanceRow.status !== row.relevance?.status) {
      throw new TypeError("research report relevance row mismatch");
    }
    const expectedIncluded = row.relevance?.status === "relevant";
    if (row.includedInDerivedAnalysis !== expectedIncluded) {
      throw new TypeError("research report ledger includedInDerivedAnalysis mismatch");
    }
    if (row.pmid && row.locator?.pmid && String(row.pmid) !== String(row.locator.pmid)) {
      throw new TypeError("research report ledger PMID locator mismatch");
    }
    if (row.pmid && /^pubmed:/i.test(row.sourceId ?? "") && row.sourceId.split(":").at(-1) !== String(row.pmid)) {
      throw new TypeError("research report ledger PMID sourceId mismatch");
    }
    if (!/^[a-f0-9]{64}$/i.test(row.sourceSnapshotHash ?? "")) {
      throw new TypeError("research report ledger sourceSnapshotHash must be SHA-256");
    }
    if (row.titlePatternId !== titlePatternFor(row.title).id) {
      throw new TypeError("research report ledger titlePatternId mismatch");
    }
    if (!sameDerivedValue(row.themeIds, asArray(row.classifierAudit?.themes).map((item) => item.id))) {
      throw new TypeError("research report ledger theme classifier audit mismatch");
    }
    if (!sameDerivedValue(row.methodSignalIds, asArray(row.classifierAudit?.methods).map((item) => item.id))) {
      throw new TypeError("research report ledger method classifier audit mismatch");
    }
    if (!sameDerivedValue(row.gapSignalIds, asArray(row.classifierAudit?.gaps).map((item) => item.id))) {
      throw new TypeError("research report ledger gap classifier audit mismatch");
    }
    if (!sameDerivedValue(row.problemSignalIds, asArray(row.classifierAudit?.problems).map((item) => item.id))) {
      throw new TypeError("research report ledger problem classifier audit mismatch");
    }
  }
  if (sourceSetHashForRecords(includedRows) !== binding.sourceSetHash) {
    throw new TypeError("research report sourceSetHash does not match included ledger rows");
  }
  if (sourceSetHashForRecords(rows) !== report.ledger?.retrievalSourceSetHash) {
    throw new TypeError("research report retrievalSourceSetHash does not match ledger rows");
  }
  const expectedAnalyzedSourceIds = includedRows.map((row) => row.sourceId);
  if (!sameDerivedValue(report.derivedAnalysis?.analyzedSourceIds, expectedAnalyzedSourceIds)) {
    throw new TypeError("research report analyzedSourceIds mismatch");
  }
  if (!sameDerivedValue(
    report.derivedAnalysis?.yearDistribution,
    distribution(includedRows.map((row) => row.year)),
  )) {
    throw new TypeError("research report yearDistribution mismatch");
  }
  if (!sameDerivedValue(
    report.derivedAnalysis?.journalDistribution,
    distribution(includedRows.map((row) => row.journal)),
  )) {
    throw new TypeError("research report journalDistribution mismatch");
  }
  const themeLabels = new Map(includedRows.flatMap((row) => (
    asArray(row.classifierAudit?.themes).map((theme) => [theme.id, theme.label])
  )));
  const expectedThemeDistribution = [...themeLabels.entries()]
    .map(([id, label]) => {
      const sourceIds = includedRows.filter((row) => row.themeIds.includes(id)).map((row) => row.sourceId);
      return { id, label, count: sourceIds.length, sourceIds };
    })
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  if (!sameDerivedValue(report.derivedAnalysis?.themeDistribution, expectedThemeDistribution)) {
    throw new TypeError("research report themeDistribution mismatch");
  }
  const expectedTitlePatternDistribution = distribution(includedRows.map((row) => (
    TITLE_PATTERN_RULES.find((rule) => rule.id === row.titlePatternId)?.label ?? "其他题名结构"
  )));
  if (!sameDerivedValue(report.derivedAnalysis?.titlePatternDistribution, expectedTitlePatternDistribution)) {
    throw new TypeError("research report titlePatternDistribution mismatch");
  }
  if (frozenSourceManifestHashFor(report) !== binding.frozenSourceManifestHash) {
    throw new TypeError("research report frozenSourceManifestHash does not match source manifest content");
  }
  if (derivedAnalysisHashFor(report) !== binding.derivedAnalysisHash) {
    throw new TypeError("research report derivedAnalysisHash does not match derived report content");
  }
  if (reportHashFor(report) !== binding.reportHash) {
    throw new TypeError("research report reportHash does not match report content");
  }
  return report;
}

export function bindArtifactToResearchReport(content, report) {
  if (!report) return content;
  assertResearchReportBinding(report);
  return {
    ...structuredClone(content),
    reportBinding: structuredClone(report.binding),
  };
}

export function assertArtifactResearchReportBinding(content, report) {
  if (!report) return content;
  assertResearchReportBinding(report);
  const binding = content?.reportBinding;
  if (
    binding?.projectId !== report.binding.projectId ||
    binding?.sourceSetHash !== report.binding.sourceSetHash ||
    binding?.reportRevision !== report.binding.reportRevision
    || binding?.reportHash !== report.binding.reportHash
  ) {
    throw new TypeError("artifact report binding mismatch");
  }
  return content;
}

export function assertResearchReportSelectionBinding(selection, report) {
  assertResearchReportBinding(report);
  const binding = selection?.reportBinding;
  if (!binding || typeof binding !== "object") {
    throw new TypeError("research direction selection reportBinding is required");
  }
  if (binding.projectId !== report.binding.projectId) {
    throw new TypeError("research direction selection projectId binding mismatch");
  }
  if (binding.sourceSetHash !== report.binding.sourceSetHash) {
    throw new TypeError("research direction selection sourceSetHash binding mismatch");
  }
  if (binding.reportRevision !== report.binding.reportRevision) {
    throw new TypeError("research direction selection reportRevision binding mismatch");
  }
  if (binding.reportHash !== report.binding.reportHash) {
    throw new TypeError("research direction selection reportHash binding mismatch");
  }
  return selection;
}
