import {researchLanguageRules} from '../../shared/research-language.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {LocalStore} from '../src/store.mjs';
import {ResearchApplication} from '../src/research-application.mjs';
import {editTopicWorkspace} from '../src/topic-library-workflow.mjs';
import {writingInput,validateBlueprint,validateParagraph,validateWritingAudit,recoverWritingOutputs} from '../src/topic-writing.mjs';
import {currentSectionVersion,writingMarkdown} from '../../shared/topic-writing.mjs';
import {seedWriting,writingModel} from './fixtures/writing.mjs';
import {manuscriptProseRules,ACADEMIC_WRITING_STANDARD_VERSION} from '../../shared/academic-writing.mjs';
async function fixture(t,options={}){
 const directory=await mkdtemp(join(tmpdir(),'rw-writing-')),store=await new LocalStore(directory).initialize(),model=writingModel(options),service=await new ResearchApplication(store,{modelFactory:()=>model}).initialize();
 await service.settings.save({baseUrl:'https://test.invalid/v1',model:'fixture',apiKey:'isolated',enabled:true});t.after(async()=>{await service.close();await store.close();});
 const seeded=await store.update(seedWriting),{p,a,outline,ids}=seeded;
 const edit=body=>store.update(s=>{const project=s.projects[p.id],artifact=project.artifacts[a.id];return editTopicWorkspace(project,artifact,{baseWorkspaceVersion:artifact.topicWorkspace.version,...body},randomUUID());});
 const snapshot=()=>store.read(s=>s.projects[p.id].artifacts[a.id].topicWorkspace);
 const run=async(extra={})=>{const artifact=await store.read(s=>s.projects[p.id].artifacts[a.id]),started=await service.start(p.id,{artifactId:a.id,baseVersion:artifact.draft.version,mode:'topic-writing',text:'按本节论证写作',accessIds:ids,topicOptions:{outlineId:outline.id,sectionId:'outline-1-1'},...extra},randomUUID());await service.running.get(started.taskId)?.promise;return store.read(s=>s.projects[p.id].researchTasks[started.taskId]);};
 return {...seeded,store,service,model,edit,snapshot,run,confirm:()=>edit({action:'confirm-outline',outlineId:outline.id,accessIds:ids})};
}
test('confirmation opens writing without calls; scoped writing caches and preserves outline, grades, notes',async t=>{
 const f=await fixture(t);await assert.rejects(f.run,e=>e.code==='outline_unconfirmed');await f.confirm();let w=await f.snapshot();assert.equal(w.writingWorkspaces[f.outline.id].activeSectionId,'outline-1-1');assert.equal(f.model.calls.length,0);
 await assert.rejects(()=>f.run({accessIds:[...f.ids,f.otherId]}),e=>e.code==='invalid_scope');
 const first=await f.run();assert.equal(first.status,'completed',first.error);assert.deepEqual(f.model.calls.map(c=>c.purpose),['blueprint','paragraph']);
 assert.ok(f.model.calls.every(c=>c.instruction.startsWith(researchLanguageRules)&&c.instruction.includes(manuscriptProseRules)),'Both planning and drafting receive manuscript/working-note separation and genre guidance');
 await f.run({topicOptions:{outlineId:f.outline.id,sectionId:'outline-1-1',auditOnly:true}});assert.deepEqual(f.model.calls.map(c=>c.purpose),['blueprint','paragraph','audit']);
 assert.ok(f.model.calls.every(c=>!c.instruction.includes('工程材料 3')));
 w=await f.snapshot();const v=currentSectionVersion(w.writingWorkspaces[f.outline.id].sections['outline-1-1']);assert.equal(v.paragraphs[0].audit[0].status,'deeper');assert.match(v.paragraphs[0].text,/\[1\]/);
 const again=await f.run();assert.equal(again.status,'completed');assert.equal(f.model.calls.length,3);assert.equal(again.reusedWritingVersionId,v.id);assert.deepEqual(w.outlines,[f.outline]);
 const a=await f.store.read(s=>s.projects[f.p.id].artifacts[f.a.id]);assert.equal(a.draft.notes.intent,'保留用户此前的研究想法');assert.equal(Object.keys(a.topicWorkspace.screenings).length,3);
});
test('interrupted audit resumes saved paragraph; rejected paragraph can retry without replaying bad raw output',async t=>{
 for(const options of [{failAudit:true},{rejectParagraph:true}]){const f=await fixture(t,options);await f.confirm();const extra=options.failAudit?{topicOptions:{outlineId:f.outline.id,sectionId:'outline-1-1',auditOnly:true}}:{};if(options.failAudit)await f.run();const failed=await f.run(extra);assert.equal(failed.status,'failed');const resumed=await f.run(extra);assert.equal(resumed.status,'completed',resumed.error);assert.equal(f.model.calls.filter(c=>c.purpose==='blueprint').length,1);assert.equal(f.model.calls.filter(c=>c.purpose==='paragraph').length,options.failAudit?1:2);}
});
test('manual edits retain versions, invalidate changed audits, reject foreign refs and move to next subsection',async t=>{
 const f=await fixture(t);await f.confirm();await f.run();let w=await f.snapshot(),s=w.writingWorkspaces[f.outline.id].sections['outline-1-1'],v=currentSectionVersion(s),body={outlineId:f.outline.id,sectionId:'outline-1-1',baseWritingVersion:v.id};
 await assert.rejects(()=>f.edit({...body,action:'writing-save',paragraphs:['伪造来源[999]']}),e=>e.code==='invalid_citation');
 await f.edit({...body,action:'writing-save',paragraphs:[v.paragraphs[0].text+'研究计划仍需确认。']});w=await f.snapshot();s=w.writingWorkspaces[f.outline.id].sections['outline-1-1'];const edited=currentSectionVersion(s);assert.equal(s.versions.length,2);assert.deepEqual(s.versions[0],v);assert.deepEqual(edited.paragraphs[0].audit,[]);
 await f.run();assert.equal(currentSectionVersion((await f.snapshot()).writingWorkspaces[f.outline.id].sections['outline-1-1']).id,edited.id);assert.equal(f.model.calls.length,2);
 await assert.rejects(()=>f.edit({...body,action:'writing-complete'}),e=>e.code==='writing_conflict');await f.edit({...body,baseWritingVersion:edited.id,action:'writing-complete'});w=await f.snapshot();assert.equal(w.writingWorkspaces[f.outline.id].activeSectionId,'outline-1-2');assert.match(writingMarkdown(f.outline,w.writingWorkspaces[f.outline.id]),/研究计划仍需确认/);
 await f.edit({...body,baseWritingVersion:edited.id,action:'writing-view',versionId:v.id});assert.equal(currentSectionVersion((await f.snapshot()).writingWorkspaces[f.outline.id].sections['outline-1-1']).id,v.id);
});
test('legacy confirmed outlines can open writing without re-confirmation',async t=>{
 const f=await fixture(t);await f.confirm();await f.store.update(s=>{delete s.projects[f.p.id].artifacts[f.a.id].topicWorkspace.writingWorkspaces;});await f.edit({action:'writing-open',outlineId:f.outline.id});assert.equal((await f.snapshot()).writingWorkspaces[f.outline.id].activeSectionId,'outline-1-1');assert.equal(f.model.calls.length,0);
});
test('local scholarly revisions retain exact sentence anchors and original versions without claiming an audit',async t=>{
 const f=await fixture(t);await f.confirm();await f.run();await f.run({topicOptions:{outlineId:f.outline.id,sectionId:'outline-1-1',auditOnly:true}});
 const w=await f.snapshot(),v=currentSectionVersion(w.writingWorkspaces[f.outline.id].sections['outline-1-1']),count=f.model.calls.length;
 const sentences=[{text:'固定观察顺序限制了成像效应的独立解释。',kind:'inference',citations:[{ref:'R1',passage:'P1'}]}],body={action:'writing-save',outlineId:f.outline.id,sectionId:'outline-1-1',baseWritingVersion:v.id,editor:'assistant',revisionReason:'收窄主张并精简语言',paragraphs:['固定观察顺序限制了成像效应的独立解释。[1]'],paragraphDetails:[{topic:'观察顺序与效应解释',sentences}]};
 await assert.rejects(()=>f.edit({...body,paragraphs:['与逐句映射不符的文本。[1]']}),e=>e.code==='invalid_input');
 await assert.rejects(()=>f.edit({...body,paragraphDetails:[{topic:'t',sentences:[{...sentences[0],citations:[{ref:'R1',passage:'P999'}]}]}]}),e=>e.code==='invalid_citation');
 await f.store.update(s=>{s.projects[f.p.id].researchTasks.active={id:'active',artifactId:f.a.id,status:'running',input:{writing:{section:{id:'outline-1-1'}}}};});
 await assert.rejects(()=>f.edit(body),e=>e.code==='writing_running');
 await f.store.update(s=>{s.projects[f.p.id].researchTasks.active.status='completed';});
 const argument={claim:'顺序固定限制了成像效应的独立解释。',relationship:'比较需区分顺序与成像。',boundary:'不建立效应的因果来源。',transition:''};
 await assert.rejects(()=>f.edit({...body,paragraphDetails:[{...body.paragraphDetails[0],argument:{...argument,citations:[{ref:'R999',passage:'P1'}]}}]}),e=>e.code==='invalid_input');
 await assert.rejects(()=>f.edit({...body,paragraphDetails:[{...body.paragraphDetails[0],argument:{...argument,claim:''}}]}),e=>e.code==='invalid_input');
 await f.edit({...body,paragraphDetails:[{...body.paragraphDetails[0],argument}]});const saved=(await f.snapshot()).writingWorkspaces[f.outline.id].sections['outline-1-1'],next=currentSectionVersion(saved);
 assert.deepEqual(saved.versions[0],v);assert.equal(next.actor,'local_assistant');assert.equal(next.paragraphs[0].topic,'观察顺序与效应解释');assert.equal(next.paragraphs[0].sentences[0].citations[0].accessId,f.ids[0]);assert.deepEqual(next.paragraphs[0].audit,[]);assert.equal(next.paragraphs[0].auditProvenance,null);assert.equal(next.paragraphs[0].provenance.modelCalled,false);assert.equal(f.model.calls.length,count);assert.notEqual(saved.completedVersionId,next.id);
 assert.equal(next.writingStandard,ACADEMIC_WRITING_STANDARD_VERSION);assert.equal(next.blueprint.paragraphs[0].topic,next.paragraphs[0].topic);assert.equal(next.blueprint.paragraphs[0].claim,argument.claim);assert.deepEqual(next.blueprint.paragraphs[0].citations,v.blueprint.paragraphs[0].citations);assert.equal(next.blueprintProvenance.editedFrom,v.id);
 await f.run();assert.equal(currentSectionVersion((await f.snapshot()).writingWorkspaces[f.outline.id].sections['outline-1-1']).id,next.id);assert.equal(f.model.calls.length,count);
});
test('missing actual records allow a draft scaffold; external literature still cannot substitute original results',()=>{
 const outline={id:'o',route:'原创研究',sections:[{heading:'结果',children:[{id:'s',evidence:[]}]}]},a={topicWorkspace:{outlines:[outline],outlineConfirmations:[{outlineId:'o'}]}},body={accessIds:[],topicOptions:{outlineId:'o',sectionId:'s'}};
 assert.equal(writingInput({},a,body).mode,'results');body.topicOptions.recordText='实际观察记录';assert.equal(writingInput({},a,body).mode,'results');
 outline.sections[0].heading='方法';body.topicOptions.recordText='';assert.equal(writingInput({},a,body).mode,'literature');
 outline.sections[0].heading='结果呈现计划';body.topicOptions.recordText='';assert.equal(writingInput({},a,body).mode,'proposal');
});
test('blueprint coverage and paragraph citations must match actual non-title passages; records exact',()=>{
 const materials=[{ref:'R1',accessId:'a',sourceId:'s',level:'abstract',text:'Actual excerpt.'}],json=v=>JSON.stringify(v),draft={focus:'focus',paragraphs:[{topic:'t',claim:'c',relationship:'r',transition:'t',boundary:'b',citations:[{ref:'R1',passage:'P1'}]}],coverage:[{ref:'R1',status:'used',reason:'actual'}],needs:[]};
 const plan=validateBlueprint(json(draft),materials).paragraphs[0];assert.throws(()=>validateBlueprint(json({...draft,coverage:[]}),materials),e=>e.code==='incomplete_paper_coverage');assert.throws(()=>validateBlueprint(json(draft),[{...materials[0],level:'title'}]),e=>e.code==='invalid_citation');
 const context={mode:'literature',language:'zh',recordText:'真实记录'},sentence={text:'源文献描述观察。',kind:'reported',citations:[{ref:'R1',passage:'P1'}]};
 assert.throws(()=>validateParagraph(json({sentences:[{...sentence,citations:[{ref:'R2',passage:'P1'}]}]}),materials,plan,context),e=>e.code==='invalid_citation');assert.throws(()=>validateParagraph(json({sentences:[{...sentence,kind:'researcher_record',recordQuote:'伪造记录'}]}),materials,plan,context),e=>e.code==='invalid_study_record');
 assert.throws(()=>validateParagraph(json({sentences:[sentence]}),materials,plan,{...context,mode:'results'}),e=>e.code==='invalid_study_record');
 const paragraph=validateParagraph(json({sentences:[sentence]}),materials,plan,context);assert.throws(()=>validateWritingAudit(json({sentences:[]}),paragraph),e=>e.code==='model_structure');
});

test('uncited framing and inferences keep the draft visible without inventing references',()=>{
 const context={language:'zh',mode:'literature',recordText:''},plan={id:'p',topic:'t',citations:[]};
 const p=validateParagraph(JSON.stringify({sentences:[{text:'首先需要明确研究对象。',kind:'framing',citations:[]},{text:'本段证据提示可能存在情境差异。',kind:'inference',citations:[]}]}),[],plan,context);
 assert.equal(p.sentences[0].checks.length,0);assert.equal(p.sentences[1].checks[0].status,'supplement');assert.ok(p.text.includes('首先需要'));assert.ok(!p.text.includes('['));
});
test('legacy recovery restores only the exact saved failed paragraph, preserves old versions, and is idempotent',async t=>{
 const f=await fixture(t);await f.confirm();const done=await f.run();
 await f.store.update(s=>{const task=s.projects[f.p.id].researchTasks[done.id],section=s.projects[f.p.id].artifacts[f.a.id].topicWorkspace.writingWorkspaces[f.outline.id].sections['outline-1-1'],v=currentSectionVersion(section),call=s.modelCalls.find(c=>c.id===task.calls.at(-1));
 call.outputText=JSON.stringify({sentences:[{text:'首先需要界定比较的范围。',kind:'inference',citations:[]},...v.paragraphs[0].sentences]});call.writingValidation='rejected';Object.assign(task,{status:'failed',error:'文献事实与推论必须有本段实际依据。',progress:'正在写作 1.1 · 第 1 / 1 段'});v.status='generating';v.paragraphs=[];
 const before=structuredClone(v),count=s.modelCalls.length;recoverWritingOutputs(s);assert.deepEqual(section.versions[0],before);assert.equal(section.versions.length,2);assert.equal(currentSectionVersion(section).paragraphs.length,1);assert.equal(task.status,'failed');assert.ok(task.localRecovery);assert.equal(s.modelCalls.length,count);recoverWritingOutputs(s);assert.equal(section.versions.length,2);
 });
});
