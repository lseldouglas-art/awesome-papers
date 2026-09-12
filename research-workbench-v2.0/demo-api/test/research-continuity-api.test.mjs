import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startServer} from '../src/server.mjs';
import {createClient} from '../src/client.mjs';
import {continuitySnapshot} from '../../shared/research-continuity.mjs';
async function fixture(t){
  const directory=await mkdtemp(join(tmpdir(),'rw-continuity-http-'));let server=await startServer({directory,port:0}),api=createClient({baseUrl:server.url});
  t.after(async()=>{await server?.close();});const p=await api.createProject({name:'连续性 · 隔离验收',goal:'验证保存和来源'}),a=Object.values(p.artifacts)[0];
  const state=()=>api.workspace(p.id),call=async(name,body={},requestId)=>api.command(p.id,name,{artifactId:a.id,baseStateVersion:(await state()).researchState.version,...body},{requestId});
  return {directory,p,a,state,call,get api(){return api;},get server(){return server;},restart:async()=>{await server.close();server=null;server=await startServer({directory,port:0});api=createClient({baseUrl:server.url});}};
}
test('lost save receipt retries once, reload preserves adoption and history, conflicting save does not overwrite',async t=>{
  const f=await fixture(t),body={artifactId:f.a.id,baseStateVersion:(await f.state()).researchState.version,kind:'protocol',title:'文献综合计划',payload:{question:'方法与证据边界',outputMode:'literature'}};
  const one=await f.api.command(f.p.id,'save-continuity',body,{requestId:'lost-save'});assert.deepEqual(await f.api.command(f.p.id,'save-continuity',body,{requestId:'lost-save'}),one);
  await f.call('decide-continuity',{itemId:one.itemId,revisionId:one.revisionId,choice:'adopt'});
  const two=await f.call('save-continuity',{itemId:one.itemId,baseRevisionId:one.revisionId,title:'修改后草案',payload:{question:'不同问题',outputMode:'proposal'}});
  await assert.rejects(()=>f.call('save-continuity',{itemId:one.itemId,baseRevisionId:one.revisionId,title:'不能覆盖',payload:{}}),e=>e.status===409);
  await f.restart();const p=await f.state();assert.equal(continuitySnapshot(p,f.a.id).protocol.ref.revisionId,one.revisionId);assert.equal(p.researchItems[one.itemId].headRevisionId,two.revisionId);assert.equal(p.researchItems[one.itemId].revisions.length,2);
  assert.deepEqual(await f.api.request('/api/model-calls'),[]);
});
test('file receipt retry is idempotent, exact file survives restart and unavailable file stays visible in export',async t=>{
  const f=await fixture(t),bytes=Buffer.from('group,value\nA,1\n'),body={artifactId:f.a.id,baseStateVersion:(await f.state()).researchState.version,name:'测试.csv',base64:bytes.toString('base64')};
  const path=`/api/projects/${f.p.id}/research-files`,one=await f.api.request(path,{method:'POST',body,requestId:'file-receipt'});
  assert.deepEqual(await f.api.request(path,{method:'POST',body,requestId:'file-receipt'}),one);await f.restart();
  const url=`${f.server.url}${path}/${one.itemId}/${one.revisionId}`,response=await fetch(url);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  const meta=(await f.state()).researchItems[one.itemId].revisions[0].payload;
  await rename(join(f.directory,'research-attachments',meta.sha256),join(f.directory,'research-attachments',`${meta.sha256}.preserved`));assert.equal((await fetch(url)).status,404);
  const exported=await f.api.request(`/api/projects/${f.p.id}/continuity/${one.itemId}/${one.revisionId}/export`);assert.equal(exported.manifest.entries[0].fileAvailable,false);assert.equal(exported.record.payload.sha256,meta.sha256);
});
test('provenance rejects foreign project refs and lists chosen old version without substituting current',async t=>{
  const f=await fixture(t),one=await f.call('save-continuity',{kind:'protocol',title:'旧版',payload:{question:'旧内容'}});
  await f.call('save-continuity',{itemId:one.itemId,baseRevisionId:one.revisionId,title:'新版',payload:{question:'新内容'}});
  const other=await f.api.createProject({name:'另一课题',goal:'隔离'}),ref={type:'research_item',id:one.itemId,revisionId:one.revisionId};
  await assert.rejects(()=>f.api.request(`/api/projects/${other.id}/provenance`,{method:'POST',body:{refs:[ref]}}),e=>e.code==='invalid_reference');
  const result=await f.api.request(`/api/projects/${f.p.id}/provenance`,{method:'POST',body:{refs:[ref]}});assert.equal(result.items[0].entries[0].content.title,'旧版');
});
