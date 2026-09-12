// Presentation-independent rules. A top-ranked pilot is precision feedback,
// never a certificate of completeness, recall, or scientific quality.
import { RELEVANCE_VERSION, topicRelations, relatedRelations, needsRelevanceReview, mergeTopicClassifications } from './topic-relevance.mjs';
export { topicRelations } from './topic-relevance.mjs';
export const topicTaskModes = ['topic-plan', 'topic-preview', 'topic-collect', 'topic-screen', 'topic-outline', 'topic-writing', 'manuscript-writing'];
export const topicSearchRequests = {
  sparse: '相关文献太少。请结合当前检索式和真实校准理由，检查同义词遗漏、缩写歧义及 AND 是否过严，优先放宽次要成像、场景、结局或设计限制，保留本题核心对象与问题，给我可编辑的替代检索式并说明改动。不要为凑数量换题。',
  noisy: '检索结果偏题太多。请结合原始前 20 篇的题名和逐篇理由，识别词义歧义与偏离的主题，补全或收紧本题核心词群，避免盲目叠加所有实验细节，给我可编辑的替代检索式并说明取舍。',
  redesign: '请诊断当前检索式与校准反馈，重新建议 2 至 3 条保留本题核心的检索式，说明每条相对当前检索式改了什么，供我选择、手动修改后再校准。'
};

// Capture calibration evidence at request time; it must not drift with later edits.
export function topicPlanningFeedback(project, artifact, query, options = {}) {
  const w = artifact.topicWorkspace ?? {}, notes = topicClassifications(w);
  const previews = w.previews ?? [], current = previews.filter(p => p.query === query).at(-1);
  const describe = p => ({ id:p.id, query:p.query, at:p.at, total:p.total, ...calibrationSummary(p,notes) });
  const collection = (w.collections ?? []).filter(c => c.query === query).at(-1);
  return {
    query,
    calibration: current ? { ...describe(current), samples:current.ids.map((pmid,index) => {
      const id=current.accessByPmid?.[pmid], access=project.accesses[id], source=project.sources[access?.sourceId], note=notes[id];
      return { rank:index+1, pmid, title:source?.title??null, level:access?.level??'not_accessed', relationship:note?.relationship??'unclear', criteriaVersion:note?.criteriaVersion??null, summary:note?.summary??null, titleMatches:note?.titleMatches??[], reason:note?.reason??null, quotes:note?.quotes??[], actor:note?.actor??null };
    }) } : null,
    recentCalibrations:previews.filter(p=>p.id!==current?.id).slice(-3).map(describe),
    collectionScope:{ from:options.from??'', to:options.to??'', sort:options.sort??'pub_date' },
    lastCollection:collection ? { query:collection.query, options:collection.options, total:collection.plan?.total??null, retrieved:collection.accessIds.length, status:collection.status } : null
  };
}
export function calibrationSummary(preview, classifications = {}, { historical = false } = {}) {
  const counts = Object.fromEntries(Object.keys(topicRelations).map(key=>[key,0]));
  if (!preview) return { label:'尚未校准',state:'unmeasured',relevant:0,size:0,unknown:0,missing:0,legacy:0,counts };
  const ids = [...new Set(preview.ids)], size = ids.length;
  const missing = ids.filter(id => !preview.accessByPmid?.[id]).length;
  const legacy = ids.filter(id=>needsRelevanceReview(classifications[preview.accessByPmid?.[id]])).length;
  const oldHistory = historical && preview.criteriaVersion !== RELEVANCE_VERSION;
  for (const id of ids) { const key=classifications[preview.accessByPmid?.[id]]?.relationship; counts[Object.hasOwn(counts,key)?key:'unclear']++; }
  const relevant = (oldHistory?['direct']:relatedRelations).reduce((n,key)=>n+counts[key],0);
  const unknown = counts.unclear;
  const incomplete = missing > 0 || size < Math.min(20, preview.total);
  const state = incomplete ? 'incomplete' : legacy&&!oldHistory ? 'legacy' : size < 20 ? 'small' : relevant === 20 ? 'excellent' : relevant > 10 ? 'good' : unknown ? 'pending' : 'adjust';
  const label = {incomplete:'取样未完整',legacy:'评级待完善',small:size?'小样本，供判断':'本次未命中',pending:'待完成判断',excellent:'优良',good:'良好',adjust:'建议调整'}[state];
  return { label,state,relevant,size,unknown,missing,legacy,counts,criteriaVersion:oldHistory?'direct-only-v0':RELEVANCE_VERSION };
}
export function topicClassifications(workspace = {}, legacyNotes = []) {
  const legacy=Object.fromEntries(legacyNotes.filter(n=>Object.hasOwn(topicRelations,n.relationship)&&n.fields?.relevance).map(n=>[n.accessId,{accessId:n.accessId,relationship:n.relationship,summary:n.summary??n.fields.findings?.text,criteriaVersion:n.criteriaVersion,reason:n.fields.relevance.text,quotes:n.fields.relevance.quotes??[],categories:[],actor:'model',legacyReview:true}]));
  return mergeTopicClassifications({...legacy,...workspace.screenings},workspace.overrides);
}
export function topicCategories(ids, classifications) {
  const groups = new Map();
  for (const id of ids) for (const path of classifications[id]?.categories ?? []) {
    const key = JSON.stringify([path.parent, path.child]);
    if (!groups.has(key)) groups.set(key, { ...path, ids: new Set() });
    groups.get(key).ids.add(id);
  }
  return [...groups.values()].map(g => ({ ...g, ids:[...g.ids] }));
}
export function collectionQuery(query, { from = '', to = '' } = {}) {
  return from || to ? `(${query}) AND ("${from || '1000-01-01'}"[Date - Publication] : "${to || '3000-12-31'}"[Date - Publication])` : query;
}
// Count a paper once while retaining every immutable access version for citations.
// A human-included snapshot takes precedence over a newly fetched version.
export function topicPaperIds(project, ids, entries=[]) {
  const kept=new Map(),included=new Set(entries.filter(e=>e.decision==='included').map(e=>e.accessId));
  const level={title:1,abstract:2,excerpt:2,full_text:3};
  for(const id of ids){const a=project.accesses[id],s=project.sources[a?.sourceId];if(!a||!s)continue;const key=s.pmid?`pmid:${s.pmid}`:a.sourceId,previous=kept.get(key);if(!previous){kept.set(key,id);continue;}if(included.has(previous))continue;if(included.has(id)||(level[a.level]??0)>=(level[project.accesses[previous].level]??0))kept.set(key,id);}
  return [...kept.values()];
}
