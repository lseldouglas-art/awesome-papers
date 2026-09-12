import test from 'node:test';
import assert from 'node:assert/strict';
import {researchInstruction,researchLanguageRules,RESEARCH_LANGUAGE_VERSION} from '../../shared/research-language.mjs';
import {researchHeading} from '../../shared/research-labels.mjs';
import {ResearchService} from '../src/research.mjs';

test('common research instruction preserves the exact task contract and is applied only once',()=>{
  const contract='只返回 JSON {status,citations:[{ref,passage}]}。\n原文：“我们先来看看” [R3/P1]。';
  const instruction=researchInstruction(contract);
  assert.equal(instruction,researchLanguageRules+'\n'+contract);
  assert.equal(researchInstruction(instruction),instruction);
});

test('legacy research calls receive the common standard without rewriting materials or output; connection stays minimal',async()=>{
  const task={id:'t',projectId:'p',status:'running',calls:[],mode:'ask'},state={projects:{p:{researchTasks:{t:task}}},modelCalls:[]},seen=[];
  const store={directory:'/private/tmp',update:async fn=>fn(state)};
  const output={text:'{"items":[{"text":"Source text remains unchanged."}]}',usage:{total_tokens:10},cost:{status:'unknown',amount:null},provenance:{provider:'fixture'}};
  const service=new ResearchService(store,{modelFactory:()=>({generate:async input=>{seen.push(input);return output;}})});
  const materials=[{sourceId:'s',accessId:'a',text:'Observed 90%; no difference was established. 我们先来看看。'}],original=structuredClone(materials);
  assert.deepEqual(await service.callModel(task,{},materials,'Exact task contract.',new AbortController().signal),output);
  assert.equal(seen.length,1);assert.ok(seen[0].instruction.startsWith(researchLanguageRules));assert.deepEqual(seen[0].materials,original);assert.deepEqual(materials,original);
  assert.equal(state.modelCalls[0].languageStandard,RESEARCH_LANGUAGE_VERSION);
  task.mode='connection';await service.callModel(task,{},[],'仅回复连接成功',new AbortController().signal);
  assert.equal(seen[1].instruction,'仅回复连接成功');assert.equal(state.modelCalls[1].languageStandard,null);
});

test('only known product headings are relabelled; source prose, user headings and saved data remain unchanged',()=>{
  const block={id:'topic-evidence-heading',type:'heading',text:'已有研究究竟做到哪里'},original=structuredClone(block);
  assert.equal(researchHeading(block),'现有证据与研究进展');assert.deepEqual(block,original);
  assert.equal(researchHeading({...block,type:'paragraph'}),block.text);
  assert.equal(researchHeading({...block,id:'user-heading'}),block.text);
  assert.equal(researchHeading({...block,text:'研究者自定义标题'}),'研究者自定义标题');
});
