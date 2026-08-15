import { sha256 } from "./event-engine-v1.js";

const LIVE_RESEARCH_MODE = "live_pubmed";
const DEFAULT_RESULT_LIMIT = 8;
const MAX_RESULT_LIMIT = 20;
const RETRIEVAL_RUN_SCHEMA_VERSION = "research-retrieval-run/v1";
const QUERY_PREVIEW_SELECTION_SCHEMA_VERSION =
  "research-query-preview-selection/v1";
const RETRIEVAL_PURPOSE_BY_NODE = Object.freeze({
  run_pilot_search: "pilot",
  build_orientation_corpus: "orientationCorpus",
  calibrate_focused_search: "focusedCalibration",
  freeze_library: "finalLibrary",
});
const PROTOCOL_TYPE_BY_NODE = Object.freeze({
  run_pilot_search: "OrientationSearchProtocol",
  build_orientation_corpus: "FrozenOrientationSearchProtocol",
  calibrate_focused_search: "FocusedSearchProtocol",
  freeze_library: "FrozenSearchProtocol",
});

const PUBMED_ACCESS_BOUNDARY =
  "仅访问 PubMed 返回的题录和摘要，未核查全文或补充材料；摘要未报告的信息保持未知。";

export class ResearchLiveRetrievalError extends Error {
  constructor(code, message, details = {}, options = {}) {
    super(message, options);
    this.name = "ResearchLiveRetrievalError";
    this.code = code;
    this.details = details;
  }
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nodeIdOf(node) {
  return typeof node === "string" ? node : node?.id;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function isoNow(now) {
  const raw = now();
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new ResearchLiveRetrievalError(
      "INVALID_RETRIEVAL_CLOCK",
      "真实检索时钟必须返回有效日期。",
    );
  }
  return date.toISOString();
}

function resolveQuery(project) {
  if (hasText(project?.searchQuery)) return project.searchQuery.trim();
  if (hasText(project?.question)) return project.question.trim();
  throw new ResearchLiveRetrievalError(
    "INVALID_SEARCH_QUERY",
    "请先填写 PubMed 检索式或研究问题，再开始真实检索。",
  );
}

function normalizedQueryVariant(value, index, nodeId) {
  if (typeof value === "string") {
    return { id: `${nodeId}:query:${index + 1}`, query: value.trim() };
  }
  if (!isPlainObject(value)) return null;
  const query = value.query ?? value.searchQuery;
  return {
    id: hasText(value.id) ? value.id.trim() : `${nodeId}:query:${index + 1}`,
    query: hasText(query) ? query.trim() : "",
  };
}

function protocolQueries(nodeId, content) {
  const variants = Array.isArray(content?.queryVariants)
    ? content.queryVariants
        .map((variant, index) => normalizedQueryVariant(variant, index, nodeId))
        .filter((variant) => hasText(variant?.query))
    : [];
  if (variants.length > 0) return variants;
  const selected = content?.selectedQuery ?? content?.query;
  return hasText(selected)
    ? [{
        id:
          content?.selectedQueryId ??
          content?.queryId ??
          `${nodeId}:query:1`,
        query: selected.trim(),
      }]
    : [];
}

export function retrievalPurposeForNode(node) {
  return RETRIEVAL_PURPOSE_BY_NODE[nodeIdOf(node)] ?? null;
}

export function buildRetrievalRequests({ node, inputArtifacts } = {}) {
  const nodeId = nodeIdOf(node);
  const purpose = retrievalPurposeForNode(nodeId);
  if (!purpose) return [];
  const protocolType = PROTOCOL_TYPE_BY_NODE[nodeId];
  const candidates = (Array.isArray(inputArtifacts) ? inputArtifacts : []).filter(
    (artifact) => artifact?.type === protocolType,
  );
  if (candidates.length !== 1) {
    throw new ResearchLiveRetrievalError(
      "RETRIEVAL_PROTOCOL_MISSING",
      `${nodeId} 必须绑定唯一的 ${protocolType} 才能执行真实检索。`,
      { nodeId, protocolType, artifactIds: candidates.map((item) => item.id) },
    );
  }
  const protocol = candidates[0];
  if (!hasText(protocol.id) || !/^[a-f0-9]{64}$/i.test(protocol.contentHash ?? "")) {
    throw new ResearchLiveRetrievalError(
      "INVALID_RETRIEVAL_PROTOCOL",
      "检索协议缺少稳定产物编号或内容指纹。",
      { nodeId, protocolArtifactId: protocol?.id ?? null },
    );
  }
  if (
    protocol.content !== undefined &&
    sha256(protocol.content) !== protocol.contentHash.toLowerCase()
  ) {
    throw new ResearchLiveRetrievalError(
      "RETRIEVAL_PROTOCOL_HASH_MISMATCH",
      "检索协议内容与持久化指纹不一致，不能执行。",
      { nodeId, protocolArtifactId: protocol.id },
    );
  }
  const queries = protocolQueries(nodeId, protocol.content);
  if (queries.length === 0) {
    throw new ResearchLiveRetrievalError(
      "RETRIEVAL_PROTOCOL_QUERY_MISSING",
      `${protocolType} 没有可执行查询。`,
      { nodeId, protocolArtifactId: protocol.id },
    );
  }
  const seenIds = new Set();
  const seenQueries = new Set();
  return queries.map((variant) => {
    if (seenIds.has(variant.id) || seenQueries.has(variant.query)) {
      throw new ResearchLiveRetrievalError(
        "DUPLICATE_PROTOCOL_QUERY",
        "同一检索协议不能包含重复的查询编号或查询字符串。",
        { nodeId, queryId: variant.id, query: variant.query },
      );
    }
    seenIds.add(variant.id);
    seenQueries.add(variant.query);
    return Object.freeze({
      purpose,
      nodeId,
      protocolArtifactId: protocol.id,
      protocolContentHash: protocol.contentHash.toLowerCase(),
      queryId: variant.id,
      query: variant.query,
      queryHash: sha256(variant.query),
    });
  });
}

function resolveLimit(project) {
  const raw =
    project?.searchLimit ??
    project?.pubmedLimit ??
    project?.liveSearchLimit ??
    project?.retrievalLimit ??
    DEFAULT_RESULT_LIMIT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ResearchLiveRetrievalError(
      "INVALID_SEARCH_LIMIT",
      "PubMed 检索数量必须是正整数。",
      { received: raw },
    );
  }
  return Math.min(parsed, MAX_RESULT_LIMIT);
}

function nullableText(value) {
  return hasText(value) ? value.trim() : null;
}

function recordLimitations(record, accessLevel) {
  const limitations = Array.isArray(record?.limitations)
    ? record.limitations.map(String).filter(hasText)
    : [];
  const boundary =
    accessLevel === "abstract_only"
      ? "仅访问 PubMed 题录与摘要，未核查全文或补充材料。"
      : "PubMed 未返回摘要；当前来源仅可用于题名级候选筛选，不能支持正文科研结论。";
  const unknowns = "题名或摘要未报告的信息保持未知，不得据此推断为未实施。";
  return [...new Set([...limitations, boundary, unknowns])];
}

function sourceSnapshotHashForNormalized(record) {
  const payload = {
    sourceId: record.sourceId,
    provider: record.provider,
    pmid: record.pmid,
    doi: record.doi,
    title: record.title,
    abstract: record.abstract,
    journal: record.journal,
    year: record.year,
    accessLevel: record.accessLevel,
    locator: record.locator,
  };
  return sha256(payload);
}

function sourceSnapshotHashCandidates(record) {
  const payload = {
    sourceId: record.sourceId,
    provider: record.provider,
    pmid: record.pmid,
    doi: record.doi,
    title: record.title,
    abstract: record.abstract,
    journal: record.journal,
    year: record.year,
    accessLevel: record.accessLevel,
    locator: record.locator,
  };
  return new Set([
    sha256(payload),
    sha256(Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== null))),
  ]);
}

function normalizeRecord(record, index) {
  const pmid = nullableText(record?.pmid ?? record?.PMID);
  const doi = nullableText(record?.doi ?? record?.DOI);
  const title = nullableText(record?.title) ?? "题名未返回";
  const abstract = nullableText(record?.abstract ?? record?.text);
  const accessLevel = abstract ? "abstract_only" : "title_only";
  const sourceId =
    nullableText(record?.sourceId ?? record?.id) ??
    (pmid ? `pubmed:${pmid}` : `pubmed:unknown:${sha256({ title, index }).slice(0, 12)}`);
  const locator = {
    ...(record?.locator && typeof record.locator === "object"
      ? structuredClone(record.locator)
      : {}),
    ...(pmid ? { pmid } : {}),
    ...(doi ? { doi } : {}),
    ...(pmid && !record?.locator?.url
      ? { url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` }
      : {}),
  };
  const normalized = {
    id: sourceId,
    sourceId,
    provider: "pubmed",
    pmid,
    doi,
    title,
    text: abstract,
    abstract,
    journal: nullableText(record?.journal),
    year: nullableText(record?.year),
    accessLevel,
    locator,
    limitations: recordLimitations(record, accessLevel),
  };
  const suppliedHash = nullableText(record?.sourceSnapshotHash);
  const computedSourceSnapshotHash = sourceSnapshotHashForNormalized(normalized);
  return {
    ...normalized,
    sourceSnapshotHash: /^[a-f0-9]{64}$/i.test(suppliedHash ?? "")
      ? suppliedHash.toLowerCase()
      : computedSourceSnapshotHash,
  };
}

function preserveToolError(error, stage) {
  if (error instanceof ResearchLiveRetrievalError) return error;
  const code = hasText(error?.code) ? error.code : "PUBMED_RETRIEVAL_FAILED";
  const originalMessage = hasText(error?.message) ? error.message : "未知错误";
  return new ResearchLiveRetrievalError(
    code,
    `PubMed ${stage}失败：${originalMessage}`,
    error?.details && typeof error.details === "object" ? error.details : {},
    { cause: error },
  );
}

export function shouldRunLiveRetrieval(project, node) {
  return (
    project?.researchMode === LIVE_RESEARCH_MODE &&
    Boolean(retrievalPurposeForNode(node))
  );
}

export async function runLiveRetrieval({
  gateway,
  project,
  node,
  request = null,
  signal,
  now = () => new Date(),
} = {}) {
  if (!shouldRunLiveRetrieval(project, node)) return null;
  if (
    !gateway ||
    typeof gateway.searchPubMed !== "function" ||
    typeof gateway.fetchPubMed !== "function"
  ) {
    throw new ResearchLiveRetrievalError(
      "PUBMED_GATEWAY_UNAVAILABLE",
      "当前运行没有配置可用的 PubMed 检索工具。",
    );
  }

  const query = hasText(request?.query) ? request.query.trim() : resolveQuery(project);
  const limit = resolveLimit(project);
  let search;
  try {
    search = await gateway.searchPubMed({ query, limit }, signal);
  } catch (error) {
    throw preserveToolError(error, "检索");
  }

  const resultIds = Array.isArray(search?.resultIds)
    ? [...new Set(search.resultIds.map(String).filter(hasText))]
    : [];
  if (resultIds.length === 0) {
    throw new ResearchLiveRetrievalError(
      "PUBMED_NO_RESULTS",
      `PubMed 没有返回可读取的记录。请检查或收窄检索式：${query}`,
      { provider: "pubmed", query, total: Number(search?.total ?? 0), limit },
    );
  }

  let fetched;
  try {
    fetched = await gateway.fetchPubMed({ resultIds }, signal);
  } catch (error) {
    throw preserveToolError(error, "摘要获取");
  }
  const records = Array.isArray(fetched?.records)
    ? fetched.records.map(normalizeRecord)
    : [];
  if (records.length === 0) {
    throw new ResearchLiveRetrievalError(
      "PUBMED_FETCH_EMPTY",
      "PubMed 返回了记录编号，但没有获得可持久化的题录或摘要。",
      { provider: "pubmed", query, resultIds },
    );
  }
  const fetchedPmids = new Set(records.map((record) => record.pmid).filter(hasText));
  const missingResultIds = resultIds.filter((resultId) => !fetchedPmids.has(resultId));
  const unexpectedPmids = [...fetchedPmids].filter((pmid) => !resultIds.includes(pmid));
  if (missingResultIds.length > 0 || unexpectedPmids.length > 0) {
    throw new ResearchLiveRetrievalError(
      "PUBMED_FETCH_INCOMPLETE",
      "PubMed 返回的题录与检索编号不完整一致；本轮已停止，避免静默遗漏来源。",
      {
        provider: "pubmed",
        query,
        resultIds,
        fetchedPmids: [...fetchedPmids],
        missingResultIds,
        unexpectedPmids,
      },
    );
  }

  const receipt = {
    provider: "pubmed",
    query,
    executedAt: hasText(search?.executedAt) ? search.executedAt : isoNow(now),
    fetchedAt: hasText(fetched?.fetchedAt) ? fetched.fetchedAt : isoNow(now),
    total: Number(search?.total ?? resultIds.length),
    resultIds,
    records,
    accessBoundary: hasText(fetched?.accessBoundary)
      ? fetched.accessBoundary
      : PUBMED_ACCESS_BOUNDARY,
  };
  const signedReceipt = { ...receipt, receiptHash: sha256(receipt) };
  assertValidLiveRetrievalReceipt(signedReceipt, {
    project: request ? { ...project, searchQuery: query } : project,
  });
  return deepFreeze(signedReceipt);
}

export function createRetrievalRun({ request, receipt } = {}) {
  if (!isPlainObject(request)) {
    throw new ResearchLiveRetrievalError(
      "INVALID_RETRIEVAL_REQUEST",
      "正式检索运行必须绑定协议请求。",
    );
  }
  assertValidLiveRetrievalReceipt(receipt, {
    project: { searchQuery: request.query },
  });
  if (
    request.queryHash !== sha256(request.query) ||
    receipt.query !== request.query
  ) {
    throw new ResearchLiveRetrievalError(
      "RETRIEVAL_QUERY_BINDING_MISMATCH",
      "检索回执没有绑定当前协议的确切查询。",
      { requestQuery: request.query, receiptQuery: receipt.query },
    );
  }
  const run = {
    schemaVersion: RETRIEVAL_RUN_SCHEMA_VERSION,
    purpose: request.purpose,
    nodeId: request.nodeId,
    protocolArtifactId: request.protocolArtifactId,
    protocolContentHash: request.protocolContentHash,
    queryId: request.queryId,
    query: request.query,
    queryHash: request.queryHash,
    receipt: structuredClone(receipt),
  };
  assertValidRetrievalRun(run);
  return deepFreeze(run);
}

export function validateRetrievalRun(run, { purpose = null } = {}) {
  const issues = [];
  if (!isPlainObject(run)) return ["retrieval run must be an object"];
  if (run.schemaVersion !== RETRIEVAL_RUN_SCHEMA_VERSION) {
    issues.push(`schemaVersion must equal ${RETRIEVAL_RUN_SCHEMA_VERSION}`);
  }
  if (!Object.values(RETRIEVAL_PURPOSE_BY_NODE).includes(run.purpose)) {
    issues.push("purpose is unsupported");
  }
  if (purpose && run.purpose !== purpose) issues.push(`purpose must equal ${purpose}`);
  if (RETRIEVAL_PURPOSE_BY_NODE[run.nodeId] !== run.purpose) {
    issues.push("nodeId does not match purpose");
  }
  const expectedProtocolType = PROTOCOL_TYPE_BY_NODE[run.nodeId];
  if (!hasText(run.protocolArtifactId)) issues.push("protocolArtifactId is required");
  if (!/^[a-f0-9]{64}$/i.test(run.protocolContentHash ?? "")) {
    issues.push("protocolContentHash must be SHA-256");
  }
  if (!expectedProtocolType) issues.push("nodeId is not a retrieval node");
  if (!hasText(run.queryId)) issues.push("queryId is required");
  if (!hasText(run.query)) issues.push("query is required");
  if (run.queryHash !== sha256(run.query ?? "")) issues.push("queryHash does not match query");
  const receiptIssues = validateLiveRetrievalReceipt(run.receipt, {
    project: hasText(run.query) ? { searchQuery: run.query } : null,
  });
  issues.push(...receiptIssues.map((issue) => `receipt: ${issue}`));
  return issues;
}

export function assertValidRetrievalRun(run, options = {}) {
  const issues = validateRetrievalRun(run, options);
  if (issues.length > 0) {
    throw new ResearchLiveRetrievalError(
      "INVALID_RETRIEVAL_RUN",
      `正式检索运行未通过绑定核查：${issues.join("；")}`,
      { issues },
    );
  }
  return run;
}

export function validateQueryPreviewSelection(selection) {
  const issues = [];
  if (!isPlainObject(selection)) return ["query preview selection must be an object"];
  if (selection.schemaVersion !== QUERY_PREVIEW_SELECTION_SCHEMA_VERSION) {
    issues.push(`schemaVersion must equal ${QUERY_PREVIEW_SELECTION_SCHEMA_VERSION}`);
  }
  for (const field of ["planHash", "selectionHash"]) {
    if (!/^[a-f0-9]{64}$/i.test(selection[field] ?? "")) {
      issues.push(`${field} must be SHA-256`);
    }
  }
  for (const field of ["candidateId", "question", "query"]) {
    if (!hasText(selection[field])) issues.push(`${field} is required`);
  }
  if (!new Set(["ready", "zero_results", "failed"]).has(selection.candidateStatus)) {
    issues.push("candidateStatus is unsupported");
  }
  if (["ready", "zero_results"].includes(selection.candidateStatus)) {
    if (!Number.isInteger(selection.total) || selection.total < 0) {
      issues.push("total must be an integer >= 0 for a completed preview");
    }
    if (!hasText(selection.executedAt) || Number.isNaN(Date.parse(selection.executedAt))) {
      issues.push("executedAt must be an ISO timestamp for a completed preview");
    }
  } else {
    if (selection.total !== null) issues.push("failed preview total must be null");
    if (selection.executedAt !== null) issues.push("failed preview executedAt must be null");
    if (!hasText(selection.error?.code) || !hasText(selection.error?.message)) {
      issues.push("failed preview requires error.code and error.message");
    }
  }
  if (selection.candidateStatus === "ready" && selection.error !== undefined) {
    issues.push("ready preview must not include error");
  }
  if (!Array.isArray(selection.samples)) {
    issues.push("samples must be an array");
  } else {
    const sampleIds = [];
    selection.samples.forEach((sample, index) => {
      if (!isPlainObject(sample)) {
        issues.push(`samples[${index}] must be an object`);
        return;
      }
      if (!hasText(sample.sourceId)) issues.push(`samples[${index}].sourceId is required`);
      if (!hasText(sample.title)) issues.push(`samples[${index}].title is required`);
      if (!new Set(["title_only", "abstract_only"]).has(sample.accessLevel)) {
        issues.push(`samples[${index}].accessLevel is unsupported`);
      }
      sampleIds.push(sample.sourceId);
    });
    if (new Set(sampleIds).size !== sampleIds.length) issues.push("sample source ids must be unique");
    if (
      !Array.isArray(selection.sampleSourceIds) ||
      selection.sampleSourceIds.length !== sampleIds.length ||
      selection.sampleSourceIds.some((id, index) => id !== sampleIds[index])
    ) {
      issues.push("sampleSourceIds must exactly match samples in order");
    }
  }
  if (/^[a-f0-9]{64}$/i.test(selection.selectionHash ?? "")) {
    const { selectionHash: _selectionHash, ...body } = selection;
    if (selection.selectionHash.toLowerCase() !== sha256(body)) {
      issues.push("selectionHash does not match selection content");
    }
  }
  return issues;
}

export function assertValidQueryPreviewSelection(selection) {
  const issues = validateQueryPreviewSelection(selection);
  if (issues.length > 0) {
    throw new ResearchLiveRetrievalError(
      "INVALID_QUERY_PREVIEW_SELECTION",
      `PubMed 预检选择未通过完整性核查：${issues.join("；")}`,
      { issues },
    );
  }
  return selection;
}

export function validateLiveRetrievalReceipt(receipt, { project = null } = {}) {
  const issues = [];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return ["receipt must be an object"];
  }
  if (receipt.provider !== "pubmed") issues.push("provider must equal pubmed");
  if (!hasText(receipt.query)) issues.push("query is required");
  if (project && hasText(project.searchQuery) && receipt.query !== project.searchQuery.trim()) {
    issues.push("query must match the frozen project searchQuery");
  }
  for (const key of ["executedAt", "fetchedAt"]) {
    if (!hasText(receipt[key]) || Number.isNaN(Date.parse(receipt[key]))) {
      issues.push(`${key} must be an ISO timestamp`);
    }
  }
  if (!Number.isInteger(receipt.total) || receipt.total < 1) {
    issues.push("total must be an integer >= 1");
  }
  if (!Array.isArray(receipt.resultIds) || receipt.resultIds.length === 0) {
    issues.push("resultIds must be a non-empty array");
  }
  if (!Array.isArray(receipt.records) || receipt.records.length === 0) {
    issues.push("records must be a non-empty array");
  } else {
    const resultIds = new Set((receipt.resultIds ?? []).map(String));
    const seen = new Set();
    for (const [index, record] of receipt.records.entries()) {
      const normalized = normalizeRecord(record);
      if (record?.provider !== "pubmed" || normalized.provider !== "pubmed") {
        issues.push(`records[${index}].provider must equal pubmed`);
      }
      if (!hasText(normalized.pmid) || !resultIds.has(normalized.pmid)) {
        issues.push(`records[${index}].pmid must appear in resultIds`);
      }
      if (seen.has(normalized.pmid)) issues.push(`records[${index}].pmid must be unique`);
      seen.add(normalized.pmid);
      if (normalized.sourceId !== `pubmed:${normalized.pmid}`) {
        issues.push(`records[${index}].sourceId must be derived from PMID`);
      }
      if (!sourceSnapshotHashCandidates(normalized).has(record?.sourceSnapshotHash)) {
        issues.push(`records[${index}].sourceSnapshotHash does not match normalized content`);
      }
    }
    const missingResultIds = [...resultIds].filter((resultId) => !seen.has(resultId));
    if (missingResultIds.length > 0) {
      issues.push(`records must cover every resultId; missing ${missingResultIds.join(", ")}`);
    }
  }
  if (!hasText(receipt.accessBoundary)) issues.push("accessBoundary is required");
  if (!/^[a-f0-9]{64}$/i.test(receipt.receiptHash ?? "")) {
    issues.push("receiptHash must be a SHA-256 hash");
  } else {
    const { receiptHash: _receiptHash, ...body } = receipt;
    if (receipt.receiptHash.toLowerCase() !== sha256(body)) {
      issues.push("receiptHash does not match receipt content");
    }
  }
  return issues;
}

export function assertValidLiveRetrievalReceipt(receipt, options = {}) {
  const issues = validateLiveRetrievalReceipt(receipt, options);
  if (issues.length > 0) {
    throw new ResearchLiveRetrievalError(
      "INVALID_LIVE_RETRIEVAL_RECEIPT",
      `PubMed 检索回执未通过完整性核查：${issues.join("；")}`,
      { issues },
    );
  }
  return receipt;
}

export const RESEARCH_LIVE_RETRIEVAL_INFO = Object.freeze({
  mode: LIVE_RESEARCH_MODE,
  provider: "pubmed",
  defaultResultLimit: DEFAULT_RESULT_LIMIT,
  maxResultLimit: MAX_RESULT_LIMIT,
  retrievalRunSchemaVersion: RETRIEVAL_RUN_SCHEMA_VERSION,
  queryPreviewSelectionSchemaVersion: QUERY_PREVIEW_SELECTION_SCHEMA_VERSION,
  nodeIds: Object.freeze(Object.keys(RETRIEVAL_PURPOSE_BY_NODE)),
  purposes: Object.freeze({ ...RETRIEVAL_PURPOSE_BY_NODE }),
});
