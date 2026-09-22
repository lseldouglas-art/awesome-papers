import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SqliteStore} from '../src/sqlite-store.mjs';
import {createWorkspace} from '../src/workspace.mjs';
import {upgradeProject} from '../src/progress.mjs';
import {ensureKernel} from '../src/kernel.mjs';
import {resolveSubmission} from '../src/submission-status.mjs';
import {linkedDiscussionMaterials,focusedDiscussionContext} from '../../shared/discussion-scope.mjs';
import {outputContractFor,validateModelContract} from '../src/model-contracts.mjs';
import {validateComparisonOutput} from '../src/workflows.mjs';
import {assessmentFixture} from './assessment-fixture.mjs';

async function fixture(t){
 const state={schemaVersion:2,projects:{},receipts:{},events:[],modelCalls:[]};
 const p=ensureKernel(upgradeProject(createWorkspace(state,{example:true},'create'),false));
 const other=ensureKernel(upgradeProject(createWorkspace(state,{example:true},'other'),false));
 for(const id of ['one','two'])p.researchTasks[id]={id,projectId:p.id,requestId:`request-${id}`,status:'running',calls:[],input:{materials:[{accessId:'a',sourceId:'s',ref:'R1',level:'abstract',text:'private full text'}],context:{large:'context'}},paperBatchRecords:[{batchId:'batch',status:'completed',result:{papers:[{accessId:'a',sourceId:'s',fields:{text:'saved extraction'}}]}}],investigation:{phases:[{key:'initial',value:{reason:'keep this judgment'}}],extractionRecords:[]}};
 state.receipts['request-one']={result:{taskId:'one'},fingerprint:'saved'};
 state.modelCalls=[{id:'c1',taskId:'one',projectId:p.id,model:'direct',runtime:'direct_model_api',outputText:'private output',inputRefs:[{accessId:'a'}]},{id:'other',taskId:'foreign',projectId:other.id,outputText:'other private'}];
 const directory=await mkdtemp(join(tmpdir(),'rw-request-speed-'));await writeFile(join(directory,'workspace.json'),JSON.stringify(state));
 const store=await new SqliteStore(directory).initialize();t.after(()=>store.close());return {store,p,other,state};
}

test('task progress persists atomically without touching another task, versions or evidence; callbacks and late scope failures roll back',async t=>{
 const {store,p,other,state}=await fixture(t);
 await Promise.all(['one','two'].map(id=>store.updateTaskState(p.id,id,s=>{
   const task=s.projects[p.id].researchTasks[id];task.progress='updated';task.calls.push(`new-${id}`);
   s.modelCalls.push({id:`new-${id}`,taskId:id,projectId:p.id});
   s.projects[p.id].researchEvents.push({id:`event-${id}`,projectId:p.id,taskId:id});
 })));
 const after=await store.read();assert.deepEqual(after.projects[other.id],state.projects[other.id]);
 assert.deepEqual(after.projects[p.id].artifacts,state.projects[p.id].artifacts);
 assert.deepEqual(after.projects[p.id].accesses,state.projects[p.id].accesses);
 assert.equal(after.projects[p.id].researchEvents.length,state.projects[p.id].researchEvents.length+2);
 assert.deepEqual(after.modelCalls.map(c=>c.id),['c1','other','new-one','new-two']);
 for(const type of ['throw','event','call']){
   await assert.rejects(store.updateTaskState(p.id,'one',async s=>{
     s.projects[p.id].researchTasks.one.progress='must roll back';
     if(type==='throw'){await Promise.resolve();throw Error('deliberate');}
     if(type==='call')s.modelCalls[0].projectId=other.id;
     else s.projects[p.id].researchEvents.push({projectId:other.id});
   }));assert.deepEqual(await store.read(),after);
 }
 await assert.rejects(store.updateTaskState(other.id,'one',()=>{}),e=>e.code==='not_found');
});

test('summary reads retain task identity, phases and scoped citations; full checkpoints stay exact and ETag changes on progress',async t=>{
 const {store,p,state}=await fixture(t);const before=await store.read();
 assert.deepEqual(await store.readProject(p.id),state.projects[p.id]);
 const view=await store.readProject(p.id,v=>v,{summary:true});const task=view.researchTasks.one;
 assert.equal(task.summaryView,true);assert.equal(task.savedBatchCount,1);assert.equal(task.input.context,undefined);assert.equal(task.input.materials[0].text,undefined);
 assert.equal(task.input.materials[0].accessId,'a');assert.equal(task.paperBatchRecords,undefined);assert.deepEqual(task.investigation.phases,state.projects[p.id].researchTasks.one.investigation.phases);
 const first=await store.taskSnapshot(p.id,'one',null,{summary:true});assert.equal((await store.taskSnapshot(p.id,'one',first.etag,{summary:true})).task,null);
 assert.deepEqual((await store.taskSnapshot(p.id,'one')).task,state.projects[p.id].researchTasks.one);
 const calls=await store.callSummaries(p.id,'one');assert.equal(calls.length,1);assert.equal(calls[0].outputAvailable,true);assert.equal(calls[0].outputText,undefined);assert.equal(calls[0].runtimeMetrics,undefined);
 assert.deepEqual(await store.read(),before);await store.updateTaskState(p.id,'one',s=>{s.projects[p.id].researchTasks.one.progress='next';});
 assert.notEqual((await store.taskSnapshot(p.id,'one',first.etag,{summary:true})).task,null);
 assert.equal((await store.projectList()).length,2);await assert.rejects(store.readProject('absent'),e=>e.code==='not_found');
});

test('acknowledgment recovery only reads durable receipts and never resubmits or crosses projects',async t=>{
 const {store,p,other}=await fixture(t),seen=[];
 const client={request:async(path,options)=>{seen.push({path,options});return store.requestStatus(p.id,'request-one');}};
 assert.deepEqual(await resolveSubmission(client,p.id,{requestId:'request-one'}),{status:'accepted',taskId:'one'});
 assert.equal(seen[0].options.method,undefined);assert.equal((await store.requestStatus(p.id,'never-sent')).status,'not_received');
 await assert.rejects(store.requestStatus(other.id,'request-one'),e=>e.code==='request_id_conflict');
 let attempts=0;await assert.rejects(resolveSubmission({request:async()=>{attempts++;throw Error('offline');}},p.id,{requestId:'request-one'}));assert.equal(attempts,1);
 await assert.rejects(resolveSubmission({request:async()=>({status:'accepted'})},p.id,{requestId:'request-one'}));
});

test('explicit linked discussion scope deduplicates only selected evidence and does not alter full domain context',()=>{
 const context={target:{blockId:'focus'},selectedArtifact:{blocks:[{id:'focus',text:'complete paragraph'},{id:'other',text:'other topic'}]},parentArtifact:{id:'parent',blocks:[{id:'whole'}]},relatedHistory:[{question:'prior correction'}]};
 const before=structuredClone(context),focused=focusedDiscussionContext(context);
 assert.deepEqual(focused.selectedArtifact.blocks,[context.selectedArtifact.blocks[0]]);assert.match(focused.discussionBoundary,/未检查其他材料/);assert.deepEqual(context,before);assert.deepEqual(focused.relatedHistory,context.relatedHistory);
 assert.deepEqual(linkedDiscussionMaterials({result:{citations:[{blockId:'focus',accessId:'a'},{blockId:'focus',accessId:'a'},{blockId:'other',accessId:'b'},{blockId:'focus',accessId:'foreign'}]},blockId:'focus',selectedIds:['a','b']}),['a']);
});

test('SDK comparison purposes use a real structured contract and still require semantic evidence checks',()=>{
 const q={question:'合成问题？',scope:'合成范围',rationale:'需要核查',unknowns:[],feasibility:{known:[],unknown:[]},supporting:[],conflicting:[],assessment:assessmentFixture()};
 const value={questions:[q],explanation:'比较差异',next:'研究者选择'};
 for(const purpose of ['model.generate','model.topic-synthesis']){
   const contract=outputContractFor(purpose,'compare');assert.equal(contract.name,'comparison');validateModelContract(JSON.stringify(value),contract);
   assert.throws(()=>validateModelContract(JSON.stringify({...value,questions:[{...q,assessment:{}}]}),contract),e=>e.code==='model_structure');
 }
 assert.equal(outputContractFor('model.generate','ask'),null);q.assessment.analysis[0].supporting=[999];
 validateModelContract(JSON.stringify(value),outputContractFor('model.generate','compare'));
 assert.throws(()=>validateComparisonOutput(JSON.stringify(value),[],{requireAnalysis:true}),e=>e.code==='invalid_citation');
});

test('HTTP task start returns a receipt before model work; linked asks keep exact scope across failure and retry',async t=>{
 const {startServer}=await import('../src/server.mjs'),{createClient}=await import('../src/client.mjs'),{executeCommand}=await import('../src/domain.mjs');
 const directory=await mkdtemp(join(tmpdir(),'rw-http-scope-'));let calls=0,inputs=[],fail=true;
 const app=await startServer({directory,port:0,researchOptions:{modelFactory:()=>({generate:async input=>{
   calls++;inputs.push(input);if(fail)throw Object.assign(Error('synthetic outage'),{code:'model_network_error'});
   return {text:JSON.stringify({items:[{text:'合成材料的局部解释',status:'inference',citations:[{ref:input.materials[0].ref,passage:'P1'}]}]}),cost:{status:'unknown'},provenance:{model:'fixture'}};
 }})}});t.after(()=>app.close());const api=createClient({baseUrl:app.url});
 await app.research.settings.save({baseUrl:'https://fixture.invalid',model:'fixture',apiKey:'synthetic-key',enabled:true});
 const p=await app.store.update(s=>{
   const p=ensureKernel(upgradeProject(createWorkspace(s,{name:'局部答疑工程样例',goal:'理解领域'},'fixture'),false)),a=Object.values(p.artifacts)[0];
   for(let i=0;i<3;i++){const src=executeCommand(s,p.id,'import-source',{title:`fixture${i}`,text:`Complete synthetic source ${i}.`,contentLevel:'abstract'},`s${i}`);const ac=executeCommand(s,p.id,'record-access',{sourceId:src.id,level:'abstract'},`a${i}`);a.draft.sourceAccessIds.push(ac.id);}p.researchResults['fixture-result']={id:'fixture-result',kind:'brief',blocks:[{id:'focus',type:'paragraph',text:'Synthetic topic explanation'}],citations:[]};a.draft.resultId='fixture-result';return p;
 });const a=Object.values(p.artifacts)[0];
 const body={artifactId:a.id,baseVersion:a.draft.version,mode:'ask',text:'解释这一条内容',accessIds:[a.draft.sourceAccessIds[0]],discussionScope:'linked',blockId:'focus'};
 const requestId='request-http-scope';const accepted=await app.research.start(p.id,body,requestId);assert.equal(calls,0);
 assert.deepEqual(await api.request(`/api/projects/${p.id}/research-requests/${requestId}`),{status:'accepted',taskId:accepted.taskId});
 await app.research.running.get(accepted.taskId)?.promise;let task=(await app.store.taskSnapshot(p.id,accepted.taskId)).task;assert.equal(task.status,'failed');
 const before=await api.workspace(p.id,{summary:true});assert.equal(before.researchTasks[task.id].input.materials[0].text,undefined);
 const etagRequest=await fetch(`${app.url}/api/projects/${p.id}/research-tasks/${task.id}?view=summary`);const etag=etagRequest.headers.get('etag');assert.equal((await fetch(etagRequest.url,{headers:{'If-None-Match':etag}})).status,304);
 fail=false;const current=await api.workspace(p.id);const retry=await app.research.start(p.id,{...body,baseVersion:current.artifacts[a.id].draft.version,retryTaskId:task.id},'request-http-retry');await app.research.running.get(retry.taskId)?.promise;
 task=(await app.store.taskSnapshot(p.id,retry.taskId)).task;assert.equal(task.status,'completed',task.error);assert.equal(calls,2);assert.equal(task.input.materials.length,1);assert.equal(inputs[1].materials[0].text,'Complete synthetic source 0.');assert.match(inputs[1].instruction,/未检查其他材料/);
 const latest=await api.workspace(p.id);assert.equal(latest.artifacts[a.id].draft.sourceAccessIds.length,3);
 const receipts=await api.request(`/api/model-calls?view=summary&projectId=${p.id}&taskId=${task.id}`);assert.equal(receipts.length,1);assert.equal(receipts[0].outputAvailable,true);assert.equal(receipts[0].inputBreakdown.materialCount,1);assert.equal(receipts[0].outputText,undefined);
 assert.deepEqual(await api.request(`/api/projects/${p.id}/research-tasks/${task.id}/batches`),[]);
});
