import {requireThat} from './errors.mjs';
import {continuityKinds,protocolFields,recordFields,researchScope,itemVersion,itemRef,resolveResearchRef,continuityMarkdown,continuitySnapshot,sameRef,nestedRef} from '../../shared/research-continuity.mjs';

const clone=structuredClone;
const editableKinds=continuityKinds.filter(k=>k!=='attachment');
const commonFields=['outputMode','inputRefs','executionStatus','originKind','verification','recordedAfterResults'];
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
export const continuityCommands=new Set(['save-continuity','restore-continuity','decide-continuity','register-research-attachment','record-comparison-event']);
function payloadOf(p,a,kind,value,{attachment=false}={}) {
  requireThat(object(value),'invalid_input','研究记录需要完整内容。');
  if(attachment){requireThat(kind==='attachment'&&/^[a-f0-9]{64}$/.test(value.sha256),'invalid_input','附件缺少内容校验。');return clone(value);}
  const fields=kind==='protocol'?protocolFields:recordFields;
  requireThat(Object.keys(value).every(k=>Object.hasOwn(fields,k)||commonFields.includes(k)),'invalid_input','研究记录含不支持的字段。');
  const payload={};
  for(const key of Object.keys(fields)) {
    requireThat(value[key]===undefined||typeof value[key]==='string'&&value[key].length<=100000,'invalid_input','请检查研究记录的文本内容。');
    payload[key]=value[key]??'';
  }
  if(kind==='protocol') {
    requireThat(['literature','proposal','results'].includes(value.outputMode??'proposal'),'invalid_input','请选择文献研究、研究方案或真实结果。');
    payload.outputMode=value.outputMode??'proposal';
  } else {
    requireThat(['user','external_ai','external_tool'].includes(value.originKind??'user'),'invalid_input','请说明记录来自研究者、AI建议还是外部工具。');
    requireThat(kind!=='execution'||value.originKind!=='external_ai','invalid_study_record','AI建议不能登记为实际执行结果。');
    payload.originKind=value.originKind??'user';
    requireThat(['unreviewed','source_checked','user_reviewed'].includes(value.verification??'unreviewed'),'invalid_input','请选择实际核查范围。');
    payload.verification=value.verification??'unreviewed';
    if(kind==='execution') {
      requireThat(['unknown','partial','completed','failed'].includes(value.executionStatus??'unknown'),'invalid_input','请说明实际执行状态。');
      payload.executionStatus=value.executionStatus??'unknown';
    }
  }
  requireThat(value.recordedAfterResults===undefined||typeof value.recordedAfterResults==='boolean','invalid_input','请说明是否在获得结果后整理。');
  payload.recordedAfterResults=value.recordedAfterResults??false;
  const refs=value.inputRefs??[];
  requireThat(Array.isArray(refs),'invalid_input','依据版本需要是列表。');
  const scope=researchScope(p,a.id);
  payload.inputRefs=refs.map(ref=>{
    requireThat(object(ref)&&typeof ref.revisionId==='string'&&['research_item','access','artifact','outline','writing','figure'].includes(ref.type)&&resolveResearchRef(p,ref),'invalid_reference','某项输入版本不存在于本课题。');
    if(ref.type==='research_item') {const item=p.researchItems[ref.id];requireThat(!continuityKinds.includes(item.kind)||item.scopeId===scope.id,'invalid_scope','请使用当前研究方向的方案或记录。');}
    if(ref.type==='access')requireThat(a.draft.sourceAccessIds.includes(ref.id),'invalid_scope','该来源不在当前成果的材料范围。');
    return clone(ref);
  });
  return payload;
}
const meaningful=p=>Object.fromEntries(Object.entries(p??{}).filter(([k])=>!['next'].includes(k)));
export function applyContinuityCommand(p,name,body,operationId,ops) {
  const {checkState,find,addItem,link,markAffected,emit,changed,userIntent,uid,now}=ops;
  checkState(p,body.baseStateVersion);
  const a=find(p.artifacts,body.artifactId,'研究页面'),scope=researchScope(p,a.id),k=p.researchKernel;
  if(name==='record-comparison-event') {
    requireThat(['workbench','gpt'].includes(body.path)&&typeof body.text==='string'&&body.text.trim()&&body.text.length<=10000,'invalid_input','请记录发生的具体断点或补救。');
    requireThat(body.activeMinutes===undefined||body.activeMinutes===null||Number.isFinite(body.activeMinutes)&&body.activeMinutes>=0,'invalid_input','主动用时需要非负分钟数或未知。');
    const event=emit(p,'comparison_observation','local_user',operationId,{artifactId:a.id,scopeId:scope.id},{path:body.path,text:body.text,activeMinutes:body.activeMinutes??null,artifactRevisionId:a.headRevisionId,context:continuitySnapshot(p,a.id)});
    changed(p);return clone(event);
  }
  const existing=body.itemId?find(p.researchItems,body.itemId,'研究记录'):null;
  requireThat(!existing||continuityKinds.includes(existing.kind)&&existing.scopeId===scope.id,'invalid_scope','这份记录不属于当前研究方向。');
  const kind=existing?.kind??body.kind;
  requireThat(editableKinds.includes(kind)||name==='register-research-attachment'&&kind==='attachment','invalid_input','不支持此类研究记录。');
  if(name==='decide-continuity') {
    const v=itemVersion(p,{id:body.itemId,revisionId:body.revisionId});
    requireThat(v,'not_found','请选择实际保存的记录版本。',404);
    requireThat(['adopt','keep','defer','reject'].includes(body.choice),'invalid_input','请选择采用、保留、未决或不采用。');
    if(body.choice==='adopt'&&['execution','interpretation'].includes(kind))requireThat(v.revision.payload.text.trim(),'invalid_study_record','请先保存实际记录或解释内容，再选择用于后续工作。');
    const target=v.ref,intent=userIntent(p,body,name,target,operationId);
    k.continuityChoices??={};k.currentProtocols??={};k.currentResults??={};
    const slot=kind==='protocol'?k.currentProtocols:['execution','interpretation'].includes(kind)?k.currentResults:null;
    const priorChoice=p.decisions[k.continuityChoices[v.item.id]];
    const old=slot?.[scope.id]??null;
    const decision={id:uid('decision'),category:kind,target,choice:body.choice,intent,actor:'local_user',operationId,createdAt:now(),supersedesId:k.continuityChoices[v.item.id]??null,scopeId:scope.id};
    p.decisions[decision.id]=decision;k.continuityChoices[v.item.id]=decision.id;
    if(body.choice==='adopt'&&slot) {
      slot[scope.id]={...target,decisionId:decision.id};
      const prior=itemVersion(p,old);
      if(old&&!sameRef(old,target))for(const revision of prior.item.revisions.filter(r=>r.number<=prior.revision.number))if(JSON.stringify(meaningful(revision.payload))!==JSON.stringify(meaningful(v.revision.payload)))markAffected(p,itemRef(prior.item,revision.id),operationId,`${kind==='protocol'?'采用方案':'用于后续工作的结果'}已改变，请重看所用旧版与当前内容的差异。`);
    }
    if(kind==='insight'&&priorChoice?.choice==='adopt'&&(body.choice!=='adopt'||!sameRef(priorChoice.target,target)))markAffected(p,priorChoice.target,operationId,'已采用的外部建议已改变，请核对使用该建议的内容。');
    // A keep/reject judgement never silently replaces the separately chosen slot.
    link(p,{type:'decision',id:decision.id,revisionId:decision.id},target);
    emit(p,'continuity_decided','local_user',operationId,target,{decisionId:decision.id,choice:decision.choice,intent,previousSelection:old});changed(p);
    return {itemId:v.item.id,revisionId:v.revision.id,decision:clone(decision)};
  }
  requireThat(!existing||body.baseRevisionId===existing.headRevisionId,'revision_conflict','这份记录已更新，你的输入保留，请对照新版本再保存。',409);
  const restored=name==='restore-continuity'?itemVersion(p,{id:existing?.id,revisionId:body.revisionId}):null;
  requireThat(name!=='restore-continuity'||restored,'not_found','要恢复的保存版不存在。',404);
  const title=restored?.revision.title??body.title;
  requireThat(typeof title==='string'&&title.trim()&&title.length<=2000,'invalid_input','请填写记录名称。');
  const payload=restored?clone(restored.revision.payload):payloadOf(p,a,kind,body.payload,{attachment:name==='register-research-attachment'});
  requireThat(!payload.inputRefs?.some(r=>r.type==='research_item'&&r.id===existing?.id),'invalid_reference','记录不能以自身作为输入。');
  const previous=existing?.revisions.at(-1);
  if(previous&&previous.title===title&&JSON.stringify(previous.payload)===JSON.stringify(payload)&&!restored)return {itemId:existing.id,revisionId:previous.id,unchanged:true};
  const intent=userIntent(p,body,name,{artifactId:a.id,itemId:existing?.id??null},operationId);
  let item,revision;
  if(!existing) {
    ({item,revision}=addItem(p,kind,{title,text:payload.text??payload.question??title,payload,unknowns:payload.limitations?[payload.limitations]:[],informationStatus:'user_provided'}, {actor:'local_user',operationId,origin:{artifactId:a.id,intent,source:body.prefilled?'existing_proposal':'user_record'}}));
    item.scopeId=scope.id;
  } else {
    item=existing;revision={...clone(previous),id:uid('item_revision'),number:previous.number+1,previousRevisionId:previous.id,createdAt:now(),actor:'local_user',operationId,title,text:payload.text??payload.question??title,payload,unknowns:payload.limitations?[payload.limitations]:[],intent,...(restored?{restoredFrom:restored.revision.id}:{})};
    item.revisions.push(revision);item.headRevisionId=revision.id;item.title=title;
  }
  const refs=[scope.questionRef,...(payload.inputRefs??[])].filter(Boolean);
  for(const ref of refs)link(p,itemRef(item,revision.id),ref);
  revision.dependencies=clone(Object.values(p.dependencies).filter(d=>sameRef(d.from,itemRef(item,revision.id))));
  emit(p,restored?'continuity_restored':'continuity_saved','local_user',operationId,itemRef(item,revision.id),{kind,intent,previousRevisionId:previous?.id??null,adoptionUnchanged:true});changed(p);
  return {itemId:item.id,revisionId:revision.id,adoptionUnchanged:true};
}

// Index only actual new output references. Never infer lineage for old content.
export function linkContinuityOutput(p,ref,snapshot,ops) {
  const dependencies=[...(snapshot?.refs??[]),...(snapshot?.extraRefs??[])];
  for(const to of dependencies)if(resolveResearchRef(p,to))ops.link(p,ref,to);
  return clone(Object.values(p.dependencies??{}).filter(d=>sameRef(d.from,ref)));
}
export function provenanceManifest(p,{ref,continuity,accessIds=[]}={}) {
  const pending=[ref,...(continuity?.refs??[])].filter(Boolean),seen=new Set(),entries=[];
  while(pending.length) {
    const target=pending.shift(),key=JSON.stringify([target.type,target.id,target.revisionId]);if(seen.has(key))continue;seen.add(key);
    const resolved=resolveResearchRef(p,target);
    entries.push({ref:clone(target),available:Boolean(resolved),...(resolved?{title:resolved.title,kind:resolved.kind,content:clone(resolved.value)}:{})});
    const dependencies=resolved?.value.dependencies??Object.values(p.dependencies??{}).filter(d=>sameRef(d.from,target));
    for(const d of dependencies)pending.push(d.to);
  }
  const ids=[...new Set([...accessIds,...entries.filter(e=>e.kind==='access').map(e=>e.ref.id)])];
  return {format:'research-workbench-provenance-v1',exportedAt:new Date().toISOString(),target:ref??null,
    lineageStatus:entries.some(e=>Object.values(p.dependencies??{}).some(d=>sameRef(d.from,e.ref)))?'explicit_saved_references':'legacy_linkage_not_recorded',entries,
    sources:ids.map(id=>{const access=p.accesses?.[id],source=p.sources?.[access?.sourceId];return access?{access:clone(access),source:clone(source)}:{accessId:id,available:false};}),
    relevantImpacts:Object.values(p.researchImpacts??{}).filter(i=>entries.some(e=>sameRef(e.ref,i.target??{type:'artifact',id:i.artifactId,revisionId:i.artifactRevisionId}))).map(value=>clone(value)),
    boundary:'所选版本的实际记录；文件存在、原文定位、研究者采用与科学支持分别判断。没有自动执行复现实验。'};
}
export function exportContinuity(p,itemId,revisionId) {
  const v=itemVersion(p,{id:itemId,revisionId});requireThat(v&&continuityKinds.includes(v.item.kind),'not_found','没有这份研究记录版本。',404);
  return {markdown:continuityMarkdown({kind:v.item.kind,...v.revision}),record:{kind:v.item.kind,...clone(v.revision)},manifest:provenanceManifest(p,{ref:v.ref})};
}
