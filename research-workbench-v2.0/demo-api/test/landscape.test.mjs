import test from 'node:test';
import assert from 'node:assert/strict';
import { validateResearchOutput } from '../src/research.mjs';
import { materialCoverage, landscapeInstructions } from '../../shared/domain-landscape.mjs';
import { dimensionFixture } from './landscape-fixture.mjs';
const materials = [
  { ref: 'R1', accessId: 'a1', sourceId: 's1', pmid: '1', year: '2001', level: 'abstract', text: 'An observational study described an association in adults.' },
  { ref: 'R2', accessId: 'a2', sourceId: 's2', pmid: '2', year: '2026', level: 'abstract', text: 'A trial in children found no difference. No adults were enrolled.' },
];
const validate = d => validateResearchOutput(JSON.stringify(d), 'landscape', materials, { requirePaperNotes: true, requireDimensions: true });

test('all seven dimensions survive with explicit insufficient evidence; no fabricated completeness', () => {
  const data = dimensionFixture(materials), result = validate(data);
  assert.deepEqual(result.dimensions.map(d => d.id), ['history', 'branches', 'hotspots', 'disagreements', 'methods', 'gaps', 'maturity']);
  assert.equal(result.dimensions[0].coverage, 'insufficient');
  assert.equal(result.blocks.find(b => b.id === 'research-history-heading').dimensionLimitation, data.sections[1].limitation);
  for (const n of result.paperNotes) assert.equal(Object.keys(n.fields).length, 5);
  assert.equal(result.paperNotes[1].fields.methods.quotes[0], materials[1].text);
});
test('missing dimensions, missing comparisons or empty boundaries cannot silently become complete briefs', () => {
  for (const mutate of [d => d.sections.splice(1, 1), d => delete d.sections[1].comparison, d => d.sections[1].limitation = '', d => d.framework = 'old']) {
    const d = dimensionFixture(materials); mutate(d); assert.throws(() => validate(d), e => ['model_structure', 'incomplete_dimensions'].includes(e.code));
  }
});
test('insufficient-evidence label cannot conceal a reported conclusion or an unsupported inference', () => {
  const d = dimensionFixture(materials); d.sections[1].items[0] = { text: '存在确定的历史演进。', status: 'reported', citations: [{ ref: 'R1', passage: 'P1' }] };
  assert.throws(() => validate(d), e => e.code === 'inconsistent_coverage');
  d.sections[1].coverage = 'partial'; d.sections[1].comparison = { text: '据此推断……', status: 'inference', citations: [] };
  assert.throws(() => validate(d), e => e.code === 'unsupported_claim');
});
test('cross-paper interpretation keeps both actual excerpts and differs from a directly reported fact', () => {
  const d = dimensionFixture(materials), section = d.sections.find(s => s.id === 'disagreements');
  section.coverage = 'partial'; section.items = [{ text: '成人观察研究报告关联，儿童试验未发现差异。', status: 'reported', citations: [{ ref: 'R1', passage: 'P1' }, { ref: 'R2', passage: 'P1' }] }];
  section.comparison = { text: '对象和设计不同，不能直接视为互相推翻。', status: 'inference', citations: [{ ref: 'R1', passage: 'P1' }, { ref: 'R2', passage: 'P1' }] };
  const result = validate(d), block = result.blocks.find(b => b.id === 'research-disagreements-1');
  assert.equal(block.informationStatus, 'inference'); assert.equal(block.analysisRole, 'comparison');
  assert.deepEqual(result.citations.filter(c => c.blockId === block.id).map(c => c.quote), materials.map(m => m.text));
});
test('each paper needs object, method, finding, relevance and unreported fields with local anchors', () => {
  for (const mutate of [d => delete d.papers[1].fields.methods, d => d.papers[1].fields.methods.passages = ['P99'], d => d.papers[1].fields.findings.passages = []]) {
    const d = dimensionFixture(materials); mutate(d); assert.throws(() => validate(d), e => ['incomplete_paper_coverage', 'invalid_citation'].includes(e.code));
  }
  const d = dimensionFixture(materials); d.papers[1].fields.methods = { text: '摘要未报告具体方法。', status: 'unknown', passages: [] };
  assert.deepEqual(validate(d).paperNotes[1].fields.methods.quotes, []);
});
test('dimension depth is not reduced to one or two bullets or eight items', () => {
  const d = dimensionFixture(materials); d.sections[2].items = Array.from({ length: 12 }, (_, i) => ({ text: `不同子问题 ${i}。`, status: 'reported', citations: [{ ref: 'R1', passage: 'P1' }] }));
  assert.equal(validate(d).blocks.filter(b => b.id.startsWith('research-branches-') && b.type !== 'heading').length, 13);
  assert.doesNotMatch(landscapeInstructions(), /每节1至2|建议60字/);
});
test('coverage is computed from selected metadata, preserving title-only and unknown dates', () => {
  const c = materialCoverage([...materials, { level: 'title', year: null, pmid: null }]);
  assert.deepEqual(c, { selectedCount: 3, pubmedCount: 2, minYear: '2001', maxYear: '2026', unknownYearCount: 1, levels: { abstract: 2, title: 1 } });
});
test('legacy six-section outputs remain readable without being accepted as a new dimensional analysis', () => {
  const old = { sections: ['overview', 'branches', 'findings', 'disagreements', 'unknowns', 'next'].map(id => ({ id, items: [{ text: '旧结果原文。', status: 'unknown', citations: [] }] })) };
  assert.equal(validateResearchOutput(JSON.stringify(old), 'landscape', materials).blocks.length, 12);
  assert.throws(() => validate(old), e => e.code === 'incomplete_dimensions');
});
