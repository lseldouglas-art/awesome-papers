import { useMemo, useState } from 'react';
import { ArrowRight, BookOpen, MagnifyingGlass, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { parentReference } from '../../shared/research-path.mjs';
import { domainStoryboard } from '../../shared/domain-storyboard.mjs';
import { ContentDiagram } from './DomainDiagrams.jsx';
import './domain-brief.css';
import {DomainChapters} from './DomainChapters.jsx';

const levelNames = { title:'题名', abstract:'摘要', excerpt:'正文片段', full_text:'全文文本' };
function SourcePill({ note, block, result, project, numbers, onSource }) {
  const c = (result.citations || []).find(c=>c.blockId===block?.id && (!note || c.sourceId===note.sourceId)) || (result.citations || []).find(c=>c.sourceId===note?.sourceId) || (note?.accessId ? {accessId:note.accessId,sourceId:note.sourceId} : null);
  if (!c) return null;
  const s=project.sources[c.sourceId], a=project.accesses[c.accessId], author=s?.authors?.[0]?.split(' ')[0];
  return <button className="domain-source-pill" title={`${s?.title || ''} · ${s?.published || ''}`} aria-label={`查看文献 ${numbers[c.sourceId]} 的来源`} onClick={()=>onSource(c.accessId,c)}><BookOpen size={15}/><span>{author ? `${author} 等` : `文献 ${numbers[c.sourceId]}`} · {s?.year || '年份未知'} · {levelNames[a?.level] || '访问未知'}</span><ArrowRight size={13}/></button>;
}
function Sources({ block, result, project, numbers, onSource }) {
  const refs=(result.citations||[]).filter(c=>c.blockId===block?.id).filter((c,i,all)=>all.findIndex(x=>x.sourceId===c.sourceId)===i);
  return <details className="domain-source-list"><summary>引文 <span>{refs.length}</span></summary><div className="domain-sources">{refs.map(c=><button key={c.sourceId} title={project.sources[c.sourceId]?.title} onClick={()=>onSource(c.accessId,c)}>[{numbers[c.sourceId]}] {project.sources[c.sourceId]?.title}</button>)}</div></details>;
}
function ResultColumn({ story, ...props }) {
  return <article className="domain-result-column domain-finding">
    <span className="domain-column-topic">{story.label}</span><h3>{story.title}</h3>
    {story.diagram.note ? <SourcePill {...props} block={story.block} note={story.diagram.note}/> : <button className="domain-source-pill" onClick={()=>props.onJump(story.block.id)}><BookOpen size={15}/><span>综合依据</span><ArrowRight size={13}/></button>}
    <ContentDiagram story={story}/>
    {!['paired','cohort','branches'].includes(story.diagram.kind)&&<div className="domain-conclusion"><CheckCircle size={18} weight="duotone"/><div><h4>核心发现</h4><p>{story.summary}</p></div></div>}
    <div className="domain-conclusion boundary"><WarningCircle size={18}/><div><h4>适用边界</h4><p>{story.boundary}</p></div></div>
    <footer><button className="domain-link" onClick={()=>props.onJump(story.block.id)}>展开论证 <ArrowRight size={16}/></button><Sources {...props} block={story.block}/></footer>
  </article>;
}
export function DomainBrief({project,artifact,onOpen,result,numbers,onJump,onSource,onCompare,disabled,onSupplement}) {
  const [spread,setSpread]=useState('main');
  const s=useMemo(()=>result?.kind==='brief'?domainStoryboard(result):null,[result]);
  if(!s)return null;
  const comparisons=Object.values(project.artifacts).filter(a=>a.kind==='questions'&&parentReference(project,a)?.artifactId===artifact.id);
  const stories=spread==='main'?s.featured:s.other;
  const props={result,project,numbers,onSource,onJump};
  const go=id=>document.getElementById(`domain-chapter-${id}`)?.scrollIntoView({behavior:'smooth',block:'start'});
  return <section className="domain-brief" aria-label="领域认识图解">
    <header className="domain-intro"><div><span className="eyebrow">领域认识 · {project.goal}</span><h1>从研究发现，理解这个领域</h1></div><button className="domain-scope-button" disabled={disabled} onClick={()=>onSupplement({focus:project.goal,expanded:true})}><MagnifyingGlass size={17}/>扩大检索范围</button></header>
    <nav className="domain-atlas-nav" aria-label="领域图解导航"><button onClick={()=>go('overview')}>研究认识</button><button onClick={()=>go('history')}>发展变化</button><button onClick={()=>go('disagreements')}>关键判断与未决</button></nav>
    <DomainChapters {...{project,result,numbers,onSource,onSupplement}} onEvidence={onJump} renderBranches={()=> <>
      <div className="domain-spread-selector"><strong>从具体研究看发现</strong><div><button aria-pressed={spread==='main'} onClick={()=>setSpread('main')}>主要研究主线</button>{s.other.length>0&&<button aria-pressed={spread==='other'} onClick={()=>setSpread('other')}>其他研究分支</button>}</div></div>
      <div className="domain-results-grid">{stories.map(story=><ResultColumn key={story.block.id} story={story} {...props}/>)}</div>
      {s.summary&&<button className="atlas-text-link" onClick={()=>onJump(s.summary.id)}>查看分支之间的联系与综合判断 <ArrowRight size={15}/></button>}
    </>}/>
    <footer className="domain-next"><details className="domain-attribution"><summary>图示与材料说明</summary><p>图解使用当前保存的报告与逐篇记录；带省略号的文字为原文节选，完整命题和条件可按节查看。关系图表示研究问题的组织，未给材料不足的历史补造转折。生物医学素材逐项许可见<a href="/api/scientific-assets/pack" download>素材包</a>；成像图为生成示意，非患者影像或研究原图。</p></details>{comparisons.length?comparisons.map(a=><button key={a.id} disabled={disabled} onClick={()=>onOpen(a.id)}>打开已有选题比较 <ArrowRight size={16}/></button>):<button disabled={disabled} onClick={onCompare}>比较可研究的问题 <ArrowRight size={16}/></button>}</footer>
  </section>;
}
