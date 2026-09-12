import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFulltextService,pdfIdentity,parseTemplatePdf,installFulltext} from '../src/template-fulltext.mjs';
import {validateAnchoredStudy} from '../src/template-study.mjs';
import {templateReady,hasFulltext} from '../../shared/research-templates.mjs';
import {validateSourceChecks,splitEditedSentences} from '../src/writing-fact-audit.mjs';
import {validateAbstract} from '../src/manuscript-refinement.mjs';
import {figureFromInput,figureSvg} from '../../shared/scientific-figures.mjs';
import {manuscriptSnapshot,manuscriptMarkdown} from '../../shared/topic-writing.mjs';
const original=new URL('../../audits/2026-09-12-fulltext-revision/template-PMC13408707.pdf',import.meta.url);
test('actual open-access PDF has eight readable pages; wrong identity and non-PDF never install',async()=>{
 const bytes=await readFile(original),paper={id:'t',doi:'10.1002/deo2.70381',text:'old abstract',level:'abstract',textVersion:1};
 const service=createFulltextService(await mkdtemp(join(tmpdir(),'rw-pdf-'))),result=await service.acquire(paper,{base64:bytes.toString('base64'),filename:'paper.pdf'});
 assert.equal(result.document.pageCount,8);assert.equal(result.document.readable,true);assert.equal(result.document.complete,false);assert.deepEqual(await service.read(result.document.sha256),bytes);
 installFulltext(paper,result);assert.equal(paper.textVersion,2);assert.equal(paper.textHistory[0].text,'old abstract');assert.equal(hasFulltext(paper),false);paper.document.complete=true;assert.equal(hasFulltext(paper),true);
 await assert.rejects(()=>parseTemplatePdf(bytes,{doi:'10.0000/wrong',title:'Wrong paper'}),e=>e.code==='pdf_identity');await assert.rejects(()=>parseTemplatePdf(Buffer.from('<html>'),paper),e=>e.code==='invalid_pdf');
});
test('full-text analysis requires exact page anchors and cannot remain valid after document replacement',()=>{
 const pages=[{number:1,text:'The observation order was fixed within each examination.'}];
 const f={dimension:'design',aspect:'顺序',observation:'固定顺序比较',application:'识别顺序影响',boundary:'不直接迁移设计',anchors:[{page:1,quote:'The observation order was fixed'}]},value={scope:'原文',features:[f]};
 assert.equal(validateAnchoredStudy(value,pages).features[0].id,'principle-1');
 assert.throws(()=>validateAnchoredStudy({...value,features:[{...f,anchors:[{page:2,quote:f.anchors[0].quote}]}]},pages),e=>e.code==='template_anchor_required');
 const paper={id:'t',textVersion:2,level:'fulltext',document:{sha256:'a',complete:true,identityMatched:true,readable:true,pages,pageCount:1}},project={templateLibrary:{studies:[{paperId:'t',textVersion:2,documentHash:'a',status:'completed',coveredPages:[1]}]}};
 assert.equal(templateReady(project,paper),true);assert.equal(templateReady(project,{...paper,textVersion:3}),false);assert.equal(templateReady(project,{...paper,document:{...paper.document,sha256:'b'}}),false);
});
test('fact check covers multiple sources independently and handles English edited sentences',()=>{
 const sentence={citations:[{ref:'R1',passage:'P1',level:'abstract',quote:'source 1'},{ref:'R2',passage:'P2',level:'fulltext',quote:'source 2'}]},rows=sentence.citations.map(c=>({...c,status:'deeper',explanation:'需核对比较条件'}));
 assert.equal(validateSourceChecks({sources:rows},sentence).length,2);assert.throws(()=>validateSourceChecks({sources:rows.slice(0,1)},sentence),e=>e.code==='audit_source_coverage');
 assert.deepEqual(splitEditedSentences('Sensitivity was 90%.[1] The sequence was fixed.[2]').map(s=>s.trim()),['Sensitivity was 90%.[1]','The sequence was fixed.[2]']);
});
test('abstract anchors stay within manuscript and disappear from pure export when body changes',()=>{
 const input={sections:[{id:'s',version:{paragraphs:[{id:'p',text:'The study proposes a counterbalanced comparison.'}]}}]},data={sentences:[{text:'A counterbalanced comparison is proposed.',anchors:[{sectionId:'s',paragraphId:'p',quote:'proposes a counterbalanced comparison.'}]}],keywords:['a','b','c','d','e'],reason:'明确目标'};
 assert.equal(validateAbstract(data,input).sentences.length,1);assert.throws(()=>validateAbstract({...data,sentences:[{...data.sentences[0],text:'The study includes 99 participants.'}]},input),e=>e.code==='abstract_new_fact');
 const outline={id:'o',title:'t',sections:[{heading:'Introduction',children:[{id:'s',heading:'h'}]}]},workspace={sections:{s:{activeVersionId:'v1',versions:[{id:'v1',status:'completed',paragraphs:[{text:'BODY'}]}]}},abstract:{text:'ABSTRACT',keywords:['word'],sectionVersions:{s:'v1'}}};
 assert.match(manuscriptMarkdown(manuscriptSnapshot(outline,workspace)),/ABSTRACT/);workspace.sections.s.activeVersionId='v2';assert.doesNotMatch(manuscriptMarkdown(manuscriptSnapshot(outline,workspace)),/ABSTRACT/);
});
test('scientific figures use only supplied finite data and escape XML',()=>{
 const input={type:'bar',title:'<Study>',caption:'Measured result',source:'Data record',xLabel:'Group',yLabel:'Value (%)',content:'label,value\nA,4\nB,-2'};
 const fig=figureFromInput(input);assert.deepEqual(fig.points.map(p=>p.value),[4,-2]);assert.match(figureSvg(fig),/&lt;Study&gt;/);assert.doesNotMatch(figureSvg(fig),/<Study>/);
 assert.throws(()=>figureFromInput({...input,content:'label,value\nA,NaN'}));assert.throws(()=>figureFromInput({...input,source:''}));
});
test('full-text fact checks require exact page support and distinguish it from the original abstract snapshot',()=>{
 const sentence={citations:[{ref:'R1',passage:'P1',accessId:'a',level:'abstract',quote:'Original abstract'}]},documents={a:{sha256:'hash',pages:[{number:2,text:'The sequence was fixed within the same examination.'}]}};
 const source={ref:'R1',passage:'P1',status:'consistent',explanation:'核对同次检查观察顺序',anchors:[{page:2,quote:'The sequence was fixed within the same examination.'}]};
 const check=validateSourceChecks({sources:[source]},sentence,documents)[0];assert.equal(check.verifiedLevel,'fulltext');assert.equal(check.level,'abstract');assert.equal(check.documentHash,'hash');
 assert.throws(()=>validateSourceChecks({sources:[{...source,anchors:[{page:8,quote:'invented support'}]}]},sentence,documents),e=>e.code==='audit_fulltext_anchor');
});

test('preview accepts content alone without weakening publication validation or mutating input',()=>{
  const input={type:'bar',content:'label,value\nControl,2\nTreatment,4'};
  const preview=figureFromInput(input,{preview:true});
  assert.deepEqual(preview.points,[{label:'Control',value:2},{label:'Treatment',value:4}]);
  assert.equal(preview.source,'来源待补充');assert.equal(input.source,undefined);
  assert.throws(()=>figureFromInput(input));
  assert.throws(()=>figureFromInput({...input,content:'label,value\nControl,NaN'},{preview:true}));
  const flow=figureFromInput({type:'flow',content:'纳入样本\n完成检测'},{preview:true});
  assert.deepEqual(flow.steps,['纳入样本','完成检测']);assert.equal(flow.xLabel,undefined);
});
