import { sha256 } from "./event-engine-v1.js";
import { buildResearchReportContract } from "./research-report-contract-v1.js";

const QUERY_PLAN_SCHEMA = "research-query-plan/v2";
const DEFAULT_SAMPLE_LIMIT = 3;
const MAX_SAMPLE_LIMIT = 5;
const DEFAULT_REVIEW_WINDOW_YEARS = 5;
const MAX_REVIEW_WINDOW_YEARS = 10;
const DEFAULT_REVIEW_SAMPLE_LIMIT = 20;
const METHOD_FOCUSED_REVIEW_CLAUSE = `(${[
  "systematic[sb]",
  "meta-analysis[Publication Type]",
  '"systematic review"[Title/Abstract]',
  '"scoping review"[Title/Abstract]',
  '"umbrella review"[Title/Abstract]',
].join(" OR ")}) NOT guideline[Publication Type] NOT practice guideline[Publication Type]`;

const CONCEPT_DICTIONARY = Object.freeze([
  { source: "围术期", patterns: [/围术期/g], terms: ["perioperative", "postoperative"] },
  { source: "术后恢复", patterns: [/术后恢复/g, /术后康复/g], terms: ["postoperative recovery", "recovery after surgery", "postsurgical recovery"] },
  { source: "术后", patterns: [/术后/g], terms: ["postoperative", "postoperative care"] },
  { source: "睡眠质量", patterns: [/睡眠质量/g], terms: ["sleep quality", "sleep disturbance", "poor sleep"] },
  { source: "睡眠", patterns: [/睡眠/g, /失眠/g], terms: ["sleep", "sleep quality", "insomnia"] },
  { source: "恢复", patterns: [/恢复/g, /康复/g], terms: ["recovery", "rehabilitation"] },
  { source: "疼痛", patterns: [/疼痛/g], terms: ["pain", "pain management"] },
  { source: "炎症", patterns: [/炎症/g], terms: ["inflammation", "inflammatory"] },
  { source: "乳腺癌", patterns: [/乳腺癌/g], terms: ["breast neoplasms", "breast cancer"] },
  {
    source: "肺癌",
    patterns: [/肺癌/g],
    terms: [
      "lung cancer",
      "pulmonary cancer",
      "cancer of the lung",
      "lung neoplasm",
      "lung neoplasms",
      "pulmonary neoplasm",
      "pulmonary neoplasms",
      "lung carcinoma",
      "pulmonary carcinoma",
      "bronchogenic carcinoma",
      "bronchial carcinoma",
      "lung tumor",
      "lung tumour",
      "non-small cell lung cancer",
      "non-small-cell lung cancer",
      "nonsmall cell lung cancer",
      "NSCLC",
      "small cell lung cancer",
      "small-cell lung cancer",
      "SCLC",
      "lung adenocarcinoma",
      "pulmonary adenocarcinoma",
      "lung squamous cell carcinoma",
      "pulmonary squamous cell carcinoma",
    ],
    proximityTerms: [
      { phrase: "lung cancer", distance: 3 },
      { phrase: "pulmonary cancer", distance: 3 },
      { phrase: "lung neoplasm", distance: 3 },
      { phrase: "pulmonary neoplasm", distance: 3 },
      { phrase: "lung carcinoma", distance: 3 },
      { phrase: "pulmonary carcinoma", distance: 3 },
    ],
    excludedAmbiguities: ["LC（缩写歧义过高，不单独纳入）"],
  },
  { source: "结直肠癌", patterns: [/结直肠癌/g, /直肠癌/g, /结肠癌/g], terms: ["colorectal neoplasms", "colorectal cancer"] },
  {
    source: "胃癌",
    patterns: [/胃腺癌/g, /胃癌/g],
    terms: [
      "gastric cancer",
      "stomach cancer",
      "gastric carcinoma",
      "stomach carcinoma",
      "gastric adenocarcinoma",
      "stomach adenocarcinoma",
      "gastric neoplasm",
      "stomach neoplasm",
      "gastric tumor",
      "gastric tumour",
      "stomach tumor",
      "stomach tumour",
    ],
    proximityTerms: [
      { phrase: "gastric cancer", distance: 3 },
      { phrase: "cancer stomach", distance: 3 },
      { phrase: "carcinoma stomach", distance: 3 },
      { phrase: "adenocarcinoma stomach", distance: 3 },
      { phrase: "neoplasm stomach", distance: 3 },
    ],
    excludedAmbiguities: ["GC（缩写歧义过高，不单独纳入）"],
  },
  { source: "化疗相关疲乏", patterns: [/化疗相关疲乏/g, /化疗相关疲劳/g], terms: ["chemotherapy-related fatigue", "cancer-related fatigue"] },
  { source: "癌因性疲乏", patterns: [/癌因性疲乏/g, /癌症相关疲乏/g, /肿瘤相关疲乏/g], terms: ["cancer-related fatigue", "fatigue"] },
  { source: "肿瘤", patterns: [/肿瘤/g, /癌症/g], terms: ["neoplasm", "cancer"] },
  { source: "糖尿病", patterns: [/糖尿病/g], terms: ["diabetes mellitus", "diabetes"] },
  { source: "高血压", patterns: [/高血压/g], terms: ["hypertension", "high blood pressure"] },
  { source: "脑卒中", patterns: [/脑卒中/g, /中风/g], terms: ["stroke", "cerebrovascular accident"] },
  { source: "抑郁", patterns: [/抑郁/g], terms: ["depression", "depressive disorder"] },
  { source: "焦虑", patterns: [/焦虑/g], terms: ["anxiety", "anxiety disorder"] },
  { source: "肥胖", patterns: [/肥胖/g], terms: ["obesity", "overweight"] },
  { source: "肠道菌群", patterns: [/肠道菌群/g, /肠道微生物/g], terms: ["gut microbiota", "intestinal microbiome"] },
  { source: "中医药", patterns: [/中医药/g, /中药/g, /中医/g], terms: ["traditional Chinese medicine", "Chinese herbal medicine"] },
  { source: "针灸", patterns: [/针灸/g, /针刺/g], terms: ["acupuncture", "acupuncture therapy"] },
  { source: "运动", patterns: [/运动/g, /锻炼/g], terms: ["exercise", "physical activity"] },
  { source: "老年人", patterns: [/老年人/g, /老年/g], terms: ["aged", "older adults"] },
  { source: "儿童", patterns: [/儿童/g, /小儿/g], terms: ["child", "pediatric"] },
  { source: "孕产妇", patterns: [/孕妇/g, /妊娠/g, /孕产妇/g], terms: ["pregnancy", "pregnant women"] },
  { source: "人工智能", patterns: [/人工智能/g, /机器学习/g], terms: ["artificial intelligence", "machine learning"] },
  { source: "网络药理学", patterns: [/网络药理学/g, /网络药理/g], terms: ["network pharmacology", "systems pharmacology"] },
]);

const MESH_TERMS_BY_SOURCE = Object.freeze({
  围术期: ["Perioperative Care"],
  术后恢复: ["Convalescence", "Postoperative Care"],
  术后: ["Postoperative Care"],
  睡眠质量: ["Sleep", "Sleep Wake Disorders"],
  睡眠: ["Sleep", "Sleep Wake Disorders"],
  恢复: ["Convalescence", "Rehabilitation"],
  疼痛: ["Pain", "Pain Management"],
  炎症: ["Inflammation"],
  乳腺癌: ["Breast Neoplasms"],
  肺癌: [
    "Lung Neoplasms",
    "Carcinoma, Bronchogenic",
    "Carcinoma, Non-Small-Cell Lung",
    "Small Cell Lung Carcinoma",
    "Adenocarcinoma of Lung",
  ],
  结直肠癌: ["Colorectal Neoplasms"],
  胃癌: ["Stomach Neoplasms"],
  肿瘤: ["Neoplasms"],
  糖尿病: ["Diabetes Mellitus"],
  高血压: ["Hypertension"],
  脑卒中: ["Stroke"],
  抑郁: ["Depressive Disorder"],
  焦虑: ["Anxiety Disorders"],
  肥胖: ["Obesity"],
  肠道菌群: ["Gastrointestinal Microbiome"],
  中医药: ["Medicine, Chinese Traditional"],
  针灸: ["Acupuncture Therapy"],
  化疗相关疲乏: ["Fatigue"],
  癌因性疲乏: ["Fatigue"],
  运动: ["Exercise", "Motor Activity"],
  老年人: ["Aged"],
  儿童: ["Child"],
  孕产妇: ["Pregnancy"],
  人工智能: ["Artificial Intelligence", "Machine Learning"],
});

const CONCEPT_ROLE_BY_SOURCE = Object.freeze({
  围术期: "context",
  术后恢复: "phenomenon",
  术后: "context",
  睡眠质量: "phenomenon",
  睡眠: "phenomenon",
  恢复: "phenomenon",
  疼痛: "phenomenon",
  炎症: "phenomenon",
  乳腺癌: "subject",
  肺癌: "subject",
  结直肠癌: "subject",
  胃癌: "subject",
  肿瘤: "subject",
  糖尿病: "subject",
  高血压: "subject",
  脑卒中: "subject",
  抑郁: "phenomenon",
  焦虑: "phenomenon",
  肥胖: "subject",
  肠道菌群: "context",
  中医药: "context",
  针灸: "context",
  化疗相关疲乏: "phenomenon",
  癌因性疲乏: "phenomenon",
  运动: "context",
  老年人: "subject",
  儿童: "subject",
  孕产妇: "subject",
  人工智能: "context",
  网络药理学: "context",
});

const CONCEPT_ROLE_LABELS = Object.freeze({
  context: "背景 / 干预 / 场景",
  subject: "核心研究对象",
  phenomenon: "具体现象 / 结局",
  core_entity: "核心实体",
});

const SEARCH_INTENT_RULES = Object.freeze([
  {
    id: "field_landscape",
    label: "领域现状与进展扫描",
    patterns: [
      /最新研究进展/g,
      /研究现状/g,
      /研究进展/g,
      /最新进展/g,
      /研究前沿/g,
      /研究趋势/g,
      /研究概况/g,
      /领域概况/g,
      /文献综述/g,
      /综述/g,
    ],
    handling: "作为研究目的保留，不把“现状/进展”误当作核心检索实体；后续通过前 100 篇反馈与近五年综述扫描实现。",
  },
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

function meshPhrase(term) {
  return `"${escapePhrase(term)}"[Mesh]`;
}

function titlePhrase(term) {
  const clean = escapePhrase(term);
  return `${clean.includes(" ") ? `"${clean}"` : clean}[Title]`;
}

function wildcardPhrase(term, field = "Title/Abstract") {
  const clean = escapePhrase(term).toLowerCase();
  if (!/^[a-z][a-z-]{3,}\*$/.test(clean)) return null;
  return `${clean}[${field}]`;
}

function proximityPhrase(value) {
  const phrase = escapePhrase(value?.phrase);
  const distance = Math.min(5, Math.max(3, Number(value?.distance) || 3));
  if (!phrase.includes(" ") || phrase.includes("*")) return null;
  return `"${phrase}"[Title/Abstract:~${distance}]`;
}

function semanticGroup(mapping, { includeMesh = true, titleOnly = false } = {}) {
  if (titleOnly) {
    const titleParts = [
      ...mapping.mappedTerms.map(titlePhrase),
      ...(mapping.wildcardTerms ?? []).map((term) => wildcardPhrase(term, "Title")),
    ].filter(Boolean);
    return `(${[...new Set(titleParts)].join(" OR ")})`;
  }
  const parts = [
    ...(includeMesh ? mapping.meshTerms.map(meshPhrase) : []),
    ...mapping.mappedTerms.map(fieldPhrase),
    ...(mapping.wildcardTerms ?? []).map((term) => wildcardPhrase(term)),
    ...(mapping.proximityTerms ?? []).map(proximityPhrase),
  ].filter(Boolean);
  return `(${[...new Set(parts)].join(" OR ")})`;
}

function queryForMappings(mappings, options = {}) {
  return mappings.map((mapping) => semanticGroup(mapping, options)).join(" AND ");
}

function candidateFromMappings({ id, label, strategy, path, mappings, options = {} }) {
  return {
    id,
    label,
    strategy,
    path,
    includedConceptIds: mappings.map((mapping) => mapping.conceptId),
    query: queryForMappings(mappings, options),
  };
}

function detectSearchIntent(question) {
  for (const rule of SEARCH_INTENT_RULES) {
    for (const pattern of rule.patterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(question);
      if (match?.[0]) {
        return {
          id: rule.id,
          label: rule.label,
          sourceTerms: [match[0]],
          handling: rule.handling,
        };
      }
    }
  }
  return null;
}

function removeSearchIntent(text) {
  let cleaned = text;
  for (const rule of SEARCH_INTENT_RULES) {
    for (const pattern of rule.patterns) {
      pattern.lastIndex = 0;
      cleaned = cleaned.replace(pattern, " ");
    }
  }
  return cleaned;
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
    const role = CONCEPT_ROLE_BY_SOURCE[concept.source] ?? "core_entity";
    mappings.push({
      conceptId: `concept_${mappings.length + 1}`,
      sourceTerm: concept.source,
      mappedTerms: [...concept.terms],
      meshTerms: [...(MESH_TERMS_BY_SOURCE[concept.source] ?? [])],
      wildcardTerms: [...(concept.wildcardTerms ?? [])],
      proximityTerms: (concept.proximityTerms ?? []).map((item) => ({ ...item })),
      excludedAmbiguities: [...(concept.excludedAmbiguities ?? [])],
      role,
      roleLabel: CONCEPT_ROLE_LABELS[role],
      confidence: "curated_starter",
    });
    for (const pattern of concept.patterns) {
      pattern.lastIndex = 0;
      unmapped = unmapped.replace(pattern, " ");
    }
  }
  unmapped = removeSearchIntent(unmapped)
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
      strategy: "不翻译未识别概念，保留原问题作为待专家补词的安全基线。",
      path: "原问题保真",
      includedConceptIds: [],
      query: clean,
    },
    {
      id: "question_title_abstract",
      label: "题名摘要限定版",
      strategy: "不猜测英文含义，只把原问题限定在题名与摘要字段，等待研究者补充专业英文词。",
      path: "原问题 · 题名摘要",
      includedConceptIds: [],
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
  const searchIntent = detectSearchIntent(normalizedQuestion);
  if (mappings.length === 0) {
    return {
      mappings,
      conceptGroups: [],
      unknownChinese: unknownChinese.length > 0 ? unknownChinese : [normalizedQuestion],
      candidates: fallbackCandidates(normalizedQuestion),
      topicComplexity: {
        type: "unresolved",
        label: "主题结构待人工确认",
        rationale: "尚未可靠识别可执行的英文核心概念，系统没有猜译。",
      },
      searchIntent,
    };
  }

  const conceptGroups = mappings.map((mapping) => ({
    id: mapping.conceptId,
    sourceTerm: mapping.sourceTerm,
    role: mapping.role,
    roleLabel: mapping.roleLabel,
    meshTerms: [...mapping.meshTerms],
    freeTextTerms: [...mapping.mappedTerms],
    wildcardTerms: [...mapping.wildcardTerms],
    proximityTerms: mapping.proximityTerms.map((item) => ({ ...item })),
    excludedAmbiguities: [...mapping.excludedAmbiguities],
    confidence: mapping.confidence,
  }));

  if (mappings.length === 1) {
    const mapping = mappings[0];
    const candidates = [
      candidateFromMappings({
        id: "single_comprehensive",
        label: "推荐检索式",
        strategy: "完整覆盖主题词、常用命名、主要亚型、可靠缩写与适用的邻近表达，作为本轮优先确认式。",
        path: mapping.conceptId,
        mappings,
      }),
      candidateFromMappings({
        id: "single_new_literature",
        label: "补充新文献",
        strategy: "保留完整自由词与邻近表达，但不依赖 MeSH 标引，用于补充尚未完成主题词标引的新文献。",
        path: mapping.conceptId,
        mappings,
        options: { includeMesh: false },
      }),
      candidateFromMappings({
        id: "single_title_focus",
        label: "题名高精度抽查",
        strategy: "把完整命名变体限定在题名字段，用于快速抽查核心文献与潜在噪声；不替代推荐检索式。",
        path: mapping.conceptId,
        mappings,
        options: { includeMesh: false, titleOnly: true },
      }),
    ];
    return {
      mappings,
      conceptGroups,
      unknownChinese,
      candidates,
      topicComplexity: {
        type: "single_concept",
        label: "单一概念主题",
        rationale: `核心实体是“${mapping.sourceTerm}”；按单一概念规则构建一个完整语义群，不强拆 A/B/C。`,
      },
      searchIntent,
    };
  }

  let candidates;
  if (mappings.length === 2) {
    candidates = [
      candidateFromMappings({
        id: "matrix_ab",
        label: "推荐检索式 · 全部概念",
        strategy: "两个概念组各自完整扩展，组内 OR、组间 AND；作为优先确认式。",
        path: "A + B",
        mappings,
      }),
      candidateFromMappings({
        id: "matrix_a",
        label: `仅检索“${mappings[0].sourceTerm}”`,
        strategy: "仅用于观察 A 词群覆盖与潜在噪声，不能替代 A+B 核心式。",
        path: "A",
        mappings: [mappings[0]],
      }),
      candidateFromMappings({
        id: "matrix_b",
        label: `仅检索“${mappings[1].sourceTerm}”`,
        strategy: "仅用于观察 B 词群覆盖与潜在噪声，不能替代 A+B 核心式。",
        path: "B",
        mappings: [mappings[1]],
      }),
    ];
  } else if (mappings.length === 3) {
    candidates = [
      candidateFromMappings({
        id: "matrix_abc",
        label: "推荐检索式 · 全部概念",
        strategy: "三个概念组完整相交，优先检查精准性与漏检风险。",
        path: "A + B + C",
        mappings,
      }),
      candidateFromMappings({
        id: "matrix_ab",
        label: `放宽“${mappings[2].sourceTerm}”`,
        strategy: "完整保留 A、B 词群，检查 C 是否造成漏检。",
        path: "A + B",
        mappings: [mappings[0], mappings[1]],
      }),
      candidateFromMappings({
        id: "matrix_bc",
        label: `放宽“${mappings[0].sourceTerm}”`,
        strategy: "完整保留 B、C 词群，检查 A 是否造成漏检。",
        path: "B + C",
        mappings: [mappings[1], mappings[2]],
      }),
      candidateFromMappings({
        id: "matrix_ac",
        label: `放宽“${mappings[1].sourceTerm}”`,
        strategy: "完整保留 A、C 词群，检查 B 是否造成漏检。",
        path: "A + C",
        mappings: [mappings[0], mappings[2]],
      }),
    ];
  } else {
    candidates = [candidateFromMappings({
      id: "matrix_all",
      label: "推荐检索式 · 全部概念",
      strategy: "保留全部已识别核心实体；每组内部完整扩展，再用 AND 连接概念组。",
      path: mappings.map((mapping) => mapping.conceptId).join(" + "),
      mappings,
    })];
    const removable = mappings
      .filter((mapping) => mapping.role !== "subject")
      .slice(-3);
    for (const mapping of removable) {
      const included = mappings.filter((candidate) => candidate.conceptId !== mapping.conceptId);
      candidates.push(candidateFromMappings({
        id: `matrix_without_${mapping.conceptId}`,
        label: `放宽“${mapping.sourceTerm}”`,
        strategy: `用于核心组合命中过少或需要补充背景时；完整保留其余概念语义群，暂时放宽“${mapping.sourceTerm}”，不会删除原路径。`,
        path: included.map((candidate) => candidate.conceptId).join(" + "),
        mappings: included,
      }));
    }
  }
  return {
    mappings,
    conceptGroups,
    unknownChinese,
    candidates: candidates.slice(0, 4),
    topicComplexity: {
      type: "multi_concept",
      label: "复合概念主题",
      rationale: `已识别 ${mappings.length} 个核心概念组；组内 OR 扩展，组间 AND 连接，并保留矩阵式放宽路径。`,
    },
    searchIntent,
  };
}

function normalizeReviewWindowYears(value) {
  const parsed = Number(value ?? DEFAULT_REVIEW_WINDOW_YEARS);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_REVIEW_WINDOW_YEARS;
  return Math.min(parsed, MAX_REVIEW_WINDOW_YEARS);
}

function normalizeReviewSampleLimit(value) {
  const parsed = Number(value ?? DEFAULT_REVIEW_SAMPLE_LIMIT);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_REVIEW_SAMPLE_LIMIT;
  return Math.min(parsed, DEFAULT_REVIEW_SAMPLE_LIMIT);
}

function pubMedDate(date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "/");
}

function reviewWindow({ now = () => new Date(), years = DEFAULT_REVIEW_WINDOW_YEARS } = {}) {
  const normalizedYears = normalizeReviewWindowYears(years);
  const current = now();
  const toDate = new Date(current instanceof Date ? current.getTime() : current);
  const fromDate = new Date(toDate.getTime());
  fromDate.setUTCFullYear(fromDate.getUTCFullYear() - normalizedYears);
  const from = pubMedDate(fromDate);
  const to = pubMedDate(toDate);
  const positivePublicationTypes = [
    "systematic[sb]",
    "meta-analysis[Publication Type]",
    "review[Publication Type]",
    '"scoping review"[Title/Abstract]',
    '"umbrella review"[Title/Abstract]',
  ].join(" OR ");
  const dateClause = `("${from}"[Date - Publication] : "${to}"[Date - Publication])`;
  return {
    years: normalizedYears,
    basis: "rolling_publication_date",
    from,
    to,
    publicationTypeClause: `(${positivePublicationTypes}) NOT guideline[Publication Type] NOT practice guideline[Publication Type]`,
    dateClause,
    boundary: `近 ${normalizedYears} 年按 PubMed 发表日期滚动计算；综述类型使用 PubMed Publication Type、systematic 子集及题名摘要补充词识别。`,
  };
}

export function generatePubMedQueryPlan({ question, now = () => new Date() } = {}) {
  const generated = generatePubMedQueryCandidates({ question });
  const generatedAt = isoNow(now);
  const plannedWindow = reviewWindow({ now, years: DEFAULT_REVIEW_WINDOW_YEARS });
  const plan = {
    schemaVersion: QUERY_PLAN_SCHEMA,
    question: question.trim(),
    generatedAt,
    planner: {
      mode: "professional_pubmed_agent_baseline_v3",
      claim: "检索 Agent 已完成专业词群扩展与 PubMed 语法编译，请重点核对词项覆盖和检索边界。",
      attributionBoundary: "这是可审查的检索初稿，不替代医学信息专家终审。",
      principles: [
        "先判断单一概念或复合概念，不机械套用 A/B/C。",
        "组内覆盖 MeSH、同义词、近义词、常见亚型、拼写变体及适用邻近表达。",
        "组内 OR，组间 AND；排除词不自动加入，留给研究者确认。",
        "确认后用 PubMed 前 100 条题名与可用摘要反馈校准。",
      ],
    },
    methodContract: {
      targetOutput: "确认可执行的 PubMed 专业检索策略，并在确认后形成近五年综述地形汇报。",
      requiredActions: ["主题复杂度判断", "完整命名变体扩展", "主题词与自由词扩展", "适用邻近检索", "矩阵式召回路径", "人工确认", "真实综述扫描", "阶段汇报"],
      failurePath: "命中不足、噪声过高或关键概念未映射时，保留旧版本并返回问题或词群修订。",
    },
    mappings: generated.mappings,
    conceptGroups: generated.conceptGroups,
    unknownChinese: generated.unknownChinese,
    candidates: generated.candidates,
    topicComplexity: generated.topicComplexity,
    searchIntent: generated.searchIntent,
    reviewWindow: plannedWindow,
    humanDecision: "not_recorded",
    accessBoundary: "本步只生成检索策略，不访问 PubMed，也不创建项目。研究者确认后才执行真实检索。",
  };
  return { ...plan, planHash: sha256(plan) };
}

export function inferResearchSubjectConcepts({ question, queryPlan = null } = {}) {
  const planMappings = Array.isArray(queryPlan?.mappings)
    ? queryPlan.mappings
    : hasText(question)
      ? generatePubMedQueryPlan({ question }).mappings
      : [];
  const subjectMappings = planMappings.filter((mapping) => mapping?.role === "subject");
  const concepts = subjectMappings.map((mapping) => ({
    conceptId: mapping.conceptId,
    sourceTerm: mapping.sourceTerm,
    role: mapping.role,
    mappedTerms: Array.isArray(mapping.mappedTerms) ? [...mapping.mappedTerms] : [],
    meshTerms: Array.isArray(mapping.meshTerms) ? [...mapping.meshTerms] : [],
  }));
  return {
    status: concepts.length > 0 ? "derived" : "unresolved",
    concepts,
    basis: Array.isArray(queryPlan?.mappings) ? "stored_query_plan" : "project_question",
    reason: concepts.length > 0
      ? "已从旧项目的研究问题或已存检索计划明确识别研究对象词群。"
      : "旧项目没有冻结研究对象词群，且无法从研究问题或已存检索计划明确识别；请重新确认研究对象后再生成最终文献库。",
    boundary: "兼容推导只使用可审计词典中角色为 subject 的概念；不会把现象、干预或上下文词冒充研究对象。",
  };
}

function normalizeProvidedCandidates(candidateQueries) {
  if (!Array.isArray(candidateQueries) || candidateQueries.length < 1) return null;
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
      path: hasText(candidate?.path) ? candidate.path.trim().slice(0, 160) : null,
      includedConceptIds: Array.isArray(candidate?.includedConceptIds)
        ? candidate.includedConceptIds.map(String).slice(0, 8)
        : [],
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
    journal: record?.journal ?? null,
    year: record?.year ?? null,
    accessLevel: record?.accessLevel ?? (abstract ? "abstract_only" : "title_only"),
    locator: record?.locator ?? null,
    noiseStatus: "unreviewed",
  };
}

const REVIEW_TYPE_RULES = Object.freeze([
  { id: "umbrella_review", label: "伞状综述", pattern: /\bumbrella review\b/i },
  { id: "scoping_review", label: "范围综述", pattern: /\bscoping review\b/i },
  { id: "meta_analysis", label: "Meta 分析", pattern: /\bmeta[ -]?analys(?:is|es)\b/i },
  { id: "systematic_review", label: "系统综述", pattern: /\bsystematic review\b/i },
  { id: "narrative_review", label: "叙述性 / 其他综述", pattern: /\b(?:narrative|integrative|review)\b/i },
]);

const TITLE_STOPWORDS = new Set([
  "about", "among", "analysis", "associated", "association", "based", "between", "clinical",
  "current", "effect", "effects", "evidence", "from", "future", "impact", "meta", "narrative",
  "patients", "review", "reviews", "scoping", "study", "systematic", "through", "toward", "using",
  "with", "within", "adult", "adults", "health", "research", "role", "recent", "update", "updated",
]);

function reviewTypeFor(record) {
  const searchable = `${record?.title ?? ""} ${record?.abstract ?? ""}`;
  const matched = REVIEW_TYPE_RULES.find((rule) => rule.pattern.test(searchable));
  return matched
    ? { id: matched.id, label: matched.label }
    : { id: "unclassified_review", label: "综述类型未从题名摘要识别" };
}

function yearFor(record) {
  return String(record?.year ?? "").match(/\b(?:19|20)\d{2}\b/)?.[0] ?? "年份未报告";
}

function frequentTitleTerms(records, limit = 8) {
  const frequencies = new Map();
  for (const record of records) {
    const terms = new Set(
      (String(record?.title ?? "").toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? [])
        .map((term) => term.replace(/^-+|-+$/g, ""))
        .filter((term) => term.length >= 4 && !TITLE_STOPWORDS.has(term)),
    );
    for (const term of terms) {
      const current = frequencies.get(term) ?? { term, count: 0, sourceIds: [] };
      current.count += 1;
      if (current.sourceIds.length < 5 && record?.sourceId) current.sourceIds.push(record.sourceId);
      frequencies.set(term, current);
    }
  }
  return [...frequencies.values()]
    .sort((left, right) => right.count - left.count || left.term.localeCompare(right.term))
    .slice(0, limit);
}

function distribution(records, valueFor) {
  const counts = new Map();
  for (const record of records) {
    const value = valueFor(record);
    const key = typeof value === "string" ? value : value.id;
    const label = typeof value === "string" ? value : value.label;
    const current = counts.get(key) ?? { id: key, label, count: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  return [...counts.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function rollingReviewBuckets(window, sampleLimit) {
  const parse = (value) => {
    const match = String(value ?? "").match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/);
    return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  };
  const fromDate = parse(window?.from);
  const toDate = parse(window?.to);
  const bucketCount = Number(window?.years);
  if (!fromDate || !toDate || !Number.isInteger(bucketCount) || bucketCount < 1 || fromDate > toDate) return [];
  const starts = Array.from({ length: bucketCount }, (_, index) => {
    const value = new Date(fromDate.getTime());
    value.setUTCFullYear(value.getUTCFullYear() + index);
    return value;
  });
  const windows = starts.map((start, index) => {
    const nextStart = starts[index + 1];
    const end = nextStart
      ? new Date(nextStart.getTime() - 24 * 60 * 60 * 1000)
      : toDate;
    return { start, end };
  }).reverse();
  const baseQuota = Math.floor(sampleLimit / windows.length);
  let remainder = sampleLimit % windows.length;
  return windows.map(({ start, end }, index) => {
    const quota = baseQuota + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    return {
      id: `rolling_window_${index + 1}`,
      label: `${pubMedDate(start)}—${pubMedDate(end)}`,
      from: pubMedDate(start),
      to: pubMedDate(end),
      quota,
    };
  }).filter((bucket) => bucket.quota > 0);
}

function appendUniqueIds(target, ids, limit) {
  for (const id of Array.isArray(ids) ? ids : []) {
    const clean = String(id).trim();
    if (!clean || target.includes(clean)) continue;
    target.push(clean);
    if (target.length >= limit) break;
  }
}

async function buildRecentReviewLandscape({
  gateway,
  candidate,
  question,
  subjectConcepts,
  signal,
  now,
  years,
  sampleLimit,
}) {
  const window = reviewWindow({ now, years });
  const query = `(${candidate.query}) AND ${window.publicationTypeClause} AND ${window.dateClause}`;
  try {
    const normalizedSampleLimit = normalizeReviewSampleLimit(sampleLimit);
    const search = await gateway.searchPubMed({ query, limit: normalizedSampleLimit }, signal);
    const overallIds = Array.isArray(search?.resultIds) ? search.resultIds.map(String).filter(Boolean) : [];
    if (overallIds.length === 0) {
      return {
        status: "zero_results",
        selectedCandidateId: candidate.id,
        baseQuery: candidate.query,
        query,
        executedAt: search?.executedAt ?? null,
        total: Number(search?.total ?? 0),
        sampledCount: 0,
        reviewWindow: window,
        yearDistribution: [],
        reviewTypeDistribution: [],
        frequentTitleTerms: [],
        synthesis: null,
        sources: [],
        stageBrief: {
          currentResearchPeriod: "检索策略确认 · 近五年综述扫描",
          newFindings: ["当前确认式在近五年综述过滤条件下返回 0 条。"],
          evidenceBoundary: "0 条只说明当前检索表达与过滤组合没有命中，不能证明该领域没有综述。",
          nextDecision: "返回专业检索策略，放宽一个概念组、补充同义词或核对主题词后重新扫描。",
        },
      };
    }
    const ids = [];
    const samplingBuckets = [];
    for (const bucket of rollingReviewBuckets(window, normalizedSampleLimit)) {
      const dateClause = `("${bucket.from}"[Date - Publication] : "${bucket.to}"[Date - Publication])`;
      const methodFocusedQuery = `(${candidate.query}) AND (${METHOD_FOCUSED_REVIEW_CLAUSE}) AND ${dateClause}`;
      try {
        const prioritySearch = await gateway.searchPubMed({
          query: methodFocusedQuery,
          limit: bucket.quota,
        }, signal);
        const before = ids.length;
        appendUniqueIds(ids, prioritySearch?.resultIds, normalizedSampleLimit);
        samplingBuckets.push({
          ...bucket,
          status: "ready",
          methodFocusedTotal: Number(prioritySearch?.total ?? 0),
          sampledCount: ids.length - before,
        });
      } catch (bucketError) {
        if (bucketError?.name === "AbortError") throw bucketError;
        samplingBuckets.push({
          ...bucket,
          status: "failed",
          methodFocusedTotal: null,
          sampledCount: 0,
          errorCode: bucketError?.code ?? "PUBMED_YEAR_BUCKET_FAILED",
        });
      }
    }
    appendUniqueIds(ids, overallIds, normalizedSampleLimit);
    const fetched = await gateway.fetchPubMed({ resultIds: ids }, signal);
    const records = (Array.isArray(fetched?.records) ? fetched.records : []).slice(0, normalizedSampleLimit);
    const samplingStrategy = {
      id: "method_focused_rolling_windows",
      label: "连续 12 个月分层 · 方法明确综述优先",
      description: "把滚动时间窗切分为连续且不重叠的 12 个月窗口，按窗口分配样本名额；优先读取系统综述、Meta 分析、范围综述与伞状综述，并排除指南；不足部分才由总体当前排序补齐。",
      buckets: samplingBuckets,
      boundary: "这是检索时冻结 PMID 的分层目的样本，不是随机抽样，也不等同于 AMSTAR 2 或全文质量筛选。PubMed Best Match/相关性排序算法可能变化，未来重跑不承诺得到相同顺序或相同 PMID。",
    };
    const researchReport = buildResearchReportContract({
      projectId: null,
      question,
      records,
      subjectConcepts,
      reportRevision: 1,
      generatedAt: fetched?.fetchedAt ?? search?.executedAt ?? null,
      reviewWindow: window,
      bindingAuthority: "preproject_preview",
      samplingMetadata: {
        schemaVersion: "pubmed-preview-stratified-sample/v1",
        database: "PubMed",
        query,
        sampleLimit: normalizedSampleLimit,
        strategy: samplingStrategy,
        boundary: "命中总数与分层样本分开保存；样本主题分布不能替代全领域发文计量。",
      },
    });
    const synthesis = researchReport.derivedAnalysis.reviewSynthesis;
    const includedSourceIds = new Set(researchReport.derivedAnalysis.analyzedSourceIds);
    const relevantRecords = records.filter((record) => includedSourceIds.has(
      record?.sourceId ?? (record?.pmid ? `pubmed:${record.pmid}` : null),
    ));
    const sourceAnalysisById = new Map(
      (synthesis?.sourceAnalyses ?? []).map((analysis) => [analysis.sourceId, analysis]),
    );
    const relevanceById = new Map(
      researchReport.relevanceGate.rows.map((row) => [row.sourceId, row]),
    );
    const sources = records.map((record) => {
      const type = reviewTypeFor(record);
      const abstract = hasText(record?.abstract) ? record.abstract.trim() : null;
      const sourceId = record?.sourceId ?? (record?.pmid ? `pubmed:${record.pmid}` : null);
      return {
        sourceId,
        pmid: record?.pmid ?? null,
        title: record?.title ?? "题名未返回",
        journal: record?.journal ?? null,
        year: record?.year ?? null,
        reviewType: type,
        abstractSnippet: abstract ? abstract.slice(0, 500) : null,
        accessLevel: record?.accessLevel ?? (abstract ? "abstract_only" : "title_only"),
        locator: record?.locator ?? null,
        relevance: relevanceById.get(sourceId) ?? null,
        abstractAnalysis: sourceAnalysisById.get(sourceId) ?? null,
      };
    });
    const yearsDistribution = distribution(relevantRecords, yearFor)
      .sort((left, right) => right.label.localeCompare(left.label));
    const typeDistribution = distribution(relevantRecords, reviewTypeFor);
    const titleTerms = frequentTitleTerms(relevantRecords);
    const abstractAvailableCount = sources.filter(
      (source) => source.relevance?.status === "relevant" && source.accessLevel === "abstract_only",
    ).length;
    const typeSummary = typeDistribution.slice(0, 3).map((item) => `${item.label} ${item.count} 篇`).join("、");
    const termSummary = titleTerms.slice(0, 5).map((item) => `${item.term}（${item.count}）`).join("、");
    if (researchReport.relevanceGate.status === "blocked") {
      return {
        status: "relevance_blocked",
        selectedCandidateId: candidate.id,
        baseQuery: candidate.query,
        query,
        executedAt: search?.executedAt ?? null,
        fetchedAt: fetched?.fetchedAt ?? null,
        total: Number(search?.total ?? ids.length),
        sampledCount: sources.length,
        analyzedCount: 0,
        abstractAvailableCount: 0,
        reviewWindow: window,
        samplingStrategy,
        yearDistribution: [],
        reviewTypeDistribution: [],
        frequentTitleTerms: [],
        synthesis: null,
        researchReport,
        relevanceGate: researchReport.relevanceGate,
        sources,
        stageBrief: {
          currentResearchPeriod: "检索策略确认 · 研究对象相关性核查",
          newFindings: [
            `本轮读取 ${sources.length} 篇题名与可用摘要，但 0 篇命中已冻结研究对象词群。`,
            "系统已停止主题分析、方向生成和后续正式文献库冻结。",
          ],
          evidenceBoundary: researchReport.relevanceGate.boundary,
          nextDecision: "修订研究对象词群或检索式并重新执行真实PubMed预检；不能把当前结果解释为领域没有研究。",
        },
      };
    }
    return {
      status: "ready",
      selectedCandidateId: candidate.id,
      baseQuery: candidate.query,
      query,
      executedAt: search?.executedAt ?? null,
      fetchedAt: fetched?.fetchedAt ?? null,
      total: Number(search?.total ?? ids.length),
      sampledCount: sources.length,
      analyzedCount: relevantRecords.length,
      abstractAvailableCount,
      reviewWindow: window,
      samplingStrategy,
      yearDistribution: yearsDistribution,
      reviewTypeDistribution: typeDistribution,
      frequentTitleTerms: titleTerms,
      synthesis,
      researchReport,
      relevanceGate: researchReport.relevanceGate,
      sources,
      stageBrief: {
        currentResearchPeriod: "检索策略确认 · 近五年综述扫描",
        newFindings: [
          `PubMed 当前命中 ${Number(search?.total ?? ids.length)} 篇近 ${window.years} 年综述，本轮读取 ${sources.length} 篇题录与可用摘要，其中 ${relevantRecords.length} 篇进入派生分析。`,
          `本轮采用“按年份分层、方法明确综述优先”的样本策略；${samplingBuckets.filter((bucket) => bucket.sampledCount > 0).length}/${samplingBuckets.length} 个年度分层取得样本。`,
          synthesis.summaries.coverage,
          synthesis.summaries.change,
          synthesis.summaries.methods,
          synthesis.summaries.gaps,
        ],
        samplingContext: {
          reviewTypeSummary: typeSummary || null,
          frequentTitleTermSummary: termSummary || null,
        },
        evidenceBoundary: `本轮只分析 ${relevantRecords.length} 篇研究对象相关样本，其中 ${abstractAvailableCount} 篇有摘要；其余来源保留在逐条账本但不进入统计。${synthesis.boundary}`,
        nextDecision: synthesis.breakthroughCandidates.length
          ? "先核对摘要分析与来源，再从候选突破口中选择一个更窄问题进入下一轮选题调查；本步不会自动替你确定选题。"
          : "当前摘要没有形成可追溯的候选突破口；先核对检索覆盖或扩大综述样本，再决定是否进入下一轮选题调查。",
      },
    };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return {
      status: "failed",
      selectedCandidateId: candidate.id,
      baseQuery: candidate.query,
      query,
      executedAt: null,
      total: null,
      sampledCount: 0,
      reviewWindow: window,
      yearDistribution: [],
      reviewTypeDistribution: [],
      frequentTitleTerms: [],
      synthesis: null,
      sources: [],
      error: { code: error?.code ?? "PUBMED_REVIEW_SCAN_FAILED", message: error?.message ?? String(error) },
      stageBrief: {
        currentResearchPeriod: "检索策略确认 · 近五年综述扫描",
        newFindings: ["近五年综述扫描未完成，本轮没有形成可用的综述地形判断。"],
        evidenceBoundary: "失败运行没有命中量、来源样本或趋势含义。",
        nextDecision: "保留当前策略，检查网络或 PubMed 状态后重试；不要把工具失败解释成领域没有综述。",
      },
    };
  }
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
  reviewScanCandidateId = null,
  reviewWindowYears = DEFAULT_REVIEW_WINDOW_YEARS,
  reviewSampleLimit = DEFAULT_REVIEW_SAMPLE_LIMIT,
  signal,
  now = () => new Date(),
} = {}) {
  if (!gateway || typeof gateway.searchPubMed !== "function" || typeof gateway.fetchPubMed !== "function") {
    const error = new Error("当前运行没有配置可用的 PubMed 试检工具。");
    error.code = "PUBMED_GATEWAY_UNAVAILABLE";
    throw error;
  }
  const generatedPlan = generatePubMedQueryPlan({ question, now });
  const candidates = normalizeProvidedCandidates(candidateQueries) ?? generatedPlan.candidates;
  const reviewCandidate = reviewScanCandidateId
    ? candidates.find((candidate) => candidate.id === reviewScanCandidateId)
    : null;
  if (reviewScanCandidateId && !reviewCandidate) {
    const error = new Error("近五年综述扫描必须绑定当前已确认的检索候选。");
    error.code = "INVALID_REVIEW_SCAN_CANDIDATE";
    throw error;
  }
  const limit = normalizeSampleLimit(sampleLimit);
  const calibrated = [];
  for (const candidate of candidates) {
    calibrated.push(await calibrateCandidate(gateway, candidate, limit, signal));
  }
  const reviewLandscape = reviewCandidate
    ? await buildRecentReviewLandscape({
        gateway,
        candidate: reviewCandidate,
        question: generatedPlan.question,
        subjectConcepts: (() => {
          const subjects = generatedPlan.mappings.filter((mapping) => mapping.role === "subject");
          return subjects.length > 0 ? subjects : generatedPlan.mappings;
        })(),
        signal,
        now,
        years: reviewWindowYears,
        sampleLimit: reviewSampleLimit,
      })
    : null;
  const { planHash: _draftPlanHash, ...draftPlan } = generatedPlan;
  const plan = {
    ...draftPlan,
    recallCheck: {
      kind: "query_concept_coverage_only",
      mappedConceptCount: generatedPlan.mappings.length,
      unknownConceptCount: generatedPlan.unknownChinese.length,
      comparedCandidateCount: calibrated.length,
      boundary: "这里只检查已映射概念、真实命中量和当前排序样本，不等于数据库召回率、系统综述敏感度或检索策略专家终审。",
    },
    sampleLimit: limit,
    candidates: calibrated,
    reviewLandscape,
    humanDecision: "not_recorded",
    accessBoundary: reviewLandscape
      ? "已访问 PubMed 题录与可用摘要，并针对人工确认式执行近五年综述扫描；未访问全文、补充材料或其他数据库。检索预演不会建立项目，也不会批准人工门禁。"
      : "仅访问 PubMed 题录与可用摘要；未访问全文、补充材料或其他数据库。检索预演不会建立项目，也不会批准任何人工门禁。",
  };
  return { ...plan, planHash: sha256(plan) };
}

export const RESEARCH_QUERY_PLANNER_INFO = Object.freeze({
  schemaVersion: QUERY_PLAN_SCHEMA,
  defaultSampleLimit: DEFAULT_SAMPLE_LIMIT,
  maxSampleLimit: MAX_SAMPLE_LIMIT,
  defaultReviewWindowYears: DEFAULT_REVIEW_WINDOW_YEARS,
  defaultReviewSampleLimit: DEFAULT_REVIEW_SAMPLE_LIMIT,
  candidateMinimum: 2,
});
