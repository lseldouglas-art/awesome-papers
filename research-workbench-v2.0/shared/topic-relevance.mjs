// Shared by screening, first-page calibration and evidence synthesis.
export const RELEVANCE_VERSION = 'topic-abcd-v1';
export const topicRelations = { direct:'A · 直接相关', indirect:'B · 间接相关', peripheral:'C · 稍微相关', unrelated:'D · 不相关', unclear:'待判断' };
export const legacyRelations = { direct:'直接相关', indirect:'间接／方法参照', unrelated:'不相关', unclear:'待判断' };
export const relatedRelations = ['direct','indirect','peripheral'];
export const needsRelevanceReview = note => Boolean(note && (note.criteriaVersion !== RELEVANCE_VERSION || note.relationship==='unrelated'&&note.actor!=='local_user'&&!note.titleCheckVersion));
export const relevanceLabel = note => topicRelations[note?.relationship] ?? '待判断';
// Collapse punctuation only; keep every factual clause and preserve the raw
// model response separately. Display and manual editing use the same limit.
export function conciseRelevance(value = '') {
  const sentences=String(value).trim().split(/(?<=[。！？!?])\s*/u).filter(Boolean);
  if(sentences.length<=2)return String(value).trim();
  return sentences[0]+sentences.slice(1).map(s=>s.replace(/[。！？!?]+$/u,'')).join('；')+'。';
}
export function screeningSummary(note,material) {
  if(material?.level!=='title')return conciseRelevance(note?.summary||note?.reason||'尚未判断相关性。');
  const terms=[...new Set((note?.titleMatches??[]).filter(hit=>typeof hit.term==='string'&&String(material.title??'').toLowerCase().includes(hit.term.toLowerCase())).map(h=>h.term))].slice(0,2).join('、');
  const lead=terms&&terms.length<=100?`题名包含“${terms}”`:'本次仅取得题名';
  const relation={direct:'涉及本题的核心主题',indirect:'可作为本题的间接关联线索',peripheral:'可作为本题的背景线索',unrelated:'当前未识别出实质关联',unclear:'具体关联仍待判断'}[note?.relationship]??'相关性仍待判断';
  return `${lead}，${relation}。关键发现、方法与研究规模未知。`;
}
// A conservative contradiction check, not an automatic scientific grade. Terms
// come from the selected core groups; a match can flag an inconsistent D only.
export function coreTitleMatches(title,groups=[]) {
  const hits=[];
  for(const group of groups.filter(g=>g.core!==false)){
    const terms=(group.query??'').split(/\b(?:OR|AND)\b/iu).map(part=>part.match(/([^\[\]]+)\[(?:tiab|mesh)\]/iu)?.[1]?.replace(/[()"']/g,'').trim()).filter(Boolean);
    if(terms.some(t=>/artificial intelligence|machine learning|deep learning/iu.test(t)))terms.push('machine learning','deep neural network*','convolutional neural network*','CNN','natural language processing','NLP','gradient-boosted machine');
    for(const term of terms){
      const pattern=term.split('*').map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/[\s-]+/g,'[\\s-]+')).join('\\w*');
      const match=String(title??'').match(new RegExp(`\\b${pattern}\\b`,'iu'));
      if(match&&!hits.some(h=>h.term===match[0]))hits.push({concept:group.label,term:match[0]});
    }
  }
  return hits;
}
export const relevanceInstructions = `主题相关性按 A/B/C/D 判断，等级不是质量、偏倚风险或正式纳排结论。
先从选定专题识别核心概念及其同义词、缩写和下位词，再逐篇寻找一切可能的关联。检索词群 A+B+C 与相关性等级 A/B/C/D 是两回事：标题只要出现任一核心概念或同义词（A 或 B 或 C），即视为相关，至少 C；不要求标题复述完整主标题或同时包含所有词群。缩写须按实际语义判断，同字异义不算命中；标题未命中时继续依据实际摘要寻找关联。
direct=A 最相关：主要研究内容就是本题；多个核心概念共同命中且语义相符通常属 A，不要求拟议实验设计的每一细节都相同。
indirect=B 间接相关：能支撑本题一个重要论点，包括有实质用途的技术、方法或跨场景参照；说明用途与不可直接外推之处。
peripheral=C 稍微相关：同一疾病背景、单个核心概念、较弱背景或桥接参考，仍计为相关。不可因为未同时包含所有概念就判 D。
unrelated=D 毫不相关：实际题名与摘要均未显示本题核心概念或实质关联。反对研究假设的结果仍可相关。
unclear=待判断：资料缺失、缩写歧义或信息不足，不能把未知当作 D。仅题名也可据明确概念判相关，但必须说明“仅题名，关键发现未知”；摘要未报告不能写成未实施。
先提炼 1–2 句中文核心信息与相关关键发现，再给等级和具体分类依据。忠实转述实际研究对象、主要发现或可用信息；说明能怎样服务本题。不得只复述题名或只写“相关／无关”，不得补写未读取的结果。保留本篇真实原文定位。`;

// Human relevance decisions survive a new model run. A taxonomy-only edit must
// not accidentally pin an obsolete model relevance judgment.
export function mergeTopicClassifications(screenings = {}, overrides = {}) {
  const merged = { ...screenings };
  for (const [id, override] of Object.entries(overrides)) {
    const current = screenings[id];
    merged[id] = override.categoryActor === 'local_user' && override.actor !== 'local_user' && current
      ? { ...current, categories:override.categories, categoryActor:override.categoryActor, categoryEditedAt:override.categoryEditedAt }
      : { ...override, ...(current && override.actor === 'local_user' ? { modelSuggestion:current } : {}) };
  }
  return merged;
}
