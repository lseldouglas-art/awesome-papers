import {randomUUID} from 'node:crypto';
import {requireThat} from './errors.mjs';
import {parseModelJsonObject} from './model-output.mjs';
import {writingSections,currentSectionVersion,manuscriptSnapshot} from '../../shared/topic-writing.mjs';
export function refinementInput(a,outlineId,focus){
  requireThat(['abstract','introduction','discussion'].includes(focus),'invalid_input','请选择摘要、引言或讨论。');
  const outline=a.topicWorkspace?.outlines?.find(o=>o.id===outlineId),workspace=a.topicWorkspace?.writingWorkspaces?.[outlineId];
  requireThat(outline&&workspace,'invalid_scope','请先完成正文。');
  const sections=writingSections(outline).map(s=>({...s,version:currentSectionVersion(workspace.sections[s.id])}));
  requireThat(sections.every(s=>s.version?.paragraphs.length&&workspace.sections[s.id].completedVersionId===s.version.id),'manuscript_review_required','完成当前正文各节审阅后，再开展重点章节深化。',409);
  return {outlineId,focus,outlineTitle:outline.title,language:sections[0].version.language,manuscript:manuscriptSnapshot(outline,workspace),sections};
}
export function validateAbstract(data,input){
  requireThat(Array.isArray(data.sentences)&&data.sentences.length&&Array.isArray(data.keywords)&&data.keywords.length>=5&&data.keywords.length<=7&&data.keywords.every(k=>typeof k==='string'&&k.trim())&&typeof data.reason==='string','model_structure','摘要需有对应正文依据及 5–7 个关键词。',502);
  const body=input.sections.flatMap(s=>s.version.paragraphs.map(p=>({sectionId:s.id,paragraphId:p.id,text:p.text}))),knownNumbers=new Set(body.flatMap(p=>p.text.match(/\d+(?:\.\d+)?%?/g)??[]));
  const sentences=data.sentences.map(sentence=>{
    requireThat(typeof sentence.text==='string'&&sentence.text.trim()&&Array.isArray(sentence.anchors)&&sentence.anchors.length,'model_structure','摘要每句需要对应正文位置。',502);
    requireThat((sentence.text.match(/\d+(?:\.\d+)?%?/g)??[]).every(n=>knownNumbers.has(n)),'abstract_new_fact','摘要出现正文以外数值，未采纳该候选。',502);
    for(const a of sentence.anchors){const p=body.find(p=>p.sectionId===a.sectionId&&p.paragraphId===a.paragraphId);requireThat(p&&typeof a.quote==='string'&&a.quote.trim().length>=12&&p.text.includes(a.quote),'abstract_anchor','摘要依据未能定位到已审阅正文。',502);}
    return {text:sentence.text,anchors:sentence.anchors};
  });return {sentences,keywords:data.keywords,reason:data.reason};
}
export async function executeRefinement({input,invoke,save,rules,validateOptimization}){
  if(input.focus==='abstract'){
    const out=await invoke('model.manuscript-abstract',`${rules}\n仅依据当前已审阅正文形成凝练的学术摘要与 5–7 个关键词，以问题、研究目的、设计、主要发现/方案及意义组织，文章若为方案必须保持方案语态，不能虚构已取得结果。模板只用于信息组织，不提供本研究事实。不能增加正文以外的事实、结论、研究对象、数值或论断强度；采用正文语言。每句 anchors 引用正文中逐字可定位的片段。只返回 JSON {sentences:[{text,anchors:[{sectionId,paragraphId,quote}]}],keywords:[],reason}。\n正文：${JSON.stringify(input.sections)}\n全文提炼：${JSON.stringify(input.fullStudy)}`);
    const proposal=validateAbstract(parseModelJsonObject(out.text),input);
    await save(l=>{l.refinements??=[];l.refinements.push({...proposal,id:`refinement_${randomUUID()}`,artifactId:input.artifactId,outlineId:input.outlineId,focus:input.focus,sectionVersions:input.manuscript.sectionVersions,paperId:input.paper.id,textVersion:input.paper.textVersion,studyId:input.fullStudy.id,at:new Date().toISOString(),provenance:out.provenance});});return;
  }
  const pattern=input.focus==='introduction'?/引言|introduction|背景|background/i:/讨论|discussion/i;
  const selected=input.sections.filter(s=>pattern.test(s.chapter));
  requireThat(selected.length,'invalid_scope','当前大纲没有对应章节，请先核对章节名称。');
  for(const section of selected)for(const paragraph of section.version.paragraphs){
    const target={...input,section,sectionId:section.id,paragraph,paragraphId:paragraph.id,writingVersionId:section.version.id};
    const out=await invoke('model.manuscript-refine',`${rules}\n正文各节已完成研究者审阅。现在针对${input.focus==='introduction'?'引言：研究问题的聚焦、重要性与缺口的证据范围、目的和研究设计的对应':'讨论：主要发现的解释、与既有研究的比较、竞争解释、局限与临床/理论适用范围'}深化当前一段。先读整篇正文确保前后相符，以已完成的模板全文提炼为参照，不能把模板事实迁入。保留当前段落所有数值和引用编号，给出具体修改理由与适用条件，勿产生新事实。返回 JSON {diagnosis,suggestions:[{before,issue,principleIds,options:[{text,reason,useWhen}]}]}，before 是当前段落唯一可定位原句。\n整篇正文：${JSON.stringify(input.manuscript)}\n模板提炼：${JSON.stringify(input.fullStudy)}\n当前段落：${JSON.stringify(paragraph)}`);
    const proposal=validateOptimization(parseModelJsonObject(out.text),target);
    await save(l=>l.optimizations.push({...proposal,id:`optimization_${randomUUID()}`,focus:input.focus,artifactId:input.artifactId,outlineId:input.outlineId,sectionId:section.id,paragraphId:paragraph.id,writingVersionId:section.version.id,originalText:paragraph.text,paperId:input.paper.id,textVersion:input.paper.textVersion,studyId:input.fullStudy.id,focusText:input.selection.focus?.textVersion===input.paper.textVersion?input.selection.focus.text:null,at:new Date().toISOString(),provenance:out.provenance}));
  }
}
