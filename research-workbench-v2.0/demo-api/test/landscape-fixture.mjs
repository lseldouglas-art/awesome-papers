import { LANDSCAPE_FRAMEWORK, LANDSCAPE_SECTIONS, DOMAIN_DIMENSIONS, PAPER_FIELDS } from '../../shared/domain-landscape.mjs';

// Engineering fixture only. Unknown dimensions are explicit instead of made-up findings.
export function dimensionFixture(materials) {
  const reported = { text: '测试摘要报告一项观察，不能外推为领域结论。', status: 'reported', citations: [{ ref: materials[0]?.ref, accessId: materials[0]?.accessId, passage: 'P1' }] };
  const unknown = { text: '这批测试材料不足以说明这一维度，需要补充相应材料。', status: 'unknown', citations: [] };
  return { framework: LANDSCAPE_FRAMEWORK,
    papers: materials.map(m => ({ ref: m.ref, fields: Object.fromEntries(Object.keys(PAPER_FIELDS).map(key => [key, { text: key === 'unreported' ? '摘要未报告独立验证。' : '测试摘要中的研究观察。', status: key === 'unreported' ? 'unknown' : key === 'relevance' ? 'inference' : 'reported', passages: key === 'unreported' ? [] : ['P1'] }])) })),
    sections: LANDSCAPE_SECTIONS.map(d => ({ id: d.id, items: [structuredClone(d.id === 'overview' || d.id === 'branches' ? reported : unknown)],
      ...(DOMAIN_DIMENSIONS.some(x => x.id === d.id) ? { coverage: d.id === 'branches' ? 'partial' : 'insufficient', limitation: '只有一组测试观察，未覆盖此维度的完整证据。', comparison: structuredClone(unknown) } : {}) })) };
}
