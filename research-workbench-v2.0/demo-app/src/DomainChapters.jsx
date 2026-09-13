import {useMemo,useState} from 'react';
import {ArrowRight,BookOpen,MagnifyingGlass,Microscope,TreeStructure,Question,Flask,ArrowSquareOut} from '@phosphor-icons/react';
import {chapterView,overviewNodes,methodRows,evidenceRows,directions,pairedClauses,conceptTitle,comparisonConditions,focusDiagram,gapLabel,evidenceExcerpt,excerpt,clauses,topic,prose} from '../../shared/domain-chapters.mjs';
import './domain-chapters.css';

function References({blockId,result,numbers,onSource,onEvidence}) {
  const refs=(result.citations??[]).filter(c=>c.blockId===blockId).filter((c,i,a)=>a.findIndex(x=>x.accessId===c.accessId)===i);
  return <span className="atlas-references">{refs.slice(0,3).map(c=><button key={c.accessId} aria-label={`查看文献 ${numbers[c.sourceId]} 的依据`} onClick={()=>onSource(c.accessId,c)}>[{numbers[c.sourceId]}]</button>)}{refs.length>3&&<button onClick={()=>onEvidence(blockId)}>+{refs.length-3}</button>}</span>;
}
function Overview({section,sections,goal,onEvidence}) {
  const nodes=overviewNodes(section,sections),isGastric=/胃/.test(goal);
  return <div className={`atlas-field-map ${nodes.length>5?'has-many':''}`} aria-label="本轮材料中的研究问题分布">
    <svg className="atlas-map-links" viewBox="0 0 800 260" preserveAspectRatio="none" aria-hidden="true"><path d="M400 108 Q260 50 100 48 M400 108 Q560 50 700 48 M400 108 Q260 205 100 208 M400 108 Q550 205 700 208 M400 108 L400 235"/></svg>
    <div className="atlas-map-center">{isGastric?<img src="/api/scientific-assets/bio-stomach" alt="胃的解剖示意"/>:<TreeStructure size={58} weight="duotone"/>}<span>{excerpt(goal,24)}</span></div>
    <div className={`atlas-map-nodes count-${nodes.length}`}>{nodes.map((n,i)=><button key={i} onClick={()=>onEvidence(n.blockId)}><small>0{i+1}</small><strong>{excerpt(n.text,34)}</strong></button>)}</div>
  </div>;
}
function History({section,onSupplement}) {
  const insufficient=section.heading.dimensionCoverage==='insufficient';
  const block=section.summary;
  if(!insufficient)return <div className="atlas-history-records">{section.findings.map(b=><div key={b.id}><BookOpen size={26}/><strong>{excerpt(b.headline??b.text,68)}</strong></div>)}</div>;
  const gap=prose(block?.text).match(/中间[^，；。]+/)?.[0]??clauses(block?.text).find(t=>/缺失|无法|不能/.test(t));
  return <div className="atlas-history-gap"><div className="atlas-history-node"><BookOpen size={32}/><strong>历史材料</strong><span>当时已知什么？</span></div><div className="atlas-missing-link"><span className="atlas-dashed-line"/><Question size={32}/><strong>{excerpt(gap??block?.headline??'研究认识的衔接尚不明确',72)}</strong><button onClick={()=>onSupplement({focus:prose(block?.headline??'领域历史'),context:block?.text,blockId:block?.id,kinds:['历年综述']})}>补查历史综述 <ArrowRight size={14}/></button></div><div className="atlas-history-node"><Microscope size={32}/><strong>当前研究材料</strong><span>不由年份推断转折</span></div></div>;
}
function Focus({section,result,numbers,onSource,onEvidence}) {
  return <div className="atlas-focus-grid">{section.findings.map((b,i)=>{
    const d=focusDiagram(b);
    return <article key={b.id}><h3>{conceptTitle(b)}</h3><div className={`atlas-focus-concepts is-${d.kind}`}>{d.kind!=='question'&&<span>{excerpt(d.nodes[0],38)}</span>}<div aria-hidden="true">{d.kind==='change'?<ArrowRight size={23}/>:d.kind==='connection'?<TreeStructure size={23}/>:<Question size={23}/>}</div><span>{excerpt(d.nodes[1],52)}</span></div><small>{d.caption}</small><footer><References {...{result,numbers,onSource,onEvidence}} blockId={b.id}/><button className="atlas-text-link" onClick={()=>onEvidence(b.id)}>依据 <ArrowSquareOut size={13}/></button></footer></article>;
  })}</div>;
}
function Methods({section,onEvidence}) {
  const rows=methodRows(section);
  return <div className="atlas-methods" aria-label="方法与能回答的问题"><div className="atlas-table-labels"><span>方法</span><span>回答的问题</span></div>{rows.map((r,i)=><button key={i} onClick={()=>onEvidence(r.blockId)}><span className="atlas-method-name"><span className="atlas-method-number">0{i+1}</span><strong>{excerpt(r.label,30)}</strong></span><ArrowRight size={24}/><span className="atlas-method-question">{excerpt(r.finding,64)}</span></button>)}</div>;
}
function Comparisons({section,result,numbers,onSource,onEvidence}) {
  const [selected,setSelected]=useState(section.summary?.id),block=section.items.find(b=>b.id===selected)??section.summary;
  if(!block)return null;
  const pair=pairedClauses(block),conditions=comparisonConditions(pair.limit);
  return <div className="atlas-comparison"><div className="atlas-selector">{section.items.map((b,i)=><button key={b.id} aria-pressed={b.id===block.id} onClick={()=>setSelected(b.id)} title={prose(b.headline??b.text)}>{i+1}<span>{conceptTitle(b)}</span></button>)}</div><div className="atlas-compare-pair"><div><span className="atlas-mini-label">发现</span><p>{excerpt(pair.left,105)}</p></div><div className="atlas-compare-divider"><span/><strong>{pair.relation}</strong><span/></div><div><span className="atlas-mini-label">对照与条件</span><p>{excerpt(pair.right,105)}</p></div></div>{conditions.length?<div className="atlas-comparison-conditions">{conditions.map(([label,value])=><span key={label}><small>{label}</small>{value}</span>)}</div>:pair.limit&&<p className="atlas-compare-limit">{excerpt(pair.limit,72)}</p>}<References {...{result,numbers,onSource,onEvidence}} blockId={block.id}/><button className="atlas-text-link" onClick={()=>onEvidence(block.id)}>核对完整命题 <ArrowSquareOut size={13}/></button></div>;
}
function Gaps({section,onEvidence,onSupplement}) {
  return <div className="atlas-gap-rows">{section.findings.map((b,i)=>{
    const text=prose(b.text),question=text.match(/(?:可检验问题|候选问题)：([^？。]+[？]?)/)?.[1];
    const check=text.match(/核查路径：([^。]+)/)?.[1]??clauses(text).find(t=>/验证缺口|需|未报告|未覆盖|不能/.test(t))??clauses(text)[0];
    return <article key={b.id}><div className="atlas-gap-index">0{i+1}</div><div><button className="atlas-gap-title" onClick={()=>onEvidence(b.id)}>{gapLabel(b)}</button><span>{excerpt(check,44)}</span></div><div className="atlas-gap-bridge" aria-hidden="true"><span/><Question size={22}/><span/></div><button onClick={()=>onSupplement({focus:question??b.headline??b.text,context:b.text,blockId:b.id})}><MagnifyingGlass size={18}/>补材料</button></article>;
  })}</div>;
}
function Maturity({section,onEvidence}) {
  return <div className="atlas-evidence-lanes">{evidenceRows(section).map((r,i)=><button key={i} onClick={()=>onEvidence(r.blockId)}><span className="atlas-evidence-symbol"><Flask size={29} weight="duotone"/></span><strong>{excerpt(r.label,28)}</strong><span>{evidenceExcerpt(r.finding)}</span></button>)}<p>仅反映本次材料。</p></div>;
}
function Next({section,onSupplement}) {
  return <div className="atlas-directions"><div className="atlas-direction-origin"><TreeStructure size={25}/><span>从你关心的问题继续</span></div><div>{directions(section).map((r,i)=><button key={i} onClick={()=>onSupplement({focus:r.finding,blockId:r.blockId})}><strong>{excerpt(r.label,25)}</strong><span>{excerpt(r.finding.replace(/^可(?:补检|深入|补查|检索)/,''),38)}</span><ArrowRight size={18}/></button>)}</div></div>;
}
export function DomainChapters({project,result,numbers,onSource,onEvidence,onSupplement,renderBranches}) {
  const sections=useMemo(()=>chapterView(result),[result]);
  return <div className="domain-chapter-atlas" aria-label="完整领域图解">{sections.map((s,i)=><section className={`atlas-chapter atlas-${s.kind}`} key={s.id} id={`domain-chapter-${s.id}`} data-chapter-id={s.id}>
    <header><div><span className="atlas-chapter-number">{String(i+1).padStart(2,'0')}</span><h2>{s.name}</h2></div><button onClick={()=>onEvidence(s.heading.id)}><BookOpen size={15}/>原文与依据</button></header>
    {s.kind==='map'?<Overview section={s} sections={sections} goal={project.goal} onEvidence={onEvidence}/>:s.kind==='studies'?renderBranches(s):s.kind==='coverage'?<History section={s} onSupplement={onSupplement}/>:s.kind==='methods'?<Methods section={s} onEvidence={onEvidence}/>:s.kind==='comparison'?<Comparisons section={s} {...{result,numbers,onSource,onEvidence}}/>:s.kind==='gaps'?<Gaps section={s} {...{onEvidence,onSupplement}}/>:s.kind==='evidence'?<Maturity section={s} onEvidence={onEvidence}/>:s.kind==='directions'?<Next section={s} onSupplement={onSupplement}/>:<Focus section={s} {...{result,numbers,onSource,onEvidence}}/>}
  </section>)}</div>;
}
