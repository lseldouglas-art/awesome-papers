import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {LocalStore} from '../src/store.mjs';
import {ResearchApplication} from '../src/research-application.mjs';
import {editTopicWorkspace} from '../src/topic-library-workflow.mjs';
import {seedWriting,writingModel} from './fixtures/writing.mjs';
import {manuscriptSnapshot,manuscriptMarkdown,manuscriptHtml,currentSectionVersion} from '../../shared/topic-writing.mjs';
import {validateBlueprint} from '../src/topic-writing.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function setup(t,{count=7,intercept}={}){
  const store=await new LocalStore(await mkdtemp(join(tmpdir(),'rw-manuscript-'))).initialize(),base=writingModel();let active=0,maxActive=0;
  const model={generate:async input=>{active++;maxActive=Math.max(maxActive,active);try{await delay(120);if(intercept)await intercept(input);return await base.generate(input);}finally{active--;}}};
  const service=await new ResearchApplication(store,{modelFactory:()=>model}).initialize();await service.settings.save({baseUrl:'https://test.invalid/v1',model:'fixture',apiKey:'isolated',enabled:true});
  t.after(async()=>{await service.close();await store.close();});
  const f=await store.update(s=>{const f=seedWriting(s),c=f.outline.sections[0].children[0];f.outline.sections[0].children=Array.from({length:count},(_,i)=>({...structuredClone(c),id:`outline-1-${i+1}`,heading:`论证小节 ${i+1}`}));editTopicWorkspace(f.p,f.a,{baseWorkspaceVersion:f.a.topicWorkspace.version,action:'confirm-outline',outlineId:f.outline.id,accessIds:f.ids},randomUUID());return f;});
  const snapshot=()=>store.read(s=>s.projects[f.p.id].artifacts[f.a.id].topicWorkspace.writingWorkspaces[f.outline.id]);
  const start=async(mode='manuscript-writing',extra={})=>{const a=await store.read(s=>s.projects[f.p.id].artifacts[f.a.id]);return service.start(f.p.id,{artifactId:f.a.id,baseVersion:a.draft.version,mode,text:'完成初稿',accessIds:f.ids,topicOptions:{outlineId:f.outline.id,sectionId:'outline-1-1'},...extra},randomUUID());};
  const done=async id=>{await service.running.get(id)?.promise;return store.read(s=>s.projects[f.p.id].researchTasks[id]);};
  return {...f,store,service,start,done,snapshot,base,max:()=>maxActive};
}
test('one manuscript task reuses existing prose, bounds concurrency, assembles ordered snapshots and never audits',async t=>{
  const f=await setup(t);await f.done((await f.start('topic-writing')).taskId);const before=await f.snapshot(),first=currentSectionVersion(before.sections['outline-1-1']);
  await assert.rejects(()=>f.start('manuscript-writing',{accessIds:[...f.ids,f.otherId]}),e=>e.code==='invalid_scope');
  const result=await f.done((await f.start()).taskId);assert.equal(result.status,'completed',result.error);assert.ok(f.max()>1);assert.ok(f.max()<=3);assert.equal(f.base.calls.filter(c=>c.purpose==='audit').length,0);assert.equal(f.base.calls.length,14);
  const w=await f.snapshot();assert.deepEqual(currentSectionVersion(w.sections['outline-1-1']),first);assert.equal(w.activeSectionId,before.activeSectionId);assert.equal(w.manuscripts.length,1);assert.equal(w.manuscripts[0].complete,true);assert.deepEqual(w.manuscripts[0].chapters[0].sections.map(s=>s.number),['1.1','1.2','1.3','1.4','1.5','1.6','1.7']);
  assert.ok(f.base.calls.every(c=>!c.instruction.includes('工程材料 3')));await f.done((await f.start()).taskId);assert.equal(f.base.calls.length,14);assert.equal((await f.snapshot()).manuscripts.length,1);
});
test('a failed section does not cancel its siblings; retry only completes missing content',async t=>{
  let fail=true;const f=await setup(t,{count:4,intercept:input=>{if(fail&&input.instruction.includes('只返回JSON {focus,')&&input.instruction.includes('"id":"outline-1-2"')){fail=false;throw Error('isolated fixture failure');}}});
  const task=await f.done((await f.start()).taskId);assert.equal(task.status,'failed');assert.equal(task.errorCode,'manuscript_incomplete');let w=await f.snapshot();assert.equal(w.manuscripts[0].completedSections,3);const preserved=structuredClone(w.sections['outline-1-1']);
  const before=f.base.calls.length,again=await f.done((await f.start()).taskId);assert.equal(again.status,'completed',again.error);w=await f.snapshot();assert.equal(w.manuscripts.length,2);assert.equal(w.manuscripts[1].complete,true);assert.deepEqual(w.sections['outline-1-1'],preserved);assert.equal(f.base.calls.length-before,2);
});
test('cancelling parallel writing prevents late responses from creating paragraphs or snapshots',async t=>{
  const f=await setup(t,{intercept:async({signal})=>{await new Promise(r=>{if(signal.aborted)r();else signal.addEventListener('abort',r,{once:true});});}});
  const {taskId}=await f.start();for(let i=0;i<100;i++){if(await f.store.read(s=>s.modelCalls.length>=3))break;await delay(5);}await f.service.stop(f.p.id,taskId,randomUUID());const task=await f.done(taskId);assert.equal(task.status,'cancelled');const w=await f.snapshot();assert.equal(w.manuscripts?.length??0,0);assert.ok(Object.values(w.sections).every(s=>!currentSectionVersion(s).paragraphs.length));
  const calls=await f.store.read(s=>s.modelCalls);assert.equal(calls.length,3);assert.ok(calls.every(c=>c.status==='failed'||c.status==='cancelled'||c.discardedAfterCancellation));
});
test('manuscript exports contain only the selected article and escape formatted text',()=>{
 const outline={id:'o',title:'题目 <script>unsafe</script>',sections:[{heading:'引言',children:[{id:'s',heading:'科学问题',evidence:[]}]}]},workspace={sections:{s:{activeVersionId:'v',completedVersionId:'old',versions:[{id:'v',status:'completed',at:'SECRET_VERSION_TIME',blueprint:{needs:['SECRET_NEEDS']},paragraphs:[{text:'正文与引用[3]。',audit:[{status:'supplement',explanation:'SECRET_AUDIT'}],provenance:{key:'SECRET_PROVENANCE'}}]}]}}};
 const snap=manuscriptSnapshot(outline,workspace),md=manuscriptMarkdown(snap),html=manuscriptHtml(snap);assert.ok(md.includes('## 1 引言'));assert.ok(md.includes('### 1.1 科学问题'));assert.ok(md.includes('正文与引用[3]。'));assert.ok(!/SECRET|待审阅|参考文献|全文核对/.test(md+html));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));workspace.sections.s.versions[0].paragraphs[0].text='后来修改';assert.ok(manuscriptMarkdown(snap).includes('正文与引用[3]。'));
});
test('the final paragraph can omit a transition, but missing arguments and invented citations still fail',()=>{
 const materials=[{ref:'R1',sourceId:'s',accessId:'a',level:'abstract',text:'Actual statement.'}],data={focus:'f',paragraphs:[{topic:'t',claim:'c',relationship:'r',boundary:'b',citations:[{ref:'R1',passage:'P1'}]}],coverage:[{ref:'R1',status:'used',reason:'r'}],needs:[]};
 const normalized=validateBlueprint(JSON.stringify(data),materials);assert.equal(normalized.paragraphs[0].transition,'');assert.deepEqual(validateBlueprint(JSON.stringify(normalized),materials),normalized);assert.throws(()=>validateBlueprint(JSON.stringify({...data,paragraphs:[{...data.paragraphs[0],claim:''}]}),materials));assert.throws(()=>validateBlueprint(JSON.stringify({...data,paragraphs:[{...data.paragraphs[0],citations:[{ref:'R1',passage:'P9'}]}]}),materials));
});
