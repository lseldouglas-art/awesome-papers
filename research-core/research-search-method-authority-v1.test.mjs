import test from "node:test";
import assert from "node:assert/strict";

import { RESEARCH_ARTIFACT_SCHEMA_VERSION } from "./artifact-contracts-v1.js";
import { sha256 } from "./event-engine-v1.js";
import {
  createRetrievalRun,
  runLiveRetrieval,
} from "./research-live-retrieval-v1.js";
import {
  assertValidSearchMethodAuthorityChain,
  createRetrievalRunReference,
  createSearchMethodArtifactFingerprint,
  validateSearchMethodAuthorityChain,
} from "./research-search-method-authority-v1.js";

const CREATED_AT = "2026-08-13T01:00:00.000Z";
const FROZEN_AT = "2026-08-13T01:30:00.000Z";

function artifact(type, id, content, version = 1) {
  return { id, type, version, content, contentHash: sha256(content) };
}

function rootArtifact(id, type) {
  return artifact(type, id, {
    schemaVersion: RESEARCH_ARTIFACT_SCHEMA_VERSION,
    id,
    version: 1,
    question: "Does acupuncture reduce chemotherapy-related fatigue?",
  });
}

function common({ id, query, upstreamArtifactFingerprints }) {
  return {
    schemaVersion: RESEARCH_ARTIFACT_SCHEMA_VERSION,
    id,
    version: 1,
    provider: "pubmed",
    database: "PubMed",
    createdAt: CREATED_AT,
    fields: ["title_abstract", "mesh_terms"],
    timeRange: { basis: "none", from: null, to: null },
    languages: ["any"],
    inclusionCriteria: ["Human breast-cancer fatigue studies"],
    exclusionCriteria: ["Records unrelated to fatigue"],
    stopRules: ["Stop after sentinel and noise checks stabilize"],
    upstreamArtifactFingerprints,
    query,
    queryHash: sha256(query),
  };
}

function conceptMatrix({ id, query, upstream, focused = false }) {
  return {
    ...common({ id, query, upstreamArtifactFingerprints: [upstream] }),
    conceptGroups: [
      {
        id: "population",
        label: "Population",
        rationale: "Bind the target population explicitly.",
        terms: ["breast neoplasms", "breast cancer"],
      },
      {
        id: "intervention",
        label: "Intervention",
        rationale: "Represent the intervention and controlled vocabulary.",
        terms: ["acupuncture", "acupuncture therapy"],
      },
    ],
    sentinelSourceIds: ["pubmed:1001"],
    ...(focused ? { focusedRelation: "intervention effect on fatigue" } : {}),
  };
}

function orientationProtocol({ matrix, query }) {
  const matrixFingerprint = createSearchMethodArtifactFingerprint(matrix);
  return {
    ...common({
      id: "orientation-protocol",
      query,
      upstreamArtifactFingerprints: [matrixFingerprint],
    }),
    conceptMatrixFingerprint: matrixFingerprint,
    queryId: "orientation-broad",
    accessPolicy: "Title and abstract screening first.",
    samplingRule: "Inspect every returned pilot record up to the configured cap.",
  };
}

function focusedProtocol({ matrix, primaryQuery, adjacentQuery }) {
  const matrixFingerprint = createSearchMethodArtifactFingerprint(matrix);
  return {
    ...common({
      id: "focused-protocol",
      query: primaryQuery,
      upstreamArtifactFingerprints: [matrixFingerprint],
    }),
    conceptMatrixFingerprint: matrixFingerprint,
    primaryQueryId: "focused-core",
    queryVariants: [
      {
        id: "focused-core",
        purpose: "core",
        query: primaryQuery,
        queryHash: sha256(primaryQuery),
      },
      {
        id: "focused-adjacent",
        purpose: "adjacent sensitivity check",
        query: adjacentQuery,
        queryHash: sha256(adjacentQuery),
      },
    ],
    accessPolicy: "Title and abstract screening first.",
    samplingRule: "Inspect all focused calibration records up to the configured cap.",
  };
}

async function retrievalRun({ protocol, purpose, nodeId, queryId, query }) {
  const receipt = await runLiveRetrieval({
    project: {
      researchMode: "live_pubmed",
      searchQuery: query,
      searchLimit: 1,
    },
    node: nodeId,
    request: { query },
    gateway: {
      async searchPubMed(input) {
        return {
          provider: "pubmed",
          query: input.query,
          executedAt: CREATED_AT,
          total: 1,
          resultIds: ["1001"],
        };
      },
      async fetchPubMed() {
        return {
          provider: "pubmed",
          fetchedAt: "2026-08-13T01:00:01.000Z",
          records: [
            {
              provider: "pubmed",
              pmid: "1001",
              title: "A real PubMed calibration record",
              abstract: "The abstract reports fatigue outcomes.",
            },
          ],
          accessBoundary: "PubMed title and abstract only.",
        };
      },
    },
  });
  return createRetrievalRun({
    request: {
      purpose,
      nodeId,
      protocolArtifactId: protocol.id,
      protocolContentHash: protocol.contentHash,
      queryId,
      query,
      queryHash: sha256(query),
    },
    receipt,
  });
}

function calibration({ id, protocol, run, selected, focused = false }) {
  const protocolFingerprint = createSearchMethodArtifactFingerprint(protocol);
  const runReference = createRetrievalRunReference(run);
  return {
    ...common({
      id,
      query: selected.query,
      upstreamArtifactFingerprints: [protocolFingerprint],
    }),
    protocolFingerprint,
    retrievalRunRefs: [runReference],
    sampleSourceIds: ["pubmed:1001"],
    checkedCount: 1,
    noiseAssessment: [
      {
        id: "noise-unrelated-population",
        description: "No unrelated population was found in the checked sample.",
        count: 0,
      },
    ],
    sentinelChecks: [
      {
        sourceId: "pubmed:1001",
        retrieved: true,
        note: "Sentinel record was present in the executed result set.",
      },
    ],
    revisionDecision: "keep",
    selectedQuery: selected,
    stopReason: focused
      ? "The focused query retrieved its sentinel with no observed pilot noise."
      : "The orientation query retrieved its sentinel and exposed the target domain.",
  };
}

function frozen({ id, protocol, calibrationArtifact, run }) {
  const parentProtocolFingerprint = createSearchMethodArtifactFingerprint(protocol);
  const calibrationFingerprint =
    createSearchMethodArtifactFingerprint(calibrationArtifact);
  const selectedExecution = createRetrievalRunReference(run);
  return {
    ...common({
      id,
      query: selectedExecution.query,
      upstreamArtifactFingerprints: [
        parentProtocolFingerprint,
        calibrationFingerprint,
      ],
    }),
    parentProtocolFingerprint,
    calibrationFingerprint,
    selectedExecution,
    frozenAt: FROZEN_AT,
    freezeReason: "Freeze the exact query that passed the recorded calibration.",
  };
}

async function completeChain() {
  const scope = rootArtifact("scope-decision", "ScopeDecision");
  const angle = rootArtifact("review-angle", "ReviewAngleDecision");

  const orientationQuery = "(breast neoplasms) AND acupuncture AND fatigue";
  const orientationMatrix = artifact(
    "OrientationConceptMatrix",
    "orientation-matrix",
    conceptMatrix({
      id: "orientation-matrix",
      query: orientationQuery,
      upstream: createSearchMethodArtifactFingerprint(scope),
    }),
  );
  const orientationProtocolArtifact = artifact(
    "OrientationSearchProtocol",
    "orientation-protocol",
    orientationProtocol({ matrix: orientationMatrix, query: orientationQuery }),
  );
  const pilotRun = await retrievalRun({
    protocol: orientationProtocolArtifact,
    purpose: "pilot",
    nodeId: "run_pilot_search",
    queryId: "orientation-broad",
    query: orientationQuery,
  });
  const orientationCalibration = artifact(
    "OrientationCalibrationReport",
    "orientation-calibration",
    calibration({
      id: "orientation-calibration",
      protocol: orientationProtocolArtifact,
      run: pilotRun,
      selected: {
        id: "orientation-broad",
        purpose: "broad field orientation",
        query: orientationQuery,
        queryHash: sha256(orientationQuery),
      },
    }),
  );
  const frozenOrientation = artifact(
    "FrozenOrientationSearchProtocol",
    "frozen-orientation",
    frozen({
      id: "frozen-orientation",
      protocol: orientationProtocolArtifact,
      calibrationArtifact: orientationCalibration,
      run: pilotRun,
    }),
  );

  const focusedQuery =
    "(breast neoplasms) AND acupuncture AND chemotherapy-related fatigue";
  const adjacentQuery = "breast cancer AND acupressure AND fatigue";
  const focusedMatrix = artifact(
    "FocusedConceptMatrix",
    "focused-matrix",
    conceptMatrix({
      id: "focused-matrix",
      query: focusedQuery,
      upstream: createSearchMethodArtifactFingerprint(angle),
      focused: true,
    }),
  );
  const focusedProtocolArtifact = artifact(
    "FocusedSearchProtocol",
    "focused-protocol",
    focusedProtocol({
      matrix: focusedMatrix,
      primaryQuery: focusedQuery,
      adjacentQuery,
    }),
  );
  const focusedRun = await retrievalRun({
    protocol: focusedProtocolArtifact,
    purpose: "focusedCalibration",
    nodeId: "calibrate_focused_search",
    queryId: "focused-core",
    query: focusedQuery,
  });
  const focusedCalibration = artifact(
    "FocusedCalibrationReport",
    "focused-calibration",
    calibration({
      id: "focused-calibration",
      protocol: focusedProtocolArtifact,
      run: focusedRun,
      selected: focusedProtocolArtifact.content.queryVariants[0],
      focused: true,
    }),
  );
  const frozenFocused = artifact(
    "FrozenSearchProtocol",
    "frozen-focused",
    frozen({
      id: "frozen-focused",
      protocol: focusedProtocolArtifact,
      calibrationArtifact: focusedCalibration,
      run: focusedRun,
    }),
  );

  return {
    artifacts: [
      scope,
      angle,
      orientationMatrix,
      orientationProtocolArtifact,
      orientationCalibration,
      frozenOrientation,
      focusedMatrix,
      focusedProtocolArtifact,
      focusedCalibration,
      frozenFocused,
    ],
    retrievalRuns: [pilotRun, focusedRun],
  };
}

test("the complete orientation and focused method chain binds exact PubMed runs", async () => {
  const chain = await completeChain();
  assert.equal(assertValidSearchMethodAuthorityChain(chain), chain);
  assert.deepEqual(validateSearchMethodAuthorityChain(chain), []);
});

test("a human protocol revision preserves method authority while changing only executable queries", async () => {
  const chain = await completeChain();
  const previous = chain.artifacts.find(
    (item) => item.type === "FocusedSearchProtocol",
  );
  previous.lineageId = "focused-protocol-lineage";
  const revisedQuery = `${previous.content.query} AND adult[mh]`;
  const revisedAdjacentQuery = `(${revisedQuery}) AND hasabstract`;
  const revisedContent = {
    ...structuredClone(previous.content),
    id: "focused-protocol-v2",
    version: 2,
    createdAt: "2026-08-13T02:00:00.000Z",
    query: revisedQuery,
    queryHash: sha256(revisedQuery),
    queryVariants: [
      {
        ...previous.content.queryVariants[0],
        query: revisedQuery,
        queryHash: sha256(revisedQuery),
      },
      {
        ...previous.content.queryVariants[1],
        query: revisedAdjacentQuery,
        queryHash: sha256(revisedAdjacentQuery),
      },
    ],
    previousProtocolFingerprint: createSearchMethodArtifactFingerprint(previous),
    humanRevision: {
      revisedBy: { id: "research-owner", role: "human_researcher", kind: "human" },
      revisedAt: "2026-08-13T02:00:00.000Z",
      reason: "Zero-result calibration required a broader, explicitly bounded query.",
      previousQuery: previous.content.query,
      previousQueryHash: previous.content.queryHash,
    },
  };
  const revised = {
    id: revisedContent.id,
    type: previous.type,
    version: 2,
    lineageId: previous.lineageId,
    producedByActorId: "research-owner",
    producedByActorRole: "human_researcher",
    content: revisedContent,
    contentHash: sha256(revisedContent),
  };
  assert.deepEqual(
    validateSearchMethodAuthorityChain({
      artifacts: [
        ...chain.artifacts.filter(
          (item) =>
            !["FocusedCalibrationReport", "FrozenSearchProtocol"].includes(item.type),
        ),
        revised,
      ],
      retrievalRuns: chain.retrievalRuns.filter(
        (run) => run.purpose !== "focusedCalibration",
      ),
    }),
    [],
  );

  revised.content.humanRevision.previousQuery = "invented prior query";
  revised.content.humanRevision.previousQueryHash = sha256("invented prior query");
  revised.contentHash = sha256(revised.content);
  assert.match(
    validateSearchMethodAuthorityChain({
      artifacts: [
        ...chain.artifacts.filter(
          (item) =>
            !["FocusedCalibrationReport", "FrozenSearchProtocol"].includes(item.type),
        ),
        revised,
      ],
      retrievalRuns: chain.retrievalRuns.filter(
        (run) => run.purpose !== "focusedCalibration",
      ),
    }).join("\n"),
    /humanRevision must bind the exact previous query/,
  );
});

test("candidate contents support same-node protocol, calibration, and frozen bindings", async () => {
  const chain = await completeChain();
  const roots = chain.artifacts.filter((item) =>
    ["ScopeDecision", "ReviewAngleDecision"].includes(item.type),
  );
  const candidates = chain.artifacts.filter(
    (item) => !["ScopeDecision", "ReviewAngleDecision"].includes(item.type),
  );
  assert.deepEqual(
    validateSearchMethodAuthorityChain({
      artifacts: roots,
      candidateContents: candidates,
      retrievalRuns: chain.retrievalRuns,
    }),
    [],
  );
});

test("a fake receipt hash cannot satisfy a calibration or frozen protocol", async () => {
  const chain = await completeChain();
  const calibrationArtifact = chain.artifacts.find(
    (item) => item.type === "OrientationCalibrationReport",
  );
  calibrationArtifact.content.retrievalRunRefs[0] = {
    ...calibrationArtifact.content.retrievalRunRefs[0],
    receiptHash: "f".repeat(64),
  };
  calibrationArtifact.contentHash = sha256(calibrationArtifact.content);
  assert.match(
    validateSearchMethodAuthorityChain(chain).join("\n"),
    /does not match a supplied, valid retrieval run/,
  );
});

test("a retrieval run from another purpose or node cannot calibrate the protocol", async () => {
  const chain = await completeChain();
  const focusedCalibration = chain.artifacts.find(
    (item) => item.type === "FocusedCalibrationReport",
  );
  const pilotReference = createRetrievalRunReference(chain.retrievalRuns[0]);
  focusedCalibration.content.retrievalRunRefs = [pilotReference];
  focusedCalibration.content.selectedQuery = {
    id: pilotReference.queryId,
    purpose: "wrong cross-purpose selection",
    query: pilotReference.query,
    queryHash: pilotReference.queryHash,
  };
  focusedCalibration.content.query = pilotReference.query;
  focusedCalibration.content.queryHash = pilotReference.queryHash;
  focusedCalibration.contentHash = sha256(focusedCalibration.content);
  const issues = validateSearchMethodAuthorityChain(chain).join("\n");
  assert.match(issues, /purpose must equal focusedCalibration/);
  assert.match(issues, /nodeId must equal calibrate_focused_search/);
});

test("query and queryHash drift is rejected at contract and cross-object layers", async () => {
  const chain = await completeChain();
  const focusedProtocolArtifact = chain.artifacts.find(
    (item) => item.type === "FocusedSearchProtocol",
  );
  focusedProtocolArtifact.content.queryVariants[0].query = "invented changed query";
  focusedProtocolArtifact.contentHash = sha256(focusedProtocolArtifact.content);
  const issues = validateSearchMethodAuthorityChain(chain).join("\n");
  assert.match(issues, /queryHash does not match/);
  assert.match(issues, /query is not declared by the bound protocol/);
});

test("focused query variants require unique ids, queries, and query hashes", async () => {
  const chain = await completeChain();
  const focusedProtocolArtifact = chain.artifacts.find(
    (item) => item.type === "FocusedSearchProtocol",
  );
  focusedProtocolArtifact.content.queryVariants[1] = {
    ...focusedProtocolArtifact.content.queryVariants[0],
  };
  focusedProtocolArtifact.contentHash = sha256(focusedProtocolArtifact.content);
  const issues = validateSearchMethodAuthorityChain(chain).join("\n");
  assert.match(issues, /must not repeat id focused-core/);
  assert.match(issues, /must not repeat query/);
  assert.match(issues, /must not repeat queryHash/);
});

test("a focused protocol requires at least two executable query variants", async () => {
  const chain = await completeChain();
  const focusedProtocolArtifact = chain.artifacts.find(
    (item) => item.type === "FocusedSearchProtocol",
  );
  focusedProtocolArtifact.content.queryVariants = [
    focusedProtocolArtifact.content.queryVariants[0],
  ];
  focusedProtocolArtifact.contentHash = sha256(focusedProtocolArtifact.content);

  assert.match(
    validateSearchMethodAuthorityChain(chain).join("\n"),
    /queryVariants must contain at least two executable variants/,
  );
});

test("an unretrieved sentinel cannot keep or freeze a protocol", async () => {
  const chain = await completeChain();
  const calibrationArtifact = chain.artifacts.find(
    (item) => item.type === "OrientationCalibrationReport",
  );
  const frozenArtifact = chain.artifacts.find(
    (item) => item.type === "FrozenOrientationSearchProtocol",
  );
  calibrationArtifact.content.sentinelChecks[0] = {
    ...calibrationArtifact.content.sentinelChecks[0],
    retrieved: false,
    note: "The pre-registered sentinel was not retrieved, so revision is required.",
  };
  calibrationArtifact.contentHash = sha256(calibrationArtifact.content);
  const calibrationFingerprint =
    createSearchMethodArtifactFingerprint(calibrationArtifact);
  frozenArtifact.content.calibrationFingerprint = calibrationFingerprint;
  frozenArtifact.content.upstreamArtifactFingerprints = [
    frozenArtifact.content.parentProtocolFingerprint,
    calibrationFingerprint,
  ];
  frozenArtifact.contentHash = sha256(frozenArtifact.content);

  const issues = validateSearchMethodAuthorityChain(chain).join("\n");
  assert.match(
    issues,
    /revisionDecision keep requires every sentinelChecks item to be successfully retrieved/,
  );
  assert.match(issues, /cannot keep a protocol after an unretrieved or failed sentinel/);
  assert.match(issues, /cannot freeze a protocol with an unretrieved or failed sentinel/);
});

test("a frozen protocol must bind the exact calibrated executed receipt", async () => {
  const chain = await completeChain();
  const frozenFocused = chain.artifacts.find(
    (item) => item.type === "FrozenSearchProtocol",
  );
  frozenFocused.content.selectedExecution = {
    ...frozenFocused.content.selectedExecution,
    query: "mismatched frozen query",
    queryHash: sha256("mismatched frozen query"),
  };
  frozenFocused.content.query = "mismatched frozen query";
  frozenFocused.content.queryHash = sha256("mismatched frozen query");
  frozenFocused.contentHash = sha256(frozenFocused.content);
  const issues = validateSearchMethodAuthorityChain(chain).join("\n");
  assert.match(issues, /does not match a supplied, valid retrieval run/);
  assert.match(issues, /must be one of the calibration retrieval runs/);
  assert.match(issues, /must equal the calibrated selectedQuery/);
});
