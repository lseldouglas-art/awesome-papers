import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalStore } from '../src/store.mjs';
import { ResearchApplication } from '../src/research-application.mjs';
import { createWorkspace } from '../src/workspace.mjs';
import { upgradeProject } from '../src/progress.mjs';
import { ensureKernel } from '../src/kernel.mjs';
import { importTopicRecords } from '../src/topic-library-workflow.mjs';
import { topicQueryState } from '../../shared/topic-search.mjs';
import { setRetrievalRange, retrievalScopeError, retrievalQuery, matchesRetrievalScope } from '../../shared/retrieval-scope.mjs';

const scope=setRetrievalRange({},'recent5','2026-09-13');
const record=id=>({pmid:id,title:`Retrieval fixture ${id}`,text:`Actual fixture abstract ${id}.`,level:'abstract',year:'2025',authors:[]});
async function fixture(t,{total=537,metadata}={}) {
  const directory=await mkdtemp(join(tmpdir(),'rw-range-')),store=await new LocalStore(directory).initialize();
  const batches=[],plans=[];
  const service=await new ResearchApplication(store,{pubmed:{
    planCollection:async(query,o)=>{plans.push(query);const target=o.limit==='all'?total:Math.min(total,o.limit),plan={query,sort:o.sort,total,target,ids:Array.from({length:target},(_,i)=>String(i+1)),complete:true};await o.onProgress(plan);return plan;},
    metadata:async(ids,o)=>{batches.push([...ids]);return metadata?metadata(ids,o):ids.map(record);}
  },modelFactory:()=>{throw Error('Retrieval must not call a model');}}).initialize();
  t.after(async()=>{await service.close();await store.close();});
  const p=await store.update(s=>ensureKernel(upgradeProject(createWorkspace(s,{name:'Retrieval test',goal:'Scope retrieval'},randomUUID()),false))),a=Object.values(p.artifacts)[0];
  const read=()=>store.read(s=>s.projects[p.id]);
  const start=async(extra={})=>service.start(p.id,{artifactId:a.id,baseVersion:(await read()).artifacts[a.id].draft.version,mode:'retrieve',query:'kidney[tiab]',accessIds:[],retrievalOptions:scope,...extra},randomUUID());
  const run=async(extra={})=>{const {taskId}=await start(extra);await service.running.get(taskId)?.promise;return (await read()).researchTasks[taskId];};
  return {p,a,store,service,run,start,read,batches,plans};
}
test('range selectors use explicit rolling dates, allow all years, and validate custom dates',()=>{
  assert.deepEqual([scope.from,scope.to],['2021-09-13','2026-09-13']);
  assert.equal(setRetrievalRange({},'recent5','2024-02-29').from,'2019-02-28');
  assert.equal(retrievalScopeError({...scope,from:'2021-02-30'}).length>0,true);
  assert.equal(retrievalScopeError({...scope,from:'2027-01-01'}).length>0,true);
  assert.equal(retrievalScopeError(setRetrievalRange(scope,'all')),'');
  const q=retrievalQuery('kidney[tiab] OR renal[tiab]',scope);
  assert.ok(q.startsWith('(kidney[tiab] OR renal[tiab]) AND'));
  assert.ok(q.includes('Meta-Analysis[pt]'));assert.ok(q.includes('2021/09/13'));
  assert.equal(retrievalQuery('kidney',setRetrievalRange({type:'any'},'all')),'kidney');
});
test('one retrieval saves all 537 records across batches without a model or replacing the report',async t=>{
  const f=await fixture(t);let oldId;
  await f.store.update(s=>{const p=s.projects[f.p.id],a=p.artifacts[f.a.id];oldId=importTopicRecords(p,a,[record('9000')]).ids[0];a.draft.resultId='kept-report';p.researchResults['kept-report']={id:'kept-report',artifactId:a.id,kind:'brief',blocks:[{id:'b',type:'paragraph',text:'Original research understanding.'}],citations:[],accessIds:[oldId]};});
  const task=await f.run(),p=await f.read(),search=p.searches[task.searchId];
  assert.equal(task.status,'completed',task.error);assert.equal(search.retrievedCount,537);assert.equal(search.status,'completed');
  assert.deepEqual(f.batches.map(b=>b.length),[100,100,100,100,100,37]);
  assert.ok(p.artifacts[f.a.id].draft.sourceAccessIds.includes(oldId));assert.equal(p.artifacts[f.a.id].draft.sourceAccessIds.length,538);
  assert.equal(p.artifacts[f.a.id].draft.resultId,'kept-report');assert.equal(p.researchResults['kept-report'].blocks[0].text,'Original research understanding.');
  assert.equal(search.query,retrievalQuery('kidney[tiab]',scope));assert.equal(topicQueryState(p,p.artifacts[f.a.id]).query,'kidney[tiab]');
  assert.equal(task.cost.amount,0);assert.ok(task.toolRuns.some(r=>r.name==='PubMed.metadata'));
  const again=await f.run({retrievalOptions:setRetrievalRange(scope,'all')});
  const second=(await f.read()).searches[again.searchId];assert.equal(second.reusedCount,537);assert.equal(f.batches.length,6);assert.equal(Object.keys((await f.read()).accesses).length,538);
});
test('failed batch leaves saved work and resumes only remaining IDs with the same manifest',async t=>{
  let fail=true;const f=await fixture(t,{total:250,metadata:ids=>{if(fail&&ids[0]==='101'){fail=false;throw Error('Temporary offline');}return ids.map(record);}});
  const first=await f.run();assert.equal(first.status,'failed');let p=await f.read(),search=p.searches[first.searchId];
  assert.equal(search.retrievedCount,100);assert.equal(search.status,'incomplete');assert.equal(search.missingIds.length,100);
  const resumed=await f.run({resumeSearchId:search.id});p=await f.read();search=p.searches[search.id];assert.equal(resumed.status,'completed',resumed.error);assert.equal(search.retrievedCount,250);assert.equal(search.status,'completed');assert.equal(f.plans.length,1);
  assert.deepEqual(f.batches.map(b=>b[0]),['1','101','101','201']);assert.equal(search.attemptTaskIds.length,2);
});
test('missing records stay explicit, and retry fetches just those records',async t=>{
  let missing=true;const f=await fixture(t,{total:3,metadata:ids=>ids.filter(id=>!(missing&&id==='2')).map(record)});
  const first=await f.run();let s=(await f.read()).searches[first.searchId];assert.equal(first.outcome,'retrieval_incomplete');assert.deepEqual(s.missingIds,['2']);assert.equal(s.status,'incomplete');
  missing=false;await f.run({resumeSearchId:s.id});s=(await f.read()).searches[s.id];assert.equal(s.status,'completed');assert.deepEqual(f.batches,[['1','2','3'],['2']]);
});
test('resume cannot switch query, dates, type or cap, and invalid input never starts a task',async t=>{
  const f=await fixture(t,{total:2,metadata:()=>[]});const first=await f.run(),search=(await f.read()).searches[first.searchId];
  assert.equal(matchesRetrievalScope(search,'kidney[tiab]',scope),true);
  for(const extra of [{query:'other'},{retrievalOptions:setRetrievalRange(scope,'all')},{retrievalOptions:{...scope,type:'any'}},{retrievalOptions:{...scope,limit:100}}])await assert.rejects(()=>f.start({resumeSearchId:search.id,...extra}),e=>e.code==='invalid_scope');
  await assert.rejects(()=>f.start({retrievalOptions:{...scope,from:'bad'}}),e=>e.code==='invalid_scope');
  assert.equal(Object.keys((await f.read()).researchTasks).length,1);
});
test('zero results complete honestly; a chosen cap remains distinct from total matches',async t=>{
  const zero=await fixture(t,{total:0});const z=await zero.run(),zs=(await zero.read()).searches[z.searchId];assert.equal(z.outcome,'no_results');assert.equal(zs.retrievedCount,0);assert.equal(zero.batches.length,0);
  const capped=await fixture(t);const c=await capped.run({retrievalOptions:{...scope,limit:100}}),s=(await capped.read()).searches[c.searchId];assert.equal(s.plan.total,537);assert.equal(s.plan.target,100);assert.equal(s.retrievedCount,100);
});
test('stopping after a saved batch retains it and resumes without downloading it again',async t=>{
  let secondBatch,ready;const reached=new Promise(resolve=>{ready=resolve;});let pause=true;
  const f=await fixture(t,{total:210,metadata:async(ids,{signal})=>{if(pause&&ids[0]==='101'){secondBatch=ids;ready();await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});}return ids.map(record);}});
  const {taskId}=await f.start();await reached;assert.equal(secondBatch.length,100);
  await f.service.stop(f.p.id,taskId,randomUUID());await f.service.running.get(taskId)?.promise;
  let p=await f.read(),search=p.searches[p.researchTasks[taskId].searchId];assert.equal(search.retrievedCount,100);assert.equal(search.status,'paused');
  pause=false;const next=await f.run({resumeSearchId:search.id});assert.equal(next.status,'completed',next.error);assert.equal((await f.read()).searches[search.id].retrievedCount,210);assert.equal(f.batches.filter(ids=>ids[0]==='1').length,1);
});
test('oversized PubMed XML splits internally without dropping IDs or retrying unrelated errors',async()=>{
  const {createPubmed}=await import('../src/pubmed.mjs');const batches=[];
  const pubmed=createPubmed({intervalMs:0,fetchImpl:async url=>{const ids=url.searchParams.get('id').split(',');batches.push(ids);return new Response(ids.length>2?'x'.repeat(4_000_001):`<PubmedArticleSet>${ids.map(id=>`<PubmedArticle><MedlineCitation><PMID>${id}</PMID><Article><ArticleTitle>Title ${id}</ArticleTitle></Article></MedlineCitation></PubmedArticle>`).join('')}</PubmedArticleSet>`);}});
  assert.deepEqual((await pubmed.metadata(['1','2','3','4','5'])).map(r=>r.pmid),['1','2','3','4','5']);
  assert.deepEqual(batches.map(b=>b.length),[5,3,2,1,2]);
  let calls=0;const unavailable=createPubmed({intervalMs:0,fetchImpl:async()=>{calls++;return new Response('Unavailable',{status:503});}});await assert.rejects(()=>unavailable.metadata(['1','2']),e=>e.code==='retrieval_http');assert.equal(calls,1);
});
