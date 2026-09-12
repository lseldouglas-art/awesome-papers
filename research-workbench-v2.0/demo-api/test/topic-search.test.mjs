import test from 'node:test';
import assert from 'node:assert/strict';
import { searchesForArtifact, topicQueryState, searchTotals } from '../../shared/topic-search.mjs';

test('shared materials do not make the global query or another topic proposal belong to this library',()=>{
 const a={id:'topic',kind:'topic_library',draft:{sourceAccessIds:['a']}},p={searches:{broad:{id:'broad',query:'broad',accessIds:['a'],searchedAt:'2026-09-08'}},researchProposal:{query:'global'},researchTasks:{foreign:{artifactId:'other',status:'completed',createdAt:'2026-09-09',proposal:{query:'other'}}}};
 assert.equal(topicQueryState(p,a).query,'');assert.deepEqual(searchesForArtifact(p,a),[]);
 p.searches.empty={id:'empty',artifactId:'topic',query:'focused zero',accessIds:[],searchedAt:'2026-09-09'};
 assert.equal(topicQueryState(p,a).query,'focused zero');assert.equal(searchesForArtifact(p,a).length,1);
 p.researchTasks.own={id:'own',artifactId:'topic',status:'completed',createdAt:'2026-09-10',finishedAt:'2026-09-10',input:{searchScopeMode:'expanded'},proposal:{query:'expanded'}};
 assert.equal(topicQueryState(p,a).query,'expanded');assert.equal(topicQueryState(p,a).scopeMode,'expanded');
 p.researchTasks.own.staleInput=true;assert.equal(topicQueryState(p,a).query,'focused zero');
});

test('legacy search ownership comes from the exact task, including zero hits',()=>{
 const a={id:'topic',kind:'topic_library',draft:{sourceAccessIds:[]}},p={searches:{zero:{id:'zero',query:'nothing',accessIds:[]}},researchTasks:{r:{artifactId:'topic',searchId:'zero'}}};
 assert.equal(searchesForArtifact(p,a)[0].id,'zero');
});

test('totals retain zero, missing values and differing sort counts without summing them',()=>{
 assert.deepEqual(searchTotals({searches:[{total:0},{total:0}]}),{min:0,max:0,consistent:true});
 assert.deepEqual(searchTotals({searches:[{total:84},{total:87}]}),{min:84,max:87,consistent:false});
 assert.equal(searchTotals({searches:[{}]}),null);assert.equal(searchTotals({searches:[{total:-1}]}),null);
});
