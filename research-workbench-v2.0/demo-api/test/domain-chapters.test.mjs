import test from 'node:test';
import assert from 'node:assert/strict';
import {chapterView,chapterForBlock,overviewNodes,methodRows,evidenceRows,directions,pairedClauses,conceptTitle,comparisonConditions,focusDiagram,gapLabel,evidenceExcerpt,excerpt,prose} from '../../shared/domain-chapters.mjs';

const heading=id=>({id:`research-${id}-heading`,type:'heading',text:id});
test('visual chapter projection preserves every original section, block and reference without rewriting the report',()=>{
 const result={blocks:[heading('overview'),{id:'a',text:'主要研究问题包括：风险因素、病因机制以及检测方法（R1 P2）。'},heading('methods'),{id:'b',text:'工具甲回答“问题一”（R1 P1）；工具乙回答“问题二”（R2 P2）。',analysisRole:'comparison'}],citations:[{blockId:'b',accessId:'access'}]};
 const frozen=structuredClone(result),sections=chapterView(result);
 assert.equal(sections.length,2);assert.equal(chapterForBlock(result,'b').id,'methods');assert.equal(chapterForBlock(result,'research-overview-heading').id,'overview');
 assert.deepEqual(overviewNodes(sections[0],sections).map(n=>n.text),['风险因素','病因机制','检测方法']);
 assert.deepEqual(methodRows(sections[1]).map(r=>[r.label,r.finding,r.blockId]),[['工具甲','问题一','b'],['工具乙','问题二','b']]);assert.deepEqual(result,frozen);
});
test('missing historical coverage remains insufficient and does not generate dates, progress scores or a new scientific state',()=>{
 const r={blocks:[{...heading('history'),dimensionCoverage:'insufficient'},{id:'unknown',text:'现有题名无法确定历史转折。'}]};
 const s=chapterView(r)[0];assert.equal(s.kind,'coverage');assert.equal(s.heading.dimensionCoverage,'insufficient');assert.equal(s.summary.text,'现有题名无法确定历史转折。');assert.equal(s.score,undefined);assert.equal(s.events,undefined);
});
test('comparison quotes retain negation and conditions, and unpaired findings do not become opposing studies',()=>{
 const pair=pairedClauses({text:'一方证据：本次未检出指标甲；另一方：样本范围不同。两说并非直接冲突。'});
 assert.equal(pair.left,'本次未检出指标甲');assert.equal(pair.right,'样本范围不同');assert.match(pair.limit,/并非直接冲突/);
 const single=pairedClauses({text:'摘要未报告外部验证。'});assert.equal(single.relation,'发现与条件');assert.match(single.left,/未报告/);assert.match(single.right,/没有另一组/);
 const long='目前未发现差异，不能认为已经证实等效；仍需核对具体条件。';assert.ok(excerpt(long,20).endsWith('…'));assert.equal(prose('样本甲（R1 P1）并未接受干预。'),'样本甲并未接受干预。');
});
test('evidence lanes and next directions retain individual input blocks rather than collapsing findings into a global maturity score',()=>{
 const r={blocks:[heading('maturity'),{id:'m',text:'方法甲：已有观察性证据。方法乙：人体验证摘要未报告。',analysisRole:'comparison'},heading('next'),{id:'n',text:'建议方向：（1）若关注检测，可补查验证研究；（2）若需领域历史，可检索专门综述。'}]};
 const s=chapterView(r);assert.deepEqual(evidenceRows(s[0]).map(r=>r.label),['方法甲','方法乙']);assert.match(evidenceRows(s[0])[1].finding,/未报告/);assert.deepEqual(directions(s[1]).map(r=>r.label),['检测','领域历史']);assert.ok(directions(s[1]).every(r=>r.blockId==='n'));
});

test('concept diagrams use stated connections and questions; condensed evidence retains its uncertainty',()=>{
 assert.deepEqual(focusDiagram({text:'研究问题已从“能否检测”转向“如何减少误报”。'}).nodes,['能否检测','如何减少误报']);
 assert.deepEqual(focusDiagram({text:'该问题同时关联一级预防与治疗增敏。'}).nodes,['一级预防','治疗增敏']);
 assert.equal(gapLabel({headline:'本次材料未覆盖的方面'}),'材料覆盖');
 assert.equal(evidenceExcerpt('机制：多条通路仅有体外/动物证据，人体验证本次摘要未报告，处于临床前阶段。'),'仅有体外/动物证据；人体验证本次摘要未报告');
 assert.equal(prose('R2受体与R1表达均未报告。'),'R2受体与R1表达均未报告。');
 assert.equal(conceptTitle({headline:'检测方法是否已有临床验证'}),'检测方法');
 assert.deepEqual(comparisonConditions('结局同为某病发病风险、方法同为病例对照汇总，但暴露因素不同'),[['结局','某病发病风险'],['方法','病例对照汇总'],['暴露','因素不同']]);
 assert.deepEqual(comparisonConditions('方法未报告'),[]);
 assert.equal(chapterView({blocks:[heading('hotspots'),{id:'only-summary',text:'仅有一段综述',analysisRole:'comparison'}]})[0].findings.length,1);
});
