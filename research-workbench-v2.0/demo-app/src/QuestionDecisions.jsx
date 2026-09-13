import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { TopicAnalysis } from './TopicAnalysis.jsx';
import { StarIcon } from '@phosphor-icons/react';
import { assessmentFor, estimateText } from '../../shared/question-assessment.mjs';
import { concise } from '../../shared/research-guidance.mjs';
import './question-decisions.css';

const originLabel = a => a.origin==='scenario' ? '起始规划假设' : a.difficulty?.origin==='scenario' ? '原周期预估 · 难度按情景估计' : '本题规划预估';
function Difficulty({ difficulty:d }) {
  return <span className="decision-stars" role="img" aria-label={`执行难度 ${d.level} / 5 星。${d.rationale}`} title={`${d.rationale}；假设：${d.assumptions.join('；')}`}>
    {Array.from({length:5},(_,i)=><StarIcon key={i} size={25} weight={i<d.level?'fill':'regular'} aria-hidden="true"/>)}
  </span>;
}
function Judgments({ assessment:a }) {
  return <dl className="decision-judgments">{[['可行性',a.feasibility],['潜在创新',a.innovation],['投入价值',a.value]].map(([label,value])=><div key={label}><dt>{label}</dt><dd title={value}>{concise(value,48)}</dd></div>)}</dl>;
}
function DurationChart({ rows, activeId, onSelect }) {
  const canvas=useRef(null), chart=useRef(null), select=useRef(onSelect);
  select.current=onSelect;
  const entries=useMemo(()=>rows.flatMap(({q,a})=>a.estimates.filter(e=>e.unit==='个月').map((e,i)=>({q,a,e,label:concise(q.title||q.text,13)+(i?` · ${e.label}`:'')}))),[rows]);
  useEffect(()=>{
    const max=Math.max(...entries.map(r=>r.e.max)), step=Math.max(1,Math.ceil(max/5)), ceiling=Math.ceil(max/step)*step;
    const rangeLabels={id:'rangeLabels',afterDatasetsDraw(c){const {ctx,chartArea}=c;ctx.save();ctx.font='500 14px -apple-system, "PingFang SC", sans-serif';ctx.textBaseline='bottom';c.getDatasetMeta(0).data.forEach((bar,i)=>{const e=entries[i].e;ctx.fillStyle=entries[i].q.id===activeId?'#075e53':'#495769';ctx.textAlign='right';const end=c.scales.x.getPixelForValue(e.max);ctx.fillText(e.min===e.max?`${e.min}`:`${e.min}–${e.max}`,Math.min(chartArea.right,Math.max(end,chartArea.left+48)),bar.y-10);});ctx.restore();}};
    let disposed=false;
    import('chart.js').then(({Chart,BarController,BarElement,LinearScale,CategoryScale,Tooltip})=>{
    if(disposed)return;
    Chart.register(BarController,BarElement,LinearScale,CategoryScale,Tooltip);
    chart.current=new Chart(canvas.current,{type:'bar',data:{labels:entries.map(r=>r.label),datasets:[{data:entries.map(r=>[r.e.min,r.e.max]),backgroundColor:entries.map(r=>r.q.id===activeId?'#126b5e':'#95c5b6'),borderColor:entries.map(r=>r.q.id===activeId?'#075e53':'#74ae9c'),borderWidth:1,borderSkipped:false,borderRadius:8,barThickness:10,minBarLength:3}]},plugins:[rangeLabels],options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,animation:false,layout:{padding:{top:15,right:4}},plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${estimateText(entries[c.dataIndex].e)} · ${originLabel(entries[c.dataIndex].a)}`}}},scales:{x:{min:0,max:ceiling,ticks:{stepSize:step,color:'#697688',font:{size:12}},grid:{color:'#e8ecee'},border:{color:'#cdd7dc'},title:{display:true,text:'时间（月）',color:'#697688'}},y:{ticks:{color:'#405366',font:{size:13},autoSkip:false},grid:{display:false},border:{display:false}}},onClick:(event,elements)=>{if(elements[0])select.current(entries[elements[0].index].q);}}});
    });
    return ()=>{disposed=true;chart.current?.destroy();};
  },[entries,activeId]);
  return <section className="decision-duration" aria-label="预估周期图"><h3>预估周期（月）</h3><p>至初稿 · 条件区间，不含审稿</p><div className="decision-chart" style={{height:Math.max(200,entries.length*66+68)}}><canvas ref={canvas} role="img" aria-label={entries.map(r=>`${r.q.title||r.q.text}，${r.e.label}：${estimateText(r.e)}，${originLabel(r.a)}`).join('；')}/></div></section>;
}
function FullAssessment({ question:q, assessment:a }) {
  return <details className="decision-full-record"><summary>完整判断与预估依据</summary><p><b>可行性：</b>{a.feasibility}</p><p><b>潜在创新：</b>{a.innovation}</p><p><b>投入价值：</b>{a.value}</p><p><b>难度理由：</b>{a.difficulty.rationale}</p><p><b>难度假设：</b>{a.difficulty.assumptions.join('；')}</p>{a.estimates.filter(e=>e.unit!=='小时/周').map((e,i)=><section key={i}><h4>{e.label} · {estimateText(e)}</h4><p><b>假设：</b>{e.assumptions.join('；')}</p><p><b>估算依据：</b>{e.basis}</p><p><b>可能变化：</b>{e.sensitivity}</p></section>)}<ul>{a.risks.map((risk,i)=><li key={i}>{risk}</li>)}</ul>{q.assessmentNeedsReview&&<p>本题已修订，原判断仍在旧版本中保存。</p>}</details>;
}
export function QuestionDecisions({ questions, project, numbers, onSource, onDeepen, onAnalyze, disabled, renderDetails }) {
  const [active,setActive]=useState(null),[pinned,setPinned]=useState(false),[reading,setReading]=useState(false);
  const timer=useRef(null),closeTimer=useRef(null),anchors=useRef(new Map()),blockedFocus=useRef(false),suppressed=useRef(null),id=useId();
  const rows=useMemo(()=>questions.map(q=>({q,a:assessmentFor(q)})),[questions]);
  // The revision is part of the identity: edits must not keep a stale analysis open.
  const selected=rows.find(r=>r.q.id===active?.id && r.q.revisionId===active?.revisionId);
  useEffect(()=>{if(active&&!selected){setActive(null);setPinned(false);}},[active,selected]);
  const cancel=()=>{clearTimeout(timer.current);clearTimeout(closeTimer.current);};
  useEffect(()=>()=>{clearTimeout(timer.current);clearTimeout(closeTimer.current);},[]);
  const close=(restore=false)=>{cancel();suppressed.current=active?.id;setActive(null);setPinned(false);if(restore){blockedFocus.current=true;anchors.current.get(active?.id)?.focus({preventScroll:true});queueMicrotask(()=>{blockedFocus.current=false;});}};
  const open=(q,lock=false)=>{cancel();if(lock||!pinned){setActive({id:q.id,revisionId:q.revisionId});setPinned(lock);}};
  const leave=()=>{clearTimeout(timer.current);if(!pinned)closeTimer.current=setTimeout(()=>{if(!document.activeElement?.closest('.topic-analysis-popover'))close();},250);};
  const source=(accessId,evidence)=>{close();onSource?.(accessId,evidence);};
  if(!rows.length)return null;
  return <section className={`question-decisions decisions-owned ${reading?'decisions-reading':''}`} aria-label="选题价值与投入判断">
    <header className="decision-heading"><h2>{rows.length>1?'候选选题比较':'选题价值与实施条件'}</h2></header>
    <div className="decision-view-controls"><p className="decision-mode-intro">逐题判断研究价值与个人适合度</p><div role="group" aria-label="选题展示方式"><button aria-pressed={!reading} onClick={()=>{close();setReading(false);}}>图表版</button><button aria-pressed={reading} onClick={()=>{close();setReading(true);}}>文字版</button></div></div>
    <p className="decision-hover-guide">悬停题目查看本题分析；点击固定阅读，也可用键盘或触屏打开。</p>
    <div className="decision-body"><div className="decision-left"><div className="decision-topic-list">
      <div className="decision-table-head"><span>具体选题 · 独立判断</span><span>执行难度</span>{reading&&<span>月</span>}</div>
      {rows.map(({q,a},index)=><article className={`decision-topic ${selected?.q.id===q.id?'is-preview':''}`} key={`${q.id}:${q.revisionId}`} onPointerEnter={e=>{if(e.pointerType==='mouse'&&!pinned&&suppressed.current!==q.id){cancel();timer.current=setTimeout(()=>open(q),300);}}} onPointerLeave={()=>{if(suppressed.current===q.id)suppressed.current=null;leave();}}>
        <div className="decision-topic-main"><button className="decision-topic-title" ref={el=>{if(el)anchors.current.set(q.id,el);else anchors.current.delete(q.id);}} id={`${id}-${q.id}`} aria-haspopup="dialog" aria-expanded={selected?.q.id===q.id} aria-controls={selected?.q.id===q.id?`${id}-analysis`:undefined} onFocus={()=>{if(!blockedFocus.current)open(q);}} onClick={()=>open(q,true)} onKeyDown={e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();anchors.current.get(rows[(index+(e.key==='ArrowDown'?1:rows.length-1))%rows.length].q.id)?.focus();}if(e.key==='Escape')close();}}>{q.title||concise(q.text,60)}{q.isAdopted&&<small>当前采用</small>}</button>
        <p className="decision-core-question">{concise(q.text,100)}</p><Judgments assessment={a}/><button className="decision-analysis-trigger" onClick={()=>open(q,true)}>查看本题的完整分析 ↗</button></div>
        <div className="decision-topic-difficulty"><Difficulty difficulty={a.difficulty}/><small>{a.difficulty.origin==='scenario'?'情景估计':'条件估计'}</small></div>{reading&&<div className="decision-topic-months">{a.estimates.filter(e=>e.unit==='个月').map((e,i)=><strong key={i}>{e.min}–{e.max}</strong>)}</div>}
      </article>)}
    </div><p className="decision-difficulty-note">星级与周期均以各题资源假设为前提；个人条件在本题分析中核查。</p></div>
    {!reading&&<aside className="decision-preview" aria-label="各题周期比较"><DurationChart rows={rows} activeId={selected?.q.id} onSelect={q=>open(q,true)}/><p className="decision-chart-note">这里只比较规划周期。各题的依据、适合度与下一步，随题目分别展开。</p></aside>}
    </div>
    {selected&&<TopicAnalysis key={`${selected.q.id}:${selected.q.revisionId}`} id={`${id}-analysis`} question={selected.q} assessment={selected.a} anchor={anchors.current.get(selected.q.id)} pinned={pinned} onPin={()=>setPinned(v=>!v)} onClose={close} onEnter={cancel} onLeave={leave} disabled={disabled} onAnalyze={onAnalyze?q=>{close();onAnalyze(q);}:undefined} onDeepen={q=>{close();onDeepen?.(q);}} project={project} numbers={numbers} onSource={source} renderDetails={renderDetails}>
      <FullAssessment question={selected.q} assessment={selected.a}/>
    </TopicAnalysis>}
  </section>;
}
