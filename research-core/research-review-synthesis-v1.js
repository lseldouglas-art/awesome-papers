const MAX_EVIDENCE_IDS = 8;
const MAX_EXCERPT_LENGTH = 320;

const THEME_RULES = Object.freeze([
  {
    id: "early_detection_screening",
    label: "早筛、早诊与影像检测",
    pattern: /\b(?:screening|early detect(?:ion)?|early diagnos(?:is|tic)|low-dose ct|ldct|computed tomography|nodule|radiomics?)\b/i,
  },
  {
    id: "biomarkers_molecular",
    label: "分子分型与生物标志物",
    pattern: /\b(?:biomarkers?|molecular|genomic|genetic|mutation|egfr|alk|kras|ros1|met|ret|her2|circulating tumor dna|ctdna|liquid biopsy)\b/i,
  },
  {
    id: "targeted_therapy",
    label: "靶向治疗",
    pattern: /\b(?:targeted therap(?:y|ies)|tyrosine kinase inhibitor|\btki\b|egfr inhibitor|alk inhibitor|kras inhibitor)\b/i,
  },
  {
    id: "immunotherapy",
    label: "免疫治疗",
    pattern: /\b(?:immunotherap(?:y|ies|eutic)|immune checkpoint|checkpoint inhibitor|pd-?1|pd-?l1|ctla-?4)\b/i,
  },
  {
    id: "perioperative_treatment",
    label: "围手术期、新辅助与辅助治疗",
    pattern: /\b(?:perioperative|neoadjuvant|adjuvant|preoperative|postoperative)\b/i,
  },
  {
    id: "local_treatment",
    label: "手术、放疗与局部治疗",
    pattern: /\b(?:surgery|surgical|resection|lobectomy|radiotherap(?:y|ies)|radiation|stereotactic|sbrt|ablation|local therap(?:y|ies))\b/i,
  },
  {
    id: "advanced_metastatic",
    label: "晚期与转移性疾病管理",
    pattern: /\b(?:advanced|metastatic|metastasis|stage iii|stage iv|oligometasta)\b/i,
  },
  {
    id: "resistance_microenvironment",
    label: "耐药机制与肿瘤微环境",
    pattern: /\b(?:resistan(?:ce|t)|tumou?r microenvironment|immune microenvironment|mechanism|escape)\b/i,
  },
  {
    id: "toxicity_supportive",
    label: "毒性、安全性与支持治疗",
    pattern: /\b(?:toxicit(?:y|ies)|adverse event|safety|supportive care|palliative|symptom|pain|fatigue)\b/i,
  },
  {
    id: "survivorship_quality_of_life",
    label: "生存质量与长期管理",
    pattern: /\b(?:quality of life|survivorship|long-term survivor|patient-reported|functional outcome|rehabilitation)\b/i,
  },
  {
    id: "ai_digital",
    label: "人工智能与数字化工具",
    pattern: /\b(?:artificial intelligence|machine learning|deep learning|digital health|algorithm|computer-aided)\b/i,
  },
  {
    id: "prevention_epidemiology",
    label: "危险因素、预防与流行病学",
    pattern: /\b(?:prevention|epidemiolog(?:y|ical)|risk factor|smoking|tobacco|incidence|mortality|air pollution)\b/i,
  },
]);

const METHOD_RULES = Object.freeze([
  { id: "systematic_review", label: "系统综述设计", pattern: /\bsystematic review\b/i, category: "design" },
  { id: "meta_analysis", label: "Meta 分析", pattern: /\bmeta[ -]?analys(?:is|es)\b/i, category: "design" },
  { id: "network_meta_analysis", label: "网状 Meta 分析", pattern: /\bnetwork meta[ -]?analys(?:is|es)\b/i, category: "design" },
  { id: "scoping_review", label: "范围综述", pattern: /\bscoping review\b/i, category: "design" },
  { id: "reporting_guideline", label: "报告 PRISMA 等规范", pattern: /\b(?:prisma|mOOSE)\b/i, category: "transparency" },
  { id: "protocol_registration", label: "方案或 PROSPERO 注册", pattern: /\b(?:prospero|registered protocol|protocol registration|pre-registered)\b/i, category: "transparency" },
  { id: "database_search", label: "报告数据库检索", pattern: /\b(?:searched|searches|search strategy|database|pubmed|medline|embase|cochrane|web of science)\b/i, category: "transparency" },
  { id: "risk_of_bias", label: "报告偏倚风险评价", pattern: /\b(?:risk of bias|quality assessment|methodological quality|newcastle-ottawa|robins-i|roB 2|quadas)\b/i, category: "appraisal" },
  { id: "certainty_assessment", label: "报告证据确定性评价", pattern: /\b(?:grade|certainty of evidence|quality of evidence)\b/i, category: "appraisal" },
  { id: "heterogeneity_analysis", label: "报告异质性分析", pattern: /\b(?:heterogeneity|\bi\s*2\b|i-squared|random-effects|fixed-effects)\b/i, category: "analysis" },
  { id: "publication_bias", label: "报告发表偏倚", pattern: /\b(?:publication bias|funnel plot|egger(?:'s)? test)\b/i, category: "analysis" },
  { id: "subgroup_sensitivity", label: "报告亚组、敏感性或回归分析", pattern: /\b(?:subgroup analysis|sensitivity analysis|meta-regression)\b/i, category: "analysis" },
  { id: "randomized_evidence", label: "纳入或讨论随机对照证据", pattern: /\b(?:randomi[sz]ed controlled trial|\brct(?:s)?\b)\b/i, category: "evidence" },
]);

const GAP_RULES = Object.freeze([
  {
    id: "limited_evidence",
    label: "证据数量或质量仍有限",
    pattern: /\b(?:limited|insufficient|scarce|sparse|paucity|lack of|few studies|small number of studies|evidence is lacking)\b/i,
  },
  {
    id: "low_certainty",
    label: "证据确定性偏低",
    pattern: /\b(?:low certainty|very low certainty|low-quality evidence|very low-quality evidence|quality of evidence was low)\b/i,
  },
  {
    id: "heterogeneity",
    label: "研究间异质性较高",
    pattern: /\b(?:substantial heterogeneity|high heterogeneity|considerable heterogeneity|heterogeneous studies|clinical heterogeneity)\b/i,
  },
  {
    id: "inconsistent_results",
    label: "结果不一致或仍有争议",
    pattern: /\b(?:inconsistent|conflicting|controversial|remains unclear|uncertain|inconclusive)\b/i,
  },
  {
    id: "prospective_trials_needed",
    label: "仍需前瞻性或随机研究",
    pattern: /\b(?:(?:further|future|additional|well-designed|large-scale|high-quality).{0,55}(?:randomi[sz]ed|prospective|clinical trial)|(?:randomi[sz]ed|prospective).{0,55}(?:needed|required|warranted))\b/i,
  },
  {
    id: "standardization_needed",
    label: "定义、结局或流程尚未标准化",
    pattern: /\b(?:standardization|standardisation|standardized definition|standardised definition|lack of consensus|no consensus|uniform criteria|harmoni[sz]ation)\b/i,
  },
  {
    id: "long_term_unknown",
    label: "长期结局或随访不足",
    pattern: /\b(?:(?:long-term|long term).{0,45}(?:unknown|uncertain|limited|needed|warranted)|(?:longer|extended).{0,35}follow-up)\b/i,
  },
  {
    id: "subgroup_biomarker_unknown",
    label: "人群分层或预测标志物仍不清楚",
    pattern: /\b(?:(?:biomarker|predictor|patient selection|subgroup|stratification).{0,55}(?:unknown|unclear|uncertain|needed|remain|identify))\b/i,
  },
  {
    id: "safety_unknown",
    label: "安全性或获益—风险仍需澄清",
    pattern: /\b(?:(?:safety|toxicity|adverse event|harm).{0,55}(?:unknown|unclear|uncertain|limited|concern|needed))\b/i,
  },
  {
    id: "implementation_gap",
    label: "真实世界实施与可及性证据不足",
    pattern: /\b(?:implementation gap|real-world evidence.{0,35}(?:limited|needed)|cost-effectiveness.{0,35}(?:unknown|needed)|access disparit|health disparit)\b/i,
  },
  {
    id: "resistance_gap",
    label: "应答与耐药机制仍待突破",
    pattern: /\b(?:(?:resistance|resistant|treatment failure|non-response).{0,55}(?:mechanism|unknown|unclear|overcome|challenge|remain))\b/i,
  },
]);

const CONCLUSION_CUE = /\b(?:conclusion|conclusions|findings suggest|results suggest|results indicate|evidence suggests|was associated|were associated|may improve|showed benefit|promising)\b/i;
const OBJECTIVE_CUE = /\b(?:objective|aim|purpose|we sought|this review|this study)\b/i;

const DEFAULT_STUDY_ROUTE = Object.freeze({
  studyDesign: "预注册的多中心前瞻性研究；涉及干预比较时优先考虑随机设计或可审计的目标试验模拟。",
  populationAndComparison: "先锁定目标人群、暴露或干预、当前标准路径及主要比较条件，避免继续使用过宽主题。",
  coreOutcomes: ["临床重要结局", "患者报告结局", "安全性", "效应大小与不确定性"],
  executionSteps: [
    "用下一轮窄检索确认现有研究设计、在研试验和可复用结局定义。",
    "预注册人群、比较条件、主要结局、样本量依据及分层分析。",
    "保留独立验证或外部验证，并完整报告效应大小、置信区间和缺失数据。",
  ],
});

const THEME_STUDY_ROUTES = Object.freeze({
  early_detection_screening: {
    studyDesign: "多中心前瞻性诊断准确性研究，或兼顾效果与实施的混合型研究。",
    populationAndComparison: "按预设风险标准连续招募目标人群，与现行筛查路径及独立参考标准比较，并保留阴性与未完成筛查者。",
    coreOutcomes: ["敏感度与特异度", "阳性预测值", "早期检出或分期迁移", "依从性、伤害与资源消耗"],
    executionSteps: ["预先锁定阳性阈值和参考标准。", "在独立中心做外部验证。", "同时报告漏诊、假阳性、随访依从性和实施成本。"],
  },
  biomarkers_molecular: {
    studyDesign: "前瞻性、盲法、多中心生物标志物验证队列；若用于指导治疗，再增加标志物分层的比较性设计。",
    populationAndComparison: "在临床用途明确的人群中固定检测平台、阈值和采样时间，与现有临床模型或标准检测比较。",
    coreOutcomes: ["判别能力与校准", "临床净获益", "外部验证表现", "与生存、应答或毒性的关联"],
    executionSteps: ["先冻结检测流程、阈值和分析计划。", "把模型开发与独立外部验证严格分开。", "同时报告校准、决策曲线和失败样本，而不只报告 AUC。"],
  },
  targeted_therapy: {
    studyDesign: "按分子亚型分层的前瞻性比较研究；可行时采用随机试验，不可行时采用预设目标试验模拟。",
    populationAndComparison: "限定具体分子改变、治疗线次和耐药状态，与当前标准方案或明确的替代方案比较。",
    coreOutcomes: ["总生存与无进展生存", "客观缓解与缓解持续时间", "耐药模式", "毒性与患者报告结局"],
    executionSteps: ["预先定义分子亚组和治疗线次。", "统一后续治疗与交叉用药的记录。", "同步采集耐药前后样本并报告亚组交互。"],
  },
  immunotherapy: {
    studyDesign: "生物标志物分层的多中心比较研究；针对可干预问题优先使用随机或务实性试验。",
    populationAndComparison: "限定疾病分期、治疗线次、PD-L1 或其他分层条件，与当前标准免疫或联合方案比较。",
    coreOutcomes: ["总生存与无进展生存", "持久应答", "免疫相关不良事件", "生活质量与停药后结局"],
    executionSteps: ["把预测标志物与预后标志物分开验证。", "统一免疫相关毒性和救援治疗定义。", "预设获益—风险亚组并做外部验证。"],
  },
  perioperative_treatment: {
    studyDesign: "按分期与分子亚型分层的多中心随机或务实性围手术期研究。",
    populationAndComparison: "明确可切除性、手术方式和新辅助/辅助路径，与现行标准围手术期方案比较。",
    coreOutcomes: ["事件无进展与总生存", "病理缓解", "手术完成率与并发症", "生活质量"],
    executionSteps: ["统一可切除性和病理缓解定义。", "记录手术延迟、降期及术后治疗完成度。", "延长随访验证替代终点能否预测生存。"],
  },
  local_treatment: {
    studyDesign: "多中心随机比较研究；随机不可行时采用前瞻性登记和预设目标试验模拟。",
    populationAndComparison: "限定病灶负荷、解剖位置、既往治疗和技术参数，与当前系统治疗或标准局部治疗比较。",
    coreOutcomes: ["总生存与无进展生存", "局部控制", "程序相关并发症", "症状缓解与生活质量"],
    executionSteps: ["统一手术、放疗或消融技术参数。", "预先定义局部控制和失败模式。", "使用独立结局判定并完整记录交叉治疗。"],
  },
  advanced_metastatic: {
    studyDesign: "按分子特征、转移负荷和治疗线次分层的前瞻性比较效果研究。",
    populationAndComparison: "限制疾病阶段、既往治疗和器官功能，与当前指南推荐路径比较。",
    coreOutcomes: ["总生存与无进展生存", "症状控制", "治疗负担", "生活质量与安全性"],
    executionSteps: ["预设关键亚组与治疗序列。", "记录后续治疗和交叉用药。", "使用患者重要结局而非只使用影像缓解。"],
  },
  resistance_microenvironment: {
    studyDesign: "带配对样本的纵向机制队列，并用独立队列和功能实验进行验证。",
    populationAndComparison: "在治疗前、早期应答和进展时获取配对样本，比较持续应答者与原发或继发耐药者。",
    coreOutcomes: ["耐药发生时间", "可重复的分子或免疫特征", "功能验证结果", "可操作的分层策略"],
    executionSteps: ["预先定义采样时间点和耐药表型。", "把探索性多组学发现与独立验证分开。", "用功能实验或干预验证关键机制，而不止停留在相关性。"],
  },
  toxicity_supportive: {
    studyDesign: "前瞻性安全性登记或嵌入患者报告结局的务实性干预研究。",
    populationAndComparison: "纳入常被试验排除的高龄、合并症和多线治疗人群，与常规支持治疗路径比较。",
    coreOutcomes: ["严重与迟发不良事件", "症状负担", "生活质量", "治疗中断和医疗资源使用"],
    executionSteps: ["统一不良事件与患者报告结局的测量时间。", "主动捕获迟发和院外事件。", "预设高风险人群并验证风险分层工具。"],
  },
  survivorship_quality_of_life: {
    studyDesign: "长期纵向队列，或以患者报告结局为主要终点的康复/随访干预试验。",
    populationAndComparison: "限定治疗阶段和生存期，与常规随访或明确康复方案比较。",
    coreOutcomes: ["生活质量", "功能恢复", "症状轨迹", "复工、复发与长期安全性"],
    executionSteps: ["使用验证过的患者报告量表。", "设置基线并延长随访。", "同时报告失访、幸存者偏倚和临床意义阈值。"],
  },
  ai_digital: {
    studyDesign: "跨机构外部验证后再进入前瞻性临床影响研究。",
    populationAndComparison: "固定算法版本、输入数据和使用场景，与临床人员或现有模型比较。",
    coreOutcomes: ["判别与校准", "跨中心泛化", "临床决策影响", "公平性、失败模式与资源消耗"],
    executionSteps: ["冻结模型后使用完全独立的数据验证。", "报告校准、亚组公平性和数据漂移。", "在前瞻性流程中验证是否真正改善决策和患者结局。"],
  },
  prevention_epidemiology: {
    studyDesign: "前瞻性队列、自然实验或准实验；政策和实施问题可采用分阶段推广设计。",
    populationAndComparison: "明确暴露窗口、基线风险和对照地区/人群，控制关键混杂因素。",
    coreOutcomes: ["发病与死亡", "绝对风险差", "暴露—反应关系", "公平性与可及性"],
    executionSteps: ["预先定义暴露测量和时间窗。", "使用负对照、敏感性分析或准实验增强因果解释。", "报告绝对效应和不同风险人群的差异。"],
  },
});

const GAP_EXECUTION_STEPS = Object.freeze({
  limited_evidence: ["优先解决样本量、代表性和独立验证，不再重复小样本探索。"],
  low_certainty: ["使用预注册方案、充分样本量和透明偏倚控制，把证据确定性作为设计目标。"],
  heterogeneity: ["统一人群、干预/暴露和核心结局，并预设分层、敏感性与异质性解释。"],
  inconsistent_results: ["先复核定义和测量差异，再使用预设亚组或个体数据解释冲突结果。"],
  prospective_trials_needed: ["把前瞻性、多中心和可复核的比较条件作为最低设计门槛。"],
  standardization_needed: ["先通过共识、核心结局集或操作手册固定定义，再启动效果验证。"],
  long_term_unknown: ["设置长期随访节点，并预先处理失访、迟发风险和竞争事件。"],
  subgroup_biomarker_unknown: ["锁定候选分层因素，在独立队列验证交互效应与临床净获益。"],
  safety_unknown: ["建立主动安全监测和获益—风险联合判定，避免只报告疗效。"],
  implementation_gap: ["使用效果—实施混合设计，同时评价可及性、采纳、持续性和成本。"],
  resistance_gap: ["使用治疗前后配对样本与功能验证，把机制信号推进到可干预靶点。"],
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sourceIdFor(record) {
  return text(record?.sourceId) || (record?.pmid ? `pubmed:${record.pmid}` : null);
}

function searchableText(record) {
  return `${text(record?.title)} ${text(record?.abstract)}`.trim();
}

function sentences(value) {
  return text(value)
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 24);
}

function excerpt(value, limit = MAX_EXCERPT_LENGTH) {
  const clean = text(value).replace(/\s+/g, " ");
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 1).trimEnd()}…`;
}

function matchingRules(record, rules) {
  const value = searchableText(record);
  return rules.filter((rule) => rule.pattern.test(value));
}

function evidenceIds(records) {
  return unique(records.map(sourceIdFor)).slice(0, MAX_EVIDENCE_IDS);
}

function reportedSentence(record, cue) {
  return sentences(record?.abstract).find((sentence) => cue.test(sentence)) ?? null;
}

function gapSentence(record, rules) {
  const abstractSentences = sentences(record?.abstract);
  for (const sentence of abstractSentences) {
    if (rules.some((rule) => rule.pattern.test(sentence))) return sentence;
  }
  return null;
}

function reviewYear(record) {
  const match = text(record?.year).match(/\b(?:19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function ratio(count, total) {
  return total > 0 ? count / total : 0;
}

function percentage(count, total) {
  return Math.round(ratio(count, total) * 100);
}

function classifyMethodVisibility(methods) {
  const hasDesign = methods.some((method) => method.category === "design");
  const supportingCategories = new Set(
    methods.filter((method) => method.category !== "design").map((method) => method.category),
  );
  if (hasDesign && supportingCategories.size >= 2) return "more_complete";
  if (hasDesign || supportingCategories.size >= 1) return "partial";
  return "not_reported";
}

function trendDirection(recentRate, earlierRate, recentCount, earlierCount, recentTotal, earlierTotal) {
  if (recentTotal === 0 || earlierTotal === 0) return { id: "insufficient_periods", label: "缺少可比较年份" };
  const change = recentRate - earlierRate;
  if (recentCount >= 2 && earlierCount === 0) return { id: "recent_only", label: "近两年新出现于样本" };
  if (recentCount > 0 && earlierCount > 0 && recentRate >= 0.2 && earlierRate >= 0.2) {
    return { id: "persistent", label: "近五年持续出现" };
  }
  if (recentCount >= 2 && change >= 0.15) return { id: "rising_signal", label: "近两年占比上升信号" };
  if (earlierCount >= 2 && change <= -0.15) return { id: "earlier_signal", label: "较早样本更集中" };
  return { id: "stable_signal", label: "样本内持续出现" };
}

function mainThemeForGap(records, gapRule, themes) {
  const gapRecords = records.filter((record) => gapRule.pattern.test(searchableText(record)));
  const scored = themes
    .map((theme) => ({
      theme,
      count: gapRecords.filter((record) => theme.pattern.test(searchableText(record))).length,
    }))
    .sort((left, right) => right.count - left.count);
  return scored[0]?.count > 0 ? scored[0].theme : null;
}

function candidateQuestion(gap, theme) {
  const subject = theme?.label ?? "当前核心方向";
  if (["heterogeneity", "inconsistent_results", "standardization_needed"].includes(gap.id)) {
    return `围绕“${subject}”，能否统一研究对象、干预/暴露、比较条件与核心结局，并用预设的分层和敏感性分析解释差异？`;
  }
  if (["limited_evidence", "low_certainty", "prospective_trials_needed"].includes(gap.id)) {
    return `围绕“${subject}”，能否用预注册的前瞻性或随机设计验证关键临床结局，并完整报告效应大小与不确定性？`;
  }
  if (gap.id === "long_term_unknown") {
    return `“${subject}”的长期获益、迟发风险和患者报告结局在延长随访后是否仍然成立？`;
  }
  if (gap.id === "subgroup_biomarker_unknown") {
    return `在“${subject}”中，哪些可重复验证的人群特征或生物标志物能够预测获益与风险？`;
  }
  if (gap.id === "safety_unknown") {
    return `“${subject}”在不同人群中的真实获益—风险边界是什么，哪些不良结局最需要前瞻性监测？`;
  }
  if (gap.id === "implementation_gap") {
    return `“${subject}”从试验走向真实世界时，哪些可及性、成本或实施条件决定实际效果？`;
  }
  if (gap.id === "resistance_gap") {
    return `“${subject}”中早期应答与继发耐药由哪些可验证机制驱动，能否形成可操作的分层干预？`;
  }
  return `围绕“${subject}”，如何针对“${gap.label}”形成一个可验证、边界清楚的下一轮研究问题？`;
}

function directionReportForCandidate(candidate, index, themes, gaps, temporalSignals) {
  const theme = themes.find((item) => item.id === candidate.themeId) ?? null;
  const gap = gaps.find((item) => item.id === candidate.gapId) ?? null;
  const temporal = temporalSignals.find((item) => item.id === candidate.themeId) ?? null;
  const route = THEME_STUDY_ROUTES[candidate.themeId] ?? DEFAULT_STUDY_ROUTE;
  const gapStep = GAP_EXECUTION_STEPS[candidate.gapId];
  const executionSteps = unique([
    ...(gapStep ? [gapStep] : []),
    ...route.executionSteps,
    "进入正式方案前，核查关键全文、在研试验、可获得数据和可行样本量。",
  ]).slice(0, 5);
  const temporalReason = temporal
    ? `该主题在当前分层样本中呈“${temporal.direction.label}”；`
    : "";
  return {
    id: `direction_report_${candidate.id}`,
    themeId: candidate.themeId ?? null,
    gapId: candidate.gapId ?? null,
    rank: index + 1,
    priorityLabel: index === 0 ? "优先验证" : index === 1 ? "次优先验证" : "探索性候选",
    direction: theme?.label ?? "当前核心方向",
    whySuitable: `${theme ? `当前样本有 ${theme.count} 篇综述涉及该主题；` : ""}${temporalReason}${gap ? `其中 ${candidate.sourceIds.length} 篇与该方向同时关联的摘要明确出现“${gap.label}”信号。` : candidate.basis}`,
    recommendedQuestion: candidate.question,
    studyPlan: {
      studyDesign: route.studyDesign,
      populationAndComparison: route.populationAndComparison,
      coreOutcomes: route.coreOutcomes,
      executionSteps,
      decisionGate: "只有在下一轮窄检索确认问题尚未被高质量研究充分回答、关键结局可测量、数据与样本量可获得后，才进入正式研究方案。",
    },
    sourceIds: candidate.sourceIds,
    boundary: "这是依据当前综述题名摘要形成的候选解决方案，不是完整研究方案、伦理申请或已证实创新点。",
  };
}

export function analyzeReviewAbstracts(records = [], { reviewWindow = null } = {}) {
  const normalized = (Array.isArray(records) ? records : []).map((record) => ({ ...record }));
  const abstractRecords = normalized.filter((record) => text(record?.abstract));
  const years = normalized.map(reviewYear).filter(Number.isFinite);
  const newestYear = years.length ? Math.max(...years) : null;
  const oldestYear = years.length ? Math.min(...years) : null;
  const recentCutoff = newestYear ? newestYear - 1 : null;
  const recentRecords = recentCutoff
    ? normalized.filter((record) => (reviewYear(record) ?? 0) >= recentCutoff)
    : [];
  const earlierRecords = recentCutoff
    ? normalized.filter((record) => (reviewYear(record) ?? Number.POSITIVE_INFINITY) < recentCutoff)
    : [];

  const themeCoverage = THEME_RULES
    .map((theme) => {
      const matched = normalized.filter((record) => theme.pattern.test(searchableText(record)));
      return {
        id: theme.id,
        label: theme.label,
        count: matched.length,
        share: percentage(matched.length, normalized.length),
        years: unique(matched.map((record) => reviewYear(record)?.toString())).sort().reverse(),
        sourceIds: evidenceIds(matched),
        exampleTitles: matched.map((record) => text(record?.title)).filter(Boolean).slice(0, 2),
      };
    })
    .filter((theme) => theme.count > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  const temporalSignals = themeCoverage
    .map((covered) => {
      const rule = THEME_RULES.find((theme) => theme.id === covered.id);
      const recentMatches = recentRecords.filter((record) => rule.pattern.test(searchableText(record)));
      const earlierMatches = earlierRecords.filter((record) => rule.pattern.test(searchableText(record)));
      const recentRate = ratio(recentMatches.length, recentRecords.length);
      const earlierRate = ratio(earlierMatches.length, earlierRecords.length);
      return {
        id: covered.id,
        label: covered.label,
        recentCount: recentMatches.length,
        recentTotal: recentRecords.length,
        earlierCount: earlierMatches.length,
        earlierTotal: earlierRecords.length,
        recentShare: percentage(recentMatches.length, recentRecords.length),
        earlierShare: percentage(earlierMatches.length, earlierRecords.length),
        direction: trendDirection(
          recentRate,
          earlierRate,
          recentMatches.length,
          earlierMatches.length,
          recentRecords.length,
          earlierRecords.length,
        ),
        sourceIds: evidenceIds([...recentMatches, ...earlierMatches]),
      };
    })
    .filter((signal) => signal.direction.id !== "insufficient_periods" && signal.recentCount + signal.earlierCount >= 2)
    .sort((left, right) => {
      const priority = { recent_only: 0, rising_signal: 1, persistent: 2, stable_signal: 3, earlier_signal: 4 };
      return (priority[left.direction.id] ?? 9) - (priority[right.direction.id] ?? 9)
        || (right.recentCount + right.earlierCount) - (left.recentCount + left.earlierCount);
    })
    .slice(0, 6);

  const methodSignals = METHOD_RULES
    .map((method) => {
      const matched = abstractRecords.filter((record) => method.pattern.test(searchableText(record)));
      return {
        id: method.id,
        label: method.label,
        category: method.category,
        count: matched.length,
        sourceIds: evidenceIds(matched),
      };
    })
    .filter((method) => method.count > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  const methodVisibilityBySource = abstractRecords.map((record) => {
    const methods = matchingRules(record, METHOD_RULES);
    return { sourceId: sourceIdFor(record), level: classifyMethodVisibility(methods) };
  });
  const methodVisibility = {
    moreCompleteCount: methodVisibilityBySource.filter((item) => item.level === "more_complete").length,
    partialCount: methodVisibilityBySource.filter((item) => item.level === "partial").length,
    notReportedCount: methodVisibilityBySource.filter((item) => item.level === "not_reported").length,
    assessedCount: abstractRecords.length,
    boundary: "这里只评价摘要中可见的方法报告信号，不等同于 AMSTAR 2、ROBIS 或全文质量评价；摘要未报告不能写成没有实施。",
  };

  const gapClusters = GAP_RULES
    .map((gap) => {
      const matched = abstractRecords.filter((record) => gap.pattern.test(searchableText(record)));
      const excerpts = matched
        .map((record) => ({
          sourceId: sourceIdFor(record),
          text: excerpt(gapSentence(record, [gap])),
        }))
        .filter((item) => item.sourceId && item.text)
        .slice(0, 3);
      return {
        id: gap.id,
        label: gap.label,
        count: matched.length,
        sourceIds: evidenceIds(matched),
        evidenceExcerpts: excerpts,
      };
    })
    .filter((gap) => gap.count > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  const breakthroughCandidates = gapClusters.map((gap, index) => {
    const gapRule = GAP_RULES.find((rule) => rule.id === gap.id);
    const theme = mainThemeForGap(normalized, gapRule, THEME_RULES);
    const themeSourceIds = themeCoverage.find((item) => item.id === theme?.id)?.sourceIds ?? [];
    const linkedSourceIds = gap.sourceIds.filter((sourceId) => themeSourceIds.includes(sourceId));
    return {
      id: `candidate_${index + 1}_${gap.id}`,
      question: candidateQuestion(gap, theme),
      basis: `${gap.count} 篇可用摘要明确出现“${gap.label}”信号；这是下一轮选题调查入口，不是已证实的研究空白。`,
      gapId: gap.id,
      themeId: theme?.id ?? null,
      sourceIds: linkedSourceIds.length ? linkedSourceIds : gap.sourceIds,
      nextAction: "下一轮应先缩小人群、干预/暴露、比较条件与结局，再针对该问题重新生成检索式并扫描证据。",
    };
  }).filter((candidate, index, all) => (
    all.findIndex((other) => other.question === candidate.question) === index
  )).slice(0, 5);

  const directionPlans = breakthroughCandidates
    .map((candidate, index) => directionReportForCandidate(
      candidate,
      index,
      themeCoverage,
      gapClusters,
      temporalSignals,
    ));
  const directionReport = {
    title: "从综述现象到下一步研究方案",
    executiveSummary: directionPlans.length
      ? `当前样本支持把宽泛的领域描述收窄为 ${directionPlans.length} 个可验证方向。优先考虑“${directionPlans[0].direction}”：它同时具有可追溯的主题覆盖和摘要明确缺口；下一步应先验证问题新颖性与可行性，再选择研究设计，而不是直接宣布创新点。`
      : "当前摘要证据还不足以提出可追溯的解决方案；应先补充更窄检索或全文核查。",
    solutionPrinciple: "优先选择“临床或机制问题明确、摘要缺口可追溯、结局可测量、设计能够提升现有证据确定性”的方向。",
    directions: directionPlans,
    nextDecision: directionPlans.length
      ? "研究者先选择一个方向；系统下一轮只围绕该方向重建更窄的 PICO/PECO、检索式和综述扫描，不自动并行推进全部候选。"
      : "先修订检索式或补充摘要样本，再决定是否进入下一轮选题调查。",
    boundary: "方向排序和解决方案来自当前 PubMed 综述样本的题名摘要信号，未核查全文、指南、试验注册或本地数据可行性；它们是选题假设，不是研究空白定论或临床建议。",
  };

  const sourceAnalyses = normalized.map((record) => {
    const abstract = text(record?.abstract);
    const themes = matchingRules(record, THEME_RULES);
    const methods = abstract ? matchingRules(record, METHOD_RULES) : [];
    const gaps = abstract ? matchingRules(record, GAP_RULES) : [];
    return {
      sourceId: sourceIdFor(record),
      accessLevel: abstract ? "abstract_only" : "title_only",
      themeIds: themes.map((item) => item.id),
      themeLabels: themes.map((item) => item.label),
      methodSignalIds: methods.map((item) => item.id),
      methodSignalLabels: methods.map((item) => item.label),
      methodVisibility: abstract ? classifyMethodVisibility(methods) : "abstract_unavailable",
      gapSignalIds: gaps.map((item) => item.id),
      gapSignalLabels: gaps.map((item) => item.label),
      objectiveExcerpt: abstract ? excerpt(reportedSentence(record, OBJECTIVE_CUE), 240) || null : null,
      conclusionExcerpt: abstract ? excerpt(reportedSentence(record, CONCLUSION_CUE), 300) || null : null,
      gapExcerpt: abstract ? excerpt(gapSentence(record, gaps), 300) || null : null,
      boundary: abstract
        ? "仅基于题名与摘要编码；未核对全文方法、数值、纳排细节或补充材料。"
        : "摘要未返回；除题名主题外，其余方法、结论和缺口保持未知。",
    };
  });

  const dominantThemes = themeCoverage.slice(0, 4);
  const leadingChanges = temporalSignals.filter((item) => ["recent_only", "rising_signal"].includes(item.direction.id)).slice(0, 3);
  return {
    schemaVersion: "research-review-synthesis/v1",
    analysisLevel: "title_abstract",
    analyzedSourceCount: normalized.length,
    abstractAvailableCount: abstractRecords.length,
    titleOnlyCount: normalized.length - abstractRecords.length,
    reviewWindow,
    observedYears: { from: oldestYear, to: newestYear },
    comparisonPeriods: recentCutoff
      ? {
          recent: { from: recentCutoff, to: newestYear, count: recentRecords.length },
          earlier: earlierRecords.length
            ? { from: oldestYear, to: recentCutoff - 1, count: earlierRecords.length }
            : null,
        }
      : null,
    themeCoverage,
    temporalSignals,
    methodSignals,
    methodVisibility,
    gapClusters,
    breakthroughCandidates,
    directionReport,
    sourceAnalyses,
    summaries: {
      coverage: dominantThemes.length
        ? `当前样本主要覆盖：${dominantThemes.map((item) => `${item.label}（${item.count}/${normalized.length}）`).join("、")}。`
        : "当前题名摘要没有形成可稳定编码的主题聚集。",
      change: leadingChanges.length
        ? `样本内近两年出现上升或新出现信号：${leadingChanges.map((item) => item.label).join("、")}。`
        : "当前样本没有形成足以报告的近两年上升信号；这不等于领域没有变化。",
      methods: `${methodVisibility.moreCompleteCount}/${abstractRecords.length} 篇摘要的方法报告信号较完整，${methodVisibility.partialCount} 篇部分可见，${methodVisibility.notReportedCount} 篇摘要未充分报告。`,
      gaps: gapClusters.length
        ? `摘要明确提到的主要证据问题包括：${gapClusters.slice(0, 4).map((item) => `${item.label}（${item.count}）`).join("、")}。`
        : "当前可用摘要未明确报告可聚类的证据缺口；不能据此写成没有研究空白。",
    },
    boundary: "时间变化、主题覆盖、方法报告和缺口均来自当前排序样本的题名摘要编码，不是全量文献计量、全文质量评价或研究空白定论。候选突破口必须进入下一轮更窄检索后再确认。",
  };
}

export const RESEARCH_REVIEW_SYNTHESIS_INFO = Object.freeze({
  schemaVersion: "research-review-synthesis/v1",
  themeRuleCount: THEME_RULES.length,
  methodRuleCount: METHOD_RULES.length,
  gapRuleCount: GAP_RULES.length,
});
