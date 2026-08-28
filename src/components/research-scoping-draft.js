export const SCOPING_DRAFT_STORAGE_KEY = "research-workbench:scoping-draft:v2";

export function loadScopingDraft(storage = globalThis.sessionStorage) {
  try {
    const raw = storage?.getItem(SCOPING_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    return draft && typeof draft === "object" ? draft : null;
  } catch {
    return null;
  }
}

export function saveScopingDraft(draft, storage = globalThis.sessionStorage) {
  try {
    if (!draft) {
      storage?.removeItem(SCOPING_DRAFT_STORAGE_KEY);
      return false;
    }
    storage?.setItem(SCOPING_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    return true;
  } catch {
    // Private browsing or storage quotas must not block the research workflow.
    return false;
  }
}

export function firstRoundCheckpointFrom({
  queryPlan,
  queryCalibration,
  queryPreview,
  selectedQueryId,
  createForm,
  directionDecision,
} = {}) {
  if (!queryPreview || typeof queryPreview !== "object") return null;
  return {
    queryPlan: queryPlan ?? null,
    queryCalibration: queryCalibration ?? null,
    queryPreview,
    selectedQueryId: selectedQueryId ?? "",
    createForm: createForm ?? null,
    directionDecision: directionDecision ?? null,
  };
}

export function restoredFirstRoundState(directionSelection) {
  const checkpoint = directionSelection?.roundOneCheckpoint;
  if (!checkpoint?.queryPreview || !checkpoint?.createForm) return null;
  return {
    scopingRound: 1,
    createStep: "review",
    queryPlan: checkpoint.queryPlan ?? null,
    queryCalibration: checkpoint.queryCalibration ?? null,
    queryPreview: checkpoint.queryPreview,
    selectedQueryId: checkpoint.selectedQueryId ?? "",
    createForm: checkpoint.createForm,
    directionDecision: checkpoint.directionDecision ?? null,
    directionSelection: null,
  };
}
