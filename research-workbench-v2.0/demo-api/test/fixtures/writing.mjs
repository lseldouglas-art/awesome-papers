import {createWorkspace} from '../../src/workspace.mjs';
import {upgradeProject} from '../../src/progress.mjs';
import {ensureKernel} from '../../src/kernel.mjs';
import {topicWorkspace,importTopicRecords} from '../../src/topic-library-workflow.mjs';
import {outlineMaterials,outlinePacket,currentOutlineContext,outlineContext} from '../../../shared/topic-outline.mjs';
import {outlineFingerprint,validateOutline} from '../../src/topic-outline.mjs';
import {RELEVANCE_VERSION} from '../../../shared/topic-relevance.mjs';
import {outlineFixture} from './outline.mjs';
export function seedWriting(state) {
 const p=ensureKernel(upgradeProject(createWorkspace(state,{name:'分步写作 · 工程隔离',goal:'检验当前小节写作的证据与版本'},'seed-writing'),false)),a=Object.values(p.artifacts)[0];
 a.kind='topic_library';a.title='专题文献库';a.branchQuestion={itemId:'q',revisionId:'qr'};a.lineage={artifactId:a.id,revisionId:a.headRevisionId};
 p.researchItems.q={id:'q',kind:'question',headRevisionId:'qr',revisions:[{id:'qr',number:1,text:'成像与观察顺序',title:'成像与观察顺序',scope:'胃癌内镜',evidenceIds:[],unknowns:[],feasibility:{known:[],unknown:[]}}]};
 a.draft.resultId='library';a.draft.notes.intent='保留用户此前的研究想法';
 p.researchResults.library={id:'library',artifactId:a.id,kind:'topic_library',blocks:[],citations:[],accessIds:[],library:{entries:[],searchIds:[]}};
 const imported=importTopicRecords(p,a,Array.from({length:3},(_,i)=>({pmid:String(900001+i),title:`观察顺序与成像效能 · 工程材料 ${i+1}`,text:`Engineering fixture ${i+1}: Detection sensitivity was 90%. Observation order was fixed. This is test data, not scientific evidence.`,level:'abstract',year:'2025',authors:[]}))),w=topicWorkspace(a);
 for(const accessId of imported.ids){w.screenings[accessId]={accessId,relationship:'direct',summary:'工程材料描述了固定观察顺序的成像比较。用于检验本节写作。',quotes:[p.accesses[accessId].text],categories:[],criteriaVersion:RELEVANCE_VERSION};p.researchResults.library.library.entries.push({accessId,decision:'included',reason:'工程测试',actor:'local_user'});}
 const ids=imported.ids.slice(0,2),rows=outlineMaterials(p,a,ids),data=outlineFixture(outlinePacket(rows));data.sections[0].children.push({...structuredClone(data.sections[0].children[0]),heading:'结局定义与评价方式'});
 const context=currentOutlineContext(p,a,''),outline={...validateOutline(JSON.stringify(data),rows),id:'outline-qa',at:new Date().toISOString(),papers:outlinePacket(rows),context:outlineContext(context),inputFingerprint:outlineFingerprint(context,rows)};
 w.outlines=[outline];w.activeOutlineId=outline.id;p.researchKernel.position={artifactId:a.id};
 return {p,a,outline,ids,otherId:imported.ids[2]};
}
export function writingModel({failAudit=false,rejectParagraph=false}={}) {
 const calls=[];let fail=failAudit,reject=rejectParagraph;
 return {calls,generate:async({materials,instruction})=>{
  if(materials.length)throw Error('Writing must not re-send the whole library');
  let data,purpose;
  if(instruction.includes('只返回JSON {focus,')){purpose='blueprint';data={focus:'比较观察顺序与成像效能的边界',paragraphs:[{topic:'观察顺序的影响',claim:'区分固定观察顺序与成像效果',relationship:'相同场景互补',transition:'转入结局定义',boundary:'工程数据不能作科学证据',citations:[{ref:'R1',passage:'P1'}]}],coverage:[{ref:'R1',status:'used',reason:'用于检验引用'},{ref:'R2',status:'unused',reason:'重复工程示例，无新增信息'}],needs:['真实观察方案']};}
  else if(instruction.includes('本次仅写一个段落：')){purpose='paragraph';data={sentences:[{text:'工程材料报告检出敏感度为90%。',kind:'reported',citations:[{ref:reject?'R999':'R1',passage:'P1'}],recordQuote:''},{text:'本研究拟对观察顺序进行比较，实际安排尚待确定。',kind:'planned',citations:[],recordQuote:''}]};reject=false;}
  else if(instruction.includes('对固定段落逐句核对')){purpose='audit';calls.push({purpose,instruction});if(fail){fail=false;throw Error('temporary audit interruption');}data={sentences:[{id:'sentence-1',status:'consistent',explanation:'工程测试中的摘要确有该值，但正式使用仍需全文核对。',sources:[{ref:'R1',passage:'P1',status:'consistent',explanation:'核对数值与结局定义。'}]},{id:'sentence-2',status:'researcher',explanation:'尚未实施的研究计划，需研究者决定。',sources:[]}]};}
  else throw Error('Unexpected model purpose');
  if(purpose!=='audit')calls.push({purpose,instruction});
  return {text:JSON.stringify(data),usage:{total_tokens:10},cost:{status:'not_applicable',amount:0},provenance:{provider:'test.invalid',model:'fixture'}};
 }};
}
