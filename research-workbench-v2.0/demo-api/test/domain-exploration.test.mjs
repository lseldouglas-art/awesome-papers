import test from 'node:test';
import assert from 'node:assert/strict';
import {validateResearchOutput} from '../src/research.mjs';
import {dimensionFixture} from './landscape-fixture.mjs';
import {chapterView} from '../../shared/domain-chapters.mjs';
import {explorationNodes} from '../../shared/domain-exploration.mjs';
import {readingResult,readingText} from '../../shared/domain-reading.mjs';

const materials=[{ref:'R1',sourceId:'s1',accessId:'a1',text:'Engineering abstract: association, not causation.',level:'abstract'}];
const make=()=>{
 const data=dimensionFixture(materials),b=data.sections.find(s=>s.id==='branches');
 b.items[0].headline='观察研究分支';b.items[0].children=[{headline:'对象与条件',text:'相关性只在所述对象中报告（R1/P1）。',status:'reported',citations:[{ref:'R1',passage:'P1'}],children:[{headline:'长期方向',text:'摘要未报告。',status:'unknown',citations:[]}]}];return data;
};
test('domain hierarchy keeps child provenance, full explanation and legacy reports without invented levels',()=>{
 const parsed=validateResearchOutput(JSON.stringify(make()),'landscape',materials,{requireDimensions:true}),before=structuredClone(parsed);
 const view=readingResult(parsed),s=chapterView(view).find(s=>s.id==='branches'),[node]=explorationNodes(s);
 assert.equal(node.children[0].title,'对象与条件');assert.equal(node.children[0].text,'相关性只在所述对象中报告。');assert.equal(node.children[0].children[0].status,'unknown');
 assert.equal(parsed.citations.filter(c=>c.nodeId).length,1);assert.equal(parsed.citations.find(c=>c.nodeId).nodeId,node.children[0].id);
 assert.deepEqual(parsed,before);assert.equal(node.fullText,parsed.blocks.find(b=>b.id===node.blockId).text);
 const legacy=explorationNodes({findings:[{id:'old',headline:'保留原题',text:'完整旧结论及边界',visual:{label:'短名',summary:'短摘要',nodes:[{label:'已有解释',text:'原解释'}]}}]})[0];
 assert.equal(legacy.title,'保留原题');assert.equal(legacy.text,'完整旧结论及边界');assert.deepEqual(legacy.children,[]);assert.equal(legacy.legacy,true);
 assert.equal(readingText('R1/P1报告关联，R2受体未报告。',['R1','R2']),'相关研究报告关联，R2受体未报告。');
});
test('unsupported or contradictory child claims and excessive nesting fail without silent clipping',()=>{
 for(const mutate of [
  d=>d.sections[2].items[0].children[0].citations=[],
  d=>d.sections[2].items[0].children[0].citations[0].ref='R999',
  d=>d.sections[2].items[0].children[0].children[0].children=[{headline:'过深',text:'未知',status:'unknown',citations:[]}],
  d=>{d.sections[3].items[0].children=d.sections[2].items[0].children;},
 ]){const data=make();mutate(data);assert.throws(()=>validateResearchOutput(JSON.stringify(data),'landscape',materials));}
});
