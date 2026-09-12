import {randomUUID} from 'node:crypto';
import {requireThat} from './errors.mjs';
import {writingInput,executeWriting} from './topic-writing.mjs';
import {writingSections,sectionAccessIds,currentSectionVersion,manuscriptSnapshot} from '../../shared/topic-writing.mjs';

export function manuscriptInput(p,a,body){
  const options=body.topicOptions??{},w=a.topicWorkspace,outline=w?.outlines?.find(o=>o.id===options.outlineId);
  requireThat(outline&&w.outlineConfirmations?.some(c=>c.outlineId===outline.id),'outline_unconfirmed','请先确认研究大纲。',409);
  const sections=writingSections(outline),ids=[...new Set(sections.flatMap(sectionAccessIds))],selected=body.accessIds??[];
  requireThat(selected.length===ids.length&&new Set(selected).size===ids.length&&selected.every(id=>ids.includes(id)),'invalid_scope','完整初稿仅使用已确认大纲各节关联的材料。');
  const workspace=w.writingWorkspaces?.[outline.id],language=options.language??'zh';
  const contexts=sections.map(section=>{
    const saved=currentSectionVersion(workspace?.sections[section.id]),reuse=saved?.language===language&&saved.paragraphs.length>0||saved?.language===language&&saved.status==='generating';
    const context=writingInput(p,a,{text:reuse?saved.request:body.text,accessIds:sectionAccessIds(section),topicOptions:{outlineId:outline.id,sectionId:section.id,language,recordText:saved?.recordText??''}});
    return {context,reuseVersionId:reuse?saved.id:null};
  });
  return {outline:structuredClone(outline),language,sections:contexts};
}

export async function executeManuscript(service,task,config,signal){
  const input=task.input.manuscript,progress=Object.fromEntries(input.sections.map(({context})=>[context.section.id,{number:context.section.number,status:'queued',progress:'等待生成'}]));
  await service.updateTask(task,{status:'running',progress:'正在生成完整初稿',sectionProgress:structuredClone(progress)});
  let cursor=0;
  const publish=()=>service.updateTask(task,{sectionProgress:structuredClone(progress),progress:`正在生成完整初稿 · ${Object.values(progress).filter(s=>s.status==='completed').length} / ${input.sections.length} 节已就绪`});
  const worker=async()=>{
    while(cursor<input.sections.length&&!signal.aborted){
      const {context,reuseVersionId}=input.sections[cursor++],id=context.section.id,ids=sectionAccessIds(context.section),materials=task.input.materials.filter(m=>ids.includes(m.accessId));
      try{
        await executeWriting(service,task,config,signal,{context,materials,reuseVersionId,batch:true,onProgress:async patch=>{Object.assign(progress[id],{status:patch.status==='completed'?'completed':'running',progress:patch.progress});await publish();}});
      }catch(error){
        if(signal.aborted)throw error;
        Object.assign(progress[id],{status:'failed',errorCode:error.code??'section_failed',progress:'本节未完成，已写内容保留'});await publish();
      }
    }
  };
  // Sections can run independently; paragraphs within a section retain their
  // predecessor context. One task owns all calls, cancellation and cost records.
  const workers=await Promise.allSettled(Array.from({length:Math.min(3,input.sections.length)},worker));
  signal.throwIfAborted();
  const rejected=workers.find(r=>r.status==='rejected');if(rejected)throw rejected.reason;
  await service.store.update(s=>{
    signal.throwIfAborted();const p=s.projects[task.projectId],t=p.researchTasks[task.id],a=p.artifacts[task.artifactId],w=a.topicWorkspace,workspace=w.writingWorkspaces[input.outline.id];
    requireThat(['queued','running'].includes(t.status),'cancelled','生成已停止。',409);
    const snapshot=manuscriptSnapshot(input.outline,workspace);
    workspace.manuscripts??=[];
    const prior=workspace.manuscripts.find(m=>JSON.stringify(m.sectionVersions)===JSON.stringify(snapshot.sectionVersions)&&JSON.stringify(m.chapters)===JSON.stringify(snapshot.chapters));
    const manuscript=prior??{...snapshot,id:`manuscript_${randomUUID()}`,at:new Date().toISOString(),taskId:task.id};
    if(!prior)workspace.manuscripts.push(manuscript);
    workspace.activeManuscriptId=manuscript.id;t.manuscriptId=manuscript.id;t.manuscriptComplete=snapshot.complete;w.version++;
  });
  const failed=Object.values(progress).filter(s=>s.status==='failed');
  await service.updateTask(task,{status:failed.length?'failed':'completed',finishedAt:new Date().toISOString(),sectionProgress:structuredClone(progress),...(failed.length?{errorCode:'manuscript_incomplete',error:`初稿已保存，${failed.length} 个小节尚未完成；继续生成将接续已有段落。`}:{}),progress:failed.length?'已有初稿保留，可继续完成剩余小节':'完整初稿已保存，可以导出或开始阅读模板文献。'});
}
