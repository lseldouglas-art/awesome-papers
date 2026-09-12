import test from 'node:test';
import assert from 'node:assert/strict';
import {comparisonRows} from '../../shared/topic-presentation.mjs';

test('study comparison preserves exact cited snapshots and unknowns without importing unrelated or newer records',()=>{
  const project={sources:{s:{id:'s',title:'Original study'}},accesses:{old:{sourceId:'s',level:'abstract'},new:{sourceId:'s',level:'full_text'},foreign:{sourceId:'s',level:'abstract'}}};
  const fields={findings:{text:'No significant difference was observed.',status:'reported',quotes:['Actual abstract.']},unreported:{text:'摘要未报告观察时点',status:'unknown',quotes:[]}};
  const result={reviewAccessIds:['old'],accessIds:['old','new','foreign'],citations:[{blockId:'b',accessId:'old'},{blockId:'b',accessId:'old'},{blockId:'b',accessId:'new'},{blockId:'other',accessId:'foreign'}],paperNotes:[{accessId:'old',sourceId:'s',fields},{accessId:'new',sourceId:'s',fields:{findings:{text:'New fulltext'}}}]};
  const before=structuredClone({project,result});
  const rows=comparisonRows(project,result,['b']);
  assert.equal(rows.length,1);assert.equal(rows[0].accessId,'old');assert.equal(rows[0].level,'abstract');assert.deepEqual(rows[0].fields,fields);
  assert.deepEqual({project,result},before);
  assert.deepEqual(comparisonRows(project,{...result,paperNotes:[{accessId:'old',sourceId:'wrong',fields}]},['b']),[]);
  assert.deepEqual(comparisonRows(project,{...result,reviewAccessIds:[]},['b']),[]);
  assert.deepEqual(comparisonRows(project,{citations:[],paperNotes:[]},['b']),[]);
});
