import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  PI_RESEARCH_EXTENSION_INFO,
  createResearchExtension,
  createResearchServiceForContext,
  exportProject,
  resumeProject,
  runProject,
  researchDataDir,
} from "./extensions/index.js";
import {
  PI_RESEARCH_CONFIG_SCHEMA,
  normalizeResearchConfig,
} from "./config-schema-v1.js";
import { sha256 } from "./event-engine-v1.js";
import {
  createAuthoritativeExportManifest,
  createAuthorSignoffContents,
} from "./export-authority-v1.js";

const packageRoot = resolve(new URL(".", import.meta.url).pathname);

function researchResult(projectId = "research-test") {
  return {
    project: {
      id: projectId,
      title: "睡眠与恢复",
      question: "术后睡眠与恢复有何关联？",
      researchMode: "live_pubmed",
      searchQuery: "postoperative sleep AND recovery",
      completionProfileId: "audited_review",
      sourceMaterials: [
        {
          id: "pubmed:123",
          provider: "pubmed",
          pmid: "123",
          title: "A title",
          accessLevel: "abstract_only",
          locator: { pmid: "123", url: "https://pubmed.ncbi.nlm.nih.gov/123/" },
          sourceSnapshotHash: "a".repeat(64),
        },
      ],
      retrievalRuns: {
        pilot: {
          purpose: "pilot",
          nodeId: "run_pilot_search",
          protocolArtifactId: "protocol:pilot",
          protocolContentHash: "d".repeat(64),
          queryId: "pilot:query",
          query: "postoperative sleep AND recovery",
          queryHash: "e".repeat(64),
          receipt: {
            provider: "pubmed",
            query: "postoperative sleep AND recovery",
            total: 51,
            executedAt: "2026-08-12T00:00:00.000Z",
            receiptHash: "b".repeat(64),
            records: [{}],
            accessBoundary: "题名与摘要",
          },
        },
      },
    },
    state: {
      completionProfileId: "audited_review",
      revision: 4,
    },
    artifacts: [],
    projection: {
      phase: "问题成形",
      activity: "确认研究问题",
      complete: false,
      boundary: {
        type: "human_gate",
        nodeId: "approve_scope",
        gateId: "gate-1",
        fingerprint: "c".repeat(64),
        inputs: [],
      },
    },
  };
}

function fakePi() {
  const handlers = new Map();
  const tools = [];
  const commands = new Map();
  const entries = [];
  const messages = [];
  return {
    handlers,
    tools,
    commands,
    entries,
    messages,
    on(name, handler) {
      handlers.set(name, handler);
    },
    registerTool(tool) {
      tools.push(tool);
    },
    registerCommand(name, command) {
      commands.set(name, command);
    },
    appendEntry(type, data) {
      entries.push({ type, data });
    },
    sendMessage(message) {
      messages.push(message);
    },
  };
}

function fakeContext(cwd, {
  mode = "print",
  hasUI = false,
  selections = [],
  inputs = [],
  confirms = [],
  entries = [],
} = {}) {
  const notifications = [];
  const statuses = [];
  return {
    cwd,
    mode,
    hasUI,
    model: undefined,
    modelRegistry: undefined,
    signal: undefined,
    notifications,
    statuses,
    sessionManager: { getEntries: () => entries },
    ui: {
      notify(message, type) {
        notifications.push({ message, type });
      },
      setStatus(key, value) {
        statuses.push({ key, value });
      },
      async select() {
        return selections.shift();
      },
      async input() {
        return inputs.shift();
      },
      async confirm() {
        return confirms.shift() ?? false;
      },
    },
  };
}

test("package manifest follows Pi explicit resource and peer-dependency rules", async () => {
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert.equal(manifest.name, "pi-research-workbench");
  assert.equal(manifest.type, "module");
  assert.equal(manifest.engines.node, ">=22.19");
  assert.ok(manifest.keywords.includes("pi-package"));
  assert.deepEqual(manifest.pi, {
    extensions: ["./extensions/index.js"],
    skills: ["./skills/scientific-research"],
    prompts: ["./prompts/*.md"],
  });
  assert.deepEqual(manifest.peerDependencies, {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-agent-core": "*",
    "@earendil-works/pi-coding-agent": "*",
    typebox: "*",
  });
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.exports["./runtime-provenance"], "./agent-run-log-v1.js");
  assert.equal(manifest.bin["research-pi"], "./cli/research-pi.js");
  assert.equal(manifest.scripts.prepublishOnly, "npm run check");
  assert.match(manifest.scripts["pack:check"], /scripts\/pack-check\.mjs/);
  assert.match(await readFile(join(packageRoot, "cli", "research-pi.js"), "utf8"), /^#!\/usr\/bin\/env node/);
});

test("skill and prompts meet Pi discovery contracts", async () => {
  const skill = await readFile(
    join(packageRoot, "skills", "scientific-research", "SKILL.md"),
    "utf8",
  );
  assert.match(skill, /^---\nname: scientific-research\ndescription: .+\n---/);
  assert.match(skill, /awaiting_user_decision/);
  assert.match(skill, /research_query_preview/);
  assert.match(skill, /at least two comparable candidates/);
  assert.match(skill, /Never reuse an old hit count|Never reuse an old hit count/i);
  assert.match(skill, /不得作为正式研究结论|must not be called a completed formal research conclusion/);
  for (const name of ["research-question", "research-pubmed", "research-audit", "research-brief"]) {
    const prompt = await readFile(join(packageRoot, "prompts", `${name}.md`), "utf8");
    assert.match(prompt, /^---\ndescription: .+\n(?:argument-hint: .+\n)?---/);
  }
  const questionPrompt = await readFile(join(packageRoot, "prompts", "research-question.md"), "utf8");
  const pubmedPrompt = await readFile(join(packageRoot, "prompts", "research-pubmed.md"), "utf8");
  assert.match(questionPrompt, /research_query_preview/);
  assert.match(pubmedPrompt, /latest plan hash/);
  assert.match(pubmedPrompt, /do not approve the Gate yourself/);
});

test("default data path is project-local and explicit override is resolved safely", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-research-data-"));
  assert.equal(researchDataDir(cwd, {}), join(cwd, ".pi", "research-workbench-data"));
  assert.equal(researchDataDir(cwd, { PI_RESEARCH_DATA_DIR: "private-research" }), join(cwd, "private-research"));
  assert.equal(
    researchDataDir(cwd, { PI_RESEARCH_DATA_DIR: "/tmp/explicit-research" }),
    "/tmp/explicit-research",
  );
});

test("extension service inherits the active Pi model registry instead of copying OAuth into env", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-research-context-model-"));
  const secret = "pi-oauth-secret-must-stay-in-memory";
  const model = {
    id: "gpt-5.5",
    name: "GPT-5.5",
    provider: "openai-codex",
    api: "openai-codex-responses",
    baseUrl: "https://chatgpt.com/backend-api",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 32000,
  };
  let authCalls = 0;
  const modelRegistry = {
    hasConfiguredAuth(candidate) {
      return candidate === model;
    },
    getProvider() {
      return { streamSimple() { throw new Error("not called by service construction"); } };
    },
    async getApiKeyAndHeaders() {
      authCalls += 1;
      return { ok: true, apiKey: secret };
    },
  };

  const service = await createResearchServiceForContext({ cwd, model, modelRegistry });
  const runtime = service.describeRuntime().agent;

  assert.equal(authCalls, 0);
  assert.equal(runtime.mode, "live");
  assert.equal(runtime.liveConfigured, true);
  assert.equal(runtime.provider, "openai-codex");
  assert.equal(runtime.modelId, "gpt-5.5");
  assert.equal(runtime.runtimeSource, "pi_context");
  assert.equal(JSON.stringify(runtime).includes(secret), false);
});

test("public configuration schema is versioned and never stores API key values", () => {
  assert.equal(PI_RESEARCH_CONFIG_SCHEMA.additionalProperties, false);
  const config = normalizeResearchConfig({
    researcherId: "researcher-1",
    ncbi: { email: "researcher@example.org" },
    agent: { mode: "guided" },
  });
  assert.equal(config.schemaVersion, "1.0.0");
  assert.equal(config.ncbi.apiKeyEnv, "NCBI_API_KEY");
  assert.equal(Object.hasOwn(config.ncbi, "apiKey"), false);
});

test("extension registers controlled tools and keeps human decisions out of Agent tools", async () => {
  const pi = fakePi();
  createResearchExtension({ serviceFactory: async () => ({}) })(pi);
  assert.deepEqual(
    pi.tools.map((tool) => tool.name),
    PI_RESEARCH_EXTENSION_INFO.tools,
  );
  assert.equal(pi.tools.some((tool) => /decide|approve|sign/.test(tool.name)), false);
  assert.deepEqual([...pi.commands.keys()], [
    "research-new",
    "research-status",
    "research-continue",
    "research-resume",
    "research-revise-protocol",
    "research-decide",
    "research-export",
  ]);
});

test("query preview and literature landscape are usable Pi tools without human approval powers", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-research-discovery-tools-"));
  const previewCalls = [];
  const result = researchResult("research-landscape");
  const service = {
    toolGateway: {
      async searchPubMed({ query, limit }) {
        previewCalls.push({ query, limit });
        return {
          provider: "pubmed",
          query,
          total: query.includes(" OR ") ? 40 : 7,
          resultIds: ["123"],
          executedAt: "2026-08-13T00:00:00.000Z",
        };
      },
      async fetchPubMed() {
        return {
          fetchedAt: "2026-08-13T00:00:01.000Z",
          records: result.project.sourceMaterials,
        };
      },
    },
    async getProject() {
      return result;
    },
  };
  const pi = fakePi();
  createResearchExtension({ serviceFactory: async () => service })(pi);
  const ctx = fakeContext(cwd);
  const preview = pi.tools.find((tool) => tool.name === "research_query_preview");
  const previewResult = await preview.execute(
    "call-preview",
    { question: "术后睡眠与恢复之间有什么关系？", sampleLimit: 1 },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(previewCalls.length, 2);
  assert.equal(previewResult.details.candidates.length, 2);

  const landscape = pi.tools.find((tool) => tool.name === "research_literature_landscape");
  const landscapeResult = await landscape.execute(
    "call-landscape",
    { projectId: result.project.id },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(landscapeResult.details.overview.sourceCount, 1);
  assert.equal(landscapeResult.details.decisionLedger.entries.length, 0);
});

test("project list exposes the same retrieval authority and maturity as project detail", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-research-project-list-"));
  const result = researchResult("research-list-authority");
  const service = {
    async listProjects() {
      return [{ id: result.project.id, title: result.project.title }];
    },
    async getProject(projectId) {
      assert.equal(projectId, result.project.id);
      return result;
    },
  };
  const pi = fakePi();
  createResearchExtension({ serviceFactory: async () => service })(pi);
  const tool = pi.tools.find((candidate) => candidate.name === "research_project_list");
  const listed = await tool.execute(
    "call-project-list",
    {},
    undefined,
    undefined,
    fakeContext(cwd),
  );

  assert.equal(listed.details.projects.length, 1);
  assert.equal(listed.details.projects[0].formalResearchComplete, false);
  assert.equal(
    listed.details.projects[0].retrievalAuthority.stage,
    "formal_retrieval_in_progress",
  );
  assert.match(listed.details.projects[0].contentMaturity.boundary, /最终|文献库/);
});

test("Agent create tool persists receipt and returns awaiting_user_decision without approving", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-research-extension-"));
  const calls = [];
  const service = {
    async createProject(input) {
      calls.push(["create", input]);
      return researchResult(input.id);
    },
    async ensureLiveRetrieval({ projectId }) {
      calls.push(["retrieve", projectId]);
      return researchResult(projectId);
    },
    async runUntilBoundary(projectId) {
      calls.push(["run", projectId]);
      return researchResult(projectId);
    },
  };
  const pi = fakePi();
  createResearchExtension({ serviceFactory: async () => service })(pi);
  service.toolGateway = {
    async searchPubMed({ query }) {
      return { query, total: 12, resultIds: ["123"], executedAt: "2026-08-13T00:00:00.000Z" };
    },
    async fetchPubMed() {
      return { fetchedAt: "2026-08-13T00:00:01.000Z", records: researchResult().project.sourceMaterials };
    },
  };
  const ctx = fakeContext(cwd);
  const previewTool = pi.tools.find((candidate) => candidate.name === "research_query_preview");
  const preview = await previewTool.execute(
    "preview-1",
    { question: "术后睡眠与恢复有何关联？", sampleLimit: 1 },
    undefined,
    undefined,
    ctx,
  );
  const selected = preview.details.candidates.find((candidate) => candidate.status === "ready");
  const tool = pi.tools.find((candidate) => candidate.name === "research_project_create");
  const result = await tool.execute(
    "tool-1",
    {
      title: "睡眠与恢复",
      question: "术后睡眠与恢复有何关联？",
      searchQuery: selected.query,
      queryPlanHash: preview.details.planHash,
      selectedCandidateId: selected.id,
    },
    undefined,
    undefined,
    ctx,
  );
  assert.match(result.content[0].text, /awaiting_user_decision/);
  assert.equal(result.details.status, "awaiting_user_decision");
  assert.equal(result.details.boundary.gateId, "gate-1");
  assert.equal(calls.some(([name]) => name === "gateDecision"), false);
  assert.equal(pi.entries.length, 1);
  assert.equal(pi.entries[0].data.receiptHash, "b".repeat(64));
  assert.match(pi.entries[0].data.previewSelectionHash, /^[a-f0-9]{64}$/);
  assert.equal(pi.entries[0].data.queryPlanHash, preview.details.planHash);
  const createInput = calls.find(([name]) => name === "create")[1];
  assert.equal(createInput.queryPreviewSelection.planHash, preview.details.planHash);
  assert.equal(createInput.queryPreviewSelection.candidateId, selected.id);
  assert.equal(createInput.queryPreviewSelection.candidateStatus, "ready");
  assert.match(createInput.queryPreviewSelection.selectionHash, /^[a-f0-9]{64}$/);
  assert.equal(calls.some(([name]) => name === "retrieve"), false);
});

test("Agent create refuses an unpreviewed or edited query before any project mutation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-research-preview-required-"));
  let creates = 0;
  const service = {
    toolGateway: {
      async searchPubMed({ query }) {
        return { query, total: 9, resultIds: ["123"], executedAt: "2026-08-13T00:00:00.000Z" };
      },
      async fetchPubMed() {
        return { fetchedAt: "2026-08-13T00:00:01.000Z", records: researchResult().project.sourceMaterials };
      },
    },
    async createProject() {
      creates += 1;
      return researchResult();
    },
  };
  const pi = fakePi();
  createResearchExtension({ serviceFactory: async () => service })(pi);
  const tool = pi.tools.find((candidate) => candidate.name === "research_project_create");
  await assert.rejects(
    tool.execute(
      "tool-unpreviewed",
      {
        title: "睡眠与恢复",
        question: "术后睡眠与恢复有何关联？",
        searchQuery: "postoperative sleep AND recovery",
        queryPlanHash: "a".repeat(64),
        selectedCandidateId: "focused_terms",
      },
      undefined,
      undefined,
      fakeContext(cwd),
    ),
    (error) => error.code === "QUERY_PREVIEW_REQUIRED",
  );
  const ctx = fakeContext(cwd);
  const previewTool = pi.tools.find((candidate) => candidate.name === "research_query_preview");
  const preview = await previewTool.execute(
    "preview-stale",
    { question: "术后睡眠与恢复有何关联？", sampleLimit: 1 },
    undefined,
    undefined,
    ctx,
  );
  const selected = preview.details.candidates[0];
  await assert.rejects(
    tool.execute(
      "tool-stale",
      {
        title: "睡眠与恢复",
        question: preview.details.question,
        searchQuery: `${selected.query} AND humans[Title/Abstract]`,
        queryPlanHash: preview.details.planHash,
        selectedCandidateId: selected.id,
      },
      undefined,
      undefined,
      ctx,
    ),
    (error) => error.code === "QUERY_PREVIEW_STALE",
  );
  assert.equal(creates, 0);
});

test("interactive research-new previews two candidates and only then creates at a human Gate", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-research-new-preview-"));
  const calls = [];
  const service = {
    toolGateway: {
      async searchPubMed({ query, limit }) {
        calls.push(["preview", query, limit]);
        return {
          query,
          total: query.includes(" OR ") ? 30 : 8,
          resultIds: ["123"],
          executedAt: "2026-08-13T00:00:00.000Z",
        };
      },
      async fetchPubMed() {
        return { fetchedAt: "2026-08-13T00:00:01.000Z", records: researchResult().project.sourceMaterials };
      },
    },
    async createProject(input) {
      calls.push(["create", input]);
      return researchResult(input.id);
    },
    async ensureLiveRetrieval({ projectId }) {
      calls.push(["retrieve", projectId]);
      return researchResult(projectId);
    },
    async runUntilBoundary(projectId) {
      calls.push(["run", projectId]);
      return researchResult(projectId);
    },
  };
  const pi = fakePi();
  createResearchExtension({ serviceFactory: async () => service })(pi);
  const previewLabel = "宽召回版 · PubMed 命中 30 · 样本 1";
  const ctx = fakeContext(cwd, {
    mode: "tui",
    hasUI: true,
    selections: [previewLabel],
    inputs: [
      "术后睡眠与恢复有何关联？",
      "(postoperative[Title/Abstract] OR \"postoperative care\"[Title/Abstract]) AND (sleep[Title/Abstract] OR \"sleep quality\"[Title/Abstract] OR insomnia[Title/Abstract]) AND (recovery[Title/Abstract] OR rehabilitation[Title/Abstract])",
      "睡眠与恢复",
    ],
    confirms: [true],
  });
  await pi.commands.get("research-new").handler("", ctx);
  assert.equal(calls.filter(([name]) => name === "preview").length, 2);
  assert.equal(calls.filter(([name]) => name === "create").length, 1);
  assert.equal(calls.some(([name]) => name === "gateDecision"), false);
  assert.equal(pi.entries[0].data.action, "project_created_by_user");
  assert.match(pi.entries[0].data.queryPlanHash, /^[a-f0-9]{64}$/);
  assert.equal(pi.messages.some((message) => /尚未建项/.test(message.content)), true);
});

test("headless research-decide refuses to write a gate decision", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-research-headless-"));
  let decisions = 0;
  const service = {
    async gateDecision() {
      decisions += 1;
      return researchResult();
    },
  };
  const pi = fakePi();
  createResearchExtension({ serviceFactory: async () => service })(pi);
  const ctx = fakeContext(cwd, {
    entries: [
      {
        type: "custom",
        customType: "pi-research-workbench",
        data: { cwd, projectId: "research-test" },
      },
    ],
  });
  await pi.handlers.get("session_start")({ type: "session_start" }, ctx);
  await pi.commands.get("research-decide").handler("", ctx);
  assert.equal(decisions, 0);
  assert.match(ctx.notifications[0].message, /headless|人工 Gate/);
});

test("interactive research-decide binds exact gate fingerprint and user reason", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-research-human-"));
  let decisionInput = null;
  const service = {
    async getProject() {
      return researchResult();
    },
    async gateDecision(input) {
      decisionInput = input;
      return researchResult();
    },
  };
  const pi = fakePi();
  createResearchExtension({ serviceFactory: async () => service })(pi);
  const ctx = fakeContext(cwd, {
    mode: "tui",
    hasUI: true,
    entries: [
      {
        type: "custom",
        customType: "pi-research-workbench",
        data: { cwd, projectId: "research-test" },
      },
    ],
    selections: ["批准当前版本"],
    inputs: ["已核对研究问题、检索式和摘要级证据边界。"],
    confirms: [true],
  });
  await pi.handlers.get("session_start")({ type: "session_start" }, ctx);
  await pi.commands.get("research-decide").handler("", ctx);
  assert.equal(decisionInput.projectId, "research-test");
  assert.equal(decisionInput.gateId, "gate-1");
  assert.equal(decisionInput.gateFingerprint, "c".repeat(64));
  assert.equal(decisionInput.decision, "approved");
  assert.match(decisionInput.reason, /已核对/);
  assert.equal(decisionInput.actor.kind, "human");
});

test("a frozen protocol query cannot be overwritten while advancing a project", async () => {
  const service = {
    async runUntilBoundary() {
      assert.fail("a direct query override must be rejected before project mutation");
    },
  };
  await assert.rejects(
    runProject(service, "research-retry", 100, undefined, "sleep recovery"),
    (error) => error.code === "REVISED_QUERY_REQUIRES_PROTOCOL_REVISION",
  );
});

test("Pi resume resolves the current blocker and continues the same project", async () => {
  const result = researchResult("research-resume");
  result.projection.boundary = {
    type: "blocked",
    nodeId: "calibrate_focused_search",
    blockers: [{ id: "agent-failed:focused:1", reason: "PubMed 暂时不可用" }],
  };
  const calls = [];
  const service = {
    async getProject(projectId) {
      calls.push(["get", projectId]);
      return result;
    },
    async resumeProject(input) {
      calls.push(["resume", input]);
      return result;
    },
    async runUntilBoundary(projectId, { maxSteps }) {
      calls.push(["run", projectId, maxSteps]);
      return researchResult(projectId);
    },
  };
  const resumed = await resumeProject(
    service,
    "research-resume",
    50,
    undefined,
    "已经检查网络状态并允许按原协议重试。",
  );
  assert.equal(resumed.project.id, "research-resume");
  assert.equal(calls.filter(([kind]) => kind === "resume").length, 1);
  assert.equal(calls.find(([kind]) => kind === "resume")[1].blockerId, "agent-failed:focused:1");
  assert.deepEqual(calls.at(-1), ["run", "research-resume", 50]);
});

test("Pi resume fails closed when the project is not blocked", async () => {
  const service = { async getProject() { return researchResult("research-not-blocked"); } };
  await assert.rejects(
    resumeProject(service, "research-not-blocked", 10, undefined, "已经检查当前状态。"),
    (error) => error.code === "PROJECT_NOT_BLOCKED",
  );
});

test("formal protocol revision is a human-only Pi command and resumes through the revised method", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-research-revise-protocol-"));
  const projectId = "research-revise-protocol";
  const blocked = researchResult(projectId);
  blocked.project.searchQuery = "sleep AND postoperative recovery";
  blocked.projection.boundary = {
    type: "blocked",
    nodeId: "run_pilot_search",
    blockers: [{
      id: "agent-failed:pilot:1",
      code: "PUBMED_NO_RESULTS",
      retryClass: "protocol_revision_required",
      failedRequest: { query: blocked.project.searchQuery },
    }],
  };
  const revisedResult = researchResult(projectId);
  const calls = [];
  const service = {
    async getProject() {
      return blocked;
    },
    async reviseCurrentRetrievalProtocol(input) {
      calls.push(["revise", input]);
      return blocked;
    },
    async runUntilBoundary(id, { maxSteps }) {
      calls.push(["run", id, maxSteps]);
      return revisedResult;
    },
  };
  const pi = fakePi();
  createResearchExtension({ serviceFactory: async () => service })(pi);
  const headless = fakeContext(cwd, {
    entries: [{
      type: "custom",
      customType: "pi-research-workbench",
      data: { cwd, projectId },
    }],
  });
  await pi.handlers.get("session_start")({ type: "session_start" }, headless);
  await pi.commands.get("research-revise-protocol").handler("", headless);
  assert.equal(calls.length, 0);
  assert.match(headless.notifications[0].message, /交互界面|研究者/);

  const interactive = fakeContext(cwd, {
    mode: "tui",
    hasUI: true,
    entries: [{
      type: "custom",
      customType: "pi-research-workbench",
      data: { cwd, projectId },
    }],
    inputs: [
      "(sleep OR sleep quality) AND postoperative recovery",
      "零结果提示原式过窄，增加同义词但保持研究边界。",
    ],
    confirms: [true],
  });
  await pi.handlers.get("session_start")({ type: "session_start" }, interactive);
  await pi.commands.get("research-revise-protocol").handler("", interactive);
  assert.equal(calls[0][0], "revise");
  assert.equal(calls[0][1].projectId, projectId);
  assert.equal(calls[0][1].actor.kind, "human");
  assert.equal(calls[0][1].blockerId, "agent-failed:pilot:1");
  assert.equal(calls[0][1].explicitRevision, false);
  assert.deepEqual(calls[1], ["run", projectId, 100]);
  assert.equal(
    pi.tools.some((tool) => /revise.*protocol|protocol.*revise/.test(tool.name)),
    false,
  );
});

test("Pi export fails closed until a content-verified ExportManifest is author-signed", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-research-export-"));
  const result = researchResult("research-export");
  const service = {
    async getProject() {
      return result;
    },
    describeRuntime() {
      return { agent: { mode: "guided" } };
    },
  };
  await assert.rejects(
    exportProject(service, "research-export", "bibtex", cwd),
    (error) => error.code === "EXPORT_NOT_SIGNED",
  );
});

test("Pi BibTeX export writes the exact author-signed manifest bytes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-research-signed-export-"));
  const result = researchResult("research-signed-export");
  result.projection.boundary = { type: "complete" };
  result.project.retrievalRuns.finalLibrary = {
    purpose: "finalLibrary",
    nodeId: "freeze_library",
    receipt: { receiptHash: "9".repeat(64), records: result.project.sourceMaterials },
  };
  result.runtimeProvenance = {
    source: "agent_run_hash_chain",
    projectId: result.project.id,
    formalEligible: true,
  };
  const audited = {
    id: "audited-1",
    type: "AuditedManuscript",
    version: 1,
    contentHash: "d".repeat(64),
    content: {
      title: "Signed manuscript",
      abstract: "Bounded abstract.",
      conclusion: "Bounded conclusion.",
      sections: [],
      disclosedLimitations: ["Abstract only."],
    },
  };
  const delivery = {
    id: "delivery-1",
    type: "DeliveryBundle",
    version: 1,
    contentHash: "e".repeat(64),
    content: {},
  };
  const libraryManifest = {
    id: "library-1",
    type: "LibraryManifest",
    version: 1,
    contentHash: null,
    freshness: "current",
    content: {
      retrievalRunPurpose: "finalLibrary",
      protocolArtifactId: "frozen-search-1",
      protocolContentHash: "8".repeat(64),
      queryId: "focused:core",
      query: "postoperative sleep AND recovery",
      queryHash: sha256("postoperative sleep AND recovery"),
      retrievalReceiptHash: "9".repeat(64),
      sourceCount: 1,
      sourceIds: [result.project.sourceMaterials[0].id],
    },
  };
  libraryManifest.contentHash = sha256(libraryManifest.content);
  result.project.retrievalRuns.finalLibrary.protocolArtifactId =
    libraryManifest.content.protocolArtifactId;
  result.project.retrievalRuns.finalLibrary.protocolContentHash =
    libraryManifest.content.protocolContentHash;
  result.project.retrievalRuns.finalLibrary.queryId = libraryManifest.content.queryId;
  result.project.retrievalRuns.finalLibrary.query = libraryManifest.content.query;
  result.project.retrievalRuns.finalLibrary.queryHash = libraryManifest.content.queryHash;
  const manifestContent = createAuthoritativeExportManifest({
    id: "manifest-1",
    version: 1,
    project: result.project,
    artifacts: [libraryManifest, audited],
    deliveryBundleId: delivery.id,
    generatedAt: "2026-08-13T01:00:00.000Z",
  });
  const manifest = {
    id: "manifest-1",
    type: "ExportManifest",
    version: 1,
    status: "accepted",
    freshness: "current",
    contentHash: sha256(manifestContent),
    content: manifestContent,
  };
  const signoff = createAuthorSignoffContents({
    manifestArtifact: manifest,
    deliveryBundleArtifact: delivery,
    humanActor: { id: "author", role: "author", kind: "human" },
    gate: { id: "gate-1", fingerprint: "f".repeat(64) },
    reason: "作者核对并签署这些唯一字节。",
    decidedAt: "2026-08-13T02:00:00.000Z",
    authorApprovalId: "approval-1",
    signedDeliveryId: "signed-1",
  });
  result.artifacts = [
    libraryManifest,
    audited,
    delivery,
    manifest,
    {
      id: "approval-1",
      type: "AuthorApproval",
      version: 1,
      status: "accepted",
      freshness: "current",
      contentHash: sha256(signoff.authorApproval),
      content: signoff.authorApproval,
    },
    {
      id: "signed-1",
      type: "SignedDelivery",
      version: 1,
      status: "accepted",
      freshness: "current",
      contentHash: sha256(signoff.signedDelivery),
      content: signoff.signedDelivery,
    },
  ];
  const service = { async getProject() { return result; } };
  const exported = await exportProject(
    service,
    "research-signed-export",
    "bibtex",
    cwd,
  );
  const bytes = await readFile(exported.path);
  const signedFile = manifestContent.files.find((file) => file.fileName === "references.bib");
  assert.deepEqual(bytes, Buffer.from(signedFile.contentBase64, "base64"));
  assert.equal(exported.sha256, signedFile.sha256);
});

test("export rejects project ids that could escape the research data directory", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-research-export-path-"));
  let reads = 0;
  const service = {
    async getProject() {
      reads += 1;
      return researchResult();
    },
  };
  await assert.rejects(
    exportProject(service, "../../outside", "json", cwd),
    (error) => error.code === "INVALID_PROJECT_ID",
  );
  assert.equal(reads, 0);
});
