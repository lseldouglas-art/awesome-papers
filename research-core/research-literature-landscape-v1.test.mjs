import test from "node:test";
import assert from "node:assert/strict";

import { validateResearchArtifactContent } from "./artifact-contracts-v1.js";
import { buildResearchOutputProjection } from "./research-artifact-presentation-v1.js";
import {
  buildLiteratureLandscape,
  landscapeBuildToArtifacts,
} from "./research-literature-landscape-v1.js";
import {
  assertValidLiteratureLandscapeBuild,
  validateIdeaCandidate,
  validateLiteratureLandscapeBuild,
} from "./research-literature-landscape-contracts-v1.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);

function source(id, title, text, hash, accessLevel = "abstract_only") {
  return {
    id,
    title,
    text,
    accessLevel,
    locator: { pmid: id.replace(/\D/g, "") || id },
    sourceSnapshotHash: hash,
  };
}

function project() {
  return {
    id: "landscape-project",
    title: "文献地形纵切",
    question: "哪些研究设计和机制证据能够支持患者风险判断？",
    sourceMaterials: [
      source(
        "PMID:1001",
        "Machine learning biomarker in patients",
        "An observational cohort reports an association in human patients.",
        HASH_A,
      ),
      source(
        "PMID:1002",
        "Clinical trial of a biomarker intervention",
        "A randomized intervention evaluates efficacy and adverse events in patients.",
        HASH_B,
      ),
      source(
        "PMID:1003",
        "Mechanistic pathway in mice",
        "An in vivo mouse model investigates a molecular signaling mechanism.",
        HASH_C,
      ),
      source(
        "PMID:1004",
        "An opaque document",
        "Zyxwvu qrst nopq.",
        HASH_D,
      ),
    ],
  };
}

function evidenceRecords() {
  return [
    {
      id: "evidence-support",
      type: "EvidenceRecord",
      content: {
        id: "evidence-support",
        sourceId: "PMID:1001",
        claimId: "claim:risk",
        relation: "partially_supports",
      },
    },
    {
      id: "evidence-contradict",
      type: "EvidenceRecord",
      content: {
        id: "evidence-contradict",
        sourceId: "PMID:1002",
        claimId: "claim:risk",
        relation: "contradicts",
      },
    },
  ];
}

test("buildLiteratureLandscape produces multi-label auditable objects without scientific scores", () => {
  const build = buildLiteratureLandscape({
    project: project(),
    evidenceRecords: evidenceRecords(),
    generatedAt: "2026-08-13T00:00:00.000Z",
  });

  assert.deepEqual(validateLiteratureLandscapeBuild(build), []);
  assert.equal(build.literatureLandscape.sourceCount, 4);
  assert.equal(build.literatureLandscape.unclassifiedSourceCount, 1);
  assert.equal(build.literatureLandscape.unclassifiedRate, 0.25);
  assert.deepEqual(build.unclassifiedBucket.sourceIds, ["PMID:1004"]);

  const first = build.tagAssignments.find((item) => item.sourceId === "PMID:1001");
  assert.ok(first.tags.length >= 3, "one source can enter several tags");
  assert.ok(first.tags.some((tag) => tag.dimension === "study_design"));
  assert.ok(first.tags.some((tag) => tag.dimension === "population"));
  assert.ok(first.tags.some((tag) => tag.dimension === "research_purpose"));

  const controversy = build.literatureLandscape.controversies[0];
  assert.equal(controversy.kind, "recorded_relation_conflict");
  assert.deepEqual(controversy.sourceIds.sort(), ["PMID:1001", "PMID:1002"]);
  assert.deepEqual(controversy.supportingEvidenceRecordIds, ["evidence-support"]);
  assert.deepEqual(controversy.contradictingEvidenceRecordIds, ["evidence-contradict"]);

  assert.ok(build.ideaCandidates.length > 0);
  for (const candidate of build.ideaCandidates) {
    assert.equal(candidate.status, "unvalidated_hypothesis");
    assert.ok(candidate.anchor.sourceIds.length > 0);
    assert.ok(candidate.componentPool.length > 0);
    assert.match(candidate.relationshipRationale, /不证明/);
    assert.equal(candidate.rejectionReason, null);
    assert.ok(candidate.recheckQuery.length > 0);
    assert.ok(candidate.sourceRefs.length > 0);
    assert.match(candidate.validationBoundary, /不得表述为.*成立/);
    assert.equal("score" in candidate, false);
    assert.deepEqual(validateIdeaCandidate(candidate), []);
  }
  assert.deepEqual(build.ideaDecisionLedger.pendingCandidateIds, build.ideaCandidates.map((item) => item.id));
  assert.deepEqual(build.ideaDecisionLedger.entries, []);
  assert.match(build.literatureLandscape.method.description, /不是统计聚类/);
});

test("ASCII tag rules use token boundaries so surgical words do not masquerade as rat studies", () => {
  const build = buildLiteratureLandscape({
    project: {
      id: "rat-boundary-regression",
      question: "术后人体研究与动物研究如何区分？",
      sourceMaterials: [
        source(
          "PMID:2001",
          "Postoperative recovery rate after operation",
          "Risk stratification was performed in human patients after operation.",
          HASH_A,
        ),
        source(
          "PMID:2002",
          "Rat model of postoperative recovery",
          "Rats were used to study an in vivo mechanism.",
          HASH_B,
        ),
      ],
    },
  });
  const human = build.tagAssignments.find((item) => item.sourceId === "PMID:2001");
  const rat = build.tagAssignments.find((item) => item.sourceId === "PMID:2002");
  const preclinicalTag = "tag:population:preclinical";
  assert.equal(human.tags.some((tag) => tag.tagId === preclinicalTag), false);
  const animalAssignment = rat.tags.find((tag) => tag.tagId === preclinicalTag);
  assert.ok(animalAssignment);
  assert.ok(animalAssignment.matchedTerms.includes("rat"));
  assert.ok(animalAssignment.matchedTerms.includes("rats"));
  assert.equal(
    animalAssignment.matchedTerms.some((term) => ["operation", "rate", "stratification"].includes(term)),
    false,
  );
});

test("every candidate traces to concrete source snapshots and EvidenceRecord ids", () => {
  const build = buildLiteratureLandscape({ project: project(), evidenceRecords: evidenceRecords() });
  const known = new Set(project().sourceMaterials.map((item) => item.id));
  const knownEvidence = new Set(evidenceRecords().map((item) => item.id));

  for (const candidate of build.ideaCandidates) {
    for (const ref of candidate.sourceRefs) {
      assert.equal(known.has(ref.sourceId), true);
      assert.match(ref.sourceSnapshotHash, /^[a-f0-9]{64}$/);
      for (const evidenceId of ref.evidenceRecordIds) {
        assert.equal(knownEvidence.has(evidenceId), true);
      }
    }
    for (const sourceId of candidate.anchor.sourceIds) assert.equal(known.has(sourceId), true);
    for (const component of candidate.componentPool) {
      for (const sourceId of component.sourceIds) assert.equal(known.has(sourceId), true);
    }
  }
});

test("human decisions are required in the decision ledger and rejected candidate data needs a reason", () => {
  const first = buildLiteratureLandscape({ project: project(), evidenceRecords: evidenceRecords() });
  const selected = first.ideaCandidates[0];
  const decided = buildLiteratureLandscape({
    project: project(),
    evidenceRecords: evidenceRecords(),
    decisionEntries: [{
      candidateId: selected.id,
      decision: "selected",
      reason: "先重检目标人群与设计边界，尚不认为关系成立。",
      decidedBy: { id: "researcher-1", role: "human_researcher", kind: "human" },
      decidedAt: "2026-08-13T01:00:00.000Z",
    }],
  });
  assert.equal(decided.ideaDecisionLedger.entries[0].decidedBy.kind, "human");
  assert.equal(decided.ideaDecisionLedger.pendingCandidateIds.includes(selected.id), false);
  assert.equal(
    decided.ideaCandidates.find((candidate) => candidate.id === selected.id).status,
    "selected_for_recheck",
  );

  const rejected = buildLiteratureLandscape({
    project: project(),
    evidenceRecords: evidenceRecords(),
    decisionEntries: [{
      candidateId: selected.id,
      decision: "rejected",
      reason: "当前目标体量与可见证据不匹配，保留供以后重开。",
      decidedBy: { id: "researcher-1", role: "human_researcher", kind: "human" },
      decidedAt: "2026-08-13T01:30:00.000Z",
    }],
  });
  const rejectedCandidate = rejected.ideaCandidates.find((candidate) => candidate.id === selected.id);
  assert.equal(rejectedCandidate.status, "rejected");
  assert.match(rejectedCandidate.rejectionReason, /目标体量/);

  const invalid = { ...selected, status: "rejected", rejectionReason: null };
  assert.ok(validateIdeaCandidate(invalid).some((issue) => issue.includes("rejectionReason")));
  assert.throws(
    () => buildLiteratureLandscape({
      project: project(),
      decisionEntries: [{
        candidateId: selected.id,
        decision: "selected",
        reason: "Agent cannot approve itself.",
        decidedBy: { id: "agent-1", role: "agent", kind: "agent" },
        decidedAt: "2026-08-13T01:00:00.000Z",
      }],
    }),
    /human actor/,
  );
  assert.throws(
    () => buildLiteratureLandscape({
      project: project(),
      decisionEntries: [{
        candidateId: selected.id,
        decision: "selected",
        reason: "A valid decision cannot cite an unrelated source.",
        decidedBy: { id: "researcher-1", role: "human_researcher", kind: "human" },
        decidedAt: "2026-08-13T01:45:00.000Z",
        sourceIds: ["PMID:9999"],
      }],
    }),
    /outside candidate/,
  );
});

test("revision history retains the previous source-set and classification fingerprint", () => {
  const first = buildLiteratureLandscape({ project: project(), version: 1 });
  const revisedProject = project();
  revisedProject.sourceMaterials[3].text = "A systematic review of patient safety.";
  revisedProject.sourceMaterials[3].sourceSnapshotHash = "e".repeat(64);
  const second = buildLiteratureLandscape({
    project: revisedProject,
    version: 2,
    previousBuild: first,
    revision: {
      version: 1,
      changedAt: "2026-08-13T02:00:00.000Z",
      changedBy: { id: "researcher-1", role: "human_researcher", kind: "human" },
      reason: "研究者补读摘要后修订可见文本。",
    },
  });
  assert.equal(second.literatureLandscape.version, 2);
  assert.equal(second.literatureLandscape.revisionHistory.length, 1);
  assert.equal(second.literatureLandscape.revisionHistory[0].sourceSetHash, first.literatureLandscape.sourceSetHash);
  assert.equal(second.literatureLandscape.unclassifiedRate, 0);
  assert.notEqual(second.literatureLandscape.sourceSetHash, first.literatureLandscape.sourceSetHash);
});

test("empty source set is explicit and never fabricates candidates", () => {
  const build = buildLiteratureLandscape({
    project: { id: "empty-landscape", question: "暂无材料", sourceMaterials: [] },
  });
  assert.equal(build.literatureLandscape.sourceCount, 0);
  assert.equal(build.literatureLandscape.unclassifiedRate, 0);
  assert.deepEqual(build.clusterMap.clusters, []);
  assert.deepEqual(build.tagAssignments, []);
  assert.deepEqual(build.ideaCandidates, []);
  assertValidLiteratureLandscapeBuild(build);
});

test("landscape objects participate in the canonical artifact content contracts", () => {
  const build = buildLiteratureLandscape({ project: project(), evidenceRecords: evidenceRecords() });
  const artifacts = landscapeBuildToArtifacts(build, {
    inputArtifactRefs: [{ artifactId: "library-manifest-1", version: 1, contentHash: HASH_A }],
  });
  assert.ok(artifacts.length >= 6);
  for (const artifact of artifacts) {
    assert.deepEqual(validateResearchArtifactContent(artifact.type, artifact.content), []);
    assert.match(artifact.contentHash, /^[a-f0-9]{64}$/);
    assert.equal(artifact.content.id, artifact.id);
  }
});

test("successive builds keep stable lineages while assigning new artifact ids", () => {
  const first = landscapeBuildToArtifacts(buildLiteratureLandscape({ project: project(), version: 1 }));
  const second = landscapeBuildToArtifacts(buildLiteratureLandscape({ project: project(), version: 2 }));
  const key = (artifact) => `${artifact.type}:${artifact.lineageId}`;
  assert.deepEqual(first.map(key).sort(), second.map(key).sort());
  assert.equal(first.every((artifact) => !second.some((next) => next.id === artifact.id)), true);
  assert.equal(second.every((artifact) => artifact.version === 2), true);
});

test("builder accepts persisted SourceSnapshot artifacts as its source-material input", () => {
  const sourceSnapshotArtifacts = project().sourceMaterials.slice(0, 2).map((item, index) => ({
    id: `artifact:source-snapshot:${index + 1}`,
    type: "SourceSnapshot",
    contentHash: item.sourceSnapshotHash,
    content: {
      id: `artifact:source-snapshot:${index + 1}`,
      sourceId: item.id,
      title: item.title,
      text: item.text,
      accessLevel: item.accessLevel,
      locator: item.locator,
      sourceSnapshotHash: item.sourceSnapshotHash,
    },
  }));
  const build = buildLiteratureLandscape({
    project: {
      id: "source-snapshot-landscape",
      question: "真实 SourceSnapshot 纵切",
      sourceMaterials: sourceSnapshotArtifacts,
    },
  });
  assert.deepEqual(
    build.literatureLandscape.sourceRefs.map((item) => item.sourceId),
    ["PMID:1001", "PMID:1002"],
  );
  assert.equal(build.ideaCandidates.every((candidate) => candidate.sourceRefs.length > 0), true);
});

test("cross-object validator rejects dangling candidate references", () => {
  const build = structuredClone(buildLiteratureLandscape({ project: project() }));
  build.literatureLandscape.ideaCandidateIds.push("idea:missing");
  assert.ok(validateLiteratureLandscapeBuild(build).some((issue) => issue.includes("unknown candidate")));

  const outside = structuredClone(buildLiteratureLandscape({ project: project() }));
  outside.ideaCandidates[0].componentPool[0].sourceIds.push("PMID:9999");
  assert.ok(
    validateLiteratureLandscapeBuild(outside).some((issue) => issue.includes("absent from sourceRefs")),
  );

  const doubleClassified = structuredClone(buildLiteratureLandscape({ project: project() }));
  doubleClassified.unclassifiedBucket.sourceIds = [doubleClassified.tagAssignments[0].sourceId];
  doubleClassified.unclassifiedBucket.sourceRefs = [doubleClassified.tagAssignments[0].sourceRef];
  doubleClassified.unclassifiedBucket.sourceCount = 1;
  doubleClassified.unclassifiedBucket.rate = 0.25;
  assert.ok(
    validateLiteratureLandscapeBuild(doubleClassified).some((issue) => issue.includes("both classified and unclassified")),
  );
});

test("research presentation exposes the landscape as researcher-facing evidence outputs", () => {
  const input = project();
  const build = buildLiteratureLandscape({ project: input, evidenceRecords: evidenceRecords() });
  const artifacts = landscapeBuildToArtifacts(build);
  const projection = buildResearchOutputProjection({ project: input, artifacts });
  const types = new Set(projection.items.map((item) => item.type));
  for (const type of [
    "LiteratureLandscape",
    "ClusterMap",
    "TagAssignment",
    "UnclassifiedBucket",
    "IdeaCandidate",
    "IdeaDecisionLedger",
  ]) {
    assert.equal(types.has(type), true, `missing ${type}`);
  }
  const candidate = projection.items.find((item) => item.type === "IdeaCandidate");
  assert.ok(candidate.details.sourceRefs.length > 0);
  assert.match(candidate.details.validationBoundary, /不得表述为.*成立/);
  assert.deepEqual(
    candidate.traceability.sourceIds.sort(),
    candidate.details.sourceRefs.map((item) => item.sourceId).sort(),
  );
  const overview = projection.items.find((item) => item.type === "LiteratureLandscape");
  assert.match(overview.readableBody, /未分类/);
  assert.equal(overview.traceability.sourceIds.length, input.sourceMaterials.length);
  assert.equal(projection.internalWorkflow.count, 0);
});
