import test from 'node:test';
import assert from 'node:assert/strict';
import {isContinueNavigation, isTopicReviewRequest,continuationQuestion,savedInvestigations} from '../../shared/research-guidance.mjs';
const question={id:'q',revisions:[{id:'v1',text:'此前采用的问题',evidenceIds:[]},{id:'v2',text:'最新修订',evidenceIds:[]}]};
const project={researchItems:{q:question,other:{id:'other',revisions:[{id:'o1',text:'另一个问题',evidenceIds:[]}]}},evidence:{},researchState:{currentQuestion:{id:'q',revisionId:'v1'}}};
test('明确进入下一步是导航，不应作为科研模型问题',()=>{
 for(const s of ['我选用了这个主题，进入下一步','我已经选择了这个题目，进入下一个阶段。','进入下一步','请进入下一阶段','下一步'])assert.equal(isContinueNavigation(s),true,s);
});
test('问下一步的内容、否定、混合指令不被导航吞掉',()=>{
 for(const s of ['下一步该检索什么？','不要进入下一步','进入下一步之前先解释这个问题','我选用了这个主题，进入下一步并计算样本量','我选择另一个题目',''])assert.equal(isContinueNavigation(s),false,s);
});
test('采用的问题按具体版本接续，不被最新修订或聊天焦点覆盖',()=>{
 assert.equal(continuationQuestion(project,{}, {id:'other',revisionId:'o1'}).text,'此前采用的问题');
});
test('分支页面继续本分支的确切问题，未知目标不会猜选第一个候选',()=>{
 assert.equal(continuationQuestion(project,{branchQuestion:{itemId:'other',revisionId:'o1'}}).id,'other');
 assert.equal(continuationQuestion({...project,researchState:{}},{},null),null);
});
test('此前论证只匹配同一问题版本的完成任务，不混入失败、迟到或其他问题',()=>{
 const tasks=[['ok','v1','completed',false],['new','v2','completed',false],['failed','v1','failed',false],['stale','v1','completed',true]].map(([id,revisionId,status,staleInput])=>({id,status,staleInput,mode:'deepen',createdAt:'2026-09-08',input:{itemTarget:{itemId:'q',revisionId}},resultId:id}));
 const p={...project,researchTasks:Object.fromEntries(tasks.map(t=>[t.id,t])),researchResults:Object.fromEntries(tasks.map(t=>[t.id,{kind:'answer'}]))};
 assert.deepEqual(savedInvestigations(p,continuationQuestion(p,{})).map(t=>t.id),['ok']);
});

test('explicit library synthesis requests route to full topic review, questions and negation stay conversational',()=>{
  assert.equal(isTopicReviewRequest('分析现有文献，给我一个具体的题目和大纲'),true);
  assert.equal(isTopicReviewRequest('完整整理所选材料'),true);
  assert.equal(isTopicReviewRequest('不要分析现有文献'),false);
  assert.equal(isTopicReviewRequest('这些文献如何分析？'),false);
});
