import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { assessmentFor, normalizeAssessment, validAssessment, decisionTemplates, decisionPresentation, estimateText } from '../../shared/question-assessment.mjs';
import { validateComparisonOutput } from '../src/workflows.mjs';
import { assessmentFixture } from './assessment-fixture.mjs';
import { createWorkspace } from '../src/workspace.mjs';
import { upgradeProject, exportProgress } from '../src/progress.mjs';
import { ensureKernel, createQuestionComparison, researchState, kernelCommand } from '../src/kernel.mjs';

test('new comparisons require numeric ranges and assumptions; legacy validation remains read compatible',()=>{
  const data={explanation:'测试解释',next:'用户取舍',questions:[{title:'测试选题',question:'研究什么？',scope:'范围',rationale:'理由',unknowns:[],feasibility:{known:[],unknown:[]},supporting:[],conflicting:[]}]};
  assert.doesNotThrow(()=>validateComparisonOutput(JSON.stringify(data),[]));
  assert.throws(()=>validateComparisonOutput(JSON.stringify(data),[],{requireAssessment:true}),e=>e.code==='model_structure');
  data.questions[0].assessment=assessmentFixture();
  const out=validateComparisonOutput(JSON.stringify(data),[],{requireAssessment:true});
  assert.equal(out.questions[0].assessment.kind,'planning_estimate');
  for(const mutate of [a=>a.estimates[0].min=0,a=>a.estimates[0].max=2,a=>a.estimates[0].assumptions=[],a=>a.estimates[0].basis='',a=>a.estimates[0].sensitivity='',a=>a.estimates.pop(),a=>a.value='待确认']){
    const a=assessmentFixture();mutate(a);assert.equal(validAssessment(a),false);
    data.questions[0].assessment=a;assert.throws(()=>validateComparisonOutput(JSON.stringify(data),[],{requireAssessment:true}));
  }
});
test('legacy templates and paired presentations remain archived; presentation is constrained',async()=>{
  assert.equal(Object.keys(decisionTemplates).length,6);
  for(const [template,v] of Object.entries(decisionTemplates)){
    await access(new URL(`../../${v.reference ?? `design-templates/topic-decisions/${v.image}`}`,import.meta.url));
    const a=assessmentFixture();a.presentation={template,reason:'按内容选择'};
    assert.equal(normalizeAssessment(normalizeAssessment(a)).presentation.template,template);
  }
  assert.equal(decisionPresentation({template:'timeline',reason:'内容理由',css:'position:fixed'}).origin,'default');
  assert.equal(decisionPresentation({template:'<script>',reason:'内容理由'}).template,'brief');
});
test('legacy scenarios have reproducible numeric planning assumptions without changing the record',()=>{
  const old={id:'q',text:'前瞻性队列研究',unknowns:['实际样本量未知']},snapshot=structuredClone(old);
  const a=assessmentFor(old),b=assessmentFor({text:'既有数据的回顾性分析'});
  assert.equal(a.origin,'scenario');assert.equal(estimateText(a.estimates[0]),'11–28 个月');
  assert.equal(estimateText(b.estimates[0]),'5–9 个月');assert.deepEqual(old,snapshot);
  assert.match(a.estimates[0].basis,/不是文献统计或本题实测/);assert.ok(a.estimates.every(e=>e.assumptions.length&&e.sensitivity));
  assert.equal(a.confidence,undefined);assert.equal(a.score,undefined);
});
test('saved assessment belongs to the question revision, is exported, and becomes stale after scope changes',()=>{
  const state={projects:{},receipts:{},events:[]};
  const p=ensureKernel(upgradeProject(createWorkspace(state,{name:'模板工程验证',goal:'比较研究方向'},'setup')));
  const a=assessmentFixture();a.presentation.template='timeline';
  const result=createQuestionComparison(p,{questions:[{question:'已有数据研究？',assessment:a,unknowns:[],supporting:[],conflicting:[]}]});
  const q=researchState(p).questions[0],original=structuredClone(p.researchItems[q.id].revisions[0]);
  assert.equal(q.assessment.presentation.template,'timeline');
  const before=exportProgress(p,result.artifactId,result.revisionId);
  assert.match(JSON.stringify(before),/5–9 个月/);assert.match(JSON.stringify(before),/执行难度/);
  kernelCommand(state,p.id,'revise-question',{baseStateVersion:p.researchKernel.version,itemId:q.id,baseRevisionId:q.revisionId,text:'改为前瞻性新建队列？',scope:'新范围'},'revise');
  const updated=researchState(p).questions[0];assert.equal(updated.assessmentNeedsReview,true);
  assert.equal(assessmentFor(updated).origin,'scenario');
  assert.deepEqual(p.researchItems[q.id].revisions[0],original);assert.deepEqual(exportProgress(p,result.artifactId,result.revisionId),before);
  assert.equal(p.researchKernel.currentQuestion,null);
});

test('difficulty is bounded and explained; new runtime rejects old hours without losing legacy readback',()=>{
  const data={explanation:'解释',next:'核查',questions:[{question:'研究问题',scope:'范围',rationale:'理由',unknowns:[],feasibility:{known:[],unknown:[]},supporting:[],conflicting:[],assessment:assessmentFixture()}]};
  const validate=()=>validateComparisonOutput(JSON.stringify(data),[],{requireAssessment:true,requireDifficulty:true});
  assert.doesNotThrow(validate);
  for(const mutate of [a=>delete a.difficulty,a=>a.difficulty.level=0,a=>a.difficulty.level=6,a=>a.difficulty.level=2.5,a=>a.difficulty.rationale='',a=>a.difficulty.assumptions=[],a=>a.estimates.push({...a.estimates[0],unit:'小时/周'})]){
    data.questions[0].assessment=assessmentFixture();mutate(data.questions[0].assessment);assert.throws(validate,e=>e.code==='model_structure');
  }
  const legacy=assessmentFixture();delete legacy.difficulty;delete legacy.version;legacy.estimates.push({label:'个人投入',min:6,max:12,unit:'小时/周',assumptions:['旧假设'],basis:'旧依据',sensitivity:'旧变化'});
  data.questions[0].assessment=legacy;
  assert.doesNotThrow(()=>validateComparisonOutput(JSON.stringify(data),[],{requireAssessment:true}));assert.throws(validate);
  const q={text:'回顾性数据分析',assessment:legacy},copy=structuredClone(q),view=assessmentFor(q);
  assert.deepEqual(q,copy);assert.deepEqual(view.estimates[0],legacy.estimates[0]);assert.equal(view.difficulty.origin,'scenario');assert.equal(view.difficulty.level,2);
  legacy.estimates[1].min=60;legacy.estimates[1].max=120;
  assert.equal(assessmentFor(q).difficulty.level,2);assert.ok(!view.estimates.some(e=>e.unit==='小时/周'));
});
test('structured research focus is optional, validated and retained through revisions',()=>{
  const a=assessmentFixture();a.focus={question:'需要回答什么？',axes:[{label:'维度甲',description:'待观察的表现'},{label:'维度乙',description:'待观察的负担'}],relation:'联合考察',nextChecks:['核查关键条件']};
  assert.deepEqual(normalizeAssessment(a).focus,a.focus);
  a.focus.axes.pop();assert.equal(validAssessment(a),false);
  delete a.focus.axes;delete a.focus.relation;assert.equal(validAssessment(a),true);
  a.focus.nextChecks=[];assert.equal(validAssessment(a),false);
});
