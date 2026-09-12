import {requireThat} from './errors.mjs';
const nonempty=s=>typeof s==='string'&&s.trim();
const statuses=['consistent','deeper','supplement','correct','researcher'];
export function validateSourceChecks(row,sentence,documents={}){
  const expected=[...new Map(sentence.citations.map(c=>[`${c.ref}:${c.passage}`,c])).values()];
  requireThat(Array.isArray(row.sources)&&row.sources.length===expected.length&&new Set(row.sources.map(s=>`${s.ref}:${s.passage}`)).size===expected.length,'audit_source_coverage','本句每个引用来源需要分别核对。',502);
  return expected.map(c=>{const s=row.sources.find(s=>s.ref===c.ref&&s.passage===c.passage);requireThat(s&&statuses.includes(s.status)&&nonempty(s.explanation),'audit_source_coverage','每个来源需要核对结果与解释。',502);const doc=documents[c.accessId];let verifiedLevel=c.level;const anchors=[];if(doc&&Array.isArray(s.anchors)){for(const a of s.anchors){const page=doc.pages.find(p=>p.number===a.page),norm=t=>String(t??'').replace(/\s+/g,' ').trim();requireThat(page&&nonempty(a.quote)&&norm(a.quote).length>=12&&norm(page.text).includes(norm(a.quote)),'audit_fulltext_anchor','全文核对需要可定位的 PDF 页码与原句。',502);anchors.push({page:a.page,quote:a.quote});}if(anchors.length)verifiedLevel='fulltext';}return {...s,anchors,documentHash:anchors.length?doc.sha256:null,verifiedLevel,level:c.level,accessId:c.accessId,quote:c.quote};});
}
export function splitEditedSentences(text){
  let plain='',index=0;const offsets=[0];
  while(index<text.length){const citation=text.slice(index).match(/^\[\d+\]/)?.[0];if(citation){index+=citation.length;offsets[plain.length]=index;}else{plain+=text[index++];offsets[plain.length]=index;}}
  let start=0;const result=[];
  for(const part of new Intl.Segmenter('en',{granularity:'sentence'}).segment(plain)){const end=offsets[part.index+part.segment.length];result.push(text.slice(start,end));start=end;}
  if(start<text.length)result.push(text.slice(start));return result.length?result:[text];
}
