import {RevisionWorkspace} from './RevisionWorkspace.jsx';
import {useState} from 'react';
import {ArrowRight,BookOpen,FileText} from '@phosphor-icons/react';
import {TopicWritingWorkbench as SectionReview} from './TopicWritingWorkbench.jsx';
import {writingSections,sectionAccessIds,manuscriptSnapshot,manuscriptMarkdown,manuscriptHtml} from '../../shared/topic-writing.mjs';
import {templateSelection} from '../../shared/research-templates.mjs';
import {download,date} from './ui.jsx';
import './manuscript.css';

export function TopicWritingWorkbench(props){
  const {project,artifact,onRun,onTemplates,onOutline,disabled,task}=props,w=artifact.topicWorkspace;
  const outline=w.outlines?.find(o=>o.id===(w.activeWritingOutlineId??w.confirmedOutlineId));
  if(!outline)return <section><h1>正文初稿</h1><p>确认研究大纲后生成初稿。</p><button onClick={onOutline}>查看研究大纲</button></section>;
  return <Manuscript key={outline.id} {...props} outline={outline}/>;
}
function Manuscript(props){
  const {project,artifact,outline,onRun,onTemplates,onOutline,disabled,task}=props;
  const workspace=artifact.topicWorkspace.writingWorkspaces?.[outline.id],live=manuscriptSnapshot(outline,workspace),history=workspace?.manuscripts??[];
  const key=`rw2:manuscript-view:${project.id}:${outline.id}`;
  const [view,setView]=useState(()=>{try{return localStorage.getItem(key)??'draft';}catch{return 'draft';}}),[selected,setSelected]=useState('current'),[language,setLanguage]=useState('zh'),[revisionOpen,setRevisionOpen]=useState(false);
  const selection=templateSelection(project,artifact),paper=selection.paper,readingKey=`${key}:read:${paper?.id}:${paper?.textVersion??1}`;
  const [readVersion,setReadVersion]=useState(()=>{try{return localStorage.getItem(readingKey)==='yes'?readingKey:null;}catch{return null;}});
  const reading=readVersion===readingKey;
  const go=v=>{setView(v);try{localStorage.setItem(key,v);}catch{}};
  const manuscript=history.find(m=>m.id===selected)??live,hasText=manuscript.chapters.some(c=>c.sections.some(s=>s.paragraphs.length));
  const running=task?.mode==='manuscript-writing',ready=live.complete;
  const generate=()=>onRun('manuscript-writing',{text:'按已确认大纲生成完整正文初稿；保留已写正文，接续未完成小节。采用凝练、严谨的学术语体，不进行全文润色或逐句审计。',accessIds:[...new Set(writingSections(outline).flatMap(sectionAccessIds))],topicOptions:{outlineId:outline.id,language}});
  const markRead=()=>{try{localStorage.setItem(readingKey,'yes');}catch{}setReadVersion(readingKey);go('review');};
  return <section className="manuscript-workbench" aria-label="正文初稿工作台">
    <header className="writing-page-head"><div><h1>正文初稿</h1><p>{outline.title}</p></div><button onClick={onOutline}>查看大纲</button></header>
    <nav className="manuscript-stages" aria-label="正文工作流程">{[['draft','完整初稿'],['template','模板阅读'],['review','逐段审阅']].map(([id,label],i)=><button key={id} aria-current={view===id?'step':undefined} onClick={()=>go(id)}><span>{i+1}</span>{label}</button>)}</nav>
    {view==='draft'&&<>
      <div className="manuscript-actions"><div><strong>{live.completedSections} / {live.totalSections} 节已形成草稿</strong><progress value={live.completedSections} max={live.totalSections}/><small>{ready?'初稿已完整，可以通读、导出并选择模板文献。':'完整初稿生成后，可对照模板开展审阅与修订。'}</small></div>{!ready?<><select aria-label="初稿语言" value={language} disabled={disabled} onChange={e=>setLanguage(e.target.value)}><option value="zh">中文</option><option value="en">英文</option></select><button className="primary" disabled={disabled} onClick={generate}>{running?'正在生成完整初稿…':hasText?'继续生成完整初稿':'生成完整初稿'}<ArrowRight size={16}/></button></>:<button className="primary" onClick={()=>go('template')}>选择并阅读模板<ArrowRight size={16}/></button>}</div>
      {running&&<details className="manuscript-task"><summary>查看生成进度</summary>{Object.values(task.sectionProgress??{}).map(s=><p key={s.number}><b>{s.number}</b> {s.progress}</p>)}</details>}
      <div className="manuscript-exports"><select aria-label="整篇初稿版本" value={selected} onChange={e=>setSelected(e.target.value)}><option value="current">当前正文</option>{history.map((m,i)=><option key={m.id} value={m.id}>初稿 {i+1} · {date(m.at)}{m.complete?'':' · 部分'}</option>)}</select><button disabled={!hasText||running} onClick={()=>download(`${manuscript.title}-正文初稿.md`,manuscriptMarkdown(manuscript),'text/markdown')}>导出正文 .md</button><button disabled={!hasText||running} onClick={()=>download(`${manuscript.title}-正文初稿.html`,manuscriptHtml(manuscript),'text/html')}>导出排版稿</button></div>
      {hasText?<div className="manuscript-reading"><aside aria-label="初稿目录">{manuscript.chapters.map(c=><div key={c.number}><b>{c.number} {c.heading}</b>{c.sections.map(s=><button key={s.id} onClick={()=>document.getElementById(`manuscript-${s.id}`)?.scrollIntoView({behavior:'smooth',block:'start'})}>{s.number} {s.heading}</button>)}</div>)}</aside><article className="manuscript-paper"><h1>{manuscript.title}</h1>{manuscript.chapters.map(c=><section key={c.number}><h2>{c.number} {c.heading}</h2>{c.sections.map(s=><section key={s.id} id={`manuscript-${s.id}`}><h3>{s.number} {s.heading}</h3>{s.paragraphs.length?s.paragraphs.map((text,i)=><p key={i}>{text}</p>):<div className="manuscript-pending">本节尚未生成</div>}</section>)}</section>)}</article></div>:<div className="manuscript-empty"><FileText size={30}/><h2>从大纲到完整初稿</h2><p>按已确认大纲生成并组装正文，完成后进入模板阅读与逐段审阅。</p></div>}
      {hasText&&<footer className="manuscript-next"><span>导出仅含文章标题、章节、正文及引用编号。</span><button disabled={!ready} onClick={()=>go('template')}>下一步：模板阅读<ArrowRight size={16}/></button></footer>}
    </>}
    {view==='template'&&<div className="manuscript-template"><BookOpen size={28}/><h2>模板文献选择与分析</h2><p>分析模板的科学问题、证据组织与论证结构，为正文修订建立参照。</p>{paper?<div className="manuscript-template-paper"><small>当前主模板</small><h3>{paper.title}</h3><p>{paper.level==='fulltext'?'已保存全文文字':paper.level==='excerpt'?'已保存原文片段':'当前保存摘要，可在阅读器补充原文'}</p></div>:<p>可确认推荐候选，或从已有文献中选择主模板。</p>}<button className="primary" onClick={()=>paper?setRevisionOpen(true):onTemplates()}>{paper?'进入并排精读':'选择模板文献'}</button></div>}
    {view==='review'&&<><div className="revision-entry"><h2>正文修订</h2><p>并排精读完整原文，提炼研究设计与写作方法，再逐段修订正文。</p><button className="primary" onClick={()=>setRevisionOpen(true)}>进入正文修订工作区</button></div><details><summary>查看已有章节审阅记录</summary>{!paper||!reading?<div className="manuscript-review-intro"><strong>模板阅读为初稿论证与表达的比较提供参照。</strong><button onClick={()=>go('template')}>进入模板阅读</button></div>:<div className="manuscript-review-intro"><strong>当前模板：{paper.title}</strong><button onClick={onTemplates}>查看模板原文</button></div>}<SectionReview {...props}/></details></>}
    {revisionOpen&&<RevisionWorkspace {...props} onClose={()=>setRevisionOpen(false)}/> }
  </section>;
}
