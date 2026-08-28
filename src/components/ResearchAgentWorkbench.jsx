import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import evidenceFirefly from "../assets/evidence-firefly-v1.png";
import { ResearchReviewReport } from "./ResearchReviewReport.jsx";
import { buildResearchReviewReportModel } from "./research-review-report-model.js";
import {
  firstRoundCheckpointFrom,
  loadScopingDraft,
  restoredFirstRoundState,
  saveScopingDraft,
} from "./research-scoping-draft.js";
import {
  buildResearchWorkbenchCalibrationPayload,
  buildResearchWorkbenchDirectionSelectionPayload,
  buildResearchWorkbenchReviewPreviewPayload,
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

const RESEARCH_JOURNEY = Object.freeze([
  {
    id: "intent",
    label: "研究意向",
    meaning: "先记录想研究的领域、粗问题与边界，不要求第一步就形成最终选题。",
    nodeIds: ["capture_intent", "clarify_question", "approve_scope"],
  },
  {
    id: "literature",
    label: "文献调研",
    meaning: "用真实检索认识领域、校准召回与噪声，形成可比较方向。",
    nodeIds: [
      "design_orientation_search",
      "run_pilot_search",
      "calibrate_search",
      "build_orientation_corpus",
    ],
  },
  {
    id: "topic",
    label: "选题确认",
    meaning: "在文献调研之后比较候选方向，由研究者锁定最终目标选题。",
    nodeIds: ["profile_landscape", "approve_review_angle"],
  },
  {
    id: "analysis",
    label: "领域分析",
    meaning: "围绕确认后的选题精准检索、冻结文献库、提取证据并核查边界。",
    nodeIds: [
      "design_focused_search",
      "calibrate_focused_search",
      "freeze_library",
      "extract_evidence",
      "seek_counterevidence",
      "synthesize_claims",
      "verify_evidence",
      "approve_evidence_boundary",
    ],
  },
  {
    id: "structure",
    label: "文章结构",
    meaning: "让已核查证据形成论证树、文章结构与图表计划。",
    nodeIds: ["derive_outline", "stress_test_outline", "approve_outline"],
  },
  {
    id: "execution",
    label: "执行与结果",
    meaning: "完成综述写作、逐句核查、全文审计与交付；不冒充实验或临床实施。",
    nodeIds: [
      "write_claim_units",
      "verify_claim_units",
      "approve_claim_units",
      "assemble_manuscript",
      "audit_manuscript",
      "prepare_delivery",
      "author_signoff",
    ],
  },
]);

const JOURNEY_PROFILE_ENDPOINTS = Object.freeze({
  evidence_brief: 3,
  evidence_outline: 4,
  audited_review: 5,
});

const WORKBENCH_TABS = Object.freeze([
  { id: "task", label: "领域简报" },
  { id: "evidence", label: "证据来源" },
  { id: "writing", label: "综述写作" },
  { id: "records", label: "技术审计" },
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
const RECOMMENDED_QUERY_CANDIDATE_IDS = new Set([
  "single_comprehensive",
  "matrix_ab",
  "matrix_abc",
  "matrix_all",
]);

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

function researcherFacingCriteria(value) {
  const internalCriterion = /真实用户|决定理由被记录|明确作出|Agent|状态机|工作单|节点编号|指纹|哈希|校验码|版本绑定/;
  return asArray(value)
    .map((item) => String(item).trim())
    .filter((item) => item && !internalCriterion.test(item));
}

function queryPlanExecutionLabel(status) {
  if (status === "completed") return "专业检索策略已生成 · 已完成模型扩词";
  if (status === "baseline_completed") return "专业检索策略初稿已生成";
  if (status === "baseline_completed_after_model_failure") return "专业检索策略初稿已生成 · 模型扩词未完成";
  return "检索策略状态待核对";
}

function queryPlanExecutionIsWarning(status) {
  return status === "baseline_completed_after_model_failure" || !status;
}

function queryPlanReviewHint(status) {
  if (status === "baseline_completed_after_model_failure") {
    return "模型扩词未完成，当前保留了可审核的专业词群；请重点检查遗漏词项。";
  }
  return "请重点核对医学词项、排除项和字段限制；可在下方直接修订。";
}

function asCollection(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function firstText(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim();
}

const FRONTSTAGE_INTERNAL_LANGUAGE = /Agent|安全保存点|安全边界|阶段边界|人工边界|内部执行状态|计划指纹|方向选择指纹|内容指纹|来源集合指纹|哈希|校验码|本机检查点|科研运行时|接口返回/;

export function researcherFacingErrorMessage(error) {
  const raw = firstText(error?.message, typeof error === "string" ? error : null) ?? "";
  const code = firstText(error?.code, error?.payload?.code)?.toUpperCase() ?? "";

  if (code === "PUBMED_NO_RESULTS" || /PubMed.*(?:零结果|未返回结果)/i.test(raw)) {
    return "本次 PubMed 检索未返回结果，请修改检索式后重试。";
  }
  if (/^PUBMED_/.test(code)) {
    return "PubMed 本次检索未完成；已有材料不受影响，请稍后重试。";
  }
  if (/QUERY_.*(?:REQUIRED|INCOMPLETE)/.test(code)) {
    return "当前检索准备材料不完整，请重新完成本步检索校准。";
  }
  if (["NETWORK_ERROR", "INVALID_JSON", "FETCH_UNAVAILABLE"].includes(code)) {
    return "当前无法更新研究材料；已有简报仍可查看，详细原因见“技术审计”。";
  }
  if (
    /(?:STALE|FINGERPRINT|HASH|BIND|MISMATCH|CONFLICT)/.test(code) ||
    FRONTSTAGE_INTERNAL_LANGUAGE.test(raw) ||
    /(?:必须绑定|绑定当前|可写入的编号)/.test(raw)
  ) {
    return "当前研究材料与最新记录不一致，请刷新后重新核对；详细原因见“技术审计”。";
  }
  return raw || "当前研究请求没有完成，请核对输入与证据范围后重试。";
}

function researcherFacingBlockerText(project) {
  const blocker = project?.blocker && typeof project.blocker === "object"
    ? project.blocker
    : null;
  const retryClass = firstText(blocker?.retryClass);
  if (retryClass === "protocol_revision_required") {
    return "当前检索式未获得可分析结果，需要检查主题词、同义词、字段限制或研究范围。";
  }
  if (retryClass === "same_protocol_retry") {
    return "检索服务暂时未完成请求；当前检索式可以保留并重试。";
  }
  if (retryClass === "human_review_required") {
    return "现有信息不足以判断问题来自检索式还是检索服务，需要核对后选择重试或修订。";
  }
  const raw = firstText(blocker?.reason, blocker?.message, typeof project?.blocker === "string" ? project.blocker : null);
  return raw && !FRONTSTAGE_INTERNAL_LANGUAGE.test(raw)
    ? raw
    : "当前研究材料需要重新核对后再继续。";
}

export function researcherFacingNextDecision(project) {
  const gate = pendingGateForProject(project);
  if (gate) return `请确认「${firstText(gate.userLabel, gate.label) ?? "当前研究范围"}」；确认后继续下一项科研工作。`;
  const review = pendingReviewForProject(project);
  if (review) return `请复核「${firstText(review.userLabel, review.label) ?? "当前研究材料"}」，并选择接受或要求修订。`;

  const currentNodeId = currentNodeIdForProject(project);
  if (currentNodeId === "approve_scope") {
    return "先确认研究范围，再用真实文献回答领域现状、主要问题与选题机会。";
  }

  const status = projectStatus(project);
  if (status === "completed") return "查看完整科研成果，并按已记录的证据边界解释和使用。";
  if (status === "cancelled") return "如需继续，请基于原研究问题建立新一轮文献调研。";
  if (status === "paused") return "核对当前研究问题、检索式与已保存材料，决定继续、修订或结束本轮。";
  if (status === "blocked") return `${researcherFacingBlockerText(project)} 请据此选择重试或修订。`;
  if (POLLING_STATUSES.has(status)) return "研究材料正在更新；形成新的可核查依据后，再判断下一项需要补证的问题。";

  const candidate = firstText(
    project?.userBrief?.nextStepOrUserDecision,
    project?.summary?.nextDecision,
    project?.currentTask?.userLabel,
  );
  return candidate && !FRONTSTAGE_INTERNAL_LANGUAGE.test(candidate)
    ? candidate
    : "根据当前证据决定下一项需要核查的科研问题。";
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

function currentNodeIdForProject(project) {
  return firstText(
    project?.currentTask?.nodeId,
    project?.currentWorkOrder?.nodeId,
    project?.currentNode?.id,
    project?.currentNodeId,
    project?.projection?.currentTask?.nodeId,
    project?.projection?.currentNode?.id,
    project?.pendingGate?.nodeId,
    project?.pendingReview?.nodeId,
  );
}

function journeyIndexForProject(project) {
  const nodeId = currentNodeIdForProject(project);
  const explicitIndex = RESEARCH_JOURNEY.findIndex((stage) => stage.nodeIds.includes(nodeId));
  if (explicitIndex >= 0) return explicitIndex;

  const phaseId = phaseIdForProject(project);
  const fallback = {
    question_formation: 0,
    literature_research: 1,
    argument_design: 4,
    writing_and_verification: 5,
    delivery: 5,
  }[phaseId];
  return Number.isFinite(fallback) ? fallback : 0;
}

function journeyEndpointForProject(project) {
  return JOURNEY_PROFILE_ENDPOINTS[project?.completionProfileId] ?? RESEARCH_JOURNEY.length - 1;
}

function journeyStageState(project, index) {
  const currentIndex = journeyIndexForProject(project);
  const endpoint = journeyEndpointForProject(project);
  if (index > endpoint) return "excluded";
  if (projectStatus(project) === "completed") return index <= endpoint ? "complete" : "excluded";
  if (index < currentIndex) return "complete";
  if (index === currentIndex) return "active";
  return "upcoming";
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
  const activeIndex = journeyIndexForProject(project);
  const activeStage = RESEARCH_JOURNEY[activeIndex] ?? RESEARCH_JOURNEY[0];
  const nodeId = currentNodeIdForProject(project);
  return (
    <nav className="rawb-progress rawb-journey" aria-label="科研工作旅程">
      <div className="rawb-journey__heading">
        <div>
          <span>当前研究路径</span>
          <strong>{activeStage.label}</strong>
        </div>
        <p>{nodeId ? activeStage.meaning : "历史项目的具体节点尚待恢复，当前只显示保守阶段映射。"}</p>
      </div>
      <ol>
        {RESEARCH_JOURNEY.map((stage, index) => {
          const state = journeyStageState(project, index);
          const active = state === "active";
          return (
            <li
              key={stage.id}
              className={`is-${state}`}
              aria-current={active ? "step" : undefined}
              title={stage.meaning}
            >
              <span className="rawb-progress__node">{index + 1}</span>
              <span className="rawb-progress__copy">
                <strong>{stage.label}</strong>
                <small>{state === "complete" ? "已通过" : state === "active" ? "进行中" : state === "excluded" ? "本轮不包含" : "未开始"}</small>
              </span>
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
      <Companion>先告诉我想研究的领域或一个大概问题。我们会用文献把它逐步收窄。</Companion>
      <h1 id="rawb-empty-title">从研究意向开始，在文献调研后确认选题</h1>
      <p>工作台会比较真实 PubMed 检索、整理证据并核查写作；研究员决定范围、最终选题和结论边界。</p>
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

function ReviewArtifactList({ artifacts, heading }) {
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
      <details className="rawb-review-artifacts__list">
        <summary>查看 {artifacts.length} 项候选研究内容</summary>
        <div className="rawb-result-list">
          {artifacts.map((artifact, index) => (
            <ArtifactResult
              key={firstText(artifact?.id, artifact?.artifactId, artifact?.address) ?? index}
              artifact={artifact}
              index={index}
              copiedId={copiedId}
              onCopy={handleCopy}
            />
          ))}
        </div>
      </details>
    </section>
  );
}

function GateDecision({ gate, busy, onDecision }) {
  const reasonId = useId();
  const [reason, setReason] = useState("");

  useEffect(() => setReason(""), [gate?.id, gate?.gateId]);

  if (!gate) return null;
  const gateNodeId = firstText(gate.nodeId, gate?.currentNode?.id);
  const label = gateNodeId === "approve_scope"
    ? "确认研究意向与初始边界"
    : firstText(gate.userLabel, gate.title, gate.label) ?? "确认本步研究边界";
  const purpose = gateNodeId === "approve_scope"
    ? "先确认这一轮要研究的领域、粗问题与不可越过的边界。文献调研之后仍会单独确认最终目标选题。"
    : firstText(gate.reason, gate.purpose, gate.explanation, gate.description) ?? "这一步会改变后续研究范围，需要由研究者明确决定。";
  const criteria = gateNodeId === "approve_scope"
    ? ["研究领域与粗问题符合本轮研究目的", "初始范围足以支持后续文献调研且没有越过当前证据边界"]
    : researcherFacingCriteria(gate.acceptanceCriteria ?? gate.criteria);
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
      <p className="rawb-decision__footnote">最终决定由研究者作出；已记录的决定不会被后续自动覆盖。</p>
    </section>
  );
}

function HumanReview({ review, busy, onDecision }) {
  const reasonId = useId();
  const [reason, setReason] = useState("");

  useEffect(() => setReason(""), [review?.id, review?.nodeId]);

  if (!review) return null;
  const title = firstText(review.userLabel, review.title, review.label) ?? "复核候选研究内容";
  const summary = firstText(review.summary, review.description, review.reason) ?? "请核对候选内容能否由当前证据支持；只有研究者接受后才会继续。";
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
  const nextStep = researcherFacingNextDecision(project);
  const accessSummary = firstText(
    evidenceBoundary.accessSummary,
    project?.summary?.boundary,
  ) ?? "尚未建立可用于研究判断的证据记录。";
  const visibleLandscape = researchWorkbenchVisibleLandscape(project);
  const visibleSynthesis = visibleLandscape?.synthesis ?? {};
  const primaryConclusion = conclusions.length
    ? firstText(conclusions[0]?.claim) ?? "结论内容未报告"
    : firstText(
      visibleSynthesis?.professorReport?.executiveSummary,
      visibleSynthesis?.summaries?.coverage,
      visibleLandscape?.stageBrief?.newFindings?.[0],
    ) ?? "现有材料尚未形成可复核的领域判断；目前不能据此描述领域成熟度、主要争议或研究空白。";

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
          <span>随文献调研更新</span>
          <h2 id="rawb-user-brief-title">本轮研究判断</h2>
        </div>
      </div>
      {feedback ? <p className="rawb-user-brief__feedback" role="status">{feedback}</p> : null}
      <div className="rawb-user-brief__grid">
        <article>
          <p>目前能回答什么</p>
          <strong>{primaryConclusion}</strong>
        </article>
        <article>
          <p>主要依据</p>
          <strong>{accessSummary}</strong>
        </article>
        <article>
          <p>下一项科研决定</p>
          <strong>{nextStep}</strong>
        </article>
      </div>
      <details className="rawb-user-brief__boundary">
        <summary>查看主要依据与证据边界</summary>
        <strong>{accessSummary}</strong>
        {boundaries.length ? (
          <ul>{boundaries.slice(0, 3).map((boundary) => <li key={boundary}>{boundary}</li>)}</ul>
        ) : null}
        <button type="button" onClick={onViewEvidence}>打开完整证据与结果</button>
      </details>
    </section>
  );
}

function DeliverySummary({ project }) {
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
  const sourceCount = asCollection(project?.sourceMaterials).length;
  const hasSources = sourceCount > 0;
  const hasSignedManifest = ["ExportManifest", "AuthorApproval", "SignedDelivery"].every(
    (type) => asCollection(project?.artifacts).some((artifact) => artifact?.type === type),
  );

  return (
    <section className="rawb-delivery-summary" aria-labelledby="rawb-delivery-title">
      <div className="rawb-delivery-summary__heading">
        <p className="rawb-eyebrow">{processDraft ? "受限研究材料" : "研究交付"}</p>
        <h2 id="rawb-delivery-title">{formalResearchComplete ? "本次研究成果已形成" : "本轮研究材料已形成"}</h2>
        <p>{formalResearchComplete
          ? "正式研究版本已经形成；请继续核对结论、来源与限制，再决定解释和发布方式。"
          : `当前材料对应“${completionProfile?.label ?? "本轮研究目标"}”，内容等级为“${maturityLabel}”。请严格按已记录的证据边界理解和使用。`}</p>
      </div>
      <dl className="rawb-delivery-summary__stats">
        <div><dt>内容等级</dt><dd>{maturityLabel}</dd></div>
        <div><dt>科研成果</dt><dd>{researchOutputCount} 项</dd></div>
        <div><dt>来源材料</dt><dd>{sourceCount} 条</dd></div>
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
        <div><strong>成果可追溯，作者仍负责</strong><p>每项结论都应回到来源与访问层级核对；最终解释、署名和发布决定仍由研究者承担。</p></div>
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
      {previewOnly && preview.reviewLandscape ? (
        <ReviewLandscapeReport landscape={preview.reviewLandscape} />
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

function ScopingDecisionLedger({ project }) {
  const decision = project?.scopingDecision;
  const rounds = asArray(project?.scopingRounds);
  if (!decision || rounds.length < 2) return null;
  return (
    <section className="rawb-scoping-ledger" aria-labelledby="rawb-scoping-ledger-title">
      <header>
        <div>
          <span>已记录的选题决定</span>
          <h3 id="rawb-scoping-ledger-title">从宽主题到聚焦问题（未验证）</h3>
        </div>
        <strong>两轮均已保留</strong>
      </header>
      <div className="rawb-scoping-ledger__rounds">
        {rounds.map((round) => (
          <article key={round.round}>
            <span>第 {round.round} 轮 · {round.role === "orientation" ? "领域全景" : "聚焦检索（未验证）"}</span>
            <h4>{round.question}</h4>
            <dl>
              <div><dt>PubMed 命中</dt><dd>{round.total ?? "未知"}</dd></div>
              <div><dt>校准读取</dt><dd>{round.calibration?.sampledCount ?? round.sampledCount ?? 0}</dd></div>
              <div><dt>近五年综述</dt><dd>{round.reviewLandscape?.sampledCount ?? 0}</dd></div>
            </dl>
          </article>
        ))}
      </div>
      <dl className="rawb-scoping-ledger__decision">
        <div><dt>采用方向</dt><dd>{decision.selectedDirection?.direction}</dd></div>
        <div><dt>采用理由</dt><dd>{decision.selectionReason}</dd></div>
        <div><dt>其余方向</dt><dd>{asArray(decision.deferredDirections).length
          ? decision.deferredDirections.map((item) => `${item.direction}：${item.reason}`).join("；")
          : "没有其他候选方向。"}</dd></div>
      </dl>
      <p><strong>证据边界：</strong>{decision.narrowedBrief?.evidenceBoundary}</p>
    </section>
  );
}

function researchWorkbenchVisibleLandscape(project) {
  const retrievalDisplay = researchWorkbenchRetrievalDisplay(project);
  const previewLandscape = retrievalDisplay.mode === "preview"
    ? retrievalDisplay.preview?.reviewLandscape
    : null;
  const scopingRounds = asArray(project?.scopingRounds);
  return previewLandscape ?? scopingRounds.at(-1)?.reviewLandscape ?? null;
}

function EvidenceOverview({ project }) {
  const scopingRounds = asArray(project?.scopingRounds);
  const landscape = researchWorkbenchVisibleLandscape(project);
  if (!landscape || landscape.status && !["ready", "blocked"].includes(landscape.status)) return null;

  const synthesis = landscape.synthesis ?? {};
  if (synthesis?.professorReport || project?.researchReport || landscape?.researchReport) {
    return (
      <ResearchReviewReport
        landscape={landscape}
        question={firstText(project?.question, project?.researchQuestion, project?.brief?.question) ?? ""}
        researchReport={project?.researchReport}
        firstRound={scopingRounds[0]?.reviewLandscape ?? null}
        secondRound={scopingRounds[1]?.reviewLandscape ?? null}
        selectedDirectionId={project?.scopingDecision?.selectedDirection?.id ?? ""}
        lockedDirection={project?.scopingDecision?.selectedDirection
          ? {
              ...project.scopingDecision.selectedDirection,
              reportBinding: project.scopingDecision.reportBinding ?? null,
            }
          : null}
        storageKey={`research-review-report:project:${projectId(project) ?? "current"}`}
        currentBinding={{
          projectId: projectId(project),
          sourceSetHash: firstText(
            project?.sourceSetHash,
            project?.finalLibrarySourceSetHash,
            project?.researchQualityMetrics?.retrieval?.sourceSetHash,
          ),
          reportRevision: project?.reportRevision,
          frozenSourceManifestHash: firstText(
            project?.researchReport?.binding?.frozenSourceManifestHash,
            landscape?.researchReport?.binding?.frozenSourceManifestHash,
          ),
          derivedAnalysisHash: firstText(
            project?.researchReport?.binding?.derivedAnalysisHash,
            landscape?.researchReport?.binding?.derivedAnalysisHash,
          ),
          reportHash: firstText(
            project?.researchReport?.binding?.reportHash,
            landscape?.researchReport?.binding?.reportHash,
          ),
        }}
      />
    );
  }
  const analyzedCount = Number(
    synthesis.analyzedSourceCount ?? landscape.sampledCount ?? 0,
  );
  const abstractCount = Number(
    landscape.abstractAvailableCount ?? synthesis.abstractAvailableCount ?? 0,
  );
  const themes = asArray(synthesis.themeCoverage ?? landscape.themeCoverage).slice(0, 5);

  const abstractRatio = analyzedCount > 0
    ? Math.max(0, Math.min(100, Math.round((abstractCount / analyzedCount) * 100)))
    : 0;
  const brief = landscape.stageBrief ?? {};

  return (
    <section className="rawb-evidence-overview" aria-labelledby="rawb-evidence-overview-title">
      <header className="rawb-evidence-overview__heading">
        <div>
          <span>领域简报</span>
          <h3 id="rawb-evidence-overview-title">领域现状与选题线索</h3>
        </div>
        <strong>当前分析 {analyzedCount} 篇综述</strong>
      </header>
      <p className="rawb-evidence-overview__thesis">{firstText(
        synthesis?.summaries?.coverage,
        brief.newFindings?.[0],
      ) ?? "当前题名与摘要样本用于识别主要研究分支、具体问题与可进一步核查的选题方向。"}</p>
      <aside className="rawb-evidence-overview__legacy">
        <strong>这项资料需要按最新方法重新分析</strong>
        <p>当前只保留主题覆盖与摘要可访问性，尚未形成具体领域问题、可复核的时间趋势和成熟综述方案；因此不展示旧版自动候选方向。</p>
      </aside>

      <div className="rawb-evidence-overview__visuals">
        <section className="rawb-evidence-clusters" aria-labelledby="rawb-evidence-clusters-title">
          <div className="rawb-visual-heading">
            <h4 id="rawb-evidence-clusters-title">主题覆盖</h4>
            <span>{analyzedCount || "—"} 篇分层综述</span>
          </div>
          {themes.length ? (
            <ul aria-label="当前摘要样本中的主题覆盖度">
              {themes.map((theme, index) => {
                const count = Number(theme.count ?? 0);
                const share = Number(theme.share ?? (analyzedCount ? count / analyzedCount * 100 : 0));
                return (
                  <li
                    key={theme.id ?? theme.label}
                    style={{
                      "--rawb-bubble-scale": Math.max(0.58, Math.min(1, share / 80)),
                      "--rawb-bubble-order": index,
                    }}
                    title={`${theme.label}：${count}/${analyzedCount || "未知"}`}
                  >
                    <strong>{theme.label}</strong>
                    <span>{count}/{analyzedCount || "—"}</span>
                  </li>
                );
              })}
            </ul>
          ) : <p>当前接口没有返回主题覆盖；保持未知。</p>}
        </section>

        <section className="rawb-access-ring" aria-labelledby="rawb-access-ring-title">
          <div className="rawb-visual-heading">
            <h4 id="rawb-access-ring-title">可访问证据</h4>
            <span>实际读取层级</span>
          </div>
          <div className="rawb-access-ring__body">
            <div
              className="rawb-access-ring__chart"
              role="img"
              aria-label={`${analyzedCount} 篇样本中 ${abstractCount} 篇有摘要`}
              style={{ "--rawb-access-angle": `${abstractRatio * 3.6}deg` }}
            >
              <strong>{abstractCount}/{analyzedCount || "—"}</strong>
              <span>摘要可用</span>
            </div>
            <ul>
              <li><span className="is-abstract" aria-hidden="true" />题名与摘要<strong>{abstractCount}</strong></li>
              <li><span className="is-title" aria-hidden="true" />仅题名<strong>{Math.max(0, analyzedCount - abstractCount)}</strong></li>
            </ul>
          </div>
          <p>摘要未报告的内容仍记为未知；尚未自动升级为全文证据。</p>
        </section>
      </div>

      <footer className="rawb-evidence-overview__boundary">
        <div><strong>目前可以说</strong><p>{firstText(synthesis?.summaries?.coverage, brief.newFindings?.[0]) ?? "已获得用于校准研究方向的题名摘要样本。"}</p></div>
        <div><strong>目前不能说</strong><p>{firstText(brief.evidenceBoundary) ?? "不能据此认定研究空白、因果关系或临床决策价值。"}</p></div>
      </footer>
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
  const taskNodeId = firstText(task.nodeId, project?.currentNode?.id, project?.currentNodeId);
  const taskLabel = taskNodeId === "approve_scope"
    ? "确认研究意向"
    : firstText(task.userLabel, task.title, task.label) ?? "准备下一步研究任务";
  const taskObjective = firstText(task.objective, task.purpose, task.description, project?.nextAction);
  const objective = taskNodeId === "approve_scope"
    ? "确认当前研究领域、粗问题和初始边界；最终目标选题将在文献调研后单独形成。"
    : taskObjective && !FRONTSTAGE_INTERNAL_LANGUAGE.test(taskObjective)
      ? taskObjective
      : "请根据当前领域判断确定下一项需要核查的研究问题。";
  const acceptance = researcherFacingCriteria(task.acceptanceCriteria ?? task.criteria);
  const outputs = asArray(task.requiredOutputs ?? task.outputs);
  const taskBlocker = firstText(task.blocker);
  const blocker = project?.blocker
    ? researcherFacingBlockerText(project)
    : taskBlocker && !FRONTSTAGE_INTERNAL_LANGUAGE.test(taskBlocker)
      ? taskBlocker
      : taskBlocker
        ? "当前研究材料需要重新核对后再继续。"
        : null;
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
    <div className="rawb-panel-grid rawb-research-workspace">
      <section className="rawb-task-card">
        <EvidenceOverview project={project} />
        <header className="rawb-task-focus">
          <div>
            <span>阅读简报后需要你确认</span>
            <h2>{taskLabel}</h2>
          </div>
          <strong>研究者决定</strong>
        </header>
        <p className="rawb-task-card__objective">{objective}</p>
        {blocker ? <p className="rawb-blocker">{blocker}</p> : null}
        {formalRetrievalBlocked ? (
          <section className={`rawb-recovery is-${retryClass}`} aria-labelledby="rawb-recovery-title">
            <div className="rawb-recovery__heading">
              <div>
                <p>当前检索需要处理</p>
                <h3 id="rawb-recovery-title">
                  {retryClass === "protocol_revision_required"
                    ? "本轮是零结果，需要修订检索协议"
                    : retryClass === "same_protocol_retry"
                      ? "当前协议可保留，等待原式重试"
                      : "失败类型需要研究者判断"}
                </h3>
              </div>
            </div>
            <dl className="rawb-recovery__facts">
              <div><dt>无法继续的原因</dt><dd>{researcherFacingBlockerText(project)}</dd></div>
              <div><dt>原检索式</dt><dd><code>{failedQuery || "未记录"}</code></dd></div>
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
                  <p>新版会保留你的修改理由并关联旧版检索方案；受影响的后续检索将重新执行。</p>
                </div>
                <label htmlFor="rawb-revised-protocol-query">新版 PubMed 检索式</label>
                <textarea
                  id="rawb-revised-protocol-query"
                  value={revisedQuery}
                  onChange={(event) => setRevisedQuery(event.target.value)}
                  minLength={3}
                  maxLength={5000}
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
            <div><strong>在同一个项目修改检索式</strong><p>不会新建第二个项目；成功后将保存新检索式，并继续完成本轮文献调研。</p></div>
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
        <details className="rawb-research-details">
          <summary>查看完整检索、完成标准与研究记录</summary>
          <ScopingDecisionLedger project={project} />
          <LiveRetrievalSummary project={project} />
          <div className="rawb-task-details">
            <div>
              <h3>完成标准</h3>
              {acceptance.length ? (
                <ul className="rawb-check-list">
                  {acceptance.map((item, index) => <li key={`${String(item)}-${index}`}>{String(item)}</li>)}
                </ul>
              ) : <p>当前尚未形成可供研究者核对的完成标准。</p>}
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
              ) : <p>本步应形成的研究材料会在研究步骤确定后显示。</p>}
            </div>
          </div>
        </details>
      </section>
      {gate ? <GateDecision gate={gate} busy={busy} onDecision={onGateDecision} /> : null}
      {review ? <HumanReview review={review} busy={busy} onDecision={onReviewDecision} /> : null}
      {!gate && !review ? (
        <aside className="rawb-guardrail">
          <div><strong>先核对证据，再决定下一问</strong><p>范围、选题与结论边界不会因为继续检索而自动改变。</p></div>
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
          <p>{currentPhaseIndex < 3 ? "先把问题、证据和论证结构做稳，写作台会在进入第四个研究时期后启用。" : "形成候选主张后，这里会显示来源支持和边界检查。"}</p>
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

function RecordsPanel({ project, runtime, runtimeLoading, runtimeError, actionError }) {
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
  const technicalBlocker = project?.blocker && typeof project.blocker === "object"
    ? project.blocker
    : null;
  const technicalActionError = firstText(
    actionError?.message,
    typeof actionError === "string" ? actionError : null,
  );
  const landscape = researchWorkbenchVisibleLandscape(project);
  let reportAuditModel = null;
  if (project?.researchReport || landscape?.researchReport) {
    try {
      reportAuditModel = buildResearchReviewReportModel({
        landscape,
        researchReport: project?.researchReport,
      });
    } catch {
      reportAuditModel = null;
    }
  }

  return (
    <div className="rawb-records-layout">
      <section className="rawb-records-note">
        <div><strong>技术状态集中在这里</strong><p>Pi Agent 运行模式、研究步骤、版本与工具日志只用于复现和故障诊断，不参与前台的领域判断。</p></div>
      </section>
      <section className="rawb-technical-runtime" aria-labelledby="rawb-technical-runtime-title">
        <div>
          <p className="rawb-eyebrow">运行底座</p>
          <h2 id="rawb-technical-runtime-title">Pi Agent 与研究流程</h2>
        </div>
        <RuntimeBadge runtime={runtime} loading={runtimeLoading} error={runtimeError} />
      </section>
      <ResearchProgress project={project} />
      {technicalActionError ? (
        <details className="rawb-technical-log rawb-technical-report-audit">
          <summary>展开最近一次请求的技术信息</summary>
          <dl className="rawb-technical-binding">
            <div><dt>错误代码</dt><dd>{firstText(actionError?.code, actionError?.payload?.code) ?? "未记录"}</dd></div>
            <div><dt>HTTP 状态</dt><dd>{actionError?.status || "未记录"}</dd></div>
            <div><dt>原始说明</dt><dd>{technicalActionError}</dd></div>
          </dl>
        </details>
      ) : null}
      {technicalBlocker ? (
        <details className="rawb-technical-log rawb-technical-report-audit">
          <summary>展开当前阻断的技术信息</summary>
          <dl className="rawb-technical-binding">
            <div><dt>失败代码</dt><dd>{firstText(technicalBlocker.code) ?? "未记录"}</dd></div>
            <div><dt>恢复类别</dt><dd>{firstText(technicalBlocker.retryClass) ?? "未记录"}</dd></div>
            <div><dt>内部步骤</dt><dd>{firstText(project?.recovery?.safeCheckpoint?.label, technicalBlocker.stage) ?? "未记录"}</dd></div>
            <div><dt>安全保存点</dt><dd>{firstText(project?.recovery?.safeCheckpoint?.message) ?? "项目与既有记录已保留"}</dd></div>
            <div><dt>原始说明</dt><dd>{firstText(technicalBlocker.message, technicalBlocker.reason) ?? "未记录"}</dd></div>
          </dl>
        </details>
      ) : null}
      {reportAuditModel ? (
        <details className="rawb-technical-log rawb-technical-report-audit">
          <summary>展开报告绑定与技术完整性信息</summary>
          <p>这些字段只用于复现、故障诊断和版本核对，不参与领域现状、趋势或选题判断。</p>
          {reportAuditModel.technicalIntegrityBoundary ? <p>{reportAuditModel.technicalIntegrityBoundary}</p> : null}
          <dl className="rawb-technical-binding">
            <div><dt>项目标识</dt><dd>{reportAuditModel.binding?.projectId ?? "建项前预检"}</dd></div>
            <div><dt>来源集合指纹</dt><dd>{reportAuditModel.binding?.sourceSetHash ? reportAuditModel.binding.sourceSetHash.slice(0, 12) : "尚未绑定"}</dd></div>
            <div><dt>报告版本</dt><dd>{reportAuditModel.binding?.reportRevision ?? "建项后生成"}</dd></div>
            <div><dt>内容指纹</dt><dd>{reportAuditModel.binding?.reportHash ? reportAuditModel.binding.reportHash.slice(0, 12) : "尚未生成"}</dd></div>
            <div><dt>研究对象相关性</dt><dd>{reportAuditModel.relevanceGate?.status === "passed" ? "通过" : reportAuditModel.relevanceGate?.status === "blocked" ? "阻断" : "建项前检查"}</dd></div>
            <div><dt>逐篇文献清单</dt><dd>{reportAuditModel.ledgerIntegrity?.status === "passed" ? "一致" : "阻断"}</dd></div>
          </dl>
        </details>
      ) : null}
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

function QueryStrategyCard({ candidate, selected, onSelect }) {
  const badge = candidate.id === "selected_direction_focused"
    ? "方向确认"
    : candidate.id === "researcher_edited"
    ? "人工修订"
    : RECOMMENDED_QUERY_CANDIDATE_IDS.has(candidate.id)
      ? "推荐"
      : "备选";
  return (
    <label className={`rawb-query-strategy${selected ? " is-selected" : ""}`}>
      <span className="rawb-query-strategy__top">
        <input
          type="radio"
          name="query-strategy"
          value={candidate.id}
          checked={selected}
          onChange={() => onSelect(candidate)}
        />
        <strong>{candidate.label}</strong>
        <em>{badge}</em>
      </span>
      <p>{candidate.strategy}</p>
      <code>{candidate.query}</code>
    </label>
  );
}

function QueryCalibrationReport({ calibration }) {
  if (!calibration) return null;
  const brief = calibration.stageBrief ?? {};
  const feedback = calibration.feedback ?? {};
  const revisionCompleted = calibration.revision?.status === "completed";
  return (
    <section className="rawb-query-calibration" aria-labelledby="rawb-query-calibration-title">
      <header>
        <div>
          <span>前 100 篇反馈校准</span>
          <h3 id="rawb-query-calibration-title">{brief.currentResearchPeriod ?? "检索式反馈校准"}</h3>
        </div>
        <strong>{revisionCompleted ? "已形成修订建议" : "等待人工核对"}</strong>
      </header>
      <div className="rawb-query-calibration__status">
        <p><strong>{revisionCompleted ? "已依据样本反馈调整词群" : "尚未形成自动修订建议"}</strong></p>
        <p>{revisionCompleted
          ? "修订建议来自前 100 篇题名摘要的概念覆盖与噪声反馈；最终检索语法仍需人工核对。"
          : "当前未形成自动修订建议；已保留原检索式、真实样本反馈和人工修改入口。"}</p>
      </div>
      <div className="rawb-query-calibration__signals">
        <div><span>当前总命中</span><strong>{calibration.total ?? "未知"}</strong></div>
        <div><span>实际读取</span><strong>{feedback.sampledCount ?? 0} / {calibration.requestedSampleLimit ?? 100}</strong></div>
        <div><span>摘要可用</span><strong>{feedback.abstractAvailableCount ?? 0}</strong></div>
        <div><span>待抽查噪声线索</span><strong>{feedback.potentialNoiseCount ?? 0}</strong></div>
      </div>
      {asArray(feedback.conceptCoverage).length ? (
        <div className="rawb-query-calibration__coverage">
          <h4>概念词群字面覆盖</h4>
          <ul>{feedback.conceptCoverage.map((item) => (
            <li key={item.conceptId}>
              <span>{item.sourceTerm}</span>
              <strong>{item.matchedCount} / {item.sampledCount}</strong>
            </li>
          ))}</ul>
        </div>
      ) : null}
      {asArray(feedback.frequentTitleTerms).length ? (
        <p className="rawb-query-calibration__terms"><strong>样本题名高频词：</strong>{feedback.frequentTitleTerms.map((item) => `${item.term}（${item.count}）`).join("、")}</p>
      ) : null}
      <details>
        <summary>抽查前 12 条来源样本</summary>
        <ol>{asArray(calibration.sources).map((source) => (
          <li key={source.sourceId ?? source.pmid}>
            <span>{source.accessLevel === "abstract_only" ? "题名+摘要" : "仅题名"}{source.year ? ` · ${source.year}` : ""}</span>
            <strong>{source.title}</strong>
            {source.abstractSnippet ? <p>{source.abstractSnippet}</p> : <p>摘要未返回；摘要层信息保持未知。</p>}
          </li>
        ))}</ol>
      </details>
      <footer>
        <p><strong>依据与边界：</strong>{brief.evidenceBoundary}</p>
        <p><strong>下一决定：</strong>{brief.nextDecision}</p>
      </footer>
    </section>
  );
}

const REVIEW_METHOD_VISIBILITY_LABELS = Object.freeze({
  more_complete: "摘要方法报告较完整",
  partial: "摘要仅报告部分方法",
  not_reported: "摘要未充分报告方法",
  abstract_unavailable: "摘要未返回",
});

function ReviewEvidenceLinks({ sourceIds, sources }) {
  const linked = asArray(sourceIds)
    .map((sourceId) => asArray(sources).find((source) => source.sourceId === sourceId))
    .filter(Boolean)
    .slice(0, 6);
  if (!linked.length) return null;
  return (
    <span className="rawb-review-evidence-links">
      <span>依据</span>
      {linked.map((source) => (
        source.locator?.url
          ? <a key={source.sourceId} href={source.locator.url} target="_blank" rel="noreferrer">PMID {source.pmid}</a>
          : <em key={source.sourceId}>{source.pmid ? `PMID ${source.pmid}` : source.sourceId}</em>
      ))}
    </span>
  );
}

function ReviewReportFinding({ item, sources }) {
  if (!item) return null;
  return (
    <article className="rawb-professor-report__finding">
      <h6>{item.title}</h6>
      <p>{item.conclusion ?? item.value}</p>
      <ReviewEvidenceLinks sourceIds={item.sourceIds} sources={sources} />
    </article>
  );
}

function ReviewIntegratedBrief({ landscape, synthesis, sources }) {
  const report = synthesis?.professorReport;
  const directions = asArray(report?.studentReviewDirections).slice(0, 5);
  const developmentStatus = asArray(report?.developmentStatus);
  const majorProblems = asArray(report?.majorProblems).slice(0, 3);
  const newcomerGuide = asArray(report?.newcomerGuide).slice(0, 5);
  const selectionPatterns = asArray(report?.selectionPatterns).slice(0, 3);
  const trendInsights = asArray(report?.trendInsights).slice(0, 2);
  const leadingTheme = asArray(synthesis?.themeCoverage)[0] ?? null;
  const leadingGap = asArray(synthesis?.gapClusters)[0] ?? null;
  const metaAnalysis = asArray(synthesis?.methodSignals).find((item) => item.id === "meta_analysis") ?? null;
  const analyzedCount = Math.max(1, Number(synthesis?.analyzedSourceCount) || 0);
  const leadingThemeShare = leadingTheme ? Math.round((leadingTheme.count / analyzedCount) * 100) : 0;

  if (!report) return null;
  return (
    <section className="rawb-integrated-brief" aria-labelledby="rawb-professor-report-title">
      <header className="rawb-integrated-brief__hero">
        <div className="rawb-integrated-brief__lead">
          <span>{report.analysisLevel} · {report.periodLabel}</span>
          <h4 id="rawb-professor-report-title">{report.title}</h4>
          <p>{report.executiveSummary}</p>
        </div>
        <dl className="rawb-integrated-brief__metrics">
          <div><dt>近五年综述</dt><dd><strong>{synthesis.analyzedSourceCount}</strong><span>篇</span></dd></div>
          <div><dt>摘要可用</dt><dd><strong>{synthesis.abstractAvailableCount}</strong><span>篇</span></dd></div>
          <div><dt>Meta 分析</dt><dd><strong>{metaAnalysis?.count ?? 0}</strong><span>篇</span></dd></div>
        </dl>
      </header>

      <section className="rawb-integrated-brief__section is-landscape" aria-labelledby="rawb-professor-status-title">
        <header className="rawb-integrated-brief__section-heading">
          <span>1</span>
          <div><h5 id="rawb-professor-status-title">领域发展现状</h5><p>结论与主题覆盖、年度轨迹在同一阅读单元中互相解释</p></div>
        </header>
        <div className="rawb-integrated-brief__landscape-grid">
          <article className="rawb-integrated-brief__dominant-finding">
            <span>当前覆盖最高主题</span>
            <strong><b>{leadingTheme?.count ?? 0}</b><small> / {synthesis.analyzedSourceCount} 篇</small></strong>
            <h6>{leadingTheme?.label ?? "主题尚未形成稳定聚类"}</h6>
            <p>{developmentStatus[0]?.conclusion}</p>
            <ReviewEvidenceLinks sourceIds={leadingTheme?.sourceIds} sources={sources} />
          </article>
          <article className="rawb-integrated-brief__chart is-coverage">
            <header><h6>主题覆盖度</h6><span>最高主题占当前样本 {leadingThemeShare}%</span></header>
            <ReviewThemeCoverageChart synthesis={synthesis} sources={sources} />
          </article>
          <article className="rawb-integrated-brief__chart is-trend">
            <header><h6>年度主题轨迹</h6><span>按年份分层样本中的出现篇数</span></header>
            <ReviewTrendChart synthesis={synthesis} sources={sources} />
            <div className="rawb-integrated-brief__trend-notes">
              {trendInsights.map((item) => <p key={item.id}><strong>{item.title}</strong>{item.conclusion}</p>)}
            </div>
          </article>
        </div>
        <div className="rawb-integrated-brief__method-band">
          <div className="rawb-integrated-brief__method-copy">
            {developmentStatus.slice(1, 3).map((item) => (
              <ReviewReportFinding key={item.id} item={item} sources={sources} />
            ))}
          </div>
          <div className="rawb-integrated-brief__method-chart">
            <h6>摘要方法报告完整度</h6>
            <ReviewMethodProfile synthesis={synthesis} />
          </div>
        </div>
      </section>

      <section className="rawb-integrated-brief__section is-problems" aria-labelledby="rawb-professor-problems-title">
        <header className="rawb-integrated-brief__section-heading">
          <span>2</span>
          <div><h5 id="rawb-professor-problems-title">当前主要问题</h5><p>只统计摘要明确表达的证据缺口，不把未报告误判为没有实施</p></div>
        </header>
        <div className="rawb-integrated-brief__problem-grid">
          <article className="rawb-integrated-brief__gap-lead">
            <span>最常见缺口信号</span>
            <strong><b>{leadingGap?.count ?? 0}</b><small> 篇</small></strong>
            <h6>{leadingGap?.label ?? "当前摘要未形成稳定缺口聚类"}</h6>
            <p>{majorProblems[0]?.conclusion}</p>
            <ReviewEvidenceLinks sourceIds={leadingGap?.sourceIds} sources={sources} />
          </article>
          <article className="rawb-integrated-brief__chart is-gap">
            <header><h6>缺口信号分布</h6><span>点击类型查看代表性摘要与 PMID</span></header>
            <ReviewGapDistribution synthesis={synthesis} sources={sources} />
          </article>
          <ol className="rawb-integrated-brief__problem-list">
            {majorProblems.map((item, index) => (
              <li key={item.id}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div><h6>{item.title}</h6><p>{item.conclusion}</p><ReviewEvidenceLinks sourceIds={item.sourceIds} sources={sources} /></div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="rawb-integrated-brief__section is-guidance" aria-labelledby="rawb-professor-newcomer-title">
        <header className="rawb-integrated-brief__section-heading">
          <span>3</span>
          <div><h5 id="rawb-professor-newcomer-title">新手必读与选题规律</h5><p>先建立科研判断顺序，再从当前样本中寻找有增量价值的综述角度</p></div>
        </header>
        <div className="rawb-integrated-brief__guidance-grid">
          <ol className="rawb-integrated-brief__guide">
            {newcomerGuide.map((item, index) => (
              <li key={item.id}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{item.title}</strong><p>{item.advice}</p></div>
              </li>
            ))}
          </ol>
          <div className="rawb-integrated-brief__pattern-list">
            {selectionPatterns.map((item) => <ReviewReportFinding key={item.id} item={item} sources={sources} />)}
          </div>
        </div>
        {asArray(report.researcherIdeas).length ? (
          <details className="rawb-integrated-brief__researcher-ideas">
            <summary>研究者视角：展开更多可能提供增量价值的综述思路</summary>
            <div>{asArray(report.researcherIdeas).map((item) => <ReviewReportFinding key={item.id} item={item} sources={sources} />)}</div>
          </details>
        ) : null}
      </section>

      {directions.length ? (
        <section className="rawb-integrated-brief__section is-directions" aria-labelledby="rawb-professor-directions-title">
          <header className="rawb-integrated-brief__section-heading">
            <span>4</span>
            <div><h5 id="rawb-professor-directions-title">候选综述方向</h5><p>50–100 篇仅作为候选发现与工作量估算目标；最终纳入量、重叠度和可行性仍须下一轮窄检索确认</p></div>
          </header>
          <div className="rawb-integrated-brief__direction-columns" aria-hidden="true">
            <span>候选方向</span><span>待验证增量</span><span>工作量</span><span>关键证据</span>
          </div>
          <ol className="rawb-integrated-brief__directions">
            {directions.map((direction) => (
              <li key={direction.id}>
                <article className="rawb-integrated-brief__direction-row">
                  <div className="rawb-integrated-brief__direction-title">
                    <span>{String(direction.rank).padStart(2, "0")}</span><h6>{direction.suggestedTitle}</h6>
                  </div>
                  <p className="rawb-integrated-brief__direction-value">{direction.whyPotentiallyValuable}</p>
                  <dl className="rawb-integrated-brief__direction-workload">
                    <div><dt>周期</dt><dd>{direction.workload?.timeline}</dd></div>
                    <div><dt>难度</dt><dd>{direction.workload?.difficulty}</dd></div>
                    <div><dt>文献</dt><dd>{direction.workload?.targetCoreLiterature}</dd></div>
                  </dl>
                  <div className="rawb-integrated-brief__direction-evidence">
                    <ReviewEvidenceLinks sourceIds={direction.sourceIds} sources={sources} />
                  </div>
                  <details className="rawb-integrated-brief__direction-detail">
                    <summary>查看文献组织思路与立题门槛</summary>
                    <div><ol>{asArray(direction.outline).map((item) => <li key={item}>{item}</li>)}</ol><p><strong>立题门槛：</strong>{direction.verificationGate}</p></div>
                  </details>
                </article>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <ReviewSourceEvidenceLedger sources={sources} synthesis={synthesis} />

      <footer className="rawb-integrated-brief__footer">
        <p><strong>可追溯范围：</strong>{report.traceability?.accessBoundary}</p>
        <p><strong>期刊指标原则：</strong>{report.traceability?.journalMetricPolicy}</p>
        <p><strong>结论边界：</strong>{report.boundary}</p>
      </footer>
    </section>
  );
}

function verifiedJournalMetric(source) {
  const metrics = source?.journalMetrics ?? {};
  const rawValue = source?.journalImpactFactor ?? metrics.journalImpactFactor ?? metrics.jif;
  const value = Number(rawValue);
  const verified = metrics.verified === true || source?.journalImpactFactorVerified === true;
  if (!Number.isFinite(value) || !verified) return null;
  return {
    value,
    year: metrics.year ?? source?.journalImpactFactorYear ?? null,
    source: metrics.source ?? "JCR",
  };
}

function ReviewSourceEvidenceLedger({ sources, synthesis }) {
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  const [reviewType, setReviewType] = useState("");
  const [theme, setTheme] = useState("");
  const options = useMemo(() => ({
    years: Array.from(new Set(asArray(sources).map((source) => source.year).filter(Boolean))).sort().reverse(),
    reviewTypes: Array.from(new Set(asArray(sources).map((source) => source.reviewType?.label).filter(Boolean))).sort(),
    themes: Array.from(new Set(asArray(sources).flatMap((source) => asArray(source.abstractAnalysis?.themeLabels)))).sort(),
  }), [sources]);
  const visibleSources = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return asArray(sources).filter((source) => {
      const matchesQuery = !needle || [source.pmid, source.locator?.doi, source.title, source.journal]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(needle));
      const matchesYear = !year || String(source.year) === year;
      const matchesType = !reviewType || source.reviewType?.label === reviewType;
      const matchesTheme = !theme || asArray(source.abstractAnalysis?.themeLabels).includes(theme);
      return matchesQuery && matchesYear && matchesType && matchesTheme;
    });
  }, [query, reviewType, sources, theme, year]);
  return (
    <details className="rawb-review-source-ledger">
      <summary>
        <span>本轮分析样本文献（{synthesis.analyzedSourceCount}）</span>
        <small>题名/摘要级 · PMID / DOI / 题目 / 期刊 / 方法 / 期刊指标状态</small>
      </summary>
      <div className="rawb-review-source-ledger__intro">
        <p>报告与可视化均由这批样本文献生成。筛选只改变当前查看范围，不改变本轮分析事实。</p>
        <p><strong>影响因子：</strong>只有来源、年份和核验状态完整的授权数据才显示；未核验时保持未知，也不参与证据质量排序。</p>
      </div>
      <div className="rawb-review-source-ledger__filters" aria-label="筛选本轮样本文献">
        <label>
          <span>检索 ID、题目或期刊</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如 PMID、DOI 或关键词" />
        </label>
        <label>
          <span>年份</span>
          <select value={year} onChange={(event) => setYear(event.target.value)}>
            <option value="">全部年份</option>
            {options.years.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span>综述类型</span>
          <select value={reviewType} onChange={(event) => setReviewType(event.target.value)}>
            <option value="">全部类型</option>
            {options.reviewTypes.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span>报告主题</span>
          <select value={theme} onChange={(event) => setTheme(event.target.value)}>
            <option value="">全部主题</option>
            {options.themes.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>
      <p className="rawb-review-source-ledger__count" role="status">当前显示 {visibleSources.length} / {sources.length} 篇</p>
      <div className="rawb-review-source-ledger__columns" aria-hidden="true">
        <span>文献 ID</span><span>题目与期刊</span><span>年份与类型</span><span>访问与方法</span><span>期刊指标</span>
      </div>
      <ol>
        {visibleSources.map((source) => {
          const analysis = source.abstractAnalysis ?? {};
          const metric = verifiedJournalMetric(source);
          const doi = source.doi ?? source.locator?.doi ?? null;
          return (
            <li key={source.sourceId ?? source.pmid}>
              <div className="rawb-review-source-ledger__row">
                <div className="rawb-review-source-ledger__id">
                  {source.locator?.url
                    ? <a href={source.locator.url} target="_blank" rel="noreferrer">PMID {source.pmid}</a>
                    : <strong>{source.pmid ? `PMID ${source.pmid}` : source.sourceId}</strong>}
                  <small>{doi ? `DOI ${doi}` : "DOI 未返回"}</small>
                </div>
                <div className="rawb-review-source-ledger__title">
                  <strong>{source.title}</strong>
                  <small>{source.journal ?? "期刊未报告"}</small>
                </div>
                <div><strong>{source.year ?? "年份未知"}</strong><small>{source.reviewType?.label ?? "类型待核"}</small></div>
                <div><strong>{source.accessLevel === "abstract_only" ? "题名 + 摘要" : "仅题名"}</strong><small>{REVIEW_METHOD_VISIBILITY_LABELS[analysis.methodVisibility] ?? "方法状态未知"}</small></div>
                <div><strong>{metric ? `${metric.value}${metric.year ? ` · ${metric.year}` : ""}` : "未接入经核验数据"}</strong><small>{metric ? metric.source : "不参与证据排序"}</small></div>
              </div>
              <details className="rawb-review-source-ledger__analysis">
                <summary>展开摘要分析与证据角色</summary>
                <div className="rawb-review-source-ledger__analysis-body">
                  <div className="rawb-review-source-tags">
                    <em>{REVIEW_METHOD_VISIBILITY_LABELS[analysis.methodVisibility] ?? "摘要分析状态未知"}</em>
                    {asArray(analysis.themeLabels).map((label) => <em key={label}>{label}</em>)}
                  </div>
                  {asArray(analysis.methodSignalLabels).length ? <p><b>摘要报告的方法：</b>{analysis.methodSignalLabels.join("、")}</p> : <p><b>摘要报告的方法：</b>摘要未充分报告，保持未知。</p>}
                  {analysis.conclusionExcerpt ? <p><b>摘要结论信号：</b>{analysis.conclusionExcerpt}</p> : <p><b>摘要结论信号：</b>未从摘要中可靠定位。</p>}
                  {analysis.gapExcerpt ? <p><b>摘要明确缺口：</b>{analysis.gapExcerpt}</p> : <p><b>摘要明确缺口：</b>未从摘要中可靠定位；不等于没有缺口。</p>}
                  {source.abstractSnippet ? <blockquote><strong>原摘要片段</strong><p>{source.abstractSnippet}</p></blockquote> : null}
                  <p className="rawb-review-source-boundary">{analysis.boundary ?? "仅基于题名摘要；未访问全文。"}</p>
                </div>
              </details>
            </li>
          );
        })}
      </ol>
      {!visibleSources.length ? <p className="rawb-review-source-ledger__empty">没有符合当前筛选条件的样本文献。</p> : null}
    </details>
  );
}

const REVIEW_CHART_COLORS = Object.freeze([
  "#2f6fbd",
  "#3f9668",
  "#e89a2d",
  "#df6659",
]);

const REVIEW_DIRECTION_LABELS = Object.freeze({
  early_detection_screening: "早筛与影像方向",
  biomarkers_molecular: "分子标志物方向",
  targeted_therapy: "靶向治疗方向",
  immunotherapy: "免疫治疗方向",
  perioperative_treatment: "围手术期方向",
  local_treatment: "局部治疗方向",
  advanced_metastatic: "晚期疾病管理方向",
  resistance_microenvironment: "耐药与微环境方向",
  toxicity_supportive: "支持治疗方向",
  survivorship_quality_of_life: "生存质量方向",
  ai_digital: "数字化工具方向",
  prevention_epidemiology: "预防与流行病学方向",
});

function ReviewMetricIcon({ type }) {
  if (type === "calendar") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 3v3M18 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z" />
      </svg>
    );
  }
  if (type === "layers") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 3 8 4-8 4-8-4 8-4Zm-8 9 8 4 8-4M4 17l8 4 8-4" />
      </svg>
    );
  }
  if (type === "check") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.5 2.5L16 9" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h8l4 4v14H7V3Z" />
      <path d="M15 3v5h5M10 12h6M10 16h6" />
    </svg>
  );
}

function ReviewMetric({ icon, label, value, detail }) {
  return (
    <div className="rawb-review-atlas__metric">
      <ReviewMetricIcon type={icon} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </div>
  );
}

function ReviewTrendChart({ synthesis, sources }) {
  const [activeThemeId, setActiveThemeId] = useState(null);
  const chart = useMemo(() => {
    const years = Array.from(new Set(
      asArray(sources)
        .map((source) => Number.parseInt(String(source.year), 10))
        .filter(Number.isFinite),
    )).sort((left, right) => left - right);
    const themes = asArray(synthesis?.themeCoverage).slice(0, 4);
    const series = themes.map((theme, index) => ({
      ...theme,
      color: REVIEW_CHART_COLORS[index],
      values: years.map((year) => asArray(sources).filter((source) => (
        Number.parseInt(String(source.year), 10) === year
        && asArray(source.abstractAnalysis?.themeIds).includes(theme.id)
      )).length),
    }));
    const maxValue = Math.max(1, ...series.flatMap((item) => item.values));
    return { years, series, maxValue };
  }, [sources, synthesis?.themeCoverage]);

  const width = 600;
  const height = 230;
  const padding = { top: 18, right: 18, bottom: 34, left: 35 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const xFor = (index) => padding.left + (chart.years.length <= 1 ? innerWidth / 2 : (innerWidth * index) / (chart.years.length - 1));
  const yFor = (value) => padding.top + innerHeight - (value / chart.maxValue) * innerHeight;
  const ticks = Array.from({ length: chart.maxValue + 1 }, (_, index) => index);

  if (!chart.years.length || !chart.series.length) {
    return <p className="rawb-review-insight__empty">当前样本不足以绘制年度主题轨迹。</p>;
  }

  return (
    <figure className="rawb-review-trend-chart">
      <div className="rawb-review-chart-legend" aria-label="选择趋势主题">
        {chart.series.map((series) => {
          const selected = activeThemeId === series.id;
          return (
            <button
              key={series.id}
              type="button"
              className={selected ? "is-selected" : ""}
              style={{ "--series-color": series.color }}
              aria-pressed={selected}
              onClick={() => setActiveThemeId((current) => current === series.id ? null : series.id)}
            >
              <i aria-hidden="true" />
              {series.label}
            </button>
          );
        })}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="rawb-review-trend-svg-title rawb-review-trend-svg-desc">
        <title id="rawb-review-trend-svg-title">近五年主题信号年度变化</title>
        <desc id="rawb-review-trend-svg-desc">每条折线表示该主题在当前按年份分层综述样本中的年度出现篇数。</desc>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              className="rawb-review-trend-chart__grid"
              x1={padding.left}
              x2={width - padding.right}
              y1={yFor(tick)}
              y2={yFor(tick)}
            />
            <text className="rawb-review-trend-chart__axis" x={padding.left - 10} y={yFor(tick) + 4} textAnchor="end">{tick}</text>
          </g>
        ))}
        {chart.years.map((year, index) => (
          <text key={year} className="rawb-review-trend-chart__axis" x={xFor(index)} y={height - 8} textAnchor="middle">{year}</text>
        ))}
        {chart.series.map((series) => {
          const dimmed = activeThemeId && activeThemeId !== series.id;
          const path = series.values.map((value, index) => `${index ? "L" : "M"} ${xFor(index)} ${yFor(value)}`).join(" ");
          return (
            <g key={series.id} className={dimmed ? "is-dimmed" : ""}>
              <path className="rawb-review-trend-chart__line" d={path} style={{ stroke: series.color }} />
              {series.values.map((value, index) => (
                <g key={chart.years[index]}>
                  <circle className="rawb-review-trend-chart__point" cx={xFor(index)} cy={yFor(value)} r="4.5" style={{ fill: series.color }}>
                    <title>{series.label} · {chart.years[index]} · {value} 篇</title>
                  </circle>
                  {(!dimmed && (activeThemeId || value > 0)) ? (
                    <text className="rawb-review-trend-chart__value" x={xFor(index)} y={yFor(value) - 9} textAnchor="middle">{value}</text>
                  ) : null}
                </g>
              ))}
            </g>
          );
        })}
      </svg>
      <figcaption>点击图例可聚焦单一主题；点位表示当前分层样本中的篇数，不是全领域发文量。</figcaption>
    </figure>
  );
}

function ReviewThemeCoverageChart({ synthesis, sources }) {
  const themes = asArray(synthesis?.themeCoverage).slice(0, 6);
  const total = Math.max(1, synthesis?.analyzedSourceCount ?? 0);
  if (!themes.length) return <p className="rawb-review-insight__empty">当前题名摘要未形成稳定主题聚集。</p>;
  return (
    <figure className="rawb-review-bar-chart">
      <ol>
        {themes.map((theme, index) => (
          <li key={theme.id}>
            <span>{theme.label}</span>
            <div className="rawb-review-bar-chart__track" aria-hidden="true">
              <i style={{ width: `${Math.max(3, (theme.count / total) * 100)}%`, background: REVIEW_CHART_COLORS[index % REVIEW_CHART_COLORS.length] }} />
            </div>
            <strong>{theme.count} / {total}</strong>
            <ReviewEvidenceLinks sourceIds={theme.sourceIds} sources={sources} />
          </li>
        ))}
      </ol>
      <figcaption>横条表示主题在 20 篇综述样本中的覆盖比例；一个摘要可以进入多个主题。</figcaption>
    </figure>
  );
}

function ReviewMethodProfile({ synthesis }) {
  const visibility = synthesis?.methodVisibility ?? {};
  const total = Math.max(1, visibility.assessedCount ?? synthesis?.abstractAvailableCount ?? 0);
  const summary = [
    { id: "complete", label: "方法报告较完整", count: visibility.moreCompleteCount ?? 0, color: "#3f9668" },
    { id: "partial", label: "部分方法可见", count: visibility.partialCount ?? 0, color: "#2f6fbd" },
    { id: "unknown", label: "摘要未充分报告", count: visibility.notReportedCount ?? 0, color: "#df6659" },
  ];
  return (
    <figure className="rawb-review-method-profile">
      <div className="rawb-review-method-profile__counts">
        {summary.map((item) => (
          <div key={item.id}>
            <strong style={{ color: item.color }}>{item.count}</strong>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
      <div className="rawb-review-method-profile__stack" aria-label="摘要方法报告完整度分布">
        {summary.filter((item) => item.count > 0).map((item) => (
          <i
            key={item.id}
            style={{ width: `${(item.count / total) * 100}%`, background: item.color }}
            title={`${item.label}：${item.count} 篇`}
          />
        ))}
      </div>
      <ol className="rawb-review-method-bars">
        {asArray(synthesis?.methodSignals).slice(0, 6).map((signal) => (
          <li key={signal.id}>
            <span>{signal.label}</span>
            <div aria-hidden="true"><i style={{ width: `${Math.max(3, (signal.count / total) * 100)}%` }} /></div>
            <strong>{signal.count} / {total}</strong>
          </li>
        ))}
      </ol>
      <figcaption>{visibility.boundary}</figcaption>
    </figure>
  );
}

function ReviewGapDistribution({ synthesis, sources }) {
  const gaps = asArray(synthesis?.gapClusters).slice(0, 4);
  const [activeGapId, setActiveGapId] = useState(gaps[0]?.id ?? null);
  const total = Math.max(1, gaps.reduce((sum, gap) => sum + gap.count, 0));
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  let cursor = 0;
  const segments = gaps.map((gap, index) => {
    const length = (gap.count / total) * circumference;
    const segment = { ...gap, color: REVIEW_CHART_COLORS[(index + 1) % REVIEW_CHART_COLORS.length], length, offset: cursor };
    cursor += length;
    return segment;
  });
  const activeGap = gaps.find((gap) => gap.id === activeGapId) ?? gaps[0];

  if (!gaps.length) {
    return <p className="rawb-review-insight__empty">当前可用摘要没有形成可追溯的缺口聚类。</p>;
  }

  return (
    <figure className="rawb-review-gap-chart">
      <div className="rawb-review-gap-chart__visual">
        <svg viewBox="0 0 130 130" role="img" aria-label={`摘要明确缺口信号共 ${total} 条`}>
          <circle className="rawb-review-gap-chart__base" cx="65" cy="65" r={radius} />
          {segments.map((segment) => (
            <circle
              key={segment.id}
              className="rawb-review-gap-chart__segment"
              cx="65"
              cy="65"
              r={radius}
              style={{ stroke: segment.color }}
              strokeDasharray={`${segment.length} ${circumference - segment.length}`}
              strokeDashoffset={-segment.offset}
            >
              <title>{segment.label}：{segment.count} 条</title>
            </circle>
          ))}
          <text x="65" y="59" textAnchor="middle">{total} 条</text>
          <text x="65" y="76" textAnchor="middle">明确缺口信号</text>
        </svg>
        <ol>
          {segments.map((gap) => (
            <li key={gap.id}>
              <button
                type="button"
                className={activeGap?.id === gap.id ? "is-selected" : ""}
                onClick={() => setActiveGapId(gap.id)}
              >
                <i style={{ background: gap.color }} aria-hidden="true" />
                <span>{gap.label}</span>
                <strong>{gap.count}</strong>
              </button>
            </li>
          ))}
        </ol>
      </div>
      {activeGap ? (
        <div className="rawb-review-gap-chart__evidence">
          <p>{activeGap.evidenceExcerpts?.[0]?.text ?? "摘要明确出现该缺口信号；请核对原摘要。"}</p>
          <ReviewEvidenceLinks sourceIds={activeGap.sourceIds} sources={sources} />
        </div>
      ) : null}
      <figcaption>环图统计摘要明确表达的缺口信号；同一篇综述可能贡献多个信号。</figcaption>
    </figure>
  );
}

function ReviewEvidencePath({ synthesis, sources }) {
  const candidates = asArray(synthesis?.breakthroughCandidates).slice(0, 4);
  const [activeCandidateId, setActiveCandidateId] = useState(candidates[0]?.id ?? null);
  const themeById = new Map(asArray(synthesis?.themeCoverage).map((theme) => [theme.id, theme]));
  const gapById = new Map(asArray(synthesis?.gapClusters).map((gap) => [gap.id, gap]));
  const activeCandidate = candidates.find((candidate) => candidate.id === activeCandidateId) ?? candidates[0];

  if (!candidates.length) {
    return <p className="rawb-review-insight__empty">当前摘要证据还不足以生成可追溯的候选突破口。</p>;
  }

  return (
    <div className="rawb-review-evidence-path">
      <div className="rawb-review-evidence-path__head" aria-hidden="true">
        <span>主题</span><span>摘要明确缺口</span><span>候选研究方向</span>
      </div>
      <ol>
        {candidates.map((candidate, index) => {
          const theme = themeById.get(candidate.themeId);
          const gap = gapById.get(candidate.gapId);
          const selected = candidate.id === activeCandidate?.id;
          const color = REVIEW_CHART_COLORS[index % REVIEW_CHART_COLORS.length];
          return (
            <li key={candidate.id} style={{ "--path-color": color }}>
              <span className="rawb-review-evidence-path__node">
                <strong>{theme?.label ?? "主题待核"}</strong>
                <small>{theme?.count ?? 0} 篇综述</small>
              </span>
              <i className="rawb-review-evidence-path__connector" aria-hidden="true" />
              <span className="rawb-review-evidence-path__node">
                <strong>{gap?.label ?? "缺口待核"}</strong>
                <small>{gap?.count ?? 0} 条信号</small>
              </span>
              <i className="rawb-review-evidence-path__connector" aria-hidden="true" />
              <button
                type="button"
                className={selected ? "rawb-review-evidence-path__node is-selected" : "rawb-review-evidence-path__node"}
                aria-pressed={selected}
                onClick={() => setActiveCandidateId(candidate.id)}
              >
                <strong>{REVIEW_DIRECTION_LABELS[candidate.themeId] ?? theme?.label ?? "候选方向"}</strong>
                <small>查看问题与依据</small>
              </button>
            </li>
          );
        })}
      </ol>
      {activeCandidate ? (
        <div className="rawb-review-evidence-path__detail" aria-live="polite">
          <span>当前候选问题</span>
          <strong>{activeCandidate.question}</strong>
          <p>{activeCandidate.basis}</p>
          <ReviewEvidenceLinks sourceIds={activeCandidate.sourceIds} sources={sources} />
        </div>
      ) : null}
    </div>
  );
}

function ReviewEvidenceAtlas({ landscape, synthesis, sources }) {
  return (
    <div className="rawb-review-atlas">
      <div className="rawb-review-atlas__metrics">
        <ReviewMetric icon="calendar" label="检索时段" value={`${landscape.reviewWindow?.from} — ${landscape.reviewWindow?.to}`} />
        <ReviewMetric icon="document" label="已分析" value={`${synthesis.analyzedSourceCount} 篇`} />
        <ReviewMetric icon="check" label="摘要可用" value={`${synthesis.abstractAvailableCount} 篇`} />
        <ReviewMetric icon="layers" label="抽样方式" value="按年份分层" detail={landscape.samplingStrategy?.label?.replace("按年份分层 · ", "")} />
      </div>

      <div className="rawb-review-atlas__primary">
        <section aria-labelledby="rawb-review-trends-title">
          <div className="rawb-review-atlas__heading">
            <h4 id="rawb-review-trends-title"><span>1</span>时间趋势：主题信号随年份变化</h4>
            <p>当前分层样本的主题轨迹</p>
          </div>
          <ReviewTrendChart synthesis={synthesis} sources={sources} />
        </section>
        <section aria-labelledby="rawb-review-covered-title">
          <div className="rawb-review-atlas__heading">
            <h4 id="rawb-review-covered-title"><span>2</span>主题覆盖度排名</h4>
            <p>按摘要明确涉及排序</p>
          </div>
          <ReviewThemeCoverageChart synthesis={synthesis} sources={sources} />
        </section>
        <section aria-labelledby="rawb-review-methods-title">
          <div className="rawb-review-atlas__heading">
            <h4 id="rawb-review-methods-title"><span>3</span>方法学报告完整性概览</h4>
            <p>仅评价摘要层可见信号</p>
          </div>
          <ReviewMethodProfile synthesis={synthesis} />
        </section>
      </div>

      <div className="rawb-review-atlas__secondary">
        <section aria-labelledby="rawb-review-gaps-title">
          <div className="rawb-review-atlas__heading">
            <h4 id="rawb-review-gaps-title"><span>4</span>明确报告的证据缺口分布</h4>
            <p>只有摘要明确表达才进入</p>
          </div>
          <ReviewGapDistribution synthesis={synthesis} sources={sources} />
        </section>
        <section aria-labelledby="rawb-review-breakthroughs-title">
          <div className="rawb-review-atlas__heading">
            <h4 id="rawb-review-breakthroughs-title"><span>5</span>证据路径：从主题到候选研究方向</h4>
            <p>点击方向查看问题、依据与 PMID</p>
          </div>
          <ReviewEvidencePath synthesis={synthesis} sources={sources} />
        </section>
      </div>
    </div>
  );
}

function ReviewDirectionReport({ report, sources }) {
  const directions = asArray(report?.directions);
  if (!report || !directions.length) return null;
  return (
    <section className="rawb-review-direction-report" aria-labelledby="rawb-review-direction-report-title">
      <header>
        <div>
          <span>文字研判 · 从现象到解决方案</span>
          <h4 id="rawb-review-direction-report-title">{report.title}</h4>
        </div>
        <p>{report.executiveSummary}</p>
      </header>
      <p className="rawb-review-direction-report__principle"><strong>方向选择原则：</strong>{report.solutionPrinciple}</p>
      <ol className="rawb-review-direction-report__directions">
        {directions.map((direction) => (
          <li key={direction.id}>
            <div className="rawb-review-direction-report__rank" aria-hidden="true">
              {String(direction.rank).padStart(2, "0")}
            </div>
            <article>
              <div className="rawb-review-direction-report__heading">
                <div>
                  <span>{direction.priorityLabel}</span>
                  <h5>{direction.direction}</h5>
                </div>
                <ReviewEvidenceLinks sourceIds={direction.sourceIds} sources={sources} />
              </div>
              <p className="rawb-review-direction-report__why"><strong>为什么适合研究：</strong>{direction.whySuitable}</p>
              <blockquote>
                <span>推荐研究问题</span>
                <p>{direction.recommendedQuestion}</p>
              </blockquote>
              <div className="rawb-review-direction-report__solution">
                <div>
                  <span>建议研究设计</span>
                  <p>{direction.studyPlan?.studyDesign}</p>
                </div>
                <div>
                  <span>人群与比较条件</span>
                  <p>{direction.studyPlan?.populationAndComparison}</p>
                </div>
                <div>
                  <span>核心结局</span>
                  <p>{asArray(direction.studyPlan?.coreOutcomes).join("、")}</p>
                </div>
              </div>
              <div className="rawb-review-direction-report__steps">
                <strong>解决方案：如何把方向变成可执行研究</strong>
                <ol>
                  {asArray(direction.studyPlan?.executionSteps).map((step, index) => (
                    <li key={step}><span>{index + 1}</span><p>{step}</p></li>
                  ))}
                </ol>
              </div>
              <p className="rawb-review-direction-report__gate"><strong>进入下一轮的门槛：</strong>{direction.studyPlan?.decisionGate}</p>
              <p className="rawb-review-direction-report__boundary">{direction.boundary}</p>
            </article>
          </li>
        ))}
      </ol>
      <footer>
        <p><strong>下一决定：</strong>{report.nextDecision}</p>
        <p><strong>建议边界：</strong>{report.boundary}</p>
      </footer>
    </section>
  );
}

function DirectionSelectionPanel({
  report,
  decision,
  busy,
  onChange,
  onSubmit,
}) {
  const directions = asArray(report?.directions);
  if (!directions.length) return null;
  const selected = directions.find((direction) => direction.id === decision.selectedDirectionId)
    ?? directions[0];
  return (
    <section className="rawb-direction-decision" aria-labelledby="rawb-direction-decision-title">
      <header>
        <div>
          <span>首轮调查的人类决定</span>
          <h3 id="rawb-direction-decision-title">选择一个方向，进入第二轮收窄</h3>
        </div>
        <strong>不会覆盖首轮</strong>
      </header>
      <p className="rawb-direction-decision__intro">
        这是科研决定，不是界面筛选。系统会保存采用理由与暂缓理由，再围绕收窄问题重跑检索校准和综述扫描。
      </p>
      <fieldset className="rawb-direction-decision__options">
        <legend>本轮采用方向</legend>
        {directions.map((direction) => (
          <label
            key={direction.id}
            className={direction.id === selected.id ? "is-selected" : ""}
          >
            <input
              type="radio"
              name="research-direction"
              checked={direction.id === selected.id}
              onChange={() => onChange({ selectedDirectionId: direction.id })}
            />
            <span>
              <strong>{direction.direction}</strong>
              <small>{direction.recommendedQuestion}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="rawb-direction-decision__question">
        <span>建议的第二轮问题</span>
        <strong>{selected.recommendedQuestion}</strong>
        <p>{selected.whySuitable}</p>
      </div>
      <label htmlFor="rawb-direction-selection-reason">为什么本轮采用这个方向</label>
      <textarea
        id="rawb-direction-selection-reason"
        value={decision.selectionReason}
        onChange={(event) => onChange({ selectionReason: event.target.value })}
        placeholder="写明科研价值、可行性、团队条件或当前最值得消除的不确定性。"
        rows={3}
        maxLength={2000}
      />
      {directions.length > 1 ? (
        <>
          <label htmlFor="rawb-direction-deferred-reason">其余方向为什么本轮暂缓</label>
          <textarea
            id="rawb-direction-deferred-reason"
            value={decision.deferredReason}
            onChange={(event) => onChange({ deferredReason: event.target.value })}
            placeholder="例如：先作为备选，等待第二轮范围、文献量与可行性比较。"
            rows={2}
            maxLength={2000}
          />
        </>
      ) : null}
      <footer>
        <p>边界：当前依据为 PubMed 题名与可用摘要；本轮选择仅用于聚焦下一轮检索。立题前仍需比较近两年同题综述，并确认原始研究数量、范围与可获取性。</p>
        <button type="button" onClick={onSubmit} disabled={busy}>
          {busy ? "正在记录决定并生成第二轮…" : "记录决定，进入第二轮调查"}
        </button>
      </footer>
    </section>
  );
}

function ReviewLandscapeReport({
  landscape,
  question = "",
  researchReport = null,
  firstRound = null,
  secondRound = null,
  decision = null,
  lockedDirection = null,
  onDecisionChange = null,
  onPrimaryAction = null,
  primaryActionLabel = "确认方向并开始第二轮窄检索",
  busy = false,
  storageKey = "research-review-report",
  currentBinding = null,
}) {
  if (!landscape) return null;
  const brief = landscape.stageBrief ?? {};
  const synthesis = landscape.synthesis ?? null;
  const sources = asArray(landscape.sources);
  const statusLabel = landscape.status === "ready"
    ? `已分析 ${synthesis?.analyzedSourceCount ?? landscape.sampledCount ?? 0} 篇`
    : landscape.status === "zero_results"
      ? "0 篇"
      : "扫描失败";
  const hasStructuredReport = Boolean(synthesis || researchReport || landscape?.researchReport);
  if (["ready", "blocked"].includes(landscape.status) && hasStructuredReport) {
    return (
      <ResearchReviewReport
        landscape={landscape}
        question={question}
        researchReport={researchReport}
        firstRound={firstRound}
        secondRound={secondRound}
        selectedDirectionId={decision?.selectedDirectionId ?? lockedDirection?.id ?? ""}
        lockedDirection={lockedDirection}
        selectionReason={decision?.selectionReason ?? ""}
        deferredReason={decision?.deferredReason ?? ""}
        onDirectionSelect={onDecisionChange
          ? (selectedDirectionId) => onDecisionChange({ selectedDirectionId })
          : null}
        onSelectionReasonChange={onDecisionChange
          ? (selectionReason) => onDecisionChange({ selectionReason })
          : null}
        onDeferredReasonChange={onDecisionChange
          ? (deferredReason) => onDecisionChange({ deferredReason })
          : null}
        onPrimaryAction={onPrimaryAction}
        primaryActionLabel={primaryActionLabel}
        busy={busy}
        storageKey={storageKey}
        currentBinding={currentBinding}
      />
    );
  }
  return (
    <section className={`rawb-review-landscape is-${landscape.status}`} aria-labelledby="rawb-review-landscape-title">
      <header>
        <div>
          <span>第一个选题调查循环</span>
          <h3 id="rawb-review-landscape-title">近五年综述 · 摘要级选题分析</h3>
        </div>
        <strong>{statusLabel}</strong>
      </header>
      {landscape.status === "ready" ? (
        <>
          {synthesis ? (
            <ResearchReviewReport
              landscape={landscape}
              question={question}
              researchReport={researchReport}
              firstRound={firstRound}
              secondRound={secondRound}
              selectedDirectionId={decision?.selectedDirectionId ?? lockedDirection?.id ?? ""}
              lockedDirection={lockedDirection}
              selectionReason={decision?.selectionReason ?? ""}
              deferredReason={decision?.deferredReason ?? ""}
              onDirectionSelect={onDecisionChange
                ? (selectedDirectionId) => onDecisionChange({ selectedDirectionId })
                : null}
              onSelectionReasonChange={onDecisionChange
                ? (selectionReason) => onDecisionChange({ selectionReason })
                : null}
              onDeferredReasonChange={onDecisionChange
                ? (deferredReason) => onDecisionChange({ deferredReason })
                : null}
              onPrimaryAction={onPrimaryAction}
              primaryActionLabel={primaryActionLabel}
              busy={busy}
              storageKey={storageKey}
              currentBinding={currentBinding}
            />
          ) : (
            <details className="rawb-review-landscape__sources">
              <summary>查看本轮读取的 {landscape.sampledCount} 篇综述题录</summary>
              <ol>{sources.map((source) => <li key={source.sourceId ?? source.pmid}><strong>{source.title}</strong></li>)}</ol>
            </details>
          )}
        </>
      ) : landscape.error ? <p className="rawb-review-landscape__error">{landscape.error.message}</p> : null}
      {!synthesis ? (
        <footer>
          <p><strong>依据与边界：</strong>{brief.evidenceBoundary}</p>
          <p><strong>下一决定：</strong>{brief.nextDecision}</p>
        </footer>
      ) : null}
    </section>
  );
}

function LoadingWorkspace() {
  return (
    <div className="rawb-loading" role="status" aria-live="polite">
      <span className="rawb-loading__firefly" aria-hidden="true" />
      <strong>正在打开科研工作台…</strong>
      <p>同步项目、证据与当前研究简报。</p>
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
  const initialScopingDraft = useMemo(() => loadScopingDraft(), []);

  const [runtime, setRuntime] = useState(null);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [runtimeError, setRuntimeError] = useState("");
  const [lastTechnicalError, setLastTechnicalError] = useState(null);
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId);
  const [project, setProject] = useState(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [projectLoading, setProjectLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionFeedback, setActionFeedback] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [activeTab, setActiveTab] = useState("task");
  const [createOpen, setCreateOpen] = useState(initialScopingDraft?.createOpen === true);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [bootstrapRevision, setBootstrapRevision] = useState(0);
  const [createStep, setCreateStep] = useState(initialScopingDraft?.createStep ?? "question");
  const [queryPlan, setQueryPlan] = useState(initialScopingDraft?.queryPlan ?? null);
  const [queryCalibration, setQueryCalibration] = useState(initialScopingDraft?.queryCalibration ?? null);
  const [queryPreview, setQueryPreview] = useState(initialScopingDraft?.queryPreview ?? null);
  const [selectedQueryId, setSelectedQueryId] = useState(initialScopingDraft?.selectedQueryId ?? "");
  const [scopingRound, setScopingRound] = useState(initialScopingDraft?.scopingRound === 2 ? 2 : 1);
  const [directionSelection, setDirectionSelection] = useState(initialScopingDraft?.directionSelection ?? null);
  const [directionDecision, setDirectionDecision] = useState(initialScopingDraft?.directionDecision ?? {
    selectedDirectionId: "",
    selectionReason: "",
    deferredReason: "",
  });
  const [createForm, setCreateForm] = useState(initialScopingDraft?.createForm ?? {
      title: "",
      question: "",
      searchQuery: "",
      completionProfileId: "evidence_brief",
      constraints: "",
      sourceMaterials: "",
    });

  const request = useCallback(async (path, { method = "GET", body, signal, idempotencyKey } = {}) => {
    if (typeof fetchImpl !== "function") {
      const apiError = new ResearchApiError("当前环境没有可用的网络请求能力。", { code: "FETCH_UNAVAILABLE" });
      setLastTechnicalError(apiError);
      throw apiError;
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
      const apiError = new ResearchApiError("无法连接科研运行时，请确认本地服务仍在运行。", {
        code: "NETWORK_ERROR",
      });
      setLastTechnicalError(apiError);
      throw apiError;
    }

    const raw = await response.text();
    let payload = null;
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        const apiError = new ResearchApiError("科研接口返回了无法识别的数据。", {
          status: response.status,
          code: "INVALID_JSON",
        });
        setLastTechnicalError(apiError);
        throw apiError;
      }
    }
    if (!response.ok) {
      const apiError = new ResearchApiError(
        firstText(payload?.message, payload?.error?.message, payload?.error) ?? `请求失败（${response.status}）`,
        {
          status: response.status,
          code: firstText(payload?.code, payload?.error?.code) ?? "REQUEST_FAILED",
          payload,
        },
      );
      setLastTechnicalError(apiError);
      throw apiError;
    }
    return payload;
  }, [base, fetchImpl]);

  useEffect(() => {
    const hasDraft = createOpen && (
      createStep !== "question" ||
      createForm.question.trim().length > 0 ||
      directionSelection
    );
    if (!hasDraft) {
      saveScopingDraft(null);
      return;
    }
    saveScopingDraft({
      createOpen,
      createStep,
      queryPlan,
      queryCalibration,
      queryPreview,
      selectedQueryId,
      scopingRound,
      directionSelection,
      directionDecision,
      createForm,
    });
  }, [
    createForm,
    createOpen,
    createStep,
    directionDecision,
    directionSelection,
    queryCalibration,
    queryPlan,
    queryPreview,
    scopingRound,
    selectedQueryId,
  ]);

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
          setError(projectsResult.reason ?? "无法读取研究项目。");
          setBootLoading(false);
        }
        return;
      }

      const nextProjects = projectsFromPayload(projectsResult.value);
      setProjects(nextProjects);
      const requestedId = initialProjectId || projectId(
        nextProjects.find((candidate) => candidate?.loadable !== false),
      );
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
        if (loadError?.name !== "AbortError") setError(loadError ?? "无法打开研究项目。");
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
      setActionFeedback("领域简报已更新，请核对新的结论、依据和下一项科研决定。");
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
          setError(pollError ?? "刷新研究材料失败。");
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
      if (loadError?.name !== "AbortError") setError(loadError ?? "无法打开研究项目。");
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
      if (loadError?.name !== "AbortError") setError(loadError ?? "刷新失败。");
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
    setActionFeedback("已打开完整科研成果与证据来源。");
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
        run: "下一项研究工作已开始；形成新的可核查材料后，本简报会更新。",
        resume: "研究已恢复，将从上次中断处继续；已有材料保持不变。",
        pause: "研究已暂停，已有文献、判断和决定均已保留。",
        cancel: "本轮已经停止；原项目和已有研究记录仍然保留。",
      }[action] ?? "研究材料已经更新。";
      revealUserBrief(feedback);
    } catch (actionError) {
      setError(actionError ?? "当前操作没有完成，请稍后重试。");
    } finally {
      setBusyAction("");
      setCancelArmed(false);
    }
  }, [commitProject, loadProject, request, revealUserBrief]);

  const resetQueryPlanning = useCallback(() => {
    createIdempotencyKeyRef.current = "";
    saveScopingDraft(null);
    setCreateStep("question");
    setQueryPlan(null);
    setQueryCalibration(null);
    setQueryPreview(null);
    setSelectedQueryId("");
    setScopingRound(1);
    setDirectionSelection(null);
    setDirectionDecision({
      selectedDirectionId: "",
      selectionReason: "",
      deferredReason: "保留为备选，等待第二轮检索范围、文献量与可行性比较后再决定。",
    });
    setCreateForm((form) => ({ ...form, searchQuery: "" }));
  }, []);

  const handlePreviewQueries = useCallback(async (event) => {
    event.preventDefault();
    const question = normalizeResearchQuestionInput(createForm.question);
    if (!researchQuestionCanPreview(question)) {
      setError("请至少输入 4 个字说明想研究的问题。中文问题可以直接开始。");
      return;
    }
    setBusyAction("query-plan");
    setError("");
    try {
      const plan = await request("/query-plan", {
        method: "POST",
        body: { question },
      });
      const candidates = asArray(plan?.candidates);
      const selectable = candidates[0];
      if (!selectable) throw new ResearchApiError("没有生成可检查的检索候选。", { code: "EMPTY_QUERY_PLAN" });
      setQueryPlan(plan);
      setQueryCalibration(null);
      setQueryPreview(null);
      setSelectedQueryId(selectable.id);
      setCreateForm((form) => ({
        ...form,
        title: form.title.trim() || question.replace(/[？?。.!！]+$/g, "").slice(0, 42),
        searchQuery: selectable.query ?? "",
      }));
      setCreateStep("strategy");
    } catch (previewError) {
      setError(previewError ?? "专业检索策略没有生成，请保留当前问题后重试。");
    } finally {
      setBusyAction("");
    }
  }, [createForm.question, request]);

  const handleConfirmQueryPlan = useCallback(async (event) => {
    event.preventDefault();
    const selected = asArray(queryPlan?.candidates).find((candidate) => candidate.id === selectedQueryId);
    const query = createForm.searchQuery.trim();
    const body = buildResearchWorkbenchCalibrationPayload({
      question: createForm.question,
      queryPlan,
      selectedQueryId,
      editedQuery: selected?.query === query ? null : query,
    });
    if (!body) {
      setError("请先选择一个检索路径，并保留至少 3 个字符的 PubMed 检索式。");
      return;
    }
    setBusyAction("query-calibration");
    setError("");
    try {
      const calibration = await request("/query-calibration", { method: "POST", body });
      const revised = asArray(calibration?.revisedPlan?.candidates)[0];
      if (!revised) throw new ResearchApiError("前 100 篇反馈没有返回可确认的检索策略。", { code: "EMPTY_QUERY_CALIBRATION" });
      setQueryCalibration(calibration);
      setQueryPreview(null);
      setSelectedQueryId(revised.id);
      setCreateForm((form) => ({ ...form, searchQuery: revised.query ?? query }));
      setCreateStep("calibration");
    } catch (previewError) {
      setError(previewError ?? "前 100 篇反馈校准没有完成，请保留当前策略后重试。");
    } finally {
      setBusyAction("");
    }
  }, [createForm.question, createForm.searchQuery, queryPlan, request, selectedQueryId]);

  const handleConfirmCalibration = useCallback(async (event) => {
    event.preventDefault();
    const revisedPlan = queryCalibration?.revisedPlan;
    const selected = asArray(revisedPlan?.candidates).find((candidate) => candidate.id === selectedQueryId);
    const query = createForm.searchQuery.trim();
    const body = buildResearchWorkbenchReviewPreviewPayload({
      question: createForm.question,
      queryPlan: revisedPlan,
      selectedQueryId,
      editedQuery: selected?.query === query ? null : query,
      calibrationHash: queryCalibration?.calibrationHash,
    });
    if (!body) {
      setError("请先选择修订后的检索路径，并保留至少 3 个字符的 PubMed 检索式。");
      return;
    }
    setBusyAction("query-preview");
    setError("");
    try {
      const preview = await request("/query-preview", { method: "POST", body });
      const confirmedId = preview?.reviewLandscape?.selectedCandidateId ?? body.reviewScanCandidateId;
      const confirmed = asArray(preview?.candidates).find((candidate) => candidate.id === confirmedId)
        ?? asArray(preview?.candidates)[0];
      if (!confirmed) throw new ResearchApiError("近五年综述扫描没有返回可检查结果。", { code: "EMPTY_QUERY_PREVIEW" });
      setQueryPreview(preview);
      setSelectedQueryId(confirmed.id);
      if (scopingRound === 1) {
        setDirectionDecision({ selectedDirectionId: "", selectionReason: "", deferredReason: "" });
      }
      setCreateForm((form) => ({ ...form, searchQuery: confirmed.query ?? query }));
      setCreateStep("review");
    } catch (previewError) {
      setError(previewError ?? "近五年综述扫描没有完成，请保留当前策略后重试。");
    } finally {
      setBusyAction("");
    }
  }, [createForm.question, createForm.searchQuery, queryCalibration, request, scopingRound, selectedQueryId]);

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
          reviewScanCandidateId: "researcher_edited",
          reviewWindowYears: 5,
          reviewSampleLimit: 20,
        },
      });
      setQueryPreview(preview);
      setSelectedQueryId("researcher_edited");
      if (scopingRound === 1) {
        setDirectionDecision({ selectedDirectionId: "", selectionReason: "", deferredReason: "" });
      }
      setCreateForm((form) => ({ ...form, searchQuery: preview.candidates[0].query }));
    } catch (previewError) {
      setError(previewError ?? "修订检索式没有完成真实试检，请继续在本步修改。");
    } finally {
      setBusyAction("");
    }
  }, [createForm.question, createForm.searchQuery, queryPreview, request, scopingRound, selectedQueryId]);

  const handleDirectionDecisionChange = useCallback((change) => {
    setDirectionDecision((current) => ({ ...current, ...change }));
  }, []);

  const handleChooseDirection = useCallback(async () => {
    const body = buildResearchWorkbenchDirectionSelectionPayload({
      queryPreview,
      ...directionDecision,
    });
    if (!body) {
      setError("请选择一个方向，并分别写明采用理由与其余方向暂缓理由（至少 4 个字）。");
      return;
    }
    setBusyAction("direction-selection");
    setError("");
    try {
      const roundOneCheckpoint = firstRoundCheckpointFrom({
        queryPlan,
        queryCalibration,
        queryPreview,
        selectedQueryId,
        createForm,
        directionDecision,
      });
      const selection = await request("/direction-selection", { method: "POST", body });
      const narrowedQuestion = normalizeResearchQuestionInput(selection?.narrowedBrief?.question);
      if (!researchQuestionCanPreview(narrowedQuestion)) {
        throw new ResearchApiError("方向决定已记录，但没有生成可执行的第二轮问题。", {
          code: "EMPTY_NARROWED_QUESTION",
        });
      }
      setDirectionSelection({ ...selection, roundOneCheckpoint });
      setScopingRound(2);
      setQueryPlan(null);
      setQueryCalibration(null);
      setQueryPreview(null);
      setSelectedQueryId("");
      setCreateForm((form) => ({
        ...form,
        question: narrowedQuestion,
        searchQuery: "",
        title: narrowedQuestion.replace(/[？?。.!！]+$/g, "").slice(0, 42),
      }));
      setCreateStep("question");

      const plan = await request("/query-plan", {
        method: "POST",
        body: {
          question: narrowedQuestion,
          directionSelectionHash: selection.decisionHash,
        },
      });
      const candidate = asArray(plan?.candidates)[0];
      if (!candidate) {
        throw new ResearchApiError("第二轮没有生成可检查的检索候选。", {
          code: "EMPTY_QUERY_PLAN",
        });
      }
      setQueryPlan(plan);
      setSelectedQueryId(candidate.id);
      setCreateForm((form) => ({ ...form, searchQuery: candidate.query ?? "" }));
      setCreateStep("strategy");
    } catch (selectionError) {
      setError(selectionError ?? "方向决定没有进入第二轮调查，请保留当前记录后重试。");
    } finally {
      setBusyAction("");
    }
  }, [createForm, directionDecision, queryCalibration, queryPlan, queryPreview, request, selectedQueryId]);

  const handleReturnToFirstRound = useCallback(() => {
    const restored = restoredFirstRoundState(directionSelection);
    if (!restored) {
      setError("当前无法恢复首轮材料；请保留研究问题与检索式并重新开始首轮扫描。");
      return;
    }
    setError("");
    setActionFeedback("已恢复首轮报告与方向选择；第二轮结果不会覆盖首轮材料。");
    setScopingRound(restored.scopingRound);
    setQueryPlan(restored.queryPlan);
    setQueryCalibration(restored.queryCalibration);
    setQueryPreview(restored.queryPreview);
    setSelectedQueryId(restored.selectedQueryId);
    setCreateForm(restored.createForm);
    if (restored.directionDecision) setDirectionDecision(restored.directionDecision);
    setDirectionSelection(restored.directionSelection);
    setCreateStep(restored.createStep);
  }, [directionSelection]);

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
          directionSelection,
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
      setQueryPlan(null);
      setQueryCalibration(null);
      setQueryPreview(null);
      setSelectedQueryId("");
      setScopingRound(1);
      setDirectionSelection(null);
      setDirectionDecision({
        selectedDirectionId: "",
        selectionReason: "",
        deferredReason: "保留为备选，等待第二轮检索范围、文献量与可行性比较后再决定。",
      });
      saveScopingDraft(null);
      setCreateOpen(false);
      setActiveTab("task");
      if (created && projectId(created)) commitProject(created);
      await loadProject(id, { quiet: true });
      revealUserBrief("新项目已经建立；第一份领域研究简报已放在主操作区下方。");
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
      setError(createError ?? "项目创建失败，请检查输入后重试。");
    } finally {
      setBusyAction("");
    }
  }, [commitProject, createForm, directionSelection, loadProject, queryPreview, request, revealUserBrief, selectedQueryId]);

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
      setError(retryError ?? "重新检索没有完成，请修改检索式后重试。");
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
      revealUserBrief("新版检索协议已保存；后续检索将按新协议重新执行，既有结果仅供追溯。");
    } catch (revisionError) {
      if (revisionError?.project && projectId(revisionError.project)) {
        commitProject(revisionError.project);
      }
      setError(revisionError ?? "新版检索协议没有保存，请核对失败原因与检索式后重试。");
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
      setError(decisionError ?? "研究决定没有记录，请重试。");
    } finally {
      setBusyAction("");
    }
  }, [commitProject, gate, loadProject, request, revealUserBrief]);

  const handleReviewDecision = useCallback(async (decision, reason) => {
    const id = selectedProjectIdRef.current;
    const nodeId = firstText(review?.nodeId, review?.id, review?.reviewId);
    if (!id || !nodeId) {
      setError("当前复核项缺少必要的研究记录，请刷新项目后重试。");
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
      revealUserBrief("复核结果已经记录；领域简报与下一项科研决定已更新。");
    } catch (decisionError) {
      setError(decisionError ?? "复核意见没有记录，请重试。");
    } finally {
      setBusyAction("");
    }
  }, [commitProject, loadProject, request, revealUserBrief, review]);

  const contentMaturity = project?.contentMaturity && typeof project.contentMaturity === "object"
    ? project.contentMaturity
    : {};
  const processDraft = firstText(contentMaturity.code)?.toLowerCase() === "guided_draft";
  const blockerRetryClass = firstText(project?.blocker?.retryClass);

  const primaryAction = useMemo(() => {
    if (!project) return { label: "开始一个研究项目", kind: "create", disabled: false };
    if (gate) return { label: "先完成这项研究决定", kind: "decision", disabled: false };
    if (review) return { label: "先完成人工复核", kind: "decision", disabled: false };
    if (status === "paused") return { label: "继续研究", kind: "resume", disabled: busyAction !== "" };
    if (status === "blocked" && blockerRetryClass === "protocol_revision_required") {
      return { label: "请先修订检索协议", kind: "recovery", disabled: false };
    }
    if (status === "blocked" && blockerRetryClass === "same_protocol_retry") {
      return { label: "请确认后按原式重试", kind: "recovery", disabled: false };
    }
    if (status === "blocked" && blockerRetryClass === "human_review_required") {
      return { label: "请先判断恢复方式", kind: "recovery", disabled: false };
    }
    if (status === "blocked") return { label: "已检查问题，继续研究", kind: "resume", disabled: busyAction !== "" };
    if (POLLING_STATUSES.has(status)) return { label: "正在整理研究材料…", kind: "busy", disabled: true };
    if (status === "completed") return { label: "查看领域研究简报", kind: "result", disabled: false };
    if (status === "cancelled") return { label: "基于原问题新建研究", kind: "restart", disabled: false };
    if (["awaiting_approval", "awaiting_gate", "awaiting_review"].includes(status)) {
      return { label: "刷新待决定材料", kind: "refresh", disabled: busyAction !== "" };
    }
    return { label: "继续下一步", kind: "run", disabled: busyAction !== "" };
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
      revealUserBrief("已定位到本轮最新的领域研究简报。");
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

  const queryPreviewMatches = asArray(queryPreview?.candidates).some((candidate) =>
    candidate.id === selectedQueryId &&
    candidate.status === "ready" &&
    candidate.query === createForm.searchQuery.trim()
  );
  const formValid =
    scopingRound === 2 &&
    Boolean(directionSelection?.decisionHash) &&
    createForm.title.trim().length >= 2 &&
    researchQuestionCanPreview(createForm.question) &&
    createForm.searchQuery.trim().length >= 3 &&
    queryPreviewMatches;
  const previewQuestionReady = researchQuestionCanPreview(createForm.question);

  return (
    <div className={`research-agent-workbench${createOpen && createStep !== "question" ? " is-planning-search" : ""}`}>
      <a className="rawb-skip-link" href="#rawb-main">跳到当前研究</a>
      <header className="rawb-header">
        <div className="rawb-brand">
          <img className="rawb-brand__mark" src={evidenceFirefly} alt="" />
          <span><strong>科研工作台 · 领域研究简报</strong><small>领域图景 · 趋势分析 · 选题与证据</small></span>
        </div>
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
              className={`rawb-create-form${createStep !== "question" ? " is-calibration" : ""}${createStep === "review" ? " is-review" : ""}`}
              onSubmit={createStep === "question"
                ? handlePreviewQueries
                : createStep === "strategy"
                  ? handleConfirmQueryPlan
                  : createStep === "calibration"
                    ? handleConfirmCalibration
                    : scopingRound === 2
                      ? handleCreate
                      : (event) => event.preventDefault()}
              aria-label={createStep === "question"
                ? "从研究领域或大概问题开始"
                : createStep === "strategy"
                  ? "确认专业 PubMed 检索策略"
                  : createStep === "calibration"
                    ? "确认前 100 篇反馈后的修订策略"
                    : "近五年综述摘要分析汇报"}
            >
              <div className="rawb-create-form__heading">
                <div>
                  <small>{createStep === "review"
                    ? "领域综述分析"
                    : createStep === "question"
                      ? (scopingRound === 1 ? "研究意向" : "收窄研究问题")
                      : createStep === "strategy"
                        ? "PubMed 检索策略"
                        : "检索校准"}{initialScopingDraft ? " · 草稿已保留" : ""}</small>
                  <strong>{createStep === "question" ? (scopingRound === 1 ? "先说研究领域或大概问题" : "确认收窄后的研究问题") : createStep === "strategy" ? "确认检索初稿" : createStep === "calibration" ? "确认前 100 篇反馈与修订" : "查看近五年综述分析"}</strong>
                </div>
                <button type="button" onClick={() => { setCreateOpen(false); resetQueryPlanning(); }}>关闭</button>
              </div>
              {createStep === "question" ? (
                <>
                  <p className="rawb-create-form__intro">{scopingRound === 1
                    ? "先别急着检索。系统会扩展 MeSH 主题词、专业自由词、常用亚型与适用的邻近表达；你确认后才访问 PubMed。"
                    : `已选择“${directionSelection?.selectedDirection?.direction ?? "当前方向"}”。现在围绕收窄问题生成第二轮检索，首轮记录不会被覆盖。`}</p>
                  {scopingRound === 2 && directionSelection?.roundOneCheckpoint ? (
                    <button className="rawb-create-form__restore" type="button" onClick={handleReturnToFirstRound}>返回首轮调整方向</button>
                  ) : null}
                  <label htmlFor="rawb-project-question">想研究的领域或大概问题</label>
                  <textarea
                    ref={titleInputRef}
                    id="rawb-project-question"
                    value={createForm.question}
                    onChange={(event) => setCreateForm((form) => ({ ...form, question: event.target.value }))}
                    placeholder="例如：肺癌免疫治疗；或想了解治疗前血液标志物与预后的关系。"
                    rows={5}
                    maxLength={1200}
                    required
                  />
                  <p className={`rawb-create-form__readiness${previewQuestionReady ? " is-ready" : ""}`} aria-live="polite">
                    {previewQuestionReady
                      ? "可以生成专业检索策略"
                      : "至少输入 4 个字，按钮就会启用"}
                  </p>
                  <button className="rawb-create-submit" type="submit" disabled={busyAction === "query-plan"}>
                    {busyAction === "query-plan" ? "正在拆解概念与词群…" : "生成专业检索策略"}
                  </button>
                  <p className="rawb-create-form__help">第一步允许保持宽泛；最终目标选题会在文献调研之后由研究者单独确认。</p>
                </>
              ) : createStep === "strategy" ? (
                <>
                  <div className="rawb-query-plan__question"><span>研究问题</span><strong>{createForm.question}</strong></div>
                  <div className="rawb-query-plan__notice">
                    <strong>{queryPlanExecutionLabel(queryPlan?.promptExecution?.status)}</strong>
                    <p className={queryPlanExecutionIsWarning(queryPlan?.promptExecution?.status) ? "is-warning" : ""}>{queryPlanReviewHint(queryPlan?.promptExecution?.status)}</p>
                  </div>
                  {asArray(queryPlan?.conceptGroups).length ? (
                    <section className="rawb-concept-matrix" aria-labelledby="rawb-concept-matrix-title">
                      <h3 id="rawb-concept-matrix-title">核心概念与词群</h3>
                      <ol>
                        {queryPlan.conceptGroups.map((group) => (
                          <li key={group.id}>
                            <span>{group.roleLabel}</span>
                            <strong>{group.sourceTerm}</strong>
                            <p>{asArray(group.meshTerms).length ? `MeSH：${group.meshTerms.join(" / ")}；` : "MeSH：待专家核对；"}自由词：{asArray(group.freeTextTerms).join(" / ")}{asArray(group.wildcardTerms).length ? `；截词：${group.wildcardTerms.join(" / ")}` : ""}{asArray(group.proximityTerms).length ? `；邻近：${group.proximityTerms.map((item) => `${item.phrase}~${item.distance}`).join(" / ")}` : ""}{asArray(group.excludedAmbiguities).length ? `；未自动纳入：${group.excludedAmbiguities.join(" / ")}` : ""}</p>
                          </li>
                        ))}
                      </ol>
                    </section>
                  ) : null}
                  {asArray(queryPlan?.unknownChinese).length ? <p className="rawb-query-plan__warning">未可靠映射：{queryPlan.unknownChinese.join("、")}。系统没有擅自翻译，请补充专业英文词或在下方修订。</p> : null}
                  <fieldset className="rawb-query-strategies">
                    <legend>选择检索方案</legend>
                    {asArray(queryPlan?.candidates).map((candidate) => (
                      <QueryStrategyCard
                        key={candidate.id}
                        candidate={candidate}
                        selected={candidate.id === selectedQueryId}
                        onSelect={(selected) => {
                          setSelectedQueryId(selected.id);
                          setCreateForm((form) => ({ ...form, searchQuery: selected.query }));
                        }}
                      />
                    ))}
                  </fieldset>
                  <label htmlFor="rawb-project-search-query">确认前可由专家修订检索式</label>
                  <textarea
                    id="rawb-project-search-query"
                    value={createForm.searchQuery}
                    onChange={(event) => setCreateForm((form) => ({ ...form, searchQuery: event.target.value }))}
                    rows={3}
                    maxLength={5000}
                    required
                  />
                  <p className="rawb-query-plan__boundary">确认后先读取 PubMed 当前排序前 100 条题名与可用摘要，形成词群覆盖、潜在噪声与修订反馈；此时还不会扫描近五年综述，也不会创建项目。{queryPlan?.accessBoundary}</p>
                  <div className="rawb-query-plan__actions">
                    <button type="button" onClick={resetQueryPlanning}>返回改问题</button>
                    <button type="submit" disabled={busyAction === "query-calibration" || createForm.searchQuery.trim().length < 3}>{busyAction === "query-calibration" ? "正在读取前 100 篇…" : "确认初稿并读取前 100 篇"}</button>
                  </div>
                  <p className="rawb-create-form__help">这是人工确认点：点击后才会把当前检索式发送到 PubMed；仍不会创建项目。</p>
                </>
              ) : createStep === "calibration" ? (
                <>
                  <div className="rawb-query-plan__question"><span>研究问题</span><strong>{createForm.question}</strong></div>
                  <QueryCalibrationReport calibration={queryCalibration} />
                  <fieldset className="rawb-query-strategies">
                    <legend>{queryCalibration?.revision?.status === "completed" ? "选择自动修订方案" : "选择保留方案或手动修订"}</legend>
                    {asArray(queryCalibration?.revisedPlan?.candidates).map((candidate) => (
                      <QueryStrategyCard
                        key={candidate.id}
                        candidate={candidate}
                        selected={candidate.id === selectedQueryId}
                        onSelect={(selected) => {
                          setSelectedQueryId(selected.id);
                          setCreateForm((form) => ({ ...form, searchQuery: selected.query }));
                        }}
                      />
                    ))}
                  </fieldset>
                  <label htmlFor="rawb-project-search-query">确认前可由专家继续修订检索式</label>
                  <textarea
                    id="rawb-project-search-query"
                    value={createForm.searchQuery}
                    onChange={(event) => setCreateForm((form) => ({ ...form, searchQuery: event.target.value }))}
                    rows={4}
                    maxLength={5000}
                    required
                  />
                  <p className="rawb-query-plan__boundary">{queryCalibration?.accessBoundary} 确认后才会使用当前式扫描 {queryCalibration?.revisedPlan?.reviewWindow?.from}—{queryCalibration?.revisedPlan?.reviewWindow?.to} 的 PubMed 综述。</p>
                  <div className="rawb-query-plan__actions">
                    <button type="button" onClick={() => {
                      const fallback = asArray(queryPlan?.candidates)[0];
                      setQueryCalibration(null);
                      setSelectedQueryId(fallback?.id ?? "");
                      setCreateForm((form) => ({ ...form, searchQuery: fallback?.query ?? form.searchQuery }));
                      setCreateStep("strategy");
                    }}>返回初稿</button>
                    <button type="submit" disabled={busyAction === "query-preview" || createForm.searchQuery.trim().length < 3}>{busyAction === "query-preview" ? "正在读取并分析综述摘要…" : "确认修订式并分析近五年综述"}</button>
                  </div>
                  <p className="rawb-create-form__help">这是第二个人工确认点；任何手动改动都会作为新式重新执行基础抽查和综述扫描。</p>
                </>
              ) : (
                <>
                  <div className="rawb-query-plan__question"><span>研究问题</span><strong>{createForm.question}</strong></div>
                  <ReviewLandscapeReport
                    landscape={queryPreview?.reviewLandscape}
                    question={createForm.question}
                    firstRound={scopingRound === 2
                      ? directionSelection?.roundOneCheckpoint?.queryPreview?.reviewLandscape
                      : null}
                    secondRound={scopingRound === 2 ? queryPreview?.reviewLandscape : null}
                    decision={scopingRound === 1 ? directionDecision : null}
                    lockedDirection={scopingRound === 2 && directionSelection?.selectedDirection
                      ? {
                          ...directionSelection.selectedDirection,
                          reportBinding: directionSelection.reportBinding ?? null,
                        }
                      : null}
                    onDecisionChange={scopingRound === 1 ? handleDirectionDecisionChange : null}
                    onPrimaryAction={scopingRound === 1 ? handleChooseDirection : null}
                    busy={busyAction === "direction-selection"}
                    storageKey={`research-review-report:${queryPreview?.planHash ?? scopingRound}`}
                    currentBinding={queryPreview?.reviewLandscape?.researchReport?.binding ?? null}
                  />
                  <details className="rawb-query-plan__advanced rawb-report-retrieval-controls">
                    <summary>检索校准、命中抽查与重新扫描</summary>
                  <fieldset className="rawb-query-candidates">
                    <legend>检索式基础命中抽查</legend>
                    {asArray(queryPreview?.candidates).map((candidate) => {
                      const selected = candidate.id === selectedQueryId;
                      return (
                        <div key={candidate.id} className={`rawb-query-candidate${selected ? " is-selected" : ""}${candidate.status !== "ready" ? " is-unavailable" : ""}`}>
                          <span className="rawb-query-candidate__top">
                            <span className="rawb-query-candidate__marker" aria-hidden="true" />
                            <strong>{candidate.label}</strong>
                            <em>{candidate.status === "ready" ? `PubMed 命中 ${candidate.total}` : candidate.status === "zero_results" ? "0 条结果" : "试检失败"}</em>
                          </span>
                          <code>{candidate.query}</code>
                          <p>{candidate.strategy}</p>
                          {candidate.error ? <p className="is-error">{candidate.error.message}</p> : null}
                          {asArray(candidate.samples).length ? (
                            <details>
                              <summary>抽查当前排序前 {candidate.sampledCount} 条未筛选样本</summary>
                              <ol>{candidate.samples.map((sample) => <li key={sample.sourceId ?? sample.pmid}><span>{sample.accessLevel === "abstract_only" ? "题名+摘要" : "仅题名"}{sample.year ? ` · ${sample.year}` : ""}</span><strong>{sample.title}</strong>{sample.abstractSnippet ? <p>{sample.abstractSnippet}</p> : null}</li>)}</ol>
                            </details>
                          ) : <small>{candidate.boundary}</small>}
                        </div>
                      );
                    })}
                  </fieldset>
                  <p className="rawb-query-plan__boundary">{queryPreview?.accessBoundary} {queryPreview?.recallCheck?.boundary}</p>
                  <label htmlFor="rawb-project-search-query">需要修订时，直接改当前基础检索式</label>
                  <textarea
                    id="rawb-project-search-query"
                    value={createForm.searchQuery}
                    onChange={(event) => setCreateForm((form) => ({ ...form, searchQuery: event.target.value }))}
                    rows={4}
                    maxLength={5000}
                    required
                  />
                  {!queryPreviewMatches && createForm.searchQuery.trim().length >= 3 ? <p className="rawb-create-form__help is-warning">检索式已改变；必须重新执行基础抽查与近五年综述扫描，不能沿用旧汇报建项。</p> : null}
                  <div className="rawb-query-plan__actions">
                    <button type="button" onClick={() => {
                      const fallback = asArray(queryCalibration?.revisedPlan?.candidates).find((candidate) => candidate.id === selectedQueryId)
                        ?? asArray(queryCalibration?.revisedPlan?.candidates)[0];
                      setQueryPreview(null);
                      setSelectedQueryId(fallback?.id ?? "");
                      setCreateForm((form) => ({ ...form, searchQuery: fallback?.query ?? form.searchQuery }));
                      setCreateStep("calibration");
                    }}>返回反馈校准</button>
                    <button type="button" onClick={handleRecalibrateQueries} disabled={busyAction === "query-preview"}>{busyAction === "query-preview" ? "正在重新扫描…" : "重新扫描当前式"}</button>
                  </div>
                  </details>
                  {scopingRound === 2 ? (
                    <>
                    <section className="rawb-second-round-summary" aria-labelledby="rawb-second-round-summary-title">
                      <span>两轮调查已接通</span>
                      <h3 id="rawb-second-round-summary-title">正式项目将继承收窄后的问题</h3>
                      <dl>
                        <div><dt>首轮宽问题</dt><dd>{directionSelection?.sourceQuestion}</dd></div>
                        <div><dt>采用方向</dt><dd>{directionSelection?.selectedDirection?.direction}</dd></div>
                        <div><dt>第二轮问题</dt><dd>{directionSelection?.narrowedBrief?.question}</dd></div>
                      </dl>
                      <p>{directionSelection?.narrowedBrief?.evidenceBoundary}</p>
                      <button type="button" onClick={handleReturnToFirstRound}>返回首轮调整方向</button>
                    </section>
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
                  <p className="rawb-create-form__help">首轮方向账本、两轮问题与两轮综述汇报会随项目保存；建项后仍只推进到首个人工决定点。</p>
                    </>
                  ) : null}
                </>
              )}
            </form>
          ) : null}

          {projects.length ? (
            <ul className="rawb-project-list">
              {projects.map((item) => {
                const id = projectId(item);
                const itemStatus = projectStatus(item);
                const itemSummaryLabel =
                  item?.loadable === false
                    ? "历史记录需恢复"
                    : itemStatus === "completed"
                      ? "可查看研究成果"
                      : ["awaiting_approval", "awaiting_gate", "awaiting_review"].includes(itemStatus)
                        ? "需要研究者确认"
                        : POLLING_STATUSES.has(itemStatus)
                          ? "正在更新领域简报"
                          : itemStatus === "blocked"
                            ? "研究受阻，需处理"
                            : itemStatus === "paused"
                              ? "研究已暂停"
                              : "可查看领域简报";
                return (
                  <li key={id ?? firstText(item?.title)}>
                    <button type="button" className={id === selectedProjectId ? "is-active" : ""} onClick={() => selectProject(id)} aria-current={id === selectedProjectId ? "true" : undefined} disabled={item?.loadable === false} title={item?.loadError?.message ?? undefined}>
                      <strong>{firstText(item?.title, item?.name) ?? "未命名研究"}</strong>
                      <span>{itemSummaryLabel}</span>
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
              <div><strong>这一步没有完成</strong><p>{researcherFacingErrorMessage(error)}</p></div>
              <button type="button" onClick={refreshSelectedProject}>重试</button>
              <button type="button" className="rawb-error__dismiss" onClick={() => setError("")}>关闭</button>
            </div>
          ) : null}
          {runtimeError && !error ? <p className="rawb-runtime-warning" role="status">当前无法更新研究材料；已有领域简报仍可查看，详细原因见“技术审计”。</p> : null}

          {bootLoading || (projectLoading && !project) ? <LoadingWorkspace /> : !project ? <EmptyState onCreate={() => setCreateOpen(true)} /> : (
            <>
              <section className="rawb-project-hero" aria-labelledby="rawb-project-title-heading">
                <div className="rawb-project-hero__copy">
                  <div className="rawb-project-hero__meta">
                    <span>领域研究简报</span>
                    <span>PubMed 题名与摘要级分析</span>
                  </div>
                  <h1 id="rawb-project-title-heading">{firstText(project?.title, project?.name) ?? "未命名研究"}</h1>
                  <p className="rawb-project-name">领域现状、主要问题、趋势与综述选题分析</p>
                  <div className="rawb-project-question">
                    <span>{journeyIndexForProject(project) < 2 ? "研究问题" : "当前目标选题"}</span>
                    <p>{firstText(project?.question, project?.researchQuestion, project?.brief?.question) ?? "研究问题尚未记录。"}</p>
                  </div>
                  <details className="rawb-mode-boundary">
                    <summary>本页证据范围</summary>
                    <p>当前结论来自实际取得的 PubMed 题名与可用摘要；候选方向需经同题综述与原始研究窄检索后才能正式立题。</p>
                  </details>
                </div>
                <div className="rawb-project-actions">
                  <button className="rawb-primary" type="button" onClick={handlePrimaryAction} disabled={primaryAction.disabled}>
                    {primaryAction.kind === "busy" ? <span className="rawb-button-spinner" aria-hidden="true" /> : null}
                    {primaryAction.label}
                  </button>
                  {POLLING_STATUSES.has(status) || status === "paused" ? (
                    <div className="rawb-run-controls" aria-label="当前检索控制">
                      {POLLING_STATUSES.has(status) ? (
                        <button type="button" disabled={Boolean(busyAction)} onClick={() => performProjectAction("pause", { reason: "研究者从工作台暂停当前项目。" })}>暂停</button>
                      ) : null}
                      {!cancelArmed ? (
                        <button className="is-danger" type="button" disabled={Boolean(busyAction)} onClick={() => setCancelArmed(true)}>停止本轮</button>
                      ) : null}
                    </div>
                  ) : null}
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
                {activeTab === "records" ? <RecordsPanel project={project} runtime={runtime} runtimeLoading={runtimeLoading} runtimeError={runtimeError} actionError={lastTechnicalError} /> : null}
              </section>
            </>
          )}
        </main>
      </div>
      <div className="rawb-announcer rawb-visually-hidden" aria-live="polite" aria-atomic="true">
        {busyAction ? "正在处理当前操作" : polling ? "正在整理当前研究材料" : actionFeedback}
      </div>
    </div>
  );
}

export default ResearchAgentWorkbench;
