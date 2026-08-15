import { createHash } from "node:crypto";

import {
  LITERATURE_LANDSCAPE_SCHEMA_VERSION,
  assertValidLiteratureLandscapeBuild,
} from "./research-literature-landscape-contracts-v1.js";

const METHOD = Object.freeze({
  kind: "transparent_rule_based_heuristic",
  claimStatus: "heuristic_only",
  description:
    "基于题名、当前可见摘要和已经登记的证据关系执行确定性词典匹配；分组可以重叠，用于导航和提出待验证问题，不是统计聚类、主题模型或领域结论。",
  limitations: Object.freeze([
    "词项出现只表示文本匹配，不证明概念关系、研究质量、因果关系或研究空白。",
    "摘要未报告的信息保持未知；仅题名或摘要级材料不能替代全文方法与结果核查。",
    "当前来源集可能是受限样本；数量和分组不能直接外推为领域趋势或患病率。",
    "候选方向是待重检、待研究者取舍和待最小验证的工作假设，不表示 idea 成立。",
  ]),
});

const DEFAULT_TAG_RULES = Object.freeze([
  {
    id: "rule:design:review",
    tagId: "tag:design:review",
    label: "综述与证据整合",
    dimension: "study_design",
    terms: ["systematic review", "meta-analysis", "meta analysis", "review", "综述", "荟萃"],
  },
  {
    id: "rule:design:trial",
    tagId: "tag:design:trial",
    label: "干预或临床试验",
    dimension: "study_design",
    terms: ["randomized", "randomised", "clinical trial", "controlled trial", "intervention", "干预", "随机"],
  },
  {
    id: "rule:design:observational",
    tagId: "tag:design:observational",
    label: "观察性或关联研究",
    dimension: "study_design",
    terms: ["cohort", "cross-sectional", "cross sectional", "case-control", "case control", "association", "correlation", "observational", "队列", "关联", "相关"],
  },
  {
    id: "rule:design:mechanistic",
    tagId: "tag:design:mechanistic",
    label: "机制与实验研究",
    dimension: "study_design",
    terms: ["mechanism", "mechanistic", "pathway", "in vitro", "in vivo", "animal model", "molecular", "机制", "通路", "动物模型"],
  },
  {
    id: "rule:design:computational",
    tagId: "tag:design:computational",
    label: "计算、组学或模型研究",
    dimension: "study_design",
    terms: ["machine learning", "artificial intelligence", "bioinformatics", "network pharmacology", "transcriptom", "proteom", "metabolom", "model", "算法", "网络药理", "生物信息", "组学"],
  },
  {
    id: "rule:population:human",
    tagId: "tag:population:human",
    label: "人体或患者材料",
    dimension: "population",
    terms: ["patient", "patients", "human", "participants", "adults", "children", "clinical", "患者", "人群", "受试者", "临床"],
  },
  {
    id: "rule:population:preclinical",
    tagId: "tag:population:preclinical",
    label: "动物或细胞材料",
    dimension: "population",
    terms: ["mouse", "mice", "rat", "rats", "murine", "animal", "cell line", "cells", "in vitro", "in vivo", "小鼠", "大鼠", "细胞", "动物"],
  },
  {
    id: "rule:purpose:diagnosis",
    tagId: "tag:purpose:diagnosis",
    label: "诊断、检测或生物标志物",
    dimension: "research_purpose",
    terms: ["diagnos", "detect", "screening", "biomarker", "sensitivity", "specificity", "诊断", "检测", "筛查", "标志物"],
  },
  {
    id: "rule:purpose:treatment",
    tagId: "tag:purpose:treatment",
    label: "治疗、预防或结局改善",
    dimension: "research_purpose",
    terms: ["treat", "therap", "prevention", "efficacy", "effectiveness", "outcome", "治疗", "疗效", "预防", "结局"],
  },
  {
    id: "rule:purpose:safety",
    tagId: "tag:purpose:safety",
    label: "安全性、风险或不良事件",
    dimension: "research_purpose",
    terms: ["safety", "adverse", "risk", "toxicity", "harm", "安全", "不良", "毒性", "风险"],
  },
  {
    id: "rule:purpose:mechanism",
    tagId: "tag:purpose:mechanism",
    label: "机制解释",
    dimension: "research_purpose",
    terms: ["mechanism", "mechanistic", "mediates", "pathway", "signaling", "机制", "介导", "通路", "信号"],
  },
]);

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function slug(value) {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "untitled";
}

function normalizeRules(rules) {
  const normalized = asArray(rules).map((rule, index) => {
    if (!rule || typeof rule !== "object") {
      throw new TypeError(`tagRules[${index}] must be an object`);
    }
    const id = hasText(rule.id) ? rule.id.trim() : `rule:custom:${index + 1}`;
    const tagId = hasText(rule.tagId) ? rule.tagId.trim() : `tag:custom:${index + 1}`;
    const label = hasText(rule.label) ? rule.label.trim() : null;
    const dimension = hasText(rule.dimension) ? rule.dimension.trim() : null;
    const terms = [...new Set(asArray(rule.terms).map((term) => String(term).trim().toLowerCase()).filter(Boolean))];
    if (!label || !dimension || terms.length === 0) {
      throw new TypeError(`tagRules[${index}] requires label, dimension, and non-empty terms`);
    }
    return { id, tagId, label, dimension, terms };
  });
  const ids = normalized.map((rule) => rule.id);
  const tagIds = normalized.map((rule) => rule.tagId);
  if (new Set(ids).size !== ids.length) throw new TypeError("tagRules must have unique ids");
  if (new Set(tagIds).size !== tagIds.length) throw new TypeError("tagRules must have unique tagIds");
  return normalized;
}

function normalizeSource(source, index, projectId) {
  if (!source || typeof source !== "object") {
    throw new TypeError(`sourceMaterials[${index}] must be an object`);
  }
  const snapshotContent = source.content && typeof source.content === "object" ? source.content : null;
  const sourceId = hasText(snapshotContent?.sourceId)
    ? snapshotContent.sourceId.trim()
    : hasText(source.sourceId)
      ? source.sourceId.trim()
      : hasText(source.id)
        ? source.id.trim()
      : `source:${projectId}:${index + 1}`;
  const title = hasText(snapshotContent?.title)
    ? snapshotContent.title.trim()
    : hasText(source.title)
      ? source.title.trim()
      : `未命名来源 ${index + 1}`;
  const visibleText = [
    title,
    snapshotContent?.abstract,
    snapshotContent?.text,
    source.abstract,
    source.text,
  ].filter(hasText).join("\n").normalize("NFKC");
  const declaredAccessLevel = snapshotContent?.accessLevel ?? source.accessLevel;
  const accessLevel = ["unknown", "title_only", "abstract_only", "full_text", "full_text_and_supplement"].includes(
    declaredAccessLevel,
  )
    ? declaredAccessLevel
    : hasText(snapshotContent?.abstract) || hasText(snapshotContent?.text) || hasText(source.abstract) || hasText(source.text)
      ? declaredAccessLevel === "unknown" ? "unknown" : "abstract_only"
      : "title_only";
  const locatorSource = snapshotContent?.locator ?? source.locator;
  const locator = locatorSource && typeof locatorSource === "object"
    ? structuredClone(locatorSource)
    : hasText(snapshotContent?.pmid ?? source.pmid)
      ? { pmid: snapshotContent?.pmid ?? source.pmid }
      : hasText(snapshotContent?.doi ?? source.doi)
        ? { doi: snapshotContent?.doi ?? source.doi }
        : { repositoryId: `project:${projectId}:materials` };
  const declaredHash = snapshotContent?.sourceSnapshotHash ?? source.sourceSnapshotHash ?? source.contentHash;
  const providedHash = /^[a-f0-9]{64}$/i.test(declaredHash ?? "");
  const sourceSnapshotHash = providedHash
    ? declaredHash.toLowerCase()
    : sha256({ sourceId, title, visibleText, accessLevel, locator });
  return {
    sourceId,
    title,
    visibleText,
    normalizedText: visibleText.toLowerCase(),
    accessLevel,
    locator,
    sourceSnapshotHash,
    snapshotHashOrigin: providedHash ? "provided" : "derived_from_visible_fields",
  };
}

function evidenceContent(record) {
  return record?.content && typeof record.content === "object" ? record.content : record;
}

function normalizeEvidenceRecords(records, sourceIds) {
  const bySourceId = new Map(sourceIds.map((id) => [id, []]));
  asArray(records).forEach((record, index) => {
    if (!record || typeof record !== "object") return;
    const content = evidenceContent(record);
    const sourceId = content?.sourceId;
    if (!bySourceId.has(sourceId)) return;
    const id = hasText(record.id)
      ? record.id.trim()
      : hasText(content.id)
        ? content.id.trim()
        : `evidence:${sourceId}:${index + 1}`;
    bySourceId.get(sourceId).push({
      id,
      relation: content.relation ?? "unclear",
      claimId: content.claimId ?? null,
    });
  });
  return bySourceId;
}

function sourceRef(source, evidenceBySourceId) {
  return {
    sourceId: source.sourceId,
    title: source.title,
    accessLevel: source.accessLevel,
    locator: structuredClone(source.locator),
    sourceSnapshotHash: source.sourceSnapshotHash,
    snapshotHashOrigin: source.snapshotHashOrigin,
    evidenceRecordIds: asArray(evidenceBySourceId.get(source.sourceId)).map((record) => record.id),
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsTerm(text, term) {
  // ASCII rules describe complete words or phrases. Substring matching would,
  // for example, classify "operation" or "stratification" as a rat study.
  // Unicode-aware boundaries keep the rule transparent while allowing common
  // punctuation and whitespace around a phrase. Chinese rules intentionally
  // retain direct substring matching because words are not space-delimited.
  if (/^[\x00-\x7F]+$/.test(term)) {
    const escaped = escapeRegExp(term.trim()).replace(/\s+/g, "\\s+");
    return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "iu").test(text);
  }
  return text.includes(term);
}

function tagMatches(source, rules) {
  return rules.flatMap((rule) => {
    const matchedTerms = rule.terms.filter((term) => containsTerm(source.normalizedText, term));
    return matchedTerms.length === 0
      ? []
      : [{
          tagId: rule.tagId,
          label: rule.label,
          dimension: rule.dimension,
          ruleId: rule.id,
          matchedTerms,
        }];
  });
}

function buildControversies(evidenceBySourceId) {
  const byClaim = new Map();
  for (const [sourceId, records] of evidenceBySourceId.entries()) {
    for (const record of records) {
      if (!hasText(record.claimId)) continue;
      const entry = byClaim.get(record.claimId) ?? {
        supporting: [],
        contradicting: [],
      };
      if (["supports", "partially_supports"].includes(record.relation)) {
        entry.supporting.push({ ...record, sourceId });
      }
      if (record.relation === "contradicts") {
        entry.contradicting.push({ ...record, sourceId });
      }
      byClaim.set(record.claimId, entry);
    }
  }
  return [...byClaim.entries()]
    .filter(([, records]) => records.contradicting.length > 0)
    .map(([claimId, records], index) => ({
      id: `controversy:${index + 1}:${slug(claimId)}`,
      kind: records.supporting.length > 0
        ? "recorded_relation_conflict"
        : "counterevidence_present",
      claimId,
      sourceIds: [...new Set([...records.supporting, ...records.contradicting].map((record) => record.sourceId))],
      supportingEvidenceRecordIds: records.supporting.map((record) => record.id),
      contradictingEvidenceRecordIds: records.contradicting.map((record) => record.id),
      boundary:
        "这里只呈现 EvidenceRecord 已登记的支持/反驳关系；它是复核入口，不表示争议已经解决，也不比较未登记的方法质量。",
    }));
}

function componentsForCluster(cluster, assignments, sourcesById) {
  const dimensions = new Map();
  for (const assignment of assignments) {
    if (!cluster.sourceIds.includes(assignment.sourceId)) continue;
    for (const tag of assignment.tags) {
      if (tag.tagId === cluster.tagId) continue;
      const entry = dimensions.get(tag.tagId) ?? {
        kind: tag.dimension,
        value: tag.label,
        sourceIds: [],
      };
      entry.sourceIds.push(assignment.sourceId);
      dimensions.set(tag.tagId, entry);
    }
  }
  const values = [...dimensions.values()]
    .map((item) => ({ ...item, sourceIds: [...new Set(item.sourceIds)] }))
    .sort((a, b) => b.sourceIds.length - a.sourceIds.length || a.value.localeCompare(b.value));
  if (values.length > 0) return values.slice(0, 3);
  return [{
    kind: "source_set",
    value: `${cluster.sourceCount} 条当前来源`,
    sourceIds: cluster.sourceIds.filter((sourceId) => sourcesById.has(sourceId)),
  }];
}

function targetScaleFor(sourceCount, accessLevels) {
  const hasFullText = accessLevels.some((level) =>
    ["full_text", "full_text_and_supplement"].includes(level),
  );
  if (sourceCount >= 8 && hasFullText) {
    return {
      kind: "bounded_synthesis_candidate",
      description: "当前只够进入更严格的范围与质量核查；是否形成综述仍取决于重检、去重、全文与领域标准。",
    };
  }
  return {
    kind: "fishing_recheck",
    description: "当前仅适合钓鱼式重检或最小可行性核查，不能据此宣称领域趋势、空白或 idea 成立。",
  };
}

function buildIdeaCandidates({ project, version, clusters, assignments, sourcesById, evidenceBySourceId }) {
  return clusters
    .filter((cluster) => cluster.sourceCount >= 2)
    .slice(0, 5)
    .map((cluster, index) => {
      const components = componentsForCluster(cluster, assignments, sourcesById);
      const sourceIds = [...new Set([
        ...cluster.sourceIds,
        ...components.flatMap((component) => component.sourceIds),
      ])];
      const refs = sourceIds.map((sourceId) => sourceRef(sourcesById.get(sourceId), evidenceBySourceId));
      const evidenceRecordIds = [...new Set(refs.flatMap((ref) => ref.evidenceRecordIds))];
      const componentLabels = components.map((component) => component.value).join("、");
      const recheckTerms = components
        .flatMap((component) => component.value.split(/[、，,;/]/))
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 3);
      const question = hasText(project.question) ? project.question.trim() : "当前研究问题";
      return {
        schemaVersion: LITERATURE_LANDSCAPE_SCHEMA_VERSION,
        type: "IdeaCandidate",
        id: `landscape:${project.id}:idea:${index + 1}:${slug(cluster.tagId)}:v${version}`,
        projectId: project.id,
        version: 1,
        generatedAt: null,
        method: structuredClone(METHOD),
        status: "unvalidated_hypothesis",
        anchor: {
          tagId: cluster.tagId,
          label: cluster.label,
          sourceIds: cluster.sourceIds,
        },
        componentPool: components,
        relationshipRationale:
          `当前来源文本在透明词典规则下同时进入“${cluster.label}”以及“${componentLabels}”标签；这只是产生重检问题的文本线索，不证明这些要素存在机制、因果或临床关系。`,
        targetScale: targetScaleFor(cluster.sourceCount, refs.map((ref) => ref.accessLevel)),
        rejectionReason: null,
        recheckQuery: `(${question}) AND (${cluster.label})${recheckTerms.length > 0 ? ` AND (${recheckTerms.join(" OR ")})` : ""}`,
        sourceRefs: refs,
        evidenceRecordIds,
        tagIds: [...new Set([
          cluster.tagId,
          ...assignments
            .filter((assignment) => sourceIds.includes(assignment.sourceId))
            .flatMap((assignment) => assignment.tags.map((tag) => tag.tagId)),
        ])],
        validationBoundary:
          "该候选尚未经过目标体量重检、关系证据核对、方法学评价或最小 idea 验证；不得表述为研究空白、创新性成立或结论成立。",
      };
    });
}

function revisionSnapshot({ revision, build, reason = null }) {
  if (!build || typeof build !== "object") return null;
  return {
    version: Number.isInteger(revision?.version) ? revision.version : build.literatureLandscape?.version ?? 1,
    sourceSetHash: build.literatureLandscape?.sourceSetHash ?? null,
    tagAssignmentHash: sha256(asArray(build.tagAssignments).map((item) => ({
      sourceId: item.sourceId,
      tags: asArray(item.tags).map((tag) => tag.tagId),
    }))),
    unclassifiedRate: build.literatureLandscape?.unclassifiedRate ?? null,
    candidateIds: asArray(build.ideaCandidates).map((candidate) => candidate.id),
    changedAt: revision?.changedAt ?? null,
    changedBy: revision?.changedBy ?? null,
    reason: revision?.reason ?? reason ?? "Generated from the supplied previous landscape.",
  };
}

function normalizeDecisionEntries(entries, candidateIds) {
  const candidateIdSet = new Set(candidateIds);
  return asArray(entries).map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new TypeError(`decisionEntries[${index}] must be an object`);
    }
    if (!candidateIdSet.has(entry.candidateId)) {
      throw new TypeError(`decisionEntries[${index}] references unknown candidate ${entry.candidateId}`);
    }
    if (!["selected", "rejected", "deferred", "reopened"].includes(entry.decision)) {
      throw new TypeError(`decisionEntries[${index}].decision is unsupported`);
    }
    if (!entry.decidedBy || entry.decidedBy.kind !== "human") {
      throw new TypeError(`decisionEntries[${index}].decidedBy must be a human actor`);
    }
    if (!hasText(entry.reason)) {
      throw new TypeError(`decisionEntries[${index}].reason is required`);
    }
    if (!hasText(entry.decidedAt) || Number.isNaN(Date.parse(entry.decidedAt))) {
      throw new TypeError(`decisionEntries[${index}].decidedAt must be an ISO timestamp`);
    }
    return {
      id: hasText(entry.id) ? entry.id.trim() : `idea-decision:${index + 1}:${slug(entry.candidateId)}`,
      candidateId: entry.candidateId,
      decision: entry.decision,
      reason: entry.reason.trim(),
      decidedBy: {
        id: String(entry.decidedBy.id ?? "").trim(),
        role: String(entry.decidedBy.role ?? "").trim(),
        kind: "human",
      },
      decidedAt: new Date(entry.decidedAt).toISOString(),
      sourceIds: [...new Set(asArray(entry.sourceIds).map(String).filter(Boolean))],
    };
  });
}

/**
 * Build an auditable, deterministic literature landscape from material the
 * project actually contains. The result is deliberately heuristic: it never
 * assigns scientific scores and never promotes an idea to "validated".
 */
export function buildLiteratureLandscape({
  project,
  evidenceRecords = [],
  tagRules = DEFAULT_TAG_RULES,
  generatedAt = null,
  version = 1,
  previousBuild = null,
  revision = null,
  decisionEntries = [],
} = {}) {
  if (!project || typeof project !== "object" || !hasText(project.id)) {
    throw new TypeError("project.id is required");
  }
  if (!Number.isInteger(version) || version < 1) throw new TypeError("version must be a positive integer");
  if (generatedAt !== null && (!hasText(generatedAt) || Number.isNaN(Date.parse(generatedAt)))) {
    throw new TypeError("generatedAt must be null or an ISO timestamp");
  }
  const normalizedGeneratedAt = generatedAt === null ? null : new Date(generatedAt).toISOString();
  const rules = normalizeRules(tagRules);
  const sources = asArray(project.sourceMaterials).map((source, index) =>
    normalizeSource(source, index, project.id),
  );
  const sourcesById = new Map(sources.map((source) => [source.sourceId, source]));
  if (sourcesById.size !== sources.length) throw new TypeError("sourceMaterials must have unique ids");
  const evidenceBySourceId = normalizeEvidenceRecords(evidenceRecords, [...sourcesById.keys()]);
  const controversies = buildControversies(evidenceBySourceId);

  const assignments = sources.flatMap((source, index) => {
    const tags = tagMatches(source, rules);
    if (tags.length === 0) return [];
    return [{
      schemaVersion: LITERATURE_LANDSCAPE_SCHEMA_VERSION,
      type: "TagAssignment",
      id: `landscape:${project.id}:assignment:${index + 1}:${slug(source.sourceId)}:v${version}`,
      projectId: project.id,
      version,
      generatedAt: normalizedGeneratedAt,
      method: structuredClone(METHOD),
      sourceId: source.sourceId,
      sourceRef: sourceRef(source, evidenceBySourceId),
      tags,
      assignmentBoundary:
        "允许一篇来源进入多个标签。标签来自可见文本的词典命中，不代表人工纳入、语义蕴含、证据等级或科学关系成立。",
    }];
  });
  const taggedSourceIds = new Set(assignments.map((assignment) => assignment.sourceId));
  const unclassifiedSources = sources.filter((source) => !taggedSourceIds.has(source.sourceId));

  const clusters = rules.flatMap((rule) => {
    const matched = assignments.filter((assignment) =>
      assignment.tags.some((tag) => tag.tagId === rule.tagId),
    );
    if (matched.length === 0) return [];
    const clusterSources = matched.map((assignment) => sourcesById.get(assignment.sourceId));
    const controversyIds = controversies
      .filter((item) => item.sourceIds.some((sourceId) => matched.some((assignment) => assignment.sourceId === sourceId)))
      .map((item) => item.id);
    return [{
      id: `cluster:${slug(rule.tagId)}`,
      tagId: rule.tagId,
      label: rule.label,
      dimension: rule.dimension,
      sourceCount: clusterSources.length,
      sourceIds: clusterSources.map((source) => source.sourceId),
      sourceRefs: clusterSources.map((source) => sourceRef(source, evidenceBySourceId)),
      matchedTerms: [...new Set(matched.flatMap((assignment) =>
        assignment.tags
          .filter((tag) => tag.tagId === rule.tagId)
          .flatMap((tag) => tag.matchedTerms),
      ))],
      controversyIds,
      interpretationBoundary:
        "此组是重叠的规则匹配导航层，不是互斥类别、统计聚类、主题模型或领域规模估计。",
    }];
  });
  clusters.sort((a, b) => b.sourceCount - a.sourceCount || a.label.localeCompare(b.label));

  const clusterMap = {
    schemaVersion: LITERATURE_LANDSCAPE_SCHEMA_VERSION,
    type: "ClusterMap",
    id: `landscape:${project.id}:cluster-map:v${version}`,
    projectId: project.id,
    version,
    generatedAt: normalizedGeneratedAt,
    method: structuredClone(METHOD),
    mapKind: "overlapping_rule_groups",
    clusters,
  };
  const unclassifiedBucket = {
    schemaVersion: LITERATURE_LANDSCAPE_SCHEMA_VERSION,
    type: "UnclassifiedBucket",
    id: `landscape:${project.id}:unclassified:v${version}`,
    projectId: project.id,
    version,
    generatedAt: normalizedGeneratedAt,
    method: structuredClone(METHOD),
    totalSourceCount: sources.length,
    sourceCount: unclassifiedSources.length,
    rate: sources.length === 0 ? 0 : unclassifiedSources.length / sources.length,
    sourceIds: unclassifiedSources.map((source) => source.sourceId),
    sourceRefs: unclassifiedSources.map((source) => sourceRef(source, evidenceBySourceId)),
    reasons: unclassifiedSources.map((source) => ({
      sourceId: source.sourceId,
      reason:
        "当前可见题名/摘要没有命中透明词典规则；这不等于该来源无关，应由研究者补充标签或修订规则。",
    })),
    nextAction:
      "逐条检查未分类来源：必要时添加可解释规则、补读摘要/全文，或保留为明确的未分类项；不得静默丢弃。",
  };
  let ideaCandidates = buildIdeaCandidates({
    project,
    version,
    clusters,
    assignments,
    sourcesById,
    evidenceBySourceId,
  }).map((candidate) => ({ ...candidate, version, generatedAt: normalizedGeneratedAt }));
  const candidateIds = ideaCandidates.map((candidate) => candidate.id);
  const normalizedDecisionEntries = normalizeDecisionEntries(decisionEntries, candidateIds).map((entry) => {
    const candidate = ideaCandidates.find((item) => item.id === entry.candidateId);
    const candidateSourceIds = new Set(candidate.sourceRefs.map((ref) => ref.sourceId));
    const unknownSourceIds = entry.sourceIds.filter((sourceId) => !candidateSourceIds.has(sourceId));
    if (unknownSourceIds.length > 0) {
      throw new TypeError(`decision entry ${entry.id} references sources outside candidate ${entry.candidateId}: ${unknownSourceIds.join(", ")}`);
    }
    return {
      ...entry,
      sourceIds: entry.sourceIds.length > 0 ? entry.sourceIds : candidate.sourceRefs.map((ref) => ref.sourceId),
    };
  });
  const latestDecisionByCandidate = new Map();
  normalizedDecisionEntries.forEach((entry) => latestDecisionByCandidate.set(entry.candidateId, entry));
  ideaCandidates = ideaCandidates.map((candidate) => {
    const entry = latestDecisionByCandidate.get(candidate.id);
    if (!entry || entry.decision === "reopened") {
      return { ...candidate, status: "unvalidated_hypothesis", rejectionReason: null };
    }
    if (entry.decision === "selected") {
      return { ...candidate, status: "selected_for_recheck", rejectionReason: null };
    }
    if (entry.decision === "rejected") {
      return { ...candidate, status: "rejected", rejectionReason: entry.reason };
    }
    return { ...candidate, status: "deferred", rejectionReason: null };
  });
  const decidedCandidateIds = new Set(
    [...latestDecisionByCandidate.values()]
      .filter((entry) => entry.decision !== "reopened")
      .map((entry) => entry.candidateId),
  );
  const ideaDecisionLedger = {
    schemaVersion: LITERATURE_LANDSCAPE_SCHEMA_VERSION,
    type: "IdeaDecisionLedger",
    id: `landscape:${project.id}:idea-decisions:v${version}`,
    projectId: project.id,
    version,
    generatedAt: normalizedGeneratedAt,
    candidateIds,
    entries: normalizedDecisionEntries,
    pendingCandidateIds: candidateIds.filter((id) => !decidedCandidateIds.has(id)),
    decisionBoundary:
      "启发式生成不能替代研究者选择。进入 idea 验证前必须由人记录选择、放弃或延期理由；推荐顺序和候选数量不是科学评分。",
  };
  const history = [
    ...asArray(previousBuild?.literatureLandscape?.revisionHistory),
    revisionSnapshot({ revision, build: previousBuild }),
  ].filter(Boolean);
  const literatureLandscape = {
    schemaVersion: LITERATURE_LANDSCAPE_SCHEMA_VERSION,
    type: "LiteratureLandscape",
    id: `landscape:${project.id}:overview:v${version}`,
    projectId: project.id,
    version,
    generatedAt: normalizedGeneratedAt,
    method: structuredClone(METHOD),
    sourceSetHash: sha256(sources.map((source) => ({
      sourceId: source.sourceId,
      sourceSnapshotHash: source.sourceSnapshotHash,
    }))),
    sourceCount: sources.length,
    taggedSourceCount: taggedSourceIds.size,
    unclassifiedSourceCount: unclassifiedSources.length,
    unclassifiedRate: sources.length === 0 ? 0 : unclassifiedSources.length / sources.length,
    sourceRefs: sources.map((source) => sourceRef(source, evidenceBySourceId)),
    controversies,
    tagAssignmentIds: assignments.map((assignment) => assignment.id),
    clusterMapId: clusterMap.id,
    unclassifiedBucketId: unclassifiedBucket.id,
    ideaCandidateIds: candidateIds,
    ideaDecisionLedgerId: ideaDecisionLedger.id,
    revisionHistory: history,
    interpretationBoundary:
      "这是基于当前实际来源与已登记 EvidenceRecord 的可审计文献导航图。它不能单独证明领域共识、趋势、研究空白、关系成立或候选 idea 成立。",
  };
  return assertValidLiteratureLandscapeBuild({
    literatureLandscape,
    clusterMap,
    tagAssignments: assignments,
    unclassifiedBucket,
    ideaCandidates,
    ideaDecisionLedger,
  });
}

export function landscapeBuildToArtifacts(build, {
  status = "candidate",
  producedByNodeId = "map_literature_landscape",
  producedByActorId = "agent:literature_landscape_mapper",
  inputArtifactRefs = [],
} = {}) {
  assertValidLiteratureLandscapeBuild(build);
  const contents = [
    build.literatureLandscape,
    build.clusterMap,
    ...build.tagAssignments,
    build.unclassifiedBucket,
    ...build.ideaCandidates,
    build.ideaDecisionLedger,
  ];
  return contents.map((content) => ({
    id: content.id,
    type: content.type,
    lineageId: content.id.replace(/:v\d+$/, ""),
    version: content.version,
    contentHash: sha256(content),
    status,
    producedByNodeId,
    producedByActorId,
    inputArtifactRefs: structuredClone(inputArtifactRefs),
    content: structuredClone(content),
  }));
}

export { DEFAULT_TAG_RULES, METHOD as LITERATURE_LANDSCAPE_HEURISTIC_METHOD };
