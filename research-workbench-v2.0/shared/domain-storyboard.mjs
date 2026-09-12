import { displayText, domainSections, domainVisual, resultTitle } from './domain-presentation.mjs';

// A reading projection, never a replacement for the stored scientific report.
// Legacy diagrams extract explicit values/clauses; they do not infer missing events.
export const sentences = text => displayText(text || '').split(/(?<=[。！？])|\n/).map(s => s.trim()).filter(Boolean);
const clean = text => displayText(text || '').replace(/[；。]$/, '').trim();
export function evidenceForBlock(block, result) {
  const ids = new Set((result.citations || []).filter(c => c.blockId === block?.id).map(c => c.sourceId));
  return (result.paperNotes || []).filter(n => ids.has(n.sourceId));
}
export function pairedObservation(note) {
  const fields = note?.fields, text = fields?.findings?.text || '';
  const match = text.match(/LCI较WLI.*?中位\s*(\d+(?:\.\d+)?)\s*vs\s*(\d+(?:\.\d+)?)/i);
  const quotes = (fields?.findings?.quotes || []).join(' ');
  const raw = quotes.match(/LCI reduced false-positive.*?median\s*(\d+(?:\.\d+)?)\s*vs\.?\s*(\d+(?:\.\d+)?)/is);
  // Check orientation against the actual excerpt, not just a number near "vs".
  if (!match || !raw || match[1] !== raw[1] || match[2] !== raw[2] || fields.findings.status !== 'reported') return null;
  if (!/观察顺序固定/.test(text) || !/sequence was fixed/.test(quotes)) return null;
  return { kind:'paired', note, labels:['WLI', 'LCI'], names:['白光成像', '联动成像'], values:[Number(match[2]), Number(match[1])], unit:'次', metric:'AI 误报次数中位数', methods:fields.methods.text, finding:'后看 LCI 时，AI 误报更少', boundary:'观察顺序固定，成像方式与先后顺序的作用尚未分开。', question:'LCI 减少 AI 误报，成像方式与观察顺序各起什么作用？' };
}
export function cohortObservation(note) {
  const text = note?.fields?.methods?.text || '';
  const m = text.match(/(约?\s*\d[\d, ]*)例与(\d[\d, ]*)对照/);
  const q = (note?.fields?.methods?.quotes || []).join(' ');
  if (!m || !/cases.*controls/is.test(q)) return null;
  const values = m.slice(1).map(s => s.replace(/[^\d]/g, ''));
  if (!values.every(s => q.replace(/[\s,]/g, '').includes(s))) return null;
  return { kind:'cohort', note, values, approximate:m[1].includes('约'), labels:['病例', '对照'], findings:note.fields.findings.text.split('；').slice(0,3).map(clean) };
}
export function contentGroups(block) {
  const text = displayText(block.text || '');
  const groups = [...text.matchAll(/(?:^|。)([^：。]{2,18})方面：([^。]+)/g)].map(m => ({ label:m[1], text:clean(m[2]) }));
  if (groups.length >= 2) return groups.slice(0,3);
  return [];
}
export function mechanismPaths(block) {
  if (!['reported','inference'].includes(block.informationStatus)) return [];
  return displayText(block.text || '').split(/[；。]/).map(s => s.replace(/^[^：]{1,12}：/, '').trim()).map(s => {
    const m = s.match(/^(.{2,38}?)经(.{2,40}?)(促进|驱动|上调|抑制)(.{2,35})$/);
    return m ? { nodes:[m[1],m[2],m[4]], relation:m[3] } : null;
  }).filter(Boolean).slice(0,3);
}
export function cardStory(block, result, section) {
  const notes = evidenceForBlock(block, result), visual = domainVisual(block.visual, block.informationStatus);
  const pair = notes.map(pairedObservation).find(Boolean), cohort = notes.map(cohortObservation).find(Boolean);
  const groups = contentGroups(block), paths = mechanismPaths(block);
  let diagram = visual ? { ...visual, kind:'structured', layout:visual.layout || (visual.kind === 'change' ? 'sequence' : visual.kind) } : pair || cohort || (groups.length ? { kind:'branches', groups } : paths.length ? { kind:'paths', paths } : { kind:'findings', nodes:notes.slice(0,3).map(n => ({ label:n.fields?.subject?.text || '', text:n.fields?.findings?.text || '', note:n })).filter(n => n.label && n.text) });
  if (!diagram.nodes?.length && diagram.kind === 'findings') diagram.nodes = sentences(block.text).slice(0,3).map(text => ({ label:'', text }));
  const topic = resultTitle(block).split('分支')[0];
  const label = visual?.label || (pair ? '成像方式与 AI 检测' : topic.length <= 20 ? topic : section?.heading?.text || '研究认识');
  const title = visual?.title || (pair ? '怎样减少 AI 的误报？' : cohort ? '哪些因素与发病风险相关？' : groups.length ? '不同机制如何影响肿瘤？' : /微环境/.test(topic) ? '细胞状态怎样改变治疗响应？' : label === topic ? topic : resultTitle(block));
  const summary = visual?.takeaway || (pair ? pair.finding : cohort ? cohort.note.fields.relevance.text : sentences(block.text).findLast(s => /共同|表明|提示|意味着|解决的限制/.test(s)) || notes[0]?.fields?.relevance?.text || sentences(block.text)[0] || resultTitle(block));
  const boundary = visual?.boundary || (pair ? pair.boundary : cohort ? cohort.note.fields.unreported.text : notes[0]?.fields?.unreported?.text || section?.heading?.dimensionLimitation || '具体适用范围见原文与完整论证。');
  return { block, section, notes, diagram, label, title, summary:displayText(summary), boundary:displayText(boundary) };
}
export function domainStoryboard(result) {
  const sections = domainSections(result), section = id => sections.find(s => s.id === id);
  const items = id => (section(id)?.items || []).filter(b => b.analysisRole !== 'comparison');
  const branches = items('branches').length ? items('branches') : items('findings');
  const stories = branches.map(b => cardStory(b,result,section('branches') || section('findings')));
  // Keep a directly measured clinical result on the first spread when available.
  const paired = stories.find(s => s.diagram.kind === 'paired');
  const featured = stories.slice(0,3);
  if (paired && !featured.includes(paired) && featured.length === 3 && featured[2].diagram.kind !== 'structured') featured[2] = paired;
  const other = stories.filter(s => !featured.includes(s));
  const focus = (result.paperNotes || []).map(pairedObservation).find(Boolean);
  return { sections, section, items, stories, featured, other, focus,
    hotspots:items('hotspots').map(b => cardStory(b,result,section('hotspots'))),
    methods:items('methods').map(b => cardStory(b,result,section('methods'))),
    questions:[...items('disagreements'),...items('gaps')],
    history:section('history'), summary:section('branches')?.items.find(b => b.analysisRole === 'comparison') };
}
