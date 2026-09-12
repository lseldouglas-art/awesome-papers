import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {seedWriting} from './fixtures/writing.mjs';
import {kernelCommand,recordOutputDependencies} from '../src/kernel.mjs';
import {continuitySnapshot,continuitySignature,selectedRecordText,itemVersion,nestedRef,consistencyFindings,currentWork,resolveResearchRef} from '../../shared/research-continuity.mjs';
import {exportContinuity,provenanceManifest} from '../src/continuity.mjs';
import {writingInput,validateParagraph} from '../src/topic-writing.mjs';
import {ResearchApplication} from '../src/research-application.mjs';
import {createResearchFiles} from '../src/research-files.mjs';
import {exportZip,crc32} from '../../shared/export-bundle.mjs';
import {validateResearchOutput} from '../src/research.mjs';
function fixture(){
  const state={projects:{},receipts:{},events:[],modelCalls:[]},seed=seedWriting(state),{p,a,outline}=seed;
  a.topicWorkspace.outlineConfirmations=[{outlineId:outline.id}];
  let n=0;
  const call=(name,body={})=>kernelCommand(state,p.id,name,{artifactId:a.id,baseStateVersion:p.researchKernel.version,...body},`continuity-${++n}`);
  const save=(kind,payload={},extra={})=>call('save-continuity',{kind,title:`工程测试 ${kind}`,payload,...extra});
  const adopt=r=>call('decide-continuity',{itemId:r.itemId,revisionId:r.revisionId,choice:'adopt'});
  return {...seed,state,call,save,adopt};
}
test('protocol draft, adoption, edit and restoration keep exact linear versions and immutable choices',()=>{
  const f=fixture(),one=f.save('protocol',{question:'工程问题',primaryOutcome:'指标A'});assert.equal(continuitySnapshot(f.p,f.a.id).protocol,null);
  f.adopt(one);const original=structuredClone(itemVersion(f.p,{id:one.itemId,revisionId:one.revisionId}).revision),snapshot=continuitySnapshot(f.p,f.a.id);
  const two=f.save('protocol',{question:'调整问题',primaryOutcome:'指标B'},{itemId:one.itemId,baseRevisionId:one.revisionId});
  assert.deepEqual(continuitySnapshot(f.p,f.a.id),snapshot);assert.deepEqual(f.p.researchItems[one.itemId].revisions[0],original);
  const restored=f.call('restore-continuity',{itemId:one.itemId,baseRevisionId:two.revisionId,revisionId:one.revisionId});assert.equal(f.p.researchItems[one.itemId].revisions.length,3);assert.equal(continuitySnapshot(f.p,f.a.id).protocol.ref.revisionId,one.revisionId);
  f.adopt(restored);assert.equal(continuitySnapshot(f.p,f.a.id).protocol.number,3);
});
test('stale writes and forged missing-version inputs fail while the previous saved content stays exact',()=>{
  const f=fixture(),one=f.save('protocol',{question:'原问题'}),before=structuredClone(f.p.researchItems);
  assert.throws(()=>f.save('protocol',{question:'覆盖'},{itemId:one.itemId,baseRevisionId:'wrong'}),e=>e.code==='revision_conflict');assert.deepEqual(f.p.researchItems,before);
  assert.throws(()=>f.save('execution',{text:'记录',inputRefs:[{type:'research_item',id:one.itemId}]}),e=>e.code==='invalid_reference');
});
test('separate research directions do not share selected protocols or accept foreign continuity records',()=>{
  const f=fixture(),one=f.save('protocol',{question:'方向一'});f.adopt(one);
  f.p.researchItems.q2={...structuredClone(f.p.researchItems.q),id:'q2'};f.a.branchQuestion={itemId:'q2',revisionId:'qr'};
  assert.equal(continuitySnapshot(f.p,f.a.id).protocol,null);assert.equal(currentWork(f.p,f.a.id).items.length,0);
  assert.throws(()=>f.save('execution',{text:'方向二',inputRefs:[{type:'research_item',id:one.itemId,revisionId:one.revisionId}]}),e=>e.code==='invalid_scope');
});
test('AI interpretation cannot become raw observation and actual execution inputs remain explicitly attributed',()=>{
  const f=fixture();assert.throws(()=>f.save('execution',{text:'AI建议',originKind:'external_ai'}),e=>e.code==='invalid_study_record');
  const run=f.save('execution',{text:'工程测试：运行失败，没有结果',performedBy:'研究者',executionStatus:'failed'}),ref={type:'research_item',id:run.itemId,revisionId:run.revisionId};
  const interpretation=f.save('interpretation',{text:'这可能与参数有关',originKind:'external_ai',inputRefs:[ref]});f.adopt(interpretation);
  const record=selectedRecordText(f.p,continuitySnapshot(f.p,f.a.id));assert.match(record,/运行失败/);assert.doesNotMatch(record,/可能与参数/);assert.equal(f.p.decisions[continuitySnapshot(f.p,f.a.id).result.decisionId].actor,'local_user');
});
test('meaningful protocol adoption reaches nested writing and figures; cosmetic titles do not',()=>{
  const f=fixture(),one=f.save('protocol',{primaryOutcome:'A'});f.adopt(one);
  f.a.topicWorkspace.writingWorkspaces={[f.outline.id]:{sections:{s:{activeVersionId:'v',versions:[{id:'v',paragraphs:[{text:'A为主要结局'}]}]}}}};
  f.a.topicWorkspace.figures=[{id:'fig',title:'图一'}];
  const writing=nestedRef('writing',f.a,f.outline.id,'s','v'),figure=nestedRef('figure',f.a,null,null,'fig');
  recordOutputDependencies(f.p,writing,continuitySnapshot(f.p,f.a.id));recordOutputDependencies(f.p,figure,{refs:[writing]});
  const cosmetic=f.save('protocol',{primaryOutcome:'A'},{title:'新名称',itemId:one.itemId,baseRevisionId:one.revisionId});f.adopt(cosmetic);assert.equal(Object.keys(f.p.researchImpacts).length,0);
  // A real change after a cosmetic adopted revision still reaches the older input.
  const changed=f.save('protocol',{primaryOutcome:'B'},{itemId:one.itemId,baseRevisionId:cosmetic.revisionId});f.adopt(changed);
  assert.ok(Object.values(f.p.researchImpacts).some(i=>i.target?.type==='writing'));
  assert.ok(Object.values(f.p.researchImpacts).some(i=>i.target?.type==='figure'));
});
test('deferred and resolved impacts retain their target and exact updated version',()=>{
  const f=fixture(),one=f.save('protocol',{primaryOutcome:'A'});f.adopt(one);
  const r=f.save('execution',{text:'执行记录',inputRefs:[{type:'research_item',id:one.itemId,revisionId:one.revisionId}]});
  const two=f.save('protocol',{primaryOutcome:'B'},{itemId:one.itemId,baseRevisionId:one.revisionId});f.adopt(two);const impact=Object.values(f.p.researchImpacts).find(i=>i.target?.id===r.itemId);assert.ok(impact);
  f.call('resolve-impact',{impactId:impact.id,choice:'defer'});assert.equal(impact.status,'deferred');
  const newer=f.save('execution',{text:'检查后更新记录'},{itemId:r.itemId,baseRevisionId:r.revisionId});
  f.call('resolve-impact',{impactId:impact.id,choice:'updated',updatedTarget:{type:'research_item',id:r.itemId,revisionId:newer.revisionId}});assert.equal(impact.resolutions.at(-1).updatedTarget.revisionId,newer.revisionId);
});
test('exported old record never substitutes a newer adopted protocol',()=>{
  const f=fixture(),one=f.save('protocol',{primaryOutcome:'A'});f.adopt(one);const r=f.save('execution',{text:'旧记录',inputRefs:[{type:'research_item',id:one.itemId,revisionId:one.revisionId}]});
  const before=exportContinuity(f.p,r.itemId,r.revisionId),two=f.save('protocol',{primaryOutcome:'B'},{itemId:one.itemId,baseRevisionId:one.revisionId});f.adopt(two);
  const after=exportContinuity(f.p,r.itemId,r.revisionId);assert.equal(after.markdown,before.markdown);assert.equal(after.manifest.entries.find(e=>e.ref.id===one.itemId).content.payload.primaryOutcome,'A');assert.ok(!after.manifest.entries.some(e=>e.ref.revisionId===two.revisionId));
});
test('literal role and unit mismatches are review candidates and absence does not claim scientific verification',()=>{
  const f=fixture(),one=f.save('protocol',{primaryOutcome:'住院时间',secondaryOutcomes:'再入院率',outcomeUnits:'住院时间：天'});f.adopt(one);
  f.a.topicWorkspace.writingWorkspaces={[f.outline.id]:{sections:{s:{activeVersionId:'v',versions:[{id:'v',paragraphs:[{text:'次要结局为住院时间，记录为2月。'}]}]}}}};
  const found=consistencyFindings(f.p,f.a.id);assert.equal(found.length,2);assert.ok(found.every(f=>f.verification.includes('candidate')));
});
test('explicit writing purpose overrides a misleading chapter heading and raw records enter only from chosen input',()=>{
  const f=fixture(),run=f.save('execution',{text:'实际记录：无有效输出'});f.adopt(run);
  const input=writingInput(f.p,f.a,{accessIds:f.ids,topicOptions:{outlineId:f.outline.id,sectionId:'outline-1-1',outputMode:'results'}});
  assert.equal(input.mode,'results');assert.match(input.recordText,/无有效输出/);assert.equal(input.modeSource,'explicit_section');
  assert.throws(()=>validateParagraph(JSON.stringify({sentences:[{text:'本研究观察到10例。',kind:'researcher_record',recordQuote:'10例',citations:[]}]}),[],{id:'p',citations:[]},input),e=>e.code==='invalid_study_record');
});
test('saving draft or unrelated observation does not make task stale; adopting changed inputs does',()=>{
  const f=fixture(),one=f.save('protocol',{primaryOutcome:'A'});f.adopt(one);
  const task={artifactId:f.a.id,input:{continuity:continuitySnapshot(f.p,f.a.id),adoptionContext:{currentQuestion:null,exploration:null}}};
  f.save('insight',{text:'尚未采用的建议'});assert.equal(ResearchApplication.prototype.isResearchInputStale(f.p,task),false);
  const two=f.save('protocol',{primaryOutcome:'B'},{itemId:one.itemId,baseRevisionId:one.revisionId});assert.equal(ResearchApplication.prototype.isResearchInputStale(f.p,task),false);f.adopt(two);assert.equal(ResearchApplication.prototype.isResearchInputStale(f.p,task),true);
});
test('historical question decisions resolve their original revision and nested refs cannot spoof identity',()=>{
  const f=fixture();f.p.researchItems.q.revisions.push({id:'new',text:'新问题'});f.p.researchItems.q.headRevisionId='new';
  assert.equal(itemVersion(f.p,{itemId:'q',itemRevisionId:'qr'}).revision.text,'成像与观察顺序');
  assert.equal(resolveResearchRef(f.p,{...nestedRef('outline',f.a,null,null,f.outline.id),id:'spoof'}),null);
});
test('comparison observations contain actual actor and optional time without inventing model work',()=>{
  const f=fixture();f.call('record-comparison-event',{path:'gpt',text:'重新解释研究条件后继续'});const event=f.p.researchEvents.at(-1);
  assert.equal(event.detail.activeMinutes,null);assert.equal(event.actor,'local_user');assert.equal(Object.keys(f.p.researchTasks).length,0);
});
test('attachment bytes are content-addressed, re-open exactly, detect tampering and preserve missing metadata',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'rw-continuity-files-')),files=createResearchFiles(dir),bytes=Buffer.from('label,value\nA,2\n');
  const meta=await files.save({name:'记录.csv',base64:bytes.toString('base64')});assert.deepEqual(await files.read(meta),bytes);assert.equal(meta.access,'stored_not_read');
  await assert.rejects(()=>files.save({name:'false.pdf',base64:bytes.toString('base64')}),e=>e.code==='invalid_file');
  await writeFile(join(dir,'research-attachments',meta.sha256),'changed');await assert.rejects(()=>files.read(meta),e=>e.code==='file_integrity');
  await rename(join(dir,'research-attachments',meta.sha256),join(dir,'research-attachments',meta.sha256+'.preserved'));await assert.rejects(()=>files.read(meta),e=>e.code==='attachment_missing');
});
test('UTF-8 export package keeps clean content and its sidecar as independent exact files',()=>{
  const data='原始正文\n',zip=exportZip([{name:'正文.md',content:data},{name:'依据.json',content:'{"version":"one"}'}]),v=new DataView(zip.buffer);
  assert.equal(v.getUint32(0,true),0x04034b50);assert.equal(v.getUint32(14,true),crc32(new TextEncoder().encode(data)));assert.equal(v.getUint32(zip.length-22,true),0x06054b50);assert.equal(v.getUint16(zip.length-12,true),2);
  assert.equal(provenanceManifest(fixture().p,{}).lineageStatus,'legacy_linkage_not_recorded');
});
test('discussion facts anchor selected execution records without borrowing a paper citation',()=>{
  const f=fixture(),r=f.save('execution',{text:'本机程序实际读到2条数据',performedBy:'验收脚本',limitations:'不能推断研究质量'});f.adopt(r);const records=continuitySnapshot(f.p,f.a.id).records;
  const output={items:[{headline:'执行记录',text:'本次程序读到2条数据。',status:'researcher_record',citations:[],record:{ref:'U1',quote:'实际读到2条数据'}}]};
  const parsed=validateResearchOutput(JSON.stringify(output),'ask',[],{records});assert.equal(parsed.citations.length,0);assert.equal(parsed.blocks[0].recordAnchor.ref.id,r.itemId);assert.equal(parsed.blocks[0].recordAnchor.performedBy,'验收脚本');
  output.items[0].record.quote='不能推断研究质量';assert.equal(validateResearchOutput(JSON.stringify(output),'ask',[],{records}).blocks[0].recordAnchor.field,'limitations');
  output.items[0].record.field='method';assert.throws(()=>validateResearchOutput(JSON.stringify(output),'ask',[],{records}),e=>e.code==='invalid_study_record');delete output.items[0].record.field;
  output.items[0].record.quote='实际读到3条数据';assert.throws(()=>validateResearchOutput(JSON.stringify(output),'ask',[],{records}),e=>e.code==='invalid_study_record');
  assert.throws(()=>validateResearchOutput(JSON.stringify(output),'ask',[]),e=>e.code==='model_structure');
});
