import { sha256 } from "./event-engine-v1.js";

const QUERY_PLAN_SCHEMA = "research-query-plan/v1";
const DEFAULT_SAMPLE_LIMIT = 3;
const MAX_SAMPLE_LIMIT = 5;

const CONCEPT_DICTIONARY = Object.freeze([
  { source: "围术期", patterns: [/围术期/g], terms: ["perioperative", "postoperative"] },
  { source: "术后", patterns: [/术后/g], terms: ["postoperative", "postoperative care"] },
  { source: "睡眠", patterns: [/睡眠/g, /失眠/g], terms: ["sleep", "sleep quality", "insomnia"] },
  { source: "恢复", patterns: [/恢复/g, /康复/g], terms: ["recovery", "rehabilitation"] },
  { source: "疼痛", patterns: [/疼痛/g], terms: ["pain", "pain management"] },
  { source: "炎症", patterns: [/炎症/g], terms: ["inflammation", "inflammatory"] },
  { source: "乳腺癌", patterns: [/乳腺癌/g], terms: ["breast neoplasms", "breast cancer"] },
  { source: "肺癌", patterns: [/肺癌/g], terms: ["lung neoplasms", "lung cancer"] },
  { source: "结直肠癌", patterns: [/结直肠癌/g, /直肠癌/g, /结肠癌/g], terms: ["colorectal neoplasms", "colorectal cancer"] },
  { source: "肿瘤", patterns: [/肿瘤/g, /癌症/g, /癌/g], terms: ["neoplasm", "cancer"] },
  { source: "糖尿病", patterns: [/糖尿病/g], terms: ["diabetes mellitus", "diabetes"] },
  { source: "高血压", patterns: [/高血压/g], terms: ["hypertension", "high blood pressure"] },
  { source: "脑卒中", patterns: [/脑卒中/g, /中风/g], terms: ["stroke", "cerebrovascular accident"] },
  { source: "抑郁", patterns: [/抑郁/g], terms: ["depression", "depressive disorder"] },
  { source: "焦虑", patterns: [/焦虑/g], terms: ["anxiety", "anxiety disorder"] },
  { source: "肥胖", patterns: [/肥胖/g], terms: ["obesity", "overweight"] },
  { source: "肠道菌群", patterns: [/肠道菌群/g, /肠道微生物/g], terms: ["gut microbiota", "intestinal microbiome"] },
  { source: "中医药", patterns: [/中医药/g, /中药/g, /中医/g], terms: ["traditional Chinese medicine", "Chinese herbal medicine"] },
  { source: "针灸", patterns: [/针灸/g, /针刺/g], terms: ["acupuncture", "acupuncture therapy"] },
  { source: "化疗相关疲乏", patterns: [/化疗相关疲乏/g, /化疗相关疲劳/g], terms: ["chemotherapy-related fatigue", "cancer-related fatigue"] },
  { source: "癌因性疲乏", patterns: [/癌因性疲乏/g, /癌症相关疲乏/g, /肿瘤相关疲乏/g], terms: ["cancer-related fatigue", "fatigue"] },
  { source: "运动", patterns: [/运动/g, /锻炼/g], terms: ["exercise", "physical activity"] },
  { source: "老年人", patterns: [/老年人/g, /老年/g], terms: ["aged", "older adults"] },
  { source: "儿童", patterns: [/儿童/g, /小儿/g], terms: ["child", "pediatric"] },
  { source: "孕产妇", patterns: [/孕妇/g, /妊娠/g, /孕产妇/g], terms: ["pregnancy", "pregnant women"] },
  { source: "人工智能", patterns: [/人工智能/g, /机器学习/g], terms: ["artificial intelligence", "machine learning"] },
  { source: "网络药理学", patterns: [/网络药理学/g, /网络药理/g], terms: ["network pharmacology", "systems pharmacology"] },
]);

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isoNow(now) {
  const value = now();
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function normalizeSampleLimit(value) {
  const parsed = Number(value ?? DEFAULT_SAMPLE_LIMIT);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_SAMPLE_LIMIT;
  return Math.min(parsed, MAX_SAMPLE_LIMIT);
}

function escapePhrase(value) {
  return String(value).replaceAll('"', "").trim();
}

function fieldPhrase(term) {
  const clean = escapePhrase(term);
  return `${clean.includes(" ") ? `"${clean}"` : clean}[Title/Abstract]`;
}

function extractMappings(question) {
  const mappings = [];
  let unmapped = question;
  for (const concept of CONCEPT_DICTIONARY) {
    const matched = concept.patterns.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(unmapped);
    });
    if (!matched) continue;
    mappings.push({
      sourceTerm: concept.source,
      mappedTerms: [...concept.terms],
      confidence: "curated_starter",
    });
    for (const pattern of concept.patterns) {
      pattern.lastIndex = 0;
      unmapped = unmapped.replace(pattern, " ");
    }
  }
  unmapped = unmapped
    .replace(/患者/g, " ")
    .replace(/能否|是否|有没有|有无|可以|能够|改善|缓解|降低|提高|影响|之间|什么|如何|关系|作用|相关|研究|评价|分析|探讨/g, " ")
    .replace(/[，。！？、；：,.!?;:()（）]/g, " ");
  const unknownChinese = [...new Set(
    (unmapped.match(/[\u3400-\u9fff]{2,}/g) ?? [])
      .map((value) => value.replace(/^(研究|评价|分析|探讨|是否|之间|什么|如何|影响|关系|作用)+|[有的与和及中对吗呢是]$/g, ""))
      .filter((value) => value.length >= 2),
  )];
  return { mappings, unknownChinese };
}

function fallbackCandidates(question) {
  const clean = escapePhrase(question);
  return [
    {
      id: "question_verbatim",
      label: "原问题保真版",
      strategy: "不翻译未识别概念，直接把原问题交给 PubMed 试检。",
      query: clean,
    },
    {
      id: "question_title_abstract",
      label: "题名摘要限定版",
      strategy: "不猜测英文含义，只把原问题限定在题名与摘要字段。",
      query: `"${clean}"[Title/Abstract]`,
    },
  ];
}

export function generatePubMedQueryCandidates({ question } = {}) {
  if (!hasText(question)) {
    const error = new Error("研究问题不能为空。");
    error.code = "INVALID_RESEARCH_QUESTION";
    throw error;
  }
  const normalizedQuestion = question.trim();
  const { mappings, unknownChinese } = extractMappings(normalizedQuestion);
  if (mappings.length === 0) {
    return {
      mappings,
      unknownChinese: unknownChinese.length > 0 ? unknownChinese : [normalizedQuestion],
      candidates: fallbackCandidates(normalizedQuestion),
    };
  }

  const broadParts = mappings.map(({ mappedTerms }) => `(${mappedTerms.map(fieldPhrase).join(" OR ")})`);
  const focusedParts = mappings.map(({ mappedTerms }) => fieldPhrase(mappedTerms[0]));
  return {
    mappings,
    unknownChinese,
    candidates: [
      {
        id: "broad_synonyms",
        label: "宽召回版",
        strategy: "每个已识别概念保留多个近义起始词，再用 AND 连接概念组。",
        query: broadParts.join(" AND "),
      },
      {
        id: "focused_terms",
        label: "聚焦版",
        strategy: "每个已识别概念只保留一个起始词，降低宽召回版可能带来的噪声。",
        query: focusedParts.join(" AND "),
      },
    ],
  };
}

function normalizeProvidedCandidates(candidateQueries) {
  if (!Array.isArray(candidateQueries) || candidateQueries.length < 2) return null;
  return candidateQueries.slice(0, 6).map((candidate, index) => {
    const query = hasText(candidate?.query) ? candidate.query.trim() : "";
    if (query.length < 3) {
      const error = new Error(`第 ${index + 1} 个检索候选至少需要 3 个字符。`);
      error.code = "INVALID_SEARCH_QUERY";
      throw error;
    }
    return {
      id: hasText(candidate?.id) ? candidate.id.trim().slice(0, 80) : `expert_${index + 1}`,
      label: hasText(candidate?.label) ? candidate.label.trim().slice(0, 80) : `专家候选 ${index + 1}`,
      strategy: hasText(candidate?.strategy)
        ? candidate.strategy.trim().slice(0, 500)
        : "研究者手动修改后重新执行真实试检。",
      query: query.slice(0, 2000),
    };
  });
}

function sampleFromRecord(record) {
  const abstract = hasText(record?.abstract) ? record.abstract.trim() : null;
  return {
    sourceId: record?.sourceId ?? (record?.pmid ? `pubmed:${record.pmid}` : null),
    pmid: record?.pmid ?? null,
    title: record?.title ?? "题名未返回",
    abstractSnippet: abstract ? abstract.slice(0, 360) : null,
    accessLevel: record?.accessLevel ?? (abstract ? "abstract_only" : "title_only"),
    locator: record?.locator ?? null,
    noiseStatus: "unreviewed",
  };
}

async function calibrateCandidate(gateway, candidate, sampleLimit, signal) {
  try {
    const search = await gateway.searchPubMed({ query: candidate.query, limit: sampleLimit }, signal);
    const ids = Array.isArray(search?.resultIds) ? search.resultIds.map(String).filter(Boolean) : [];
    if (ids.length === 0) {
      return {
        ...candidate,
        status: "zero_results",
        executedAt: search?.executedAt ?? null,
        total: Number(search?.total ?? 0),
        sampledCount: 0,
        samples: [],
        boundary: "PubMed 本次真实试检返回 0 条；这不证明该领域没有研究，只说明当前检索表达未取得候选。",
      };
    }
    const fetched = await gateway.fetchPubMed({ resultIds: ids }, signal);
    const samples = (Array.isArray(fetched?.records) ? fetched.records : [])
      .slice(0, sampleLimit)
      .map(sampleFromRecord);
    return {
      ...candidate,
      status: "ready",
      executedAt: search?.executedAt ?? null,
      fetchedAt: fetched?.fetchedAt ?? null,
      total: Number(search?.total ?? ids.length),
      sampledCount: samples.length,
      samples,
      boundary: "命中量来自 PubMed 本次真实试检；样本是当前排序前 N 条未筛选题名/摘要，仅供噪声抽查，不代表已纳入文献、领域趋势或研究空白。",
    };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return {
      ...candidate,
      status: "failed",
      total: null,
      sampledCount: 0,
      samples: [],
      error: { code: error?.code ?? "PUBMED_PREVIEW_FAILED", message: error?.message ?? String(error) },
      boundary: "本候选没有完成真实试检；不得把它的命中量或适用性当作已知。",
    };
  }
}

export async function previewPubMedQueryPlan({
  gateway,
  question,
  candidateQueries = null,
  sampleLimit = DEFAULT_SAMPLE_LIMIT,
  signal,
  now = () => new Date(),
} = {}) {
  if (!gateway || typeof gateway.searchPubMed !== "function" || typeof gateway.fetchPubMed !== "function") {
    const error = new Error("当前运行没有配置可用的 PubMed 试检工具。");
    error.code = "PUBMED_GATEWAY_UNAVAILABLE";
    throw error;
  }
  const generated = generatePubMedQueryCandidates({ question });
  const candidates = normalizeProvidedCandidates(candidateQueries) ?? generated.candidates;
  const limit = normalizeSampleLimit(sampleLimit);
  const calibrated = [];
  for (const candidate of candidates) {
    calibrated.push(await calibrateCandidate(gateway, candidate, limit, signal));
  }
  const generatedAt = isoNow(now);
  const plan = {
    schemaVersion: QUERY_PLAN_SCHEMA,
    question: question.trim(),
    generatedAt,
    planner: {
      mode: "guided_transparent_mapping",
      claim: "这是可检查的起始词汇映射，不是医学主题词专家审核，也不是完整召回保证。",
    },
    mappings: generated.mappings,
    unknownChinese: generated.unknownChinese,
    recallCheck: {
      kind: "query_concept_coverage_only",
      mappedConceptCount: generated.mappings.length,
      unknownConceptCount: generated.unknownChinese.length,
      boundary: "这里只检查检索式是否覆盖已映射概念，不等于数据库召回率或系统综述敏感度验证。",
    },
    sampleLimit: limit,
    candidates: calibrated,
    humanDecision: "not_recorded",
    accessBoundary: "仅访问 PubMed 题录与可用摘要；未访问全文、补充材料或其他数据库。检索预演不会建立项目，也不会批准任何人工门禁。",
  };
  return { ...plan, planHash: sha256(plan) };
}

export const RESEARCH_QUERY_PLANNER_INFO = Object.freeze({
  schemaVersion: QUERY_PLAN_SCHEMA,
  defaultSampleLimit: DEFAULT_SAMPLE_LIMIT,
  maxSampleLimit: MAX_SAMPLE_LIMIT,
  candidateMinimum: 2,
});
