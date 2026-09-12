import {writingModel} from './writing.mjs';
export const study={scope:'仅依据工程摘要，不声称读过全文。',features:[{aspect:'开篇命题',observation:'先定义比较对象。',application:'以可检验的具体问题开篇。'}]};
export function templateModel(){const writing=writingModel(),calls=[];return {calls,writingCalls:writing.calls,generate:async args=>{
 const i=args.instruction;let data;
 if(i.includes('为模板检索返回JSON'))data={query:'gastric cancer'};
 else if(i.includes('真实PubMed候选'))data={candidates:[{pmid:'12345',fit:'同类工程测试',quality:'期刊契合是推荐判断，IF未核验。',learn:'可比较开篇组织。',tradeoff:'仅摘要，尚未覆盖正文。'}]};
 else if(i.includes('实际原文页：')){const page=JSON.parse(i.split('实际原文页：').at(-1));data={scope:'本页工程提炼',features:[{dimension:'design',aspect:'比较条件',observation:'明确报告比较条件。',application:'保持可检验的比较问题。',boundary:'不迁移模板数据。',anchors:[{page:page.number,quote:page.text.slice(0,70)}]}]};}
 else if(i.includes('逐页提炼：')){const parts=JSON.parse(i.split('逐页提炼：').at(-1));data={scope:'完整工程文字分析',features:['design','logic','language'].map(d=>({...parts[0].features[0],dimension:d,aspect:d}))};}
 else if(i.includes('只分析这份实际文本'))data=study;
 else if(i.includes('仅依据当前已审阅正文形成')){const sections=JSON.parse(i.split('\n正文：').at(-1).split('\n全文提炼：')[0]),s=sections[0],p=s.version.paragraphs[0];data={sentences:[{text:'本研究拟比较观察顺序，具体实施安排尚待确定。',anchors:[{sectionId:s.id,paragraphId:p.id,quote:p.text}]}],keywords:['观察顺序','成像','检出','研究方案','比较'],reason:'摘要只保留正文已给定计划。'};}
 else if(i.includes('正文各节已完成研究者审阅')){const p=JSON.parse(i.split('\n当前段落：').at(-1));data={diagnosis:'按全文关系优化措辞',suggestions:[{before:p.text,issue:'凝练测量报告',principleIds:['principle-3'],options:[{text:p.text.replace('报告检出','所报告的检出'),reason:'维持研究条件',useWhen:'不引入新事实'}]}]};}
 else if(i.includes('当前小节与正文（独立于模板）'))data={study,diagnosis:'保持数值和条件，调整报告动词。',suggestions:[{before:'工程材料报告检出敏感度为90%。[1]',issue:'报告动词可更具体',principleIds:['principle-3'],options:[{text:'工程材料所报告的检出敏感度为90%。[1]',reason:'突出测量指标，维持来源范围。',useWhen:'保留原有研究条件。'},{text:'工程材料中，检出敏感度报告为90%。[1]',reason:'以研究范围限定指标。',useWhen:'承接前句时采用。'}]}]};
 else return writing.generate(args);
 calls.push(i);return {text:JSON.stringify(data),usage:{total_tokens:10},cost:{status:'not_applicable',amount:0},provenance:{provider:'test.invalid',model:'fixture'}};
}};}

export function seedTemplateFulltext(p,paperId){
 const paper=p.templateLibrary.papers[paperId];paper.level='fulltext';paper.document={sha256:'a'.repeat(64),identityMatched:true,complete:true,readable:true,pageCount:1,pages:[{number:1,text:paper.text+' This complete engineering template explains comparison conditions.'}]};
}
