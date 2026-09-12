import { materialPacket, sourcePassages } from './material-scope.mjs';
import {continuityContext,hasContinuity} from './research-continuity.mjs';
import { topicClassifications } from './topic-library-workflow.mjs';
import { RELEVANCE_VERSION, screeningSummary } from './topic-relevance.mjs';
export const OUTLINE_VERSION = 'topic-outline-v2';

// Existing immutable access IDs are the cache boundary; a newer abstract is a
// different input even when its PMID is unchanged. Keep human decisions separate.
export function outlineMaterials(project, artifact, ids) {
  const result=project.researchResults[artifact.draft.resultId], classes=topicClassifications(artifact.topicWorkspace??{},result?.paperNotes??[]);
  const recovered=new Map(Object.values(project.researchTasks??{}).filter(t=>t.artifactId===artifact.id).flatMap(t=>t.reusedPaperNotes??[]).map(n=>[n.accessId,n]));
  return materialPacket(project,ids).map(m=>{
    const note=classes[m.accessId], prior=recovered.get(m.accessId)??result?.paperNotes?.find(p=>p.accessId===m.accessId);
    const quotes=[...new Set([...(note?.quotes??[]),...(prior?.fields?.findings?.quotes??[])])].filter(q=>q&&m.text.includes(q));
    const passages=sourcePassages(m.text).filter(p=>quotes.some(q=>{const start=m.text.indexOf(q);return start<p.end&&start+q.length>p.start;}));
    const ready=Boolean((note?.criteriaVersion===RELEVANCE_VERSION||note?.actor==='local_user')&&note.summary?.trim()&&(note.relationship==='unclear'||passages.length));
    return {...m,note,ready,summary:note?.summary??prior?.fields?.findings?.text??null,passages,
      reuse:{accessId:m.accessId,screeningTaskId:note?.taskId??null,screeningCallId:note?.callId??null,reviewResultId:prior?.reviewResultId??null,actor:note?.actor??null}};
  });
}
export function outlinePacket(rows) {
  return rows.map(m=>({ref:m.ref,accessId:m.accessId,sourceId:m.sourceId,title:m.title,level:m.level,
    relationship:m.note?.relationship??'unclear',summary:m.summary,reason:m.note?.reason??'',categories:m.note?.categories??[],
    findings:m.note?.segmentFindings??[],passages:m.passages.map(({id,text})=>({id,text})),reuse:m.reuse}));
}
export function outlineContext(input, version=OUTLINE_VERSION) {
  return {version,topic:input.itemTarget,goal:input.goal,conditions:input.conditions,notes:input.notes,request:input.text,...(hasContinuity(input.continuity)?{continuity:input.continuity}:{})};
}
export function currentOutlineContext(project,artifact,request) {
  const item=project.researchItems[artifact.branchQuestion.itemId],revision=item.revisions.find(r=>r.id===artifact.branchQuestion.revisionId);
  return {itemTarget:{itemId:item.id,revisionId:revision.id,kind:item.kind,text:revision.text,scope:revision.scope},goal:project.goal,conditions:project.conditions,notes:artifact.draft.notes,text:request,continuity:continuityContext(project,artifact.id)};
}

export function outlineMarkdown(outline) {
  return [`# ${outline.title}`,outline.route,`版本：${outline.id} · ${outline.at}`,'依据已保存的逐篇发现编排；未重新读取原始摘要。',
    ...(outline.positioning?[`核心问题：${outline.positioning.question}`,`预期贡献：${outline.positioning.contribution}`,`论述边界：${outline.positioning.scope}`]:[]),
    ...outline.sections.flatMap((s,i)=>[`## ${i+1} ${s.heading}`,s.purpose,...s.children.flatMap((c,j)=>[
      `### ${i+1}.${j+1} ${c.heading}`,c.purpose,...(c.question?[`科学问题：${c.question}`,`论证主张／待验证命题：${c.claim}`,...c.argument.map((a,k)=>`${k+1}. ${a.point}${a.refs.length?`（${a.refs.join('、')}）`:''}`),`矛盾与边界：${c.counterpoint}`,`章节衔接：${c.transition}`]:[]),...c.evidence.map(e=>`- ${e.ref} · ${{direct:'直接依据',indirect:'间接参照',background:'背景'}[e.role]}${e.use?` · ${e.use}`:''} · ${e.level} · ${e.accessId} / ${e.passage}`),
      ...c.figures.map(f=>`- 图表：${f}`),...c.needs.map(n=>`- 待补：${n}`)])]),
    '## 本版材料与原文定位',...outline.papers.flatMap(p=>[`- ${p.ref} ${p.title} · ${p.level} · ${p.accessId}`,screeningSummary(p,p)])].join('\n\n');
}
