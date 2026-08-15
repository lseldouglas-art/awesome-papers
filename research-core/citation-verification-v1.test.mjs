import test from "node:test";
import assert from "node:assert/strict";

import {
  CitationVerificationError,
  enforceCitationVerification,
} from "./citation-verification-v1.js";
import { ResearchToolGateway } from "./research-tool-gateway-v1.js";

function workOrder(sentenceText, { sources = null, evidence = null, evidenceId = "evidence:1" } = {}) {
  const sourceMaterials = sources ?? [
    {
      id: "pmid:123",
      title: "Bounded evidence",
      text: "The retrieved sample showed a limited association.",
      accessLevel: "abstract_only",
      sourceSnapshotHash: "a".repeat(64),
      locator: { pmid: "123" },
    },
  ];
  const evidenceRecords = evidence ?? [
    {
      id: "evidence:1",
      type: "EvidenceRecord",
      content: {
        sourceId: "pmid:123",
        sourceSnapshotHash: "a".repeat(64),
      },
    },
  ];
  return {
    id: "work-order:verify",
    role: "citation_verifier",
    project: {
      sourceMaterials,
    },
    inputArtifacts: [
      {
        id: "draft:1",
        type: "ClaimUnitDraft",
        content: {
          producerId: "agent:claim_unit_writer",
          sentences: [
            {
              id: "sentence:1",
              text: sentenceText,
              kind: "factual",
              citationIntents: [
                { id: "intent:1", evidenceId, purpose: "support" },
              ],
            },
          ],
        },
      },
      ...evidenceRecords,
    ],
    requiredOutputs: [
      {
        artifactId: "verification:1",
        type: "ClaimVerificationResult",
        slot: 1,
        version: 1,
      },
    ],
  };
}

function proposedCandidate(verdict = "direct_support") {
  return [
    {
      artifactId: "verification:1",
      type: "ClaimVerificationResult",
      content: {
        sentenceResults: [{ sentenceId: "sentence:1", verdict }],
      },
    },
  ];
}

test("model-authored direct_support is replaced by a source-bound tool receipt", async () => {
  const audits = [];
  const gateway = new ResearchToolGateway({
    now: () => new Date("2026-08-12T09:00:00.000Z"),
  });
  const result = await enforceCitationVerification({
    workOrder: workOrder("This treatment definitively causes recovery."),
    candidates: proposedCandidate("direct_support"),
    gateway,
    onReceipt: async (event) => audits.push(event),
  });

  const sentence = result[0].content.sentenceResults[0];
  assert.equal(sentence.verdict, "unsupported");
  assert.equal(sentence.verifiedEvidenceIds.length, 0);
  assert.match(sentence.requiredRevision, /删除|补充/);
  assert.match(sentence.verificationReceipt.receiptHash, /^[a-f0-9]{64}$/);
  assert.equal(sentence.verificationReceipt.toolId, "citation_verify");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].toolName, "citation_verify");
});

test("an exact visible excerpt can pass but preserves scope limitations", async () => {
  const gateway = new ResearchToolGateway({
    now: () => new Date("2026-08-12T09:00:00.000Z"),
  });
  const result = await enforceCitationVerification({
    workOrder: workOrder("The retrieved sample showed a limited association."),
    candidates: proposedCandidate("unsupported"),
    gateway,
  });

  const sentence = result[0].content.sentenceResults[0];
  assert.equal(sentence.verdict, "direct_support");
  assert.equal(sentence.requiredRevision, null);
  assert.deepEqual(sentence.verifiedEvidenceIds, ["evidence:1"]);
  assert.equal(sentence.verificationReceipt.sourceBindingSatisfied, true);
  assert.deepEqual(
    sentence.verificationReceipt.matchedSourceRefs.map((reference) => reference.sourceId),
    ["pmid:123"],
  );
  assert.match(result[0].content.limitations.join(" "), /因果/);
});

test("interpretation sentences also require a source-bound tool receipt", async () => {
  const order = workOrder("The retrieved sample showed a limited association.");
  order.inputArtifacts[0].content.sentences[0].kind = "interpretation";
  const result = await enforceCitationVerification({
    workOrder: order,
    candidates: proposedCandidate("unsupported"),
    gateway: new ResearchToolGateway({
      now: () => new Date("2026-08-12T09:00:00.000Z"),
    }),
  });
  assert.equal(result[0].content.sentenceResults.length, 1);
  assert.equal(result[0].content.sentenceResults[0].verdict, "direct_support");
  assert.match(
    result[0].content.sentenceResults[0].verificationReceipt.receiptHash,
    /^[a-f0-9]{64}$/,
  );
});

test("transition labels cannot bypass source-bound citation verification", async () => {
  const order = workOrder("The retrieved sample showed a limited association.");
  order.inputArtifacts[0].content.sentences[0].kind = "transition";
  const result = await enforceCitationVerification({
    workOrder: order,
    candidates: proposedCandidate("unsupported"),
    gateway: new ResearchToolGateway({
      now: () => new Date("2026-08-12T09:00:00.000Z"),
    }),
  });
  assert.equal(result[0].content.sentenceResults.length, 1);
  assert.equal(result[0].content.sentenceResults[0].verdict, "direct_support");
});

test("a positive substring inside an uncertainty sentence is not direct support", async () => {
  const uncertainSource = [{
    id: "pmid:uncertain",
    title: "Uncertain finding",
    text: "It remains unknown whether Drug X reduces mortality by 50%.",
    accessLevel: "abstract_only",
    sourceSnapshotHash: "c".repeat(64),
    locator: { pmid: "999" },
  }];
  const uncertainEvidence = [{
    id: "evidence:uncertain",
    type: "EvidenceRecord",
    content: {
      sourceId: "pmid:uncertain",
      sourceSnapshotHash: "c".repeat(64),
    },
  }];
  const result = await enforceCitationVerification({
    workOrder: workOrder("Drug X reduces mortality by 50%.", {
      sources: uncertainSource,
      evidence: uncertainEvidence,
      evidenceId: "evidence:uncertain",
    }),
    candidates: proposedCandidate("direct_support"),
    gateway: new ResearchToolGateway({
      now: () => new Date("2026-08-12T09:00:00.000Z"),
    }),
  });
  assert.equal(result[0].content.sentenceResults[0].verdict, "unsupported");
  assert.deepEqual(result[0].content.sentenceResults[0].verifiedEvidenceIds, []);
});

test("adjacent epistemic context cannot be promoted to direct support", async () => {
  const claim = "Drug X reduces mortality by 50%.";
  const guardedParagraphs = [
    "It remains unknown whether the following hypothesis is true. Drug X reduces mortality by 50%.",
    "It is uncertain. Drug X reduces mortality by 50%.",
    "Drug X reduces mortality by 50%. This result was not statistically significant.",
    "Drug X reduces mortality by 50%. However, this could not be confirmed.",
    "It is uncertain.\n\nDrug X reduces mortality by 50%.",
    "It remains unknown whether the following hypothesis is true: Drug X reduces mortality by 50%.",
    "It remains unknown whether the following hypothesis is true; Drug X reduces mortality by 50%.",
  ];

  for (const [index, text] of guardedParagraphs.entries()) {
    const sourceId = `pmid:adjacent:${index}`;
    const snapshotHash = String(index + 1).padStart(64, "0");
    const result = await enforceCitationVerification({
      workOrder: workOrder(claim, {
        sources: [{
          id: sourceId,
          title: "Epistemically scoped finding",
          text,
          accessLevel: "abstract_only",
          sourceSnapshotHash: snapshotHash,
          locator: { pmid: String(1000 + index) },
        }],
        evidence: [{
          id: "evidence:guarded",
          type: "EvidenceRecord",
          content: { sourceId, sourceSnapshotHash: snapshotHash },
        }],
        evidenceId: "evidence:guarded",
      }),
      candidates: proposedCandidate("direct_support"),
      gateway: new ResearchToolGateway({
        now: () => new Date("2026-08-12T09:00:00.000Z"),
      }),
    });
    const sentence = result[0].content.sentenceResults[0];
    assert.equal(sentence.verdict, "unsupported", text);
    assert.deepEqual(sentence.verifiedEvidenceIds, [], text);
  }
});

test("a complete uncertainty sentence preserves its epistemic scope", async () => {
  const claim = "It remains unknown whether Drug X reduces mortality by 50%.";
  const sourceId = "pmid:complete-uncertain";
  const snapshotHash = "d".repeat(64);
  const result = await enforceCitationVerification({
    workOrder: workOrder(claim, {
      sources: [{
        id: sourceId,
        title: "Epistemically scoped finding",
        text: claim,
        accessLevel: "abstract_only",
        sourceSnapshotHash: snapshotHash,
        locator: { pmid: "2000" },
      }],
      evidence: [{
        id: "evidence:complete-uncertain",
        type: "EvidenceRecord",
        content: { sourceId, sourceSnapshotHash: snapshotHash },
      }],
      evidenceId: "evidence:complete-uncertain",
    }),
    candidates: proposedCandidate("unsupported"),
    gateway: new ResearchToolGateway({
      now: () => new Date("2026-08-12T09:00:00.000Z"),
    }),
  });
  assert.equal(result[0].content.sentenceResults[0].verdict, "direct_support");
  assert.deepEqual(
    result[0].content.sentenceResults[0].verifiedEvidenceIds,
    ["evidence:complete-uncertain"],
  );
});

test("a sentence matching the second source cannot validate an EvidenceRecord from the first source", async () => {
  const gateway = new ResearchToolGateway({
    now: () => new Date("2026-08-12T09:00:00.000Z"),
  });
  const sources = [
    {
      id: "source:first",
      title: "Unrelated source",
      text: "This source does not contain the claimed statement.",
      accessLevel: "abstract_only",
      sourceSnapshotHash: "a".repeat(64),
      locator: { pmid: "111" },
    },
    {
      id: "source:second",
      title: "Actually matching source",
      text: "The second source contains this exact statement.",
      accessLevel: "abstract_only",
      sourceSnapshotHash: "b".repeat(64),
      locator: { pmid: "222" },
    },
  ];
  const evidence = [
    {
      id: "evidence:first",
      type: "EvidenceRecord",
      content: {
        sourceId: "source:first",
        sourceSnapshotHash: "a".repeat(64),
      },
    },
  ];
  const result = await enforceCitationVerification({
    workOrder: workOrder("The second source contains this exact statement.", {
      sources,
      evidence,
      evidenceId: "evidence:first",
    }),
    candidates: proposedCandidate("direct_support"),
    gateway,
  });

  const sentence = result[0].content.sentenceResults[0];
  assert.equal(sentence.verdict, "unsupported");
  assert.deepEqual(sentence.verifiedEvidenceIds, []);
  assert.equal(sentence.verificationReceipt.sourceBindingSatisfied, false);
  assert.deepEqual(
    sentence.verificationReceipt.matchedSourceRefs.map((reference) => reference.sourceId),
    ["source:second"],
  );
  assert.deepEqual(
    sentence.verificationReceipt.unmatchedExpectedSourceRefs,
    [{ sourceId: "source:first", sourceSnapshotHash: "a".repeat(64) }],
  );
  assert.match(sentence.requiredRevision, /其他来源|EvidenceRecord/);
});

test("verification fails closed when the cited EvidenceRecord is absent from the work order", async () => {
  const order = workOrder("The retrieved sample showed a limited association.");
  order.inputArtifacts = order.inputArtifacts.filter(
    (artifact) => artifact.type !== "EvidenceRecord",
  );
  await assert.rejects(
    enforceCitationVerification({
      workOrder: order,
      candidates: proposedCandidate(),
      gateway: new ResearchToolGateway(),
    }),
    (error) =>
      error instanceof CitationVerificationError &&
      error.code === "CITATION_EVIDENCE_BINDING_UNRESOLVED",
  );
});

test("verification fails closed without a citation tool", async () => {
  await assert.rejects(
    enforceCitationVerification({
      workOrder: workOrder("The retrieved sample showed a limited association."),
      candidates: proposedCandidate(),
      gateway: {},
    }),
    (error) =>
      error instanceof CitationVerificationError &&
      error.code === "CITATION_VERIFIER_UNAVAILABLE",
  );
});
