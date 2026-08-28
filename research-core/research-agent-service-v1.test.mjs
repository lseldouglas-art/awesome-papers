import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PiRuntimeAdapter } from "./pi-runtime-adapter-v1.js";
import {
  createGuidedCandidates,
  createGuidedReviewCandidate,
} from "./research-agent-work-order-v1.js";
import { ResearchAgentServiceV1 } from "./research-agent-service-v1.js";
import {
  EXECUTION_STATES,
  REVIEW_RESEARCH_MACHINE_V1,
} from "./review-research-machine-v1.js";
import { sha256 } from "./event-engine-v1.js";

const owner = {
  id: "integration-researcher",
  role: "human_researcher",
  kind: "human",
};

function monotonicClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 7, 12, 3, 0, tick++));
}

function guidedRuntime() {
  return new PiRuntimeAdapter({
    gateway: {},
    forceMode: "guided",
  });
}

function projectInput(id, completionProfileId = "evidence_brief") {
  return {
    id,
    title: "科研 Agent 服务集成测试",
    question: "当前可见证据能支持什么受限判断？",
    completionProfileId,
    owner,
    constraints: ["摘要未报告的信息保持未知"],
    sourceMaterials: [
      {
        id: "source-1",
        title: "A bounded abstract snapshot",
        text: "This abstract reports a bounded association and no causal conclusion.",
        accessLevel: "abstract_only",
        locator: { pmid: "12345678" },
      },
    ],
  };
}

async function prepareCurrentPilotNode(service, projectId) {
  const pending = await service.runUntilBoundary(projectId);
  assert.equal(pending.projection.boundary.nodeId, "approve_scope");
  await service.gateDecision({
    projectId,
    actor: owner,
    decision: "approved",
    reason: "测试研究者确认问题与范围。",
    gateFingerprint: pending.projection.boundary.fingerprint,
  });
  await service.runUntilBoundary(projectId, { maxSteps: 2 });
  return service.getProject(projectId);
}

function queryPreviewSelection({
  question,
  query,
  candidateStatus = "ready",
  suffix = "ready",
  sampleSourceId = null,
  pmid = null,
} = {}) {
  const resolvedPmid = pmid ?? (suffix === "ready" ? "24681012" : null);
  const sample = {
    sourceId: sampleSourceId ?? `pubmed:preview:${suffix}`,
    pmid: resolvedPmid,
    title: "预检样本文献",
    abstractSnippet: "仅用于定题预检，不进入正式证据库。",
    accessLevel: "abstract_only",
    locator: { pmid: resolvedPmid },
  };
  const body = {
    schemaVersion: "research-query-preview-selection/v1",
    planHash: sha256({ question, candidateId: `candidate:${suffix}` }),
    candidateId: `candidate:${suffix}`,
    candidateStatus,
    question,
    query,
    total: candidateStatus === "failed" ? null : 1,
    executedAt: candidateStatus === "failed" ? null : "2026-08-12T08:00:00.000Z",
    samples: candidateStatus === "failed" ? [] : [sample],
    sampleSourceIds: candidateStatus === "failed" ? [] : [sample.sourceId],
    subjectConcepts: [{
      conceptId: "subject:test-query",
      sourceTerm: "测试研究对象",
      role: "core_entity",
      mappedTerms: [...new Set([
        ...(String(query ?? "")
          .replace(/\[[^\]]+\]/g, " ")
          .match(/[A-Za-z][A-Za-z-]{3,}/g) ?? []),
        "bounded",
      ])].filter((term) => !["AND", "OR", "NOT"].includes(term.toUpperCase())),
      meshTerms: [],
    }],
    ...(candidateStatus === "failed"
      ? { error: { code: "PREVIEW_TIMEOUT", message: "预检暂时失败。" } }
      : {}),
  };
  return { ...body, selectionHash: sha256(body) };
}

function machineWithHumanReview() {
  const capture = structuredClone(
    REVIEW_RESEARCH_MACHINE_V1.nodes.find((node) => node.id === "capture_intent"),
  );
  const manualNode = {
    id: "human_reviewed_work",
    kind: "work",
    phaseId: "question_formation",
    userLabel: "形成人工复核对象",
    userStatus: "等待研究者核查候选范围",
    purpose: "生成一个必须由真实研究者复核的范围对象。",
    inputs: ["ResearchIntent@1"],
    outputs: ["ScopeBoundary@1"],
    acceptanceCriteria: ["范围边界明确", "未知信息没有被补写"],
    executorRole: "scope_modeler",
    reviewerRole: "human_researcher",
    insufficientEvidenceAction: "退回修订",
  };
  return {
    ...structuredClone(REVIEW_RESEARCH_MACHINE_V1),
    id: "human-review-integration-machine",
    nodes: [capture, manualNode],
    edges: [
      {
        id: "capture-to-human-review",
        source: capture.id,
        target: manualNode.id,
        type: "hard_dependency",
      },
    ],
    completionProfiles: [
      {
        id: "manual_review_test",
        userLabel: "完成人工复核测试",
        terminalNodeId: manualNode.id,
      },
    ],
  };
}

class PausableGuidedRuntime {
  constructor() {
    this.waiting = null;
    this.releaseWaiting = null;
    this.blockNextExecution = true;
  }

  describeRuntime() {
    return { mode: "guided" };
  }

  async execute(workOrder, { signal } = {}) {
    if (workOrder.id.startsWith("review-order:")) {
      return {
        candidates: [
          createGuidedReviewCandidate({
            reviewOrder: workOrder,
            targetArtifacts: workOrder.inputArtifacts,
          }),
        ],
        runtime: { mode: "guided" },
      };
    }
    if (this.blockNextExecution) {
      this.blockNextExecution = false;
      this.waiting = new Promise((resolve) => {
        this.releaseWaiting = resolve;
      });
      await new Promise((resolve, reject) => {
        const onAbort = () => {
          const error = new Error("guided execution aborted");
          error.code = "AGENT_ABORTED";
          reject(error);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        this.waiting.then(resolve, reject);
      });
    }
    return {
      candidates: createGuidedCandidates(workOrder),
      runtime: { mode: "guided" },
    };
  }

  abort() {}
}

class CapturingGuidedRuntime {
  constructor() {
    this.delegate = guidedRuntime();
    this.workOrders = [];
  }

  describeRuntime() {
    return this.delegate.describeRuntime();
  }

  async execute(workOrder, options) {
    this.workOrders.push(structuredClone(workOrder));
    return this.delegate.execute(workOrder, options);
  }

  abort(workOrderId) {
    return this.delegate.abort?.(workOrderId);
  }
}

test("an amendment atomically returns to the declared work node and creates a new gate fingerprint", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "research-agent-service-amendment-"));
  const projectId = "agent-service-amendment";
  const runtime = new CapturingGuidedRuntime();
  const service = new ResearchAgentServiceV1({
    dataDir,
    piRuntimeAdapter: runtime,
    now: monotonicClock(),
  });
  await service.createProject(projectInput(projectId));
  const firstGate = await service.runUntilBoundary(projectId);
  const oldGateId = firstGate.projection.boundary.gateId;
  const oldFingerprint = firstGate.projection.boundary.fingerprint;
  const oldInputs = firstGate.projection.boundary.inputs.map((artifact) => ({
    id: artifact.id,
    version: artifact.version,
  }));
  const reason = "请把问题进一步限定到摘要层级可验证的研究对象、比较项和结局。";

  const amended = await service.gateDecision({
    projectId,
    actor: owner,
    decision: "amendment_requested",
    reason,
    gateFingerprint: oldFingerprint,
  });
  const correction = amended.state.corrections.at(-1);
  assert.equal(amended.state.gates[oldGateId].status, "amendment_requested");
  assert.equal(correction.sourceGateId, oldGateId);
  assert.equal(correction.sourceGateFingerprint, oldFingerprint);
  assert.equal(correction.amendmentTargetNodeId, "clarify_question");
  assert.equal(correction.reason, reason);
  assert.equal(amended.state.focusNodeId, "clarify_question");
  assert.equal(amended.state.nodeExecutions.clarify_question.state, EXECUTION_STATES.REVISION);
  assert.equal(amended.state.nodeExecutions.clarify_question.staleByCorrectionId, correction.id);
  for (const input of oldInputs) {
    assert.equal(amended.state.artifacts[input.id].freshness, "stale");
  }

  const secondGate = await service.runUntilBoundary(projectId);
  assert.equal(secondGate.projection.boundary.nodeId, "approve_scope");
  assert.notEqual(secondGate.projection.boundary.gateId, oldGateId);
  assert.notEqual(secondGate.projection.boundary.fingerprint, oldFingerprint);
  assert.deepEqual(
    secondGate.projection.boundary.inputs.map((artifact) => artifact.version),
    oldInputs.map((artifact) => artifact.version + 1),
  );
  const revisionOrder = runtime.workOrders
    .filter(
      (order) =>
        order.nodeId === "clarify_question" &&
        !order.id.startsWith("review-order:"),
    )
    .at(-1);
  assert.equal(revisionOrder.revisionRequest.reason, reason);
  assert.equal(revisionOrder.revisionRequest.correctionId, correction.id);
  assert.equal(revisionOrder.revisionRequest.sourceGateId, oldGateId);

  const restarted = new ResearchAgentServiceV1({
    dataDir,
    piRuntimeAdapter: guidedRuntime(),
  });
  const recovered = await restarted.getProject(projectId);
  assert.equal(recovered.projection.boundary.gateId, secondGate.projection.boundary.gateId);
  assert.equal(recovered.projection.boundary.fingerprint, secondGate.projection.boundary.fingerprint);
});

test("persists capture_intent, reaches a human gate, and recovers it after restart", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "research-agent-service-restart-"));
  const projectId = "agent-service-restart";
  const first = new ResearchAgentServiceV1({
    dataDir,
    piRuntimeAdapter: guidedRuntime(),
    now: monotonicClock(),
  });

  const created = await first.createProject(projectInput(projectId));
  assert.equal(
    created.state.nodeExecutions.capture_intent.state,
    EXECUTION_STATES.ACCEPTED,
  );
  assert.equal(created.project.question, projectInput(projectId).question);
  assert.equal(
    created.artifacts.find((artifact) => artifact.type === "ResearchIntent")
      .content.projectSnapshot.sourceMaterials[0].text,
    projectInput(projectId).sourceMaterials[0].text,
  );

  const pending = await first.runUntilBoundary(projectId);
  assert.equal(pending.projection.boundary.type, "human_gate");
  assert.equal(pending.projection.boundary.nodeId, "approve_scope");
  assert.equal(pending.projection.needsUserDecision, true);
  assert.ok(Object.keys(pending.agentRunStatus.workOrders).length >= 2);
  assert.ok(Object.keys(pending.agentRunStatus.runs).length >= 2);
  assert.ok(Object.keys(pending.agentRunStatus.toolCalls).length >= 4);
  assert.equal(pending.agentRunStatus.activeRunIds.length, 0);
  assert.equal(pending.runtimeProvenance.formalEligible, false);
  assert.equal(
    pending.runtimeProvenance.receiptCount,
    Object.keys(pending.agentRunStatus.runs).length,
  );
  assert.ok(
    pending.runtimeProvenance.receipts.every(
      (receipt) => receipt.invocationClass === "guided_faux",
    ),
  );
  assert.equal(first.describeRuntime().service, "ResearchAgentServiceV1");

  const switchedToLiveConfiguration = new ResearchAgentServiceV1({
    dataDir,
    piRuntimeAdapter: {
      describeRuntime() {
        return {
          mode: "live",
          liveConfigured: true,
          provider: "openai",
          modelId: "gpt-5-mini",
        };
      },
      async execute() {
        throw new Error("historical provenance lookup must not invoke current runtime");
      },
    },
    now: monotonicClock(),
  });
  const afterConfigurationSwitch = await switchedToLiveConfiguration.getProject(projectId);
  assert.equal(afterConfigurationSwitch.runtimeProvenance.formalEligible, false);
  assert.ok(
    afterConfigurationSwitch.runtimeProvenance.blockers.some(
      (blocker) => blocker.code === "agent_run_not_live_provider",
    ),
  );

  const restarted = new ResearchAgentServiceV1({
    dataDir,
    piRuntimeAdapter: guidedRuntime(),
    now: monotonicClock(),
  });
  const recovered = await restarted.getProject(projectId);
  assert.equal(recovered.projection.boundary.gateId, pending.projection.boundary.gateId);
  assert.equal(recovered.agentRunStatus.version, pending.agentRunStatus.version);
  assert.deepEqual(
    Object.keys(recovered.agentRunStatus.workOrders),
    Object.keys(pending.agentRunStatus.workOrders),
  );
  assert.deepEqual(
    recovered.projection.boundary.inputs.map((artifact) => artifact.content),
    pending.projection.boundary.inputs.map((artifact) => artifact.content),
  );
  const indexed = await restarted.listProjects();
  assert.equal(indexed.length, 1);
  assert.equal(indexed[0].id, projectId);
  assert.equal(indexed[0].boundary.type, "human_gate");
  assert.equal(
    (await restarted.getProjectRuntimeProvenance(projectId)).formalEligible,
    false,
  );

  const decided = await restarted.gateDecision({
    projectId,
    actor: owner,
    decision: "approved",
    reason: "研究者确认当前问题与范围边界。",
    gateFingerprint: recovered.projection.boundary.fingerprint,
  });
  assert.equal(
    decided.state.nodeExecutions.approve_scope.state,
    EXECUTION_STATES.ACCEPTED,
  );
  assert.ok(
    decided.artifacts.some(
      (artifact) => artifact.type === "ResearchBrief" && artifact.content.gateId,
    ),
  );
});

test("stops at a declared human reviewer and accepts only through manualReview", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "research-agent-service-review-"));
  const machine = machineWithHumanReview();
  const service = new ResearchAgentServiceV1({
    dataDir,
    machine,
    piRuntimeAdapter: guidedRuntime(),
    now: monotonicClock(),
  });
  const projectId = "agent-service-human-review";
  await service.createProject(projectInput(projectId, "manual_review_test"));

  const waiting = await service.runUntilBoundary(projectId);
  assert.equal(waiting.projection.boundary.type, "human_review");
  assert.equal(waiting.projection.boundary.nodeId, "human_reviewed_work");
  assert.equal(
    waiting.state.nodeExecutions.human_reviewed_work.state,
    EXECUTION_STATES.REVIEW,
  );

  const accepted = await service.manualReview({
    projectId,
    nodeId: "human_reviewed_work",
    actor: owner,
    decision: "accepted",
    reason: "研究者逐项确认范围边界与未知项表达。",
  });
  assert.equal(accepted.projection.boundary.type, "complete");
  assert.equal(
    accepted.state.nodeExecutions.human_reviewed_work.state,
    EXECUTION_STATES.ACCEPTED,
  );
});

test("pause releases active work, resume can retry, and cancel is authoritative", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "research-agent-service-control-"));
  const machine = machineWithHumanReview();
  machine.nodes[1].reviewerRole = "scope_reviewer";
  const runtime = new PausableGuidedRuntime();
  const service = new ResearchAgentServiceV1({
    dataDir,
    machine,
    piRuntimeAdapter: runtime,
    now: monotonicClock(),
  });
  const projectId = "agent-service-pause-resume";
  await service.createProject(projectInput(projectId, "manual_review_test"));

  const running = service.runUntilBoundary(projectId);
  while (!runtime.waiting) await new Promise((resolve) => setImmediate(resolve));
  const paused = await service.pauseProject({
    projectId,
    nodeId: "human_reviewed_work",
    actor: owner,
    reason: "研究者暂停检查输入。",
  });
  assert.equal(paused.projection.boundary.type, "blocked");
  const interrupted = await running;
  assert.equal(interrupted.projection.boundary.type, "blocked");
  const releasedLease = Object.values(interrupted.state.workLeases).at(-1);
  assert.equal(releasedLease.status, "released");

  const resumed = await service.resumeProject({
    projectId,
    nodeId: "human_reviewed_work",
    blockerId: paused.blockerId,
    actor: owner,
    resolution: "输入已检查，可以重新执行。",
  });
  assert.equal(
    resumed.state.nodeExecutions.human_reviewed_work.state,
    EXECUTION_STATES.READY,
  );
  const completed = await service.runUntilBoundary(projectId);
  assert.equal(completed.projection.boundary.type, "complete");

  const cancelProjectId = "agent-service-cancel";
  await service.createProject(projectInput(cancelProjectId, "manual_review_test"));
  const cancelled = await service.cancelNode({
    projectId: cancelProjectId,
    nodeId: "human_reviewed_work",
    actor: owner,
    reason: "研究者终止该测试路径。",
  });
  assert.equal(cancelled.projection.boundary.type, "cancelled");
  assert.equal(
    cancelled.state.nodeExecutions.human_reviewed_work.state,
    EXECUTION_STATES.CANCELLED,
  );
});

test("formal PubMed retrieval runs are protocol-bound, multi-round, and restart-idempotent", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "research-agent-service-live-retrieval-"));
  let searches = 0;
  const rawRecord = {
    sourceId: "pubmed:12345678",
    provider: "pubmed",
    pmid: "12345678",
    doi: "10.1000/example",
    title: "Sleep and postoperative recovery",
    abstract: "The abstract reports a bounded association and no causal conclusion.",
    journal: "Example Journal",
    year: "2025",
    accessLevel: "abstract_only",
    locator: {
      pmid: "12345678",
      doi: "10.1000/example",
      url: "https://pubmed.ncbi.nlm.nih.gov/12345678/",
    },
  };
  const offTopicRecord = {
    sourceId: "pubmed:87654321",
    provider: "pubmed",
    pmid: "87654321",
    title: "An unrelated orthopedic rehabilitation review",
    abstract: "This review evaluates mobility after joint replacement.",
    journal: "Other Journal",
    year: "2025",
    accessLevel: "abstract_only",
    locator: {
      pmid: "87654321",
      url: "https://pubmed.ncbi.nlm.nih.gov/87654321/",
    },
  };
  const gateway = {
    async searchPubMed({ query }) {
      searches += 1;
      return {
        provider: "pubmed",
        query,
        executedAt: "2026-08-12T08:00:00.000Z",
        total: 2,
        resultIds: ["12345678", "87654321"],
      };
    },
    async fetchPubMed() {
      return {
        provider: "pubmed",
        fetchedAt: "2026-08-12T08:00:01.000Z",
        records: [
          { ...rawRecord, sourceSnapshotHash: sha256(rawRecord) },
          { ...offTopicRecord, sourceSnapshotHash: sha256(offTopicRecord) },
        ],
        accessBoundary: "本轮只访问 PubMed 题录与摘要。",
      };
    },
  };
  const projectId = "agent-service-live-retrieval";
  const first = new ResearchAgentServiceV1({
    dataDir,
    toolGateway: gateway,
    piRuntimeAdapter: new PiRuntimeAdapter({ gateway, forceMode: "guided" }),
  });
  await first.createProject({
    id: projectId,
    title: "真实 PubMed 检索测试",
    question: "术后睡眠与恢复之间有什么关系？",
    completionProfileId: "audited_review",
    owner,
    researchMode: "live_pubmed",
    searchQuery: "sleep AND postoperative recovery",
    queryPreviewSelection: queryPreviewSelection({
      question: "术后睡眠与恢复之间有什么关系？",
      query: "sleep AND postoperative recovery",
      suffix: "12345678",
      sampleSourceId: "pubmed:12345678",
      pmid: "12345678",
    }),
    sourceMaterials: [],
  });

  const scopeGate = await first.runUntilBoundary(projectId);
  assert.equal(scopeGate.projection.boundary.nodeId, "approve_scope");
  assert.equal(searches, 0, "pre-project preview and scope work cannot satisfy or trigger pilot retrieval");
  await first.gateDecision({
    projectId,
    actor: owner,
    decision: "approved",
    reason: "研究者批准问题范围并允许执行正式检索。",
    gateFingerprint: scopeGate.projection.boundary.fingerprint,
  });
  const angleGate = await first.runUntilBoundary(projectId);
  assert.equal(
    angleGate.projection.boundary.nodeId,
    "approve_review_angle",
    JSON.stringify(angleGate.projection.boundary),
  );
  assert.equal(searches, 2, "pilot and orientation corpus must execute separately");
  assert.equal(angleGate.project.retrievalRuns.pilot.purpose, "pilot");
  assert.equal(
    angleGate.project.retrievalRuns.orientationCorpus.purpose,
    "orientationCorpus",
  );
  assert.notEqual(
    angleGate.project.retrievalRuns.pilot.protocolArtifactId,
    angleGate.project.retrievalRuns.orientationCorpus.protocolArtifactId,
  );
  assert.equal(angleGate.project.liveRetrieval, null);
  assert.equal(angleGate.project.sourceMaterials[0].locator.pmid, "12345678");
  assert.match(angleGate.project.sourceMaterials[0].text, /bounded association/);

  const restarted = new ResearchAgentServiceV1({
    dataDir,
    toolGateway: gateway,
    piRuntimeAdapter: new PiRuntimeAdapter({ gateway, forceMode: "guided" }),
  });
  const recoveredAngleGate = await restarted.runUntilBoundary(projectId);
  assert.equal(recoveredAngleGate.projection.boundary.nodeId, "approve_review_angle");
  assert.equal(searches, 2, "restarting at the same human boundary must not repeat retrieval");
  await restarted.gateDecision({
    projectId,
    actor: owner,
    decision: "approved",
    reason: "研究者选定证据支持的深挖方向。",
    gateFingerprint: recoveredAngleGate.projection.boundary.fingerprint,
  });
  const nextGate = await restarted.runUntilBoundary(projectId);
  assert.equal(nextGate.projection.boundary.type, "human_gate");
  assert.ok(searches >= 5, "two focused variants and the final library must execute after orientation");
  assert.equal(nextGate.project.retrievalRuns.focusedCalibration.length, 2);
  assert.equal(nextGate.project.retrievalRuns.finalLibrary.purpose, "finalLibrary");
  assert.equal(nextGate.project.retrievalRuns.finalLibrary.receipt.records.length, 2);
  assert.equal(nextGate.project.sourceMaterials.length, 1);
  assert.equal(nextGate.project.sourceMaterials[0].id, "pubmed:12345678");
  assert.equal(nextGate.project.finalLibraryScreening.retrievedCount, 2);
  assert.equal(nextGate.project.finalLibraryScreening.acceptedCount, 1);
  assert.equal(nextGate.project.finalLibraryScreening.excludedCount, 1);
  assert.deepEqual(
    nextGate.project.finalLibraryScreening.exclusions.map((item) => item.sourceId),
    ["pubmed:87654321"],
  );
  assert.equal(nextGate.project.sourceSetHash, nextGate.project.researchReport.binding.sourceSetHash);
  assert.equal(nextGate.project.researchReport.ledger.rowCount, 2);
  assert.equal(nextGate.project.researchReport.ledger.analyzedRowCount, 1);
  assert.ok(nextGate.artifacts
    .filter((artifact) => artifact.type === "EvidenceRecord")
    .every((artifact) => artifact.content.sourceId !== "pubmed:87654321"));
  const purposes = [
    nextGate.project.retrievalRuns.pilot,
    nextGate.project.retrievalRuns.orientationCorpus,
    ...nextGate.project.retrievalRuns.focusedCalibration,
    nextGate.project.retrievalRuns.finalLibrary,
  ].map((run) => run.purpose);
  assert.deepEqual(purposes, [
    "pilot",
    "orientationCorpus",
    "focusedCalibration",
    "focusedCalibration",
    "finalLibrary",
  ]);
  const searchesAtBoundary = searches;
  const finalRestart = new ResearchAgentServiceV1({
    dataDir,
    toolGateway: gateway,
    piRuntimeAdapter: new PiRuntimeAdapter({ gateway, forceMode: "guided" }),
  });
  const finalRecovered = await finalRestart.runUntilBoundary(projectId);
  assert.equal(finalRecovered.projection.boundary.nodeId, nextGate.projection.boundary.nodeId);
  assert.equal(searches, searchesAtBoundary);
  assert.equal(finalRecovered.project.sourceMaterials[0].title, rawRecord.title);
});

test("a failed focused variant preserves the prior successful run and resume does not repeat it", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "research-agent-service-focused-resume-"));
  const calls = new Map();
  let failSecondFocused = true;
  const gateway = {
    async searchPubMed({ query }) {
      calls.set(query, (calls.get(query) ?? 0) + 1);
      if (query.includes("hasabstract") && failSecondFocused) {
        throw Object.assign(new Error("temporary PubMed outage"), { code: "PUBMED_SEARCH_FAILED" });
      }
      return {
        provider: "pubmed",
        query,
        executedAt: "2026-08-12T08:00:00.000Z",
        total: 1,
        resultIds: ["12345678"],
      };
    },
    async fetchPubMed() {
      const record = {
        sourceId: "pubmed:12345678",
        provider: "pubmed",
        pmid: "12345678",
        title: "A bounded record",
        abstract: "A bounded abstract statement.",
        accessLevel: "abstract_only",
        locator: {
          pmid: "12345678",
          url: "https://pubmed.ncbi.nlm.nih.gov/12345678/",
        },
      };
      return {
        provider: "pubmed",
        fetchedAt: "2026-08-12T08:00:01.000Z",
        records: [record],
        accessBoundary: "本轮只访问题名与摘要。",
      };
    },
  };
  const projectId = "agent-service-focused-resume";
  const service = new ResearchAgentServiceV1({
    dataDir,
    toolGateway: gateway,
    piRuntimeAdapter: new PiRuntimeAdapter({ gateway, forceMode: "guided" }),
  });
  await service.createProject({
    id: projectId,
    title: "聚焦检索恢复测试",
    question: "术后睡眠与恢复之间有什么关系？",
    completionProfileId: "audited_review",
    owner,
    researchMode: "live_pubmed",
    searchQuery: "sleep AND postoperative recovery",
    queryPreviewSelection: queryPreviewSelection({
      question: "术后睡眠与恢复之间有什么关系？",
      query: "sleep AND postoperative recovery",
      suffix: "12345678",
      sampleSourceId: "pubmed:12345678",
      pmid: "12345678",
    }),
    sourceMaterials: [],
  });
  const scope = await service.runUntilBoundary(projectId);
  await service.gateDecision({
    projectId,
    actor: owner,
    decision: "approved",
    reason: "研究者批准问题范围并允许真实检索。",
    gateFingerprint: scope.projection.boundary.fingerprint,
  });
  const angle = await service.runUntilBoundary(projectId);
  assert.equal(
    angle.projection.boundary.nodeId,
    "approve_review_angle",
    JSON.stringify(angle.projection.boundary),
  );
  await service.gateDecision({
    projectId,
    actor: owner,
    decision: "approved",
    reason: "研究者批准聚焦方向并允许精准检索。",
    gateFingerprint: angle.projection.boundary.fingerprint,
  });

  const blocked = await service.runUntilBoundary(projectId);
  assert.equal(blocked.projection.boundary.type, "blocked");
  assert.equal(blocked.projection.boundary.nodeId, "calibrate_focused_search");
  assert.equal(blocked.projection.boundary.blockers[0].code, "PUBMED_SEARCH_FAILED");
  assert.equal(blocked.projection.boundary.blockers[0].retryClass, "same_protocol_retry");
  assert.equal(blocked.projection.boundary.blockers[0].stage, "calibrate_focused_search");
  assert.equal(
    blocked.projection.boundary.blockers[0].protocolFingerprint.artifactType,
    "FocusedSearchProtocol",
  );
  assert.equal(blocked.project.retrievalRuns.focusedCalibration.length, 1);
  const successfulFocusedQuery = blocked.project.retrievalRuns.focusedCalibration[0].query;
  const successfulFocusedCallsBeforeResume = calls.get(successfulFocusedQuery);
  assert.ok(successfulFocusedCallsBeforeResume >= 1);

  failSecondFocused = false;
  const blocker = blocked.projection.boundary.blockers[0];
  await service.resumeProject({
    projectId,
    nodeId: "calibrate_focused_search",
    blockerId: blocker.id,
    actor: owner,
    resolution: "PubMed 服务已恢复，按同一冻结协议继续。",
  });
  const focusedResumed = await service.runUntilBoundary(projectId, { maxSteps: 1 });
  assert.equal(focusedResumed.project.retrievalRuns.focusedCalibration.length, 2);
  assert.equal(
    calls.get(successfulFocusedQuery),
    successfulFocusedCallsBeforeResume,
    "the successful focused query must not repeat after resume",
  );
  const resumed = await service.runUntilBoundary(projectId);
  assert.equal(resumed.project.retrievalRuns.finalLibrary.purpose, "finalLibrary");
});

test("zero-result formal retrieval requires an attributable protocol revision and survives restart", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "research-agent-service-protocol-revision-"));
  const calls = new Map();
  const oldQuery = "sleep AND postoperative recovery";
  const revisedQuery = "(sleep OR sleep quality) AND postoperative recovery";
  const gateway = {
    async searchPubMed({ query }) {
      calls.set(query, (calls.get(query) ?? 0) + 1);
      if (query === oldQuery) {
        return {
          provider: "pubmed",
          query,
          executedAt: "2026-08-12T08:00:00.000Z",
          total: 0,
          resultIds: [],
        };
      }
      return {
        provider: "pubmed",
        query,
        executedAt: "2026-08-12T08:05:00.000Z",
        total: 1,
        resultIds: ["12345678"],
      };
    },
    async fetchPubMed() {
      return {
        provider: "pubmed",
        fetchedAt: "2026-08-12T08:05:01.000Z",
        records: [{
          sourceId: "pubmed:12345678",
          provider: "pubmed",
          pmid: "12345678",
          title: "A bounded recovery record",
          abstract: "The abstract reports an association with recovery.",
          accessLevel: "abstract_only",
          locator: {
            pmid: "12345678",
            url: "https://pubmed.ncbi.nlm.nih.gov/12345678/",
          },
        }],
        accessBoundary: "本轮只访问题名与摘要。",
      };
    },
  };
  const serviceOptions = {
    dataDir,
    toolGateway: gateway,
    piRuntimeAdapter: new PiRuntimeAdapter({ gateway, forceMode: "guided" }),
  };
  const projectId = "agent-service-protocol-revision";
  const first = new ResearchAgentServiceV1(serviceOptions);
  await first.createProject({
    id: projectId,
    title: "正式检索协议修订测试",
    question: "术后睡眠与恢复之间有什么关系？",
    completionProfileId: "audited_review",
    owner,
    researchMode: "live_pubmed",
    searchQuery: oldQuery,
    queryPreviewSelection: queryPreviewSelection({
      question: "术后睡眠与恢复之间有什么关系？",
      query: oldQuery,
      suffix: "12345678",
      sampleSourceId: "pubmed:12345678",
      pmid: "12345678",
    }),
    sourceMaterials: [],
  });
  const scope = await first.runUntilBoundary(projectId);
  await first.gateDecision({
    projectId,
    actor: owner,
    decision: "approved",
    reason: "研究者批准问题边界并允许执行正式试检。",
    gateFingerprint: scope.projection.boundary.fingerprint,
  });
  const blocked = await first.runUntilBoundary(projectId);
  assert.equal(blocked.projection.boundary.nodeId, "run_pilot_search");
  const blocker = blocked.projection.boundary.blockers[0];
  assert.equal(blocker.code, "PUBMED_NO_RESULTS");
  assert.equal(blocker.retryClass, "protocol_revision_required");
  assert.equal(blocker.details.query, oldQuery);
  assert.equal(blocker.failedRequest.queryHash, sha256(oldQuery));
  assert.equal(blocker.protocolFingerprint.artifactType, "OrientationSearchProtocol");
  assert.equal(calls.get(oldQuery), 1);

  await assert.rejects(
    first.resumeProject({
      projectId,
      actor: owner,
      blockerId: blocker.id,
      resolution: "尝试不改变协议直接重试。",
    }),
    (error) => error.code === "RETRIEVAL_PROTOCOL_REVISION_REQUIRED",
  );
  await assert.rejects(
    first.reviseCurrentRetrievalProtocol({
      projectId,
      actor: { id: "agent:search_runner", role: "search_runner", kind: "agent" },
      revisedQuery,
      reason: "Agent 不得自行改变正式研究方法。",
    }),
    (error) => error.code === "HUMAN_REQUIRED",
  );
  await assert.rejects(
    first.reviseCurrentRetrievalProtocol({
      projectId,
      actor: owner,
      revisedQuery: oldQuery,
      reason: "研究者尝试提交没有变化的检索式。",
    }),
    (error) => error.code === "RETRIEVAL_PROTOCOL_QUERY_UNCHANGED",
  );

  const revised = await first.reviseCurrentRetrievalProtocol({
    projectId,
    actor: owner,
    blockerId: blocker.id,
    revisedQuery,
    reason: "零结果说明原式过窄，研究者明确放宽睡眠概念后重新试检。",
  });
  const orientationProtocols = revised.artifacts
    .filter((artifact) => artifact.type === "OrientationSearchProtocol")
    .sort((left, right) => left.version - right.version);
  assert.equal(orientationProtocols.length, 2);
  assert.equal(orientationProtocols[0].status, "superseded");
  assert.equal(orientationProtocols[0].freshness, "stale");
  assert.equal(orientationProtocols[1].content.query, revisedQuery);
  assert.equal(orientationProtocols[1].content.queryHash, sha256(revisedQuery));
  assert.equal(
    orientationProtocols[1].content.previousProtocolFingerprint.artifactId,
    orientationProtocols[0].id,
  );
  assert.equal(orientationProtocols[1].content.humanRevision.revisedBy.kind, "human");
  assert.equal(revised.project.retrievalRuns.pilot, undefined);
  assert.equal(revised.project.sourceMaterials.length, 0);
  assert.equal(revised.state.nodeExecutions.approve_scope.state, EXECUTION_STATES.ACCEPTED);

  const restarted = new ResearchAgentServiceV1(serviceOptions);
  const afterRestart = await restarted.getProject(projectId);
  assert.equal(
    afterRestart.artifacts.find(
      (artifact) =>
        artifact.type === "OrientationSearchProtocol" && artifact.freshness !== "stale",
    ).content.query,
    revisedQuery,
  );
  const angle = await restarted.runUntilBoundary(projectId);
  assert.equal(
    angle.projection.boundary.nodeId,
    "approve_review_angle",
    JSON.stringify(angle.projection.boundary),
  );
  assert.equal(calls.get(oldQuery), 1, "the failed old protocol must never be retried");
  assert.equal(angle.project.retrievalRuns.pilot.query, revisedQuery);
  assert.equal(
    angle.project.retrievalRuns.pilot.protocolArtifactId,
    orientationProtocols[1].id,
  );
  assert.ok((calls.get(revisedQuery) ?? 0) >= 1);
});

test("focused protocol revision invalidates only focused runs and never repeats accepted upstream retrieval", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "research-agent-service-focused-revision-"));
  const calls = new Map();
  const oldQuery = "sleep AND postoperative recovery";
  const oldSecondQuery = `(${oldQuery}) AND hasabstract`;
  const revisedQuery = "(sleep quality OR insomnia) AND postoperative recovery";
  const gateway = {
    async searchPubMed({ query }) {
      calls.set(query, (calls.get(query) ?? 0) + 1);
      if (query === oldSecondQuery) {
        return {
          provider: "pubmed",
          query,
          executedAt: "2026-08-12T08:00:00.000Z",
          total: 0,
          resultIds: [],
        };
      }
      return {
        provider: "pubmed",
        query,
        executedAt: "2026-08-12T08:00:00.000Z",
        total: 1,
        resultIds: ["12345678"],
      };
    },
    async fetchPubMed() {
      return {
        provider: "pubmed",
        fetchedAt: "2026-08-12T08:00:01.000Z",
        records: [{
          sourceId: "pubmed:12345678",
          provider: "pubmed",
          pmid: "12345678",
          title: "A bounded focused-search record",
          abstract: "The abstract reports a bounded association.",
          accessLevel: "abstract_only",
          locator: {
            pmid: "12345678",
            url: "https://pubmed.ncbi.nlm.nih.gov/12345678/",
          },
        }],
        accessBoundary: "本轮只访问题名与摘要。",
      };
    },
  };
  const serviceOptions = {
    dataDir,
    toolGateway: gateway,
    piRuntimeAdapter: new PiRuntimeAdapter({ gateway, forceMode: "guided" }),
  };
  const projectId = "agent-service-focused-revision";
  const first = new ResearchAgentServiceV1(serviceOptions);
  await first.createProject({
    id: projectId,
    title: "精准检索协议修订测试",
    question: "术后睡眠与恢复之间有什么关系？",
    completionProfileId: "audited_review",
    owner,
    researchMode: "live_pubmed",
    searchQuery: oldQuery,
    queryPreviewSelection: queryPreviewSelection({
      question: "术后睡眠与恢复之间有什么关系？",
      query: oldQuery,
      suffix: "12345678",
      sampleSourceId: "pubmed:12345678",
      pmid: "12345678",
    }),
    sourceMaterials: [],
  });
  const scope = await first.runUntilBoundary(projectId);
  await first.gateDecision({
    projectId,
    actor: owner,
    decision: "approved",
    reason: "研究者批准问题边界并允许执行领域检索。",
    gateFingerprint: scope.projection.boundary.fingerprint,
  });
  const angle = await first.runUntilBoundary(projectId);
  await first.gateDecision({
    projectId,
    actor: owner,
    decision: "approved",
    reason: "研究者批准深挖方向并允许执行精准检索。",
    gateFingerprint: angle.projection.boundary.fingerprint,
  });
  const blocked = await first.runUntilBoundary(projectId);
  assert.equal(blocked.projection.boundary.nodeId, "calibrate_focused_search");
  assert.equal(blocked.projection.boundary.blockers[0].code, "PUBMED_NO_RESULTS");
  assert.equal(blocked.project.retrievalRuns.focusedCalibration.length, 1);
  const pilot = structuredClone(blocked.project.retrievalRuns.pilot);
  const orientation = structuredClone(blocked.project.retrievalRuns.orientationCorpus);
  const upstreamCalls = calls.get(oldQuery);

  const revised = await first.reviseCurrentRetrievalProtocol({
    projectId,
    actor: owner,
    blockerId: blocked.projection.boundary.blockers[0].id,
    revisedQuery,
    reason: "第二个精准候选式零结果，研究者明确修订核心与敏感性查询后重新校准。",
  });
  assert.deepEqual(revised.project.retrievalRuns.pilot, pilot);
  assert.deepEqual(revised.project.retrievalRuns.orientationCorpus, orientation);
  assert.equal(revised.project.retrievalRuns.focusedCalibration, undefined);
  assert.equal(revised.project.retrievalRuns.finalLibrary, undefined);
  assert.equal(revised.project.retrievalRunHistory.length, 1);
  assert.equal(revised.project.retrievalRunHistory[0].purpose, "focusedCalibration");
  assert.equal(revised.project.retrievalRunHistory[0].authority, "historical_only");
  assert.equal(
    revised.project.retrievalRunHistory[0].invalidatedBy.reason,
    "formal_protocol_revision",
  );
  assert.equal(
    revised.state.nodeExecutions.approve_review_angle.state,
    EXECUTION_STATES.ACCEPTED,
  );
  assert.equal(calls.get(oldQuery), upstreamCalls);

  const restarted = new ResearchAgentServiceV1(serviceOptions);
  const nextBoundary = await restarted.runUntilBoundary(projectId);
  assert.equal(nextBoundary.projection.boundary.type, "human_gate");
  assert.equal(nextBoundary.project.retrievalRuns.focusedCalibration.length, 2);
  assert.equal(nextBoundary.project.retrievalRuns.finalLibrary.purpose, "finalLibrary");
  assert.deepEqual(nextBoundary.project.retrievalRuns.pilot, pilot);
  assert.deepEqual(nextBoundary.project.retrievalRuns.orientationCorpus, orientation);
  assert.equal(
    calls.get(oldQuery),
    upstreamCalls,
    "accepted pilot, orientation, and old focused core runs must not repeat",
  );
  assert.equal(calls.get(oldSecondQuery), 1, "the failed old variant must stay historical");
  assert.equal(calls.get(revisedQuery), 2, "new core runs once for calibration and once for final library");
  assert.equal(calls.get(`(${revisedQuery}) AND hasabstract`), 1);
});

test("rejects forged live PubMed snapshots before project creation or attachment", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "research-agent-service-forged-retrieval-"));
  const gateway = {};
  const service = new ResearchAgentServiceV1({
    dataDir,
    toolGateway: gateway,
    piRuntimeAdapter: new PiRuntimeAdapter({ gateway, forceMode: "guided" }),
  });
  const forged = {
    provider: "pubmed",
    query: "sleep",
    executedAt: "2026-08-12T08:00:00.000Z",
    fetchedAt: "2026-08-12T08:00:01.000Z",
    total: 1,
    resultIds: ["12345678"],
    records: [{
      sourceId: "pubmed:12345678",
      provider: "pubmed",
      pmid: "12345678",
      title: "Invented source",
      accessLevel: "title_only",
      locator: { pmid: "12345678" },
      sourceSnapshotHash: "a".repeat(64),
    }],
    accessBoundary: "题名级",
    receiptHash: "b".repeat(64),
  };

  await assert.rejects(
    service.createProject({
      id: "forged-at-create",
      title: "伪造检索回执",
      question: "是否允许外部伪造 PubMed 回执？",
      completionProfileId: "audited_review",
      owner,
      researchMode: "live_pubmed",
      searchQuery: "sleep",
      liveRetrieval: forged,
      sourceMaterials: forged.records,
    }),
    (error) => error.code === "EXTERNAL_LIVE_RETRIEVAL_FORBIDDEN",
  );

  await service.createProject({
    id: "forged-at-attach",
    title: "伪造检索回执",
    question: "是否允许外部伪造 PubMed 回执？",
    completionProfileId: "audited_review",
    owner,
    researchMode: "live_pubmed",
    searchQuery: "sleep",
    sourceMaterials: [],
  });
  assert.equal(service.attachLiveRetrieval, undefined);
});

test("user-provided material cannot bind edited content to an arbitrary snapshot hash", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "research-agent-material-hash-"));
  const service = new ResearchAgentServiceV1({
    dataDir,
    piRuntimeAdapter: guidedRuntime(),
    now: monotonicClock(),
  });
  await assert.rejects(
    service.createProject({
      id: "material-hash-project",
      title: "Material hash project",
      question: "Can supplied material be traced?",
      completionProfileId: "evidence_brief",
      owner,
      sourceMaterials: [
        {
          id: "source:user:1",
          title: "User supplied note",
          text: "The actual supplied text.",
          accessLevel: "abstract_only",
          locator: { repositoryId: "local-note" },
          sourceSnapshotHash: "f".repeat(64),
        },
      ],
    }),
    (error) => error?.code === "SOURCE_SNAPSHOT_HASH_MISMATCH",
  );
});

test("a live project without a pre-registered preview sentinel blocks before retrieval", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "research-agent-service-live-zero-"));
  let fetches = 0;
  const gateway = {
    async searchPubMed() {
      return {
        provider: "pubmed",
        query: "no-result-query",
        executedAt: "2026-08-12T08:00:00.000Z",
        total: 0,
        resultIds: [],
      };
    },
    async fetchPubMed() {
      fetches += 1;
      return { records: [] };
    },
  };
  const service = new ResearchAgentServiceV1({
    dataDir,
    toolGateway: gateway,
    piRuntimeAdapter: new PiRuntimeAdapter({ gateway, forceMode: "guided" }),
  });
  const projectId = "agent-service-live-zero";
  await service.createProject({
    id: projectId,
    title: "空检索测试",
    question: "这个问题没有可检出的文献吗？",
    completionProfileId: "audited_review",
    owner,
    researchMode: "live_pubmed",
    searchQuery: "no-result-query",
    sourceMaterials: [],
  });
  const pending = await service.runUntilBoundary(projectId);
  assert.equal(pending.projection.boundary.nodeId, "approve_scope");
  await service.gateDecision({
    projectId,
    actor: owner,
    decision: "approved",
    reason: "测试研究者确认问题与范围。",
    gateFingerprint: pending.projection.boundary.fingerprint,
  });
  const blocked = await service.runUntilBoundary(projectId);
  assert.equal(blocked.projection.boundary.type, "blocked");
  assert.equal(blocked.projection.boundary.nodeId, "design_orientation_search");
  assert.match(
    blocked.projection.boundary.blockers[0].reason,
    /sentinelSourceIds must not be empty/,
  );
  await assert.rejects(
    service.ensureLiveRetrieval({ projectId, nodeId: "run_pilot_search" }),
    (error) => error.code === "RETRIEVAL_NODE_NOT_CURRENT",
  );
  assert.equal(fetches, 0);
  const current = await service.getProject(projectId);
  assert.equal(current.project.sourceMaterials.length, 0);
  assert.equal(
    current.artifacts.some((artifact) =>
      JSON.stringify(artifact.content).includes("missing-source"),
    ),
    false,
  );
});

test("a failed preview can be replaced inside the same paused project without becoming evidence", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "research-agent-service-live-retry-"));
  const gateway = {};
  const service = new ResearchAgentServiceV1({
    dataDir,
    toolGateway: gateway,
    piRuntimeAdapter: new PiRuntimeAdapter({ gateway, forceMode: "guided" }),
  });
  const projectId = "agent-service-live-retry";
  const question = "修改预检式后能否在同一个项目中恢复？";
  const failedSelection = queryPreviewSelection({
    question,
    query: "empty query",
    candidateStatus: "failed",
    suffix: "failed",
  });
  await service.createProject({
    id: projectId,
    title: "同项目检索恢复测试",
    question,
    completionProfileId: "audited_review",
    owner,
    researchMode: "live_pubmed",
    searchQuery: "empty query",
    queryPreviewSelection: failedSelection,
    sourceMaterials: [],
  });
  const paused = await service.pauseProject({
    projectId,
    nodeId: "clarify_question",
    actor: owner,
    reason: "预检失败，等待研究者选择新检索式。",
  });
  assert.equal(paused.state.nodeExecutions.clarify_question.state, EXECUTION_STATES.BLOCKED);
  const revisedSelection = queryPreviewSelection({
    question,
    query: "revised query",
    candidateStatus: "ready",
    suffix: "ready",
  });
  const recovered = await service.updateQueryPreviewSelection({
    projectId,
    selection: revisedSelection,
  });
  assert.equal(recovered.project.id, projectId);
  assert.equal(recovered.project.searchQuery, "revised query");
  assert.equal(recovered.project.retrievalRuns.previewSelection.selectionHash, revisedSelection.selectionHash);
  assert.equal(recovered.project.sourceMaterials.length, 0);
  assert.equal(recovered.project.retrievalRuns.pilot, undefined);
  assert.equal((await service.listProjects()).length, 1);

  const restarted = new ResearchAgentServiceV1({
    dataDir,
    toolGateway: gateway,
    piRuntimeAdapter: new PiRuntimeAdapter({ gateway, forceMode: "guided" }),
  });
  const afterRestart = await restarted.getProject(projectId);
  assert.equal(afterRestart.project.searchQuery, "revised query");
  assert.equal(
    afterRestart.project.retrievalRuns.previewSelection.samples[0].title,
    "预检样本文献",
  );
  assert.equal(afterRestart.project.sourceMaterials.length, 0);
});
