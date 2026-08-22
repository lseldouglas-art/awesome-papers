import { contentText } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

import { sha256 } from "./event-engine-v1.js";
import { generatePubMedQueryPlan } from "./research-query-planner-v1.js";

const PROMPT_TEMPLATE_ID = "professional-pubmed-query-agent/v4";
const MAX_CONCEPTS = 3;
const ROLE_LABELS = Object.freeze({
  context: "背景 / 干预 / 场景",
  subject: "核心研究对象",
  phenomenon: "具体现象 / 结局",
});

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function cleanTerm(value, maxLength = 120) {
  return String(value ?? "")
    .replaceAll('"', "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function uniqueTerms(values, limit = 24) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const term = cleanTerm(value);
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    result.push(term);
    if (result.length >= limit) break;
  }
  return result;
}

function parseModelJson(value) {
  const text = String(value ?? "").trim();
  const unfenced = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("模型没有返回可解析的 JSON 对象。");
    return JSON.parse(unfenced.slice(start, end + 1));
  }
}

function wildcardTerm(value) {
  const term = cleanTerm(value).toLowerCase();
  if (!/^[a-z][a-z-]{3,}\*$/.test(term)) return null;
  const prefix = term.slice(0, -1).replaceAll("-", "");
  return prefix.length >= 4 ? `${term}[Title/Abstract]` : null;
}

function freeTextTerm(value) {
  const term = cleanTerm(value);
  if (!term) return null;
  return `${term.includes(" ") || term.includes("-") ? `"${term}"` : term}[Title/Abstract]`;
}

function meshTerm(value) {
  const term = cleanTerm(value);
  return term ? `"${term}"[Mesh]` : null;
}

function proximityTerm(value) {
  const phrase = cleanTerm(value?.phrase);
  const distance = Math.min(5, Math.max(3, Number(value?.distance) || 3));
  if (!phrase.includes(" ") || phrase.includes("*")) return null;
  return `"${phrase}"[Title/Abstract:~${distance}]`;
}

function wildcardTitleTerm(value) {
  const term = cleanTerm(value).toLowerCase();
  if (!/^[a-z][a-z-]{3,}\*$/.test(term)) return null;
  const prefix = term.slice(0, -1).replaceAll("-", "");
  return prefix.length >= 4 ? `${term}[Title]` : null;
}

function titleTerm(value) {
  const term = cleanTerm(value);
  if (!term) return null;
  return `${term.includes(" ") || term.includes("-") ? `"${term}"` : term}[Title]`;
}

function compileConceptGroup(concept, { includeMesh = true, titleOnly = false } = {}) {
  if (titleOnly) {
    const titleParts = [
      ...concept.freeTextTerms.map(titleTerm),
      ...concept.wildcardTerms.map(wildcardTitleTerm),
    ].filter(Boolean);
    return `(${[...new Set(titleParts)].join(" OR ")})`;
  }
  const parts = [
    ...(includeMesh ? concept.meshTerms.map(meshTerm) : []),
    ...concept.freeTextTerms.map(freeTextTerm),
    ...concept.wildcardTerms.map(wildcardTerm),
    ...concept.proximityTerms.map(proximityTerm),
  ].filter(Boolean);
  return `(${[...new Set(parts)].join(" OR ")})`;
}

function normalizeConcept(raw, index, conceptCount) {
  const role = ["context", "subject", "phenomenon"].includes(raw?.role)
    ? raw.role
    : conceptCount === 1
      ? "subject"
      : ["context", "subject", "phenomenon"][index] ?? "phenomenon";
  const sourceTerm = cleanTerm(raw?.sourceTerm ?? raw?.preferredLabel ?? `概念 ${index + 1}`, 80);
  const excludedAmbiguities = uniqueTerms(raw?.excludedAmbiguities, 8);
  const excludedKeys = new Set(excludedAmbiguities.map((term) => term.toLowerCase()));
  const preferredTerms = uniqueTerms(raw?.preferredTerms ?? [raw?.preferredLabel]);
  const freeTextTerms = uniqueTerms([
    ...preferredTerms,
    ...(raw?.synonyms ?? []),
    ...(raw?.abbreviations ?? []),
    ...(raw?.narrowerTerms ?? []),
    ...(raw?.spellingVariants ?? []),
  ]).filter((term) => !excludedKeys.has(term.toLowerCase()));
  const meshTerms = uniqueTerms(raw?.meshTerms, 10);
  const wildcardTerms = uniqueTerms(raw?.wildcardTerms, 10)
    .filter((term) => wildcardTerm(term));
  const proximityTerms = (Array.isArray(raw?.proximityTerms) ? raw.proximityTerms : [])
    .map((item) => ({ phrase: cleanTerm(item?.phrase), distance: Number(item?.distance) || 3 }))
    .filter((item) => proximityTerm(item))
    .slice(0, 8);
  if (freeTextTerms.length + meshTerms.length + wildcardTerms.length + proximityTerms.length === 0) {
    throw new Error(`概念 ${index + 1} 没有可执行的英文词项。`);
  }
  return {
    conceptId: `concept_${String.fromCharCode(65 + index)}`,
    sourceTerm,
    role,
    roleLabel: ROLE_LABELS[role],
    meshTerms,
    freeTextTerms,
    wildcardTerms,
    proximityTerms,
    excludedAmbiguities,
    confidence: "model_generated_pending_expert_review",
  };
}

function candidateForPath(concepts, path, id, label, strategy, options = {}) {
  const selected = path.map((index) => concepts[index]).filter(Boolean);
  return {
    id,
    label,
    strategy,
    path: selected.map((concept) => concept.conceptId.replace("concept_", "")).join(" + "),
    includedConceptIds: selected.map((concept) => concept.conceptId),
    query: selected.map((concept) => compileConceptGroup(concept, options)).join(" AND "),
  };
}

export function compilePubMedConceptMatrix(rawConcepts) {
  if (!Array.isArray(rawConcepts) || rawConcepts.length < 1) {
    throw new Error("完整提示词至少需要返回 1 个可执行概念组。");
  }
  const boundedConcepts = rawConcepts.slice(0, MAX_CONCEPTS);
  const concepts = boundedConcepts.map((concept, index) => normalizeConcept(concept, index, boundedConcepts.length));
  const paths = concepts.length === 1
    ? [
        [[0], "single_comprehensive", "推荐检索式", "完整覆盖主题词、自由词、有效截词与邻近表达，作为本轮优先确认式。", {}],
        [[0], "single_new_literature", "补充新文献", "不依赖 MeSH 标引，保留完整自由词、有效截词与邻近表达。", { includeMesh: false }],
        [[0], "single_title_focus", "题名高精度抽查", "将完整命名变体限定在题名字段，用于抽查核心记录与噪声。", { includeMesh: false, titleOnly: true }],
      ]
    : concepts.length >= 3
    ? [
        [[0, 1, 2], "matrix_abc", "A + B + C · 精准核心式", "三个概念组完整相交，优先检查精准性。"],
        [[0, 1], "matrix_ab", "A + B · 放宽现象", "完整保留 A、B 词群，观察 C 是否造成漏检。"],
        [[1, 2], "matrix_bc", "B + C · 放宽场景", "完整保留 B、C 词群，观察 A 是否造成漏检。"],
        [[0, 2], "matrix_ac", "A + C · 放宽对象", "完整保留 A、C 词群，观察 B 是否造成漏检。"],
      ]
    : [
        [[0, 1], "matrix_ab", "A + B · 核心式", "两个概念组完整相交。"],
        [[0], "matrix_a", "A · 背景扫描", "仅用于观察 A 词群边界，不能替代核心式。"],
        [[1], "matrix_b", "B · 主题扫描", "仅用于观察 B 词群边界，不能替代核心式。"],
      ];
  return {
    mappings: concepts.map((concept) => ({
      conceptId: concept.conceptId,
      sourceTerm: concept.sourceTerm,
      mappedTerms: concept.freeTextTerms,
      meshTerms: concept.meshTerms,
      wildcardTerms: concept.wildcardTerms,
      proximityTerms: concept.proximityTerms,
      excludedAmbiguities: concept.excludedAmbiguities,
      role: concept.role,
      roleLabel: concept.roleLabel,
      confidence: concept.confidence,
    })),
    conceptGroups: concepts.map((concept) => ({
      id: concept.conceptId,
      sourceTerm: concept.sourceTerm,
      role: concept.role,
      roleLabel: concept.roleLabel,
      meshTerms: concept.meshTerms,
      freeTextTerms: concept.freeTextTerms,
      wildcardTerms: concept.wildcardTerms,
      proximityTerms: concept.proximityTerms,
      excludedAmbiguities: concept.excludedAmbiguities,
      confidence: concept.confidence,
    })),
    candidates: paths.map(([path, id, label, strategy, options]) =>
      candidateForPath(concepts, path, id, label, strategy, options)),
    topicComplexity: concepts.length === 1
      ? {
          type: "single_concept",
          label: "单一概念主题",
          rationale: `模型识别到一个核心实体“${concepts[0].sourceTerm}”；按完整语义群生成，不强拆 A/B/C。`,
        }
      : {
          type: "multi_concept",
          label: "复合概念主题",
          rationale: `模型识别到 ${concepts.length} 个核心概念组；组内 OR 扩展，组间 AND 连接。`,
        },
  };
}

export function buildInitialQueryStrategyPrompt(question) {
  return `你是一名负责 PubMed 系统综述检索策略的医学信息专家。请先判断研究问题是单一概念主题还是复合概念主题，再生成可审查的完整词群。

研究问题：${question}

必须执行：
1. 单一概念主题只返回 1 个完整语义群，不得为套用框架虚构背景、对象或结局。例如“胃癌的研究现状”应围绕胃癌建立一个完整词群，“研究现状”是研究目的，不是第二个检索实体。
2. 复合概念主题返回 2–3 个核心概念组：可用 A=背景/干预/场景，B=核心研究对象，C=现象/结局；只有语义上确实存在这些维度时才拆分。
3. 每组分别列出首选英文词、PubMed MeSH、同义词、近义词、亚型/下位词、缩写、英美拼写变体。
4. 只在词干至少 4 个字母时提出 PubMed 截词，如 rehabilitat*；不要把 * 放入引号。
5. 只对至少两个词且没有截词的短语提出 PubMed 邻近检索，距离使用 3–5。
6. 标注可能歧义，但不要自行加入高风险 NOT；排除建议留给人工确认。
7. 不得输出 Scopus/WOS 语法，不得使用 TITLE-ABS-KEY、W/n、NEAR/n。
8. 只返回 JSON，不要 Markdown。结构必须是：
{"topicComplexity":"single_concept|multi_concept","concepts":[{"sourceTerm":"中文概念","role":"context|subject|phenomenon","preferredTerms":[],"meshTerms":[],"synonyms":[],"abbreviations":[],"narrowerTerms":[],"spellingVariants":[],"wildcardTerms":[],"proximityTerms":[{"phrase":"two terms","distance":3}],"excludedAmbiguities":[]}],"relationshipCondition":"","qualityNotes":[]}`;
}

export function buildFeedbackQueryStrategyPrompt({ question, records, feedback }) {
  const sample = (Array.isArray(records) ? records : []).slice(0, 100).map((record, index) => ({
    n: index + 1,
    title: record?.title ?? "题名未返回",
    abstract: hasText(record?.abstract) ? record.abstract.slice(0, 1200) : "摘要未返回",
  }));
  return `${buildInitialQueryStrategyPrompt(question)}

这是初稿在 PubMed 当前排序前 ${sample.length} 条题名与可用摘要上的反馈。请依据真实样本修订词群；不要从摘要未报告内容推断。
机器统计：${JSON.stringify(feedback)}
样本：${JSON.stringify(sample)}

在相同 JSON 结构中返回修订后的 concepts；qualityNotes 说明新增、删除或保留词项的理由。`;
}

export function createQueryStrategyModel({ env = process.env } = {}) {
  const provider = env.RESEARCH_AGENT_PROVIDER;
  const modelId = env.RESEARCH_AGENT_MODEL;
  const apiKey = provider === "openai"
    ? env.OPENAI_API_KEY
    : provider === "anthropic"
      ? env.ANTHROPIC_API_KEY
      : null;
  if (!hasText(provider) || !hasText(modelId) || !hasText(apiKey)) {
    return {
      configured: false,
      descriptor: { mode: "guided_rule", provider: null, modelId: null },
      async completeJson() { throw new Error("实时检索策略模型未配置。"); },
    };
  }
  if (!["openai", "anthropic"].includes(provider)) {
    throw new Error(`检索策略模型暂不支持 provider：${provider}`);
  }
  const models = builtinModels();
  const model = models.getModel(provider, modelId);
  if (!model) throw new Error(`未找到检索策略模型：${provider}/${modelId}`);
  return {
    configured: true,
    descriptor: { mode: "live_model", provider, modelId },
    async completeJson(prompt, { signal } = {}) {
      const response = await models.completeSimple(model, {
        systemPrompt: "你只输出符合给定结构的 JSON。不得声称检索或读取了未提供的文献。",
        messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
      }, {
        apiKey,
        signal,
        temperature: 0.1,
        maxTokens: 7000,
      });
      if (response?.stopReason === "error") throw new Error(response.errorMessage || "模型调用失败。");
      return parseModelJson(contentText(response.content));
    },
  };
}

function promptReceipt({ prompt, model, status, error = null }) {
  const boundary = status === "completed"
    ? "专业检索规则与实时模型扩词均已执行；词群仍需人工确认，模型输出不替代医学信息专家终审。"
    : status === "baseline_completed_after_model_failure"
      ? "实时模型扩词失败；专业检索规则已由本地 Agent 执行并保留人工修订入口。未覆盖词项仍需医学信息专家核对。"
      : status === "baseline_completed"
        ? "专业检索规则已由本地 Agent 执行；本轮未调用实时模型做开放式扩词。词群仍需人工确认，未覆盖词项会明确提示，不会猜译。"
        : "检索策略未形成可验证结果。";
  return {
    templateId: PROMPT_TEMPLATE_ID,
    templateHash: sha256(prompt),
    status,
    mode: model.descriptor.mode,
    provider: model.descriptor.provider,
    modelId: model.descriptor.modelId,
    ...(error ? { error: String(error.message ?? error).slice(0, 500) } : {}),
    boundary,
  };
}

export async function generatePromptDrivenPubMedQueryPlan({
  question,
  model = createQueryStrategyModel(),
  signal,
  now = () => new Date(),
} = {}) {
  const fallback = generatePubMedQueryPlan({ question, now });
  const prompt = buildInitialQueryStrategyPrompt(question);
  if (!model.configured) {
    const draft = {
      ...fallback,
      planner: {
        ...fallback.planner,
        mode: "professional_agent_baseline_without_live_model",
        claim: "检索 Agent 已完成专业词群扩展与 PubMed 语法编译，请重点核对词项覆盖和检索边界。",
      },
      promptExecution: promptReceipt({ prompt, model, status: "baseline_completed" }),
    };
    const { planHash: _oldHash, ...payload } = draft;
    return { ...payload, planHash: sha256(payload) };
  }
  try {
    const output = await model.completeJson(prompt, { signal });
    const matrix = compilePubMedConceptMatrix(output?.concepts);
    const draft = {
      ...fallback,
      planner: {
        ...fallback.planner,
        mode: "prompt_driven_pubmed_matrix_v2",
        claim: "检索 Agent 已调用实时模型扩展专业词群，并编译为可比较的 PubMed 检索方案。",
      },
      mappings: matrix.mappings,
      conceptGroups: matrix.conceptGroups,
      candidates: matrix.candidates,
      topicComplexity: matrix.topicComplexity,
      unknownChinese: [],
      promptExecution: promptReceipt({ prompt, model, status: "completed" }),
      modelQualityNotes: uniqueTerms(output?.qualityNotes, 12),
    };
    const { planHash: _oldHash, ...payload } = draft;
    return { ...payload, planHash: sha256(payload) };
  } catch (error) {
    const draft = {
      ...fallback,
      planner: {
        ...fallback.planner,
        mode: "professional_agent_baseline_after_model_failure",
        claim: "实时模型没有形成可验证的结构化词群；已自动回退到本地专业词群，并保留人工修订入口。",
      },
      promptExecution: promptReceipt({ prompt, model, status: "baseline_completed_after_model_failure", error }),
    };
    const { planHash: _oldHash, ...payload } = draft;
    return { ...payload, planHash: sha256(payload) };
  }
}

export const RESEARCH_QUERY_STRATEGY_AGENT_INFO = Object.freeze({
  promptTemplateId: PROMPT_TEMPLATE_ID,
  maximumConcepts: MAX_CONCEPTS,
});
