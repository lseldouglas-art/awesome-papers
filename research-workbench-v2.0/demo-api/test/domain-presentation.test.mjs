import test from 'node:test';
import assert from 'node:assert/strict';
import { domainVisual, domainSections, resultExcerpt, domainSupplementPrompt } from '../../shared/domain-presentation.mjs';
import { validateResearchOutput } from '../src/research.mjs';
import { createPubmed } from '../src/pubmed.mjs';
import { dimensionFixture } from './landscape-fixture.mjs';

const material = { ref:'R1', accessId:'a1', sourceId:'s1', level:'abstract', year:'2026', text:'Engineering observation. The historical transition is unknown.' };
const visual = { kind:'comparison', label:'具体研究问题', summary:'结果适用条件不同，不能互相推翻。', nodes:[{ label:'成人观察研究', text:'本次材料报告关联。' }, { label:'儿童试验', text:'结果不明确。' }] };
test('bounded diagrams preserve block provenance; malformed visuals fall back without losing research', () => {
  const data = dimensionFixture([material]); data.sections[2].items[0].visual = visual;
  const parse = () => validateResearchOutput(JSON.stringify(data), 'landscape', [material], { requireDimensions:true, requirePaperNotes:true });
  const result = parse(), block = result.blocks.find(b => b.id === 'research-branches-0');
  assert.deepEqual(block.visual, visual);
  assert.equal(result.citations.find(c => c.blockId === block.id).quote, material.text);
  data.sections[2].items[0].visual.kind = '<script>';
  const fallback = parse(); assert.equal(fallback.blocks.find(b => b.id === block.id).visual, undefined);
  assert.equal(fallback.blocks.find(b => b.id === block.id).text, block.text);
  assert.deepEqual(fallback.citations, result.citations);
});
test('unknown materials cannot draw a factual historical transition or unbounded diagram', () => {
  assert.equal(domainVisual({ ...visual, kind:'change' }, 'unknown'), null);
  assert.equal(domainVisual({ ...visual, nodes:Array(5).fill(visual.nodes[0]) }, 'reported'), null);
  assert.equal(domainVisual({ ...visual, nodes:[{ label:'A' }, { label:'B' }] }, 'reported'), null);
});
test('legacy projection keeps limitations, distinguishes history from publication dates and never changes saved content', () => {
  const result = { blocks:[{ id:'research-history-heading', type:'heading', text:'历史', dimensionCoverage:'insufficient' }, { id:'research-history-0', text:'尚不能判断历史转折（R1 P1）；不能认定未实施。后续需补查。', informationStatus:'unknown' }] };
  const original = structuredClone(result), sections = domainSections(result);
  assert.equal(sections[0].id, 'history'); assert.equal(sections[0].heading.dimensionCoverage, 'insufficient');
  assert.equal(resultExcerpt(sections[0].items[0]), '尚不能判断历史转折；不能认定未实施。');
  assert.deepEqual(result, original);
});
test('supplement request preserves the selected research object and the exact unresolved question', () => {
  const prompt = domainSupplementPrompt({ goal:'胃癌', focus:'观察顺序是否影响结果？', kinds:['历年综述','代表性原始研究'], expanded:true });
  assert.match(prompt, /胃癌/); assert.match(prompt, /观察顺序是否影响结果/); assert.match(prompt, /保留该领域核心对象/); assert.match(prompt, /按内容覆盖/);
});
test('next retrieval batch advances both database sorts and keeps zero-based cursor in receipt', async () => {
  const calls = [], pubmed = createPubmed({ fetchImpl:async url => {
    const u = new URL(url); calls.push(u);
    return new Response(JSON.stringify({ esearchresult:{ count:'60', idlist:[], querytranslation:'gastric review' } }));
  } });
  const result = await pubmed.search('gastric review', { offset:20 });
  assert.equal(result.offset, 20); assert.equal(calls.length, 2);
  assert(calls.every(u => u.searchParams.get('retstart') === '20'));
  assert.match(result.coverage, /21–40/);
  await assert.rejects(pubmed.search('gastric review', { offset:-1 }), e => e.code === 'invalid_query');
});
