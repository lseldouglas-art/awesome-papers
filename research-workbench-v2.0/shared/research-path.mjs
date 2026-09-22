// Only recorded input references define ancestry. Recency never invents a path.
export function parentReference(project, artifact, result = project.researchResults?.[artifact?.draft?.resultId]) {
  let explicit = result?.inputContext ?? artifact?.lineage;
  // A new comparison version can depend on its own previous version. Follow
  // that recorded version to its external parent without making a UI self-loop.
  const visited = new Set();
  while (explicit && explicit.artifactId === artifact?.id) {
    if (!explicit.revisionId || visited.has(explicit.revisionId)) return null;
    visited.add(explicit.revisionId);
    const revision = artifact.revisions?.find(r => r.id === explicit.revisionId);
    result = project.researchResults?.[revision?.resultId];
    explicit = result?.inputContext;
  }
  if (explicit?.artifactId && project.artifacts[explicit.artifactId]) return explicit;
  const task = result?.taskId && project.researchTasks?.[result.taskId];
  if (task && task.artifactId !== artifact?.id && project.artifacts[task.artifactId]) {
    return { artifactId: task.artifactId, revisionId: task.input.revisionId, basis: 'recorded_task_input' };
  }
  return null;
}
export function researchPath(project, artifact) {
  const path = [], seen = new Set();
  while (artifact && !seen.has(artifact.id)) {
    seen.add(artifact.id); path.unshift(artifact);
    artifact = project.artifacts[parentReference(project, artifact)?.artifactId];
  }
  return path;
}
export const artifactKindLabels = { brief: '领域认识', questions: '选题比较', research_brief: '工作简报', research_branch: '选题探索', topic_library: '专题文献库' };

export function landscapeCandidates(project, artifact) {
  return Object.values(project.artifacts).filter(a => a.id !== artifact.id && project.researchResults?.[a.draft?.resultId]?.kind === 'brief');
}

export function briefIsOutdated(project, result) {
  if (result?.kind !== 'research_brief') return false;
  const saved = result.adoptionContext ?? {}, state = project.researchState;
  if (!state) return false;
  const ids = [...new Set([...Object.values(project.researchKernel?.choices ?? {}), state.currentQuestion?.decisionId, state.exploration?.decisionId,
    !state.currentQuestion && project.researchKernel?.undecidedDecisionId].filter(Boolean))].sort();
  return JSON.stringify([saved.currentQuestion?.decisionId ?? null, saved.exploration?.decisionId ?? null, [...(saved.decisionIds ?? [])].sort()])
    !== JSON.stringify([state.currentQuestion?.decisionId ?? null, state.exploration?.decisionId ?? null, ids]);
}
