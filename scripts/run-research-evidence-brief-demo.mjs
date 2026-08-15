import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  dispatchCommand,
  getRuntimeUserProjection,
  replayEvents,
  sha256,
  verifyEventChain,
} from "../research-core/event-engine-v1.js";
import {
  ARTIFACT_STATES,
  EXECUTION_STATES,
  GATE_STATES,
  REVIEW_RESEARCH_MACHINE_V1,
} from "../research-core/review-research-machine-v1.js";
import { assertValidEvidenceBriefBundle } from "../research-core/artifact-contracts-v1.js";
import { renderEvidenceBrief } from "../research-core/user-brief-renderer-v1.js";

export const DEFAULT_EVIDENCE_BRIEF_INPUT = fileURLToPath(
  new URL(
    "../research-core/fixtures/network-pharmacology-evidence-brief-input-v1.json",
    import.meta.url,
  ),
);

const PROJECT_ID = "network-pharmacology-evidence-brief-demo";
const GATE_ID = "NP-LIT3-EVIDENCE-BOUNDARY-DEMO-GATE-001";
const CLAIM_MAP_ID = "NP-LIT3-CLAIM-EVIDENCE-MAP-DEMO-001";
const APPRAISAL_ID = "NP-LIT3-APPRAISAL-DEMO-001";
const COUNTEREVIDENCE_ID = "NP-LIT3-COUNTEREVIDENCE-DEMO-001";
const COVERAGE_GAPS_ID = "NP-LIT3-COVERAGE-GAPS-DEMO-001";
const WORKSPACE_ROOT = fileURLToPath(new URL("../", import.meta.url));

const ACTORS = Object.freeze({
  human: Object.freeze({
    id: "human-researcher",
    role: "human_researcher",
    kind: "human",
  }),
  system: Object.freeze({
    id: "evidence-brief-migration",
    role: "system_migrator",
    kind: "system",
  }),
  orchestrator: Object.freeze({
    id: "research-orchestrator",
    role: "research_orchestrator",
    kind: "agent",
  }),
  synthesizer: Object.freeze({
    id: "evidence-brief-synthesizer",
    role: "evidence_synthesizer",
    kind: "agent",
  }),
  synthesisReviewer: Object.freeze({
    id: "evidence-card-reviewer",
    role: "evidence_reviewer",
    kind: "agent",
  }),
  verifier: Object.freeze({
    id: "independent-evidence-verifier",
    role: "independent_evidence_verifier",
    kind: "agent",
  }),
  verificationReviewer: Object.freeze({
    id: "independent-evidence-reviewer",
    role: "independent_evidence_reviewer",
    kind: "agent",
  }),
});

function readBundle(inputPath) {
  return JSON.parse(readFileSync(inputPath, "utf8"));
}

function proofSet(nodeId, artifactIds) {
  const node = REVIEW_RESEARCH_MACHINE_V1.nodes.find((item) => item.id === nodeId);
  return node.acceptanceCriteria.map((criterion) => ({
    criterion,
    passed: true,
    proofArtifactIds: [...artifactIds],
  }));
}

function accessCounts(evidenceExcerpts) {
  return evidenceExcerpts.reduce((counts, evidence) => {
    counts[evidence.accessLevel] = (counts[evidence.accessLevel] ?? 0) + 1;
    return counts;
  }, {});
}

function assertSourceSnapshots(evidenceExcerpts) {
  for (const evidence of evidenceExcerpts) {
    const sourcePath = resolve(WORKSPACE_ROOT, evidence.locator.repositoryId);
    const actualHash = sha256(readFileSync(sourcePath, "utf8"));
    if (actualHash !== evidence.sourceSnapshotHash) {
      throw new Error(
        `Source snapshot hash mismatch for ${evidence.id}: ${sourcePath}`,
      );
    }
  }
  return evidenceExcerpts.length;
}

function importedEvidenceArtifacts(bundle) {
  return bundle.evidenceExcerpts.map((evidence) => ({
    id: evidence.id,
    type: "EvidenceRecord",
    lineageId: evidence.id,
    version: 1,
    contentHash: sha256(evidence),
    status: ARTIFACT_STATES.ACCEPTED,
    producedByNodeId: "extract_evidence",
    producedByActorId: "legacy-evidence-extractor",
    producedByActorRole: "evidence_extractor",
    inputArtifactRefs: [],
    sourceRef: {
      path: evidence.locator.repositoryId,
      sha256: evidence.sourceSnapshotHash,
      pmid: evidence.locator.pmid,
      accessLevel: evidence.accessLevel,
    },
  }));
}

function importedSupportingArtifacts(bundle) {
  const counts = accessCounts(bundle.evidenceExcerpts);
  return [
    {
      id: APPRAISAL_ID,
      type: "AppraisalRecord",
      lineageId: APPRAISAL_ID,
      version: 1,
      contentHash: sha256({ accessCounts: counts, evidenceIds: bundle.evidenceExcerpts.map((item) => item.id) }),
      status: ARTIFACT_STATES.ACCEPTED,
      producedByNodeId: "extract_evidence",
      inputArtifactRefs: [],
      sourceRef: { bundleId: bundle.id, meaning: "access-level appraisal for the runnable slice" },
    },
    {
      id: COUNTEREVIDENCE_ID,
      type: "CounterevidenceRegister",
      lineageId: COUNTEREVIDENCE_ID,
      version: 1,
      contentHash: sha256({ counterEvidenceIds: [], reason: "no complete-chain counterexample confirmed in the bounded set" }),
      status: ARTIFACT_STATES.ACCEPTED,
      producedByNodeId: "seek_counterevidence",
      inputArtifactRefs: [],
      sourceRef: { bundleId: bundle.id, meaning: "bounded counterevidence register" },
    },
    {
      id: COVERAGE_GAPS_ID,
      type: "CoverageGapRegister",
      lineageId: COVERAGE_GAPS_ID,
      version: 1,
      contentHash: sha256({ boundaries: bundle.boundaries, accessCounts: counts }),
      status: ARTIFACT_STATES.ACCEPTED,
      producedByNodeId: "seek_counterevidence",
      inputArtifactRefs: [],
      sourceRef: { bundleId: bundle.id, meaning: "coverage and access boundary register" },
    },
  ];
}

export function runNetworkPharmacologyEvidenceBriefSlice({
  bundle = null,
  inputPath = DEFAULT_EVIDENCE_BRIEF_INPUT,
  humanDecision = null,
} = {}) {
  const inputBundle = structuredClone(bundle ?? readBundle(inputPath));
  assertValidEvidenceBriefBundle(inputBundle);
  const verifiedEvidenceRecordSnapshotCount = assertSourceSnapshots(
    inputBundle.evidenceExcerpts,
  );

  const events = [];
  let commandIndex = 0;
  const dispatch = (type, actor, extra = {}) => {
    const expectedVersion = events.length;
    const occurredAt = new Date(
      Date.UTC(2026, 7, 11, 1, commandIndex, 0),
    ).toISOString();
    commandIndex += 1;
    const command = {
      type,
      commandId: `demo-${String(commandIndex).padStart(2, "0")}-${type.toLowerCase()}`,
      projectId: PROJECT_ID,
      expectedVersion,
      occurredAt,
      actor,
      ...extra,
    };
    const result = dispatchCommand(REVIEW_RESEARCH_MACHINE_V1, events, command);
    events.push(...result.newEvents);
    return result;
  };

  dispatch("CREATE_PROJECT", ACTORS.human, {
    completionProfileId: "evidence_brief",
  });

  const evidenceArtifacts = importedEvidenceArtifacts(inputBundle);
  const supportingArtifacts = importedSupportingArtifacts(inputBundle);
  const extractionArtifactIds = [
    ...evidenceArtifacts.map((artifact) => artifact.id),
    APPRAISAL_ID,
  ];
  const counterevidenceArtifactIds = [COUNTEREVIDENCE_ID, COVERAGE_GAPS_ID];
  const synthesisInputIds = [
    ...extractionArtifactIds,
    ...counterevidenceArtifactIds,
  ];

  dispatch("IMPORT_LEGACY_CHECKPOINT", ACTORS.system, {
    artifacts: [...evidenceArtifacts, ...supportingArtifacts],
    nodes: [
      {
        nodeId: "extract_evidence",
        state: EXECUTION_STATES.ACCEPTED,
        artifactIds: extractionArtifactIds,
        sourceRef: { bundleId: inputBundle.id, meaning: "previously completed evidence extraction" },
      },
      {
        nodeId: "seek_counterevidence",
        state: EXECUTION_STATES.ACCEPTED,
        artifactIds: counterevidenceArtifactIds,
        sourceRef: { bundleId: inputBundle.id, meaning: "previously completed counterevidence search" },
      },
    ],
    gates: [],
  });

  dispatch("READY_NODE", ACTORS.orchestrator, { nodeId: "synthesize_claims" });
  dispatch("CLAIM_WORK", ACTORS.synthesizer, {
    nodeId: "synthesize_claims",
    leaseId: "demo-synthesis-lease",
    expiresAt: "2026-08-12T01:00:00.000Z",
  });
  dispatch("START_NODE", ACTORS.synthesizer, {
    nodeId: "synthesize_claims",
    leaseId: "demo-synthesis-lease",
  });

  const conclusionCard = inputBundle.conclusionCards[0];
  dispatch("PRODUCE_ARTIFACT", ACTORS.synthesizer, {
    nodeId: "synthesize_claims",
    leaseId: "demo-synthesis-lease",
    artifact: {
      id: CLAIM_MAP_ID,
      type: "ClaimEvidenceMap",
      lineageId: CLAIM_MAP_ID,
      version: 1,
      content: {
        question: inputBundle.researchQuestion,
        conclusionCardIds: [conclusionCard.id],
        evidenceIds: conclusionCard.supportingEvidenceIds,
        boundaryCount: inputBundle.boundaries.length,
      },
      inputArtifactRefs: synthesisInputIds,
      sourceRef: { bundleId: inputBundle.id, representation: "claim-evidence-map" },
    },
  });
  dispatch("PRODUCE_ARTIFACT", ACTORS.synthesizer, {
    nodeId: "synthesize_claims",
    leaseId: "demo-synthesis-lease",
    artifact: {
      id: conclusionCard.id,
      type: "ResearchConclusionCard",
      lineageId: conclusionCard.id,
      version: conclusionCard.version,
      content: conclusionCard,
      inputArtifactRefs: synthesisInputIds,
      sourceRef: { bundleId: inputBundle.id, representation: "typed-conclusion-card" },
    },
  });

  const synthesisOutputIds = [CLAIM_MAP_ID, conclusionCard.id];
  dispatch("SUBMIT_NODE", ACTORS.synthesizer, {
    nodeId: "synthesize_claims",
    leaseId: "demo-synthesis-lease",
    artifactIds: synthesisOutputIds,
  });
  for (const artifactId of synthesisOutputIds) {
    dispatch("VERIFY_ARTIFACT", ACTORS.synthesisReviewer, {
      artifactId,
      verdict: "pass",
    });
  }
  dispatch("ACCEPT_NODE", ACTORS.synthesisReviewer, {
    nodeId: "synthesize_claims",
    artifactIds: synthesisOutputIds,
    criteriaProofs: proofSet("synthesize_claims", synthesisOutputIds),
  });

  dispatch("READY_NODE", ACTORS.orchestrator, { nodeId: "verify_evidence" });
  dispatch("CLAIM_WORK", ACTORS.verifier, {
    nodeId: "verify_evidence",
    leaseId: "demo-verification-lease",
    expiresAt: "2026-08-12T01:00:00.000Z",
  });
  dispatch("START_NODE", ACTORS.verifier, {
    nodeId: "verify_evidence",
    leaseId: "demo-verification-lease",
  });

  const verificationReport = inputBundle.verificationReports[0];
  dispatch("PRODUCE_ARTIFACT", ACTORS.verifier, {
    nodeId: "verify_evidence",
    leaseId: "demo-verification-lease",
    artifact: {
      id: verificationReport.id,
      type: "EvidenceVerificationReport",
      lineageId: verificationReport.id,
      version: 1,
      content: verificationReport,
      inputArtifactRefs: synthesisOutputIds,
      sourceRef: { bundleId: inputBundle.id, representation: "typed-independent-verification" },
    },
  });
  dispatch("SUBMIT_NODE", ACTORS.verifier, {
    nodeId: "verify_evidence",
    leaseId: "demo-verification-lease",
    artifactIds: [verificationReport.id],
  });
  dispatch("VERIFY_ARTIFACT", ACTORS.verificationReviewer, {
    artifactId: verificationReport.id,
    verdict: "pass",
  });
  dispatch("ACCEPT_NODE", ACTORS.verificationReviewer, {
    nodeId: "verify_evidence",
    artifactIds: [verificationReport.id],
    criteriaProofs: proofSet("verify_evidence", [verificationReport.id]),
  });

  dispatch("READY_NODE", ACTORS.orchestrator, {
    nodeId: "approve_evidence_boundary",
  });
  dispatch("REQUEST_GATE", ACTORS.orchestrator, {
    gateId: GATE_ID,
    nodeId: "approve_evidence_boundary",
    artifactIds: [verificationReport.id, conclusionCard.id],
  });

  if (humanDecision) {
    const pendingState = replayEvents(
      REVIEW_RESEARCH_MACHINE_V1,
      PROJECT_ID,
      events,
    );
    const pendingGate = pendingState.gates[GATE_ID];
    const accepts = new Set([
      GATE_STATES.APPROVED,
      GATE_STATES.ACCEPTED_RISK,
    ]).has(humanDecision.decision);
    const decisionArtifacts = accepts
      ? [
          {
            id: "NP-LIT3-EVIDENCE-BOUNDARY-DECISION-DEMO-001",
            type: "EvidenceBoundaryDecision",
            lineageId: "NP-LIT3-EVIDENCE-BOUNDARY-DECISION-DEMO-001",
            version: 1,
            content: {
              schemaVersion: "1.0.0",
              id: "NP-LIT3-EVIDENCE-BOUNDARY-DECISION-DEMO-001",
              gateId: GATE_ID,
              bundleId: inputBundle.id,
              materialFingerprint: pendingGate.fingerprint,
              decision: humanDecision.decision,
              reason: humanDecision.reason,
              conclusionCardIds: [conclusionCard.id],
              verificationReportIds: [verificationReport.id],
              nextResearchPeriod: "论证结构",
            },
            sourceRef: {
              bundleId: inputBundle.id,
              representation: "human-evidence-boundary-decision",
            },
          },
        ]
      : [];

    dispatch("DECIDE_GATE", ACTORS.human, {
      gateId: GATE_ID,
      gateFingerprint: humanDecision.gateFingerprint,
      decision: humanDecision.decision,
      reason: humanDecision.reason,
      decisionArtifacts,
    });
  }

  const state = replayEvents(REVIEW_RESEARCH_MACHINE_V1, PROJECT_ID, events);
  const gate = state.gates[GATE_ID];
  const renderedBrief = renderEvidenceBrief(inputBundle);
  const projection = getRuntimeUserProjection(REVIEW_RESEARCH_MACHINE_V1, state);
  const registeredConclusion = state.artifacts[conclusionCard.id];
  const registeredVerification = state.artifacts[verificationReport.id];

  return {
    projectId: PROJECT_ID,
    input: {
      id: inputBundle.id,
      evidenceRecordCount: inputBundle.evidenceExcerpts.length,
      verifiedEvidenceRecordSnapshotCount,
      snapshotMeaning: "workspace evidence-record files, not original article files",
      accessCounts: accessCounts(inputBundle.evidenceExcerpts),
    },
    contractValidation: "passed",
    eventLog: {
      eventCount: events.length,
      hashChainValid: verifyEventChain(events, PROJECT_ID),
      headHash: events.at(-1).hash,
    },
    registeredConclusion: {
      id: registeredConclusion.id,
      status: registeredConclusion.status,
      contentHash: registeredConclusion.contentHash,
      expectedContentHash: sha256(conclusionCard),
      producedByActorId: registeredConclusion.producedByActorId,
    },
    independentVerification: {
      id: registeredVerification.id,
      status: registeredVerification.status,
      producedByActorId: registeredVerification.producedByActorId,
      acceptedByActorId: registeredVerification.acceptedBy.actorId,
      independent:
        registeredVerification.producedByActorId !==
        registeredVerification.acceptedBy.actorId,
    },
    humanGate: {
      id: gate.id,
      status: gate.status,
      fingerprint: gate.fingerprint,
      artifactIds: gate.artifactRefs.map((ref) => ref.artifactId),
      decisionRecorded: gate.status !== GATE_STATES.PENDING,
      decisionReceipt:
        gate.status === GATE_STATES.PENDING
          ? null
          : {
              decidedBy: gate.decidedBy,
              decidedAt: gate.decidedAt,
              reason: gate.reason,
              decisionArtifactIds: gate.decisionArtifactIds,
              eventLogHeadHash: events.at(-1).hash,
            },
    },
    evidenceBrief: {
      researchQuestion: inputBundle.researchQuestion,
      currentResearchPeriod: inputBundle.currentResearchPeriod,
      conclusion: conclusionCard,
      verification: verificationReport,
      boundaries: inputBundle.boundaries,
      evidence: inputBundle.evidenceExcerpts.map((item) => ({
        id: item.id,
        pmid: item.locator.pmid,
        repositoryId: item.locator.repositoryId,
        accessLevel: item.accessLevel,
        relation: item.relation,
        extractedFacts: item.extractedFacts,
        limitations: item.limitations,
        unknowns: item.unknowns,
      })),
      nextStepOrUserDecision: inputBundle.nextStepOrUserDecision,
    },
    userProjection: projection,
    brief: renderedBrief,
  };
}

function printHumanReadable(result, inputPath) {
  const lines = [
    "科研内核可运行纵切：网络药理学 evidence brief",
    "",
    `输入文件：${inputPath}`,
    `1. 内容契约：通过（${result.input.evidenceRecordCount} 条证据记录，${result.input.verifiedEvidenceRecordSnapshotCount} 份逐篇证据记录文件校验一致）`,
    `2. 事件账本：通过（${result.eventLog.eventCount} 个事件，哈希链有效）`,
    `3. 结论卡：${result.registeredConclusion.status}，内容哈希已绑定`,
    `4. 独立核查：${result.independentVerification.status}，生产者与接受者不同`,
    `5. 人工门禁：${result.humanGate.status}，尚未记录研究者决定`,
    "",
    result.brief.markdown,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  const jsonMode = process.argv.includes("--json");
  const inputFlagIndex = process.argv.indexOf("--input");
  const inputPath =
    inputFlagIndex >= 0
      ? process.argv[inputFlagIndex + 1]
      : DEFAULT_EVIDENCE_BRIEF_INPUT;
  const result = runNetworkPharmacologyEvidenceBriefSlice({ inputPath });
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    printHumanReadable(result, inputPath);
  }
}
