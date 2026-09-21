import test from 'node:test';
import assert from 'node:assert/strict';
import { extractionForRevision } from '../src/extraction-reuse.mjs';
import { planMaterialBatches, validatePaperBatchOutput } from '../src/workflows.mjs';
import { dimensionFixture } from './landscape-fixture.mjs';

function fixture() {
  const materials = [1, 2].map(i => ({ ref: `R${i}`, sourceId: `s${i}`, accessId: `a${i}`, level: 'abstract', text: `Observed association ${i}.` }));
  const batch = planMaterialBatches(materials).batches[0];
  const record = { batchId: batch.id, status: 'completed', segments: batch.segments,
    result: validatePaperBatchOutput(JSON.stringify(dimensionFixture(materials)), batch) };
  const source = { id: 'old', status: 'completed', mode: 'landscape', artifactId: 'canvas', provider: 'fixture', model: 'same',
    input: { materials, context: { goal: 'domain', conditions: 'known', researcherProfile: { data: 'none' }, question: 'old question' } }, paperBatchRecords: [record] };
  const project = { researchTasks: { old: source }, researchResults: { report: { id: 'report', taskId: 'old', artifactId: 'canvas' } } };
  const task = { mode: 'revise', artifactId: 'canvas', model: 'same', provider: 'fixture', input: { text: '解释不同结果',
    context: { ...source.input.context, question: 'new question', selectedArtifact: { resultId: 'report' } } } };
  return { project, task, materials };
}

test('revision reuse is limited to current report, research context and exact immutable access text', () => {
  const f = fixture(), before = structuredClone(f.project);
  assert.equal(extractionForRevision(f.project, f.task, f.materials).accessIds.length, 2);
  assert.deepEqual(f.project, before);
  const changed = structuredClone(f.materials); changed[0].text = 'New contradictory source text.';
  assert.deepEqual(extractionForRevision(f.project, f.task, changed).accessIds, ['a2']);
  for (const patch of [{ model: 'another' }, { provider: 'another' }, { artifactId: 'another' }, { mode: 'compare' }])
    assert.equal(extractionForRevision(f.project, { ...f.task, ...patch }, f.materials), null);
  for (const key of ['goal', 'conditions', 'researcherProfile', 'notes', 'currentQuestion']) {
    const task = structuredClone(f.task); task.input.context[key] = 'changed';
    assert.equal(extractionForRevision(f.project, task, f.materials), null);
  }
  const tampered = fixture(); tampered.project.researchTasks.old.paperBatchRecords[0].result.papers[0].fields.findings.citations[0].quote = 'fabricated';
  assert.deepEqual(extractionForRevision(tampered.project, tampered.task, tampered.materials).accessIds, ['a2']);
});

test('a question branch reuses only its recorded ancestor report, clearing old relevance for the new focus', () => {
  const f = fixture();
  f.project.artifacts = {
    canvas: { id: 'canvas', revisions: [{ id: 'v-report', resultId: 'report' }] },
    branch: { id: 'branch', lineage: { artifactId: 'canvas', revisionId: 'v-report', resultId: 'report' } },
  };
  f.project.researchResults.handoff = { id: 'handoff', artifactId: 'branch', taskId: null };
  f.task.artifactId = 'branch'; f.task.input.context.selectedArtifact.resultId = 'handoff';
  f.task.input.context.currentQuestion = { text: 'A focused new question' };
  const reused = extractionForRevision(f.project, f.task, f.materials);
  assert.equal(reused.ancestral, true); assert.equal(reused.accessIds.length, 2);
  assert.ok(reused.records.flatMap(r => r.result.papers).every(p => p.fields.relevance.status === 'unknown'));
  f.project.artifacts.branch.lineage.revisionId = 'missing';
  assert.equal(extractionForRevision(f.project, f.task, f.materials), null);
  f.project.artifacts.branch.lineage = { artifactId: 'branch', revisionId: 'cycle' };
  assert.equal(extractionForRevision(f.project, f.task, f.materials), null);
});
