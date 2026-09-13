import test from 'node:test';
import assert from 'node:assert/strict';
import {readingText,readingResult} from '../../shared/domain-reading.mjs';
import {displayText} from '../../shared/domain-presentation.mjs';
import {chapterView,maturityFindings,directions} from '../../shared/domain-chapters.mjs';

test('reading references become natural language while scientific names and original records remain intact',()=>{
 const refs=['R1','R2','R17','R35','R39'];
 assert.equal(readingText('R17、R35、R39作者均指出样本小（R17 P6），不能推断等效。',refs),'相关研究作者均指出样本小，不能推断等效。');
 assert.equal(readingText('结果在R1、R2中被部分涉及；R17与R35未报告外部验证。',refs),'结果在相关研究中被部分涉及；相关研究未报告外部验证。');
 assert.equal(readingText('R2受体与R1表达均未报告。',refs),'R2受体与R1表达均未报告。');
 assert.equal(displayText('指标（R2受体）未报告。'),'指标（R2受体）未报告。');
 assert.equal(readingText('R999仍待核对。',refs),'R999仍待核对。');
 const r={id:'result',blocks:[{id:'b',text:'R1指出结论有限（R1 P2）。',visual:{nodes:[{label:'验证',text:'R1未报告外部验证。'}]}}],citations:[{blockId:'b',sourceId:'s',accessId:'a',ref:'R1',quote:'R1'}],paperNotes:[{sourceId:'s',fields:{findings:{text:'R1未报告方法。',quotes:['R1 original']}}}]};
 const before=structuredClone(r),view=readingResult(r);
 assert.deepEqual(r,before);assert.deepEqual(view.citations,r.citations);assert.equal(view.blocks[0].id,'b');
 assert.equal(view.blocks[0].visual.nodes[0].text,'相关研究未报告外部验证。');
 assert.deepEqual(view.paperNotes[0].fields.findings.quotes,['R1 original']);
});
test('maturity exposes actual evidence and limits instead of repeating only a short headline',()=>{
 const r={blocks:[{id:'research-maturity-heading',type:'heading',text:'研究成熟度'},{id:'m',headline:'已有汇总证据，验证仍有限',text:'完整原文',visual:{nodes:[{label:'验证',text:'样本量小、随访短。'},{label:'应用',text:'注册研究占比8%。'}],boundary:'8%为试验结构，不是临床使用率。'}},{id:'m2',headline:'临床外推仍待核对',text:'41项研究均为临床前研究；外部适用性尚未建立。'}]};
 const rows=maturityFindings(chapterView(r)[0]);
 assert.equal(rows[0].finding,'已有汇总证据，验证仍有限');
 assert.match(rows[0].evidence[0].text,/样本量小、随访短/);assert.match(rows[0].boundary,/不是临床使用率/);
 assert.equal(rows[1].evidence.length,2);assert.match(rows[1].evidence[1].text,/尚未建立/);
 assert.equal(rows[0].score,undefined);
});
test('next directions retain the actionable headline and full conditions without a clipped first sentence',()=>{
 const s=chapterView({blocks:[{id:'research-next-heading',type:'heading',text:'后续研究方向'},{id:'n',headline:'下一步可选择：比较候选问题',text:'先比较已有研究。再核对方法细节，具体取舍取决于实验条件。'}]})[0];
 const [r]=directions(s);assert.equal(r.label,'比较候选问题');assert.equal(r.finding,'先比较已有研究。再核对方法细节，具体取舍取决于实验条件。');assert.equal(r.blockId,'n');
});
