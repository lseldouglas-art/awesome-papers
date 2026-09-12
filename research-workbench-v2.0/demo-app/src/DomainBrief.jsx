import { useMemo, useState } from 'react';
import { ArrowRight, BookOpen, ClockCounterClockwise, MagnifyingGlass, CheckCircle, WarningCircle, ImageSquare, Brain, FileText, ChartBar, CaretDown } from '@phosphor-icons/react';
import { parentReference } from '../../shared/research-path.mjs';
import { displayText, resultTitle } from '../../shared/domain-presentation.mjs';
import { domainStoryboard, sentences } from '../../shared/domain-storyboard.mjs';
import { ContentDiagram, PairedFigure } from './DomainDiagrams.jsx';
import './domain-brief.css';

const views = [['results','研究认识'],['changes','发展变化'],['questions','关键判断与未决']];
const levelNames = { title:'题名', abstract:'摘要', excerpt:'正文片段', full_text:'全文文本' };
function SourcePill({ note, block, result, project, numbers, onSource }) {
  const c = (result.citations || []).find(c=>c.blockId===block?.id && (!note || c.sourceId===note.sourceId)) || (result.citations || []).find(c=>c.sourceId===note?.sourceId) || (note?.accessId ? {accessId:note.accessId,sourceId:note.sourceId} : null);
  if (!c) return null;
  const s=project.sources[c.sourceId], a=project.accesses[c.accessId], author=s?.authors?.[0]?.split(' ')[0];
  return <button className="domain-source-pill" title={`${s?.title || ''} · ${s?.published || ''}`} aria-label={`查看文献 ${numbers[c.sourceId]} 的来源`} onClick={()=>onSource(c.accessId,c)}><BookOpen size={15}/><span>{author ? `${author} 等` : `文献 ${numbers[c.sourceId]}`} · {s?.year || '年份未知'} · {levelNames[a?.level] || '访问未知'}</span><ArrowRight size={13}/></button>;
}
function Sources({ block, result, project, numbers, onSource }) {
  const refs=(result.citations||[]).filter(c=>c.blockId===block?.id).filter((c,i,all)=>all.findIndex(x=>x.sourceId===c.sourceId)===i);
  return <details className="domain-source-list"><summary>来源与完整引文 <span>{refs.length}</span></summary><div className="domain-sources">{refs.map(c=><button key={c.sourceId} title={project.sources[c.sourceId]?.title} onClick={()=>onSource(c.accessId,c)}>[{numbers[c.sourceId]}] {project.sources[c.sourceId]?.title}</button>)}</div></details>;
}
function ResultColumn({ story, ...props }) {
  return <article className="domain-result-column domain-finding">
    <span className="domain-column-topic">{story.label}</span><h3>{story.title}</h3>
    {story.diagram.note ? <SourcePill {...props} block={story.block} note={story.diagram.note}/> : <button className="domain-source-pill" onClick={()=>props.onJump(story.block.id)}><BookOpen size={15}/><span>多项研究 · 查看综合依据</span><ArrowRight size={13}/></button>}
    <ContentDiagram story={story}/>
    <div className="domain-conclusion"><CheckCircle size={18} weight="duotone"/><div><h4>核心发现</h4><p>{story.summary}</p></div></div>
    <div className="domain-conclusion boundary"><WarningCircle size={18}/><div><h4>适用边界</h4><p>{story.boundary}</p></div></div>
    <footer><button className="domain-link" onClick={()=>props.onJump(story.block.id)}>展开论证 <ArrowRight size={16}/></button><Sources {...props} block={story.block}/></footer>
  </article>;
}
function HistoryView({ storyboard:s, result, project, numbers, onSource, onJump, renderSupplement, onSupplement }) {
  const gap=s.history?.items.find(b=>b.analysisRole!=='comparison'), insufficient=s.history?.heading.dimensionCoverage==='insufficient';
  const transition=s.history?.items.map(b=>b.text?.match(/无法确定([^；。]+)/)?.[1]).find(Boolean);
  const focus=transition ? `${transition}？` : gap ? resultTitle(gap) : `${project.goal}的认识变化与代表性研究`;
  const firstNote=(result.paperNotes||[]).find(n=>project.accesses[n.accessId]?.level==='title');

  const request={focus, context:gap?.text, blockId:gap?.id};
  return <>
    <div className="domain-history-spread">
      <section className="domain-history-column"><h2>{insufficient ? '历史认识的衔接仍有缺口' : '研究认识如何发生变化'}</h2><p className="domain-subtitle">{insufficient ? '现有材料能描述当前研究，但尚未接起中间的关键转折。' : '按材料中的问题、发现与解释梳理变化。'}</p>
        <div className="domain-timeline">
          <article><span className="timeline-marker"/><BookOpen size={42} weight="duotone"/><div><span className="timeline-label">已有的早期记录</span><h3>{firstNote ? project.sources[firstNote.sourceId]?.title : '早期认识需要追溯'}</h3><p>{firstNote ? '当前仅有题名，不能据此重建当时的研究认识。' : '本次材料尚不足以描述这一阶段。'}</p>{firstNote&&<SourcePill {...{result,project,numbers,onSource}} note={firstNote}/>}</div></article>
          <article className="timeline-gap"><span className="timeline-marker"/><MagnifyingGlass size={42}/><div><span className="timeline-label">待补齐的研究衔接</span><h3>{focus}</h3><p>{gap ? sentences(gap.text)[0] : '需要能够回答该问题的历年综述与代表性研究。'}</p><button onClick={()=>document.getElementById('domain-inline-supplement')?.scrollIntoView({behavior:'smooth',block:'nearest'})}>补齐这段认识 <ArrowRight size={16}/></button></div></article>
          <article><span className="timeline-marker"/><FileText size={42} weight="duotone"/><div><span className="timeline-label">目前能够形成的认识</span><h3>{s.summary ? resultTitle(s.summary) : '当前材料中的研究发现'}</h3>{s.summary&&<Sources {...{result,project,numbers,onSource}} block={s.summary}/>}<p>需要进一步核对分支之间的历史衔接及认识转折。</p></div></article>
        </div>
        {!insufficient&&s.history?.items.map(b=><div key={b.id} className="domain-history-result"><p>{displayText(b.text)}</p><button onClick={()=>onJump(b.id)}>查看变化与依据</button></div>)}
      </section>
      <section id="domain-inline-supplement" className="domain-inline-supplement">{renderSupplement ? renderSupplement(request) : <button onClick={()=>onSupplement(request)}>补充综述与代表性研究</button>}</section>
    </div>
    <section className="domain-method-section"><h2>方法改变了什么？</h2><div className="domain-results-grid">{s.methods.map(story=><ResultColumn key={story.block.id} story={story} {...{result,project,numbers,onSource,onJump}}/>)}</div></section>
    <details className="domain-more-content"><summary>研究走到了哪里 <CaretDown size={16}/></summary>{s.items('maturity').map(b=><div key={b.id}><h3>{resultTitle(b)}</h3><p>{displayText(b.text)}</p><button onClick={()=>onJump(b.id)}>展开论证</button></div>)}</details>
  </>;
}
function QuestionView({ storyboard:s, result, project, numbers, onSource, onJump, onSupplement }) {
  const [selected,setSelected]=useState('spotlight');
  const focus=s.focus, block=s.questions.find(b=>b.id===selected), chosen=block||(!focus?s.questions[0]:null);
  const focusBlock=(result.blocks||[]).find(b=>b.text?.includes('LCI研究自述观察顺序固定')) || s.questions.find(b=>b.text?.includes('LCI'));
  const specificRequest=focus ? {focus:focus.question,context:focus.note.fields.findings.text,blockId:focusBlock?.id} : {focus:resultTitle(chosen),context:chosen?.text,blockId:chosen?.id};
  return <>
    <div className="domain-question-selector"><span>正在展开</span><select aria-label="选择关键判断与未决问题" value={chosen?.id||'spotlight'} onChange={e=>setSelected(e.target.value)}>{focus&&<option value="spotlight">LCI 误报减少：成像与观察顺序</option>}{s.questions.map(b=><option value={b.id} key={b.id}>{resultTitle(b)}</option>)}</select></div>
    <h2 className="domain-question-title">{chosen ? resultTitle(chosen) : focus?.question || '当前尚待回答的问题'}</h2>
    {focus&&!chosen ? <div className="domain-question-spread">
      <section><h3>研究实际观察到了什么</h3><SourcePill {...{result,project,numbers,onSource}} note={focus.note} block={focusBlock}/><p className="domain-study-description">{focus.methods}。</p><PairedFigure observation={focus} detailed/><div className="domain-answer-band"><CheckCircle size={23} weight="fill"/><strong>{focus.finding}。</strong></div><p className="domain-small-note">期刊标年：{project.sources[focus.note.sourceId]?.year}；具体发表日期以来源记录为准。</p></section>
      <section><h3>为什么还不能直接归因</h3><p className="domain-subtitle">两种作用尚未被研究设计分开</p><div className="domain-explanations">
        <div className="explanation"><ImageSquare size={35}/><div><h4>成像方式的影响</h4><p>LCI 增强黏膜与血管对比，可能有助于辨认病灶。</p></div></div>
        <div className="explanation is-uncertain"><Brain size={35}/><div><h4>再次观察的影响</h4><p>同一次检查中，LCI 总在 WLI 之后；先后顺序的影响尚未单独验证。</p></div></div>
        <div className="explanation-outcome"><ArrowRight size={21}/><strong>误报减少</strong><span>贡献尚未分开</span></div>
      </div><div className="domain-caution"><WarningCircle size={22} weight="fill"/><div><strong>{focus.boundary}</strong><p>当前结果不能单独确定减少的误报由哪一种作用造成。</p></div></div><div className="domain-evidence-note"><ChartBar size={21}/><span>{focus.methods.split('，')[0]} · 结论限于该研究情境</span></div><button className="domain-link" onClick={()=>focusBlock&&onJump(focusBlock.id)}>展开完整论证 <ArrowRight size={16}/></button></section>
    </div> : chosen ? <div className="domain-question-spread"><section><h3>当前研究判断</h3>{sentences(chosen.text).map((t,i)=><p key={i} className="domain-study-description">{t}</p>)}<Sources {...{result,project,numbers,onSource}} block={chosen}/></section><section><h3>需要继续回答什么</h3><div className="domain-caution"><WarningCircle size={25}/><p>{chosen.text.match(/(?:可检验问题|候选问题)：([^。]+)/)?.[1]||s.section('disagreements')?.heading.dimensionLimitation||'需要围绕该具体命题补充可比较的材料。'}</p></div><button onClick={()=>onJump(chosen.id)}>展开论证</button></section></div> : null}
    <section className="domain-question-next"><h2>下一步，找能回答这个问题的材料</h2><div><BookOpen size={32}/><div><h3>{focus&&!chosen?'先查前瞻性或平衡观察顺序的研究':'补充相关综述与代表性研究'}</h3><p>{focus&&!chosen?'核对改变观察顺序后，误报差异是否仍存在。':'结合新的材料，检查当前判断与解释。'}</p></div><button onClick={()=>onSupplement({...specificRequest,kinds:['代表性原始研究','后续验证与长期随访']})}>补检验证研究 <ArrowRight size={16}/></button><div><h3>核对不同场景中的结果</h3><p>补充外部验证，查看结论的适用范围。</p></div><button onClick={()=>onSupplement({...specificRequest,focus:`${specificRequest.focus} 外部验证与适用范围`,expanded:true})}>查找外部验证 <ArrowRight size={16}/></button></div></section>
  </>;
}
export function DomainBrief({ project,artifact,onOpen,result,numbers,onJump,onSource,onCompare,disabled,onSupplement,renderSupplement }) {
  const [view,setView]=useState('results'),[spread,setSpread]=useState('main');
  const s=useMemo(()=>result?.kind==='brief'?domainStoryboard(result):null,[result]);
  if(!s) return null;
  const comparisons=Object.values(project.artifacts).filter(a=>a.kind==='questions'&&parentReference(project,a)?.artifactId===artifact.id);
  const stories=spread==='main'?s.featured:spread==='hotspots'?s.hotspots:s.other;
  const title=view==='results'?'从研究发现，理解这个领域':view==='changes'?'把缺失的研究认识接起来':'看清研究结果，还有哪些问题未决';
  const props={result,project,numbers,onSource,onJump};
  return <section className="domain-brief" aria-label="领域认识图解">
    <header className={`domain-intro ${view === 'questions' ? 'is-question-view' : ''}`}><div><span className="eyebrow">领域认识 · {project.goal}</span><h1>{title}</h1></div><button className="domain-scope-button" disabled={disabled} onClick={()=>onSupplement({focus:project.goal,expanded:true})}><MagnifyingGlass size={17}/>扩大检索范围</button></header>
    <div className="domain-tabs" role="tablist" aria-label="领域图解视图">{views.map(([id,label],i)=><button key={id} role="tab" id={`domain-tab-${id}`} aria-controls={`domain-panel-${id}`} aria-selected={id===view} tabIndex={id===view?0:-1} onClick={()=>setView(id)} onKeyDown={e=>{if(!['ArrowRight','ArrowLeft','Home','End'].includes(e.key))return;e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3;setView(views[n][0]);requestAnimationFrame(()=>document.getElementById(`domain-tab-${views[n][0]}`)?.focus());}}>{label}</button>)}</div>
    <div role="tabpanel" id={`domain-panel-${view}`} aria-labelledby={`domain-tab-${view}`}>
      {view==='results'&&<><div className="domain-spread-selector"><strong>本轮形成的研究认识</strong><div><button aria-pressed={spread==='main'} onClick={()=>setSpread('main')}>主要研究主线</button>{s.other.length>0&&<button aria-pressed={spread==='other'} onClick={()=>setSpread('other')}>其他研究分支</button>}{s.hotspots.length>0&&<button aria-pressed={spread==='hotspots'} onClick={()=>setSpread('hotspots')}>值得关注的研究</button>}</div></div>
      <div className="domain-results-grid">{stories.map(story=><ResultColumn key={story.block.id} story={story} {...props}/>)}</div>
      {s.summary&&<div className="domain-takeaway"><BookOpen size={43} weight="duotone"/><div><h3>这些发现，怎样改变我们对领域的理解？</h3><p>{resultTitle(s.summary)}</p><button className="domain-link" onClick={()=>onJump(s.summary.id)}>展开解释与依据 <ArrowRight size={15}/></button></div><button className="primary" disabled={disabled} onClick={()=>setView('changes')}>按内容缺口补材料 <ArrowRight size={17}/></button></div>}</>}
      {view==='changes'&&<HistoryView storyboard={s} {...props} {...{renderSupplement,onSupplement}}/>}
      {view==='questions'&&<QuestionView storyboard={s} {...props} onSupplement={onSupplement}/>}
    </div>
    <footer className="domain-next"><details className="domain-attribution"><summary>图示与材料说明</summary><p>图解使用当前保存的报告与逐篇记录。生物医学素材来自Servier / Bioicons，逐项许可见<a href="/api/scientific-assets/pack" download>素材包</a>；成像屏幕为生成示意，非患者影像或研究原图。数字按实际材料绘制，不代表领域热度。</p></details>{comparisons.length?comparisons.map(a=><button key={a.id} disabled={disabled} onClick={()=>onOpen(a.id)}>打开已有选题比较 <ArrowRight size={16}/></button>):<button disabled={disabled} onClick={onCompare}>比较可研究的问题 <ArrowRight size={16}/></button>}</footer>
  </section>;
}
