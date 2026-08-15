import test from "node:test";
import assert from "node:assert/strict";

import {
  RESEARCH_ARTIFACT_SCHEMA_VERSION,
  SEARCH_METHOD_ARTIFACT_TYPES,
  assertValidAcceptedClaimUnit,
  assertValidAuditedManuscript,
  assertValidClaimUnitDraft,
  assertValidClaimVerificationResult,
  assertValidDecisionReceipt,
  assertValidDeliveryBundle,
  assertValidExportManifest,
  assertValidAuthorApproval,
  assertValidSignedDelivery,
  assertValidEvidenceBriefBundle,
  assertValidEvidenceDrivenOutline,
  assertValidEvidenceExcerpt,
  assertValidEvidenceVerificationReport,
  assertValidFrozenWritingPlan,
  assertValidManuscriptAudit,
  assertValidManuscriptDraft,
  assertValidOutlineStressTest,
  assertValidResearchConclusionCard,
  researchArtifactContentNeedsValidation,
  validateEvidenceExcerpt,
  validateResearchArtifactContent,
} from "./artifact-contracts-v1.js";
import { sha256 } from "./event-engine-v1.js";
import {
  createAuthoritativeExportManifest,
  createAuthorSignoffContents,
} from "./export-authority-v1.js";
import { createDeterministicManuscriptDraft } from "./manuscript-authority-v1.js";

const HASH = "a".repeat(64);
const SECOND_HASH = "b".repeat(64);

function livePubMedRecord(overrides = {}) {
  return {
    sourceId: "PMID:41977470",
    title: "A traceable PubMed source",
    accessLevel: "abstract_only",
    sourceSnapshotHash: HASH,
    locator: {
      pmid: "41977470",
      url: "https://pubmed.ncbi.nlm.nih.gov/41977470/",
    },
    ...overrides,
  };
}

function liveSearchSnapshot(overrides = {}) {
  return {
    retrievalMode: "live_pubmed",
    provider: "pubmed",
    executionStatus: "completed_live_search",
    query: "postoperative sleep recovery",
    executedAt: "2026-08-12T08:00:00.000Z",
    resultCount: 1,
    receiptHash: HASH,
    records: [livePubMedRecord()],
    ...overrides,
  };
}

function liveSourceSnapshot(overrides = {}) {
  return {
    retrievalMode: "live_pubmed",
    provider: "pubmed",
    ...livePubMedRecord(),
    ...overrides,
  };
}

function liveManifest(overrides = {}) {
  return {
    retrievalMode: "live_pubmed",
    provider: "pubmed",
    sourceCount: 1,
    sourceIds: ["PMID:41977470"],
    retrievalReceiptHash: SECOND_HASH,
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    schemaVersion: RESEARCH_ARTIFACT_SCHEMA_VERSION,
    id: "evidence-1",
    sourceId: "PMID:41977470",
    claimId: "conclusion-1",
    locator: { pmid: "41977470", section: "Results" },
    accessLevel: "full_text_and_supplement",
    relation: "partially_supports",
    extractedFacts: ["The retrieved material reports a partial target-evidence chain."],
    limitations: ["The animal experiment did not intervene on the named target."],
    unknowns: ["In-vivo tissue concentration remains unknown."],
    sourceSnapshotHash: HASH,
    ...overrides,
  };
}

function conclusion(overrides = {}) {
  return {
    schemaVersion: RESEARCH_ARTIFACT_SCHEMA_VERSION,
    id: "conclusion-1",
    questionId: "question-1",
    version: 1,
    claim: "The reviewed material supports a partial chain, not a continuous animal mechanism.",
    scope: "The retrieved network-pharmacology candidate set only.",
    producerId: "evidence-synthesizer",
    confidence: "bounded",
    supportingEvidenceIds: ["evidence-1"],
    counterEvidenceIds: [],
    uncertainties: ["The candidate set is not a prevalence sample."],
    accessBoundary: "One record was checked at full-text-and-supplement level.",
    nextQuestion: "Which matched perturbation would close the target-mediation gap?",
    ...overrides,
  };
}

function verification(overrides = {}) {
  return {
    schemaVersion: RESEARCH_ARTIFACT_SCHEMA_VERSION,
    id: "verification-1",
    conclusionCardIds: ["conclusion-1"],
    status: "verified",
    verdict: "pass",
    producerId: "evidence-synthesizer",
    verifierId: "independent-reviewer",
    limitations: [],
    ...overrides,
  };
}

function bundle(overrides = {}) {
  return {
    schemaVersion: RESEARCH_ARTIFACT_SCHEMA_VERSION,
    id: "brief-1",
    researchQuestion: "Can network pharmacology establish a continuous animal mechanism?",
    currentResearchPeriod: "文献调研：正在确认经过核查的证据边界",
    evidenceExcerpts: [evidence()],
    conclusionCards: [conclusion()],
    verificationReports: [verification()],
    boundaries: ["This is a bounded judgment, not a field-wide prevalence estimate."],
    nextStepOrUserDecision: {
      kind: "human_decision",
      prompt: "是否接受当前证据边界作为后续论证结构的依据？",
    },
    decisionReceipt: null,
    ...overrides,
  };
}

function outline(overrides = {}) {
  return {
    schemaVersion: RESEARCH_ARTIFACT_SCHEMA_VERSION,
    id: "outline-1",
    version: 1,
    questionId: "question-1",
    evidenceBoundaryDecisionId: "boundary-decision-1",
    claimEvidenceMapId: "claim-map-1",
    producerId: "argument-architect",
    excludedTopics: ["Clinical efficacy is outside the reviewed evidence boundary."],
    sections: [
      {
        id: "section-1",
        title: "Mechanistic evidence",
        purpose: "State the bounded mechanistic conclusion and its limits.",
        claimIds: ["conclusion-1"],
        supportingEvidenceIds: ["evidence-1"],
        counterEvidenceIds: [],
        limitations: ["The candidate set is not a prevalence sample."],
      },
    ],
    ...overrides,
  };
}

function outlineStressTest(overrides = {}) {
  return {
    schemaVersion: RESEARCH_ARTIFACT_SCHEMA_VERSION,
    id: "outline-stress-1",
    version: 1,
    outlineId: "outline-1",
    outlineProducerId: "argument-architect",
    verifierId: "outline-verifier",
    verdict: "pass",
    reviewedSectionIds: ["section-1"],
    findings: [],
    ...overrides,
  };
}

function writingPlan(overrides = {}) {
  return {
    schemaVersion: RESEARCH_ARTIFACT_SCHEMA_VERSION,
    id: "writing-plan-1",
    version: 1,
    outlineId: "outline-1",
    outlineStressTestId: "outline-stress-1",
    outlineDecisionId: "outline-decision-1",
    approvedBy: {
      id: "researcher-1",
      role: "human_researcher",
      kind: "human",
    },
    approvedAt: "2026-08-12T00:00:00.000Z",
    excludedTopics: ["Clinical recommendations"],
    claimUnitPlans: [
      {
        id: "unit-plan-1",
        sectionId: "section-1",
        claimId: "conclusion-1",
        purpose: "Explain the bounded target-evidence chain.",
        allowedEvidenceIds: ["evidence-1"],
        prohibitedMoves: ["Do not generalize beyond the bounded candidate set."],
      },
    ],
    ...overrides,
  };
}

function citationIntent(overrides = {}) {
  return {
    id: "citation-intent-1",
    evidenceId: "evidence-1",
    purpose: "support",
    ...overrides,
  };
}

function draftSentence(overrides = {}) {
  return {
    id: "sentence-1",
    text: "The reviewed source directly reports a partial target-evidence chain.",
    kind: "factual",
    citationIntents: [citationIntent()],
    ...overrides,
  };
}

function claimDraft(overrides = {}) {
  return {
    schemaVersion: RESEARCH_ARTIFACT_SCHEMA_VERSION,
    id: "draft-1",
    version: 1,
    writingPlanId: "writing-plan-1",
    claimUnitPlanId: "unit-plan-1",
    claimId: "conclusion-1",
    producerId: "claim-writer",
    boundaries: ["This sentence applies only to the retrieved candidate set."],
    sentences: [
      draftSentence(),
      draftSentence({
        id: "sentence-2",
        text: "This supports a bounded interpretation, not a continuous animal mechanism.",
        kind: "interpretation",
        citationIntents: [citationIntent({ id: "citation-intent-2" })],
      }),
      draftSentence({
        id: "sentence-3",
        text: "The remaining uncertainty is addressed next.",
        kind: "transition",
        citationIntents: [citationIntent({ id: "citation-intent-3", purpose: "context" })],
      }),
    ],
    ...overrides,
  };
}

function claimVerification(overrides = {}) {
  return {
    schemaVersion: RESEARCH_ARTIFACT_SCHEMA_VERSION,
    id: "verification-result-1",
    version: 1,
    claimUnitDraftId: "draft-1",
    draftProducerId: "claim-writer",
    verifierId: "citation-verifier",
    status: "verified",
    limitations: [],
    sentenceResults: [
      {
        sentenceId: "sentence-1",
        verdict: "direct_support",
        citationIntentIds: ["citation-intent-1"],
        verifiedEvidenceIds: ["evidence-1"],
        rationale: "The cited source directly supports the bounded factual sentence.",
        requiredRevision: null,
        verificationReceipt: {
          toolId: "citation_verify",
          receiptHash: "1".repeat(64),
          claimHash: "2".repeat(64),
          method: "exact_visible_text_match",
          checkedAt: "2026-08-12T00:30:00.000Z",
          coverage: 1,
          sourceRefs: [
            {
              sourceId: "source-1",
              sourceSnapshotHash: "3".repeat(64),
              accessLevel: "abstract_only",
              locator: { pmid: "12345678" },
            },
          ],
        },
      },
    ],
    ...overrides,
  };
}

function acceptedUnit(overrides = {}) {
  return {
    schemaVersion: RESEARCH_ARTIFACT_SCHEMA_VERSION,
    id: "accepted-unit-1",
    version: 1,
    sourceDraftId: "draft-1",
    verificationResultId: "verification-result-1",
    writingPlanId: "writing-plan-1",
    claimId: "conclusion-1",
    producerId: "claim-writer",
    acceptedBy: {
      id: "researcher-1",
      role: "human_researcher",
      kind: "human",
    },
    acceptedAt: "2026-08-12T01:00:00.000Z",
    boundaries: ["This sentence applies only to the retrieved candidate set."],
    sentences: [
      draftSentence({
        verification: {
          resultId: "verification-result-1",
          verdict: "direct_support",
          verifiedEvidenceIds: ["evidence-1"],
        },
      }),
      draftSentence({
        id: "sentence-2",
        text: "This supports a bounded interpretation, not a continuous animal mechanism.",
        kind: "interpretation",
        citationIntents: [citationIntent({ id: "citation-intent-2" })],
        verification: {
          resultId: "verification-result-1",
          verdict: "direct_support",
          verifiedEvidenceIds: ["evidence-1"],
        },
      }),
    ],
    ...overrides,
  };
}

function manuscriptDraft(overrides = {}) {
  return {
    ...createDeterministicManuscriptDraft({
      id: "manuscript-draft-1",
      version: 1,
      writingPlanId: "writing-plan-1",
      producerId: "manuscript-editor",
      title: "A bounded appraisal of the target-evidence chain",
      acceptedClaimUnits: [
        {
          id: "accepted-unit-1",
          version: 1,
          contentHash: "c".repeat(64),
          content: acceptedUnit(),
        },
      ],
    }),
    ...overrides,
  };
}

function manuscriptAudit(overrides = {}) {
  return {
    schemaVersion: RESEARCH_ARTIFACT_SCHEMA_VERSION,
    id: "manuscript-audit-1",
    version: 1,
    manuscriptDraftId: "manuscript-draft-1",
    manuscriptProducerId: "manuscript-editor",
    auditorId: "manuscript-auditor",
    status: "audited",
    verdict: "pass",
    checkedClaimUnitIds: ["accepted-unit-1"],
    draftAssemblyFingerprint: manuscriptDraft().assembly.fingerprint,
    disclosedLimitations: manuscriptDraft().limitations,
    findings: [],
    rightsChecks: [
      {
        id: "rights-1",
        materialId: "manuscript-text",
        status: "not_applicable",
        note: "The manuscript contains original prose.",
      },
    ],
    ...overrides,
  };
}

function auditedManuscript(overrides = {}) {
  return {
    schemaVersion: RESEARCH_ARTIFACT_SCHEMA_VERSION,
    id: "audited-manuscript-1",
    version: 1,
    manuscriptDraftId: "manuscript-draft-1",
    manuscriptAuditId: "manuscript-audit-1",
    producerId: "manuscript-editor",
    auditorId: "manuscript-auditor",
    auditVerdict: "pass",
    title: manuscriptDraft().title,
    abstract: manuscriptDraft().abstract,
    conclusion: manuscriptDraft().conclusion,
    acceptedClaimUnitIds: ["accepted-unit-1"],
    disclosedLimitations: manuscriptAudit().disclosedLimitations,
    draftAssemblyFingerprint: manuscriptDraft().assembly.fingerprint,
    unresolvedIssueIds: [],
    sections: manuscriptDraft().sections,
    ...overrides,
  };
}

function deliveryBundle(overrides = {}) {
  return {
    schemaVersion: RESEARCH_ARTIFACT_SCHEMA_VERSION,
    id: "delivery-1",
    version: 1,
    auditedManuscriptId: "audited-manuscript-1",
    manuscriptAuditId: "manuscript-audit-1",
    preparedBy: "delivery-editor",
    limitations: ["Author sign-off remains a separate human decision."],
    authorSignoffStatus: "pending",
    manifestHash: HASH,
    exportManifestId: "export-manifest-1",
    exportManifestFingerprint: HASH,
    artifactFingerprints: [
      {
        artifactId: "audited-manuscript-1",
        role: "audited_manuscript",
        version: 1,
        contentHash: HASH,
      },
      {
        artifactId: "manuscript-audit-1",
        role: "manuscript_audit",
        version: 1,
        contentHash: SECOND_HASH,
      },
    ],
    exports: [
      {
        id: "export-markdown",
        format: "markdown",
        fileName: "manuscript.md",
        mediaType: "text/markdown",
        contentHash: HASH,
        byteLength: 100,
      },
      {
        id: "export-json",
        format: "json",
        fileName: "research-bundle.json",
        mediaType: "application/json",
        contentHash: SECOND_HASH,
        byteLength: 200,
      },
    ],
    ...overrides,
  };
}

function simulationAuthority(overrides = {}) {
  return {
    class: "simulation",
    authoritative: false,
    finality: "non_authoritative",
    runtimeMode: "guided",
    inheritance: "rebuild_in_live_run",
    label: "流程演练（非正式科研产物）",
    boundary: "正式研究必须在全新的 live run 中重新构建。",
    ...overrides,
  };
}

test("an evidence excerpt requires explicit access, source locator, unknowns, and snapshot hash", () => {
  assert.equal(assertValidEvidenceExcerpt(evidence()).id, "evidence-1");
  const issues = validateEvidenceExcerpt(
    evidence({ accessLevel: undefined, locator: {}, sourceSnapshotHash: "not-a-hash" }),
  );
  assert.ok(issues.some((issue) => issue.includes("accessLevel")));
  assert.ok(issues.some((issue) => issue.includes("locator")));
  assert.ok(issues.some((issue) => issue.includes("sourceSnapshotHash")));
});

test("abstract records preserve unreported details as unknown instead of inferring absence", () => {
  const abstractRecord = evidence({
    accessLevel: "abstract_only",
    unknowns: ["摘要未报告靶点干预的样本量与完整实验分组。"],
  });
  assert.equal(assertValidEvidenceExcerpt(abstractRecord).unknowns.length, 1);
});

test("verification reports forbid producer self-verification", () => {
  assert.throws(
    () =>
      assertValidEvidenceVerificationReport(
        verification({ producerId: "same-agent", verifierId: "same-agent" }),
      ),
    /independent from the producer/,
  );
});

test("evidence-brief bundles reject missing or semantically incompatible evidence references", () => {
  assert.throws(
    () =>
      assertValidEvidenceBriefBundle(
        bundle({ conclusionCards: [conclusion({ supportingEvidenceIds: ["missing"] })] }),
      ),
    /unknown supporting evidence missing/,
  );
  assert.throws(
    () =>
      assertValidEvidenceBriefBundle(
        bundle({ evidenceExcerpts: [evidence({ relation: "context_only" })] }),
      ),
    /incompatible relation context_only/,
  );
});

test("decision receipts bind a human decision to exact artifact fingerprints", () => {
  const receipt = {
    schemaVersion: RESEARCH_ARTIFACT_SCHEMA_VERSION,
    id: "decision-1",
    decision: "approve evidence boundary",
    reason: "The limitations are explicit and acceptable for outline design.",
    reversibleScope: "Reversible until manuscript prose begins.",
    explicitDefaults: ["No clinical recommendation will be generated."],
    decidedAt: "2026-08-11T10:00:00.000Z",
    decidedBy: { id: "human-researcher", role: "human_researcher", kind: "human" },
    artifactFingerprints: [
      { artifactId: "conclusion-1", version: 1, contentHash: HASH },
    ],
  };
  assert.equal(assertValidDecisionReceipt(receipt).decidedBy.kind, "human");
});

test("a valid evidence-brief bundle links each conclusion to verified evidence", () => {
  assert.equal(assertValidEvidenceBriefBundle(bundle()).conclusionCards.length, 1);
});

test("the writing-review artifact chain accepts one complete valid content bundle", () => {
  assert.equal(assertValidEvidenceDrivenOutline(outline()).id, "outline-1");
  assert.equal(
    assertValidOutlineStressTest(outlineStressTest()).id,
    "outline-stress-1",
  );
  assert.equal(assertValidFrozenWritingPlan(writingPlan()).id, "writing-plan-1");
  assert.equal(assertValidClaimUnitDraft(claimDraft()).id, "draft-1");
  assert.equal(
    assertValidClaimVerificationResult(claimVerification()).id,
    "verification-result-1",
  );
  assert.equal(assertValidAcceptedClaimUnit(acceptedUnit()).id, "accepted-unit-1");
  assert.equal(assertValidManuscriptDraft(manuscriptDraft()).id, "manuscript-draft-1");
  assert.equal(assertValidManuscriptAudit(manuscriptAudit()).id, "manuscript-audit-1");
  assert.equal(
    assertValidAuditedManuscript(auditedManuscript()).id,
    "audited-manuscript-1",
  );
  assert.equal(assertValidDeliveryBundle(deliveryBundle()).id, "delivery-1");
});

test("every writing-review artifact type is registered for content validation", () => {
  const artifactTypes = [
    "EvidenceDrivenOutline",
    "OutlineStressTest",
    "FrozenWritingPlan",
    "ClaimUnitDraft",
    "ClaimVerificationResult",
    "AcceptedClaimUnit",
    "ManuscriptDraft",
    "ManuscriptAudit",
    "AuditedManuscript",
    "DeliveryBundle",
  ];
  artifactTypes.forEach((artifactType) => {
    assert.equal(researchArtifactContentNeedsValidation(artifactType), true);
  });
  assert.deepEqual(validateResearchArtifactContent("ClaimUnitDraft", claimDraft()), []);
});

test("all orientation and focused search-method artifacts require executable PubMed contracts", () => {
  SEARCH_METHOD_ARTIFACT_TYPES.forEach((artifactType) => {
    assert.equal(researchArtifactContentNeedsValidation(artifactType), true);
    const issues = validateResearchArtifactContent(artifactType, {
      schemaVersion: RESEARCH_ARTIFACT_SCHEMA_VERSION,
      id: "method-artifact",
      version: 1,
      provider: "model_suggestion",
      database: "unspecified",
      query: "breast cancer AND acupuncture",
      queryHash: "not-a-real-hash",
      upstreamArtifactFingerprints: [],
    });
    assert.match(issues.join("\n"), /provider must equal pubmed/);
    assert.match(issues.join("\n"), /database must equal PubMed/);
    assert.match(issues.join("\n"), /queryHash must be a SHA-256 hash/);
    assert.match(
      issues.join("\n"),
      /upstreamArtifactFingerprints must not be empty/,
    );
  });
});

test("search-method contracts reject placeholder sentinels and a one-query focused protocol", () => {
  const query = "breast cancer AND acupuncture";
  const common = {
    schemaVersion: RESEARCH_ARTIFACT_SCHEMA_VERSION,
    id: "focused-method",
    version: 1,
    provider: "pubmed",
    database: "PubMed",
    createdAt: "2026-08-13T01:00:00.000Z",
    fields: ["title_abstract"],
    timeRange: { basis: "none", from: null, to: null },
    languages: ["all"],
    inclusionCriteria: ["Directly relevant records"],
    exclusionCriteria: ["Unrelated records"],
    stopRules: ["Stop after calibration stabilizes"],
    upstreamArtifactFingerprints: [
      {
        artifactId: "scope-1",
        artifactType: "ScopeDecision",
        version: 1,
        contentHash: HASH,
      },
    ],
    query,
    queryHash: sha256(query),
  };
  const matrixIssues = validateResearchArtifactContent("FocusedConceptMatrix", {
    ...common,
    conceptGroups: [
      {
        id: "focused-group",
        label: "Focused group",
        rationale: "Keep the selected relation explicit.",
        terms: ["acupuncture"],
      },
    ],
    sentinelSourceIds: ["sentinel:selected-angle"],
    focusedRelation: "intervention effect",
  });
  assert.match(matrixIssues.join("\n"), /real pre-registered source/);

  const protocolIssues = validateResearchArtifactContent("FocusedSearchProtocol", {
    ...common,
    conceptMatrixFingerprint: {
      artifactId: "matrix-1",
      artifactType: "FocusedConceptMatrix",
      version: 1,
      contentHash: SECOND_HASH,
    },
    primaryQueryId: "focused-core",
    queryVariants: [
      {
        id: "focused-core",
        purpose: "core",
        query,
        queryHash: sha256(query),
      },
    ],
    accessPolicy: "Title and abstract screening first.",
    samplingRule: "Inspect returned calibration records.",
  });
  assert.match(protocolIssues.join("\n"), /at least two executable variants/);
});

test("live PubMed retrieval artifacts satisfy strict search, source, and manifest contracts", () => {
  ["SearchRunSnapshot", "FocusedSearchRunSnapshot"].forEach((artifactType) => {
    assert.equal(researchArtifactContentNeedsValidation(artifactType), true);
    assert.deepEqual(
      validateResearchArtifactContent(artifactType, liveSearchSnapshot()),
      [],
    );
  });

  ["OrientationSourceSnapshot", "SourceSnapshot"].forEach((artifactType) => {
    assert.equal(researchArtifactContentNeedsValidation(artifactType), true);
    assert.deepEqual(
      validateResearchArtifactContent(artifactType, liveSourceSnapshot()),
      [],
    );
  });

  ["OrientationCorpusManifest", "LibraryManifest"].forEach((artifactType) => {
    assert.equal(researchArtifactContentNeedsValidation(artifactType), true);
    assert.deepEqual(
      validateResearchArtifactContent(artifactType, liveManifest()),
      [],
    );
  });
});

test("live PubMed search snapshots reject invented or incomplete execution receipts", () => {
  const issues = validateResearchArtifactContent(
    "SearchRunSnapshot",
    liveSearchSnapshot({
      provider: "not_executed",
      executionStatus: "completed",
      query: " ",
      executedAt: "2026-08-12",
      resultCount: 0,
      receiptHash: "not-a-hash",
      records: [
        livePubMedRecord({
          sourceId: "",
          title: "",
          accessLevel: "unknown",
          sourceSnapshotHash: "bad",
          locator: { doi: "10.1000/not-enough-for-this-contract" },
        }),
      ],
    }),
  );

  assert.match(issues.join("\n"), /provider must equal pubmed/);
  assert.match(issues.join("\n"), /completed_live_search/);
  assert.match(issues.join("\n"), /query must be a non-empty string/);
  assert.match(issues.join("\n"), /executedAt must be an ISO timestamp/);
  assert.match(issues.join("\n"), /resultCount must be a positive integer/);
  assert.match(issues.join("\n"), /receiptHash must be a SHA-256 hash/);
  assert.match(issues.join("\n"), /records\[0\]\.sourceId/);
  assert.match(issues.join("\n"), /records\[0\]\.title/);
  assert.match(issues.join("\n"), /records\[0\]\.accessLevel/);
  assert.match(issues.join("\n"), /records\[0\]\.sourceSnapshotHash/);
  assert.match(issues.join("\n"), /records\[0\]\.locator/);
});

test("live PubMed source and manifest contracts reject untraceable content", () => {
  const sourceIssues = validateResearchArtifactContent(
    "SourceSnapshot",
    liveSourceSnapshot({
      sourceId: "",
      title: "",
      accessLevel: "unknown",
      sourceSnapshotHash: "bad",
      locator: {},
    }),
  );
  assert.match(sourceIssues.join("\n"), /source\.sourceId/);
  assert.match(sourceIssues.join("\n"), /source\.title/);
  assert.match(sourceIssues.join("\n"), /source\.accessLevel/);
  assert.match(sourceIssues.join("\n"), /source\.sourceSnapshotHash/);
  assert.match(sourceIssues.join("\n"), /source\.locator/);

  const manifestIssues = validateResearchArtifactContent(
    "LibraryManifest",
    liveManifest({
      provider: "user_provided_materials",
      sourceCount: 2,
      sourceIds: ["PMID:41977470"],
      retrievalReceiptHash: "bad",
    }),
  );
  assert.match(manifestIssues.join("\n"), /provider must equal pubmed/);
  assert.match(manifestIssues.join("\n"), /sourceCount must equal sourceIds.length/);
  assert.match(manifestIssues.join("\n"), /retrievalReceiptHash must be a SHA-256 hash/);
});

test("legacy guided retrieval artifacts remain backward compatible", () => {
  assert.deepEqual(
    validateResearchArtifactContent("SearchRunSnapshot", {
      provider: "user_provided_materials",
      executionStatus: "completed",
    }),
    [],
  );
  assert.deepEqual(
    validateResearchArtifactContent("SourceSnapshot", {
      sourceId: "legacy-source",
    }),
    [],
  );
  assert.deepEqual(
    validateResearchArtifactContent("LibraryManifest", {
      sourceCount: 0,
      sourceIds: [],
    }),
    [],
  );
});

test("outlines require traceable supporting evidence and independent stress tests", () => {
  assert.throws(
    () =>
      assertValidEvidenceDrivenOutline(
        outline({
          sections: [
            {
              ...outline().sections[0],
              supportingEvidenceIds: [],
            },
          ],
        }),
      ),
    /supportingEvidenceIds must not be empty/,
  );
  assert.throws(
    () =>
      assertValidOutlineStressTest(
        outlineStressTest({ verifierId: "argument-architect" }),
      ),
    /independent from the outline producer/,
  );
  assert.throws(
    () =>
      assertValidOutlineStressTest(
        outlineStressTest({
          findings: [
            {
              id: "finding-1",
              targetRef: "section-1",
              severity: "blocker",
              message: "The section overstates the evidence boundary.",
              recommendedAction: "Narrow the claim.",
              resolved: false,
            },
          ],
        }),
      ),
    /cannot retain unresolved blockers/,
  );
});

test("a frozen writing plan requires human approval and evidence-bounded claim units", () => {
  assert.throws(
    () =>
      assertValidFrozenWritingPlan(
        writingPlan({
          approvedBy: { id: "writer-agent", role: "writer", kind: "agent" },
        }),
      ),
    /approvedBy.kind must equal human/,
  );
  assert.throws(
    () =>
      assertValidFrozenWritingPlan(
        writingPlan({
          claimUnitPlans: [
            {
              ...writingPlan().claimUnitPlans[0],
              allowedEvidenceIds: [],
            },
          ],
        }),
      ),
    /allowedEvidenceIds must not be empty/,
  );
});

test("claim-unit drafts classify every sentence and no label can bypass citation intent", () => {
  assert.throws(
    () =>
      assertValidClaimUnitDraft(
        claimDraft({ sentences: [draftSentence({ citationIntents: [] })] }),
      ),
    /factual sentence requires at least one citation intent/,
  );
  assert.throws(
    () =>
      assertValidClaimUnitDraft(
        claimDraft({ sentences: [draftSentence({ kind: "opinion" })] }),
      ),
    /kind must be one of factual, interpretation, transition/,
  );
  assert.throws(
    () =>
      assertValidClaimUnitDraft(
        claimDraft({
          sentences: [
            draftSentence({
              kind: "interpretation",
              citationIntents: [],
            }),
          ],
        }),
      ),
    /interpretation sentence requires at least one citation intent/,
  );
  assert.throws(
    () =>
      assertValidClaimUnitDraft(
        claimDraft({
          sentences: [
            draftSentence({
              kind: "transition",
              citationIntents: [],
            }),
          ],
        }),
      ),
    /transition sentence requires at least one citation intent/,
  );
});

test("claim verification is independent and records a revision for every failed sentence", () => {
  assert.throws(
    () =>
      assertValidClaimVerificationResult(
        claimVerification({ verifierId: "claim-writer" }),
      ),
    /independent from the draft producer/,
  );
  assert.throws(
    () =>
      assertValidClaimVerificationResult(
        claimVerification({
          sentenceResults: [
            {
              ...claimVerification().sentenceResults[0],
              sentenceId: "sentence-1",
              verdict: "partial_support",
              citationIntentIds: ["citation-intent-1"],
              verifiedEvidenceIds: ["evidence-1"],
              rationale: "The source supports only part of the sentence.",
              requiredRevision: "",
            },
          ],
        }),
      ),
    /partial_support requires requiredRevision/,
  );
});

test("accepted claim units cannot contain a factual sentence that failed verification", () => {
  assert.throws(
    () =>
      assertValidAcceptedClaimUnit(
        acceptedUnit({
          sentences: [
            draftSentence({
              verification: {
                resultId: "verification-result-1",
                verdict: "partial_support",
                verifiedEvidenceIds: ["evidence-1"],
              },
            }),
          ],
        }),
      ),
    /must have direct_support before acceptance/,
  );
  assert.throws(
    () =>
      assertValidAcceptedClaimUnit(
        acceptedUnit({
          sentences: [
            draftSentence({
              kind: "interpretation",
              verification: {
                resultId: "verification-result-1",
                verdict: "partial_support",
                verifiedEvidenceIds: ["evidence-1"],
              },
            }),
          ],
        }),
      ),
    /interpretation sentence must have direct_support before acceptance/,
  );
  assert.throws(
    () =>
      assertValidAcceptedClaimUnit(
        acceptedUnit({
          sentences: [
            draftSentence({
              kind: "transition",
              citationIntents: [
                citationIntent({ id: "citation-intent-transition", purpose: "context" }),
              ],
            }),
          ],
        }),
      ),
    /transition sentence requires a verification result/,
  );
});

test("manuscript assembly uses every accepted unit exactly once and introduces no new facts", () => {
  assert.throws(
    () =>
      assertValidManuscriptDraft(
        manuscriptDraft({ newFactualClaims: ["A new unreviewed result."] }),
      ),
    /new facts require a claim-unit review/,
  );
  assert.throws(
    () =>
      assertValidManuscriptDraft(
        manuscriptDraft({
          sections: [
            {
              ...manuscriptDraft().sections[0],
              claimUnitIds: ["unreviewed-unit"],
            },
          ],
        }),
      ),
    /references unaccepted unit unreviewed-unit/,
  );
});

test("a passing manuscript audit requires an independent auditor and no blockers", () => {
  assert.throws(
    () =>
      assertValidManuscriptAudit(
        manuscriptAudit({ auditorId: "manuscript-editor" }),
      ),
    /independent from the manuscript producer/,
  );
  assert.throws(
    () =>
      assertValidManuscriptAudit(
        manuscriptAudit({
          findings: [
            {
              id: "audit-finding-1",
              targetRef: "sentence-1",
              category: "citation_support",
              severity: "blocker",
              message: "The citation no longer resolves.",
              resolved: false,
            },
          ],
        }),
      ),
    /cannot retain blockers or blocked rights/,
  );
});

test("only a passing, issue-free manuscript can become an audited manuscript", () => {
  assert.throws(
    () =>
      assertValidAuditedManuscript(
        auditedManuscript({ auditVerdict: "revision_required" }),
      ),
    /auditVerdict must equal pass/,
  );
  assert.throws(
    () =>
      assertValidAuditedManuscript(
        auditedManuscript({ unresolvedIssueIds: ["audit-finding-1"] }),
      ),
    /unresolvedIssueIds must be empty/,
  );
});

test("guided audit contracts preserve a non-authoritative simulation boundary", () => {
  const simulatedAudit = manuscriptAudit({
    status: "simulation_reviewed",
    verdict: "simulation_only",
    authority: simulationAuthority(),
    findings: [
      {
        id: "authority-boundary-1",
        targetRef: "manuscript-draft-1",
        category: "authority_boundary",
        severity: "note",
        message: "This is a workflow simulation, not a scientific audit pass.",
        resolved: false,
      },
    ],
  });
  assert.equal(assertValidManuscriptAudit(simulatedAudit).verdict, "simulation_only");
  assert.equal(
    assertValidAuditedManuscript(
      auditedManuscript({
        auditVerdict: "simulation_only",
        authority: simulationAuthority(),
        unresolvedIssueIds: ["authority-boundary-1"],
      }),
    ).authority.authoritative,
    false,
  );
  assert.throws(
    () =>
      assertValidManuscriptAudit({
        ...simulatedAudit,
        status: "audited",
        verdict: "pass",
      }),
    /simulation manuscript audit verdict must equal simulation_only|simulation_reviewed/,
  );
  assert.throws(
    () =>
      assertValidAuditedManuscript(
        auditedManuscript({
          auditVerdict: "pass",
          authority: simulationAuthority(),
        }),
      ),
    /simulation_only/,
  );
});

test("delivery bundles fingerprint audited inputs and export human- and machine-readable forms", () => {
  assert.throws(
    () =>
      assertValidDeliveryBundle(
        deliveryBundle({ exports: [deliveryBundle().exports[0]] }),
      ),
    /machine-readable research format/,
  );
  assert.throws(
    () =>
      assertValidDeliveryBundle(
        deliveryBundle({ artifactFingerprints: [deliveryBundle().artifactFingerprints[0]] }),
      ),
    /must include manuscript_audit/,
  );
  assert.throws(
    () =>
      assertValidDeliveryBundle(
        deliveryBundle({ authorSignoffStatus: "approved" }),
      ),
    /authorSignoffStatus must equal pending/,
  );
  assert.throws(
    () =>
      assertValidDeliveryBundle(
        deliveryBundle({
          artifactFingerprints: [
            {
              ...deliveryBundle().artifactFingerprints[0],
              artifactId: "different-manuscript",
            },
            deliveryBundle().artifactFingerprints[1],
          ],
        }),
      ),
    /audited_manuscript fingerprint must match auditedManuscriptId/,
  );
  assert.throws(
    () =>
      assertValidDeliveryBundle(
        deliveryBundle({
          exports: [
            {
              ...deliveryBundle().exports[0],
              fileName: "manuscript.pdf",
              mediaType: "application/pdf",
            },
            deliveryBundle().exports[1],
          ],
        }),
      ),
    /fileName must use .md or .markdown for markdown/,
  );
});

test("guided delivery contracts accept only explicitly restricted simulation status", () => {
  const simulated = deliveryBundle({
    authority: simulationAuthority(),
    authorSignoffStatus: "simulation_pending",
  });
  assert.equal(
    assertValidDeliveryBundle(simulated).authorSignoffStatus,
    "simulation_pending",
  );
  assert.throws(
    () =>
      assertValidDeliveryBundle({
        ...simulated,
        authorSignoffStatus: "pending",
      }),
    /simulation_pending/,
  );
});

test("ExportManifest, AuthorApproval, and SignedDelivery bind one exact byte manifest", () => {
  const finalRecord = {
    id: "source-1",
    sourceId: "source-1",
    provider: "pubmed",
    pmid: "12345678",
    title: "Source",
    accessLevel: "abstract_only",
    locator: { pmid: "12345678" },
  };
  const finalRun = {
    purpose: "finalLibrary",
    nodeId: "freeze_library",
    protocolArtifactId: "frozen-search-1",
    protocolContentHash: HASH,
    queryId: "focused:core",
    query: "source query",
    queryHash: sha256("source query"),
    receipt: { receiptHash: SECOND_HASH, records: [finalRecord] },
  };
  const libraryContent = {
    retrievalRunPurpose: "finalLibrary",
    protocolArtifactId: finalRun.protocolArtifactId,
    protocolContentHash: finalRun.protocolContentHash,
    queryId: finalRun.queryId,
    query: finalRun.query,
    queryHash: finalRun.queryHash,
    retrievalReceiptHash: finalRun.receipt.receiptHash,
    sourceCount: 1,
    sourceIds: [finalRecord.sourceId],
  };
  const libraryManifest = {
    id: "library-manifest-1",
    type: "LibraryManifest",
    version: 1,
    freshness: "current",
    contentHash: sha256(libraryContent),
    content: libraryContent,
  };
  const project = {
    id: "contract-export-chain",
    title: "Contract export chain",
    question: "Which bytes were signed?",
    constraints: ["Keep unknowns explicit."],
    sourceMaterials: [finalRecord],
    retrievalRuns: { finalLibrary: finalRun },
  };
  const auditedArtifact = {
    id: "audited-manuscript-1",
    type: "AuditedManuscript",
    version: 1,
    contentHash: HASH,
    producedAt: "2026-08-13T00:00:00.000Z",
    content: auditedManuscript(),
  };
  const manifestContent = createAuthoritativeExportManifest({
    id: "export-manifest-1",
    version: 1,
    project,
    artifacts: [libraryManifest, auditedArtifact],
    deliveryBundleId: "delivery-1",
    generatedAt: "2026-08-13T01:00:00.000Z",
  });
  const manifestArtifact = {
    id: "export-manifest-1",
    type: "ExportManifest",
    version: 1,
    contentHash: sha256(manifestContent),
    content: manifestContent,
  };
  const contents = createAuthorSignoffContents({
    manifestArtifact,
    deliveryBundleArtifact: { id: "delivery-1", type: "DeliveryBundle", version: 1 },
    humanActor: { id: "author", role: "author", kind: "human" },
    gate: { id: "gate-1", fingerprint: SECOND_HASH },
    reason: "Author checked and signed the exact manifest bytes.",
    decidedAt: "2026-08-13T02:00:00.000Z",
    authorApprovalId: "author-approval-1",
    signedDeliveryId: "signed-delivery-1",
  });
  assert.equal(assertValidExportManifest(manifestContent).id, "export-manifest-1");
  assert.equal(assertValidAuthorApproval(contents.authorApproval).id, "author-approval-1");
  assert.equal(assertValidSignedDelivery(contents.signedDelivery).id, "signed-delivery-1");
});
