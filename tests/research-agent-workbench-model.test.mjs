import test from "node:test";
import assert from "node:assert/strict";

import {
  buildResearchWorkbenchCalibrationPayload,
  buildResearchWorkbenchDirectionSelectionPayload,
  buildResearchWorkbenchReviewPreviewPayload,
  buildResearchWorkbenchCreatePayload,
  normalizeResearchQuestionInput,
  researchQuestionCanPreview,
  researchWorkbenchRetrievalDisplay,
} from "../src/research-agent-workbench-model.js";

test("confirmed professional strategy becomes one bounded five-year review scan", () => {
  const payload = buildResearchWorkbenchReviewPreviewPayload({
    question: "  围术期睡眠与术后恢复有什么关系？ ",
    queryPlan: {
      candidates: [
        { id: "matrix_core", label: "核心组合", strategy: "完整词群", query: "sleep AND recovery" },
        { id: "matrix_free", label: "扩展组合", strategy: "放宽路径", query: "sleep" },
      ],
    },
    selectedQueryId: "matrix_core",
    calibrationHash: "c".repeat(64),
  });
  assert.equal(payload.question, "围术期睡眠与术后恢复有什么关系?");
  assert.equal(payload.reviewScanCandidateId, "matrix_core");
  assert.equal(payload.reviewWindowYears, 5);
  assert.equal(payload.reviewSampleLimit, 20);
  assert.equal(payload.calibrationHash, "c".repeat(64));
  assert.deepEqual(payload.candidateQueries.map((candidate) => candidate.id), ["matrix_core", "matrix_free"]);
});

test("review preview preserves calibrated candidate order and rejects in-place query edits", () => {
  const queryPlan = {
    candidates: [
      { id: "matrix_core", label: "核心组合", strategy: "完整词群", query: "sleep AND recovery" },
      { id: "matrix_free", label: "扩展组合", strategy: "放宽路径", query: "sleep" },
      { id: "matrix_outcome", label: "结局组合", strategy: "结局路径", query: "recovery" },
    ],
  };
  const payload = buildResearchWorkbenchReviewPreviewPayload({
    question: "围术期睡眠与术后恢复有什么关系？",
    queryPlan,
    selectedQueryId: "matrix_free",
    calibrationHash: "c".repeat(64),
  });
  assert.equal(payload.reviewScanCandidateId, "matrix_free");
  assert.deepEqual(
    payload.candidateQueries.map((candidate) => [candidate.id, candidate.query]),
    queryPlan.candidates.map((candidate) => [candidate.id, candidate.query]),
  );
  assert.equal(buildResearchWorkbenchReviewPreviewPayload({
    question: "围术期睡眠与术后恢复有什么关系？",
    queryPlan,
    selectedQueryId: "matrix_free",
    editedQuery: "sleep AND recovery",
    calibrationHash: "c".repeat(64),
  }), null);
});

test("initial strategy confirmation binds the 100-record calibration to the plan fingerprint", () => {
  const queryPlan = {
    planHash: "a".repeat(64),
    candidates: [
      { id: "matrix_abc", query: "sleep AND recovery" },
      { id: "matrix_ab", query: "sleep" },
    ],
  };
  assert.deepEqual(buildResearchWorkbenchCalibrationPayload({
    question: " 围术期睡眠与术后恢复？ ",
    queryPlan,
    selectedQueryId: "matrix_abc",
  }), {
    question: "围术期睡眠与术后恢复?",
    initialPlanHash: "a".repeat(64),
    selectedCandidateId: "matrix_abc",
  });
  assert.equal(buildResearchWorkbenchCalibrationPayload({
    question: "围术期睡眠与术后恢复？",
    queryPlan,
    selectedQueryId: "missing",
  }), null);
});

test("every pre-project request carries only the authoritative scoping session identity", () => {
  const scopingSession = {
    schemaVersion: "research-scoping-session-identity/v1",
    id: "scoping-00000000-0000-4000-8000-000000000001",
    revision: 6,
    revisionHash: "f".repeat(64),
    stage: "second_calibration",
  };
  const queryPlan = {
    planHash: "a".repeat(64),
    candidates: [
      { id: "matrix_abc", query: "sleep AND recovery" },
      { id: "matrix_ab", query: "sleep" },
      { id: "matrix_free", query: "recovery" },
    ],
  };
  const calibration = buildResearchWorkbenchCalibrationPayload({
    question: "围术期睡眠与术后恢复？",
    queryPlan,
    selectedQueryId: "matrix_abc",
    scopingSession,
  });
  assert.equal(calibration.scopingSessionId, scopingSession.id);
  assert.equal(calibration.scopingSessionRevision, 6);
  const preview = buildResearchWorkbenchReviewPreviewPayload({
    question: "围术期睡眠与术后恢复？",
    queryPlan,
    selectedQueryId: "matrix_abc",
    calibrationHash: "c".repeat(64),
    scopingSession,
  });
  assert.deepEqual(preview.candidateQueries.map((candidate) => candidate.id), [
    "matrix_abc",
    "matrix_ab",
    "matrix_free",
  ]);
  assert.equal(preview.scopingSessionId, scopingSession.id);
  assert.equal(preview.scopingSessionRevision, 6);
  assert.equal(Object.prototype.hasOwnProperty.call(preview, "revisionHash"), false);
});

test("new research sends the exact preview plan and selected query candidate", () => {
  assert.deepEqual(
    buildResearchWorkbenchCreatePayload({
      form: {
        title: "  睡眠与恢复  ",
        question: "  术后睡眠与恢复有何关系？  ",
        searchQuery: "  sleep AND recovery  ",
        completionProfileId: "evidence_outline",
        constraints: "  摘要未报告保持未知  ",
        sourceMaterials: "  PMID 12345678  ",
      },
      queryPreview: { planHash: "a".repeat(64) },
      selectedQueryId: "focused_candidate",
    }),
    {
      title: "睡眠与恢复",
      question: "术后睡眠与恢复有何关系？",
      researchMode: "live_pubmed",
      searchQuery: "sleep AND recovery",
      queryPlanHash: "a".repeat(64),
      selectedCandidateId: "focused_candidate",
      completionProfileId: "evidence_outline",
      constraints: "摘要未报告保持未知",
      sourceMaterials: "PMID 12345678",
    },
  );
});

test("direction selection binds reasons to a candidate from the visible first-round report", () => {
  const reportBinding = {
    projectId: null,
    sourceSetHash: "b".repeat(64),
    reportRevision: 1,
    frozenSourceManifestHash: "e".repeat(64),
    derivedAnalysisHash: "f".repeat(64),
    reportHash: "c".repeat(64),
    authority: "preview",
  };
  const payload = buildResearchWorkbenchDirectionSelectionPayload({
    queryPreview: {
      planHash: "d".repeat(64),
      reviewLandscape: {
        researchReport: { binding: reportBinding },
        synthesis: {
          professorReport: {
            studentReviewDirections: [
              { id: "review_proposal_biomarker", suggestedTitle: "分子标志物综述" },
              { id: "review_proposal_local", suggestedTitle: "局部治疗综述" },
            ],
          },
        },
      },
    },
    selectedDirectionId: "review_proposal_biomarker",
    selectionReason: " 更符合本轮可行性。 ",
    deferredReason: " 其余方向暂缓比较。 ",
  });
  assert.deepEqual(payload, {
    queryPlanHash: "d".repeat(64),
    selectedDirectionId: "review_proposal_biomarker",
    selectionReason: "更符合本轮可行性。",
    deferredReason: "其余方向暂缓比较。",
    reportBinding,
  });
  assert.equal(buildResearchWorkbenchDirectionSelectionPayload({
    queryPreview: { planHash: "d".repeat(64), reviewLandscape: { synthesis: { professorReport: { studentReviewDirections: [] } } } },
    selectedDirectionId: "invented",
    selectionReason: "理由足够明确。",
    deferredReason: "其他方向暂缓。",
  }), null);
  assert.equal(buildResearchWorkbenchDirectionSelectionPayload({
    queryPreview: {
      planHash: "d".repeat(64),
      reviewLandscape: {
        researchReport: { binding: { ...reportBinding, derivedAnalysisHash: undefined } },
        synthesis: { professorReport: { studentReviewDirections: [{ id: "review_proposal_biomarker" }] } },
      },
    },
    selectedDirectionId: "review_proposal_biomarker",
    selectionReason: "理由足够明确。",
    deferredReason: "其他方向暂缓。",
  }), null);
  assert.equal(buildResearchWorkbenchDirectionSelectionPayload({
    queryPreview: {
      planHash: "d".repeat(64),
      reviewLandscape: {
        researchReport: { binding: { ...reportBinding, frozenSourceManifestHash: undefined } },
        synthesis: { professorReport: { studentReviewDirections: [{ id: "review_proposal_biomarker" }] } },
      },
    },
    selectedDirectionId: "review_proposal_biomarker",
    selectionReason: "理由足够明确。",
    deferredReason: "其他方向暂缓。",
  }), null);
  assert.equal(buildResearchWorkbenchDirectionSelectionPayload({
    queryPreview: {
      planHash: "d".repeat(64),
      reviewLandscape: {
        researchReport: { binding: { ...reportBinding, reportHash: undefined } },
        synthesis: { professorReport: { studentReviewDirections: [{ id: "review_proposal_biomarker" }] } },
      },
    },
    selectedDirectionId: "review_proposal_biomarker",
    selectionReason: "理由足够明确。",
    deferredReason: "其他方向暂缓。",
  }), null);
  assert.equal(buildResearchWorkbenchDirectionSelectionPayload({
    queryPreview: {
      planHash: "d".repeat(64),
      reviewLandscape: {
        synthesis: {
          professorReport: { studentReviewDirections: [{ id: "review_proposal_biomarker" }] },
          directionReport: { directions: [{ id: "legacy_original_research" }] },
        },
      },
    },
    selectedDirectionId: "legacy_original_research",
    selectionReason: "理由足够明确。",
    deferredReason: "其他方向暂缓。",
  }), null);
});

test("a visible Chinese research question enables preview without a hidden length trap", () => {
  assert.equal(normalizeResearchQuestionInput("  \u200B针灸效果？  "), "针灸效果?");
  assert.equal(researchQuestionCanPreview("针灸效果"), true);
  assert.equal(researchQuestionCanPreview("研究？"), false);
});

test("preview samples remain distinct from formal retrieval runs", () => {
  const preview = { candidateStatus: "ready", query: "sleep", samples: [{ sourceId: "pubmed:1" }] };
  const display = researchWorkbenchRetrievalDisplay({
    queryPreviewSelection: preview,
    retrievalRuns: [],
    sourceMaterials: [],
  });
  assert.equal(display.mode, "preview");
  assert.equal(display.preview, preview);
  assert.deepEqual(display.formalRuns, []);
});

test("a historical single receipt is never presented as a formal multi-stage run", () => {
  const legacy = { provider: "pubmed", query: "legacy", receiptHash: "b".repeat(64) };
  const display = researchWorkbenchRetrievalDisplay({
    legacyRetrieval: legacy,
    liveRetrieval: null,
    retrievalRuns: [],
  });
  assert.equal(display.mode, "legacy");
  assert.equal(display.legacy, legacy);
  assert.deepEqual(display.formalRuns, []);
});

test("the final library takes precedence over preview and legacy compatibility data", () => {
  const finalLibrary = { purpose: "finalLibrary", query: "final" };
  const display = researchWorkbenchRetrievalDisplay({
    liveRetrieval: { query: "legacy" },
    queryPreviewSelection: { candidateStatus: "ready", query: "preview" },
    retrievalRuns: [
      { purpose: "pilot", query: "pilot" },
      finalLibrary,
    ],
  });
  assert.equal(display.mode, "final_library");
  assert.equal(display.retrieval, finalLibrary);
});

test("pilot and focused calibration remain visibly in progress, not a final library", () => {
  for (const run of [
    { purpose: "pilot", query: "pilot" },
    { purpose: "focusedCalibration", query: "focused" },
  ]) {
    const display = researchWorkbenchRetrievalDisplay({ retrievalRuns: [run] });
    assert.equal(display.mode, "formal_in_progress");
    assert.equal(display.purpose, run.purpose);
    assert.equal(display.retrieval, run);
  }
});
