import test from 'node:test';
import assert from 'node:assert/strict';
import { pairedObservation, cohortObservation, contentGroups, mechanismPaths, domainStoryboard } from '../../shared/domain-storyboard.mjs';
import { domainVisual } from '../../shared/domain-presentation.mjs';
const note = { sourceId:'s1',accessId:'a1',fields:{findings:{status:'reported',text:'LCI较WLI减少AI假阳性（中位2 vs 5），观察顺序固定',quotes:['LCI reduced false-positive AI detections compared with WLI (median 2 vs. 5). However, the observation sequence was fixed.']},methods:{text:'同一检查中WLI与LCI序贯对比',status:'reported'}} };
test('paired observations keep the original modality/value orientation and require an actual supporting passage',()=>{
  assert.deepEqual(pairedObservation(note).values,[5,2]);
  const reversed=structuredClone(note);reversed.fields.findings.text=reversed.fields.findings.text.replace('2 vs 5','5 vs 2');assert.equal(pairedObservation(reversed),null);
  const absent=structuredClone(note);absent.fields.findings.quotes=[];assert.equal(pairedObservation(absent),null);
  const guessed=structuredClone(note);guessed.fields.findings.status='unknown';assert.equal(pairedObservation(guessed),null);
  const noOrder=structuredClone(note);noOrder.fields.findings.quotes=['LCI reduced false-positive AI detections compared with WLI (median 2 vs. 5).'];assert.equal(pairedObservation(noOrder),null);
});
test('cohort sizes are extracted from matched text and quotes, never used as research popularity',()=>{
  const n={fields:{methods:{text:'约13000例与31000对照的汇总分析',quotes:['about 13 000 cases and 31 000 controls']},findings:{text:'因素甲呈正相关；因素乙呈负相关'},relevance:{text:'关联结果'}}};
  const d=cohortObservation(n);assert.deepEqual(d.values,['13000','31000']);assert.equal(d.approximate,true);assert.equal(d.kind,'cohort');
  n.fields.methods.text='约12000例与31000对照';assert.equal(cohortObservation(n),null);
});
test('legacy mechanisms preserve explicit relations; unknown history cannot invent a pathway',()=>{
  const b={text:'感染方面：因素甲经通路乙促进结果丙。代谢方面：因素丁与结果戊相关。',informationStatus:'inference'};
  assert.deepEqual(contentGroups(b).map(x=>x.label),['感染','代谢']);
  assert.deepEqual(mechanismPaths(b)[0],{nodes:['因素甲','通路乙','结果丙'],relation:'促进'});
  assert.deepEqual(mechanismPaths({...b,informationStatus:'unknown'}),[]);
});
test('storyboards preserve all branches and do not write visual projections into the report',()=>{
  const result={blocks:[{id:'research-branches-heading',type:'heading',text:'主要分支'},...Array.from({length:4},(_,i)=>({id:`b${i}`,text:`分支${i}的实际发现。`,headline:`研究方向${i}分支`,informationStatus:'unknown'}))],citations:[],paperNotes:[]};
  const original=structuredClone(result),s=domainStoryboard(result);assert.equal(s.featured.length,3);assert.equal(s.other.length,1);assert.equal(s.stories.length,4);assert.deepEqual(result,original);
});
test('new model layouts are bounded and historical sequences are refused for unknown statements',()=>{
  const v={kind:'finding',label:'研究问题',summary:'有依据的解释',nodes:[{label:'因素甲',text:'观察甲'},{label:'因素乙',text:'观察乙'}],layout:'branches',title:'研究得到什么？',takeaway:'具体发现',boundary:'条件尚未核查'};
  assert.equal(domainVisual(v,'reported').layout,'branches');assert.equal(domainVisual({...v,layout:'sequence'},'unknown').layout,undefined);assert.equal(domainVisual({...v,layout:'javascript'},'reported').layout,undefined);
});
