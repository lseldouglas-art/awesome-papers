export const EXECUTION_STATES = Object.freeze({
  DRAFT: "draft",
  READY: "ready",
  RUNNING: "running",
  REVIEW: "review",
  REVISION: "revision",
  BLOCKED: "blocked",
  ACCEPTED: "accepted",
  SUPERSEDED: "superseded",
  CANCELLED: "cancelled",
});

export const EXECUTION_TRANSITIONS = Object.freeze({
  [EXECUTION_STATES.DRAFT]: [
    EXECUTION_STATES.READY,
    EXECUTION_STATES.CANCELLED,
  ],
  [EXECUTION_STATES.READY]: [
    EXECUTION_STATES.RUNNING,
    EXECUTION_STATES.BLOCKED,
    EXECUTION_STATES.CANCELLED,
  ],
  [EXECUTION_STATES.RUNNING]: [
    EXECUTION_STATES.REVIEW,
    EXECUTION_STATES.BLOCKED,
    EXECUTION_STATES.CANCELLED,
  ],
  [EXECUTION_STATES.REVIEW]: [
    EXECUTION_STATES.ACCEPTED,
    EXECUTION_STATES.REVISION,
    EXECUTION_STATES.BLOCKED,
    EXECUTION_STATES.CANCELLED,
  ],
  [EXECUTION_STATES.REVISION]: [
    EXECUTION_STATES.READY,
    EXECUTION_STATES.CANCELLED,
  ],
  [EXECUTION_STATES.BLOCKED]: [
    EXECUTION_STATES.READY,
    EXECUTION_STATES.CANCELLED,
  ],
  [EXECUTION_STATES.ACCEPTED]: [EXECUTION_STATES.SUPERSEDED],
  [EXECUTION_STATES.SUPERSEDED]: [],
  [EXECUTION_STATES.CANCELLED]: [],
});

export const ARTIFACT_STATES = Object.freeze({
  CANDIDATE: "candidate",
  VERIFIED: "verified",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  STALE: "stale",
  SUPERSEDED: "superseded",
});

export const ARTIFACT_FRESHNESS = Object.freeze({
  CURRENT: "current",
  STALE: "stale",
});

export const GATE_STATES = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  AMENDMENT_REQUESTED: "amendment_requested",
  ACCEPTED_RISK: "accepted_risk",
  INVALIDATED: "invalidated",
});

export const LEASE_STATES = Object.freeze({
  QUEUED: "queued",
  CLAIMED: "claimed",
  RUNNING: "running",
  PAUSED: "paused",
  RELEASED: "released",
  EXPIRED: "expired",
});

const phases = [
  {
    id: "question_formation",
    order: 1,
    userLabel: "问题成形",
    userMeaning: "把一个宽泛主题变成可以检索、判断和负责的研究问题。",
  },
  {
    id: "literature_research",
    order: 2,
    userLabel: "文献调研",
    userMeaning: "用真实检索建立证据边界，明确目前能说什么、不能说什么。",
  },
  {
    id: "argument_design",
    order: 3,
    userLabel: "论证结构",
    userMeaning: "让章节和论点从已经核查的证据中生长出来。",
  },
  {
    id: "writing_and_verification",
    order: 4,
    userLabel: "写作与核查",
    userMeaning: "一次完成一个可核查的主张，并逐句验证来源。",
  },
  {
    id: "delivery",
    order: 5,
    userLabel: "定稿交付",
    userMeaning: "完成全文审计、版本冻结和作者签署。",
  },
];

const nodes = [
  {
    id: "capture_intent",
    kind: "input",
    phaseId: "question_formation",
    userLabel: "说出想研究的问题",
    userStatus: "正在了解你真正想解决的问题",
    purpose: "记录主题、目标读者、预期产物、时间预算、禁止项和已有材料。",
    inputs: ["UserPrompt", "OptionalSourceMaterial"],
    outputs: ["ResearchIntent@1"],
    acceptanceCriteria: [
      "目标产物明确",
      "目标读者明确",
      "时间与来源约束已记录",
      "用户没有被迫学习内部流程术语",
    ],
    humanAuthority: "用户可以随时改写原始意图",
    reviewerRole: "intake_reviewer",
    insufficientEvidenceAction: "继续追问最少的必要信息",
  },
  {
    id: "clarify_question",
    kind: "work",
    phaseId: "question_formation",
    userLabel: "把问题说清楚",
    userStatus: "正在把主题变成可检验的问题",
    purpose: "把宽泛主题拆成对象、关系、情境、时间和可观察结果，并消除预设结论。",
    inputs: ["ResearchIntent@1"],
    outputs: ["ResearchQuestionCandidate[]@1", "ScopeBoundary@1"],
    acceptanceCriteria: [
      "抽象词已转成可检索对象",
      "问题没有预设答案",
      "范围内与范围外均有明确示例",
      "候选问题之间的差异可被普通用户理解",
    ],
    executorRole: "question_modeler",
    reviewerRole: "method_reviewer",
    insufficientEvidenceAction: "回到研究意图，仅追问会改变研究方向的歧义",
  },
  {
    id: "approve_scope",
    kind: "human_gate",
    phaseId: "question_formation",
    userLabel: "确认研究问题",
    userStatus: "需要你确认研究边界",
    purpose: "由研究者选择问题、范围和不可越过的结论边界。",
    inputs: ["ResearchQuestionCandidate[]@1", "ScopeBoundary@1"],
    outputs: ["ResearchBrief@1", "ScopeDecision@1"],
    acceptanceCriteria: ["决定由真实用户明确作出", "决定理由被记录"],
    approverRoles: ["human_researcher"],
    amendmentTargetNodeId: "clarify_question",
    humanAuthority: "只有研究者可以批准、驳回或修改研究问题",
    insufficientEvidenceAction: "退回问题澄清并生成新版本，不覆盖旧决定",
  },
  {
    id: "design_orientation_search",
    kind: "work",
    phaseId: "literature_research",
    userLabel: "设计领域探索检索",
    userStatus: "正在把初步问题转成可执行的领域探索方法",
    purpose: "先用较宽的概念空间了解领域，定义概念组、数据库、字段、边界、哨兵文献和停止条件。",
    inputs: ["ResearchBrief@1", "ScopeDecision@1"],
    outputs: ["OrientationConceptMatrix@1", "OrientationSearchProtocol@1"],
    acceptanceCriteria: [
      "每个检索概念都有保留理由",
      "检索式符合目标数据库语法",
      "数据源、字段、日期和版本分别记录",
      "纳排标准与停止条件已声明",
      "已准备召回检查所需的哨兵来源",
    ],
    executorRole: "search_designer",
    reviewerRole: "method_reviewer",
    insufficientEvidenceAction: "扩充概念组或重新界定问题，不宣称已完成检索",
  },
  {
    id: "run_pilot_search",
    kind: "work",
    phaseId: "literature_research",
    userLabel: "真实运行试检",
    userStatus: "正在数据库中实际运行候选检索",
    purpose: "实际提交候选检索并保存结果数、记录样本、执行时间和来源快照。",
    inputs: ["OrientationSearchProtocol@1"],
    outputs: ["SearchRunSnapshot[]@1"],
    acceptanceCriteria: [
      "检索已在声明的数据源真实执行",
      "执行时间、查询字符串和结果数已保存",
      "生成、语法检查和真实执行状态没有混写",
      "数据库失败或权限限制被如实记录",
    ],
    executorRole: "search_runner",
    reviewerRole: "method_reviewer",
    insufficientEvidenceAction: "标记阻塞或换用已获授权的数据源，不伪造执行结果",
  },
  {
    id: "calibrate_search",
    kind: "verifier",
    phaseId: "literature_research",
    userLabel: "检查检索是否靠谱",
    userStatus: "正在用真实结果检查漏检与误检",
    purpose: "检查代表性结果、误召回原因和哨兵来源召回，再冻结可复现检索。",
    inputs: ["SearchRunSnapshot[]@1", "OrientationSearchProtocol@1"],
    outputs: ["OrientationCalibrationReport@1", "FrozenOrientationSearchProtocol@1"],
    acceptanceCriteria: [
      "抽样规则和实际检查数量已记录",
      "主要噪声来源得到解释",
      "哨兵来源的召回情况已检查",
      "修改前后检索版本可以比较",
      "停止校准的理由已声明",
    ],
    executorRole: "search_calibrator",
    reviewerRole: "independent_method_reviewer",
    insufficientEvidenceAction: "产生新版检索协议并重新试检；旧版本保留为历史",
  },
  {
    id: "build_orientation_corpus",
    kind: "work",
    phaseId: "literature_research",
    userLabel: "建立领域认识样本",
    userStatus: "正在建立用于理解领域全貌的初始文献样本",
    purpose: "按已校准的宽检索正式执行、导出、去重并形成可追溯的领域认识语料。",
    inputs: ["FrozenOrientationSearchProtocol@1"],
    outputs: ["OrientationCorpusManifest@1", "OrientationSourceSnapshot[]@1"],
    acceptanceCriteria: [
      "正式执行继承已校准的宽检索协议",
      "导出、去重、来源和时间均可追溯",
      "该语料只用于形成领域认识，不冒充最终证据库",
      "覆盖限制和无法访问的数据源已记录",
    ],
    executorRole: "orientation_corpus_builder",
    reviewerRole: "data_reviewer",
    insufficientEvidenceAction: "修复导出与覆盖问题，必要时重新打开领域探索检索",
  },
  {
    id: "profile_landscape",
    kind: "work",
    phaseId: "literature_research",
    userLabel: "理解领域并寻找可行切口",
    userStatus: "正在辨认已有综述、主要争议和可能的研究切口",
    purpose: "基于可追溯语料描述主题、争议、已有综述和证据分布，形成多个可比较的综述切口。",
    inputs: ["OrientationCorpusManifest@1", "OrientationSourceSnapshot[]@1"],
    outputs: ["LandscapeProfile@1", "ReviewAngleCandidate[]@1"],
    acceptanceCriteria: [
      "领域判断可回到语料记录",
      "真正的研究缺口与检索漏失得到区分",
      "候选切口同时比较价值、可行性和证据量",
      "不以标题计数单独证明趋势或空白",
      "不把单库或单语种观察外推为整个领域",
    ],
    executorRole: "landscape_analyst",
    reviewerRole: "method_reviewer",
    insufficientEvidenceAction: "补充领域探索检索或降低画像结论强度",
  },
  {
    id: "approve_review_angle",
    kind: "human_gate",
    phaseId: "literature_research",
    userLabel: "选择真正要深挖的方向",
    userStatus: "需要你从证据支持的候选方向中作出选择",
    purpose: "由研究者根据价值、可行性和证据基础选择、修改或否决综述切口。",
    inputs: ["LandscapeProfile@1", "ReviewAngleCandidate[]@1"],
    outputs: ["ReviewAngleDecision@1", "FocusedResearchBrief@1"],
    acceptanceCriteria: [
      "选择由真实研究者明确作出",
      "选择理由和被放弃方向被记录",
      "精准重检索所需的对象与关系已明确",
    ],
    approverRoles: ["human_researcher"],
    amendmentTargetNodeId: "profile_landscape",
    humanAuthority: "只有研究者可以锁定综述切口",
    insufficientEvidenceAction: "返回领域认识，补检或缩小候选方向",
  },
  {
    id: "design_focused_search",
    kind: "work",
    phaseId: "literature_research",
    userLabel: "围绕选定方向精准重检索",
    userStatus: "正在为选定方向构建精准检索矩阵",
    purpose: "把选定切口拆成核心、放宽和相邻组合，形成可直接执行的精准检索协议。",
    inputs: ["FocusedResearchBrief@1", "ReviewAngleDecision@1"],
    outputs: ["FocusedConceptMatrix@1", "FocusedSearchProtocol@1"],
    acceptanceCriteria: [
      "核心对象与关系被具体化",
      "核心、放宽和相邻检索路径用途明确",
      "每条检索式可在目标数据库直接运行",
      "纳排标准与选定方向一致",
    ],
    executorRole: "focused_search_designer",
    reviewerRole: "method_reviewer",
    insufficientEvidenceAction: "修订概念矩阵，必要时重新打开方向选择",
  },
  {
    id: "calibrate_focused_search",
    kind: "verifier",
    phaseId: "literature_research",
    userLabel: "校准精准检索",
    userStatus: "正在检查精准检索的噪声、漏检和覆盖边界",
    purpose: "真实试运行精准检索，检查误召回、哨兵来源与覆盖缺口后冻结正式协议。",
    inputs: ["FocusedSearchProtocol@1"],
    outputs: ["FocusedSearchRunSnapshot[]@1", "FocusedCalibrationReport@1", "FrozenSearchProtocol@1"],
    acceptanceCriteria: [
      "候选检索已真实执行并保存快照",
      "噪声样本和关键来源召回得到检查",
      "修订历史与停止理由已记录",
      "最终协议可以复现",
    ],
    executorRole: "focused_search_calibrator",
    reviewerRole: "independent_method_reviewer",
    insufficientEvidenceAction: "产生新版精准检索并重跑；证据根本不足时返回方向选择",
  },
  {
    id: "freeze_library",
    kind: "work",
    phaseId: "literature_research",
    userLabel: "建立可追溯文献库",
    userStatus: "正在去重、编号并冻结本次调研的文献范围",
    purpose: "正式检索、导出、去重、归并研究家族，并保存来源、版本和文件哈希。",
    inputs: ["FrozenSearchProtocol@1"],
    outputs: ["LibraryManifest@1", "SourceSnapshot[]@1"],
    acceptanceCriteria: [
      "正式检索继承已冻结协议",
      "每条记录有稳定标识和来源",
      "去重与研究家族归并规则已记录",
      "文献库文件和来源快照具有校验值",
      "不以命中数量直接推断领域结论",
    ],
    executorRole: "library_builder",
    reviewerRole: "data_reviewer",
    insufficientEvidenceAction: "修复导出或去重问题；范围改变时重新打开检索校准",
  },
  {
    id: "extract_evidence",
    kind: "work",
    phaseId: "literature_research",
    userLabel: "提取与问题直接相关的证据",
    userStatus: "正在逐篇判断文献究竟支持什么",
    purpose: "按预先声明的字段提取主张、方法、结果、限制、研究情境和原文定位。",
    inputs: ["LibraryManifest@1", "SourceSnapshot[]@1"],
    outputs: ["EvidenceRecord[]@1", "AppraisalRecord[]@1"],
    acceptanceCriteria: [
      "每条证据可回到来源和具体位置",
      "未报告与未执行没有混写",
      "方法、参数、版本和验证类型分字段记录",
      "研究质量按领域判断而非单一总分",
      "抽取结论没有超出可见全文或摘要",
      "大范围筛选允许以题名和摘要完成，但每条记录必须标明访问层级",
    ],
    executorRole: "evidence_extractor",
    reviewerRole: "evidence_reviewer",
    insufficientEvidenceAction:
      "摘要未报告的内容标记为未知并继续筛选；仅在用户要求或关键主张无法由摘要判断时申请全文，不使用常识填空",
  },
  {
    id: "seek_counterevidence",
    kind: "work",
    phaseId: "literature_research",
    userLabel: "主动寻找反例与缺口",
    userStatus: "正在寻找会改变当前判断的证据",
    purpose: "主动寻找相反结果、失败案例、方法边界和缺失人群，避免只收集支持材料。",
    inputs: ["LibraryManifest@1", "ResearchBrief@1"],
    outputs: ["CounterevidenceRegister@1", "CoverageGapRegister@1"],
    acceptanceCriteria: [
      "反证问题由当前假设明确导出",
      "负面或不一致结果没有被隐藏",
      "覆盖缺口与真正的无效结论得到区分",
      "补检范围和停止理由已记录",
    ],
    executorRole: "counterevidence_scout",
    reviewerRole: "evidence_reviewer",
    insufficientEvidenceAction: "保留不确定性并降低结论强度",
  },
  {
    id: "synthesize_claims",
    kind: "work",
    phaseId: "literature_research",
    userLabel: "形成可核查的研究判断",
    userStatus: "正在把分散证据整理成一个个清晰判断",
    purpose: "以单一主张为最小单位，连接支持、反证、限制、适用范围和下一问题。",
    inputs: [
      "EvidenceRecord[]@1",
      "AppraisalRecord[]@1",
      "CounterevidenceRegister@1",
      "CoverageGapRegister@1",
    ],
    outputs: ["ClaimEvidenceMap@1", "ResearchConclusionCard[]@1"],
    acceptanceCriteria: [
      "每张结论卡只表达一个可判断主张",
      "支持、反证和限制同时可见",
      "结论强度与证据层级一致",
      "所有定量与因果表述有直接来源定位",
      "下一问题由证据缺口自然产生",
    ],
    executorRole: "evidence_synthesizer",
    reviewerRole: "evidence_reviewer",
    insufficientEvidenceAction: "合并主张、补检或降级为待验证问题",
  },
  {
    id: "verify_evidence",
    kind: "verifier",
    phaseId: "literature_research",
    userLabel: "独立核查研究判断",
    userStatus: "正在逐项核查结论与来源是否真正匹配",
    purpose: "由未参与主张生成的角色核对来源定位、支持关系、方法可信度和外推边界。",
    inputs: ["ClaimEvidenceMap@1", "ResearchConclusionCard[]@1"],
    outputs: ["EvidenceVerificationReport@1"],
    acceptanceCriteria: [
      "生成者与核查者不同",
      "每个主张得到强支持、部分支持、不支持或无法判断的结论",
      "引用存在不等于引用支持该主张",
      "方法局限和适用边界已写入结论卡",
      "核查失败会触发修订而不是静默改写记录",
    ],
    executorRole: "independent_evidence_verifier",
    reviewerRole: "independent_evidence_reviewer",
    insufficientEvidenceAction: "退回主张合成或证据抽取并创建新版本",
  },
  {
    id: "approve_evidence_boundary",
    kind: "human_gate",
    phaseId: "literature_research",
    userLabel: "确认目前能得出的结论",
    userStatus: "需要你确认目前能说什么、不能说什么",
    purpose: "由研究者批准证据边界，并决定结束、继续深挖或进入论证结构。",
    inputs: ["EvidenceVerificationReport@1", "ResearchConclusionCard[]@1"],
    outputs: ["EvidenceBoundaryDecision@1"],
    acceptanceCriteria: ["人类明确选择下一步", "范围限制与未决问题被保留"],
    approverRoles: ["human_researcher"],
    amendmentTargetNodeId: "synthesize_claims",
    humanAuthority: "只有研究者可以接受证据边界和研究解释",
    insufficientEvidenceAction: "选择补检、缩小问题或以不确定结论结束",
  },
  {
    id: "derive_outline",
    kind: "work",
    phaseId: "argument_design",
    userLabel: "让证据长成论文结构",
    userStatus: "正在根据已经核查的判断组织章节",
    purpose: "按论点关系组织章节和段落目的，而不是先套模板再寻找引用。",
    inputs: ["EvidenceBoundaryDecision@1", "ClaimEvidenceMap@1"],
    outputs: ["EvidenceDrivenOutline@1"],
    acceptanceCriteria: [
      "每个子章节映射具体已核查主张",
      "每个子章节显示支撑文献与反证数量",
      "章节顺序服务于研究问题而非课程顺序",
      "没有证据的主题没有被AI补齐",
    ],
    executorRole: "argument_architect",
    reviewerRole: "method_reviewer",
    insufficientEvidenceAction: "合并章节、扩展检索或降低章节目标",
  },
  {
    id: "stress_test_outline",
    kind: "verifier",
    phaseId: "argument_design",
    userLabel: "检查结构是否站得住",
    userStatus: "正在检查章节是否失衡、重复或缺少证据",
    purpose: "检查逻辑跳跃、主题重叠、证据失衡、反证缺席和超出范围的章节。",
    inputs: ["EvidenceDrivenOutline@1", "ClaimEvidenceMap@1"],
    outputs: ["OutlineStressTest@1"],
    acceptanceCriteria: [
      "每章最低证据门槛明确",
      "证据不足章节有合并、补检或降级规则",
      "反证被放入相关章节而非集中隐藏",
      "结论与章节功能没有重复",
    ],
    executorRole: "outline_verifier",
    reviewerRole: "independent_outline_reviewer",
    insufficientEvidenceAction: "退回大纲并保留问题清单",
  },
  {
    id: "approve_outline",
    kind: "human_gate",
    phaseId: "argument_design",
    userLabel: "确认论文论证路线",
    userStatus: "需要你确认接下来按什么逻辑写",
    purpose: "由研究者确认章节功能、论证顺序和暂不写入的内容。",
    inputs: ["EvidenceDrivenOutline@1", "OutlineStressTest@1"],
    outputs: ["OutlineDecision@1", "FrozenWritingPlan@1"],
    acceptanceCriteria: ["章节功能和顺序被明确批准", "排除内容和理由被记录"],
    approverRoles: ["human_researcher"],
    amendmentTargetNodeId: "derive_outline",
    humanAuthority: "只有研究者可以批准论文的论证路线",
    insufficientEvidenceAction: "退回结构设计或重新打开证据调研",
  },
  {
    id: "write_claim_units",
    kind: "work",
    phaseId: "writing_and_verification",
    userLabel: "一次写清一个论点",
    userStatus: "正在把一个已核查论点写成段落",
    purpose: "按工作单逐个撰写主张单元，限定可用证据和段落功能。",
    inputs: ["FrozenWritingPlan@1", "ClaimEvidenceMap@1"],
    outputs: ["ClaimUnitDraft[]@1"],
    acceptanceCriteria: [
      "每个工作单只处理一个核心论点",
      "事实、作者解释和展望得到区分",
      "所有数字、引文和机制有稳定来源标识",
      "没有为了流畅而填补证据空白",
    ],
    executorRole: "claim_unit_writer",
    reviewerRole: "citation_verifier",
    insufficientEvidenceAction: "暂停该段并请求证据，不跨越边界继续生成",
  },
  {
    id: "verify_claim_units",
    kind: "verifier",
    phaseId: "writing_and_verification",
    userLabel: "逐句核对引用",
    userStatus: "正在核对每句话与引用文献是否匹配",
    purpose: "逐句拆解草稿，对照来源定位，判断直接支持、部分支持、不支持或无依据。",
    inputs: ["ClaimUnitDraft[]@1", "SourceSnapshot[]@1", "EvidenceRecord[]@1"],
    outputs: ["ClaimVerificationResult[]@1"],
    acceptanceCriteria: [
      "生成与核查由不同角色完成",
      "每个事实句都有来源定位或明确标记为作者判断",
      "部分支持和不支持的句子得到修订或删除",
      "引用多个来源时逐一核对贡献",
    ],
    executorRole: "citation_verifier",
    reviewerRole: "independent_evidence_reviewer",
    insufficientEvidenceAction: "退回对应主张单元，不牵连已通过的无关段落",
  },
  {
    id: "approve_claim_units",
    kind: "human_gate",
    phaseId: "writing_and_verification",
    userLabel: "确认逐句核查后的段落",
    userStatus: "需要你确认只有通过逐句核查的内容可以进入全文",
    purpose:
      "由研究者逐项查看主张单元与逐句核查结果，只接受有直接证据支持的事实句。",
    inputs: ["ClaimUnitDraft[]@1", "ClaimVerificationResult[]@1"],
    outputs: ["AcceptedClaimUnit[]@1"],
    acceptanceCriteria: [
      "每个事实句都有直接支持的核查结果",
      "未通过的句子已删除或退回修订",
      "研究者明确确认接受的具体段落版本",
      "边界、作者判断和不确定性仍然可见",
    ],
    approverRoles: ["human_researcher"],
    amendmentTargetNodeId: "write_claim_units",
    humanAuthority: "只有研究者可以批准段落进入全文组装",
    insufficientEvidenceAction: "退回对应主张单元修订，不批量改写其他已通过内容",
  },
  {
    id: "assemble_manuscript",
    kind: "work",
    phaseId: "writing_and_verification",
    userLabel: "组装并统一全文",
    userStatus: "正在统一全文逻辑、术语和重复内容",
    purpose: "只使用已核查的主张单元组装正文，并从正文派生引言、结论与摘要。",
    inputs: ["AcceptedClaimUnit[]@1", "FrozenWritingPlan@1"],
    outputs: ["ManuscriptDraft@1"],
    acceptanceCriteria: [
      "正文只包含已通过核查的主张单元",
      "引言、结论和摘要不引入正文外事实",
      "术语、范围和论证方向一致",
      "风格编辑没有改变事实强度",
      "作者原创表达优先，不以规避检测为目标",
    ],
    executorRole: "manuscript_editor",
    reviewerRole: "manuscript_auditor",
    insufficientEvidenceAction: "定位到具体主张单元修订，不整篇无痕重写",
  },
  {
    id: "audit_manuscript",
    kind: "verifier",
    phaseId: "writing_and_verification",
    userLabel: "完成全文科研审计",
    userStatus: "正在检查全文事实、范围和引用链",
    purpose: "审计全文的主张—来源关系、内部一致性、遗漏限制、版权和方法声明。",
    inputs: ["ManuscriptDraft@1", "ClaimVerificationResult[]@1"],
    outputs: ["ManuscriptAudit@1", "AuditedManuscript@1"],
    acceptanceCriteria: [
      "所有实质主张均可回溯",
      "结论没有超出正文和证据边界",
      "数据库、语种、时间和对象限制得到披露",
      "图表、长引文和复用材料的版权状态明确",
      "未解决问题被显式列出",
    ],
    executorRole: "manuscript_auditor",
    reviewerRole: "human_researcher",
    insufficientEvidenceAction: "按问题定位退回对应节点并生成修订版本",
  },
  {
    id: "prepare_delivery",
    kind: "work",
    phaseId: "delivery",
    userLabel: "准备可提交版本",
    userStatus: "正在整理正文、参考文献和审计记录",
    purpose: "生成正文、引用、图表许可、方法附件、版本差异和可复现材料清单。",
    inputs: ["AuditedManuscript@1", "ManuscriptAudit@1", "LibraryManifest@1"],
    outputs: ["DeliveryBundle@1", "ExportManifest@1"],
    acceptanceCriteria: [
      "正文、引用和参考文献一致",
      "图表来源与许可状态可查",
      "检索、筛选和审计材料可按需复现",
      "交付包声明仍未解决的限制",
    ],
    executorRole: "delivery_editor",
    reviewerRole: "human_researcher",
    insufficientEvidenceAction: "只修复受影响的交付项，不改写已接受证据",
  },
  {
    id: "author_signoff",
    kind: "human_gate",
    phaseId: "delivery",
    userLabel: "作者最终确认",
    userStatus: "等待作者完成最终责任确认",
    purpose: "由作者确认内容、署名责任、利益冲突、使用声明和提交版本。",
    inputs: ["DeliveryBundle@1", "ExportManifest@1"],
    outputs: ["AuthorApproval@1", "SignedDelivery@1"],
    acceptanceCriteria: ["作者明确签署", "签署对应唯一版本", "未决限制仍然可见"],
    approverRoles: ["author"],
    amendmentTargetNodeId: "prepare_delivery",
    humanAuthority: "AI 不得代替作者签署或承担最终科研责任",
    insufficientEvidenceAction: "退回受影响节点，签署版本保持不变",
  },
];

const edges = [
  ["capture_intent", "clarify_question"],
  ["clarify_question", "approve_scope"],
  ["approve_scope", "design_orientation_search"],
  ["design_orientation_search", "run_pilot_search"],
  ["run_pilot_search", "calibrate_search"],
  ["calibrate_search", "build_orientation_corpus"],
  ["build_orientation_corpus", "profile_landscape"],
  ["profile_landscape", "approve_review_angle"],
  ["approve_review_angle", "design_focused_search"],
  ["design_focused_search", "calibrate_focused_search"],
  ["calibrate_focused_search", "freeze_library"],
  ["freeze_library", "extract_evidence"],
  ["freeze_library", "seek_counterevidence"],
  ["extract_evidence", "synthesize_claims"],
  ["seek_counterevidence", "synthesize_claims"],
  ["synthesize_claims", "verify_evidence"],
  ["verify_evidence", "approve_evidence_boundary"],
  ["synthesize_claims", "approve_evidence_boundary"],
  ["approve_evidence_boundary", "derive_outline"],
  ["derive_outline", "stress_test_outline"],
  ["synthesize_claims", "stress_test_outline"],
  ["stress_test_outline", "approve_outline"],
  ["derive_outline", "approve_outline"],
  ["approve_outline", "write_claim_units"],
  ["synthesize_claims", "write_claim_units"],
  ["write_claim_units", "verify_claim_units"],
  ["freeze_library", "verify_claim_units"],
  ["extract_evidence", "verify_claim_units"],
  ["verify_claim_units", "approve_claim_units"],
  ["write_claim_units", "approve_claim_units"],
  ["approve_claim_units", "assemble_manuscript"],
  ["approve_outline", "assemble_manuscript"],
  ["assemble_manuscript", "audit_manuscript"],
  ["verify_claim_units", "audit_manuscript"],
  ["audit_manuscript", "prepare_delivery"],
  ["freeze_library", "prepare_delivery"],
  ["prepare_delivery", "author_signoff"],
].map(([source, target], index) => ({
  id: `hard-${String(index + 1).padStart(2, "0")}`,
  source,
  target,
  type: "hard_dependency",
}));

export const REVIEW_RESEARCH_MACHINE_V1 = Object.freeze({
  id: "review-research-core",
  version: 1,
  scope: "evidence-led literature review research and writing",
  sourceMethod: {
    reference:
      "local-reference/AI综述论文陪跑训练营-提示词工作台.html",
    inheritedPrinciples: [
      "先明确研究方向，再建立文献基础",
      "宽检索理解领域，再围绕问题精准重检索",
      "大纲由文献证据驱动",
      "按段落推进写作",
      "生成与事实核查分离",
      "摘要、结论和配图在正文证据稳定后处理",
    ],
    strengthenedRules: [
      "生成检索式不等于真实执行检索",
      "冻结文献库之前不得声称完成领域分析",
      "命中量不能直接证明趋势、空白或效果",
      "核查必须回到来源定位，不能由模型自证",
      "不以规避AIGC检测作为产品目标",
      "大范围筛选默认使用题名与摘要，全文不是筛选完成前提",
      "每次科研最终回复必须在聊天正文直接给出用户简报，文件链接不能替代简报",
    ],
  },
  phases,
  nodes,
  edges,
  completionProfiles: [
    {
      id: "evidence_brief",
      userLabel: "得到经过核查的研究判断",
      terminalNodeId: "approve_evidence_boundary",
    },
    {
      id: "evidence_outline",
      userLabel: "得到有证据支撑的论文结构",
      terminalNodeId: "approve_outline",
    },
    {
      id: "audited_review",
      userLabel: "得到经过全文审计的综述稿",
      terminalNodeId: "author_signoff",
    },
  ],
  immutablePolicies: [
    "所有正式产物只新增版本，不覆盖历史",
    "人工决定必须绑定用户、时间、对象版本和理由",
    "通过的主张必须连接来源定位和独立核查结果",
    "范围变化会使受影响的下游产物失效，不能静默沿用",
    "网站、对话界面和产品截图只能投影状态机事实，不成为第二份事实",
  ],
  screeningPolicy: {
    largeScaleDefault: "title_abstract_primary",
    fullTextIsCompletionPrerequisite: false,
    accessLevelMustBeExplicit: true,
    missingAbstractDetails: "mark_unknown_do_not_impute",
    fullTextEscalationTriggers: [
      "user_explicitly_requests_full_text_review",
      "key_eligibility_cannot_be_decided_from_abstract",
      "precise_method_or_numeric_claim",
      "strong_causal_or_high_risk_claim",
      "formal_writing_or_full_text_audit",
    ],
  },
  deliveryPolicy: {
    inlineUserBriefRequired: true,
    fileLinksCanReplaceBrief: false,
    requiredBriefFields: [
      "current_research_period",
      "new_conclusions",
      "main_evidence_and_boundaries",
      "next_step_or_user_decision",
    ],
  },
  stalePropagation: [
    { changed: "ResearchBrief", staleFrom: "design_orientation_search" },
    { changed: "ReviewAngleDecision", staleFrom: "design_focused_search" },
    { changed: "FrozenSearchProtocol", staleFrom: "freeze_library" },
    { changed: "LibraryManifest", staleFrom: "extract_evidence" },
    { changed: "ClaimEvidenceMap", staleFrom: "derive_outline" },
    { changed: "FrozenWritingPlan", staleFrom: "write_claim_units" },
    { changed: "SourceSnapshot", staleFrom: "extract_evidence" },
  ],
  runtimeArchitecture: {
    workflowDefinition:
      "不可变的流程模板和依赖图；新版本只影响新项目或经人工批准的迁移",
    projectRun: "某次真实研究项目的当前路径、节点执行和阻塞状态",
    workLease: "执行角色的临时认领状态，不等于科研内容被接受",
    researchArtifact:
      "研究问题、检索、文献库、证据、主张和稿件的独立版本与质量状态",
    humanGate:
      "引用明确产物版本与哈希的人工决定；内容完成时仍可保持 pending",
  },
  eventPolicy: {
    storage: "append_only",
    stateSource: "replayable_events",
    requiredFields: [
      "eventId",
      "projectId",
      "aggregateId",
      "sequence",
      "workflowVersion",
      "actorId",
      "actorRole",
      "actorKind",
      "occurredAt",
      "commandId",
      "commandRequestHash",
      "commandEventIndex",
      "commandEventCount",
      "causationId",
      "correlationId",
      "payload",
      "artifactRefs",
      "previousHash",
    ],
    correctionRule:
      "回退通过新事件、新产物版本和下游 stale 传播完成，绝不修改历史事件",
  },
  userProjectionPolicy: {
    show: ["当前阶段", "正在做什么", "为什么需要这一步", "下一项用户决定"],
    hideByDefault: [
      "内部节点ID",
      "对象Schema",
      "Agent角色名",
      "运行日志",
      "G0/G1/G2/G3代号",
      "无法由验收条件推导的进度百分比",
    ],
  },
});

export function validateResearchMachine(machine) {
  const issues = [];
  const phaseIds = new Set(machine.phases.map((phase) => phase.id));
  const nodeIds = new Set();

  for (const node of machine.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push(`duplicate node id: ${node.id}`);
    }
    nodeIds.add(node.id);

    if (!phaseIds.has(node.phaseId)) {
      issues.push(`unknown phase for ${node.id}: ${node.phaseId}`);
    }
    if (!node.userLabel || /\bG[0-9]+\b/i.test(node.userLabel)) {
      issues.push(`invalid user label for ${node.id}`);
    }
    if (!node.userStatus) issues.push(`missing user status for ${node.id}`);
    if (!node.purpose) issues.push(`missing purpose for ${node.id}`);
    if (!Array.isArray(node.inputs) || !Array.isArray(node.outputs)) {
      issues.push(`inputs and outputs must be arrays for ${node.id}`);
    }
    if (!Array.isArray(node.acceptanceCriteria) || node.acceptanceCriteria.length === 0) {
      issues.push(`missing acceptance criteria for ${node.id}`);
    }
    if (node.kind === "human_gate") {
      if (!node.humanAuthority) {
        issues.push(`missing human authority for ${node.id}`);
      }
      if (!Array.isArray(node.approverRoles) || node.approverRoles.length === 0) {
        issues.push(`missing approver roles for ${node.id}`);
      }
      if (!node.amendmentTargetNodeId) {
        issues.push(`missing amendment target for ${node.id}`);
      }
    }
    if (
      node.kind === "verifier" &&
      node.executorRole &&
      node.executorRole === node.reviewerRole
    ) {
      issues.push(`self review is forbidden for ${node.id}`);
    }
  }

  const adjacency = new Map([...nodeIds].map((nodeId) => [nodeId, []]));
  const incoming = new Map([...nodeIds].map((nodeId) => [nodeId, 0]));
  for (const edge of machine.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push(`invalid edge endpoint: ${edge.id}`);
      continue;
    }
    adjacency.get(edge.source).push(edge.target);
    incoming.set(edge.target, incoming.get(edge.target) + 1);
  }

  function hardDependencyAncestors(nodeId) {
    const ancestors = new Set();
    const queue = machine.edges
      .filter((edge) => edge.type === "hard_dependency" && edge.target === nodeId)
      .map((edge) => edge.source);
    while (queue.length > 0) {
      const candidate = queue.shift();
      if (ancestors.has(candidate)) continue;
      ancestors.add(candidate);
      queue.push(
        ...machine.edges
          .filter(
            (edge) => edge.type === "hard_dependency" && edge.target === candidate,
          )
          .map((edge) => edge.source),
      );
    }
    return ancestors;
  }

  for (const node of machine.nodes.filter((candidate) => candidate.kind === "human_gate")) {
    const target = machine.nodes.find(
      (candidate) => candidate.id === node.amendmentTargetNodeId,
    );
    if (!target) {
      issues.push(`unknown amendment target for ${node.id}: ${node.amendmentTargetNodeId}`);
      continue;
    }
    if (target.kind === "human_gate") {
      issues.push(`amendment target cannot be a human gate for ${node.id}`);
    }
    if (!hardDependencyAncestors(node.id).has(target.id)) {
      issues.push(`amendment target is not an upstream dependency for ${node.id}: ${target.id}`);
    }
  }

  for (const node of machine.nodes) {
    if (node.kind !== "input" && incoming.get(node.id) === 0) {
      issues.push(`unreachable node: ${node.id}`);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(nodeId) {
    if (visiting.has(nodeId)) {
      issues.push(`hard dependency cycle at ${nodeId}`);
      return;
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const target of adjacency.get(nodeId) ?? []) visit(target);
    visiting.delete(nodeId);
    visited.add(nodeId);
  }
  for (const nodeId of nodeIds) visit(nodeId);

  for (const profile of machine.completionProfiles) {
    if (!nodeIds.has(profile.terminalNodeId)) {
      issues.push(`unknown completion profile target: ${profile.terminalNodeId}`);
    }
  }

  return issues;
}

export function getUserProgress(machine, runtime) {
  const priority = [
    EXECUTION_STATES.BLOCKED,
    EXECUTION_STATES.REVISION,
    EXECUTION_STATES.RUNNING,
    EXECUTION_STATES.REVIEW,
    EXECUTION_STATES.READY,
    EXECUTION_STATES.DRAFT,
  ];
  let currentNode = null;
  for (const state of priority) {
    currentNode = machine.nodes.find(
      (node) => (runtime.nodes?.[node.id]?.state ?? EXECUTION_STATES.DRAFT) === state,
    );
    if (currentNode) break;
  }
  currentNode ??= machine.nodes.at(-1);

  const phase = machine.phases.find((item) => item.id === currentNode.phaseId);
  const runtimeState = runtime.nodes?.[currentNode.id]?.state ?? EXECUTION_STATES.DRAFT;

  return {
    phase: `${phase.userLabel}（第${phase.order}阶段，共${machine.phases.length}阶段）`,
    step: currentNode.userLabel,
    status: currentNode.userStatus,
    state: runtimeState,
    needsUserDecision: currentNode.kind === "human_gate",
  };
}
