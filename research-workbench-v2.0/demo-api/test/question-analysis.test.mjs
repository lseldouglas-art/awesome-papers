import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisDimensions, normalizeAnalysis, questionAnalysisFor, topicAnalysisRequest } from '../../shared/question-analysis.mjs';
import { assessmentFor, assessmentText } from '../../shared/question-assessment.mjs';
import { validateComparisonOutput } from '../src/workflows.mjs';
import { assessmentFixture } from './assessment-fixture.mjs';
const question = () => ({question:'指定对象与结局之间的关系？',scope:'指定对象',rationale:'已有材料需要核查',unknowns:[],feasibility:{known:[],unknown:['协作者未知']},supporting:[],conflicting:[],assessment:assessmentFixture()});
const packet = q => JSON.stringify({explanation:'分别比较',next:'由研究者取舍',questions:[q]});

test('new reasoning requires all distinct dimensions, reasoning, checks and valid local evidence links',()=>{
  const q=question();
  const validate=()=>validateComparisonOutput(packet(q),[],{requireAssessment:true,requireDifficulty:true,requireAnalysis:true});
  assert.equal(validate().questions[0].assessment.analysis.length,8);
  for(const mutate of [a=>a.pop(),a=>a[1].key=a[0].key,a=>a[0].reasoning='',a=>a[0].checks=[],a=>a[0].supporting=[-1],a=>a[0].basis='reported',a=>a[0].basis='inference']) {
    q.assessment=assessmentFixture();mutate(q.assessment.analysis);assert.throws(validate);
  }
  q.assessment=assessmentFixture();q.assessment.analysis[0].supporting=[0];assert.throws(validate,e=>e.code==='invalid_citation');
  q.assessment=assessmentFixture();delete q.assessment.analysis;assert.throws(validate,e=>e.code==='model_structure');
  assert.doesNotThrow(()=>validateComparisonOutput(packet(q),[]));
});
test('single-topic refresh cannot swap its question, scope or introduce a second candidate',()=>{
  const q=question(),target={kind:'question',text:q.question,scope:q.scope};
  const validate=data=>validateComparisonOutput(JSON.stringify(data),[],{requireAnalysis:true,selectedQuestion:target});
  const data={explanation:'分析本题',next:'继续核查',questions:[q]};assert.doesNotThrow(()=>validate(data));
  data.questions.push(question());assert.throws(()=>validate(data));data.questions.pop();q.scope='其他范围';assert.throws(()=>validate(data));q.scope=target.scope;q.question='其他问题？';assert.throws(()=>validate(data));
});
test('old records display their own proposal and actual conditions, never inherit another topic or invent missing reasoning',()=>{
  const q={id:'one',revisionId:'rev1',text:'甲题',feasibility:{known:[],unknown:['甲题权限未知']},proposal:{design:'甲题设计',analysisPlan:'甲题分析',dataRequirements:['甲题条件']},assessment:assessmentFixture()};delete q.assessment.analysis;
  const before=structuredClone(q),view=questionAnalysisFor(q,assessmentFor(q));
  assert.equal(view.find(v=>v.key==='design').judgment,'甲题设计');assert.equal(view.find(v=>v.key==='testability').missing,true);
  assert.deepEqual(view.find(v=>v.key==='feasibility').checks,['甲题权限未知']);assert.deepEqual(q,before);
  const other=questionAnalysisFor({...q,id:'two',proposal:{design:'乙题设计'}},assessmentFor(q));assert.equal(other.find(v=>v.key==='design').judgment,'乙题设计');assert.ok(!JSON.stringify(other).includes('甲题设计'));
});
test('dimension evidence resolves within its candidate and ignores model-provided citation payloads',()=>{
  const q={assessment:assessmentFixture(),supporting:[{text:'本题依据',citations:[{accessId:'a',passage:'P1',quote:'实际片段'}]}],conflicting:[]};
  q.assessment.analysis[0]={...q.assessment.analysis[0],basis:'inference',supporting:[0],citations:[{accessId:'foreign'}]};
  const view=questionAnalysisFor(q,assessmentFor(q));assert.equal(view[0].statements[0].citations[0].accessId,'a');assert.ok(!JSON.stringify(normalizeAnalysis(q.assessment.analysis)).includes('foreign'));
  assert.equal(questionAnalysisFor({...q,assessmentNeedsReview:true},assessmentFor(q))[0].origin,'stale');
});
test('single-topic request carries exact revision and only that topic’s distinct evidence accesses',()=>{
  const q={id:'one',revisionId:'rev',text:'问题',scope:'范围',evidence:[{accessId:'a'},{accessId:'a'},{accessId:'b'}]};
  const request=topicAnalysisRequest(q);assert.deepEqual(request.accessIds,['a','b']);assert.equal(request.itemId,'one');assert.equal(request.itemRevisionId,'rev');assert.match(request.text,/保持 question 与 scope 原文/);
});
test('deep reasoning survives normalization and is included in saved text exports',()=>{
  const a=assessmentFixture();const text=assessmentText(a);for(const d of analysisDimensions)assert.ok(text.includes(d.label));
  assert.deepEqual(normalizeAnalysis(normalizeAnalysis(a.analysis)),normalizeAnalysis(a.analysis));
});
test('unsupported personal fit is retained as an explicit unknown without relaxing scientific evidence requirements',()=>{
  const q=question(),item=q.assessment.analysis.find(v=>v.key==='feasibility');item.basis='inference';
  const before=structuredClone(q),parsed=validateComparisonOutput(packet(q),[],{requireAnalysis:true,requireDifficulty:true});
  const a=parsed.questions[0].assessment,v=a.analysis.find(v=>v.key==='feasibility');
  assert.equal(v.basis,'unknown');assert.equal(v.modelBasis,'inference');assert.equal(v.reviewRequired,true);
  assert.equal(v.judgment,item.judgment);assert.equal(v.reasoning,item.reasoning);assert.deepEqual(v.supporting,[]);
  assert.match(assessmentText(a),/不能视为已经确认可行/);assert.deepEqual(normalizeAnalysis(a.analysis),a.analysis);assert.deepEqual(q,before);
  q.assessment.analysis.find(v=>v.key==='gap').basis='inference';assert.throws(()=>validateComparisonOutput(packet(q),[],{requireAnalysis:true}));
});
