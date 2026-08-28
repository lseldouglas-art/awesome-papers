const MAX_EVIDENCE_IDS = 8;
const MAX_EXCERPT_LENGTH = 320;

export const RESEARCH_REVIEW_CLASSIFIER_VERSION = "research-review-classifier/v5";

const THEME_RULES = Object.freeze([
  {
    id: "early_detection_screening",
    label: "早筛、早诊与影像检测",
    pattern: /\b(?:screening|early detect(?:ion)?|early diagnos(?:is|tic)|diagnos(?:is|tic).{0,35}\bearly\b|diagnostic imaging|(?:fapi\s+)?pet(?:\/ct)? imaging|endoscop(?:y|ic)|radiomics?)\b/i,
  },
  {
    id: "early_onset",
    label: "早发与青年发病人群",
    pattern: /\b(?:early[- ]onset|young[- ]onset|younger patients?|young adults?|\beogc\b)\b/i,
  },
  {
    id: "biomarkers_molecular",
    label: "分子分型与生物标志物",
    pattern: /\b(?:biomarkers?|molecular|genomic|genetic|mutation|non[- ]coding rnas?|ncrnas?|microRNAs?|miRNAs?|lncRNAs?|circular RNAs?|circRNAs?|circulating tumor dna|ctdna|liquid biopsy)\b/i,
  },
  {
    id: "targeted_therapy",
    label: "靶向治疗",
    pattern: /\b(?:targeted therap(?:y|ies)|tyrosine kinase inhibitor|\btki\b|molecularly targeted)\b/i,
  },
  {
    id: "systemic_treatment",
    label: "系统治疗与综合管理",
    pattern: /\b(?:systemic (?:therap(?:y|ies)|treatment)|(?:gastric|stomach|breast|lung|colorectal|colon|rectal) cancer treatment)\b/i,
  },
  {
    id: "immunotherapy",
    label: "免疫治疗",
    pattern: /\b(?:immunotherap(?:y|ies|eutic)|immune checkpoint|checkpoint inhibitor|immunosuppressive (?:tumou?r )?microenvironment|pd-?1|pd-?l1|ctla-?4)\b/i,
  },
  {
    id: "perioperative_treatment",
    label: "围手术期、新辅助与辅助治疗",
    pattern: /\b(?:perioperative|neoadjuvant|adjuvant|preoperative|postoperative)\b/i,
  },
  {
    id: "local_treatment",
    label: "手术、放疗与局部治疗",
    pattern: /\b(?:surgery|surgical|resection|radiotherap(?:y|ies)|stereotactic radiotherapy|ablation|local therap(?:y|ies))\b/i,
  },
  {
    id: "advanced_metastatic",
    label: "晚期与转移性疾病管理",
    pattern: /\b(?:advanced(?:-stage|\s+(?:cancer|carcinoma|neoplasm|tumou?r|disease))|metastatic|metastasis|stage iii|stage iv|oligometasta)\b/i,
  },
  {
    id: "resistance_microenvironment",
    label: "耐药机制与肿瘤微环境",
    pattern: /\b(?:resistan(?:ce|t)|tumou?r microenvironment|immune microenvironment|resistance mechanism|immune escape)\b/i,
  },
  {
    id: "toxicity_supportive",
    label: "毒性、安全性与支持治疗",
    pattern: /\b(?:toxicit(?:y|ies)|adverse event|safety|supportive care|palliative care|symptom burden|cancer-related fatigue|treatment-related fatigue|fatigue severity|pain management)\b/i,
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
    pattern: /\b(?:prevention|epidemiolog(?:y|ical)|risk factor|(?:global|worldwide|regional|national) (?:prevalence|incidence)|prevalence.{0,30}incidence|characteristics.{0,60}around the world|incidence trend|incidence rate|mortality trend|mortality rate|population-based)\b/i,
  },
]);

const GENERIC_THEME_RULES = Object.freeze([
  {
    id: "generic_diagnosis_measurement",
    label: "识别、测量与诊断",
    pattern: /\b(?:diagnos(?:is|tic)|screening|detection|measurement|assessment|instrument|test accuracy|validation)\b/i,
  },
  {
    id: "generic_intervention_management",
    label: "干预、治疗与管理",
    pattern: /\b(?:intervention|treatment|therapy|management|care pathway|program(?:me)?)\b/i,
  },
  {
    id: "generic_risk_prognosis",
    label: "风险、预后与分层",
    pattern: /\b(?:risk factor|risk prediction|prognos(?:is|tic)|predictor|stratification)\b/i,
  },
  {
    id: "generic_mechanism_pathway",
    label: "机制与作用路径",
    pattern: /\b(?:mechanisms?|pathways?|pathophysiolog|mediators?|moderators?)\b/i,
  },
  {
    id: "generic_outcomes_recovery",
    label: "结局、症状与恢复",
    pattern: /\b(?:outcomes?|quality of life|patient-reported|symptoms?|recovery|rehabilitation|sleep quality|sleep disturbance)\b/i,
  },
  {
    id: "generic_digital_methods",
    label: "数字方法与人工智能",
    pattern: /\b(?:artificial intelligence|machine learning|deep learning|digital health|algorithm)\b/i,
  },
  {
    id: "generic_implementation_equity",
    label: "实施、可及性与公平性",
    pattern: /\b(?:implementation|accessibility|access to care|equity|disparit|cost-effectiveness)\b/i,
  },
]);

const METHOD_RULES = Object.freeze([
  { id: "systematic_review", label: "系统综述设计", pattern: /\bsystematic review\b/i, category: "design" },
  { id: "meta_analysis", label: "Meta 分析", pattern: /\bmeta[ -]?analys(?:is|es)\b/i, category: "design" },
  { id: "network_meta_analysis", label: "网状 Meta 分析", pattern: /\bnetwork meta[ -]?analys(?:is|es)\b/i, category: "design" },
  { id: "scoping_review", label: "范围综述", pattern: /\bscoping review\b/i, category: "design" },
  { id: "reporting_guideline", label: "报告 PRISMA 等规范", pattern: /\b(?:prisma|mOOSE)\b/i, category: "transparency" },
  { id: "protocol_registration", label: "方案或 PROSPERO 注册", pattern: /\b(?:prospero|registered protocol|protocol registration|pre-registered)\b/i, category: "transparency" },
  { id: "database_search", label: "报告数据库检索", pattern: /\b(?:search(?:ed|es|ing)?\s+(?:the\s+)?(?:electronic\s+)?databases?|database search(?:es)?|search strategy|pubmed|medline|embase|cochrane|web of science)\b/i, category: "transparency" },
  { id: "risk_of_bias", label: "报告偏倚风险评价", pattern: /\b(?:risk of bias|quality assessment|methodological quality|newcastle-ottawa|robins-i|roB 2|quadas)\b/i, category: "appraisal" },
  { id: "certainty_assessment", label: "报告证据确定性评价", pattern: /\b(?:(?:using|according to|with)\s+grade|grade\s+(?:approach|framework|assessment|methodology)|certainty of evidence|quality of evidence)\b/i, category: "appraisal" },
  { id: "heterogeneity_analysis", label: "报告统计异质性分析", pattern: /\b(?:statistical heterogeneity|between-study heterogeneity|heterogeneity (?:was|is|were|are) (?:assessed|evaluated|examined)|heterogeneity analysis|\bi\s*2\b|i-squared|random-effects|fixed-effects)\b/i, category: "analysis" },
  { id: "publication_bias", label: "报告发表偏倚", pattern: /\b(?:publication bias|funnel plot|egger(?:'s)? test)\b/i, category: "analysis" },
  { id: "subgroup_sensitivity", label: "报告亚组、敏感性或回归分析", pattern: /\b(?:subgroup analysis|sensitivity analysis|meta-regression)\b/i, category: "analysis" },
  { id: "randomized_evidence", label: "纳入或讨论随机对照证据", pattern: /\b(?:randomi[sz]ed controlled trial|\brct(?:s)?\b)\b/i, category: "evidence" },
]);

const GAP_RULES = Object.freeze([
  {
    id: "limited_evidence",
    label: "证据数量或质量仍有限",
    pattern: /\b(?:(?:limited|insufficient|scarce|sparse)\s+(?:available\s+)?(?:high-quality\s+)?(?:evidence|data|studies|research|literature|information|sample size)|(?:evidence|data|studies|research|literature)\s+(?:is|are|was|were|remains?|remain)\s+(?:very\s+)?(?:limited|insufficient|scarce|sparse)|(?:paucity|lack)\s+of\s+(?:high-quality\s+)?(?:evidence|data|studies|research|literature)|few studies|small number of studies|evidence is lacking)\b/i,
  },
  {
    id: "low_certainty",
    label: "证据确定性偏低",
    pattern: /\b(?:low certainty|very low certainty|low-quality evidence|very low-quality evidence|quality of evidence was low)\b/i,
  },
  {
    id: "heterogeneity",
    label: "研究间异质性较高",
    pattern: /\b(?:substantial heterogeneity|high heterogeneity|considerable heterogeneity|(?:clinical|methodological|statistical) heterogeneity|heterogeneity (?:across|between) studies)\b/i,
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

const DOMAIN_PROBLEM_RULES = Object.freeze([
  {
    id: "treatment_sequence",
    category: "clinical_unresolved_problem",
    label: "多模式治疗的最佳序列仍在探索",
    pattern: /\boptimal sequencing of multimodality therapy.{0,35}(?:investigated|unclear)\b/i,
  },
  {
    id: "local_treatment_long_term",
    category: "clinical_unresolved_problem",
    label: "保胃与前哨技术的长期结局仍待随访",
    pattern: /^(?=[\s\S]*\b(?:function-preserving gastrectomy|sentinel node|sentinel lymph node|limited resection|these techniques)\b)(?=[\s\S]*\bstudies of long-term outcomes?.{0,35}(?:ongoing|unknown|uncertain|limited)\b)[\s\S]*$/i,
    auditPattern: /\bstudies of long-term outcomes?.{0,35}(?:ongoing|unknown|uncertain|limited)\b/i,
  },
  {
    id: "east_asia_transferability",
    category: "external_validity_and_representation",
    label: "保胃与前哨技术在东亚外的外部适用性不足",
    pattern: /\b(?:procedure|approach|strategy|treatment|experience|use|techniques?).{0,65}rare outside of (?:east asia|asia|japan|china|korea)\b/i,
  },
  {
    id: "latin_africa_representation",
    category: "external_validity_and_representation",
    label: "拉美与非洲人群的证据代表性不足",
    pattern: /\b(?:(?:latin america|africa).{0,100}(?:underrepresented|under-represented)|more research is needed in (?:latin america|africa).{0,100}(?:underrepresented|under-represented))\b/i,
  },
  {
    id: "immunotherapy_benefit_resistance",
    category: "benefit_stratification_and_resistance",
    label: "免疫治疗持久获益分层与耐药解释不足",
    pattern: /\b(?:durable responses? in .{0,30}(?:remain|are|is) limited|heterogeneous tumou?r microenvironment.{0,80}(?:immune evasion|resistance)|tumou?r microenvironment.{0,80}(?:immune evasion|resistance))\b/i,
  },
  {
    id: "multiomics_biomarker_translation",
    category: "implementation_and_translation",
    label: "多组学标志物从发现、验证到临床整合仍有障碍",
    pattern: /\b(?:(?:challenges?|limitations?).{0,50}integrat(?:e|ing|ion).{0,40}multi-omics|practical integration of .{0,60}multi-omics|biomarker implementation)\b/i,
  },
  {
    id: "microbiome_definition_translation",
    category: "definition_and_standardization",
    label: "胃微生物组概念边界与临床用途尚未标准化",
    pattern: /^(?=[\s\S]*\b(?:microbiota|microbiome)\b)(?=[\s\S]*\bconceptual (?:haziness|ambiguity)\b)[\s\S]*$/i,
    auditPattern: /\bconceptual (?:haziness|ambiguity)\b/i,
  },
  {
    id: "ai_clinical_implementation",
    category: "implementation_and_translation",
    label: "AI 早诊从模型表现到临床实施仍面临障碍",
    pattern: /^(?=[\s\S]*\b(?:artificial intelligence|\bai\b))(?=[\s\S]*\b(?:major challenges?|external validation|clinical implementation|application limitations?)\b)[\s\S]*$/i,
    auditPattern: /\b(?:major challenges?|external validation|clinical implementation|application limitations?)\b/i,
  },
  {
    id: "advanced_treatment_options",
    category: "clinical_unresolved_problem",
    label: "晚期胃癌可用治疗选择仍有限",
    pattern: /\blimited treatment options? at advanced stages?\b/i,
  },
  {
    id: "targeted_benefit_subset",
    category: "benefit_stratification_and_resistance",
    label: "靶向治疗获益仅覆盖部分患者",
    pattern: /\beffective for (?:only )?a limited (?:subset|proportion) of patients\b/i,
  },
  {
    id: "early_detection_markers_targets",
    category: "diagnosis_and_target_discovery",
    label: "无创早检标志物与新治疗靶点仍缺乏",
    pattern: /\b(?:painless|noninvasive|non-invasive).{0,45}markers?.{0,45}early detection.{0,80}(?:new )?targets?.{0,45}unavailable\b/i,
  },
  {
    id: "targeted_agent_failures",
    category: "clinical_unresolved_problem",
    label: "部分靶向药物未能转化为有效治疗",
    pattern: /\bfailure of (?:several )?targeted agents?\b/i,
  },
]);

const GENERIC_DOMAIN_PROBLEM_RULES = Object.freeze([
  {
    id: "generic_outcome_uncertainty",
    category: "outcome_uncertainty",
    label: "长期或关键结局仍不确定",
    pattern: /\b(?:(?:long-term|long term|key) outcomes?.{0,35}(?:ongoing|unknown|uncertain|limited)|longer follow-up.{0,25}(?:needed|required))\b/i,
  },
  {
    id: "generic_representation",
    category: "external_validity_and_representation",
    label: "样本人群代表性与外部适用性待核",
    pattern: /\b(?:underrepresented|under-represented|limited generalizability|lack of external validation)\b/i,
  },
  {
    id: "generic_definition_standardization",
    category: "definition_and_standardization",
    label: "概念、定义或结局标准仍不一致",
    pattern: /\b(?:conceptual (?:haziness|ambiguity)|definition remains unclear|lack of consensus|no consensus|standardization|standardisation|uniform criteria|harmoni[sz]ation)\b/i,
  },
  {
    id: "generic_implementation_translation",
    category: "implementation_and_translation",
    label: "从研究证据到实际实施仍有障碍",
    pattern: /\b(?:implementation challenges?|barriers? to implementation|practical integration|clinical translation|application limitations?)\b/i,
  },
  {
    id: "generic_clinical_options",
    category: "clinical_unresolved_problem",
    label: "可用干预或管理选择仍有限",
    pattern: /\blimited (?:treatment|intervention|management) options?\b/i,
  },
]);

const CONCLUSION_CUE = /\b(?:conclusion|conclusions|findings suggest|results suggest|results indicate|evidence suggests|was associated|were associated|may improve|showed benefit|promising)\b/i;
const OBJECTIVE_CUE = /\b(?:objective|aim|purpose|we sought|this review|this study)\b/i;

const DEFAULT_REVIEW_ROUTE = Object.freeze({
  reviewType: "系统综述；若问题仍过宽，先做范围综述并建立证据地图。",
  populationAndComparison: "冻结目标人群、干预或暴露、比较条件、核心结局和研究设计边界，避免继续使用宽泛主题。",
  coreOutcomes: ["效应大小与不确定性", "证据确定性", "患者重要结局", "适用性"],
  organization: [
    "按人群、干预或暴露、比较条件、结局和研究设计建立提取矩阵。",
    "把定义差异、偏倚风险和证据确定性作为综合主轴。",
    "定量合并必须以临床与方法同质性成立为前提；否则采用结构化叙述综合。",
  ],
});

const THEME_REVIEW_ROUTES = Object.freeze({
  early_onset: {
    reviewType: "定义与人群差异导向的范围综述；若年龄界值与结局可统一，再升级为系统综述。",
    populationAndComparison: "比较不同年龄界值、地区与基线风险下的早发病例，并区分风险、筛查、病理特征、治疗路径和长期结局。",
    coreOutcomes: ["年龄界值与病例定义", "地区与人群差异", "筛查与诊断路径", "治疗、复发与长期生存"],
    organization: ["先绘制 EOGC/early-onset 的年龄界值与病例定义。", "按地区、族群与研究场景比较风险和检出路径。", "分开综合病理分子特征、治疗路径与长期结局，避免用病例比例替代风险。"],
  },
  early_detection_screening: {
    reviewType: "诊断准确性系统综述；异质技术较多时先做范围综述。",
    populationAndComparison: "按风险层级、检测技术、阳性阈值和参考标准分层，并区分筛查、诊断与监测场景。",
    coreOutcomes: ["敏感度与特异度", "阳性预测值", "分期迁移", "伤害、依从性与资源消耗"],
    organization: ["先统一检测用途和参考标准。", "按风险层级、阈值与验证场景分层提取。", "把漏诊、假阳性和实施结局与准确性指标并列综合。"],
  },
  biomarkers_molecular: {
    reviewType: "按临床用途分层的预后或预测标志物系统综述。",
    populationAndComparison: "区分诊断、预后、疗效预测和监测用途，再按检测平台、阈值、采样时间及验证层级分层。",
    coreOutcomes: ["判别能力与校准", "临床净获益", "外部验证表现", "与生存、应答或毒性的关联"],
    organization: ["把模型开发、内部验证和独立外部验证分开编码。", "比较检测平台、阈值和采样时点。", "同时综合校准、决策曲线和失败样本，不只汇总 AUC。"],
  },
  targeted_therapy: {
    reviewType: "按分子亚组与治疗线次预设分层的干预系统综述。",
    populationAndComparison: "限定具体分子改变、治疗线次和耐药状态，与当前标准方案或明确的替代方案比较。",
    coreOutcomes: ["总生存与无进展生存", "客观缓解与缓解持续时间", "耐药模式", "毒性与患者报告结局"],
    organization: ["预先定义分子亚组和治疗线次。", "分开提取随机与非随机证据并评价偏倚。", "将后续治疗、交叉用药与耐药定义纳入异质性解释。"],
  },
  systemic_treatment: {
    reviewType: "按疾病阶段与治疗序列分层的系统综述；方案网络可交换性不足时采用结构化叙述综合。",
    populationAndComparison: "限定疾病阶段、既往治疗和治疗目标，比较当前标准系统治疗、联合路径与后续治疗序列。",
    coreOutcomes: ["总生存与无进展生存", "应答及其持续时间", "治疗完成度与后续治疗", "安全性与患者报告结局"],
    organization: ["按疾病阶段、治疗线次和分层标志物建立证据矩阵。", "分开随机与非随机证据并评价跨方案可比性。", "同步提取后续治疗、毒性和患者重要结局。"],
  },
  immunotherapy: {
    reviewType: "按治疗场景与预测标志物分层的干预系统综述。",
    populationAndComparison: "限定疾病分期、治疗线次、PD-L1 或其他分层条件，与当前标准免疫或联合方案比较。",
    coreOutcomes: ["总生存与无进展生存", "持久应答", "免疫相关不良事件", "生活质量与停药后结局"],
    organization: ["把预测标志物与预后标志物分开编码。", "统一治疗线次、联合方案和免疫相关毒性定义。", "按预设亚组综合获益—风险并评价交互证据。"],
  },
  perioperative_treatment: {
    reviewType: "按疾病分期、方案与手术路径分层的干预系统综述。",
    populationAndComparison: "明确可切除性、手术方式和新辅助/辅助路径，与现行标准围手术期方案比较。",
    coreOutcomes: ["事件无进展与总生存", "病理缓解", "手术完成率与并发症", "生活质量"],
    organization: ["统一可切除性、病理缓解和结局时间点。", "按方案完成度、手术影响和疾病分期分层。", "将替代终点与长期生存证据分开呈现。"],
  },
  local_treatment: {
    reviewType: "围绕地区适用性与治疗序列的系统综述；跨方案可比性不足时采用结构化叙述综合。",
    populationAndComparison: "限定可切除胃癌的分期、手术范围、围手术期治疗与地区实践背景，比较东西方证据的患者选择、治疗序列和适用边界。",
    coreOutcomes: ["长期生存与复发", "手术与围手术期方案完成度", "程序相关并发症", "地区外部适用性"],
    organization: ["按东西方人群、分期与手术路径建立可比性矩阵。", "比较治疗序列、患者选择与后续治疗差异。", "把短期手术结局与长期生存分开，并明确哪些结论不能跨地区外推。"],
  },
  advanced_metastatic: {
    reviewType: "面向治疗序列决策的系统综述；证据网络足够时再考虑网状 Meta 分析。",
    populationAndComparison: "限制疾病阶段、既往治疗和器官功能，与当前指南推荐路径比较。",
    coreOutcomes: ["总生存与无进展生存", "症状控制", "治疗负担", "生活质量与安全性"],
    organization: ["按治疗线次、分子特征和转移负荷构建证据矩阵。", "评估跨试验可交换性后再决定能否间接比较。", "优先综合患者重要结局并解释后续治疗影响。"],
  },
  resistance_microenvironment: {
    reviewType: "机制证据范围综述；若表型和结局足够一致，再做分层系统综述。",
    populationAndComparison: "在治疗前、早期应答和进展时获取配对样本，比较持续应答者与原发或继发耐药者。",
    coreOutcomes: ["耐药发生时间", "可重复的分子或免疫特征", "功能验证结果", "可操作的分层策略"],
    organization: ["按耐药表型、采样时间和证据层级建图。", "把探索性发现、独立验证和功能证据分开综合。", "明确哪些结论只有相关性支持，哪些已有机制验证。"],
  },
  toxicity_supportive: {
    reviewType: "安全性与支持治疗系统综述；结局定义过散时先做范围综述。",
    populationAndComparison: "纳入常被试验排除的高龄、合并症和多线治疗人群，与常规支持治疗路径比较。",
    coreOutcomes: ["严重与迟发不良事件", "症状负担", "生活质量", "治疗中断和医疗资源使用"],
    organization: ["统一不良事件与患者报告结局的测量时间。", "分开随机试验、登记和常规数据来源。", "按高风险人群综合迟发事件、治疗中断和资源使用。"],
  },
  survivorship_quality_of_life: {
    reviewType: "患者报告结局与长期随访的系统综述或证据地图。",
    populationAndComparison: "限定治疗阶段和生存期，与常规随访或明确康复方案比较。",
    coreOutcomes: ["生活质量", "功能恢复", "症状轨迹", "复工、复发与长期安全性"],
    organization: ["按治疗阶段、生存期和量表测量域分层。", "比较基线、随访长度和临床意义阈值。", "把失访和幸存者偏倚作为解释主轴。"],
  },
  ai_digital: {
    reviewType: "诊断或预测模型系统综述，并按开发、验证和临床影响分层。",
    populationAndComparison: "固定算法版本、输入数据和使用场景，与临床人员或现有模型比较。",
    coreOutcomes: ["判别与校准", "跨中心泛化", "临床决策影响", "公平性、失败模式与资源消耗"],
    organization: ["按算法用途和验证层级分开建表。", "统一提取判别、校准、外部验证和偏倚风险。", "把公平性、数据漂移和临床影响与模型性能分开综合。"],
  },
  prevention_epidemiology: {
    reviewType: "病因或预防问题系统综述；暴露与结局过散时先做证据地图。",
    populationAndComparison: "明确暴露窗口、基线风险和对照地区/人群，控制关键混杂因素。",
    coreOutcomes: ["发病与死亡", "绝对风险差", "暴露—反应关系", "公平性与可及性"],
    organization: ["预先定义暴露测量、时间窗和混杂因素。", "按研究设计与偏倚风险分层综合。", "同时报告相对效应、绝对效应和不同基线风险人群。"],
  },
});

const GAP_REVIEW_STEPS = Object.freeze({
  limited_evidence: ["先用窄检索区分‘原始研究少’与‘现有综述漏检’，并把未知文献量保留为待验证。"],
  low_certainty: ["按 GRADE 或适配框架梳理降级原因，不把论文数量等同于证据确定性。"],
  heterogeneity: ["预设人群、干预或暴露、结局和研究设计分层，只有同质性成立时才合并。"],
  inconsistent_results: ["先复核定义、测量和偏倚差异，再决定亚组综合或叙述综合。"],
  prospective_trials_needed: ["把研究设计缺口编码为证据地图的一部分，不代替原始研究可行性评估。"],
  standardization_needed: ["比较现有定义和核心结局集，提出可审计的最小统一框架。"],
  long_term_unknown: ["按随访长度、失访风险和竞争事件分层综合长期结局。"],
  subgroup_biomarker_unknown: ["区分预后与预测问题，并评价亚组交互和外部验证证据。"],
  safety_unknown: ["同步提取疗效与伤害，比较主动与被动安全监测造成的差异。"],
  implementation_gap: ["把可及性、采纳、持续性和成本作为独立综合维度。"],
  resistance_gap: ["按耐药定义、采样时点和证据层级组织机制证据。"],
});

const REVIEW_PROPOSAL_TEMPLATES = Object.freeze({
  early_onset: {
    title: "早发胃癌的定义与年龄界值：地区差异、筛查路径与临床管理的范围综述",
    outline: ["术语、年龄界值与病例定义", "地区、族群与风险因素", "筛查、诊断与分子病理特征", "治疗路径、复发与长期结局"],
    difficulty: "中等",
  },
  generic_diagnosis_measurement: {
    title: "识别与测量工具的可比性：定义、阈值、验证层级与临床用途的系统综述",
    outline: ["目标用途与适用人群", "工具、参考标准与阈值", "开发、内部验证与外部验证", "可解释性、可实施性与患者重要结局"],
    difficulty: "中等",
  },
  generic_intervention_management: {
    title: "干预路径的比较效果：人群边界、实施强度与患者重要结局的系统综述",
    outline: ["人群与干预构成", "比较条件与实施强度", "疗效、伤害与患者报告结局", "异质性、适用性与证据确定性"],
    difficulty: "中等",
  },
  generic_risk_prognosis: {
    title: "风险与预后分层：预测因子、模型验证与临床净获益的系统综述",
    outline: ["预测用途与目标人群", "候选因子与模型构建", "校准、判别与外部验证", "偏倚风险与临床净获益"],
    difficulty: "中高",
  },
  generic_mechanism_pathway: {
    title: "机制证据从关联到验证：作用路径、证据层级与可干预节点的范围综述",
    outline: ["机制概念与表型定义", "观察性关联与时间顺序", "独立复现与功能验证", "可干预节点与证据边界"],
    difficulty: "中高",
  },
  generic_outcomes_recovery: {
    title: "患者重要结局与恢复轨迹：测量时间、最小重要差异与长期随访综述",
    outline: ["人群、基线与恢复阶段", "结局工具和测量时间", "变化轨迹与临床意义阈值", "失访、适用性与实施条件"],
    difficulty: "中等",
  },
  generic_digital_methods: {
    title: "数字方法从性能到实施：外部验证、校准、公平性与临床影响综述",
    outline: ["模型用途、输入与目标结局", "开发、内部验证与外部验证", "性能、校准与临床影响", "公平性、漂移与实施门槛"],
    difficulty: "中高",
  },
  generic_implementation_equity: {
    title: "证据到实践的转化：采纳、可及性、公平性与持续实施的范围综述",
    outline: ["干预与实施场景", "采纳、覆盖与持续性", "可及性、公平性与成本", "情境机制与可转移性"],
    difficulty: "中等",
  },
  early_detection_screening: {
    title: "高风险人群的早筛与早诊：风险分层、检测阈值与实施证据的系统综述",
    outline: ["目标人群与基线风险", "检测路径、阈值与参考标准", "诊断表现与患者重要结局", "可及性、伤害与实施条件"],
    difficulty: "中等",
  },
  biomarkers_molecular: {
    title: "从生物标志物发现到临床决策：检测标准化、外部验证与临床净获益",
    outline: ["标志物用途与检测平台", "阈值、采样时间和人群差异", "开发队列与独立外部验证", "预测价值、临床净获益与实施门槛"],
    difficulty: "中高",
  },
  targeted_therapy: {
    title: "靶向治疗的获益与耐药：分子亚组、治疗线次和长期结局的系统综述",
    outline: ["分子亚组与检测条件", "治疗线次和比较方案", "疗效、安全性与患者报告结局", "原发和继发耐药路径"],
    difficulty: "中高",
  },
  systemic_treatment: {
    title: "系统治疗的证据演变：患者分层、治疗序列与患者重要结局的系统综述",
    outline: ["疾病阶段与治疗目标", "系统治疗与联合路径", "患者分层和治疗序列", "长期结局、安全性与证据确定性"],
    difficulty: "中高",
  },
  immunotherapy: {
    title: "免疫治疗的获益—风险分层：预测标志物、耐药与患者重要结局",
    outline: ["治疗场景与患者分层", "预测与预后标志物", "持久应答、毒性和生活质量", "耐药、治疗序列与证据确定性"],
    difficulty: "中高",
  },
  perioperative_treatment: {
    title: "围手术期治疗完成度与长期结局：人群分层和核心结局标准化综述",
    outline: ["可切除性与治疗路径", "方案完成度和手术影响", "短期安全性与长期肿瘤结局", "分层因素与核心结局建议"],
    difficulty: "中等",
  },
  local_treatment: {
    title: "局部治疗路径的东西方适用性：患者选择、治疗序列与长期结局的系统综述",
    outline: ["地区人群、分期与可切除性", "手术范围与围手术期治疗序列", "短期安全性、复发与长期生存", "跨地区可比性与外推边界"],
    difficulty: "中等",
  },
  advanced_metastatic: {
    title: "晚期与转移性疾病的治疗序列和患者选择：面向临床决策的系统综述",
    outline: ["疾病负荷与治疗线次", "全身和局部治疗组合", "患者选择与关键亚组", "生存、症状、生活质量与治疗负担"],
    difficulty: "中高",
  },
  resistance_microenvironment: {
    title: "治疗应答与耐药机制：配对证据、独立验证与可干预靶点",
    outline: ["耐药表型与采样时间", "治疗前后配对证据", "发现队列与独立验证", "功能证据和可干预靶点"],
    difficulty: "高",
  },
  toxicity_supportive: {
    title: "支持治疗与安全性：患者报告结局和真实世界证据的系统综述",
    outline: ["治疗暴露与支持路径", "安全性和症状测量", "患者报告结局与治疗中断", "高风险人群和真实世界实施"],
    difficulty: "中等",
  },
  survivorship_quality_of_life: {
    title: "长期生存与功能恢复：症状轨迹、生活质量和随访干预综述",
    outline: ["生存阶段与基线状态", "症状和功能测量", "康复与随访干预", "失访、幸存者偏倚和临床意义阈值"],
    difficulty: "中等",
  },
  ai_digital: {
    title: "人工智能从模型性能到临床实施：外部验证、校准、公平性与临床净获益",
    outline: ["算法用途、输入和目标结局", "开发、内部验证与外部验证", "判别、校准和决策曲线", "公平性、数据漂移和临床影响"],
    difficulty: "中高",
  },
  prevention_epidemiology: {
    title: "高风险人群的精准预防：暴露、风险分层和公平性的证据综述",
    outline: ["人群与暴露窗口", "相对风险和绝对风险", "筛查或预防路径", "地区差异、公平性和可及性"],
    difficulty: "中等",
  },
});

const GENERIC_ONCOLOGY_REVIEW_OVERRIDES = Object.freeze({
  early_onset: Object.freeze({
    template: Object.freeze({
      title: "早发与青年发病病例的定义及年龄界值：地区差异、风险路径与临床管理的范围综述",
      outline: ["术语、年龄界值与病例定义", "地区、族群与风险因素", "诊断与分子病理特征", "治疗路径、复发与长期结局"],
      difficulty: "中等",
    }),
    route: Object.freeze({
      reviewType: "定义与人群差异导向的范围综述；若年龄界值与结局可统一，再升级为系统综述。",
      populationAndComparison: "比较目标肿瘤在不同年龄界值、地区与基线风险下的早发病例，并区分风险、诊断、病理特征、治疗路径和长期结局。",
      coreOutcomes: ["年龄界值与病例定义", "地区与人群差异", "诊断路径", "治疗、复发与长期生存"],
      organization: ["先绘制 early-onset/young-onset 的年龄界值与病例定义。", "按地区、族群与研究场景比较风险和诊断路径。", "分开综合病理分子特征、治疗路径与长期结局，避免用病例比例替代风险。"],
    }),
  }),
  local_treatment: Object.freeze({
    template: Object.freeze({
      title: "局部治疗路径的地区适用性：患者选择、治疗序列与长期结局的系统综述",
      outline: ["地区人群、分期与可治疗性", "局部治疗范围与全身治疗序列", "短期安全性、复发与长期生存", "跨地区可比性与外推边界"],
      difficulty: "中等",
    }),
    route: Object.freeze({
      reviewType: "围绕地区适用性与治疗序列的系统综述；跨方案可比性不足时采用结构化叙述综合。",
      populationAndComparison: "限定目标肿瘤的分期、局部治疗范围、全身治疗序列与地区实践背景，比较不同地区证据的患者选择、治疗序列和适用边界。",
      coreOutcomes: ["长期生存与复发", "局部与全身治疗完成度", "程序相关并发症", "地区外部适用性"],
      organization: ["按地区人群、分期与治疗路径建立可比性矩阵。", "比较治疗序列、患者选择与后续治疗差异。", "把短期程序结局与长期生存分开，并明确哪些结论不能跨地区外推。"],
    }),
  }),
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

function contextualRuleExcerpt(record, rule, limit = 220) {
  const sentence = gapSentence(record, [{ pattern: rule.auditPattern ?? rule.pattern }]);
  const clean = text(sentence).replace(/\s+/g, " ");
  if (!clean || clean.length <= limit) return clean;
  const matchIndex = clean.search(rule.auditPattern ?? rule.pattern);
  if (matchIndex < 0) return excerpt(clean, limit);
  const start = Math.max(0, matchIndex - Math.floor(limit * 0.35));
  const end = Math.min(clean.length, start + limit);
  return `${start > 0 ? "…" : ""}${clean.slice(start, end).trim()}${end < clean.length ? "…" : ""}`;
}

function matchingRules(record, rules) {
  const value = searchableText(record);
  return rules.filter((rule) => rule.pattern.test(value));
}

function matchingRuleAudits(record, rules, { includeAbstract = true } = {}) {
  const searchable = searchableText(record);
  const fields = [
    { field: "title", value: text(record?.title) },
    ...(includeAbstract ? [{ field: "abstract", value: text(record?.abstract) }] : []),
  ];
  return rules.flatMap((rule) => {
    // `auditPattern` is deliberately narrower than some contextual rules so the
    // user sees the exact phrase that supports a classification.  It must never
    // become an independent classifier: broad phrases such as "external
    // validation" are only evidence for the AI rule when the full rule also
    // established the required AI context.
    if (!rule.pattern.test(searchable)) return [];
    const matches = fields.flatMap(({ field, value }) => {
      if (!value) return [];
      const matched = value.match(rule.auditPattern ?? rule.pattern)?.[0];
      return matched ? [{ field, term: matched }] : [];
    });
    return matches.length > 0
      ? [{ id: rule.id, label: rule.label, matches }]
      : [];
  });
}

function themeEvidenceFields(record) {
  const objective = reportedSentence(record, OBJECTIVE_CUE);
  const conclusion = reportedSentence(record, CONCLUSION_CUE);
  return [
    { field: "title", value: text(record?.title) },
    ...(objective ? [{ field: "objective", value: objective }] : []),
    ...(conclusion && conclusion !== objective ? [{ field: "conclusion", value: conclusion }] : []),
  ];
}

function themeRuleMatches(record, rule) {
  return themeEvidenceFields(record).some(({ value }) => rule.pattern.test(value));
}

function matchingThemeRules(record, themeRules) {
  return themeRules.filter((rule) => themeRuleMatches(record, rule));
}

function matchingThemeRuleAudits(record, themeRules) {
  return themeRules.flatMap((rule) => {
    const matches = themeEvidenceFields(record).flatMap(({ field, value }) => {
      const matched = value.match(rule.pattern)?.[0];
      return matched ? [{ field, term: matched }] : [];
    });
    return matches.length > 0
      ? [{ id: rule.id, label: rule.label, matches }]
      : [];
  });
}

function evidenceIds(records) {
  return unique(records.map(sourceIdFor));
}

function representativeEvidenceIds(sourceIds) {
  return unique(sourceIds).slice(0, MAX_EVIDENCE_IDS);
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
  if (recentCount >= 2 && earlierCount === 0) return { id: "recent_only", label: "近两年新编码为题名或核心摘要主轴" };
  if (recentCount === 0 && earlierCount > 0) return { id: "earlier_only", label: "仅较早样本编码为核心主轴；近期未形成主轴信号" };
  if (recentCount > 0 && earlierCount > 0 && recentRate >= 0.2 && earlierRate >= 0.2) {
    return { id: "persistent", label: "近五年持续编码为题名或核心摘要主轴" };
  }
  if (recentCount >= 2 && change >= 0.15) return { id: "rising_signal", label: "近两年核心主轴编码占比上升" };
  if (earlierCount >= 2 && change <= -0.15) return { id: "earlier_signal", label: "较早样本更常编码为核心主轴" };
  return { id: "stable_signal", label: "题名或核心摘要主轴编码持续出现" };
}

function mainThemeForGap(records, gapRule, themes) {
  const gapRecords = records.filter((record) => gapRule.pattern.test(searchableText(record)));
  const scored = themes
    .map((theme) => ({
      theme,
      count: gapRecords.filter((record) => themeRuleMatches(record, theme)).length,
    }))
    .sort((left, right) => right.count - left.count);
  return scored[0]?.count > 0 ? scored[0].theme : null;
}

function candidateQuestion(gap, theme) {
  const subject = theme?.label ?? "当前核心方向";
  if (["heterogeneity", "inconsistent_results", "standardization_needed"].includes(gap.id)) {
    return `围绕“${subject}”，现有综述中的研究对象、干预/暴露、比较条件与核心结局如何定义；能否用预设分层解释结论差异？`;
  }
  if (["limited_evidence", "low_certainty", "prospective_trials_needed"].includes(gap.id)) {
    return `围绕“${subject}”，现有原始研究的数量、设计与证据确定性如何；哪一种综述框架能够在不夸大结论的前提下明确证据边界？`;
  }
  if (gap.id === "long_term_unknown") {
    return `“${subject}”的长期获益、迟发风险和患者报告结局在延长随访后是否仍然成立？`;
  }
  if (gap.id === "subgroup_biomarker_unknown") {
    return `在“${subject}”的既有证据中，哪些人群特征或生物标志物被用于获益—风险分层，其预测证据经过了哪些验证？`;
  }
  if (gap.id === "safety_unknown") {
    return `“${subject}”在不同人群中的获益—风险证据如何分布，既有研究遗漏或低估了哪些重要不良结局？`;
  }
  if (gap.id === "implementation_gap") {
    return `“${subject}”从试验走向真实世界时，哪些可及性、成本或实施条件决定实际效果？`;
  }
  if (gap.id === "resistance_gap") {
    return `“${subject}”中早期应答与继发耐药的机制证据处于发现、独立验证还是功能验证阶段；哪些结论仍只有相关性支持？`;
  }
  return `围绕“${subject}”，如何针对“${gap.label}”形成一个可验证、边界清楚的下一轮研究问题？`;
}

function directionReportForCandidate(candidate, index, themes, gaps, temporalSignals) {
  const theme = themes.find((item) => item.id === candidate.themeId) ?? null;
  const gap = gaps.find((item) => item.id === candidate.gapId) ?? null;
  const temporal = temporalSignals.find((item) => item.id === candidate.themeId) ?? null;
  const route = THEME_REVIEW_ROUTES[candidate.themeId] ?? DEFAULT_REVIEW_ROUTE;
  const gapStep = GAP_REVIEW_STEPS[candidate.gapId];
  const executionSteps = unique([
    ...(gapStep ? [gapStep] : []),
    ...route.organization,
    "正式立题前窄检索近两年同题综述，并以 50–100 篇候选发现目标估算工作量；最终纳入量由预设标准决定。",
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
    whySuitable: `${theme ? `当前分层样本有 ${theme.count} 篇综述涉及该主题，提示存在同题竞争；` : ""}${temporalReason}${gap ? `${candidate.sourceIds.length} 篇关联摘要出现“${gap.label}”信号，可作为评价轴候选。` : candidate.basis} 是否构成可发表增量尚未通过同题综述窄检索证实。`,
    recommendedQuestion: candidate.question,
    studyPlan: {
      studyDesign: route.reviewType,
      populationAndComparison: route.populationAndComparison,
      coreOutcomes: route.coreOutcomes,
      executionSteps,
      decisionGate: "下一轮窄检索须排除高质量同题综述，并以 50–100 篇候选发现目标核定工作量；最终纳入量由预设标准决定。只有范围可在目标周期内执行时才冻结方案。",
    },
    sourceIds: candidate.sourceIds,
    representativeSourceIds: representativeEvidenceIds(candidate.sourceIds),
    boundary: "这是依据当前综述题名摘要形成的综述选题假设，不是研究空白、创新性或可发表性定论。",
  };
}

function linkedGapForTheme(theme, gapClusters) {
  const themeIds = new Set(theme?.sourceIds ?? []);
  return gapClusters
    .map((gap) => ({
      gap,
      linkedSourceIds: gap.sourceIds.filter((sourceId) => themeIds.has(sourceId)),
    }))
    .filter((item) => item.linkedSourceIds.length > 0)
    .sort((left, right) => right.linkedSourceIds.length - left.linkedSourceIds.length)[0] ?? null;
}

function linkedProblemForTheme(theme, problemClusters) {
  const themeIds = new Set(theme?.sourceIds ?? []);
  return problemClusters
    .map((problem) => ({
      problem,
      linkedSourceIds: problem.sourceIds.filter((sourceId) => themeIds.has(sourceId)),
    }))
    .filter((item) => item.linkedSourceIds.length > 0)
    .sort((left, right) => right.linkedSourceIds.length - left.linkedSourceIds.length)[0] ?? null;
}

function linkedSupportingEvidence(cluster, sourceIds) {
  const allowed = new Set(sourceIds);
  const evidence = cluster?.evidenceExcerpts?.find((item) => allowed.has(item.sourceId));
  return evidence
    ? { sourceId: evidence.sourceId, field: "abstract", excerpt: evidence.text }
    : null;
}

function reviewProposalForTheme(
  theme,
  index,
  gapClusters,
  problemClusters,
  temporalSignals,
  totalCount,
  subjectLabel,
  taxonomyProfile,
) {
  const oncologyOverride = taxonomyProfile === "oncology_generic_v1"
    ? GENERIC_ONCOLOGY_REVIEW_OVERRIDES[theme.id]
    : null;
  const template = oncologyOverride?.template ?? REVIEW_PROPOSAL_TEMPLATES[theme.id] ?? {
    title: `${theme.label}：证据边界、方法异质性与可验证研究路径`,
    outline: ["问题与人群边界", "方法和比较条件", "关键结局与证据确定性", "实施条件和下一步研究"],
    difficulty: "中等",
  };
  const linked = linkedGapForTheme(theme, gapClusters);
  const linkedProblem = linkedProblemForTheme(theme, problemClusters);
  const temporal = temporalSignals.find((item) => item.id === theme.id) ?? null;
  const reviewRoute = oncologyOverride?.route ?? THEME_REVIEW_ROUTES[theme.id] ?? DEFAULT_REVIEW_ROUTE;
  const gapText = linked
    ? `其中 ${linked.linkedSourceIds.length} 篇同时出现“${linked.gap.label}”摘要信号。`
    : linkedProblem
      ? `其中 ${linkedProblem.linkedSourceIds.length} 篇出现“${linkedProblem.problem.label}”的领域问题信号；这不是证据数量不足的同义词。`
      : "当前摘要未形成可稳定归类的问题或证据缺口信号，因此不能直接宣布该方向存在研究空白。";
  const temporalText = temporal ? `主题轨迹为“${temporal.direction.label}”。` : "当前样本尚不足以判断时间变化。";
  const sourceIds = unique([
    ...(linked?.linkedSourceIds ?? []),
    ...(linkedProblem?.linkedSourceIds ?? []),
    ...theme.sourceIds,
  ]);
  const coverageShare = theme.count / Math.max(totalCount, 1);
  const sampleCoverageSignal = coverageShare >= 0.25 ? "higher" : coverageShare >= 0.1 ? "moderate" : "lower";
  const emerging = ["recent_only", "rising_signal"].includes(temporal?.direction?.id);
  const portfolioRole = emerging
    ? "emerging_signal"
    : sampleCoverageSignal === "higher"
      ? "sample_high_coverage_reframing"
      : "low_coverage_exploratory";
  const incrementalValue = linked
    ? `可验证的增量假设是把“${linked.gap.label}”转化为预设评价轴，并核对既有综述是否已完成同样分层。`
    : linkedProblem
      ? `可验证的增量假设是围绕“${linkedProblem.problem.label}”重构提取与比较框架，而不是再次做宽泛进展综述。`
      : `可验证的增量假设是围绕“${theme.label}”建立更窄的人群、比较和结局矩阵；当前仅为探索性候选。`;
  const titlePrefix = text(subjectLabel);
  const suggestedTitle = titlePrefix && !template.title.includes(titlePrefix)
    ? `${titlePrefix}：${template.title}`
    : template.title;
  const problemSupportingEvidence = linkedProblem
    ? linkedSupportingEvidence(linkedProblem.problem, linkedProblem.linkedSourceIds)
    : linked
      ? linkedSupportingEvidence(linked.gap, linked.linkedSourceIds)
      : null;
  return {
    id: `review_proposal_${theme.id}`,
    rank: index + 1,
    priority: portfolioRole === "emerging_signal"
      ? "优先核查近年信号"
      : portfolioRole === "sample_high_coverage_reframing"
        ? "样本高覆盖重构"
        : "探索性备选",
    portfolioRole,
    themeId: theme.id,
    theme: theme.label,
    taxonomyProfile,
    subjectLabel: titlePrefix || null,
    suggestedTitle,
    existingCoverage: {
      count: theme.count,
      total: totalCount,
      competitionStatus: "unverified_pending_same_topic_review_search",
      sampleCoverageSignal,
      interpretation: `当前分层样本覆盖 ${theme.count}/${totalCount}，属于样本内${sampleCoverageSignal === "higher" ? "较高" : sampleCoverageSignal === "moderate" ? "中等" : "较低"}覆盖信号；首轮不能据此给出竞争风险等级，必须在第二轮定位并逐篇比较同题综述。`,
    },
    incrementalValueHypothesis: incrementalValue,
    problemBasis: linkedProblem
      ? {
          id: linkedProblem.problem.id,
          category: linkedProblem.problem.category,
          label: linkedProblem.problem.label,
          sourceIds: linkedProblem.linkedSourceIds,
          supportingEvidence: problemSupportingEvidence,
          representativeExcerpt: problemSupportingEvidence?.excerpt ?? null,
        }
      : linked
        ? {
            id: linked.gap.id,
            category: "evidence_design_or_certainty",
            label: linked.gap.label,
            sourceIds: linked.linkedSourceIds,
            supportingEvidence: problemSupportingEvidence,
            representativeExcerpt: problemSupportingEvidence?.excerpt ?? null,
          }
        : null,
    whyNotFullyReviewed: linkedProblem
      ? `待核假设：既有综述可能尚未以“${linkedProblem.problem.label}”为主轴，同时比较本题的人群边界、定义和结局；必须经同题综述窄检索逐篇比较后才能保留。`
      : `待核假设：既有综述可能尚未同时采用“${theme.label}”的本题人群边界、评价轴与结局框架；必须经同题综述窄检索逐篇比较后才能保留。`,
    noveltyStatus: "unverified_pending_same_topic_review_search",
    whyPotentiallyValuable: `${temporalText}${gapText} ${incrementalValue} 未完成同题综述窄检索前，创新度与可发表性均为未知。`,
    outline: template.outline,
    reviewPlan: {
      reviewType: reviewRoute.reviewType,
      populationAndComparison: reviewRoute.populationAndComparison,
      coreOutcomes: reviewRoute.coreOutcomes,
      organization: reviewRoute.organization,
    },
    workload: {
      targetCoreLiterature: "候选发现与工作量估算目标 50–100 篇；最终纳入量由预设标准决定",
      timeline: "10–12 周目标周期（须经窄检索与团队资源核定，不构成完成承诺）",
      difficulty: template.difficulty,
      plan: ["第 1–2 周冻结问题、方案和检索式", "第 3–6 周筛选并提取证据", "第 7–9 周完成综合与图表", "第 10–12 周写作、核查和修订"],
    },
    discardConditions: [
      "近两年已有范围、评价轴与结局框架高度重合的高质量综述，且没有可说明的更新价值。",
      "以 50–100 篇作为候选发现与工作量估算目标后，仍无法通过调整综述类型或范围形成兼顾深度与周期的可执行文献集；最终纳入量始终由预设标准决定，不以该目标作硬阈值。",
      "关键人群、比较条件或结局定义无法形成可复核的纳入排除标准。",
    ],
    sourceIds,
    representativeSourceIds: representativeEvidenceIds(sourceIds),
    verificationGate: "正式选题前必须进入下一轮窄检索，核对近两年同题综述、可获得的原始研究数量和全文方法，确认不与已有高质量综述重复。",
  };
}

function selectReviewProposalPortfolio(proposals, maximum = 5) {
  const selected = [];
  const selectedIds = new Set();
  const take = (proposal) => {
    if (!proposal || selectedIds.has(proposal.id) || selected.length >= maximum) return;
    selected.push(proposal);
    selectedIds.add(proposal.id);
  };
  if (proposals.some((proposal) => proposal.taxonomyProfile === "gastric_oncology_v1")) {
    for (const themeId of ["biomarkers_molecular", "immunotherapy", "early_onset", "local_treatment", "ai_digital"]) {
      take(proposals.find((proposal) => proposal.themeId === themeId));
    }
    proposals.forEach(take);
    return selected.slice(0, maximum).map((proposal, index) => ({
      ...proposal,
      rank: index + 1,
    }));
  }
  for (const role of ["sample_high_coverage_reframing", "emerging_signal", "low_coverage_exploratory"]) {
    take(proposals.find((proposal) => proposal.portfolioRole === role));
  }
  take(proposals.find((proposal) => proposal.themeId === "early_onset"));
  take(proposals.find((proposal) => proposal.themeId === "local_treatment"));
  take(proposals.find((proposal) => proposal.themeId === "ai_digital"));
  proposals.forEach(take);
  return selected.slice(0, maximum).map((proposal, index) => ({
    ...proposal,
    rank: index + 1,
  }));
}

function buildProfessorReport({
  normalized,
  abstractRecords,
  reviewWindow,
  observedYears,
  themeCoverage,
  temporalSignals,
  methodSignals,
  methodVisibility,
  gapClusters,
  problemClusters,
  subjectLabel,
  taxonomyProfile,
}) {
  const metaAnalysis = methodSignals.find((item) => item.id === "meta_analysis") ?? null;
  const systematicReview = methodSignals.find((item) => item.id === "systematic_review") ?? null;
  const topThemes = themeCoverage.slice(0, 5);
  const proposals = selectReviewProposalPortfolio(
    themeCoverage
      .map((theme, index) => reviewProposalForTheme(
        theme,
        index,
        gapClusters,
        problemClusters,
        temporalSignals,
        normalized.length,
        subjectLabel,
        taxonomyProfile,
      ))
      .filter((proposal) => proposal.sourceIds.length > 0),
    5,
  );
  const leadingTemporal = temporalSignals.slice(0, 4);
  const evidenceSourceIds = unique(normalized.map(sourceIdFor));
  const periodLabel = reviewWindow?.from && reviewWindow?.to
    ? `${reviewWindow.from}—${reviewWindow.to}`
    : observedYears.from && observedYears.to
      ? `${observedYears.from}—${observedYears.to}`
      : "当前检索窗口";
  const topThemeText = topThemes.length
    ? topThemes.map((item) => `${item.label}（${item.count}/${normalized.length}）`).join("、")
    : "尚未形成稳定主题聚类";
  const mainGap = gapClusters[0] ?? null;
  const mainProblem = problemClusters[0] ?? null;
  const leadingProblems = mainProblem
    ? problemClusters.filter((problem) => problem.count === mainProblem.count)
    : [];
  const leadingGaps = mainGap
    ? gapClusters.filter((gap) => gap.count === mainGap.count)
    : [];
  const problemSummary = leadingProblems.length > 1
    ? `当前样本中并列出现的代表性领域问题包括${leadingProblems.slice(0, 4).map((item) => `“${item.label}”`).join("、")}（均 ${mainProblem.count} 篇）；并列计数不构成科研优先级。`
    : mainProblem
      ? `当前样本中计数较高的领域问题信号为“${mainProblem.label}”（${mainProblem.count} 篇）；它仍不是科研优先级或研究空白定论。`
      : leadingGaps.length > 1
        ? `当前样本中并列出现的代表性证据问题包括${leadingGaps.slice(0, 4).map((item) => `“${item.label}”`).join("、")}（均 ${mainGap.count} 篇）；并列计数不构成科研优先级。`
        : mainGap
          ? `当前样本中计数较高的证据问题信号为“${mainGap.label}”（${mainGap.count} 篇）；它仍不是研究空白定论。`
          : "摘要未形成可稳定聚类的问题信号。";

  return {
    schemaVersion: "research-professor-report/v1",
    title: "领域发展现状、主要问题与综述选题报告",
    periodLabel,
    analysisLevel: "题名与摘要级",
    executiveSummary: `本轮分析 ${normalized.length} 篇近五年综述，其中 ${abstractRecords.length} 篇有摘要。当前样本题名或核心摘要主轴主要编码为${topThemeText}。${metaAnalysis ? `${metaAnalysis.count} 篇摘要明确属于 Meta 分析；` : ""}${problemSummary} 下一步应围绕具体决策与评价轴做窄检索，而不是从宽泛领域描述直接宣布创新点。`,
    majorProblemOrderingBoundary: "主要问题按摘要命中计数与预设规则顺序稳定展示，仅供代表性阅读；同计数项目没有科研优先级、严重性或创新性排序含义。",
    developmentStatus: [
      {
        id: "topic_structure",
        title: "主题结构",
        conclusion: `当前样本题名或核心摘要主轴主要编码为${topThemeText}；一个摘要可以进入多个主题，因此这些数字表示主轴覆盖度，不是互斥分类，也不是全文提及计数。`,
        sourceIds: unique(topThemes.flatMap((item) => item.sourceIds)),
        representativeSourceIds: representativeEvidenceIds(topThemes.flatMap((item) => item.sourceIds)),
      },
      {
        id: "review_maturity",
        title: "当前样本的综述类型",
        conclusion: `${metaAnalysis?.count ?? 0} 篇摘要明确报告 Meta 分析，${systematicReview?.count ?? 0} 篇明确报告系统综述设计。这些计数只描述当前分层样本，不能据此判断领域成熟度、同题重复程度或效应汇总是否充分。`,
        sourceIds: unique([...(metaAnalysis?.sourceIds ?? []), ...(systematicReview?.sourceIds ?? [])]),
        representativeSourceIds: representativeEvidenceIds([...(metaAnalysis?.sourceIds ?? []), ...(systematicReview?.sourceIds ?? [])]),
      },
      {
        id: "method_visibility",
        title: "方法报告",
        conclusion: `${methodVisibility.moreCompleteCount}/${abstractRecords.length} 篇摘要的方法报告信号较完整，${methodVisibility.partialCount} 篇部分可见，${methodVisibility.notReportedCount} 篇摘要未充分报告。摘要未报告不能写成没有实施。`,
        sourceIds: unique(methodSignals.slice(0, 3).flatMap((item) => item.sourceIds)),
        representativeSourceIds: representativeEvidenceIds(methodSignals.slice(0, 3).flatMap((item) => item.sourceIds)),
      },
    ],
    trendInsights: leadingTemporal.length
      ? leadingTemporal.map((item) => ({
          id: `trend_${item.id}`,
          title: item.label,
          conclusion: `${item.direction.label}：近两年主轴编码 ${item.recentCount}/${item.recentTotal}，较早样本 ${item.earlierCount}/${item.earlierTotal}。这是题名或核心目的/结论字段的主轴信号，不是全文提及计数或全领域发文量。`,
          sourceIds: item.sourceIds,
          representativeSourceIds: representativeEvidenceIds(item.sourceIds),
        }))
      : [{
          id: "trend_insufficient",
          title: "时间趋势暂不成立",
          conclusion: "当前样本没有形成足以报告的近两年变化信号；这不等于领域没有变化。",
          sourceIds: [],
        }],
    majorProblems: problemClusters.map((problem) => ({
        id: `domain_problem_${problem.id}`,
        category: problem.category,
        title: problem.label,
        conclusion: `${problem.count} 篇可用摘要明确出现这一领域问题信号；它不自动等于证据数量或质量不足。${problem.evidenceExcerpts[0]?.text ? `代表性摘要表述：${problem.evidenceExcerpts[0].text}` : "摘要未提供可安全截取的代表性表述。"}`,
        directObservation: `${problem.count} 篇可用摘要命中“${problem.label}”的预设问题规则。`,
        interpretation: "该计数是摘要直接问题信号；是否构成综述增量价值仍属于待窄检索验证的推断。",
        displayRole: "representative_problem_not_priority_rank",
        supportingEvidence: problem.evidenceExcerpts.map((item) => ({
          sourceId: item.sourceId,
          field: "abstract",
          excerpt: item.text,
          claimRole: "directly_reported_domain_problem_signal",
        })),
        sourceIds: problem.sourceIds,
        representativeSourceIds: representativeEvidenceIds(problem.sourceIds),
      })),
    evidenceProblems: gapClusters.map((gap) => ({
        id: `evidence_problem_${gap.id}`,
        category: "evidence_design_or_certainty",
        title: gap.label,
        conclusion: `${gap.count} 篇可用摘要明确出现这一证据问题信号。${gap.evidenceExcerpts[0]?.text ? `代表性摘要表述：${gap.evidenceExcerpts[0].text}` : "摘要未提供可安全截取的代表性表述。"}`,
        directObservation: `${gap.count} 篇可用摘要命中“${gap.label}”的预设证据缺口规则。`,
        interpretation: "该计数只说明摘要报告了证据设计或确定性问题，不等于已经证明研究空白。",
        supportingEvidence: gap.evidenceExcerpts.map((item) => ({
          sourceId: item.sourceId,
          field: "abstract",
          excerpt: item.text,
          claimRole: "directly_reported_evidence_gap_signal",
        })),
        sourceIds: gap.sourceIds,
        representativeSourceIds: representativeEvidenceIds(gap.sourceIds),
      })),
    newcomerGuide: [
      { id: "decision_first", title: "先选决策问题，再选技术名词", advice: "把主题收窄为明确的人群、干预或暴露、比较条件和核心结局；宽泛的“研究进展”通常难以形成新价值。" },
      { id: "review_type", title: "让综述类型服从问题", advice: "定义和证据地图适合范围综述；窄疗效问题适合系统综述或 Meta 分析；已有大量综述时先考虑伞状综述或重叠度分析。" },
      { id: "evidence_quality", title: "不要用影响因子代替证据评价", advice: "期刊指标只能作为来源元数据。研究设计、偏倚风险、适用性和证据确定性才决定一篇论文能支持多强的结论。" },
      { id: "unknowns", title: "把未知保留下来", advice: "摘要没有报告的方法、样本量、数值或阴性结果必须记为未知，不能补写，也不能写成没有实施。" },
      { id: "protocol", title: "短周期项目也要预注册和留痕", advice: "先冻结问题、纳排标准、检索式、提取表和偏倚评价工具，再开始正式筛选；所有改动保留版本和理由。" },
    ],
    selectionPatterns: [
      {
        id: "narrow_decision",
        title: "更有价值的题目围绕一个可行动的决策点",
        conclusion: "优先选择能够明确比较条件、患者分层、阈值或实施门槛的问题，避免再次覆盖整个领域。",
        sourceIds: unique(topThemes.slice(0, 3).flatMap((item) => item.sourceIds)),
        representativeSourceIds: representativeEvidenceIds(topThemes.slice(0, 3).flatMap((item) => item.sourceIds)),
      },
      {
        id: "incremental_value",
        title: "新意通常来自评价框架，而不只是检索更新",
        conclusion: "标准化定义、外部验证、患者重要结局、真实世界实施、公平性和因果偏倚可作为候选评价轴；是否形成增量价值必须通过同题综述窄检索验证。",
        sourceIds: unique([
          ...problemClusters.slice(0, 4).flatMap((item) => item.sourceIds),
          ...gapClusters.slice(0, 4).flatMap((item) => item.sourceIds),
        ]),
        representativeSourceIds: representativeEvidenceIds([
          ...problemClusters.slice(0, 4).flatMap((item) => item.sourceIds),
          ...gapClusters.slice(0, 4).flatMap((item) => item.sourceIds),
        ]),
      },
    ],
    researcherIdeas: proposals.map((proposal) => ({
      id: `researcher_${proposal.id}`,
      title: proposal.suggestedTitle,
      value: proposal.whyPotentiallyValuable,
      sourceIds: proposal.sourceIds,
      representativeSourceIds: proposal.representativeSourceIds,
    })),
    studentReviewDirections: proposals,
    traceability: {
      analyzedSourceCount: normalized.length,
      abstractAvailableCount: abstractRecords.length,
      titleOnlyCount: normalized.length - abstractRecords.length,
      sourceIds: evidenceSourceIds,
      journalMetricPolicy: "只有来源、指标年份和核验状态完整的授权期刊指标才可显示；影响因子不参与证据质量判定。",
      accessBoundary: "报告、图表和选题建议均来自同一批 PubMed 题名与可用摘要；未访问全文、补充材料、指南、试验注册或其他数据库。",
    },
    boundary: "这是题名摘要级领域扫描与选题报告，不是全量文献计量、全文系统综述、研究空白定论或临床建议。所有推荐方向都必须进入下一轮窄检索，核对同题综述、原始研究数量和全文方法后才能正式立题。",
  };
}

export function analyzeReviewAbstracts(records = [], {
  reviewWindow = null,
  subjectLabel = null,
  taxonomyProfile = "auto",
} = {}) {
  const normalized = (Array.isArray(records) ? records : []).map((record) => ({ ...record }));
  const inferredOncology = normalized.some((record) => (
    /\b(?:cancer|carcinoma|neoplasm|tumou?r|sarcoma|leukemia|lymphoma|melanoma)\b/i
      .test(`${text(record?.title)} ${text(record?.abstract)}`)
  ));
  const inferredGastricOncology = normalized.some((record) => (
    /\b(?:gastric|stomach)\b/i.test(`${text(record?.title)} ${text(record?.abstract)}`)
    && /\b(?:cancer|carcinoma|neoplasm|tumou?r|adenocarcinoma)\b/i
      .test(`${text(record?.title)} ${text(record?.abstract)}`)
  ));
  const activeTaxonomyProfile = taxonomyProfile === "gastric_oncology_v1"
    ? "gastric_oncology_v1"
    : ["oncology_generic_v1", "oncology_v1"].includes(taxonomyProfile)
      ? "oncology_generic_v1"
      : taxonomyProfile === "auto" && inferredGastricOncology
        ? "gastric_oncology_v1"
        : taxonomyProfile === "auto" && inferredOncology
          ? "oncology_generic_v1"
          : "generic_safe_v1";
  const themeRules = ["gastric_oncology_v1", "oncology_generic_v1"].includes(activeTaxonomyProfile)
    ? THEME_RULES
    : GENERIC_THEME_RULES;
  const problemRules = activeTaxonomyProfile === "gastric_oncology_v1"
    ? DOMAIN_PROBLEM_RULES
    : GENERIC_DOMAIN_PROBLEM_RULES;
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

  const themeCoverage = themeRules
    .map((theme) => {
      const matched = normalized.filter((record) => themeRuleMatches(record, theme));
      return {
        id: theme.id,
        label: theme.label,
        count: matched.length,
        share: percentage(matched.length, normalized.length),
        years: unique(matched.map((record) => reviewYear(record)?.toString())).sort().reverse(),
        sourceIds: evidenceIds(matched),
        representativeSourceIds: representativeEvidenceIds(evidenceIds(matched)),
        exampleTitles: matched.map((record) => text(record?.title)).filter(Boolean).slice(0, 2),
      };
    })
    .filter((theme) => theme.count > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  const classifiedThemeSourceIds = new Set(themeCoverage.flatMap((theme) => theme.sourceIds));
  const unclassifiedThemeSourceIds = evidenceIds(
    normalized.filter((record) => !classifiedThemeSourceIds.has(sourceIdFor(record))),
  );
  const unclassifiedThemeSources = {
    count: unclassifiedThemeSourceIds.length,
    sourceIds: unclassifiedThemeSourceIds,
    representativeSourceIds: representativeEvidenceIds(unclassifiedThemeSourceIds),
    boundary: "这些来源通过研究对象相关性门禁，但题名与核心目的/结论字段没有命中当前受控主题规则；保留为未分类而不强行归类。未编码不等于摘要没有涉及相关主题。",
  };

  const temporalSignals = themeCoverage
    .map((covered) => {
      const rule = themeRules.find((theme) => theme.id === covered.id);
      const recentMatches = recentRecords.filter((record) => themeRuleMatches(record, rule));
      const earlierMatches = earlierRecords.filter((record) => themeRuleMatches(record, rule));
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
        representativeSourceIds: representativeEvidenceIds(evidenceIds([...recentMatches, ...earlierMatches])),
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
        representativeSourceIds: representativeEvidenceIds(evidenceIds(matched)),
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

  const problemClusters = problemRules
    .map((problem) => {
      const matched = abstractRecords.filter((record) => problem.pattern.test(searchableText(record)));
      const evidenceExcerpts = matched
        .map((record) => ({
          sourceId: sourceIdFor(record),
          text: contextualRuleExcerpt(record, problem, 220),
        }))
        .filter((item) => item.sourceId && item.text)
        .slice(0, 3);
      return {
        id: problem.id,
        category: problem.category,
        label: problem.label,
        count: matched.length,
        sourceIds: evidenceIds(matched),
        representativeSourceIds: representativeEvidenceIds(evidenceIds(matched)),
        evidenceExcerpts,
      };
    })
    .filter((problem) => problem.count > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

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
        representativeSourceIds: representativeEvidenceIds(evidenceIds(matched)),
        evidenceExcerpts: excerpts,
      };
    })
    .filter((gap) => gap.count > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  const breakthroughCandidates = gapClusters.map((gap, index) => {
    const gapRule = GAP_RULES.find((rule) => rule.id === gap.id);
    const theme = mainThemeForGap(normalized, gapRule, themeRules);
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
    const themes = matchingThemeRules(record, themeRules);
    const methods = abstract ? matchingRules(record, METHOD_RULES) : [];
    const gaps = abstract ? matchingRules(record, GAP_RULES) : [];
    const problems = abstract ? matchingRules(record, problemRules) : [];
    return {
      sourceId: sourceIdFor(record),
      classifierVersion: RESEARCH_REVIEW_CLASSIFIER_VERSION,
      accessLevel: abstract ? "abstract_only" : "title_only",
      themeIds: themes.map((item) => item.id),
      themeLabels: themes.map((item) => item.label),
      methodSignalIds: methods.map((item) => item.id),
      methodSignalLabels: methods.map((item) => item.label),
      methodVisibility: abstract ? classifyMethodVisibility(methods) : "abstract_unavailable",
      gapSignalIds: gaps.map((item) => item.id),
      gapSignalLabels: gaps.map((item) => item.label),
      problemSignalIds: problems.map((item) => item.id),
      problemSignalLabels: problems.map((item) => item.label),
      classifierAudit: {
        themes: matchingThemeRuleAudits(record, themeRules),
        methods: abstract ? matchingRuleAudits(record, METHOD_RULES) : [],
        gaps: abstract ? matchingRuleAudits(record, GAP_RULES) : [],
        problems: abstract ? matchingRuleAudits(record, problemRules) : [],
      },
      objectiveExcerpt: abstract ? excerpt(reportedSentence(record, OBJECTIVE_CUE), 240) || null : null,
      conclusionExcerpt: abstract ? excerpt(reportedSentence(record, CONCLUSION_CUE), 300) || null : null,
      gapExcerpt: abstract ? excerpt(gapSentence(record, gaps), 300) || null : null,
      boundary: abstract
        ? "仅基于题名与摘要编码；未核对全文方法、数值、纳排细节或补充材料。"
        : "摘要未返回；除题名主题外，其余方法、结论和缺口保持未知。",
    };
  });

  const professorReport = buildProfessorReport({
    normalized,
    abstractRecords,
    reviewWindow,
    observedYears: { from: oldestYear, to: newestYear },
    themeCoverage,
    temporalSignals,
    methodSignals,
    methodVisibility,
    gapClusters,
    problemClusters,
    subjectLabel,
    taxonomyProfile: activeTaxonomyProfile,
  });

  const dominantThemes = themeCoverage.slice(0, 4);
  const leadingChanges = temporalSignals.filter((item) => ["recent_only", "rising_signal"].includes(item.direction.id)).slice(0, 3);
  return {
    schemaVersion: "research-review-synthesis/v1",
    classifierVersion: RESEARCH_REVIEW_CLASSIFIER_VERSION,
    taxonomyProfile: activeTaxonomyProfile,
    taxonomyBoundary: activeTaxonomyProfile === "gastric_oncology_v1"
      ? "研究对象明确为胃癌，启用肿瘤主题编码和胃癌专属问题规则；主题与问题仍仅描述当前样本。"
      : activeTaxonomyProfile === "oncology_generic_v1"
        ? "研究对象属于非胃癌肿瘤，启用通用肿瘤主题编码；不会生成胃癌、胃早诊或胃癌地区适用性专属问题标签。"
        : "研究对象未识别为肿瘤，使用通用安全主题编码；不会生成肿瘤耐药、肿瘤微环境或肿瘤专属检索词。",
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
    unclassifiedThemeSources,
    themeCodingBoundary: "主题覆盖与时间信号表示题名、核心目的或结论字段是否把该主题作为可审计主轴；它不是全文内容提及计数。未编码为主轴不等于摘要或全文未涉及。",
    temporalSignals,
    methodSignals,
    methodVisibility,
    gapClusters,
    problemClusters,
    breakthroughCandidates,
    directionReport,
    professorReport,
    sourceAnalyses,
    summaries: {
      coverage: dominantThemes.length
        ? `当前样本题名或核心摘要主轴主要编码为：${dominantThemes.map((item) => `${item.label}（${item.count}/${normalized.length}）`).join("、")}。`
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
  classifierVersion: RESEARCH_REVIEW_CLASSIFIER_VERSION,
  themeRuleCount: THEME_RULES.length,
  methodRuleCount: METHOD_RULES.length,
  gapRuleCount: GAP_RULES.length,
});
