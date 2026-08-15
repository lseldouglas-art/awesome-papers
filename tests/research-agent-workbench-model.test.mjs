import test from "node:test";
import assert from "node:assert/strict";

import {
  buildResearchWorkbenchCreatePayload,
  normalizeResearchQuestionInput,
  researchQuestionCanPreview,
  researchWorkbenchRetrievalDisplay,
} from "../src/research-agent-workbench-model.js";

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
