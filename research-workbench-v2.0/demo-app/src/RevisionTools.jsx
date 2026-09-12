import {useEffect,useState} from 'react';
import {templateSelection,templateReady} from '../../shared/research-templates.mjs';
import {writingSections,currentSectionVersion,manuscriptSnapshot} from '../../shared/topic-writing.mjs';
import {figureFromInput,figureSvg} from '../../shared/scientific-figures.mjs';
import {download} from './ui.jsx';
export function PriorityRevision({project,artifact,outline,disabled,onRun,onTemplateEdit,onSection}){
  const [focus,setFocus]=useState('introduction'),w=artifact.topicWorkspace.writingWorkspaces[outline.id],paper=templateSelection(project,artifact).paper;
  const reviewed=writingSections(outline).every(s=>w.sections[s.id]?.completedVersionId&&w.sections[s.id].completedVersionId===w.sections[s.id].activeVersionId);
  const ready=reviewed&&templateReady(project,paper,artifact),proposal=project.templateLibrary?.refinements?.findLast(r=>r.artifactId===artifact.id&&r.outlineId===outline.id&&r.paperId===paper?.id&&r.textVersion===paper?.textVersion);
  const current=manuscriptSnapshot(outline,w),fresh=proposal&&JSON.stringify(proposal.sectionVersions)===JSON.stringify(current.sectionVersions);
  return <section className="revision-tool-sheet"><h2>重点章节深化</h2><p>以已审阅正文为基础，结合模板的完整分析，进一步审视引言、讨论与摘要的论证和表达。</p><label>优化章节<select aria-label="重点优化章节" value={focus} onChange={e=>setFocus(e.target.value)}><option value="introduction">引言</option><option value="discussion">讨论</option><option value="abstract">摘要与关键词</option></select></label><button className="primary" disabled={disabled||!ready} onClick={()=>onRun('template-refine',{accessIds:[],text:'基于已审阅全文与模板提炼，深化重点章节。',templateOptions:{outlineId:outline.id,focus}})}>生成修改建议</button>{!ready&&<p>当前正文全部审阅、模板全文分析完成后开放。</p>}{focus!=='abstract'&&<p>建议逐段保存在对应章节，审阅后选择应用。{writingSections(outline).filter(s=>(focus==='introduction'?/引言|introduction|背景|background/i:/讨论|discussion/i).test(s.chapter)).map(s=><button key={s.id} onClick={()=>onSection(s.id)}>{s.number} {s.heading}</button>)}</p>}{focus==='abstract'&&proposal&&<><h3>摘要候选</h3>{proposal.sentences.map((s,i)=><div key={i}><p className="academic-paragraph">{s.text}</p><details><summary>对应正文</summary>{s.anchors.map((a,j)=><button key={j} onClick={()=>onSection(a.sectionId)}>{a.quote}</button>)}</details></div>)}<p>关键词：{proposal.keywords.join('；')}</p><p>{proposal.reason}</p><button className="primary" disabled={disabled||!fresh||!ready} onClick={()=>onTemplateEdit({action:'apply-abstract',refinementId:proposal.id})}>{w.abstract?.refinementId===proposal.id?'已采用此摘要':'采用摘要并纳入正文导出'}</button>{!fresh&&<p>正文已更新，请重新形成摘要。</p>}</>}</section>;
}
export function DataFigures({project,artifact,disabled,onTemplateEdit}){
  const key=`rw2:figure-input:${project.id}:${artifact.id}`;
  const [input,setInput]=useState(()=>{try{return JSON.parse(localStorage.getItem(key))??{type:'bar',title:'',caption:'',source:'',xLabel:'',yLabel:'',content:'label,value\n'};}catch{return {type:'bar',content:'label,value\n'};}}),[figure,setFigure]=useState(null),[error,setError]=useState(''),[detailsOpen,setDetailsOpen]=useState(false);
  useEffect(()=>{try{localStorage.setItem(key,JSON.stringify(input));}catch{setError('浏览器暂存不可用，请保存图稿或复制数据。');}},[key,input]);
  const update=(key,value)=>{setInput(v=>({...v,[key]:value}));if(key==='content')setFigure(null);else if(figure)setFigure(figureFromInput({...input,[key]:value},{preview:true}));};
  const svg=figure?figureSvg(figure):'',url=svg?`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`:null;
  const png=async final=>{const img=new Image();img.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(figureSvg(final))}`;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width*3;canvas.height=img.height*3;canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${final.title}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  const finish=action=>{try{const final=figureFromInput(input);setFigure(final);setError('');action(final);}catch(e){setDetailsOpen(true);setError(e.message);}};
  const fields=['title',...(input.type==='flow'?[]:['xLabel','yLabel']),'source','caption'];
  return <section className="revision-tool-sheet figure-workspace data-figure-studio">
    <header><h2>数据图与流程图</h2><p>先放入数据或步骤，预览后再补充出版信息。</p></header>
    <label className="data-kind">图形<select aria-label="科研图形类型" value={input.type} onChange={e=>{setInput(v=>({...v,type:e.target.value,content:e.target.value==='flow'?'':'label,value\n'}));setFigure(null);setError('');}}><option value="bar">柱状图</option><option value="line">折线图</option><option value="flow">研究流程图</option></select></label>
    <div className="data-figure-columns"><div className="data-figure-input">
      <label>{input.type==='flow'?'流程步骤':'数据'}<textarea aria-label="科研作图数据" rows={7} placeholder={input.type==='flow'?'每行一个步骤，至少两步':'label,value'} value={input.content??''} onChange={e=>update('content',e.target.value)}/></label>
      <small>{input.type==='flow'?'每行一个步骤，按实际顺序排列。':'CSV 首行为 label,value；之后每行填写标签和数值。'}</small>
      {input.type!=='flow'&&<details className="data-import"><summary>从 CSV 文件导入</summary><input aria-label="导入 CSV" type="file" accept=".csv,text/csv" onChange={async e=>{const file=e.target.files[0];if(file){if(file.size>1000000){setError('CSV 不得超过 1 MB。');return;}update('content',await file.text());}}}/></details>}
      <button className="primary" onClick={()=>{try{setFigure(figureFromInput(input,{preview:true}));setError('');}catch(e){setError(e.message);}}}>生成图稿</button>
      <details className="data-metadata" open={detailsOpen} onToggle={e=>setDetailsOpen(e.currentTarget.open)}><summary>出版信息 <small>保存或导出前补充</small></summary><div className="data-fields">{fields.map(k=><label key={k} className={k==='source'||k==='caption'?'wide':undefined}>{({title:'图题',caption:'图注',source:'数据或方案来源',xLabel:'横轴与单位',yLabel:'纵轴与单位'})[k]}<input value={input[k]??''} onChange={e=>update(k,e.target.value)}/></label>)}</div></details>
      {error&&<p role="alert">{error}</p>}
    </div><div className="data-figure-result">
      {figure?<><img className="scientific-figure-preview" src={url} alt={figure.title}/><div className="figure-export"><button disabled={disabled} onClick={()=>finish(()=>onTemplateEdit({action:'save-figure',figure:input}))}>保存图稿版本</button><button onClick={()=>finish(f=>download(`${f.title}.svg`,figureSvg(f),'image/svg+xml'))}>导出矢量 SVG</button><button onClick={()=>finish(f=>png(f))}>导出高清 PNG</button></div></>:<div className="data-preview-empty"><span aria-hidden="true">▥ →</span><h3>在这里预览图稿</h3><p>{input.type==='flow'?'输入步骤后生成流程图。':'粘贴或导入数据后生成图表。'}</p></div>}
      <small>{input.type==='flow'?'流程仅表达输入方案，不代表研究已实施。':'数值来自输入数据，不自动推断显著性或置信区间。'}</small>
    </div></div>
    <details className="data-saved"><summary>已保存图稿 · {artifact.topicWorkspace.figures?.filter(f=>f.type!=='illustration').length??0}</summary>{artifact.topicWorkspace.figures?.filter(f=>f.type!=='illustration').map(f=><button key={f.id} onClick={()=>{setInput(f.input);setFigure(f);setError('');}}>{f.title} · {new Date(f.at).toLocaleString()}</button>)}</details>
  </section>;
}
