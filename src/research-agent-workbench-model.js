export function researchWorkbenchFormalRetrievalRuns(project) {
  const runs = project?.retrievalRuns;
  if (Array.isArray(runs)) return runs.filter(Boolean);
  if (!runs || typeof runs !== "object") return [];
  return [
    runs.pilot,
    runs.orientationCorpus,
    ...(Array.isArray(runs.focusedCalibration) ? runs.focusedCalibration : []),
    runs.finalLibrary,
  ].filter(Boolean);
}

export function researchWorkbenchRetrievalDisplay(project) {
  const formalRuns = researchWorkbenchFormalRetrievalRuns(project);
  if (formalRuns.length > 0) {
    const retrieval = formalRuns.at(-1);
    return {
      mode: retrieval?.purpose === "finalLibrary" ? "final_library" : "formal_in_progress",
      retrieval,
      purpose: retrieval?.purpose ?? null,
      formalRuns,
    };
  }
  const preview = project?.queryPreviewSelection;
  if (preview && typeof preview === "object" && preview.candidateStatus === "ready") {
    return { mode: "preview", preview, formalRuns };
  }
  const legacy = project?.legacyRetrieval ?? project?.liveRetrieval;
  if (legacy && typeof legacy === "object") {
    return { mode: "legacy", legacy, formalRuns };
  }
  return { mode: "none", formalRuns };
}

export function buildResearchWorkbenchCreatePayload({ form, queryPreview, selectedQueryId }) {
  return {
    title: form.title.trim(),
    question: form.question.trim(),
    researchMode: "live_pubmed",
    searchQuery: form.searchQuery.trim(),
    queryPlanHash: queryPreview?.planHash,
    selectedCandidateId: selectedQueryId,
    completionProfileId: form.completionProfileId,
    constraints: form.constraints.trim(),
    sourceMaterials: form.sourceMaterials.trim(),
  };
}

export function normalizeResearchQuestionInput(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .trim();
}

export function researchQuestionCanPreview(value) {
  return Array.from(normalizeResearchQuestionInput(value)).length >= 4;
}
