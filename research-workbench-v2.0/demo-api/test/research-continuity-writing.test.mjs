import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {LocalStore} from '../src/store.mjs';
import {ResearchApplication} from '../src/research-application.mjs';
import {seedWriting,writingModel} from './fixtures/writing.mjs';
import {kernelCommand} from '../src/kernel.mjs';
import {currentSectionVersion} from '../../shared/topic-writing.mjs';
test('late paragraph output preserves its frozen protocol and does not replace the previously displayed draft',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'rw-continuity-late-')),store=await new LocalStore(directory).initialize(),base=writingModel();
  let pause=false,release,entered;const enteredPromise=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  const model={generate:async args=>{if(pause){pause=false;entered();await gate;}return base.generate(args);}};
  const service=await new ResearchApplication(store,{modelFactory:()=>model}).initialize();t.after(async()=>{release();await service.close();await store.close();});
  await service.settings.save({baseUrl:'https://test.invalid/v1',model:'fixture',apiKey:'isolated',enabled:true});
  const {p,a,outline,ids}=await store.update(s=>{const f=seedWriting(s);f.a.topicWorkspace.outlineConfirmations=[{outlineId:f.outline.id}];return f;});
  const call=(name,body)=>store.update(s=>kernelCommand(s,p.id,name,{artifactId:a.id,baseStateVersion:s.projects[p.id].researchKernel.version,...body},randomUUID()));
  const protocol=await call('save-continuity',{kind:'protocol',title:'原采用方案',payload:{outputMode:'literature',primaryOutcome:'A'}});await call('decide-continuity',{itemId:protocol.itemId,revisionId:protocol.revisionId,choice:'adopt'});
  const start=async text=>service.start(p.id,{artifactId:a.id,baseVersion:(await store.read(s=>s.projects[p.id].artifacts[a.id])).draft.version,mode:'topic-writing',text,accessIds:ids,topicOptions:{outlineId:outline.id,sectionId:'outline-1-1'}},randomUUID());
  const wait=async id=>{for(let i=0;i<1000;i++){const task=await store.read(s=>s.projects[p.id].researchTasks[id]);if(['failed','completed','cancelled'].includes(task.status))return task;await new Promise(r=>setTimeout(r,10));}throw Error('任务未结束');};
  const first=await start('第一版');assert.equal((await wait(first.id??first.taskId)).status,'completed');
  const old=await store.read(s=>currentSectionVersion(s.projects[p.id].artifacts[a.id].topicWorkspace.writingWorkspaces[outline.id].sections['outline-1-1']));
  pause=true;const second=await start('再生成一版');await enteredPromise;
  const changed=await call('save-continuity',{itemId:protocol.itemId,baseRevisionId:protocol.revisionId,title:'更改采用方案',payload:{outputMode:'literature',primaryOutcome:'B'}});await call('decide-continuity',{itemId:changed.itemId,revisionId:changed.revisionId,choice:'adopt'});release();
  const task=await wait(second.id??second.taskId);assert.equal(task.status,'completed');assert.equal(task.staleInput,true);
  const section=await store.read(s=>s.projects[p.id].artifacts[a.id].topicWorkspace.writingWorkspaces[outline.id].sections['outline-1-1']);
  assert.equal(section.activeVersionId,old.id);assert.equal(section.versions.at(-1).continuity.protocol.ref.revisionId,protocol.revisionId);assert.equal(section.versions.at(-1).staleInput,true);assert.deepEqual(section.versions[0],old);
});
test('records-only discussion runs the complete application path and retains exact execution attribution',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'rw-record-ask-')),store=await new LocalStore(directory).initialize();let calls=0;
  const service=await new ResearchApplication(store,{modelFactory:()=>({generate:async({materials,instruction})=>{calls++;assert.equal(materials.length,0);assert.match(instruction,/researcher_record/);return {text:JSON.stringify({items:[{text:'程序读到2条。',status:'researcher_record',citations:[],record:{ref:'U1',quote:'读到2条'}}]}),usage:{total_tokens:1},cost:{status:'not_applicable',amount:0}};}})}).initialize();
  t.after(async()=>{await service.close();await store.close();});await service.settings.save({baseUrl:'https://test.invalid/v1',model:'fixture',apiKey:'isolated',enabled:true});
  const {p,a}=await store.update(s=>{const f=seedWriting(s),call=(name,body)=>kernelCommand(s,f.p.id,name,{artifactId:f.a.id,baseStateVersion:f.p.researchKernel.version,...body},randomUUID());const r=call('save-continuity',{kind:'execution',title:'实际运行',payload:{text:'程序读到2条',performedBy:'隔离脚本'}});call('decide-continuity',{itemId:r.itemId,revisionId:r.revisionId,choice:'adopt'});return f;});
  const started=await service.start(p.id,{artifactId:a.id,baseVersion:a.draft.version,mode:'ask',text:'解释实际执行结果',accessIds:[]},randomUUID());let task;
  for(let i=0;i<1000;i++){task=await store.read(s=>s.projects[p.id].researchTasks[started.id??started.taskId]);if(['completed','failed'].includes(task.status))break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(task.status,'completed',task.error);assert.equal(calls,1);const result=await store.read(s=>s.projects[p.id].researchResults[task.resultId]);assert.equal(result.blocks[0].recordAnchor.performedBy,'隔离脚本');assert.equal(result.citations.length,0);
});
