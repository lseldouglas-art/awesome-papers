import assert from "node:assert/strict";
import test from "node:test";

import {
  ManuscriptAuthorityError,
  assertValidManuscriptAuthorityChain,
  createDeterministicManuscriptDraft,
} from "./manuscript-authority-v1.js";

const acceptedUnit = {
  id: "accepted-unit-1",
  type: "AcceptedClaimUnit",
  version: 1,
  contentHash: "a".repeat(64),
  content: {
    boundaries: ["Only the accessed abstract is represented."],
    sentences: [
      {
        id: "sentence-1",
        text: "The accessed abstract reports a limited association.",
        kind: "factual",
      },
      {
        id: "sentence-2",
        text: "This interpretation remains bounded to that association.",
        kind: "interpretation",
      },
    ],
  },
};

function draft() {
  return createDeterministicManuscriptDraft({
    id: "draft-1",
    version: 1,
    writingPlanId: "plan-1",
    producerId: "editor-1",
    title: "Bounded manuscript",
    acceptedClaimUnits: [acceptedUnit],
  });
}

function audit(draftContent) {
  return {
    id: "audit-1",
    manuscriptDraftId: draftContent.id,
    manuscriptProducerId: draftContent.producerId,
    auditorId: "auditor-1",
    verdict: "pass",
    checkedClaimUnitIds: [...draftContent.acceptedClaimUnitIds],
    draftAssemblyFingerprint: draftContent.assembly.fingerprint,
    disclosedLimitations: [...draftContent.limitations],
    findings: [],
  };
}

function audited(draftContent, auditContent) {
  return {
    id: "audited-1",
    manuscriptDraftId: draftContent.id,
    manuscriptAuditId: auditContent.id,
    producerId: draftContent.producerId,
    auditorId: auditContent.auditorId,
    auditVerdict: auditContent.verdict,
    title: draftContent.title,
    abstract: draftContent.abstract,
    conclusion: draftContent.conclusion,
    acceptedClaimUnitIds: [...draftContent.acceptedClaimUnitIds],
    sections: structuredClone(draftContent.sections),
    draftAssemblyFingerprint: draftContent.assembly.fingerprint,
    disclosedLimitations: [...auditContent.disclosedLimitations],
    unresolvedIssueIds: [],
  };
}

test("deterministic assembly uses only exact AcceptedClaimUnit sentence text", () => {
  const content = draft();
  assert.equal(
    content.abstract,
    "The accessed abstract reports a limited association. This interpretation remains bounded to that association.",
  );
  assert.equal(content.conclusion, content.abstract);
  assert.equal(content.sections[0].content, content.abstract);
  assert.doesNotThrow(() =>
    assertValidManuscriptAuthorityChain({
      acceptedClaimUnits: [acceptedUnit],
      manuscriptDraft: content,
    }),
  );
});

test("a manuscript cannot smuggle prose into abstract, conclusion, or body", () => {
  for (const mutation of [
    (content) => (content.abstract += " Unreviewed prevalence claim."),
    (content) => (content.conclusion = "A causal conclusion."),
    (content) => (content.sections[0].content += " Hidden external fact."),
  ]) {
    const content = draft();
    mutation(content);
    assert.throws(
      () =>
        assertValidManuscriptAuthorityChain({
          acceptedClaimUnits: [acceptedUnit],
          manuscriptDraft: content,
        }),
      (error) =>
        error instanceof ManuscriptAuthorityError &&
        error.code === "INVALID_MANUSCRIPT_AUTHORITY_CHAIN",
    );
  }
});

test("audit and audited manuscript must cross-bind ids, units, verdict, and exact draft prose", () => {
  const draftContent = draft();
  const auditContent = audit(draftContent);
  const auditedContent = audited(draftContent, auditContent);
  assert.doesNotThrow(() =>
    assertValidManuscriptAuthorityChain({
      manuscriptDraft: draftContent,
      manuscriptAudit: auditContent,
      auditedManuscript: auditedContent,
    }),
  );

  const mutations = [
    { manuscriptAuditId: "different-audit" },
    { auditVerdict: "revision_required" },
    { acceptedClaimUnitIds: ["different-unit"] },
    { abstract: `${auditedContent.abstract} Injected sentence.` },
  ];
  for (const mutation of mutations) {
    assert.throws(() =>
      assertValidManuscriptAuthorityChain({
        manuscriptDraft: draftContent,
        manuscriptAudit: auditContent,
        auditedManuscript: { ...auditedContent, ...mutation },
      }),
    );
  }
});

test("an audit cannot omit checked units or draft limitations", () => {
  const draftContent = draft();
  for (const mutation of [
    { checkedClaimUnitIds: ["other-unit"] },
    { disclosedLimitations: ["A replacement limitation."] },
    { draftAssemblyFingerprint: "b".repeat(64) },
  ]) {
    const auditContent = { ...audit(draftContent), ...mutation };
    assert.throws(() =>
      assertValidManuscriptAuthorityChain({
        manuscriptDraft: draftContent,
        manuscriptAudit: auditContent,
        auditedManuscript: audited(draftContent, auditContent),
      }),
    );
  }
});
