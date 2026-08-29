import { sha256 } from "./event-engine-v1.js";
import {
  buildFeedbackQueryStrategyPrompt,
  compilePubMedConceptMatrix,
  createQueryStrategyModel,
} from "./research-query-strategy-agent-v1.js";

const CALIBRATION_SCHEMA = "research-query-calibration/v1";
const CALIBRATION_SAMPLE_LIMIT = 100;
const CALIBRATION_PROMPT_ID = "professional-query-feedback-optimization/v3";
const STOPWORDS = new Set([
  "about", "among", "analysis", "associated", "association", "based", "between",
  "clinical", "effect", "effects", "evidence", "from", "health", "patients", "study",
  "systematic", "review", "reviews", "with", "within", "using", "result", "results",
]);

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function recordText(record) {
  return `${record?.title ?? ""} ${record?.abstract ?? ""}`.toLowerCase();
}

function normalizedNeedles(mapping) {
  const values = [
    ...(mapping?.mappedTerms ?? []),
    ...(mapping?.meshTerms ?? []),
    ...(mapping?.wildcardTerms ?? []).map((term) => String(term).replace(/\*+$/g, "")),
    ...(mapping?.proximityTerms ?? []).map((item) => item?.phrase),
  ];
  return [...new Set(values.map((value) => String(value ?? "").toLowerCase().trim()).filter(Boolean))];
}

function conceptCoverage(records, mappings) {
  return (Array.isArray(mappings) ? mappings : []).map((mapping) => {
    const needles = normalizedNeedles(mapping);
    const matched = records.filter((record) => {
      const text = recordText(record);
      return needles.some((needle) => text.includes(needle));
    });
    return {
      conceptId: mapping.conceptId,
      sourceTerm: mapping.sourceTerm,
      matchedCount: matched.length,
      sampledCount: records.length,
      rate: records.length ? matched.length / records.length : null,
      matchedSourceIds: matched.slice(0, 8).map((record) => record?.sourceId).filter(Boolean),
      boundary: "按当前词群对题名与可用摘要做字面覆盖检查；未命中不等于语义不相关。",
    };
  });
}

function coverageDistribution(records, mappings) {
  const needles = (Array.isArray(mappings) ? mappings : []).map(normalizedNeedles);
  const counts = new Map();
  for (const record of records) {
    const text = recordText(record);
    const matched = needles.filter((group) => group.some((needle) => text.includes(needle))).length;
    counts.set(matched, (counts.get(matched) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([matchedConceptCount, count]) => ({ matchedConceptCount, count }))
    .sort((left, right) => left.matchedConceptCount - right.matchedConceptCount);
}

function frequentTerms(records, limit = 12) {
  const frequencies = new Map();
  for (const record of records) {
    const terms = new Set(
      (String(record?.title ?? "").toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? [])
        .map((term) => term.replace(/^-+|-+$/g, ""))
        .filter((term) => term.length >= 4 && !STOPWORDS.has(term)),
    );
    for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  }
  return [...frequencies.entries()]
    .map(([term, count]) => ({ term, count }))
    .sort((left, right) => right.count - left.count || left.term.localeCompare(right.term))
    .slice(0, limit);
}

function summarizeRecord(record) {
  return {
    sourceId: record?.sourceId ?? (record?.pmid ? `pubmed:${record.pmid}` : null),
    pmid: record?.pmid ?? null,
    title: record?.title ?? "题名未返回",
    year: record?.year ?? null,
    journal: record?.journal ?? null,
    abstractAvailable: hasText(record?.abstract),
    abstractSnippet: hasText(record?.abstract) ? record.abstract.trim().slice(0, 360) : null,
    accessLevel: record?.accessLevel ?? (hasText(record?.abstract) ? "abstract_only" : "title_only"),
    locator: record?.locator ?? null,
  };
}

function normalizeSelectedCandidate(plan, selectedCandidateId, editedQuery) {
  const selected = plan?.candidates?.find((candidate) => candidate.id === selectedCandidateId);
  if (!selected) {
    const error = new Error("前 100 篇反馈必须绑定初稿中的一个检索路径。");
    error.code = "INVALID_CALIBRATION_CANDIDATE";
    throw error;
  }
  const query = hasText(editedQuery) ? editedQuery.trim() : selected.query;
  if (!hasText(query) || query.length < 3) {
    const error = new Error("用于前 100 篇反馈的 PubMed 检索式至少需要 3 个字符。");
    error.code = "INVALID_SEARCH_QUERY";
    throw error;
  }
  return {
    ...selected,
    id: hasText(editedQuery) && query !== selected.query ? "researcher_edited" : selected.id,
    label: hasText(editedQuery) && query !== selected.query ? "研究者修订初稿" : selected.label,
    query: query.slice(0, 5000),
  };
}

function revisionReceipt(model, status, prompt, error = null) {
  return {
    templateId: CALIBRATION_PROMPT_ID,
    templateHash: sha256(prompt),
    status,
    mode: model.descriptor.mode,
    provider: model.descriptor.provider,
    modelId: model.descriptor.modelId,
    ...(error ? { error: String(error?.message ?? error).slice(0, 500) } : {}),
  };
}

export async function calibratePubMedQueryStrategy({
  gateway,
  question,
  plan,
  selectedCandidateId,
  editedQuery = null,
  model = createQueryStrategyModel(),
  signal,
  now = () => new Date(),
} = {}) {
  if (!gateway || typeof gateway.searchPubMed !== "function" || typeof gateway.fetchPubMed !== "function") {
    const error = new Error("当前运行没有配置可用的 PubMed 反馈工具。");
    error.code = "PUBMED_GATEWAY_UNAVAILABLE";
    throw error;
  }
  const selected = normalizeSelectedCandidate(plan, selectedCandidateId, editedQuery);
  if (plan?.directionSeed) {
    const frozenDirectionCandidate = (plan.candidates ?? []).find(
      (candidate) => candidate.id === selectedCandidateId,
    );
    if (!frozenDirectionCandidate || frozenDirectionCandidate.query !== selected.query) {
      const error = new Error("第二轮聚焦检索式已经改变；必须回到方向选择重新生成，不能在校准时删除或替换方向词群。");
      error.code = "DIRECTION_SEED_QUERY_MISMATCH";
      throw error;
    }
  }
  const search = await gateway.searchPubMed({ query: selected.query, limit: CALIBRATION_SAMPLE_LIMIT }, signal);
  const ids = (Array.isArray(search?.resultIds) ? search.resultIds : [])
    .map(String)
    .filter(Boolean)
    .slice(0, CALIBRATION_SAMPLE_LIMIT);
  const fetched = ids.length ? await gateway.fetchPubMed({ resultIds: ids }, signal) : { records: [] };
  const records = (Array.isArray(fetched?.records) ? fetched.records : []).slice(0, CALIBRATION_SAMPLE_LIMIT);
  const coverage = conceptCoverage(records, plan?.mappings);
  const distribution = coverageDistribution(records, plan?.mappings);
  const expectedConceptCount = Math.max(
    1,
    Array.isArray(selected?.includedConceptIds) && selected.includedConceptIds.length > 0
      ? selected.includedConceptIds.length
      : Array.isArray(plan?.mappings)
        ? plan.mappings.length
        : 1,
  );
  const potentialNoiseMaxMatchedConcepts = expectedConceptCount === 1 ? 0 : 1;
  const potentialNoiseCount = distribution
    .filter((item) => item.matchedConceptCount <= potentialNoiseMaxMatchedConcepts)
    .reduce((total, item) => total + item.count, 0);
  const potentialNoiseDefinition = expectedConceptCount === 1
    ? "题名与可用摘要未字面命中当前单一概念组；这是待人工抽查线索，不是自动排除结论。"
    : "题名与可用摘要仅字面命中 0–1 个当前概念组；这是待人工抽查线索，不是自动排除结论。";
  const feedback = {
    sampledCount: records.length,
    abstractAvailableCount: records.filter((record) => hasText(record?.abstract)).length,
    conceptCoverage: coverage,
    matchedConceptDistribution: distribution,
    expectedConceptCount,
    potentialNoiseMaxMatchedConcepts,
    potentialNoiseCount,
    potentialNoiseDefinition,
    frequentTitleTerms: frequentTerms(records),
  };
  const prompt = buildFeedbackQueryStrategyPrompt({ question, records, feedback });
  let revisedPlan = {
    ...plan,
    candidates: [selected, ...(plan?.candidates ?? []).filter((candidate) => candidate.id !== selectedCandidateId)],
  };
  let revision = revisionReceipt(model, "model_not_configured", prompt);
  if (model.configured && records.length > 0 && !plan?.directionSeed) {
    try {
      const output = await model.completeJson(prompt, { signal });
      const matrix = compilePubMedConceptMatrix(output?.concepts);
      const candidatePlan = {
        ...plan,
        generatedAt: now().toISOString(),
        planner: {
          ...plan.planner,
          mode: "prompt_feedback_revised_pubmed_matrix_v2",
          claim: "已依据 PubMed 当前排序前 100 条题名与可用摘要修订词群，并重新编译检索方案。",
        },
        mappings: matrix.mappings,
        conceptGroups: matrix.conceptGroups,
        candidates: matrix.candidates,
        modelQualityNotes: Array.isArray(output?.qualityNotes) ? output.qualityNotes.slice(0, 12) : [],
      };
      const { planHash: _oldHash, ...payload } = candidatePlan;
      revisedPlan = { ...payload, planHash: sha256(payload) };
      revision = revisionReceipt(model, "completed", prompt);
    } catch (error) {
      revision = revisionReceipt(model, "model_failed", prompt, error);
    }
  }
  const compactSources = records.slice(0, 12).map(summarizeRecord);
  const result = {
    schemaVersion: CALIBRATION_SCHEMA,
    question: String(question ?? "").trim(),
    initialPlanHash: plan.planHash,
    selectedCandidate: selected,
    executedAt: search?.executedAt ?? now().toISOString(),
    fetchedAt: fetched?.fetchedAt ?? null,
    total: Number(search?.total ?? ids.length),
    requestedSampleLimit: CALIBRATION_SAMPLE_LIMIT,
    feedback,
    revision,
    revisedPlan,
    sources: compactSources,
    accessBoundary: `本轮请求 PubMed 当前排序前 ${CALIBRATION_SAMPLE_LIMIT} 条，实际读取 ${records.length} 条题名与可用摘要；未访问全文，也没有自动排除文献。`,
    stageBrief: {
      currentResearchPeriod: "确认研究问题 · 检索式前 100 篇反馈校准",
      newFindings: [
        `初稿当前命中 ${Number(search?.total ?? ids.length)} 条，本轮读取前 ${records.length} 条题名与可用摘要。`,
        `其中 ${feedback.abstractAvailableCount} 条有摘要，${feedback.potentialNoiseCount} 条${expectedConceptCount === 1 ? "未字面命中当前单一概念组" : "仅字面命中 0–1 个当前概念组"}，需人工抽查。`,
        revision.status === "completed"
          ? "已完成第二轮自动修订并生成新策略。"
          : "实时模型未完成自动修订；保留原策略与可追溯样本，改变检索式需重新校准。",
      ],
      evidenceBoundary: "覆盖率是当前词群对题名/摘要的字面检查，不是语义相关性判定、正式纳排或数据库召回率。",
      nextDecision: "从本轮已绑定候选中选择扫描方案；若要修改检索式，请建立新的调查链并重新执行前 100 篇反馈。",
    },
  };
  return { ...result, calibrationHash: sha256(result) };
}

export const RESEARCH_QUERY_CALIBRATION_INFO = Object.freeze({
  schemaVersion: CALIBRATION_SCHEMA,
  sampleLimit: CALIBRATION_SAMPLE_LIMIT,
  promptTemplateId: CALIBRATION_PROMPT_ID,
});
