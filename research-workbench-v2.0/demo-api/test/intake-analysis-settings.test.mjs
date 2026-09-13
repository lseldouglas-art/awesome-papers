import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from '../src/server.mjs';
import {createClient} from '../src/client.mjs';
import {ModelSettings} from '../src/model-settings.mjs';
import {intakeQuestions, initialIntake, researcherPlan} from '../../shared/researcher-intake.mjs';
import {reasoningProfile} from '../../shared/model-analysis.mjs';
import {buildResearchContext} from '../src/workflows.mjs';

test('intake persists drafts across restart, confirms an explicit profile and plan, and protects concurrent edits',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'rw-intake-test-'));
 let server=await startServer({directory,port:0});t.after(()=>server.close());let client=createClient({baseUrl:server.url});
 let project=await client.createProject({name:'工程测试课题',goal:'完全不了解该领域，希望了解领域现状',intake:true});
 assert.equal(project.researcherIntake.status,'draft');assert.equal(project.researcherProfile,undefined);
 assert.equal(Object.keys(project.researcherIntake.answers).length,2);
 const answers={...project.researcherIntake.answers,background:{choice:'临床工作者'}};
 let saved=await client.command(project.id,'save-researcher-intake',{baseVersion:1,answers});assert.equal(saved.version,2);
 await server.close();server=await startServer({directory,port:0});client=createClient({baseUrl:server.url});
 project=await client.workspace(project.id);assert.equal(project.researcherIntake.answers.background.choice,'临床工作者');
 assert.equal(project.metadataVersion,1);assert.equal(project.researchKernel.currentQuestion,null);
 await assert.rejects(client.command(project.id,'save-researcher-intake',{baseVersion:1,answers}),e=>e.code==='metadata_conflict');
 await assert.rejects(client.command(project.id,'save-researcher-intake',{baseVersion:2,answers,confirm:true}),e=>e.code==='invalid_input');
 for(const q of intakeQuestions)answers[q.id]??={note:'未知'};
 answers.resources={values:{'数据或病例资料':'未知','统计支持':'需要协作'}};
 answers.schedule={choice:intakeQuestions[5].options[2],note:'三个月'};
 saved=await client.command(project.id,'save-researcher-intake',{baseVersion:2,answers,confirm:true});
 project=await client.workspace(project.id);assert.equal(project.metadataVersion,2);assert.equal(project.researcherProfile.version,saved.version);
 assert.match(project.researcherProfile.plan.constraints.join(''),/未知|协作|固定期限/);
 const artifact=Object.values(project.artifacts)[0];assert.deepEqual(buildResearchContext(project,artifact).researcherProfile,project.researcherProfile);
 assert.equal(project.researchKernel.currentQuestion,null);assert.equal(project.researcherIntake.history.length,2);
 const established=project.researcherProfile;
 await client.command(project.id,'save-researcher-intake',{baseVersion:3,answers:{...answers,background:{note:'修改待确认'}}});
 project=await client.workspace(project.id);assert.deepEqual(project.researcherProfile,established);assert.equal(project.metadataVersion,2);
 const legacy=await client.createProject({name:'已有课题',goal:'现有问题'});assert.equal(legacy.researcherIntake,undefined);
});
test('starting plan responds to scientific intent and concrete constraints without defaulting to a review manuscript',()=>{
 const answers=initialIntake('我想了解领域现状，还不了解').answers;
 assert.match(researcherPlan(answers).steps[0].title,/基础/);assert.match(researcherPlan(answers).steps[2].title,/阅读领域简报/);
 answers.startingPoint={choice:intakeQuestions[0].options[3]};answers.abilities={values:{'目前无法开展':'动物实验'}};
 const plan=researcherPlan(answers);assert.match(plan.steps[0].title,/方法要回答的问题/);assert.match(plan.constraints.join(''),/动物实验/);
});
test('model settings advertise only supported effort values and persist effort and batch size without leaking keys',async()=>{
 const settings=await new ModelSettings(await mkdtemp(join(tmpdir(),'rw-analysis-settings-'))).initialize();
 const body={baseUrl:'https://open.bigmodel.cn/api/paas/v4',model:'GLM-5.3-Flash',apiKey:'private-test-key',enabled:true};
 let view=await settings.save(body);assert.equal(view.reasoningEffort,'low');assert.equal(view.paperBatchSize,50);
 assert.deepEqual(view.reasoning.options.map(o=>o.value),['low','high','max']);
 view=await settings.save({...body,apiKey:'',reasoningEffort:'high',paperBatchSize:100});assert.equal(view.reasoningEffort,'high');assert.equal(view.paperBatchSize,100);
 await settings.save({...body,apiKey:''});assert.equal(settings.config.reasoningEffort,'high');assert.equal(settings.config.paperBatchSize,100);
 assert.doesNotMatch(JSON.stringify(view),/private-test-key/);
 await assert.rejects(settings.save({...body,reasoningEffort:'medium'}),e=>e.code==='invalid_configuration');
 await assert.rejects(settings.save({...body,paperBatchSize:12}),e=>e.code==='invalid_configuration');
 assert.deepEqual(reasoningProfile('other','https://other.test').options.map(o=>o.value),['default']);
});

test('a successful re-fetch retains the previous failed analysis continuation, a newer analysis supersedes it',async()=>{
 const {pendingDomainAnalysis}=await import('../../shared/research-guidance.mjs');
 const failed={id:'failed',artifactId:'a',mode:'landscape',status:'failed',createdAt:'2026-09-13T01:00:00Z'};
 const fetched={id:'fetched',artifactId:'a',mode:'retrieve',status:'completed',createdAt:'2026-09-13T02:00:00Z'};
 assert.equal(pendingDomainAnalysis([failed,fetched],'a'),failed);
 assert.equal(pendingDomainAnalysis([failed,fetched],'b'),null);
 for(const status of ['running','completed'])assert.equal(pendingDomainAnalysis([failed,fetched,{...failed,id:'new',createdAt:'2026-09-13T03:00:00Z',status}],'a'),null);
});
