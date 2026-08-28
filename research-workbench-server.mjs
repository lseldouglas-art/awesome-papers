import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { ContentAddressedArtifactStore } from "./research-core/content-addressed-artifact-store-v1.js";
import {
  buildResearchOutputProjection,
} from "./research-core/research-artifact-presentation-v1.js";
import {
  authoritativeExportFile,
  publicExportManifest,
  resolveSignedExportAuthority,
} from "./research-core/export-authority-v1.js";
import { ResearchEngineError, sha256 } from "./research-core/event-engine-v1.js";
import { evaluateResearchFormalAuthority } from "./research-core/research-formal-authority-v1.js";
import { PiRuntimeAdapter } from "./research-core/pi-runtime-adapter-v1.js";
import { buildLiteratureLandscape } from "./research-core/research-literature-landscape-v1.js";
import {
  generatePubMedQueryPlan,
  previewPubMedQueryPlan,
} from "./research-core/research-query-planner-v1.js";
import {
  calibratePubMedQueryStrategy,
} from "./research-core/research-query-calibration-v1.js";
import {
  buildResearchDirectionSelection,
} from "./research-core/research-direction-selection-v1.js";
import { assertResearchReportSelectionBinding } from "./research-core/research-report-contract-v1.js";
import {
  createQueryStrategyModel,
  generatePromptDrivenPubMedQueryPlan,
} from "./research-core/research-query-strategy-agent-v1.js";
import {
  ResearchAgentServiceError,
  ResearchAgentServiceV1,
} from "./research-core/research-agent-service-v1.js";
import { ResearchToolGateway } from "./research-core/research-tool-gateway-v1.js";
import {
  EXECUTION_STATES,
  REVIEW_RESEARCH_MACHINE_V1,
} from "./research-core/review-research-machine-v1.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const production = process.argv.includes("--production") || process.env.NODE_ENV === "production";
const envMode = process.env.NODE_ENV === "test" ? "test" : production ? "production" : "development";
const viteModule = production ? null : await import("vite");
const env = {
  ...(viteModule ? viteModule.loadEnv(envMode, root, "") : {}),
  ...process.env,
};
const host = env.RESEARCH_WORKBENCH_HOST || "127.0.0.1";
const port = Number(env.RESEARCH_WORKBENCH_PORT || env.PORT || 5177);
const dataDir = env.RESEARCH_WORKBENCH_DATA_DIR || join(root, ".research-workbench-data");
const staticDir =
  env.NODE_ENV === "test" && env.RESEARCH_WORKBENCH_STATIC_DIR
    ? resolve(env.RESEARCH_WORKBENCH_STATIC_DIR)
    : resolve(join(root, "dist-research"));
const ownerId = env.RESEARCH_WORKBENCH_OWNER_ID || "local-researcher";
const authUsername = env.RESEARCH_WORKBENCH_AUTH_USERNAME || "";
const authPassword = env.RESEARCH_WORKBENCH_AUTH_PASSWORD || "";
if (Boolean(authUsername) !== Boolean(authPassword)) {
  throw new Error(
    "RESEARCH_WORKBENCH_AUTH_USERNAME and RESEARCH_WORKBENCH_AUTH_PASSWORD must be configured together.",
  );
}
const machine = REVIEW_RESEARCH_MACHINE_V1;
const startedAt = new Date().toISOString();
const ARTIFACT_LABELS = Object.freeze({
  ResearchIntent: "研究意图",
  ResearchQuestionCandidate: "候选研究问题",
  ScopeBoundary: "研究范围边界",
  ResearchBrief: "已确认的研究简报",
  ScopeDecision: "问题范围决定",
  OrientationConceptMatrix: "领域探索概念矩阵",
  OrientationSearchProtocol: "领域探索检索方案",
  SearchRunSnapshot: "试检运行记录",
  OrientationCalibrationReport: "宽检索校准报告",
  FrozenOrientationSearchProtocol: "已冻结的宽检索方案",
  OrientationCorpusManifest: "领域认识语料清单",
  OrientationSourceSnapshot: "领域认识来源快照",
  LandscapeProfile: "领域证据画像",
  ReviewAngleCandidate: "候选综述方向",
  ReviewAngleDecision: "综述方向决定",
  FocusedResearchBrief: "聚焦研究简报",
  FocusedConceptMatrix: "精准检索概念矩阵",
  FocusedSearchProtocol: "精准检索方案",
  FocusedSearchRunSnapshot: "精准检索试运行记录",
  FocusedCalibrationReport: "精准检索校准报告",
  FrozenSearchProtocol: "已冻结的正式检索方案",
  LibraryManifest: "可追溯文献库清单",
  SourceSnapshot: "来源内容快照",
  EvidenceRecord: "证据提取记录",
  AppraisalRecord: "证据质量评估",
  CounterevidenceRegister: "反证登记",
  CoverageGapRegister: "证据缺口登记",
  ClaimEvidenceMap: "主张—证据关系图",
  ResearchConclusionCard: "受限研究判断",
  EvidenceVerificationReport: "独立证据核查报告",
  EvidenceBoundaryDecision: "证据边界决定",
  EvidenceDrivenOutline: "证据驱动的论证结构",
  OutlineStressTest: "论证结构压力测试",
  OutlineDecision: "论证路线决定",
  FrozenWritingPlan: "已确认的写作计划",
  ClaimUnitDraft: "逐论点写作草稿",
  ClaimVerificationResult: "逐句引用核查结果",
  AcceptedClaimUnit: "已确认的主张单元",
  ManuscriptDraft: "全文候选稿",
  ManuscriptAudit: "全文科研审计",
  AuditedManuscript: "经审计的全文",
  DeliveryBundle: "可提交交付包",
  ExportManifest: "导出文件清单",
  AuthorApproval: "作者责任确认",
  SignedDelivery: "作者签署版本",
});

const BRIEF_ACCESS_LABELS = Object.freeze({
  title_only: "仅题名",
  abstract_only: "摘要级",
  full_text: "全文级",
  full_text_and_supplement: "全文与补充材料级",
  user_provided_note: "用户笔记",
  unknown: "访问层级未知",
});

const BRIEF_CONFIDENCE_LABELS = Object.freeze({
  provisional: "初步判断",
  bounded: "限域判断",
  convergent: "多来源一致判断",
});

const artifactStore = new ContentAddressedArtifactStore({
  rootDir: join(dataDir, "artifacts"),
});
const testPubMedBaseUrl = (() => {
  if (env.NODE_ENV !== "test" || !env.RESEARCH_PUBMED_BASE_URL) return null;
  const parsed = new URL(env.RESEARCH_PUBMED_BASE_URL);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    !["127.0.0.1", "::1", "localhost"].includes(parsed.hostname)
  ) {
    throw new Error(
      "RESEARCH_PUBMED_BASE_URL is test-only and must point to a loopback HTTP(S) origin.",
    );
  }
  return parsed;
})();
const toolGateway = new ResearchToolGateway({
  artifactStore,
  ncbiApiKey: env.NCBI_API_KEY || null,
  email: env.NCBI_EMAIL || null,
  tool: env.NCBI_TOOL || "local-research-workbench",
  ...(testPubMedBaseUrl
    ? {
        baseUrl: testPubMedBaseUrl.href,
        allowedPubMedOrigins: [testPubMedBaseUrl.origin],
        minIntervalMs: Number(env.RESEARCH_PUBMED_MIN_INTERVAL_MS ?? 0),
        retryCount: Number(env.RESEARCH_PUBMED_RETRY_COUNT ?? 0),
        timeoutMs: Number(env.RESEARCH_PUBMED_TIMEOUT_MS ?? 15_000),
      }
    : {}),
});
const piRuntime = new PiRuntimeAdapter({
  gateway: toolGateway,
  env,
  forceMode: env.RESEARCH_AGENT_FORCE_MODE || "auto",
});
const service = new ResearchAgentServiceV1({
  dataDir,
  machine,
  artifactStore,
  piRuntimeAdapter: piRuntime,
  toolGateway,
});
const activeRuns = new Map();
const activeCreates = new Map();
const queryPlans = new Map();
const queryCalibrations = new Map();
const queryPreviews = new Map();
const directionSelections = new Map();
const queryStrategyModel = createQueryStrategyModel({ env });

const vite = production
  ? null
  : await viteModule.createServer({
      root,
      server: { middlewareMode: true },
      appType: "spa",
    });

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function projectIdFromIdempotencyKey(request) {
  const value = request.headers["idempotency-key"];
  if (value === undefined) return `research-${randomUUID()}`;
  if (Array.isArray(value) || !/^[A-Za-z0-9._:-]{8,200}$/.test(value)) {
    throw Object.assign(
      new Error("Idempotency-Key 必须是 8–200 位字母、数字或 . _ : -。"),
      { code: "INVALID_IDEMPOTENCY_KEY" },
    );
  }
  return `research-${sha256Bytes(`create:${value}`).slice(0, 32)}`;
}

function rememberQueryPreview(preview) {
  queryPreviews.set(preview.planHash, {
    preview: structuredClone(preview),
    expiresAt: Date.now() + 30 * 60 * 1000,
  });
  if (queryPreviews.size > 200) {
    for (const [planHash, entry] of queryPreviews) {
      if (entry.expiresAt <= Date.now() || queryPreviews.size > 200) {
        queryPreviews.delete(planHash);
      }
    }
  }
  return preview;
}

function rememberExpiring(map, key, value) {
  map.set(key, {
    value: structuredClone(value),
    expiresAt: Date.now() + 30 * 60 * 1000,
  });
  if (map.size > 200) {
    for (const [entryKey, entry] of map) {
      if (entry.expiresAt <= Date.now() || map.size > 200) map.delete(entryKey);
    }
  }
  return value;
}

function requireExpiring(map, key, { staleCode, staleMessage }) {
  const entry = map.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    map.delete(key);
    throw Object.assign(new Error(staleMessage), { code: staleCode });
  }
  return structuredClone(entry.value);
}

function requireQueryPreviewSelection(body) {
  if (typeof body.queryPlanHash !== "string" || !/^[a-f0-9]{64}$/i.test(body.queryPlanHash)) {
    throw Object.assign(
      new Error("建项前必须先完成 PubMed 真实试检，并提交该次计划指纹。"),
      { code: "QUERY_PREVIEW_REQUIRED" },
    );
  }
  const entry = queryPreviews.get(body.queryPlanHash);
  if (!entry || entry.expiresAt <= Date.now()) {
    queryPreviews.delete(body.queryPlanHash);
    throw Object.assign(
      new Error("检索试检记录不存在或已过期；请重新试检后再建立研究。"),
      { code: "QUERY_PREVIEW_STALE" },
    );
  }
  const preview = entry.preview;
  if (preview.question !== body.question.trim()) {
    throw Object.assign(
      new Error("研究问题已改变；请针对当前问题重新试检。"),
      { code: "QUERY_PREVIEW_STALE" },
    );
  }
  const candidate = preview.candidates.find(
    (item) => item.id === body.selectedCandidateId,
  );
  if (!candidate || candidate.status !== "ready") {
    throw Object.assign(
      new Error("所选检索候选没有完成真实 PubMed 试检，不能用于建项。"),
      { code: "QUERY_CANDIDATE_NOT_READY" },
    );
  }
  if (candidate.query !== body.searchQuery.trim()) {
    throw Object.assign(
      new Error("检索式已改变；请重新试检，不能沿用旧命中量建项。"),
      { code: "QUERY_PREVIEW_STALE" },
    );
  }
  return candidate;
}

function queryPreviewFailureForSelection(body) {
  if (
    typeof body.queryPlanHash !== "string" ||
    !/^[a-f0-9]{64}$/i.test(body.queryPlanHash)
  ) {
    return null;
  }
  const entry = queryPreviews.get(body.queryPlanHash);
  if (
    !entry ||
    entry.expiresAt <= Date.now() ||
    entry.preview.question !== body.question?.trim()
  ) {
    return null;
  }
  const candidate = entry?.preview?.candidates?.find(
    (item) => item.id === body.selectedCandidateId,
  );
  if (!candidate || candidate.query !== body.searchQuery?.trim()) return null;
  if (candidate.status === "zero_results") {
    return {
      code: "PUBMED_NO_RESULTS",
      message: "PubMed 真实试检返回 0 条；项目已保留，可在同一项目修改检索式后重试。",
    };
  }
  if (candidate.status === "failed") {
    return {
      code: candidate.error?.code ?? "PUBMED_PREVIEW_FAILED",
      message:
        candidate.error?.message ??
        "PubMed 真实试检失败；项目已保留，可在同一项目修复后重试。",
    };
  }
  return null;
}

function queryPreviewSelectionForBody(body) {
  const entry = queryPreviews.get(body.queryPlanHash);
  const candidate = entry?.preview?.candidates?.find(
    (item) => item.id === body.selectedCandidateId,
  );
  if (!entry || !candidate) return null;
  const samples = (candidate.samples ?? []).map((sample) => ({
    sourceId: sample.sourceId ?? (sample.pmid ? `pubmed:${sample.pmid}` : null),
    pmid: sample.pmid ?? null,
    title: sample.title,
    abstractSnippet: sample.abstractSnippet ?? null,
    accessLevel: sample.accessLevel,
    locator: sample.locator ?? null,
  }));
  const mappedConcepts = Array.isArray(entry.preview.mappings)
    ? entry.preview.mappings
    : [];
  const subjectMappings = mappedConcepts.filter((mapping) => mapping?.role === "subject");
  const subjectConcepts = (subjectMappings.length > 0 ? subjectMappings : mappedConcepts)
    .map((mapping) => ({
      conceptId: mapping.conceptId,
      sourceTerm: mapping.sourceTerm,
      role: mapping.role,
      mappedTerms: Array.isArray(mapping.mappedTerms) ? mapping.mappedTerms : [],
      meshTerms: Array.isArray(mapping.meshTerms) ? mapping.meshTerms : [],
    }));
  const selection = {
    schemaVersion: "research-query-preview-selection/v1",
    planHash: entry.preview.planHash,
    candidateId: candidate.id,
    candidateStatus: candidate.status,
    question: entry.preview.question,
    query: candidate.query,
    total: Number.isInteger(candidate.total) ? candidate.total : null,
    executedAt: candidate.executedAt ?? null,
    ...(candidate.error ? { error: candidate.error } : {}),
    samples,
    sampleSourceIds: samples.map((sample) => sample.sourceId),
    subjectConcepts,
    ...(entry.preview.directionSeed
      ? { directionSeed: structuredClone(entry.preview.directionSeed) }
      : {}),
    ...(entry.preview.directionBinding
      ? { directionBinding: structuredClone(entry.preview.directionBinding) }
      : {}),
    ...(entry.preview.reviewLandscape
      ? { reviewLandscape: structuredClone(entry.preview.reviewLandscape) }
      : {}),
    ...(entry.preview.strategyCalibration
      ? { strategyCalibration: structuredClone(entry.preview.strategyCalibration) }
      : {}),
  };
  return { ...selection, selectionHash: sha256(selection) };
}

function scopingContextForCreate(body, finalPreviewSelection) {
  if (typeof body.directionSelectionHash !== "string") return null;
  if (!/^[a-f0-9]{64}$/i.test(body.directionSelectionHash)) {
    throw Object.assign(new Error("方向选择指纹无效；请重新提交方向决定。"), {
      code: "INVALID_DIRECTION_SELECTION_HASH",
    });
  }
  const context = requireExpiring(directionSelections, body.directionSelectionHash, {
    staleCode: "DIRECTION_SELECTION_STALE",
    staleMessage: "方向选择记录不存在或已过期；请从首轮综述重新确认方向。",
  });
  if (
    context.decision.decisionHash !== body.directionSelectionHash ||
    context.decision.narrowedBrief.question.trim().normalize("NFKC") !== body.question.trim().normalize("NFKC")
  ) {
    throw Object.assign(
      new Error("最终研究问题已经改变；请重新确认方向并执行第二轮调查。"),
      { code: "SCOPING_DECISION_MISMATCH" },
    );
  }
  if (!finalPreviewSelection || finalPreviewSelection.question.trim() !== body.question.trim()) {
    throw Object.assign(
      new Error("第二轮调查没有绑定当前收窄问题，不能建立正式项目。"),
      { code: "SECOND_ROUND_PREVIEW_REQUIRED" },
    );
  }
  const decision = context.decision;
  const expectedFocusHash = sha256(decision.narrowedBrief?.focusMapping ?? null);
  const expectedQuery = String(decision.narrowedBrief?.suggestedQuery ?? "").trim();
  const binding = finalPreviewSelection.directionBinding;
  if (
    !binding
    || binding.decisionHash !== decision.decisionHash
    || binding.selectedDirectionId !== decision.selectedDirection.id
    || binding.sourcePreviewPlanHash !== decision.sourcePreviewPlanHash
    || binding.reportHash !== (decision.reportBinding?.reportHash ?? null)
    || binding.focusMappingHash !== expectedFocusHash
    || binding.focusedQueryHash !== sha256(expectedQuery)
    || finalPreviewSelection.query !== expectedQuery
  ) {
    throw Object.assign(
      new Error("第二轮调查未完整绑定方向决定、科研简报和受控方向词群，不能建立正式项目。"),
      { code: "SECOND_ROUND_DIRECTION_BINDING_MISMATCH" },
    );
  }
  return {
    scopingDecision: context.decision,
    scopingVerification: {
      schemaVersion: "research-scoping-verification/v1",
      status: "exploratory_unverified",
      sameTopicReviewOverlapVerified: false,
      primaryStudyVolumeVerified: false,
      verdict: "unknown",
      requiredChecks: [
        "独立执行近两年同题综述检索，并按 PICO/PCC 与评价轴逐篇比较重叠。",
        "排除综述与指南后执行原始研究量预检、去重和初筛，重新估算工作量。",
        "记录 retain / revise / drop / unknown 结论及其可定位证据。",
      ],
      boundary: "本次第二轮仍是题名摘要级聚焦样本，只能支持继续调查，不能证明创新度、50–100 篇文献量或正式立题可行性。",
    },
    scopingRounds: [
      {
        round: 1,
        role: "orientation",
        question: context.roundOnePreviewSelection.question,
        query: context.roundOnePreviewSelection.query,
        previewSelection: context.roundOnePreviewSelection,
      },
      {
        round: 2,
        role: "focused",
        question: finalPreviewSelection.question,
        query: finalPreviewSelection.query,
        previewSelection: finalPreviewSelection,
      },
    ],
  };
}

function queryPlanWithDirectionSeed(plan, decision) {
  const query = String(decision?.narrowedBrief?.suggestedQuery ?? "").trim();
  if (query.length < 3) return plan;
  const focusMapping = decision?.narrowedBrief?.focusMapping;
  const sourceMappings = Array.isArray(plan.mappings)
    ? structuredClone(plan.mappings)
    : [];
  const hasFocusMapping = focusMapping
    && focusMapping.conceptId
    && !sourceMappings.some((mapping) => mapping.conceptId === focusMapping.conceptId);
  const mappings = hasFocusMapping
    ? [
        ...sourceMappings,
        {
          ...structuredClone(focusMapping),
          roleLabel: "研究者选定方向",
          excludedAmbiguities: [],
          confidence: "human_selected_controlled_seed",
        },
      ]
    : sourceMappings;
  const sourceConceptGroups = Array.isArray(plan.conceptGroups)
    ? structuredClone(plan.conceptGroups)
    : [];
  const conceptGroups = hasFocusMapping
    ? [
        ...sourceConceptGroups,
        {
          id: focusMapping.conceptId,
          sourceTerm: focusMapping.sourceTerm,
          role: "selected_direction",
          roleLabel: "研究者选定方向",
          meshTerms: [...(focusMapping.meshTerms ?? [])],
          freeTextTerms: [...(focusMapping.mappedTerms ?? [])],
          wildcardTerms: [...(focusMapping.wildcardTerms ?? [])],
          proximityTerms: structuredClone(focusMapping.proximityTerms ?? []),
          excludedAmbiguities: [],
          confidence: "human_selected_controlled_seed",
        },
      ]
    : sourceConceptGroups;
  const seeded = {
    ...structuredClone(plan),
    planner: {
      ...structuredClone(plan.planner),
      mode: "human_selected_direction_seed_v1",
      claim: "已继承首轮研究对象词群，并追加研究者所选方向的受控英文词群。",
    },
    mappings,
    conceptGroups,
    candidates: [
      {
        id: "selected_direction_focused",
        label: "方向收窄检索式",
        strategy: decision.narrowedBrief.queryRationale,
        query: query.slice(0, 5_000),
        includedConceptIds: [...new Set(
          mappings.map((mapping) => mapping.conceptId).filter(Boolean),
        )],
      },
    ],
    unknownChinese: Array.isArray(plan.unknownChinese)
      ? plan.unknownChinese.filter((term) => term !== decision.selectedDirection.direction)
      : [],
    directionSeed: {
      decisionHash: decision.decisionHash,
      selectedDirectionId: decision.selectedDirection.id,
      themeId: decision.selectedDirection.themeId,
      sourcePreviewPlanHash: decision.sourcePreviewPlanHash,
    },
    accessBoundary:
      "第二轮初稿继承首轮已确认的研究对象词群，并加入被选方向的受控词群；尚未访问 PubMed，研究者确认后才执行前 100 篇反馈校准。",
  };
  const { planHash: _oldPlanHash, ...body } = seeded;
  return { ...body, planHash: sha256(body) };
}

function sendDownload(response, { body, contentType, fileName, sha256 = null }) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
  const digest = sha256 ?? sha256Bytes(bytes);
  response.writeHead(200, {
    "Content-Type": `${contentType}; charset=utf-8`,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": String(bytes.byteLength),
    "Digest": `sha-256=${Buffer.from(digest, "hex").toString("base64")}`,
    "X-Content-SHA256": digest,
  });
  response.end(bytes);
}

const staticContentTypes = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
});

async function serveProduction(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD", "X-Content-Type-Options": "nosniff" });
    response.end();
    return;
  }
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400, { "X-Content-Type-Options": "nosniff" });
    response.end();
    return;
  }
  const relativePath =
    decodedPath === "/" || decodedPath === "/research-workbench"
      ? "research-workbench.html"
      : decodedPath.replace(/^\/+/, "");
  const filePath = resolve(join(staticDir, relativePath));
  if (filePath !== staticDir && !filePath.startsWith(`${staticDir}${sep}`)) {
    response.writeHead(403, { "X-Content-Type-Options": "nosniff" });
    response.end();
    return;
  }
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  if (!fileStat.isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": staticContentTypes[extname(filePath)] || "application/octet-stream",
    "Content-Length": String(fileStat.size),
    "Cache-Control": filePath.endsWith(".html")
      ? "no-cache"
      : "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

async function readJson(request) {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > 256_000) {
    const error = new Error("请求内容超过 256 KB；请分批添加材料。");
    error.code = "REQUEST_TOO_LARGE";
    throw error;
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.byteLength;
    if (bytes > 256_000) {
      const error = new Error("请求内容超过 256 KB；请分批添加材料。");
      error.code = "REQUEST_TOO_LARGE";
      throw error;
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(body || "{}");
  } catch {
    const error = new Error("请求正文不是有效 JSON。");
    error.code = "INVALID_JSON";
    throw error;
  }
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function humanActor(role = "human_researcher") {
  return { id: ownerId, role, kind: "human" };
}

function splitLines(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  return value
    .split(/\r?\n|；/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function locatorForMaterial(value) {
  const pmid = value.match(/(?:PMID\s*[:：]?\s*)?(\d{7,9})\b/i)?.[1];
  if (pmid) return { pmid, url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` };
  const doi = value.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0];
  if (doi) return { doi, url: `https://doi.org/${doi}` };
  try {
    const url = new URL(value);
    if (["http:", "https:"].includes(url.protocol)) return { url: url.href };
  } catch {
    // A prose material description intentionally falls through.
  }
  return null;
}

function normalizeMaterialInput(value, projectId, index) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  const text = String(value ?? "").trim();
  const locator = locatorForMaterial(text);
  const locatorOnly = Boolean(locator);
  return {
    id: `source:${projectId}:${index + 1}`,
    title: text.slice(0, 180) || `来源材料 ${index + 1}`,
    text: locatorOnly ? null : text,
    provider: locatorOnly ? null : "user_provided_note",
    accessLevel: locatorOnly ? "title_only" : "unknown",
    locator: locator ?? { repositoryId: `project:${projectId}:materials` },
    limitations: locatorOnly
      ? ["当前只记录了来源定位，尚未取得摘要或全文。"]
      : ["这是用户提供的笔记或材料说明，不是摘要或全文，不能直接作为文献证据。"],
  };
}

function normalizeSourceMaterials(value, projectId) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== null && item !== undefined)
      .map((item, index) => normalizeMaterialInput(item, projectId, index));
  }
  const entries = splitLines(value);
  return entries.map((item, index) => normalizeMaterialInput(item, projectId, index));
}

function hasLivePubMedSources(project) {
  return (
    project?.researchMode === "live_pubmed" &&
    (project?.retrievalRuns?.finalLibrary?.receipt?.records?.length ?? 0) > 0
  );
}

function previewSelection(project) {
  return project?.retrievalRuns?.previewSelection ?? null;
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

function latestRetrievalReceipt(project) {
  return formalRetrievalRuns(project).at(-1)?.receipt ?? null;
}

function retrievalSourcePresentation(project) {
  const run = formalRetrievalRuns(project).at(-1) ?? null;
  const legacy = project?.retrievalRuns?.legacyBootstrap ?? null;
  if (run?.purpose === "finalLibrary") {
    return {
      purpose: "finalLibrary",
      stage: "final_library",
      status: "最终文献库来源",
      eligibility: "final_library_source",
      purposeText: "核对最终冻结文献库中的题录、可见摘要、访问层级与定位信息。",
      limitation: "已进入本轮最终文献库，但仍不等于全文核查或支持具体结论。",
      receiptHash: run.receipt?.receiptHash ?? null,
    };
  }
  if (run) {
    const label = {
      pilot: "试检候选来源",
      orientationCorpus: "领域宽检索候选来源",
      focusedCalibration: "聚焦校准候选来源",
    }[run.purpose] ?? "检索校准候选来源";
    return {
      purpose: run.purpose,
      stage: "formal_retrieval_in_progress",
      status: label,
      eligibility: "calibration_source_not_final",
      purposeText: "核对当前检索校准阶段保存的题录、可见摘要和访问层级。",
      limitation: "当前材料只用于试检、领域认识或聚焦校准，尚未进入最终冻结文献库。",
      receiptHash: run.receipt?.receiptHash ?? null,
    };
  }
  if (legacy) {
    return {
      purpose: "legacyBootstrap",
      stage: "legacy_single_receipt",
      status: "历史单次检索来源",
      eligibility: "legacy_trace_only",
      purposeText: "保留旧版本单次检索的题录与摘要以便追溯。",
      limitation: "历史单次回执不能证明分阶段检索，也不能升格为正式文献库。",
      receiptHash: legacy.receipt?.receiptHash ?? null,
    };
  }
  return {
    purpose: "user_materials",
    stage: "not_started",
    status: "项目补充材料",
    eligibility: "user_supplied_not_final",
    purposeText: "核对研究者补充的来源定位与当前实际访问层级。",
    limitation: "用户补充材料尚未通过最终文献库冻结与证据核查。",
    receiptHash: null,
  };
}

function contentMaturityFor(result, status) {
  const authority = evaluateResearchFormalAuthority({
    project: result.project,
    artifacts: result.artifacts,
    runtimeProvenance: result.runtimeProvenance,
    workflowComplete: status === "completed",
  });
  if (hasLivePubMedSources(result.project)) {
    const formal = authority.formalResearchComplete;
    return {
      code: formal ? "live_pubmed_audited_signed" : "live_pubmed_guided_analysis",
      label: formal ? "PubMed 实时研究 · 已审计签署" : "PubMed 真实检索 · Agent 受限分析",
      formalResearchComplete: formal,
      boundary: formal
        ? "已完成实时 Agent 运行、审计与作者签署；结论仍只适用于本轮已保存来源及其实际访问层级。"
        : authority.boundary,
    };
  }
  if (result.project?.researchMode === "live_pubmed") {
    return {
      code: "live_pubmed_pending",
      label: previewSelection(result.project) ? "PubMed 真实预检 · 等待确认范围" : "等待 PubMed 真实检索",
      formalResearchComplete: false,
      boundary: authority.boundary,
    };
  }
  return {
    code: "guided_draft",
    label: "结构化流程草案",
    formalResearchComplete: false,
    boundary: "当前项目没有绑定最终 PubMed 文献库；即使模型流程已运行，也只能证明流程、门禁和可追溯记录，不能升格为正式研究成果。",
  };
}

function latestArtifact(result, type) {
  return result.artifacts.filter((artifact) => artifact.type === type).at(-1) ?? null;
}

function humanDecisionLog(result) {
  return Object.values(result.state.gates ?? {})
    .filter((gate) => gate.status !== "pending")
    .map((gate) => ({
      gateId: gate.id,
      nodeId: gate.nodeId,
      decision: gate.status,
      reason: gate.reason ?? null,
      decidedAt: gate.decidedAt ?? null,
      decidedBy: gate.decidedBy ?? null,
      gateFingerprint: gate.fingerprint ?? null,
    }));
}

function literatureLandscapeFor(result) {
  const evidenceRecords = result.artifacts.filter(
    (artifact) => artifact.type === "EvidenceRecord",
  );
  const generatedAt =
    latestArtifact(result, "LibraryManifest")?.producedAt ??
    latestArtifact(result, "OrientationCorpusManifest")?.producedAt ??
    latestRetrievalReceipt(result.project)?.fetchedAt ??
    latestRetrievalReceipt(result.project)?.executedAt ??
    null;
  return buildLiteratureLandscape({
    project: result.project,
    evidenceRecords,
    generatedAt,
  });
}

function landscapeResearchOutputs(landscape) {
  const clusterItems = landscape.clusterMap.clusters.map((cluster) => ({
    id: cluster.id,
    type: "ClusterMap",
    title: cluster.label,
    purpose: "查看当前来源为什么被放在这个可重叠文献组中。",
    status: "启发式分组",
    summary: `${cluster.sourceCount} 条当前来源；匹配词：${cluster.matchedTerms.join("、")}。`,
    readableBody: cluster.interpretationBoundary,
    details: cluster,
    sourceIds: cluster.sourceIds,
    sourceRefs: cluster.sourceRefs,
    accessLevels: [...new Set(cluster.sourceRefs.map((source) => source.accessLevel))],
    limitations: [cluster.interpretationBoundary],
  }));
  const ideaItems = landscape.ideaCandidates.map((candidate) => ({
    id: candidate.id,
    type: "IdeaCandidate",
    title: `待验证方向：${candidate.anchor.label}`,
    purpose: "把文献分组转成可重检、可放弃、可进入最小验证的候选问题。",
    status: candidate.status === "selected_for_recheck" ? "已选中重检" : "尚未验证",
    summary: candidate.relationshipRationale,
    readableBody: `${candidate.validationBoundary}\n\n建议重检式：${candidate.recheckQuery}`,
    details: candidate,
    sourceIds: candidate.sourceRefs.map((source) => source.sourceId),
    sourceRefs: candidate.sourceRefs,
    accessLevels: [...new Set(candidate.sourceRefs.map((source) => source.accessLevel))],
    limitations: [candidate.validationBoundary],
  }));
  const overview = landscape.literatureLandscape;
  return [
    {
      id: overview.id,
      type: "LiteratureLandscape",
      title: "当前文献地形",
      purpose: "先看分组、未分类和争议，再决定要聚焦哪个候选方向。",
      status: "可追溯导航图",
      summary: `${overview.sourceCount} 条来源；${overview.unclassifiedSourceCount} 条未分类（${Math.round(overview.unclassifiedRate * 100)}%）；${overview.controversies.length} 个已登记争议。`,
      readableBody: overview.interpretationBoundary,
      details: overview,
      sourceIds: overview.sourceRefs.map((source) => source.sourceId),
      sourceRefs: overview.sourceRefs,
      accessLevels: [...new Set(overview.sourceRefs.map((source) => source.accessLevel))],
      limitations: [overview.interpretationBoundary],
    },
    ...clusterItems,
    ...ideaItems,
    {
      id: landscape.unclassifiedBucket.id,
      type: "UnclassifiedBucket",
      title: "尚未分类的来源",
      purpose: "把无法归类的材料显式保留，避免被系统静默丢弃。",
      status: landscape.unclassifiedBucket.sourceCount === 0 ? "当前无未分类项" : "需要人工检查",
      summary: `${landscape.unclassifiedBucket.sourceCount} / ${landscape.unclassifiedBucket.totalSourceCount} 条来源尚未分类。`,
      readableBody: landscape.unclassifiedBucket.nextAction,
      details: landscape.unclassifiedBucket,
      sourceIds: landscape.unclassifiedBucket.sourceIds,
      sourceRefs: landscape.unclassifiedBucket.sourceRefs,
      accessLevels: [...new Set(landscape.unclassifiedBucket.sourceRefs.map((source) => source.accessLevel))],
      limitations: ["未分类不等于无关。"],
    },
  ];
}

function nodeById(nodeId) {
  return machine.nodes.find((node) => node.id === nodeId) ?? null;
}

function phaseByNodeId(nodeId) {
  const node = nodeById(nodeId);
  return node ? machine.phases.find((phase) => phase.id === node.phaseId) ?? null : null;
}

function openBlockers(state) {
  return machine.nodes.flatMap((node) =>
    Object.values(state.nodeExecutions[node.id]?.blockers ?? {})
      .filter((blocker) => blocker.status !== "resolved")
      .map((blocker) => ({ ...blocker, nodeId: node.id })),
  );
}

function activeRunFor(projectId) {
  return activeRuns.get(projectId) ?? null;
}

function statusForResult(result) {
  if (activeRunFor(result.project.id)) return "running";
  const boundary = result.projection.boundary;
  if (boundary.type === "complete") return "completed";
  if (boundary.type === "human_gate") return "awaiting_gate";
  if (boundary.type === "human_review") return "awaiting_review";
  if (boundary.type === "cancelled") return "cancelled";
  if (boundary.type === "blocked") {
    return boundary.blockers?.some((blocker) => blocker.id?.startsWith("pause:"))
      ? "paused"
      : "blocked";
  }
  return "idle";
}

function uniqueBriefText(values, limit = 4) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))]
    .slice(0, limit);
}

function userBriefFor({
  result,
  artifactViews,
  status,
  maturity,
  phase,
  node,
  pendingGate,
  pendingReview,
  currentBlocker,
}) {
  const currentArtifacts = artifactViews.filter(
    (artifact) => artifact.freshness !== "stale" && !["rejected", "superseded", "stale"].includes(artifact.status),
  );
  const acceptedConclusions = currentArtifacts.filter(
    (artifact) =>
      artifact.type === "ResearchConclusionCard" &&
      ["accepted", "verified"].includes(artifact.status) &&
      typeof artifact.content?.claim === "string",
  );
  const currentEvidence = currentArtifacts.filter(
    (artifact) =>
      artifact.type === "EvidenceRecord" &&
      ["accepted", "verified"].includes(artifact.status),
  );
  const verificationReports = currentArtifacts.filter(
    (artifact) => artifact.type === "EvidenceVerificationReport",
  );
  const sourceMaterials = result.project.sourceMaterials ?? [];
  const accessSource = currentEvidence.length > 0
    ? currentEvidence.map((artifact) => artifact.content)
    : sourceMaterials;
  const accessCounts = accessSource.reduce((counts, item) => {
    const accessLevel = item?.accessLevel ?? "unknown";
    counts[accessLevel] = (counts[accessLevel] ?? 0) + 1;
    return counts;
  }, {});
  const accessParts = Object.entries(accessCounts).map(
    ([accessLevel, count]) => `${count} 条${BRIEF_ACCESS_LABELS[accessLevel] ?? accessLevel}`,
  );
  const preview = previewSelection(result.project);
  const reviewLandscape = preview?.reviewLandscape;
  const reviewSynthesis = reviewLandscape?.synthesis;
  const accessSummary = currentEvidence.length > 0
    ? `已形成 ${currentEvidence.length} 条可追溯证据提取记录：${accessParts.join("、")}。`
    : sourceMaterials.length > 0
      ? `已保存 ${sourceMaterials.length} 条来源（${accessParts.join("、")}），尚未把来源自动等同于经过核查的证据。`
      : reviewLandscape?.status === "ready"
        ? `建项前已完成近 ${reviewLandscape.reviewWindow?.years ?? 5} 年综述扫描与摘要分析：PubMed 命中 ${reviewLandscape.total ?? "未知"} 篇，本轮分析 ${reviewLandscape.sampledCount ?? 0} 篇。${reviewSynthesis?.summaries?.coverage ?? ""}${reviewSynthesis?.summaries?.gaps ?? ""}这些材料仍是选题调查样本，不属于正式文献库。`
      : preview
        ? `建项前 PubMed 试检命中 ${preview.total ?? "未知"} 条；当前样本只用于校准检索，不属于正式文献库。`
        : "尚未建立可用于研究判断的来源或证据记录。";

  const conclusionBoundaries = acceptedConclusions.flatMap((artifact) => [
    artifact.content?.accessBoundary,
    ...(artifact.content?.uncertainties ?? []),
  ]);
  const verificationBoundaries = verificationReports.flatMap(
    (artifact) => artifact.content?.limitations ?? [],
  );
  const sourceBoundaries = sourceMaterials.flatMap((material) => material.limitations ?? []);
  const boundaries = uniqueBriefText([
    ...conclusionBoundaries,
    ...verificationBoundaries,
    maturity.boundary,
    ...sourceBoundaries,
    reviewSynthesis?.boundary,
    acceptedConclusions.length === 0
      ? "尚未形成通过当前准入条件的研究结论；摘要未报告和未执行的步骤保持未知。"
      : null,
  ]);

  const nextStepOrUserDecision = pendingGate
    ? `需要你确认「${pendingGate.userLabel}」；决定写入后，Agent 才会进入下一步。`
    : pendingReview
      ? `需要你复核「${pendingReview.userLabel}」的当前材料版本，并选择接受或要求修订。`
      : status === "completed"
        ? "本轮约定的交付目标已经完成。请查看完整科研成果，并按这里记录的证据边界使用。"
        : status === "cancelled"
          ? "本轮已经停止且不会原地恢复。需要继续时，请基于原研究问题建立一个新项目。"
          : status === "paused"
            ? "项目停在安全保存点。确认当前输入和失败原因后，可以恢复执行。"
            : status === "blocked"
              ? currentBlocker?.reason ?? "当前步骤需要研究者检查失败原因并选择恢复方式。"
              : status === "running"
                ? `Agent 正在执行「${node.userLabel}」；到达新的人工边界后，这里会自动更新。`
                : `可以继续执行「${node.userLabel}」；下一次人工边界出现前不会替你做研究决定。`;

  return {
    schemaVersion: "research-user-brief/v1",
    status,
    revision: result.state.revision,
    updateMarker: `${result.state.revision}:${result.projection.boundary.type}:${node.id}`,
    currentResearchPeriod: `${phase?.userLabel ?? "当前研究阶段"} · ${node.userLabel}`,
    newConclusions: acceptedConclusions.slice(-3).map((artifact) => ({
      id: artifact.id,
      claim: artifact.content.claim,
      scope: artifact.content.scope ?? "适用范围尚未单独报告。",
      confidence: BRIEF_CONFIDENCE_LABELS[artifact.content.confidence] ?? artifact.content.confidence ?? "强度未报告",
      nextQuestion: artifact.content.nextQuestion ?? null,
    })),
    mainEvidenceAndBoundaries: {
      evidenceRecordCount: currentEvidence.length,
      sourceCount: sourceMaterials.length,
      accessCounts,
      accessSummary,
      boundaries,
    },
    nextStepOrUserDecision,
  };
}

function flattenAgentRecords(agentRunStatus, state) {
  const records = [];
  for (const order of Object.values(agentRunStatus.workOrders ?? {})) {
    records.push({
      id: `record:work-order:${order.id}:${order.lastSequence}`,
      type: `work_order_${order.status}`,
      at: order.updatedAt,
      message: order.payload?.objective ?? order.id,
    });
  }
  for (const run of Object.values(agentRunStatus.runs ?? {})) {
    records.push({
      id: `record:run:${run.id}:${run.lastSequence}`,
      type: `run_${run.status}`,
      at: run.updatedAt,
      message: run.terminalPayload?.errorMessage ?? run.payload?.runtime?.modelId ?? run.id,
    });
  }
  for (const tool of Object.values(agentRunStatus.toolCalls ?? {})) {
    records.push({
      id: `record:tool:${tool.id}:${tool.lastSequence}`,
      type: `tool_${tool.status}`,
      at: tool.updatedAt,
      toolName: tool.toolId,
      message: tool.resultPayload?.errorMessage ?? null,
    });
  }
  for (const gate of Object.values(state.gates ?? {})) {
    records.push({
      id: `record:gate:${gate.id}`,
      type:
        gate.status === "approved"
          ? "gate_approved"
          : gate.status === "amendment_requested"
            ? "gate_amendment_requested"
            : "gate_opened",
      at: gate.decidedAt ?? gate.requestedAt,
      message: nodeById(gate.nodeId)?.userLabel ?? gate.nodeId,
    });
  }
  return records
    .filter((record) => record.at)
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}

function decisionTimeline(result) {
  const decisions = [];
  for (const gate of Object.values(result.state.gates ?? {})) {
    if (!gate.decidedAt) continue;
    decisions.push({
      id: `decision:${gate.id}`,
      kind: "human_gate",
      title: nodeById(gate.nodeId)?.userLabel ?? "人工研究决定",
      decision: gate.status,
      reason: gate.reason ?? null,
      at: gate.decidedAt,
      gateId: gate.id,
      nodeId: gate.nodeId,
      fingerprint: gate.fingerprint ?? null,
      artifactRefs: gate.artifactRefs ?? [],
    });
  }
  for (const [nodeId, runtimeNode] of Object.entries(
    result.state.nodeExecutions ?? {},
  )) {
    for (const blocker of Object.values(runtimeNode.blockers ?? {})) {
      decisions.push({
        id: `blocker:${nodeId}:${blocker.id}`,
        kind: blocker.status === "resolved" ? "resolved_blocker" : "open_blocker",
        title:
          blocker.status === "resolved"
            ? "一个研究阻塞已经解决"
            : "研究在安全位置停下",
        decision: blocker.status,
        reason: blocker.reason,
        resolution: blocker.resolution ?? null,
        at: blocker.resolvedAt ?? blocker.createdAt ?? blocker.addedAt ?? null,
        nodeId,
      });
    }
  }
  return decisions
    .filter((item) => item.at)
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
}

function artifactView(artifact) {
  const rawContent = artifact.content ?? {};
  let content = rawContent;
  let presentationWarning = null;
  if (artifact.type === "ExportManifest") {
    try {
      content = publicExportManifest(rawContent);
    } catch {
      content = {
        schemaVersion: "legacy-export-manifest/presentation-v1",
        status: "legacy_invalid",
        summary: "这是旧版本留下的导出清单，当前契约无法验证；仅保留历史记录，不开放下载，也不视为正式交付授权。",
        fileCount: Array.isArray(rawContent?.files) ? rawContent.files.length : 0,
      };
      presentationWarning = "旧版导出清单未通过当前契约，只能用于历史追溯。";
    }
  }
  const producerNode = nodeById(artifact.producedByNodeId);
  const artifactLabel = ARTIFACT_LABELS[artifact.type] ?? producerNode?.userLabel ?? "研究产物";
  const rawSummary = content.summary ?? content.claim ?? content.conclusion ?? null;
  const summary =
    typeof rawSummary === "string"
      ? rawSummary.replaceAll(artifact.type, artifactLabel)
      : rawSummary;
  return {
    id: artifact.id,
    artifactId: artifact.id,
    type: artifact.type,
    version: artifact.version,
    status: artifact.status,
    freshness: artifact.freshness,
    contentHash: artifact.contentHash,
    title: artifactLabel,
    summary,
    content,
    presentationWarning,
  };
}

function evidenceView(result) {
  const sourcePresentation = retrievalSourcePresentation(result.project);
  const materialById = new Map(
    (result.project.sourceMaterials ?? []).map((material) => [material.id, material]),
  );
  const evidence = result.artifacts.filter((artifact) => artifact.type === "EvidenceRecord");
  if (evidence.length > 0) {
    return evidence.map((artifact) => {
      const content = artifact.content;
      const material = materialById.get(content.sourceId);
      return {
        id: artifact.id,
        title: material?.title ?? content.sourceId,
        accessLevel: content.accessLevel,
        extractedFacts: content.extractedFacts,
        limitations: content.limitations,
        unknowns: content.unknowns,
        relation: content.relation,
        retrievalPurpose: sourcePresentation.purpose,
        retrievalStage: sourcePresentation.stage,
        libraryEligibility: sourcePresentation.eligibility,
        ...content.locator,
        repositoryId: content.locator?.repositoryId,
        url: content.locator?.url,
      };
    });
  }
  return (result.project.sourceMaterials ?? []).map((material) => ({
    ...material,
    summary: material.text,
    url: material.locator?.url,
    pmid: material.locator?.pmid,
    doi: material.locator?.doi,
    retrievalPurpose: sourcePresentation.purpose,
    retrievalStage: sourcePresentation.stage,
    libraryEligibility: sourcePresentation.eligibility,
    limitations: material.limitations?.length
      ? material.limitations
      : [sourcePresentation.limitation],
  }));
}

function writingView(result) {
  const drafts = result.artifacts.filter((artifact) => artifact.type === "ClaimUnitDraft");
  const verificationByDraft = new Map(
    result.artifacts
      .filter((artifact) => artifact.type === "ClaimVerificationResult")
      .map((artifact) => [artifact.content.claimUnitDraftId, artifact]),
  );
  const claims = [];
  const issues = [];
  for (const draft of drafts) {
    const verification = verificationByDraft.get(draft.id);
    const resultsBySentence = new Map(
      (verification?.content?.sentenceResults ?? []).map((item) => [item.sentenceId, item]),
    );
    for (const sentence of draft.content.sentences ?? []) {
      const sentenceResult = resultsBySentence.get(sentence.id);
      const status = sentenceResult?.verdict === "direct_support"
        ? "verified"
        : sentenceResult?.verdict ?? "pending";
      claims.push({
        id: sentence.id,
        claimId: draft.content.claimId,
        text: sentence.text,
        kind: sentence.kind,
        status,
        verification: sentenceResult?.rationale ?? "这句话尚未取得逐句来源核查回执。",
        boundary: draft.content.boundaries?.join("；") ?? null,
        verifiedEvidenceIds: sentenceResult?.verifiedEvidenceIds ?? [],
      });
      if (sentenceResult && sentenceResult.verdict !== "direct_support") {
        issues.push({
          id: `${verification.id}:${sentence.id}`,
          message: sentenceResult.requiredRevision ?? sentenceResult.rationale,
        });
      }
    }
  }
  return { claims, issues };
}

function researchQualityMetrics(result, landscape, decisions) {
  const sources = result.project.sourceMaterials ?? [];
  const retrieval = latestRetrievalReceipt(result.project);
  const preview = previewSelection(result.project);
  const checkableSentences = result.artifacts
    .filter((artifact) => artifact.type === "ClaimUnitDraft")
    .flatMap((artifact) => artifact.content?.sentences ?? [])
    .filter((sentence) => ["factual", "interpretation", "transition"].includes(sentence.kind));
  const sentenceResults = result.artifacts
    .filter((artifact) => artifact.type === "ClaimVerificationResult")
    .flatMap((artifact) => artifact.content?.sentenceResults ?? []);
  const directlySupported = sentenceResults.filter(
    (item) => item.verdict === "direct_support",
  ).length;
  const unresolvedSentenceCount = sentenceResults.filter(
    (item) => item.verdict !== "direct_support",
  ).length;
  const humanDecisions = decisions.filter((item) => item.kind === "human_gate");
  return {
    retrieval: {
      stage: result.project?.retrievalRuns?.finalLibrary
        ? "final_library"
        : formalRetrievalRuns(result.project).length > 0
          ? "formal_retrieval_in_progress"
          : preview
            ? "preview_only"
            : "not_started",
      totalHits: retrieval?.total ?? preview?.total ?? null,
      formalRunCount: formalRetrievalRuns(result.project).length,
      previewSampleCount: preview?.samples?.length ?? 0,
      savedSources: sources.length,
      abstractAvailable: sources.filter((source) => source.accessLevel === "abstract_only").length,
      titleOnly: sources.filter((source) => source.accessLevel === "title_only").length,
      fullTextAvailable: sources.filter((source) =>
        ["full_text", "full_text_and_supplement"].includes(source.accessLevel),
      ).length,
    },
    literatureMap: {
      sourceCount: landscape.literatureLandscape.sourceCount,
      taggedSourceCount: landscape.literatureLandscape.taggedSourceCount,
      unclassifiedSourceCount: landscape.literatureLandscape.unclassifiedSourceCount,
      unclassifiedRate: landscape.literatureLandscape.unclassifiedRate,
      registeredControversies: landscape.literatureLandscape.controversies.length,
      unvalidatedIdeaCandidates: landscape.ideaCandidates.filter(
        (candidate) => candidate.status !== "rejected",
      ).length,
    },
    verification: {
      checkableSentenceCount: checkableSentences.length,
      // Deprecated alias retained for older clients. Every sentence kind now
      // requires a verification receipt before it can enter accepted writing.
      factualSentenceCount: checkableSentences.length,
      checkedSentenceCount: sentenceResults.length,
      directlySupportedSentenceCount: directlySupported,
      unresolvedSentenceCount,
      directSupportRate:
        sentenceResults.length === 0 ? null : directlySupported / sentenceResults.length,
    },
    responsibility: {
      humanDecisionCount: humanDecisions.length,
      recordedStopOrRecoveryCount: decisions.length - humanDecisions.length,
    },
    interpretationBoundary:
      "这些指标用于观察检索覆盖、分类负担、核查完成度和人工责任，不是论文质量分、研究新颖性分或科研成功率。",
  };
}

function serializeProject(result) {
  const boundary = result.projection.boundary;
  const node = nodeById(boundary.nodeId) ??
    machine.nodes.find((candidate) => candidate.userLabel === result.projection.activity) ??
    machine.nodes.at(-1);
  const phase = phaseByNodeId(node.id);
  const blockers = openBlockers(result.state);
  const status = statusForResult(result);
  const maturity = contentMaturityFor(result, status);
  const artifactViews = result.artifacts.map(artifactView);
  const researchOutputProjection = buildResearchOutputProjection({
    project: result.project,
    artifacts: result.artifacts,
    contentMaturity: maturity,
    runtimeProvenance: result.runtimeProvenance,
  });
  const literatureLandscape = literatureLandscapeFor(result);
  const sourcePresentation = retrievalSourcePresentation(result.project);
  const decisions = decisionTimeline(result);
  const landscapeOutputs = landscapeResearchOutputs(literatureLandscape);
  const researchOutputs = researchOutputProjection.groups.map((group) =>
    ["evidence", "sources"].includes(group.id)
      ? { ...group, items: [...landscapeOutputs, ...group.items] }
      : group,
  );
  if (!researchOutputs.some((group) => ["evidence", "sources"].includes(group.id))) {
    researchOutputs.splice(1, 0, {
      id: "evidence",
      label: "来源与证据",
      description: "真实来源、可追溯文献地形、未分类材料和尚未验证的候选方向。",
      items: landscapeOutputs,
    });
  }
  const sourceMaterialItems = result.project.sourceMaterials.map((material) => ({
    id: `research-source:${material.id}`,
    type: "ResearchSource",
    title: material.title ?? "未命名来源",
    purpose: sourcePresentation.purposeText,
    status: sourcePresentation.status,
    summary:
      material.abstract ?? material.text ?? "当前只有题名或题录；摘要未报告的信息保持未知。",
    readableBody:
      material.abstract ?? material.text ?? "当前只有题名或题录；摘要未报告的信息保持未知。",
    details: {
      provider: material.provider,
      journal: material.journal ?? null,
      year: material.year ?? null,
      accessLevel: material.accessLevel,
      locator: material.locator,
      retrievalPurpose: sourcePresentation.purpose,
      retrievalStage: sourcePresentation.stage,
      libraryEligibility: sourcePresentation.eligibility,
      retrievalReceiptHash: sourcePresentation.receiptHash,
    },
    sourceIds: [material.id],
    sourceRefs: [{
      sourceId: material.id,
      title: material.title,
      accessLevel: material.accessLevel,
      locator: material.locator,
      sourceSnapshotHash: material.sourceSnapshotHash,
    }],
    accessLevels: [material.accessLevel],
    limitations: [
      sourcePresentation.limitation,
      ...(material.limitations ?? []),
      "按当前实际访问层级保存；尚未访问的全文信息不能补写。",
    ].filter((item, index, values) => item && values.indexOf(item) === index),
  }));
  const evidenceOutputGroup = researchOutputs.find((group) =>
    ["evidence", "sources"].includes(group.id),
  );
  if (evidenceOutputGroup) {
    evidenceOutputGroup.items = [...evidenceOutputGroup.items, ...sourceMaterialItems];
  }
  const currentTask = {
    nodeId: node.id,
    phaseId: node.phaseId,
    userLabel: node.userLabel,
    objective: node.purpose,
    acceptanceCriteria: node.acceptanceCriteria,
    requiredOutputs: node.outputs.map((contract) => ({
      type: contract.split("@")[0].replace("[]", ""),
      label:
        ARTIFACT_LABELS[contract.split("@")[0].replace("[]", "")] ??
        "本步研究产物",
      contract,
    })),
    blocker: blockers.find((item) => item.nodeId === node.id)?.reason ?? null,
  };
  const currentBlocker = blockers.find((item) => item.nodeId === node.id) ?? blockers[0] ?? null;
  const pendingGate = boundary.type === "human_gate"
    ? {
        id: boundary.gateId,
        gateId: boundary.gateId,
        nodeId: node.id,
        status: "pending",
        fingerprint: boundary.fingerprint,
        gateFingerprint: boundary.fingerprint,
        userLabel: node.userLabel,
        purpose: node.purpose,
        acceptanceCriteria: node.acceptanceCriteria,
        artifacts: (boundary.inputs ?? []).map(artifactView),
      }
    : null;
  const pendingReviewArtifacts = boundary.type === "human_review"
    ? (boundary.artifacts ?? []).map(artifactView)
    : [];
  const pendingReview = boundary.type === "human_review"
    ? {
        id: node.id,
        nodeId: node.id,
        status: "pending",
        reviewerRole: boundary.reviewerRole,
        userLabel: node.userLabel,
        description: node.purpose,
        materialFingerprint: sha256(pendingReviewArtifacts.map((artifact) => ({
          artifactId: artifact.artifactId,
          version: artifact.version,
          contentHash: artifact.contentHash,
        }))),
        artifacts: pendingReviewArtifacts,
      }
    : null;
  const userBrief = userBriefFor({
    result,
    artifactViews,
    status,
    maturity,
    phase,
    node,
    pendingGate,
    pendingReview,
    currentBlocker,
  });
  return {
    id: result.project.id,
    title: result.project.title,
    question: result.project.question,
    constraints: result.project.constraints,
    sourceMaterials: result.project.sourceMaterials.map((material) => ({
      id: material.id,
      provider: material.provider,
      pmid: material.pmid,
      doi: material.doi,
      title: material.title,
      abstract: material.abstract ?? material.text,
      journal: material.journal,
      year: material.year,
      accessLevel: material.accessLevel,
      locator: material.locator,
      limitations: material.limitations,
      sourceSnapshotHash: material.sourceSnapshotHash,
    })),
    completionProfileId: result.project.completionProfileId,
    version: result.state.revision,
    reportRevision: Number.isInteger(result.project.reportRevision)
      ? result.project.reportRevision
      : 0,
    sourceSetHash: typeof result.project.sourceSetHash === "string"
      ? result.project.sourceSetHash
      : null,
    researchReport: result.project.researchReport
      ? structuredClone(result.project.researchReport)
      : null,
    finalLibraryScreening: result.project.finalLibraryScreening
      ? structuredClone(result.project.finalLibraryScreening)
      : null,
    status,
    currentPhaseId: phase?.id ?? node.phaseId,
    currentNode: { id: node.id, phaseId: node.phaseId, userLabel: node.userLabel },
    currentTask,
    progress: (phase?.order ?? 1) / machine.phases.length,
    completedPhaseIds: machine.phases
      .filter((candidate) => candidate.order < (phase?.order ?? 1))
      .map((candidate) => candidate.id),
    currentResearchPeriod: userBrief.currentResearchPeriod,
    contentMaturity: maturity,
    researchMode: result.project.researchMode ?? "guided_materials",
    searchQuery: result.project.searchQuery ?? null,
    queryPreviewSelection: previewSelection(result.project)
      ? {
          candidateId: previewSelection(result.project).candidateId,
          candidateStatus: previewSelection(result.project).candidateStatus,
          query: previewSelection(result.project).query,
          total: previewSelection(result.project).total,
          executedAt: previewSelection(result.project).executedAt,
          planHash: previewSelection(result.project).planHash,
          selectionHash: previewSelection(result.project).selectionHash,
          subjectConcepts: previewSelection(result.project).subjectConcepts ?? [],
          samples: previewSelection(result.project).samples,
          reviewLandscape: previewSelection(result.project).reviewLandscape ?? null,
        }
      : null,
    scopingDecision: result.project.scopingDecision
      ? structuredClone(result.project.scopingDecision)
      : null,
    scopingVerification: result.project.scopingVerification
      ? structuredClone(result.project.scopingVerification)
      : null,
    scopingRounds: Array.isArray(result.project.scopingRounds)
      ? result.project.scopingRounds.map((round) => ({
          round: round.round,
          role: round.role,
          question: round.question,
          query: round.query,
          previewSelectionHash: round.previewSelection?.selectionHash ?? null,
          total: round.previewSelection?.total ?? null,
          sampledCount: round.previewSelection?.samples?.length ?? 0,
          calibration: round.previewSelection?.strategyCalibration
            ? {
                requestedSampleLimit:
                  round.previewSelection.strategyCalibration.requestedSampleLimit ?? 100,
                sampledCount:
                  round.previewSelection.strategyCalibration.feedback?.sampledCount ?? 0,
                abstractAvailableCount:
                  round.previewSelection.strategyCalibration.feedback?.abstractAvailableCount ?? 0,
                potentialNoiseCount:
                  round.previewSelection.strategyCalibration.feedback?.potentialNoiseCount ?? 0,
              }
            : null,
          reviewLandscape: round.previewSelection?.reviewLandscape ?? null,
        }))
      : [],
    retrievalRuns: formalRetrievalRuns(result.project).map((run) => ({
      purpose: run.purpose,
      nodeId: run.nodeId,
      protocolArtifactId: run.protocolArtifactId,
      protocolContentHash: run.protocolContentHash,
      queryId: run.queryId,
      query: run.query,
      queryHash: run.queryHash,
      executedAt: run.receipt?.executedAt,
      fetchedAt: run.receipt?.fetchedAt,
      total: run.receipt?.total,
      recordCount: run.receipt?.records?.length ?? 0,
      receiptHash: run.receipt?.receiptHash,
      accessBoundary: run.receipt?.accessBoundary,
    })),
    liveRetrieval: latestRetrievalReceipt(result.project)
      ? {
          provider: latestRetrievalReceipt(result.project).provider,
          query: latestRetrievalReceipt(result.project).query,
          executedAt: latestRetrievalReceipt(result.project).executedAt,
          fetchedAt: latestRetrievalReceipt(result.project).fetchedAt,
          total: latestRetrievalReceipt(result.project).total,
          recordCount: latestRetrievalReceipt(result.project).records?.length ?? 0,
          receiptHash: latestRetrievalReceipt(result.project).receiptHash,
          accessBoundary: latestRetrievalReceipt(result.project).accessBoundary,
        }
      : null,
    legacyRetrieval: result.project?.retrievalRuns?.legacyBootstrap?.receipt
      ? {
          provider: result.project.retrievalRuns.legacyBootstrap.receipt.provider,
          query: result.project.retrievalRuns.legacyBootstrap.receipt.query,
          executedAt: result.project.retrievalRuns.legacyBootstrap.receipt.executedAt,
          total: result.project.retrievalRuns.legacyBootstrap.receipt.total,
          recordCount:
            result.project.retrievalRuns.legacyBootstrap.receipt.records?.length ?? 0,
          receiptHash:
            result.project.retrievalRuns.legacyBootstrap.receipt.receiptHash,
          authority: "legacy_single_receipt",
          reusableForFormalNodes: [],
        }
      : null,
    literatureLandscape,
    researchQualityMetrics: researchQualityMetrics(result, literatureLandscape, decisions),
    userBrief,
    summary: {
      newConclusion: userBrief.newConclusions[0]?.claim ?? null,
      boundary: userBrief.mainEvidenceAndBoundaries.boundaries[0] ?? null,
      nextDecision: userBrief.nextStepOrUserDecision,
    },
    pendingGate,
    pendingReview,
    blocker: currentBlocker,
    recovery: currentBlocker
      ? {
          safeCheckpoint: {
            nodeId: currentBlocker.nodeId,
            label: nodeById(currentBlocker.nodeId)?.userLabel ?? "当前研究步骤",
            message: "项目、既有产物和成功检索回执均已保存；恢复操作只会从这个步骤继续。",
          },
          action:
            currentBlocker.retryClass === "protocol_revision_required"
              ? "revise_protocol"
              : currentBlocker.retryClass === "same_protocol_retry"
                ? "retry_same_protocol"
                : "human_review",
          message:
            currentBlocker.retryClass === "protocol_revision_required"
              ? "原检索式已确认零结果，必须由研究者说明理由并提交新版正式检索协议。"
              : currentBlocker.retryClass === "same_protocol_retry"
                ? "当前协议未被否定；检查网络或数据库状态后可按原检索式重试。"
                : "请先检查失败原因，再由研究者决定是否重试或显式修订协议。",
        }
      : null,
    researchOutputs,
    usableArtifacts: researchOutputProjection.usableArtifacts,
    internalWorkflowArtifacts: researchOutputProjection.internalWorkflow,
    artifactCount: result.artifacts.length,
    researchOutputCount:
      researchOutputProjection.items.length + landscapeOutputs.length + sourceMaterialItems.length,
    // Backward-compatible raw objects for existing clients. New UI should use
    // researchOutputs and keep this collection behind an expert/debug view.
    artifacts: artifactViews,
    evidence: evidenceView(result),
    writingReview: writingView(result),
    events: flattenAgentRecords(result.agentRunStatus, result.state),
    decisionTimeline: decisions,
    runtimeStatus: result.agentRunStatus.status,
  };
}

async function currentProject(projectId) {
  return serializeProject(await service.getProject(projectId));
}

function launchRun(projectId) {
  const existing = activeRuns.get(projectId);
  if (existing) return existing;
  const controller = new AbortController();
  const record = {
    controller,
    startedAt: new Date().toISOString(),
    promise: null,
  };
  record.promise = Promise.resolve()
    .then(() => service.runUntilBoundary(projectId, { signal: controller.signal }))
    .catch((error) => {
      record.error = error;
      return null;
    })
    .finally(() => {
      if (activeRuns.get(projectId) === record) activeRuns.delete(projectId);
    });
  activeRuns.set(projectId, record);
  return record;
}

function errorStatus(error) {
  if (error?.code === "PROJECT_NOT_FOUND") return 404;
  if (error?.code === "PROJECT_RUN_ACTIVE") return 409;
  if (error?.code === "EXPORT_NOT_READY") return 409;
  if (error?.code === "STALE_REVIEW_MATERIAL") return 409;
  if (error?.code === "STALE_RESEARCH_REPORT_BINDING") return 409;
  if (String(error?.code ?? "").startsWith("QUERY_PREVIEW_")) return 409;
  if (error?.code === "QUERY_CANDIDATE_NOT_READY") return 409;
  if (error?.code === "PUBMED_NO_RESULTS") return 422;
  if (error?.code === "RESEARCH_SUBJECT_RELEVANCE_BLOCKED") return 422;
  if (String(error?.code ?? "").startsWith("PUBMED_")) return 502;
  if (
    error instanceof ResearchEngineError ||
    error instanceof ResearchAgentServiceError ||
    String(error?.code ?? "").includes("MISMATCH") ||
    String(error?.code ?? "").startsWith("INVALID_")
  ) {
    return 409;
  }
  if (error?.code === "REQUEST_TOO_LARGE") return 413;
  return 400;
}

function constantTimeTextEqual(left, right) {
  const leftDigest = createHash("sha256").update(String(left)).digest();
  const rightDigest = createHash("sha256").update(String(right)).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function requestHasValidBasicAuth(request) {
  if (!authUsername) return true;
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Basic ")) return false;
  let decoded;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  return (
    constantTimeTextEqual(decoded.slice(0, separator), authUsername) &&
    constantTimeTextEqual(decoded.slice(separator + 1), authPassword)
  );
}

function requestBasicAuth(response) {
  response.writeHead(401, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
    "WWW-Authenticate": 'Basic realm="Research Workbench", charset="UTF-8"',
    "X-Content-Type-Options": "nosniff",
  });
  response.end("Authentication required");
}

async function apiHandler(request, response, pathname) {
  if (request.method !== "GET" && !sameOrigin(request)) {
    sendJson(response, 403, { code: "INVALID_ORIGIN", message: "请求来源无效。" });
    return true;
  }

  if (pathname === "/api/research/runtime" && request.method === "GET") {
    const description = service.describeRuntime();
    sendJson(response, 200, {
      mode: description.agent.mode,
      adapter: description.agent.adapter,
      piVersion: description.agent.piVersion,
      provider: description.agent.provider,
      modelId: description.agent.modelId,
      liveConfigured: description.agent.liveConfigured,
      isRealPi: true,
      connected: true,
      modelExecution:
        description.agent.mode === "live" ? "live_model" : "guided_faux_provider",
      authority: "canonical state machine and event engine",
      persistence: description.persistence,
    });
    return true;
  }

  if (pathname === "/api/research/health" && request.method === "GET") {
    const description = service.describeRuntime();
    sendJson(response, 200, {
      status: shuttingDown ? "shutting_down" : "ok",
      service: description.service,
      startedAt,
      uptimeSeconds: Math.max(0, Math.round(process.uptime())),
      machine: description.machine,
      agent: {
        mode: description.agent.mode,
        adapter: description.agent.adapter,
        piVersion: description.agent.piVersion,
        liveConfigured: description.agent.liveConfigured,
      },
      persistence: description.persistence,
      delivery: production ? "static-dist-research" : "vite-middleware",
      pubmedEndpoint:
        env.NODE_ENV === "test" && testPubMedBaseUrl
          ? "loopback-test-double"
          : "NCBI E-utilities",
    });
    return true;
  }

  if (pathname === "/api/research/projects" && request.method === "GET") {
    const projects = await service.listProjects();
    // The compact project index omits authoritative retrieval, artifact and
    // runtime provenance. Rehydrate each project so the sidebar and detail view
    // apply exactly the same maturity decision.
    const projectResults = await Promise.all(
      projects.map(async (project) => ({
        index: project,
        result: project.loadable === false ? null : await service.getProject(project.id),
      })),
    );
    sendJson(
      response,
      200,
      projectResults.map(({ index, result }) => {
        if (!result) {
          return {
            id: index.id,
            title: index.title,
            question: index.question,
            completionProfileId: index.completionProfileId,
            contentMaturity: { code: "recovery_required", label: "历史记录待恢复" },
            status: "failed",
            currentPhaseId: "question_formation",
            loadable: false,
            loadError: index.loadError,
          };
        }
        const project = result.project;
        const nodeId = result.projection.boundary?.nodeId;
        const status = statusForResult(result);
        const maturity = contentMaturityFor(result, status);
        return {
          id: project.id,
          title: project.title,
          question: project.question,
          completionProfileId: project.completionProfileId,
          contentMaturity: maturity,
          status,
          currentPhaseId: phaseByNodeId(nodeId)?.id ?? "question_formation",
        };
      }),
    );
    return true;
  }

  if (pathname === "/api/research/query-plan" && request.method === "POST") {
    const body = await readJson(request);
    if (typeof body.question !== "string" || Array.from(body.question.trim()).length < 4) {
      throw Object.assign(new Error("研究问题至少需要 4 个字，才能生成专业检索策略。"), {
        code: "INVALID_RESEARCH_QUESTION",
      });
    }
    let directionDecision = null;
    if (typeof body.directionSelectionHash === "string") {
      const context = requireExpiring(directionSelections, body.directionSelectionHash, {
        staleCode: "DIRECTION_SELECTION_STALE",
        staleMessage: "方向选择记录不存在或已过期；请从首轮综述重新确认方向。",
      });
      if (context.decision.narrowedBrief.question.trim().normalize("NFKC") !== body.question.trim().normalize("NFKC")) {
        throw Object.assign(new Error("第二轮问题已经改变；请重新确认方向决定。"), {
          code: "SCOPING_DECISION_MISMATCH",
        });
      }
      directionDecision = context.decision;
    }
    const generatedPlan = await generatePromptDrivenPubMedQueryPlan({
      question: body.question.trim().slice(0, 1200),
      model: queryStrategyModel,
      signal: AbortSignal.timeout(90_000),
    });
    const plan = directionDecision
      ? queryPlanWithDirectionSeed(generatedPlan, directionDecision)
      : generatedPlan;
    rememberExpiring(queryPlans, plan.planHash, plan);
    sendJson(response, 200, plan);
    return true;
  }

  if (pathname === "/api/research/query-calibration" && request.method === "POST") {
    const body = await readJson(request);
    if (typeof body.question !== "string" || Array.from(body.question.trim()).length < 4) {
      throw Object.assign(new Error("研究问题至少需要 4 个字，才能执行前 100 篇反馈校准。"), {
        code: "INVALID_RESEARCH_QUESTION",
      });
    }
    if (typeof body.initialPlanHash !== "string" || !/^[a-f0-9]{64}$/i.test(body.initialPlanHash)) {
      throw Object.assign(new Error("前 100 篇反馈必须绑定当前检索初稿指纹。"), {
        code: "QUERY_PLAN_REQUIRED",
      });
    }
    const plan = requireExpiring(queryPlans, body.initialPlanHash, {
      staleCode: "QUERY_PLAN_STALE",
      staleMessage: "检索初稿不存在或已过期；请重新生成初稿。",
    });
    if (plan.question !== body.question.trim()) {
      throw Object.assign(new Error("研究问题已改变；请重新生成检索初稿。"), {
        code: "QUERY_PLAN_STALE",
      });
    }
    const calibration = await calibratePubMedQueryStrategy({
      gateway: toolGateway,
      question: plan.question,
      plan,
      selectedCandidateId: body.selectedCandidateId,
      editedQuery: typeof body.editedQuery === "string" ? body.editedQuery : null,
      model: queryStrategyModel,
      signal: AbortSignal.timeout(150_000),
    });
    rememberExpiring(queryCalibrations, calibration.calibrationHash, calibration);
    rememberExpiring(queryPlans, calibration.revisedPlan.planHash, calibration.revisedPlan);
    sendJson(response, 200, calibration);
    return true;
  }

  if (pathname === "/api/research/query-preview" && request.method === "POST") {
    const body = await readJson(request);
    if (typeof body.question !== "string" || Array.from(body.question.trim()).length < 4) {
      throw Object.assign(new Error("研究问题至少需要 4 个字，才能生成可比较的检索候选。"), {
        code: "INVALID_RESEARCH_QUESTION",
      });
    }
    let strategyCalibration = null;
    let directionBinding = null;
    let seededPlan = null;
    if (typeof body.calibrationHash === "string") {
      const calibration = requireExpiring(queryCalibrations, body.calibrationHash, {
        staleCode: "QUERY_CALIBRATION_STALE",
        staleMessage: "前 100 篇反馈记录不存在或已过期；请重新校准检索式。",
      });
      if (calibration.question !== body.question.trim()) {
        throw Object.assign(new Error("研究问题已改变；请重新执行前 100 篇反馈。"), {
          code: "QUERY_CALIBRATION_STALE",
        });
      }
      seededPlan = calibration.revisedPlan?.directionSeed
        ? calibration.revisedPlan
        : null;
      if (seededPlan) {
        const seed = seededPlan.directionSeed;
        const context = requireExpiring(directionSelections, seed.decisionHash, {
          staleCode: "DIRECTION_SELECTION_STALE",
          staleMessage: "第二轮方向选择记录不存在或已过期；请从首轮综述重新确认方向。",
        });
        const decision = context.decision;
        const expectedCandidate = seededPlan.candidates?.find(
          (candidate) => candidate.id === body.reviewScanCandidateId,
        ) ?? seededPlan.candidates?.[0];
        const suppliedCandidate = Array.isArray(body.candidateQueries)
          ? body.candidateQueries.find((candidate) => candidate.id === expectedCandidate?.id)
          : null;
        if (
          !expectedCandidate
          || !suppliedCandidate
          || suppliedCandidate.query !== expectedCandidate.query
          || seed.selectedDirectionId !== decision.selectedDirection.id
          || seed.sourcePreviewPlanHash !== decision.sourcePreviewPlanHash
          || seed.decisionHash !== decision.decisionHash
        ) {
          throw Object.assign(
            new Error("第二轮候选检索式或方向绑定已改变；请重新执行方向收窄与校准。"),
            { code: "SECOND_ROUND_DIRECTION_BINDING_MISMATCH" },
          );
        }
        directionBinding = {
          schemaVersion: "research-second-round-direction-binding/v1",
          decisionHash: decision.decisionHash,
          selectedDirectionId: decision.selectedDirection.id,
          themeId: decision.selectedDirection.themeId ?? null,
          sourcePreviewPlanHash: decision.sourcePreviewPlanHash,
          reportHash: decision.reportBinding?.reportHash ?? null,
          focusMappingHash: sha256(decision.narrowedBrief?.focusMapping ?? null),
          focusedQueryHash: sha256(expectedCandidate.query),
        };
      }
      strategyCalibration = {
        schemaVersion: calibration.schemaVersion,
        calibrationHash: calibration.calibrationHash,
        initialPlanHash: calibration.initialPlanHash,
        executedAt: calibration.executedAt,
        total: calibration.total,
        requestedSampleLimit: calibration.requestedSampleLimit,
        feedback: calibration.feedback,
        revision: calibration.revision,
        accessBoundary: calibration.accessBoundary,
        stageBrief: calibration.stageBrief,
        ...(seededPlan ? { directionSeed: structuredClone(seededPlan.directionSeed) } : {}),
        ...(directionBinding ? { directionBinding: structuredClone(directionBinding) } : {}),
      };
    }
    const generatedPreview = await previewPubMedQueryPlan({
      gateway: toolGateway,
      question: body.question.trim().slice(0, 1200),
      candidateQueries: Array.isArray(body.candidateQueries) ? body.candidateQueries : null,
      sampleLimit: body.sampleLimit,
      reviewScanCandidateId: body.reviewScanCandidateId,
      reviewWindowYears: body.reviewWindowYears,
      reviewSampleLimit: body.reviewSampleLimit,
      signal: AbortSignal.timeout(75_000),
    });
    const preview = rememberQueryPreview({
      ...generatedPreview,
      ...(seededPlan ? {
        mappings: structuredClone(seededPlan.mappings ?? []),
        conceptGroups: structuredClone(seededPlan.conceptGroups ?? []),
        directionSeed: structuredClone(seededPlan.directionSeed),
      } : {}),
      ...(directionBinding ? { directionBinding } : {}),
      ...(strategyCalibration ? { strategyCalibration } : {}),
    });
    sendJson(response, 200, preview);
    return true;
  }

  if (pathname === "/api/research/direction-selection" && request.method === "POST") {
    const body = await readJson(request);
    if (typeof body.queryPlanHash !== "string" || !/^[a-f0-9]{64}$/i.test(body.queryPlanHash)) {
      throw Object.assign(new Error("方向选择必须绑定当前首轮综述指纹。"), {
        code: "DIRECTION_PREVIEW_REQUIRED",
      });
    }
    const entry = queryPreviews.get(body.queryPlanHash);
    if (!entry || entry.expiresAt <= Date.now()) {
      queryPreviews.delete(body.queryPlanHash);
      throw Object.assign(new Error("首轮综述记录不存在或已过期；请重新扫描后选择方向。"), {
        code: "DIRECTION_PREVIEW_STALE",
      });
    }
    const preview = structuredClone(entry.preview);
    const researchReport = preview.reviewLandscape?.researchReport ?? null;
    if (researchReport) {
      try {
        assertResearchReportSelectionBinding({ reportBinding: body.reportBinding }, researchReport);
      } catch (error) {
        throw Object.assign(
          new Error(`方向选择绑定的科研简报已变化：${error.message}`),
          { code: "STALE_RESEARCH_REPORT_BINDING" },
        );
      }
    }
    const selectedCandidateId = preview.reviewLandscape?.selectedCandidateId
      ?? preview.candidates?.find((candidate) => candidate.status === "ready")?.id;
    const roundOnePreviewSelection = queryPreviewSelectionForBody({
      queryPlanHash: preview.planHash,
      selectedCandidateId,
    });
    if (!roundOnePreviewSelection) {
      throw Object.assign(new Error("首轮综述没有可冻结的检索回执。"), {
        code: "DIRECTION_PREVIEW_STALE",
      });
    }
    const decision = buildResearchDirectionSelection({
      preview,
      selectedDirectionId: body.selectedDirectionId,
      selectionReason: body.selectionReason,
      deferredReason: body.deferredReason,
      actor: humanActor(),
    });
    rememberExpiring(directionSelections, decision.decisionHash, {
      decision,
      roundOnePreviewSelection,
    });
    sendJson(response, 200, decision);
    return true;
  }

  if (pathname === "/api/research/projects" && request.method === "POST") {
    const body = await readJson(request);
    if (typeof body.title !== "string" || body.title.trim().length < 2) {
      throw Object.assign(new Error("项目名称至少需要 2 个字。"), { code: "INVALID_PROJECT_TITLE" });
    }
    if (typeof body.question !== "string" || Array.from(body.question.trim()).length < 4) {
      throw Object.assign(new Error("研究问题至少需要 4 个字。"), { code: "INVALID_RESEARCH_QUESTION" });
    }
    if (body.researchMode === "live_pubmed" && (typeof body.searchQuery !== "string" || body.searchQuery.trim().length < 3)) {
      throw Object.assign(
        new Error("真实研究需要填写至少 3 个字符的 PubMed 英文检索式。"),
        { code: "INVALID_SEARCH_QUERY" },
      );
    }
    const completionProfileId = body.completionProfileId ?? "audited_review";
    if (!machine.completionProfiles.some((profile) => profile.id === completionProfileId)) {
      throw Object.assign(new Error("请选择受支持的研究交付目标。"), {
        code: "UNKNOWN_COMPLETION_PROFILE",
      });
    }
    const id = projectIdFromIdempotencyKey(request);
    let pending = activeCreates.get(id);
    if (!pending) {
      pending = (async () => {
        const previewFailure =
          body.researchMode === "live_pubmed"
            ? queryPreviewFailureForSelection(body)
            : null;
        if (body.researchMode === "live_pubmed") {
          if (!previewFailure) requireQueryPreviewSelection(body);
        }
        const queryPreviewSelection = body.researchMode === "live_pubmed"
          ? queryPreviewSelectionForBody(body)
          : null;
        const scopingContext = body.researchMode === "live_pubmed"
          ? scopingContextForCreate(body, queryPreviewSelection)
          : null;
        const sources = normalizeSourceMaterials(body.sourceMaterials, id);
        let result = await service.createProject({
          id,
          title: body.title.trim().slice(0, 120),
          question: body.question.trim().slice(0, 1200),
          completionProfileId,
          owner: humanActor(),
          constraints: splitLines(body.constraints),
          researchMode: body.researchMode === "live_pubmed" ? "live_pubmed" : "guided_materials",
          searchQuery: typeof body.searchQuery === "string" ? body.searchQuery.trim().slice(0, 5000) : null,
          searchLimit: 8,
          queryPreviewSelection,
          ...(scopingContext ?? {}),
          sourceMaterials: sources,
        });
        if (body.researchMode === "live_pubmed") {
          if (previewFailure) {
            const paused = await service.pauseProject({
              projectId: id,
              nodeId: "clarify_question",
              actor: humanActor(),
              reason: `PubMed 真实检索未完成：${previewFailure.message}`,
            });
            throw Object.assign(new Error(previewFailure.message), {
              code: previewFailure.code,
              projectId: id,
              project: serializeProject(paused),
              recoverable: true,
            });
          }
        }
        result = await service.runUntilBoundary(id);
        return serializeProject(result);
      })();
      activeCreates.set(id, pending);
      pending.finally(() => {
        if (activeCreates.get(id) === pending) activeCreates.delete(id);
      }).catch(() => {});
    }
    sendJson(response, 201, await pending);
    return true;
  }

  const retrySearchMatch = pathname.match(
    /^\/api\/research\/projects\/([^/]+)\/retry-search$/,
  );
  if (retrySearchMatch && request.method === "POST") {
    const projectId = decodeURIComponent(retrySearchMatch[1]);
    const body = await readJson(request);
    if (typeof body.searchQuery !== "string" || body.searchQuery.trim().length < 3) {
      throw Object.assign(
        new Error("请填写至少 3 个字符的 PubMed 英文检索式。"),
        { code: "INVALID_SEARCH_QUERY", projectId },
      );
    }
    const before = await service.getProject(projectId);
    if (before.project.researchMode !== "live_pubmed") {
      throw Object.assign(new Error("这个项目没有启用 PubMed 真实检索。"), {
        code: "LIVE_RETRIEVAL_NOT_ENABLED",
        projectId,
      });
    }
    const retrievalBlockers = openBlockers(before.state).filter(
      (blocker) =>
        blocker.nodeId === "clarify_question" &&
        String(blocker.id ?? "").startsWith("pause:clarify_question") &&
        String(blocker.reason ?? "").startsWith("PubMed 真实检索未完成："),
    );
    if (retrievalBlockers.length === 0) {
      throw Object.assign(new Error("当前项目没有可修订的建项前 PubMed 预检失败。"), {
        code: "QUERY_PREVIEW_UPDATE_NOT_ALLOWED",
        projectId,
      });
    }
    let preview;
    try {
      preview = rememberQueryPreview(await previewPubMedQueryPlan({
        gateway: toolGateway,
        question: before.project.question,
        candidateQueries: [
          {
            id: "researcher_retry",
            label: "研究者修订版",
            strategy: "同一项目修订检索式后重新执行真实预检。",
            query: body.searchQuery.trim().slice(0, 5000),
          },
          {
            id: "previous_query_comparison",
            label: "上次检索式对照",
            strategy: "保留上次检索式用于比较，不自动批准。",
            query: before.project.searchQuery,
          },
        ],
        sampleLimit: 3,
        signal: AbortSignal.timeout(45_000),
      }));
    } catch (error) {
      error.projectId = projectId;
      error.project = await currentProject(projectId);
      error.recoverable = true;
      throw error;
    }
    const candidate = preview.candidates.find((item) => item.id === "researcher_retry");
    if (candidate?.status !== "ready") {
      const error = Object.assign(
        new Error(candidate?.error?.message ?? "修订检索式仍未取得可检查的 PubMed 预检样本。"),
        {
          code: candidate?.status === "zero_results"
            ? "PUBMED_NO_RESULTS"
            : candidate?.error?.code ?? "PUBMED_PREVIEW_FAILED",
          projectId,
          project: serializeProject(before),
          recoverable: true,
        },
      );
      throw error;
    }
    const selection = queryPreviewSelectionForBody({
      queryPlanHash: preview.planHash,
      selectedCandidateId: candidate.id,
    });
    let result = await service.updateQueryPreviewSelection({ projectId, selection });
    for (const blocker of retrievalBlockers) {
      result = await service.resumeProject({
        projectId,
        nodeId: blocker.nodeId,
        blockerId: blocker.id,
        actor: humanActor(),
        resolution: "研究者修改检索式后，PubMed 预检已返回可检查样本；正式检索仍需在范围批准后执行。",
      });
    }
    result = await service.runUntilBoundary(projectId);
    sendJson(response, 200, serializeProject(result));
    return true;
  }

  const exportMatch = pathname.match(
    /^\/api\/research\/projects\/([^/]+)\/exports\/(manuscript\.md|restricted-draft\.md|research-bundle\.json|references\.bib|export-manifest\.json)$/,
  );
  if (exportMatch && request.method === "GET") {
    const projectId = decodeURIComponent(exportMatch[1]);
    const exportName = exportMatch[2];
    const result = await service.getProject(projectId);
    const status = statusForResult(result);
    const maturity = contentMaturityFor(result, status);
    let signedAuthority;
    try {
      signedAuthority = resolveSignedExportAuthority(result.artifacts);
    } catch (error) {
      throw Object.assign(
        new Error("当前项目没有内容级校验通过且由作者签署的唯一导出清单。"),
        { code: "EXPORT_NOT_READY", cause: error },
      );
    }
    const manifest = signedAuthority.manifestArtifact.content;
    if (exportName === "export-manifest.json") {
      const body = `${JSON.stringify(publicExportManifest(manifest), null, 2)}\n`;
      sendDownload(response, {
        body,
        contentType: "application/json",
        fileName: `${result.project.title || "research"}-export-manifest.json`,
      });
      return true;
    }
    if (exportName === "manuscript.md") {
      if (
        !maturity.formalResearchComplete ||
        signedAuthority.authorityClass !== "authoritative" ||
        signedAuthority.restrictedOnly
      ) {
        throw Object.assign(
          new Error("当前版本尚未同时完成正式内容等级、全文审计和作者签署；只能导出受限草稿或可追溯研究包。"),
          { code: "EXPORT_NOT_READY" },
        );
      }
      const file = authoritativeExportFile(manifest, "audited-manuscript.md");
      sendDownload(response, {
        body: file.bytes,
        contentType: file.mediaType,
        fileName: `${result.project.title || "research-manuscript"}.md`,
        sha256: file.sha256,
      });
      return true;
    }
    if (exportName === "restricted-draft.md") {
      const file = authoritativeExportFile(manifest, "restricted-draft.md");
      sendDownload(response, {
        body: file.bytes,
        contentType: file.mediaType,
        fileName: `${result.project.title || "research"}-受限草稿.md`,
        sha256: file.sha256,
      });
      return true;
    }
    if (exportName === "references.bib") {
      let file;
      try {
        file = authoritativeExportFile(manifest, "references.bib");
      } catch {
        throw Object.assign(new Error("当前项目还没有可导出的来源记录。"), {
          code: "EXPORT_NOT_READY",
        });
      }
      sendDownload(response, {
        body: file.bytes,
        contentType: file.mediaType,
        fileName: `${result.project.title || "research"}-references.bib`,
        sha256: file.sha256,
      });
      return true;
    }
    const file = authoritativeExportFile(manifest, "research-bundle.json");
    sendDownload(response, {
      body: file.bytes,
      contentType: file.mediaType,
      fileName: `${result.project.title || "research"}-成果包.json`,
      sha256: file.sha256,
    });
    return true;
  }

  const reviseRetrievalProtocolMatch = pathname.match(
    /^\/api\/research\/projects\/([^/]+)\/revise-retrieval-protocol$/,
  );
  if (reviseRetrievalProtocolMatch && request.method === "POST") {
    const projectId = decodeURIComponent(reviseRetrievalProtocolMatch[1]);
    const body = await readJson(request);
    const result = await service.reviseCurrentRetrievalProtocol({
      projectId,
      actor: humanActor(),
      revisedQuery: body.revisedQuery,
      reason: body.reason,
      blockerId: body.blockerId ?? null,
      explicitRevision: body.explicitRevision === true,
    });
    launchRun(projectId);
    sendJson(response, 202, serializeProject(result));
    return true;
  }

  const projectMatch = pathname.match(/^\/api\/research\/projects\/([^/]+)$/);
  if (projectMatch && request.method === "GET") {
    sendJson(response, 200, await currentProject(decodeURIComponent(projectMatch[1])));
    return true;
  }

  const actionMatch = pathname.match(
    /^\/api\/research\/projects\/([^/]+)\/(run|pause|resume|cancel)$/,
  );
  if (actionMatch && request.method === "POST") {
    const projectId = decodeURIComponent(actionMatch[1]);
    const action = actionMatch[2];
    const body = await readJson(request);
    if (action === "run") {
      launchRun(projectId);
      sendJson(response, 202, await currentProject(projectId));
      return true;
    }
    if (action === "pause") {
      const record = activeRunFor(projectId);
      const result = await service.pauseProject({
        projectId,
        actor: humanActor(),
        reason: body.reason || "研究者从工作台暂停当前项目。",
      });
      record?.controller.abort("paused_by_researcher");
      sendJson(response, 200, serializeProject(result));
      return true;
    }
    if (action === "resume") {
      const result = await service.resumeProject({
        projectId,
        actor: humanActor(),
        blockerId: body.blockerId ?? null,
        resolution: body.reason || "研究者从工作台恢复当前项目。",
      });
      launchRun(projectId);
      sendJson(response, 202, serializeProject(result));
      return true;
    }
    const record = activeRunFor(projectId);
    const result = await service.cancelNode({
      projectId,
      actor: humanActor(),
      reason: body.reason || "研究者明确停止当前研究步骤。",
    });
    record?.controller.abort("cancelled_by_researcher");
    sendJson(response, 200, serializeProject(result));
    return true;
  }

  const gateMatch = pathname.match(
    /^\/api\/research\/projects\/([^/]+)\/gates\/([^/]+)\/decision$/,
  );
  if (gateMatch && request.method === "POST") {
    const projectId = decodeURIComponent(gateMatch[1]);
    const gateId = decodeURIComponent(gateMatch[2]);
    const body = await readJson(request);
    const current = await service.getProject(projectId);
    const gate = current.state.gates[gateId];
    const node = gate ? nodeById(gate.nodeId) : null;
    const role = node?.approverRoles?.[0] ?? "human_researcher";
    const result = await service.gateDecision({
      projectId,
      gateId,
      actor: humanActor(role),
      decision: body.decision,
      reason: body.reason,
      gateFingerprint: body.gateFingerprint,
    });
    if (
      body.decision === "approved" ||
      body.decision === "accepted_risk" ||
      body.decision === "amendment_requested"
    ) {
      launchRun(projectId);
    }
    sendJson(response, 200, serializeProject(result));
    return true;
  }

  const reviewMatch = pathname.match(
    /^\/api\/research\/projects\/([^/]+)\/reviews\/([^/]+)\/decision$/,
  );
  if (reviewMatch && request.method === "POST") {
    const projectId = decodeURIComponent(reviewMatch[1]);
    const nodeId = decodeURIComponent(reviewMatch[2]);
    const body = await readJson(request);
    const node = nodeById(nodeId);
    const current = serializeProject(await service.getProject(projectId));
    const pendingReview = current.pendingReview;
    if (!pendingReview || pendingReview.nodeId !== nodeId) {
      throw Object.assign(new Error("当前项目已经不在这项人工复核上，请刷新后核对新状态。"), {
        code: "STALE_REVIEW_MATERIAL",
      });
    }
    const submittedArtifactIds = Array.isArray(body.artifactIds)
      ? body.artifactIds.map(String).sort()
      : [];
    const currentArtifactIds = pendingReview.artifacts
      .map((artifact) => artifact.artifactId)
      .sort();
    if (
      body.materialFingerprint !== pendingReview.materialFingerprint ||
      JSON.stringify(submittedArtifactIds) !== JSON.stringify(currentArtifactIds)
    ) {
      throw Object.assign(new Error("候选内容已变化或请求没有绑定当前可见版本，请刷新后重新核对。"), {
        code: "STALE_REVIEW_MATERIAL",
      });
    }
    const result = await service.manualReview({
      projectId,
      nodeId,
      actor: humanActor(node?.reviewerRole ?? "human_researcher"),
      decision: body.decision,
      reason: body.reason,
    });
    if (["accepted", "approved", "accepted_with_limitations"].includes(body.decision)) {
      launchRun(projectId);
    }
    sendJson(response, 200, serializeProject(result));
    return true;
  }

  return false;
}

let shuttingDown = false;
const sockets = new Set();
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  try {
    if (pathname !== "/api/research/health" && !requestHasValidBasicAuth(request)) {
      requestBasicAuth(response);
      return;
    }
    if (pathname.startsWith("/api/research/")) {
      const handled = await apiHandler(request, response, pathname);
      if (!handled) sendJson(response, 404, { code: "NOT_FOUND", message: "科研接口不存在。" });
      return;
    }
    if (production) {
      await serveProduction(request, response);
      return;
    }
    if (pathname === "/research-workbench") request.url = "/research-workbench.html";
    vite.middlewares(request, response);
  } catch (error) {
    sendJson(response, errorStatus(error), {
      code: error?.code ?? "RESEARCH_WORKBENCH_ERROR",
      message: error instanceof Error ? error.message : "科研工作台暂时无法完成这项操作。",
      projectId: error?.projectId ?? null,
      project: error?.project ?? null,
      recoverable: error?.recoverable === true,
      details: env.NODE_ENV === "development" ? error?.details ?? null : undefined,
    });
  }
});

server.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});

async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Research Workbench received ${signal}; waiting for active work to stop.`);
  for (const run of activeRuns.values()) run.controller.abort(`server_${signal.toLowerCase()}`);
  const forceTimer = setTimeout(() => {
    for (const socket of sockets) socket.destroy();
  }, 10_000);
  forceTimer.unref();
  server.close(async (error) => {
    clearTimeout(forceTimer);
    try {
      await vite?.close?.();
    } finally {
      process.exitCode = error ? 1 : 0;
      if (error) console.error("Research Workbench shutdown failed:", error.message);
    }
  });
  server.closeIdleConnections?.();
}

process.once("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.once("SIGINT", () => void gracefulShutdown("SIGINT"));

server.listen(port, host, () => {
  const runtime = piRuntime.describeRuntime();
  console.log(`Research Workbench ready at http://${host}:${port}/research-workbench`);
  console.log(
    runtime.mode === "live"
      ? `Pi Agent live mode: ${runtime.provider}/${runtime.modelId}`
      : "Pi Agent guided mode: real Agent/tool loop with deterministic local responses.",
  );
  console.log(`Research data persists under ${dataDir}`);
});
