import test from "node:test";
import assert from "node:assert/strict";

import { sha256 } from "./event-engine-v1.js";
import {
  BIOINFORMATICS_DIFFERENTIAL_EXPRESSION_TEMPLATE_V1,
  WET_LAB_TARGET_MEDIATION_TEMPLATE_V1,
} from "./method-pack-interface-v1.js";
import {
  EXTERNAL_RESULT_ORIGIN_ATTESTATION,
  IDEA_VALIDATION_INTERFACE_V1,
  IdeaValidationError,
  createIdeaValidationDecision,
  createIdeaValidationPlan,
  createIdeaValidationProtocol,
  ideaValidationBuildToArtifacts,
  recordIdeaValidationResult,
  releaseIdeaValidationProtocol,
  validateIdeaValidationDecision,
  validateIdeaValidationPlan,
  validateIdeaValidationProtocol,
  validateIdeaValidationResult,
} from "./idea-validation-v1.js";

const TIME = "2026-08-13T08:00:00.000Z";
const HUMAN = Object.freeze({ id: "researcher-1", role: "principal_investigator", kind: "human" });

function candidate(overrides = {}) {
  return {
    schemaVersion: "1.0.0",
    type: "IdeaCandidate",
    id: "idea-de-001",
    projectId: "project-transcriptomics-001",
    version: 1,
    generatedAt: TIME,
    method: {
      kind: "transparent_rule_based_heuristic",
      claimStatus: "heuristic_only",
      description: "由文献地形中的关系和来源透明组合出的待复核候选。",
      limitations: ["候选不是结论，必须经过独立最小验证。"],
    },
    status: "selected_for_recheck",
    anchor: {
      tagId: "tag-condition-expression",
      label: "疾病条件与表达差异",
      sourceIds: ["source-1"],
    },
    componentPool: [
      { kind: "condition", value: "研究条件 A", sourceIds: ["source-1"] },
      { kind: "measurement", value: "转录组表达", sourceIds: ["source-1"] },
    ],
    relationshipRationale: "检验条件 A 与表达差异的关系是否在冻结设计中达到最小门槛。",
    targetScale: { kind: "predefined_contrast", description: "条件 A 与匹配对照的组间对比" },
    rejectionReason: null,
    recheckQuery: "condition A AND transcriptome AND independent cohort",
    sourceRefs: [
      {
        sourceId: "source-1",
        title: "Source used only to anchor the candidate",
        accessLevel: "abstract_only",
        sourceSnapshotHash: sha256("source-1-snapshot"),
        snapshotHashOrigin: "provided",
        locator: { doi: "10.0000/example.1" },
        evidenceRecordIds: [],
      },
    ],
    evidenceRecordIds: [],
    tagIds: ["tag-condition-expression"],
    validationBoundary: "来源只锚定候选，不代表差异表达已经被当前项目验证。",
    ...overrides,
  };
}

function humanReceipt({ subjectType, subjectId, subjectHash, decision, reason }) {
  return {
    id: `receipt-${decision}-${subjectId}`,
    subjectType,
    subjectId,
    subjectHash,
    decision,
    reason,
    decidedAt: TIME,
    decidedBy: HUMAN,
  };
}

function selectionReceipt(value) {
  return humanReceipt({
    subjectType: "IdeaCandidate",
    subjectId: value.id,
    subjectHash: sha256(value),
    decision: "selected_for_idea_validation",
    reason: "该候选可用现有数据做一次有明确停止边界的最小验证。",
  });
}

function makePlan(value = candidate()) {
  return createIdeaValidationPlan({
    candidate: value,
    methodPack: BIOINFORMATICS_DIFFERENTIAL_EXPRESSION_TEMPLATE_V1,
    validationQuestion: {
      questionType: "differential_association",
      intendedClaimType: "condition_associated_expression_difference",
      proposition: "在预定义对比中，条件 A 与一组表达差异相关。",
      scope: "仅限当前数据版本、纳排规则、设计矩阵与预注册统计模型。",
      requiredEvidenceComponents: [],
      contextTags: ["human"],
    },
    availability: {
      prerequisiteIds: [
        "raw_or_primary_data",
        "sample_metadata",
        "analysis_question",
        "data_permission",
      ],
    },
    selectionReceipt: selectionReceipt(value),
    now: TIME,
  });
}

function protocolSpec() {
  return {
    objective: "判断条件 A 的预定义差异表达对比是否同时达到 FDR 与效应量最小门槛。",
    minimalityRationale:
      "只运行一个预定义对比、一个冻结模型和两个共同判定阈值；不做结果驱动的通路扩展。",
    experimentalUnit: "具有独立供体标识的生物学样本",
    primaryEndpoint: {
      id: "primary-decision-endpoint",
      label: "同时满足 FDR 与绝对效应量门槛的预定义目标特征",
      measurement: "预定义目标特征的调整后 P 值与绝对 log2 fold change",
      unit: "feature-level contrast",
      analysisMethod: "冻结设计矩阵下的负二项回归与 Benjamini-Hochberg 校正",
    },
    decisionThresholds: [
      {
        id: "fdr-threshold",
        metricId: "target_adjusted_p_value",
        comparator: "lte",
        boundary: 0.05,
        unit: "proportion",
        rationale: "在执行前锁定多重检验门槛。",
        onPass: "继续检查效应量门槛",
        onFail: "最小验证失败，不形成支持性信号",
      },
      {
        id: "effect-threshold",
        metricId: "target_absolute_log2_fold_change",
        comparator: "gte",
        boundary: 1,
        unit: "absolute log2 fold change",
        rationale: "避免只依赖统计显著而忽略预设最小效应。",
        onPass: "若质量与证据组件也通过，形成有边界的继续信号",
        onFail: "最小验证失败，回到候选或协议修改",
      },
    ],
    controls: [
      {
        id: "sample-identity-control",
        label: "样本身份与分组一致性",
        methodControl: "样本身份检查",
        role: "排除身份错配和标签交换",
        acceptanceCriterion: "全部纳入样本身份与冻结元数据一致",
        failureAction: "停止分析并更正样本映射后生成新协议版本",
      },
      {
        id: "batch-condition-control",
        label: "批次与条件可分辨性",
        methodControl: "批次与条件列联检查",
        role: "识别批次与研究条件完全混杂",
        acceptanceCriterion: "设计矩阵满秩且关键批次不与条件完全重合",
        failureAction: "终止当前对比；不得把批次效应解释为条件差异",
      },
      {
        id: "technical-reference-control",
        label: "技术参考样本稳定性",
        methodControl: "已知技术控制或参考样本",
        role: "监测测量漂移和方向错误",
        acceptanceCriterion: "参考样本位于预注册容许区间",
        failureAction: "质量控制失败并排查测量平台",
      },
    ],
    failureCriteria: [
      {
        id: "qc-failure",
        criterion: "任一必需对照失败或未评估",
        consequence: "结果不可判定，不能用阈值通过覆盖质量失败",
      },
      {
        id: "threshold-failure",
        criterion: "FDR 或绝对效应量任一未达标",
        consequence: "记录最小验证失败，不把缺乏支持写成已证明无效",
      },
    ],
    stopRules: [
      {
        id: "stop-confounding",
        trigger: "发现关键批次与条件完全混杂",
        action: "立即停止当前对比并返回领域认识层记录不可判定边界",
      },
      {
        id: "stop-identity",
        trigger: "样本身份无法确认",
        action: "不运行统计模型，等待可审计元数据",
      },
    ],
    additionalAlternativeExplanations: [
      "条件 A 观察到的信号可能由采样时点差异解释",
      "目标特征变化可能反映细胞组成而非细胞内调控",
    ],
    evidenceCollectionPlan: [
      {
        componentId: "qc_qualified_expression_matrix",
        collectionMethod: "导入样本与特征 QC 报告并记录保留/排除审计",
        sourceArtifactType: "DataAudit",
        completionCriterion: "所有纳入样本通过冻结的身份、库质量与过滤规则",
      },
      {
        componentId: "design_adjusted_contrast",
        collectionMethod: "导入冻结设计矩阵、对比向量、系数与区间",
        sourceArtifactType: "AnalysisRun",
        completionCriterion: "对比、协变量和模型版本与协议指纹一致",
      },
      {
        componentId: "multiplicity_controlled_results",
        collectionMethod: "导入完整特征表及多重检验校正字段",
        sourceArtifactType: "ComputationalEvidenceBundle",
        completionCriterion: "全部被检验特征均保留原始与调整后 P 值",
      },
    ],
    modificationPaths: [
      {
        id: "modify-design",
        trigger: "设计混杂或模型不适配",
        action: "修改研究问题或获取可分辨的新数据，生成新协议版本",
        rationale: "避免在不可识别设计上调整阈值追逐阳性结果",
      },
      {
        id: "modify-candidate",
        trigger: "阈值失败但替代解释仍可检验",
        action: "缩小候选范围或提出区分替代解释的新最小测试",
        rationale: "失败用于更新领域认识，而不是事后改写原假设",
      },
    ],
    terminationPath: "将失败条件、适用范围和替代解释写回领域认识，终止该验证分支。",
    retestPath: "在独立队列上用同一冻结阈值复现；若修改协议则明确标为新版本。",
    executionAdapterId: "cwl-workflow-adapter",
  };
}

function makeDraftProtocol(plan = makePlan()) {
  return createIdeaValidationProtocol({
    plan,
    methodPack: BIOINFORMATICS_DIFFERENTIAL_EXPRESSION_TEMPLATE_V1,
    protocolSpec: protocolSpec(),
    now: TIME,
  });
}

function releaseProtocol(draft = makeDraftProtocol()) {
  return releaseIdeaValidationProtocol({
    protocol: draft,
    releaseReceipt: humanReceipt({
      subjectType: "IdeaValidationProtocol",
      subjectId: draft.id,
      subjectHash: draft.protocolFingerprint,
      decision: "release_external_execution",
      reason: "阈值、对照、失败标准、替代解释和停止规则均已在看结果前冻结。",
    }),
  });
}

function externalResult(protocol, overrides = {}) {
  return {
    originAttestation: EXTERNAL_RESULT_ORIGIN_ATTESTATION,
    protocolFingerprint: protocol.protocolFingerprint,
    executor: { id: "workflow-runner-7", role: "external_bioinformatics_workflow", kind: "external_system" },
    sourceLocator: "fixture://externally-supplied/run-007/result-bundle",
    protocolVersion: "1.0.0",
    parameterSet: { design: "~ batch + condition", contrast: "condition_A_vs_control", fdr: 0.05 },
    validationType: "minimal_pre_registered_analysis",
    startTime: "2026-08-13T06:00:00.000Z",
    endTime: "2026-08-13T07:00:00.000Z",
    inputHash: sha256("external-input-bundle-run-007"),
    outputHash: sha256("external-output-bundle-run-007"),
    deviations: [],
    observations: [
      {
        metricId: "target_adjusted_p_value",
        value: 0.012,
        unit: "proportion",
        evidenceLocator: "fixture://externally-supplied/run-007/full-results.tsv#target",
      },
      {
        metricId: "target_absolute_log2_fold_change",
        value: 1.28,
        unit: "absolute log2 fold change",
        evidenceLocator: "fixture://externally-supplied/run-007/full-results.tsv#target",
      },
    ],
    evidenceComponents: [
      {
        componentId: "qc_qualified_expression_matrix",
        status: "observed",
        summary: "外部运行附带了通过冻结 QC 的表达矩阵快照。",
        evidenceLocator: "fixture://externally-supplied/run-007/data-audit.json",
      },
      {
        componentId: "design_adjusted_contrast",
        status: "observed",
        summary: "外部运行记录了设计矩阵、对比和模型输出。",
        evidenceLocator: "fixture://externally-supplied/run-007/model.json",
      },
      {
        componentId: "multiplicity_controlled_results",
        status: "observed",
        summary: "外部运行提供了完整多重校正结果表。",
        evidenceLocator: "fixture://externally-supplied/run-007/full-results.tsv",
      },
    ],
    qualityChecks: [
      {
        controlId: "sample-identity-control",
        status: "pass",
        details: "外部审计报告中所有样本标识与冻结元数据一致。",
        evidenceLocator: "fixture://externally-supplied/run-007/qc.json#identity",
      },
      {
        controlId: "batch-condition-control",
        status: "pass",
        details: "外部设计审计显示矩阵满秩且不存在完全混杂。",
        evidenceLocator: "fixture://externally-supplied/run-007/qc.json#design",
      },
      {
        controlId: "technical-reference-control",
        status: "pass",
        details: "外部报告中的参考样本位于预注册容许区间。",
        evidenceLocator: "fixture://externally-supplied/run-007/qc.json#reference",
      },
    ],
    ...overrides,
  };
}

test("idea validation is contractually separate from source-claim evidence verification", () => {
  assert.match(IDEA_VALIDATION_INTERFACE_V1.separationRule.evidenceVerification, /来源/);
  assert.match(IDEA_VALIDATION_INTERFACE_V1.separationRule.ideaValidation, /最小/);
  assert.ok(
    IDEA_VALIDATION_INTERFACE_V1.invariants.includes("运行时不得生成、推测或补写实验与分析数据"),
  );
});

test("a selected IdeaCandidate becomes a method-bound plan with human release points", () => {
  const plan = makePlan();

  assert.deepEqual(validateIdeaValidationPlan(plan), []);
  assert.equal(plan.status, "planned");
  assert.equal(plan.validationKind, "idea_minimal_test");
  assert.deepEqual(plan.targetClaim.minimumEvidenceComponentIds, [
    "qc_qualified_expression_matrix",
    "design_adjusted_contrast",
    "multiplicity_controlled_results",
  ]);
  assert.equal(plan.humanReleasePoints.length, 3);
  assert.equal(plan.methodFit.humanReleaseRequired, true);
  assert.ok(plan.targetClaim.cannotEstablish.includes("基因因果作用"));
});

test("the protocol freezes thresholds, controls, failures, alternatives and routes before release", () => {
  const draft = makeDraftProtocol();

  assert.deepEqual(validateIdeaValidationProtocol(draft), []);
  assert.equal(draft.status, "awaiting_human_release");
  assert.equal(draft.executionAllowed, false);
  assert.equal(draft.decisionThresholds.length, 2);
  assert.equal(draft.controls.length, 3);
  assert.equal(draft.failureCriteria.length, 2);
  assert.ok(draft.alternativeExplanations.includes("技术批次"));
  assert.equal(draft.modificationPaths.length, 2);
  assert.match(draft.executionBoundary, /不生成/);

  const released = releaseProtocol(draft);
  assert.equal(released.status, "ready_for_external_execution");
  assert.equal(released.executionAllowed, true);
  assert.equal(released.protocolFingerprint, draft.protocolFingerprint);
});

test("a structured external bioinformatics result can yield only a bounded continuation signal", () => {
  const plan = makePlan();
  const protocol = releaseProtocol(makeDraftProtocol(plan));
  const result = recordIdeaValidationResult({
    protocol,
    externalResult: externalResult(protocol),
    now: TIME,
  });

  assert.deepEqual(validateIdeaValidationResult(result), []);
  assert.equal(result.status, "completed");
  assert.equal(result.outcome, "supports_continuation");
  assert.equal(result.ideaEstablished, false);
  assert.ok(result.thresholdAssessments.every((item) => item.status === "pass"));
  assert.match(result.interpretationBoundary, /不代表/);

  const awaiting = createIdeaValidationDecision({ plan, protocol, result, now: TIME });
  assert.equal(awaiting.status, "awaiting_human_decision");
  assert.equal(awaiting.action, null);
  assert.equal(awaiting.domainKnowledgeFeedback.knowledgeStatus, "bounded_signal_only");

  const decision = createIdeaValidationDecision({
    plan,
    protocol,
    result,
    decisionReceipt: humanReceipt({
      subjectType: "IdeaValidationResult",
      subjectId: result.id,
      subjectHash: result.resultFingerprint,
      decision: "continue",
      reason: "最小门槛与质量条件通过，但需要独立队列复现，不能升级为已成立。",
    }),
    now: TIME,
  });

  assert.deepEqual(validateIdeaValidationDecision(decision), []);
  assert.equal(decision.status, "decided");
  assert.equal(decision.action, "continue");
  assert.equal(
    decision.domainKnowledgeFeedback.candidateStatusAfterFeedback,
    "unvalidated_hypothesis",
  );
  assert.ok(decision.domainKnowledgeFeedback.prohibitedClaims.includes("候选想法已经成立"));
  assert.match(decision.domainKnowledgeFeedback.nextPath, /独立队列/);

  const artifacts = ideaValidationBuildToArtifacts({ plan, protocol, result, decision });
  assert.deepEqual(artifacts.map((item) => item.type), [
    "IdeaValidationPlan",
    "IdeaValidationProtocol",
    "IdeaValidationResult",
    "IdeaValidationDecision",
  ]);
});

test("missing or unreleased external results stay blocked and never acquire observations", () => {
  const draft = makeDraftProtocol();
  const unreleased = recordIdeaValidationResult({
    protocol: draft,
    externalResult: externalResult(draft),
    now: TIME,
  });
  assert.equal(unreleased.status, "blocked");
  assert.equal(unreleased.blockReason.code, "PROTOCOL_NOT_RELEASED");
  assert.deepEqual(unreleased.observations, []);
  assert.equal(unreleased.ideaEstablished, false);

  const protocol = releaseProtocol(draft);
  const missing = recordIdeaValidationResult({ protocol, now: TIME });
  assert.equal(missing.status, "blocked");
  assert.equal(missing.blockReason.code, "EXTERNAL_RESULT_MISSING");
  assert.equal(missing.externalProvenance, null);
  assert.deepEqual(missing.thresholdAssessments, []);
});

test("threshold failure returns to modification or termination and forbids continue", () => {
  const plan = makePlan();
  const protocol = releaseProtocol(makeDraftProtocol(plan));
  const failedExternal = externalResult(protocol, {
    outputHash: sha256("external-output-bundle-run-008"),
    observations: [
      {
        metricId: "target_adjusted_p_value",
        value: 0.23,
        unit: "proportion",
        evidenceLocator: "fixture://externally-supplied/run-008/full-results.tsv#target",
      },
      {
        metricId: "target_absolute_log2_fold_change",
        value: 0.34,
        unit: "absolute log2 fold change",
        evidenceLocator: "fixture://externally-supplied/run-008/full-results.tsv#target",
      },
    ],
  });
  const result = recordIdeaValidationResult({ protocol, externalResult: failedExternal, now: TIME });
  assert.equal(result.status, "completed");
  assert.equal(result.outcome, "fails_minimum_test");
  assert.ok(result.thresholdAssessments.every((item) => item.status === "fail"));

  assert.throws(
    () =>
      createIdeaValidationDecision({
        plan,
        protocol,
        result,
        decisionReceipt: humanReceipt({
          subjectType: "IdeaValidationResult",
          subjectId: result.id,
          subjectHash: result.resultFingerprint,
          decision: "continue",
          reason: "这个决定应该被拒绝。",
        }),
        now: TIME,
      }),
    (error) => error instanceof IdeaValidationError && error.code === "DECISION_NOT_ALLOWED",
  );

  const decision = createIdeaValidationDecision({
    plan,
    protocol,
    result,
    decisionReceipt: humanReceipt({
      subjectType: "IdeaValidationResult",
      subjectId: result.id,
      subjectHash: result.resultFingerprint,
      decision: "modify",
      reason: "保留失败条件，区分混杂与真实小效应后再设计新协议。",
    }),
    now: TIME,
  });
  assert.equal(decision.domainKnowledgeFeedback.knowledgeStatus, "minimum_test_failed");
  assert.match(decision.domainKnowledgeFeedback.proposedUpdate, /未达到/);
  assert.ok(decision.domainKnowledgeFeedback.alternativeExplanations.includes("细胞组成差异"));
  assert.match(decision.domainKnowledgeFeedback.nextPath, /生成新协议版本/);
});

test("quality-control failure overrides passing thresholds", () => {
  const protocol = releaseProtocol();
  const external = externalResult(protocol);
  external.qualityChecks = external.qualityChecks.map((item) =>
    item.controlId === "batch-condition-control"
      ? {
          ...item,
          status: "fail",
          details: "外部审计发现批次与条件完全混杂。",
        }
      : item,
  );
  external.outputHash = sha256("external-output-with-qc-failure");

  const result = recordIdeaValidationResult({ protocol, externalResult: external, now: TIME });
  assert.equal(result.status, "failed_quality_control");
  assert.equal(result.outcome, "inconclusive");
  assert.equal(result.ideaEstablished, false);
  assert.ok(result.thresholdAssessments.every((item) => item.status === "pass"));
});

test("external provenance is mandatory and wet-lab ethics gaps block planning", () => {
  const protocol = releaseProtocol();
  const untrusted = externalResult(protocol);
  delete untrusted.originAttestation;
  assert.throws(
    () => recordIdeaValidationResult({ protocol, externalResult: untrusted, now: TIME }),
    (error) => error instanceof IdeaValidationError && error.code === "INVALID_EXTERNAL_RESULT",
  );

  const value = candidate({ id: "idea-wet-lab-001" });
  const wetPlan = createIdeaValidationPlan({
    candidate: value,
    methodPack: WET_LAB_TARGET_MEDIATION_TEMPLATE_V1,
    validationQuestion: {
      questionType: "mechanism_test",
      intendedClaimType: "target_specific_functional_mediation",
      proposition: "干预物通过候选靶点介导动物模型中的预定义表型。",
      scope: "仅限当前动物模型、暴露和测量体系。",
      requiredEvidenceComponents: [],
      contextTags: ["animal"],
    },
    availability: {
      prerequisiteIds: [
        "defined_intervention",
        "validated_model",
        "validated_reagents",
        "analysis_plan",
      ],
    },
    selectionReceipt: selectionReceipt(value),
    now: TIME,
  });
  assert.equal(wetPlan.status, "blocked");
  assert.ok(wetPlan.blockers.some((item) => item.includes("伦理批准")));
  assert.throws(
    () =>
      createIdeaValidationProtocol({
        plan: wetPlan,
        methodPack: WET_LAB_TARGET_MEDIATION_TEMPLATE_V1,
        protocolSpec: {},
        now: TIME,
      }),
    (error) => error instanceof IdeaValidationError && error.code === "PLAN_BLOCKED",
  );
});
