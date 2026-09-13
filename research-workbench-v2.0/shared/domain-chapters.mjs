import {domainSections, displayText, resultTitle} from './domain-presentation.mjs';

// Extractive reading only. Every displayed phrase retains its original block;
// these layouts neither regenerate the report nor rank the underlying evidence.
export const chapterKinds={overview:'map',history:'coverage',branches:'studies',hotspots:'focus',disagreements:'comparison',methods:'methods',gaps:'gaps',maturity:'evidence',next:'directions'};
export const chapterNames={overview:'领域概览',history:'领域历史',branches:'主要分支与发现',hotspots:'当前热点',disagreements:'关键争议',methods:'技术与方法演进',gaps:'证据空缺与未知',maturity:'研究成熟度',next:'后续研究方向'};
export function prose(text='') {
  return displayText(text).replace(/\bR\d+\s+P\d+(?:[–—-]\d+)?/g,'').replace(/[（(]\s*[）)]/g,'').trim();
}
export function clauses(text='') {
  return prose(text).split(/[；。\n]/).map(t=>t.trim()).filter(Boolean);
}
export function excerpt(text='',max=72) {
  const value=prose(text);
  if(value.length<=max)return value;
  // Display a visibly marked excerpt, never silently delete a negation or limit.
  const boundary=value.slice(0,max).search(/[^，；。]*$/);
  return `${value.slice(0,boundary>max/2?boundary:max).trim()}…`;
}
export function topic(block) {
  const title=prose(resultTitle(block));
  const colon=title.search(/[：:]/);
  const branch=title.indexOf('分支');
  return excerpt(colon>0&&colon<28?title.slice(0,colon):branch>0&&branch<28?title.slice(0,branch):title,32);
}
export function conceptTitle(block) {
  const title=prose(resultTitle(block));
  if(/^本次材料未报告|^本次材料未覆盖/.test(title))return '材料覆盖';
  const words=title.split(/是否|的效能评价|是本次|是当前|等新型|研究活跃|存在|中维生素/)[0];
  return excerpt(words,28);
}
export function comparisonConditions(text='') {
  const endpoint=text.match(/结局同为([^、，；]+)/)?.[1],method=text.match(/方法同为([^，；]+)/)?.[1];
  return endpoint&&method&&text.includes('暴露因素不同')?[['结局',endpoint],['方法',method],['暴露','因素不同']]:[];
}
export function chapterForBlock(result,id) {
  return domainSections(result).find(s=>s.heading.id===id||s.items.some(b=>b.id===id));
}
export function chapterView(result) {
  return domainSections(result).map(s=>{const findings=s.items.filter(b=>b.analysisRole!=='comparison');return {...s,kind:chapterKinds[s.id]??'focus',name:chapterNames[s.id]??s.heading.text,summary:s.items.find(b=>b.analysisRole==='comparison')??s.items[0],findings:findings.length?findings:s.items};});
}
export function overviewNodes(section,sections) {
  const block=section.items.find(b=>/主要研究问题包括|核心问题可概括为/.test(b.text))??section.items[0];
  const text=prose(block?.text);
  const list=text.match(/(?:主要研究问题包括|核心问题可概括为)[：:]([^。]+)/)?.[1];
  const nodes=list?.split(/、|以及|，以及/).map(t=>t.trim()).filter(Boolean)??[];
  if(nodes.length>=2&&nodes.length<=8)return nodes.map(text=>({text,blockId:block.id}));
  return (sections.find(s=>s.id==='branches')?.findings??section.items).map(b=>({text:topic(b),blockId:b.id}));
}
export function methodRows(section) {
  const block=section.summary;
  const quoted=[...prose(block?.text).matchAll(/(?:^|[；。])([^；。]+?)回答[“「]([^”」]+)[”」]/g)];
  if(quoted.length>=2)return quoted.map(m=>({label:m[1].trim(),finding:m[2].trim(),blockId:block.id}));
  return section.findings.map(b=>({label:topic(b),finding:clauses(b.text).find(t=>/解决的限制|扩展|使|回答/.test(t))??clauses(b.text)[0]??'',blockId:b.id}));
}
export function evidenceRows(section) {
  const rows=clauses(section.summary?.text).map(text=>{const m=text.match(/^([^：]{2,20})：(.+)$/);return m?{label:m[1],finding:m[2],blockId:section.summary.id}:null;}).filter(Boolean);
  return rows.length>=2?rows:section.findings.map(b=>({label:topic(b),finding:b.headline??clauses(b.text)[0],blockId:b.id}));
}
export function maturityFindings(section) {
  return section.findings.map(b => {
    const nodes = b.visual?.nodes?.filter(n => n.text);
    const evidence = nodes?.length ? nodes.map(n => ({label:prose(n.label),text:prose(n.text)})) : prose(b.text).split(/[；。]\s*/).filter(Boolean).map(text => {
      const match = text.match(/^([^：]{2,16}(?:层面|层))：(.+)$/);
      return match ? {label:match[1],text:match[2]} : {text};
    });
    return {blockId:b.id, finding:prose(b.headline || b.visual?.takeaway || b.text), evidence, boundary:prose(b.visual?.boundary || '')};
  });
}
export function directions(section) {
  return section.items.flatMap(b=>{
    const items=prose(b.text).split(/（\d+）|\(\d+\)/).filter(t=>/若关注|若需|若希望/.test(t));
    return (items.length?items:[prose(b.text)]).map(text=>{
      const m=text.match(/若(?:关注|需|希望)([^，：；。]+)[，：](.+)/);
      return {label:m?m[1]:prose(b.headline || '继续了解这个问题').replace(/^下一步可选择[：:]\s*/,''),finding:prose(m?m[2]:text),blockId:b.id};
    });
  });
}
export function pairedClauses(block) {
  const text=prose(block?.text),explicit=text.match(/一方证据[：:](.+?)；另一方[：:](.+?)(?:。|$)/);
  if(explicit)return {left:explicit[1],right:explicit[2],relation:'两种解释',limit:clauses(text).find(t=>/并非|外推|尚无/.test(t))};
  const sentence=clauses(text)[0]??'',split=sentence.match(/^(.+?)[，,](?:但|而)(.+)$/);
  if(split)return {left:split[1],right:split[2],relation:'并置核对',limit:clauses(text).find(t=>/不同|异质|并非|不能|无法|未报告/.test(t))??''};
  return {left:sentence,right:clauses(text).find(t=>t!==sentence&&/不同|异质|未报告|不能|限制|尚/.test(t))??clauses(text)[1]??'本段没有另一组可直接对照的结果',relation:'发现与条件',limit:''};
}
export function focusDiagram(block) {
  const text=prose(block.text),change=text.match(/从[“「]([^”」]+)[”」]转向[“「]([^”」]+)[”」]/);
  if(change)return {kind:'change',nodes:change.slice(1),caption:'本轮报告中的问题变化'};
  const connection=text.match(/同时关联([^；。]+?)与([^；。]+)/);
  if(connection)return {kind:'connection',nodes:connection.slice(1),caption:'同一研究问题连接的方向'};
  const limit=clauses(text).findLast(t=>/摘要未报告|需更多验证|适用条件|限制/.test(t));
  return {kind:'question',nodes:[conceptTitle(block),excerpt(limit??clauses(text).at(-1),62)],caption:'关注点与待核对证据'};
}
export function gapLabel(block) {
  const title=block.headline??block.text??'';
  return /临床验证/.test(title)?'临床验证':/研究设计/.test(title)?'研究设计':/未覆盖|覆盖边界/.test(title)?'材料覆盖':topic(block);
}
export function evidenceExcerpt(text) {
  const value=prose(text),matched=value.match(/构成(.+?)的分支/)??value.match(/，属([^。；]+)/);
  if(matched)return matched[1];
  const limited=value.match(/仅有([^，。；]+)/),unknown=value.match(/人体验证[^，。；]*摘要未报告/);
  if(limited&&unknown)return `仅有${limited[1]}；${unknown[0]}`;
  return excerpt(value,64);
}
