// Optional, bounded presentation of a cited statement. Never an alternative
// evidence model: old blocks remain readable and citations stay on the block.
export const DOMAIN_VISUAL_KINDS = ['finding', 'change', 'comparison'];
const shortText = (v, n) => typeof v === 'string' && v.trim() && v.length <= n;
export function domainVisual(value, status) {
  if (!value || !DOMAIN_VISUAL_KINDS.includes(value.kind) || !shortText(value.label, 40) || !shortText(value.summary, 240)) return null;
  if (!Array.isArray(value.nodes) || value.nodes.length < 2 || value.nodes.length > 4 || !value.nodes.every(n => n && shortText(n.label, 40) && shortText(n.text, 160))) return null;
  if (value.kind === 'change' && (value.nodes.length !== 2 || !['reported', 'inference'].includes(status))) return null;
  const extra = {};
  for (const [key, limit] of [['title',50],['takeaway',180],['boundary',180]]) if (shortText(value[key],limit)) extra[key] = value[key].trim();
  if (['finding','branches','comparison','sequence'].includes(value.layout) && (value.layout !== 'sequence' || ['reported','inference'].includes(status))) extra.layout = value.layout;
  return { kind: value.kind, label: value.label.trim(), summary: value.summary.trim(), nodes: value.nodes.map(n => ({ label: n.label.trim(), text: n.text.trim() })), ...extra };
}
// Remove only inline R/P reference notation; keep all scientific qualifiers.
export function displayText(text = '') {
  return text.replace(/[（(](?:R\d+[^()（）]*[）)])/g, '').trim();
}
export function resultTitle(block) {
  return displayText(block?.headline || block?.text?.split(/[。！？\n]/)[0] || '尚待补充的研究认识');
}
export function resultExcerpt(block) {
  const text = displayText(block?.text);
  return text.match(/[^。！？\n]+[。！？]?/)?.[0] || text;
}
export function domainSections(result) {
  const sections = [];
  for (const block of result?.blocks ?? []) {
    if (block.type === 'heading') sections.push({ id: block.id.replace(/^research-/, '').replace(/-heading$/, ''), heading: block, items: [] });
    else if (sections.length) sections.at(-1).items.push(block);
  }
  return sections;
}
export const domainReviewMethod = `领域理解首先围绕当前领域读取历年综述的内容，按核心问题、认识转折、分支与未决问题决定补充哪些材料，不预设固定篇数或每年篇数。初次范围建议默认以综述为入口（Review[pt] 或 Systematic Review[pt]），不默认限近年；用户指定代表性原始研究、后续验证或自定义范围时遵从该选择。沿具体内容缺口补充代表性研究；实际支持的检索能力是 PubMed 题名摘要检索，不能声称已追踪未访问的参考文献。篇数与排序样本不能裁决热度、成熟度或历史转折。扩大范围保留核心研究对象，并说明放宽的条件；不为凑数量换题。`;
export function domainSupplementPrompt({ goal, focus, kinds, expanded }) {
  return `围绕当前领域“${goal}”，补充关于“${focus}”的材料。准备获取：${kinds.join('、')}。${expanded ? '保留该领域核心对象，适当放宽次要限制并说明与当前问题的关系。' : '保持当前研究对象，优先弥补这项具体内容缺口。'}构建可编辑的 PubMed 检索式，按内容覆盖决定后续批次，不以固定篇数代表完成，不自动限定近年。不编造已读取的综述或参考文献。`;
}
