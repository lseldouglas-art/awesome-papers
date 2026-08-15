import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import { ContentAddressedArtifactStore } from "../content-addressed-artifact-store-v1.js";
import {
  authoritativeExportFile,
  publicExportManifest,
  resolveSignedExportAuthority,
} from "../export-authority-v1.js";
import {
  PiRuntimeAdapter,
  createPiContextRuntime,
} from "../pi-runtime-adapter-v1.js";
import { buildLiteratureLandscape } from "../research-literature-landscape-v1.js";
import { previewPubMedQueryPlan } from "../research-query-planner-v1.js";
import { ResearchAgentServiceV1 } from "../research-agent-service-v1.js";
import {
  buildResearchOutputProjection,
} from "../research-artifact-presentation-v1.js";
import { ResearchToolGateway } from "../research-tool-gateway-v1.js";
import { sha256 } from "../event-engine-v1.js";
import {
  evaluateResearchFormalAuthority,
  retrievalAuthorityForProject,
} from "../research-formal-authority-v1.js";
import { REVIEW_RESEARCH_MACHINE_V1 } from "../review-research-machine-v1.js";

const ENTRY_TYPE = "pi-research-workbench";
const mutationTails = new Map();

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function assertSafeProjectId(value) {
  if (
    !hasText(value) ||
    value.length > 200 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ||
    value === "." ||
    value === ".."
  ) {
    const error = new Error("projectId 格式无效；不得包含路径分隔符或目录跳转。 ");
    error.code = "INVALID_PROJECT_ID";
    throw error;
  }
  return value;
}

function owner() {
  return {
    id: hasText(process.env.PI_RESEARCHER_ID)
      ? process.env.PI_RESEARCHER_ID.trim()
      : "local-researcher",
    role: "human_researcher",
    kind: "human",
  };
}

export function researchDataDir(cwd, env = process.env) {
  const configured = env.PI_RESEARCH_DATA_DIR;
  if (!hasText(configured)) return join(resolve(cwd), ".pi", "research-workbench-data");
  return isAbsolute(configured) ? resolve(configured) : resolve(cwd, configured);
}

async function withProjectMutation(key, operation) {
  const previous = mutationTails.get(key) ?? Promise.resolve();
  let unlock;
  const lock = new Promise((resolveLock) => {
    unlock = resolveLock;
  });
  const tail = previous.catch(() => undefined).then(() => lock);
  mutationTails.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    unlock();
    if (mutationTails.get(key) === tail) mutationTails.delete(key);
  }
}

export async function createResearchServiceForContext(ctx) {
  const dataDir = researchDataDir(ctx.cwd);
  const env = { ...process.env };
  const envSelectsRuntime =
    hasText(env.RESEARCH_AGENT_PROVIDER) && hasText(env.RESEARCH_AGENT_MODEL);
  const piContextRuntime = envSelectsRuntime
    ? null
    : createPiContextRuntime({
        model: ctx?.model,
        modelRegistry: ctx?.modelRegistry,
      });
  const artifactStore = new ContentAddressedArtifactStore({
    rootDir: join(dataDir, "artifacts"),
  });
  const gateway = new ResearchToolGateway({
    artifactStore,
    ncbiApiKey: env.NCBI_API_KEY || null,
    email: env.NCBI_EMAIL || null,
    tool: env.NCBI_TOOL || "pi-research-workbench",
  });
  const adapter = new PiRuntimeAdapter({
    gateway,
    env,
    forceMode: env.RESEARCH_AGENT_FORCE_MODE || "auto",
    piContextRuntime,
  });
  return new ResearchAgentServiceV1({
    dataDir,
    machine: REVIEW_RESEARCH_MACHINE_V1,
    artifactStore,
    piRuntimeAdapter: adapter,
    toolGateway: gateway,
  });
}

function latestArtifact(result, ...types) {
  for (const type of types) {
    const matches = result.artifacts
      .filter((artifact) => artifact.type === type && artifact.freshness !== "stale")
      .sort((left, right) => (right.version ?? 0) - (left.version ?? 0));
    if (matches[0]) return matches[0];
  }
  return null;
}

function boundaryStatus(boundary) {
  if (["human_gate", "human_review"].includes(boundary?.type)) {
    return "awaiting_user_decision";
  }
  return boundary?.type ?? "unknown";
}

function sourceView(source) {
  return {
    id: source.id,
    provider: source.provider ?? null,
    pmid: source.pmid ?? source.locator?.pmid ?? null,
    doi: source.doi ?? source.locator?.doi ?? null,
    title: source.title,
    journal: source.journal ?? null,
    year: source.year ?? null,
    accessLevel: source.accessLevel,
    url: source.locator?.url ?? null,
    sourceSnapshotHash: source.sourceSnapshotHash,
  };
}

function formalRetrievalRuns(project) {
  const runs = project?.retrievalRuns ?? {};
  return [
    runs.pilot,
    runs.orientationCorpus,
    ...(Array.isArray(runs.focusedCalibration) ? runs.focusedCalibration : []),
    runs.finalLibrary,
  ].filter(Boolean);
}

function retrievalRunView(run) {
  return {
    purpose: run.purpose,
    nodeId: run.nodeId,
    protocolArtifactId: run.protocolArtifactId,
    protocolContentHash: run.protocolContentHash,
    queryId: run.queryId,
    query: run.query,
    queryHash: run.queryHash,
    total: run.receipt?.total ?? null,
    savedCount: run.receipt?.records?.length ?? 0,
    executedAt: run.receipt?.executedAt ?? null,
    receiptHash: run.receipt?.receiptHash ?? null,
    accessBoundary: run.receipt?.accessBoundary ?? null,
  };
}

function retrievalAuthorityView(project) {
  const authority = retrievalAuthorityForProject(project);
  const legacy = authority.legacyBootstrap;
  return {
    stage: authority.stage,
    finalLibraryReady: authority.finalLibraryReady,
    formalRunCount: authority.formalRunCount,
    legacy: legacy?.receipt
      ? {
          authority: legacy.authority ?? "legacy_single_receipt",
          receiptHash: legacy.receipt.receiptHash ?? null,
          reusableForFormalNodes: [],
          boundary: "历史单次检索只供追溯，不能证明分阶段真实检索。",
        }
      : null,
    boundary: authority.finalLibraryReady
      ? "最终文献库已按冻结协议保存；每项结论仍需独立证据核查。"
      : authority.formalRunCount > 0
        ? "当前只有试检、宽检索或聚焦校准运行；尚未形成最终冻结文献库。"
        : "尚未形成最终冻结文献库。",
  };
}

function publicProjectView(result, { includeOutputs = true } = {}) {
  const boundary = result.projection.boundary;
  const retrievalRuns = formalRetrievalRuns(result.project);
  const latestRetrieval = retrievalRuns.at(-1) ?? null;
  const preview = result.project?.retrievalRuns?.previewSelection ?? null;
  const retrievalAuthority = retrievalAuthorityView(result.project);
  const formalAuthority = evaluateResearchFormalAuthority({
    project: result.project,
    artifacts: result.artifacts,
    runtimeProvenance: result.runtimeProvenance,
    workflowComplete: result.projection.boundary?.type === "complete",
  });
  const formalResearchComplete = formalAuthority.formalResearchComplete;
  return {
    id: result.project.id,
    title: result.project.title,
    question: result.project.question,
    researchMode: result.project.researchMode,
    searchQuery: result.project.searchQuery,
    completionProfileId: result.state.completionProfileId,
    revision: result.state.revision,
    phase: result.projection.phase,
    activity: result.projection.activity,
    workflowComplete: result.projection.complete,
    formalResearchComplete,
    contentMaturity: {
      code: formalResearchComplete
        ? "live_pubmed_audited_signed"
        : result.projection.complete
          ? "workflow_complete_restricted"
          : retrievalAuthority.stage,
      label: formalResearchComplete
        ? "PubMed 实时研究 · 已审计签署"
        : result.projection.complete
          ? "流程已完成 · 研究内容仍受限"
          : "研究进行中",
      boundary: formalResearchComplete
        ? "最终文献库、实时模型运行、审计与作者签署均已绑定。"
        : formalAuthority.boundary,
    },
    status: boundaryStatus(boundary),
    boundary: {
      type: boundary?.type,
      nodeId: boundary?.nodeId ?? null,
      gateId: boundary?.gateId ?? null,
      fingerprint: boundary?.fingerprint ?? null,
      reviewerRole: boundary?.reviewerRole ?? null,
      blockers: boundary?.blockers ?? [],
      message: boundary?.message ?? null,
    },
    queryPreviewSelection: preview
      ? {
          planHash: preview.planHash,
          selectionHash: preview.selectionHash,
          candidateId: preview.candidateId,
          status: preview.candidateStatus,
          query: preview.query,
          total: preview.total,
          sampledCount: preview.samples?.length ?? 0,
          executedAt: preview.executedAt,
          boundary: "建项前预检只用于确认问题与检索表达，不进入正式文献库。",
        }
      : null,
    retrievalRuns: retrievalRuns.map(retrievalRunView),
    latestRetrievalRun: latestRetrieval ? retrievalRunView(latestRetrieval) : null,
    retrievalAuthority,
    sources: result.project.sourceMaterials.map((source) => ({
      ...sourceView(source),
      retrievalStage: retrievalAuthority.stage,
      libraryEligibility: retrievalAuthority.finalLibraryReady
        ? "final_library_source"
        : "calibration_or_legacy_source",
    })),
    ...(includeOutputs
      ? {
          outputs: buildResearchOutputProjection({
            project: result.project,
            artifacts: result.artifacts,
            contentMaturity: {
              formalResearchComplete,
              label: formalResearchComplete
                ? "PubMed 实时研究 · 已审计签署"
                : "可追溯受限研究产物",
              boundary: formalResearchComplete
                ? "正式资格由当前项目的最终文献库、实时模型回执和作者签署共同决定。"
                : formalAuthority.boundary,
            },
            runtimeProvenance: result.runtimeProvenance,
          }).groups,
        }
      : {}),
  };
}

function landscapeProjectView(result) {
  const retrievalAuthority = retrievalAuthorityView(result.project);
  const build = buildLiteratureLandscape({
    project: result.project,
    evidenceRecords: result.artifacts.filter((artifact) => artifact.type === "EvidenceRecord"),
    generatedAt:
      formalRetrievalRuns(result.project).at(-1)?.receipt?.fetchedAt ??
      formalRetrievalRuns(result.project).at(-1)?.receipt?.executedAt ??
      null,
  });
  return {
    retrievalAuthority,
    sourceAuthority: retrievalAuthority.finalLibraryReady
      ? "final_library_sources"
      : "orientation_or_calibration_sources",
    boundary: retrievalAuthority.finalLibraryReady
      ? "该导航图使用最终冻结文献库；候选方向仍未被实验或独立研究验证。"
      : "该导航图只使用当前试检、宽检索或聚焦校准材料，不代表最终文献库或领域全景。",
    overview: build.literatureLandscape,
    clusters: build.clusterMap.clusters,
    unclassified: build.unclassifiedBucket,
    ideaCandidates: build.ideaCandidates,
    decisionLedger: build.ideaDecisionLedger,
  };
}

function toolResult(summary, details) {
  return {
    content: [{ type: "text", text: summary }],
    details,
  };
}

function queryPreviewView(preview) {
  return {
    planHash: preview.planHash,
    question: preview.question,
    planner: preview.planner,
    mappings: preview.mappings,
    unknownChinese: preview.unknownChinese,
    candidates: preview.candidates.map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
      strategy: candidate.strategy,
      query: candidate.query,
      status: candidate.status,
      total: candidate.total,
      sampledCount: candidate.sampledCount,
      samples: candidate.samples.map((sample) => ({
        pmid: sample.pmid,
        title: sample.title,
        accessLevel: sample.accessLevel,
        noiseStatus: sample.noiseStatus,
      })),
      error: candidate.error ?? null,
      boundary: candidate.boundary,
    })),
    recallCheck: preview.recallCheck,
    accessBoundary: preview.accessBoundary,
  };
}

function candidateChoiceLabel(candidate) {
  const result = candidate.status === "ready"
    ? `PubMed 命中 ${candidate.total} · 样本 ${candidate.sampledCount}`
    : candidate.status === "zero_results"
      ? "0 条结果"
      : "试检失败";
  return `${candidate.label} · ${result}`;
}

function editedCandidateQueries(preview, editedQuery, baselineCandidate = null) {
  const comparison = preview.candidates.find(
    (candidate) => candidate.query !== editedQuery && candidate.id !== baselineCandidate?.id,
  ) ?? preview.candidates.find((candidate) => candidate.query !== editedQuery) ?? baselineCandidate;
  return [
    {
      id: "researcher_edited",
      label: "研究者修订版",
      strategy: "由研究者手动修改，并重新执行真实 PubMed 试检。",
      query: editedQuery,
    },
    {
      id: comparison?.id ?? "comparison_baseline",
      label: comparison?.label ?? "原候选对照",
      strategy: comparison?.strategy ?? "保留原候选作为真实试检对照。",
      query: comparison?.query ?? baselineCandidate?.query ?? editedQuery,
    },
  ];
}

function requirePreviewSelection(plan, params) {
  if (!plan || plan.planHash !== params.queryPlanHash) {
    const error = new Error("建项前必须先运行 research_query_preview，并使用最近一次真实试检的计划指纹。");
    error.code = "QUERY_PREVIEW_REQUIRED";
    throw error;
  }
  if (plan.question !== params.question.trim()) {
    const error = new Error("研究问题已改变；请针对当前问题重新运行 research_query_preview。");
    error.code = "QUERY_PREVIEW_STALE";
    throw error;
  }
  const candidate = plan.candidates.find((item) => item.id === params.selectedCandidateId);
  if (!candidate || candidate.status !== "ready") {
    const error = new Error("所选检索候选没有完成真实 PubMed 试检，不能用于建项。");
    error.code = "QUERY_CANDIDATE_NOT_READY";
    throw error;
  }
  if (candidate.query !== params.searchQuery.trim()) {
    const error = new Error("检索式已被修改；请重新运行 research_query_preview，不能沿用旧命中量建项。");
    error.code = "QUERY_PREVIEW_STALE";
    throw error;
  }
  return candidate;
}

function queryPreviewSelection(plan, candidate) {
  const samples = candidate.samples.map((sample) => ({
    sourceId: sample.sourceId ?? (sample.pmid ? `pubmed:${sample.pmid}` : null),
    pmid: sample.pmid ?? null,
    title: sample.title,
    abstractSnippet: sample.abstractSnippet ?? null,
    accessLevel: sample.accessLevel,
    locator: sample.locator ?? null,
  }));
  const selection = {
    schemaVersion: "research-query-preview-selection/v1",
    planHash: plan.planHash,
    candidateId: candidate.id,
    candidateStatus: candidate.status,
    question: plan.question,
    query: candidate.query,
    total: Number.isInteger(candidate.total) ? candidate.total : null,
    executedAt: candidate.executedAt ?? null,
    ...(candidate.error ? { error: candidate.error } : {}),
    samples,
    sampleSourceIds: samples.map((sample) => sample.sourceId),
  };
  return { ...selection, selectionHash: sha256(selection) };
}

function recordSession(pi, ctx, action, result, extra = {}) {
  const formalRuns = formalRetrievalRuns(result.project);
  const latestReceiptHash = formalRuns.at(-1)?.receipt?.receiptHash ?? null;
  const previewSelectionHash = result.project?.retrievalRuns?.previewSelection?.selectionHash ?? null;
  const entry = {
    schemaVersion: "1.0.0",
    action,
    cwd: resolve(ctx.cwd),
    projectId: result.project?.id ?? result.id,
    boundary: result.projection?.boundary?.type ?? result.boundary?.type ?? null,
    receiptHash: latestReceiptHash ?? result.retrieval?.receiptHash ?? null,
    previewSelectionHash,
    recordedAt: new Date().toISOString(),
    ...extra,
  };
  pi.appendEntry(ENTRY_TYPE, entry);
  return entry;
}

function display(pi, ctx, title, payload, level = "info") {
  const text = `${title}\n${JSON.stringify(payload, null, 2)}`;
  if (typeof pi.sendMessage === "function") {
    pi.sendMessage({
      customType: "research-workbench-status",
      content: text,
      display: true,
      details: payload,
    });
  } else {
    ctx.ui?.notify?.(title, level);
  }
}

function selectedProjectId(selectedByCwd, ctx, explicit) {
  return hasText(explicit) ? explicit.trim() : selectedByCwd.get(resolve(ctx.cwd)) ?? null;
}

export async function createAndRun(service, input, signal) {
  const result = await service.createProject({
    id: input.projectId ?? `research-${randomUUID()}`,
    title: input.title.trim(),
    question: input.question.trim(),
    searchQuery: input.searchQuery.trim(),
    queryPreviewSelection: input.queryPreviewSelection ?? null,
    searchLimit: input.searchLimit ?? 8,
    researchMode: "live_pubmed",
    completionProfileId: input.completionProfileId ?? "audited_review",
    constraints: input.constraints ?? [
      "题名与摘要级证据必须标明访问层级",
      "摘要未报告的信息保持未知",
      "不得形成个体临床建议",
    ],
    owner: owner(),
  });
  return service.runUntilBoundary(result.project.id, { maxSteps: 100, signal });
}

export async function runProject(service, projectId, maxSteps, signal, searchQuery = null) {
  assertSafeProjectId(projectId);
  if (searchQuery !== null) {
    const error = new Error(
      "检索式属于冻结协议，不能在推进工具中直接覆盖。请先用 research_query_preview 重新试检；建项前失败可在同一项目更新预检，正式检索失败则需回到对应协议版本。",
    );
    error.code = "REVISED_QUERY_REQUIRES_PROTOCOL_REVISION";
    throw error;
  }
  return service.runUntilBoundary(projectId, { maxSteps, signal });
}

export async function resumeProject(service, projectId, maxSteps, signal, reason) {
  assertSafeProjectId(projectId);
  const current = await service.getProject(projectId);
  if (current.projection?.boundary?.type !== "blocked") {
    const error = new Error("当前项目没有可恢复的阻塞步骤。");
    error.code = "PROJECT_NOT_BLOCKED";
    throw error;
  }
  const blockers = current.projection.boundary.blockers ?? [];
  if (blockers.length === 0) {
    const error = new Error("当前阻塞边界没有可解析的阻塞记录。");
    error.code = "OPEN_BLOCKER_NOT_FOUND";
    throw error;
  }
  const resolution = hasText(reason)
    ? reason.trim()
    : "研究者已检查工具状态与失败原因，并明确要求从同一冻结协议重试。";
  for (const blocker of blockers) {
    await service.resumeProject({
      projectId,
      nodeId: current.projection.boundary.nodeId,
      blockerId: blocker.id,
      actor: owner(),
      resolution,
    });
  }
  return service.runUntilBoundary(projectId, { maxSteps, signal });
}

export async function reviseRetrievalProtocol(
  service,
  projectId,
  { revisedQuery, reason, blockerId = null, explicitRevision = false, maxSteps = 100, signal } = {},
) {
  assertSafeProjectId(projectId);
  await service.reviseCurrentRetrievalProtocol({
    projectId,
    actor: owner(),
    revisedQuery,
    reason,
    blockerId,
    explicitRevision,
  });
  return service.runUntilBoundary(projectId, { maxSteps, signal });
}

export async function exportProject(service, projectId, format, cwd) {
  assertSafeProjectId(projectId);
  const result = await service.getProject(projectId);
  const dataDir = researchDataDir(cwd);
  const exportDir = join(dataDir, "exports", projectId);
  await mkdir(exportDir, { recursive: true, mode: 0o700 });
  const formalAuthorityResult = evaluateResearchFormalAuthority({
    project: result.project,
    artifacts: result.artifacts,
    runtimeProvenance: result.runtimeProvenance,
    workflowComplete: result.projection.boundary.type === "complete",
  });
  const formal = formalAuthorityResult.formalResearchComplete;

  let signedAuthority = null;
  try {
    signedAuthority = resolveSignedExportAuthority(result.artifacts);
  } catch {
    // Unsigned projects may still use the explicitly restricted legacy path.
  }
  if (!signedAuthority) {
    const error = new Error(
      "当前项目没有内容级校验通过且由作者签署的唯一 ExportManifest，不能导出。",
    );
    error.code = "EXPORT_NOT_SIGNED";
    throw error;
  }
  const formalAuthority = formal && signedAuthority.authorityClass === "authoritative";

  let fileName;
  let mediaType;
  let content;
  let maturity;
  if (format === "markdown") {
    const manuscript = latestArtifact(result, "AuditedManuscript", "ManuscriptDraft");
    if (!manuscript) {
      const error = new Error("当前项目尚未形成可导出的正文候选稿。");
      error.code = "MANUSCRIPT_NOT_READY";
      throw error;
    }
    const label = formalAuthority ? "formal-review" : "restricted-draft";
    fileName = `${projectId}-${label}.md`;
    mediaType = "text/markdown";
    const file = authoritativeExportFile(
      signedAuthority.manifestArtifact.content,
      formalAuthority ? "audited-manuscript.md" : "restricted-draft.md",
    );
    content = file.bytes.toString("utf8");
    maturity = formalAuthority ? "formal" : "restricted_draft";
  } else if (format === "bibtex") {
    content = authoritativeExportFile(
      signedAuthority.manifestArtifact.content,
      "references.bib",
    ).bytes.toString("utf8");
    if (!content) {
      const error = new Error("当前项目尚无可导出的参考文献来源。");
      error.code = "REFERENCES_NOT_READY";
      throw error;
    }
    fileName = `${projectId}-references.bib`;
    mediaType = "application/x-bibtex";
    maturity = "traceable_references";
  } else {
    const bundleFile = authoritativeExportFile(
      signedAuthority.manifestArtifact.content,
      "research-bundle.json",
    );
    const bundle = JSON.parse(bundleFile.bytes.toString("utf8"));
    fileName = `${projectId}-research-bundle.json`;
    mediaType = "application/json";
    content = bundleFile.bytes.toString("utf8");
    maturity = bundle.maturity?.code ?? "signed_research_bundle";
  }
  const bytes = Buffer.from(content, "utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const path = join(exportDir, fileName);
  await writeFile(path, bytes, {
    encoding: "utf8",
    mode: 0o600,
  });
  const manifestPath = `${path}.manifest.json`;
  const manifest = publicExportManifest(signedAuthority.manifestArtifact.content);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return { path, manifestPath, format, mediaType, bytes: bytes.byteLength, sha256, maturity };
}

export function createResearchExtension({ serviceFactory = createResearchServiceForContext } = {}) {
  return function researchExtension(pi) {
    const selectedByCwd = new Map();
    const queryPlanByCwd = new Map();

    pi.on("session_start", async (_event, ctx) => {
      const cwd = resolve(ctx.cwd);
      for (const entry of ctx.sessionManager?.getEntries?.() ?? []) {
        if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
        const data = entry.data ?? entry.details ?? {};
        if (resolve(data.cwd ?? cwd) === cwd && hasText(data.projectId)) {
          selectedByCwd.set(cwd, data.projectId);
        }
      }
      const selected = selectedByCwd.get(cwd);
      ctx.ui?.setStatus?.("research-workbench", selected ? `科研 · ${selected}` : "科研 · 就绪");
    });

    pi.registerTool({
      name: "research_query_preview",
      label: "比较 PubMed 检索方案",
      description: "从研究问题生成至少两个透明候选并真实试检 PubMed。只返回命中量和未筛选题名/摘要样本，不创建项目。",
      executionMode: "sequential",
      parameters: Type.Object({
        question: Type.String({ minLength: 4 }),
        sampleLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
        candidateQueries: Type.Optional(Type.Array(Type.Object({
          id: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
          label: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
          strategy: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
          query: Type.String({ minLength: 3, maxLength: 2000 }),
        }), { minItems: 2, maxItems: 6 })),
      }),
      execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
        const service = await serviceFactory(ctx);
        const preview = await previewPubMedQueryPlan({
          gateway: service.toolGateway,
          question: params.question,
          sampleLimit: params.sampleLimit,
          candidateQueries: params.candidateQueries,
          signal,
        });
        queryPlanByCwd.set(resolve(ctx.cwd), preview);
        return toolResult(
          `已真实试检 ${preview.candidates.length} 个 PubMed 检索候选；尚未建立项目。`,
          preview,
        );
      },
    });

    pi.registerTool({
      name: "research_project_create",
      label: "建立真实研究",
      description: "建立一个真实 PubMed 研究项目，冻结首轮来源快照并推进到第一个人工决定点。不能代表用户批准任何 Gate。",
      promptSnippet: "Create a traceable PubMed research project and stop at human gates.",
      promptGuidelines: [
        "Call research_query_preview first and let the user choose a ready candidate.",
        "If the query is edited, preview the edited query again with a comparison candidate before project creation.",
        "Never claim a research gate has been approved through a tool call.",
        "When status is awaiting_user_decision, ask the user to run /research-decide.",
      ],
      executionMode: "sequential",
      parameters: Type.Object({
        title: Type.String({ minLength: 1 }),
        question: Type.String({ minLength: 1 }),
        searchQuery: Type.String({ minLength: 1, description: "A PubMed query, normally in English." }),
        queryPlanHash: Type.String({ pattern: "^[a-f0-9]{64}$", description: "The latest research_query_preview planHash." }),
        selectedCandidateId: Type.String({ minLength: 1, maxLength: 80 }),
        searchLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
        completionProfileId: Type.Optional(
          StringEnum(["evidence_brief", "evidence_outline", "audited_review"]),
        ),
        constraints: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 20 })),
      }),
      execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
        const selectedCandidate = requirePreviewSelection(
          queryPlanByCwd.get(resolve(ctx.cwd)),
          params,
        );
        const projectId = `research-${randomUUID()}`;
        const service = await serviceFactory(ctx);
        const result = await withProjectMutation(
          `${researchDataDir(ctx.cwd)}:${projectId}`,
          () => createAndRun(service, {
            ...params,
            projectId,
            queryPreviewSelection: queryPreviewSelection(
              queryPlanByCwd.get(resolve(ctx.cwd)),
              selectedCandidate,
            ),
          }, signal),
        );
        selectedByCwd.set(resolve(ctx.cwd), projectId);
        recordSession(pi, ctx, "project_created", result, {
          retrievalError: result.retrievalError ?? null,
          queryPlanHash: params.queryPlanHash,
          selectedCandidateId: selectedCandidate.id,
          previewSelectionHash: result.project?.retrievalRuns?.previewSelection?.selectionHash ??
            queryPreviewSelection(queryPlanByCwd.get(resolve(ctx.cwd)), selectedCandidate).selectionHash,
        });
        const view = publicProjectView(result);
        return toolResult(
          result.retrievalError
            ? `项目 ${projectId} 已安全保存，但 PubMed 检索失败。请修正网络或检索式后继续同一项目；不要重复创建。`
            : `项目 ${projectId} 已建立并推进至 ${view.status}。候选来源 ${view.sources.length} 条。`,
          view,
        );
      },
    });

    pi.registerTool({
      name: "research_project_list",
      label: "列出研究项目",
      description: "列出当前项目目录中已持久化的科研项目及其自然语言进度。",
      parameters: Type.Object({}),
      execute: async (_toolCallId, _params, _signal, _onUpdate, ctx) => {
        const service = await serviceFactory(ctx);
        const indexedProjects = await service.listProjects();
        const projects = [];
        for (const indexedProject of indexedProjects) {
          const result = await service.getProject(indexedProject.id);
          projects.push(publicProjectView(result, { includeOutputs: false }));
        }
        return toolResult(`当前共有 ${projects.length} 个科研项目。`, { projects });
      },
    });

    pi.registerTool({
      name: "research_project_read",
      label: "读取研究进度",
      description: "读取科研人员关心的研究问题、来源、证据产物、当前边界和待决定事项；隐藏内部工程对象。",
      parameters: Type.Object({
        projectId: Type.Optional(Type.String({ minLength: 1 })),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        const projectId = selectedProjectId(selectedByCwd, ctx, params.projectId);
        if (!projectId) throw new Error("未选择研究项目。先调用 research_project_create 或提供 projectId。");
        const service = await serviceFactory(ctx);
        const result = await service.getProject(projectId);
        selectedByCwd.set(resolve(ctx.cwd), projectId);
        const view = publicProjectView(result);
        return toolResult(`项目 ${projectId} 当前为 ${view.status}。`, view);
      },
    });

    pi.registerTool({
      name: "research_literature_landscape",
      label: "查看文献地形与候选方向",
      description: "从项目实际来源和证据记录生成可重叠分组、未分类桶、争议与待验证候选；这是透明启发式导航，不是科学聚类或验证结论。",
      parameters: Type.Object({
        projectId: Type.Optional(Type.String({ minLength: 1 })),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        const projectId = selectedProjectId(selectedByCwd, ctx, params.projectId);
        if (!projectId) throw new Error("未选择研究项目。先建立项目或提供 projectId。");
        const service = await serviceFactory(ctx);
        const result = await service.getProject(projectId);
        const view = landscapeProjectView(result);
        return toolResult(
          `当前 ${view.overview.sourceCount} 条来源形成 ${view.clusters.length} 个可重叠导航组、${view.ideaCandidates.length} 个尚未验证的候选方向。`,
          view,
        );
      },
    });

    pi.registerTool({
      name: "research_run_current_step",
      label: "推进当前研究",
      description: "让科研 Agent 按固定状态机处理当前事件，最多推进到下一人工 Gate、人工复核、阻塞或完成。不会自动批准。",
      promptGuidelines: ["A human boundary must be returned as awaiting_user_decision and never auto-approved."],
      executionMode: "sequential",
      parameters: Type.Object({
        projectId: Type.Optional(Type.String({ minLength: 1 })),
        maxSteps: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        searchQuery: Type.Optional(Type.String({ minLength: 1, description: "Deprecated. Frozen protocol queries cannot be overwritten while advancing; preview and revise the relevant protocol instead." })),
      }),
      execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
        const projectId = selectedProjectId(selectedByCwd, ctx, params.projectId);
        if (!projectId) throw new Error("未选择研究项目。先建立项目或提供 projectId。");
        const service = await serviceFactory(ctx);
        const result = await withProjectMutation(
          `${researchDataDir(ctx.cwd)}:${projectId}`,
          () => runProject(service, projectId, params.maxSteps ?? 100, signal, params.searchQuery ?? null),
        );
        selectedByCwd.set(resolve(ctx.cwd), projectId);
        recordSession(pi, ctx, "project_advanced", result, {
          retrievalError: result.retrievalError ?? null,
        });
        const view = publicProjectView(result);
        return toolResult(
          view.status === "awaiting_user_decision"
            ? `研究已停在人工决定点 ${view.boundary.nodeId}。必须由用户运行 /research-decide；Agent 不能批准。`
            : `研究已推进至 ${view.status}。`,
          view,
        );
      },
    });

    pi.registerTool({
      name: "research_resume_current_step",
      label: "恢复受阻研究",
      description: "研究者已处理网络或工具故障后，从同一项目、同一冻结协议恢复当前步骤；已持久化的成功检索不会重复。不会修改检索式或批准人工 Gate。",
      promptGuidelines: [
        "Use only after the user confirms the blocking cause has been checked or fixed.",
        "Do not change a frozen query through this tool.",
        "Stop again at any human boundary.",
      ],
      executionMode: "sequential",
      parameters: Type.Object({
        projectId: Type.Optional(Type.String({ minLength: 1 })),
        reason: Type.String({ minLength: 8, maxLength: 500 }),
        maxSteps: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      }),
      execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
        const projectId = selectedProjectId(selectedByCwd, ctx, params.projectId);
        if (!projectId) throw new Error("未选择研究项目。先建立项目或提供 projectId。");
        const service = await serviceFactory(ctx);
        const result = await withProjectMutation(
          `${researchDataDir(ctx.cwd)}:${projectId}`,
          () => resumeProject(service, projectId, params.maxSteps ?? 100, signal, params.reason),
        );
        selectedByCwd.set(resolve(ctx.cwd), projectId);
        recordSession(pi, ctx, "project_resumed", result, { reason: params.reason });
        const view = publicProjectView(result);
        return toolResult(`项目 ${projectId} 已从同一安全位置恢复至 ${view.status}。`, view);
      },
    });

    pi.registerTool({
      name: "research_export",
      label: "导出科研成果",
      description: "将当前研究导出为可追溯 JSON 研究包或 Markdown。未满足正式条件时会明确导出为受限草稿。",
      executionMode: "sequential",
      parameters: Type.Object({
        projectId: Type.Optional(Type.String({ minLength: 1 })),
        format: StringEnum(["json", "markdown", "bibtex"]),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        const projectId = selectedProjectId(selectedByCwd, ctx, params.projectId);
        if (!projectId) throw new Error("未选择研究项目。先建立项目或提供 projectId。");
        const service = await serviceFactory(ctx);
        const exported = await withProjectMutation(
          `${researchDataDir(ctx.cwd)}:${projectId}`,
          () => exportProject(service, projectId, params.format, ctx.cwd),
        );
        recordSession(pi, ctx, "project_exported", { id: projectId, boundary: {} }, exported);
        return toolResult(`已导出 ${exported.maturity}：${exported.path}`, exported);
      },
    });

    pi.registerCommand("research-new", {
      description: "从研究问题生成并真实比较 PubMed 候选，确认后建项并停在第一个人工决定点",
      handler: async (args, ctx) => {
        if (!ctx.hasUI) {
          ctx.ui.notify("无交互界面时不能创建需要确认的研究；请使用 Agent 工具并检查 awaiting_user_decision。", "warning");
          return;
        }
        let question = hasText(args) ? args.trim() : await ctx.ui.input("研究问题", "例如：术后睡眠与恢复有何关系？");
        if (!hasText(question)) return;
        const service = await serviceFactory(ctx);
        let preview = await previewPubMedQueryPlan({
          gateway: service.toolGateway,
          question,
          sampleLimit: 3,
          signal: ctx.signal,
        });
        let selectedCandidate = null;
        while (!selectedCandidate) {
          queryPlanByCwd.set(resolve(ctx.cwd), preview);
          display(pi, ctx, "PubMed 检索预演 · 尚未建项", queryPreviewView(preview));
          const readyCandidates = preview.candidates.filter((candidate) => candidate.status === "ready");
          const options = [
            ...readyCandidates.map(candidateChoiceLabel),
            "手动修改并重新试检",
            "返回修改研究问题",
            "取消建项",
          ];
          const choice = await ctx.ui.select("比较真实试检后选择", options);
          if (!choice || choice === "取消建项") return;
          if (choice === "返回修改研究问题") {
            const revisedQuestion = await ctx.ui.input("修改研究问题", question);
            if (!hasText(revisedQuestion)) return;
            question = revisedQuestion.trim();
            preview = await previewPubMedQueryPlan({
              gateway: service.toolGateway,
              question,
              sampleLimit: 3,
              signal: ctx.signal,
            });
            continue;
          }
          if (choice === "手动修改并重新试检") {
            const baseline = readyCandidates[0] ?? preview.candidates[0];
            const editedQuery = await ctx.ui.input("手动修改 PubMed 检索式", baseline?.query ?? "");
            if (!hasText(editedQuery)) return;
            preview = await previewPubMedQueryPlan({
              gateway: service.toolGateway,
              question,
              candidateQueries: editedCandidateQueries(preview, editedQuery.trim(), baseline),
              sampleLimit: 3,
              signal: ctx.signal,
            });
            continue;
          }
          const candidate = readyCandidates.find((item) => candidateChoiceLabel(item) === choice);
          if (!candidate) continue;
          const confirmedQuery = await ctx.ui.input("确认或修改 PubMed 检索式", candidate.query);
          if (!hasText(confirmedQuery)) return;
          if (confirmedQuery.trim() !== candidate.query) {
            preview = await previewPubMedQueryPlan({
              gateway: service.toolGateway,
              question,
              candidateQueries: editedCandidateQueries(preview, confirmedQuery.trim(), candidate),
              sampleLimit: 3,
              signal: ctx.signal,
            });
            continue;
          }
          selectedCandidate = candidate;
        }
        const title = await ctx.ui.input("项目名称", question.slice(0, 40));
        if (!hasText(title)) return;
        const confirmed = await ctx.ui.confirm(
          "建立研究",
          `采用已真实试检的“${selectedCandidate.label}”：PubMed 命中 ${selectedCandidate.total}，已抽查当前排序前 ${selectedCandidate.sampledCount} 条未筛选题名/摘要。\n\n${selectedCandidate.query}\n\n建项后只推进到首个人工决定点，不会自动批准 Gate。`,
        );
        if (!confirmed) return;
        const projectId = `research-${randomUUID()}`;
        const result = await withProjectMutation(
          `${researchDataDir(ctx.cwd)}:${projectId}`,
          () => createAndRun(service, {
            projectId,
            title,
            question,
            searchQuery: selectedCandidate.query,
            queryPreviewSelection: queryPreviewSelection(preview, selectedCandidate),
          }, ctx.signal),
        );
        selectedByCwd.set(resolve(ctx.cwd), projectId);
        recordSession(pi, ctx, "project_created_by_user", result, {
          retrievalError: result.retrievalError ?? null,
          queryPlanHash: preview.planHash,
          selectedCandidateId: selectedCandidate.id,
          previewSelectionHash: result.project?.retrievalRuns?.previewSelection?.selectionHash ??
            queryPreviewSelection(preview, selectedCandidate).selectionHash,
        });
        display(pi, ctx, "科研项目已建立", publicProjectView(result), result.retrievalError ? "warning" : "info");
      },
    });

    pi.registerCommand("research-status", {
      description: "显示当前科研项目、来源、研究产物和待决定事项",
      handler: async (args, ctx) => {
        const projectId = selectedProjectId(selectedByCwd, ctx, args);
        if (!projectId) {
          ctx.ui.notify("尚未选择科研项目。运行 /research-new。", "warning");
          return;
        }
        const service = await serviceFactory(ctx);
        const result = await service.getProject(projectId);
        selectedByCwd.set(resolve(ctx.cwd), projectId);
        display(pi, ctx, `科研状态 · ${result.project.title}`, publicProjectView(result));
      },
    });

    pi.registerCommand("research-continue", {
      description: "按状态机继续当前研究；遇人工边界立即停止",
      handler: async (args, ctx) => {
        const projectId = selectedProjectId(selectedByCwd, ctx, args);
        if (!projectId) {
          ctx.ui.notify("尚未选择科研项目。运行 /research-new。", "warning");
          return;
        }
        const service = await serviceFactory(ctx);
        const result = await withProjectMutation(
          `${researchDataDir(ctx.cwd)}:${projectId}`,
          () => runProject(service, projectId, 100, ctx.signal),
        );
        recordSession(pi, ctx, "project_advanced_by_user", result, {
          retrievalError: result.retrievalError ?? null,
        });
        display(pi, ctx, "研究已推进", publicProjectView(result), result.retrievalError ? "warning" : "info");
      },
    });

    pi.registerCommand("research-resume", {
      description: "在研究者确认故障已处理后，恢复当前受阻步骤",
      handler: async (args, ctx) => {
        const projectId = selectedProjectId(selectedByCwd, ctx, args);
        if (!projectId) {
          ctx.ui.notify("尚未选择科研项目。运行 /research-new。", "warning");
          return;
        }
        if (!ctx.hasUI || ctx.mode !== "tui") {
          ctx.ui?.notify?.("恢复受阻研究需要在 Pi 交互界面由研究者确认。", "warning");
          return;
        }
        const reason = await ctx.ui.input(
          "恢复理由",
          "请说明已检查或修复的网络、数据库或工具问题（至少 8 个字）",
        );
        if (!hasText(reason) || reason.trim().length < 8) {
          ctx.ui.notify("恢复理由至少需要 8 个字。", "warning");
          return;
        }
        const confirmed = await ctx.ui.confirm(
          "恢复受阻研究",
          "将沿当前冻结协议重试；已持久化的成功检索不会重复，也不会改写检索式或批准人工 Gate。",
        );
        if (!confirmed) return;
        const service = await serviceFactory(ctx);
        const result = await withProjectMutation(
          `${researchDataDir(ctx.cwd)}:${projectId}`,
          () => resumeProject(service, projectId, 100, ctx.signal, reason),
        );
        recordSession(pi, ctx, "project_resumed_by_user", result, { reason });
        display(pi, ctx, "科研项目已恢复", publicProjectView(result));
      },
    });

    pi.registerCommand("research-revise-protocol", {
      description: "由研究者说明理由，修订当前失败步骤的正式 PubMed 检索协议并继续",
      handler: async (args, ctx) => {
        const projectId = selectedProjectId(selectedByCwd, ctx, args);
        if (!projectId) {
          ctx.ui.notify("尚未选择科研项目。运行 /research-new。", "warning");
          return;
        }
        if (!ctx.hasUI || ctx.mode !== "tui") {
          ctx.ui?.notify?.("正式检索协议只能在 Pi 交互界面由研究者修订。", "warning");
          return;
        }
        const service = await serviceFactory(ctx);
        const current = await service.getProject(projectId);
        const boundary = current.projection?.boundary;
        if (boundary?.type !== "blocked") {
          ctx.ui.notify("当前项目没有停在可修订的正式检索失败步骤。", "warning");
          return;
        }
        const blockers = (boundary.blockers ?? []).filter((blocker) =>
          ["protocol_revision_required", "same_protocol_retry", "human_review_required"]
            .includes(blocker.retryClass),
        );
        if (blockers.length !== 1) {
          ctx.ui.notify(
            blockers.length === 0
              ? "当前阻塞不是正式检索协议问题。"
              : "当前有多个正式检索阻塞，请先在状态页确认唯一失败记录。",
            "warning",
          );
          return;
        }
        const blocker = blockers[0];
        const previousQuery = blocker.failedRequest?.query ?? current.project.searchQuery ?? "";
        const revisedQuery = await ctx.ui.input(
          "修订 PubMed 检索式",
          previousQuery,
        );
        if (!hasText(revisedQuery) || revisedQuery.trim().length < 3) {
          ctx.ui.notify("修订后的 PubMed 检索式至少需要 3 个字符。", "warning");
          return;
        }
        if (revisedQuery.trim() === previousQuery) {
          ctx.ui.notify("检索式没有变化；工具故障请使用 /research-resume 按原协议重试。", "warning");
          return;
        }
        const reason = await ctx.ui.input(
          "方法修订理由",
          "请说明原协议为什么需要改变、改了什么（至少 8 个字）",
        );
        if (!hasText(reason) || reason.trim().length < 8) {
          ctx.ui.notify("正式检索协议修订理由至少需要 8 个字符。", "warning");
          return;
        }
        const explicitRevision = blocker.retryClass !== "protocol_revision_required";
        const confirmed = await ctx.ui.confirm(
          "确认建立新版正式检索协议",
          [
            `失败步骤：${boundary.nodeId}`,
            `失败代码：${blocker.code ?? "未记录"}`,
            `原检索式：${previousQuery || "未记录"}`,
            `新检索式：${revisedQuery.trim()}`,
            `理由：${reason.trim()}`,
            "",
            "项目和既有成功回执已安全保存。新版协议会带研究者身份和理由，并使受影响的下游检索失效后重新执行。",
          ].join("\n"),
        );
        if (!confirmed) return;
        const result = await withProjectMutation(
          `${researchDataDir(ctx.cwd)}:${projectId}`,
          () => reviseRetrievalProtocol(service, projectId, {
            revisedQuery: revisedQuery.trim(),
            reason: reason.trim(),
            blockerId: blocker.id,
            explicitRevision,
            maxSteps: 100,
            signal: ctx.signal,
          }),
        );
        recordSession(pi, ctx, "retrieval_protocol_revised_by_user", result, {
          blockerId: blocker.id,
          failureCode: blocker.code ?? null,
          reason: reason.trim(),
        });
        display(pi, ctx, "新版检索协议已保存，研究已继续", publicProjectView(result));
      },
    });

    pi.registerCommand("research-decide", {
      description: "由当前用户对精确人工 Gate 或人工复核作出有理由的决定",
      handler: async (args, ctx) => {
        if (!ctx.hasUI) {
          ctx.ui.notify("人工 Gate 只能在可交互会话中决定；headless 模式保持 awaiting_user_decision。", "warning");
          return;
        }
        const projectId = selectedProjectId(selectedByCwd, ctx, args);
        if (!projectId) {
          ctx.ui.notify("尚未选择科研项目。", "warning");
          return;
        }
        const service = await serviceFactory(ctx);
        const current = await service.getProject(projectId);
        const boundary = current.projection.boundary;
        if (!["human_gate", "human_review"].includes(boundary.type)) {
          ctx.ui.notify(`当前不是人工决定点，而是 ${boundary.type}。`, "warning");
          return;
        }
        const choices = boundary.type === "human_gate"
          ? ["批准当前版本", "带风险接受", "要求修改", "拒绝"]
          : ["接受核查", "带限制接受", "要求修改", "拒绝"];
        const choice = await ctx.ui.select(`决定 · ${boundary.nodeId}`, choices);
        if (!choice) return;
        const reason = await ctx.ui.input("决定理由（必填）", "请写明检查了什么、接受哪些边界或要求怎样修改");
        if (!hasText(reason)) {
          ctx.ui.notify("没有理由的人工决定不会写入。", "warning");
          return;
        }
        if (["批准当前版本", "带风险接受", "接受核查", "带限制接受"].includes(choice)) {
          const confirmed = await ctx.ui.confirm(
            "确认写入不可覆盖的研究决定",
            `对象：${boundary.nodeId}\n理由：${reason}\n\n该决定将绑定当前产物版本与指纹。`,
          );
          if (!confirmed) return;
        }
        let result;
        if (boundary.type === "human_gate") {
          const decision = {
            "批准当前版本": "approved",
            "带风险接受": "accepted_risk",
            "要求修改": "amendment_requested",
            "拒绝": "rejected",
          }[choice];
          const node = REVIEW_RESEARCH_MACHINE_V1.nodes.find((item) => item.id === boundary.nodeId);
          result = await withProjectMutation(
            `${researchDataDir(ctx.cwd)}:${projectId}`,
            () => service.gateDecision({
              projectId,
              gateId: boundary.gateId,
              gateFingerprint: boundary.fingerprint,
              actor: { ...owner(), role: node.approverRoles[0] },
              decision,
              reason,
            }),
          );
        } else {
          const decision = {
            "接受核查": "accepted",
            "带限制接受": "accepted_with_limitations",
            "要求修改": "revision_requested",
            "拒绝": "rejected",
          }[choice];
          result = await withProjectMutation(
            `${researchDataDir(ctx.cwd)}:${projectId}`,
            () => service.manualReview({
              projectId,
              nodeId: boundary.nodeId,
              actor: { ...owner(), role: boundary.reviewerRole },
              decision,
              reason,
              limitations: decision === "accepted_with_limitations" ? reason : null,
            }),
          );
        }
        recordSession(pi, ctx, "human_decision", result, {
          nodeId: boundary.nodeId,
          decision: choice,
        });
        display(pi, ctx, "人工决定已写入；运行 /research-continue 继续", publicProjectView(result));
      },
    });

    pi.registerCommand("research-export", {
      description: "导出 JSON 研究包或 Markdown 正文；受限内容不会伪装成正式稿",
      handler: async (args, ctx) => {
        const [explicitId, explicitFormat] = args.trim().split(/\s+/).filter(Boolean);
        const projectId = selectedProjectId(selectedByCwd, ctx, explicitId);
        if (!projectId) {
          ctx.ui.notify("尚未选择科研项目。", "warning");
          return;
        }
        const format = ["json", "markdown", "bibtex"].includes(explicitFormat)
          ? explicitFormat
          : ctx.hasUI
            ? await ctx.ui.select("导出格式", ["json", "markdown", "bibtex"])
            : "json";
        if (!format) return;
        const service = await serviceFactory(ctx);
        const exported = await withProjectMutation(
          `${researchDataDir(ctx.cwd)}:${projectId}`,
          () => exportProject(service, projectId, format, ctx.cwd),
        );
        recordSession(pi, ctx, "project_exported_by_user", { id: projectId, boundary: {} }, exported);
        display(pi, ctx, "科研成果已导出", exported);
      },
    });
  };
}

export default createResearchExtension();

export const PI_RESEARCH_EXTENSION_INFO = Object.freeze({
  version: 1,
  tools: [
    "research_query_preview",
    "research_project_create",
    "research_project_list",
    "research_project_read",
    "research_literature_landscape",
    "research_run_current_step",
    "research_resume_current_step",
    "research_export",
  ],
  humanOnlyCommands: [
    "research-new",
    "research-resume",
    "research-revise-protocol",
    "research-decide",
  ],
});
