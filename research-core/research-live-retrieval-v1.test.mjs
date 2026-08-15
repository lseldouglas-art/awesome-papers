import test from "node:test";
import assert from "node:assert/strict";

import { sha256 } from "./event-engine-v1.js";
import {
  assertValidQueryPreviewSelection,
  assertValidLiveRetrievalReceipt,
  assertValidRetrievalRun,
  buildRetrievalRequests,
  createRetrievalRun,
  runLiveRetrieval,
  shouldRunLiveRetrieval,
  validateLiveRetrievalReceipt,
} from "./research-live-retrieval-v1.js";

function protocolArtifact(type, id, content) {
  return { id, type, content, contentHash: sha256(content) };
}

function liveProject(overrides = {}) {
  return {
    id: "live-project",
    researchMode: "live_pubmed",
    question: "postoperative sleep recovery",
    ...overrides,
  };
}

function successfulGateway(calls) {
  return {
    async searchPubMed(input, signal) {
      calls.push({ method: "search", input, signal });
      return {
        provider: "pubmed",
        query: input.query,
        executedAt: "2026-08-12T01:00:00.000Z",
        total: 42,
        resultIds: ["123", "456"],
      };
    },
    async fetchPubMed(input, signal) {
      calls.push({ method: "fetch", input, signal });
      return {
        provider: "pubmed",
        fetchedAt: "2026-08-12T01:00:01.000Z",
        records: [
          {
            sourceId: "pubmed:123",
            provider: "pubmed",
            pmid: "123",
            doi: "10.1000/example",
            title: "A retrieved abstract",
            abstract: "The abstract reports a bounded association.",
            journal: "Research Journal",
            year: "2025",
            accessLevel: "abstract_only",
            locator: { pmid: "123" },
          },
          {
            provider: "pubmed",
            pmid: "456",
            title: "A title-only record",
          },
        ],
        accessBoundary: "测试访问边界。",
      };
    },
  };
}

test("live retrieval searches PubMed, fetches records, and returns an immutable receipt", async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const receipt = await runLiveRetrieval({
    gateway: successfulGateway(calls),
    project: liveProject(),
    node: { id: "run_pilot_search" },
    signal,
  });

  assert.deepEqual(
    calls.map(({ method }) => method),
    ["search", "fetch"],
  );
  assert.deepEqual(calls[0].input, {
    query: "postoperative sleep recovery",
    limit: 8,
  });
  assert.deepEqual(calls[1].input, { resultIds: ["123", "456"] });
  assert.equal(calls[0].signal, signal);
  assert.equal(receipt.provider, "pubmed");
  assert.equal(receipt.records[0].id, "pubmed:123");
  assert.equal(receipt.records[0].text, receipt.records[0].abstract);
  assert.match(receipt.records[0].sourceSnapshotHash, /^[a-f0-9]{64}$/);
  assert.equal(receipt.records[1].accessLevel, "title_only");
  assert.match(receipt.records[1].limitations.join(" "), /不能支持正文科研结论/);
  assert.equal(receipt.receiptHash, sha256({
    provider: receipt.provider,
    query: receipt.query,
    executedAt: receipt.executedAt,
    fetchedAt: receipt.fetchedAt,
    total: receipt.total,
    resultIds: receipt.resultIds,
    records: receipt.records,
    accessBoundary: receipt.accessBoundary,
  }));
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.records), true);
  assert.equal(Object.isFrozen(receipt.records[0].locator), true);
});

test("live retrieval receipts reject forged providers, content hashes, and receipt hashes", async () => {
  const receipt = await runLiveRetrieval({
    gateway: successfulGateway([]),
    project: liveProject(),
    node: "run_pilot_search",
  });
  const forgedProvider = structuredClone(receipt);
  forgedProvider.provider = "user_supplied";
  assert.match(validateLiveRetrievalReceipt(forgedProvider).join(" "), /provider must equal pubmed/);

  const forgedSource = structuredClone(receipt);
  forgedSource.records[0].title = "Invented title after retrieval";
  assert.match(
    validateLiveRetrievalReceipt(forgedSource).join(" "),
    /sourceSnapshotHash does not match normalized content|receiptHash does not match/,
  );

  const forgedReceipt = structuredClone(receipt);
  forgedReceipt.receiptHash = "f".repeat(64);
  assert.throws(
    () => assertValidLiveRetrievalReceipt(forgedReceipt),
    (error) => error.code === "INVALID_LIVE_RETRIEVAL_RECEIPT",
  );
});

test("zero PubMed results fail clearly and never call fetch", async () => {
  let fetchCalls = 0;
  const gateway = {
    async searchPubMed() {
      return { total: 0, resultIds: [] };
    },
    async fetchPubMed() {
      fetchCalls += 1;
      return { records: [] };
    },
  };

  await assert.rejects(
    runLiveRetrieval({
      gateway,
      project: liveProject({ searchQuery: "no-result-query" }),
      node: "freeze_library",
    }),
    (error) => {
      assert.equal(error.code, "PUBMED_NO_RESULTS");
      assert.match(error.message, /没有返回/);
      assert.match(error.message, /no-result-query/);
      return true;
    },
  );
  assert.equal(fetchCalls, 0);
});

test("partial PubMed fetch fails closed instead of silently dropping result ids", async () => {
  const gateway = successfulGateway([]);
  gateway.fetchPubMed = async () => ({
    provider: "pubmed",
    fetchedAt: "2026-08-12T01:00:01.000Z",
    records: [{ provider: "pubmed", pmid: "123", title: "Only one fetched record" }],
    accessBoundary: "测试访问边界。",
  });

  await assert.rejects(
    runLiveRetrieval({
      gateway,
      project: liveProject(),
      node: { id: "run_pilot_search" },
    }),
    (error) =>
      error.code === "PUBMED_FETCH_INCOMPLETE" &&
      error.details?.missingResultIds?.includes("456"),
  );

  const completeReceipt = await runLiveRetrieval({
    gateway: successfulGateway([]),
    project: liveProject(),
    node: { id: "run_pilot_search" },
  });
  const incompleteReceipt = structuredClone(completeReceipt);
  incompleteReceipt.records = incompleteReceipt.records.slice(0, 1);
  const { receiptHash: _oldHash, ...incompleteBody } = incompleteReceipt;
  incompleteReceipt.receiptHash = sha256(incompleteBody);
  assert.match(
    validateLiveRetrievalReceipt(incompleteReceipt).join(" "),
    /records must cover every resultId; missing 456/,
  );
});

test("disabled modes and unrelated nodes never run live retrieval", async () => {
  let calls = 0;
  const gateway = {
    async searchPubMed() {
      calls += 1;
    },
    async fetchPubMed() {
      calls += 1;
    },
  };

  assert.equal(shouldRunLiveRetrieval(liveProject(), "build_orientation_corpus"), true);
  assert.equal(
    shouldRunLiveRetrieval(liveProject({ researchMode: "guided" }), "run_pilot_search"),
    false,
  );
  assert.equal(shouldRunLiveRetrieval(liveProject(), "capture_intent"), false);
  assert.equal(
    await runLiveRetrieval({
      gateway,
      project: liveProject({ researchMode: "guided" }),
      node: "run_pilot_search",
    }),
    null,
  );
  assert.equal(calls, 0);
});

test("searchQuery wins over question and the configured limit is bounded", async () => {
  const calls = [];
  await runLiveRetrieval({
    gateway: successfulGateway(calls),
    project: liveProject({
      question: "自然语言研究问题",
      searchQuery: "sleep AND postoperative recovery",
      searchLimit: 200,
    }),
    node: "calibrate_focused_search",
  });

  assert.deepEqual(calls[0].input, {
    query: "sleep AND postoperative recovery",
    limit: 20,
  });
});

test("gateway error codes are preserved with a clear PubMed stage", async () => {
  const gatewayError = Object.assign(new Error("HTTP 503"), {
    code: "PUBMED_SEARCH_FAILED",
    details: { status: 503 },
  });
  await assert.rejects(
    runLiveRetrieval({
      gateway: {
        async searchPubMed() {
          throw gatewayError;
        },
        async fetchPubMed() {},
      },
      project: liveProject(),
      node: "run_pilot_search",
    }),
    (error) => {
      assert.equal(error.code, "PUBMED_SEARCH_FAILED");
      assert.match(error.message, /PubMed 检索失败/);
      assert.equal(error.cause, gatewayError);
      return true;
    },
  );
});

test("retrieval requests bind each formal node to its exact protocol and focused variants", () => {
  const cases = [
    ["run_pilot_search", "OrientationSearchProtocol", { query: "orientation pilot" }, "pilot"],
    ["build_orientation_corpus", "FrozenOrientationSearchProtocol", { query: "orientation final" }, "orientationCorpus"],
    ["freeze_library", "FrozenSearchProtocol", { query: "fallback", selectedQuery: "focused final" }, "finalLibrary"],
  ];
  for (const [nodeId, type, content, purpose] of cases) {
    const artifact = protocolArtifact(type, `artifact:${nodeId}`, content);
    const [request] = buildRetrievalRequests({ node: nodeId, inputArtifacts: [artifact] });
    assert.equal(request.purpose, purpose);
    assert.equal(request.protocolArtifactId, artifact.id);
    assert.equal(request.protocolContentHash, artifact.contentHash);
    assert.equal(request.queryHash, sha256(request.query));
  }

  const focused = protocolArtifact("FocusedSearchProtocol", "artifact:focused", {
    query: "core query",
    queryVariants: [
      { id: "core", query: "core query" },
      { id: "broad", query: "broad query" },
    ],
  });
  const focusedRequests = buildRetrievalRequests({
    node: "calibrate_focused_search",
    inputArtifacts: [focused],
  });
  assert.deepEqual(focusedRequests.map((request) => request.queryId), ["core", "broad"]);
  assert.ok(focusedRequests.every((request) => request.purpose === "focusedCalibration"));

  const tampered = { ...focused, contentHash: "f".repeat(64) };
  assert.throws(
    () => buildRetrievalRequests({ node: "calibrate_focused_search", inputArtifacts: [tampered] }),
    (error) => error.code === "RETRIEVAL_PROTOCOL_HASH_MISMATCH",
  );
});

test("retrieval runs preserve the protocol-query-receipt authority binding", async () => {
  const protocol = protocolArtifact("OrientationSearchProtocol", "artifact:orientation", {
    query: "protocol exact query",
  });
  const [request] = buildRetrievalRequests({
    node: "run_pilot_search",
    inputArtifacts: [protocol],
  });
  const receipt = await runLiveRetrieval({
    gateway: successfulGateway([]),
    project: liveProject({ searchQuery: "old project query" }),
    node: "run_pilot_search",
    request,
  });
  const run = createRetrievalRun({ request, receipt });
  assert.equal(run.query, "protocol exact query");
  assert.equal(run.receipt.query, "protocol exact query");
  assert.equal(run.protocolContentHash, protocol.contentHash);
  assert.doesNotThrow(() => assertValidRetrievalRun(run, { purpose: "pilot" }));
  const forged = structuredClone(run);
  forged.query = "another query";
  assert.throws(
    () => assertValidRetrievalRun(forged),
    (error) => error.code === "INVALID_RETRIEVAL_RUN",
  );
});

test("query preview selection persists samples but is cryptographically self-bound", () => {
  const body = {
    schemaVersion: "research-query-preview-selection/v1",
    planHash: sha256({ plan: 1 }),
    candidateId: "candidate:1",
    candidateStatus: "ready",
    question: "预检问题",
    query: "preview query",
    total: 1,
    executedAt: "2026-08-12T01:00:00.000Z",
    samples: [{
      sourceId: "pubmed:123",
      pmid: "123",
      title: "预检题名",
      abstractSnippet: "预检摘要片段",
      accessLevel: "abstract_only",
      locator: { pmid: "123" },
    }],
    sampleSourceIds: ["pubmed:123"],
  };
  const selection = { ...body, selectionHash: sha256(body) };
  assert.doesNotThrow(() => assertValidQueryPreviewSelection(selection));
  const reordered = structuredClone(selection);
  reordered.sampleSourceIds = ["pubmed:999"];
  assert.throws(
    () => assertValidQueryPreviewSelection(reordered),
    (error) => error.code === "INVALID_QUERY_PREVIEW_SELECTION",
  );
});
