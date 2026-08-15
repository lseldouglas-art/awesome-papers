import { sha256 } from "./event-engine-v1.js";
import { createAuthoritativeExportManifest } from "./export-authority-v1.js";
import { createAuthorSignoffContents } from "./export-authority-v1.js";
import { createDeterministicManuscriptDraft } from "./manuscript-authority-v1.js";

const SCHEMA_VERSION = "1.0.0";
const DEFAULT_BOUNDARIES = Object.freeze([
  "只使用工作单列出的材料；未提供的信息保持未知。",
  "自动产物是候选科研对象，不等同于研究者批准或作者签署。",
]);
const GUIDED_SIMULATION_AUTHORITY = Object.freeze({
  class: "simulation",
  authoritative: false,
  finality: "non_authoritative",
  runtimeMode: "guided",
  inheritance: "rebuild_in_live_run",
  label: "流程演练（非正式科研产物）",
  boundary:
    "该产物只证明工作台流程能够运行，不代表科学审计通过；正式研究必须在全新的 live run 中从来源重新构建。",
});

function guidedSimulationAuthority() {
  return { ...GUIDED_SIMULATION_AUTHORITY };
}

function hasGuidedSimulationAuthority(content) {
  return (
    content?.authority?.class === "simulation" &&
    content.authority.authoritative === false &&
    content.authority.finality === "non_authoritative"
  );
}

function contractType(contract) {
  return contract.split("@")[0].replace(/\[\]$/, "");
}

function isArrayContract(contract) {
  return contract.split("@")[0].endsWith("[]");
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function sourceMaterials(project) {
  return Array.isArray(project.sourceMaterials) ? project.sourceMaterials : [];
}

function currentRetrievalRuns(project) {
  return Array.isArray(project?.currentRetrievalRuns)
    ? project.currentRetrievalRuns
    : [];
}

function previewSentinelSourceIds(project) {
  const selection = project?.retrievalRuns?.previewSelection;
  if (selection?.candidateStatus !== "ready") return [];
  const sampleIds = new Set(
    (Array.isArray(selection.samples) ? selection.samples : [])
      .map((sample) => sample?.sourceId)
      .filter(hasText),
  );
  return [
    ...new Set(
      (Array.isArray(selection.sampleSourceIds)
        ? selection.sampleSourceIds
        : []
      ).filter(
        (sourceId) =>
          hasText(sourceId) &&
          !/^sentinel:/i.test(sourceId.trim()) &&
          sampleIds.has(sourceId),
      ),
    ),
  ];
}

function retrievalRun(project, slot = 1) {
  return currentRetrievalRuns(project)[slot - 1] ?? null;
}

function liveRetrieval(project, slot = 1) {
  return retrievalRun(project, slot)?.receipt ?? null;
}

function isLivePubMedProject(project) {
  return project?.researchMode === "live_pubmed";
}

function artifactId(projectId, nodeId, type, slot, version) {
  return `artifact:${projectId}:${nodeId}:${type}:${slot}:v${version}`;
}

function lineageId(projectId, nodeId, type, slot) {
  return `lineage:${projectId}:${nodeId}:${type}:${slot}`;
}

function outputCount(contract, project, inputArtifacts) {
  if (!isArrayContract(contract)) return 1;
  const type = contractType(contract);
  if (["ResearchQuestionCandidate", "ReviewAngleCandidate"].includes(type)) return 2;
  if (type === "FocusedSearchRunSnapshot") {
    return Math.max(1, currentRetrievalRuns(project).length);
  }
  if (
    [
      "OrientationSourceSnapshot",
      "SourceSnapshot",
      "EvidenceRecord",
      "AppraisalRecord",
    ].includes(type)
  ) {
    return Math.min(sourceMaterials(project).length, 8);
  }
  if (type === "ClaimUnitDraft") {
    const plan = inputArtifacts.find((artifact) => artifact.type === "FrozenWritingPlan");
    return Math.max(1, plan?.content?.claimUnitPlans?.length ?? 0);
  }
  if (["ClaimVerificationResult", "AcceptedClaimUnit"].includes(type)) {
    const draftCount = inputArtifacts.filter(
      (artifact) => artifact.type === "ClaimUnitDraft",
    ).length;
    return Math.max(1, draftCount);
  }
  return 1;
}

function currentVersionForLineage(state, targetLineageId) {
  const versions = Object.values(state.artifacts)
    .filter((artifact) => artifact.lineageId === targetLineageId)
    .map((artifact) => artifact.version);
  return versions.length === 0 ? 1 : Math.max(...versions) + 1;
}

export function buildRequiredOutputs({ machine, state, node, project, inputArtifacts }) {
  return node.outputs.flatMap((contract) => {
    const type = contractType(contract);
    const count = outputCount(contract, project, inputArtifacts);
    return Array.from({ length: count }, (_, index) => {
      const slot = index + 1;
      const lineId = lineageId(project.id, node.id, type, slot);
      const version = currentVersionForLineage(state, lineId);
      return {
        contract,
        type,
        slot,
        lineageId: lineId,
        version,
        artifactId: artifactId(project.id, node.id, type, slot, version),
      };
    });
  });
}

export function buildWorkOrder({
  machine,
  state,
  node,
  project,
  inputArtifacts,
  runtimeMode,
  createdAt,
  recentRunEvents = [],
  revisionRequest = null,
}) {
  const requiredOutputs = buildRequiredOutputs({
    machine,
    state,
    node,
    project,
    inputArtifacts,
  });
  const payload = {
    id: `work-order:${project.id}:${node.id}:${state.revision + 1}`,
    projectId: project.id,
    nodeId: node.id,
    phaseId: node.phaseId,
    userLabel: node.userLabel,
    role: node.executorRole ?? "research_intake_agent",
    reviewerRole: node.reviewerRole ?? "independent_research_reviewer",
    objective: node.purpose,
    inputArtifacts: inputArtifacts.map((artifact) => ({
      id: artifact.id,
      type: artifact.type,
      version: artifact.version,
      contentHash: artifact.contentHash,
      content: artifact.content,
    })),
    requiredOutputs,
    acceptanceCriteria: [...node.acceptanceCriteria],
    allowedToolIds: [
      "inspect_work_order",
      "artifact_read",
      "submit_artifacts",
      ...(node.phaseId === "literature_research"
        ? ["research_search", "research_fetch", "citation_verify"]
        : []),
      ...(node.phaseId === "writing_and_verification"
        ? ["citation_verify"]
        : []),
    ],
    budget: {
      maxTurns: 8,
      maxToolCalls: 12,
      maxSources: 20,
    },
    runtimeMode,
    project: {
      id: project.id,
      title: project.title,
      question: project.question,
      target: project.completionProfileId,
      constraints: project.constraints ?? [],
      researchMode: project.researchMode ?? "guided_materials",
      searchQuery: project.searchQuery ?? null,
      searchLimit: project.searchLimit ?? 8,
      retrievalRuns:
        project.retrievalRuns && typeof project.retrievalRuns === "object"
          ? structuredClone(project.retrievalRuns)
          : {},
      currentRetrievalRuns: structuredClone(currentRetrievalRuns(project)),
      sourceMaterials: sourceMaterials(project),
    },
    recentRunEvents: recentRunEvents.slice(-8),
    revisionRequest: revisionRequest ? structuredClone(revisionRequest) : null,
    createdAt,
  };
  return {
    ...payload,
    contextSnapshotHash: sha256(payload),
  };
}

function materialForSlot(workOrder, slot) {
  const materials = sourceMaterials(workOrder.project);
  return materials[slot - 1] ?? null;
}

function snapshotFromMaterial(workOrder, output) {
  const material = materialForSlot(workOrder, output.slot);
  if (!material) {
    return {
      id: output.artifactId,
      sourceId: `missing-source:${output.slot}`,
      title: "尚未提供来源材料",
      text: null,
      accessLevel: "title_only",
      sourceSnapshotHash: sha256(`missing-source:${workOrder.projectId}:${output.slot}`),
      locator: { repositoryId: `project:${workOrder.projectId}:materials` },
      limitations: ["当前项目没有可读取的来源材料。"],
    };
  }
  return {
    id: output.artifactId,
    sourceId: material.id,
    provider: material.provider ?? null,
    pmid: material.pmid ?? material.locator?.pmid ?? null,
    doi: material.doi ?? material.locator?.doi ?? null,
    title: material.title,
    text: material.text,
    abstract: material.accessLevel === "abstract_only" ? material.text : null,
    accessLevel: material.accessLevel,
    sourceSnapshotHash: material.sourceSnapshotHash,
    locator: material.locator,
    journal: material.journal ?? null,
    year: material.year ?? null,
    limitations: material.limitations ?? [],
  };
}

function genericContent(workOrder, output) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: output.artifactId,
    version: output.version,
    artifactType: output.type,
    projectId: workOrder.projectId,
    question: workOrder.project.question,
    title: `${workOrder.userLabel} · ${output.type}`,
    summary: `围绕“${workOrder.project.question}”形成的 ${output.type} 候选版本。`,
    inputs: workOrder.inputArtifacts.map((artifact) => ({
      id: artifact.id,
      type: artifact.type,
      contentHash: artifact.contentHash,
    })),
    sourceMaterials: sourceMaterials(workOrder.project).map((material) => ({
      id: material.id,
      title: material.title,
      accessLevel: material.accessLevel,
      sourceSnapshotHash: material.sourceSnapshotHash,
      locator: material.locator,
    })),
    boundaries: [...DEFAULT_BOUNDARIES],
    ...(workOrder.revisionRequest
      ? { revisionRequest: structuredClone(workOrder.revisionRequest) }
      : {}),
    createdAt: workOrder.createdAt,
  };
}

function artifactFingerprint(artifact, content = artifact?.content) {
  return {
    artifactId: artifact?.id ?? "artifact:pending",
    artifactType: artifact?.type ?? "UnknownArtifact",
    version: artifact?.version ?? 1,
    contentHash: artifact?.contentHash ?? sha256(content ?? { pending: true }),
  };
}

function upstreamFingerprints(workOrder) {
  return workOrder.inputArtifacts.map((artifact) => artifactFingerprint(artifact));
}

function commonSearchMethod(workOrder, output, query) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: output.artifactId,
    version: output.version,
    provider: "pubmed",
    database: "PubMed",
    createdAt: workOrder.createdAt,
    fields: ["all_fields", "title_abstract"],
    timeRange: { basis: "none", from: null, to: null },
    languages: ["all"],
    inclusionCriteria: ["题名或摘要与已批准研究问题直接相关。"],
    exclusionCriteria: ["仅题名重合但研究对象或关系不相关。"],
    stopRules: ["达到当前检索预算，且新增样本不再改变边界判断。"],
    upstreamArtifactFingerprints: upstreamFingerprints(workOrder),
    query,
    queryHash: sha256(query),
  };
}

function formalRetrievalRuns(workOrder, purpose = null) {
  const current = currentRetrievalRuns(workOrder.project);
  const stored = workOrder.project?.retrievalRuns ?? {};
  const all = current.length > 0
    ? current
    : [
        stored.pilot,
        stored.orientationCorpus,
        ...(Array.isArray(stored.focusedCalibration) ? stored.focusedCalibration : []),
        stored.finalLibrary,
      ].filter(Boolean);
  return purpose ? all.filter((run) => run.purpose === purpose) : all;
}

function retrievalRunReference(run) {
  return {
    purpose: run.purpose,
    nodeId: run.nodeId,
    protocolArtifactId: run.protocolArtifactId,
    protocolContentHash: run.protocolContentHash,
    queryId: run.queryId,
    query: run.query,
    queryHash: run.queryHash,
    receiptHash: run.receipt.receiptHash,
  };
}

function protocolFingerprint(workOrder, type) {
  return artifactFingerprint(
    workOrder.inputArtifacts.find((artifact) => artifact.type === type),
  );
}

function contentForType(workOrder, output) {
  const base = genericContent(workOrder, output);
  const sources = sourceMaterials(workOrder.project);
  const evidenceInputs = workOrder.inputArtifacts.filter(
    (artifact) => artifact.type === "EvidenceRecord",
  );
  const conclusionInputs = workOrder.inputArtifacts.filter(
    (artifact) => artifact.type === "ResearchConclusionCard",
  );
  const findInput = (type) =>
    workOrder.inputArtifacts.find((artifact) => artifact.type === type);
  const findInputs = (type) =>
    workOrder.inputArtifacts.filter((artifact) => artifact.type === type);

  if (output.type === "ExportManifest") {
    const deliveryOutput = workOrder.requiredOutputs.find(
      (candidate) => candidate.type === "DeliveryBundle",
    );
    const manifest = createAuthoritativeExportManifest({
      id: output.artifactId,
      version: output.version,
      project: workOrder.project,
      artifacts: workOrder.inputArtifacts,
      deliveryBundleId: deliveryOutput?.artifactId ?? "missing-delivery-bundle",
      generatedAt: workOrder.createdAt,
    });
    return {
      ...manifest,
      status: "simulation_pending_signoff",
      authority: guidedSimulationAuthority(),
      displayNotice:
        "这是受限流程演练清单，不是经科学审计通过的正式导出清单。",
    };
  }

  switch (output.type) {
    case "ResearchIntent":
      return {
        ...base,
        researchQuestion: workOrder.project.question,
        intendedDeliverable: workOrder.project.target,
        constraints: workOrder.project.constraints,
        materialCount: sources.length,
      };

    case "ResearchQuestionCandidate":
      return {
        ...base,
        candidateNumber: output.slot,
        question:
          output.slot === 1
            ? workOrder.project.question
            : `${workOrder.project.question}（优先描述证据范围、研究对象与可观察结果）`,
        avoidsPresetConclusion: true,
      };

    case "ScopeBoundary":
      return {
        ...base,
        inScope: ["当前研究问题", "PubMed 真实检索结果", "可追溯的题录与摘要信息"],
        outOfScope: ["个体临床建议", "摘要未报告的精确数值", "未经核查的强因果结论"],
      };

    case "OrientationConceptMatrix": {
      const query = workOrder.project.searchQuery ?? workOrder.project.question;
      return {
        ...base,
        ...commonSearchMethod(workOrder, output, query),
        conceptGroups: [
          {
            id: "orientation:approved-question",
            label: "已批准研究问题",
            rationale: "保留研究者批准的问题原貌，避免自动扩展改变研究方向。",
            terms: [query],
          },
        ],
        sentinelSourceIds: previewSentinelSourceIds(workOrder.project),
      };
    }

    case "OrientationSearchProtocol": {
      const query = workOrder.project.searchQuery ?? workOrder.project.question;
      const concept = findInput("OrientationConceptMatrix") ?? workOrder.inputArtifacts[0];
      return {
        ...base,
        ...commonSearchMethod(workOrder, output, query),
        queryId: "orientation:primary",
        conceptMatrixFingerprint: artifactFingerprint(concept),
        accessPolicy: "题名与摘要优先；精确数值、强因果与正式写作按需升级全文。",
        samplingRule: "按 PubMed 返回顺序读取当前预算内的题名与摘要。",
      };
    }

    case "OrientationCalibrationReport": {
      const protocol = findInput("OrientationSearchProtocol");
      const runs = formalRetrievalRuns(workOrder, "pilot");
      const selected = runs[0];
      const sampleIds = [
        ...new Set(
          runs.flatMap((run) =>
            (run.receipt?.records ?? [])
              .map((record) => record.sourceId ?? record.id)
              .filter(hasText),
          ),
        ),
      ];
      const sentinelIds = previewSentinelSourceIds(workOrder.project);
      const sentinelChecks = sentinelIds.map((sourceId) => ({
        sourceId,
        retrieved: sampleIds.includes(sourceId),
        note: sampleIds.includes(sourceId)
          ? "该预检登记文献出现在绑定的真实试检回执中。"
          : "该预检登记文献未出现在绑定的真实试检回执中，必须修订后重跑。",
      }));
      const allSentinelsRetrieved =
        sentinelChecks.length > 0 && sentinelChecks.every((check) => check.retrieved);
      const query = selected?.query ?? protocol?.content?.query ?? workOrder.project.question;
      return {
        ...base,
        ...commonSearchMethod(workOrder, output, query),
        protocolFingerprint: artifactFingerprint(protocol),
        retrievalRunRefs: runs.map(retrievalRunReference),
        sampleSourceIds: sampleIds,
        checkedCount: sampleIds.length,
        noiseAssessment: [{
          id: "noise:pilot",
          description: allSentinelsRetrieved
            ? "当前抽样未识别需改变研究边界的主要噪声。"
            : "预检登记文献未全部召回，当前检索式不能冻结。",
          count: allSentinelsRetrieved ? 0 : sentinelChecks.filter((check) => !check.retrieved).length,
        }],
        sentinelChecks,
        revisionDecision: allSentinelsRetrieved ? "keep" : "revise",
        selectedQuery: {
          id: selected?.queryId ?? "orientation:primary",
          purpose: "领域探索主查询",
          query,
          queryHash: sha256(query),
        },
        stopReason: allSentinelsRetrieved
          ? "真实试检已保存且预检登记文献均已召回，当前样本足以冻结领域探索协议。"
          : "预检登记文献未全部召回；停止冻结并请求修订检索式。",
      };
    }

    case "FrozenOrientationSearchProtocol": {
      const protocol = workOrder.inputArtifacts.find(
        (artifact) => artifact.type === "OrientationSearchProtocol",
      );
      const calibration = findInput("OrientationCalibrationReport");
      const run = formalRetrievalRuns(workOrder, "pilot")[0];
      const sentinelIds = previewSentinelSourceIds(workOrder.project);
      const retrievedIds = new Set(
        (run?.receipt?.records ?? [])
          .map((record) => record.sourceId ?? record.id)
          .filter(hasText),
      );
      const canFreeze =
        sentinelIds.length > 0 && sentinelIds.every((sourceId) => retrievedIds.has(sourceId));
      const query = run?.query ?? protocol?.content?.query ?? workOrder.project.searchQuery ?? workOrder.project.question;
      return {
        ...base,
        ...commonSearchMethod(workOrder, output, query),
        parentProtocolFingerprint: artifactFingerprint(protocol),
        calibrationFingerprint: artifactFingerprint(calibration),
        selectedExecution: run ? retrievalRunReference(run) : {},
        frozenAt: workOrder.createdAt,
        freezeReason: canFreeze
          ? "基于真实试检回执且预检登记文献均已召回，冻结领域探索协议。"
          : "未冻结：缺少可核对的预检哨兵或存在未召回哨兵，必须修订后重跑。",
        accessPolicy: protocol?.content?.accessPolicy ?? "题名与摘要优先。",
      };
    }

    case "FocusedConceptMatrix": {
      const query = workOrder.project.searchQuery ?? workOrder.project.question;
      return {
        ...base,
        ...commonSearchMethod(workOrder, output, query),
        conceptGroups: [{ id: "focused:selected-angle", label: "选定综述切口", rationale: "严格继承研究者选择的深挖方向。", terms: [query] }],
        sentinelSourceIds: previewSentinelSourceIds(workOrder.project),
        focusedRelation: workOrder.project.question,
      };
    }

    case "FocusedSearchProtocol": {
      const query = workOrder.project.searchQuery ?? workOrder.project.question;
      return {
        ...base,
        ...commonSearchMethod(workOrder, output, query),
        primaryQueryId: "focused:core",
        conceptMatrixFingerprint: artifactFingerprint(findInput("FocusedConceptMatrix") ?? workOrder.inputArtifacts[0]),
        queryVariants: [
          { id: "focused:core", purpose: "核心检索", query, queryHash: sha256(query) },
          {
            id: "focused:abstract-available",
            purpose: "摘要可读性校准",
            query: `(${query}) AND hasabstract`,
            queryHash: sha256(`(${query}) AND hasabstract`),
          },
        ],
        accessPolicy: "题名与摘要优先；两个候选式分别保存真实回执后再冻结。",
        samplingRule: "分别抽查核心式与摘要可读性式的真实返回记录。",
      };
    }

    case "FocusedCalibrationReport": {
      const protocol = findInput("FocusedSearchProtocol");
      const runs = formalRetrievalRuns(workOrder, "focusedCalibration");
      const selected = runs[0];
      const sampleIds = [...new Set(runs.flatMap((run) =>
        (run.receipt?.records ?? [])
          .map((record) => record.sourceId ?? record.id)
          .filter(hasText),
      ))];
      const query = selected?.query ?? protocol?.content?.query ?? workOrder.project.question;
      const sentinelIds = previewSentinelSourceIds(workOrder.project);
      const sentinelChecks = sentinelIds.map((sourceId) => ({
        sourceId,
        retrieved: sampleIds.includes(sourceId),
        note: sampleIds.includes(sourceId)
          ? "该预检登记文献出现在绑定的真实精准校准回执中。"
          : "该预检登记文献未出现在绑定的真实精准校准回执中，必须修订后重跑。",
      }));
      const allSentinelsRetrieved =
        sentinelChecks.length > 0 && sentinelChecks.every((check) => check.retrieved);
      return {
        ...base,
        ...commonSearchMethod(workOrder, output, query),
        protocolFingerprint: artifactFingerprint(protocol),
        retrievalRunRefs: runs.map(retrievalRunReference),
        sampleSourceIds: sampleIds,
        checkedCount: sampleIds.length,
        noiseAssessment: [{
          id: "noise:focused",
          description: allSentinelsRetrieved
            ? "比较两个真实候选式后，预检登记文献均已召回。"
            : "预检登记文献未全部召回，当前候选式不能冻结。",
          count: allSentinelsRetrieved ? 0 : sentinelChecks.filter((check) => !check.retrieved).length,
        }],
        sentinelChecks,
        revisionDecision: allSentinelsRetrieved ? "keep" : "revise",
        selectedQuery: { id: selected?.queryId ?? "focused:core", purpose: "核心检索", query, queryHash: sha256(query) },
        stopReason: allSentinelsRetrieved
          ? "候选查询均已真实执行并保存回执，预检登记文献均已召回。"
          : "预检登记文献未全部召回；停止冻结并请求修订候选查询。",
      };
    }

    case "FrozenSearchProtocol": {
      const protocol = workOrder.inputArtifacts.find(
        (artifact) => artifact.type === "FocusedSearchProtocol",
      );
      const variants = Array.isArray(protocol?.content?.queryVariants)
        ? protocol.content.queryVariants
        : [];
      const selected = variants[0]?.query ?? protocol?.content?.query ?? workOrder.project.searchQuery ?? workOrder.project.question;
      const run = formalRetrievalRuns(workOrder, "focusedCalibration")[0];
      const sentinelIds = previewSentinelSourceIds(workOrder.project);
      const retrievedIds = new Set(
        formalRetrievalRuns(workOrder, "focusedCalibration")
          .flatMap((candidateRun) => candidateRun.receipt?.records ?? [])
          .map((record) => record.sourceId ?? record.id)
          .filter(hasText),
      );
      const canFreeze =
        sentinelIds.length > 0 && sentinelIds.every((sourceId) => retrievedIds.has(sourceId));
      return {
        ...base,
        ...commonSearchMethod(workOrder, output, selected),
        selectedQuery: selected,
        selectedQueryId: variants[0]?.id ?? "focused:query:1",
        parentProtocolFingerprint: artifactFingerprint(protocol),
        calibrationFingerprint: artifactFingerprint(findInput("FocusedCalibrationReport")),
        selectedExecution: run ? retrievalRunReference(run) : {},
        frozenAt: workOrder.createdAt,
        freezeReason: canFreeze
          ? "比较真实候选查询回执且预检登记文献均已召回后，冻结核心检索。"
          : "未冻结：缺少可核对的预检哨兵或存在未召回哨兵，必须修订后重跑。",
        accessPolicy: protocol?.content?.accessPolicy ?? "题名与摘要优先。",
      };
    }

    case "SearchRunSnapshot":
    case "FocusedSearchRunSnapshot":
      {
        const run = retrievalRun(
          workOrder.project,
          output.type === "FocusedSearchRunSnapshot" ? output.slot : 1,
        );
        const retrieval = run?.receipt ?? null;
        if (retrieval) {
          return {
            ...base,
            query: retrieval.query,
            queryId: run.queryId,
            queryHash: run.queryHash,
            retrievalRunPurpose: run.purpose,
            protocolArtifactId: run.protocolArtifactId,
            protocolContentHash: run.protocolContentHash,
            retrievalMode: "live_pubmed",
            provider: "pubmed",
            executionStatus: "completed_live_search",
            executedAt: retrieval.executedAt,
            fetchedAt: retrieval.fetchedAt,
            resultCount: retrieval.records.length,
            totalResultCount: retrieval.total,
            receiptHash: retrieval.receiptHash,
            records: retrieval.records.map((source) => ({
              sourceId: source.id,
              title: source.title,
              accessLevel: source.accessLevel,
              locator: source.locator,
              sourceSnapshotHash: source.sourceSnapshotHash,
            })),
            limitation: retrieval.accessBoundary,
          };
        }
      return {
        ...base,
        query: workOrder.project.question,
        provider: sources.length > 0 ? "user_provided_materials" : "not_executed",
        executionStatus: sources.length > 0 ? "completed" : "blocked_no_source",
        resultCount: sources.length,
        records: sources.map((source) => ({
          sourceId: source.id,
          title: source.title,
          accessLevel: source.accessLevel,
          locator: source.locator,
          sourceSnapshotHash: source.sourceSnapshotHash,
        })),
        limitation:
          sources.length > 0
            ? "本轮仅实际扫描用户提供的材料，不代表数据库系统检索。"
            : "尚未提供材料，也未配置可用的实时检索模型。",
      };
      }

    case "OrientationSourceSnapshot":
    case "SourceSnapshot":
      return { ...base, ...snapshotFromMaterial(workOrder, output) };

    case "OrientationCorpusManifest":
    case "LibraryManifest":
      {
        const run = retrievalRun(workOrder.project);
        const retrieval = run?.receipt ?? null;
      return {
        ...base,
        ...(retrieval ? {
          retrievalMode: "live_pubmed",
          provider: "pubmed",
          retrievalRunPurpose: run.purpose,
          protocolArtifactId: run.protocolArtifactId,
          protocolContentHash: run.protocolContentHash,
          queryId: run.queryId,
          queryHash: run.queryHash,
          retrievalReceiptHash: retrieval.receiptHash,
          query: retrieval.query,
          executedAt: retrieval.executedAt,
        } : {}),
        sourceCount: sources.length,
        sourceIds: sources.map((source) => source.id),
        accessCounts: sources.reduce((counts, source) => {
          counts[source.accessLevel] = (counts[source.accessLevel] ?? 0) + 1;
          return counts;
        }, {}),
        frozen: sources.length > 0,
      };
      }

    case "EvidenceRecord": {
      const material = materialForSlot(workOrder, output.slot);
      const conclusionId = `artifact:${workOrder.projectId}:synthesize_claims:ResearchConclusionCard:1:v1`;
      const fact = hasText(material?.text)
        ? material.text.trim().slice(0, 500)
        : "当前来源没有可提取的正文或摘要事实。";
      return {
        schemaVersion: SCHEMA_VERSION,
        id: output.artifactId,
        sourceId: material?.id ?? `missing-source:${output.slot}`,
        claimId: conclusionId,
        accessLevel: material?.accessLevel ?? "title_only",
        relation: material ? "partially_supports" : "unclear",
        locator: material?.locator ?? {
          repositoryId: `project:${workOrder.projectId}:materials`,
        },
        extractedFacts: [fact],
        limitations: [
          ...(material?.limitations ?? []),
          material?.accessLevel === "abstract_only"
            ? "只访问摘要；摘要未报告的实验细节保持未知。"
            : "来源内容仍需独立核查者确认与当前主张的匹配。",
        ],
        unknowns: ["未由当前材料明确报告的参数、数值与未观察结果"],
        sourceSnapshotHash:
          material?.sourceSnapshotHash ??
          sha256(`missing-source:${workOrder.projectId}:${output.slot}`),
      };
    }

    case "AppraisalRecord": {
      const material = materialForSlot(workOrder, output.slot);
      return {
        ...base,
        sourceId: material?.id ?? `missing-source:${output.slot}`,
        accessLevel: material?.accessLevel ?? "title_only",
        appraisal: material ? "可进入候选证据池，仍需独立核查。" : "材料不足。",
        riskFlags: material?.accessLevel === "abstract_only" ? ["abstract_only"] : [],
      };
    }

    case "ResearchConclusionCard":
      return {
        schemaVersion: SCHEMA_VERSION,
        id: output.artifactId,
        questionId: `question:${workOrder.projectId}`,
        version: output.version,
        claim:
          evidenceInputs.length > 0
            ? `在当前 ${evidenceInputs.length} 条可见证据范围内，“${workOrder.project.question}”只能形成受限的候选判断，尚不能自动升级为强因果或临床结论。`
            : `当前材料不足以回答“${workOrder.project.question}”。`,
        scope: isLivePubMedProject(workOrder.project)
          ? `仅限本项目当前 ${sources.length} 条 PubMed 题录/摘要来源。`
          : `仅限本项目当前 ${sources.length} 份用户提供材料。`,
        producerId: `agent:${workOrder.role}`,
        confidence: evidenceInputs.length > 0 ? "bounded" : "provisional",
        supportingEvidenceIds: evidenceInputs.map((artifact) => artifact.id),
        counterEvidenceIds: [],
        uncertainties: [
          isLivePubMedProject(workOrder.project)
            ? "当前只检索 PubMed 且限制返回数量，不能代表所有数据库或领域总体。"
            : "用户提供材料并非系统抽样，不能代表领域总体。",
          "摘要未报告的信息与未执行的研究步骤不能混写。",
        ],
        accessBoundary: "按每条来源实际访问层级解释；未完成全文审计。",
        nextQuestion: "哪些证据缺口最可能改变当前受限判断？",
      };

    case "EvidenceVerificationReport": {
      const producerId = conclusionInputs[0]?.content?.producerId ?? "agent:evidence_synthesizer";
      return {
        schemaVersion: SCHEMA_VERSION,
        id: output.artifactId,
        conclusionCardIds: conclusionInputs.map((artifact) => artifact.id),
        status: "verified",
        verdict: conclusionInputs.length > 0 ? "partial" : "fail",
        producerId,
        verifierId: `agent:${workOrder.role}`,
        limitations: [
          "核查确认结论保留了来源范围与访问边界。",
          "当前仍未完成全文语义和方法学审计。",
        ],
      };
    }

    case "ClaimEvidenceMap":
      return {
        ...base,
        claims: evidenceInputs.length
          ? [
              {
                claimId: `artifact:${workOrder.projectId}:synthesize_claims:ResearchConclusionCard:1:v1`,
                evidenceIds: evidenceInputs.map((artifact) => artifact.id),
              },
            ]
          : [],
      };

    case "EvidenceDrivenOutline": {
      const boundary = findInput("EvidenceBoundaryDecision");
      const claimMap = findInput("ClaimEvidenceMap");
      const mappedClaims = claimMap?.content?.claims ?? [];
      const claimIds = mappedClaims.map((claim) => claim.claimId).filter(Boolean);
      const evidenceIds = mappedClaims
        .flatMap((claim) => claim.evidenceIds ?? [])
        .filter(Boolean);
      return {
        schemaVersion: SCHEMA_VERSION,
        id: output.artifactId,
        version: output.version,
        questionId: `question:${workOrder.projectId}`,
        evidenceBoundaryDecisionId: boundary?.id ?? "missing-evidence-boundary",
        claimEvidenceMapId: claimMap?.id ?? "missing-claim-map",
        producerId: `agent:${workOrder.role}`,
        excludedTopics: ["超出当前证据边界的临床、因果或总体外推"],
        sections: [
          {
            id: `section:${workOrder.projectId}:bounded-findings`,
            title: "当前证据支持的判断与边界",
            purpose: "先陈述经过核查的有限判断，再明确反证、限制与未知。",
            claimIds: claimIds.length > 0 ? claimIds : [`claim:${workOrder.projectId}:pending`],
            supportingEvidenceIds:
              evidenceIds.length > 0 ? evidenceIds : [`evidence:${workOrder.projectId}:pending`],
            counterEvidenceIds: [],
            limitations: ["章节只允许使用当前证据图中已经登记的材料。"],
          },
        ],
      };
    }

    case "OutlineStressTest": {
      const outline = findInput("EvidenceDrivenOutline");
      return {
        schemaVersion: SCHEMA_VERSION,
        id: output.artifactId,
        version: output.version,
        outlineId: outline?.id ?? "missing-outline",
        outlineProducerId: outline?.content?.producerId ?? "agent:argument_architect",
        verifierId: `agent:${workOrder.role}`,
        verdict: "pass",
        reviewedSectionIds:
          outline?.content?.sections?.map((section) => section.id) ?? ["section:pending"],
        findings: [],
      };
    }

    case "ClaimUnitDraft": {
      const writingPlan = findInput("FrozenWritingPlan");
      const unitPlan =
        writingPlan?.content?.claimUnitPlans?.[output.slot - 1] ??
        writingPlan?.content?.claimUnitPlans?.[0];
      const evidenceId = unitPlan?.allowedEvidenceIds?.[0] ?? "evidence:pending";
      const visibleExcerpt = sources[output.slot - 1]?.text ?? sources[0]?.text;
      const factualText = hasText(visibleExcerpt)
        ? visibleExcerpt.trim()
        : `在当前可见材料范围内，关于“${workOrder.project.question}”只能形成保留证据边界的有限判断。`;
      return {
        schemaVersion: SCHEMA_VERSION,
        id: output.artifactId,
        version: output.version,
        writingPlanId: writingPlan?.id ?? "missing-writing-plan",
        claimUnitPlanId: unitPlan?.id ?? `claim-unit-plan:${output.slot}`,
        claimId: unitPlan?.claimId ?? `claim:${workOrder.projectId}:pending`,
        producerId: `agent:${workOrder.role}`,
        boundaries: [...DEFAULT_BOUNDARIES],
        sentences: [
          {
            id: `${output.artifactId}:sentence:1`,
            text: factualText,
            kind: "factual",
            citationIntents: [
              {
                id: `${output.artifactId}:citation:1`,
                evidenceId,
                purpose: "support",
              },
            ],
          },
        ],
      };
    }

    case "ClaimVerificationResult": {
      const draft = findInputs("ClaimUnitDraft")[output.slot - 1] ?? findInput("ClaimUnitDraft");
      const verifiableSentences = draft?.content?.sentences ?? [];
      return {
        schemaVersion: SCHEMA_VERSION,
        id: output.artifactId,
        version: output.version,
        claimUnitDraftId: draft?.id ?? "missing-claim-unit-draft",
        draftProducerId: draft?.content?.producerId ?? "agent:claim_unit_writer",
        verifierId: `agent:${workOrder.role}`,
        status: "verified",
        limitations: ["本地引导模式完成结构化逐句核查；正式发表前仍需回到原文定位复核。"],
        sentenceResults: verifiableSentences.map((sentence) => ({
          sentenceId: sentence.id,
          // This proposal is deliberately non-authoritative. The service must
          // replace it with a citation_verify receipt before persistence.
          verdict: "unsupported",
          citationIntentIds: sentence.citationIntents.map((intent) => intent.id),
          verifiedEvidenceIds: [],
          rationale: "等待 Research Harness 调用 citation_verify 生成可校验回执。",
          requiredRevision: "必须完成工具核查后才能进入人工接受边界。",
        })),
      };
    }

    case "ManuscriptDraft": {
      const writingPlan = findInput("FrozenWritingPlan");
      const acceptedUnits = findInputs("AcceptedClaimUnit");
      return createDeterministicManuscriptDraft({
        id: output.artifactId,
        version: output.version,
        writingPlanId: writingPlan?.id ?? "missing-writing-plan",
        producerId: `agent:${workOrder.role}`,
        title: workOrder.project.title,
        acceptedClaimUnits: acceptedUnits,
      });
    }

    case "ManuscriptAudit": {
      const draft = findInput("ManuscriptDraft");
      const authorityFindingId = `${output.artifactId}:authority-boundary`;
      return {
        schemaVersion: SCHEMA_VERSION,
        id: output.artifactId,
        version: output.version,
        manuscriptDraftId: draft?.id ?? "missing-manuscript-draft",
        manuscriptProducerId: draft?.content?.producerId ?? "agent:manuscript_editor",
        auditorId: `agent:${workOrder.role}`,
        status: "simulation_reviewed",
        verdict: "simulation_only",
        authority: guidedSimulationAuthority(),
        checkedClaimUnitIds: draft?.content?.acceptedClaimUnitIds ?? ["accepted-unit:pending"],
        draftAssemblyFingerprint:
          draft?.content?.assembly?.fingerprint ?? sha256("missing-draft-assembly"),
        disclosedLimitations: [
          "本记录仅完成流程演练，不构成独立科学审计，也不能声明稿件审计通过。",
          ...(draft?.content?.limitations ?? ["当前材料边界仍需披露。"]),
        ],
        findings: [
          {
            id: authorityFindingId,
            targetRef: draft?.id ?? "missing-manuscript-draft",
            category: "authority_boundary",
            severity: "note",
            message:
              "guided/faux 执行只能核对结构与流程；科学有效性必须由全新 live run 和独立人工审计重新确认。",
            resolved: false,
          },
        ],
        rightsChecks: [
          {
            id: `${output.artifactId}:rights:1`,
            materialId: draft?.id ?? "manuscript-text",
            status: "not_applicable",
            note: "流程演练未执行正式权利审计；这里只记录待正式复核的材料边界。",
          },
        ],
      };
    }

    case "AuditedManuscript": {
      const draft = findInput("ManuscriptDraft");
      const auditOutput = workOrder.requiredOutputs.find(
        (candidate) => candidate.type === "ManuscriptAudit",
      );
      return {
        schemaVersion: SCHEMA_VERSION,
        id: output.artifactId,
        version: output.version,
        manuscriptDraftId: draft?.id ?? "missing-manuscript-draft",
        manuscriptAuditId: auditOutput?.artifactId ?? "missing-manuscript-audit",
        producerId: draft?.content?.producerId ?? "agent:manuscript_editor",
        auditorId: `agent:${workOrder.role}`,
        auditVerdict: "simulation_only",
        authority: guidedSimulationAuthority(),
        title: draft?.content?.title ?? workOrder.project.title,
        abstract: draft?.content?.abstract ?? "当前摘要保持证据边界。",
        conclusion: draft?.content?.conclusion ?? "当前结论保持证据边界。",
        acceptedClaimUnitIds:
          draft?.content?.acceptedClaimUnitIds ?? ["accepted-unit:pending"],
        disclosedLimitations: [
          "本记录仅完成流程演练，不构成独立科学审计，也不能声明稿件审计通过。",
          ...(draft?.content?.limitations ?? ["当前材料边界仍需披露。"]),
        ],
        draftAssemblyFingerprint:
          draft?.content?.assembly?.fingerprint ?? sha256("missing-draft-assembly"),
        unresolvedIssueIds: [
          `${auditOutput?.artifactId ?? "missing-manuscript-audit"}:authority-boundary`,
        ],
        sections:
          draft?.content?.sections ?? [
            {
              id: `audited-section:${workOrder.projectId}:1`,
              title: "流程演练正文（非正式审计）",
              content: "当前正文只演练结构与边界，未获得正式科学审计通过。",
              claimUnitIds: ["accepted-unit:pending"],
            },
          ],
      };
    }

    case "DeliveryBundle": {
      const manuscript = findInput("AuditedManuscript");
      const audit = findInput("ManuscriptAudit");
      const fingerprints = [
        {
          artifactId: manuscript?.id ?? "missing-audited-manuscript",
          role: "audited_manuscript",
          version: manuscript?.version ?? 1,
          contentHash: manuscript?.contentHash ?? sha256("missing-audited-manuscript"),
        },
        {
          artifactId: audit?.id ?? "missing-manuscript-audit",
          role: "manuscript_audit",
          version: audit?.version ?? 1,
          contentHash: audit?.contentHash ?? sha256("missing-manuscript-audit"),
        },
      ];
      const manifestOutput = workOrder.requiredOutputs.find(
        (candidate) => candidate.type === "ExportManifest",
      );
      const manifest = createAuthoritativeExportManifest({
        id: manifestOutput?.artifactId ?? "missing-export-manifest",
        version: manifestOutput?.version ?? 1,
        project: workOrder.project,
        artifacts: workOrder.inputArtifacts,
        deliveryBundleId: output.artifactId,
        generatedAt: workOrder.createdAt,
      });
      return {
        schemaVersion: SCHEMA_VERSION,
        id: output.artifactId,
        version: output.version,
        auditedManuscriptId: fingerprints[0].artifactId,
        manuscriptAuditId: fingerprints[1].artifactId,
        preparedBy: `agent:${workOrder.role}`,
        authority: guidedSimulationAuthority(),
        displayNotice: "受限流程演练交付；不得作为正式科研成果或正式审计稿继承。",
        limitations: [
          "作者只能确认受限演练字节，不能把本包签署为科学审计通过。",
          "正式交付必须在全新的 live run 中从来源重新构建，AI 不代替作者承担责任。",
        ],
        authorSignoffStatus: "simulation_pending",
        manifestHash: manifest.manifestFingerprint,
        artifactFingerprints: fingerprints,
        exportManifestId: manifest.id,
        exportManifestFingerprint: manifest.manifestFingerprint,
        exports: manifest.files.map((file) => ({
          id: file.id,
          format: file.format,
          fileName: file.fileName,
          mediaType: file.mediaType,
          byteLength: file.byteLength,
          contentHash: file.sha256,
        })),
      };
    }

    case "CounterevidenceRegister":
      return {
        ...base,
        counterevidence: [],
        limitation: "当前材料中未识别到可确认的反证，不等于反证不存在。",
      };

    case "CoverageGapRegister":
      return {
        ...base,
        gaps: isLivePubMedProject(workOrder.project)
          ? ["尚未检索其他数据库", "关键主张尚未完成全文定位核查"]
          : ["缺少系统数据库检索", "关键主张尚未完成全文定位核查"],
      };

    default:
      return base;
  }
}

export function createGuidedCandidates(workOrder) {
  const candidates = workOrder.requiredOutputs.map((output) => ({
    artifactId: output.artifactId,
    type: output.type,
    content: contentForType(workOrder, output),
  }));
  const byType = new Map(candidates.map((candidate) => [candidate.type, candidate]));
  const descriptor = (candidate) => {
    const output = workOrder.requiredOutputs.find(
      (item) => item.artifactId === candidate?.artifactId,
    );
    return {
      id: candidate?.artifactId,
      type: candidate?.type,
      version: output?.version ?? candidate?.content?.version ?? 1,
      content: candidate?.content,
    };
  };
  const fingerprint = (candidate) => artifactFingerprint(descriptor(candidate));
  for (const [matrixType, protocolType] of [
    ["OrientationConceptMatrix", "OrientationSearchProtocol"],
    ["FocusedConceptMatrix", "FocusedSearchProtocol"],
  ]) {
    const matrix = byType.get(matrixType);
    const protocol = byType.get(protocolType);
    if (!matrix || !protocol) continue;
    const matrixFingerprint = fingerprint(matrix);
    protocol.content.conceptMatrixFingerprint = matrixFingerprint;
    protocol.content.upstreamArtifactFingerprints = [matrixFingerprint];
  }
  for (const [protocolType, calibrationType, frozenType] of [
    ["OrientationSearchProtocol", "OrientationCalibrationReport", "FrozenOrientationSearchProtocol"],
    ["FocusedSearchProtocol", "FocusedCalibrationReport", "FrozenSearchProtocol"],
  ]) {
    const protocol = workOrder.inputArtifacts.find(
      (artifact) => artifact.type === protocolType,
    );
    const calibration = byType.get(calibrationType);
    const frozen = byType.get(frozenType);
    if (protocol && calibration) {
      const bound = artifactFingerprint(protocol);
      calibration.content.protocolFingerprint = bound;
      calibration.content.upstreamArtifactFingerprints = [bound];
    }
    if (protocol && calibration && frozen) {
      const parentFingerprint = artifactFingerprint(protocol);
      const calibrationFingerprint = fingerprint(calibration);
      frozen.content.parentProtocolFingerprint = parentFingerprint;
      frozen.content.calibrationFingerprint = calibrationFingerprint;
      frozen.content.upstreamArtifactFingerprints = [
        parentFingerprint,
        calibrationFingerprint,
      ];
    }
  }
  return candidates;
}

export function createGuidedReviewCandidate({ reviewOrder, targetArtifacts }) {
  const blockedExecution = targetArtifacts.some(
    (artifact) => artifact.content?.executionStatus === "blocked_no_source",
  );
  const missingContent = targetArtifacts.some((artifact) => artifact.content === undefined);
  const liveRetrievalRequired = reviewOrder?.project?.researchMode === "live_pubmed";
  const liveRetrievalTypes = new Set([
    "SearchRunSnapshot",
    "FocusedSearchRunSnapshot",
    "OrientationSourceSnapshot",
    "SourceSnapshot",
    "OrientationCorpusManifest",
    "LibraryManifest",
  ]);
  const unverifiableLiveRetrieval = liveRetrievalRequired && targetArtifacts.some(
    (artifact) =>
      liveRetrievalTypes.has(artifact.type) &&
      !(
        artifact.content?.provider === "pubmed" &&
        artifact.content?.retrievalMode === "live_pubmed" &&
        (artifact.content?.receiptHash || artifact.content?.retrievalReceiptHash)
      ),
  );
  const unverifiedClaimSentence = targetArtifacts.some(
    (artifact) =>
      artifact.type === "ClaimVerificationResult" &&
      (artifact.content?.sentenceResults ?? []).some(
        (result) =>
          result.verdict !== "direct_support" ||
          !/^[a-f0-9]{64}$/i.test(result.verificationReceipt?.receiptHash ?? ""),
      ),
  );
  const verdict =
    blockedExecution ||
    missingContent ||
    unverifiableLiveRetrieval ||
    unverifiedClaimSentence
      ? "fail"
      : "pass";
  const output = reviewOrder.requiredOutputs[0];
  return {
    artifactId: output.artifactId,
    type: output.type,
    content: {
      schemaVersion: SCHEMA_VERSION,
      id: output.artifactId,
      reviewedNodeId: reviewOrder.reviewedNodeId,
      reviewerRole: reviewOrder.role,
      verdict,
      criteria: reviewOrder.acceptanceCriteria.map((criterion) => ({
        criterion,
        passed: verdict === "pass",
        proofArtifactIds: targetArtifacts.map((artifact) => artifact.id),
      })),
      limitations:
        verdict === "pass"
          ? ["本地引导审阅只证明结构和显式边界通过，不替代领域专家终审。"]
          : [
              unverifiedClaimSentence
                ? "仍有事实句未获得 citation_verify 的直接支持，不能验收该节点。"
                : "缺少实际来源材料或工具执行证据，不能验收该节点。",
            ],
      reviewedAt: reviewOrder.createdAt,
    },
  };
}

export function createGateDecisionArtifacts({
  project,
  node,
  gate,
  decision,
  reason,
  state,
  inputArtifacts = [],
  humanActor = {
    id: project.researchOwnerId ?? project.ownerId ?? "local-researcher",
    role: node.approverRoles?.[0] ?? "human_researcher",
    kind: "human",
  },
  decidedAt = new Date().toISOString(),
}) {
  if (!new Set(["approved", "accepted_risk"]).has(decision)) return [];
  if (node.id === "author_signoff") {
    const manifestArtifact = inputArtifacts.find(
      (artifact) => artifact.type === "ExportManifest",
    );
    const deliveryBundleArtifact = inputArtifacts.find(
      (artifact) => artifact.type === "DeliveryBundle",
    );
    const descriptors = node.outputs.map((contract, contractIndex) => {
      const type = contractType(contract);
      const lineId = lineageId(project.id, node.id, type, 1);
      const version = currentVersionForLineage(state, lineId);
      return {
        type,
        lineId,
        version,
        id: artifactId(project.id, node.id, type, 1, version),
        contractIndex,
      };
    });
    const authorApproval = descriptors.find((item) => item.type === "AuthorApproval");
    const signedDelivery = descriptors.find((item) => item.type === "SignedDelivery");
    const contents = createAuthorSignoffContents({
      manifestArtifact,
      deliveryBundleArtifact,
      humanActor,
      gate,
      reason,
      decidedAt,
      authorApprovalId: authorApproval.id,
      signedDeliveryId: signedDelivery.id,
      version: authorApproval.version,
    });
    const simulation =
      hasGuidedSimulationAuthority(deliveryBundleArtifact?.content) ||
      hasGuidedSimulationAuthority(manifestArtifact?.content);
    if (simulation) {
      contents.authorApproval = {
        ...contents.authorApproval,
        authority: guidedSimulationAuthority(),
        responsibilityStatement:
          "作者仅确认受限流程演练字节及其边界，不确认科学审计通过，也不签署正式科研交付。",
      };
      contents.signedDelivery = {
        ...contents.signedDelivery,
        authority: guidedSimulationAuthority(),
        status: "simulation_signed",
        displayNotice:
          "受限流程演练字节已由研究者确认；该确认不产生正式科研权威或可继承的最终稿。",
      };
    }
    return descriptors.map((descriptor) => ({
      id: descriptor.id,
      type: descriptor.type,
      lineageId: descriptor.lineId,
      version: descriptor.version,
      content:
        descriptor.type === "AuthorApproval"
          ? contents.authorApproval
          : contents.signedDelivery,
      sourceRef: `gate:${gate.id}`,
    }));
  }
  return node.outputs.flatMap((contract, contractIndex) => {
    const type = contractType(contract);
    const count = isArrayContract(contract)
      ? Math.max(1, inputArtifacts.filter((artifact) => artifact.type === "ClaimUnitDraft").length)
      : 1;
    return Array.from({ length: count }, (_, index) => {
      const slot = index + 1;
      const lineId = lineageId(project.id, node.id, type, slot);
      const version = currentVersionForLineage(state, lineId);
      const id = artifactId(project.id, node.id, type, slot, version);
      const base = {
        schemaVersion: SCHEMA_VERSION,
        id,
        version,
        projectId: project.id,
        gateId: gate.id,
        gateFingerprint: gate.fingerprint,
        decision,
        reason,
        approvedInputArtifactIds: gate.artifactRefs.map((ref) => ref.artifactId),
        question: project.question,
        boundaries: [...DEFAULT_BOUNDARIES],
      };
      let content = base;
      if (type === "FrozenWritingPlan") {
        const outline = inputArtifacts.find((artifact) => artifact.type === "EvidenceDrivenOutline");
        const stress = inputArtifacts.find((artifact) => artifact.type === "OutlineStressTest");
        const outlineDecision = `artifact:${project.id}:${node.id}:OutlineDecision:${contractIndex}:v${version}`;
        const sections = outline?.content?.sections ?? [];
        content = {
          schemaVersion: SCHEMA_VERSION,
          id,
          version,
          outlineId: outline?.id ?? "missing-outline",
          outlineStressTestId: stress?.id ?? "missing-outline-stress-test",
          outlineDecisionId: outlineDecision,
          approvedBy: humanActor,
          approvedAt: decidedAt,
          excludedTopics: outline?.content?.excludedTopics ?? [],
          claimUnitPlans: sections.map((section, sectionIndex) => ({
            id: `${id}:unit-plan:${sectionIndex + 1}`,
            sectionId: section.id,
            claimId: section.claimIds[0],
            purpose: section.purpose,
            allowedEvidenceIds: section.supportingEvidenceIds,
            prohibitedMoves: ["不得加入未在当前证据图中核查的新事实。"],
          })),
        };
      }
      if (type === "AcceptedClaimUnit") {
        const draft =
          inputArtifacts.filter((artifact) => artifact.type === "ClaimUnitDraft")[index] ??
          inputArtifacts.find((artifact) => artifact.type === "ClaimUnitDraft");
        const verification = inputArtifacts.find(
          (artifact) =>
            artifact.type === "ClaimVerificationResult" &&
            artifact.content?.claimUnitDraftId === draft?.id,
        );
        const resultBySentence = new Map(
          (verification?.content?.sentenceResults ?? []).map((result) => [
            result.sentenceId,
            result,
          ]),
        );
        content = {
          schemaVersion: SCHEMA_VERSION,
          id,
          version,
          sourceDraftId: draft?.id ?? "missing-claim-unit-draft",
          verificationResultId: verification?.id ?? "missing-verification-result",
          writingPlanId: draft?.content?.writingPlanId ?? "missing-writing-plan",
          claimId: draft?.content?.claimId ?? "missing-claim",
          producerId: draft?.content?.producerId ?? "agent:claim_unit_writer",
          acceptedBy: humanActor,
          acceptedAt: decidedAt,
          boundaries: draft?.content?.boundaries ?? [...DEFAULT_BOUNDARIES],
          sentences: (draft?.content?.sentences ?? []).map((sentence) => {
            const result = resultBySentence.get(sentence.id);
            return {
              ...sentence,
              verification: {
                resultId: verification?.id ?? "missing-verification-result",
                verdict: result?.verdict ?? "unsupported",
                verifiedEvidenceIds: result?.verifiedEvidenceIds ?? [],
              },
            };
          }),
        };
      }
      return {
        id,
        type,
        lineageId: lineId,
        version,
        content,
        sourceRef: `gate:${gate.id}`,
      };
    });
  });
}

export const WORK_ORDER_SCHEMA_VERSION = "1.0.0";
