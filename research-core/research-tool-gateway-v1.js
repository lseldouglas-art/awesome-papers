import { sha256 } from "./event-engine-v1.js";

const DEFAULT_PUBMED_LIMIT = 8;
const MAX_PUBMED_LIMIT = 100;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_MIN_INTERVAL_MS = 350;
const API_KEY_MIN_INTERVAL_MS = 100;
const RETRY_BASE_DELAY_MS = 200;
const DEFAULT_PUBMED_BASE_URL =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export class ResearchToolError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ResearchToolError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new ResearchToolError(code, message, details);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

function createAbortError(reason) {
  if (isAbortError(reason)) return reason;
  if (typeof DOMException === "function") {
    return new DOMException("The operation was aborted.", "AbortError");
  }
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function defaultSleep(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(createAbortError(signal.reason));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(createAbortError(signal.reason));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function decodeXml(value = "") {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(source, pattern) {
  return decodeXml(source.match(pattern)?.[1] ?? "");
}

function allMatches(source, pattern) {
  return [...source.matchAll(pattern)]
    .map((match) => decodeXml(match[1] ?? ""))
    .filter(Boolean);
}

function parsePubMedXml(xml) {
  const articles = [...xml.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g)];
  return articles.map((match) => {
    const source = match[1];
    const pmid = firstMatch(source, /<PMID[^>]*>([\s\S]*?)<\/PMID>/);
    const title = firstMatch(
      source,
      /<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/,
    );
    const abstractSections = allMatches(
      source,
      /<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g,
    );
    const journal = firstMatch(source, /<Title>([\s\S]*?)<\/Title>/);
    const year =
      firstMatch(source, /<PubDate>[\s\S]*?<Year>([\s\S]*?)<\/Year>/) ||
      firstMatch(source, /<PubDate>[\s\S]*?<MedlineDate>([\s\S]*?)<\/MedlineDate>/);
    const doi = firstMatch(
      source,
      /<ArticleId IdType="doi">([\s\S]*?)<\/ArticleId>/,
    );
    const abstract = abstractSections.join(" ");
    const accessLevel = abstract ? "abstract_only" : "title_only";
    const record = {
      sourceId: pmid ? `pubmed:${pmid}` : `pubmed:unknown:${sha256(title).slice(0, 12)}`,
      provider: "pubmed",
      pmid: pmid || null,
      doi: doi || null,
      title: title || "题名未返回",
      abstract: abstract || null,
      journal: journal || null,
      year: year || null,
      accessLevel,
      locator: {
        ...(pmid ? { pmid } : {}),
        ...(doi ? { doi } : {}),
        ...(pmid ? { url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` } : {}),
      },
    };
    return {
      ...record,
      sourceSnapshotHash: sha256(record),
    };
  });
}

function parsePubMedEsearchXml(xml) {
  const count = Number(firstMatch(xml, /<Count>([\s\S]*?)<\/Count>/) || 0);
  const ids = allMatches(xml, /<Id>([\s\S]*?)<\/Id>/g).filter((id) => /^\d+$/.test(id));
  return { count, idlist: ids };
}

function normalizeLimit(value) {
  const parsed = Number(value ?? DEFAULT_PUBMED_LIMIT);
  if (!Number.isInteger(parsed) || parsed < 1) {
    fail("INVALID_SEARCH_LIMIT", "检索数量必须是正整数。");
  }
  return Math.min(parsed, MAX_PUBMED_LIMIT);
}

function tokenizeClaim(value) {
  const lower = String(value ?? "").toLowerCase();
  const latin = lower.match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [];
  const chineseRuns = lower.match(/[\u3400-\u9fff]{2,}/g) ?? [];
  const chinese = chineseRuns.flatMap((run) => {
    const pairs = [];
    for (let index = 0; index < run.length - 1; index += 1) {
      pairs.push(run.slice(index, index + 2));
    }
    return pairs;
  });
  return [...new Set([...latin, ...chinese])];
}

function normalizeVisibleText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const EPISTEMIC_CONTEXT_CUES = [
  /\b(?:unknown|uncertain(?:ty|ties)?|unclear|inconclusive|equivocal)\b/u,
  /\b(?:may|might|could|possibly|perhaps)\b/u,
  /\b(?:hypothesis|hypotheses|hypothetical|counterfactual)\b/u,
  /\b(?:speculat(?:e|es|ed|ing|ion|ive)|possible explanation)\b/u,
  /\b(?:no|not|never|neither|nor|cannot|can't|couldn't|didn't|doesn't|isn't|wasn't|weren't|hasn't|haven't|hadn't)\b/u,
  /(?:不确定|尚不清楚|仍不清楚|未知|尚未知|不明确|未明确|无法确定|尚不能确定|可能|或许|也许|假设|假说|推测|猜测|反事实|未证实|未证明|未确认|未支持|不支持|无证据|证据不足|无统计学意义|未达到统计学显著)/u,
];

function hasEpistemicContextCue(value) {
  const normalized = normalizeVisibleText(value);
  return normalized.length > 0 && EPISTEMIC_CONTEXT_CUES.some((cue) => cue.test(normalized));
}

function visibleTextSegments(source) {
  const segments = [];
  for (const field of [source?.title, source?.abstract, source?.text]) {
    const normalizedFieldSource = String(field ?? "").normalize("NFKC");
    const normalizedField = normalizeVisibleText(normalizedFieldSource);
    if (!normalizedField) continue;
    // A claim equal to the complete visible field preserves all local context.
    segments.push({ text: normalizedField, externalContext: "" });
    const paragraphs = normalizedFieldSource
      .split(/\r?\n\s*\r?\n+/u);
    const paragraphRecords = paragraphs
      .map((paragraph) => ({
        text: normalizeVisibleText(paragraph),
        sentences: (paragraph.match(/[^.!?。！？]+[.!?。！？]?/gu) ?? [])
          .map(normalizeVisibleText)
          .filter(Boolean),
      }))
      .filter((paragraph) => paragraph.text);
    const orderedSentences = paragraphRecords.flatMap((paragraph, paragraphIndex) =>
      paragraph.sentences.map((text, sentenceIndex) => ({
        text,
        paragraphIndex,
        sentenceIndex,
      })),
    );
    for (let paragraphIndex = 0; paragraphIndex < paragraphRecords.length; paragraphIndex += 1) {
      const paragraph = paragraphRecords[paragraphIndex];
      const paragraphSentenceIndexes = orderedSentences
        .map((sentence, index) => ({ sentence, index }))
        .filter(({ sentence }) => sentence.paragraphIndex === paragraphIndex)
        .map(({ index }) => index);
      const firstSentenceIndex = paragraphSentenceIndexes[0];
      const lastSentenceIndex = paragraphSentenceIndexes.at(-1);
      const adjacentParagraphContext = [
        orderedSentences[firstSentenceIndex - 1]?.text,
        orderedSentences[lastSentenceIndex + 1]?.text,
      ].filter(Boolean);
      // An exact paragraph preserves every qualifier inside it, while an
      // immediately adjacent paragraph can still scope that paragraph.
      segments.push({
        text: paragraph.text,
        externalContext: adjacentParagraphContext.join(" "),
      });
      for (const sentenceIndex of paragraphSentenceIndexes) {
        const sentence = orderedSentences[sentenceIndex];
        // Exact sentence matching is only authoritative when surrounding
        // sentences in the same paragraph do not reverse or qualify it. The
        // matcher cannot safely resolve anaphora such as "this result", so it
        // deliberately fails closed on any local epistemic cue.
        const externalContext = [
          ...paragraph.sentences.filter(
            (_candidate, candidateIndex) =>
              candidateIndex !== sentence.sentenceIndex,
          ),
          ...(sentenceIndex === firstSentenceIndex
            ? [orderedSentences[sentenceIndex - 1]?.text]
            : []),
          ...(sentenceIndex === lastSentenceIndex
            ? [orderedSentences[sentenceIndex + 1]?.text]
            : []),
        ].filter(Boolean);
        segments.push({
          text: sentence.text,
          externalContext: [...new Set(externalContext)].join(" "),
        });
      }
    }
  }
  return segments;
}

function responseClone(response) {
  return typeof response?.clone === "function" ? response.clone() : null;
}

function normalizedOrigin(value, fieldName) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("INVALID_PUBMED_ENDPOINT", `${fieldName} 必须是有效的绝对 URL。`);
  }
  if (!["https:", "http:"].includes(url.protocol)) {
    fail("INVALID_PUBMED_ENDPOINT", `${fieldName} 只允许 HTTP(S) URL。`);
  }
  if (url.username || url.password) {
    fail("INVALID_PUBMED_ENDPOINT", `${fieldName} 不得在 URL 中携带凭据。`);
  }
  return url.origin;
}

function byteLength(value) {
  return Buffer.byteLength(String(value ?? ""), "utf8");
}

export class ResearchToolGateway {
  constructor({
    fetchFn = globalThis.fetch,
    artifactStore = null,
    now = () => new Date(),
    userAgent = "local-research-workbench/0.1",
    ncbiApiKey = null,
    email = null,
    tool = "local-research-workbench",
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retryCount = DEFAULT_RETRY_COUNT,
    minIntervalMs,
    sleepFn = defaultSleep,
    baseUrl = DEFAULT_PUBMED_BASE_URL,
    allowedPubMedOrigins = [new URL(DEFAULT_PUBMED_BASE_URL).origin],
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  } = {}) {
    if (typeof fetchFn !== "function") {
      fail("FETCH_UNAVAILABLE", "ResearchToolGateway requires a fetch function.");
    }
    this.fetchFn = fetchFn;
    this.artifactStore = artifactStore;
    this.now = now;
    this.userAgent = userAgent;
    this.ncbiApiKey = hasText(ncbiApiKey) ? ncbiApiKey.trim() : null;
    this.email = hasText(email) ? email.trim() : null;
    this.tool = hasText(tool) ? tool.trim() : null;
    this.timeoutMs = Number(timeoutMs);
    this.retryCount = Number(retryCount);
    this.minIntervalMs = minIntervalMs === undefined
      ? this.ncbiApiKey
        ? API_KEY_MIN_INTERVAL_MS
        : DEFAULT_MIN_INTERVAL_MS
      : Number(minIntervalMs);
    this.sleepFn = sleepFn;
    this.baseUrl = new URL(baseUrl);
    if (!this.baseUrl.pathname.endsWith("/")) this.baseUrl.pathname += "/";
    this.allowedPubMedOrigins = new Set(
      (Array.isArray(allowedPubMedOrigins) ? allowedPubMedOrigins : [])
        .map((origin) => normalizedOrigin(origin, "allowedPubMedOrigins")),
    );
    this.maxResponseBytes = Number(maxResponseBytes);
    this.lastRequestStartedAt = 0;
    this.throttleTail = Promise.resolve();

    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      fail("INVALID_TIMEOUT", "PubMed 请求超时必须是正数毫秒。");
    }
    if (!Number.isInteger(this.retryCount) || this.retryCount < 0) {
      fail("INVALID_RETRY_COUNT", "PubMed 重试次数必须是非负整数。");
    }
    if (!Number.isFinite(this.minIntervalMs) || this.minIntervalMs < 0) {
      fail("INVALID_MIN_INTERVAL", "PubMed 请求间隔必须是非负毫秒数。");
    }
    if (typeof this.sleepFn !== "function") {
      fail("INVALID_SLEEP_FUNCTION", "PubMed sleepFn 必须是函数。");
    }
    if (!Number.isInteger(this.maxResponseBytes) || this.maxResponseBytes < 1) {
      fail("INVALID_RESPONSE_LIMIT", "PubMed 响应体上限必须是正整数。 ");
    }
    this.#assertAllowedUrl(this.baseUrl, "PubMed baseUrl");
  }

  #assertAllowedUrl(value, operation) {
    const url = value instanceof URL ? value : new URL(value);
    if (!this.allowedPubMedOrigins.has(url.origin)) {
      fail(
        "PUBMED_EGRESS_BLOCKED",
        `${operation}试图访问未获准的网络来源。`,
        { origin: url.origin, allowedOrigins: [...this.allowedPubMedOrigins] },
      );
    }
    return url;
  }

  #endpoint(pathname) {
    return this.#assertAllowedUrl(new URL(pathname, this.baseUrl), "PubMed 请求");
  }

  #assertResponseSize(size, operation) {
    if (!Number.isFinite(size) || size <= this.maxResponseBytes) return;
    fail(
      "PUBMED_RESPONSE_TOO_LARGE",
      `${operation}返回内容超过 ${this.maxResponseBytes} 字节安全上限。`,
      { operation, maxResponseBytes: this.maxResponseBytes, responseBytes: size },
    );
  }

  #assertDeclaredResponseSize(response, operation) {
    const value = response?.headers?.get?.("content-length");
    if (value === null || value === undefined || value === "") return;
    const declared = Number(value);
    if (Number.isFinite(declared)) this.#assertResponseSize(declared, operation);
  }

  async #readText(response, operation) {
    this.#assertDeclaredResponseSize(response, operation);
    if (typeof response?.text !== "function") {
      fail("PUBMED_INVALID_RESPONSE", `${operation}返回了无法读取的响应。`);
    }
    const value = await response.text();
    this.#assertResponseSize(byteLength(value), operation);
    return value;
  }

  async #readJson(response, operation) {
    this.#assertDeclaredResponseSize(response, operation);
    if (typeof response?.text === "function") {
      const text = await this.#readText(response, operation);
      return JSON.parse(text);
    }
    if (typeof response?.json !== "function") {
      fail("PUBMED_INVALID_RESPONSE", `${operation}返回了无法读取的响应。`);
    }
    const value = await response.json();
    this.#assertResponseSize(byteLength(JSON.stringify(value)), operation);
    return value;
  }

  #addNcbiIdentity(url) {
    if (this.tool) url.searchParams.set("tool", this.tool);
    if (this.email) url.searchParams.set("email", this.email);
    if (this.ncbiApiKey) url.searchParams.set("api_key", this.ncbiApiKey);
  }

  async #sleep(ms, signal) {
    if (signal?.aborted) throw createAbortError(signal.reason);
    await this.sleepFn(ms, signal);
    if (signal?.aborted) throw createAbortError(signal.reason);
  }

  async #waitForRequestSlot(signal) {
    let release;
    const previous = this.throttleTail;
    this.throttleTail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      if (signal?.aborted) throw createAbortError(signal.reason);
      const remaining = this.minIntervalMs - (Date.now() - this.lastRequestStartedAt);
      if (remaining > 0) await this.#sleep(remaining, signal);
      this.lastRequestStartedAt = Date.now();
    } finally {
      release();
    }
  }

  #retryDelay(response, attempt) {
    const exponentialDelay = RETRY_BASE_DELAY_MS * (2 ** attempt);
    const retryAfter = Number(response?.headers?.get?.("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter >= 0) {
      return Math.min(Math.max(exponentialDelay, retryAfter * 1_000), 5_000);
    }
    return Math.min(exponentialDelay, 2_000);
  }

  async #fetchWithTimeout(url, options, externalSignal) {
    if (externalSignal?.aborted) throw createAbortError(externalSignal.reason);
    const controller = new AbortController();
    let rejectExternalAbort;
    const externalAbortPromise = new Promise((_, reject) => {
      rejectExternalAbort = reject;
    });
    const onExternalAbort = () => {
      controller.abort(externalSignal.reason);
      rejectExternalAbort(createAbortError(externalSignal.reason));
    };
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    let timeout;
    const timeoutError = new ResearchToolError(
      "PUBMED_TIMEOUT",
      `PubMed 请求超过 ${this.timeoutMs} 毫秒，已停止。`,
      { timeoutMs: this.timeoutMs },
    );
    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort(timeoutError);
        reject(timeoutError);
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([
        this.fetchFn(url, { ...options, signal: controller.signal }),
        timeoutPromise,
        externalAbortPromise,
      ]);
    } catch (error) {
      if (externalSignal?.aborted) throw createAbortError(externalSignal.reason);
      throw error;
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }

  async #request(url, { signal, failureCode, operation }) {
    this.#assertAllowedUrl(url, operation);
    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      await this.#waitForRequestSlot(signal);
      let response;
      try {
        response = await this.#fetchWithTimeout(
          url,
          { headers: { "User-Agent": this.userAgent } },
          signal,
        );
      } catch (error) {
        if (error?.code === "PUBMED_TIMEOUT" || isAbortError(error)) throw error;
        if (attempt < this.retryCount) {
          await this.#sleep(this.#retryDelay(null, attempt), signal);
          continue;
        }
        throw new ResearchToolError(
          failureCode,
          `${operation}失败：网络请求未完成。`,
          { cause: error?.message ?? String(error) },
        );
      }

      const retryableStatus = response.status === 429 || response.status >= 500;
      if (!response.ok && retryableStatus && attempt < this.retryCount) {
        await this.#sleep(this.#retryDelay(response, attempt), signal);
        continue;
      }
      if (!response.ok) {
        fail(failureCode, `${operation}失败（HTTP ${response.status}）。`, {
          status: response.status,
        });
      }
      if (response?.url) this.#assertAllowedUrl(response.url, `${operation}重定向`);
      this.#assertDeclaredResponseSize(response, operation);
      return response;
    }
    throw new ResearchToolError(failureCode, `${operation}失败。`);
  }

  async searchPubMed({ query, limit = DEFAULT_PUBMED_LIMIT } = {}, signal) {
    if (!hasText(query)) fail("INVALID_SEARCH_QUERY", "PubMed 检索式不能为空。");
    const resultLimit = normalizeLimit(limit);
    const url = this.#endpoint("esearch.fcgi");
    url.searchParams.set("db", "pubmed");
    url.searchParams.set("retmode", "json");
    url.searchParams.set("retmax", String(resultLimit));
    url.searchParams.set("term", query.trim());
    this.#addNcbiIdentity(url);

    const response = await this.#request(url, {
      signal,
      failureCode: "PUBMED_SEARCH_FAILED",
      operation: "PubMed 检索",
    });
    let result;
    const textFallbackResponse = responseClone(response);
    try {
      const payload = await this.#readJson(response, "PubMed 检索");
      result = payload?.esearchresult ?? {};
    } catch {
      const readable = textFallbackResponse ?? response;
      if (typeof readable?.text !== "function") {
        fail("PUBMED_SEARCH_FAILED", "PubMed 检索返回了无法解析的响应。");
      }
      result = parsePubMedEsearchXml(await this.#readText(readable, "PubMed 检索"));
    }
    return {
      provider: "pubmed",
      query: query.trim(),
      executedAt: this.now().toISOString(),
      total: Number(result.count ?? 0),
      resultIds: Array.isArray(result.idlist) ? result.idlist : [],
      accessLevel: "title_only",
      limit: resultLimit,
    };
  }

  async fetchPubMed({ resultIds } = {}, signal) {
    if (!Array.isArray(resultIds) || resultIds.length === 0) {
      fail("INVALID_FETCH_IDS", "至少需要一个 PubMed 记录编号。");
    }
    const ids = [...new Set(resultIds.map(String).filter((id) => /^\d+$/.test(id)))].slice(
      0,
      MAX_PUBMED_LIMIT,
    );
    if (ids.length === 0) fail("INVALID_FETCH_IDS", "PubMed 记录编号格式无效。");

    const url = this.#endpoint("efetch.fcgi");
    url.searchParams.set("db", "pubmed");
    url.searchParams.set("retmode", "xml");
    url.searchParams.set("id", ids.join(","));
    this.#addNcbiIdentity(url);
    const response = await this.#request(url, {
      signal,
      failureCode: "PUBMED_FETCH_FAILED",
      operation: "PubMed 摘要获取",
    });
    const xml = await this.#readText(response, "PubMed 摘要获取");
    const records = parsePubMedXml(xml);
    return {
      provider: "pubmed",
      fetchedAt: this.now().toISOString(),
      requestedIds: ids,
      records,
      accessBoundary:
        "本工具只读取 PubMed 返回的题录和摘要；摘要未报告的信息保持未知。",
    };
  }

  async readArtifact({ contentHash } = {}) {
    if (!this.artifactStore) {
      fail("ARTIFACT_STORE_UNAVAILABLE", "当前运行没有配置 Artifact Store。");
    }
    if (!/^[a-f0-9]{64}$/i.test(contentHash ?? "")) {
      fail("INVALID_CONTENT_HASH", "Artifact content hash must be SHA-256.");
    }
    return this.artifactStore.read(`sha256:${contentHash.toLowerCase()}`);
  }

  verifyCitation({ claim, sources, expectedSourceRefs = null } = {}) {
    if (!hasText(claim)) fail("INVALID_CLAIM", "待核查主张不能为空。");
    if (!Array.isArray(sources) || sources.length === 0) {
      fail("MISSING_SOURCES", "逐句核查至少需要一个可定位来源。");
    }
    const checkedSources = sources.map((source, index) => {
      const sourceId =
        source?.sourceId ?? source?.id ?? source?.pmid ?? `source:${index + 1}`;
      const sourceSnapshotHash =
        source?.sourceSnapshotHash ??
        sha256({
          sourceId,
          title: source?.title ?? null,
          abstract: source?.abstract ?? null,
          text: source?.text ?? null,
          locator: source?.locator ?? null,
        });
      return {
        sourceId: String(sourceId),
        sourceSnapshotHash,
        accessLevel: source?.accessLevel ?? "unknown",
        locator: source?.locator ?? null,
      };
    });
    const claimTokens = tokenizeClaim(claim);
    const normalizedClaim = normalizeVisibleText(claim);
    const normalizedClaimStem = normalizedClaim.replace(/[.!?。！？;；:：]+$/u, "");
    const sourceChecks = sources.map((source, index) => {
      const sourceText = [source.title, source.abstract, source.text]
        .map(normalizeVisibleText)
        .filter(Boolean)
        .join(" ");
      const visibleSegments = visibleTextSegments(source);
      const matchedTokens = claimTokens.filter((token) => sourceText.includes(token));
      const coverage = claimTokens.length === 0 ? 0 : matchedTokens.length / claimTokens.length;
      const exactSegments = visibleSegments.filter(
        (segment) => segment.text === normalizedClaim,
      );
      const epistemicallyGuardedExactMatch =
        normalizedClaim.length >= 12 &&
        exactSegments.some((segment) => hasEpistemicContextCue(segment.externalContext));
      const exactTextMatch =
        normalizedClaim.length >= 12 &&
        exactSegments.some((segment) => !hasEpistemicContextCue(segment.externalContext));
      const contextDependentSubstring =
        normalizedClaim.length >= 12 &&
        !exactTextMatch &&
        visibleSegments.some(
          (segment) =>
            segment.text.includes(normalizedClaim) ||
            (normalizedClaimStem.length >= 12 &&
              segment.text.includes(normalizedClaimStem)),
        );
      return {
        sourceRef: checkedSources[index],
        exactTextMatch,
        epistemicallyGuardedExactMatch,
        contextDependentSubstring,
        coverage: Number(coverage.toFixed(3)),
        matchedTokens,
      };
    });
    const exactMatches = sourceChecks.filter((check) => check.exactTextMatch);
    // A claim copied out of a longer sentence may have its polarity or
    // uncertainty reversed (for example, dropping "it remains unknown
    // whether"). Never treat such a context-stripped substring as support.
    const lexicalMatches = sourceChecks.filter(
      (check) => check.coverage >= 0.25 && !check.contextDependentSubstring,
    );
    const baseVerdict =
      exactMatches.length > 0
        ? "direct_support"
        : lexicalMatches.length > 0
          ? "partial_support"
          : "unsupported";
    const matchedChecks =
      baseVerdict === "direct_support"
        ? exactMatches
        : baseVerdict === "partial_support"
          ? lexicalMatches
          : [];
    const matchedSourceRefs = matchedChecks.map((check) => ({
      ...check.sourceRef,
      matchMethod: check.exactTextMatch
        ? "exact_visible_text_match"
        : "lexical_fallback",
      coverage: check.coverage,
      matchedTokens: check.matchedTokens,
    }));
    const normalizedExpectedSourceRefs = Array.isArray(expectedSourceRefs)
      ? expectedSourceRefs.map((sourceRef) => ({
          sourceId: String(sourceRef?.sourceId ?? ""),
          sourceSnapshotHash: String(sourceRef?.sourceSnapshotHash ?? "").toLowerCase(),
        }))
      : null;
    const unmatchedExpectedSourceRefs = (normalizedExpectedSourceRefs ?? []).filter(
      (expected) =>
        !matchedSourceRefs.some(
          (actual) =>
            actual.sourceId === expected.sourceId &&
            actual.sourceSnapshotHash.toLowerCase() === expected.sourceSnapshotHash,
        ),
    );
    const sourceBindingSatisfied =
      normalizedExpectedSourceRefs === null ||
      baseVerdict === "unsupported" ||
      unmatchedExpectedSourceRefs.length === 0;
    // A lexical fallback may prove that an exact visible excerpt exists, but it
    // must never upgrade a paraphrase to direct semantic support by itself.
    // A match in some other project source must also never validate the
    // EvidenceRecord named by the sentence's citation intent.
    const verdict = sourceBindingSatisfied ? baseVerdict : "unsupported";
    const method =
      baseVerdict === "direct_support" ? "exact_visible_text_match" : "lexical_fallback";
    const coverage = Math.max(0, ...sourceChecks.map((check) => check.coverage));
    const matchedTokens = [
      ...new Set(matchedChecks.flatMap((check) => check.matchedTokens)),
    ];
    const checkedAt = this.now().toISOString();
    const claimHash = sha256(claim.trim());
    const sourceRefs =
      matchedSourceRefs.length > 0
        ? matchedSourceRefs.map(({ matchMethod, coverage: _coverage, matchedTokens: _tokens, ...sourceRef }) => sourceRef)
        : checkedSources;
    const receiptBody = {
      toolId: "citation_verify",
      method,
      claimHash,
      verdict,
      baseVerdict,
      coverage,
      sourceRefs,
      checkedSourceRefs: checkedSources,
      matchedSourceRefs,
      expectedSourceRefs: normalizedExpectedSourceRefs,
      unmatchedExpectedSourceRefs:
        baseVerdict === "unsupported" ? [] : unmatchedExpectedSourceRefs,
      sourceBindingSatisfied,
      checkedAt,
    };
    return {
      verdict,
      baseVerdict,
      method,
      coverage,
      matchedTokens,
      claimHash,
      sourceRefs,
      checkedSourceRefs: checkedSources,
      matchedSourceRefs,
      expectedSourceRefs: normalizedExpectedSourceRefs,
      unmatchedExpectedSourceRefs:
        baseVerdict === "unsupported" ? [] : unmatchedExpectedSourceRefs,
      sourceBindingSatisfied,
      limitations: [
        baseVerdict === "direct_support"
          ? "直接支持仅表示该句是可见来源文本中的精确摘录，不自动证明因果、方法学质量或外推有效性。"
          : "词项覆盖只能标记部分支持或不支持，不会把改写文本自动升级为直接语义支持。",
        sourceBindingSatisfied
          ? "匹配按单篇来源独立执行；不同来源中的词项不会拼接为支持。"
          : "可见文本虽在其他来源中命中，但没有命中 citation intent 指向的 EvidenceRecord 来源，因此不能形成支持。",
        "正式写作仍需独立核查者回到原文定位确认。",
      ],
      checkedAt,
      receiptHash: sha256(receiptBody),
    };
  }
}

export const __testing = Object.freeze({ parsePubMedXml, parsePubMedEsearchXml, tokenizeClaim });
