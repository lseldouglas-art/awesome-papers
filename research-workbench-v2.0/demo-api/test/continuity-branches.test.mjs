import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace } from '../src/workspace.mjs';
import { executeCommand } from '../src/domain.mjs';
import { upgradeProject, capture, exportProgress, progressCommand } from '../src/progress.mjs';
import { ensureKernel, kernelCommand, createQuestionComparison, researchState, saveBranchInvestigation } from '../src/kernel.mjs';
import { buildResearchContext, validateComparisonOutput, comparisonInstructions, resolveMaterialCitations } from '../src/workflows.mjs';
import { materialPacket } from '../../shared/material-scope.mjs';
import { researchPath, briefIsOutdated } from '../../shared/research-path.mjs';

function fixture() {
  const state={projects:{},receipts:{},events:[]};
  const p=ensureKernel(upgradeProject(createWorkspace(state,{name:'工程：研究接续',goal:'工程测试，不作为科研结论'},'setup'))), a=Object.values(p.artifacts)[0];
  const source=executeCommand(state,p.id,'import-source',{title:'工程测试材料',contentLevel:'abstract',text:'工程材料报告关联。长期方向尚不清楚。'},'source');
  const access=executeCommand(state,p.id,'record-access',{sourceId:source.id,level:'abstract'},'access');
  const result={id:'saved-landscape',kind:'brief',artifactId:a.id,accessIds:[access.id],blocks:[
    {id:'research-overview-heading',type:'heading',text:'领域概览'},
    {id:'research-overview-0',type:'paragraph',text:'工程材料显示关联，方向仍需研究。',informationStatus:'inference'},
    {id:'research-gaps-0',type:'paragraph',text:'长期方向未知。',informationStatus:'unknown'}],citations:[{blockId:'research-overview-0',sourceId:source.id,accessId:access.id,quote:'工程材料报告关联。'}]};
  p.researchResults[result.id]=result; a.draft.resultId=result.id;a.draft.sourceAccessIds=[access.id];a.draft.notes.understanding='用户的原始认识';
  const saved=capture(p,a,'initial');
  const call=(name,body={})=>kernelCommand(state,p.id,name,{baseStateVersion:p.researchKernel.version,...body},crypto.randomUUID());
  const proposal={paperTitle:'工程关联的纵向验证：一项拟议队列研究',design:'拟议纵向观察',primaryOutcome:'随访变化',analysisPlan:'预先定义混杂因素',dataRequirements:['纵向数据'],noveltyCheck:'检索相近纵向研究',contribution:'检验观察的稳定性'};
  const comparison=createQuestionComparison(p,{questions:[{question:'工程关联是否稳定？',scope:'工程对象',rationale:'工程理由',proposal,supporting:[{text:'工程关联',status:'reported',citations:[{accessId:access.id,quote:'工程材料报告关联。'}]}],conflicting:[],unknowns:['长期方向'],feasibility:{known:[],unknown:['数据']}}]}, {inputArtifactId:a.id,inputRevisionId:saved.id,accessIds:[access.id]});
  const ca=p.artifacts[comparison.artifactId], cs=capture(p,ca,'comparison-input'), q=p.researchItems[comparison.questionIds[0]];
  const open=()=>call('open-branch',{inputArtifactId:ca.id,inputRevisionId:cs.id,baseInputVersion:ca.draft.version,itemId:q.id,itemRevisionId:q.headRevisionId,accessIds:[access.id]});
  return {state,p,a,access,source,result,saved,call,proposal,ca,cs,q,open};
}
test('undecided brief inherits exact saved understanding and citations while preserving the original report and decisions',()=>{
  const {p,a,saved,call,result,access}=fixture(), before=exportProgress(p,a.id,saved.id), decisions=structuredClone(p.decisions);
  const output=call('compose-brief',{inputArtifactId:a.id,inputRevisionId:saved.id}), brief=p.researchResults[output.resultId];
  assert.equal(brief.adoptionContext.currentQuestion,null);assert.deepEqual(p.decisions,decisions);
  assert.equal(brief.blocks.find(b=>b.id==='inherited-research-overview-0').text,result.blocks[1].text);
  assert.equal(brief.citations[0].accessId,access.id);assert.equal(brief.citations[0].quote,result.citations[0].quote);
  assert.ok(p.artifacts[output.artifactId].draft.sourceAccessIds.includes(access.id));
  assert.deepEqual(exportProgress(p,a.id,saved.id),before);
  assert.deepEqual(researchPath(p,p.artifacts[output.artifactId]).map(a=>a.id),[a.id,output.artifactId]);
});
test('brief refresh uses the explicit parent snapshot and exposes later human decisions without changing an old export',()=>{
  const {p,a,saved,call,q}=fixture();
  const one=call('compose-brief',{inputArtifactId:a.id,inputRevisionId:saved.id}), old=exportProgress(p,one.artifactId,one.revisionId);
  call('decide-question',{itemId:q.id,itemRevisionId:q.headRevisionId,choice:'keep'});
  p.researchState=researchState(p);assert.equal(briefIsOutdated(p,p.researchResults[one.resultId]),true);
  const two=call('compose-brief',{artifactId:one.artifactId});
  assert.equal(p.researchResults[two.resultId].inputContext.revisionId,saved.id);
  assert.match(p.researchResults[two.resultId].blocks.find(b=>b.id==='actual-choices').text,/暂保留/);
  assert.deepEqual(exportProgress(p,one.artifactId,one.revisionId),old);
});
test('opening a topic creates a stable child page, preserves its proposal, and repeated opening never re-adopts or bills',()=>{
  const {p,a,ca,q,proposal,open}=fixture(), before=structuredClone(a), one=open(), count=Object.keys(p.decisions).length;
  const branch=p.artifacts[one.artifactId];assert.equal(branch.kind,'research_branch');assert.equal(branch.title,proposal.paperTitle);
  assert.equal(branch.branchQuestion.itemId,q.id);assert.equal(researchState(p).currentQuestion,null);
  assert.equal(researchState(p).exploration.itemId,q.id);assert.deepEqual(a,before);
  const two=open();assert.equal(two.artifactId,one.artifactId);assert.equal(two.reused,true);assert.equal(Object.keys(p.decisions).length,count);
  assert.deepEqual(researchPath(p,branch).map(a=>a.id),[a.id,ca.id,branch.id]);assert.equal(Object.keys(p.researchTasks).length,0);
});
test('branch rejects foreign materials and stale question/input versions before recording any choice',()=>{
  const {p,ca,cs,q,call}=fixture(), before=structuredClone(p);
  const body={inputArtifactId:ca.id,inputRevisionId:cs.id,baseInputVersion:ca.draft.version,itemId:q.id,itemRevisionId:q.headRevisionId,accessIds:['foreign']};
  assert.throws(()=>call('open-branch',body),e=>e.code==='invalid_scope');assert.deepEqual(p,before);
  assert.throws(()=>call('open-branch',{...body,accessIds:[],itemRevisionId:'foreign'}),e=>e.code==='not_found');assert.deepEqual(p,before);
  assert.throws(()=>call('open-branch',{...body,baseInputVersion:0}),e=>e.code==='draft_conflict');assert.deepEqual(p,before);
});
test('branch investigation enters the central page, follows original evidence versions, and late output never overwrites newer input',()=>{
  const {p,state,access,q,open}=fixture(), branch=p.artifacts[open().artifactId], old=structuredClone(branch.revisions[0]);
  const task={id:'branch-task',requestId:'branch-run',artifactId:branch.id,input:{resultId:branch.draft.resultId,revisionId:branch.headRevisionId,adoptionContext:p.researchResults[branch.draft.resultId].adoptionContext,materials:materialPacket(p,[access.id])},staleInput:false};
  const parsed={blocks:[{id:'research-answer-0',type:'paragraph',text:'工程论证结果',headline:'工程论点',informationStatus:'inference'}],citations:[{blockId:'research-answer-0',accessId:access.id,sourceId:access.sourceId,quote:'工程材料报告关联。'}]};
  const output=saveBranchInvestigation(p,task,parsed,{model:'engineering-fixture'});
  assert.equal(output.applied,true);assert.ok(p.researchResults[branch.draft.resultId].blocks.some(b=>b.id==='investigation-research-answer-0'));
  assert.deepEqual(branch.revisions[0],old);assert.equal(branch.branchQuestion.itemId,q.id);
  progressCommand(state,p.id,'save-notes',{artifactId:branch.id,baseVersion:branch.draft.version,notes:{...branch.draft.notes,understanding:'最新用户认识'}},'user');
  const before=structuredClone(branch);saveBranchInvestigation(p,{...task,staleInput:true},parsed,{model:'engineering-fixture'});assert.deepEqual(branch,before);
  const context=buildResearchContext(p,branch,{accessIds:[access.id]});assert.equal(context.parentArtifact.id,branch.lineage.artifactId);assert.equal(context.parentArtifact.revisionId,branch.lineage.revisionId);
});
test('each page retains its own reading position while navigating to siblings',()=>{
  const {p,a,call,open}=fixture(), b=p.artifacts[open().artifactId];
  call('set-position',{artifactId:a.id,blockId:'research-overview-0'});call('set-position',{artifactId:b.id,blockId:'branch-question'});
  call('set-position',{artifactId:a.id,blockId:'research-overview-0',passive:true});
  assert.equal(researchState(p).position.artifactId,b.id);
  assert.equal(researchState(p).positions[a.id].blockId,'research-overview-0');assert.equal(researchState(structuredClone(p)).positions[b.id].blockId,'branch-question');
});
test('revising a proposal marks the inherited design for review and cannot change its earlier exported candidate',()=>{
  const {p,ca,q,call}=fixture(), savedId=ca.headRevisionId, saved=exportProgress(p,ca.id,savedId), old=structuredClone(q.revisions[0]);
  call('revise-question',{itemId:q.id,baseRevisionId:q.headRevisionId,text:'修订后的工程问题？',scope:'另一个工程对象'});
  const current=researchState(p).questions.find(i=>i.id===q.id);
  assert.equal(current.proposalNeedsReview,true);assert.deepEqual(q.revisions[0],old);
  assert.deepEqual(exportProgress(p,ca.id,savedId),saved);
});
test('comparison validates actionable proposal fields without inventing them in legacy outputs',()=>{
  const {p,access,proposal}=fixture(), materials=materialPacket(p,[access.id]);
  const q={question:'工程问题？',scope:'工程范围',rationale:'测试',supporting:[],conflicting:[],unknowns:['未知'],feasibility:{known:[],unknown:[]}};
  const data={explanation:'工程说明',next:'测试',questions:[q]};
  assert.equal(validateComparisonOutput(JSON.stringify(data),materials).questions[0].proposal,null);
  q.proposal=proposal;assert.deepEqual(validateComparisonOutput(JSON.stringify(data),materials).questions[0].proposal,proposal);
  delete q.proposal.analysisPlan;assert.throws(()=>validateComparisonOutput(JSON.stringify(data),materials),e=>e.code==='model_structure');
  assert.match(comparisonInstructions(),/不得捏造/);
});
test('explicit multi-passage citations expand exact saved passages without accepting invented locations or edited quotes',()=>{
  const materials=[{ref:'R1',sourceId:'s1',accessId:'a1',level:'abstract',text:'第一条原文。'.repeat(150)+'\n'+'第二条原文。'.repeat(150)+'\n'+'第三条原文。'.repeat(150)}];
  const citations=resolveMaterialCitations({ref:'R1',passage:'P1、P3'},materials);
  assert.equal(citations.length,2);assert.deepEqual(citations.map(c=>c.passage),['P1','P3']);assert.ok(citations.every(c=>materials[0].text.slice(c.start,c.end)===c.quote));
  assert.ok(citations.every(c=>c.modelLocator==='P1、P3'));
  for(const citation of [{ref:'R1',passage:'P1、P99'},{ref:'R2',passage:'P1、P2'},{ref:'R1',passage:'P1、P3',quote:'拼接的伪造引文'},{ref:'R1',passage:'P1、任意片段'}])assert.throws(()=>resolveMaterialCitations(citation,materials),e=>e.code==='invalid_citation');
});
test('annotated locators retain the explanation separately and resolve only the named original passage',()=>{
  const materials=[{ref:'R1',sourceId:'s1',accessId:'a1',level:'abstract',text:'Actual source reports an uncertain effect.'}];
  const input={ref:'R1',passage:'P1: 效果仍不确定，需核查'};
  const [citation]=resolveMaterialCitations(input,materials);
  assert.equal(citation.quote,materials[0].text);assert.equal(citation.modelLocator,input.passage);
  assert.equal(citation.locatorExplanation,'效果仍不确定，需核查');assert.equal(citation.passage,'P1');
  for(const bad of [{ref:'R1',passage:'P99: 解释'},{ref:'R9',passage:'P1: 解释'},
    {ref:'R1',passage:'P1: 也可能P2'},{...input,quote:'invented exact quote'}])assert.throws(()=>resolveMaterialCitations(bad,materials));
});
