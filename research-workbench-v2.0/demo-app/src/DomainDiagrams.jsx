import { useEffect, useRef } from 'react';
import { ArrowRight, UsersThree, BookOpen, Microscope } from '@phosphor-icons/react';

function MiniBars({ observation }) {
  const ref = useRef();
  useEffect(() => {
    let chart, cancelled = false;
    import('chart.js/auto').then(({ default:Chart }) => {
      if (cancelled) return;
      chart = new Chart(ref.current, {
        type:'bar',
        data:{labels:observation.labels,datasets:[{data:observation.values,backgroundColor:['#709b90','#175e54'],borderRadius:3,barThickness:14}]},
        plugins:[{id:'domainValues',afterDatasetsDraw(chart){
          const ctx=chart.ctx;ctx.save();ctx.font='600 13px sans-serif';ctx.fillStyle='#175e54';ctx.textBaseline='middle';
          chart.getDatasetMeta(0).data.forEach((bar,i)=>ctx.fillText(`${observation.values[i]} ${observation.unit}`,bar.x+7,bar.y));ctx.restore();
        }}],
        options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,animation:false,
          plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${observation.metric}：${ctx.raw} ${observation.unit}`}}},
          scales:{x:{beginAtZero:true,suggestedMax:Math.max(...observation.values)*1.25,ticks:{precision:0,color:'#718580',font:{size:10}},grid:{color:'#e2ebe6'},border:{display:false}},y:{ticks:{color:'#28524a',font:{size:12}},grid:{display:false},border:{display:false}}}
        }
      });
      ref.current.dataset.chartReady = 'true';
    });
    return () => { cancelled = true; chart?.destroy(); };
  }, [observation]);
  return <div className="domain-metric-chart"><canvas ref={ref} role="img" aria-label={`${observation.metric}：${observation.labels.map((l,i)=>`${l} ${observation.values[i]} ${observation.unit}`).join('，')}`}/></div>;
}
export function PairedFigure({ observation, detailed = false }) {
  return <figure className={`domain-paired ${detailed ? 'is-detailed' : ''}`}>
    <div className="paired-labels">{observation.labels.map((l,i) => <div key={l}><span>{i === 0 ? '先观察' : '再观察'}</span><strong>{l}</strong><small>{observation.names[i]}</small></div>)}</div>
    <div className="paired-art"><img src="/domain-art/endoscopy-modes.png" alt="白光与联动成像模式示意，非患者影像"/><ArrowRight size={25} weight="bold" aria-label="先后观察顺序"/></div>
    {!detailed && <div className="paired-values">{observation.values.map((v,i) => <div key={i}><span>误报次数中位数</span><strong>{v}<small> 次</small></strong></div>)}</div>}
    {detailed && <MiniBars observation={observation}/>}
    <figcaption>同一批患者 · 模式示意，非研究原图</figcaption>
  </figure>;
}
export function ContentDiagram({ story }) {
  const d = story.diagram;
  if (d.kind === 'paired') return <PairedFigure observation={d}/>;
  if (d.kind === 'cohort') return <figure className="domain-cohort">
    <div className="cohort-sample">{d.values.map((v,i) => <div key={i}><UsersThree size={47} weight="duotone"/><span>{d.approximate ? '约 ' : ''}{Number(v).toLocaleString()}</span><small>{d.labels[i]}</small></div>)}</div>
    <div className="association-rows">{d.findings.map((text,i) => { const m = text.match(/^(.*?)(呈正相关|呈负相关|无一致关联)$/); return <div key={i}><span>{m?.[2] || '研究发现'}</span><p>{m?.[1] || text}</p></div>; })}</div>
    <figcaption>汇总研究中的关联 · 不表示因果效应</figcaption>
  </figure>;
  if (d.kind === 'branches') return <figure className="domain-branches"><div className="branch-art"><img src="/api/scientific-assets/bio-cancerous-cell-1" alt="肿瘤细胞示意"/><small>多个机制层面</small></div><div className="branch-options">{d.groups.map(g => <div key={g.label}><strong>{g.label}</strong><p>{g.text.split('；')[0]}</p></div>)}</div><figcaption>并行研究方向 · 分支之间不表示因果关系</figcaption></figure>;
  if (d.kind === 'paths') return <figure className="domain-paths"><img src="/api/scientific-assets/bio-fibroblast-1" alt="成纤维细胞示意"/>{d.paths.map((p,i)=><div className="molecular-path" key={i}>{p.nodes.map((n,j)=><div key={j}><strong>{n}</strong>{j<2&&<span><small>{j===1?p.relation:'经'}</small><ArrowRight size={15}/></span>}</div>)}</div>)}<figcaption>按当前报告中的机制描述整理</figcaption></figure>;
  if (d.kind === 'structured') return <figure className={`domain-structured domain-diagram ${d.layout || d.kind}`}><div className="structured-nodes">{d.nodes.map((n,i) => <div className="structured-node" key={i}><BookOpen size={22}/><strong>{n.label}</strong><p>{n.text}</p>{d.layout === 'sequence' && i < d.nodes.length-1 && <ArrowRight size={18}/>}</div>)}</div><figcaption>{d.summary}</figcaption></figure>;
  return <figure className="domain-findings-diagram">{d.nodes.map((n,i)=><div key={i}><Microscope size={24}/><div>{n.label&&<strong>{n.label}</strong>}<p>{n.text}</p></div></div>)}<figcaption>当前材料中的具体发现</figcaption></figure>;
}
