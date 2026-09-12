import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalStore } from '../src/store.mjs';
import { ResearchApplication } from '../src/research-application.mjs';
import { createWorkspace } from '../src/workspace.mjs';
import { upgradeProject,capture,exportProgress } from '../src/progress.mjs';
import { executeCommand } from '../src/domain.mjs';
import { ensureKernel,kernelCommand } from '../src/kernel.mjs';
import { validateTopicReview,completeTopicAggregation } from '../src/topic-review.mjs';
import { PAPER_FIELDS } from '../../shared/domain-landscape.mjs';
import { materialPacket } from '../../shared/material-scope.mjs';

export function topicFixture(materials) {
 const statement={headline:'工程证据判断',text:'这是一条工程测试论证，不是科研结论。',status:'inference',citations:[{ref:materials[0].ref,passage:'P1'}]};
 return {framework:'topic-evidence-v1',papers:materials.map((m,i)=>({ref:m.ref,relationship:i?'indirect':'direct',fields:Object.fromEntries(Object.keys(PAPER_FIELDS).map(key=>[key,{text:'工程记录的对应字段。',status:key==='unreported'?'unknown':'reported',passages:key==='unreported'?[]:['P1']}]))})),sections:['evidence','gap','design'].map(id=>({id,judgment:statement,reasoning:[statement]})),paperTitle:'工程测试题目：观察研究',outline:[{heading:'方法',purpose:'描述需要获取的数据和待检验的终点，尚未实施。'}]};
}
async function setup(t,generate,pubmed) {
 const directory=await mkdtemp(join(tmpdir(),'rw2-topic-')),store=await new LocalStore(directory).initialize();
 const service=await new ResearchApplication(store,{pubmed,modelFactory:()=>({generate:generate??(async ({materials})=>({text:JSON.stringify(topicFixture(materials)),usage:{total_tokens:10},cost:{status:'unknown'},provenance:{model:'engineering'}}))})}).initialize();
 await service.settings.save({baseUrl:'https://fixture.invalid/v1',model:'fixture',apiKey:'engineering-only',enabled:true});
 t.after(async()=>{await service.close();await store.close();});
 const ids=await store.update(s=>{
  const p=ensureKernel(upgradeProject(createWorkspace(s,{name:'工程专题测试',goal:'检验选题接续'},'create'))),a=Object.values(p.artifacts)[0];
  for(let i=0;i<2;i++){const source=executeCommand(s,p.id,'import-source',{title:`工程资料${i}`,contentLevel:'abstract',text:`Engineering observation ${i}.`},`source${i}`);const access=executeCommand(s,p.id,'record-access',{sourceId:source.id,level:'abstract'},`access${i}`);a.draft.sourceAccessIds.push(access.id);}
  const q=kernelCommand(s,p.id,'create-question',{baseStateVersion:p.researchKernel.version,text:'工程观察是否可比较？'},'q');
  const saved=capture(p,a,'capture');
  const branch=kernelCommand(s,p.id,'open-branch',{baseStateVersion:p.researchKernel.version,inputArtifactId:a.id,inputRevisionId:saved.id,baseInputVersion:a.draft.version,itemId:q.id,itemRevisionId:q.revisionId},'branch');
  const b=p.artifacts[branch.artifactId];
  const library=kernelCommand(s,p.id,'open-topic-library',{baseStateVersion:p.researchKernel.version,inputArtifactId:b.id,inputRevisionId:b.headRevisionId,baseInputVersion:b.draft.version},'library');
  return {projectId:p.id,branchId:b.id,libraryId:library.artifactId,questionId:q.id};
 });return {store,service,...ids};
}
const get=async f=>f.store.read(s=>s.projects[f.projectId]);
async function startReview(f){const p=await get(f),a=p.artifacts[f.libraryId];const started=await f.service.start(p.id,{mode:'topic-review',artifactId:a.id,baseVersion:a.draft.version,accessIds:a.draft.sourceAccessIds},randomUUID());return started;}

test('library screening preserves previous exports, exact question, sources and adoption',async t=>{
 const f=await setup(t),before=await get(f),a=before.artifacts[f.libraryId],old=exportProgress(before,a.id,a.headRevisionId),id=a.draft.sourceAccessIds[0];
 await f.store.update(s=>kernelCommand(s,f.projectId,'update-topic-library',{artifactId:a.id,baseVersion:a.draft.version,decisions:[{accessId:id,decision:'included'}]},'screen'));
 const p=await get(f),now=p.researchResults[p.artifacts[a.id].draft.resultId];
 assert.equal(now.library.entries[0].decision,'included');assert.equal(old.research.library.entries[0].decision,'pending');assert.deepEqual(exportProgress(p,a.id,a.headRevisionId),old);assert.deepEqual(p.accesses,before.accesses);assert.deepEqual(p.decisions,before.decisions);assert.equal(p.researchKernel.currentQuestion,null);
 await assert.rejects(f.store.update(s=>kernelCommand(s,p.id,'update-topic-library',{artifactId:a.id,baseVersion:p.artifacts[a.id].draft.version,addAccessIds:['foreign']},'bad')),e=>e.code==='invalid_scope');
});
test('topic review completes all selected papers and creates central result without choosing inclusions',async t=>{
 let instruction;const f=await setup(t,async input=>{instruction=input.instruction;return {text:JSON.stringify(topicFixture(input.materials))+'\n说明：额外尾注保留审计。',usage:{total_tokens:10},cost:{status:'unknown'},provenance:{model:'fixture'}};});
 const before=await get(f),run=await startReview(f);await f.service.running.get(run.taskId)?.promise;const p=await get(f),task=p.researchTasks[run.taskId],r=p.researchResults[p.artifacts[f.libraryId].draft.resultId];
 assert.equal(task.status,'completed',task.error);assert.equal(r.paperNotes.length,2);assert.equal(r.topicSections.length,3);assert.ok(r.library.entries.every(e=>e.decision==='pending'));assert.deepEqual(p.decisions,before.decisions);assert.ok(instruction.includes('selectedResearchItem'));assert.ok(instruction.includes('"parentArtifact":null'));
 const calls=await f.store.read(s=>s.modelCalls);assert.equal(calls.length,1);assert.match(calls[0].outputText,/额外尾注/);assert.equal(calls[0].formatNormalization.contentRewritten,false);assert.ok(!r.blocks.some(b=>b.text.includes('额外尾注')));
});
test('late topic result cannot replace newer screening and remains inspectable',async t=>{
 let release,started;const waiting=new Promise(r=>started=r);const f=await setup(t,input=>{started();return new Promise(r=>release=()=>r({text:JSON.stringify(topicFixture(input.materials)),provenance:{model:'fixture'}}));});
 const run=await startReview(f);await waiting;const before=await get(f),a=before.artifacts[f.libraryId];await f.store.update(s=>kernelCommand(s,f.projectId,'update-topic-library',{artifactId:a.id,baseVersion:a.draft.version,decisions:[{accessId:a.draft.sourceAccessIds[0],decision:'excluded'}]},'changed-screen'));
 const resultId=(await get(f)).artifacts[a.id].draft.resultId;release();await f.service.running.get(run.taskId)?.promise;const p=await get(f),task=p.researchTasks[run.taskId];assert.equal(task.status,'completed');assert.equal(task.staleInput,true);assert.equal(p.artifacts[a.id].draft.resultId,resultId);assert.equal(p.researchResults[task.resultId].paperNotes.length,2);
});
test('topic validator refuses missing papers, unsupported judgments and unknown classified as direct',async t=>{
 const f=await setup(t),p=await get(f),materials=materialPacket(p,p.artifacts[f.libraryId].draft.sourceAccessIds),valid=topicFixture(materials);
 assert.equal(validateTopicReview(JSON.stringify(valid),materials).paperNotes.length,2);
 const missing=structuredClone(valid);missing.papers.pop();assert.throws(()=>validateTopicReview(JSON.stringify(missing),materials),e=>e.code==='incomplete_paper_coverage');
 const claim=structuredClone(valid);claim.sections[0].judgment.citations=[];assert.throws(()=>validateTopicReview(JSON.stringify(claim),materials),e=>e.code==='unsupported_claim');
 const uncertain=structuredClone(valid);uncertain.papers[0].fields.relevance.status='unknown';uncertain.papers[0].fields.relevance.passages=[];assert.throws(()=>validateTopicReview(JSON.stringify(uncertain),materials),e=>e.code==='model_structure');
});
test('topic aggregation cannot cite an original passage omitted from its supplied excerpts',()=>{
 const combined={paperNotes:[{ref:'R1',fields:{relevance:{text:'known',status:'reported',passages:['P1']}}}]};
 assert.throws(()=>completeTopicAggregation(JSON.stringify({classifications:[{ref:'R1',relationship:'direct'}],sections:[{judgment:{citations:[{ref:'R1',passage:'P2'}]},reasoning:[]}]}),combined),e=>e.code==='invalid_citation');
});

test('explicit passage objects resolve saved source text and retain model excerpts only as audit data',async t=>{
 const f=await setup(t),p=await get(f),materials=materialPacket(p,p.artifacts[f.libraryId].draft.sourceAccessIds),data=topicFixture(materials);
 data.papers[0].fields.findings.passages=[{passage:'P1',quote:'A model-written nonverbatim summary.'}];
 const result=validateTopicReview(JSON.stringify(data),materials),field=result.paperNotes[0].fields.findings;
 assert.ok(materials[0].text.includes(field.quotes[0]));assert.notEqual(field.quotes[0],'A model-written nonverbatim summary.');
 assert.deepEqual(field.observations[0].citations[0].locatorAudit,{input:{passage:'P1',quote:'A model-written nonverbatim summary.'},resolvedBy:'explicit_passage_id',modelExcerptUsedAsSource:false,modelExcerptMatches:false});
 for(const locator of [{quote:materials[0].text},{passage:'P999'},{passage:1}]){
  data.papers[0].fields.findings.passages=[locator];assert.throws(()=>validateTopicReview(JSON.stringify(data),materials),e=>e.code==='invalid_citation');
 }
});

test('explicit retry reuses complete topic extraction and only reruns the rejected synthesis',async t=>{
 let supplied,calls=0;const f=await setup(t,async input=>{
  calls++;
  if(calls===1){supplied=input.materials;const bad=topicFixture(supplied);bad.sections[0].judgment.citations=[];return {text:JSON.stringify(bad),provenance:{model:'fixture'}};}
  assert.equal(input.materials.length,0);const data=topicFixture(supplied);data.classifications=data.papers.map(p=>({ref:p.ref,relationship:p.relationship}));delete data.papers;return {text:JSON.stringify(data),provenance:{model:'fixture'}};
 });
 const first=await startReview(f);await f.service.running.get(first.taskId)?.promise;const p=await get(f),failed=p.researchTasks[first.taskId];assert.equal(failed.errorCode,'unsupported_claim');
 const a=p.artifacts[f.libraryId],retry=await f.service.start(p.id,{mode:'topic-review',artifactId:a.id,baseVersion:a.draft.version,accessIds:a.draft.sourceAccessIds,retryTaskId:failed.id},'explicit-topic-retry');
 await f.service.running.get(retry.taskId)?.promise;const after=await get(f),task=after.researchTasks[retry.taskId];assert.equal(task.status,'completed',task.error);assert.equal(calls,2);assert.equal(task.toolRuns[0].name,'model.topic-synthesis');assert.equal(task.paperBatchRecords[0].recovery.newModelCall,false);assert.equal(after.researchResults[task.resultId].paperNotes.length,2);
});

test('a narrower synthesis keeps earlier library paper notes while exporting its exact input scope',async t=>{
 const f=await setup(t),first=await startReview(f);await f.service.running.get(first.taskId)?.promise;
 const before=await get(f),a=before.artifacts[f.libraryId],r=before.researchResults[a.draft.resultId],oldNote=r.paperNotes[1];
 const next=await f.service.start(before.id,{mode:'topic-review',artifactId:a.id,baseVersion:a.draft.version,accessIds:[a.draft.sourceAccessIds[0]]},'narrow-topic-review');await f.service.running.get(next.taskId)?.promise;
 const p=await get(f),task=p.researchTasks[next.taskId],library=p.researchResults[p.artifacts[a.id].draft.resultId],report=p.researchResults[task.resultId];
 assert.equal(task.status,'completed',task.error);assert.equal(library.paperNotes.length,2);assert.deepEqual(library.paperNotes[1],oldNote);assert.equal(report.paperNotes.length,1);assert.equal(library.reviewAccessIds.length,1);assert.equal(report.accessIds.length,1);
});

test('topic search pins the saved question, preserves expansion intent and supplies complete calibration materials',async t=>{
 let sent;const f=await setup(t,async input=>{sent=input;return {text:JSON.stringify({explanation:'保持本题对象，补全同义词。',scope:'同一专题的扩展候选。',questions:[],query:'observation[tiab]'}),provenance:{model:'fixture'}};});
 const before=await get(f),a=before.artifacts[f.libraryId];
 const run=await f.service.start(before.id,{mode:'clarify',artifactId:a.id,baseVersion:a.draft.version,query:'old query',searchScopeMode:'expanded',accessIds:a.draft.sourceAccessIds},'topic-clarify');
 await f.service.running.get(run.taskId)?.promise;const p=await get(f),task=p.researchTasks[run.taskId];
 assert.equal(task.status,'completed',task.error);assert.equal(task.input.itemTarget.itemId,f.questionId);assert.equal(task.input.context.primaryResearchObject.revisionId,a.branchQuestion.revisionId);assert.equal(task.input.searchScopeMode,'expanded');assert.equal(sent.materials.length,2);assert.deepEqual(sent.materials.map(m=>m.text),a.draft.sourceAccessIds.map(id=>before.accesses[id].text));assert.match(sent.instruction,/组内以 OR/);assert.match(sent.instruction,/数量波动不等于/);assert.match(sent.instruction,/primaryResearchObject/);assert.equal(p.researchKernel.currentQuestion,before.researchKernel.currentQuestion);
 await assert.rejects(f.service.start(p.id,{mode:'clarify',artifactId:a.id,baseVersion:p.artifacts[a.id].draft.version,itemId:'another-topic'},'wrong-topic'),e=>e.code==='invalid_target');
 await assert.rejects(f.service.start(p.id,{mode:'clarify',artifactId:a.id,baseVersion:p.artifacts[a.id].draft.version,searchScopeMode:'anything'},'wrong-scope'),e=>e.code==='invalid_scope');
 await f.store.update(s=>{const item=s.projects[p.id].researchItems[f.questionId];item.revisions.push({...item.revisions[0],id:'later-topic-version',text:'A different version of the question'});});
 await assert.rejects(f.service.start(p.id,{mode:'clarify',artifactId:a.id,baseVersion:p.artifacts[a.id].draft.version,itemRevisionId:'later-topic-version'},'wrong-version-only'),e=>e.code==='invalid_target');
});

test('zero-result topic retrieval retains its query, date, question and scope without creating a model call',async t=>{
 const f=await setup(t,undefined,{search:async query=>({query,database:'PubMed',searchedAt:'2026-09-09T00:00:00Z',searches:[{sort:'relevance',total:0,ids:[]},{sort:'pub_date',total:0,ids:[]}],records:[],missingIds:[],warnings:[],coverage:'工程零结果'})});
 const before=await get(f),a=before.artifacts[f.libraryId];const run=await f.service.start(before.id,{mode:'retrieve',artifactId:a.id,baseVersion:a.draft.version,query:'test empty',searchScopeMode:'expanded'},'empty-topic');
 await f.service.running.get(run.taskId)?.promise;const p=await get(f),task=p.researchTasks[run.taskId],search=p.searches[task.searchId];
 assert.equal(task.status,'completed',task.error);assert.equal(task.outcome,'no_results');assert.equal(search.scopeMode,'expanded');assert.equal(search.artifactId,a.id);assert.equal(search.topicTarget.revisionId,a.branchQuestion.revisionId);assert.deepEqual(p.accesses,before.accesses);assert.equal(task.calls.length,0);
});

test('optional template choices are bounded and cannot discard scientific content',async t=>{
 const f=await setup(t),p=await get(f),materials=materialPacket(p,p.artifacts[f.libraryId].draft.sourceAccessIds),data=topicFixture(materials);
 data.sections[0].presentation={layout:'sequence'};data.sections[1].presentation={layout:'html',html:'<script>bad()</script>'};data.sections[2].presentation={layout:'cards'};
 const parsed=validateTopicReview(JSON.stringify(data),materials);
 assert.deepEqual(parsed.topicSections.map(s=>s.presentation.layout),['sequence','cards','cards']);assert.equal(parsed.topicSections[1].presentation.origin,'default');assert.equal(parsed.blocks.filter(b=>b.analysisRole==='reasoning').length,3);assert.equal(parsed.citations.length,6);assert.ok(!JSON.stringify(parsed).includes('<script>'));
 data.sections[1].reasoning[0]={text:'No evidence',status:'reported',citations:[]};assert.throws(()=>validateTopicReview(JSON.stringify(data),materials),e=>e.code==='unsupported_claim');
});


test('topic synthesis accepts C with cited information and preserves legacy recovery semantics',async t=>{
 const f=await setup(t),p=await get(f),materials=materialPacket(p,p.artifacts[f.libraryId].draft.sourceAccessIds),data=topicFixture(materials);
 data.papers[0].relationship='peripheral';data.papers[0].fields.relevance.text='该材料提供同一疾病的背景信息。可作为本专题的桥接参照。';
 const current=validateTopicReview(JSON.stringify(data),materials).paperNotes[0];
 assert.equal(current.relationship,'peripheral');assert.equal(current.criteriaVersion,'topic-abcd-v1');assert.equal(current.summary,data.papers[0].fields.relevance.text);assert.ok(current.fields.relevance.quotes.length);
 const historic=validateTopicReview(JSON.stringify(data),materials,{criteriaVersion:null}).paperNotes[0];assert.equal(historic.criteriaVersion,null);
});
