import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {LocalStore} from '../src/store.mjs';
import {ResearchApplication} from '../src/research-application.mjs';
import {editTemplates,templateInput,validateOptimization} from '../src/research-templates.mjs';
import {templateSelection} from '../../shared/research-templates.mjs';
import {editTopicWorkspace} from '../src/topic-library-workflow.mjs';
import {currentSectionVersion} from '../../shared/topic-writing.mjs';
import {seedWriting,writingModel} from './fixtures/writing.mjs';
import {templateModel,study,seedTemplateFulltext} from './fixtures/templates.mjs';
const records=[{pmid:'12345',title:'Engineering template: gastric cancer review',text:'This engineering abstract compares detection methods. It is not scientific evidence.',year:'2026',journal:'Engineering journal',level:'abstract',url:'https://pubmed.ncbi.nlm.nih.gov/12345/'}];
async function fixture(t){const directory=await mkdtemp(join(tmpdir(),'rw-template-')),store=await new LocalStore(directory).initialize(),model=templateModel(),pubmed={queryPage:async()=>({total:1,ids:['12345']}),metadata:async()=>records},service=await new ResearchApplication(store,{modelFactory:()=>model,pubmed}).initialize();await service.settings.save({baseUrl:'https://test.invalid/v1',model:'fixture',apiKey:'test',enabled:true});t.after(async()=>{await service.close();await store.close();});const seed=await store.update(seedWriting),{p,a,outline,ids}=seed;
 const snapshot=()=>store.read(s=>s.projects[p.id]);
 const edit=body=>store.update(s=>{const p=s.projects[seed.p.id];return editTemplates(p,p.artifacts[a.id],{baseTemplateVersion:p.templateLibrary?.version??1,...body},randomUUID());});
 const run=async(mode,templateOptions={},extra={})=>{const p=await snapshot(),started=await service.start(p.id,{artifactId:a.id,baseVersion:p.artifacts[a.id].draft.version,accessIds:[],mode,templateOptions,text:'工程验证',...extra},randomUUID());await service.running.get(started.taskId)?.promise;return store.read(s=>s.projects[p.id].researchTasks[started.taskId]);};
 await store.update(s=>editTopicWorkspace(s.projects[p.id],s.projects[p.id].artifacts[a.id],{baseWorkspaceVersion:1,action:'confirm-outline',outlineId:outline.id,accessIds:ids},randomUUID()));
 return {...seed,service,store,model,run,edit,snapshot};}
test('recommend verified candidates, confirm separately, inherit only along research ancestry, cache study',async t=>{
 const f=await fixture(t),before=await f.snapshot();const task=await f.run('template-recommend',{articleType:'review',topic:'胃癌'});assert.equal(task.status,'completed',task.error);let p=await f.snapshot(),l=p.templateLibrary;assert.equal(l.recommendations[0].candidates.length,1);assert.equal(templateSelection(p,p.artifacts[f.a.id]).paper,null);assert.deepEqual(p.sources,before.sources);assert.deepEqual(p.accesses,before.accesses);
 const paperId=l.recommendations[0].candidates[0].paperId;await f.edit({action:'select',paperId});p=await f.snapshot();assert.equal(templateSelection(p,p.artifacts[f.a.id]).paper.id,paperId);
 const child={id:'child',lineage:{artifactId:f.a.id}},sibling={id:'sibling'};p.artifacts.child=child;p.artifacts.sibling=sibling;assert.equal(templateSelection(p,child).paper.id,paperId);assert.equal(templateSelection(p,sibling).paper,null);
 await assert.rejects(()=>f.run('template-study'),e=>e.code==='template_pdf_required');await f.store.update(s=>seedTemplateFulltext(s.projects[f.p.id],paperId));const s=await f.run('template-study');assert.equal(s.status,'completed',s.error);const count=f.model.calls.length;await f.run('template-study');assert.equal(f.model.calls.length,count);
 await f.edit({action:'save-text',paperId,text:'用户提供的新片段',level:'excerpt',location:'Introduction 第2段'});assert.equal((await f.snapshot()).templateLibrary.papers[paperId].textVersion,2);
 await assert.rejects(()=>f.run('template-study'),e=>e.code==='template_pdf_required');assert.equal(f.model.calls.length,count);await f.edit({action:'select',paperId:null});await assert.rejects(()=>f.run('template-study'),e=>e.code==='template_required');
});
test('paragraph optimization is a proposal; application creates a version and invalidates changed audits',async t=>{
 const f=await fixture(t);await f.edit({action:'add-existing',accessId:f.ids[0]});let p=await f.snapshot(),paperId=Object.keys(p.templateLibrary.papers)[0];await f.edit({action:'select',paperId});await assert.rejects(()=>f.run('template-optimize'),e=>e.code==='template_study_required');await f.store.update(s=>seedTemplateFulltext(s.projects[f.p.id],paperId));await f.run('template-study');await f.run('topic-writing',{}, {accessIds:f.ids,topicOptions:{outlineId:f.outline.id,sectionId:'outline-1-1'}});
 p=await f.snapshot();const a=p.artifacts[f.a.id],saved=a.topicWorkspace.writingWorkspaces[f.outline.id].sections['outline-1-1'],v=currentSectionVersion(saved),options={outlineId:f.outline.id,sectionId:'outline-1-1',writingVersionId:v.id,paragraphId:v.paragraphs[0].id};
 const task=await f.run('template-optimize',options);assert.equal(task.status,'completed',task.error);p=await f.snapshot();const proposal=p.templateLibrary.optimizations[0];assert.equal(currentSectionVersion(p.artifacts[a.id].topicWorkspace.writingWorkspaces[f.outline.id].sections['outline-1-1']).id,v.id);
 await f.edit({action:'apply-optimization',optimizationId:proposal.id,choices:[{suggestionId:'suggestion-1',optionId:'option-2'}]});p=await f.snapshot();const next=currentSectionVersion(p.artifacts[a.id].topicWorkspace.writingWorkspaces[f.outline.id].sections['outline-1-1']);assert.notEqual(next.id,v.id);assert.match(next.paragraphs[0].text,/报告为90%/);assert.deepEqual(next.paragraphs[0].audit,[]);assert.equal(next.paragraphs[0].edited,true);
 await assert.rejects(()=>f.edit({action:'apply-optimization',optimizationId:proposal.id,choices:[{suggestionId:'suggestion-1',optionId:'option-1'}]}),e=>e.code==='writing_conflict');
 await assert.rejects(()=>f.run('template-optimize',options),e=>e.code==='writing_conflict');
});
test('optimization refuses invented numbers, swapped citations, ambiguous spans and distinctive copied expression',()=>{
 const input={paragraph:{text:'观察值为90%。[1]'},paper:{text:'独特模板写作内容'}},data={study,diagnosis:'x',suggestions:[{before:'观察值为90%。[1]',issue:'x',options:[{text:'测得观察值为90%。[1]',reason:'x',useWhen:'x'}]}]};
 assert.equal(validateOptimization(data,input).suggestions[0].start,0);
 for(const after of ['观察值为99%。[1]','观察值为90%。[2]']){const d=structuredClone(data);d.suggestions[0].options[0].text=after;assert.throws(()=>validateOptimization(d,input),e=>e.code==='optimization_facts_changed');}
 assert.throws(()=>validateOptimization(data,{...input,paragraph:{text:input.paragraph.text+input.paragraph.text}}),e=>e.code==='model_structure');
 const copy='This distinctive long original passage contains twelve separate words that should never be copied wholesale';const d=structuredClone(data);d.suggestions[0].options[0].text=copy+'90%[1]';assert.throws(()=>validateOptimization(d,{...input,paper:{text:copy}}),e=>e.code==='template_similarity');
});
test('chosen template passage is exact, inherited selection can be narrowed, and older text versions cannot be selected',async t=>{
 const f=await fixture(t);await f.edit({action:'add-existing',accessId:f.ids[0]});let p=await f.snapshot(),paper=Object.values(p.templateLibrary.papers)[0];await f.edit({action:'select',paperId:paper.id});
 await f.edit({action:'select-passage',paperId:paper.id,textVersion:1,start:0,end:20});p=await f.snapshot();let selected=templateSelection(p,p.artifacts[f.a.id]);assert.equal(selected.focus.text,paper.text.slice(0,20));
 await f.store.update(s=>seedTemplateFulltext(s.projects[f.p.id],paper.id));await f.run('template-study');await f.run('topic-writing',{}, {accessIds:f.ids,topicOptions:{outlineId:f.outline.id,sectionId:'outline-1-1'}});p=await f.snapshot();const version=currentSectionVersion(p.artifacts[f.a.id].topicWorkspace.writingWorkspaces[f.outline.id].sections['outline-1-1']);
 const input=templateInput(p,p.artifacts[f.a.id],{mode:'template-optimize',templateOptions:{outlineId:f.outline.id,sectionId:'outline-1-1',writingVersionId:version.id,paragraphId:'paragraph-1'}});assert.equal(input.focusText,paper.text.slice(0,20));assert.equal(input.paper.level,'fulltext');assert.equal(input.fullStudy.status,'completed');
 await f.edit({action:'save-text',paperId:paper.id,text:'New user supplied original text.',level:'excerpt',location:'Introduction paragraph 2'});
 await assert.rejects(()=>f.edit({action:'select-passage',paperId:paper.id,textVersion:1,start:0,end:10}),e=>e.code==='template_conflict');
});
test('reviewed manuscript supports anchored introduction proposals and abstract adoption; edits stale abstract exports',async t=>{
 const f=await fixture(t);await f.edit({action:'add-existing',accessId:f.ids[0]});let p=await f.snapshot();const paperId=Object.keys(p.templateLibrary.papers)[0];await f.edit({action:'select',paperId});await f.store.update(s=>seedTemplateFulltext(s.projects[f.p.id],paperId));await f.run('template-study');
 await assert.rejects(()=>f.run('template-refine',{outlineId:f.outline.id,focus:'abstract'}),e=>e.code==='manuscript_review_required');
 await f.run('manuscript-writing',{}, {accessIds:f.ids,topicOptions:{outlineId:f.outline.id,language:'zh'}});
 await f.store.update(s=>{const a=s.projects[f.p.id].artifacts[f.a.id],w=a.topicWorkspace.writingWorkspaces[f.outline.id];a.topicWorkspace.outlines[0].sections[0].heading='引言';for(const section of Object.values(w.sections))section.completedVersionId=section.activeVersionId;});
 const intro=await f.run('template-refine',{outlineId:f.outline.id,focus:'introduction'});assert.equal(intro.status,'completed',intro.error);p=await f.snapshot();assert.equal(p.templateLibrary.optimizations.length,2);
 const abstract=await f.run('template-refine',{outlineId:f.outline.id,focus:'abstract'});assert.equal(abstract.status,'completed',abstract.error);p=await f.snapshot();const proposal=p.templateLibrary.refinements.at(-1);assert.equal(proposal.sentences.length,1);
 await f.edit({action:'apply-abstract',refinementId:proposal.id});p=await f.snapshot();assert.equal(p.artifacts[f.a.id].topicWorkspace.writingWorkspaces[f.outline.id].abstract.refinementId,proposal.id);
 await f.store.update(s=>{const a=s.projects[f.p.id].artifacts[f.a.id],w=a.topicWorkspace.writingWorkspaces[f.outline.id],v=currentSectionVersion(w.sections['outline-1-1']);editTopicWorkspace(s.projects[f.p.id],a,{baseWorkspaceVersion:a.topicWorkspace.version,action:'writing-save',outlineId:f.outline.id,sectionId:'outline-1-1',baseWritingVersion:v.id,paragraphs:v.paragraphs.map(p=>p.text+'研究者修订。')},'manual');});
 await assert.rejects(()=>f.edit({action:'apply-abstract',refinementId:proposal.id}),e=>e.code==='writing_conflict');
});
