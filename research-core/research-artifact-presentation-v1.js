import { createHash } from "node:crypto";

import { projectRuntimeProvenanceAllowsFormal } from "./agent-run-log-v1.js";

const OUTPUT_GROUPS = Object.freeze([
  {
    id: "conclusions",
    label: "研究结论",
    description: "当前证据允许得出的判断、适用范围与仍待回答的问题。",
  },
  {
    id: "evidence",
    label: "来源与证据",
    description: "逐篇来源、实际访问层级、提取事实、质量评价与反证。",
  },
  {
    id: "methods",
    label: "检索与方法",
    description: "可复现的检索方案、实际运行范围与文献库边界。",
  },
  {
    id: "writing",
    label: "写作稿件",
    description: "证据驱动的论文结构、已确认写作计划与可阅读正文。",
  },
  {
    id: "quality",
    label: "质量审计与交付",
    description: "独立核查、全文审计、作者责任与可下载成果。",
  },
]);

const STATUS_LABELS = Object.freeze({
  candidate: "Agent 候选",
  verified: "已独立核查",
  accepted: "研究者已确认",
  rejected: "未通过核查",
  superseded: "已有新版本",
});

const ACCESS_LABELS = Object.freeze({
  metadata_only: "仅题录元数据",
  title_only: "仅题名",
  title_abstract: "题名与摘要",
  abstract_only: "题名与摘要",
  full_text: "已访问全文",
  full_text_and_supplement: "全文与补充材料",
  unknown: "访问层级未知",
});

const RELATION_LABELS = Object.freeze({
  supports: "支持",
  partially_supports: "部分支持",
  contradicts: "反驳",
  context_only: "仅作背景",
  unclear: "关系尚不明确",
});

const OUTPUT_PURPOSES = Object.freeze({
  LiteratureLandscape: "俯瞰当前来源的重叠标签、未分类率、已登记争议与候选方向，并保留启发式边界。",
  ClusterMap: "按透明规则查看可重叠的文献组；分组用于导航，不表示统计聚类或领域结论。",
  TagAssignment: "核对单篇来源为何进入一个或多个标签，以及匹配了哪些可见词项。",
  UnclassifiedBucket: "检查没有被规则覆盖的来源，避免材料被静默丢弃。",
  IdeaCandidate: "把文献地形转成待重检的候选问题，并回到具体来源、标签和证据记录。",
  IdeaDecisionLedger: "记录研究者对候选方向的选择、放弃、延期和理由，避免只凭 Agent 推荐通关。",
  ResearchConclusionCard: "快速了解当前证据究竟允许得出什么结论，以及结论不能外推到哪里。",
  EvidenceRecord: "回到单篇来源核对提取事实、证据关系、访问层级和未知信息。",
  CounterevidenceRegister: "查看与主要判断不一致的材料，避免只保留支持性证据。",
  CoverageGapRegister: "识别最可能改变结论的证据缺口，并据此安排下一轮调研。",
  LibraryManifest: "确认本轮研究实际纳入了多少来源，以及全文、摘要和题名材料的比例。",
  FrozenSearchProtocol: "复现正式检索，检查数据库、检索式、访问策略和停止规则。",
  FrozenOrientationSearchProtocol: "在正式精准检索形成前，复现当前领域探索检索。",
  FocusedSearchRunSnapshot: "核对精准检索是否真实执行、返回多少结果以及存在什么限制。",
  SearchRunSnapshot: "核对领域探索检索是否真实执行、返回多少结果以及存在什么限制。",
  EvidenceDrivenOutline: "检查论文结构是否由已登记证据驱动，而不是先有结论再寻找材料。",
  FrozenWritingPlan: "查看研究者已经批准的写作顺序、允许使用的证据和排除主题。",
  AuditedManuscript: "阅读经过逐句核查和全文审计后的当前正式稿。",
  ManuscriptDraft: "在全文审计完成前阅读当前候选稿；其内容尚不能视为正式结论。",
  EvidenceVerificationReport: "确认研究结论是否由独立角色核查，以及核查仍有哪些边界。",
  ManuscriptAudit: "检查全文是否存在引用、边界、权利或未披露限制问题。",
  DeliveryBundle: "取得可提交成果及其内容哈希，确认下载内容与审计版本一致。",
});

const RESEARCH_OUTPUT_TYPES = new Set(Object.keys(OUTPUT_PURPOSES));

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstText(...values) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0) ?? null;
}

function latest(artifacts, type) {
  return artifacts.filter((artifact) => artifact.type === type).at(-1) ?? null;
}

const FORMAL_RETRIEVAL_PURPOSES = [
  "pilot",
  "orientationCorpus",
  "focusedCalibration",
  "finalLibrary",
];

function formalRetrievalRuns(project) {
  const runs = project?.retrievalRuns ?? {};
  return [
    runs.pilot,
    runs.orientationCorpus,
    ...(Array.isArray(runs.focusedCalibration) ? runs.focusedCalibration : []),
    runs.finalLibrary,
  ].filter(Boolean);
}

function retrievalRunBundleView(run) {
  const receipt = run?.receipt ?? {};
  return {
    purpose: run?.purpose ?? null,
    nodeId: run?.nodeId ?? null,
    protocolArtifactId: run?.protocolArtifactId ?? null,
    protocolContentHash: run?.protocolContentHash ?? null,
    queryId: run?.queryId ?? null,
    query: run?.query ?? null,
    queryHash: run?.queryHash ?? null,
    executedAt: receipt.executedAt ?? null,
    fetchedAt: receipt.fetchedAt ?? null,
    total: receipt.total ?? null,
    savedCount: asArray(receipt.records).length,
    receiptHash: receipt.receiptHash ?? null,
    accessBoundary: receipt.accessBoundary ?? null,
  };
}

function statusView(artifact) {
  if (artifact.freshness === "stale") {
    return { code: "stale", label: "已失效，请重新运行", tone: "warning" };
  }
  const code = artifact.status ?? "candidate";
  return {
    code,
    label: STATUS_LABELS[code] ?? "状态待确认",
    tone:
      code === "accepted" || code === "verified"
        ? "positive"
        : code === "rejected"
          ? "critical"
          : "neutral",
  };
}

function artifactTraceability(artifact, sourceMaterials = []) {
  const content = artifact.content ?? {};
  const sourceIds = [
    content.sourceId,
    ...asArray(content.sourceIds),
    ...asArray(content.sourceRefs).map((source) => source?.sourceId ?? source?.id),
    ...asArray(content.clusters).flatMap((cluster) => asArray(cluster?.sourceIds)),
    ...asArray(content.records).map((source) => source?.sourceId ?? source?.id),
    ...asArray(content.sourceMaterials).map((source) => source?.id),
  ].filter(Boolean);
  const sourceById = new Map(sourceMaterials.map((source) => [source.id, source]));
  const source = sourceById.get(content.sourceId);
  const locator = content.locator ?? source?.locator ?? artifact.locator ?? null;
  const accessLevels = [
    content.accessLevel,
    source?.accessLevel,
    ...asArray(content.sourceRefs).map((item) => item?.accessLevel),
    ...asArray(content.clusters).flatMap((cluster) =>
      asArray(cluster?.sourceRefs).map((item) => item?.accessLevel),
    ),
    ...asArray(content.records).map((item) => item?.accessLevel),
    ...asArray(content.sourceMaterials).map((item) => item?.accessLevel),
  ].filter(Boolean);
  const sources = [...new Set(sourceIds)].map((sourceId) => {
    const material = sourceById.get(sourceId);
    if (!material) return { id: sourceId, title: "已绑定项目来源", accessLevel: null, url: null };
    return {
      id: material.id,
      title: material.title ?? "未命名项目来源",
      accessLevel: material.accessLevel ?? null,
      url: material.locator?.url ?? null,
      locator: material.locator ?? null,
    };
  });
  return {
    version: artifact.version ?? null,
    contentHash: artifact.contentHash ?? null,
    producedAt: artifact.producedAt ?? null,
    producerNodeId: artifact.producedByNodeId ?? null,
    producerActorId: artifact.producedByActorId ?? null,
    sourceIds: [...new Set(sourceIds)],
    accessLevels: [...new Set(accessLevels)],
    accessLabels: [...new Set(accessLevels)].map((level) => ACCESS_LABELS[level] ?? level),
    sources,
    locator,
    inputArtifactIds: asArray(artifact.inputArtifactRefs).map(
      (reference) => reference?.artifactId ?? reference?.id,
    ).filter(Boolean),
  };
}

function detailsFor(artifact, context) {
  const content = artifact.content ?? {};
  const appraisal = context.appraisalBySourceId.get(content.sourceId)?.content;
  switch (artifact.type) {
    case "ResearchConclusionCard":
      return {
        conclusion: content.claim,
        confidence: content.confidence,
        scope: content.scope,
        accessBoundary: content.accessBoundary,
        uncertainties: asArray(content.uncertainties),
        nextQuestion: content.nextQuestion,
        supportingEvidenceIds: asArray(content.supportingEvidenceIds),
        counterEvidenceIds: asArray(content.counterEvidenceIds),
        limitations: asArray(content.uncertainties),
      };
    case "LiteratureLandscape":
      return {
        sourceCount: content.sourceCount ?? 0,
        taggedSourceCount: content.taggedSourceCount ?? 0,
        unclassifiedSourceCount: content.unclassifiedSourceCount ?? 0,
        unclassifiedRate: content.unclassifiedRate ?? 0,
        controversies: asArray(content.controversies),
        ideaCandidateIds: asArray(content.ideaCandidateIds),
        interpretationBoundary: content.interpretationBoundary ?? null,
        method: content.method ?? null,
        revisionHistory: asArray(content.revisionHistory),
      };
    case "ClusterMap":
      return {
        mapKind: content.mapKind,
        clusters: asArray(content.clusters),
        method: content.method ?? null,
      };
    case "TagAssignment":
      return {
        sourceId: content.sourceId,
        sourceRef: content.sourceRef ?? null,
        tags: asArray(content.tags),
        assignmentBoundary: content.assignmentBoundary ?? null,
      };
    case "UnclassifiedBucket":
      return {
        sourceCount: content.sourceCount ?? 0,
        totalSourceCount: content.totalSourceCount ?? 0,
        rate: content.rate ?? 0,
        sourceRefs: asArray(content.sourceRefs),
        reasons: asArray(content.reasons),
        nextAction: content.nextAction ?? null,
      };
    case "IdeaCandidate":
      return {
        candidateStatus: content.status,
        anchor: content.anchor ?? null,
        componentPool: asArray(content.componentPool),
        relationshipRationale: content.relationshipRationale ?? null,
        targetScale: content.targetScale ?? null,
        rejectionReason: content.rejectionReason ?? null,
        recheckQuery: content.recheckQuery ?? null,
        sourceRefs: asArray(content.sourceRefs),
        evidenceRecordIds: asArray(content.evidenceRecordIds),
        validationBoundary: content.validationBoundary ?? null,
      };
    case "IdeaDecisionLedger":
      return {
        entries: asArray(content.entries),
        pendingCandidateIds: asArray(content.pendingCandidateIds),
        decisionBoundary: content.decisionBoundary ?? null,
      };
    case "EvidenceRecord":
      return {
        sourceId: content.sourceId,
        accessLevel: content.accessLevel,
        accessLabel: ACCESS_LABELS[content.accessLevel] ?? content.accessLevel,
        relation: content.relation,
        relationLabel: RELATION_LABELS[content.relation] ?? content.relation,
        extractedFacts: asArray(content.extractedFacts),
        appraisal: appraisal?.appraisal ?? null,
        riskFlags: asArray(appraisal?.riskFlags),
        limitations: asArray(content.limitations),
        unknowns: asArray(content.unknowns),
        sourceSnapshotHash: content.sourceSnapshotHash ?? null,
        locator: content.locator ?? null,
      };
    case "CounterevidenceRegister":
      return {
        counterevidence: asArray(content.counterevidence),
        limitation: content.limitation ?? null,
      };
    case "CoverageGapRegister":
      return { gaps: asArray(content.gaps) };
    case "LibraryManifest":
      return {
        sourceCount: content.sourceCount ?? 0,
        accessCounts: content.accessCounts ?? {},
        frozen: Boolean(content.frozen),
        provider: content.provider ?? null,
        query: content.query ?? null,
        executedAt: content.executedAt ?? null,
      };
    case "FrozenSearchProtocol":
    case "FrozenOrientationSearchProtocol":
      return {
        query: content.query ?? null,
        dataSources: asArray(content.dataSources),
        accessPolicy: content.accessPolicy ?? null,
        stopRule: content.stopRule ?? null,
      };
    case "FocusedSearchRunSnapshot":
    case "SearchRunSnapshot":
      return {
        query: content.query ?? null,
        provider: content.provider ?? null,
        executionStatus: content.executionStatus ?? null,
        resultCount: content.resultCount ?? 0,
        totalResultCount: content.totalResultCount ?? content.resultCount ?? 0,
        executedAt: content.executedAt ?? null,
        records: asArray(content.records),
        limitation: content.limitation ?? null,
      };
    case "EvidenceDrivenOutline":
      return {
        sections: asArray(content.sections).map((section) => ({
          title: section.title,
          purpose: section.purpose,
          claimIds: asArray(section.claimIds),
          supportingEvidenceIds: asArray(section.supportingEvidenceIds),
          limitations: asArray(section.limitations),
        })),
        excludedTopics: asArray(content.excludedTopics),
      };
    case "FrozenWritingPlan":
      return {
        claimUnitPlans: asArray(content.claimUnitPlans),
        excludedTopics: asArray(content.excludedTopics),
        approvedBy: content.approvedBy ?? null,
        approvedAt: content.approvedAt ?? null,
      };
    case "ManuscriptDraft":
    case "AuditedManuscript":
      return {
        title: content.title,
        abstract: content.abstract,
        sections: asArray(content.sections),
        conclusion: content.conclusion,
        limitations: asArray(content.disclosedLimitations ?? content.limitations),
        auditVerdict: content.auditVerdict ?? null,
      };
    case "EvidenceVerificationReport":
      return {
        verdict: content.verdict,
        verifierId: content.verifierId,
        limitations: asArray(content.limitations),
        conclusionCardIds: asArray(content.conclusionCardIds),
      };
    case "ManuscriptAudit":
      return {
        verdict: content.verdict,
        auditorId: content.auditorId,
        findings: asArray(content.findings),
        disclosedLimitations: asArray(content.disclosedLimitations),
        rightsChecks: asArray(content.rightsChecks),
      };
    case "DeliveryBundle":
      return {
        authorSignoffStatus: context.signedDelivery ? "signed" : content.authorSignoffStatus,
        authorSignoffReason:
          context.signedDelivery?.content?.reason ?? context.authorApproval?.content?.reason ?? null,
        authorSignoffAt: context.signedDelivery?.producedAt ?? null,
        limitations: asArray(content.limitations),
        exports: asArray(content.exports),
        manifestHash: content.manifestHash,
      };
    case "AuthorApproval":
    case "SignedDelivery":
      return { ...content };
    default:
      return {};
  }
}

function readableBodyFor(artifact, details) {
  const content = artifact.content ?? {};
  switch (artifact.type) {
    case "ResearchConclusionCard":
      return firstText(content.claim, "当前尚未形成可读结论。");
    case "LiteratureLandscape":
      return `当前 ${content.sourceCount ?? 0} 条来源中，${content.taggedSourceCount ?? 0} 条进入至少一个启发式标签，${content.unclassifiedSourceCount ?? 0} 条未分类（${Math.round((content.unclassifiedRate ?? 0) * 100)}%）；登记 ${asArray(content.controversies).length} 个待复核争议。`;
    case "ClusterMap":
      return asArray(content.clusters).map((cluster) => `${cluster.label}：${cluster.sourceCount} 条来源（可与其他组重叠）`).join("\n") || "当前没有形成规则分组。";
    case "TagAssignment":
      return `${content.sourceRef?.title ?? content.sourceId ?? "当前来源"}：${asArray(content.tags).map((tag) => tag.label).join("、")}`;
    case "UnclassifiedBucket":
      return content.sourceCount > 0
        ? `${content.sourceCount} 条来源尚未分类，需逐条补读、补规则或明确保留未分类。`
        : "当前没有未分类来源；这不代表标签已经具有科学完备性。";
    case "IdeaCandidate":
      return `候选锚点：${content.anchor?.label ?? "待明确"}。${content.relationshipRationale ?? "尚未说明关系依据。"}`;
    case "IdeaDecisionLedger":
      return `研究者已留下 ${asArray(content.entries).length} 条候选取舍记录，仍有 ${asArray(content.pendingCandidateIds).length} 个候选待决定。`;
    case "EvidenceRecord":
      return asArray(content.extractedFacts).join("\n\n") || "当前来源尚未提取出可核查事实。";
    case "CounterevidenceRegister":
      return asArray(content.counterevidence).join("\n\n") || firstText(content.limitation, "当前未登记反证；这不等于反证不存在。");
    case "CoverageGapRegister":
      return asArray(content.gaps).map((gap) => `- ${gap}`).join("\n") || "当前未登记证据缺口。";
    case "FrozenSearchProtocol":
    case "FrozenOrientationSearchProtocol":
      return [
        content.query && `检索问题：${content.query}`,
        content.accessPolicy && `访问规则：${content.accessPolicy}`,
        content.stopRule && `停止规则：${content.stopRule}`,
      ].filter(Boolean).join("\n");
    case "FocusedSearchRunSnapshot":
    case "SearchRunSnapshot":
      return `本轮实际得到 ${content.resultCount ?? 0} 条结果。${content.limitation ?? ""}`.trim();
    case "LibraryManifest":
      return `本轮文献库共 ${content.sourceCount ?? 0} 条来源。`;
    case "EvidenceDrivenOutline":
      return asArray(content.sections).map((section) => `${section.title}\n${section.purpose}`).join("\n\n");
    case "FrozenWritingPlan":
      return `已确认 ${asArray(content.claimUnitPlans).length} 个写作单元。`;
    case "ManuscriptDraft":
    case "AuditedManuscript":
      return manuscriptToMarkdown(content);
    case "EvidenceVerificationReport":
      return `独立证据核查结果：${content.verdict ?? "待确认"}。${asArray(content.limitations).join("；")}`;
    case "ManuscriptAudit":
      return `全文科研审计结果：${content.verdict ?? "待确认"}。发现 ${asArray(content.findings).length} 项问题。`;
    case "DeliveryBundle":
      return `已登记 ${asArray(content.exports).length} 种交付格式；作者签署状态：${details.authorSignoffStatus === "signed" ? "已由研究者确认" : "待确认"}。`;
    default:
      return firstText(content.summary, content.description, "内容已保存，可展开查看结构化详情。");
  }
}

function titleFor(artifact, context) {
  const content = artifact.content ?? {};
  const source = context.sourceById.get(content.sourceId);
  const titles = {
    LiteratureLandscape: "当前文献地形总览",
    ClusterMap: "可重叠文献分组",
    TagAssignment: source?.title ? `来源标签：${source.title}` : "单篇来源标签",
    UnclassifiedBucket: "未分类来源桶",
    IdeaCandidate: content.anchor?.label ? `候选方向：${content.anchor.label}` : "待验证候选方向",
    IdeaDecisionLedger: "候选方向取舍账本",
    ResearchConclusionCard: "当前研究结论",
    EvidenceRecord: source?.title ? `来源证据：${source.title}` : "逐篇来源证据",
    CounterevidenceRegister: "反证与不一致结果",
    CoverageGapRegister: "仍需补齐的证据缺口",
    LibraryManifest: "本轮文献库范围",
    FrozenSearchProtocol: "正式检索方案",
    FrozenOrientationSearchProtocol: "领域探索检索方案",
    FocusedSearchRunSnapshot: "精准检索实际运行结果",
    SearchRunSnapshot: "领域试检实际运行结果",
    EvidenceDrivenOutline: "证据驱动的论文结构",
    FrozenWritingPlan: "研究者已确认的写作计划",
    ManuscriptDraft: content.title ? `${content.title}（候选稿）` : "全文候选稿",
    AuditedManuscript: content.title ? `${content.title}（经审计稿）` : "经审计的全文",
    EvidenceVerificationReport: "研究结论独立核查",
    ManuscriptAudit: "全文科研审计",
    DeliveryBundle: "科研成果交付包",
    AuthorApproval: "作者责任确认",
    SignedDelivery: "作者签署版本",
  };
  return titles[artifact.type] ?? "科研产物";
}

function groupFor(type) {
  if (type === "ResearchConclusionCard") return "conclusions";
  if (["LiteratureLandscape", "ClusterMap", "TagAssignment", "UnclassifiedBucket", "IdeaCandidate", "IdeaDecisionLedger", "EvidenceRecord", "CounterevidenceRegister", "CoverageGapRegister"].includes(type)) return "evidence";
  if (["LibraryManifest", "FrozenSearchProtocol", "FrozenOrientationSearchProtocol", "FocusedSearchRunSnapshot", "SearchRunSnapshot"].includes(type)) return "methods";
  if (["EvidenceDrivenOutline", "FrozenWritingPlan", "ManuscriptDraft", "AuditedManuscript"].includes(type)) return "writing";
  return "quality";
}

function outputActions(
  artifact,
  projectId,
  hasAuditedManuscript,
  hasSignedManifest,
  contentMaturity = null,
  runtimeProvenance = null,
) {
  const base = `/api/research/projects/${encodeURIComponent(projectId)}/exports`;
  if (!hasSignedManifest) return [];
  if (artifact.type === "AuditedManuscript") {
    const formal =
      contentMaturity?.formalResearchComplete === true &&
      projectRuntimeProvenanceAllowsFormal(runtimeProvenance, { projectId });
    return [{
      id: formal ? "download_markdown" : "download_restricted_markdown",
      label: formal ? "下载正式 Markdown 正文" : "下载受限草稿（Markdown）",
      method: "GET",
      href: `${base}/${formal ? "manuscript.md" : "restricted-draft.md"}`,
      mediaType: "text/markdown",
    }];
  }
  if (artifact.type === "DeliveryBundle" && hasAuditedManuscript) {
    return [
      { id: "download_research_bundle", label: "下载可追溯研究包（JSON）", method: "GET", href: `${base}/research-bundle.json`, mediaType: "application/json" },
      { id: "download_references", label: "下载参考文献（BibTeX）", method: "GET", href: `${base}/references.bib`, mediaType: "application/x-bibtex" },
    ];
  }
  return [];
}

function selectedArtifacts(artifacts) {
  const current = asArray(artifacts).filter(
    (artifact) =>
      artifact.freshness !== "stale" &&
      !["rejected", "superseded"].includes(artifact.status),
  );
  const selected = [];
  const add = (artifact) => artifact && !selected.some((item) => item.id === artifact.id) && selected.push(artifact);
  current.filter((artifact) => artifact.type === "ResearchConclusionCard").forEach(add);
  add(latest(current, "LiteratureLandscape"));
  add(latest(current, "ClusterMap"));
  current.filter((artifact) => artifact.type === "TagAssignment").forEach(add);
  add(latest(current, "UnclassifiedBucket"));
  current.filter((artifact) => artifact.type === "IdeaCandidate").forEach(add);
  add(latest(current, "IdeaDecisionLedger"));
  current.filter((artifact) => artifact.type === "EvidenceRecord").forEach(add);
  add(latest(current, "CounterevidenceRegister"));
  add(latest(current, "CoverageGapRegister"));
  add(latest(current, "LibraryManifest"));
  add(latest(current, "FrozenSearchProtocol") ?? latest(current, "FrozenOrientationSearchProtocol"));
  add(latest(current, "FocusedSearchRunSnapshot") ?? latest(current, "SearchRunSnapshot"));
  add(latest(current, "EvidenceDrivenOutline"));
  add(latest(current, "FrozenWritingPlan"));
  add(latest(current, "AuditedManuscript") ?? latest(current, "ManuscriptDraft"));
  add(latest(current, "EvidenceVerificationReport"));
  add(latest(current, "ManuscriptAudit"));
  add(latest(current, "DeliveryBundle"));
  return selected;
}

export function manuscriptToMarkdown(content = {}) {
  const lines = [`# ${firstText(content.title, "科研综述")}`, ""];
  if (content.abstract) lines.push("## 摘要", "", content.abstract, "");
  for (const section of asArray(content.sections)) {
    lines.push(`## ${firstText(section.title, "正文")}`, "", firstText(section.content, "") ?? "", "");
  }
  if (content.conclusion) lines.push("## 结论", "", content.conclusion, "");
  const limitations = asArray(content.disclosedLimitations ?? content.limitations);
  if (limitations.length > 0) {
    lines.push("## 研究边界与限制", "", ...limitations.map((item) => `- ${item}`), "");
  }
  return `${lines.join("\n").trim()}\n`;
}

function bibtexEscape(value) {
  return String(value ?? "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

export function projectSourcesToBibtex(project = {}) {
  const entries = asArray(project.sourceMaterials).map((source, index) => {
    const key = `pubmed${source.pmid ?? source.locator?.pmid ?? index + 1}`;
    const fields = [
      `  title = {${bibtexEscape(source.title || "题名未返回")}}`,
      source.journal ? `  journal = {${bibtexEscape(source.journal)}}` : null,
      source.year ? `  year = {${bibtexEscape(source.year)}}` : null,
      source.doi || source.locator?.doi
        ? `  doi = {${bibtexEscape(source.doi ?? source.locator.doi)}}`
        : null,
      source.pmid || source.locator?.pmid
        ? `  pmid = {${bibtexEscape(source.pmid ?? source.locator.pmid)}}`
        : null,
      source.locator?.url ? `  url = {${bibtexEscape(source.locator.url)}}` : null,
      `  note = {访问层级：${bibtexEscape(source.accessLevel || "unknown")}}`,
    ].filter(Boolean);
    return `@article{${key},\n${fields.join(",\n")}\n}`;
  });
  return entries.length > 0 ? `${entries.join("\n\n")}\n` : "";
}

export function sha256ExportBytes(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  return createHash("sha256").update(bytes).digest("hex");
}

function exportFile({ id, role, format, fileName, mediaType, body }) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
  return Object.freeze({
    id,
    role,
    format,
    fileName,
    mediaType,
    body: bytes.toString("utf8"),
    byteLength: bytes.byteLength,
    contentHash: sha256ExportBytes(bytes),
  });
}

/**
 * Legacy preview helper retained for compatibility and unit-level rendering.
 * It is not an export authority. Production callers must serve only bytes from
 * the persisted ExportManifest via export-authority-v1.js.
 */
export function buildResearchExportSet({
  project,
  artifacts,
  contentMaturity = null,
  runtimeProvenance = null,
  humanDecisions = [],
  auditVersion = null,
} = {}) {
  const audited = latest(artifacts, "AuditedManuscript");
  const manuscript = audited ?? latest(artifacts, "ManuscriptDraft");
  const delivery = latest(artifacts, "DeliveryBundle");
  const signed = latest(artifacts, "SignedDelivery");
  const formal = Boolean(
      contentMaturity?.formalResearchComplete === true &&
      projectRuntimeProvenanceAllowsFormal(runtimeProvenance, {
        projectId: project?.id,
      }) &&
      audited &&
      delivery &&
      signed,
  );
  const files = [];
  if (manuscript) {
    const warning = formal
      ? ""
      : [
          "# 受限研究草稿｜不可作为正式签署版本",
          "",
          `> 内容等级：${contentMaturity?.label ?? "受限研究产物"}`,
          `> 使用边界：${contentMaturity?.boundary ?? "尚未同时完成正式模型运行、全文审计与作者签署。"}`,
          "",
        ].join("\n");
    files.push(
      exportFile({
        id: formal ? "manuscript" : "restricted-draft",
        role: formal ? "formal_manuscript" : "restricted_manuscript",
        format: "markdown",
        fileName: formal ? "audited-manuscript.md" : "restricted-draft.md",
        mediaType: "text/markdown",
        body: `${warning}${manuscriptToMarkdown(manuscript.content)}`,
      }),
    );
  }
  const bibtex = projectSourcesToBibtex(project);
  if (bibtex) {
    files.push(
      exportFile({
        id: "references",
        role: "references",
        format: "bibtex",
        fileName: "references.bib",
        mediaType: "application/x-bibtex",
        body: bibtex,
      }),
    );
  }

  const bundle = {
    ...buildResearchBundle({ project, artifacts, contentMaturity, runtimeProvenance }),
    schemaVersion: "1.1.0",
    auditVersion,
    formalResearchComplete: formal,
    signedDeliveryId: signed?.id ?? null,
    humanDecisions: asArray(humanDecisions),
    limitations: [
      contentMaturity?.boundary,
      ...asArray(delivery?.content?.limitations),
    ].filter(Boolean),
    exportManifest: {
      schemaVersion: "1.0.0",
      artifactId: delivery?.id ?? null,
      artifactManifestHash: delivery?.content?.manifestHash ?? null,
      artifactFingerprints: delivery?.content?.artifactFingerprints ?? [],
      files: files.map(({ id, role, format, fileName, mediaType, byteLength, contentHash }) => ({
        id,
        role,
        format,
        fileName,
        mediaType,
        byteLength,
        contentHash,
      })),
    },
  };
  const jsonBody = `${JSON.stringify(bundle, null, 2)}\n`;
  files.push(
    exportFile({
      id: "research-bundle",
      role: "machine_readable_research_bundle",
      format: "json",
      fileName: "research-bundle.json",
      mediaType: "application/json",
      body: jsonBody,
    }),
  );
  const manifest = {
    schemaVersion: "1.0.0",
    projectId: project?.id ?? null,
    generatedAt: bundle.generatedAt,
    formalResearchComplete: formal,
    files: files.map(({ id, role, format, fileName, mediaType, byteLength, contentHash }) => ({
      id,
      role,
      format,
      fileName,
      mediaType,
      byteLength,
      contentHash,
    })),
  };
  return Object.freeze({
    formalResearchComplete: formal,
    files: Object.freeze(files),
    manifest: Object.freeze({
      ...manifest,
      manifestHash: sha256ExportBytes(`${JSON.stringify(manifest, null, 2)}\n`),
    }),
  });
}

export function buildResearchOutputProjection({
  project,
  artifacts,
  contentMaturity = null,
  runtimeProvenance = null,
}) {
  const sourceMaterials = asArray(project?.sourceMaterials);
  const sourceById = new Map(sourceMaterials.map((source) => [source.id, source]));
  const appraisalBySourceId = new Map(
    asArray(artifacts)
      .filter((artifact) => artifact.type === "AppraisalRecord")
      .map((artifact) => [artifact.content?.sourceId, artifact]),
  );
  const context = {
    sourceById,
    appraisalBySourceId,
    authorApproval: latest(artifacts, "AuthorApproval"),
    signedDelivery: latest(artifacts, "SignedDelivery"),
  };
  const chosen = selectedArtifacts(artifacts);
  const hasAuditedManuscript = chosen.some((artifact) => artifact.type === "AuditedManuscript");
  const hasSignedManifest = Boolean(
    latest(artifacts, "ExportManifest") &&
      latest(artifacts, "AuthorApproval") &&
      latest(artifacts, "SignedDelivery"),
  );
  const items = chosen.map((artifact) => {
    const details = detailsFor(artifact, context);
    const actions = outputActions(
      artifact,
      project.id,
      hasAuditedManuscript,
      hasSignedManifest,
      contentMaturity,
      runtimeProvenance,
    );
    return {
      id: artifact.id,
      type: artifact.type,
      visibility: "research_output",
      groupId: groupFor(artifact.type),
      title: titleFor(artifact, context),
      purpose: OUTPUT_PURPOSES[artifact.type],
      status: statusView(artifact),
      summary: readableBodyFor(artifact, details).split("\n").find(Boolean) ?? "内容已保存。",
      readableBody: readableBodyFor(artifact, details),
      details,
      traceability: artifactTraceability(artifact, sourceMaterials),
      actions,
      downloadUrl: actions[0]?.href ?? null,
    };
  });
  const groups = OUTPUT_GROUPS.map((group) => ({
    ...group,
    items: items.filter((item) => item.groupId === group.id),
  })).filter((group) => group.items.length > 0);
  const internalArtifacts = asArray(artifacts).filter(
    (artifact) => !chosen.some((item) => item.id === artifact.id),
  );
  const typeCounts = internalArtifacts.reduce((counts, artifact) => {
    counts[artifact.type] = (counts[artifact.type] ?? 0) + 1;
    return counts;
  }, {});
  return {
    groups,
    items,
    usableArtifacts: items.filter((item) => item.actions.length > 0),
    internalWorkflow: {
      count: internalArtifacts.length,
      hiddenByDefault: true,
      description: "这些对象用于状态机依赖、Agent 工作单、人工门禁和重启恢复，不属于科研人员的主要阅读成果。",
      typeCounts,
    },
  };
}

export function buildResearchBundle({
  project,
  artifacts,
  contentMaturity = null,
  runtimeProvenance = null,
}) {
  const projection = buildResearchOutputProjection({
    project,
    artifacts,
    contentMaturity,
    runtimeProvenance,
  });
  const signedDelivery = latest(artifacts, "SignedDelivery");
  const delivery = latest(artifacts, "DeliveryBundle");
  const manuscript = latest(artifacts, "AuditedManuscript");
  const generatedAt =
    signedDelivery?.producedAt ?? delivery?.producedAt ?? manuscript?.producedAt ?? null;
  const retrievalRuns = formalRetrievalRuns(project);
  const latestRetrieval = retrievalRuns.at(-1) ?? null;
  const preview = project?.retrievalRuns?.previewSelection ?? null;
  const legacy = project?.retrievalRuns?.legacyBootstrap ?? null;
  return {
    schemaVersion: "1.0.0",
    // Stable artifact time, not the HTTP request time. Repeated downloads of
    // the same version therefore serialize to the same research package.
    generatedAt,
    project: {
      id: project.id,
      title: project.title,
      question: project.question,
      constraints: asArray(project.constraints),
      researchMode: project.researchMode ?? "guided_materials",
      searchQuery: project.searchQuery ?? null,
    },
    retrieval: latestRetrieval ? retrievalRunBundleView(latestRetrieval) : null,
    retrievalRuns: retrievalRuns.map(retrievalRunBundleView),
    retrievalAuthority: {
      requiredPurposes: FORMAL_RETRIEVAL_PURPOSES,
      finalLibraryReady: Boolean(project?.retrievalRuns?.finalLibrary),
      previewSelection: preview
        ? {
            candidateId: preview.candidateId ?? null,
            candidateStatus: preview.candidateStatus ?? null,
            query: preview.query ?? null,
            total: preview.total ?? null,
            executedAt: preview.executedAt ?? null,
            planHash: preview.planHash ?? null,
            selectionHash: preview.selectionHash ?? null,
            sampledCount: asArray(preview.samples).length,
            boundary: "建项前预检只用于确认问题和检索表达，不进入正式文献库。",
          }
        : null,
      legacyBootstrap: legacy?.receipt
        ? {
            authority: legacy.authority ?? "legacy_single_receipt",
            receiptHash: legacy.receipt.receiptHash ?? null,
            reusableForFormalNodes: [],
            boundary: "历史单次检索仅供追溯，不能证明分阶段真实检索。",
          }
        : null,
    },
    sources: asArray(project.sourceMaterials).map((source) => ({
      id: source.id,
      provider: source.provider ?? null,
      pmid: source.pmid ?? source.locator?.pmid ?? null,
      doi: source.doi ?? source.locator?.doi ?? null,
      title: source.title ?? null,
      abstract: source.abstract ?? source.text ?? null,
      journal: source.journal ?? null,
      year: source.year ?? null,
      accessLevel: source.accessLevel ?? "unknown",
      locator: source.locator ?? null,
      sourceSnapshotHash: source.sourceSnapshotHash ?? null,
      limitations: asArray(source.limitations),
    })),
    contentMaturity,
    runtimeProvenance,
    researchOutputs: projection.groups.map((group) => ({
      id: group.id,
      label: group.label,
      description: group.description,
      items: group.items.map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        purpose: item.purpose,
        status: item.status,
        readableBody: item.readableBody,
        details: item.details,
        traceability: item.traceability,
      })),
    })),
    internalWorkflow: projection.internalWorkflow,
  };
}

export function isResearchOutputType(type) {
  return RESEARCH_OUTPUT_TYPES.has(type);
}
