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

export function buildResearchWorkbenchCreatePayload({
  form,
  queryPreview,
  selectedQueryId,
  directionSelection = null,
}) {
  return {
    title: form.title.trim(),
    question: form.question.trim(),
    researchMode: "live_pubmed",
    searchQuery: form.searchQuery.trim(),
    queryPlanHash: queryPreview?.planHash,
    selectedCandidateId: selectedQueryId,
    ...(directionSelection?.decisionHash
      ? { directionSelectionHash: directionSelection.decisionHash }
      : {}),
    completionProfileId: form.completionProfileId,
    constraints: form.constraints.trim(),
    sourceMaterials: form.sourceMaterials.trim(),
  };
}

export function buildResearchWorkbenchDirectionSelectionPayload({
  queryPreview,
  selectedDirectionId,
  selectionReason,
  deferredReason,
}) {
  const directions = queryPreview?.reviewLandscape?.synthesis?.directionReport?.directions;
  if (
    !/^[a-f0-9]{64}$/i.test(queryPreview?.planHash ?? "") ||
    !Array.isArray(directions) ||
    !directions.some((direction) => direction.id === selectedDirectionId)
  ) return null;
  const reason = String(selectionReason ?? "").trim();
  const deferred = String(deferredReason ?? "").trim();
  if (Array.from(reason).length < 4 || (directions.length > 1 && Array.from(deferred).length < 4)) {
    return null;
  }
  return {
    queryPlanHash: queryPreview.planHash,
    selectedDirectionId,
    selectionReason: reason,
    deferredReason: deferred,
  };
}

export function buildResearchWorkbenchReviewPreviewPayload({
  question,
  queryPlan,
  selectedQueryId,
  editedQuery = null,
  calibrationHash = null,
  reviewWindowYears = 5,
  reviewSampleLimit = 20,
}) {
  const candidates = Array.isArray(queryPlan?.candidates) ? queryPlan.candidates : [];
  const selected = candidates.find((candidate) => candidate.id === selectedQueryId);
  if (!selected) return null;
  const selectedQuery = String(editedQuery ?? selected.query ?? "").trim();
  if (selectedQuery.length < 3) return null;
  const selectedCandidate = {
    ...selected,
    id: editedQuery === null ? selected.id : "researcher_edited",
    label: editedQuery === null ? selected.label : "研究者修订版",
    strategy: editedQuery === null
      ? selected.strategy
      : "研究者在专业策略基础上修改；重新执行基础命中抽查与近五年综述扫描。",
    query: selectedQuery,
  };
  const alternate = candidates.find((candidate) => candidate.id !== selectedQueryId);
  return {
    question: normalizeResearchQuestionInput(question),
    sampleLimit: 3,
    candidateQueries: [selectedCandidate, ...(alternate ? [alternate] : [])],
    reviewScanCandidateId: selectedCandidate.id,
    reviewWindowYears,
    reviewSampleLimit,
    ...(calibrationHash ? { calibrationHash } : {}),
  };
}

export function buildResearchWorkbenchCalibrationPayload({
  question,
  queryPlan,
  selectedQueryId,
  editedQuery = null,
}) {
  const candidates = Array.isArray(queryPlan?.candidates) ? queryPlan.candidates : [];
  const selected = candidates.find((candidate) => candidate.id === selectedQueryId);
  if (!selected || typeof queryPlan?.planHash !== "string") return null;
  const query = String(editedQuery ?? selected.query ?? "").trim();
  if (query.length < 3) return null;
  return {
    question: normalizeResearchQuestionInput(question),
    initialPlanHash: queryPlan.planHash,
    selectedCandidateId: selected.id,
    ...(query !== selected.query ? { editedQuery: query } : {}),
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
