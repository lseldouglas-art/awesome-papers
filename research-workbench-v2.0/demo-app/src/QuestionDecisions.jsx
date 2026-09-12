import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { StarIcon, PushPinIcon, WarningCircleIcon, BooksIcon, ArrowRightIcon, ArrowsHorizontalIcon, FlagIcon, UserIcon, InfoIcon } from '@phosphor-icons/react';
import { assessmentFor, decisionTemplates, estimateText } from '../../shared/question-assessment.mjs';
import { concise } from '../../shared/research-guidance.mjs';
import { levels } from './ui.jsx';
import './question-decisions.css';

const durationFor = a => a.estimates.find(e=>e.unit==='个月');
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
function Evidence({ question:q, project, numbers={}, onSource }) {
  const unique=[...new Map((q.evidence??[]).map(e=>[e.accessId,e])).values()];
  return <section className="decision-evidence" aria-label="本题判断依据"><BooksIcon size={23} aria-hidden="true"/><strong>判断依据</strong><div>{unique.length?unique.map((e,i)=>{const a=project?.accesses?.[e.accessId],s=project?.sources?.[a?.sourceId];return <button key={e.accessId||i} disabled={!onSource||!a} onClick={()=>onSource(e.accessId,e)} title={s?.title}>{numbers[s?.id]?`[${numbers[s.id]}] `:''}{concise(s?.title||e.interpretation||`来源 ${i+1}`,22)}<small>{levels[a?.level]||'访问范围未知'}</small></button>;}):<span>尚无可定位来源，当前内容为规划假设。</span>}</div></section>;
}
function FullAssessment({ question:q, assessment:a }) {
  return <details className="decision-full-record"><summary>完整判断与预估依据</summary><p><b>可行性：</b>{a.feasibility}</p><p><b>潜在创新：</b>{a.innovation}</p><p><b>投入价值：</b>{a.value}</p><p><b>难度理由：</b>{a.difficulty.rationale}</p><p><b>难度假设：</b>{a.difficulty.assumptions.join('；')}</p>{a.estimates.filter(e=>e.unit!=='小时/周').map((e,i)=><section key={i}><h4>{e.label} · {estimateText(e)}</h4><p><b>假设：</b>{e.assumptions.join('；')}</p><p><b>估算依据：</b>{e.basis}</p><p><b>可能变化：</b>{e.sensitivity}</p></section>)}<ul>{a.risks.map((risk,i)=><li key={i}>{risk}</li>)}</ul>{q.assessmentNeedsReview&&<p>本题已修订，原判断仍在旧版本中保存。</p>}</details>;
}
function Focus({ question:q, assessment:a, pinned, onPin, reading }) {
  const focus=a.focus, checks=(focus?.nextChecks??(q.unknowns??[]).map(v=>typeof v==='string'?v:v.text)).filter(v=>v&&v!==a.risks[0]);
  const next=checks.length?checks.slice(0,2):[a.difficulty.assumptions[0],durationFor(a).sensitivity];
  return <section className="decision-focus" aria-label="本题的研究切口"><header><h3>本题的研究切口</h3><button aria-pressed={pinned} onClick={onPin}><PushPinIcon size={17} weight={pinned?'fill':'regular'} aria-hidden="true"/>{pinned?'取消固定':'固定预览'}</button></header>
    {reading?<><h4>研究价值与依据</h4><p>{concise(q.rationale||a.summary,180)}</p></>:focus?.axes?<div className="decision-axes"><div title={focus.axes[0].description}><strong>{focus.axes[0].label}</strong><small>{focus.axes[0].description}</small></div><span><small>{focus.relation}</small><ArrowsHorizontalIcon size={34} aria-hidden="true"/></span><div title={focus.axes[1].description}><strong>{focus.axes[1].label}</strong><small>{focus.axes[1].description}</small></div></div>:<span className="decision-focus-label">待回答的问题</span>}
    <p className="decision-focus-question">{focus?.question||q.text||q.question}</p>
    <div className="decision-checks"><h4>下一步核查</h4><ul>{next.map((check,i)=><li key={i}>{concise(check,100)}</li>)}</ul></div>
    <p className="decision-hover-hint"><InfoIcon size={17} aria-hidden="true"/>{pinned?'已固定本题；取消后可悬停切换。':'悬停选题切换分析；点击固定，键盘聚焦也可查看。'}</p>
  </section>;
}
export function QuestionDecisions({ questions, project, numbers, onSource, onDeepen, disabled, renderDetails }) {
  const [activeId,setActiveId]=useState(null),[pinned,setPinned]=useState(false),[override,setOverride]=useState('comparison');
  const timer=useRef(null),pinRef=useRef(pinned),id=useId();pinRef.current=pinned;
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  const rows=useMemo(()=>questions.map(q=>({q,a:assessmentFor(q)})),[questions]);
  if(!rows.length)return null;
  const active=rows.find(r=>r.q.id===activeId)??rows[0],{q,a}=active;
  const layout=override||(rows.length>1?'comparison':rows[0].a.presentation.template),reading=layout==='reading',chart=['comparison','timeline'].includes(layout);
  const cancel=()=>clearTimeout(timer.current);
  const preview=question=>{if(!pinRef.current)setActiveId(question.id);};
  const toggle=question=>{cancel();setActiveId(question.id);setPinned(!(active.q.id===question.id&&pinned));};
  const rowEvents=question=>({onPointerEnter:e=>{if(e.pointerType==='mouse'){cancel();timer.current=setTimeout(()=>preview(question),320);}},onPointerLeave:cancel,onFocus:()=>{cancel();preview(question);}});
  const focus=<Focus key={q.id} question={q} assessment={a} pinned={pinned} onPin={()=>toggle(q)} reading={reading||layout==='brief'}/>;
  return <section className={`question-decisions decisions-${layout}`} aria-label="选题价值与投入判断" onKeyDown={e=>{if(e.key==='Escape'){cancel();setPinned(false);}}}>
    <div className="decision-body"><div className="decision-left">
      <header className="decision-heading"><h2>{rows.length>1?'候选选题比较':'选题价值与实施条件'}</h2></header>
      <div className="decision-view-controls"><p className="decision-mode-intro">研究价值、可行性与实施难度</p><div role="group" aria-label="选题展示方式"><button aria-pressed={override==='comparison'} onClick={()=>setOverride('comparison')}>图表版</button><button aria-pressed={reading} onClick={()=>setOverride('reading')}>文字版</button></div><select aria-label="选题表达模板" value={override==='reading'?'reading':override} onChange={e=>setOverride(e.target.value)}><option value="">按内容选择</option>{Object.entries(decisionTemplates).map(([key,v])=><option value={key} key={key}>{v.name}</option>)}</select></div>
      <div className="decision-resource"><UserIcon size={21} aria-hidden="true"/><span><b>{originLabel(a)}：</b>{concise(a.difficulty.assumptions[0],66)}</span></div>
      <div className="decision-topic-list"><div className="decision-table-head"><span>研究方向与判断</span><span>难度</span>{reading&&<span>周期（月）</span>}</div>
        {rows.map(({q:topic,a:assessment})=><article className={`decision-topic ${active.q.id===topic.id?'is-preview':''}`} key={`${topic.id}:${topic.revisionId}`} {...rowEvents(topic)}>
          <div className="decision-topic-main"><button className="decision-topic-title" id={`${id}-${topic.id}`} aria-controls={`${id}-preview`} aria-pressed={active.q.id===topic.id} onClick={()=>toggle(topic)} onKeyDown={e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();cancel();const index=rows.findIndex(r=>r.q.id===topic.id),next=rows[(index+(e.key==='ArrowDown'?1:rows.length-1))%rows.length].q;document.getElementById(`${id}-${next.id}`)?.focus();}}}>{topic.title||concise(topic.text,50)}{topic.isAdopted&&<small>当前采用</small>}</button><Judgments assessment={assessment}/></div>
          <div className="decision-topic-difficulty"><Difficulty difficulty={assessment.difficulty}/><small>{assessment.difficulty.origin==='scenario'?'情景估计':'条件估计'}</small></div>{reading&&<div className="decision-topic-months">{assessment.estimates.filter(e=>e.unit==='个月').map((e,i)=><span key={i}>{i>0&&<small>{e.label}</small>}<strong>{e.min===e.max?e.min:`${e.min}–${e.max}`}</strong></span>)}</div>}
          {layout==='accordion'&&active.q.id===topic.id&&<div className="decision-inline-focus" id={`${id}-preview`}>{focus}<div className="decision-alternate-months"><h4>预估周期（月）</h4><p>{durationFor(assessment).min}–{durationFor(assessment).max}</p></div></div>}
        </article>)}
      </div>
      <p className="decision-difficulty-note">难度按资源条件估计：1 星低 → 5 星高；不代表研究质量或成功概率。</p>
      <section className="decision-obstacle"><WarningCircleIcon size={24} aria-hidden="true"/><strong>关键障碍</strong><p>{concise(a.risks[0],120)}</p></section>
      <Evidence question={q} project={project} numbers={numbers} onSource={onSource}/>
    </div>
    {layout!=='accordion'&&<aside id={`${id}-preview`} className="decision-preview" aria-label="当前选题分析">{chart&&<DurationChart rows={rows} activeId={q.id} onSelect={toggle}/>}<div className="decision-active-name">{q.title||concise(q.text,44)}</div>{focus}{!chart&&!reading&&<div className="decision-alternate-months"><h4>预估周期（月）</h4>{a.estimates.filter(e=>e.unit==='个月').map((e,i)=><p key={i}><b>{e.label}：</b>{e.min}–{e.max}</p>)}</div>}</aside>}
    </div>
    <div className="decision-next"><FlagIcon size={25} aria-hidden="true"/><span>关键条件核查与研究设计</span>{onDeepen&&<button className="primary" disabled={disabled} onClick={()=>onDeepen(q)}>继续论证这个方向<ArrowRightIcon size={19} aria-hidden="true"/></button>}</div>
    <FullAssessment key={`full-${q.id}`} question={q} assessment={a}/>{renderDetails?.(q)}
  </section>;
}
