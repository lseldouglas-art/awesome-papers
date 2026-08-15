import {
  dispatchCommand,
  getRuntimeUserProjection,
  replayEvents,
  sha256,
  verifyEventChain,
} from "../event-engine-v1.js";
import {
  ARTIFACT_STATES,
  EXECUTION_STATES,
  GATE_STATES,
  REVIEW_RESEARCH_MACHINE_V1,
} from "../review-research-machine-v1.js";

export const NETWORK_PHARMACOLOGY_PROJECT_ID =
  "network-pharmacology-golden-replay-v1";

export const NETWORK_PHARMACOLOGY_SOURCE_DAY = "2026-08-10";
export const NETWORK_PHARMACOLOGY_REVISION_DAY = "2026-08-11";

const EXAMPLE_ROOT = "docs/research-workbench-examples";
const INTERACTION_LOG =
  `${EXAMPLE_ROOT}/network-pharmacology-test-interaction-log-2026-08-09.md`;
const INTERACTION_LOG_SHA256 =
  "7772cc09219c79ed8bebf5908e55b744e600fc056e3835759b4a7ea8c7599956";

export const NETWORK_PHARMACOLOGY_MILESTONES_V1 = Object.freeze([
  {
    id: "canonical-g1-snapshot-accepted",
    milestoneSequence: 1,
    sourceSequence: 12,
    sourceDate: NETWORK_PHARMACOLOGY_SOURCE_DAY,
    meaning:
      "NP-G1-20260810-v8 and NP-G1-LIB-002 become the scoped PubMed-only authority.",
  },
  {
    id: "g2-candidate-package-produced",
    milestoneSequence: 2,
    sourceSequence: 13,
    sourceDate: NETWORK_PHARMACOLOGY_SOURCE_DAY,
    meaning: "The old G2 protocol package exists as candidate work, not approval.",
  },
  {
    id: "independent-agent-review-completed",
    milestoneSequence: 3,
    sourceSequence: 13,
    sourceDate: NETWORK_PHARMACOLOGY_SOURCE_DAY,
    meaning: "Independent agent review passed with explicit human-review limits.",
  },
  {
    id: "human-g2-gate-requested",
    milestoneSequence: 4,
    sourceSequence: 13,
    sourceDate: NETWORK_PHARMACOLOGY_SOURCE_DAY,
    meaning: "The old G2 content package waits for a human decision.",
  },
  {
    id: "workflow-sequence-corrected-by-user",
    milestoneSequence: 5,
    sourceSequence: 15,
    sourceDate: NETWORK_PHARMACOLOGY_SOURCE_DAY,
    meaning:
      "The user restores the research-first sequence; the premature G2 package and gate lose current applicability.",
  },
  {
    id: "focused-search-calibration-completed",
    milestoneSequence: 6,
    sourceSequence: 16,
    sourceDate: NETWORK_PHARMACOLOGY_SOURCE_DAY,
    meaning:
      "The v7 focused search is accepted as a run and calibration fact while all 13 Q4 records remain candidates.",
  },
  {
    id: "single-pain-point-product-wedge-proposed",
    milestoneSequence: 7,
    sourceSequence: 17,
    sourceDate: NETWORK_PHARMACOLOGY_SOURCE_DAY,
    meaning: "A low-friction product direction is proposed without changing research state.",
  },
  {
    id: "research-policy-accepted",
    milestoneSequence: 8,
    sourceSequence: 18,
    sourceDate: NETWORK_PHARMACOLOGY_SOURCE_DAY,
    meaning: "The research-first operating policy is accepted without approving G2.",
  },
  {
    id: "product-boundary-corrected",
    milestoneSequence: 9,
    sourceSequence: 19,
    sourceDate: NETWORK_PHARMACOLOGY_SOURCE_DAY,
    meaning: "The website-like visual direction is superseded by an independent-product boundary.",
  },
  {
    id: "state-machine-first-architecture-accepted",
    milestoneSequence: 10,
    sourceSequence: 20,
    sourceDate: NETWORK_PHARMACOLOGY_SOURCE_DAY,
    meaning: "The state-machine-first architecture is accepted and product form is deferred.",
  },
  {
    id: "traceable-library-frozen-in-zotero",
    milestoneSequence: 11,
    sourceSequence: 23,
    sourceDate: NETWORK_PHARMACOLOGY_SOURCE_DAY,
    meaning:
      "The 13-record PubMed candidate library is frozen and cross-referenced to the verified Zotero collection.",
  },
  {
    id: "evidence-extraction-synthesis-and-independent-review-completed",
    milestoneSequence: 12,
    sourceSequence: 24,
    sourceDate: NETWORK_PHARMACOLOGY_SOURCE_DAY,
    meaning:
      "Per-paper extraction, counterevidence, cross-paper synthesis, and independent agent review are complete with explicit access limits.",
  },
  {
    id: "evidence-boundary-gate-requested",
    milestoneSequence: 13,
    sourceSequence: 24,
    sourceDate: NETWORK_PHARMACOLOGY_SOURCE_DAY,
    meaning:
      "The verified evidence boundary is presented to the human researcher without recording an approval decision.",
  },
  {
    id: "evidence-boundary-approved-and-target-extended",
    milestoneSequence: 14,
    sourceSequence: 28,
    sourceDate: NETWORK_PHARMACOLOGY_SOURCE_DAY,
    meaning:
      "The human researcher approves the presented abstract-level evidence boundary and explicitly extends the target to an evidence-driven outline.",
  },
  {
    id: "abstract-led-outline-produced-and-independently-reviewed",
    milestoneSequence: 15,
    sourceSequence: 29,
    sourceDate: NETWORK_PHARMACOLOGY_SOURCE_DAY,
    meaning:
      "The evidence-driven outline is produced from the accepted boundary and independently stress-tested without writing manuscript prose.",
  },
  {
    id: "outline-gate-requested",
    milestoneSequence: 16,
    sourceSequence: 29,
    sourceDate: NETWORK_PHARMACOLOGY_SOURCE_DAY,
    meaning:
      "The reviewed outline is presented to the human researcher for a separate argument-route decision.",
  },
  {
    id: "outline-v1-amendment-requested",
    milestoneSequence: 17,
    sourceSequence: 30,
    sourceDate: NETWORK_PHARMACOLOGY_SOURCE_DAY,
    meaning:
      "The researcher returns the conceptual outline for revision because it is not yet a paragraph-level manuscript writing plan.",
  },
  {
    id: "manuscript-ready-outline-v2-produced-and-reviewed",
    milestoneSequence: 18,
    sourceSequence: 31,
    sourceDate: NETWORK_PHARMACOLOGY_REVISION_DAY,
    meaning:
      "The paragraph-level manuscript outline v2 is produced and independently reviewed after substantive corrections; this review does not approve the argument route.",
  },
  {
    id: "revised-outline-gate-requested",
    milestoneSequence: 19,
    sourceSequence: 31,
    sourceDate: NETWORK_PHARMACOLOGY_REVISION_DAY,
    meaning:
      "The exact v2 outline and independent review are presented to the researcher for a new decision without starting manuscript prose.",
  },
]);

export const Q4_FULL_TEXT_CANDIDATE_PMIDS = Object.freeze([
  "42173417",
  "41974236",
  "41935649",
  "41924844",
  "42083411",
  "41970211",
  "41977470",
  "41389885",
  "41106101",
  "40961540",
  "38663783",
  "38929100",
  "34464700",
]);

export const LITERATURE_STAGE_3_EVIDENCE_RECORDS = Object.freeze([
  {
    pmid: "34464700",
    accessLevel: "abstract_only",
    sha256: "294a41f4c04dc028ae66446e52c2de1e11f7e01a30a41e6714097cb6e646885f",
  },
  {
    pmid: "38663783",
    accessLevel: "abstract_only",
    sha256: "a61e7c664c7700aea79b3f62f82eed340278041947f86d0ea1f6b6d346c60c44",
  },
  {
    pmid: "38929100",
    accessLevel: "full_text_and_supplement",
    sha256: "090fc255c047d2d8594387c712c5a3531050a527ffcbe58e06b56acbd7cb34df",
  },
  {
    pmid: "40961540",
    accessLevel: "abstract_only",
    sha256: "3e2ae7cef1035935f36bf26ec39b640dcf5ecba8709546801c3de178218c4ead",
  },
  {
    pmid: "41106101",
    accessLevel: "abstract_only",
    sha256: "f09d012fe4d485f225e27302097b1ac90220d2ee48318310796c00c6b94fa6c3",
  },
  {
    pmid: "41389885",
    accessLevel: "abstract_only",
    sha256: "ae88f6836d1f4f987410030b3d00604b30ab86812757f09a25951a2828543b7b",
  },
  {
    pmid: "41924844",
    accessLevel: "abstract_only",
    sha256: "0609092f5574d00ec578b10340f480d5d51793b1b5e13833a9b5cc92510ba0a4",
  },
  {
    pmid: "41935649",
    accessLevel: "abstract_only",
    sha256: "e4827dfec9daf83ff88b54e5830100231ebea131762ff35dd3210dbc41d6a445",
  },
  {
    pmid: "41970211",
    accessLevel: "full_text_and_supplement",
    sha256: "f6edc3e7291bb7ff9a338fc80a15d92c13b8fb8365f0a04fe549113f687b3233",
  },
  {
    pmid: "41974236",
    accessLevel: "abstract_only",
    sha256: "a4407bdb3bfea2efcc87a677cbabb9d33be7931a5cdafe7bb7ad8b4dee4b40b4",
  },
  {
    pmid: "41977470",
    accessLevel: "full_text_and_supplement",
    sha256: "79b2966c8784820703423ea89bb6eb88020d4e94a48c4a354e89c7367e67c99a",
  },
  {
    pmid: "42083411",
    accessLevel: "abstract_only",
    sha256: "f061deb57503bb7bf885498a3d10ca4a3c9749ad4a60f5a489f82d950d345e7f",
  },
  {
    pmid: "42173417",
    accessLevel: "abstract_only_official_OA_metadata_but_full_text_not_retrieved",
    sha256: "0c9a9414f364b733d3cde4e14e31a172b5afd22a82c290b794310814de07e3e9",
  },
]);

const Q4_MACHINE_GRADES = Object.freeze([
  "A",
  "A",
  "A",
  "A",
  "A",
  "A",
  "A",
  "A",
  "A",
  "A",
  "B",
  "B",
  "A",
]);

const ACTORS = Object.freeze({
  system: Object.freeze({
    id: "network-pharmacology-migration",
    role: "system_migrator",
    kind: "system",
  }),
  human: Object.freeze({
    id: "human-researcher",
    role: "human_researcher",
    kind: "human",
  }),
  agent: Object.freeze({
    id: "research-orchestrator",
    role: "research_orchestrator",
    kind: "agent",
  }),
  evidenceVerifier: Object.freeze({
    id: "independent-evidence-verifier",
    role: "independent_evidence_verifier",
    kind: "agent",
  }),
  evidenceReviewer: Object.freeze({
    id: "independent-evidence-reviewer",
    role: "independent_evidence_reviewer",
    kind: "agent",
  }),
  argumentArchitect: Object.freeze({
    id: "evidence-outline-architect",
    role: "argument_architect",
    kind: "agent",
  }),
  methodReviewer: Object.freeze({
    id: "evidence-outline-method-reviewer",
    role: "method_reviewer",
    kind: "agent",
  }),
  outlineVerifier: Object.freeze({
    id: "independent-outline-verifier",
    role: "outline_verifier",
    kind: "agent",
  }),
  outlineReviewer: Object.freeze({
    id: "independent-outline-reviewer",
    role: "independent_outline_reviewer",
    kind: "agent",
  }),
});

function milestone(sequence) {
  return NETWORK_PHARMACOLOGY_MILESTONES_V1.find(
    (item) => item.milestoneSequence === sequence,
  );
}

function sourceRef(sequence, path, sha256Value, extra = {}) {
  const item = milestone(sequence);
  return {
    occurredOn: item.sourceDate,
    occurredAtPrecision: "day",
    sourceSequence: item.sourceSequence,
    milestoneSequence: item.milestoneSequence,
    path,
    sha256: sha256Value,
    ...extra,
  };
}

function interactionSourceRef(sequence, extra = {}) {
  return sourceRef(sequence, INTERACTION_LOG, INTERACTION_LOG_SHA256, extra);
}

function legacyArtifact({
  id,
  type,
  lineageId,
  version,
  contentHash,
  status,
  sourceRef: artifactSourceRef,
  producedByNodeId = null,
  inputArtifactRefs = [],
  ...extra
}) {
  return {
    id,
    type,
    lineageId,
    version,
    contentHash,
    status,
    sourceRef: artifactSourceRef,
    producedByNodeId,
    inputArtifactRefs,
    ...extra,
  };
}

function q4CandidateArtifacts() {
  const sourcePath =
    `${EXAMPLE_ROOT}/network-pharmacology-literature-stage-2-first100-feedback-v7-2026-08-10.tsv`;
  const sourceSha256 =
    "e6066e93eaefa6a947fbc4b19a4d04d3cf9f52f1defef8d953024e233e06e6d0";
  return Q4_FULL_TEXT_CANDIDATE_PMIDS.map((pmid, index) =>
    legacyArtifact({
      id: `PMID-${pmid}`,
      type: "LiteratureCandidate",
      lineageId: `pubmed-${pmid}`,
      version: 1,
      contentHash: sha256({
        pmid,
        pathId: "Q4_exposure_target_phenotype_chain",
        rank: index + 1,
        machineGrade: Q4_MACHINE_GRADES[index],
        sourceSha256,
      }),
      status: ARTIFACT_STATES.CANDIDATE,
      sourceRef: sourceRef(6, sourcePath, sourceSha256, {
        locator: {
          pathId: "Q4_exposure_target_phenotype_chain",
          rank: index + 1,
          pmid,
        },
      }),
      producedByNodeId: "calibrate_focused_search",
      inputArtifactRefs: ["NP-STAGE2-SEARCH-RUN-V7"],
      machineGrade: Q4_MACHINE_GRADES[index],
      evidenceUse: "abstract_screening_candidate_with_reported_limits",
      humanInclusionDecision: "not_made",
    }),
  );
}

function stage3EvidenceRecordArtifacts({ libraryArtifactIds }) {
  return LITERATURE_STAGE_3_EVIDENCE_RECORDS.map((record) => {
    const sourcePath =
      `${EXAMPLE_ROOT}/network-pharmacology-evidence-record-PMID${record.pmid}-v1-2026-08-10.md`;
    return legacyArtifact({
      id: `NP-LIT3-EVIDENCE-PMID-${record.pmid}`,
      type: "EvidenceRecord",
      lineageId: `NP-LIT3-EVIDENCE-PMID-${record.pmid}`,
      version: 1,
      contentHash: record.sha256,
      status: ARTIFACT_STATES.ACCEPTED,
      sourceRef: sourceRef(12, sourcePath, record.sha256, {
        pmid: record.pmid,
        accessLevel: record.accessLevel,
        extractionMeaning:
          "Accepted as a bounded extraction of the material actually read in this run.",
      }),
      producedByNodeId: "extract_evidence",
      inputArtifactRefs: libraryArtifactIds,
      accessLevel: record.accessLevel,
      humanInclusionDecision: "not_made",
    });
  });
}

export function buildNetworkPharmacologyReplayV1() {
  const machine = REVIEW_RESEARCH_MACHINE_V1;
  const projectId = NETWORK_PHARMACOLOGY_PROJECT_ID;
  const events = [];
  let commandOrdinal = 0;

  function dispatch(type, milestoneSequence, actor, extra = {}) {
    commandOrdinal += 1;
    const item =
      milestoneSequence === 0
        ? {
            id: "replay-project-created",
            sourceDate: NETWORK_PHARMACOLOGY_SOURCE_DAY,
          }
        : milestone(milestoneSequence);
    const result = dispatchCommand(machine, events, {
      type,
      commandId: `network-pharmacology-v1-${String(commandOrdinal).padStart(2, "0")}-${type.toLowerCase()}`,
      projectId,
      expectedVersion: events.length,
      occurredAt: item.sourceDate,
      actor,
      correlationId: item.id,
      causationId:
        milestoneSequence === 0
          ? null
          : `source-sequence-${item.sourceSequence}-milestone-${milestoneSequence}`,
      sourceContext: {
        occurredOn: item.sourceDate,
        occurredAtPrecision: "day",
        sourceSequence:
          milestoneSequence === 0 ? 0 : item.sourceSequence,
        milestoneSequence,
      },
      ...extra,
    });
    events.push(...result.newEvents);
    return result.state;
  }

  dispatch("CREATE_PROJECT", 0, ACTORS.human, {
    completionProfileId: "evidence_brief",
  });

  const g1Artifacts = [
    legacyArtifact({
      id: "NP-G1-LIB-001",
      type: "OrientationCorpusManifest",
      lineageId: "NP-G1-LIB",
      version: 1,
      contentHash:
        "fca6fd5cce0960abbf9b97c00dca0b8a28db9954bbfac94169eda4d12c05b0fa",
      status: ARTIFACT_STATES.ACCEPTED,
      sourceRef: sourceRef(
        1,
        `${EXAMPLE_ROOT}/network-pharmacology-g1-library-manifest-v1-2026-08-10.yaml`,
        "fca6fd5cce0960abbf9b97c00dca0b8a28db9954bbfac94169eda4d12c05b0fa",
        { objectId: "NP-G1-LIB-001" },
      ),
      producedByNodeId: "build_orientation_corpus",
    }),
    legacyArtifact({
      id: "NP-G1-LIB-002",
      type: "OrientationCorpusManifest",
      lineageId: "NP-G1-LIB",
      version: 2,
      contentHash:
        "f1490595d7947251481eb22c08b7b5a1238925047d647573662a36a4fa0f721a",
      status: ARTIFACT_STATES.ACCEPTED,
      sourceRef: sourceRef(
        1,
        `${EXAMPLE_ROOT}/network-pharmacology-g1-library-manifest-v2-2026-08-10.yaml`,
        "f1490595d7947251481eb22c08b7b5a1238925047d647573662a36a4fa0f721a",
        { objectId: "NP-G1-LIB-002", scope: "PubMed_only_methodological_orientation" },
      ),
      producedByNodeId: "build_orientation_corpus",
    }),
    legacyArtifact({
      id: "NP-G1-20260810-v7",
      type: "LandscapeProfile",
      lineageId: "NP-G1-STAGEPACK",
      version: 7,
      contentHash:
        "19bbee7677225ffbd1a1f7ba3908280ca3ddccd337f913f87116717cada5e584",
      status: ARTIFACT_STATES.ACCEPTED,
      sourceRef: sourceRef(
        1,
        `${EXAMPLE_ROOT}/network-pharmacology-g1-stagepack-v7-2026-08-10.yaml`,
        "19bbee7677225ffbd1a1f7ba3908280ca3ddccd337f913f87116717cada5e584",
        { objectId: "NP-G1-20260810-v7" },
      ),
      producedByNodeId: "profile_landscape",
      inputArtifactRefs: [],
    }),
    legacyArtifact({
      id: "NP-G1-20260810-v8",
      type: "LandscapeProfile",
      lineageId: "NP-G1-STAGEPACK",
      version: 8,
      contentHash:
        "3e99f1006ce7de256f21d83837ae3cedec043ce7917954553e3c4fb0bf58d83d",
      status: ARTIFACT_STATES.ACCEPTED,
      sourceRef: sourceRef(
        1,
        `${EXAMPLE_ROOT}/network-pharmacology-g1-stagepack-v8-2026-08-10.yaml`,
        "3e99f1006ce7de256f21d83837ae3cedec043ce7917954553e3c4fb0bf58d83d",
        {
          objectId: "NP-G1-20260810-v8",
          scope: "PubMed_only_methodological_orientation",
        },
      ),
      producedByNodeId: "profile_landscape",
      inputArtifactRefs: ["NP-G1-LIB-002"],
    }),
  ];

  const derivedHistoricalArtifact = ({
    id,
    type,
    producedByNodeId,
    inputArtifactRefs = [],
    sourceSequence,
    meaning,
  }) =>
    legacyArtifact({
      id,
      type,
      lineageId: id,
      version: 1,
      contentHash: sha256({ id, type, sourceSequence, meaning }),
      status: ARTIFACT_STATES.ACCEPTED,
      sourceRef: {
        occurredOn: sourceSequence === 4 ? "2026-08-09" : "2026-08-10",
        occurredAtPrecision: "day",
        sourceSequence,
        path: INTERACTION_LOG,
        sha256: INTERACTION_LOG_SHA256,
        locator: `event-${sourceSequence}`,
        replayLayerDerivedObject: true,
        meaning,
      },
      producedByNodeId,
      inputArtifactRefs,
    });

  g1Artifacts.push(
    derivedHistoricalArtifact({
      id: "NP-HIST-RESEARCH-INTENT-001",
      type: "ResearchIntent",
      producedByNodeId: "capture_intent",
      sourceSequence: 4,
      meaning: "The research intent recorded before the first scope decision.",
    }),
    derivedHistoricalArtifact({
      id: "NP-HIST-QUESTION-CANDIDATE-001",
      type: "ResearchQuestionCandidate",
      producedByNodeId: "clarify_question",
      inputArtifactRefs: ["NP-HIST-RESEARCH-INTENT-001"],
      sourceSequence: 4,
      meaning: "The bounded network-pharmacology methodological question.",
    }),
    derivedHistoricalArtifact({
      id: "NP-HIST-SCOPE-BOUNDARY-001",
      type: "ScopeBoundary",
      producedByNodeId: "clarify_question",
      inputArtifactRefs: ["NP-HIST-RESEARCH-INTENT-001"],
      sourceSequence: 4,
      meaning: "The explicit in-scope and out-of-scope research boundary.",
    }),
    derivedHistoricalArtifact({
      id: "NP-HIST-RESEARCH-BRIEF-001",
      type: "ResearchBrief",
      producedByNodeId: "approve_scope",
      inputArtifactRefs: [
        "NP-HIST-QUESTION-CANDIDATE-001",
        "NP-HIST-SCOPE-BOUNDARY-001",
      ],
      sourceSequence: 4,
      meaning: "The human-approved research brief reconstructed from event 4.",
    }),
    derivedHistoricalArtifact({
      id: "NP-HIST-SCOPE-DECISION-001",
      type: "ScopeDecision",
      producedByNodeId: "approve_scope",
      inputArtifactRefs: [
        "NP-HIST-QUESTION-CANDIDATE-001",
        "NP-HIST-SCOPE-BOUNDARY-001",
      ],
      sourceSequence: 4,
      meaning: "The attributed human scope decision from event 4.",
    }),
    derivedHistoricalArtifact({
      id: "NP-HIST-ORIENTATION-MATRIX-001",
      type: "OrientationConceptMatrix",
      producedByNodeId: "design_orientation_search",
      inputArtifactRefs: [
        "NP-HIST-RESEARCH-BRIEF-001",
        "NP-HIST-SCOPE-DECISION-001",
      ],
      sourceSequence: 12,
      meaning: "The concepts used for the PubMed-only orientation search.",
    }),
    derivedHistoricalArtifact({
      id: "NP-HIST-ORIENTATION-PROTOCOL-001",
      type: "OrientationSearchProtocol",
      producedByNodeId: "design_orientation_search",
      inputArtifactRefs: [
        "NP-HIST-RESEARCH-BRIEF-001",
        "NP-HIST-SCOPE-DECISION-001",
      ],
      sourceSequence: 12,
      meaning: "The executed orientation-search protocol lineage.",
    }),
    derivedHistoricalArtifact({
      id: "NP-HIST-ORIENTATION-RUN-001",
      type: "SearchRunSnapshot",
      producedByNodeId: "run_pilot_search",
      inputArtifactRefs: ["NP-HIST-ORIENTATION-PROTOCOL-001"],
      sourceSequence: 12,
      meaning: "The saved PubMed orientation-search execution fact.",
    }),
    derivedHistoricalArtifact({
      id: "NP-HIST-ORIENTATION-CALIBRATION-001",
      type: "OrientationCalibrationReport",
      producedByNodeId: "calibrate_search",
      inputArtifactRefs: [
        "NP-HIST-ORIENTATION-RUN-001",
        "NP-HIST-ORIENTATION-PROTOCOL-001",
      ],
      sourceSequence: 12,
      meaning: "The orientation-search calibration record.",
    }),
    derivedHistoricalArtifact({
      id: "NP-HIST-FROZEN-ORIENTATION-PROTOCOL-001",
      type: "FrozenOrientationSearchProtocol",
      producedByNodeId: "calibrate_search",
      inputArtifactRefs: [
        "NP-HIST-ORIENTATION-RUN-001",
        "NP-HIST-ORIENTATION-PROTOCOL-001",
      ],
      sourceSequence: 12,
      meaning: "The historical PubMed-only orientation protocol snapshot.",
    }),
    derivedHistoricalArtifact({
      id: "NP-HIST-ORIENTATION-SOURCE-001",
      type: "OrientationSourceSnapshot",
      producedByNodeId: "build_orientation_corpus",
      inputArtifactRefs: ["NP-HIST-FROZEN-ORIENTATION-PROTOCOL-001"],
      sourceSequence: 12,
      meaning: "The source snapshot paired with orientation corpus LIB-002.",
    }),
    derivedHistoricalArtifact({
      id: "NP-HIST-REVIEW-ANGLE-CANDIDATE-001",
      type: "ReviewAngleCandidate",
      producedByNodeId: "profile_landscape",
      inputArtifactRefs: [
        "NP-G1-LIB-002",
        "NP-HIST-ORIENTATION-SOURCE-001",
      ],
      sourceSequence: 12,
      meaning: "The methodological-orientation review angle selected by the user.",
    }),
    derivedHistoricalArtifact({
      id: "NP-HIST-REVIEW-ANGLE-DECISION-001",
      type: "ReviewAngleDecision",
      producedByNodeId: "approve_review_angle",
      inputArtifactRefs: [
        "NP-G1-20260810-v8",
        "NP-HIST-REVIEW-ANGLE-CANDIDATE-001",
      ],
      sourceSequence: 12,
      meaning: "The attributed PubMed-only review-angle decision.",
    }),
    derivedHistoricalArtifact({
      id: "NP-HIST-FOCUSED-BRIEF-001",
      type: "FocusedResearchBrief",
      producedByNodeId: "approve_review_angle",
      inputArtifactRefs: [
        "NP-G1-20260810-v8",
        "NP-HIST-REVIEW-ANGLE-CANDIDATE-001",
      ],
      sourceSequence: 12,
      meaning: "The focused methodological brief entering precise retrieval.",
    }),
  );

  const importedG1State = dispatch("IMPORT_LEGACY_CHECKPOINT", 1, ACTORS.system, {
    artifacts: g1Artifacts,
    nodes: [],
    gates: [],
  });
  dispatch("SUPERSEDE_ARTIFACT", 1, ACTORS.system, {
    artifactId: "NP-G1-LIB-001",
    supersededBy: "NP-G1-LIB-002",
    reason: "The scoped PubMed-only authority was recorded as LIB-002.",
  });
  const fingerprintFromImportedState = (artifactIds) =>
    sha256(
      artifactIds
        .map((artifactId) => importedG1State.artifacts[artifactId])
        .map((artifact) => ({
          artifactId: artifact.id,
          contentHash: artifact.contentHash,
          manifestHash: artifact.manifestHash,
          version: artifact.version,
        }))
        .sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
    );
  dispatch("SUPERSEDE_ARTIFACT", 1, ACTORS.system, {
    artifactId: "NP-G1-20260810-v7",
    supersededBy: "NP-G1-20260810-v8",
    reason: "StagePack v8 records the user's scoped PubMed-only decision.",
  });
  const legacyHumanDecisionReceipts = {
    approve_scope: {
      decidedBy: {
        actorId: ACTORS.human.id,
        actorRole: ACTORS.human.role,
        actorKind: ACTORS.human.kind,
      },
      decidedOn: "2026-08-09",
      decidedAtPrecision: "day",
      sourceSequence: 4,
      reason:
        "The user explicitly approved the middle-out route and authorized entry into the literature-search stage.",
      fingerprint: fingerprintFromImportedState([
        "NP-HIST-QUESTION-CANDIDATE-001",
        "NP-HIST-SCOPE-BOUNDARY-001",
      ]),
      sourceRef: {
        occurredOn: "2026-08-09",
        occurredAtPrecision: "day",
        sourceSequence: 4,
        path: INTERACTION_LOG,
        sha256: INTERACTION_LOG_SHA256,
        locator: "event-4",
      },
    },
    approve_review_angle: {
      decidedBy: {
        actorId: ACTORS.human.id,
        actorRole: ACTORS.human.role,
        actorKind: ACTORS.human.kind,
      },
      decidedOn: NETWORK_PHARMACOLOGY_SOURCE_DAY,
      decidedAtPrecision: "day",
      sourceSequence: 12,
      reason:
        "The user explicitly authorized a PubMed-only methodological orientation after declining the blocked Scopus and CNKI paths.",
      fingerprint: fingerprintFromImportedState([
        "NP-G1-20260810-v8",
        "NP-HIST-REVIEW-ANGLE-CANDIDATE-001",
      ]),
      sourceRef: interactionSourceRef(1, { locator: "event-12" }),
    },
  };
  const acceptedArtifactsByLegacyNode = {
    capture_intent: ["NP-HIST-RESEARCH-INTENT-001"],
    clarify_question: [
      "NP-HIST-QUESTION-CANDIDATE-001",
      "NP-HIST-SCOPE-BOUNDARY-001",
    ],
    approve_scope: [
      "NP-HIST-RESEARCH-BRIEF-001",
      "NP-HIST-SCOPE-DECISION-001",
    ],
    design_orientation_search: [
      "NP-HIST-ORIENTATION-MATRIX-001",
      "NP-HIST-ORIENTATION-PROTOCOL-001",
    ],
    run_pilot_search: ["NP-HIST-ORIENTATION-RUN-001"],
    calibrate_search: [
      "NP-HIST-ORIENTATION-CALIBRATION-001",
      "NP-HIST-FROZEN-ORIENTATION-PROTOCOL-001",
    ],
    build_orientation_corpus: [
      "NP-G1-LIB-002",
      "NP-HIST-ORIENTATION-SOURCE-001",
    ],
    profile_landscape: [
      "NP-G1-20260810-v8",
      "NP-HIST-REVIEW-ANGLE-CANDIDATE-001",
    ],
    approve_review_angle: [
      "NP-HIST-REVIEW-ANGLE-DECISION-001",
      "NP-HIST-FOCUSED-BRIEF-001",
    ],
  };
  const gateInputsByLegacyNode = {
    approve_scope: [
      "NP-HIST-QUESTION-CANDIDATE-001",
      "NP-HIST-SCOPE-BOUNDARY-001",
    ],
    approve_review_angle: [
      "NP-G1-20260810-v8",
      "NP-HIST-REVIEW-ANGLE-CANDIDATE-001",
    ],
  };
  dispatch("IMPORT_LEGACY_CHECKPOINT", 1, ACTORS.system, {
    artifacts: [],
    nodes: [
      "capture_intent",
      "clarify_question",
      "approve_scope",
      "design_orientation_search",
      "run_pilot_search",
      "calibrate_search",
      "build_orientation_corpus",
      "profile_landscape",
      "approve_review_angle",
    ].map((nodeId) => ({
      nodeId,
      state: EXECUTION_STATES.ACCEPTED,
      artifactIds: acceptedArtifactsByLegacyNode[nodeId],
      ...(gateInputsByLegacyNode[nodeId]
        ? { inputArtifactIds: gateInputsByLegacyNode[nodeId] }
        : {}),
      sourceRef: interactionSourceRef(1, { nodeId }),
      ...(legacyHumanDecisionReceipts[nodeId]
        ? { decisionReceipt: legacyHumanDecisionReceipts[nodeId] }
        : {}),
    })),
    gates: [],
  });

  const oldG2Artifacts = [
    legacyArtifact({
      id: "NP-G2-PROTOCOL-001",
      type: "FocusedSearchProtocol",
      lineageId: "NP-G2-PROTOCOL",
      version: 1,
      contentHash:
        "aa26ca24abc55029d24e967e6961158f5d56d7f4c0594c5b3431bb9330429880",
      status: ARTIFACT_STATES.CANDIDATE,
      sourceRef: sourceRef(
        2,
        `${EXAMPLE_ROOT}/network-pharmacology-g2-protocol-v1-2026-08-10.md`,
        "aa26ca24abc55029d24e967e6961158f5d56d7f4c0594c5b3431bb9330429880",
        { objectId: "NP-G2-PROTOCOL-001" },
      ),
      producedByNodeId: null,
      inputArtifactRefs: ["NP-G1-20260810-v8", "NP-G1-LIB-002"],
      legacyWorkflowLabel: "G2 protocol formation",
    }),
    legacyArtifact({
      id: "NP-G2-OUTLINE-001",
      type: "EvidenceDrivenOutline",
      lineageId: "NP-G2-OUTLINE",
      version: 1,
      contentHash:
        "0752e80d39c35cd72c5b111442dbef8a0949bf2d97b89b98e01526b4adb045ae",
      status: ARTIFACT_STATES.CANDIDATE,
      sourceRef: sourceRef(
        2,
        `${EXAMPLE_ROOT}/network-pharmacology-g2-evidence-outline-v1-2026-08-10.yaml`,
        "0752e80d39c35cd72c5b111442dbef8a0949bf2d97b89b98e01526b4adb045ae",
        { objectId: "NP-G2-OUTLINE-001" },
      ),
      producedByNodeId: "derive_outline",
      inputArtifactRefs: ["NP-G2-PROTOCOL-001"],
    }),
    legacyArtifact({
      id: "NP-G2-CHART-001",
      type: "PilotChartingSchema",
      lineageId: "NP-G2-CHART",
      version: 1,
      contentHash:
        "aaff5851e4dbb0d7791c5361ade964b01e4cce3252fe6cf6a8e96c239e559806",
      status: ARTIFACT_STATES.CANDIDATE,
      sourceRef: sourceRef(
        2,
        `${EXAMPLE_ROOT}/network-pharmacology-g2-charting-schema-v1-2026-08-10.yaml`,
        "aaff5851e4dbb0d7791c5361ade964b01e4cce3252fe6cf6a8e96c239e559806",
        { objectId: "NP-G2-CHART-001" },
      ),
      producedByNodeId: "extract_evidence",
      inputArtifactRefs: ["NP-G2-PROTOCOL-001"],
    }),
    legacyArtifact({
      id: "NP-G2-BRIEF-001",
      type: "FocusedResearchBrief",
      lineageId: "NP-READER-BRIEF",
      version: 1,
      contentHash:
        "b68796ff1adfbd55dcb5e643073c1784bb30bb5b1f45b2a2bbb9bddb0c947c7d",
      status: ARTIFACT_STATES.CANDIDATE,
      sourceRef: sourceRef(
        2,
        `${EXAMPLE_ROOT}/network-pharmacology-g2-user-brief-v1-2026-08-10.md`,
        "b68796ff1adfbd55dcb5e643073c1784bb30bb5b1f45b2a2bbb9bddb0c947c7d",
        { objectId: "NP-G2-BRIEF-001" },
      ),
      producedByNodeId: "design_focused_search",
      inputArtifactRefs: [],
    }),
    legacyArtifact({
      id: "NP-G2-20260810-v1",
      type: "StagePack",
      lineageId: "NP-G2-STAGEPACK",
      version: 1,
      contentHash:
        "43c237d064d2cf909760aa75961e9fdedcc17ec66b5a11b10473245e06cddbf8",
      status: ARTIFACT_STATES.CANDIDATE,
      sourceRef: sourceRef(
        2,
        `${EXAMPLE_ROOT}/network-pharmacology-g2-stagepack-v1-2026-08-10.yaml`,
        "43c237d064d2cf909760aa75961e9fdedcc17ec66b5a11b10473245e06cddbf8",
        { objectId: "NP-G2-20260810-v1" },
      ),
      producedByNodeId: "derive_outline",
      inputArtifactRefs: [
        "NP-G2-PROTOCOL-001",
        "NP-G2-OUTLINE-001",
        "NP-G2-CHART-001",
        "NP-G2-BRIEF-001",
      ],
    }),
  ];

  dispatch("IMPORT_LEGACY_CHECKPOINT", 2, ACTORS.system, {
    artifacts: oldG2Artifacts,
    nodes: [],
    gates: [],
  });

  dispatch("IMPORT_LEGACY_CHECKPOINT", 3, ACTORS.system, {
    artifacts: [
      legacyArtifact({
        id: "NP-G2-REVIEW-001",
        type: "IndependentReview",
        lineageId: "NP-G2-REVIEW",
        version: 1,
        contentHash:
          "df27625c2ed97f6b5b7eff6615b469d3cd17ca2b352fc1a6a39a15e43c16b7f4",
        status: ARTIFACT_STATES.VERIFIED,
        sourceRef: sourceRef(
          3,
          `${EXAMPLE_ROOT}/network-pharmacology-g2-independent-review-v1-2026-08-10.yaml`,
          "df27625c2ed97f6b5b7eff6615b469d3cd17ca2b352fc1a6a39a15e43c16b7f4",
          {
            objectId: "NP-G2-REVIEW-001",
            limitation:
              "Agent review does not substitute for a human PI, PRESS, or two human reviewers.",
          },
        ),
        reviewVerdict: "pass",
        humanApprovalEffect: "none",
      }),
      legacyArtifact({
        id: "NP-G2-REVIEW-APPLICABILITY-001",
        type: "ReviewApplicability",
        lineageId: "NP-G2-REVIEW-APPLICABILITY",
        version: 1,
        contentHash: sha256({
          reviewId: "NP-G2-REVIEW-001",
          reviewedPackageId: "NP-G2-20260810-v1",
        }),
        status: ARTIFACT_STATES.VERIFIED,
        sourceRef: interactionSourceRef(3, {
          objectId: "NP-G2-REVIEW-APPLICABILITY-001",
        }),
        inputArtifactRefs: ["NP-G2-20260810-v1"],
      }),
    ],
    nodes: [],
    gates: [],
  });

  dispatch("IMPORT_LEGACY_CHECKPOINT", 4, ACTORS.system, {
    artifacts: [],
    nodes: [],
    gates: [
      {
        id: "NP-G2-DEC-PENDING-001",
        nodeId: "approve_outline",
        status: GATE_STATES.PENDING,
        artifactIds: [
          "NP-G2-20260810-v1",
          "NP-G2-PROTOCOL-001",
          "NP-G2-CHART-001",
        ],
        requestedBy: {
          actorId: ACTORS.agent.id,
          actorRole: ACTORS.agent.role,
          actorKind: ACTORS.agent.kind,
        },
        requestedAt: NETWORK_PHARMACOLOGY_SOURCE_DAY,
        sourceRef: sourceRef(
          4,
          `${EXAMPLE_ROOT}/network-pharmacology-g2-stagepack-v1-2026-08-10.yaml`,
          "43c237d064d2cf909760aa75961e9fdedcc17ec66b5a11b10473245e06cddbf8",
          { objectId: "NP-G2-DEC-PENDING-001" },
        ),
        legacyWorkflowLabel: "G2 human decision",
      },
    ],
  });

  dispatch("RECORD_HUMAN_CORRECTION", 5, ACTORS.human, {
    correctionId: "NP-CORRECTION-EVENT-15",
    reason:
      "The G2 package was prepared before focused-search calibration and literature-library freeze; return to the valid research sequence.",
    artifactIds: [
      "NP-G2-PROTOCOL-001",
      "NP-G2-OUTLINE-001",
      "NP-G2-CHART-001",
      "NP-G2-20260810-v1",
    ],
    focusNodeId: "freeze_library",
  });

  const stage2SummaryPath =
    `${EXAMPLE_ROOT}/network-pharmacology-literature-stage-2-first100-feedback-summary-v7-2026-08-10.json`;
  const stage2SummarySha256 =
    "ccf484951d431358304b0393241415e3bd82a2e2281726b47071cc1aef35a80c";
  const stage2TsvPath =
    `${EXAMPLE_ROOT}/network-pharmacology-literature-stage-2-first100-feedback-v7-2026-08-10.tsv`;
  const stage2TsvSha256 =
    "e6066e93eaefa6a947fbc4b19a4d04d3cf9f52f1defef8d953024e233e06e6d0";
  const humanReviewPath =
    `${EXAMPLE_ROOT}/network-pharmacology-literature-stage-2-human-review-note-v1-2026-08-10.md`;
  const humanReviewSha256 =
    "6805772d68b94f88e12ca0ded1bacfa97ca3a794e5f129591531d39468b7f254";
  const readerReportPath =
    `${EXAMPLE_ROOT}/network-pharmacology-literature-stage-2-reader-report-v1-2026-08-10.md`;
  const readerReportSha256 =
    "dded6ca17b6b5806ef5a6522c59a77a1222385c38866070b2f19742ec68a409f";

  dispatch("IMPORT_LEGACY_CHECKPOINT", 6, ACTORS.system, {
    artifacts: [
      legacyArtifact({
        id: "NP-STAGE2-FOCUSED-PROTOCOL-V7",
        type: "FrozenSearchProtocol",
        lineageId: "NP-STAGE2-FOCUSED-PROTOCOL",
        version: 7,
        contentHash: stage2SummarySha256,
        status: ARTIFACT_STATES.ACCEPTED,
        sourceRef: sourceRef(6, stage2SummaryPath, stage2SummarySha256, {
          strategyVersion: "v7_final_candidate_after_manual_title_feedback",
          acceptanceMeaning:
            "Accepted as the reproducible calibration protocol, not as literature inclusion.",
        }),
        producedByNodeId: "calibrate_focused_search",
        inputArtifactRefs: ["NP-G1-20260810-v8", "NP-G1-LIB-002"],
      }),
      legacyArtifact({
        id: "NP-STAGE2-SEARCH-RUN-V7",
        type: "FocusedSearchRunSnapshot",
        lineageId: "NP-STAGE2-SEARCH-RUN",
        version: 7,
        contentHash: stage2TsvSha256,
        status: ARTIFACT_STATES.ACCEPTED,
        sourceRef: sourceRef(6, stage2TsvPath, stage2TsvSha256, {
          database: "PubMed",
          acceptanceMeaning:
            "Accepted only as an immutable execution snapshot and result set.",
        }),
        producedByNodeId: "calibrate_focused_search",
        inputArtifactRefs: ["NP-STAGE2-FOCUSED-PROTOCOL-V7"],
      }),
      legacyArtifact({
        id: "NP-STAGE2-CALIBRATION-V7",
        type: "FocusedCalibrationReport",
        lineageId: "NP-STAGE2-CALIBRATION",
        version: 7,
        contentHash: humanReviewSha256,
        status: ARTIFACT_STATES.ACCEPTED,
        sourceRef: sourceRef(6, humanReviewPath, humanReviewSha256, {
          warning:
            "Machine grades support search calibration only; full-text human review is still required.",
        }),
        producedByNodeId: "calibrate_focused_search",
        inputArtifactRefs: ["NP-STAGE2-SEARCH-RUN-V7"],
      }),
      legacyArtifact({
        id: "NP-STAGE2-READER-REPORT-001",
        type: "FocusedResearchBrief",
        lineageId: "NP-READER-BRIEF",
        version: 2,
        contentHash: readerReportSha256,
        status: ARTIFACT_STATES.VERIFIED,
        sourceRef: sourceRef(6, readerReportPath, readerReportSha256, {
          candidateBoundary:
            "The 13 Q4 papers are candidates and do not establish complete mechanism chains.",
        }),
        inputArtifactRefs: [
          "NP-STAGE2-SEARCH-RUN-V7",
          "NP-STAGE2-CALIBRATION-V7",
        ],
      }),
      ...q4CandidateArtifacts(),
    ],
    nodes: [],
    gates: [],
  });
  dispatch("SUPERSEDE_ARTIFACT", 6, ACTORS.system, {
    artifactId: "NP-G2-BRIEF-001",
    supersededBy: "NP-STAGE2-READER-REPORT-001",
    reason:
      "The reader-facing stage-two report replaces the premature G2 technical brief.",
  });
  dispatch("IMPORT_LEGACY_CHECKPOINT", 6, ACTORS.system, {
    artifacts: [],
    nodes: [
      {
        nodeId: "design_focused_search",
        state: EXECUTION_STATES.ACCEPTED,
        artifactIds: ["NP-STAGE2-FOCUSED-PROTOCOL-V7"],
        sourceRef: interactionSourceRef(6, {
          nodeId: "design_focused_search",
        }),
      },
      {
        nodeId: "calibrate_focused_search",
        state: EXECUTION_STATES.ACCEPTED,
        artifactIds: [
          "NP-STAGE2-FOCUSED-PROTOCOL-V7",
          "NP-STAGE2-SEARCH-RUN-V7",
          "NP-STAGE2-CALIBRATION-V7",
        ],
        sourceRef: interactionSourceRef(6, {
          nodeId: "calibrate_focused_search",
        }),
      },
    ],
    gates: [],
  });
  dispatch("READY_NODE", 6, ACTORS.agent, { nodeId: "freeze_library" });

  dispatch("IMPORT_LEGACY_CHECKPOINT", 7, ACTORS.system, {
    artifacts: [
      legacyArtifact({
        id: "NP-PRODUCT-DIRECTION-001",
        type: "ProductHypothesis",
        lineageId: "NP-PRODUCT-DIRECTION",
        version: 1,
        contentHash: sha256({
          sourceSequence: 17,
          hypothesis:
            "one low-friction research conclusion card with expandable evidence",
        }),
        status: ARTIFACT_STATES.CANDIDATE,
        sourceRef: interactionSourceRef(7, {
          locator: "event-17",
          scientificStateEffect: "none",
        }),
      }),
    ],
    nodes: [],
    gates: [],
  });

  dispatch("IMPORT_LEGACY_CHECKPOINT", 8, ACTORS.system, {
    artifacts: [
      legacyArtifact({
        id: "NP-RESEARCH-POLICY-001",
        type: "ResearchPolicyDecision",
        lineageId: "NP-RESEARCH-POLICY",
        version: 1,
        contentHash: sha256({
          sourceSequence: 18,
          policy:
            "clarify, search, calibrate, extract, seek counterevidence, and independently verify before claims",
        }),
        status: ARTIFACT_STATES.ACCEPTED,
        sourceRef: interactionSourceRef(8, {
          locator: "event-18",
          g2ApprovalEffect: "none",
        }),
      }),
    ],
    nodes: [],
    gates: [],
  });

  dispatch("IMPORT_LEGACY_CHECKPOINT", 9, ACTORS.system, {
    artifacts: [
      legacyArtifact({
        id: "NP-PRODUCT-DIRECTION-002",
        type: "ProductHypothesis",
        lineageId: "NP-PRODUCT-DIRECTION",
        version: 2,
        contentHash: sha256({
          sourceSequence: 19,
          boundary:
            "independent research product, runtime carrier, and website presentation remain separate",
        }),
        status: ARTIFACT_STATES.ACCEPTED,
        sourceRef: interactionSourceRef(9, {
          locator: "event-19",
          scientificStateEffect: "none",
        }),
      }),
    ],
    nodes: [],
    gates: [],
  });
  dispatch("SUPERSEDE_ARTIFACT", 9, ACTORS.system, {
    artifactId: "NP-PRODUCT-DIRECTION-001",
    supersededBy: "NP-PRODUCT-DIRECTION-002",
    reason:
      "The website-like visual exploration cannot stand in for an independent product.",
  });

  dispatch("IMPORT_LEGACY_CHECKPOINT", 10, ACTORS.system, {
    artifacts: [
      legacyArtifact({
        id: "NP-ARCHITECTURE-DECISION-001",
        type: "ArchitectureDecision",
        lineageId: "NP-ARCHITECTURE-DECISION",
        version: 1,
        contentHash: sha256({
          sourceSequence: 20,
          decision: "state machine first; product form after validated research needs",
        }),
        status: ARTIFACT_STATES.ACCEPTED,
        sourceRef: interactionSourceRef(10, {
          locator: "event-20",
          productForm: "deferred",
        }),
      }),
      legacyArtifact({
        id: "REVIEW-RESEARCH-MACHINE-V1",
        type: "WorkflowDefinition",
        lineageId: "REVIEW-RESEARCH-MACHINE",
        version: 1,
        contentHash:
          "2c7bae0f4fc1dfe6a0cf879eedc8aba3a0b8a853aacce3b1844df59a8c0f089e",
        status: ARTIFACT_STATES.VERIFIED,
        sourceRef: sourceRef(
          10,
          "research-core/review-research-machine-v1.js",
          "2c7bae0f4fc1dfe6a0cf879eedc8aba3a0b8a853aacce3b1844df59a8c0f089e",
          {
            verificationMeaning:
              "Structurally validated workflow definition; not a product-shape decision.",
          },
        ),
      }),
    ],
    nodes: [],
    gates: [],
  });

  const stage3LibraryManifestPath =
    `${EXAMPLE_ROOT}/network-pharmacology-traceable-library-manifest-v1-2026-08-10.yaml`;
  const stage3LibraryManifestSha256 =
    "ef94c1627cab98dfd60693e5f3a9efb48697659d6463e2c942cccee8a392881b";
  const stage3SourceSnapshotPath =
    `${EXAMPLE_ROOT}/network-pharmacology-traceable-library-v1-2026-08-10.md`;
  const stage3SourceSnapshotSha256 =
    "84034321cdcc31c6e8b119794ba3ee326eda67b8252aa38cc4f0d98efa4add6d";
  const stage3LibraryArtifactIds = [
    "NP-LIT3-LIBRARY-MANIFEST-001",
    "NP-LIT3-SOURCE-SNAPSHOT-001",
  ];

  dispatch("IMPORT_LEGACY_CHECKPOINT", 11, ACTORS.system, {
    artifacts: [
      legacyArtifact({
        id: "NP-LIT3-LIBRARY-MANIFEST-001",
        type: "LibraryManifest",
        lineageId: "NP-LIT3-LIBRARY-MANIFEST",
        version: 1,
        contentHash: stage3LibraryManifestSha256,
        status: ARTIFACT_STATES.ACCEPTED,
        sourceRef: sourceRef(
          11,
          stage3LibraryManifestPath,
          stage3LibraryManifestSha256,
          {
            databaseScope: "PubMed_only",
            recordCount: 13,
            zoteroCollectionKey: "DW5629VI",
          },
        ),
        producedByNodeId: "freeze_library",
        inputArtifactRefs: ["NP-STAGE2-FOCUSED-PROTOCOL-V7"],
      }),
      legacyArtifact({
        id: "NP-LIT3-SOURCE-SNAPSHOT-001",
        type: "SourceSnapshot",
        lineageId: "NP-LIT3-SOURCE-SNAPSHOT",
        version: 1,
        contentHash: stage3SourceSnapshotSha256,
        status: ARTIFACT_STATES.ACCEPTED,
        sourceRef: sourceRef(
          11,
          stage3SourceSnapshotPath,
          stage3SourceSnapshotSha256,
          {
            databaseScope: "PubMed_only",
            recordCount: 13,
            zoteroCollectionKey: "DW5629VI",
          },
        ),
        producedByNodeId: "freeze_library",
        inputArtifactRefs: ["NP-STAGE2-FOCUSED-PROTOCOL-V7"],
      }),
    ],
    nodes: [
      {
        nodeId: "freeze_library",
        state: EXECUTION_STATES.ACCEPTED,
        artifactIds: stage3LibraryArtifactIds,
        sourceRef: interactionSourceRef(11, {
          nodeId: "freeze_library",
          locator: "event-23",
        }),
      },
    ],
    gates: [],
  });

  const stage3ManifestPath =
    `${EXAMPLE_ROOT}/network-pharmacology-traceable-library-manifest-v2-2026-08-10.yaml`;
  const stage3ManifestSha256 =
    "73674b39c44cc03238f89b690c86436b03b79f3daf494fdcf9ad07d4943dae4f";
  const stage3EvidenceMapPath =
    `${EXAMPLE_ROOT}/network-pharmacology-literature-stage-3-evidence-map-v1-2026-08-10.md`;
  const stage3EvidenceMapSha256 =
    "c22b203cd8a98d2b63bb9a68dcb8f5043e01c308b70539993e419b6219781717";
  const stage3EvidenceBriefPath =
    `${EXAMPLE_ROOT}/network-pharmacology-literature-stage-3-evidence-brief-v1-2026-08-10.md`;
  const stage3EvidenceBriefSha256 =
    "cd788ffce8493580cd23894adfe5866a824af4cc8def913ae7dd7959a15bff86";
  const stage3IndependentReviewPath =
    `${EXAMPLE_ROOT}/network-pharmacology-literature-stage-3-independent-review-v1-2026-08-10.md`;
  const stage3IndependentReviewSha256 =
    "a4dcb2edfaf97e514e9522d56a60de43973e011cb96ee32c2e89a4cd43e9d5ce";
  const stage3EvidenceRecords = stage3EvidenceRecordArtifacts({
    libraryArtifactIds: stage3LibraryArtifactIds,
  });
  const stage3EvidenceRecordIds = stage3EvidenceRecords.map(
    (artifact) => artifact.id,
  );
  const extractionOutputIds = [
    ...stage3EvidenceRecordIds,
    "NP-LIT3-APPRAISAL-001",
  ];
  const counterevidenceOutputIds = [
    "NP-LIT3-COUNTEREVIDENCE-001",
    "NP-LIT3-COVERAGE-GAPS-001",
  ];
  const synthesisInputIds = [
    ...extractionOutputIds,
    ...counterevidenceOutputIds,
  ];
  const synthesisOutputIds = [
    "NP-LIT3-CLAIM-EVIDENCE-MAP-001",
    "NP-LIT3-CONCLUSION-CARDS-001",
  ];

  dispatch("IMPORT_LEGACY_CHECKPOINT", 12, ACTORS.system, {
    artifacts: [
      ...stage3EvidenceRecords,
      legacyArtifact({
        id: "NP-LIT3-APPRAISAL-001",
        type: "AppraisalRecord",
        lineageId: "NP-LIT3-APPRAISAL",
        version: 1,
        contentHash: stage3ManifestSha256,
        status: ARTIFACT_STATES.ACCEPTED,
        sourceRef: sourceRef(12, stage3ManifestPath, stage3ManifestSha256, {
          fullTextReviewedCount: 3,
          abstractOnlyCount: 10,
          independentlyCrossCheckedCount: 13,
        }),
        producedByNodeId: "extract_evidence",
        inputArtifactRefs: stage3LibraryArtifactIds,
      }),
      legacyArtifact({
        id: "NP-LIT3-COUNTEREVIDENCE-001",
        type: "CounterevidenceRegister",
        lineageId: "NP-LIT3-COUNTEREVIDENCE",
        version: 1,
        contentHash: stage3EvidenceMapSha256,
        status: ARTIFACT_STATES.ACCEPTED,
        sourceRef: sourceRef(
          12,
          stage3EvidenceMapPath,
          stage3EvidenceMapSha256,
          {
            scope:
              "Contradictions, missing links, and non-equivalent validation types in the 13-record sample.",
          },
        ),
        producedByNodeId: "seek_counterevidence",
        inputArtifactRefs: [
          "NP-LIT3-LIBRARY-MANIFEST-001",
          "NP-HIST-RESEARCH-BRIEF-001",
        ],
      }),
      legacyArtifact({
        id: "NP-LIT3-COVERAGE-GAPS-001",
        type: "CoverageGapRegister",
        lineageId: "NP-LIT3-COVERAGE-GAPS",
        version: 1,
        contentHash: stage3EvidenceBriefSha256,
        status: ARTIFACT_STATES.ACCEPTED,
        sourceRef: sourceRef(
          12,
          stage3EvidenceBriefPath,
          stage3EvidenceBriefSha256,
          {
            databaseScope: "PubMed_only",
            accessBoundary: "3_full_text_and_10_abstract_only",
          },
        ),
        producedByNodeId: "seek_counterevidence",
        inputArtifactRefs: [
          "NP-LIT3-LIBRARY-MANIFEST-001",
          "NP-HIST-RESEARCH-BRIEF-001",
        ],
      }),
      legacyArtifact({
        id: "NP-LIT3-CLAIM-EVIDENCE-MAP-001",
        type: "ClaimEvidenceMap",
        lineageId: "NP-LIT3-CLAIM-EVIDENCE-MAP",
        version: 1,
        contentHash: stage3EvidenceMapSha256,
        status: ARTIFACT_STATES.ACCEPTED,
        sourceRef: sourceRef(
          12,
          stage3EvidenceMapPath,
          stage3EvidenceMapSha256,
          {
            confirmedCompleteMechanismChainCount: 0,
            sampleInterpretation: "deliberately_enriched_not_prevalence_sample",
          },
        ),
        producedByNodeId: "synthesize_claims",
        inputArtifactRefs: synthesisInputIds,
      }),
      legacyArtifact({
        id: "NP-LIT3-CONCLUSION-CARDS-001",
        type: "ResearchConclusionCard",
        lineageId: "NP-LIT3-CONCLUSION-CARDS",
        version: 1,
        contentHash: stage3EvidenceBriefSha256,
        status: ARTIFACT_STATES.ACCEPTED,
        sourceRef: sourceRef(
          12,
          stage3EvidenceBriefPath,
          stage3EvidenceBriefSha256,
          {
            readerFacing: true,
            manuscriptWritingAllowed: false,
          },
        ),
        producedByNodeId: "synthesize_claims",
        inputArtifactRefs: synthesisInputIds,
      }),
      legacyArtifact({
        id: "NP-LIT3-EVIDENCE-VERIFICATION-001",
        type: "EvidenceVerificationReport",
        lineageId: "NP-LIT3-EVIDENCE-VERIFICATION",
        version: 1,
        contentHash: stage3IndependentReviewSha256,
        status: ARTIFACT_STATES.ACCEPTED,
        sourceRef: sourceRef(
          12,
          stage3IndependentReviewPath,
          stage3IndependentReviewSha256,
          {
            verificationMeaning:
              "Independent agent cross-check passed; this does not approve the evidence boundary.",
            humanApprovalEffect: "none",
          },
        ),
        producedByNodeId: "verify_evidence",
        inputArtifactRefs: synthesisOutputIds,
        producedByActorId: ACTORS.evidenceVerifier.id,
        producedByActorRole: ACTORS.evidenceVerifier.role,
        acceptedBy: {
          actorId: ACTORS.evidenceReviewer.id,
          actorRole: ACTORS.evidenceReviewer.role,
          actorKind: ACTORS.evidenceReviewer.kind,
        },
        humanApprovalEffect: "none",
      }),
    ],
    nodes: [
      {
        nodeId: "extract_evidence",
        state: EXECUTION_STATES.ACCEPTED,
        artifactIds: extractionOutputIds,
        sourceRef: interactionSourceRef(12, {
          nodeId: "extract_evidence",
          locator: "event-24",
        }),
      },
      {
        nodeId: "seek_counterevidence",
        state: EXECUTION_STATES.ACCEPTED,
        artifactIds: counterevidenceOutputIds,
        sourceRef: interactionSourceRef(12, {
          nodeId: "seek_counterevidence",
          locator: "event-24",
        }),
      },
      {
        nodeId: "synthesize_claims",
        state: EXECUTION_STATES.ACCEPTED,
        artifactIds: synthesisOutputIds,
        sourceRef: interactionSourceRef(12, {
          nodeId: "synthesize_claims",
          locator: "event-24",
        }),
      },
      {
        nodeId: "verify_evidence",
        state: EXECUTION_STATES.ACCEPTED,
        artifactIds: ["NP-LIT3-EVIDENCE-VERIFICATION-001"],
        sourceRef: sourceRef(
          12,
          stage3IndependentReviewPath,
          stage3IndependentReviewSha256,
          {
            nodeId: "verify_evidence",
            producedBy: ACTORS.evidenceVerifier,
            acceptedBy: ACTORS.evidenceReviewer,
            humanApprovalEffect: "none",
          },
        ),
      },
    ],
    gates: [],
  });

  dispatch("READY_NODE", 13, ACTORS.agent, {
    nodeId: "approve_evidence_boundary",
  });
  dispatch("REQUEST_GATE", 13, ACTORS.agent, {
    gateId: "NP-LIT3-EVIDENCE-BOUNDARY-PENDING-001",
    nodeId: "approve_evidence_boundary",
    artifactIds: [
      "NP-LIT3-EVIDENCE-VERIFICATION-001",
      "NP-LIT3-CONCLUSION-CARDS-001",
    ],
  });

  const evidenceBoundaryState = replayEvents(machine, projectId, events);
  dispatch("DECIDE_GATE", 14, ACTORS.human, {
    gateId: "NP-LIT3-EVIDENCE-BOUNDARY-PENDING-001",
    gateFingerprint:
      evidenceBoundaryState.gates["NP-LIT3-EVIDENCE-BOUNDARY-PENDING-001"]
        .fingerprint,
    decision: GATE_STATES.APPROVED,
    reason:
      "The researcher reviewed the inline abstract-level brief and explicitly chose to enter the next step; this approves the bounded conclusions but not manuscript prose.",
    decisionArtifacts: [
      {
        id: "NP-LIT3-EVIDENCE-BOUNDARY-DECISION-001",
        type: "EvidenceBoundaryDecision",
        lineageId: "NP-LIT3-EVIDENCE-BOUNDARY-DECISION",
        version: 1,
        content: {
          decision: "enter_evidence_driven_outline",
          screeningBasis: "title_abstract_primary",
          databaseScope: "PubMed_only",
          applicationSample: "13_deliberately_enriched_candidates",
          manuscriptWritingAuthorized: false,
          retainedLimits: [
            "not_a_prevalence_sample",
            "abstract_nonreporting_remains_unknown",
            "no_clinical_efficacy_claim",
            "no_formula_target_animal_causality_claim",
          ],
        },
        sourceRef: interactionSourceRef(14, {
          locator: "event-28",
          userInstruction: "进入下一步",
        }),
      },
    ],
  });
  dispatch("CHANGE_COMPLETION_PROFILE", 14, ACTORS.human, {
    completionProfileId: "evidence_outline",
    reason:
      "The researcher explicitly extended the target from an approved evidence brief to an evidence-driven outline.",
  });

  const outlinePath =
    `${EXAMPLE_ROOT}/network-pharmacology-abstract-led-evidence-outline-v1-2026-08-10.md`;
  const outlineSha256 =
    "9fc37977bf80a0b0d7eea8652c21cf54f2d333a39aa0b02dda144e4b76ffa7f8";
  const outlineReviewPath =
    `${EXAMPLE_ROOT}/network-pharmacology-abstract-led-outline-independent-review-v1-2026-08-10.md`;
  const outlineReviewSha256 =
    "31140f4ead806f52af08e770256bed4013c9ba78ca96bcc7ef2c7d1fef41d431";
  const outlineV1Content = {
    schemaVersion: "1.0.0",
    id: "NP-ARGUMENT-OUTLINE-001",
    version: 1,
    questionId: "NP-HIST-QUESTION-CANDIDATE-001",
    evidenceBoundaryDecisionId: "NP-LIT3-EVIDENCE-BOUNDARY-DECISION-001",
    claimEvidenceMapId: "NP-LIT3-CLAIM-EVIDENCE-MAP-001",
    producerId: ACTORS.argumentArchitect.id,
    excludedTopics: [
      "领域发生率或代表性比例推断",
      "临床疗效或个体诊疗建议",
      "方剂经单一成分和靶点导致动物表型的连续因果结论",
    ],
    sections: [
      {
        id: "outline-v1-section-1",
        title: "为什么网络预测必须复核",
        purpose: "区分候选生成、计算可重复性与生物学机制证明。",
        claimIds: ["NP-OUTLINE-V1-CLAIM-1"],
        supportingEvidenceIds: [...stage3EvidenceRecordIds],
        counterEvidenceIds: ["NP-LIT3-COUNTEREVIDENCE-001"],
        limitations: ["方法来源用于界定判断框架，不用于估计领域比例。"],
      },
      {
        id: "outline-v1-section-2",
        title: "成分真的到达了吗",
        purpose: "检查实测暴露、组织可达性与实验浓度之间的连续性。",
        claimIds: ["NP-OUTLINE-V1-CLAIM-2"],
        supportingEvidenceIds: [...stage3EvidenceRecordIds],
        counterEvidenceIds: ["NP-LIT3-COUNTEREVIDENCE-001"],
        limitations: ["摘要未报告的组织浓度保持未知。"],
      },
      {
        id: "outline-v1-section-3",
        title: "成分真的作用于具体靶点了吗",
        purpose: "按预测、对接、结合和功能作用的不同证据层级解释靶点主张。",
        claimIds: ["NP-OUTLINE-V1-CLAIM-3"],
        supportingEvidenceIds: [...stage3EvidenceRecordIds],
        counterEvidenceIds: ["NP-LIT3-COUNTEREVIDENCE-001"],
        limitations: ["实验方法被列出不等于摘要报告了阳性结果。"],
      },
      {
        id: "outline-v1-section-4",
        title: "药效是否依赖该靶点，而且证据是否真正对齐",
        purpose: "检查药物、靶点干预、表型、物种、组织、时间和浓度是否对齐。",
        claimIds: ["NP-OUTLINE-V1-CLAIM-4"],
        supportingEvidenceIds: [...stage3EvidenceRecordIds],
        counterEvidenceIds: ["NP-LIT3-COUNTEREVIDENCE-001"],
        limitations: ["多种证据组件并存不能自动证明连续机制。"],
      },
      {
        id: "outline-v1-section-5",
        title: "现有证据允许写到什么程度",
        purpose: "给出受限综述主张以及证据不足时的合并、补检和降级规则。",
        claimIds: ["NP-OUTLINE-V1-CLAIM-5"],
        supportingEvidenceIds: [...stage3EvidenceRecordIds],
        counterEvidenceIds: ["NP-LIT3-COVERAGE-GAPS-001"],
        limitations: ["13篇刻意富集候选不是领域总体的代表性样本。"],
      },
    ],
  };
  const outlineStressTestV1Content = {
    schemaVersion: "1.0.0",
    id: "NP-ARGUMENT-OUTLINE-STRESS-TEST-001",
    version: 1,
    outlineId: outlineV1Content.id,
    outlineProducerId: ACTORS.argumentArchitect.id,
    verifierId: ACTORS.outlineVerifier.id,
    verdict: "pass",
    reviewedSectionIds: outlineV1Content.sections.map((section) => section.id),
    findings: [],
  };

  dispatch("READY_NODE", 15, ACTORS.argumentArchitect, {
    nodeId: "derive_outline",
  });
  dispatch("CLAIM_WORK", 15, ACTORS.argumentArchitect, {
    nodeId: "derive_outline",
    leaseId: "np-argument-outline-architect-lease-001",
    expiresAt: "2026-08-11T00:00:00+08:00",
  });
  dispatch("START_NODE", 15, ACTORS.argumentArchitect, {
    nodeId: "derive_outline",
    leaseId: "np-argument-outline-architect-lease-001",
  });
  dispatch("PRODUCE_ARTIFACT", 15, ACTORS.argumentArchitect, {
    nodeId: "derive_outline",
    leaseId: "np-argument-outline-architect-lease-001",
    artifact: {
      id: "NP-ARGUMENT-OUTLINE-001",
      type: "EvidenceDrivenOutline",
      lineageId: "NP-ARGUMENT-OUTLINE",
      version: 1,
      content: outlineV1Content,
      contentHash: sha256(outlineV1Content),
      inputArtifactRefs: [
        "NP-LIT3-EVIDENCE-BOUNDARY-DECISION-001",
        "NP-LIT3-CLAIM-EVIDENCE-MAP-001",
      ],
      sourceRef: sourceRef(15, outlinePath, outlineSha256, {
        format: "reader_first_evidence_outline",
        manuscriptProse: false,
      }),
    },
  });
  dispatch("SUBMIT_NODE", 15, ACTORS.argumentArchitect, {
    nodeId: "derive_outline",
    leaseId: "np-argument-outline-architect-lease-001",
    artifactIds: ["NP-ARGUMENT-OUTLINE-001"],
  });
  dispatch("VERIFY_ARTIFACT", 15, ACTORS.methodReviewer, {
    artifactId: "NP-ARGUMENT-OUTLINE-001",
    verdict: "pass",
  });
  dispatch("ACCEPT_NODE", 15, ACTORS.methodReviewer, {
    nodeId: "derive_outline",
    artifactIds: ["NP-ARGUMENT-OUTLINE-001"],
    criteriaProofs: machine.nodes
      .find((node) => node.id === "derive_outline")
      .acceptanceCriteria.map((criterion) => ({
        criterion,
        passed: true,
        proofArtifactIds: ["NP-ARGUMENT-OUTLINE-001"],
      })),
  });

  dispatch("READY_NODE", 15, ACTORS.outlineVerifier, {
    nodeId: "stress_test_outline",
  });
  dispatch("CLAIM_WORK", 15, ACTORS.outlineVerifier, {
    nodeId: "stress_test_outline",
    leaseId: "np-outline-stress-test-lease-001",
    expiresAt: "2026-08-11T00:00:00+08:00",
  });
  dispatch("START_NODE", 15, ACTORS.outlineVerifier, {
    nodeId: "stress_test_outline",
    leaseId: "np-outline-stress-test-lease-001",
  });
  dispatch("PRODUCE_ARTIFACT", 15, ACTORS.outlineVerifier, {
    nodeId: "stress_test_outline",
    leaseId: "np-outline-stress-test-lease-001",
    artifact: {
      id: "NP-ARGUMENT-OUTLINE-STRESS-TEST-001",
      type: "OutlineStressTest",
      lineageId: "NP-ARGUMENT-OUTLINE-STRESS-TEST",
      version: 1,
      content: outlineStressTestV1Content,
      contentHash: sha256(outlineStressTestV1Content),
      inputArtifactRefs: [
        "NP-ARGUMENT-OUTLINE-001",
        "NP-LIT3-CLAIM-EVIDENCE-MAP-001",
      ],
      sourceRef: sourceRef(15, outlineReviewPath, outlineReviewSha256, {
        verdict: "pass",
        humanApprovalEffect: "none",
      }),
    },
  });
  dispatch("SUBMIT_NODE", 15, ACTORS.outlineVerifier, {
    nodeId: "stress_test_outline",
    leaseId: "np-outline-stress-test-lease-001",
    artifactIds: ["NP-ARGUMENT-OUTLINE-STRESS-TEST-001"],
  });
  dispatch("VERIFY_ARTIFACT", 15, ACTORS.outlineReviewer, {
    artifactId: "NP-ARGUMENT-OUTLINE-STRESS-TEST-001",
    verdict: "pass",
  });
  dispatch("ACCEPT_NODE", 15, ACTORS.outlineReviewer, {
    nodeId: "stress_test_outline",
    artifactIds: ["NP-ARGUMENT-OUTLINE-STRESS-TEST-001"],
    criteriaProofs: machine.nodes
      .find((node) => node.id === "stress_test_outline")
      .acceptanceCriteria.map((criterion) => ({
        criterion,
        passed: true,
        proofArtifactIds: ["NP-ARGUMENT-OUTLINE-STRESS-TEST-001"],
      })),
  });

  dispatch("READY_NODE", 16, ACTORS.agent, {
    nodeId: "approve_outline",
  });
  dispatch("REQUEST_GATE", 16, ACTORS.agent, {
    gateId: "NP-ARGUMENT-OUTLINE-GATE-001",
    nodeId: "approve_outline",
    artifactIds: [
      "NP-ARGUMENT-OUTLINE-001",
      "NP-ARGUMENT-OUTLINE-STRESS-TEST-001",
    ],
  });

  const outlineV1GateState = replayEvents(machine, projectId, events);
  dispatch("DECIDE_GATE", 17, ACTORS.human, {
    gateId: "NP-ARGUMENT-OUTLINE-GATE-001",
    gateFingerprint:
      outlineV1GateState.gates["NP-ARGUMENT-OUTLINE-GATE-001"].fingerprint,
    decision: GATE_STATES.AMENDMENT_REQUESTED,
    correctionId: "NP-OUTLINE-CORRECTION-EVENT-30",
    reason:
      "Revise the outline into a manuscript-ready plan with an explicit article type, abstract, introduction, methods, results, discussion, conclusion, paragraph tasks, citation mapping, and figure/table planning; do not start prose.",
  });

  const outlineV2Path =
    `${EXAMPLE_ROOT}/network-pharmacology-manuscript-ready-outline-v2-2026-08-10.md`;
  const outlineV2Sha256 =
    "285c16574b0b48bc7dfafc922535e162bf62d296fd88e378e5e0bd9326d84a0a";
  const outlineReviewV2Path =
    `${EXAMPLE_ROOT}/network-pharmacology-manuscript-ready-outline-independent-review-v2-2026-08-11.md`;
  const outlineReviewV2Sha256 =
    "9b32562c518c525622f05b5737bd7498c1f697b17b9d4d036f8caf53929cd094";
  const outlineV2SectionSpecs = [
    {
      id: "outline-v2-abstract",
      title: "结构化摘要",
      purpose: "从正文已规划内容派生背景、目的、方法、结果和受限结论。",
      paragraphIds: ["A1", "A2", "A3", "A4", "A5"],
    },
    {
      id: "outline-v2-introduction",
      title: "引言",
      purpose: "界定网络药理学的候选生成价值、机制证明缺口和本文贡献。",
      paragraphIds: ["I1", "I2", "I3", "I4", "I5"],
    },
    {
      id: "outline-v2-methods",
      title: "方法",
      purpose: "报告研究设计、检索校准、筛选、访问层级、提取和综合规则。",
      paragraphIds: ["M1", "M2", "M3", "M4", "M5", "M6"],
    },
    {
      id: "outline-v2-results",
      title: "结果",
      purpose: "依次呈现语料边界、暴露、靶点作用、功能介导和跨体系断点。",
      paragraphIds: Array.from({ length: 18 }, (_, index) => `R${index + 1}`),
    },
    {
      id: "outline-v2-discussion",
      title: "讨论",
      purpose: "解释证据链断点、合理价值边界、方法贡献、未来要求与局限。",
      paragraphIds: Array.from({ length: 8 }, (_, index) => `D${index + 1}`),
    },
    {
      id: "outline-v2-conclusion",
      title: "结论",
      purpose: "只回答当前受限证据允许回答的问题，不扩大事实强度。",
      paragraphIds: ["C1"],
    },
  ];
  const outlineV2Content = {
    schemaVersion: "1.0.0",
    id: "NP-ARGUMENT-OUTLINE-002",
    version: 2,
    questionId: "NP-HIST-QUESTION-CANDIDATE-001",
    evidenceBoundaryDecisionId: "NP-LIT3-EVIDENCE-BOUNDARY-DECISION-001",
    claimEvidenceMapId: "NP-LIT3-CLAIM-EVIDENCE-MAP-001",
    producerId: ACTORS.argumentArchitect.id,
    excludedTopics: [
      "领域发生率或代表性比例推断",
      "临床疗效或个体诊疗建议",
      "方剂经单一成分和靶点导致动物表型的连续因果结论",
      "尚未完成来源定位核查的精确数值",
    ],
    sections: outlineV2SectionSpecs.map((section, index) => ({
      ...section,
      claimIds: [`NP-OUTLINE-V2-CLAIM-${index + 1}`],
      supportingEvidenceIds: [...stage3EvidenceRecordIds],
      counterEvidenceIds: ["NP-LIT3-COUNTEREVIDENCE-001"],
      limitations: [
        "13篇刻意富集候选不是领域总体的代表性样本。",
        "摘要未报告的信息保持未知，正式事实句仍需逐句核查。",
      ],
    })),
  };
  const outlineStressTestV2Content = {
    schemaVersion: "1.0.0",
    id: "NP-ARGUMENT-OUTLINE-STRESS-TEST-002",
    version: 2,
    outlineId: outlineV2Content.id,
    outlineProducerId: ACTORS.argumentArchitect.id,
    verifierId: ACTORS.outlineVerifier.id,
    verdict: "pass",
    reviewedSectionIds: outlineV2Content.sections.map((section) => section.id),
    findings: [
      {
        id: "outline-v2-finding-1",
        targetRef: "outline-v2-methods",
        severity: "blocker",
        message: "早期草案混淆了定向方法来源和13篇应用研究语料。",
        recommendedAction: "在方法段中分开报告两类来源的角色和计数。",
        resolved: true,
      },
      {
        id: "outline-v2-finding-2",
        targetRef: "outline-v2-results",
        severity: "warning",
        message: "早期草案的段落数量与正文映射未完全对齐。",
        recommendedAction: "冻结43个物理段落标识并逐项核对。",
        resolved: true,
      },
      {
        id: "outline-v2-finding-3",
        targetRef: "outline-v2-conclusion",
        severity: "blocker",
        message: "早期结论措辞可能被解读为超出受限样本的领域判断。",
        recommendedAction: "将结论限定为当前PubMed候选集和实际访问层级。",
        resolved: true,
      },
    ],
  };

  dispatch("READY_NODE", 18, ACTORS.argumentArchitect, {
    nodeId: "derive_outline",
  });
  dispatch("CLAIM_WORK", 18, ACTORS.argumentArchitect, {
    nodeId: "derive_outline",
    leaseId: "np-argument-outline-architect-lease-002",
    expiresAt: "2026-08-12T00:00:00+08:00",
  });
  dispatch("START_NODE", 18, ACTORS.argumentArchitect, {
    nodeId: "derive_outline",
    leaseId: "np-argument-outline-architect-lease-002",
  });
  dispatch("PRODUCE_ARTIFACT", 18, ACTORS.argumentArchitect, {
    nodeId: "derive_outline",
    leaseId: "np-argument-outline-architect-lease-002",
    artifact: {
      id: "NP-ARGUMENT-OUTLINE-002",
      type: "EvidenceDrivenOutline",
      lineageId: "NP-ARGUMENT-OUTLINE",
      version: 2,
      content: outlineV2Content,
      contentHash: sha256(outlineV2Content),
      inputArtifactRefs: [
        "NP-LIT3-EVIDENCE-BOUNDARY-DECISION-001",
        "NP-LIT3-CLAIM-EVIDENCE-MAP-001",
      ],
      sourceRef: sourceRef(18, outlineV2Path, outlineV2Sha256, {
        format: "manuscript_ready_physical_paragraph_outline",
        manuscriptProse: false,
        paragraphCount: 43,
        articleType:
          "focused_critical_methodological_review_with_targeted_pubmed_evidence_map",
        humanApprovalEffect: "none",
      }),
    },
  });
  dispatch("SUBMIT_NODE", 18, ACTORS.argumentArchitect, {
    nodeId: "derive_outline",
    leaseId: "np-argument-outline-architect-lease-002",
    artifactIds: ["NP-ARGUMENT-OUTLINE-002"],
  });
  dispatch("VERIFY_ARTIFACT", 18, ACTORS.methodReviewer, {
    artifactId: "NP-ARGUMENT-OUTLINE-002",
    verdict: "pass",
  });
  dispatch("ACCEPT_NODE", 18, ACTORS.methodReviewer, {
    nodeId: "derive_outline",
    artifactIds: ["NP-ARGUMENT-OUTLINE-002"],
    criteriaProofs: machine.nodes
      .find((node) => node.id === "derive_outline")
      .acceptanceCriteria.map((criterion) => ({
        criterion,
        passed: true,
        proofArtifactIds: ["NP-ARGUMENT-OUTLINE-002"],
      })),
  });
  dispatch("SUPERSEDE_ARTIFACT", 18, ACTORS.argumentArchitect, {
    artifactId: "NP-ARGUMENT-OUTLINE-001",
    supersededBy: "NP-ARGUMENT-OUTLINE-002",
    reason:
      "The paragraph-level v2 writing plan replaces the conceptual v1 outline returned by the researcher while retaining v1 as auditable history.",
  });

  dispatch("READY_NODE", 18, ACTORS.outlineVerifier, {
    nodeId: "stress_test_outline",
  });
  dispatch("CLAIM_WORK", 18, ACTORS.outlineVerifier, {
    nodeId: "stress_test_outline",
    leaseId: "np-outline-stress-test-lease-002",
    expiresAt: "2026-08-12T00:00:00+08:00",
  });
  dispatch("START_NODE", 18, ACTORS.outlineVerifier, {
    nodeId: "stress_test_outline",
    leaseId: "np-outline-stress-test-lease-002",
  });
  dispatch("PRODUCE_ARTIFACT", 18, ACTORS.outlineVerifier, {
    nodeId: "stress_test_outline",
    leaseId: "np-outline-stress-test-lease-002",
    artifact: {
      id: "NP-ARGUMENT-OUTLINE-STRESS-TEST-002",
      type: "OutlineStressTest",
      lineageId: "NP-ARGUMENT-OUTLINE-STRESS-TEST",
      version: 2,
      content: outlineStressTestV2Content,
      contentHash: sha256(outlineStressTestV2Content),
      inputArtifactRefs: [
        "NP-ARGUMENT-OUTLINE-002",
        "NP-LIT3-CLAIM-EVIDENCE-MAP-001",
      ],
      sourceRef: sourceRef(
        18,
        outlineReviewV2Path,
        outlineReviewV2Sha256,
        {
          verdict: "pass_after_substantive_corrections",
          paragraphCount: 43,
          remainingBlockers: 0,
          humanApprovalEffect: "none",
        },
      ),
    },
  });
  dispatch("SUBMIT_NODE", 18, ACTORS.outlineVerifier, {
    nodeId: "stress_test_outline",
    leaseId: "np-outline-stress-test-lease-002",
    artifactIds: ["NP-ARGUMENT-OUTLINE-STRESS-TEST-002"],
  });
  dispatch("VERIFY_ARTIFACT", 18, ACTORS.outlineReviewer, {
    artifactId: "NP-ARGUMENT-OUTLINE-STRESS-TEST-002",
    verdict: "pass",
  });
  dispatch("ACCEPT_NODE", 18, ACTORS.outlineReviewer, {
    nodeId: "stress_test_outline",
    artifactIds: ["NP-ARGUMENT-OUTLINE-STRESS-TEST-002"],
    criteriaProofs: machine.nodes
      .find((node) => node.id === "stress_test_outline")
      .acceptanceCriteria.map((criterion) => ({
        criterion,
        passed: true,
        proofArtifactIds: ["NP-ARGUMENT-OUTLINE-STRESS-TEST-002"],
      })),
  });
  dispatch("SUPERSEDE_ARTIFACT", 18, ACTORS.outlineVerifier, {
    artifactId: "NP-ARGUMENT-OUTLINE-STRESS-TEST-001",
    supersededBy: "NP-ARGUMENT-OUTLINE-STRESS-TEST-002",
    reason:
      "The independent v2 review replaces the v1 stress test because the researcher changed the required outline deliverable.",
  });

  dispatch("READY_NODE", 19, ACTORS.agent, {
    nodeId: "approve_outline",
  });
  dispatch("REQUEST_GATE", 19, ACTORS.agent, {
    gateId: "NP-ARGUMENT-OUTLINE-GATE-002",
    nodeId: "approve_outline",
    artifactIds: [
      "NP-ARGUMENT-OUTLINE-002",
      "NP-ARGUMENT-OUTLINE-STRESS-TEST-002",
    ],
  });

  verifyEventChain(events, projectId);
  const state = replayEvents(machine, projectId, events);
  const projection = getRuntimeUserProjection(machine, state);

  return { projectId, events, state, projection };
}

export const NETWORK_PHARMACOLOGY_REPLAY_V1 =
  buildNetworkPharmacologyReplayV1();
