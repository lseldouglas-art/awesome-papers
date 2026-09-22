import { useMemo } from 'react';
import { ArrowRight, MagnifyingGlass } from '@phosphor-icons/react';
import { parentReference } from '../../shared/research-path.mjs';
import { domainSections } from '../../shared/domain-presentation.mjs';
import { readingResult } from '../../shared/domain-reading.mjs';
import './domain-brief.css';
import {DomainChapters} from './DomainChapters.jsx';

export function DomainBrief({project,artifact,onOpen,result,numbers,onJump,onSource,onCompare,disabled,onSupplement,onDiscuss}) {
  const reading=useMemo(()=>result?.kind==='brief'?readingResult(result):null,[result]);
  const sections=useMemo(()=>reading?domainSections(reading):[],[reading]);
  if(!reading)return null;
  const comparisons=Object.values(project.artifacts).filter(a=>a.kind==='questions'&&parentReference(project,a)?.artifactId===artifact.id);
  const supplement=request=>onSupplement({...request,context:result.blocks.find(b=>b.id===request.blockId)?.text??request.context});
  const nextAction=()=> <div className="domain-topic-action" aria-label="进入选题分析">
    <div><span>下一步 · 选题分析</span><h3>把领域认识，变成可研究的问题</h3><p>比较候选问题的研究价值、已有证据和实施条件，再决定优先深入哪一个。</p></div>
    <div className="domain-topic-buttons">{comparisons.length?comparisons.map(a=><button key={a.id} disabled={disabled} onClick={()=>onOpen(a.id)}>进入选题分析{comparisons.length>1?` · ${a.title}`:''} <ArrowRight size={22}/></button>):<button disabled={disabled} onClick={onCompare}>开始选题分析 <ArrowRight size={22}/></button>}
    <small>{comparisons.length?'打开已保存的候选问题比较':'基于本轮认识与所选材料生成候选问题比较'}</small></div>
  </div>;
  const go=id=>document.getElementById(`domain-chapter-${id}`)?.scrollIntoView({behavior:'smooth',block:'start'});
  return <section className="domain-brief" aria-label="领域认识图解">
    <header className="domain-intro"><div><span className="eyebrow">领域认识 · {project.goal}</span><h1>从研究发现，理解这个领域</h1></div><button className="domain-scope-button" disabled={disabled} onClick={()=>onSupplement({focus:project.goal,expanded:true})}><MagnifyingGlass size={17}/>扩大检索范围</button></header>
    <nav className="domain-atlas-nav" aria-label="领域图解导航"><button onClick={()=>go('overview')}>研究认识</button><button onClick={()=>go('history')}>发展变化</button><button onClick={()=>go('disagreements')}>关键判断与未决</button><button onClick={()=>go('maturity')}>成熟度判断</button><button onClick={()=>go('next')}>下一步：选题分析 <ArrowRight size={15}/></button></nav>
    <DomainChapters {...{project,numbers,onSource,onDiscuss}} result={reading} onSupplement={supplement} renderNextAction={nextAction} onEvidence={onJump}/>
    {!sections.some(section=>section.id==='next')&&nextAction()}
    <footer className="domain-next"><details className="domain-attribution"><summary>图示与材料说明</summary><p>图解使用当前保存的报告与逐篇记录；带省略号的文字为原文节选，完整命题和条件可按节查看。关系图表示研究问题的组织，未给材料不足的历史补造转折。生物医学素材逐项许可见<a href="/api/scientific-assets/pack" download>素材包</a>；成像图为生成示意，非患者影像或研究原图。</p></details></footer>
  </section>;
}
