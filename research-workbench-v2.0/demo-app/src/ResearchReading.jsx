import { useState } from 'react';
import { artifactKindLabels, parentReference, researchPath, landscapeCandidates, briefIsOutdated } from '../../shared/research-path.mjs';
import { DOMAIN_DIMENSIONS, COVERAGE_LABELS } from '../../shared/domain-landscape.mjs';
import './research-reading.css';

export function statementTitle(block) {
  if (block.headline) return block.headline;
  const text = block.text ?? '';
  const colon = text.search(/[：:]/);
  if (colon > 0 && colon < 50 && !/(为|如下|包括|是)$/.test(text.slice(0,colon))) return text.slice(0, colon);
  return text.split(/[。！？\n]/)[0];
}
export function ResearchPathNav({ project, activeId, onOpen, disabled }) {
  const artifacts = Object.values(project.artifacts), children = new Map();
  for (const a of artifacts) {
    const id = parentReference(project, a)?.artifactId ?? null;
    if (!children.has(id)) children.set(id, []);
    children.get(id).push(a);
  }
  const render = (parentId, visited = new Set()) => <ol>{(children.get(parentId) ?? []).filter(a => !visited.has(a.id)).map(a => <li key={a.id}>
    <button title={a.title} disabled={disabled} aria-current={a.id === activeId ? 'page' : undefined} onClick={() => onOpen(a.id)}><span className="path-dot"/><span><small>{artifactKindLabels[a.kind] ?? '研究成果'}</small><strong>{a.title}</strong></span></button>
    {children.has(a.id) && render(a.id, new Set([...visited, a.id]))}
  </li>)}</ol>;
  return <nav className="research-path" aria-label="研究脉络"><h2>研究脉络</h2><p>研究路径与成果关联</p>{render(null)}</nav>;
}
export function ResearchBreadcrumbs({ project, artifact, onOpen, onVersion }) {
  const path = researchPath(project, artifact), parent = parentReference(project, artifact);
  const revision = parent && project.artifacts[parent.artifactId]?.revisions.find(r=>r.id===parent.revisionId);
  return <div className="research-breadcrumbs"><nav aria-label="当前研究路径">{path.map((a, i) => <span key={a.id}>{i > 0 && <i>›</i>}<button aria-current={a.id === artifact.id ? 'page' : undefined} onClick={() => onOpen(a.id)} title={a.title}>{artifactKindLabels[a.kind] ?? a.title}</button></span>)}</nav>{parent && <div className="parent-links"><button className="return-parent" onClick={() => onOpen(parent.artifactId)}>← 返回上一步</button>{revision && <details className="lineage-version"><summary>来路版本</summary><button onClick={()=>onVersion({artifactId:parent.artifactId,revisionId:parent.revisionId})}>查看来路版本</button></details>}</div>}</div>;
}
export function BriefContinuity({ project, artifact, result, disabled, onOpen, onRepair }) {
  const [sourceId, setSourceId] = useState('');
  if (result?.kind !== 'research_brief') return null;
  const parent = parentReference(project, artifact, result), candidates = landscapeCandidates(project, artifact);
  const outdated = briefIsOutdated(project, result), missing = !parent && candidates.length > 0;
  const selected = sourceId || (candidates.length === 1 ? candidates[0].id : '');
  if (!outdated && !missing) return null;
  return <section className="continuity-notice" aria-label="简报接续提示"><strong>{missing ? '此前的领域报告仍完整保留' : '研究决定已更新'}</strong><p>{missing ? '这份早期工作简报没有关联领域报告。选择来路后，可把已有认识和依据补入新版本。' : '下方简报保留了生成时的状态。更新后会承接当前取舍，旧版本仍可回看。'}</p>
    {missing && candidates.length > 1 && <select aria-label="简报所承接的领域报告" value={selected} onChange={e => setSourceId(e.target.value)}><option value="">选择来源报告</option>{candidates.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select>}
    <div className="journey-actions">{(selected || parent) && <button onClick={() => onOpen(selected || parent.artifactId)}>查看完整领域报告</button>}<button disabled={disabled || missing && !selected} onClick={() => onRepair(missing ? selected : parent?.artifactId)}>补齐认识与当前取舍</button></div>
  </section>;
}
function citedSources(project, result, block) {
  const ids = [...new Set((result.citations ?? []).filter(c => c.blockId === block.id).map(c => c.accessId))];
  return ids.map(id => ({ ...project.sources[project.accesses[id]?.sourceId], accessId: id })).filter(s => s.id);
}
export function ResearchVisuals({ project, artifact, onOpen, result, numbers, onJump, onSource, onCompare, onDeepen, disabled }) {
  const [view, setView] = useState('map');
  if (result?.kind !== 'brief') return null;
  const comparisons = Object.values(project.artifacts).filter(a => a.kind === 'questions' && parentReference(project,a)?.artifactId === artifact.id);
  const blocks = result.blocks, sections = DOMAIN_DIMENSIONS.map(d => ({ ...d, heading: blocks.find(b => b.id === `research-${d.id}-heading`), items: blocks.filter(b => new RegExp(`^research-${d.id}-\\d+$`).test(b.id)) }));
  const overview = blocks.filter(b => /^research-overview-\d+$/.test(b.id)), lead = overview.find(b => ['reported', 'inference'].includes(b.informationStatus)) ?? overview[0];
  const branches = sections.find(s => s.id === 'branches').items.filter(b => b.analysisRole !== 'comparison');
  const history = sections.find(s => s.id === 'history').items.filter(b => b.analysisRole !== 'comparison');
  return <section className="research-visuals" aria-label="领域认识图解">
    <div className="reading-intro"><span className="eyebrow">领域研判</span><h2>{lead ? statementTitle(lead) : '领域证据综合'}</h2>{lead && <button className="text-button" onClick={() => onJump(lead.id)}>阅读完整判断与依据 →</button>}</div>
    <div className="visual-tabs" role="tablist" aria-label="领域图解视图">{[['map','研究地图'],['timeline','发展脉络'],['evidence','证据分布']].map(([id,label]) => <button role="tab" id={`visual-tab-${id}`} aria-controls={`visual-panel-${id}`} aria-selected={view === id} tabIndex={view === id ? 0 : -1} key={id} onClick={() => setView(id)} onKeyDown={e => { if (['ArrowRight','ArrowLeft','Home','End'].includes(e.key)) { e.preventDefault(); const ids=['map','timeline','evidence']; const next=e.key==='Home'?0:e.key==='End'?2:(ids.indexOf(id)+(e.key==='ArrowRight'?1:2))%3; setView(ids[next]); requestAnimationFrame(() => document.getElementById(`visual-tab-${ids[next]}`)?.focus()); } }}>{label}</button>)}</div>
    <div role="tabpanel" id={`visual-panel-${view}`} aria-labelledby={`visual-tab-${view}`}>
      {view === 'map' && <><div className="map-root">{project.goal}</div><div className="field-map">{branches.map((b,i) => { const direction=project.researchState?.directions.find(d=>d.origin?.resultId===result.id && d.origin?.blockId===b.id); return <article key={b.id}><span className="map-index">{String(i+1).padStart(2,'0')}</span><h3>{statementTitle(b)}</h3><p>{citedSources(project,result,b).length} 份关联材料 · {b.informationStatus === 'unknown' ? '尚未确认' : '查看研究发现'}</p><div className="map-actions"><button onClick={() => onJump(b.id)}>查看发现与依据</button>{direction && <button disabled={disabled} onClick={()=>onDeepen(direction)}>沿此分支探索 →</button>}</div></article>; })}</div>{!branches.length && <p>当前保存内容尚未分出研究分支。</p>}</>}
      {view === 'timeline' && <><p className="visual-note">沿研究问题与方法阅读历史线索。下方年份是所引文献的发表时间，不自动视为学科转折点。</p><ol className="field-timeline">{history.map(b => { const sources=citedSources(project,result,b), years=sources.map(s=>String(s.year??'')).filter(y=>/^\d{4}$/.test(y)).sort(); return <li key={b.id}><div className="timeline-years">{years.length ? `${years[0]}${years.at(-1)!==years[0]?`—${years.at(-1)}`:''}` : '时间待核查'}<small>依据文献年份</small></div><div><h3>{statementTitle(b)}</h3><button onClick={() => onJump(b.id)}>阅读这条历史线索</button><div className="visual-citations">{sources.map(s=><button key={s.accessId} onClick={()=>onSource(s.accessId)}>[{numbers[s.id]}] {s.year||'未知年份'}</button>)}</div></div></li>; })}</ol>{!history.length && <p>当前报告尚无可定位的历史线索。</p>}</>}
      {view === 'evidence' && <><p className="visual-note">按本次报告的关联文献展示材料分布；数量不代表结论强度或全领域热度。</p><div className="evidence-matrix" role="table" aria-label="七个维度的实际材料覆盖">{sections.map(s => { const ids=new Set(s.items.flatMap(b=>citedSources(project,result,b).map(v=>v.id))); return <div role="row" key={s.id}><button role="cell" onClick={()=>onJump(`research-${s.id}-heading`)}>{s.label}</button><span role="cell" className="coverage-track"><span style={{width:`${Math.round(ids.size/Math.max(1,(result.accessIds??[]).length)*100)}%`}}/></span><span role="cell">{ids.size} 篇</span><small role="cell">{COVERAGE_LABELS[s.heading?.dimensionCoverage]??'尚未标注'}</small></div>; })}</div></>}
    </div>
    <div className="reading-next"><div><strong>{comparisons.length ? '已有选题与研究决定' : '研究问题形成与比较'}</strong><p>{comparisons.length ? '已保存的比较与取舍可直接打开。' : '从缺口依据出发，比较题目与研究设计。'}</p></div>{comparisons.length ? <div className="saved-comparisons">{comparisons.map((a,i)=><button key={a.id} className="primary" disabled={disabled} onClick={()=>onOpen(a.id)}>打开已有选题比较{comparisons.length>1?` · ${i+1}`:''} →</button>)}</div> : <button className="primary" disabled={disabled} onClick={onCompare}>生成论文选题并比较 →</button>}</div>

  </section>;
}

export function ScientificReading({ blocks, renderBlocks }) {
  const groups=[];
  for (const b of blocks) {
    if (b.type==='heading' || !groups.length) groups.push({heading:b.type==='heading'?b:null,items:b.type==='heading'?[]:[b]});
    else groups.at(-1).items.push(b);
  }
  return <div className="scientific-reading">{groups.map((g,i) => <section key={g.heading?.id??i} className="scientific-section">
    {g.heading && renderBlocks([g.heading])}
    {g.items.filter(b=>b.analysisRole==='comparison').map(b=><div key={b.id} className="synthesis-statement"><span className="eyebrow">综合判断</span>{b.headline && <h3>{b.headline}</h3>}{renderBlocks([b])}</div>)}
    {g.items.some(b=>b.analysisRole==='comparison') && g.items.length>1 ? <details className="section-evidence"><summary>展开研究发现与论证 · {g.items.length-1} 项</summary>{g.items.filter(b=>b.analysisRole!=='comparison').map(b=><div key={b.id}>{b.headline && <h3>{b.headline}</h3>}{renderBlocks([b])}</div>)}</details> : g.items.filter(b=>b.analysisRole!=='comparison').map(b=><div key={b.id}>{b.headline && <h3>{b.headline}</h3>}{renderBlocks([b])}</div>)}
  </section>)}</div>;
}
