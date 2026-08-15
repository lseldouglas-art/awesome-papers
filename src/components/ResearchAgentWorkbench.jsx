import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import evidenceFirefly from "../assets/evidence-firefly-v1.png";
import {
  buildResearchWorkbenchCreatePayload,
  normalizeResearchQuestionInput,
  researchQuestionCanPreview,
  researchWorkbenchRetrievalDisplay,
} from "../research-agent-workbench-model.js";
import "../research-agent-workbench.css";

const RESEARCH_PHASES = Object.freeze([
  {
    id: "question_formation",
    label: "问题成形",
    meaning: "把想法变成可检验、可负责的研究问题。",
  },
  {
    id: "literature_research",
    label: "文献调研",
    meaning: "用真实检索划清证据边界。",
  },
  {
    id: "argument_design",
    label: "论证结构",
    meaning: "让论点从已核查证据中生长出来。",
  },
  {
    id: "writing_and_verification",
    label: "写作与核查",
    meaning: "逐条写作，并验证来源能否支持主张。",
  },
  {
    id: "delivery",
    label: "定稿交付",
    meaning: "完成审计、冻结版本并交付。",
  },
]);

const WORKBENCH_TABS = Object.freeze([
  { id: "task", label: "当前任务" },
  { id: "evidence", label: "科研成果" },
  { id: "writing", label: "写作核查" },
  { id: "records", label: "研究记录" },
]);

const COMPLETION_PROFILES = Object.freeze([
  {
    id: "evidence_brief",
    label: "研究判断",
    description: "完成检索、证据提取与独立核查后停止，适合先回答一个问题。",
    terminalPhaseIndex: 1,
  },
  {
    id: "evidence_outline",
    label: "证据提纲",
    description: "在研究判断上继续形成经压力测试的论证结构。",
    terminalPhaseIndex: 2,
  },
  {
    id: "audited_review",
    label: "经审计综述",
    description: "继续逐句写作、全文审计和作者签署，流程最长。",
    terminalPhaseIndex: 4,
  },
]);

const CATEGORY_PREVIEW_LIMIT = 4;
const EVIDENCE_PREVIEW_LIMIT = 6;

const RESEARCH_RESULT_CATEGORIES = Object.freeze([
  {
    id: "question",
    label: "研究问题与方案",
    description: "研究问题、纳入范围与最终采用的研究方向。",
    empty: "问题澄清完成后，这里会出现可直接复核的研究问题与范围。",
    aliases: ["question", "scope", "question_formation", "research_question"],
    types: [
      "FocusedResearchBrief",
      "ResearchBrief",
      "ScopeBoundary",
      "ReviewAngleCandidate",
      "LandscapeProfile",
      "ResearchQuestionCandidate",
      "ResearchIntent",
    ],
  },
  {
    id: "search",
    label: "检索过程与文献库",
    description: "区分试检、领域宽检索、聚焦校准和最终冻结文献库，并保留每轮真实回执。",
    empty: "检索真正运行并冻结文献库后，这里会留下策略与文献清单。",
    aliases: ["search", "literature", "protocol", "library", "retrieval"],
    types: [
      "FrozenSearchProtocol",
      "LibraryManifest",
      "FocusedSearchRunSnapshot",
      "FocusedCalibrationReport",
      "FocusedSearchProtocol",
      "OrientationCorpusManifest",
      "OrientationSourceSnapshot",
      "FrozenOrientationSearchProtocol",
      "SearchRunSnapshot",
      "OrientationCalibrationReport",
      "OrientationSearchProtocol",
      "FocusedConceptMatrix",
      "OrientationConceptMatrix",
      "SourceSnapshot",
    ],
  },
  {
    id: "evidence",
    label: "证据表与质量评价",
    description: "逐篇提取的事实、访问层级、质量判断与证据边界。",
    empty: "进入证据提取后，这里会出现逐篇证据表和质量评价。",
    aliases: ["evidence", "appraisal", "source", "quality"],
    types: [
      "EvidenceRecord",
      "AppraisalRecord",
      "EvidenceVerificationReport",
      "ClaimVerificationResult",
    ],
  },
  {
    id: "findings",
    label: "结论、反证与缺口",
    description: "主张能否成立、哪些证据反对它，以及下一步还缺什么。",
    empty: "完成证据综合后，这里会显示受限结论、反证与研究缺口。",
    aliases: ["finding", "findings", "synthesis", "argument", "conclusion"],
    types: [
      "ResearchConclusionCard",
      "ClaimEvidenceMap",
      "CounterevidenceRegister",
      "CoverageGapRegister",
      "EvidenceDrivenOutline",
      "OutlineStressTest",
      "FrozenWritingPlan",
    ],
  },
  {
    id: "manuscript",
    label: "稿件与科研审计",
    description: "已核查的写作单元、全文、审计结果与最终交付版本。",
    empty: "进入写作期后，这里会出现经核查的稿件和科研审计结果。",
    aliases: ["writing", "manuscript", "delivery", "audit", "publication"],
    types: [
      "AuditedManuscript",
      "ManuscriptAudit",
      "ManuscriptDraft",
      "AcceptedClaimUnit",
      "DeliveryBundle",
      "ExportManifest",
      "SignedDelivery",
    ],
  },
]);

const RESEARCH_ARTIFACT_LABELS = Object.freeze({
  ResearchIntent: "初始研究意图",
  ResearchQuestionCandidate: "候选研究问题",
  ScopeBoundary: "研究范围",
  ResearchBrief: "研究方案",
  FocusedResearchBrief: "聚焦研究方案",
  ReviewAngleCandidate: "候选研究方向",
  LandscapeProfile: "领域证据概况",
  OrientationConceptMatrix: "宽检索概念表",
  OrientationSearchProtocol: "宽检索策略",
  SearchRunSnapshot: "宽检索结果",
  OrientationCalibrationReport: "宽检索校准结果",
  FrozenOrientationSearchProtocol: "已确认的宽检索策略",
  OrientationCorpusManifest: "领域文献清单",
  OrientationSourceSnapshot: "领域来源内容",
  FocusedConceptMatrix: "精准检索概念表",
  FocusedSearchProtocol: "精准检索策略",
  FocusedSearchRunSnapshot: "精准检索结果",
  FocusedCalibrationReport: "精准检索校准结果",
  FrozenSearchProtocol: "最终检索策略",
  LibraryManifest: "纳入文献清单",
  SourceSnapshot: "来源内容",
  EvidenceRecord: "逐篇证据提取表",
  AppraisalRecord: "证据质量评价",
  EvidenceVerificationReport: "独立证据核查",
  ClaimVerificationResult: "逐句引用核查",
  CounterevidenceRegister: "反证清单",
  CoverageGapRegister: "证据缺口清单",
  ClaimEvidenceMap: "主张与证据对应表",
  ResearchConclusionCard: "主要研究结论",
  EvidenceDrivenOutline: "证据驱动的论证结构",
  OutlineStressTest: "论证结构压力测试",
  FrozenWritingPlan: "已确认的写作计划",
  AcceptedClaimUnit: "已核查的写作单元",
  ManuscriptDraft: "全文候选稿",
  ManuscriptAudit: "全文科研审计",
  AuditedManuscript: "经审计的全文",
  DeliveryBundle: "交付研究包",
  ExportManifest: "交付文件清单",
  SignedDelivery: "作者确认版本",
});

const RESEARCH_ARTIFACT_PURPOSES = Object.freeze({
  ResearchIntent: "记录研究目标、约束和预期交付，防止后续任务悄悄变题。",
  ResearchQuestionCandidate: "供研究者比较并选择一个可检验、无预设结论的问题。",
  ScopeBoundary: "明确纳入什么、排除什么，避免检索和论证无限扩张。",
  ResearchBrief: "冻结已经批准的研究问题、范围和研究责任。",
  FocusedResearchBrief: "把领域探索收束为真正值得深入核查的方向。",
  LandscapeProfile: "说明当前领域有哪些证据、争议和可行切口。",
  FrozenSearchProtocol: "保存可复现的数据库、检索式、时间范围和停止规则。",
  LibraryManifest: "列出实际纳入的文献及其访问层级，便于复核和补全文。",
  EvidenceRecord: "逐篇保存可以从来源中直接提取的事实，并标明未知信息。",
  AppraisalRecord: "评价每篇证据的研究设计、偏倚风险和可用边界。",
  EvidenceVerificationReport: "由独立角色检查证据综合是否越过来源能够支持的范围。",
  CounterevidenceRegister: "主动保存与主要判断不一致的证据，降低选择性引用风险。",
  CoverageGapRegister: "指出现有材料没有回答的问题，形成下一轮检索或实验计划。",
  ClaimEvidenceMap: "让每条核心主张都能回到支持证据、反证和限制。",
  ResearchConclusionCard: "给出带置信度、证据边界和下一问题的受限科研判断。",
  EvidenceDrivenOutline: "按证据强弱组织论证，不让写作先于证据。",
  OutlineStressTest: "检查论证结构是否遗漏反证、过度外推或混淆事实与解释。",
  FrozenWritingPlan: "冻结允许写入全文的主张与排除主题。",
  AcceptedClaimUnit: "保存经过逐句来源核查并由研究者接受的写作内容。",
  ManuscriptDraft: "把已接受的写作单元组合为候选全文，不额外创造事实。",
  ManuscriptAudit: "检查全文的来源支持、限制披露、权利和未解决问题。",
  AuditedManuscript: "保存通过科研审计并明确披露边界的正式全文。",
  DeliveryBundle: "绑定唯一全文、审计结果和限制，形成可追溯的交付版本。",
  ExportManifest: "说明交付包应包含哪些文件和版本。",
  SignedDelivery: "记录作者最终确认的唯一交付版本。",
});

const RESEARCH_FIELD_LABELS = Object.freeze({
  question: "研究问题",
  researchQuestion: "研究问题",
  intendedDeliverable: "预期交付",
  constraints: "研究约束",
  materialCount: "已有材料数",
  inScope: "纳入范围",
  outOfScope: "排除范围",
  avoidsPresetConclusion: "是否避免预设结论",
  query: "实际检索式",
  dataSources: "检索来源",
  accessPolicy: "全文访问规则",
  stopRule: "停止规则",
  executionStatus: "运行状态",
  provider: "实际数据来源",
  resultCount: "检索结果数",
  records: "检索到的材料",
  sourceCount: "纳入文献数",
  accessCounts: "访问层级统计",
  frozen: "是否已冻结",
  abstract: "摘要内容",
  text: "来源内容",
  accessLevel: "访问层级",
  accessLabel: "实际访问层级",
  extractedFacts: "直接提取的事实",
  relation: "与研究问题的关系",
  relationLabel: "与研究问题的关系",
  appraisal: "质量评价",
  riskFlags: "偏倚或风险提示",
  counterevidence: "反证",
  gaps: "证据缺口",
  claims: "核心主张",
  claim: "受限结论",
  confidence: "结论置信度",
  accessBoundary: "证据访问边界",
  scope: "结论适用范围",
  supportingEvidenceIds: "支持证据",
  counterEvidenceIds: "反对证据",
  uncertainties: "不确定性",
  nextQuestion: "下一研究问题",
  findings: "核查发现",
  verdict: "核查结论",
  sections: "正文结构与内容",
  excludedTopics: "明确不写入的内容",
  claimUnitPlans: "写作单元计划",
  sentences: "逐句内容",
  sentenceResults: "逐句核查结果",
  conclusion: "全文结论",
  auditVerdict: "审计结论",
  disclosedLimitations: "已披露限制",
  newFactualClaims: "新增事实主张",
  rightsChecks: "权利检查",
  unresolvedIssueIds: "未解决问题",
  exports: "交付文件",
  authorSignoffStatus: "作者确认状态",
  status: "状态",
});

const INTERNAL_CONTENT_KEYS = new Set([
  "id",
  "artifactId",
  "artifactType",
  "projectId",
  "schemaVersion",
  "version",
  "createdAt",
  "producedAt",
  "producerId",
  "preparedBy",
  "auditorId",
  "verifierId",
  "draftProducerId",
  "manuscriptProducerId",
  "inputs",
  "inputArtifactRefs",
  "sourceRef",
  "locator",
  "sourceId",
  "sourceSnapshotHash",
  "contentHash",
  "manifestHash",
  "gateId",
  "gateFingerprint",
  "approvedInputArtifactIds",
  "artifactFingerprints",
  "questionId",
  "claimId",
  "claimUnitDraftId",
  "claimUnitPlanId",
  "writingPlanId",
  "outlineId",
  "outlineDecisionId",
  "outlineStressTestId",
  "verificationResultId",
  "sourceDraftId",
  "manuscriptDraftId",
  "manuscriptAuditId",
  "auditedManuscriptId",
  "acceptedClaimUnitIds",
  "checkedClaimUnitIds",
  "conclusionCardIds",
]);

const MULTI_ITEM_ARTIFACT_TYPES = new Set([
  "ResearchQuestionCandidate",
  "ReviewAngleCandidate",
  "EvidenceRecord",
  "AppraisalRecord",
  "AcceptedClaimUnit",
]);

const POLLING_STATUSES = new Set([
  "queued",
  "starting",
  "running",
  "resuming",
  "cancelling",
]);

const STATUS_LABELS = Object.freeze({
  created: "等待开始",
  idle: "可以继续",
  queued: "已进入队列",
  starting: "正在启动",
  running: "Agent 正在工作",
  awaiting_approval: "等待人工复核",
  awaiting_gate: "等待你的决定",
  awaiting_review: "等待人工复核",
  paused: "已暂停",
  resuming: "正在恢复",
  cancelling: "正在停止",
  cancelled: "已停止",
  failed: "需要处理",
  blocked: "需要处理",
  completed: "研究已完成",
});

const EVENT_LABELS = Object.freeze({
  work_order_created: "生成了本步工作单",
  work_order_queued: "本步工作单已排队",
  work_order_running: "正在处理本步工作单",
  work_order_started: "开始处理本步工作单",
  work_order_completed: "本步工作单已经完成",
  work_order_failed: "本步工作单处理失败",
  work_order_cancelled: "本步工作单已停止",
  run_created: "Agent 建立了一轮执行",
  run_running: "Agent 正在执行本轮任务",
  run_awaiting_approval: "本轮执行等待批准",
  run_started: "Agent 开始一轮执行",
  run_completed: "Agent 完成一轮执行",
  run_failed: "Agent 本轮执行失败",
  run_paused: "研究已暂停",
  run_resumed: "研究已恢复",
  run_cancelled: "当前执行已停止",
  tool_requested: "Agent 请求调用研究工具",
  tool_running: "研究工具正在运行",
  tool_awaiting_approval: "研究工具等待批准",
  tool_approved: "研究工具调用已批准",
  tool_started: "开始调用研究工具",
  tool_completed: "研究工具调用完成",
  tool_failed: "研究工具调用失败",
  tool_cancelled: "研究工具调用已停止",
  tool_denied: "研究工具调用未获批准",
  gate_opened: "到达人工决定点",
  gate_approved: "人工决定已批准",
  gate_amendment_requested: "人工要求修订",
  review_requested: "候选产物等待人工复核",
  review_accepted: "人工复核已接受",
  review_revision_requested: "人工复核要求修改",
});

const ACCESS_LABELS = Object.freeze({
  title_only: "仅题名",
  title_abstract: "题名与摘要",
  abstract_only: "摘要",
  full_text: "全文",
  full_text_and_supplement: "全文与补充材料",
  metadata_only: "仅题录",
  unknown: "访问层级未报告",
});

const RESEARCH_VALUE_LABELS = Object.freeze({
  bounded: "证据有限，仅支持受限判断",
  partial: "部分通过",
  pass: "通过",
  fail: "未通过",
  pending: "待确认",
  signed: "已由研究者确认",
  accepted: "研究者已确认",
  verified: "已独立核查",
  supports: "支持",
  partially_supports: "部分支持",
  contradicts: "反驳",
  context_only: "仅作背景",
  unclear: "关系尚不明确",
  abstract_only: "题名与摘要",
  title_abstract: "题名与摘要",
  title_only: "仅题名",
  metadata_only: "仅题录元数据",
  full_text: "已访问全文",
  full_text_and_supplement: "全文与补充材料",
  unknown: "未知",
  input_material_only: "仅处理用户提供材料",
  user_materials: "用户提供材料",
  completed: "已完成",
  blocked_no_source: "因缺少来源而停止",
  guided: "本地引导",
});

class ResearchApiError extends Error {
  constructor(message, { status = 0, code = "REQUEST_FAILED", payload = null } = {}) {
    super(message);
    this.name = "ResearchApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
    this.projectId = firstText(payload?.projectId, payload?.project?.id);
    this.project = payload?.project && typeof payload.project === "object" ? payload.project : null;
    this.recoverable = payload?.recoverable === true;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asCollection(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function firstText(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim();
}

function unwrapData(payload) {
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    Object.prototype.hasOwnProperty.call(payload, "data")
  ) {
    return payload.data;
  }
  return payload;
}

function projectId(project) {
  return firstText(project?.id, project?.projectId);
}

function projectFromPayload(payload) {
  const value = unwrapData(payload);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value.project && typeof value.project === "object" ? value.project : value;
}

function projectsFromPayload(payload) {
  const value = unwrapData(payload);
  if (Array.isArray(value)) return value;
  return asArray(value?.projects ?? value?.items);
}

function runtimeFromPayload(payload) {
  const value = unwrapData(payload);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value.runtime && typeof value.runtime === "object" ? value.runtime : value;
}

function projectStatus(project) {
  return (
    firstText(
      project?.status,
      project?.runtimeStatus,
      project?.projection?.status,
      project?.projection?.runtimeStatus,
      project?.currentRun?.status,
      project?.run?.status,
    )?.toLowerCase() ?? "created"
  );
}

function phaseIdForProject(project) {
  return firstText(
    project?.currentPhaseId,
    project?.phaseId,
    project?.currentPhase,
    project?.phase?.id,
    project?.currentNode?.phaseId,
    project?.currentTask?.phaseId,
    project?.state?.currentNode?.phaseId,
    project?.projection?.currentPhaseId,
    project?.projection?.phaseId,
    project?.projection?.currentNode?.phaseId,
  );
}

function phaseIndexForProject(project) {
  if (projectStatus(project) === "completed") {
    const profile = COMPLETION_PROFILES.find(
      (candidate) => candidate.id === project?.completionProfileId,
    );
    return profile ? profile.terminalPhaseIndex + 1 : RESEARCH_PHASES.length;
  }
  const phaseId = phaseIdForProject(project);
  const explicitIndex = RESEARCH_PHASES.findIndex((phase) => phase.id === phaseId);
  if (explicitIndex >= 0) return explicitIndex;

  const numericProgress = Number(project?.progress ?? project?.projection?.progress);
  if (Number.isFinite(numericProgress)) {
    const normalized = numericProgress > 1 ? numericProgress / 100 : numericProgress;
    return Math.min(
      RESEARCH_PHASES.length - 1,
      Math.max(0, Math.floor(normalized * RESEARCH_PHASES.length)),
    );
  }
  return 0;
}

function pendingGateForProject(project) {
  const direct = project?.pendingGate ?? project?.projection?.pendingGate ?? project?.gate;
  if (direct && ["pending", "open", "awaiting_decision"].includes(direct.status ?? "pending")) {
    return direct;
  }
  return asCollection(project?.gates ?? project?.state?.gates).find((gate) =>
    ["pending", "open", "awaiting_decision"].includes(gate?.status),
  );
}

function pendingReviewForProject(project) {
  const direct = project?.pendingReview ?? project?.projection?.pendingReview ?? project?.review;
  if (direct && ["pending", "open", "awaiting_review"].includes(direct.status ?? "pending")) {
    return direct;
  }
  return asCollection(project?.reviews ?? project?.state?.reviews).find((review) =>
    ["pending", "open", "awaiting_review"].includes(review?.status),
  );
}

function formatDate(value) {
  if (!value) return "时间未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatEventType(type) {
  if (!type) return "研究状态更新";
  return EVENT_LABELS[type] ?? "研究状态更新";
}

function safeExternalUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function artifactType(artifact) {
  return firstText(
    artifact?.type,
    artifact?.artifactType,
    artifact?.content?.artifactType,
  );
}

function researchCategoryForArtifact(artifact) {
  const category = firstText(
    artifact?.researchCategory,
    artifact?.category,
    artifact?.content?.researchCategory,
    artifact?.content?.category,
  )?.toLowerCase();
  const type = artifactType(artifact);
  return RESEARCH_RESULT_CATEGORIES.find((candidate) =>
    candidate.types.includes(type) ||
    candidate.aliases.some((alias) => category === alias || category?.includes(alias)),
  )?.id ?? null;
}

function artifactResearchTitle(artifact, fallbackIndex = 0) {
  const type = artifactType(artifact);
  const rawTitle = firstText(
    artifact?.researchTitle,
    artifact?.content?.researchTitle,
    artifact?.title,
    artifact?.label,
  );
  const genericTitle = rawTitle && type
    ? rawTitle.replaceAll(type, RESEARCH_ARTIFACT_LABELS[type] ?? "研究成果")
    : rawTitle;
  return firstText(RESEARCH_ARTIFACT_LABELS[type], genericTitle) ?? `研究成果 ${fallbackIndex + 1}`;
}

function artifactPurpose(artifact) {
  const content = artifact?.content ?? {};
  const type = artifactType(artifact);
  return firstText(
    artifact?.purpose,
    artifact?.researchPurpose,
    content?.purpose,
    content?.researchPurpose,
    RESEARCH_ARTIFACT_PURPOSES[type],
    artifact?.description,
    artifact?.summary,
    content?.description,
    content?.summary,
  ) ?? "保存当前研究步骤中可供研究者复核和复用的内容。";
}

function artifactSummary(artifact) {
  const content = artifact?.content ?? {};
  const type = artifactType(artifact);
  const summary = firstText(
    artifact?.detail,
    artifact?.summary,
    content?.detail,
    content?.conclusion,
    content?.claim,
    content?.summary,
    content?.question,
    content?.researchQuestion,
  );
  if (!summary) return artifactPurpose(artifact);
  return type ? summary.replaceAll(type, RESEARCH_ARTIFACT_LABELS[type] ?? "本研究成果") : summary;
}

function artifactLimitations(artifact) {
  const content = artifact?.content ?? {};
  const values = [
    artifact?.limitations,
    artifact?.limitation,
    artifact?.boundary,
    content?.limitations,
    content?.limitation,
    content?.boundaries,
    content?.uncertainties,
    content?.accessBoundary,
  ].flatMap((value) => asCollection(value));
  if (!values.length) {
    return firstText(
      artifact?.limitations,
      artifact?.limitation,
      content?.limitations,
      content?.limitation,
      content?.accessBoundary,
    ) ? [firstText(
      artifact?.limitations,
      artifact?.limitation,
      content?.limitations,
      content?.limitation,
      content?.accessBoundary,
    )] : [];
  }
  return [...new Set(values.map((value) => researchValueToText(value)).filter(Boolean))];
}

function artifactSources(artifact) {
  const content = artifact?.content ?? {};
  const materials = asCollection(
    artifact?.sources ??
    artifact?.sourceMaterials ??
    content?.sources ??
    content?.sourceMaterials ??
    content?.records,
  );
  const locators = asCollection(artifact?.sourceLinks ?? content?.sourceLinks);
  return [...materials, ...locators].map((source, index) => {
    if (typeof source === "string") return { id: `${source}-${index}`, title: source };
    return {
      ...source,
      id: firstText(source?.id, source?.sourceId, source?.pmid, source?.doi) ?? `source-${index}`,
      title: firstText(source?.title, source?.citation, source?.label, source?.sourceId) ?? `来源 ${index + 1}`,
      url: safeExternalUrl(source?.url ?? source?.sourceUrl ?? source?.locator?.url),
      accessLevel: firstText(source?.accessLevel, source?.access_level),
    };
  });
}

function researchValueToText(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") return RESEARCH_VALUE_LABELS[value] ?? value;
  if (["number", "bigint"].includes(typeof value)) return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => researchValueToText(item)).filter(Boolean).join("；");
  }
  if (typeof value === "object") {
    return firstText(value?.text, value?.claim, value?.title, value?.summary, value?.message, value?.rationale) ??
      Object.entries(value)
        .filter(([key]) => !INTERNAL_CONTENT_KEYS.has(key) && !/(^|_)id(s)?$/i.test(key))
        .map(([key, item]) => {
          const text = researchValueToText(item);
          if (!text) return "";
          const label = RESEARCH_FIELD_LABELS[key];
          return label ? `${label}：${text}` : text;
        })
        .filter(Boolean)
        .join("；");
  }
  return "";
}

function artifactDetailRows(artifact) {
  const detail = artifact?.detail;
  const content = detail && typeof detail === "object" && !Array.isArray(detail)
    ? detail
    : artifact?.content && typeof artifact.content === "object" && !Array.isArray(artifact.content)
      ? artifact.content
      : {};
  return Object.entries(content)
    .filter(([key, value]) =>
      !INTERNAL_CONTENT_KEYS.has(key) &&
      !/(^|_)id(s)?$/i.test(key) &&
      !["title", "summary", "description", "purpose", "researchPurpose", "limitations", "limitation", "boundaries", "sourceMaterials"].includes(key) &&
      researchValueToText(value),
    )
    .map(([key, value]) => ({
      key,
      label: RESEARCH_FIELD_LABELS[key] ?? "补充研究内容",
      value: ["supportingEvidenceIds", "counterEvidenceIds"].includes(key)
        ? `${asCollection(value).length} 条已绑定证据`
        : researchValueToText(value),
    }));
}

function artifactCopyText(artifact) {
  const title = artifactResearchTitle(artifact);
  const rows = artifactDetailRows(artifact);
  const limits = artifactLimitations(artifact);
  const sources = artifactSources(artifact);
  return [
    title,
    `用途：${artifactPurpose(artifact)}`,
    `摘要：${artifactSummary(artifact)}`,
    ...rows.map((row) => `${row.label}：${row.value}`),
    limits.length ? `限制：${limits.join("；")}` : null,
    sources.length ? `来源：${sources.map((source) => source.title).join("；")}` : null,
  ].filter(Boolean).join("\n\n");
}

function serverResearchCategories(project) {
  const outputs = project?.researchOutputs ?? project?.researchResults;
  if (!outputs) return [];
  const rawCategories = Array.isArray(outputs)
    ? outputs
    : Object.entries(outputs).map(([id, value]) => ({
        id,
        ...(Array.isArray(value) ? { items: value } : value),
      }));
  return rawCategories.flatMap((group, groupIndex) => {
    if (!group) return [];
    const rawId = firstText(group.id, group.category, group.key, group.slug)?.toLowerCase();
    const categoryId = rawId ?? RESEARCH_RESULT_CATEGORIES[groupIndex]?.id;
    const fallback = RESEARCH_RESULT_CATEGORIES[groupIndex];
    if (!fallback) return [];
    return [{
      ...fallback,
      id: categoryId,
      label: firstText(group.label, group.title, group.name) ?? fallback.label,
      description: firstText(group.description, group.purpose) ?? fallback.description,
      items: asCollection(group.items ?? group.outputs ?? group.results ?? group.artifacts ?? group),
    }];
  });
}

function researchOutputTitle(output, index = 0) {
  return firstText(output?.title, output?.label, output?.name) ?? artifactResearchTitle(output, index);
}

function researchOutputPurpose(output) {
  return firstText(output?.purpose, output?.researchPurpose, output?.description) ?? artifactPurpose(output);
}

function researchOutputSummary(output) {
  return firstText(output?.summary, output?.abstract, output?.readableBody) ?? artifactSummary(output);
}

function researchOutputLimitations(output) {
  const traceability = output?.traceability ?? {};
  const raw =
    output?.limitations ??
    output?.boundaries ??
    output?.details?.limitations ??
    output?.details?.disclosedLimitations ??
    output?.details?.uncertainties ??
    output?.details?.boundaries ??
    traceability?.limitations ??
    traceability?.boundaries;
  const values = asCollection(raw).map((value) => researchValueToText(value)).filter(Boolean);
  if (values.length) return values;
  const single = firstText(output?.limitation, output?.boundary, traceability?.limitation, traceability?.boundary);
  return single ? [single] : artifactLimitations(output);
}

function researchOutputSources(output) {
  const traceability = output?.traceability ?? {};
  const direct = output?.sources ?? traceability?.sources ?? traceability?.references ?? traceability?.materials;
  if (direct) {
    const resolved = artifactSources({ ...output, sources: direct });
    if (resolved.length) return resolved;
  }
  const sourceIds = asCollection(traceability?.sourceIds);
  if (sourceIds.length) {
    return sourceIds.map((sourceId, index) => ({
      id: `${index}-${String(sourceId)}`,
      title: `已绑定来源 ${index + 1}`,
      accessLevel: asArray(traceability?.accessLevels)[index],
    }));
  }
  const boundEvidenceCount = asCollection(output?.details?.supportingEvidenceIds).length;
  if (boundEvidenceCount > 0) {
    return [{
      id: "bound-evidence",
      title: `已绑定 ${boundEvidenceCount} 条证据；可在下方“实际使用的研究材料”逐条核对`,
    }];
  }
  return artifactSources(output);
}

function researchOutputDetailRows(output) {
  const details = output?.details;
  if (Array.isArray(details)) {
    return details.map((item, index) => {
      if (typeof item === "string") return { key: `detail-${index}`, label: "研究内容", value: item };
      return {
        key: firstText(item?.id, item?.key) ?? `detail-${index}`,
        label: firstText(item?.label, item?.title, item?.name) ?? "研究内容",
        value: researchValueToText(item?.value ?? item?.content ?? item?.text ?? item),
      };
    }).filter((item) => item.value);
  }
  if (details && typeof details === "object") {
    return Object.entries(details)
      .filter(([key]) =>
        !INTERNAL_CONTENT_KEYS.has(key) &&
        !/(^|_)id(s)?$/i.test(key) &&
        key !== "locator" &&
        key !== "limitations" &&
        key !== "disclosedLimitations" &&
        key !== "uncertainties" &&
        key !== "boundaries" &&
        !(key === "accessLevel" && details.accessLabel) &&
        !(key === "relation" && details.relationLabel),
      )
      .map(([key, value]) => ({
        key,
        label: RESEARCH_FIELD_LABELS[key] ?? "补充研究内容",
        value: ["supportingEvidenceIds", "counterEvidenceIds", "claimIds", "conclusionCardIds"].includes(key)
          ? `${asCollection(value).length} 条已绑定记录`
          : researchValueToText(value),
      }))
      .filter((item) => item.value);
  }
  return artifactDetailRows(output);
}

function researchOutputCopyText(output) {
  const rows = researchOutputDetailRows(output);
  const limits = researchOutputLimitations(output);
  const sources = researchOutputSources(output);
  return [
    researchOutputTitle(output),
    `用途：${researchOutputPurpose(output)}`,
    `摘要：${researchOutputSummary(output)}`,
    output?.readableBody ? `正文：${output.readableBody}` : null,
    ...rows.map((row) => `${row.label}：${row.value}`),
    limits.length ? `限制：${limits.join("；")}` : null,
    sources.length ? `来源：${sources.map((source) => source.title).join("；")}` : null,
  ].filter(Boolean).join("\n\n");
}

async function copyText(value) {
  if (globalThis.navigator?.clipboard?.writeText) {
    await globalThis.navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function normalizeApiBase(apiBase) {
  const base = typeof apiBase === "string" && apiBase.trim() ? apiBase.trim() : "/api/research";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

function handleTabArrowNavigation(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll('[role="tab"]') ?? []);
  const currentIndex = tabs.indexOf(event.currentTarget);
  if (currentIndex < 0 || tabs.length === 0) return;
  event.preventDefault();
  let nextIndex = currentIndex;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = tabs.length - 1;
  if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
  tabs[nextIndex]?.focus();
  tabs[nextIndex]?.click();
}

function mergeProjectList(projects, project) {
  const id = projectId(project);
  if (!id) return projects;
  const index = projects.findIndex((item) => projectId(item) === id);
  if (index < 0) return [project, ...projects];
  return projects.map((item, itemIndex) =>
    itemIndex === index ? { ...item, ...project } : item,
  );
}

function RuntimeBadge({ runtime, loading, error }) {
  if (loading) {
    return <div className="rawb-runtime is-loading" role="status">正在核对运行时…</div>;
  }

  const agent = runtime?.agent && typeof runtime.agent === "object" ? runtime.agent : runtime;
  const mode = firstText(agent?.mode, agent?.runtimeMode, agent?.kind)?.toLowerCase();
  const isRealPi = runtime?.isRealPi === true || agent?.isRealPi === true || agent?.adapter === "PiRuntimeAdapter" || ["pi", "real_pi", "native_pi"].includes(mode);
  const connected = runtime?.connected !== false && runtime?.available !== false && agent?.connected !== false;
  const provider = firstText(agent?.provider, agent?.modelProvider, agent?.model?.provider);
  const model = firstText(agent?.modelId, agent?.modelName, agent?.model?.id);
  const version = firstText(agent?.piVersion, agent?.version, agent?.pi?.version);
  const liveConfigured = agent?.liveConfigured ?? runtime?.liveConfigured;

  let title = "运行时身份未确认";
  let detail = "后端尚未返回运行模式";
  let tone = "unknown";
  if (error) {
    title = "运行时信息暂不可用";
    detail = "不会把未知状态冒充为真实 Pi";
    tone = "warning";
  } else if (isRealPi && connected && mode === "live") {
    title = "Pi Agent · 实时模型";
    detail = [provider, model, version ? `Pi v${version}` : null, "真实 Agent / tool loop", liveConfigured === false ? "实时模型配置未完成" : null].filter(Boolean).join(" · ");
    tone = liveConfigured === false ? "warning" : "pi";
  } else if (isRealPi && connected && mode === "guided") {
    title = "Pi Agent · 本地引导";
    detail = [version ? `Pi v${version}` : null, "真实 Agent / tool loop", "确定性本地响应", "未调用实时模型"].filter(Boolean).join(" · ");
    tone = "pi";
  } else if (isRealPi && connected) {
    title = "Pi Agent · 运行模式待说明";
    detail = [version ? `Pi v${version}` : null, "运行时未声明 live 或 guided"].filter(Boolean).join(" · ");
    tone = "pi";
  } else if (mode === "mock" || mode === "demo" || mode === "fixture") {
    title = "演示运行时";
    detail = "当前不是 Pi 的真实模型调用";
    tone = "warning";
  } else if (!connected) {
    title = "Pi 运行时未连接";
    detail = "项目数据仍可查看";
    tone = "warning";
  }

  return (
    <div className={`rawb-runtime is-${tone}`} aria-label={`${title}，${detail}`}>
      <span className="rawb-runtime__light" aria-hidden="true" />
      <span><strong>{title}</strong><small>{detail}</small></span>
    </div>
  );
}

function ResearchProgress({ project }) {
  const activeIndex = phaseIndexForProject(project);
  const projectCompleted = projectStatus(project) === "completed";
  const completedIds = new Set(asArray(project?.completedPhaseIds));
  return (
    <nav className="rawb-progress" aria-label="研究进度">
      <ol>
        {RESEARCH_PHASES.map((phase, index) => {
          const complete = index < activeIndex || completedIds.has(phase.id);
          const active = !projectCompleted && activeIndex < RESEARCH_PHASES.length && index === activeIndex;
          return (
            <li
              key={phase.id}
              className={[complete ? "is-complete" : "", active ? "is-active" : ""].filter(Boolean).join(" ")}
              aria-current={active ? "step" : undefined}
              title={phase.meaning}
            >
              <span className="rawb-progress__node">{index + 1}</span>
              <span>{phase.label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Companion({ children, active = false }) {
  return (
    <div className={`rawb-companion${active ? " is-active" : ""}`}>
      <div className="rawb-companion__portrait">
        <img src={evidenceFirefly} alt="萤火虫科研搭档" />
        {active ? <span className="rawb-companion__pulse" aria-hidden="true" /> : null}
      </div>
      <p>{children}</p>
    </div>
  );
}

function EmptyState({ onCreate }) {
  return (
    <section className="rawb-empty" aria-labelledby="rawb-empty-title">
      <Companion>先告诉我一个真正想弄清楚的问题。我们一次只走一步。</Companion>
      <h1 id="rawb-empty-title">从研究问题开始，不从模板开始</h1>
      <p>当前是证据综述模式：Agent 会比较真实 PubMed 检索、整理证据并核查写作；它不会把文献线索冒充实验或分析结果。</p>
      <button className="rawb-primary" type="button" onClick={onCreate}>
        开始一个研究项目
      </button>
    </section>
  );
}

function DecisionReason({
  id,
  label,
  value,
  onChange,
  hint = "至少写 8 个字，让这个决定以后可以被解释。",
}) {
  return (
    <div className="rawb-reason-field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        minLength={8}
        maxLength={500}
        rows={3}
        required
        aria-describedby={`${id}-hint`}
      />
      <small id={`${id}-hint`}>{hint} {value.trim().length}/500</small>
    </div>
  );
}

function ReviewArtifactList({ artifacts, heading, authorityFingerprint = null }) {
  const [copiedId, setCopiedId] = useState("");

  async function handleCopy(itemKey, artifact) {
    try {
      await copyText(artifactCopyText(artifact));
      setCopiedId(itemKey);
      globalThis.setTimeout(() => setCopiedId((current) => current === itemKey ? "" : current), 1800);
    } catch {
      setCopiedId("");
    }
  }

  if (!artifacts.length) return null;
  return (
    <section className="rawb-review-artifacts" aria-label={heading}>
      <h4>{heading}</h4>
      {authorityFingerprint ? (
        <p className="rawb-review-artifacts__fingerprint">
          本次决定只绑定以下决定指纹：<code>{authorityFingerprint}</code>
        </p>
      ) : null}
      <div className="rawb-result-list">
        {artifacts.map((artifact, index) => (
          <ArtifactResult
            key={firstText(artifact?.id, artifact?.artifactId, artifact?.address) ?? index}
            artifact={artifact}
            index={index}
            copiedId={copiedId}
            onCopy={handleCopy}
            defaultOpen
          />
        ))}
      </div>
    </section>
  );
}

function GateDecision({ gate, busy, onDecision }) {
  const reasonId = useId();
  const [reason, setReason] = useState("");

  useEffect(() => setReason(""), [gate?.id, gate?.gateId]);

  if (!gate) return null;
  const label = firstText(gate.userLabel, gate.title, gate.label) ?? "确认本步研究边界";
  const purpose = firstText(gate.reason, gate.purpose, gate.explanation, gate.description) ?? "这一步会改变后续研究范围，需要由研究者明确决定。";
  const criteria = asArray(gate.acceptanceCriteria ?? gate.criteria);
  const artifacts = asCollection(gate.artifacts ?? gate.inputs ?? gate.outputs);
  const validReason = reason.trim().length >= 8;

  return (
    <section className="rawb-decision" aria-labelledby={`${reasonId}-title`}>
      <div className="rawb-decision__heading">
        <div>
          <p>需要你拍板</p>
          <h3 id={`${reasonId}-title`}>{label}</h3>
        </div>
      </div>
      <p className="rawb-decision__purpose">{purpose}</p>
      {criteria.length ? (
        <ul className="rawb-check-list">
          {criteria.map((item, index) => <li key={`${String(item)}-${index}`}>{String(item)}</li>)}
        </ul>
      ) : null}
      <ReviewArtifactList
        artifacts={artifacts}
        heading="批准前先核对这些研究内容"
        authorityFingerprint={firstText(gate.gateFingerprint, gate.fingerprint)}
      />
      <DecisionReason id={reasonId} label="决定理由" value={reason} onChange={setReason} />
      <div className="rawb-decision__actions">
        <button
          className="rawb-decision-button is-approve"
          type="button"
          disabled={!validReason || busy}
          onClick={() => onDecision("approved", reason.trim())}
        >
          批准并继续
        </button>
        <button
          className="rawb-decision-button"
          type="button"
          disabled={!validReason || busy}
          onClick={() => onDecision("amendment_requested", reason.trim())}
        >
          带理由退回修订
        </button>
      </div>
      <p className="rawb-decision__footnote">Agent 不能替你批准，也不会覆盖旧决定。</p>
    </section>
  );
}

function HumanReview({ review, busy, onDecision }) {
  const reasonId = useId();
  const [reason, setReason] = useState("");

  useEffect(() => setReason(""), [review?.id, review?.nodeId]);

  if (!review) return null;
  const title = firstText(review.userLabel, review.title, review.label) ?? "复核 Agent 的候选产物";
  const summary = firstText(review.summary, review.description, review.reason) ?? "请核对候选产物是否满足本步要求。接受后，状态机才会进入下一步。";
  const outputs = asCollection(review.artifacts ?? review.outputs ?? review.candidates);
  const validReason = reason.trim().length >= 8;

  return (
    <section className="rawb-review" aria-labelledby={`${reasonId}-title`}>
      <div className="rawb-review__heading">
        <div>
          <p>人工复核</p>
          <h3 id={`${reasonId}-title`}>{title}</h3>
        </div>
      </div>
      <p>{summary}</p>
      <ReviewArtifactList
        artifacts={outputs}
        heading="接受前先核对候选正文与结构"
        authorityFingerprint={firstText(review.materialFingerprint, review.fingerprint)}
      />
      <DecisionReason id={reasonId} label="复核意见" value={reason} onChange={setReason} />
      <div className="rawb-decision__actions">
        <button
          className="rawb-decision-button is-approve"
          type="button"
          disabled={!validReason || busy}
          onClick={() => onDecision("accepted", reason.trim())}
        >
          接受候选产物
        </button>
        <button
          className="rawb-decision-button"
          type="button"
          disabled={!validReason || busy}
          onClick={() => onDecision("revision_requested", reason.trim())}
        >
          要求修改
        </button>
      </div>
      <p className="rawb-decision__footnote">这里接受的是本步候选产物，不等于替作者签署最终结论。</p>
    </section>
  );
}

function ResearchUserBrief({ project, briefRef, feedback, onViewEvidence }) {
  const brief = project?.userBrief && typeof project.userBrief === "object"
    ? project.userBrief
    : {};
  const evidenceBoundary = brief.mainEvidenceAndBoundaries && typeof brief.mainEvidenceAndBoundaries === "object"
    ? brief.mainEvidenceAndBoundaries
    : {};
  const conclusions = asCollection(brief.newConclusions);
  const boundaries = asArray(evidenceBoundary.boundaries).filter(Boolean);
  const currentPeriod = firstText(
    brief.currentResearchPeriod,
    project?.currentResearchPeriod,
    project?.currentTask?.userLabel,
  ) ?? "当前研究阶段尚未报告";
  const nextStep = firstText(
    brief.nextStepOrUserDecision,
    project?.summary?.nextDecision,
    project?.currentTask?.userLabel,
  ) ?? "等待当前项目状态更新。";
  const accessSummary = firstText(
    evidenceBoundary.accessSummary,
    project?.summary?.boundary,
  ) ?? "尚未建立可用于研究判断的证据记录。";

  return (
    <section
      className="rawb-user-brief"
      ref={briefRef}
      tabIndex={-1}
      aria-labelledby="rawb-user-brief-title"
      data-testid="research-user-brief"
    >
      <div className="rawb-user-brief__heading">
        <div>
          <p className="rawb-eyebrow">紧邻当前操作 · 自动更新</p>
          <h2 id="rawb-user-brief-title">阶段科研回报</h2>
        </div>
        <span>项目版本 {Number.isFinite(Number(brief.revision ?? project?.version)) ? Number(brief.revision ?? project.version) : "—"}</span>
      </div>
      {feedback ? <p className="rawb-user-brief__feedback" role="status">{feedback}</p> : null}
      <div className="rawb-user-brief__grid">
        <article>
          <p>当前研究时期</p>
          <strong>{currentPeriod}</strong>
        </article>
        <article className="rawb-user-brief__conclusions">
          <p>本轮新得到的结论</p>
          {conclusions.length ? (
            <ol>
              {conclusions.map((conclusion, index) => (
                <li key={firstText(conclusion?.id) ?? index}>
                  <strong>{firstText(conclusion?.claim) ?? "结论内容未报告"}</strong>
                  <span>{firstText(conclusion?.confidence, conclusion?.scope) ?? "适用范围尚未报告"}</span>
                </li>
              ))}
            </ol>
          ) : <span>本轮尚未产生通过当前准入条件的新结论。</span>}
        </article>
        <article>
          <p>主要依据与边界</p>
          <strong>{accessSummary}</strong>
          {boundaries.length ? (
            <ul>
              {boundaries.slice(0, 3).map((boundary) => <li key={boundary}>{boundary}</li>)}
            </ul>
          ) : null}
        </article>
        <article>
          <p>下一步或需要确认的决定</p>
          <strong>{nextStep}</strong>
        </article>
      </div>
      <div className="rawb-user-brief__actions">
        <button type="button" onClick={onViewEvidence}>查看完整科研成果</button>
        <span>这里只显示可交付给研究者的回报；详细产物和内部记录分别留在对应标签页。</span>
      </div>
    </section>
  );
}

function DeliverySummary({ project }) {
  const records = asCollection(project?.events ?? project?.records ?? project?.history ?? project?.runLog);
  const serverCategories = serverResearchCategories(project);
  const researchOutputCount = Number.isFinite(Number(project?.researchOutputCount))
    ? Number(project.researchOutputCount)
    : serverCategories.reduce((total, category) => total + category.items.length, 0);
  const maturity = project?.contentMaturity && typeof project.contentMaturity === "object"
    ? project.contentMaturity
    : {};
  const maturityCode = firstText(maturity.code)?.toLowerCase();
  const processDraft = maturityCode === "guided_draft";
  const formalResearchComplete = maturity.formalResearchComplete === true;
  const maturityLabel = firstText(maturity.label) ?? (formalResearchComplete ? "正式研究版本" : "研究成果");
  const completionProfile = COMPLETION_PROFILES.find(
    (candidate) => candidate.id === project?.completionProfileId,
  );
  const limitation = firstText(
    maturity.boundary,
    project?.summary?.boundary,
    project?.limitation,
    project?.projection?.limitation,
  ) ?? "正式使用时仍要保留每条来源的实际访问层级；最终解释和发布责任属于研究者。";
  const exportBase = `/api/research/projects/${encodeURIComponent(projectId(project) ?? "")}/exports`;
  const hasAuditedManuscript = asCollection(project?.artifacts).some(
    (artifact) => artifact?.type === "AuditedManuscript",
  );
  const hasSources = asCollection(project?.sourceMaterials).length > 0;
  const hasSignedManifest = ["ExportManifest", "AuthorApproval", "SignedDelivery"].every(
    (type) => asCollection(project?.artifacts).some((artifact) => artifact?.type === type),
  );

  return (
    <section className="rawb-delivery-summary" aria-labelledby="rawb-delivery-title">
      <div className="rawb-delivery-summary__heading">
        <p className="rawb-eyebrow">{processDraft ? "流程演练交付" : "研究交付"}</p>
        <h2 id="rawb-delivery-title">{formalResearchComplete ? "本次研究已经完成" : "本轮科研流程已经走完"}</h2>
        <p>{formalResearchComplete
          ? "约定的研究目标均已通过，正式版本已经冻结。你仍可查看成果、核查写作和追溯全过程。"
          : `“${completionProfile?.label ?? "本轮研究目标"}”已经到达约定终点，内容等级标注为“${maturityLabel}”。请按照服务端记录的证据边界理解和使用这些成果。`}</p>
      </div>
      <dl className="rawb-delivery-summary__stats">
        <div><dt>流程状态</dt><dd>{processDraft ? "演练完成" : "完成"}</dd></div>
        <div><dt>内容等级</dt><dd>{maturityLabel}</dd></div>
        <div><dt>科研成果</dt><dd>{researchOutputCount} 项</dd></div>
        <div><dt>研究记录</dt><dd>{records.length} 条</dd></div>
      </dl>
      <div className="rawb-delivery-summary__limitation">
        <strong>交付时仍需记住</strong>
        <p>{limitation}</p>
      </div>
      <div className="rawb-delivery-summary__exports" aria-labelledby="rawb-delivery-exports-title">
        <div>
          <strong id="rawb-delivery-exports-title">固定导出区</strong>
          <p>{formalResearchComplete
            ? "这是已审计并由作者签署的正式科研版本。"
            : "当前不是正式签署版本；下载文件会保留“受限草稿/可追溯研究包”标识。"}</p>
        </div>
        {hasSignedManifest ? (
          <div className="rawb-delivery-summary__export-actions">
            {formalResearchComplete ? (
              <a href={`${exportBase}/manuscript.md`} download>正式 Markdown</a>
            ) : hasAuditedManuscript ? (
              <a href={`${exportBase}/restricted-draft.md`} download>受限草稿</a>
            ) : null}
            <a href={`${exportBase}/research-bundle.json`} download>可追溯研究包</a>
            {hasSources ? <a href={`${exportBase}/references.bib`} download>BibTeX</a> : null}
          </div>
        ) : (
          <p>作者尚未签署唯一导出清单，下载入口保持关闭。</p>
        )}
      </div>
      <aside className="rawb-guardrail">
        <div><strong>流程有护栏，作者仍负责</strong><p>状态机固定了步骤和准入条件，Agent 留下了可追溯记录；最终解释、署名和发布决定仍由研究者承担。</p></div>
      </aside>
    </section>
  );
}

function LiveRetrievalSummary({ project }) {
  const display = researchWorkbenchRetrievalDisplay(project);
  const preview = display.mode === "preview" ? display.preview : null;
  const retrieval = ["formal_in_progress", "final_library"].includes(display.mode)
    ? display.retrieval
    : null;
  const legacyRetrieval = display.mode === "legacy" ? display.legacy : null;
  const previewOnly = display.mode === "preview";
  const finalLibrary = display.mode === "final_library";
  const formalInProgress = display.mode === "formal_in_progress";
  const sources = previewOnly
    ? asArray(preview.samples).map((sample) => ({
        ...sample,
        id: sample.sourceId,
        abstract: sample.abstractSnippet,
      }))
    : asCollection(project?.sourceMaterials);
  const provider = firstText(retrieval?.provider)?.toLowerCase();

  if ((!retrieval || provider !== "pubmed") && !previewOnly && !legacyRetrieval) return null;

  if (legacyRetrieval) {
    return (
      <section className="rawb-live-retrieval rawb-live-retrieval--legacy" aria-labelledby="rawb-live-retrieval-title">
        <div className="rawb-live-retrieval__heading">
          <div>
            <p>历史单次检索记录</p>
            <h3 id="rawb-live-retrieval-title">尚未完成分阶段真实检索</h3>
          </div>
          <strong>不能作为正式文献库</strong>
        </div>
        <dl className="rawb-live-retrieval__facts">
          <div><dt>历史检索式</dt><dd>{firstText(legacyRetrieval.query, project?.searchQuery) ?? "未记录"}</dd></div>
          <div><dt>历史命中</dt><dd>{Number.isFinite(Number(legacyRetrieval.total)) ? `${Number(legacyRetrieval.total).toLocaleString("zh-CN")} 条` : "未记录"}</dd></div>
          <div><dt>兼容状态</dt><dd>只保留追溯，不复用到新检索节点</dd></div>
        </dl>
        <p className="rawb-live-retrieval__boundary"><strong>当前证据边界：</strong>这是旧版本留下的单次题录/摘要检索。它没有分别证明试检、宽检索建库、聚焦比较和最终冻结，因此新版本不会把它显示成正式检索完成。</p>
        <p className="rawb-live-retrieval__decision-note"><strong>下一步：</strong>可保留这个历史项目用于追溯；需要继续研究时，请建立一个新研究并按当前分阶段检索流程运行。</p>
      </section>
    );
  }

  const storedCount = previewOnly
    ? sources.length
    : Number.isFinite(Number(retrieval.recordCount))
    ? Number(retrieval.recordCount)
    : sources.length;
  const totalCount = Number.isFinite(Number(previewOnly ? preview.total : retrieval.total))
    ? Number(previewOnly ? preview.total : retrieval.total)
    : null;
  const accessBoundary = previewOnly
    ? "这些是建项前真实试检保存的当前排序样本，只用于确认问题与检索表达；尚未进入正式宽检索、聚焦检索或最终证据库。"
    : formalInProgress
      ? "这是分阶段正式检索中的中间运行，用于试检、领域认识或聚焦校准；尚未冻结为最终文献库，不能作为正式纳入集合。"
    : firstText(retrieval.accessBoundary)
    ?? "当前只读取 PubMed 题录与可用摘要；摘要未报告的信息保持未知。";
  const abstractCount = sources.filter(
    (source) => ["abstract_only", "title_abstract"].includes(source?.accessLevel),
  ).length;
  const titleOnlyCount = sources.filter((source) => source?.accessLevel === "title_only").length;
  const purposeCopy = {
    pilot: { eyebrow: "PubMed 正式试检已保存", title: "试检候选记录", badge: "尚未进入正式文献库" },
    orientationCorpus: { eyebrow: "PubMed 宽检索语料已保存", title: "领域认识候选记录", badge: "仅用于理解领域" },
    focusedCalibration: { eyebrow: "PubMed 聚焦校准已保存", title: "聚焦校准候选记录", badge: "尚未冻结正式文献库" },
    finalLibrary: { eyebrow: "PubMed 最终文献库已冻结", title: "已冻结来源记录", badge: `正式保存 ${storedCount} 篇` },
  }[display.purpose] ?? {
    eyebrow: "PubMed 分阶段检索已保存",
    title: "中间候选记录",
    badge: "尚未冻结正式文献库",
  };

  return (
    <section className="rawb-live-retrieval" aria-labelledby="rawb-live-retrieval-title">
      <div className="rawb-live-retrieval__heading">
        <div>
          <p>{previewOnly ? "PubMed 建项前预检已完成" : purposeCopy.eyebrow}</p>
          <h3 id="rawb-live-retrieval-title">{storedCount} 条{previewOnly ? "预检样本" : purposeCopy.title}（尚未筛选）</h3>
        </div>
        <strong>{previewOnly ? "尚未纳入文献库" : purposeCopy.badge}</strong>
      </div>
      <dl className="rawb-live-retrieval__facts">
        <div><dt>实际检索式</dt><dd>{firstText(previewOnly ? preview.query : retrieval.query, project?.searchQuery) ?? "未记录"}</dd></div>
        <div><dt>数据库命中</dt><dd>{totalCount === null ? "未记录" : `${totalCount.toLocaleString("zh-CN")} 条`}</dd></div>
        <div><dt>本轮保存规则</dt><dd>按 PubMed 当前排序保存前 {storedCount} 条{previewOnly ? "未筛选预检样本" : "候选"}</dd></div>
        <div><dt>可见内容</dt><dd>{abstractCount} 条有摘要 · {titleOnlyCount} 条仅题名</dd></div>
        <div><dt>检索时间</dt><dd>{formatDate(previewOnly ? preview.executedAt : retrieval.executedAt)}</dd></div>
      </dl>
      {sources.length ? (
        <div className="rawb-live-retrieval__sources">
          <h4>{previewOnly ? "预检抽查样本" : finalLibrary ? "最终文献库来源" : "本轮校准来源"}</h4>
          <ol>
            {sources.slice(0, 3).map((source, index) => {
              const pmid = firstText(source?.pmid, source?.locator?.pmid);
              const sourceUrl = safeExternalUrl(source?.locator?.url)
                ?? (pmid ? `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(pmid)}/` : null);
              const title = firstText(source?.title) ?? `PubMed 来源 ${index + 1}`;
              const accessLabel = ACCESS_LABELS[source?.accessLevel] ?? firstText(source?.accessLevel) ?? "访问层级未记录";
              return (
                <li key={firstText(source?.id, pmid) ?? index}>
                  <div>
                    {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">{title}</a> : <strong>{title}</strong>}
                    <p>{pmid ? `PMID ${pmid}` : "PMID 未记录"} · {accessLabel}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          {sources.length > 3 ? <p className="rawb-live-retrieval__more">另有 {sources.length - 3} 条；{previewOnly ? "正式检索后才会进入科研成果。" : finalLibrary ? "进入“科研成果”后可逐条核对。" : "仅供当前检索校准，不等于最终纳入。"}</p> : null}
        </div>
      ) : null}
      <p className="rawb-live-retrieval__boundary"><strong>当前证据边界：</strong>{accessBoundary}</p>
      <p className="rawb-live-retrieval__decision-note"><strong>当前责任边界：</strong>{previewOnly
        ? "确认研究问题和范围是否值得继续；不等于把预检样本纳入文献库，也不等于批准研究结论。"
        : finalLibrary
          ? "这说明本轮文献范围已经按冻结协议保存；仍不等于每篇文献已纳入结论或完成全文核查。"
          : "这些记录只用于检索校准和方向判断；只有最终冻结步骤完成后，来源才进入本轮正式文献库。"}</p>
    </section>
  );
}

function TaskPanel({
  project,
  gate,
  review,
  busy,
  onGateDecision,
  onReviewDecision,
  onRetrySearch,
  onRetrySameProtocol,
  onReviseProtocol,
}) {
  const taskContainer = project?.currentTask ?? project?.currentWorkOrder ?? project?.workOrder ?? project?.currentNode ?? {};
  const task = taskContainer?.payload && typeof taskContainer.payload === "object"
    ? { ...taskContainer, ...taskContainer.payload }
    : taskContainer;
  const objective = firstText(task.objective, task.purpose, task.description, project?.nextAction) ?? "等待状态机给出下一项明确任务。";
  const acceptance = asArray(task.acceptanceCriteria ?? task.criteria);
  const outputs = asArray(task.requiredOutputs ?? task.outputs);
  const blocker = firstText(project?.blocker?.message, project?.blocker, task.blocker);
  const structuredBlocker = project?.blocker && typeof project.blocker === "object"
    ? project.blocker
    : null;
  const retryClass = firstText(structuredBlocker?.retryClass);
  const formalRetrievalBlocked = [
    "protocol_revision_required",
    "same_protocol_retry",
    "human_review_required",
  ].includes(retryClass);
  const failedQuery = firstText(
    structuredBlocker?.failedRequest?.query,
    project?.searchQuery,
  ) ?? "";
  const previewStatus = firstText(project?.queryPreviewSelection?.candidateStatus);
  const liveRetrievalFailed =
    project?.researchMode === "live_pubmed" &&
    asArray(project?.retrievalRuns).length === 0 &&
    !project?.liveRetrieval &&
    (!project?.queryPreviewSelection || ["zero_results", "failed"].includes(previewStatus)) &&
    ["paused", "blocked"].includes(projectStatus(project));
  const [retryQuery, setRetryQuery] = useState(firstText(project?.searchQuery) ?? "");
  const [revisedQuery, setRevisedQuery] = useState(failedQuery);
  const [revisionReason, setRevisionReason] = useState("");
  const [showExplicitRevision, setShowExplicitRevision] = useState(false);

  useEffect(() => {
    setRetryQuery(firstText(project?.searchQuery) ?? "");
    setRevisedQuery(failedQuery);
    setRevisionReason("");
    setShowExplicitRevision(false);
  }, [failedQuery, project?.id, project?.searchQuery, structuredBlocker?.id]);

  if (projectStatus(project) === "completed") return <DeliverySummary project={project} />;

  return (
    <div className="rawb-panel-grid">
      <section className="rawb-task-card">
        <p className="rawb-eyebrow">现在只做这一件事</p>
        <h2>{firstText(task.userLabel, task.title, task.label) ?? "准备下一步研究任务"}</h2>
        <p className="rawb-task-card__objective">{objective}</p>
        {blocker ? <p className="rawb-blocker">{blocker}</p> : null}
        {formalRetrievalBlocked ? (
          <section className={`rawb-recovery is-${retryClass}`} aria-labelledby="rawb-recovery-title">
            <div className="rawb-recovery__heading">
              <div>
                <p>研究已停在安全位置</p>
                <h3 id="rawb-recovery-title">
                  {retryClass === "protocol_revision_required"
                    ? "本轮是零结果，需要修订检索协议"
                    : retryClass === "same_protocol_retry"
                      ? "当前协议可保留，等待原式重试"
                      : "失败类型需要研究者判断"}
                </h3>
              </div>
              <span>{firstText(structuredBlocker?.code) ?? "失败代码未记录"}</span>
            </div>
            <dl className="rawb-recovery__facts">
              <div><dt>失败原因</dt><dd>{firstText(structuredBlocker?.reason) ?? "未记录"}</dd></div>
              <div><dt>失败步骤</dt><dd>{firstText(project?.recovery?.safeCheckpoint?.label, structuredBlocker?.stage) ?? "当前正式检索步骤"}</dd></div>
              <div><dt>原检索式</dt><dd><code>{failedQuery || "未记录"}</code></dd></div>
              <div><dt>安全保存点</dt><dd>{firstText(project?.recovery?.safeCheckpoint?.message) ?? "项目、既有产物和成功检索回执均已保存。"}</dd></div>
            </dl>
            {retryClass === "same_protocol_retry" ? (
              <div className="rawb-recovery__single-action">
                <p>适用于超时、限流或 PubMed 暂时不可用。不会改写协议，也不会重复已成功并持久化的检索。</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRetrySameProtocol?.(structuredBlocker.id)}
                >
                  {busy ? "正在按原式恢复…" : "按原检索式重试"}
                </button>
              </div>
            ) : null}
            {retryClass === "human_review_required" && !showExplicitRevision ? (
              <div className="rawb-recovery__choice">
                <p>系统不能安全判断这次失败是否否定了检索方法。请先查看原因，再选择保留原协议或建立新版协议。</p>
                <div>
                  <button type="button" disabled={busy} onClick={() => onRetrySameProtocol?.(structuredBlocker.id)}>保留原式重试</button>
                  <button type="button" disabled={busy} onClick={() => setShowExplicitRevision(true)}>我要修订协议</button>
                </div>
              </div>
            ) : null}
            {retryClass === "protocol_revision_required" || showExplicitRevision ? (
              <form className="rawb-recovery__revision" onSubmit={(event) => {
                event.preventDefault();
                onReviseProtocol?.({
                  blockerId: structuredBlocker.id,
                  revisedQuery: revisedQuery.trim(),
                  reason: revisionReason.trim(),
                  explicitRevision: retryClass !== "protocol_revision_required",
                });
              }}>
                <div>
                  <strong>在同一个项目建立新版协议</strong>
                  <p>新版会绑定你的理由、身份和旧协议指纹；受影响的下游检索将失效后重新执行。</p>
                </div>
                <label htmlFor="rawb-revised-protocol-query">新版 PubMed 检索式</label>
                <textarea
                  id="rawb-revised-protocol-query"
                  value={revisedQuery}
                  onChange={(event) => setRevisedQuery(event.target.value)}
                  minLength={3}
                  maxLength={2000}
                  rows={3}
                  required
                />
                <label htmlFor="rawb-revised-protocol-reason">为什么要改变研究方法</label>
                <textarea
                  id="rawb-revised-protocol-reason"
                  value={revisionReason}
                  onChange={(event) => setRevisionReason(event.target.value)}
                  minLength={8}
                  maxLength={1000}
                  rows={3}
                  placeholder="例如：原式只覆盖精确短语，零结果提示概念范围过窄，因此加入同义词并保留原研究边界。"
                  required
                />
                <div className="rawb-recovery__revision-actions">
                  {showExplicitRevision ? <button type="button" onClick={() => setShowExplicitRevision(false)}>返回选择</button> : null}
                  <button
                    type="submit"
                    disabled={
                      busy ||
                      revisedQuery.trim().length < 3 ||
                      revisedQuery.trim() === failedQuery ||
                      revisionReason.trim().length < 8
                    }
                  >
                    {busy ? "正在保存并继续…" : "保存新版协议并继续"}
                  </button>
                </div>
                {revisedQuery.trim() === failedQuery ? <p className="rawb-recovery__hint">检索式尚未改变。若只是工具恢复，请选择按原式重试。</p> : null}
              </form>
            ) : null}
          </section>
        ) : null}
        {liveRetrievalFailed ? (
          <form className="rawb-retry-search" onSubmit={(event) => {
            event.preventDefault();
            onRetrySearch?.(retryQuery.trim());
          }}>
            <div><strong>在同一个项目修改检索式</strong><p>不会新建第二个项目；成功后会保存新的检索式并从这个安全位置继续。</p></div>
            <label htmlFor="rawb-retry-search-query">PubMed 英文检索式</label>
            <input
              id="rawb-retry-search-query"
              value={retryQuery}
              onChange={(event) => setRetryQuery(event.target.value)}
              minLength={3}
              maxLength={500}
              required
            />
            <button type="submit" disabled={busy || retryQuery.trim().length < 3}>
              {busy ? "正在重新检索…" : "修改并重新检索"}
            </button>
          </form>
        ) : null}
        <LiveRetrievalSummary project={project} />
        <div className="rawb-task-details">
          <div>
            <h3>完成标准</h3>
            {acceptance.length ? (
              <ul className="rawb-check-list">
                {acceptance.map((item, index) => <li key={`${String(item)}-${index}`}>{String(item)}</li>)}
              </ul>
            ) : <p>状态机尚未返回本步验收条件。</p>}
          </div>
          <div>
            <h3>本步会留下</h3>
            {outputs.length ? (
              <ul className="rawb-output-list is-compact">
                {outputs.map((output, index) => (
                  <li key={firstText(output?.artifactId, output?.id, output?.type) ?? index}>
                    <strong>{firstText(output?.label, output?.title, output?.type) ?? String(output)}</strong>
                  </li>
                ))}
              </ul>
            ) : <p>产物要求将在工作单生成后显示。</p>}
          </div>
        </div>
      </section>
      {gate ? <GateDecision gate={gate} busy={busy} onDecision={onGateDecision} /> : null}
      {review ? <HumanReview review={review} busy={busy} onDecision={onReviewDecision} /> : null}
      {!gate && !review ? (
        <aside className="rawb-guardrail">
          <div><strong>流程有护栏，Agent 有行动空间</strong><p>状态机决定顺序和准入条件；Agent 只处理当前事件，不能跳过人工决定。</p></div>
        </aside>
      ) : null}
    </div>
  );
}

function ArtifactResult({
  artifact,
  index,
  copiedId,
  onCopy,
  serverShaped = false,
  defaultOpen = false,
}) {
  const itemId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const type = artifactType(artifact);
  const sources = serverShaped ? researchOutputSources(artifact) : artifactSources(artifact);
  const limitations = serverShaped ? researchOutputLimitations(artifact) : artifactLimitations(artifact);
  const detailRows = serverShaped ? researchOutputDetailRows(artifact) : artifactDetailRows(artifact);
  const itemKey = firstText(artifact?.id, artifact?.artifactId, artifact?.address) ?? `${type}-${index}`;
  const status = firstText(artifact?.status?.tone, artifact?.status?.value, artifact?.status)?.toLowerCase();
  const explicitStatusLabel = firstText(artifact?.status?.label);
  const verified =
    ["positive", "accepted", "verified", "frozen", "completed", "passed"].includes(status) ||
    /已确认|已核查|已通过|已冻结/.test(explicitStatusLabel ?? "");
  const statusLabel = explicitStatusLabel ?? (verified ? "已核查" : Number.isFinite(artifact?.version) ? `版本 ${artifact.version}` : "可复核");
  const detailActions = asCollection(artifact?.actions).filter((action) => {
    const href = typeof action === "string" ? action : action?.href;
    return href !== artifact?.downloadUrl && (safeExternalUrl(href) || (typeof href === "string" && href.startsWith("/")));
  });
  const downloadUrl = safeExternalUrl(artifact?.downloadUrl) ?? (typeof artifact?.downloadUrl === "string" && artifact.downloadUrl.startsWith("/") ? artifact.downloadUrl : null);

  return (
    <article className="rawb-result-card">
      <div className="rawb-result-card__head">
        <div>
          <span className={`rawb-result-card__state${verified ? " is-verified" : ""}`}>
            {statusLabel}
          </span>
          <h4>{serverShaped ? researchOutputTitle(artifact, index) : artifactResearchTitle(artifact, index)}</h4>
          <p className="rawb-result-card__purpose">{serverShaped ? researchOutputPurpose(artifact) : artifactPurpose(artifact)}</p>
        </div>
        <div className="rawb-result-card__actions">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={itemId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "收起" : "查看详情"}
          </button>
          <button type="button" onClick={() => onCopy(itemKey, artifact)}>
            {copiedId === itemKey ? "已复制" : "复制内容"}
          </button>
          {downloadUrl ? <a href={downloadUrl}>下载成果</a> : null}
          {detailActions.map((action, actionIndex) => {
            const href = typeof action === "string" ? action : action.href;
            return (
              <a key={`${href}-${actionIndex}`} href={href} target={safeExternalUrl(href) ? "_blank" : undefined} rel={safeExternalUrl(href) ? "noreferrer" : undefined}>
                {typeof action === "string" ? "打开相关内容" : firstText(action.label, action.title) ?? "打开相关内容"}
              </a>
            );
          })}
        </div>
      </div>
      <p className="rawb-result-card__summary">{serverShaped ? researchOutputSummary(artifact) : artifactSummary(artifact)}</p>
      {artifact?.contentHash ? (
        <p className="rawb-result-card__authority">
          当前内容哈希 <code>{artifact.contentHash}</code>
        </p>
      ) : null}
      {open ? (
        <div className="rawb-result-detail" id={itemId}>
          {serverShaped && artifact?.readableBody ? <div className="rawb-result-detail__body">{artifact.readableBody}</div> : null}
          {detailRows.length ? (
            <dl>
              {detailRows.map((row) => (
                <div key={row.key}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : <p className="rawb-result-detail__empty">当前接口只返回了这项成果的摘要；更多结构化内容将在生成后继续显示。</p>}
          <div className="rawb-result-detail__columns">
            <section>
              <h5>来源</h5>
              {sources.length ? (
                <ul>
                  {sources.slice(0, 8).map((source) => (
                    <li key={source.id}>
                      {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : source.title}
                      {source.accessLevel ? <small>{ACCESS_LABELS[source.accessLevel] ?? source.accessLevel}</small> : null}
                    </li>
                  ))}
                </ul>
              ) : <p>这项成果没有直接来源清单；请到下方“实际使用的研究材料”核对项目证据边界。</p>}
            </section>
            <section>
              <h5>限制与边界</h5>
              {limitations.length ? <ul>{limitations.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{item}</li>)}</ul> : <p>当前接口没有单独返回限制字段，不能据此认定“没有限制”。</p>}
            </section>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function EvidencePanel({ project }) {
  const evidenceListId = useId();
  const currentProjectId = projectId(project);
  const [activeCategory, setActiveCategory] = useState("");
  const [showAllCategoryItems, setShowAllCategoryItems] = useState(false);
  const [showAllEvidence, setShowAllEvidence] = useState(false);
  const [expandedEvidenceIds, setExpandedEvidenceIds] = useState(() => new Set());
  const [copiedId, setCopiedId] = useState("");
  const evidence = asCollection(
    project?.evidence ?? project?.evidenceItems ?? project?.evidenceBrief?.evidence ?? project?.sources,
  );
  const artifacts = asCollection(project?.artifacts ?? project?.outputs ?? project?.projection?.artifacts ?? project?.state?.artifacts);
  const fullTextCount = evidence.filter((item) => ["full_text", "full_text_and_supplement"].includes(item?.accessLevel)).length;
  const abstractCount = evidence.filter((item) => ["title_abstract", "abstract_only"].includes(item?.accessLevel)).length;
  const categories = useMemo(() => {
    const serverCategories = serverResearchCategories(project);
    if (serverCategories.length) return serverCategories;
    return RESEARCH_RESULT_CATEGORIES.map((category) => ({
      ...category,
      items: artifacts.filter((artifact) => researchCategoryForArtifact(artifact) === category.id),
    }));
  }, [artifacts, project]);
  const serverShaped = Boolean(serverResearchCategories(project).length);
  const selectedCategory = categories.find((category) => category.id === activeCategory) ?? categories[0];
  const primaryItems = useMemo(() => {
    if (!selectedCategory) return [];
    if (serverShaped) return selectedCategory.items;
    const byType = new Map();
    selectedCategory.items.forEach((artifact) => {
      const type = artifactType(artifact) ?? "unknown";
      if (MULTI_ITEM_ARTIFACT_TYPES.has(type)) {
        byType.set(`${type}:${firstText(artifact?.id, artifact?.artifactId)}`, artifact);
      } else {
        byType.set(type, artifact);
      }
    });
    return [...byType.values()].sort((left, right) => {
      const leftRank = selectedCategory.types.indexOf(artifactType(left));
      const rightRank = selectedCategory.types.indexOf(artifactType(right));
      return (leftRank < 0 ? 999 : leftRank) - (rightRank < 0 ? 999 : rightRank);
    });
  }, [selectedCategory, serverShaped]);
  const visibleItems = showAllCategoryItems ? selectedCategory.items : primaryItems.slice(0, CATEGORY_PREVIEW_LIMIT);
  const visibleEvidence = showAllEvidence ? evidence : evidence.slice(0, EVIDENCE_PREVIEW_LIMIT);

  useEffect(() => {
    setActiveCategory("");
    setShowAllCategoryItems(false);
    setShowAllEvidence(false);
    setExpandedEvidenceIds(new Set());
    setCopiedId("");
  }, [currentProjectId]);

  useEffect(() => {
    if (categories.length && !categories.some((category) => category.id === activeCategory)) {
      setActiveCategory(categories[0].id);
    }
  }, [activeCategory, categories]);

  useEffect(() => {
    setShowAllCategoryItems(false);
  }, [activeCategory]);

  async function handleCopy(itemKey, artifact) {
    try {
      await copyText(serverShaped ? researchOutputCopyText(artifact) : artifactCopyText(artifact));
      setCopiedId(itemKey);
      globalThis.setTimeout(() => setCopiedId((current) => current === itemKey ? "" : current), 1800);
    } catch {
      setCopiedId("");
    }
  }

  return (
    <div className="rawb-evidence-layout">
      <section className="rawb-research-results" aria-labelledby="rawb-artifacts-title">
        <header className="rawb-research-results__intro">
          <div>
            <p className="rawb-eyebrow">科研成果</p>
            <h2 id="rawb-artifacts-title">研究者真正需要复核的内容</h2>
            <p>内部运行对象已经收起。这里只保留结论、来源证据、检索方法、写作稿件和质量审计五类成果。</p>
          </div>
          <span>{serverShaped ? `${categories.reduce((total, category) => total + category.items.length, 0)} 项科研成果` : `${artifacts.length} 项过程成果已归档`}</span>
        </header>

        <div className="rawb-category-tabs" role="tablist" aria-label="科研成果分类">
          {categories.map((category) => (
            <button
              key={category.id}
              id={`rawb-category-tab-${category.id}`}
              type="button"
              role="tab"
              aria-selected={activeCategory === category.id}
              aria-controls={`rawb-category-panel-${category.id}`}
              tabIndex={activeCategory === category.id ? 0 : -1}
              className={activeCategory === category.id ? "is-active" : ""}
              onClick={() => setActiveCategory(category.id)}
              onKeyDown={handleTabArrowNavigation}
            >
              <strong>{category.label}</strong>
              <span>{category.items.length ? `${category.items.length} 项` : "待生成"}</span>
            </button>
          ))}
        </div>

        <section
          className="rawb-category-panel"
          role="tabpanel"
          id={`rawb-category-panel-${selectedCategory.id}`}
          aria-labelledby={`rawb-category-tab-${selectedCategory.id}`}
        >
          <div className="rawb-category-panel__heading">
            <div><h3>{selectedCategory.label}</h3><p>{selectedCategory.description}</p></div>
            {selectedCategory.items.length > primaryItems.slice(0, CATEGORY_PREVIEW_LIMIT).length ? (
              <button type="button" onClick={() => setShowAllCategoryItems((value) => !value)}>
                {showAllCategoryItems ? "只看关键成果" : `查看全部 ${selectedCategory.items.length} 项`}
              </button>
            ) : null}
          </div>
          {visibleItems.length ? (
            <div className="rawb-result-list">
              {visibleItems.map((artifact, index) => (
                <ArtifactResult
                  key={firstText(artifact?.id, artifact?.artifactId, artifact?.address) ?? index}
                  artifact={artifact}
                  index={index}
                  copiedId={copiedId}
                  onCopy={handleCopy}
                  serverShaped={serverShaped}
                />
              ))}
            </div>
          ) : <div className="rawb-soft-empty">{selectedCategory.empty}</div>}
        </section>
      </section>

      <section className="rawb-evidence-summary" aria-label="材料访问层级摘要">
        <div><strong>{evidence.length}</strong><span>条可追溯材料</span></div>
        <div><strong>{fullTextCount}</strong><span>条已访问全文</span></div>
        <div><strong>{abstractCount}</strong><span>条仅到摘要层级</span></div>
        <p>没有在摘要中报告的信息保持“未知”；工作台不会擅自写成“没有发生”。</p>
      </section>

      <section className="rawb-section" aria-labelledby="rawb-evidence-title">
        <div className="rawb-section__heading"><div><p className="rawb-eyebrow">来源核对</p><h2 id="rawb-evidence-title">实际使用的研究材料</h2></div></div>
        {evidence.length ? (
          <>
            <ol className="rawb-source-list" id={evidenceListId}>
              {visibleEvidence.map((item, index) => {
                const url = safeExternalUrl(item?.url ?? item?.sourceUrl);
                const title = firstText(item?.title, item?.citation, item?.label) ?? `材料 ${index + 1}`;
                const access = firstText(item?.accessLevel, item?.access_level) ?? "unknown";
                const facts = asCollection(item?.extractedFacts).map((fact) => researchValueToText(fact)).filter(Boolean);
                const limitations = asCollection(item?.limitations).map((limit) => researchValueToText(limit)).filter(Boolean);
                const itemKey = firstText(item?.id, item?.repositoryId, item?.pmid, item?.doi) ?? `source-${index}`;
                const summary = facts[0] ?? firstText(item?.summary, item?.extractedFact) ?? "已记录题录；具体提取事实尚未返回。";
                const libraryStatus = item?.libraryEligibility === "final_library_source"
                  ? "最终文献库"
                  : item?.libraryEligibility === "legacy_trace_only"
                    ? "历史追溯材料"
                    : item?.retrievalStage === "formal_retrieval_in_progress"
                      ? "检索校准材料"
                      : null;
                const expanded = expandedEvidenceIds.has(itemKey);
                const longSummary = summary.length > 360;
                return (
                  <li key={itemKey}>
                    <div className="rawb-source-list__main">
                      <span>{[libraryStatus, ACCESS_LABELS[access] ?? "访问层级未知"].filter(Boolean).join(" · ")}</span>
                      {url ? <a href={url} target="_blank" rel="noreferrer">{title}</a> : <strong>{title}</strong>}
                      <p className={longSummary && !expanded ? "is-collapsed" : ""}>{summary}</p>
                      {longSummary ? (
                        <button
                          className="rawb-source-list__toggle"
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => setExpandedEvidenceIds((current) => {
                            const next = new Set(current);
                            if (next.has(itemKey)) next.delete(itemKey);
                            else next.add(itemKey);
                            return next;
                          })}
                        >
                          {expanded ? "收起摘要" : "展开摘要"}
                        </button>
                      ) : null}
                      {limitations[0] ? <small className="rawb-source-list__limit">限制：{limitations[0]}</small> : null}
                    </div>
                    <small>{firstText(item?.pmid && `PMID ${item.pmid}`, item?.doi) ?? "项目材料"}</small>
                  </li>
                );
              })}
            </ol>
            {evidence.length > EVIDENCE_PREVIEW_LIMIT ? (
              <button
                className="rawb-expand-button"
                type="button"
                aria-expanded={showAllEvidence}
                aria-controls={evidenceListId}
                onClick={() => setShowAllEvidence((open) => !open)}
              >
                {showAllEvidence ? "收起材料" : `展开全部 ${evidence.length} 条材料`}
              </button>
            ) : null}
          </>
        ) : <div className="rawb-soft-empty">检索开始后，这里会按实际访问层级列出材料。</div>}
      </section>
    </div>
  );
}

function WritingPanel({ project }) {
  const writing = project?.writingReview ?? project?.writingVerification ?? project?.claimAudit ?? {};
  const claims = asCollection(writing.claims ?? writing.claimUnits ?? project?.claimUnits);
  const issues = asCollection(writing.issues ?? writing.warnings ?? project?.writingIssues);
  const verified = claims.filter((claim) => ["verified", "supported", "passed"].includes(claim?.status)).length;
  const currentPhaseIndex = phaseIndexForProject(project);

  return (
    <div className="rawb-writing-layout">
      <section className="rawb-writing-intro">
        <div>
          <p className="rawb-eyebrow">逐条主张，而不是一次生成全文</p>
          <h2>写作核查台</h2>
          <p>每个实质性主张都要说明由什么来源支持、访问到了哪一层，以及仍然不能推出什么。</p>
        </div>
      </section>

      {claims.length ? (
        <>
          <section className="rawb-writing-score" aria-label="写作核查进度">
            <div><strong>{claims.length}</strong><span>条写作单元</span></div>
            <div><strong>{verified}</strong><span>条已通过来源核查</span></div>
            <div><strong>{issues.length}</strong><span>个需要处理的问题</span></div>
          </section>
          <ol className="rawb-claim-list">
            {claims.map((claim, index) => {
              const status = firstText(claim?.status)?.toLowerCase() ?? "pending";
              const kind = firstText(claim?.kind)?.toLowerCase();
              const semanticStatus = status;
              const kindLabel = {
                factual: "事实句",
                interpretation: "解释句",
                transition: "衔接句",
              }[kind] ?? "句子";
              const statusLabel = ["verified", "supported", "passed"].includes(status)
                ? `${kindLabel} · 已逐句核查`
                : ["failed", "unsupported"].includes(status)
                  ? `${kindLabel} · 不被当前来源支持`
                  : `${kindLabel} · 等待来源核查`;
              return (
                <li key={firstText(claim?.id, claim?.claimId) ?? index}>
                  <span className={`rawb-claim-list__state is-${semanticStatus}`} aria-hidden="true" />
                  <div>
                    <strong>{firstText(claim?.text, claim?.claim, claim?.title) ?? `主张 ${index + 1}`}</strong>
                    <p>{firstText(claim?.verification, claim?.support, claim?.boundary, claim?.note) ?? "等待逐句来源核查。"}</p>
                  </div>
                  <small>{statusLabel}</small>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <div className="rawb-writing-empty">
          <strong>{currentPhaseIndex < 3 ? "还没到写作，不抢跑。" : "等待第一条可核查主张。"}</strong>
          <p>{currentPhaseIndex < 3 ? "先把问题、证据和论证结构做稳，写作台会在进入第四个研究时期后启用。" : "Agent 生成候选主张后，这里会显示来源支持和边界检查。"}</p>
        </div>
      )}

      {issues.length ? (
        <section className="rawb-issues" aria-labelledby="rawb-writing-issues-title">
          <h3 id="rawb-writing-issues-title">需要处理</h3>
          <ul>{issues.map((issue, index) => <li key={firstText(issue?.id) ?? index}>{firstText(issue?.message, issue?.description) ?? String(issue)}</li>)}</ul>
        </section>
      ) : null}
    </div>
  );
}

function RecordsPanel({ project }) {
  const events = asCollection(project?.events ?? project?.records ?? project?.history ?? project?.runLog);
  const decisions = asCollection(project?.decisionTimeline);
  const quality = project?.researchQualityMetrics;
  const runs = asCollection(project?.runs);
  const toolCalls = asCollection(project?.toolCalls ?? project?.tools);
  const combined = events.length
    ? events
    : [
        ...runs.map((run) => ({ ...run, type: run.type ?? `run_${run.status ?? "updated"}` })),
        ...toolCalls.map((call) => ({ ...call, type: call.type ?? `tool_${call.status ?? "updated"}` })),
      ];
  const ordered = combined.slice().sort((a, b) => {
    const aTime = new Date(a?.at ?? a?.createdAt ?? a?.timestamp ?? 0).getTime();
    const bTime = new Date(b?.at ?? b?.createdAt ?? b?.timestamp ?? 0).getTime();
    return bTime - aTime;
  });

  return (
    <div className="rawb-records-layout">
      <section className="rawb-records-note">
        <div><strong>过程可以追溯，但不把日志变成负担</strong><p>这里记录每轮执行、工具调用和人工决定。旧记录只追加，不用新结果覆盖。</p></div>
      </section>
      {quality ? (
        <section className="rawb-quality-pulse" aria-labelledby="rawb-quality-pulse-title">
          <div className="rawb-quality-pulse__heading">
            <div><p className="rawb-eyebrow">观察研究质量，不给科研打一个假总分</p><h2 id="rawb-quality-pulse-title">当前研究体检</h2></div>
          </div>
          <dl>
            <div><dt>{quality.retrieval?.stage === "final_library" ? "最终文献库来源" : "当前阶段候选来源"}</dt><dd>{quality.retrieval?.savedSources ?? 0}</dd></div>
            <div><dt>可见摘要</dt><dd>{quality.retrieval?.abstractAvailable ?? 0}</dd></div>
            <div><dt>尚未分类</dt><dd>{Math.round((quality.literatureMap?.unclassifiedRate ?? 0) * 100)}%</dd></div>
            <div><dt>已记录人工决定</dt><dd>{quality.responsibility?.humanDecisionCount ?? 0}</dd></div>
            <div><dt>逐句来源核查</dt><dd>{quality.verification?.checkedSentenceCount ?? 0}/{quality.verification?.checkableSentenceCount ?? quality.verification?.factualSentenceCount ?? 0}</dd></div>
          </dl>
          <p>{quality.interpretationBoundary}</p>
        </section>
      ) : null}
      <section className="rawb-decision-timeline" aria-labelledby="rawb-decision-timeline-title">
        <div className="rawb-decision-timeline__heading">
          <div><p className="rawb-eyebrow">先看取舍，再看机器日志</p><h2 id="rawb-decision-timeline-title">为什么研究走到这里</h2></div>
          <span>{decisions.length} 项关键决定</span>
        </div>
        {decisions.length ? (
          <ol>
            {decisions.slice(0, 24).map((decision, index) => (
              <li key={firstText(decision?.id) ?? index}>
                <div>
                  <strong>{firstText(decision?.title) ?? "研究决定"}</strong>
                  <span>{firstText(decision?.decision) ?? "已记录"} · {formatDate(decision?.at)}</span>
                </div>
                {firstText(decision?.reason) ? <p><b>当时为什么：</b>{decision.reason}</p> : null}
                {firstText(decision?.resolution) ? <p><b>后来如何解决：</b>{decision.resolution}</p> : null}
              </li>
            ))}
          </ol>
        ) : <div className="rawb-soft-empty">第一个人工决定或失败恢复发生后，这里会先保留“为什么”，再展示完整运行日志。</div>}
      </section>
      {combined.length ? (
        <details className="rawb-technical-log">
          <summary>展开完整运行与工具日志（{combined.length} 条）</summary>
          <ol className="rawb-timeline">
          {ordered.slice(0, 80).map((event, index) => {
            const toolName = firstText(event?.toolName, event?.tool?.name);
            const detail = firstText(event?.message, event?.summary, event?.reason, event?.details?.message);
            return (
              <li key={firstText(event?.id, event?.eventId, event?.hash) ?? index}>
                <span className="rawb-timeline__dot" aria-hidden="true" />
                <div>
                  <strong>{formatEventType(event?.type)}</strong>
                  {toolName ? <span>工具：{toolName}</span> : null}
                  {detail ? <p>{detail}</p> : null}
                </div>
                <time dateTime={event?.at ?? event?.createdAt ?? event?.timestamp}>{formatDate(event?.at ?? event?.createdAt ?? event?.timestamp)}</time>
              </li>
            );
          })}
          </ol>
        </details>
      ) : <div className="rawb-soft-empty">第一次运行开始后，研究记录会按时间出现在这里。</div>}
    </div>
  );
}

function LoadingWorkspace() {
  return (
    <div className="rawb-loading" role="status" aria-live="polite">
      <span className="rawb-loading__firefly" aria-hidden="true" />
      <strong>正在打开科研工作台…</strong>
      <p>同步项目、运行时和当前研究状态。</p>
    </div>
  );
}

export function ResearchAgentWorkbench({
  apiBase = "/api/research",
  fetchImpl = globalThis.fetch,
  initialProjectId = null,
  pollIntervalMs = 2000,
  onProjectChange,
}) {
  const base = useMemo(() => normalizeApiBase(apiBase), [apiBase]);
  const tabBaseId = useId();
  const titleInputRef = useRef(null);
  const briefRef = useRef(null);
  const lastBriefMarkerRef = useRef("");
  const selectedProjectIdRef = useRef(initialProjectId);
  const requestSequenceRef = useRef(0);
  const createIdempotencyKeyRef = useRef("");

  const [runtime, setRuntime] = useState(null);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [runtimeError, setRuntimeError] = useState("");
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId);
  const [project, setProject] = useState(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [projectLoading, setProjectLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionFeedback, setActionFeedback] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [activeTab, setActiveTab] = useState("task");
  const [createOpen, setCreateOpen] = useState(false);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [bootstrapRevision, setBootstrapRevision] = useState(0);
  const [createStep, setCreateStep] = useState("question");
  const [queryPreview, setQueryPreview] = useState(null);
  const [selectedQueryId, setSelectedQueryId] = useState("");
  const [createForm, setCreateForm] = useState({
    title: "",
    question: "",
    searchQuery: "",
    completionProfileId: "evidence_brief",
    constraints: "",
    sourceMaterials: "",
  });

  const request = useCallback(async (path, { method = "GET", body, signal, idempotencyKey } = {}) => {
    if (typeof fetchImpl !== "function") {
      throw new ResearchApiError("当前环境没有可用的网络请求能力。", { code: "FETCH_UNAVAILABLE" });
    }
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        signal,
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (requestError) {
      if (requestError?.name === "AbortError") throw requestError;
      throw new ResearchApiError("无法连接科研运行时，请确认本地服务仍在运行。", {
        code: "NETWORK_ERROR",
      });
    }

    const raw = await response.text();
    let payload = null;
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new ResearchApiError("科研接口返回了无法识别的数据。", {
          status: response.status,
          code: "INVALID_JSON",
        });
      }
    }
    if (!response.ok) {
      throw new ResearchApiError(
        firstText(payload?.message, payload?.error?.message, payload?.error) ?? `请求失败（${response.status}）`,
        {
          status: response.status,
          code: firstText(payload?.code, payload?.error?.code) ?? "REQUEST_FAILED",
          payload,
        },
      );
    }
    return payload;
  }, [base, fetchImpl]);

  const commitProject = useCallback((nextProject) => {
    if (!nextProject) return;
    const id = projectId(nextProject);
    if (id && selectedProjectIdRef.current && id !== selectedProjectIdRef.current) return;
    setProject(nextProject);
    setProjects((current) => mergeProjectList(current, nextProject));
  }, []);

  const loadProject = useCallback(async (id, { quiet = false, signal } = {}) => {
    if (!id) return null;
    const sequence = ++requestSequenceRef.current;
    if (!quiet) setProjectLoading(true);
    try {
      const payload = await request(`/projects/${encodeURIComponent(id)}`, { signal });
      const nextProject = projectFromPayload(payload);
      if (sequence === requestSequenceRef.current && selectedProjectIdRef.current === id) {
        commitProject(nextProject);
      }
      return nextProject;
    } finally {
      if (!quiet && sequence === requestSequenceRef.current) setProjectLoading(false);
    }
  }, [commitProject, request]);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    async function bootstrap() {
      setBootLoading(true);
      setRuntimeLoading(true);
      setError("");
      setRuntimeError("");
      const [runtimeResult, projectsResult] = await Promise.allSettled([
        request("/runtime", { signal: controller.signal }),
        request("/projects", { signal: controller.signal }),
      ]);
      if (disposed) return;

      if (runtimeResult.status === "fulfilled") {
        setRuntime(runtimeFromPayload(runtimeResult.value));
      } else if (runtimeResult.reason?.name !== "AbortError") {
        setRuntimeError(runtimeResult.reason?.message ?? "无法读取运行时信息。");
      }
      setRuntimeLoading(false);

      if (projectsResult.status === "rejected") {
        if (projectsResult.reason?.name !== "AbortError") {
          setError(projectsResult.reason?.message ?? "无法读取研究项目。");
          setBootLoading(false);
        }
        return;
      }

      const nextProjects = projectsFromPayload(projectsResult.value);
      setProjects(nextProjects);
      const requestedId = initialProjectId || projectId(nextProjects[0]);
      if (!requestedId) {
        selectedProjectIdRef.current = null;
        setSelectedProjectId(null);
        setProject(null);
        setBootLoading(false);
        return;
      }
      selectedProjectIdRef.current = requestedId;
      setSelectedProjectId(requestedId);
      try {
        await loadProject(requestedId, { quiet: true, signal: controller.signal });
      } catch (loadError) {
        if (loadError?.name !== "AbortError") setError(loadError?.message ?? "无法打开研究项目。");
      } finally {
        if (!disposed) setBootLoading(false);
      }
    }
    bootstrap();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [bootstrapRevision, initialProjectId, loadProject, request]);

  useEffect(() => {
    onProjectChange?.(project);
  }, [onProjectChange, project]);

  const status = projectStatus(project);
  const polling = Boolean(project && POLLING_STATUSES.has(status));

  useEffect(() => {
    if (!project) return;
    const id = projectId(project) ?? "unknown";
    const marker = firstText(project?.userBrief?.updateMarker)
      ?? `${project?.version ?? "0"}:${status}:${project?.currentNode?.id ?? "unknown"}`;
    const previous = lastBriefMarkerRef.current;
    lastBriefMarkerRef.current = `${id}:${marker}`;
    if (!previous || !previous.startsWith(`${id}:`) || polling) return;
    if (previous !== `${id}:${marker}`) {
      setActionFeedback(`阶段已更新：${firstText(project?.userBrief?.currentResearchPeriod, project?.currentTask?.userLabel) ?? "最新科研回报已就绪"}。`);
    }
  }, [polling, project, status]);

  useEffect(() => {
    if (!polling || !selectedProjectId) return undefined;
    let stopped = false;
    let timer = null;
    let controller = null;
    const delay = Math.max(800, Number(pollIntervalMs) || 2000);

    async function tick() {
      controller = new AbortController();
      try {
        await loadProject(selectedProjectId, { quiet: true, signal: controller.signal });
      } catch (pollError) {
        if (!stopped && pollError?.name !== "AbortError") {
          setError(pollError?.message ?? "刷新研究状态失败。");
        }
      }
      if (!stopped) timer = globalThis.setTimeout(tick, delay);
    }

    timer = globalThis.setTimeout(tick, delay);
    return () => {
      stopped = true;
      if (timer) globalThis.clearTimeout(timer);
      controller?.abort();
    };
  }, [loadProject, pollIntervalMs, polling, selectedProjectId]);

  useEffect(() => {
    if (!createOpen) return;
    const frame = globalThis.requestAnimationFrame?.(() => titleInputRef.current?.focus());
    return () => {
      if (frame) globalThis.cancelAnimationFrame?.(frame);
    };
  }, [createOpen]);

  const selectProject = useCallback(async (id) => {
    if (!id || id === selectedProjectIdRef.current) return;
    requestSequenceRef.current += 1;
    selectedProjectIdRef.current = id;
    setSelectedProjectId(id);
    setProject(null);
    setActiveTab("task");
    setCancelArmed(false);
    setError("");
    setActionFeedback("");
    try {
      await loadProject(id);
    } catch (loadError) {
      if (loadError?.name !== "AbortError") setError(loadError?.message ?? "无法打开研究项目。");
    }
  }, [loadProject]);

  const refreshSelectedProject = useCallback(async () => {
    setError("");
    if (!selectedProjectIdRef.current) {
      setBootstrapRevision((value) => value + 1);
      return;
    }
    try {
      await loadProject(selectedProjectIdRef.current);
    } catch (loadError) {
      if (loadError?.name !== "AbortError") setError(loadError?.message ?? "刷新失败。");
    }
  }, [loadProject]);

  const revealUserBrief = useCallback((message, { focus = true } = {}) => {
    setActionFeedback(message);
    if (!focus) return;
    globalThis.requestAnimationFrame?.(() => {
      briefRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      briefRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const handleViewEvidence = useCallback(() => {
    setActiveTab("evidence");
    setActionFeedback("已打开完整科研成果；阶段回报仍保留在主操作区下方。");
    globalThis.requestAnimationFrame?.(() => {
      globalThis.document?.querySelector(".rawb-tab-panel")?.focus({ preventScroll: false });
    });
  }, []);

  const performProjectAction = useCallback(async (action, body) => {
    const id = selectedProjectIdRef.current;
    if (!id) return;
    setBusyAction(action);
    setError("");
    requestSequenceRef.current += 1;
    try {
      const payload = await request(`/projects/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        body,
      });
      const returnedProject = projectFromPayload(payload);
      if (projectId(returnedProject)) commitProject(returnedProject);
      await loadProject(id, { quiet: true });
      const feedback = {
        run: "继续运行的请求已经提交；新的阶段边界出现后，本卡片会自动更新。",
        resume: "恢复请求已经写入；项目会从安全保存点继续。",
        pause: "项目已经停在安全保存点，现有研究记录不会丢失。",
        cancel: "本轮已经停止；原项目和已有研究记录仍然保留。",
      }[action] ?? "操作已经完成，阶段科研回报已更新。";
      revealUserBrief(feedback);
    } catch (actionError) {
      setError(actionError?.message ?? "当前操作没有完成，请稍后重试。");
    } finally {
      setBusyAction("");
      setCancelArmed(false);
    }
  }, [commitProject, loadProject, request, revealUserBrief]);

  const resetQueryPlanning = useCallback(() => {
    createIdempotencyKeyRef.current = "";
    setCreateStep("question");
    setQueryPreview(null);
    setSelectedQueryId("");
    setCreateForm((form) => ({ ...form, searchQuery: "" }));
  }, []);

  const handlePreviewQueries = useCallback(async (event) => {
    event.preventDefault();
    const question = normalizeResearchQuestionInput(createForm.question);
    if (!researchQuestionCanPreview(question)) {
      setError("请至少输入 4 个字说明想研究的问题。中文问题可以直接开始。");
      return;
    }
    setBusyAction("query-preview");
    setError("");
    try {
      const preview = await request("/query-preview", {
        method: "POST",
        body: { question, sampleLimit: 3 },
      });
      const candidates = asArray(preview?.candidates);
      const selectable = candidates.find((candidate) => candidate?.status === "ready") ?? candidates[0];
      if (!selectable) throw new ResearchApiError("没有生成可检查的检索候选。", { code: "EMPTY_QUERY_PLAN" });
      setQueryPreview(preview);
      setSelectedQueryId(selectable.id);
      setCreateForm((form) => ({
        ...form,
        title: form.title.trim() || question.replace(/[？?。.!！]+$/g, "").slice(0, 42),
        searchQuery: selectable.query ?? "",
      }));
      setCreateStep("calibration");
    } catch (previewError) {
      setError(previewError?.message ?? "检索预演没有完成，请保留当前问题后重试。");
    } finally {
      setBusyAction("");
    }
  }, [createForm.question, request]);

  const handleRecalibrateQueries = useCallback(async () => {
    const query = createForm.searchQuery.trim();
    if (query.length < 3) {
      setError("修改后的 PubMed 检索式至少需要 3 个字符。");
      return;
    }
    setBusyAction("query-preview");
    setError("");
    try {
      const selected = asArray(queryPreview?.candidates).find((candidate) => candidate.id === selectedQueryId);
      const alternate = asArray(queryPreview?.candidates).find((candidate) => candidate.id !== selectedQueryId);
      const preview = await request("/query-preview", {
        method: "POST",
        body: {
          question: createForm.question.trim(),
          sampleLimit: 3,
          candidateQueries: [
            {
              id: "researcher_edited",
              label: "研究者修订版",
              strategy: "由研究者手动修改，并重新执行真实 PubMed 试检。",
              query,
            },
            {
              id: alternate?.id ?? "comparison_baseline",
              label: alternate?.label ?? "原候选对照",
              strategy: alternate?.strategy ?? selected?.strategy ?? "保留一个原候选用于比较。",
              query: alternate?.query ?? selected?.query ?? query,
            },
          ],
        },
      });
      setQueryPreview(preview);
      setSelectedQueryId("researcher_edited");
      setCreateForm((form) => ({ ...form, searchQuery: preview.candidates[0].query }));
    } catch (previewError) {
      setError(previewError?.message ?? "修订检索式没有完成真实试检，请继续在本步修改。");
    } finally {
      setBusyAction("");
    }
  }, [createForm.question, createForm.searchQuery, queryPreview, request, selectedQueryId]);

  const handleCreate = useCallback(async (event) => {
    event.preventDefault();
    const title = createForm.title.trim();
    const question = normalizeResearchQuestionInput(createForm.question);
    const searchQuery = createForm.searchQuery.trim();
    if (title.length < 2 || !researchQuestionCanPreview(question) || searchQuery.length < 3) {
      setError("请写清项目名称、研究问题，并填写至少 3 个字符的 PubMed 英文检索式。");
      return;
    }
    setBusyAction("create");
    setError("");
    if (!createIdempotencyKeyRef.current) {
      createIdempotencyKeyRef.current = globalThis.crypto?.randomUUID?.()
        ?? `create-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    try {
      const payload = await request("/projects", {
        method: "POST",
        idempotencyKey: createIdempotencyKeyRef.current,
        body: buildResearchWorkbenchCreatePayload({
          form: createForm,
          queryPreview,
          selectedQueryId,
        }),
      });
      const created = projectFromPayload(payload);
      const id = projectId(created) ?? firstText(unwrapData(payload)?.projectId);
      if (!id) throw new ResearchApiError("项目已经提交，但接口没有返回项目编号。", { code: "MISSING_PROJECT_ID" });
      selectedProjectIdRef.current = id;
      setSelectedProjectId(id);
      setProjects((current) => mergeProjectList(current, created ?? { id, title, question }));
      setCreateForm({
        title: "",
        question: "",
        searchQuery: "",
        completionProfileId: "evidence_brief",
        constraints: "",
        sourceMaterials: "",
      });
      createIdempotencyKeyRef.current = "";
      setCreateStep("question");
      setQueryPreview(null);
      setSelectedQueryId("");
      setCreateOpen(false);
      setActiveTab("task");
      if (created && projectId(created)) commitProject(created);
      await loadProject(id, { quiet: true });
      revealUserBrief("新项目已经建立；第一份阶段科研回报已放在主操作区下方。");
    } catch (createError) {
      const failedProject = createError?.project;
      const failedId = firstText(createError?.projectId, projectId(failedProject));
      if (failedId) {
        selectedProjectIdRef.current = failedId;
        setSelectedProjectId(failedId);
        setProjects((current) => mergeProjectList(
          current,
          failedProject ?? { id: failedId, title, question, status: "paused" },
        ));
        setCreateOpen(false);
        setActiveTab("task");
        if (failedProject) commitProject(failedProject);
        try {
          await loadProject(failedId, { quiet: true });
        } catch {
          // The structured failure snapshot remains usable even if this refresh fails.
        }
      }
      setError(createError?.message ?? "项目创建失败，请检查输入后重试。");
    } finally {
      setBusyAction("");
    }
  }, [commitProject, createForm, loadProject, request, revealUserBrief]);

  const handleRetrySearch = useCallback(async (searchQuery) => {
    const id = selectedProjectIdRef.current;
    if (!id || searchQuery.trim().length < 3) {
      setError("请填写至少 3 个字符的 PubMed 英文检索式。");
      return;
    }
    setBusyAction("retry-search");
    setError("");
    requestSequenceRef.current += 1;
    try {
      const payload = await request(`/projects/${encodeURIComponent(id)}/retry-search`, {
        method: "POST",
        body: { searchQuery: searchQuery.trim() },
      });
      const returnedProject = projectFromPayload(payload);
      if (projectId(returnedProject)) commitProject(returnedProject);
      await loadProject(id, { quiet: true });
      revealUserBrief("新的检索结果已经写入，证据边界与下一步已更新。");
    } catch (retryError) {
      if (retryError?.project && projectId(retryError.project)) commitProject(retryError.project);
      setError(retryError?.message ?? "重新检索没有完成，请修改检索式后重试。");
    } finally {
      setBusyAction("");
    }
  }, [commitProject, loadProject, request, revealUserBrief]);

  const handleRetrySameProtocol = useCallback(async (blockerId) => {
    await performProjectAction("resume", {
      blockerId,
      reason: "研究者已检查失败原因，确认当前检索协议不变，并要求从安全保存点按原式重试。",
    });
  }, [performProjectAction]);

  const handleReviseProtocol = useCallback(async ({
    blockerId,
    revisedQuery,
    reason,
    explicitRevision = false,
  }) => {
    const id = selectedProjectIdRef.current;
    if (!id || revisedQuery.trim().length < 3 || reason.trim().length < 8) {
      setError("请填写新版 PubMed 检索式，并用至少 8 个字符说明方法修订理由。");
      return;
    }
    setBusyAction("revise-retrieval-protocol");
    setError("");
    requestSequenceRef.current += 1;
    try {
      const payload = await request(`/projects/${encodeURIComponent(id)}/revise-retrieval-protocol`, {
        method: "POST",
        body: {
          blockerId,
          revisedQuery: revisedQuery.trim(),
          reason: reason.trim(),
          explicitRevision,
        },
      });
      const returnedProject = projectFromPayload(payload);
      if (projectId(returnedProject)) commitProject(returnedProject);
      await loadProject(id, { quiet: true });
      revealUserBrief("新版检索协议已经保存；阶段回报已切换到新的安全边界。");
    } catch (revisionError) {
      if (revisionError?.project && projectId(revisionError.project)) {
        commitProject(revisionError.project);
      }
      setError(revisionError?.message ?? "新版检索协议没有保存，请核对失败原因与检索式后重试。");
    } finally {
      setBusyAction("");
    }
  }, [commitProject, loadProject, request, revealUserBrief]);

  const gate = pendingGateForProject(project);
  const review = pendingReviewForProject(project);

  const handleGateDecision = useCallback(async (decision, reason) => {
    const id = selectedProjectIdRef.current;
    const gateId = firstText(gate?.id, gate?.gateId, gate?.nodeId);
    if (!id || !gateId) {
      setError("当前决定点缺少可写入的编号，请刷新项目后重试。");
      return;
    }
    setBusyAction("gate-decision");
    setError("");
    requestSequenceRef.current += 1;
    try {
      const payload = await request(`/projects/${encodeURIComponent(id)}/gates/${encodeURIComponent(gateId)}/decision`, {
        method: "POST",
        body: {
          decision,
          reason,
          gateFingerprint: firstText(gate?.gateFingerprint, gate?.fingerprint, gate?.materialFingerprint),
        },
      });
      const returnedProject = projectFromPayload(payload);
      if (projectId(returnedProject)) commitProject(returnedProject);
      await loadProject(id, { quiet: true });
      revealUserBrief("你的研究决定已经记录；本轮回报和下一步已同步更新。");
    } catch (decisionError) {
      setError(decisionError?.message ?? "人工决定没有写入，请重试。");
    } finally {
      setBusyAction("");
    }
  }, [commitProject, gate, loadProject, request, revealUserBrief]);

  const handleReviewDecision = useCallback(async (decision, reason) => {
    const id = selectedProjectIdRef.current;
    const nodeId = firstText(review?.nodeId, review?.id, review?.reviewId);
    if (!id || !nodeId) {
      setError("当前复核项缺少节点编号，请刷新项目后重试。");
      return;
    }
    setBusyAction("review-decision");
    setError("");
    requestSequenceRef.current += 1;
    try {
      const payload = await request(`/projects/${encodeURIComponent(id)}/reviews/${encodeURIComponent(nodeId)}/decision`, {
        method: "POST",
        body: {
          decision,
          reason,
          artifactIds: asCollection(review?.artifacts ?? review?.outputs)
            .map((artifact) => firstText(artifact?.artifactId, artifact?.id))
            .filter(Boolean),
          materialFingerprint: firstText(review?.materialFingerprint, review?.fingerprint),
        },
      });
      const returnedProject = projectFromPayload(payload);
      if (projectId(returnedProject)) commitProject(returnedProject);
      await loadProject(id, { quiet: true });
      revealUserBrief("人工复核结果已经记录；最新阶段回报已就位。");
    } catch (decisionError) {
      setError(decisionError?.message ?? "复核意见没有写入，请重试。");
    } finally {
      setBusyAction("");
    }
  }, [commitProject, loadProject, request, revealUserBrief, review]);

  const contentMaturity = project?.contentMaturity && typeof project.contentMaturity === "object"
    ? project.contentMaturity
    : {};
  const processDraft = firstText(contentMaturity.code)?.toLowerCase() === "guided_draft";
  const formalResearchComplete = contentMaturity.formalResearchComplete === true;
  const maturityLabel = firstText(contentMaturity.label);
  const blockerRetryClass = firstText(project?.blocker?.retryClass);

  const primaryAction = useMemo(() => {
    if (!project) return { label: "开始一个研究项目", kind: "create", disabled: false };
    if (gate) return { label: "先完成这项研究决定", kind: "decision", disabled: false };
    if (review) return { label: "先完成人工复核", kind: "decision", disabled: false };
    if (status === "paused") return { label: "恢复 Agent", kind: "resume", disabled: busyAction !== "" };
    if (status === "blocked" && blockerRetryClass === "protocol_revision_required") {
      return { label: "请先修订检索协议", kind: "recovery", disabled: false };
    }
    if (status === "blocked" && blockerRetryClass === "same_protocol_retry") {
      return { label: "请确认后按原式重试", kind: "recovery", disabled: false };
    }
    if (status === "blocked" && blockerRetryClass === "human_review_required") {
      return { label: "请先判断恢复方式", kind: "recovery", disabled: false };
    }
    if (status === "blocked") return { label: "已检查问题，恢复 Agent", kind: "resume", disabled: busyAction !== "" };
    if (POLLING_STATUSES.has(status)) return { label: "Agent 正在推进…", kind: "busy", disabled: true };
    if (status === "completed") return { label: "查看阶段科研回报", kind: "result", disabled: false };
    if (status === "cancelled") return { label: "基于原问题新建研究", kind: "restart", disabled: false };
    if (["awaiting_approval", "awaiting_gate", "awaiting_review"].includes(status)) {
      return { label: "刷新待决定材料", kind: "refresh", disabled: busyAction !== "" };
    }
    return { label: "让 Agent 继续", kind: "run", disabled: busyAction !== "" };
  }, [blockerRetryClass, busyAction, gate, project, review, status]);

  const handlePrimaryAction = useCallback(() => {
    if (primaryAction.kind === "create") {
      setCreateOpen(true);
      return;
    }
    if (primaryAction.kind === "decision") {
      setActiveTab("task");
      globalThis.requestAnimationFrame?.(() => globalThis.document?.querySelector(".rawb-decision, .rawb-review")?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return;
    }
    if (primaryAction.kind === "recovery") {
      setActiveTab("task");
      globalThis.requestAnimationFrame?.(() => globalThis.document?.querySelector(".rawb-recovery")?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return;
    }
    if (primaryAction.kind === "result") {
      revealUserBrief("已定位到本轮最新的阶段科研回报。");
      return;
    }
    if (primaryAction.kind === "restart") {
      createIdempotencyKeyRef.current = "";
      setCreateStep("question");
      setQueryPreview(null);
      setSelectedQueryId("");
      setCreateForm({
        title: `${firstText(project?.title) ?? "研究项目"} · 新一轮`,
        question: firstText(project?.question) ?? "",
        searchQuery: "",
        completionProfileId: firstText(project?.completionProfileId) ?? "evidence_brief",
        constraints: typeof project?.constraints === "string" ? project.constraints : "",
        sourceMaterials: "",
      });
      setCreateOpen(true);
      return;
    }
    if (primaryAction.kind === "refresh") {
      refreshSelectedProject()
        .then(() => revealUserBrief("待决定材料已经刷新，请在当前任务区继续处理。"))
        .catch(() => {});
      return;
    }
    if (primaryAction.kind === "resume") {
      performProjectAction("resume", {
        reason: status === "blocked"
          ? "研究者已查看当前阻塞原因，并明确要求恢复执行。"
          : "研究者从工作台恢复当前项目。",
      });
      return;
    }
    if (primaryAction.kind === "run") {
      performProjectAction("run", {
        reason: "研究者要求 Agent 继续当前允许的下一步。",
        expectedVersion: project?.version ?? project?.projection?.version,
      });
    }
  }, [performProjectAction, primaryAction.kind, project, refreshSelectedProject, revealUserBrief, status]);

  const companionMessage = useMemo(() => {
    if (gate) return "这一步会改变后续研究边界。我已经把理由放在下面，决定权交给你。";
    if (review) return "候选产物已经准备好。请看内容是否达到本步标准，再决定接受还是修订。";
    if (POLLING_STATUSES.has(status)) return "我正在处理当前工作单。你可以离开这个页面，研究记录会持续保留。";
    if (status === "paused") return "项目停在安全位置，没有丢失进度。准备好后再让我继续。";
    if (status === "cancelled") return "本轮已经停止，原项目和研究记录仍被保留。继续研究时请基于原问题建立新项目。";
    if (status === "completed") {
      if (formalResearchComplete) return "约定的研究目标已经走完。现在看到的是已经冻结、可以追溯的交付版本。";
      if (processDraft) return `本轮研究目标已经到达终点。当前内容等级是“${maturityLabel ?? "结构化流程草案"}”，请按标注边界使用。`;
      return `本轮研究目标已经到达终点。当前内容等级是“${maturityLabel ?? "研究成果"}”，请按证据边界继续核查。`;
    }
    if (["failed", "blocked"].includes(status)) return "这一步没有硬闯过去。先看清问题，再从同一个安全位置继续。";
    return "状态机已经选好下一步。你只需要决定：现在要不要让 Agent 开始。";
  }, [formalResearchComplete, gate, maturityLabel, processDraft, review, status]);

  const currentPhase = RESEARCH_PHASES[Math.min(phaseIndexForProject(project), RESEARCH_PHASES.length - 1)];
  const selectedCompletionProfile = COMPLETION_PROFILES.find(
    (candidate) => candidate.id === project?.completionProfileId,
  );
  const formValid =
    createForm.title.trim().length >= 2 &&
    researchQuestionCanPreview(createForm.question) &&
    createForm.searchQuery.trim().length >= 3 &&
    asArray(queryPreview?.candidates).some((candidate) =>
      candidate.id === selectedQueryId &&
      candidate.status === "ready" &&
      candidate.query === createForm.searchQuery.trim()
    );
  const previewQuestionReady = researchQuestionCanPreview(createForm.question);

  return (
    <div className={`research-agent-workbench${createOpen && createStep === "calibration" ? " is-planning-search" : ""}`}>
      <a className="rawb-skip-link" href="#rawb-main">跳到当前研究</a>
      <header className="rawb-header">
        <div className="rawb-brand">
          <img className="rawb-brand__mark" src={evidenceFirefly} alt="" />
          <span><strong>科研工作台 · 证据综述</strong><small>真实检索 · Agent 执行 · 人类负责</small></span>
        </div>
        <RuntimeBadge runtime={runtime} loading={runtimeLoading} error={runtimeError} />
        <button className="rawb-new-button" type="button" onClick={() => {
          if (createOpen) resetQueryPlanning();
          setCreateOpen((open) => !open);
        }} aria-expanded={createOpen}>
          新研究
        </button>
      </header>

      <div className="rawb-shell">
        <aside className="rawb-project-rail" aria-label="研究项目">
          <div className="rawb-project-rail__heading"><p>我的研究</p><span>{projects.length}</span></div>
          {createOpen ? (
            <form
              className={`rawb-create-form${createStep === "calibration" ? " is-calibration" : ""}`}
              onSubmit={createStep === "question" ? handlePreviewQueries : handleCreate}
              aria-label={createStep === "question" ? "从研究问题开始" : "比较并确认 PubMed 检索"}
            >
              <div className="rawb-create-form__heading">
                <div><small>{createStep === "question" ? "第 1 步 / 2" : "第 2 步 / 2"}</small><strong>{createStep === "question" ? "先说研究问题" : "比较真实试检"}</strong></div>
                <button type="button" onClick={() => { setCreateOpen(false); resetQueryPlanning(); }}>关闭</button>
              </div>
              {createStep === "question" ? (
                <>
                  <p className="rawb-create-form__intro">不需要先会写英文检索式。系统会给出可比较的起始方案，真实试检后再由你选择。</p>
                  <label htmlFor="rawb-project-question">真正想研究的问题</label>
                  <textarea
                    ref={titleInputRef}
                    id="rawb-project-question"
                    value={createForm.question}
                    onChange={(event) => setCreateForm((form) => ({ ...form, question: event.target.value }))}
                    placeholder="例如：围术期睡眠与术后恢复之间有什么关系？"
                    rows={5}
                    maxLength={1200}
                    required
                  />
                  <p className={`rawb-create-form__readiness${previewQuestionReady ? " is-ready" : ""}`} aria-live="polite">
                    {previewQuestionReady
                      ? "可以开始真实试检"
                      : "至少输入 4 个字，按钮就会启用"}
                  </p>
                  <button className="rawb-create-submit" type="submit" disabled={busyAction === "query-preview"}>
                    {busyAction === "query-preview" ? "正在真实试检…" : "生成并试检方案"}
                  </button>
                  <p className="rawb-create-form__help">这一步只检索 PubMed 题录与可用摘要，不会创建项目，也不会替你通过人工决定。</p>
                </>
              ) : (
                <>
                  <div className="rawb-query-plan__question"><span>研究问题</span><strong>{createForm.question}</strong></div>
                  <div className="rawb-query-plan__notice">
                    <strong>词汇映射只是可检查的起点</strong>
                    <p>{queryPreview?.planner?.claim}</p>
                    {asArray(queryPreview?.mappings).length ? <p>已识别：{asArray(queryPreview.mappings).map((item) => `${item.sourceTerm} → ${asArray(item.mappedTerms).join(" / ")}`).join("；")}</p> : null}
                    {asArray(queryPreview?.unknownChinese).length ? <p className="is-warning">未可靠映射：{asArray(queryPreview.unknownChinese).join("、")}。系统没有擅自补写英文含义，请你重点检查。</p> : null}
                  </div>
                  <fieldset className="rawb-query-candidates">
                    <legend>选择一个已真实试检的版本</legend>
                    {asArray(queryPreview?.candidates).map((candidate) => {
                      const selected = candidate.id === selectedQueryId;
                      return (
                        <label key={candidate.id} className={`rawb-query-candidate${selected ? " is-selected" : ""}${candidate.status !== "ready" ? " is-unavailable" : ""}`}>
                          <span className="rawb-query-candidate__top">
                            <input
                              type="radio"
                              name="query-candidate"
                              value={candidate.id}
                              checked={selected}
                              disabled={candidate.status !== "ready"}
                              onChange={() => {
                                setSelectedQueryId(candidate.id);
                                setCreateForm((form) => ({ ...form, searchQuery: candidate.query }));
                              }}
                            />
                            <strong>{candidate.label}</strong>
                            <em>{candidate.status === "ready" ? `PubMed 命中 ${candidate.total}` : candidate.status === "zero_results" ? "0 条结果" : "试检失败"}</em>
                          </span>
                          <code>{candidate.query}</code>
                          <p>{candidate.strategy}</p>
                          {candidate.error ? <p className="is-error">{candidate.error.message}</p> : null}
                          {asArray(candidate.samples).length ? (
                            <details>
                              <summary>抽查当前排序前 {candidate.sampledCount} 条未筛选样本</summary>
                              <ol>{candidate.samples.map((sample) => <li key={sample.sourceId ?? sample.pmid}><span>{sample.accessLevel === "abstract_only" ? "题名+摘要" : "仅题名"}</span><strong>{sample.title}</strong>{sample.abstractSnippet ? <p>{sample.abstractSnippet}</p> : null}</li>)}</ol>
                            </details>
                          ) : <small>{candidate.boundary}</small>}
                        </label>
                      );
                    })}
                  </fieldset>
                  <p className="rawb-query-plan__boundary">{queryPreview?.accessBoundary} {queryPreview?.recallCheck?.boundary}</p>
                  <label htmlFor="rawb-project-search-query">专家可手动修改检索式</label>
                  <textarea
                    id="rawb-project-search-query"
                    value={createForm.searchQuery}
                    onChange={(event) => setCreateForm((form) => ({ ...form, searchQuery: event.target.value }))}
                    rows={3}
                    maxLength={2000}
                    required
                  />
                  {!formValid && createForm.searchQuery.trim().length >= 3 ? <p className="rawb-create-form__help is-warning">检索式已改变；请先重新试检，不能用旧命中量创建项目。</p> : null}
                  <div className="rawb-query-plan__actions">
                    <button type="button" onClick={resetQueryPlanning}>返回改问题</button>
                    <button type="button" onClick={handleRecalibrateQueries} disabled={busyAction === "query-preview"}>{busyAction === "query-preview" ? "正在试检…" : "重新试检当前式"}</button>
                  </div>
                  <details className="rawb-query-plan__advanced">
                    <summary>项目名称、约束与已有材料</summary>
                    <label htmlFor="rawb-project-title">项目名称</label>
                    <input id="rawb-project-title" value={createForm.title} onChange={(event) => setCreateForm((form) => ({ ...form, title: event.target.value }))} maxLength={120} required />
                    <fieldset className="rawb-completion-profiles">
                      <legend>这轮研究做到哪里</legend>
                      {COMPLETION_PROFILES.map((profile) => (
                        <label key={profile.id}>
                          <input
                            type="radio"
                            name="completion-profile"
                            value={profile.id}
                            checked={createForm.completionProfileId === profile.id}
                            onChange={() => setCreateForm((form) => ({
                              ...form,
                              completionProfileId: profile.id,
                            }))}
                          />
                          <span><strong>{profile.label}</strong><small>{profile.description}</small></span>
                        </label>
                      ))}
                    </fieldset>
                    <label htmlFor="rawb-project-constraints">约束与禁止项 <span>可选</span></label>
                    <textarea id="rawb-project-constraints" value={createForm.constraints} onChange={(event) => setCreateForm((form) => ({ ...form, constraints: event.target.value }))} placeholder="时间范围、数据库、语言、不能做的推断…" rows={3} maxLength={2000} />
                    <label htmlFor="rawb-project-materials">已有材料 <span>可选补充</span></label>
                    <textarea id="rawb-project-materials" value={createForm.sourceMaterials} onChange={(event) => setCreateForm((form) => ({ ...form, sourceMaterials: event.target.value }))} placeholder="粘贴 DOI、PMID、网址或材料说明，每行一条。" rows={3} maxLength={8000} />
                  </details>
                  <button className="rawb-create-submit" type="submit" disabled={!formValid || busyAction === "create"}>
                    {busyAction === "create" ? "正在建立研究…" : "采用这个检索并建立研究"}
                  </button>
                  <p className="rawb-create-form__help">建项后只会推进到首个人工决定点；系统不会自动批准研究范围。</p>
                </>
              )}
            </form>
          ) : null}

          {projects.length ? (
            <ul className="rawb-project-list">
              {projects.map((item) => {
                const id = projectId(item);
                const itemStatus = projectStatus(item);
                const itemPhaseIndex = phaseIndexForProject(item);
                const completedProfile = COMPLETION_PROFILES.find(
                  (candidate) => candidate.id === item?.completionProfileId,
                );
                const phaseLabel = itemStatus === "completed"
                  ? completedProfile?.label ?? "研究交付"
                  : RESEARCH_PHASES[itemPhaseIndex]?.label;
                const itemStatusLabel =
                  itemStatus === "completed" && item?.contentMaturity?.code === "guided_draft"
                    ? "流程演练已完成"
                    : STATUS_LABELS[itemStatus] ?? itemStatus;
                return (
                  <li key={id ?? firstText(item?.title)}>
                    <button type="button" className={id === selectedProjectId ? "is-active" : ""} onClick={() => selectProject(id)} aria-current={id === selectedProjectId ? "true" : undefined}>
                      <strong>{firstText(item?.title, item?.name) ?? "未命名研究"}</strong>
                      <span>{phaseLabel}<i aria-hidden="true">·</i>{itemStatusLabel}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : !bootLoading ? <p className="rawb-project-rail__empty">还没有项目。先从一个好问题开始。</p> : null}
        </aside>

        <main id="rawb-main" className="rawb-main" aria-busy={bootLoading || projectLoading}>
          {error ? (
            <div className="rawb-error" role="alert">
              <div><strong>这一步没有完成</strong><p>{error}</p></div>
              <button type="button" onClick={refreshSelectedProject}>重试</button>
              <button type="button" className="rawb-error__dismiss" onClick={() => setError("")}>关闭</button>
            </div>
          ) : null}
          {runtimeError && !error ? <p className="rawb-runtime-warning" role="status">{runtimeError} 项目仍可继续查看。</p> : null}

          {bootLoading || (projectLoading && !project) ? <LoadingWorkspace /> : !project ? <EmptyState onCreate={() => setCreateOpen(true)} /> : (
            <>
              <ResearchProgress project={project} />
              <section className="rawb-project-hero" aria-labelledby="rawb-project-title-heading">
                <Companion active={POLLING_STATUSES.has(status)}>{companionMessage}</Companion>
                <div className="rawb-project-hero__copy">
                  <div className="rawb-project-hero__meta">
                    <span>{status === "completed"
                      ? selectedCompletionProfile?.label ?? "研究交付"
                      : currentPhase?.label ?? "研究准备"}</span>
                    <span className={`rawb-status is-${status}`}>{status === "completed" && processDraft ? "流程演练已完成" : STATUS_LABELS[status] ?? status}</span>
                  </div>
                  <h1 id="rawb-project-title-heading">{firstText(project?.title, project?.name) ?? "未命名研究"}</h1>
                  <p>{firstText(project?.question, project?.researchQuestion, project?.brief?.question) ?? "研究问题尚未记录。"}</p>
                  <p className="rawb-mode-boundary"><strong>当前模式：</strong>可审计的 PubMed 证据综述；候选方向必须经过单独验证，不能当作实验或分析结论。</p>
                </div>
                <div className="rawb-project-actions">
                  <button className="rawb-primary" type="button" onClick={handlePrimaryAction} disabled={primaryAction.disabled}>
                    {primaryAction.kind === "busy" ? <span className="rawb-button-spinner" aria-hidden="true" /> : null}
                    {primaryAction.label}
                  </button>
                  <div className="rawb-run-controls" aria-label="运行控制">
                    {POLLING_STATUSES.has(status) ? (
                      <button type="button" disabled={Boolean(busyAction)} onClick={() => performProjectAction("pause", { reason: "研究者从工作台暂停当前项目。" })}>暂停</button>
                    ) : null}
                    {!cancelArmed && (POLLING_STATUSES.has(status) || status === "paused") ? (
                      <button className="is-danger" type="button" disabled={Boolean(busyAction)} onClick={() => setCancelArmed(true)}>停止本轮</button>
                    ) : null}
                  </div>
                  {cancelArmed ? (
                    <div className="rawb-cancel-confirm" role="group" aria-label="确认停止当前运行">
                      <p>停止本轮，但保留项目和已有记录？</p>
                      <button type="button" onClick={() => performProjectAction("cancel", { reason: "研究者明确停止当前运行；保留项目与记录。" })}>确认停止</button>
                      <button type="button" onClick={() => setCancelArmed(false)}>返回</button>
                    </div>
                  ) : null}
                </div>
              </section>

              <ResearchUserBrief
                project={project}
                briefRef={briefRef}
                feedback={actionFeedback}
                onViewEvidence={handleViewEvidence}
              />

              <div className="rawb-tabs" role="tablist" aria-label="研究工作区">
                {WORKBENCH_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    id={`${tabBaseId}-${tab.id}-tab`}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    aria-controls={`${tabBaseId}-${tab.id}-panel`}
                    tabIndex={activeTab === tab.id ? 0 : -1}
                    onClick={() => setActiveTab(tab.id)}
                    onKeyDown={handleTabArrowNavigation}
                  >
                    {tab.label}
                    {tab.id === "task" && (gate || review) ? <span className="rawb-tabs__notice"><span className="rawb-visually-hidden">，有一项待处理</span></span> : null}
                  </button>
                ))}
              </div>

              <section
                className="rawb-tab-panel"
                id={`${tabBaseId}-${activeTab}-panel`}
                role="tabpanel"
                aria-labelledby={`${tabBaseId}-${activeTab}-tab`}
                tabIndex={0}
              >
                {activeTab === "task" ? (
                  <TaskPanel
                    project={project}
                    gate={gate}
                    review={review}
                    busy={Boolean(busyAction)}
                    onGateDecision={handleGateDecision}
                    onReviewDecision={handleReviewDecision}
                    onRetrySearch={handleRetrySearch}
                    onRetrySameProtocol={handleRetrySameProtocol}
                    onReviseProtocol={handleReviseProtocol}
                  />
                ) : null}
                {activeTab === "evidence" ? <EvidencePanel project={project} /> : null}
                {activeTab === "writing" ? <WritingPanel project={project} /> : null}
                {activeTab === "records" ? <RecordsPanel project={project} /> : null}
              </section>
            </>
          )}
        </main>
      </div>
      <div className="rawb-announcer rawb-visually-hidden" aria-live="polite" aria-atomic="true">
        {busyAction ? "正在处理当前操作" : polling ? "Agent 正在推进当前研究" : actionFeedback}
      </div>
    </div>
  );
}

export default ResearchAgentWorkbench;
