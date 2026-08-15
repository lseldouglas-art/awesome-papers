export const METHOD_PACK_SCHEMA_VERSION = "research.method-pack/v1";

export const METHOD_PACK_CATEGORIES = Object.freeze([
  "inquiry",
  "evidence_synthesis",
  "wet_lab",
  "computational",
  "clinical_or_observational",
]);

export const METHOD_PACK_MATURITY = Object.freeze([
  "candidate_template",
  "validated_template",
  "locally_qualified",
  "deprecated",
]);

export const METHOD_PACK_INTERFACE_V1 = Object.freeze({
  schemaVersion: METHOD_PACK_SCHEMA_VERSION,
  purpose:
    "让每一种科研方法明确说明它适合回答什么问题、会产生什么证据、不能支持什么结论，以及怎样被复核和复现。",
  requiredSections: [
    "identity",
    "scientificContract",
    "prerequisites",
    "compositionContract",
    "workflowContract",
    "qualityContract",
    "uncertaintyContract",
    "provenanceContract",
    "resourceContract",
    "governanceContract",
    "executionAdapters",
    "lifecycle",
  ],
  invariants: [
    "问题决定证据要求，证据要求决定可用方法",
    "方法包不能声称超出其证据产出的结论",
    "计算预测、实测暴露、直接结合、细胞内占有和功能介导必须分开记录",
    "来源、版本、参数和验证类型必须分字段保存",
    "质量控制失败不能被正常结果覆盖",
    "涉及伦理、安全或不可逆操作时必须由真实研究者放行",
    "已执行的方法包只能新增版本，不能覆盖历史",
  ],
});

const REQUIRED_PROVENANCE_RECORDS = Object.freeze([
  "sourceLocator",
  "protocolVersion",
  "parameterSet",
  "validationType",
]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function requireObjectSection(pack, section, issues) {
  if (!pack?.[section] || typeof pack[section] !== "object") {
    issues.push(`missing section: ${section}`);
    return null;
  }
  return pack[section];
}

function duplicateIds(items = []) {
  const seen = new Set();
  const duplicates = new Set();
  for (const item of items) {
    if (!item?.id) continue;
    if (seen.has(item.id)) duplicates.add(item.id);
    seen.add(item.id);
  }
  return [...duplicates];
}

export function validateMethodPack(pack) {
  const issues = [];
  if (!pack || typeof pack !== "object") return ["method pack must be an object"];
  if (pack.schemaVersion !== METHOD_PACK_SCHEMA_VERSION) {
    issues.push(`schemaVersion must be ${METHOD_PACK_SCHEMA_VERSION}`);
  }

  for (const section of METHOD_PACK_INTERFACE_V1.requiredSections) {
    if (section === "executionAdapters") continue;
    requireObjectSection(pack, section, issues);
  }
  if (!Array.isArray(pack.executionAdapters)) {
    issues.push("executionAdapters must be an array");
  }

  const identity = pack.identity ?? {};
  for (const key of ["id", "version", "name", "userPurpose", "domain"] ) {
    if (!isNonEmptyString(identity[key])) issues.push(`identity.${key} is required`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(identity.id ?? "")) {
    issues.push("identity.id must be a stable machine id");
  }
  if (!/^\d+\.\d+\.\d+$/.test(identity.version ?? "")) {
    issues.push("identity.version must use semantic versioning");
  }
  if (!METHOD_PACK_CATEGORIES.includes(identity.category)) {
    issues.push(`identity.category must be one of: ${METHOD_PACK_CATEGORIES.join(", ")}`);
  }
  if (!METHOD_PACK_MATURITY.includes(identity.maturity)) {
    issues.push(`identity.maturity must be one of: ${METHOD_PACK_MATURITY.join(", ")}`);
  }

  const scientific = pack.scientificContract ?? {};
  for (const key of [
    "applicableQuestionTypes",
    "incompatibleQuestionTypes",
    "supportedClaimTypes",
    "unsupportedClaimTypes",
    "evidenceOutputs",
    "minimumEvidenceForClaims",
  ]) {
    if (!Array.isArray(scientific[key])) {
      issues.push(`scientificContract.${key} must be an array`);
    }
  }
  if (!isNonEmptyArray(scientific.applicableQuestionTypes)) {
    issues.push("at least one applicable question type is required");
  }
  if (!isNonEmptyArray(scientific.supportedClaimTypes)) {
    issues.push("at least one supported claim type is required");
  }
  if (!isNonEmptyArray(scientific.unsupportedClaimTypes)) {
    issues.push("explicit unsupported claim types are required");
  }
  if (!isNonEmptyArray(scientific.evidenceOutputs)) {
    issues.push("at least one evidence output is required");
  }

  const overlap = (scientific.supportedClaimTypes ?? []).filter((claim) =>
    (scientific.unsupportedClaimTypes ?? []).includes(claim),
  );
  if (overlap.length > 0) {
    issues.push(`claim types cannot be both supported and unsupported: ${overlap.join(", ")}`);
  }

  const evidenceOutputs = scientific.evidenceOutputs ?? [];
  for (const id of duplicateIds(evidenceOutputs)) {
    issues.push(`duplicate evidence output id: ${id}`);
  }
  const evidenceIds = new Set(evidenceOutputs.map((item) => item.id));
  const supportedClaims = new Set(scientific.supportedClaimTypes ?? []);
  for (const output of evidenceOutputs) {
    if (!isNonEmptyString(output.id)) issues.push("evidence output id is required");
    if (!isNonEmptyString(output.evidenceType)) {
      issues.push(`evidence type is required for ${output.id ?? "unknown evidence"}`);
    }
    if (!isNonEmptyString(output.unitOfAnalysis)) {
      issues.push(`unit of analysis is required for ${output.id ?? "unknown evidence"}`);
    }
    if (!Array.isArray(output.supportsClaims)) {
      issues.push(`supportsClaims must be an array for ${output.id ?? "unknown evidence"}`);
    }
    if (!isNonEmptyArray(output.cannotEstablish)) {
      issues.push(`cannotEstablish is required for ${output.id ?? "unknown evidence"}`);
    }
    for (const claim of output.supportsClaims ?? []) {
      if (!supportedClaims.has(claim)) {
        issues.push(`evidence ${output.id} references unsupported claim: ${claim}`);
      }
    }
  }

  for (const rule of scientific.minimumEvidenceForClaims ?? []) {
    if (!supportedClaims.has(rule.claimType)) {
      issues.push(`minimum-evidence rule references unknown claim: ${rule.claimType}`);
    }
    if (!isNonEmptyArray(rule.requiredEvidenceComponents)) {
      issues.push(`required evidence components missing for claim: ${rule.claimType}`);
    }
    for (const evidenceId of rule.requiredEvidenceComponents ?? []) {
      if (!evidenceIds.has(evidenceId)) {
        issues.push(`claim ${rule.claimType} references unknown evidence: ${evidenceId}`);
      }
    }
  }

  const prerequisites = pack.prerequisites ?? {};
  if (!Array.isArray(prerequisites.items)) {
    issues.push("prerequisites.items must be an array");
  }
  for (const id of duplicateIds(prerequisites.items)) {
    issues.push(`duplicate prerequisite id: ${id}`);
  }

  const composition = pack.compositionContract ?? {};
  for (const key of [
    "inputObjectTypes",
    "outputObjectTypes",
    "compatibleUpstreamPacks",
    "compatibleDownstreamPacks",
  ]) {
    if (!Array.isArray(composition[key])) {
      issues.push(`compositionContract.${key} must be an array`);
    }
  }
  if (!isNonEmptyArray(composition.inputObjectTypes)) {
    issues.push("compositionContract.inputObjectTypes is required");
  }
  if (!isNonEmptyArray(composition.outputObjectTypes)) {
    issues.push("compositionContract.outputObjectTypes is required");
  }
  if (typeof composition.canRunAsSubHarness !== "boolean") {
    issues.push("compositionContract.canRunAsSubHarness must be boolean");
  }

  const workflow = pack.workflowContract ?? {};
  if (!isNonEmptyArray(workflow.steps)) issues.push("workflowContract.steps is required");
  if (!isNonEmptyArray(workflow.stoppingRules)) {
    issues.push("workflowContract.stoppingRules is required");
  }
  if (!isNonEmptyString(workflow.deviationPolicy)) {
    issues.push("workflowContract.deviationPolicy is required");
  }
  for (const id of duplicateIds(workflow.steps)) issues.push(`duplicate workflow step id: ${id}`);

  const quality = pack.qualityContract ?? {};
  for (const key of [
    "controls",
    "acceptanceCriteria",
    "biasControls",
    "robustnessChecks",
    "independentReview",
  ]) {
    if (!isNonEmptyArray(quality[key])) issues.push(`qualityContract.${key} is required`);
  }

  const uncertainty = pack.uncertaintyContract ?? {};
  for (const key of ["assumptions", "knownFailureModes", "alternativeExplanations"] ) {
    if (!isNonEmptyArray(uncertainty[key])) {
      issues.push(`uncertaintyContract.${key} is required`);
    }
  }
  if (!isNonEmptyString(uncertainty.missingnessHandling)) {
    issues.push("uncertaintyContract.missingnessHandling is required");
  }

  const provenance = pack.provenanceContract ?? {};
  if (!Array.isArray(provenance.requiredRecords)) {
    issues.push("provenanceContract.requiredRecords must be an array");
  }
  for (const field of REQUIRED_PROVENANCE_RECORDS) {
    if (!(provenance.requiredRecords ?? []).includes(field)) {
      issues.push(`provenance must record ${field}`);
    }
  }
  if (!isNonEmptyArray(provenance.standards)) {
    issues.push("provenanceContract.standards is required");
  }

  const governance = pack.governanceContract ?? {};
  if (!isNonEmptyArray(governance.humanDecisions)) {
    issues.push("governanceContract.humanDecisions is required");
  }
  if (!isNonEmptyString(governance.riskClass)) {
    issues.push("governanceContract.riskClass is required");
  }

  const lifecycle = pack.lifecycle ?? {};
  if (lifecycle.versionPolicy !== "new_version_only") {
    issues.push("lifecycle.versionPolicy must be new_version_only");
  }
  if (lifecycle.claimsCannotExceedEvidence !== true) {
    issues.push("lifecycle.claimsCannotExceedEvidence must be true");
  }

  return [...new Set(issues)];
}

function prerequisiteApplies(item, question) {
  if (!item.required) return false;
  if (!isNonEmptyArray(item.requiredWhenContextTags)) return true;
  return item.requiredWhenContextTags.some((tag) =>
    (question.contextTags ?? []).includes(tag),
  );
}

export function assessMethodFit(pack, question, availability = {}) {
  const schemaIssues = validateMethodPack(pack);
  if (schemaIssues.length > 0) {
    throw new Error(`invalid method pack: ${schemaIssues.join("; ")}`);
  }

  const blockers = [];
  const warnings = [];
  const scientific = pack.scientificContract;
  const providedEvidence = new Set(scientific.evidenceOutputs.map((item) => item.id));

  if (!scientific.applicableQuestionTypes.includes(question.questionType)) {
    blockers.push(`该方法不适用于问题类型：${question.questionType}`);
  }
  if (scientific.incompatibleQuestionTypes.includes(question.questionType)) {
    blockers.push(`该方法明确排除问题类型：${question.questionType}`);
  }
  if (!scientific.supportedClaimTypes.includes(question.intendedClaimType)) {
    blockers.push(`该方法不能支持目标结论：${question.intendedClaimType}`);
  }
  if (scientific.unsupportedClaimTypes.includes(question.intendedClaimType)) {
    blockers.push(`目标结论位于该方法的禁止外推范围：${question.intendedClaimType}`);
  }

  const claimRule = scientific.minimumEvidenceForClaims.find(
    (item) => item.claimType === question.intendedClaimType,
  );
  const requiredEvidence = new Set([
    ...(claimRule?.requiredEvidenceComponents ?? []),
    ...(question.requiredEvidenceComponents ?? []),
  ]);
  for (const component of requiredEvidence) {
    if (!providedEvidence.has(component)) {
      blockers.push(`方法包不能产生问题所需证据：${component}`);
    }
  }

  const availablePrerequisites = new Set(availability.prerequisiteIds ?? []);
  for (const item of pack.prerequisites.items) {
    if (prerequisiteApplies(item, question) && !availablePrerequisites.has(item.id)) {
      blockers.push(`缺少前置条件：${item.userLabel}`);
    }
  }

  if (pack.identity.maturity === "candidate_template") {
    warnings.push("该方法包仍是候选模板，正式使用前需要本地验证和负责人批准");
  }
  for (const assumption of pack.uncertaintyContract.assumptions) {
    warnings.push(`需要核实的假设：${assumption}`);
  }
  for (const failureMode of pack.uncertaintyContract.knownFailureModes) {
    warnings.push(`已知失效方式：${failureMode}`);
  }

  return {
    fit: blockers.length > 0 ? "not_fit" : warnings.length > 0 ? "conditional" : "fit",
    blockers,
    warnings,
    supportedEvidenceComponents: [...providedEvidence],
    humanReleaseRequired:
      pack.executionAdapters.some((adapter) => adapter.requiresHumanRelease) ||
      pack.governanceContract.riskClass !== "low",
  };
}

const commonProvenance = {
  requiredRecords: [
    "sourceLocator",
    "protocolVersion",
    "parameterSet",
    "validationType",
    "executor",
    "startTime",
    "endTime",
    "inputHash",
    "outputHash",
    "deviations",
  ],
  standards: ["W3C PROV-O", "RO-Crate", "FAIR Guiding Principles"],
  retentionPolicy: "保留原始输入、执行记录、失败运行、偏差说明和所有已发布版本",
};

export const FIELD_INQUIRY_METHOD_PACK_V1 = Object.freeze({
  schemaVersion: METHOD_PACK_SCHEMA_VERSION,
  identity: {
    id: "field-inquiry",
    version: "1.0.0",
    name: "陌生领域调研",
    userPurpose: "从一个陌生领域形成可追溯的领域认识，并找到值得进一步验证的问题。",
    domain: "cross-domain",
    category: "inquiry",
    maturity: "candidate_template",
  },
  scientificContract: {
    applicableQuestionTypes: ["field_orientation", "candidate_question_selection"],
    incompatibleQuestionTypes: ["individual_clinical_decision", "causal_effect_estimation"],
    supportedClaimTypes: ["bounded_landscape_description", "evidence_gap", "candidate_question"],
    unsupportedClaimTypes: ["clinical_efficacy", "causal_mechanism", "global_prevalence"],
    evidenceOutputs: [
      {
        id: "mapped_sources",
        evidenceType: "traceable_source_map",
        unitOfAnalysis: "source family",
        supportsClaims: ["bounded_landscape_description", "evidence_gap", "candidate_question"],
        cannotEstablish: ["全领域穷尽", "因果机制", "临床有效性"],
      },
      {
        id: "scope_boundaries",
        evidenceType: "explicit_scope_and_coverage_boundary",
        unitOfAnalysis: "search source and eligibility rule",
        supportsClaims: ["bounded_landscape_description", "evidence_gap"],
        cannotEstablish: ["未检索来源中的证据情况"],
      },
      {
        id: "counterevidence_map",
        evidenceType: "counterevidence_and_alternative_explanation_map",
        unitOfAnalysis: "claim-evidence relation",
        supportsClaims: ["evidence_gap", "candidate_question"],
        cannotEstablish: ["候选问题一定成立"],
      },
    ],
    minimumEvidenceForClaims: [
      {
        claimType: "bounded_landscape_description",
        requiredEvidenceComponents: ["mapped_sources", "scope_boundaries"],
      },
      {
        claimType: "evidence_gap",
        requiredEvidenceComponents: ["mapped_sources", "scope_boundaries", "counterevidence_map"],
      },
      {
        claimType: "candidate_question",
        requiredEvidenceComponents: ["mapped_sources", "counterevidence_map"],
      },
    ],
  },
  prerequisites: {
    items: [
      { id: "research_intent", type: "artifact", userLabel: "初始研究意图", required: true },
      { id: "source_access", type: "resource", userLabel: "至少一个可真实检索的数据源", required: true },
    ],
  },
  compositionContract: {
    inputObjectTypes: ["ResearchIntent", "OptionalSourceMaterial"],
    outputObjectTypes: ["LandscapeMap", "ResearchQuestionCandidate", "QuestionDecision"],
    compatibleUpstreamPacks: [],
    compatibleDownstreamPacks: ["wet-lab-target-mediation", "bioinformatics-differential-expression"],
    canRunAsSubHarness: true,
  },
  workflowContract: {
    steps: [
      { id: "scope", userLabel: "界定问题与边界", produces: ["ResearchBrief"] },
      { id: "orient", userLabel: "建立领域视野", produces: ["LandscapeMap"] },
      { id: "challenge", userLabel: "寻找反证与替代解释", produces: ["CounterevidenceMap"] },
      { id: "select", userLabel: "比较并选择候选问题", produces: ["QuestionDecision"] },
    ],
    stoppingRules: ["新增来源不再改变主要概念结构", "关键争议均有正反证据位置", "覆盖边界已经可解释"],
    deviationPolicy: "任何检索式、数据源或纳排标准改变都生成新版并说明原因",
  },
  qualityContract: {
    controls: ["哨兵文献召回检查", "重复记录与研究家族归并", "反证专门检索"],
    acceptanceCriteria: ["所有主要判断可回到来源", "证据不足会降低结论强度", "单库观察不外推为全领域事实"],
    biasControls: ["来源覆盖审计", "语言与发表偏倚说明", "确认偏误检查"],
    robustnessChecks: [
      "替代检索式敏感性检查",
      "摘要边界复核；仅在用户要求或关键主张需要时抽样核查全文",
      "独立方法复核",
    ],
    independentReview: ["检索策略复核", "主张—证据映射复核"],
  },
  uncertaintyContract: {
    assumptions: ["可访问来源足以支持当前限域判断"],
    knownFailureModes: ["把检索不到误写成研究空白", "把题名频次误写成趋势", "先有结论再挑证据"],
    alternativeExplanations: ["观察到的差异可能来自数据库覆盖、术语变化或纳排规则"],
    missingnessHandling: "将不可访问来源和未报告信息分别标记，不以零值替代",
  },
  provenanceContract: commonProvenance,
  resourceContract: {
    estimatedTime: "取决于范围与数据源；先以可停止的领域认识样本运行",
    costBand: "low_to_medium",
    equipment: [],
    compute: ["文献检索与结构化存储"],
    specialistRoles: ["领域研究者", "信息检索或方法学复核者"],
  },
  governanceContract: {
    riskClass: "low",
    humanDecisions: ["批准研究边界", "选择候选问题", "接受证据限制"],
    ethicsTriggers: ["涉及个人数据、敏感人群或双重用途时升级审查"],
    dataGovernance: ["遵守来源许可", "不泄露未授权全文或个人数据"],
  },
  executionAdapters: [
    { id: "pubmed-adapter", kind: "database_search", requiresHumanRelease: false },
    { id: "zotero-adapter", kind: "library_management", requiresHumanRelease: false },
  ],
  lifecycle: {
    versionPolicy: "new_version_only",
    claimsCannotExceedEvidence: true,
    qualificationRule: "在新学科使用前，以已知哨兵来源和人工复核完成校准",
  },
});

export const WET_LAB_TARGET_MEDIATION_TEMPLATE_V1 = Object.freeze({
  schemaVersion: METHOD_PACK_SCHEMA_VERSION,
  identity: {
    id: "wet-lab-target-mediation",
    version: "1.0.0",
    name: "靶点介导机制实验设计模板",
    userPurpose: "检验某一处理是否通过特定靶点引起观察到的表型，而不是停留在计算预测。",
    domain: "biomedical-mechanism",
    category: "wet_lab",
    maturity: "candidate_template",
  },
  scientificContract: {
    applicableQuestionTypes: ["mechanism_test", "target_mediation_test"],
    incompatibleQuestionTypes: ["population_effectiveness", "literature_prevalence"],
    supportedClaimTypes: [
      "direct_binding_or_cellular_engagement",
      "target_specific_functional_mediation",
      "compound_target_phenotype_mechanism",
    ],
    unsupportedClaimTypes: ["clinical_efficacy", "population_causality", "universal_pathway_mechanism"],
    evidenceOutputs: [
      {
        id: "identity_and_exposure",
        evidenceType: "measured_entity_identity_and_context_appropriate_exposure",
        unitOfAnalysis: "compound or defined intervention in matched model",
        supportsClaims: ["compound_target_phenotype_mechanism"],
        cannotEstablish: ["靶点结合", "靶点介导", "临床有效"],
      },
      {
        id: "binding_or_engagement",
        evidenceType: "direct_binding_or_cellular_target_engagement",
        unitOfAnalysis: "compound-target pair",
        supportsClaims: ["direct_binding_or_cellular_engagement", "compound_target_phenotype_mechanism"],
        cannotEstablish: ["靶点介导表型", "体内可达暴露"],
      },
      {
        id: "functional_mediation",
        evidenceType: "target_perturbation_with_effect_modification_or_rescue",
        unitOfAnalysis: "target perturbation by treatment interaction",
        supportsClaims: ["target_specific_functional_mediation", "compound_target_phenotype_mechanism"],
        cannotEstablish: ["直接结合", "临床有效"],
      },
      {
        id: "concentration_compatibility",
        evidenceType: "concentration_response_and_exposure_effect_alignment",
        unitOfAnalysis: "concentration or dose in matched context",
        supportsClaims: ["compound_target_phenotype_mechanism"],
        cannotEstablish: ["靶点特异性", "直接结合"],
      },
      {
        id: "phenotype_readout",
        evidenceType: "validated_phenotype_measurement",
        unitOfAnalysis: "experimental unit defined before analysis",
        supportsClaims: ["target_specific_functional_mediation", "compound_target_phenotype_mechanism"],
        cannotEstablish: ["靶点结合", "临床转化"],
      },
    ],
    minimumEvidenceForClaims: [
      {
        claimType: "direct_binding_or_cellular_engagement",
        requiredEvidenceComponents: ["binding_or_engagement"],
      },
      {
        claimType: "target_specific_functional_mediation",
        requiredEvidenceComponents: ["functional_mediation", "phenotype_readout"],
      },
      {
        claimType: "compound_target_phenotype_mechanism",
        requiredEvidenceComponents: [
          "identity_and_exposure",
          "binding_or_engagement",
          "functional_mediation",
          "concentration_compatibility",
          "phenotype_readout",
        ],
      },
    ],
  },
  prerequisites: {
    items: [
      { id: "defined_intervention", type: "material", userLabel: "身份与纯度明确的干预物", required: true },
      { id: "validated_model", type: "model", userLabel: "与问题匹配并经过验证的实验模型", required: true },
      { id: "validated_reagents", type: "material", userLabel: "经过身份和性能验证的关键试剂", required: true },
      { id: "analysis_plan", type: "artifact", userLabel: "预先确定的样本量与统计分析计划", required: true },
      {
        id: "ethics_approval",
        type: "approval",
        userLabel: "适用的人体或动物伦理批准",
        required: true,
        requiredWhenContextTags: ["human", "animal"],
      },
    ],
  },
  compositionContract: {
    inputObjectTypes: ["ResearchQuestion", "EvidenceRequirement", "QualifiedMaterial", "ValidatedModel"],
    outputObjectTypes: ["RawObservationSet", "QualityDecision", "MechanismEvidenceBundle"],
    compatibleUpstreamPacks: ["field-inquiry"],
    compatibleDownstreamPacks: ["field-inquiry"],
    canRunAsSubHarness: true,
  },
  workflowContract: {
    steps: [
      { id: "design", userLabel: "锁定假设、对照和主要终点", produces: ["PreregisteredProtocol"] },
      { id: "qualify", userLabel: "验证模型、材料和测量体系", produces: ["QualificationReport"] },
      { id: "execute", userLabel: "按随机化与盲法方案执行", produces: ["RawObservationSet"] },
      { id: "qc", userLabel: "在解读前完成质量控制", produces: ["QualityDecision"] },
      { id: "interpret", userLabel: "按证据组件分别解释", produces: ["MechanismEvidenceBundle"] },
    ],
    stoppingRules: ["预设质量控制失败", "安全阈值触发", "样本量或停止边界达到预设条件"],
    deviationPolicy: "偏离预注册方案必须在揭盲或结果解释前记录，并区分确认性与探索性分析",
  },
  qualityContract: {
    controls: ["阳性对照", "阴性或载体对照", "技术空白", "靶点扰动对照"],
    acceptanceCriteria: ["实验单位与重复类型明确", "主要终点预先定义", "关键试剂与模型验证通过"],
    biasControls: ["随机化", "盲法或无法盲法的理由", "排除标准预先定义", "批次平衡"],
    robustnessChecks: ["独立重复", "正交测量", "剂量或浓度响应", "敏感性分析"],
    independentReview: ["实验设计审查", "统计分析审查", "原始记录抽查"],
  },
  uncertaintyContract: {
    assumptions: ["实验模型中的暴露、靶点状态和表型与目标生物学问题相容"],
    knownFailureModes: ["伪重复", "批次效应", "试剂失效", "只用敲低或救援中的单一环节过度宣称因果"],
    alternativeExplanations: ["非特异作用", "毒性引起的继发表型", "旁路或补偿机制"],
    missingnessHandling: "记录所有排除和失败实验；不把未测量或质量控制失败当作阴性结果",
  },
  provenanceContract: {
    ...commonProvenance,
    standards: ["W3C PROV-O", "RO-Crate", "FAIR Guiding Principles", "ARRIVE 2.0 when applicable"],
  },
  resourceContract: {
    estimatedTime: "由模型、重复次数和测量平台决定，必须在批准前估算",
    costBand: "medium_to_high",
    equipment: ["由具体检测技术声明并校准"],
    compute: ["随机化表、原始数据保存和统计分析环境"],
    specialistRoles: ["领域研究者", "实验平台主管", "统计或方法学复核者"],
  },
  governanceContract: {
    riskClass: "high",
    humanDecisions: ["批准实验设计", "批准伦理与安全条件", "确认质量控制决定", "批准结论边界"],
    ethicsTriggers: ["人体材料", "动物实验", "病原体或基因改造", "双重用途风险"],
    dataGovernance: ["样本同意与用途一致", "原始记录不可追溯修改", "敏感数据最小化访问"],
  },
  executionAdapters: [
    { id: "manual-lab-run", kind: "physical_execution", requiresHumanRelease: true },
    { id: "instrument-export", kind: "instrument_data_import", requiresHumanRelease: true },
  ],
  lifecycle: {
    versionPolicy: "new_version_only",
    claimsCannotExceedEvidence: true,
    qualificationRule: "必须按具体模型、靶点、检测平台和机构规范完成本地资格确认后才能执行",
  },
});

export const BIOINFORMATICS_DIFFERENTIAL_EXPRESSION_TEMPLATE_V1 = Object.freeze({
  schemaVersion: METHOD_PACK_SCHEMA_VERSION,
  identity: {
    id: "bioinformatics-differential-expression",
    version: "1.0.0",
    name: "差异表达分析模板",
    userPurpose: "在明确设计和质量边界下识别与研究条件相关的表达差异，并生成可验证假设。",
    domain: "transcriptomics",
    category: "computational",
    maturity: "candidate_template",
  },
  scientificContract: {
    applicableQuestionTypes: ["differential_association", "exploratory_biomarker_generation"],
    incompatibleQuestionTypes: ["causal_mechanism_test", "individual_diagnosis"],
    supportedClaimTypes: ["condition_associated_expression_difference", "exploratory_pathway_hypothesis"],
    unsupportedClaimTypes: ["causal_gene_effect", "clinical_biomarker_validity", "target_engagement"],
    evidenceOutputs: [
      {
        id: "qc_qualified_expression_matrix",
        evidenceType: "quality_controlled_expression_measurement",
        unitOfAnalysis: "independent biological sample",
        supportsClaims: ["condition_associated_expression_difference", "exploratory_pathway_hypothesis"],
        cannotEstablish: ["基因因果作用", "蛋白活性", "临床诊断性能"],
      },
      {
        id: "design_adjusted_contrast",
        evidenceType: "model_adjusted_statistical_contrast",
        unitOfAnalysis: "predefined comparison",
        supportsClaims: ["condition_associated_expression_difference"],
        cannotEstablish: ["未测混杂已被排除", "个体层面预测有效"],
      },
      {
        id: "multiplicity_controlled_results",
        evidenceType: "multiple_testing_adjusted_result_set",
        unitOfAnalysis: "tested feature family",
        supportsClaims: ["condition_associated_expression_difference", "exploratory_pathway_hypothesis"],
        cannotEstablish: ["生物学重要性", "独立重复"],
      },
      {
        id: "robustness_and_replication",
        evidenceType: "sensitivity_or_independent_replication_result",
        unitOfAnalysis: "analysis variant or independent cohort",
        supportsClaims: ["condition_associated_expression_difference", "exploratory_pathway_hypothesis"],
        cannotEstablish: ["机制因果", "临床效用"],
      },
    ],
    minimumEvidenceForClaims: [
      {
        claimType: "condition_associated_expression_difference",
        requiredEvidenceComponents: [
          "qc_qualified_expression_matrix",
          "design_adjusted_contrast",
          "multiplicity_controlled_results",
        ],
      },
      {
        claimType: "exploratory_pathway_hypothesis",
        requiredEvidenceComponents: ["qc_qualified_expression_matrix", "multiplicity_controlled_results"],
      },
    ],
  },
  prerequisites: {
    items: [
      { id: "raw_or_primary_data", type: "data", userLabel: "原始数据或可审计的一级定量数据", required: true },
      { id: "sample_metadata", type: "data", userLabel: "样本、分组、批次和关键协变量元数据", required: true },
      { id: "analysis_question", type: "artifact", userLabel: "预先定义的比较和目标结论", required: true },
      { id: "data_permission", type: "approval", userLabel: "数据使用和隐私权限", required: true },
    ],
  },
  compositionContract: {
    inputObjectTypes: ["ResearchQuestion", "EvidenceRequirement", "PrimaryData", "SampleMetadata"],
    outputObjectTypes: ["DataAudit", "AnalysisRun", "RobustnessReport", "ComputationalEvidenceBundle"],
    compatibleUpstreamPacks: ["field-inquiry"],
    compatibleDownstreamPacks: ["field-inquiry", "wet-lab-target-mediation"],
    canRunAsSubHarness: true,
  },
  workflowContract: {
    steps: [
      { id: "inspect", userLabel: "检查数据、元数据和设计", produces: ["DataAudit"] },
      { id: "qc", userLabel: "完成样本和特征质量控制", produces: ["QCDecision"] },
      { id: "model", userLabel: "冻结模型、对比和多重检验方法", produces: ["AnalysisPlan"] },
      { id: "run", userLabel: "在冻结环境中执行", produces: ["AnalysisRun"] },
      { id: "challenge", userLabel: "检查稳健性和替代解释", produces: ["RobustnessReport"] },
    ],
    stoppingRules: ["样本身份或分组无法确认", "关键批次与研究条件完全混杂", "预设质量阈值失败"],
    deviationPolicy: "任何过滤、模型、阈值或数据版本改变均产生新运行，不覆盖原结果",
  },
  qualityContract: {
    controls: ["样本身份检查", "批次与条件列联检查", "已知技术控制或参考样本"],
    acceptanceCriteria: ["实验单位正确", "模型与设计匹配", "效应量、区间与多重检验同时报告"],
    biasControls: ["避免数据泄漏", "混杂检查", "预先定义排除标准", "训练与验证分离"],
    robustnessChecks: ["替代过滤阈值", "批次敏感性分析", "影响点检查", "可用时独立队列复现"],
    independentReview: ["代码审查", "统计设计审查", "从原始数据重跑"],
  },
  uncertaintyContract: {
    assumptions: ["样本独立性、测量尺度和统计模型假设与数据相容"],
    knownFailureModes: ["批次与分组混杂", "伪重复", "数据泄漏", "只报告显著通路"],
    alternativeExplanations: ["细胞组成差异", "技术批次", "未测混杂", "数据库注释偏倚"],
    missingnessHandling: "区分技术缺失、结构性缺失与过滤；所有插补或剔除产生审计记录",
  },
  provenanceContract: {
    ...commonProvenance,
    standards: ["W3C PROV-O", "RO-Crate", "FAIR Guiding Principles", "CWL-compatible adapter when executable"],
  },
  resourceContract: {
    estimatedTime: "由样本量、数据质量和复现要求决定",
    costBand: "low_to_medium",
    equipment: [],
    compute: ["锁定的软件环境", "足够的存储与内存", "可重放工作流"],
    specialistRoles: ["领域研究者", "生物信息学分析者", "统计复核者"],
  },
  governanceContract: {
    riskClass: "medium",
    humanDecisions: ["批准比较与协变量", "确认质量控制排除", "批准结论边界"],
    ethicsTriggers: ["人类基因组数据", "可重新识别信息", "临床决策用途"],
    dataGovernance: ["最小权限", "用途限制", "敏感数据不写入公开日志"],
  },
  executionAdapters: [
    { id: "cwl-workflow-adapter", kind: "computational_workflow", requiresHumanRelease: false },
    { id: "manual-notebook-adapter", kind: "interactive_analysis", requiresHumanRelease: true },
  ],
  lifecycle: {
    versionPolicy: "new_version_only",
    claimsCannotExceedEvidence: true,
    qualificationRule: "必须针对物种、平台、设计和数据类型完成本地基准测试",
  },
});

export const METHOD_PACK_REGISTRY_V1 = Object.freeze([
  FIELD_INQUIRY_METHOD_PACK_V1,
  WET_LAB_TARGET_MEDIATION_TEMPLATE_V1,
  BIOINFORMATICS_DIFFERENTIAL_EXPRESSION_TEMPLATE_V1,
]);
