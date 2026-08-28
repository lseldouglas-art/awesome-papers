import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(new URL("..", import.meta.url).pathname);

function listen(server, host = "127.0.0.1") {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      resolveListen(server.address().port);
    });
  });
}

async function availablePort() {
  const probe = createServer();
  const port = await listen(probe);
  await new Promise((resolveClose, reject) =>
    probe.close((error) => (error ? reject(error) : resolveClose())),
  );
  return port;
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function pubmedXml(id) {
  return [
    "<?xml version=\"1.0\"?>",
    "<PubmedArticleSet><PubmedArticle><MedlineCitation>",
    `<PMID>${id}</PMID>`,
    "<Article>",
    `<ArticleTitle>Perioperative sleep and postoperative recovery evidence for ${id}</ArticleTitle>`,
    "<Abstract><AbstractText>This systematic review followed PRISMA and evaluates sleep quality and postoperative recovery. Patient selection biomarkers remain unclear, longer follow-up is needed, and the findings do not establish causality.</AbstractText></Abstract>",
    "<Journal><Title>Local Integration Journal</Title><JournalIssue><PubDate><Year>2026</Year></PubDate></JournalIssue></Journal>",
    "</Article></MedlineCitation><PubmedData><ArticleIdList>",
    `<ArticleId IdType=\"doi\">10.1000/mock.${id}</ArticleId>`,
    "</ArticleIdList></PubmedData></PubmedArticle></PubmedArticleSet>",
  ].join("");
}

function pubmedXmlSet(ids) {
  return ids.map((id) => pubmedXml(id).replace(/^<\?xml version="1\.0"\?>/, "").replace(/^<PubmedArticleSet>|<\/PubmedArticleSet>$/g, "")).join("");
}

async function startMockPubMed() {
  const calls = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    calls.push({ pathname: url.pathname, query: Object.fromEntries(url.searchParams) });
    if (url.pathname.endsWith("/esearch.fcgi")) {
      const term = url.searchParams.get("term") ?? "";
      if (term.includes("service-unavailable")) {
        json(response, 503, { error: "temporary PubMed outage" });
        return;
      }
      if (term.includes("timeout-query")) {
        const timer = setTimeout(() => {
          if (!response.destroyed) json(response, 200, { esearchresult: { count: "1", idlist: ["99999999"] } });
        }, 250);
        response.once("close", () => clearTimeout(timer));
        return;
      }
      if (term.includes("no-result")) {
        json(response, 200, { esearchresult: { count: "0", idlist: [] } });
        return;
      }
      const sameQuerySearchCount = calls.filter(
        (call) => call.pathname.endsWith("/esearch.fcgi") && call.query.term === term,
      ).length;
      if (term.includes("formal-zero") && sameQuerySearchCount >= 2) {
        json(response, 200, { esearchresult: { count: "0", idlist: [] } });
        return;
      }
      const id = term.includes("revised") ? "87654321" : "12345678";
      const count = term.includes(" OR ") ? "23" : "6";
      json(response, 200, { esearchresult: { count, idlist: [id] } });
      return;
    }
    if (url.pathname.endsWith("/efetch.fcgi")) {
      const ids = (url.searchParams.get("id") ?? "12345678").split(",");
      const body = `<?xml version="1.0"?><PubmedArticleSet>${pubmedXmlSet(ids)}</PubmedArticleSet>`;
      response.writeHead(200, {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
      });
      response.end(body);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const port = await listen(server);
  return {
    calls,
    baseUrl: `http://127.0.0.1:${port}/entrez/eutils/`,
    close: () =>
      new Promise((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      ),
  };
}

function waitForExit(child, timeoutMs = 12_000) {
  return new Promise((resolveExit, reject) => {
    if (child.exitCode !== null) {
      resolveExit({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timer = setTimeout(() => {
      reject(new Error(`workbench did not exit within ${timeoutMs} ms`));
    }, timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    });
  });
}

async function startWorkbench({ port, dataDir, staticDir, pubmedBaseUrl }) {
  const child = spawn(process.execPath, ["research-workbench-server.mjs", "--production"], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "test",
      RESEARCH_AGENT_FORCE_MODE: "guided",
      RESEARCH_WORKBENCH_HOST: "127.0.0.1",
      RESEARCH_WORKBENCH_PORT: String(port),
      RESEARCH_WORKBENCH_DATA_DIR: dataDir,
      RESEARCH_WORKBENCH_STATIC_DIR: staticDir,
      RESEARCH_PUBMED_BASE_URL: pubmedBaseUrl,
      RESEARCH_PUBMED_MIN_INTERVAL_MS: "0",
      RESEARCH_PUBMED_RETRY_COUNT: "0",
      RESEARCH_PUBMED_TIMEOUT_MS: "60",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`workbench exited before readiness (${child.exitCode}):\n${output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/research/health`);
      if (response.ok) return { child, baseUrl, output: () => output };
    } catch {
      // The child may still be binding its listener.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  child.kill("SIGTERM");
  throw new Error(`workbench readiness timeout:\n${output}`);
}

async function stopWorkbench(instance) {
  if (!instance || instance.child.exitCode !== null) return { code: instance?.child.exitCode ?? 0 };
  instance.child.kill("SIGTERM");
  return waitForExit(instance.child);
}

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  return { response, body };
}

test("production API traverses mock PubMed, recovery, persistence, and safety boundaries", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "research-workbench-api-data-"));
  const staticDir = await mkdtemp(join(tmpdir(), "research-workbench-api-static-"));
  await mkdir(staticDir, { recursive: true });
  await writeFile(
    join(staticDir, "research-workbench.html"),
    "<!doctype html><title>Research Workbench production test</title>",
    "utf8",
  );
  const mock = await startMockPubMed();
  t.after(() => mock.close());
  const port = await availablePort();
  let workbench = await startWorkbench({ port, dataDir, staticDir, pubmedBaseUrl: mock.baseUrl });
  t.after(async () => {
    await stopWorkbench(workbench);
  });

  const health = await requestJson(workbench.baseUrl, "/api/research/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.status, "ok");
  assert.equal(health.body.delivery, "static-dist-research");
  assert.equal(health.body.pubmedEndpoint, "loopback-test-double");

  const staticPage = await fetch(`${workbench.baseUrl}/research-workbench`);
  assert.equal(staticPage.status, 200);
  assert.match(await staticPage.text(), /Research Workbench production test/);

  const crossOrigin = await requestJson(workbench.baseUrl, "/api/research/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://attacker.invalid" },
    body: JSON.stringify({ title: "恶意请求", question: "这个请求不应被接受。" }),
  });
  assert.equal(crossOrigin.response.status, 403);
  assert.equal(crossOrigin.body.code, "INVALID_ORIGIN");

  const oversized = await requestJson(workbench.baseUrl, "/api/research/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ padding: "x".repeat(256_100) }),
  });
  assert.equal(oversized.response.status, 413);
  assert.equal(oversized.body.code, "REQUEST_TOO_LARGE");

  const pubmedCallsBeforePlanning = mock.calls.length;
  const queryPlan = await requestJson(workbench.baseUrl, "/api/research/query-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "围术期睡眠与术后恢复有什么关系？" }),
  });
  assert.equal(queryPlan.response.status, 200);
  assert.equal(queryPlan.body.schemaVersion, "research-query-plan/v2");
  assert.ok(queryPlan.body.candidates.length >= 3);
  assert.ok(queryPlan.body.methodContract.requiredActions.includes("人工确认"));
  assert.equal(queryPlan.body.promptExecution.status, "baseline_completed");
  assert.match(queryPlan.body.planner.claim, /检索 Agent 已完成专业词群扩展/);
  assert.match(queryPlan.body.promptExecution.boundary, /未调用实时模型/);
  assert.doesNotMatch(JSON.stringify(queryPlan.body), /钟教授|钟澄/);
  assert.equal(mock.calls.length, pubmedCallsBeforePlanning);

  const calibration = await requestJson(workbench.baseUrl, "/api/research/query-calibration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: queryPlan.body.question,
      initialPlanHash: queryPlan.body.planHash,
      selectedCandidateId: queryPlan.body.candidates[0].id,
    }),
  });
  assert.equal(calibration.response.status, 200);
  assert.equal(calibration.body.schemaVersion, "research-query-calibration/v1");
  assert.equal(calibration.body.requestedSampleLimit, 100);
  assert.equal(calibration.body.feedback.sampledCount, 1);
  assert.equal(calibration.body.revision.status, "model_not_configured");
  assert.match(calibration.body.accessBoundary, /未访问全文/);
  assert.equal(
    mock.calls.findLast((call) => call.pathname.endsWith("/esearch.fcgi")).query.retmax,
    "100",
  );

  const preview = await requestJson(workbench.baseUrl, "/api/research/query-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: queryPlan.body.question,
      candidateQueries: calibration.body.revisedPlan.candidates,
      reviewScanCandidateId: calibration.body.revisedPlan.candidates[0].id,
      reviewWindowYears: 5,
      reviewSampleLimit: 20,
      calibrationHash: calibration.body.calibrationHash,
    }),
  });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.candidates.length, calibration.body.revisedPlan.candidates.length);
  assert.ok(preview.body.candidates.every((candidate) => candidate.total === 23));
  assert.ok(preview.body.candidates.every((candidate) => candidate.samples.length === 1));
  assert.equal(preview.body.reviewLandscape.status, "ready");
  assert.equal(preview.body.reviewLandscape.reviewWindow.years, 5);
  assert.equal(preview.body.reviewLandscape.sampledCount, 1);
  assert.equal(preview.body.reviewLandscape.synthesis.schemaVersion, "research-review-synthesis/v1");
  assert.equal(preview.body.reviewLandscape.synthesis.analysisLevel, "title_abstract");
  assert.ok(preview.body.reviewLandscape.synthesis.directionReport);
  assert.ok(Array.isArray(preview.body.reviewLandscape.synthesis.directionReport.directions));
  assert.match(preview.body.reviewLandscape.synthesis.directionReport.boundary, /选题假设/);
  assert.equal(
    preview.body.reviewLandscape.synthesis.professorReport.schemaVersion,
    "research-professor-report/v1",
  );
  assert.ok(Array.isArray(preview.body.reviewLandscape.synthesis.professorReport.studentReviewDirections));
  assert.ok(preview.body.reviewLandscape.synthesis.professorReport.studentReviewDirections.length > 0);
  assert.equal(preview.body.reviewLandscape.synthesis.professorReport.traceability.sourceIds.length, 1);
  assert.match(preview.body.reviewLandscape.synthesis.professorReport.boundary, /题名摘要/);
  assert.equal(preview.body.reviewLandscape.synthesis.sourceAnalyses.length, 1);
  assert.ok(preview.body.reviewLandscape.sources[0].abstractAnalysis);
  assert.match(preview.body.reviewLandscape.query, /review\[Publication Type\]/i);
  assert.match(preview.body.reviewLandscape.stageBrief.evidenceBoundary, /当前排序样本/);
  assert.equal(preview.body.strategyCalibration.calibrationHash, calibration.body.calibrationHash);
  assert.match(preview.body.accessBoundary, /不会建立项目/);
  assert.equal((await requestJson(workbench.baseUrl, "/api/research/projects")).body.length, 0);

  const firstDirection = preview.body.reviewLandscape.synthesis.professorReport.studentReviewDirections[0];
  assert.ok(firstDirection, "the first-round review should expose at least one review-topic proposal");
  assert.match(firstDirection.id, /^review_proposal_/);
  const reportBinding = preview.body.reviewLandscape.researchReport.binding;
  const staleBindings = [
    { ...reportBinding, projectId: "project:wrong" },
    { ...reportBinding, sourceSetHash: "f".repeat(64) },
    { ...reportBinding, reportRevision: reportBinding.reportRevision + 1 },
  ];
  for (const staleBinding of staleBindings) {
    const rejected = await requestJson(workbench.baseUrl, "/api/research/direction-selection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queryPlanHash: preview.body.planHash,
        reportBinding: staleBinding,
        selectedDirectionId: firstDirection.id,
        selectionReason: "这个方向最贴近当前团队能力与待消除的不确定性。",
        deferredReason: "其余方向保留为备选，等待第二轮范围比较。",
      }),
    });
    assert.equal(rejected.response.status, 409);
    assert.equal(rejected.body.code, "STALE_RESEARCH_REPORT_BINDING");
  }
  const directionSelection = await requestJson(workbench.baseUrl, "/api/research/direction-selection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      queryPlanHash: preview.body.planHash,
      reportBinding,
      selectedDirectionId: firstDirection.id,
      selectionReason: "这个方向最贴近当前团队能力与待消除的不确定性。",
      deferredReason: "其余方向保留为备选，等待第二轮范围比较。",
    }),
  });
  assert.equal(directionSelection.response.status, 200);
  assert.match(directionSelection.body.decisionHash, /^[a-f0-9]{64}$/);
  assert.equal(directionSelection.body.selectedBy.kind, "human");
  assert.match(directionSelection.body.narrowedBrief.evidenceBoundary, /第二轮同题综述窄检索假设/);

  const secondPlan = await requestJson(workbench.baseUrl, "/api/research/query-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: directionSelection.body.narrowedBrief.question,
      directionSelectionHash: directionSelection.body.decisionHash,
    }),
  });
  assert.equal(secondPlan.response.status, 200);
  assert.equal(secondPlan.body.directionSeed.decisionHash, directionSelection.body.decisionHash);
  assert.equal(secondPlan.body.candidates[0].query, directionSelection.body.narrowedBrief.suggestedQuery);
  assert.ok(queryPlan.body.mappings.every((sourceMapping) => (
    secondPlan.body.mappings.some((mapping) => mapping.sourceTerm === sourceMapping.sourceTerm)
  )));
  assert.ok(secondPlan.body.mappings.some((mapping) => (
    mapping.conceptId === directionSelection.body.selectedDirection.themeId
    && mapping.role === "selected_direction"
  )));
  assert.ok(secondPlan.body.candidates[0].includedConceptIds.includes(
    directionSelection.body.selectedDirection.themeId,
  ));
  const secondCalibration = await requestJson(workbench.baseUrl, "/api/research/query-calibration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: secondPlan.body.question,
      initialPlanHash: secondPlan.body.planHash,
      selectedCandidateId: secondPlan.body.candidates[0].id,
    }),
  });
  assert.equal(secondCalibration.response.status, 200);
  assert.equal(
    secondCalibration.body.revisedPlan.directionSeed.decisionHash,
    directionSelection.body.decisionHash,
  );
  const editedFocusedCandidates = structuredClone(secondCalibration.body.revisedPlan.candidates);
  editedFocusedCandidates[0].query = queryPlan.body.candidates[0].query;
  const rejectedEditedFocusedPreview = await requestJson(workbench.baseUrl, "/api/research/query-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: secondPlan.body.question,
      candidateQueries: editedFocusedCandidates,
      reviewScanCandidateId: editedFocusedCandidates[0].id,
      reviewWindowYears: 5,
      reviewSampleLimit: 20,
      calibrationHash: secondCalibration.body.calibrationHash,
    }),
  });
  assert.equal(rejectedEditedFocusedPreview.response.status, 409);
  assert.equal(rejectedEditedFocusedPreview.body.code, "SECOND_ROUND_DIRECTION_BINDING_MISMATCH");
  const secondPreview = await requestJson(workbench.baseUrl, "/api/research/query-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: secondPlan.body.question,
      candidateQueries: secondCalibration.body.revisedPlan.candidates,
      reviewScanCandidateId: secondCalibration.body.revisedPlan.candidates[0].id,
      reviewWindowYears: 5,
      reviewSampleLimit: 20,
      calibrationHash: secondCalibration.body.calibrationHash,
    }),
  });
  assert.equal(secondPreview.response.status, 200);
  assert.equal(secondPreview.body.directionBinding.decisionHash, directionSelection.body.decisionHash);
  assert.equal(secondPreview.body.directionBinding.selectedDirectionId, firstDirection.id);
  assert.equal(secondPreview.body.directionBinding.reportHash, reportBinding.reportHash);

  const unboundFocusedPreview = await requestJson(workbench.baseUrl, "/api/research/query-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: secondPlan.body.question,
      candidateQueries: secondCalibration.body.revisedPlan.candidates,
      reviewScanCandidateId: secondCalibration.body.revisedPlan.candidates[0].id,
      reviewWindowYears: 5,
      reviewSampleLimit: 20,
    }),
  });
  assert.equal(unboundFocusedPreview.response.status, 200);
  const rejectedUnboundCreate = await requestJson(workbench.baseUrl, "/api/research/projects", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "reject-unbound-second-round",
    },
    body: JSON.stringify({
      title: "不得绕过方向绑定",
      question: unboundFocusedPreview.body.question,
      researchMode: "live_pubmed",
      searchQuery: unboundFocusedPreview.body.candidates[0].query,
      queryPlanHash: unboundFocusedPreview.body.planHash,
      selectedCandidateId: unboundFocusedPreview.body.candidates[0].id,
      directionSelectionHash: directionSelection.body.decisionHash,
      completionProfileId: "audited_review",
    }),
  });
  assert.equal(rejectedUnboundCreate.response.status, 409);
  assert.equal(rejectedUnboundCreate.body.code, "SECOND_ROUND_DIRECTION_BINDING_MISMATCH");

  const unpreviewedCreate = await requestJson(workbench.baseUrl, "/api/research/projects", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "reject-unpreviewed-live-create",
    },
    body: JSON.stringify({
      title: "不得绕过真实试检",
      question: preview.body.question,
      researchMode: "live_pubmed",
      searchQuery: preview.body.candidates[0].query,
    }),
  });
  assert.equal(unpreviewedCreate.response.status, 409);
  assert.equal(unpreviewedCreate.body.code, "QUERY_PREVIEW_REQUIRED");

  const stalePreviewCreate = await requestJson(workbench.baseUrl, "/api/research/projects", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "reject-edited-query-after-preview",
    },
    body: JSON.stringify({
      title: "检索式改变必须重新试检",
      question: preview.body.question,
      researchMode: "live_pubmed",
      searchQuery: `${preview.body.candidates[0].query} AND humans[MeSH Terms]`,
      queryPlanHash: preview.body.planHash,
      selectedCandidateId: preview.body.candidates[0].id,
    }),
  });
  assert.equal(stalePreviewCreate.response.status, 409);
  assert.equal(stalePreviewCreate.body.code, "QUERY_PREVIEW_STALE");
  assert.equal((await requestJson(workbench.baseUrl, "/api/research/projects")).body.length, 0);

  const invalidProfile = await requestJson(workbench.baseUrl, "/api/research/projects", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "reject-unknown-completion-profile",
    },
    body: JSON.stringify({
      title: "不得使用未知交付目标",
      question: preview.body.question,
      researchMode: "live_pubmed",
      searchQuery: preview.body.candidates[0].query,
      queryPlanHash: preview.body.planHash,
      selectedCandidateId: preview.body.candidates[0].id,
      completionProfileId: "instant_paper",
    }),
  });
  assert.equal(invalidProfile.response.status, 400);
  assert.equal(invalidProfile.body.code, "UNKNOWN_COMPLETION_PROFILE");

  const createRequest = {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "create-mock-live-cut" },
    body: JSON.stringify({
      title: "Mock PubMed 真实纵切",
      question: secondPreview.body.question,
      researchMode: "live_pubmed",
      searchQuery: secondPreview.body.candidates[0].query,
      queryPlanHash: secondPreview.body.planHash,
      selectedCandidateId: secondPreview.body.candidates[0].id,
      directionSelectionHash: directionSelection.body.decisionHash,
      completionProfileId: "audited_review",
    }),
  };
  const selectedQueryCallsBeforeCreate = mock.calls.filter(
    (call) => call.pathname.endsWith("/esearch.fcgi") && call.query.term === secondPreview.body.candidates[0].query,
  ).length;
  const allSearchCallsBeforeCreate = mock.calls.filter(
    (call) => call.pathname.endsWith("/esearch.fcgi"),
  ).length;
  const allFetchCallsBeforeCreate = mock.calls.filter(
    (call) => call.pathname.endsWith("/efetch.fcgi"),
  ).length;
  const [created, duplicateCreated] = await Promise.all([
    requestJson(workbench.baseUrl, "/api/research/projects", createRequest),
    requestJson(workbench.baseUrl, "/api/research/projects", createRequest),
  ]);
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(duplicateCreated.response.status, 201);
  assert.equal(duplicateCreated.body.id, created.body.id);
  assert.equal(created.body.status, "awaiting_gate");
  assert.equal(created.body.completionProfileId, "audited_review");
  assert.equal(created.body.pendingGate.nodeId, "approve_scope");
  assert.equal(created.body.scopingVerification.status, "exploratory_unverified");
  assert.equal(created.body.scopingVerification.verdict, "unknown");
  assert.equal(created.body.scopingVerification.sameTopicReviewOverlapVerified, false);
  assert.equal(created.body.scopingVerification.primaryStudyVolumeVerified, false);
  assert.match(created.body.userBrief.currentResearchPeriod, /问题成形/);
  assert.deepEqual(created.body.userBrief.newConclusions, []);
  assert.match(created.body.userBrief.mainEvidenceAndBoundaries.accessSummary, /综述扫描/);
  assert.match(created.body.userBrief.nextStepOrUserDecision, /需要你确认/);
  assert.equal(created.body.question, directionSelection.body.narrowedBrief.question);
  assert.equal(created.body.queryPreviewSelection.query, secondPreview.body.candidates[0].query);
  assert.equal(created.body.queryPreviewSelection.samples[0].sourceId, "pubmed:12345678");
  assert.equal(created.body.queryPreviewSelection.reviewLandscape.status, "ready");
  assert.equal(created.body.queryPreviewSelection.reviewLandscape.reviewWindow.years, 5);
  assert.equal(created.body.scopingDecision.decisionHash, directionSelection.body.decisionHash);
  assert.equal(created.body.scopingRounds.length, 2);
  assert.deepEqual(
    created.body.scopingRounds.map((round) => round.calibration.sampledCount),
    [1, 1],
  );
  assert.deepEqual(
    created.body.scopingRounds.map((round) => round.reviewLandscape.sampledCount),
    [1, 1],
  );
  assert.equal(created.body.scopingRounds[0].question, preview.body.question);
  assert.equal(created.body.scopingRounds[1].question, secondPreview.body.question);
  assert.equal(created.body.liveRetrieval, null);
  assert.deepEqual(created.body.retrievalRuns, []);
  assert.deepEqual(created.body.sourceMaterials, []);
  assert.match(created.body.contentMaturity.boundary, /建项前预检.*不进入正式文献库/);
  assert.equal(created.body.literatureLandscape.literatureLandscape.sourceCount, 0);
  assert.equal(created.body.researchQualityMetrics.retrieval.stage, "preview_only");
  assert.equal(created.body.researchQualityMetrics.retrieval.savedSources, 0);
  assert.equal(created.body.researchQualityMetrics.retrieval.previewSampleCount, 1);
  assert.match(created.body.researchQualityMetrics.interpretationBoundary, /不是论文质量分/);
  const persistedProjectId = created.body.id;
  assert.equal(
    mock.calls.filter(
      (call) => call.pathname.endsWith("/esearch.fcgi") && call.query.term === secondPreview.body.candidates[0].query,
    ).length - selectedQueryCallsBeforeCreate,
    0,
  );
  assert.equal(
    mock.calls.filter((call) => call.pathname.endsWith("/esearch.fcgi")).length,
    allSearchCallsBeforeCreate,
  );
  assert.equal(
    mock.calls.filter((call) => call.pathname.endsWith("/efetch.fcgi")).length,
    allFetchCallsBeforeCreate,
  );

  const unsignedExport = await requestJson(
    workbench.baseUrl,
    `/api/research/projects/${encodeURIComponent(persistedProjectId)}/exports/manuscript.md`,
  );
  assert.equal(unsignedExport.response.status, 409);
  assert.equal(unsignedExport.body.code, "EXPORT_NOT_READY");

  for (const exportName of ["references.bib", "research-bundle.json", "export-manifest.json"]) {
    const unsigned = await requestJson(
      workbench.baseUrl,
      `/api/research/projects/${encodeURIComponent(persistedProjectId)}/exports/${exportName}`,
    );
    assert.equal(unsigned.response.status, 409);
    assert.equal(unsigned.body.code, "EXPORT_NOT_READY");
  }

  const originalScopeGate = created.body.pendingGate;
  const amendmentReason = "请把问题边界收紧，并在新版研究简报里明确这次退回的范围要求。";
  const amendment = await requestJson(
    workbench.baseUrl,
    `/api/research/projects/${encodeURIComponent(persistedProjectId)}/gates/${encodeURIComponent(originalScopeGate.gateId)}/decision`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: "amendment_requested",
        reason: amendmentReason,
        gateFingerprint: originalScopeGate.gateFingerprint,
      }),
    },
  );
  assert.equal(amendment.response.status, 200, JSON.stringify(amendment.body));
  assert.equal(amendment.body.status, "running");

  let revisedScope = amendment.body;
  const revisedScopeDeadline = Date.now() + 15_000;
  while (Date.now() < revisedScopeDeadline) {
    revisedScope = (
      await requestJson(
        workbench.baseUrl,
        `/api/research/projects/${encodeURIComponent(persistedProjectId)}`,
      )
    ).body;
    if (
      revisedScope.pendingGate?.nodeId === "approve_scope" &&
      revisedScope.pendingGate.gateId !== originalScopeGate.gateId
    ) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  assert.equal(revisedScope.pendingGate?.nodeId, "approve_scope", JSON.stringify(revisedScope));
  assert.notEqual(revisedScope.pendingGate.gateId, originalScopeGate.gateId);
  assert.notEqual(revisedScope.pendingGate.gateFingerprint, originalScopeGate.gateFingerprint);
  const originalScopeVersions = new Map(
    originalScopeGate.artifacts.map((artifact) => [artifact.type, artifact.version]),
  );
  for (const artifact of revisedScope.pendingGate.artifacts) {
    assert.ok(
      artifact.version > (originalScopeVersions.get(artifact.type) ?? 0),
      `${artifact.type} should advance after an amendment`,
    );
  }
  assert.ok(
    revisedScope.decisionTimeline.some(
      (decision) =>
        decision.gateId === originalScopeGate.gateId &&
        decision.decision === "amendment_requested" &&
        decision.reason === amendmentReason,
    ),
  );

  let completed = revisedScope;
  let staleReviewChecked = false;
  for (let turn = 0; turn < 40 && completed.status !== "completed"; turn += 1) {
    if (completed.pendingGate) {
      const decision = await requestJson(
        workbench.baseUrl,
        `/api/research/projects/${encodeURIComponent(persistedProjectId)}/gates/${encodeURIComponent(completed.pendingGate.gateId)}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision: "approved",
            reason: `API 端到端核对并批准 ${completed.pendingGate.userLabel} 的唯一材料版本。`,
            gateFingerprint: completed.pendingGate.gateFingerprint,
          }),
        },
      );
      assert.equal(decision.response.status, 200, JSON.stringify(decision.body));
    } else if (completed.pendingReview) {
      if (!staleReviewChecked) {
        const staleReview = await requestJson(
          workbench.baseUrl,
          `/api/research/projects/${encodeURIComponent(persistedProjectId)}/reviews/${encodeURIComponent(completed.pendingReview.nodeId)}/decision`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              decision: "accepted",
              reason: "这个旧请求没有绑定当前候选版本，因此必须被拒绝。",
              artifactIds: completed.pendingReview.artifacts.map((artifact) => artifact.artifactId),
              materialFingerprint: "0".repeat(64),
            }),
          },
        );
        assert.equal(staleReview.response.status, 409);
        assert.equal(staleReview.body.code, "STALE_REVIEW_MATERIAL");
        staleReviewChecked = true;
      }
      const review = await requestJson(
        workbench.baseUrl,
        `/api/research/projects/${encodeURIComponent(persistedProjectId)}/reviews/${encodeURIComponent(completed.pendingReview.nodeId)}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision: "accepted",
            reason: `API 端到端逐项核对 ${completed.pendingReview.userLabel} 并接受当前版本。`,
            artifactIds: completed.pendingReview.artifacts.map((artifact) => artifact.artifactId),
            materialFingerprint: completed.pendingReview.materialFingerprint,
          }),
        },
      );
      assert.equal(review.response.status, 200, JSON.stringify(review.body));
    } else {
      const run = await requestJson(
        workbench.baseUrl,
        `/api/research/projects/${encodeURIComponent(persistedProjectId)}/run`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      assert.equal(run.response.status, 202, JSON.stringify(run.body));
    }
    const deadline = Date.now() + 15_000;
    do {
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      completed = (
        await requestJson(
          workbench.baseUrl,
          `/api/research/projects/${encodeURIComponent(persistedProjectId)}`,
        )
      ).body;
      if (completed.pendingGate || completed.pendingReview || completed.status === "completed") break;
    } while (Date.now() < deadline);
  }
  assert.equal(completed.status, "completed", JSON.stringify(completed));
  const completedList = await requestJson(workbench.baseUrl, "/api/research/projects");
  const completedListItem = completedList.body.find((item) => item.id === persistedProjectId);
  assert.deepEqual(completedListItem.contentMaturity, completed.contentMaturity);
  assert.equal(completedListItem.status, completed.status);
  assert.deepEqual(
    completed.retrievalRuns.map((run) => run.purpose),
    ["pilot", "orientationCorpus", "focusedCalibration", "focusedCalibration", "finalLibrary"],
  );
  assert.equal(completed.retrievalRuns.at(-1).query, secondPreview.body.candidates[0].query);
  assert.equal(completed.sourceMaterials[0].pmid, "12345678");
  assert.equal(completed.sourceMaterials[0].accessLevel, "abstract_only");
  assert.equal(completed.researchQualityMetrics.retrieval.formalRunCount, 5);
  assert.equal(completed.researchQualityMetrics.retrieval.stage, "final_library");
  assert.equal(completed.literatureLandscape.literatureLandscape.sourceCount, 1);
  assert.match(completed.userBrief.currentResearchPeriod, /文献调研|写作与核查|定稿交付/);
  assert.ok(completed.userBrief.newConclusions.length > 0);
  assert.match(completed.userBrief.newConclusions[0].claim, /只能形成受限的候选判断/);
  assert.match(completed.userBrief.mainEvidenceAndBoundaries.accessSummary, /证据提取记录/);
  assert.ok(completed.userBrief.mainEvidenceAndBoundaries.boundaries.length > 0);
  assert.match(completed.userBrief.nextStepOrUserDecision, /已经完成/);
  assert.equal(
    mock.calls.filter((call) => call.pathname.endsWith("/esearch.fcgi")).length -
      allSearchCallsBeforeCreate,
    5,
  );
  assert.equal(
    mock.calls.filter((call) => call.pathname.endsWith("/efetch.fcgi")).length -
      allFetchCallsBeforeCreate,
    5,
  );

  const references = await fetch(
    `${workbench.baseUrl}/api/research/projects/${encodeURIComponent(persistedProjectId)}/exports/references.bib`,
  );
  assert.equal(references.status, 200);
  const referencesBody = await references.text();
  assert.match(referencesBody, /12345678/);
  const manifestResponse = await fetch(
    `${workbench.baseUrl}/api/research/projects/${encodeURIComponent(persistedProjectId)}/exports/export-manifest.json`,
  );
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json();
  const referencesManifest = manifest.files.find((file) => file.fileName === "references.bib");
  assert.equal(referencesManifest.sha256, references.headers.get("x-content-sha256"));
  assert.equal(referencesManifest.byteLength, Buffer.byteLength(referencesBody));
  const bundleResponse = await fetch(
    `${workbench.baseUrl}/api/research/projects/${encodeURIComponent(persistedProjectId)}/exports/research-bundle.json`,
  );
  assert.equal(bundleResponse.status, 200);
  const bundleBytes = Buffer.from(await bundleResponse.arrayBuffer());
  const bundleManifest = manifest.files.find((file) => file.fileName === "research-bundle.json");
  assert.equal(bundleBytes.byteLength, bundleManifest.byteLength);
  assert.equal(bundleResponse.headers.get("x-content-sha256"), bundleManifest.sha256);
  const restrictedDraft = await fetch(
    `${workbench.baseUrl}/api/research/projects/${encodeURIComponent(persistedProjectId)}/exports/restricted-draft.md`,
  );
  assert.equal(restrictedDraft.status, 200);
  assert.match(await restrictedDraft.text(), /受限草稿/);
  const stillNotFormal = await requestJson(
    workbench.baseUrl,
    `/api/research/projects/${encodeURIComponent(persistedProjectId)}/exports/manuscript.md`,
  );
  assert.equal(stillNotFormal.response.status, 409);
  assert.equal(stillNotFormal.body.code, "EXPORT_NOT_READY");

  const failed = await requestJson(workbench.baseUrl, "/api/research/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "可恢复零结果",
      question: "零结果后能否在同一项目修改检索式？",
      researchMode: "live_pubmed",
      searchQuery: "no-result-query",
      queryPlanHash: (
        await requestJson(workbench.baseUrl, "/api/research/query-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: "零结果后能否在同一项目修改检索式？",
            candidateQueries: [
              { id: "zero-result", query: "no-result-query" },
              { id: "comparison", query: "revised recovery query" },
            ],
          }),
        })
      ).body.planHash,
      selectedCandidateId: "zero-result",
    }),
  });
  assert.equal(failed.response.status, 422);
  assert.equal(failed.body.code, "PUBMED_NO_RESULTS");
  assert.equal(failed.body.recoverable, true);
  assert.equal(failed.body.project.id, failed.body.projectId);
  assert.equal(failed.body.project.status, "paused");

  const retried = await requestJson(
    workbench.baseUrl,
    `/api/research/projects/${encodeURIComponent(failed.body.projectId)}/retry-search`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ searchQuery: "revised recovery query" }),
    },
  );
  assert.equal(retried.response.status, 200);
  assert.equal(retried.body.id, failed.body.projectId);
  assert.equal(retried.body.status, "awaiting_gate");
  assert.equal(retried.body.queryPreviewSelection.query, "revised recovery query");
  assert.equal(retried.body.queryPreviewSelection.samples[0].sourceId, "pubmed:87654321");
  assert.equal(retried.body.liveRetrieval, null);
  assert.deepEqual(retried.body.retrievalRuns, []);
  assert.deepEqual(retried.body.sourceMaterials, []);
  const projects = await requestJson(workbench.baseUrl, "/api/research/projects");
  assert.equal(projects.body.length, 2);

  const formalFailureQuestion = "正式试检零结果后能否修订当前项目的检索协议？";
  const formalFailureQuery = "formal-zero sleep AND recovery";
  const formalRevisionQuery = "sleep OR recovery";
  const formalFailurePreview = await requestJson(workbench.baseUrl, "/api/research/query-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: formalFailureQuestion,
      candidateQueries: [
        { id: "formal-zero", query: formalFailureQuery },
        { id: "comparison", query: formalRevisionQuery },
      ],
    }),
  });
  assert.equal(formalFailurePreview.response.status, 200);
  assert.equal(formalFailurePreview.body.candidates[0].status, "ready");
  const formalFailureCreated = await requestJson(workbench.baseUrl, "/api/research/projects", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "formal-zero-protocol-revision",
    },
    body: JSON.stringify({
      title: "正式零结果协议修订",
      question: formalFailureQuestion,
      researchMode: "live_pubmed",
      searchQuery: formalFailureQuery,
      queryPlanHash: formalFailurePreview.body.planHash,
      selectedCandidateId: "formal-zero",
    }),
  });
  assert.equal(formalFailureCreated.response.status, 201);
  const formalFailureProjectId = formalFailureCreated.body.id;
  const formalScopeDecision = await requestJson(
    workbench.baseUrl,
    `/api/research/projects/${encodeURIComponent(formalFailureProjectId)}/gates/${encodeURIComponent(formalFailureCreated.body.pendingGate.gateId)}/decision`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: "approved",
        reason: "API 测试确认研究范围并允许执行正式 PubMed 试检。",
        gateFingerprint: formalFailureCreated.body.pendingGate.gateFingerprint,
      }),
    },
  );
  assert.equal(formalScopeDecision.response.status, 200);
  let formalBlocked = null;
  const formalBlockedDeadline = Date.now() + 15_000;
  do {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    formalBlocked = (
      await requestJson(
        workbench.baseUrl,
        `/api/research/projects/${encodeURIComponent(formalFailureProjectId)}`,
      )
    ).body;
    if (formalBlocked.status === "blocked") break;
  } while (Date.now() < formalBlockedDeadline);
  assert.equal(formalBlocked.status, "blocked", JSON.stringify(formalBlocked));
  assert.equal(formalBlocked.blocker.code, "PUBMED_NO_RESULTS");
  assert.equal(formalBlocked.blocker.retryClass, "protocol_revision_required");
  assert.equal(formalBlocked.blocker.failedRequest.query, formalFailureQuery);
  assert.equal(formalBlocked.recovery.action, "revise_protocol");
  assert.match(formalBlocked.recovery.safeCheckpoint.message, /已保存/);
  const oldFormalQueryCalls = mock.calls.filter(
    (call) => call.pathname.endsWith("/esearch.fcgi") && call.query.term === formalFailureQuery,
  ).length;
  const forbiddenSameProtocolRetry = await requestJson(
    workbench.baseUrl,
    `/api/research/projects/${encodeURIComponent(formalFailureProjectId)}/resume`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blockerId: formalBlocked.blocker.id,
        reason: "零结果后尝试不改变协议直接重复检索。",
      }),
    },
  );
  assert.equal(forbiddenSameProtocolRetry.response.status, 409);
  assert.equal(
    forbiddenSameProtocolRetry.body.code,
    "RETRIEVAL_PROTOCOL_REVISION_REQUIRED",
  );
  const revisedFormalProtocol = await requestJson(
    workbench.baseUrl,
    `/api/research/projects/${encodeURIComponent(formalFailureProjectId)}/revise-retrieval-protocol`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blockerId: formalBlocked.blocker.id,
        revisedQuery: formalRevisionQuery,
        reason: "正式试检零结果提示原式过窄，因此由研究者加入同义概念并保留原研究范围。",
      }),
    },
  );
  assert.equal(revisedFormalProtocol.response.status, 202, JSON.stringify(revisedFormalProtocol.body));
  let formalRevisionAdvanced = revisedFormalProtocol.body;
  const formalRevisionDeadline = Date.now() + 15_000;
  do {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    formalRevisionAdvanced = (
      await requestJson(
        workbench.baseUrl,
        `/api/research/projects/${encodeURIComponent(formalFailureProjectId)}`,
      )
    ).body;
    if (formalRevisionAdvanced.pendingGate || formalRevisionAdvanced.status === "blocked") break;
  } while (Date.now() < formalRevisionDeadline);
  assert.equal(
    formalRevisionAdvanced.pendingGate?.nodeId,
    "approve_review_angle",
    JSON.stringify(formalRevisionAdvanced),
  );
  assert.equal(formalRevisionAdvanced.retrievalRuns[0].query, formalRevisionQuery);
  assert.equal(
    mock.calls.filter(
      (call) => call.pathname.endsWith("/esearch.fcgi") && call.query.term === formalFailureQuery,
    ).length,
    oldFormalQueryCalls,
    "failed zero-result protocol must not be retried after revision",
  );

  for (const [query, expectedCode] of [
    ["service-unavailable-query", "PUBMED_SEARCH_FAILED"],
    ["timeout-query", "PUBMED_TIMEOUT"],
  ]) {
    const failureQuestion = `当 PubMed ${expectedCode} 时是否保持同一项目并停止？`;
    const failurePreview = await requestJson(workbench.baseUrl, "/api/research/query-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: failureQuestion,
        candidateQueries: [
          { id: "failure-query", query },
          { id: "comparison", query: "revised recovery query" },
        ],
      }),
    });
    const failure = await requestJson(workbench.baseUrl, "/api/research/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `failure-${expectedCode.toLowerCase()}`,
      },
      body: JSON.stringify({
        title: `失败关闭 ${expectedCode}`,
        question: failureQuestion,
        researchMode: "live_pubmed",
        searchQuery: query,
        queryPlanHash: failurePreview.body.planHash,
        selectedCandidateId: "failure-query",
      }),
    });
    assert.equal(failure.response.status, 502);
    assert.equal(failure.body.code, expectedCode);
    assert.equal(failure.body.recoverable, true);
    assert.equal(failure.body.project.id, failure.body.projectId);
    assert.equal(failure.body.project.status, "paused");
    assert.equal(failure.body.project.liveRetrieval, null);
    const falseFormalExport = await requestJson(
      workbench.baseUrl,
      `/api/research/projects/${encodeURIComponent(failure.body.projectId)}/exports/manuscript.md`,
    );
    assert.equal(falseFormalExport.response.status, 409);
    assert.equal(falseFormalExport.body.code, "EXPORT_NOT_READY");
  }

  const firstExit = await stopWorkbench(workbench);
  assert.equal(firstExit.code, 0, workbench.output());
  workbench = await startWorkbench({ port, dataDir, staticDir, pubmedBaseUrl: mock.baseUrl });
  const recovered = await requestJson(
    workbench.baseUrl,
    `/api/research/projects/${encodeURIComponent(persistedProjectId)}`,
  );
  assert.equal(recovered.response.status, 200);
  assert.equal(recovered.body.status, "completed");
  assert.equal(recovered.body.pendingGate, null);
  assert.equal(recovered.body.liveRetrieval.receiptHash, completed.liveRetrieval.receiptHash);
  assert.equal(recovered.body.sourceMaterials[0].sourceSnapshotHash, completed.sourceMaterials[0].sourceSnapshotHash);
});
