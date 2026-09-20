import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPaperBatch, learnedPaperCallSize } from '../src/paper-extraction.mjs';
import { planMaterialBatches, recoverPaperBatch, combinePaperCoverage, reusablePaperExtractions, resolveMaterialCitation, validatePaperBatchOutput } from '../src/workflows.mjs';
import { dimensionFixture } from './landscape-fixture.mjs';
const materials = Array.from({ length: 4 }, (_, i) => ({ ref: `R${i + 1}`, accessId: `a${i}`, sourceId: `s${i}`, level: 'abstract', text: 'Observed association. A second finding.' }));
const batch = planMaterialBatches(materials).batches[0];
const output = (scope, id = 'physical-call') => ({ text: JSON.stringify({ framework: 'domain-landscape-v1', papers: dimensionFixture(scope).papers }), provenance: { requestId: id } });
const incomplete = (text, finishReason = 'length') => Object.assign(new Error('incomplete'), {
  code: 'model_incomplete_response', callId: 'failed-call', responseSnapshot: { text, finishReason, usage: { total_tokens: 50 } },
});

test('compact truncation retains complete items, not nested fake items or a cut final record', () => {
  const text = output(materials).text, cut = text.indexOf('{"ref":"R3"');
  const recovered = recoverPaperBatch(text.slice(0, cut) + '{"ref":"R3","fields":', batch);
  assert.deepEqual(recovered.papers.map(p => p.ref), ['R1', 'R2']);
  const one = dimensionFixture([materials[0]]).papers[0];
  one.fields.findings.text = 'Data includes {"ref":"R4","fields":{}} in a literal string.';
  assert.deepEqual(recoverPaperBatch(JSON.stringify({ framework: 'domain-landscape-v1', papers: [one] }).slice(0, -2), batch).papers.map(p => p.ref), ['R1']);
});

test('capacity exhaustion halves only remaining work, retains original call identity and complete coverage', async () => {
  const calls = [], retained = [], limits = [];
  const result = await extractPaperBatch({ batch, retain: async r => retained.push(r), onLimit: async l => limits.push(l),
    invoke: async unit => {
      calls.push(unit.materials.map(m => m.ref));
      if (calls.length === 1) throw incomplete(output([materials[0]]).text.slice(0, -2) + ',{"ref":"R2"');
      return output(unit.materials);
    } });
  assert.deepEqual(calls, [['R1', 'R2', 'R3', 'R4'], ['R2', 'R3'], ['R4']]);
  assert.deepEqual(limits, [2]);
  assert.equal(retained[0].recovery.sourceCallId, 'failed-call');
  assert.equal(combinePaperCoverage([result], materials).coverage.complete, true);
  assert.equal(reusablePaperExtractions(retained, materials).accessIds.size, 4);
});

test('transport interruption retains validated papers but waits for explicit retry, not automatic resend', async () => {
  const saved = []; let calls = 0;
  await assert.rejects(extractPaperBatch({ batch, retain: async r => saved.push(r), invoke: async () => {
    calls++; throw incomplete(output([materials[0]]).text.slice(0, -2), null);
  } }), e => e.code === 'model_incomplete_response');
  assert.equal(calls, 1); assert.equal(reusablePaperExtractions(saved, materials).accessIds.size, 1);
  assert.equal(learnedPaperCallSize(50, [{ errorCode: 'model_incomplete_response', segments: Array(50).fill({}) }]), 25);
});

test('failed repair preserves earlier results; cancellation discards late output', async () => {
  const saved = []; let calls = 0;
  await assert.rejects(extractPaperBatch({ batch, retain: async r => saved.push(r), invoke: async () => {
    calls++; if (calls === 1) return output([materials[0]]);
    throw Object.assign(new Error('unavailable'), { code: 'model_unavailable' });
  } }), e => e.code === 'model_unavailable');
  assert.equal(saved.length, 1); assert.equal(saved[0].result.papers[0].ref, 'R1');
  const controller = new AbortController(); let writes = 0;
  await assert.rejects(extractPaperBatch({ batch, signal: controller.signal, retain: async () => writes++, invoke: async () => {
    controller.abort(); return output(materials);
  } }), e => e.name === 'AbortError');
  assert.equal(writes, 0);
});

test('legacy passage quote requires exact unique text and cannot rescue unknown identifiers, ellipses or another source', () => {
  const found = resolveMaterialCitation({ ref: 'R1', passage: 'Observed association.' }, materials);
  assert.equal(found.quote, 'Observed association.'); assert.equal(found.locatorAudit.resolvedBy, 'unique_exact_legacy_excerpt');
  for (const citation of [{ ref: 'R1', passage: 'P999', quote: 'Observed association.' }, { ref: 'R1', passage: 'Observed...finding.' },
    { ref: 'R5', passage: 'Observed association.' }]) assert.throws(() => resolveMaterialCitation(citation, materials), e => e.code === 'invalid_citation');
  assert.throws(() => resolveMaterialCitation({ ref: 'R1', passage: 'Observed association.' }, [{ ...materials[0], text: 'Observed association. Observed association.' }]), e => e.code === 'invalid_citation');
});

test('long-paper segment reuse ignores duplicate parent and recovered checkpoints without hiding gaps', () => {
  const material = { ...materials[0], text: 'First reported finding. Second reported finding.' }, split = 24;
  const records = [[0, split], [split, material.text.length]].flatMap(([start, end], i) => {
    const unit = { ...batch, id: `segment-${i}`, materials: [{ ...material, text: material.text.slice(start, end) }],
      segments: [{ accessId: material.accessId, sourceId: material.sourceId, start, end, totalLength: material.text.length }] };
    const result = validatePaperBatchOutput(output(unit.materials).text, unit);
    return ['child', 'parent'].map(name => ({ batchId: `${name}-${i}`, status: 'completed', result }));
  });
  assert.equal(reusablePaperExtractions(records, [material]).accessIds.size, 1);
  assert.equal(reusablePaperExtractions(records.slice(0, 2), [material]).accessIds.size, 0);
});
