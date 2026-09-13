import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PushPinIcon, XIcon, ArrowRightIcon } from '@phosphor-icons/react';
import { analysisDimensions, questionAnalysisFor } from '../../shared/question-analysis.mjs';
import { estimateText } from '../../shared/question-assessment.mjs';
import { levels } from './ui.jsx';
import './topic-analysis.css';

const groups=[['fit','可行性与适合度'],['value','研究价值'],['route','设计与证据']];
const statuses={inference:'据材料推论',planning:'规划判断',unknown:'尚待查清'};
function Sources({statements,project,numbers,onSource}) {
  return statements.map((s,i)=><details className="topic-statement" key={i}><summary>{s.role==='conflicting'?'限制或不同依据':'支持依据'} · {s.text}</summary><p>原记录标注：{s.status==='reported'?'材料报告':'综合推论'}；定位原文不等于已经核验判断。</p>{s.citations?.map((c,j)=>{const access=project?.accesses?.[c.accessId],source=project?.sources?.[access?.sourceId];return <div key={j}><button disabled={!access||!onSource} onClick={()=>onSource(c.accessId,c)}>[{numbers?.[source?.id]??'?'}] {source?.title??'来源待核查'} · {levels[access?.level]??'访问范围未知'}</button><blockquote>{c.quote??'原文摘录未保存在该条记录中。'}</blockquote></div>;})}</details>);
}
export function TopicAnalysis({id,question:q,assessment:a,anchor,pinned,onPin,onClose,onEnter,onLeave,project,numbers,onSource,onDeepen,onAnalyze,disabled,renderDetails,children}) {
  const ref=useRef(null),content=useRef(null),[tab,setTab]=useState('fit'),[position,setPosition]=useState(null),titleId=useId(),closeRef=useRef(onClose);
  closeRef.current=onClose;
  const analysis=useMemo(()=>questionAnalysisFor(q,a),[q,a]);
  useLayoutEffect(()=>{
    const place=()=>{if(!anchor?.isConnected){closeRef.current();return;}const rect=anchor.getBoundingClientRect(),vw=window.innerWidth,vh=window.innerHeight,width=Math.min(700,vw-24),height=Math.min(680,vh-32);
      const left=vw<720?12:Math.max(12,Math.min(rect.left+Math.min(rect.width*.25,130),vw-width-12));
      const top=vw<720?16:Math.max(16,Math.min(rect.bottom+10,vh-height-16));
      setPosition({left,top,width,maxHeight:height});};
    place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[anchor]);
  useEffect(()=>{if(pinned)ref.current?.focus({preventScroll:true});},[pinned]);
  useEffect(()=>{
    const outside=e=>{if(!ref.current?.contains(e.target)&&!e.target.closest('.decision-topic'))closeRef.current();};
    const key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeRef.current(true);}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);};
  },[]);
  const known=typeof q.feasibility==='object'?q.feasibility.known??[]:[],unknown=typeof q.feasibility==='object'?q.feasibility.unknown??[]:[];
  return createPortal(<aside ref={ref} id={id} tabIndex={-1} role="dialog" aria-modal="false" aria-labelledby={titleId} className="topic-analysis-popover question-decisions" style={position??{visibility:'hidden'}} onPointerEnter={onEnter} onPointerLeave={onLeave} onFocusCapture={onEnter} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))onLeave();}}>
    <header className="topic-analysis-heading"><div><small>本题独立分析 · 第 {q.version??1} 版</small><h2 id={titleId}>{q.title||q.text}</h2></div><button aria-label={pinned?'取消固定本题':'固定本题分析'} aria-pressed={pinned} onClick={onPin}><PushPinIcon weight={pinned?'fill':'regular'} size={20}/></button><button aria-label="关闭本题分析" onClick={()=>onClose(true)}><XIcon size={20}/></button></header>
    <nav className="topic-analysis-tabs" aria-label="本题分析维度">{groups.map(([key,label])=><button key={key} aria-pressed={tab===key} onClick={()=>{setTab(key);content.current?.scrollTo({top:0});}}>{label}</button>)}</nav>
    <div className="topic-analysis-content" ref={content}>
      <p className="topic-analysis-question">{q.text}</p>
      {q.scope&&<details className="topic-scope"><summary>研究对象与边界</summary><p>{q.scope}</p></details>}
      {onAnalyze&&<div className="topic-reanalyze"><button disabled={disabled} onClick={()=>onAnalyze(q)}>与科研搭档核查本题</button><small>保留题目画布，在侧栏讨论、补查与修订判断。</small></div>}
      {analysis[0]?.origin!=='analysis'&&<p className="topic-record-note">{analysis[0]?.origin==='stale'?'问题已修订，先核对旧依据与新范围；以下旧字段不能视为新结论。':'按本题已保存的理由、设计与条件展开；本版缺失的论证保留为待补。'}</p>}
      {tab==='fit'&&<><div className="topic-conditions"><section><h3>你已说明的条件</h3>{known.length?<ul>{known.map((x,i)=><li key={i}>{x}</li>)}</ul>:<p>尚未记录，不能推定已有资源。</p>}</section><section><h3>本题仍需确认</h3>{unknown.length?<ul>{unknown.map((x,i)=><li key={i}>{x}</li>)}</ul>:<p>尚未列出；不表示所有条件已满足。</p>}</section></div><details className="topic-estimates"><summary>至初稿：{a.estimates.filter(e=>e.unit==='个月').map(estimateText).join(' / ')} · 规划假设</summary>{a.estimates.map((e,i)=><section key={i}><h3>{e.label} · {estimateText(e)}</h3><p>{e.assumptions.join('；')}</p><p>估算依据：{e.basis}</p><p>变化因素：{e.sensitivity}</p></section>)}</details></>}
      {analysisDimensions.filter(d=>d.group===tab).map(d=>{const v=analysis.find(v=>v.key===d.key);return <section className="topic-analysis-dimension" key={d.key}><div><h3>{d.label}</h3><small>{v.missing?'尚待补全':v.origin==='analysis'?statuses[v.basis]:'本题已存记录'}</small></div><h4>{v.judgment}</h4>{v.reviewReason&&<p className="muted">{v.reviewReason}</p>}<p>{v.reasoning}</p>{v.checks.length>0&&<details><summary>{v.origin==='analysis'?'下一项核查':'相关条件与待核查项'} · {v.checks.length}</summary><ul>{v.checks.map((x,i)=><li key={i}>{x}</li>)}</ul></details>}<Sources statements={v.statements} project={project} numbers={numbers} onSource={onSource}/></section>;})}
      {tab==='route'&&<><h3>本题完整依据</h3><Sources statements={[...(q.supporting??[]).map(s=>({...s,role:'supporting'})),...(q.conflicting??[]).map(s=>({...s,role:'conflicting'}))]} project={project} numbers={numbers} onSource={onSource}/>{!q.supporting?.length&&!q.conflicting?.length&&<p>本版没有已定位的支持或限制依据。</p>}{children}{renderDetails?.(q)}</>}
    </div><footer className="topic-analysis-footer"><small>{pinned?'已固定；取消固定后可悬停换题。':'悬停预览 · 点击图钉可固定阅读。'}</small>{onDeepen&&<button className="primary" disabled={disabled} onClick={()=>onDeepen(q)}>继续论证本题<ArrowRightIcon size={18}/></button>}</footer>
  </aside>,document.body);
}
