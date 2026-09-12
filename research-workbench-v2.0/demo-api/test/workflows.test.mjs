import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchContext, validateComparisonOutput, resolveMaterialCitation, materialContextLimits, planMaterialBatches,
  materialRequestSize, assertMaterialContextFits, perPaperBatchInstructions, validatePaperBatchOutput, combinePaperCoverage,
  landscapeAggregationInstructions, completeLandscapeAggregation, createTaskAttempt, createToolRun, transitionRun, runMaterialBatches, workflowRegistry } from '../src/workflows.mjs';
import { LANDSCAPE_FRAMEWORK, PAPER_FIELDS } from '../../shared/domain-landscape.mjs';
import { dimensionFixture } from './landscape-fixture.mjs';
import { validateResearchOutput } from '../src/research.mjs';

const material = (i, text = `Observed association ${i}.`) => ({ ref: `R${i}`, accessId: `a${i}`, sourceId: `s${i}`, title: `Paper ${i}`, authors: [], year: null, pmid: null, level: 'abstract', text });
const papersFor = batch => JSON.stringify({ framework: LANDSCAPE_FRAMEWORK, papers: batch.materials.map(m => ({ ref: m.ref,
  fields: Object.fromEntries(Object.keys(PAPER_FIELDS).map(key => [key, { text: key === 'unreported' ? '本次片段未报告。' : '本次片段报告一项观察。', status: key === 'unreported' ? 'unknown' : 'reported', passages: key === 'unreported' ? [] : ['P1'] }])) })) });
const comparison = () => ({ explanation: '比较依据和未知。', next: '你可以深入或保持未决。', questions: [{ title: '观察关系', question: '问题是什么？', scope: '本次人群', rationale: '值得继续了解但尚未核查可行性。',
  supporting: [{ text: '材料报告关联。', status: 'reported', citations: [{ ref: 'R1', passage: 'P1' }] }], conflicting: [], unknowns: ['因果关系未知'], feasibility: { known: [], unknown: ['资料可得性未知'] } }] });

test('capabilities do not encode a global scientific stage or automatic adoption', () => {
  assert.deepEqual(Object.keys(workflowRegistry), ['clarify', 'retrieve', 'landscape', 'ask', 'revise', 'compare', 'topic-plan', 'topic-preview', 'topic-collect', 'topic-screen', 'topic-outline', 'topic-review', 'deepen', 'brief']);
  assert.ok(Object.values(workflowRegistry).every(w => w.adoptsDecision === false));
});

test('task context uses adopted exact revision, selected artifact/materials, and explicit related discussion', () => {
  const m = material(1), a = { id: 'art', title: '领域认识', kind: 'brief', headRevisionId: 'v1', revisions: [{ id: 'v1', sourceAccessIds: ['a1'], blocks: [{ id: 'b', type: 'paragraph', text: '原认识' }] }], draft: { version: 2, sourceAccessIds: ['a1'], notes: {}, resultId: 'r1' } };
  const p = { goal: '当前目标', originalGoal: '初始意图', conditions: '', metadataVersion: 1, artifacts: { art: a }, sources: { s1: { id: 's1', title: 'Paper 1' } }, accesses: { a1: { id: 'a1', sourceId: 's1', text: m.text, level: 'abstract' } }, researchResults: { r1: { blocks: [{ id: 'b', type: 'paragraph', text: '当前认识' }] } },
    researchKernel: { currentQuestion: { itemId: 'q', revisionId: 'q1', decisionId: 'd1' } }, researchItems: { q: { id: 'q', kind: 'question', headRevisionId: 'q2', revisions: [{ id: 'q1', text: '采用的原问题', evidenceIds: [] }, { id: 'q2', text: '尚未采用的修订' }] } },
    researchTasks: { unrelated: { id: 'unrelated', status: 'completed', mode: 'ask', input: { text: '旧问题' }, proposal: '无关旧答案' }, related: { id: 'related', status: 'completed', mode: 'ask', input: { text: '接续问题' }, proposal: '相关回答' } } };
  const context = buildResearchContext(p, a, { materials: [m], replyToTaskId: 'related', text: '现在的问题' });
  assert.equal(context.currentQuestion.text, '采用的原问题'); assert.equal(context.selectedArtifact.blocks[0].text, '当前认识');
  assert.deepEqual(context.relatedHistory.map(h => h.taskId), ['related']); assert.equal(context.selectedMaterialRefs[0].text, undefined);
  assert.doesNotMatch(JSON.stringify(context), /无关旧答案|尚未采用的修订/);
  context.currentQuestion.text = 'mutated'; assert.equal(p.researchItems.q.revisions[0].text, '采用的原问题');
  assert.throws(() => buildResearchContext(p, a, { materials: [material(2)] }), e => e.code === 'invalid_scope');
  assert.throws(() => buildResearchContext(p, a, { materials: [{ ...m, text: 'changed snapshot' }] }), e => e.code === 'invalid_scope');
});

test('comparison permits no candidates and resolves exact references without adopting or scoring', () => {
  const result = validateComparisonOutput(JSON.stringify(comparison()), [material(1)]);
  const citation = result.questions[0].supporting[0].citations[0];
  assert.equal(citation.quote, material(1).text); assert.equal(citation.start, 0); assert.equal(citation.level, 'abstract');
  assert.equal(citation.verification, 'exact_excerpt_only'); assert.equal(result.questions[0].adopted, undefined);
  assert.deepEqual(validateComparisonOutput(JSON.stringify({ ...comparison(), questions: [] }), []).questions, []);
});

test('comparison rejects unselected snapshots, missing evidence, fabricated passages and numeric ratings', () => {
  for (const mutate of [d => d.questions[0].supporting[0].citations[0].ref = 'R99', d => d.questions[0].supporting[0].citations[0].passage = 'P99',
    d => d.questions[0].supporting[0].citations = [], d => d.questions[0].score = 99]) {
    const data = comparison(); mutate(data); assert.throws(() => validateComparisonOutput(JSON.stringify(data), [material(1)]));
  }
  assert.throws(() => resolveMaterialCitation({ ref: 'R1', accessId: 'a99', passage: 'P1' }, [material(1)]), e => e.code === 'invalid_citation');
  assert.throws(() => resolveMaterialCitation({ ref: 'R1', passage: 'P1', quote: 'wrong' }, [material(1)]), e => e.code === 'invalid_citation');
});

test('missing display title uses the exact question while required content and citation checks remain strict', () => {
  const data = comparison(); delete data.questions[0].title;
  data.questions[0].question = '  完整的问题表达（不摘要、不改写）？  ';
  const raw = JSON.stringify(data), result = validateComparisonOutput(raw, [material(1)]);
  assert.equal(result.questions[0].title, data.questions[0].question);
  assert.equal(result.questions[0].question, data.questions[0].question);
  assert.equal(JSON.stringify(data), raw);
  for (const title of [null, 42, {}, [], '', '  ']) {
    assert.throws(() => validateComparisonOutput(JSON.stringify({ ...data, questions: [{ ...data.questions[0], title }] }), [material(1)]), e => e.code === 'model_structure');
  }
  const noQuestion = structuredClone(data); delete noQuestion.questions[0].question;
  assert.throws(() => validateComparisonOutput(JSON.stringify(noQuestion), [material(1)]), e => e.code === 'model_structure');
  const noEvidence = structuredClone(data); noEvidence.questions[0].supporting[0].citations = [];
  assert.throws(() => validateComparisonOutput(JSON.stringify(noEvidence), [material(1)]), e => e.code === 'unsupported_claim');
  const wrongCitation = structuredClone(data); wrongCitation.questions[0].supporting[0].citations[0].ref = 'R99';
  assert.throws(() => validateComparisonOutput(JSON.stringify(wrongCitation), [material(1)]), e => e.code === 'invalid_citation');
});

test('unknown provider context sends all selected materials in one complete batch', () => {
  const selected = Array.from({ length: 180 }, (_, i) => material(i + 1, '完整文本 '.repeat(300)));
  const plan = planMaterialBatches(selected);
  assert.equal(materialContextLimits({}).maxInputTokens, null); assert.equal(plan.batches.length, 1);
  assert.deepEqual(plan.batches[0].materials, selected); assert.deepEqual(plan.coverage.excludedAccessIds, []);
  assert.equal(plan.coverage.selectedCount, 180);
});

test('only explicit provider allowance triggers lossless batching and oversized-paper segmentation', () => {
  const selected = [material(1, '观察 😀 association. '.repeat(300)), material(2, 'Second paper.')];
  const options = { maxInputTokens: 700, countTokens: s => s.length, instruction: 'extract' };
  const plan = planMaterialBatches(selected, options); assert.ok(plan.batches.length > 2);
  for (const m of selected) assert.equal(plan.batches.flatMap(b => b.materials).filter(p => p.accessId === m.accessId).map(p => p.text).join(''), m.text);
  for (const batch of plan.batches) assert.ok(materialRequestSize(batch.materials, options) <= 700);
  assert.equal(plan.batches[0].materials[0].ref, 'R1'); assert.equal(plan.batches.at(-1).materials[0].ref, 'R2');
  assert.equal(materialContextLimits({ contextWindowTokens: 1000, maxOutputTokens: 200 }).maxInputTokens, 800);
  assert.throws(() => materialContextLimits({ contextWindowTokens: 1000, maxOutputTokens: 1200 }), e => e.code === 'invalid_context_configuration');
  assert.throws(() => planMaterialBatches(selected, { maxInputTokens: 5 }), e => e.code === 'context_capacity');
});

test('per-paper validation and combination preserve all segment observations and original offsets', () => {
  const selected = [material(1, 'The original observation. '.repeat(90)), material(2)];
  const plan = planMaterialBatches(selected, { maxInputTokens: 800, countTokens: s => s.length });
  const results = plan.batches.map(b => validatePaperBatchOutput(papersFor(b), b));
  const combined = combinePaperCoverage(results, selected);
  assert.equal(combined.coverage.complete, true); assert.equal(combined.paperNotes.length, 2);
  assert.ok(combined.paperNotes[0].fields.findings.observations.length > 1);
  for (const paper of combined.paperNotes) for (const observation of paper.fields.findings.observations) for (const c of observation.citations) {
    assert.equal(selected.find(m => m.accessId === c.accessId).text.slice(c.start, c.end), c.quote);
  }
  assert.throws(() => combinePaperCoverage(results.slice(1), selected), e => e.code === 'incomplete_paper_coverage');
  assert.throws(() => combinePaperCoverage([...results, results[0]], selected), e => e.code === 'incomplete_paper_coverage');
  const wrong = JSON.parse(papersFor(plan.batches[0])); wrong.papers[0].fields.methods.passages = ['P500'];
  assert.throws(() => validatePaperBatchOutput(JSON.stringify(wrong), plan.batches[0]), e => e.code === 'invalid_citation');
  assert.match(perPaperBatchInstructions(), /本次片段未报告/);
});

test('aggregation includes all paper records plus actual excerpts and preserves seven-dimensional validation', () => {
  const selected = [material(1), material(2)], plan = planMaterialBatches(selected);
  const combined = combinePaperCoverage(plan.batches.map(b => validatePaperBatchOutput(papersFor(b), b)), selected);
  const instruction = landscapeAggregationInstructions(combined, { goal: '研究关联' });
  assert.match(instruction, /R1/); assert.match(instruction, /R2/); assert.ok(instruction.includes(selected[0].text));
  const output = dimensionFixture(selected); output.papers = [{ ref: 'R99' }];
  const completed = completeLandscapeAggregation(JSON.stringify(output), combined);
  const final = validateResearchOutput(completed, 'landscape', selected, { requirePaperNotes: true, requireDimensions: true });
  assert.equal(final.paperNotes.length, 2); assert.equal(final.dimensions.length, 7);
  output.sections[0].items[0].citations = [{ ref: 'R1', passage: 'P100' }];
  assert.throws(() => completeLandscapeAggregation(JSON.stringify(output), combined), e => e.code === 'invalid_citation');
  assert.throws(() => assertMaterialContextFits([], { instruction, maxInputTokens: 100 }), e => e.code === 'context_capacity');
});

test('run lifecycle rejects terminal resurrection and new manual attempt has separate identity', () => {
  const first = createTaskAttempt('task', { at: '2026-09-08T00:00:00Z' }), tool = createToolRun(first, { name: 'PubMed.search' });
  assert.equal(tool.attemptId, first.id); const running = transitionRun(first, 'running'); const failed = transitionRun(running, 'failed');
  assert.throws(() => transitionRun(failed, 'running'), e => e.code === 'invalid_run_transition');
  assert.throws(() => transitionRun(first, 'completed'), e => e.code === 'invalid_run_transition');
  const retry = createTaskAttempt('task', { previousAttemptId: failed.id }); assert.notEqual(retry.id, failed.id); assert.equal(retry.previousAttemptId, failed.id);
});

test('batch runner checkpoints before calls, stops at first error, and reuses successful batches on manual retry', async () => {
  const plan = planMaterialBatches([material(1, 'a'.repeat(300)), material(2, 'b'.repeat(300))], { maxInputTokens: 550, countTokens: s => s.length });
  assert.equal(plan.batches.length, 2);
  const saved = new Map(), called = [];
  const checkpoint = async record => { saved.set(record.batchId, record); };
  const run = async ({ batch }) => { assert.equal(saved.get(batch.id).status, 'running'); called.push(batch.id); if (batch.id === plan.batches[1].id) throw new DomainError('model_rate_limited', 502, 'test'); return validatePaperBatchOutput(papersFor(batch), batch); };
  await assert.rejects(runMaterialBatches({ plan, run, checkpoint }), e => e.code === 'model_rate_limited');
  assert.equal(called.length, 2); assert.equal(saved.get(plan.batches[0].id).status, 'completed');
  await assert.rejects(runMaterialBatches({ plan, run, checkpoint, previous: [...saved.values()] }), e => e.code === 'manual_retry_required');
  const result = await runMaterialBatches({ plan, checkpoint, previous: [...saved.values()], manualRetry: true,
    run: async ({ batch }) => { called.push(batch.id); return validatePaperBatchOutput(papersFor(batch), batch); } });
  assert.equal(called.length, 3); assert.deepEqual(result.reusedBatchIds, [plan.batches[0].id]);
  assert.equal(result.records[1].attempts.length, 2); assert.equal(combinePaperCoverage(result.results, [material(1, 'a'.repeat(300)), material(2, 'b'.repeat(300))]).coverage.complete, true);
});

test('late model results after cancellation are not marked complete or retried', async () => {
  const plan = planMaterialBatches([material(1)]), controller = new AbortController(), saved = [];
  let count = 0;
  await assert.rejects(runMaterialBatches({ plan, signal: controller.signal, checkpoint: async r => saved.push(r), run: async () => { count++; controller.abort(); return { papers: [] }; } }));
  assert.equal(count, 1); assert.equal(saved.at(-1).status, 'cancelled'); assert.equal(saved.at(-1).result, null);
});

// Import kept explicit so test exceptions exercise the same typed failure path.
import { DomainError } from '../src/errors.mjs';
