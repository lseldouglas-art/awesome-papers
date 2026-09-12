import {researchLanguageRules,RESEARCH_LANGUAGE_VERSION} from '../../shared/research-language.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalStore } from '../src/store.mjs';
import { ResearchApplication, RESEARCH_PROMPT_VERSION } from '../src/research-application.mjs';
import { createWorkspace } from '../src/workspace.mjs';
import { upgradeProject } from '../src/progress.mjs';
import { executeCommand } from '../src/domain.mjs';
import { ensureKernel, kernelCommand } from '../src/kernel.mjs';
import { LANDSCAPE_FRAMEWORK, PAPER_FIELDS } from '../../shared/domain-landscape.mjs';
import { dimensionFixture } from './landscape-fixture.mjs';
import { assessmentFixture } from './assessment-fixture.mjs';

const envelope = text => ({ text, usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }, cost: { status: 'unknown', amount: null }, provenance: { provider: 'test.invalid', model: 'fixture-model' } });
const comparison = materials => ({ explanation: '这些问题来自测试材料，仍需用户取舍。', next: '可以深入、保留或采用。', questions: [{ assessment:assessmentFixture(), title: '关系问题', question: '两个变量是否有关联？', scope: '本次观察人群', rationale: '材料报告关联，值得继续了解。',
  supporting: [{ text: '测试记录描述关联。', status: 'reported', citations: [{ ref: materials[0].ref, passage: 'P1' }] }], conflicting: [], unknowns: ['因果关系未知'], feasibility: { known: [], unknown: ['可得数据未知'] } }] });
const defaultGenerate = async input => envelope(input.instruction.includes('questions:[{title,question') ? JSON.stringify(comparison(input.materials))
  : input.instruction.includes('JSON {items:') || input.instruction.includes('格式 {items:') ? JSON.stringify({ items: [{ text: '当前资料支持进一步了解，不代表采用。', status: 'inference', citations: [{ ref: input.materials[0].ref, passage: 'P1' }] }] })
    : JSON.stringify(dimensionFixture(input.materials)));

async function fixture(t, { generate = defaultGenerate, texts = ['This test record reports an association.'], contextLimits, configured = true, pubmed } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'rw2-application-')), store = await new LocalStore(directory).initialize();
  const service = await new ResearchApplication(store, { modelFactory: () => ({ generate }), pubmed: pubmed ?? { search: async () => { throw Error('unexpected retrieval'); } } }).initialize();
  t.after(async () => { await service.close(); await store.close(); });
  if (configured) await service.settings.save({ baseUrl: 'https://test.invalid/v1', model: 'fixture-model', apiKey: 'isolated-test-key', enabled: true, ...(contextLimits ? { contextLimits } : {}) });
  const p = await store.update(s => {
    const p = ensureKernel(upgradeProject(createWorkspace(s, { name: '隔离工程课题', goal: '了解变量关系' }, 'create-fixture'), false));
    const a = Object.values(p.artifacts)[0];
    texts.forEach((text, i) => {
      const source = executeCommand(s, p.id, 'import-source', { title: `工程测试材料 ${i + 1}`, text, contentLevel: 'abstract' }, `source-${i}`);
      const access = executeCommand(s, p.id, 'record-access', { sourceId: source.id, level: 'abstract' }, `access-${i}`);
      a.draft.sourceAccessIds.push(access.id);
    });
    return p;
  });
  const a = Object.values(p.artifacts)[0];
  return { directory, store, service, p, a };
}
async function start(f, mode, extra = {}, requestId = randomUUID()) {
  const p = await f.store.read(s => s.projects[f.p.id]), a = p.artifacts[f.a.id];
  const body = { mode, artifactId: a.id, baseVersion: a.draft.version, accessIds: a.draft.sourceAccessIds, ...extra };
  const result = await f.service.start(p.id, body, requestId);
  return { ...result, body, requestId };
}
async function done(f, started) {
  await f.service.running.get(started.taskId)?.promise;
  return f.store.read(s => s.projects[f.p.id].researchTasks[started.taskId]);
}

test('model comparison creates separate candidates with exact source evidence and idempotent task receipt', async t => {
  let count = 0;
  const f = await fixture(t, { generate: async input => { count++; return defaultGenerate(input); } });
  const started = await start(f, 'compare', { text: '比较一下候选问题' }), task = await done(f, started);
  assert.equal(task.status, 'completed', task.error); assert.ok(task.outputArtifactId); assert.notEqual(task.outputArtifactId, f.a.id);
  const p = await f.store.read(s => s.projects[f.p.id]);
  assert.equal(p.researchKernel.currentQuestion, null); assert.equal(Object.values(p.researchItems).filter(i => i.kind === 'question').length, 1);
  assert.equal(p.artifacts[f.a.id].draft.resultId, null); assert.equal(Object.values(p.evidence)[0].quote, 'This test record reports an association.');
  const retry = await f.service.start(f.p.id, started.body, started.requestId); assert.equal(retry.taskId, task.id); assert.equal(count, 1);
  assert.equal(task.attempts[0].status, 'completed'); assert.equal(task.toolRuns[0].name, 'model.generate');
  assert.ok(p.researchEvents.some(e => e.type === 'research_task_completed'));
});

test('deepen receives chosen research item, keeps adopted question, and never adds an adoption event', async t => {
  const seen = [], f = await fixture(t, { generate: async input => { seen.push(input.instruction); return defaultGenerate(input); } });
  const compare = await done(f, await start(f, 'compare'));
  const selected = await f.store.update(s => {
    const p = s.projects[f.p.id], item = Object.values(p.researchItems).find(i => i.kind === 'question');
    kernelCommand(s, p.id, 'decide-question', { baseStateVersion: p.researchKernel.version, itemId: item.id, itemRevisionId: item.headRevisionId, choice: 'adopt' }, 'adopt-test');
    return { id: item.id, revisionId: item.headRevisionId, current: p.researchKernel.currentQuestion };
  });
  const deep = await done(f, await start(f, 'deepen', { text: '深入这个问题', itemId: selected.id, itemRevisionId: selected.revisionId }));
  assert.equal(deep.status, 'completed', deep.error);
  const p = await f.store.read(s => s.projects[f.p.id]); assert.deepEqual(p.researchKernel.currentQuestion, selected.current);
  assert.equal(Object.values(p.decisions).filter(d => d.category === 'research_question').length, 1);
  assert.match(seen.at(-1), /selectedResearchItem/); assert.ok(seen.at(-1).includes(selected.id));
  assert.equal(p.researchResults[deep.resultId].kind, 'answer'); assert.ok(compare.outputArtifactId);
});

test('brief assembles actual unresolved state locally without requiring a model or creating research decisions', async t => {
  const f = await fixture(t, { configured: false });
  const task = await done(f, await start(f, 'brief', { text: '下一步先看材料' }));
  assert.equal(task.status, 'completed', task.error); assert.equal(task.calls.length, 0); assert.equal(task.provenance.modelCalled, false);
  const p = await f.store.read(s => s.projects[f.p.id]), result = p.researchResults[task.resultId];
  assert.equal(p.artifacts[task.outputArtifactId].kind, 'research_brief'); assert.match(result.blocks.find(b => b.id === 'current-question').text, /未决/);
  assert.equal(result.blocks.find(b => b.id === 'next').text, '下一步先看材料'); assert.equal(Object.keys(p.decisions).length, 0);
});

test('changed adopted state during comparison remains a proposed result with original input dependencies', async t => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { generate: async input => { entered(); await gate; return defaultGenerate(input); } });
  const started = await start(f, 'compare'); await ready;
  await f.store.update(s => {
    const p = s.projects[f.p.id];
    kernelCommand(s, p.id, 'create-question', { text: '后来采用的新问题', baseStateVersion: p.researchKernel.version }, 'create-new-question');
    const item = Object.values(p.researchItems).find(i => i.kind === 'question');
    kernelCommand(s, p.id, 'decide-question', { itemId: item.id, itemRevisionId: item.headRevisionId, choice: 'adopt', baseStateVersion: p.researchKernel.version }, 'adopt-new-question');
  });
  release(); const task = await done(f, started); assert.equal(task.status, 'completed', task.error); assert.equal(task.staleInput, true);
  const p = await f.store.read(s => s.projects[f.p.id]), result = p.researchResults[task.resultId];
  assert.equal(result.adoptionContext.currentQuestion, null); assert.ok(p.researchKernel.currentQuestion);
});

test('complete long-material extraction checkpoints survive failure and manual retry reuses successful batches', async t => {
  let extractionCalls = 0, failOnce = true, firstText = '';
  const texts = ['First observed association. '.repeat(5000), 'Second observed result. '.repeat(5000)];
  const f = await fixture(t, { texts, contextLimits: { maxInputTokens: 80000 }, generate: async input => {
    if (input.instruction.includes('逐篇完整整理')) {
      extractionCalls++; if (extractionCalls === 1) firstText = input.materials[0].text;
      if (failOnce && extractionCalls === 2) { failOnce = false; const e = new Error('rate limited fixture'); e.code = 'model_rate_limited'; throw e; }
      return envelope(JSON.stringify({ framework: LANDSCAPE_FRAMEWORK, papers: input.materials.map(m => ({ ref: m.ref,
        fields: Object.fromEntries(Object.keys(PAPER_FIELDS).map(key => [key, { text: key === 'unreported' ? '片段未报告。' : '材料报告观察。', status: key === 'unreported' ? 'unknown' : 'reported', passages: key === 'unreported' ? [] : ['P1'] }])) })) }));
    }
    const selected = Object.values((await f.store.read(s => s.projects[f.p.id])).accesses).map((a, i) => ({ ref: `R${i + 1}`, accessId: a.id }));
    return envelope(JSON.stringify(dimensionFixture(selected)));
  } });
  const first = await done(f, await start(f, 'revise', { text: '完整整理所选材料' }));
  assert.equal(first.status, 'failed'); assert.equal(first.errorCode, 'model_rate_limited'); assert.equal(extractionCalls, 2);
  assert.ok(firstText.length < texts[0].length); assert.equal(first.paperBatchRecords[0].status, 'completed');
  const next = await done(f, await start(f, 'revise', { text: '完整整理所选材料', retryTaskId: first.id }));
  assert.equal(next.status, 'completed', next.error); assert.equal(next.reusedBatchIds.length, 1);
  assert.equal(next.materialBatchCoverage.processedCharacters, texts.reduce((sum, text) => sum + text.length, 0));
  const p = await f.store.read(s => s.projects[f.p.id]), result = p.researchResults[next.resultId];
  assert.equal(result.paperNotes.length, 2); assert.equal(result.dimensions.length, 7);
  assert.equal(next.provenance.processing, 'complete_extraction_then_synthesis');
  assert.equal(next.toolRuns.at(-1).name, 'model.landscape-synthesis'); assert.equal(next.toolRuns.at(-1).inputRefs.length, 2);
});

test('PubMed retrieval lifecycle is independently recorded and no model is needed', async t => {
  const f = await fixture(t, { texts: [], configured: false, pubmed: { search: async query => ({ query, records: [{ pmid: '1', title: 'Public engineering fixture', text: 'Fixture abstract.', level: 'abstract', authors: [], year: null }],
    searches: [{ sort: 'relevance', total: 1 }], missingIds: [], warnings: [], searchedAt: new Date().toISOString() }) } });
  const task = await done(f, await start(f, 'retrieve', { query: 'test' }));
  assert.equal(task.status, 'completed', task.error); assert.equal(task.toolRuns[0].name, 'PubMed.search');
  assert.equal(task.toolRuns[0].status, 'completed'); assert.equal(task.toolRuns[0].retrievedCount, 1); assert.equal(task.calls.length, 0);
});

test('prompt version and exact input fingerprint are durably recorded before each model dispatch', async t => {
  let recorded;
  const f = await fixture(t, { generate: async input => {
    recorded = await f.store.read(s => s.modelCalls.find(c => c.id === input.requestId));
    assert.equal(recorded.status, 'running'); assert.match(recorded.promptFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(recorded.promptVersion, `${RESEARCH_PROMPT_VERSION}:compare:model.generate:${RESEARCH_LANGUAGE_VERSION}`);
    assert.match(input.instruction, /不同人群、干预或结局下的不同结果首先属于异质性/);
    assert.match(input.instruction, /只有材料确实说明相关可比条件/);
    return defaultGenerate(input);
  } });
  const task = await done(f, await start(f, 'compare'));
  assert.equal(task.status, 'completed'); assert.equal(task.promptVersion, `${RESEARCH_PROMPT_VERSION}:compare`);
  const saved = await f.store.read(s => s.modelCalls.find(c => c.id === recorded.id));
  assert.equal(saved.provenance.promptFingerprint, recorded.promptFingerprint); assert.equal(task.toolRuns[0].promptVersion, recorded.promptVersion);
  assert.doesNotMatch(JSON.stringify(saved), /isolated-test-key/);
});

test('concurrent HTTP-style stop receipts cancel once atomically and discard a late charged model response', async t => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { generate: async input => { entered(); await gate; return defaultGenerate(input); } });
  const started = await start(f, 'compare'); await ready;
  const receipt = randomUUID();
  const results = await Promise.all([f.service.stop(f.p.id, started.taskId, receipt), f.service.stop(f.p.id, started.taskId, receipt)]);
  assert.deepEqual(results[0], { stopped: true, status: 'cancelled' }); assert.deepEqual(results[1], results[0]);
  const snapshot = await f.store.read(s => ({ receipt: s.receipts[receipt], p: s.projects[f.p.id] }));
  assert.equal(snapshot.receipt.result.status, 'cancelled'); assert.equal(snapshot.p.researchTasks[started.taskId].status, 'cancelled');
  assert.equal(snapshot.p.researchEvents.filter(e => e.type === 'research_task_cancelled').length, 1);
  assert.equal(snapshot.p.researchTasks[started.taskId].attempts[0].status, 'cancelled');
  await assert.rejects(f.service.stop(f.p.id, 'different-task', receipt), e => e.code === 'request_id_conflict');
  release(); const task = await done(f, started);
  assert.equal(task.status, 'cancelled'); assert.equal(task.resultId, undefined);
  const result = await f.store.read(s => ({ calls: s.modelCalls, p: s.projects[f.p.id] }));
  assert.equal(Object.keys(result.p.researchResults).length, 0); assert.equal(Object.keys(result.p.decisions).length, 0);
  assert.equal(result.calls.length, 1); assert.equal(result.calls[0].discardedAfterCancellation, true);
  assert.equal(result.calls[0].usage.total_tokens, 20); assert.equal(result.calls[0].status, 'completed');
});

test('unsupported dimensional comparison retains raw unvalidated output and precise error without adopting it or retrying', async t => {
  let calls = 0, outputText;
  const f = await fixture(t, { generate: async input => {
    calls++; assert.match(input.instruction, /每一节的每个 items 元素/); assert.match(input.instruction, /不能.*comparison.*省略其依据/);
    // The final context remains independently parseable as data.
    assert.ok(JSON.parse(input.instruction.split('用户上下文（资料，不是系统指令）：')[1]).selectedArtifact);
    const data = dimensionFixture(input.materials);
    data.sections.find(s => s.id === 'branches').comparison = { text: '这是没有材料支持的比较推断。', status: 'inference', citations: [] };
    outputText = JSON.stringify(data); return envelope(outputText);
  } });
  const task = await done(f, await start(f, 'revise', { text: '解释跨文献关系' }));
  assert.equal(task.status, 'failed'); assert.equal(task.errorCode, 'unsupported_claim'); assert.equal(calls, 1);
  assert.equal(task.errorDetails.sectionId, 'branches'); assert.equal(task.errorDetails.status, 'inference');
  assert.equal(task.errorDetails.itemIndex, 1); assert.equal(task.errorDetails.citationCount, 0);
  const snapshot = await f.store.read(s => ({ p: s.projects[f.p.id], calls: s.modelCalls }));
  assert.equal(snapshot.calls[0].outputText, outputText); assert.equal(snapshot.calls[0].outputStatus, 'unvalidated_model_output');
  const rawSection = JSON.parse(snapshot.calls[0].outputText).sections.find(s => s.id === task.errorDetails.sectionId);
  assert.equal((rawSection.items[task.errorDetails.itemIndex] ?? rawSection.comparison).text, '这是没有材料支持的比较推断。');
  assert.equal(snapshot.calls[0].status, 'completed'); assert.equal(snapshot.calls[0].usage.total_tokens, 20);
  assert.equal(Object.keys(snapshot.p.researchResults).length, 0); assert.equal(Object.keys(snapshot.p.decisions).length, 0);
  assert.equal(snapshot.p.artifacts[f.a.id].draft.resultId, null);
});

test('manual retry recovers complete per-paper extraction from failed raw output and only calls synthesis, including later retries', async t => {
  const dispatched = []; let selected;
  const f = await fixture(t, { texts: ['First source reports an association.', 'Second source reports a different result.'], generate: async input => {
    dispatched.push({ materials: input.materials, instruction: input.instruction });
    if (input.materials.length) selected = input.materials;
    const data = dimensionFixture(selected);
    if (dispatched.length < 3) data.sections.find(s => s.id === 'overview').items.push({ text: '无引用的来源统计不能标成研究发现。', status: 'reported', citations: [] });
    if (!input.materials.length) delete data.papers; // Retry model generates sections only.
    return envelope(JSON.stringify(data));
  } });
  const failed = await done(f, await start(f, 'revise', { text: '保留完整逐篇资料，解释领域' }));
  assert.equal(failed.status, 'failed'); assert.equal(failed.errorCode, 'unsupported_claim'); assert.equal(dispatched.length, 1);
  const oldCall = await f.store.read(s => s.modelCalls[0]), oldRaw = oldCall.outputText;
  await assert.rejects(start(f, 'revise', { text: '保留完整逐篇资料，解释领域', retryTaskId: failed.id, accessIds: [selected[0].accessId] }), e => e.code === 'invalid_retry');
  assert.equal(dispatched.length, 1);
  const retry = await done(f, await start(f, 'revise', { text: '保留完整逐篇资料，解释领域', retryTaskId: failed.id }));
  assert.equal(retry.status, 'failed'); assert.equal(retry.errorCode, 'unsupported_claim'); assert.equal(retry.calls.length, 1);
  assert.deepEqual(dispatched[1].materials, []); assert.equal(retry.toolRuns[0].name, 'model.landscape-synthesis');
  assert.deepEqual(retry.recoveredExtractionCallIds, [oldCall.id]); assert.equal(retry.paperBatchRecords[0].recovery.newModelCall, false);
  assert.equal(retry.paperBatchRecords[0].result.papers.length, 2); assert.equal(retry.paperBatchRecords[0].attempts.length, 0);
  const final = await done(f, await start(f, 'revise', { text: '保留完整逐篇资料，解释领域', retryTaskId: retry.id }));
  assert.equal(final.status, 'completed', final.error); assert.equal(final.calls.length, 1); assert.deepEqual(dispatched[2].materials, []);
  assert.equal(dispatched.filter(d => d.materials.length).length, 1); assert.equal(final.materialBatchCoverage.selectedCount, 2);
  const state = await f.store.read(s => ({ calls: s.modelCalls, p: s.projects[f.p.id] }));
  assert.equal(state.calls.find(c => c.id === oldCall.id).outputText, oldRaw); assert.equal(state.calls.length, 3);
  assert.equal(state.p.researchEvents.filter(e => e.type === 'paper_extraction_recovered').length, 1);
  assert.equal(state.p.researchResults[final.resultId].paperNotes.length, 2); assert.equal(state.p.researchResults[final.resultId].dimensions.length, 7);
  assert.equal(state.p.researchTasks[failed.id].status, 'failed'); assert.equal(state.p.researchTasks[retry.id].status, 'failed');
});

test('partial raw extraction cannot become a recovered complete pass; manual retry uses the normal whole-input pipeline', async t => {
  const dispatched = [];
  const f = await fixture(t, { texts: ['First engineering source.', 'Second engineering source.'], generate: async input => {
    dispatched.push(input.materials); const data = dimensionFixture(input.materials);
    if (dispatched.length === 1) {
      data.papers.pop();
      data.sections[0].items.push({ text: '无依据的肯定句。', status: 'reported', citations: [] });
    }
    return envelope(JSON.stringify(data));
  } });
  const failed = await done(f, await start(f, 'revise', { text: '整理全部材料' })); assert.equal(failed.status, 'failed');
  const retried = await done(f, await start(f, 'revise', { text: '整理全部材料', retryTaskId: failed.id }));
  assert.equal(retried.status, 'completed', retried.error); assert.equal(dispatched.length, 2); assert.equal(dispatched[1].length, 2);
  assert.equal(retried.toolRuns[0].name, 'model.generate'); assert.equal(retried.paperBatchRecords.length, 0);
  assert.equal((await f.store.read(s => s.projects[f.p.id].researchEvents)).filter(e => e.type === 'paper_extraction_recovered').length, 0);
});

test('explicit local output revalidation retains failed history, excludes note, respects newer draft/adoption, and never calls model', async t => {
  let calls = 0;
  const note = '\n``**说明**：这段额外说明不属于结构化科研成果。';
  const f = await fixture(t, { generate: async input => { calls++; return envelope(JSON.stringify(dimensionFixture(input.materials)) + note); } });
  // Simulate the pre-v0.9 strict transport that produced this historical failure.
  const legacyInvoke = f.service.invokeModel.bind(f.service);
  f.service.invokeModel = async (...args) => { const result = await legacyInvoke(...args); return { ...result, text: await f.store.read(s => s.modelCalls.at(-1).outputText) }; };
  const original = await done(f, await start(f, 'revise', { text: '解释已有资料' }));
  assert.equal(original.status, 'failed'); assert.equal(original.errorCode, 'model_structure');
  const before = await f.store.read(s => ({ task: s.projects[f.p.id].researchTasks[original.id], calls: s.modelCalls }));
  const strict = await done(f, await f.service.revalidateSavedOutput(f.p.id, original.id, randomUUID()));
  assert.equal(strict.status, 'failed'); assert.equal(strict.errorCode, 'model_structure'); assert.equal(calls, 1);
  const chosen = await f.store.update(s => {
    const p = s.projects[f.p.id], a = p.artifacts[f.a.id]; a.draft.version++; a.draft.notes.understanding = '原模型运行之后补充的个人认识。';
    const question = kernelCommand(s, p.id, 'create-question', { text: '另一个已经采用的研究问题', baseStateVersion: p.researchKernel.version }, 'new-question-before-revalidation');
    kernelCommand(s, p.id, 'decide-question', { itemId: question.id, itemRevisionId: question.revisionId, choice: 'adopt', baseStateVersion: p.researchKernel.version }, 'adopt-before-revalidation');
    return p.researchKernel.currentQuestion;
  });
  const receipt = randomUUID(), options = { extractLeadingJson: true };
  const started = await Promise.all([f.service.revalidateSavedOutput(f.p.id, original.id, receipt, options), f.service.revalidateSavedOutput(f.p.id, original.id, receipt, options)]);
  assert.equal(started[0].taskId, started[1].taskId);
  const recovered = await done(f, started[0]); assert.equal(recovered.status, 'completed', recovered.error); assert.equal(recovered.staleInput, true);
  assert.equal(recovered.input.revisionId, original.input.revisionId); assert.equal(recovered.executionMode, 'local_revalidation');
  assert.equal(recovered.calls.length, 0); assert.equal(recovered.cost.amount, 0); assert.equal(recovered.provenance.modelCalled, false);
  assert.equal(recovered.provenance.excludedOutput, note); assert.equal(recovered.provenance.excludedOutputIncludedInArtifact, false);
  const after = await f.store.read(s => ({ p: s.projects[f.p.id], calls: s.modelCalls }));
  assert.deepEqual(after.calls, before.calls); assert.deepEqual(after.p.researchTasks[original.id], before.task); assert.equal(calls, 1);
  assert.equal(Object.keys(after.p.researchResults).length, 1); assert.equal(after.p.artifacts[f.a.id].draft.resultId, null);
  assert.equal(after.p.artifacts[f.a.id].draft.notes.understanding, '原模型运行之后补充的个人认识。'); assert.deepEqual(after.p.researchKernel.currentQuestion, chosen);
  const result = after.p.researchResults[recovered.resultId]; assert.equal(result.dimensions.length, 7); assert.equal(result.adoptionContext.currentQuestion, null);
  assert.ok(result.blocks.every(b => !b.text.includes('这段额外说明')));
  assert.equal(after.p.researchEvents.filter(e => e.type === 'saved_output_revalidated').length, 1);
});

test('local saved-output revalidation preserves science failures and refuses extra structured payloads without model fallback', async t => {
  let calls = 0;
  const f = await fixture(t, { generate: async input => {
    calls++; const data = dimensionFixture(input.materials); data.sections[0].items[0].citations = [];
    return envelope(JSON.stringify(data) + '\n说明：尾注');
  } });
  const failed = await done(f, await start(f, 'revise'));
  const checked = await done(f, await f.service.revalidateSavedOutput(f.p.id, failed.id, randomUUID(), { extractLeadingJson: true }));
  assert.equal(checked.status, 'failed'); assert.equal(checked.errorCode, 'unsupported_claim'); assert.equal(checked.errorDetails.sectionId, 'overview');
  assert.equal(checked.calls.length, 0); assert.equal(checked.revalidation.excludedOutput, '\n说明：尾注'); assert.equal(calls, 1);
  assert.equal(Object.keys((await f.store.read()).projects[f.p.id].researchResults).length, 0);
});


test('analysis, comparison and research questions share academic instructions while retaining exact outputs and sources',async t=>{
  const seen=[],raw=[];
  const f=await fixture(t,{generate:async input=>{seen.push(input);const result=await defaultGenerate(input);raw.push(result.text);return result;}});
  for(const mode of ['revise','compare','ask']){
    const task=await done(f,await start(f,mode));assert.equal(task.status,'completed',task.error);
  }
  assert.equal(seen.length,3,'Common language rules do not add a polishing pass');
  assert.ok(seen.every(input=>input.instruction.startsWith(researchLanguageRules+'\n')));
  assert.ok(seen.every(input=>input.materials[0].text==='This test record reports an association.'));
  const calls=await f.store.read(s=>s.modelCalls);
  assert.deepEqual(calls.map(c=>c.outputText),raw);
  assert.ok(calls.every(c=>c.languageStandard===RESEARCH_LANGUAGE_VERSION&&c.promptVersion.endsWith(RESEARCH_LANGUAGE_VERSION)));
  const p=await f.store.read(s=>s.projects[f.p.id]);
  assert.equal(p.accesses[f.a.draft.sourceAccessIds[0]].text,'This test record reports an association.');
});
