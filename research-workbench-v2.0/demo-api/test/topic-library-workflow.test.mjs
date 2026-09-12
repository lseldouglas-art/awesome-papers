import { outlineFixture } from './fixtures/outline.mjs';
import { RELEVANCE_VERSION, relevanceInstructions, mergeTopicClassifications, needsRelevanceReview } from '../../shared/topic-relevance.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { calibrationSummary, topicCategories, topicPaperIds, topicPlanningFeedback } from '../../shared/topic-library-workflow.mjs';
import { createPubmed } from '../src/pubmed.mjs';
import { validateScreening, editTopicWorkspace, topicWorkspace } from '../src/topic-library-workflow.mjs';
import { LocalStore } from '../src/store.mjs';
import { ResearchApplication } from '../src/research-application.mjs';
import { createWorkspace } from '../src/workspace.mjs';
import { upgradeProject } from '../src/progress.mjs';
import { ensureKernel, kernelCommand } from '../src/kernel.mjs';

const pmids=n=>Array.from({length:n},(_,i)=>String(i+1));
const preview={ids:pmids(20),total:1000,accessByPmid:Object.fromEntries(pmids(20).map(id=>[id,`a${id}`]))};
const classes=n=>Object.fromEntries(pmids(20).map((id,i)=>[`a${id}`,{relationship:i<n?'direct':'unrelated',criteriaVersion:RELEVANCE_VERSION,titleCheckVersion:'core-title-v1'}]));
test('pilot uses strict >10 boundary and reports unknown, incomplete and small samples separately',()=>{
  assert.equal(calibrationSummary(preview,classes(20)).state,'excellent');
  assert.equal(calibrationSummary(preview,classes(11)).state,'good');
  assert.equal(calibrationSummary(preview,classes(10)).state,'adjust');
  assert.equal(calibrationSummary({...preview,ids:pmids(7),total:7},classes(20)).state,'small');
  assert.equal(calibrationSummary({...preview,accessByPmid:{}},classes(20)).state,'incomplete');
  const notes=classes(14);notes.a20={relationship:'unclear',criteriaVersion:RELEVANCE_VERSION};
  assert.equal(calibrationSummary(preview,notes).label,'良好');
  assert.equal(calibrationSummary(preview,notes).unknown,1);
  assert.equal(calibrationSummary({...preview,ids:pmids(19)},classes(20)).state,'incomplete');
});
test('screening validates coverage and real passage identity without making inclusion choices',()=>{
  const m=[{ref:'R1',accessId:'a',sourceId:'s',text:'Actual title or abstract.',level:'abstract'}];
  const n={ref:'R1',relationship:'direct',summary:'本研究观察了成像方法。可为本题方法选择提供参考。',titleMatches:[],reason:'直接研究本题',passages:['P1'],categories:[{parent:'技术',child:'成像'}]};
  const result=validateScreening(JSON.stringify({papers:[n]}),m);
  assert.deepEqual(result[0].quotes,['Actual title or abstract.']);assert.equal(result[0].decision,undefined);
  assert.equal(validateScreening(JSON.stringify({papers:[{...n,passages:['P999']}]}),m)[0].needsReview,true);
  assert.throws(()=>validateScreening('{"papers":[]}',m),e=>e.code==='incomplete_paper_coverage');
  assert.equal(topicCategories(['a'],{a:{categories:[...n.categories,...n.categories]}})[0].ids.length,1);
});
test('publication partitions retain undated records and resumable PMID manifests beyond 10,000',async()=>{
  let calls=0;
  const api=createPubmed({intervalMs:0,fetchImpl:async url=>{
    calls++;const term=url.searchParams.get('term'),limit=Number(url.searchParams.get('retmax'));
    const unknown=term.includes(' NOT '), dated=term.includes('Date - Publication');
    const ids=unknown?['10001','10002']:pmids(dated?10000:10002);
    return new Response(JSON.stringify({esearchresult:{count:String(ids.length),idlist:ids.slice(0,limit)}}));
  }});
  let saved;const result=await api.planCollection('topic',{limit:'all',sort:'pub_date',onProgress:async state=>{saved=structuredClone(state);}});
  assert.equal(result.ids.length,10002);assert.equal(result.complete,true);assert.equal(result.partitions.at(-1).undated,true);
  const before=calls;const resumed=await api.planCollection('topic',{state:saved,sort:'pub_date',limit:'all'});assert.equal(calls,before);assert.deepEqual(resumed.ids,result.ids);
  await assert.rejects(()=>api.queryPage('topic',{offset:10000,limit:20}),e=>e.code==='invalid_scope');
  await assert.rejects(()=>api.planCollection('topic',{limit:500,sort:'relevance'}),e=>e.code==='retrieval_partition_sort');
});
test('missing IDs never turn a partial manifest into completed collection',async()=>{
  const api=createPubmed({intervalMs:0,fetchImpl:async url=>new Response(JSON.stringify({esearchresult:{count:'50',idlist:Number(url.searchParams.get('retmax'))?pmids(49):[]}}))});
  let saved;await assert.rejects(()=>api.planCollection('topic',{limit:'all',onProgress:async p=>{saved=structuredClone(p);}}),e=>e.code==='retrieval_manifest_incomplete');assert.equal(saved.complete,false);
});
async function fixture(t,{configured=true,failBatch=false,planResponse,failOutline=false}={}) {
  const directory=await mkdtemp(join(tmpdir(),'rw-topic-flow-')),store=await new LocalStore(directory).initialize();let calls=0,fail=failBatch;const planRequests=[];
  const record=id=>({pmid:id,title:`Engineering topic ${id}`,text:`Abstract about this topic ${id}.`,level:'abstract',year:'2025',authors:[]});
  const service=await new ResearchApplication(store,{pubmed:{queryPage:async()=>({total:150,ids:pmids(20),queryTranslation:'topic',warnings:null}),metadata:async ids=>{if(fail&&ids.includes('101')){fail=false;throw Error('temporary fixture failure');}return ids.filter(id=>id!=='19').map(record);},planCollection:async(query,o)=>{const plan={query,sort:o.sort,total:150,target:150,ids:pmids(150),complete:true};await o.onProgress(plan);return plan;}},modelFactory:()=>({generate:async({materials,instruction})=>{calls++;assert.ok(materials.every(m=>Object.keys(m).every(k=>['sourceId','accessId','text','ref','title','authors','year','pmid','level'].includes(k))));if(instruction.includes('topic-outline-v2')){if(failOutline){failOutline=false;throw Error('outline interrupted');}const papers=JSON.parse(instruction.split('全部所选文献的已保存记录（继承发现与定位，不重发原始摘要）：')[1]);return {text:JSON.stringify(outlineFixture(papers)),provenance:{provider:'test.invalid',model:'fixture'},usage:{total_tokens:10},cost:{status:'not_applicable',amount:0}};}if(instruction.includes('options:[')){planRequests.push(instruction);return {text:planResponse??JSON.stringify({options:[{label:'核心',groups:[{label:'对象',query:'topic[tiab]',core:true},{label:'技术',query:'imaging[tiab]',core:true}],reason:'补全技术词',tradeoff:'待校准'},{label:'放宽',groups:[{label:'对象',query:'topic[tiab]',core:true},{label:'技术',query:'imaging[tiab]',core:true},{label:'场景',query:'clinical[tiab]',core:false}],reason:'检查场景边界',tradeoff:'待校准'}]}),usage:{total_tokens:10},cost:{status:'not_applicable',amount:0},provenance:{provider:'test.invalid',model:'fixture'}};}return {text:JSON.stringify({papers:materials.map(m=>({ref:m.ref,relationship:'direct',summary:'工程材料描述了成像专题。其研究对象与本题相同。',titleMatches:[],reason:'材料主题直接对应所选问题',passages:['P1'],categories:[{parent:'技术与方法',child:'成像'}]}))}),usage:{total_tokens:10},cost:{status:'unknown',amount:null},provenance:{provider:'test.invalid',model:'fixture'}};}})}).initialize();
  if(configured)await service.settings.save({baseUrl:'https://test.invalid/v1',model:'fixture',apiKey:'isolated-key',enabled:true});
  t.after(async()=>{await service.close();await store.close();});
  const p=await store.update(s=>{
    const p=ensureKernel(upgradeProject(createWorkspace(s,{name:'工程隔离',goal:'专题建库'},randomUUID()),false)),a=Object.values(p.artifacts)[0];
    a.kind='topic_library';a.branchQuestion={itemId:'q',revisionId:'qr'};a.lineage={artifactId:a.id,revisionId:a.headRevisionId};
    p.researchItems.q={id:'q',kind:'question',headRevisionId:'qr',revisions:[{id:'qr',number:1,text:'研究本题成像方法',title:'成像专题',scope:'本题',evidenceIds:[],unknowns:[],feasibility:{known:[],unknown:[]}}]};
    a.draft.resultId='library';p.researchResults.library={id:'library',artifactId:a.id,kind:'topic_library',blocks:[],citations:[],accessIds:[],library:{entries:[],searchIds:[]}};
    return p;
  });const a=Object.values(p.artifacts)[0];
  const run=async(mode,extra={})=>{const latest=await store.read(s=>s.projects[p.id].artifacts[a.id]);const started=await service.start(p.id,{artifactId:a.id,baseVersion:latest.draft.version,mode,query:'topic',accessIds:[],...extra},randomUUID());await service.running.get(started.taskId)?.promise;return store.read(s=>s.projects[p.id].researchTasks[started.taskId]);};
  return {p,a,store,service,run,calls:()=>calls,planRequests};
}
test('pilot preserves original first20 including failed retrieval, models only actual records, and does not auto-adopt',async t=>{
  const f=await fixture(t);const task=await f.run('topic-preview');assert.equal(task.status,'completed',task.error);
  const p=await f.store.read(s=>s.projects[f.p.id]),a=p.artifacts[f.a.id],w=a.topicWorkspace;
  assert.equal(w.previews[0].ids[18],'19');assert.equal(w.previews[0].missingIds[0],'19');assert.equal(a.draft.sourceAccessIds.length,19);assert.equal(Object.keys(w.screenings).length,19);assert.equal(p.researchResults.library.library.entries.length,0);
  assert.equal(calibrationSummary(w.previews[0],w.screenings).state,'incomplete');assert.equal(f.calls(),1);
  assert.equal(task.model,'fixture');assert.ok(task.toolRuns.some(t=>t.name==='PubMed.queryPage'));
});
test('pilot supports manual review when no model is configured',async t=>{const f=await fixture(t,{configured:false});const task=await f.run('topic-preview');assert.equal(task.status,'completed',task.error);assert.equal(f.calls(),0);});
test('collect exceeds40, keeps failed batches and resumes only uncollected IDs without adopting',async t=>{
  const f=await fixture(t,{configured:false,failBatch:true}),options={limit:500,sort:'pub_date',from:'',to:''};
  const first=await f.run('topic-collect',{topicOptions:options});assert.equal(first.status,'failed');
  let a=await f.store.read(s=>s.projects[f.p.id].artifacts[f.a.id]);assert.equal(a.draft.sourceAccessIds.length,99);
  const second=await f.run('topic-collect',{topicOptions:{...options,resumeId:first.collectionId}});assert.equal(second.status,'completed',second.error);
  a=await f.store.read(s=>s.projects[f.p.id].artifacts[f.a.id]);assert.equal(a.draft.sourceAccessIds.length,149);assert.equal(a.topicWorkspace.collections.length,1);assert.deepEqual(a.topicWorkspace.collections[0].failedIds,['19']);assert.equal(a.topicWorkspace.collections[0].status,'incomplete');assert.equal(f.calls(),0);
  const snapshot=await f.store.read(s=>s.projects[f.p.id]);assert.equal(snapshot.researchResults.library.library.entries.length,0);
});
test('human correction, multi-label rename, scope save and restore preserve prior material snapshots',async t=>{
  const f=await fixture(t);await f.run('topic-preview');
  await f.store.update(s=>{
    const p=s.projects[f.p.id],a=p.artifacts[f.a.id],w=topicWorkspace(a),id=a.draft.sourceAccessIds[0];
    const edit=body=>editTopicWorkspace(p,a,{baseWorkspaceVersion:w.version,...body},randomUUID());
    edit({action:'override',accessId:id,relationship:'indirect',summary:'本文比较了相邻成像方法。可为本题提供方法参照。',reason:'仅作为方法参照',categories:[{parent:'技术',child:'旧成像'}]});
    edit({action:'rename-category',parent:'技术',child:'旧成像',nextParent:'技术',nextChild:'成像'});
    kernelCommand(s,p.id,'update-topic-library',{artifactId:a.id,baseVersion:a.draft.version,decisions:[{accessId:id,decision:'included',reason:'保留方法参照'}]},randomUUID());
    edit({action:'snapshot',name:'首轮范围'});const saved=structuredClone(w.snapshots[0]),oldResultId=a.draft.resultId;
    kernelCommand(s,p.id,'update-topic-library',{artifactId:a.id,baseVersion:a.draft.version,decisions:[{accessId:id,decision:'excluded',reason:'后续复核'}]},randomUUID());
    kernelCommand(s,p.id,'update-topic-workspace',{artifactId:a.id,baseWorkspaceVersion:w.version,action:'restore',snapshotId:saved.id},randomUUID());
    assert.equal(p.researchResults[a.draft.resultId].library.entries.find(e=>e.accessId===id).decision,'included');
    assert.equal(p.researchResults[oldResultId].library.entries.find(e=>e.accessId===id).decision,'included');
    assert.deepEqual(w.snapshots[0],saved);assert.equal(w.snapshots.length,2);assert.equal(w.overrides[id].relationship,'indirect');assert.equal(w.overrides[id].categories[0].child,'成像');
    assert.throws(()=>editTopicWorkspace(p,a,{baseWorkspaceVersion:0,action:'snapshot',name:'stale'},randomUUID()),e=>e.code==='draft_conflict');
  });
});

test('one paper with newer access snapshots counts once and retains the human-included version',()=>{
 const p={sources:{s:{id:'s',pmid:'12'},s2:{id:'s2',pmid:'12'}},accesses:{old:{sourceId:'s',level:'abstract'},new:{sourceId:'s2',level:'abstract'}}};
 assert.deepEqual(topicPaperIds(p,['old','new']),['new']);
 assert.deepEqual(topicPaperIds(p,['old','new'],[{accessId:'old',decision:'included'}]),['old']);
});


test('search repair receives exact calibration, human overrides and date scope without importing unrelated material',async t=>{
  const f=await fixture(t);await f.run('topic-preview');
  await f.store.update(s=>{const p=s.projects[f.p.id],a=p.artifacts[f.a.id],w=a.topicWorkspace,id=w.previews[0].accessByPmid['1'];w.overrides[id]={relationship:'indirect',reason:'人的核对：研究的是相邻成像技术',quotes:['Actual selected quotation'],actor:'local_user'};w.collections.push({id:'empty',query:'topic',options:{from:'2026-09-10',to:'2026-09-10',sort:'pub_date',limit:500},plan:{total:0},accessIds:[],status:'completed'});});
  const task=await f.run('topic-plan',{text:'相关文献太少，请放宽次要限制',topicOptions:{from:'2026-09-10',to:'2026-09-10'}});
  assert.equal(task.status,'completed',task.error);
  const feedback=task.input.searchFeedback;
  assert.equal(feedback.calibration.samples.length,20);
  assert.equal(feedback.calibration.samples[0].relationship,'indirect');
  assert.equal(feedback.calibration.samples[0].actor,'local_user');
  assert.equal(feedback.calibration.samples[18].level,'not_accessed');
  assert.equal(feedback.lastCollection.total,0);
  assert.equal(feedback.collectionScope.from,'2026-09-10');
  assert.equal(task.input.materials.length,0);
  assert.ok(f.planRequests[0].includes('人的核对：研究的是相邻成像技术'));
  assert.ok(f.planRequests[0].includes('相关文献太少，请放宽次要限制'));
  assert.ok(f.planRequests[0].includes('不把零结果误判为原式无效'));
  await f.store.update(s=>{const w=s.projects[f.p.id].artifacts[f.a.id].topicWorkspace;w.overrides[w.previews[0].accessByPmid['1']]={reason:'later edit'};});
  assert.deepEqual((await f.store.read(s=>s.projects[f.p.id].researchTasks[task.id])).input.searchFeedback,feedback);
});

test('an edited uncalibrated query never inherits another query’s score',async t=>{
  const f=await fixture(t);await f.run('topic-preview');
  const p=await f.store.read(s=>s.projects[f.p.id]);
  const feedback=topicPlanningFeedback(p,p.artifacts[f.a.id],'changed query');
  assert.equal(feedback.calibration,null);assert.equal(feedback.lastCollection,null);
  assert.equal(feedback.recentCalibrations[0].query,'topic');
  assert.equal(feedback.recentCalibrations[0].size,20);
});


test('compact plans expand shared core groups while preserving different optional scopes',async t=>{
  const coreGroups=[{label:'对象',query:'topic[tiab]',core:true},{label:'技术',query:'imaging[tiab]',core:true}];
  const f=await fixture(t,{planResponse:JSON.stringify({coreGroups,options:[{label:'核心',groups:[],reason:'保留核心',tradeoff:'需校准'},{label:'临床场景',groups:[{label:'场景',query:'clinical[tiab]',core:false}],reason:'增加临床场景',tradeoff:'可能遗漏非临床材料'}]})});
  const task=await f.run('topic-plan');assert.equal(task.status,'completed',task.error);
  const plans=await f.store.read(s=>s.projects[f.p.id].artifacts[f.a.id].topicWorkspace.plans);
  assert.equal(plans[0].query,'(topic[tiab]) AND (imaging[tiab])');assert.equal(plans[1].groups.length,3);assert.deepEqual(plans[0].groups,coreGroups);
});


test('A+B+C all count as related; legacy calibration history retains its original meaning',()=>{
  const notes=classes(0);
  for(let i=1;i<=20;i++)notes[`a${i}`].relationship=i<=3?'direct':i<=11?'indirect':'peripheral';
  const now=calibrationSummary(preview,notes);
  assert.equal(now.state,'excellent');assert.equal(now.relevant,20);
  assert.deepEqual(now.counts,{direct:3,indirect:8,peripheral:9,unrelated:0,unclear:0});
  notes.a20.relationship='unrelated';assert.equal(calibrationSummary(preview,notes).relevant,19);
  const old=Object.fromEntries(Object.entries(notes).map(([id,{criteriaVersion,...n}])=>[id,n]));
  assert.equal(calibrationSummary(preview,old).state,'legacy');
  assert.equal(calibrationSummary(preview,old,{historical:true}).relevant,3);
  assert.equal(calibrationSummary(preview,old,{historical:true}).state,'adjust');
});

test('screening preserves title-only C, requires findings and rejects D with a real core title match',()=>{
  const materials=[{ref:'R1',accessId:'a',sourceId:'s',title:'Artificial intelligence for colonic lesions',text:'Artificial intelligence for colonic lesions',level:'title'}];
  const n={ref:'R1',relationship:'peripheral',summary:'题名涉及人工智能识别结肠病变，可为本题的人工智能技术提供桥接线索。仅题名，关键发现未知。',reason:'只命中人工智能概念，场景不同，暂作背景参照。',titleMatches:[{concept:'人工智能',term:'Artificial intelligence'}],passages:['P1'],categories:[]};
  const validate=note=>validateScreening(JSON.stringify({papers:[note]}),materials);
  const [note]=validate(n);assert.equal(note.relationship,'peripheral');assert.equal(note.criteriaVersion,RELEVANCE_VERSION);assert.equal(note.level,'title');
  assert.equal(validate({...n,relationship:'unrelated'})[0].relationship,'unclear');
  assert.deepEqual(validate({...n,titleMatches:[{concept:'胃癌',term:'gastric cancer'}]})[0].titleMatches,[]);
  assert.equal(validate({...n,summary:''})[0].needsReview,true);
  assert.equal(validate({...n,summary:'第一句。第二句。第三句。'})[0].summary,'第一句。第二句；第三句。');
  assert.equal(validate({...n,relationship:'unclear',titleMatches:[],summary:'仅有题名且术语含义不明，关键发现未知。',passages:[]})[0].relationship,'unclear');
  assert.ok(relevanceInstructions.includes('至少 C'));assert.ok(relevanceInstructions.includes('标题未命中时继续依据实际摘要'));
});

test('new AI findings do not replace human grades; taxonomy-only edits do not block reclassification',()=>{
  const current={relationship:'peripheral',criteriaVersion:RELEVANCE_VERSION,summary:'同一疾病背景，可作桥接。',categories:[]};
  const human={relationship:'unrelated',actor:'local_user',reason:'旧人工判定'};
  const merged=mergeTopicClassifications({a:current},{a:human});
  assert.equal(merged.a.relationship,'unrelated');assert.equal(merged.a.modelSuggestion.summary,current.summary);assert.equal(needsRelevanceReview(merged.a),true);
  const taxonomy={relationship:'unrelated',actor:'model',categoryActor:'local_user',categories:[{parent:'技术',child:'成像'}]};
  const fixed=mergeTopicClassifications({a:current},{a:taxonomy}).a;
  assert.equal(fixed.relationship,'peripheral');assert.deepEqual(fixed.categories,taxonomy.categories);
});

test('old screening records are re-evaluated once, archived, and leave human inclusion unchanged',async t=>{
  const f=await fixture(t);await f.run('topic-preview');
  let ids,original;
  await f.store.update(s=>{const p=s.projects[f.p.id],a=p.artifacts[f.a.id],w=a.topicWorkspace;ids=a.draft.sourceAccessIds;original=structuredClone(w.previews[0].initialClassifications);for(const n of Object.values(w.screenings)){delete n.criteriaVersion;delete n.summary;}kernelCommand(s,p.id,'update-topic-library',{artifactId:a.id,baseVersion:a.draft.version,decisions:[{accessId:ids[0],decision:'included',reason:'人的纳入决定'}]},randomUUID());});
  const rerun=await f.run('topic-screen',{accessIds:ids});assert.equal(rerun.status,'completed',rerun.error);assert.equal(f.calls(),2);
  const p=await f.store.read(s=>s.projects[f.p.id]),a=p.artifacts[f.a.id],w=a.topicWorkspace;
  assert.equal(w.screeningHistory.length,ids.length);assert.ok(Object.values(w.screenings).every(n=>n.summary&&n.criteriaVersion===RELEVANCE_VERSION));
  assert.deepEqual(w.previews[0].initialClassifications,original);assert.equal(p.researchResults[a.draft.resultId].library.entries[0].decision,'included');
  await f.run('topic-screen',{accessIds:ids});assert.equal(f.calls(),2);
});

test('outline reuses findings, supplements only added papers, caches identical inputs and preserves human confirmation',async t=>{
  const f=await fixture(t);await f.run('topic-preview');
  const ids=await f.store.update(s=>{const p=s.projects[f.p.id],a=p.artifacts[f.a.id];const ids=a.draft.sourceAccessIds.slice(0,2);kernelCommand(s,p.id,'update-topic-library',{artifactId:a.id,baseVersion:a.draft.version,decisions:ids.map(accessId=>({accessId,decision:'included',reason:'认可'}))},randomUUID());return ids;});
  const first=await f.run('topic-outline',{accessIds:ids});assert.equal(first.status,'completed',first.error);assert.equal(f.calls(),2);assert.deepEqual(first.outlineReuse,{selected:2,reused:2,supplement:0});
  const again=await f.run('topic-outline',{accessIds:ids});assert.equal(again.status,'completed',again.error);assert.equal(again.reusedOutlineId,first.outlineId);assert.equal(f.calls(),2);
  await f.store.update(s=>{const p=s.projects[f.p.id],a=p.artifacts[f.a.id],w=a.topicWorkspace;editTopicWorkspace(p,a,{baseWorkspaceVersion:w.version,action:'confirm-outline',outlineId:first.outlineId,accessIds:ids},randomUUID());assert.equal(w.confirmedOutlineId,first.outlineId);editTopicWorkspace(p,a,{baseWorkspaceVersion:w.version,action:'override',accessId:ids[0],relationship:'peripheral',summary:'本文可提供背景信息。',reason:'弱背景',categories:[]},randomUUID());assert.throws(()=>editTopicWorkspace(p,a,{baseWorkspaceVersion:w.version,action:'confirm-outline',outlineId:first.outlineId,accessIds:ids},randomUUID()),e=>e.code==='stale_outline');});
  const changed=await f.run('topic-outline',{accessIds:ids});assert.equal(changed.status,'completed',changed.error);assert.notEqual(changed.outlineId,first.outlineId);assert.equal(f.calls(),3);assert.equal(changed.outlineReuse.supplement,0);
  const extended=await f.store.update(s=>{const p=s.projects[f.p.id],a=p.artifacts[f.a.id],w=a.topicWorkspace,id=a.draft.sourceAccessIds[2];delete w.screenings[id];kernelCommand(s,p.id,'update-topic-library',{artifactId:a.id,baseVersion:a.draft.version,decisions:[{accessId:id,decision:'included',reason:'新增'}]},randomUUID());return [...ids,id];});
  const added=await f.run('topic-outline',{accessIds:extended});assert.equal(added.status,'completed',added.error);assert.equal(added.outlineReuse.supplement,1);assert.equal(f.calls(),5);
  const p=await f.store.read(s=>s.projects[f.p.id]),w=p.artifacts[f.a.id].topicWorkspace;assert.equal(w.outlines.length,3);assert.equal(w.confirmedOutlineId,first.outlineId);assert.equal(w.overrides[ids[0]].relationship,'peripheral');assert.equal(w.outlines[0].status,'proposed');
});

test('outline rejects fabricated anchors, D support and strong C use; keeps zero-evidence needs',async()=>{
  const {validateOutline}=await import('../src/topic-outline.mjs');
  const rows=[{ref:'R1',accessId:'a',sourceId:'s',level:'abstract',note:{relationship:'peripheral'},passages:[{id:'P1',text:'Actual source.',start:0,end:14}]}];
  const data=outlineFixture([{ref:'R1',relationship:'peripheral',passages:[{id:'P1'}]}]);
  assert.equal(validateOutline(JSON.stringify(data),rows).citations[0].quote,'Actual source.');
  data.sections[0].children[0].evidence[0].role='direct';assert.throws(()=>validateOutline(JSON.stringify(data),rows),e=>e.code==='invalid_citation');
  data.sections[0].children[0].evidence[0].role='background';rows[0].note.relationship='unrelated';assert.throws(()=>validateOutline(JSON.stringify(data),rows),e=>e.code==='invalid_citation');
  rows[0].note.relationship='direct';data.sections[0].children[0].evidence[0].passage='P99';assert.throws(()=>validateOutline(JSON.stringify(data),rows),e=>e.code==='invalid_citation');
  data.sections[0].children[0].evidence=[];data.sections[0].children[0].argument.forEach(a=>a.refs=[]);data.sections[0].children[0].needs=['真实实施记录'];assert.equal(validateOutline(JSON.stringify(data),rows).citations.length,0);
});

test('failed outline compilation resumes from saved supplements without re-screening',async t=>{
  const f=await fixture(t,{failOutline:true});await f.run('topic-preview');
  const ids=await f.store.update(s=>{const p=s.projects[f.p.id],a=p.artifacts[f.a.id],ids=a.draft.sourceAccessIds.slice(0,2);delete a.topicWorkspace.screenings[ids[1]];kernelCommand(s,p.id,'update-topic-library',{artifactId:a.id,baseVersion:a.draft.version,decisions:ids.map(accessId=>({accessId,decision:'included',reason:'认可'}))},randomUUID());return ids;});
  const first=await f.run('topic-outline',{accessIds:ids});assert.equal(first.status,'failed');assert.equal(first.screenedCount,1);assert.equal(f.calls(),3);
  const retry=await f.run('topic-outline',{accessIds:ids});assert.equal(retry.status,'completed',retry.error);assert.equal(retry.outlineReuse.supplement,0);assert.equal(f.calls(),4);
});


test('outline requires argument depth and local evidence use; export preserves every planned field',async()=>{
  const {validateOutline,outlineInstruction}=await import('../src/topic-outline.mjs');
  const {outlineMarkdown,outlineContext,OUTLINE_VERSION}=await import('../../shared/topic-outline.mjs');
  const rows=[{ref:'R1',accessId:'a',sourceId:'s',title:'Title',level:'abstract',note:{relationship:'direct'},summary:'Saved finding',passages:[{id:'P1',text:'Actual source.',start:0,end:14}]}];
  const data=outlineFixture([{ref:'R1',relationship:'direct',passages:[{id:'P1'}]}]);
  for(const field of ['question','claim','counterpoint','transition']) {const incomplete=structuredClone(data);delete incomplete.sections[0].children[0][field];assert.throws(()=>validateOutline(JSON.stringify(incomplete),rows),e=>e.code==='model_structure');}
  const shallow=structuredClone(data);shallow.sections[0].children[0].argument=[];assert.throws(()=>validateOutline(JSON.stringify(shallow),rows),e=>e.code==='model_structure');
  const forged=structuredClone(data);forged.sections[0].children[0].argument[0].refs=['R999'];assert.throws(()=>validateOutline(JSON.stringify(forged),rows),e=>e.code==='invalid_citation');
  const unmapped=structuredClone(data);delete unmapped.sections[0].children[0].evidence[0].use;assert.throws(()=>validateOutline(JSON.stringify(unmapped),rows),e=>e.code==='model_structure');
  const parsed=validateOutline(JSON.stringify(data),rows),md=outlineMarkdown({...parsed,id:'version',at:'date',papers:rows});
  for(const text of [data.positioning.contribution,data.sections[0].children[0].question,data.sections[0].children[0].argument[1].point,data.sections[0].children[0].counterpoint,data.sections[0].children[0].transition,data.sections[0].children[0].evidence[0].use])assert.ok(md.includes(text));
  const instruction=outlineInstruction({},rows);assert.ok(instruction.includes('Saved finding'));assert.ok(!instruction.includes('Actual source.'));assert.ok(instruction.includes('不能虚构期刊要求'));assert.ok(instruction.includes('外部论文不能冒充本研究数据'));
  assert.equal(outlineContext({}).version,OUTLINE_VERSION);assert.equal(outlineContext({},'topic-outline-v1').version,'topic-outline-v1');
});

test('previous outline contract stays confirmable while new compilation upgrades without re-screening',async t=>{
  const {outlineFingerprint}=await import('../src/topic-outline.mjs');
  const {outlineMaterials,currentOutlineContext}=await import('../../shared/topic-outline.mjs');
  const f=await fixture(t);await f.run('topic-preview');
  const ids=await f.store.update(s=>{const p=s.projects[f.p.id],a=p.artifacts[f.a.id],ids=a.draft.sourceAccessIds.slice(0,2);kernelCommand(s,p.id,'update-topic-library',{artifactId:a.id,baseVersion:a.draft.version,decisions:ids.map(accessId=>({accessId,decision:'included',reason:'认可'}))},randomUUID());return ids;});
  const first=await f.run('topic-outline',{accessIds:ids});
  await f.store.update(s=>{const p=s.projects[f.p.id],a=p.artifacts[f.a.id],w=a.topicWorkspace,o=w.outlines[0];o.framework='topic-outline-v1';o.context.version='topic-outline-v1';delete o.positioning;o.sections.forEach(s=>s.children.forEach(c=>{for(const k of ['question','claim','argument','counterpoint','transition'])delete c[k];c.evidence.forEach(e=>delete e.use);}));o.inputFingerprint=outlineFingerprint(currentOutlineContext(p,a,o.context.request),outlineMaterials(p,a,ids),'topic-outline-v1');editTopicWorkspace(p,a,{baseWorkspaceVersion:w.version,action:'confirm-outline',outlineId:o.id,accessIds:ids},randomUUID());});
  const next=await f.run('topic-outline',{accessIds:ids});assert.equal(next.status,'completed',next.error);assert.equal(next.outlineReuse.supplement,0);assert.notEqual(next.outlineId,first.outlineId);assert.equal(f.calls(),3);
  const w=await f.store.read(s=>s.projects[f.p.id].artifacts[f.a.id].topicWorkspace);assert.equal(w.confirmedOutlineId,first.outlineId);assert.equal(w.outlines[0].framework,'topic-outline-v1');assert.equal(w.outlines[1].framework,'topic-outline-v2');
});

test('outline normalizes figure plan text and retains explicit argument sources without inventing papers',async()=>{
  const {validateOutline}=await import('../src/topic-outline.mjs');
  const rows=['R1','R2'].map((ref,i)=>({ref,accessId:'a'+i,sourceId:'s'+i,level:'abstract',note:{relationship:i?'peripheral':'direct'},passages:[{id:'P1',text:'Saved source '+i,start:0,end:14}]}));
  const data=outlineFixture([{ref:'R1',relationship:'direct',passages:[{id:'P1'}]}]),c=data.sections[0].children[0];
  c.figures=[{plan:'图表计划原文'}];c.argument[1].refs=['R2'];
  const parsed=validateOutline(JSON.stringify(data),rows),child=parsed.sections[0].children[0];
  assert.equal(child.figures[0],'图表计划原文');assert.equal(child.evidence[1].ref,'R2');assert.equal(child.evidence[1].quote,'Saved source 1');assert.equal(child.evidence[1].use,c.argument[1].point);assert.equal(child.evidence[1].role,'background');assert.equal(child.evidence[1].mappedFrom,'argument');
  assert.deepEqual(parsed.formatNormalization,['figure_plan_to_text','argument_ref_to_saved_evidence']);
  c.argument[1].refs=['R999'];assert.throws(()=>validateOutline(JSON.stringify(data),rows),e=>e.code==='invalid_citation');
});

test('a bad paper is isolated while C and D survive the same batch; no invented citation is retained',()=>{
 const materials=['a','b','c'].map((id,i)=>({ref:`R${i+1}`,accessId:id,sourceId:'s'+id,title:'Actual imaging title',text:'Saved abstract.',level:'abstract'}));
 const note={relationship:'peripheral',summary:'研究背景可为本题提供参考。',reason:'背景关联。',titleMatches:[{concept:'imaging',term:'not in title'}],passages:['P1'],categories:[]};
 const result=validateScreening(JSON.stringify({papers:[{...note,ref:'R1'},{...note,ref:'R2',relationship:'direct',passages:['P999']},{...note,ref:'R3',relationship:'unrelated',titleMatches:[]}]}),materials);
 assert.deepEqual(result.map(n=>n.relationship),['peripheral','unclear','unrelated']);assert.deepEqual(result[1].quotes,[]);assert.equal(result[1].needsReview,true);assert.deepEqual(result[0].quotes,['Saved abstract.']);
});

test('grade selection includes ABC, defaults D to excluded, leaves unknown, and undo preserves later individual edits',async t=>{
 const {applyTopicScreeningPolicy}=await import('../src/kernel.mjs');
 const f=await fixture(t);await f.run('topic-preview');
 await f.store.update(state=>{
  const p=state.projects[f.p.id],a=p.artifacts[f.a.id],w=a.topicWorkspace,ids=a.draft.sourceAccessIds.slice(0,5);
  ['direct','indirect','peripheral','unrelated','unclear'].forEach((relationship,i)=>w.screenings[ids[i]]={...w.screenings[ids[i]],relationship});
  const edit=body=>kernelCommand(state,p.id,'update-topic-workspace',{artifactId:a.id,baseWorkspaceVersion:w.version,...body},randomUUID());
  edit({action:'screening-policy',includeRelations:['direct','indirect','peripheral']});
  let entries=p.researchResults[a.draft.resultId].library.entries;
  assert.deepEqual(ids.map(id=>entries.find(e=>e.accessId===id).decision),['included','included','included','excluded','pending']);
  const change=w.policyChanges.at(-1);
  kernelCommand(state,p.id,'update-topic-library',{artifactId:a.id,baseVersion:a.draft.version,decisions:[{accessId:ids[3],decision:'included',reason:'逐篇特例'}]},'individual');
  applyTopicScreeningPolicy(p,a,'subsequent-batch');
  assert.equal(p.researchResults[a.draft.resultId].library.entries.find(e=>e.accessId===ids[3]).decision,'included');
  edit({action:'undo-screening-policy',changeId:change.id});
  entries=p.researchResults[a.draft.resultId].library.entries;
  assert.equal(entries.find(e=>e.accessId===ids[0]).decision,'pending');assert.equal(entries.find(e=>e.accessId===ids[3]).reason,'逐篇特例');
  edit({action:'screening-policy',includeRelations:['direct']});
  entries=p.researchResults[a.draft.resultId].library.entries;
  assert.equal(entries.find(e=>e.accessId===ids[2]).decision,'pending');assert.equal(entries.find(e=>e.accessId===ids[3]).decision,'excluded');
 });
});

test('failed screening recovery uses exact stored requests, preserves valid C, and rejects changed/cancelled inputs',async()=>{
 const {recoverFailedScreenings}=await import('../src/topic-library-workflow.mjs');const {createHash}=await import('node:crypto');
 const material={ref:'R1',accessId:'a',sourceId:'s',title:'Actual title',text:'Actual text.',level:'abstract'};
 const input={itemTarget:{text:'Current question'},goal:'goal',conditions:'',notes:{},materials:[material]};
 const note={ref:'R1',relationship:'peripheral',summary:'本篇提供相关背景。',reason:'背景用途。',titleMatches:[],passages:['P1'],categories:[]};
 const stored={instruction:'Original instruction',materials:[material]},hash=createHash('sha256').update(JSON.stringify(stored)).digest('hex');
 const p={id:'p',researchTasks:{old:{id:'old',artifactId:'a',status:'failed',input}},researchEvents:[]},a={id:'a'},task={id:'new',input};
 const call={id:'call',projectId:'p',taskId:'old',purpose:'model.topic-screen',status:'completed',startedAt:'2026-09-10',screeningInput:stored,promptFingerprint:hash,outputText:JSON.stringify({papers:[note]})};
 assert.equal(recoverFailedScreenings({modelCalls:[call]},p,a,task),1);assert.equal(a.topicWorkspace.screenings.a.relationship,'peripheral');
 assert.equal(recoverFailedScreenings({modelCalls:[call]},p,a,task),0);
 assert.equal(recoverFailedScreenings({modelCalls:[{...call,screeningInput:{...stored,instruction:'Tampered'}}]},p,{id:'a'},task),0);
 assert.equal(recoverFailedScreenings({modelCalls:[call]},p,{id:'a'},{...task,input:{...input,materials:[{...material,text:'Different text'}]}}),0);
 p.researchTasks.old.status='cancelled';assert.equal(recoverFailedScreenings({modelCalls:[call]},p,{id:'a'},task),0);
});

test('changing a single grade to D applies its exclusion without reapplying decisions to other papers',async t=>{
 const f=await fixture(t);await f.run('topic-preview');
 await f.store.update(s=>{const p=s.projects[f.p.id],a=p.artifacts[f.a.id],ids=a.draft.sourceAccessIds.slice(0,2);
 kernelCommand(s,p.id,'update-topic-library',{artifactId:a.id,baseVersion:a.draft.version,decisions:ids.map(accessId=>({accessId,decision:'included'}))},randomUUID());
 kernelCommand(s,p.id,'update-topic-workspace',{artifactId:a.id,baseWorkspaceVersion:a.topicWorkspace.version,action:'override',accessId:ids[0],relationship:'unrelated',summary:'本篇研究与专题无实质关联。',reason:'与本题无关。',categories:[]},randomUUID());
 const entries=p.researchResults[a.draft.resultId].library.entries;
 assert.deepEqual(ids.map(id=>entries.find(e=>e.accessId===id).decision),['excluded','included']);
 });
});

test('a D cannot omit an actual core term or a broad AI method; words alone never promote a grade',()=>{
 const m={ref:'R1',accessId:'a',sourceId:'s',title:'A deep CNN model in wireless capsule endoscopy',text:'Actual abstract.',level:'abstract'};
 const n={ref:'R1',relationship:'unrelated',summary:'本篇使用深度学习方法。',reason:'认为场景不同。',titleMatches:[],passages:['P1'],categories:[]};
 const groups=[{core:true,label:'人工智能',query:'artificial intelligence[tiab] OR deep learning[tiab]'}];
 assert.equal(validateScreening(JSON.stringify({papers:[n]}),[m],groups)[0].relationship,'unclear');
 assert.equal(validateScreening(JSON.stringify({papers:[n]}),[m],[{label:'其他主题',query:'unrelated concept[tiab]',core:true}])[0].relationship,'unrelated');
});

test('screening accepts one exact-coverage correction but never chooses between two complete answers',()=>{
 const m={ref:'R1',accessId:'a',sourceId:'s',title:'Title',text:'Text',level:'abstract'};
 const n={ref:'R1',relationship:'peripheral',summary:'可用背景。',reason:'背景相关。',titleMatches:[],passages:['P1'],categories:[]};
 const full=JSON.stringify({papers:[n]}),wrong=JSON.stringify({papers:[n,{...n,ref:'R1b'}]});
 const notes=validateScreening(wrong+'\nCorrection:\n'+full,[m]);assert.equal(notes[0].formatNormalization,'unique_exact_coverage_object');assert.equal(notes[0].relationship,'peripheral');
 assert.throws(()=>validateScreening(full+'\nAnother answer:\n'+full,[m]),e=>e.code==='ambiguous_screening_output');
});

test('invalidating an automatic D restores its prior inclusion instead of leaving unknown excluded',async t=>{
 const {applyTopicScreeningPolicy}=await import('../src/kernel.mjs');const f=await fixture(t);await f.run('topic-preview');
 await f.store.update(s=>{const p=s.projects[f.p.id],a=p.artifacts[f.a.id],id=a.draft.sourceAccessIds[0];
 kernelCommand(s,p.id,'update-topic-library',{artifactId:a.id,baseVersion:a.draft.version,decisions:[{accessId:id,decision:'included'}]},'original-choice');
 a.topicWorkspace.screeningPolicy.at='9999';a.topicWorkspace.screenings[id].relationship='unrelated';applyTopicScreeningPolicy(p,a,'screen-1');
 assert.equal(p.researchResults[a.draft.resultId].library.entries.find(e=>e.accessId===id).decision,'excluded');
 a.topicWorkspace.screenings[id].relationship='unclear';applyTopicScreeningPolicy(p,a,'screen-2');
 assert.equal(p.researchResults[a.draft.resultId].library.entries.find(e=>e.accessId===id).decision,'included');
 a.topicWorkspace.screenings[id].relationship='peripheral';applyTopicScreeningPolicy(p,a,'screen-3');applyTopicScreeningPolicy(p,a,'screen-4');
 assert.equal(p.researchResults[a.draft.resultId].library.entries.find(e=>e.accessId===id).decision,'included');
 });
});

test('title-only display and outline input never turn a guessed case count or method into a finding',async()=>{
 const {screeningSummary}=await import('../../shared/topic-relevance.mjs');const {outlineInstruction}=await import('../src/topic-outline.mjs');
 const m={ref:'R1',accessId:'a',sourceId:'s',title:'Early gastric cancer with bilateral Krukenberg tumors.',level:'title',summary:'报道一例病例并采用 ESD。',note:{relationship:'peripheral',summary:'报道一例病例并采用 ESD。',titleMatches:[{term:'Early gastric cancer'}]},passages:[{id:'P1',text:'Only a title.'}]};
 const displayed=screeningSummary(m.note,m);assert.ok(displayed.includes('Early gastric cancer'));assert.ok(displayed.includes('关键发现、方法与研究规模未知'));assert.ok(!displayed.includes('一例'));
 const instruction=outlineInstruction({},[m]);assert.ok(!instruction.includes('报道一例病例并采用 ESD'));
});

test('outline figure item envelopes retain their literal text without accepting unknown objects',async()=>{
 const {validateOutline}=await import('../src/topic-outline.mjs');
 const rows=[{ref:'R1',sourceId:'s',accessId:'a',level:'abstract',note:{relationship:'direct'},passages:[{id:'P1',text:'Source',start:0,end:6}]}];
 const data=outlineFixture([{ref:'R1',relationship:'direct',passages:[{id:'P1'}]}]);
 data.sections[0].children[0].figures=[{item:'比较两组变量的图表计划'}];
 assert.deepEqual(validateOutline(JSON.stringify(data),rows).formatNormalization,['figure_item_to_text']);
 data.sections[0].children[0].figures=[{item:'图表',unhandled:'重要条件'}];
 assert.throws(()=>validateOutline(JSON.stringify(data),rows),e=>e.code==='model_structure');
});

test('a completed model response from a failed outline save is recovered locally and cached without another call',async t=>{
 const f=await fixture(t);await f.run('topic-preview');
 const ids=await f.store.update(s=>{const p=s.projects[f.p.id],a=p.artifacts[f.a.id],ids=a.draft.sourceAccessIds.slice(0,2);kernelCommand(s,p.id,'update-topic-library',{artifactId:a.id,baseVersion:a.draft.version,decisions:ids.map(accessId=>({accessId,decision:'included'}))},randomUUID());return ids;});
 const first=await f.run('topic-outline',{accessIds:ids});assert.equal(first.status,'completed');
 const callId=await f.store.update(s=>{const p=s.projects[f.p.id],a=p.artifacts[f.a.id];p.researchTasks[first.id].status='failed';a.topicWorkspace.outlines=[];a.topicWorkspace.activeOutlineId=null;return s.modelCalls.find(c=>c.taskId===first.id).id;});
 const retry=await f.run('topic-outline',{accessIds:ids});assert.equal(retry.status,'completed',retry.error);assert.equal(retry.recoveredOutlineCallId,callId);assert.equal(retry.provenance.modelCalled,false);assert.equal(f.calls(),2);
 const cached=await f.run('topic-outline',{accessIds:ids});assert.equal(cached.reusedOutlineId,retry.outlineId);assert.equal(f.calls(),2);
 // A changed scientific request cannot silently reuse the failed response.
 const changed=await f.run('topic-outline',{accessIds:ids,text:'不同的论述问题'});assert.equal(changed.status,'completed');assert.equal(changed.recoveredOutlineCallId,undefined);assert.equal(f.calls(),3);
});

test('local editorial recovery requires matching original output and keeps the raw response',async t=>{
 const {createHash}=await import('node:crypto');const f=await fixture(t);await f.run('topic-preview');
 const ids=await f.store.update(s=>{const p=s.projects[f.p.id],a=p.artifacts[f.a.id],ids=a.draft.sourceAccessIds.slice(0,2);kernelCommand(s,p.id,'update-topic-library',{artifactId:a.id,baseVersion:a.draft.version,decisions:ids.map(accessId=>({accessId,decision:'included'}))},randomUUID());return ids;});
 const first=await f.run('topic-outline',{accessIds:ids});let original;
 await f.store.update(s=>{const p=s.projects[f.p.id],a=p.artifacts[f.a.id],call=s.modelCalls.find(c=>c.taskId===first.id);original=call.outputText;const reviewed=JSON.parse(original);reviewed.title='修订后的中性研究题目';call.outlineEditorialRevision={originalOutputHash:'mismatched',inputFingerprint:first.outlineInputFingerprint,text:JSON.stringify(reviewed),actor:'assistant_editor',at:'test',changes:[{path:'title',before:JSON.parse(original).title,after:reviewed.title}]};p.researchTasks[first.id].status='failed';a.topicWorkspace.outlines=[];});
 const mismatched=await f.run('topic-outline',{accessIds:ids});
 let outline=await f.store.read(s=>s.projects[f.p.id].artifacts[f.a.id].topicWorkspace.outlines.at(-1));assert.equal(outline.title,JSON.parse(original).title);assert.equal(mismatched.provenance.editorialRevision,undefined);
 await f.store.update(s=>{const p=s.projects[f.p.id],a=p.artifacts[f.a.id],call=s.modelCalls.find(c=>c.taskId===first.id);call.outlineEditorialRevision.originalOutputHash=createHash('sha256').update(original).digest('hex');a.topicWorkspace.outlines=[];});
 const recovered=await f.run('topic-outline',{accessIds:ids});outline=await f.store.read(s=>s.projects[f.p.id].artifacts[f.a.id].topicWorkspace.outlines.at(-1));assert.equal(outline.title,'修订后的中性研究题目');assert.equal(recovered.provenance.editorialRevision.actor,'assistant_editor');assert.equal(f.calls(),2);assert.equal(await f.store.read(s=>s.modelCalls.find(c=>c.taskId===first.id).outputText),original);
});
