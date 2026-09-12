// Read-only views over the existing research items, revisions and decisions.
// No summary here is a second source of research state.
export const continuityKinds = ['protocol', 'execution', 'interpretation', 'insight', 'attachment'];
export const continuityLabels = {protocol:'研究方案',execution:'执行与结果',interpretation:'结果解释',insight:'外部建议',attachment:'附件'};
export const protocolFields = {question:'研究问题',objective:'本轮目标',design:'研究路线与方法',primaryOutcome:'主要结局／核心比较',secondaryOutcomes:'次要结局（每行一项）',analysisUnit:'分析单位',outcomeUnits:'结局单位（每行：名称：单位）',analysisPlan:'分析或综合方法',dataRequirements:'材料与数据需求',criteria:'范围与纳排标准',limitations:'限制与尚未明确',next:'下一项工作'};
export const recordFields = {text:'原始记录／结果内容',origin:'来自何处',performedBy:'实际执行者',performedAt:'实际发生时间（不知道可留空）',method:'实际方法／代码或命令',parameters:'关键参数',environment:'工具与环境版本',deviations:'与原方案的偏离',limitations:'局限与未知',next:'下一项工作'};
export const outputModes = {literature:'文献研究',proposal:'研究方案',results:'真实结果'};
const clone = v => structuredClone(v);
const list = v => Array.isArray(v) ? v : [];
export const itemRef = (item, revisionId=item.headRevisionId) => ({type:'research_item',id:item.id,revisionId});
export const sameRef = (a,b) => Boolean(a&&b&&a.type===b.type&&a.id===b.id&&a.revisionId===b.revisionId);
export function itemVersion(p, ref) {
  if(!ref) return null;
  const item=p.researchItems?.[ref.id??ref.itemId];
  const revision=item?.revisions?.find(r=>r.id===(ref.revisionId??ref.itemRevisionId??item.headRevisionId));
  return revision ? {item,revision,ref:itemRef(item,revision.id)} : null;
}
export function researchScope(p, artifactId) {
  let a=p.artifacts?.[artifactId]; const visited=new Set();
  while(a&&!visited.has(a.id)) {
    visited.add(a.id);
    const q=a.branchQuestion??a.researchContext?.question;
    if(q?.itemId) return {id:q.itemId,questionRef:{type:'research_item',id:q.itemId,revisionId:q.revisionId},artifactId};
    const ref=a.lineage??a.parent; a=p.artifacts?.[ref?.artifactId];
  }
  const q=p.researchKernel?.currentQuestion??p.researchKernel?.exploration;
  // Unbranched project records stay reachable when a first question is chosen.
  // Explicit topic branches above keep their own question-scoped records.
  return {id:p.id,questionRef:q?{type:'research_item',id:q.itemId,revisionId:q.revisionId}:null,artifactId};
}
export function continuityItems(p,artifactId) {
  const scope=researchScope(p,artifactId);
  return Object.values(p.researchItems??{}).filter(i=>continuityKinds.includes(i.kind)&&i.scopeId===scope.id);
}
function selected(p,ref) {
  const v=itemVersion(p,ref); if(!v)return null;
  return {ref:v.ref,kind:v.item.kind,title:v.revision.title,number:v.revision.number,payload:clone(v.revision.payload??{}),createdAt:v.revision.createdAt,decisionId:ref.decisionId??null};
}
export function continuitySnapshot(p,artifactId) {
  const scope=researchScope(p,artifactId),k=p.researchKernel??{};
  const protocol=selected(p,k.currentProtocols?.[scope.id]),result=selected(p,k.currentResults?.[scope.id]);
  const insights=Object.values(k.continuityChoices??{}).map(id=>p.decisions?.[id]).filter(d=>d?.choice==='adopt')
    .map(d=>selected(p,{...d.target,decisionId:d.id})).filter(v=>v?.kind==='insight'&&p.researchItems[v.ref.id]?.scopeId===scope.id);
  const records=(result?.kind==='execution'?[result]:list(result?.payload.inputRefs).map(ref=>selected(p,ref)).filter(r=>r?.kind==='execution')).map((r,i)=>({...r,label:`U${i+1}`}));
  return {scope,protocol,result,insights,records,refs:[scope.questionRef,protocol?.ref,result?.ref,...insights.map(i=>i.ref)].filter(Boolean),
    boundary:'方案采用、原始执行记录、AI解释与科学证据分别保留；附件存在不代表已读或已独立核验。'};
}
export function continuitySignature(snapshot) {
  return JSON.stringify({scope:snapshot?.scope?.id,refs:snapshot?.refs??[]});
}
export function hasContinuity(snapshot) { return Boolean(snapshot?.protocol||snapshot?.result||snapshot?.insights?.length); }
export function continuityContext(p,artifactId) {
  const snapshot=continuitySnapshot(p,artifactId);
  return hasContinuity(snapshot)?snapshot:null;
}
export function continuityChanged(p,artifactId,snapshot) {
  return continuitySignature(snapshot)!==continuitySignature(continuitySnapshot(p,artifactId));
}
export function taskInputsChanged(p,artifactId,input) {
  return Boolean(input.continuity&&continuityChanged(p,artifactId,input.continuity))
    || input.goal!==undefined&&input.goal!==p.goal
    || input.conditions!==undefined&&input.conditions!==p.conditions
    || input.notes!==undefined&&JSON.stringify(input.notes)!==JSON.stringify(p.artifacts?.[artifactId]?.draft?.notes);
}
export function selectedRecordText(p,snapshot) {
  const result=snapshot?.result;
  if(!result)return '';
  // An interpretation can use its exact raw execution inputs, never itself as
  // an observed fact. User supplied records retain that source attribution.
  const records=result.kind==='execution'?[result]:list(result.payload.inputRefs).map(r=>selected(p,r)).filter(r=>r?.kind==='execution');
  return records.map(r=>`【研究者提供的执行记录：${r.title}；版本 ${r.number}】\n${r.payload.text??''}`).join('\n\n');
}
export function protocolDraft(p,artifactId) {
  const scope=researchScope(p,artifactId),q=itemVersion(p,scope.questionRef),proposal=q?.revision.proposal??{};
  const str=v=>Array.isArray(v)?v.join('\n'):typeof v==='string'?v:'';
  return {title:proposal.paperTitle||'本课题研究方案',outputMode:'proposal',question:q?.revision.text??p.goal??'',objective:p.goal??'',design:str(proposal.design),primaryOutcome:str(proposal.primaryOutcome),secondaryOutcomes:'',analysisUnit:'',analysisPlan:str(proposal.analysisPlan),dataRequirements:str(proposal.dataRequirements),criteria:'',limitations:list(q?.revision.unknowns).join('\n'),next:'',inputRefs:[scope.questionRef].filter(Boolean)};
}
export function nestedRef(type,a,outlineId,sectionId,revisionId) {
  return {type,id:[a.id,outlineId,sectionId].filter(Boolean).join(':'),revisionId,artifactId:a.id,...(outlineId?{outlineId}:{}),...(sectionId?{sectionId}:{})};
}
export function resolveResearchRef(p,ref) {
  if(!ref)return null;
  if(ref.type==='research_item') {const v=itemVersion(p,ref);return v?{value:v.revision,title:v.revision.title||v.revision.text,artifactId:v.item.origin?.artifactId,kind:v.item.kind}:null;}
  if(ref.type==='access') {const a=p.accesses?.[ref.id];return a&&ref.revisionId===ref.id?{value:a,title:p.sources?.[a.sourceId]?.title,kind:'access'}:null;}
  const a=p.artifacts?.[ref.type==='artifact'?ref.id:ref.artifactId]; if(!a)return null;
  if(ref.type!=='artifact'&&ref.id!==nestedRef(ref.type,a,ref.type==='writing'?ref.outlineId:null,ref.type==='writing'?ref.sectionId:null,ref.revisionId).id)return null;
  if(ref.type==='artifact'){const v=a.revisions.find(r=>r.id===ref.revisionId);return v?{value:v,title:a.title,artifactId:a.id,kind:a.kind}:null;}
  const w=a.topicWorkspace;
  if(ref.type==='outline'){const v=w?.outlines?.find(o=>o.id===ref.revisionId);return v?{value:v,title:v.title,artifactId:a.id,kind:'outline'}:null;}
  if(ref.type==='writing'){const v=w?.writingWorkspaces?.[ref.outlineId]?.sections?.[ref.sectionId]?.versions.find(v=>v.id===ref.revisionId);return v?{value:v,title:`正文 ${ref.sectionId}`,artifactId:a.id,kind:'writing'}:null;}
  if(ref.type==='figure'){const v=w?.figures?.find(v=>v.id===ref.revisionId);return v?{value:v,title:v.spec?.title??v.title??'图稿',artifactId:a.id,kind:'figure'}:null;}
  return null;
}
export function referencedPayloads(p, refs) {
  return list(refs).map(ref=>{const v=resolveResearchRef(p,ref);return v?{ref,title:v.title,kind:v.kind,content:clone(v.value),available:true}:{ref,available:false};});
}
export function currentWork(p,artifactId) {
  const a=p.artifacts?.[artifactId],snapshot=continuitySnapshot(p,artifactId),q=itemVersion(p,snapshot.scope.questionRef);
  const relevantItems=continuityItems(p,artifactId),impacts=Object.values(p.researchImpacts??{}).filter(i=>['needs_review','deferred'].includes(i.status)&&i.artifactId===artifactId);
  const unknowns=[...new Set([...list(q?.revision.unknowns),snapshot.protocol?.payload.limitations,snapshot.result?.payload.limitations,a?.draft?.notes?.unknown].filter(Boolean))];
  const next=snapshot.result?.payload.next||snapshot.protocol?.payload.next||a?.draft?.notes?.next;
  return {snapshot,question:q?.revision.text??p.goal,questionAdopted:p.researchKernel?.currentQuestion?.itemId===q?.item.id&&p.researchKernel?.currentQuestion?.revisionId===q?.revision.id,
    unknowns,impacts,next:next||(!snapshot.protocol?'从已有认识整理一份方案，或继续讨论当前问题。':!snapshot.result?'按当前方案推进文献研究，或带回实际执行记录。':impacts.length?'查看变化影响，再继续解释和修订相关成果。':'结合当前结果和局限，继续讨论或更新正文与图表。'),
    nextReason:next?'来自已保存的下一步安排。':!snapshot.protocol?'当前还没有采用方案。':!snapshot.result?'方案已明确；实际执行与结果尚未关联。':impacts.length?'已有成果使用的依据发生了变化。':'当前采用与结果已有明确出处。',
    items:relevantItems,decisions:Object.values(p.decisions??{}).filter(d=>d.target?.itemId===snapshot.scope.id||relevantItems.some(i=>i.id===d.target?.id)).sort((a,b)=>(a.createdAt??'').localeCompare(b.createdAt??''))};
}
export function consistencyFindings(p,artifactId) {
  const a=p.artifacts?.[artifactId],snapshot=continuitySnapshot(p,artifactId),protocol=snapshot.protocol?.payload;
  if(!a||!protocol)return [];
  const labels=[...[protocol.primaryOutcome].filter(Boolean).map(name=>({name,role:'主要',opposite:/次要|secondary/i})),...String(protocol.secondaryOutcomes??'').split('\n').filter(Boolean).map(name=>({name,role:'次要',opposite:/主要|primary/i}))];
  const rows=[];
  for(const [outlineId,w] of Object.entries(a.topicWorkspace?.writingWorkspaces??{})) for(const [sectionId,s] of Object.entries(w.sections??{})) {
    const v=s.versions.find(v=>v.id===s.activeVersionId);if(!v)continue;
    v.paragraphs.forEach((paragraph,index)=>rows.push({target:nestedRef('writing',a,outlineId,sectionId,v.id),location:`${sectionId} · 第 ${index+1} 段`,text:paragraph.text}));
  }
  for(const v of a.topicWorkspace?.figures??[])rows.push({target:nestedRef('figure',a,null,null,v.id),location:v.spec?.title??v.title??'图稿',text:[v.spec?.title,v.spec?.caption,v.spec?.description,v.title,v.caption,v.xLabel,v.yLabel,v.scene?.caption,v.scene?.sourceText,...(v.scene?.nodes??[]).map(n=>n.label)].filter(Boolean).join('；')});
  const findings=[];
  for(const row of rows) for(const sentence of String(row.text??'').split(/[。；;\n]/u)) for(const label of labels) {
    if(sentence.includes(label.name)&&label.opposite.test(sentence))findings.push({...row,text:sentence,field:label.name,expected:label.role,protocolRef:snapshot.protocol.ref,explanation:`采用方案将“${label.name}”列为${label.role}，此处出现不同角色措辞，请核对上下文。`,verification:'literal_conflict_candidate_not_scientific_verdict'});
  }
  const unitRows=String(protocol.outcomeUnits??'').split('\n').map(line=>line.split(/[：:]/u)).filter(parts=>parts.length===2&&parts.every(v=>v.trim())).map(([name,unit])=>({name:name.trim(),unit:unit.trim()}));
  for(const row of rows)for(const unit of unitRows)for(const sentence of String(row.text??'').split(/[。；;\n]/u)) {
    if(!sentence.includes(unit.name))continue;
    const observed=[...sentence.matchAll(/\d+(?:\.\d+)?\s*(%|％|mmHg|mg\/dL|mmol\/L|kg|mg|mL|年|月|天|小时|分钟|years?|months?|days?|hours?)(?![a-zA-Z])/g)].map(m=>m[1]);
    for(const value of [...new Set(observed)])if(value!==unit.unit)findings.push({...row,text:sentence,field:unit.name,expected:unit.unit,protocolRef:snapshot.protocol.ref,explanation:`采用方案记为“${unit.name}：${unit.unit}”，此处出现“${value}”，请核对是否为同一指标及是否经过单位换算。`,verification:'literal_unit_candidate_not_scientific_verdict'});
  }
  return findings;
}
export function readableBatches(task) {
  return list(task?.paperBatchRecords).filter(r=>r.status==='completed'&&r.result).map(r=>({id:r.batchId,segments:r.segments,content:r.result.papers??r.result.records??r.result,complete:true}));
}
export function continuityMarkdown(entry) {
  const payload=entry.payload??entry.content?.payload??{};
  const fields=entry.kind==='protocol'?protocolFields:recordFields;
  return `# ${entry.title||continuityLabels[entry.kind]||'研究记录'}\n\n${Object.entries(fields).filter(([k])=>payload[k]).map(([k,label])=>`## ${label}\n\n${payload[k]}`).join('\n\n')}\n`;
}
