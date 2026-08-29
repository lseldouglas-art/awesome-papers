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
  scopingSession = null,
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
    ...scopingSessionRequestFields(scopingSession),
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
  scopingSession = null,
}) {
  const directions = queryPreview?.reviewLandscape?.synthesis?.professorReport?.studentReviewDirections;
  const reportBinding = queryPreview?.reviewLandscape?.researchReport?.binding ?? null;
  const bindingComplete = Boolean(
    reportBinding
    && /^[a-f0-9]{64}$/i.test(reportBinding.sourceSetHash ?? "")
    && Number.isInteger(Number(reportBinding.reportRevision))
    && Number(reportBinding.reportRevision) > 0
    && /^[a-f0-9]{64}$/i.test(reportBinding.frozenSourceManifestHash ?? "")
    && /^[a-f0-9]{64}$/i.test(reportBinding.derivedAnalysisHash ?? "")
    && /^[a-f0-9]{64}$/i.test(reportBinding.reportHash ?? ""),
  );
  if (
    !/^[a-f0-9]{64}$/i.test(queryPreview?.planHash ?? "") ||
    !bindingComplete ||
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
    reportBinding,
    ...scopingSessionRequestFields(scopingSession),
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
  scopingSession = null,
}) {
  const candidates = Array.isArray(queryPlan?.candidates) ? queryPlan.candidates : [];
  const selected = candidates.find((candidate) => candidate.id === selectedQueryId);
  if (!selected) return null;
  const selectedQuery = String(selected.query ?? "").trim();
  if (selectedQuery.length < 3) return null;
  if (editedQuery !== null && String(editedQuery).trim() !== selectedQuery) return null;
  return {
    question: normalizeResearchQuestionInput(question),
    sampleLimit: 3,
    // Candidate order, ids, and queries are part of the persisted calibration.
    // Choosing which bound candidate to scan must not rewrite that material.
    candidateQueries: candidates.map((candidate) => ({ ...candidate })),
    reviewScanCandidateId: selected.id,
    reviewWindowYears,
    reviewSampleLimit,
    ...(calibrationHash ? { calibrationHash } : {}),
    ...scopingSessionRequestFields(scopingSession),
  };
}

export function buildResearchWorkbenchCalibrationPayload({
  question,
  queryPlan,
  selectedQueryId,
  editedQuery = null,
  scopingSession = null,
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
    ...scopingSessionRequestFields(scopingSession),
  };
}

export function scopingSessionRequestFields(scopingSession) {
  if (
    typeof scopingSession?.id !== "string"
    || !Number.isInteger(scopingSession?.revision)
  ) return {};
  return {
    scopingSessionId: scopingSession.id,
    scopingSessionRevision: scopingSession.revision,
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
