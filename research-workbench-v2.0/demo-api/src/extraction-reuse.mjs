import { reusablePaperExtractions } from './workflows.mjs';
import { parentReference } from '../../shared/research-path.mjs';

// Revision reuses the selected report's source facts, not an arbitrary recent run.
// Context-dependent relevance is cleared in this new projection; history stays intact.
export function extractionForRevision(project, task, materials) {
  if (task.mode !== 'revise' || task.retryOfTaskId
    || /不要复用|不复用|重新(?:逐篇|提取|阅读|核查|核对|整理)|重读|重做逐篇|纠正.{0,8}(?:提取|逐篇)|重新分析(?:每篇|所有|全部)/.test(task.input.text ?? '')) return null;
  const selected = task.input.context?.selectedArtifact;
  let result = project.researchResults[selected?.resultId];
  let source = project.researchTasks[result?.taskId];
  let artifact = project.artifacts?.[task.artifactId], ancestral = false;
  const visited = new Set();
  // A question branch may start with a deterministic handoff, with no model
  // task of its own. Follow its exact recorded parent revisions to the report.
  while (!source?.paperBatchRecords?.length && artifact && !visited.has(artifact.id)) {
    visited.add(artifact.id);
    const ref = parentReference(project, artifact, result), parent = project.artifacts?.[ref?.artifactId];
    const revision = parent?.revisions?.find(r => r.id === ref.revisionId);
    if (!revision || ref.resultId && revision.resultId && ref.resultId !== revision.resultId) break;
    result = project.researchResults[ref.resultId ?? revision.resultId];
    artifact = parent; source = project.researchTasks[result?.taskId]; ancestral = true;
  }
  if (!source || source.status !== 'completed' || !['landscape', 'revise'].includes(source.mode)
    || source.artifactId !== (ancestral ? artifact?.id : task.artifactId) || result.artifactId !== source.artifactId
    || source.provider !== task.provider || source.model !== task.model) return null;
  const before = source.input.context ?? {}, after = task.input.context ?? {};
  if ((ancestral ? ['goal', 'originalGoal'] : ['goal', 'originalGoal', 'conditions', 'researcherProfile', 'notes', 'currentQuestion', 'exploration', 'primaryResearchObject'])
    .some(key => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))) return null;
  // Source IDs alone are insufficient: compare the original accessed bytes too.
  const unchanged = materials.filter(m => source.input.materials?.some(old => old.accessId === m.accessId
    && old.sourceId === m.sourceId && old.text === m.text && old.level === m.level));
  if (!unchanged.length) return null;
  const reused = reusablePaperExtractions(source.paperBatchRecords ?? [], unchanged);
  if (!reused.accessIds.size) return null;
  const records = structuredClone(reused.records);
  for (const record of records) {
    record.result.papers = record.result.papers.filter(p => reused.accessIds.has(p.accessId));
    record.segments = record.result.papers.map(p => p.segment);
    record.reusedFromTaskId = source.id;
    record.contextProjection = { omittedFields: ['relevance'], reason: 'new_revision_question' };
    for (const paper of record.result.papers) paper.fields.relevance = {
      text: '本轮相关性需按新的修改要求重新判断；原判断保留在此前记录。', status: 'unknown', citations: [],
    };
  }
  return { records, sourceTaskId: source.id, sourceResultId: result.id, accessIds: [...reused.accessIds], ancestral };
}
