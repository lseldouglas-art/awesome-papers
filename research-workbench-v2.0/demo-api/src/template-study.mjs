import {randomUUID} from 'node:crypto';
import {requireThat} from './errors.mjs';
import {parseModelJsonObject} from './model-output.mjs';
const norm=t=>String(t??'').replace(/\s+/g,' ').trim();
const nonempty=t=>typeof t==='string'&&t.trim();
export function validateAnchoredStudy(value,pages){
  requireThat(value&&nonempty(value.scope)&&Array.isArray(value.features)&&value.features.length>0,'model_structure','分析需要明确范围及具体提炼结果。',502);
  const features=value.features.map((f,i)=>{
    requireThat(['design','logic','language'].includes(f.dimension)&&['aspect','observation','application','boundary'].every(k=>nonempty(f[k]))&&Array.isArray(f.anchors)&&f.anchors.length>0,'model_structure','每项提炼需要原文依据、适用方式与不可迁移条件。',502);
    const anchors=f.anchors.map(a=>{const page=pages.find(p=>p.number===a.page);requireThat(page&&nonempty(a.quote)&&norm(a.quote).length>=12&&norm(a.quote).length<=700&&norm(page.text).includes(norm(a.quote)),'template_anchor_required','原文引句未能与 PDF 页码对应，当前分析未采纳。',502);return {page:a.page,quote:a.quote};});
    return {id:`principle-${i+1}`,dimension:f.dimension,aspect:f.aspect,observation:f.observation,application:f.application,boundary:f.boundary,anchors};
  });
  return {scope:value.scope,features};
}
const schema='{scope,features:[{dimension:"design|logic|language",aspect,observation,application,boundary,anchors:[{page,quote}]}]}';
export async function executeFulltextStudy({service,task,input,invoke,save,hash,rules}){
  const doc=input.paper.document,key=hash({standard:1,artifactId:input.artifactId,sha:doc.sha256,textVersion:input.paper.textVersion,topic:input.topic,articleType:input.articleType,targetJournal:input.targetJournal});
  const current=()=>service.store.read(s=>s.projects[task.projectId].templateLibrary.studies.find(st=>st.fingerprint===key));
  let study=await current();
  if(study?.status==='completed')return;
  if(!study){await save(l=>l.studies.push({id:`template_study_${randomUUID()}`,fingerprint:key,artifactId:input.artifactId,paperId:input.paper.id,textVersion:input.paper.textVersion,documentHash:doc.sha256,status:'reading',coveredPages:[],parts:[],features:[],scope:'全文分析进行中',at:new Date().toISOString()}));}
  for(const page of doc.pages){
    study=await current();if(study.parts.some(p=>p.page===page.number))continue;
    await service.updateTask(task,{progress:`模板原文分析 · 第 ${page.number} / ${doc.pageCount} 页`});
    const output=await invoke('model.template-page',`${rules}\n采用女娲的提炼方法：识别作者如何作出研究设计决策、如何建立论证和如何表达，而非复述研究结论。仅分析给定页，跨页结论留待综合。区分作者明确报告与分析者推断；提出设计取舍、论证推进、句法/术语特征，说明为何有效以及何时不能迁移。参考文献页应识别来源组织，不虚构其内容。图像像素未输入，只可分析实际文字与图注，不声称已视觉核验图表。每项必须以本页逐字引句定位，quote 12–700 字符，不能翻译或拼接。返回 JSON ${schema}。\n当前研究：${input.topic}\n文献：${input.paper.title}\n实际原文页：${JSON.stringify(page)}`);
    const part=validateAnchoredStudy(parseModelJsonObject(output.text),[page]);
    await save(l=>{const st=l.studies.find(s=>s.fingerprint===key);st.parts.push({...part,page:page.number,provenance:output.provenance});st.coveredPages.push(page.number);});
  }
  study=await current();
  await service.updateTask(task,{progress:'综合全文的研究设计、论证逻辑与语言特征'});
  const output=await invoke('model.template-synthesis',`${rules}\n已逐页读取全部 PDF 文字。采用女娲的原文提炼方法，综合全篇形成可执行的写作参照，而非泛化写作建议。返回 JSON ${schema}。design、logic、language 三个维度均须覆盖。design 解释研究问题到设计/比较/终点/解释的决策链及代价；logic 解释文章各部分如何协同、竞争解释及证据边界；language 提炼真实句法、动词强度、统计量/引用组织及段间推进。每条 application 针对当前专题，boundary 指明不可迁移的事实、设计差异或反例。每个 anchors 必须沿用逐页分析中的原句及页码。图表仅分析图注与正文描述，图像内容尚需人工查阅。\n当前研究：${input.topic}\n文章类型：${input.articleType}\n逐页提炼：${JSON.stringify(study.parts)}`);
  const final=validateAnchoredStudy(parseModelJsonObject(output.text),doc.pages);
  requireThat(['design','logic','language'].every(d=>final.features.some(f=>f.dimension===d)),'model_structure','全文综合需要同时覆盖研究设计、论证逻辑与语言特点。',502);
  await save(l=>Object.assign(l.studies.find(s=>s.fingerprint===key),final,{status:'completed',provenance:output.provenance,at:new Date().toISOString(),visualReview:'pending',coverageNote:`已分析 PDF 全部 ${doc.pageCount} 页文字及可提取图注；图像、外部附件仍需人工查阅。`}));
}
