import { useState } from 'react';
import { artifactKindLabels, parentReference, researchPath, landscapeCandidates, briefIsOutdated } from '../../shared/research-path.mjs';
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
export { DomainBrief as ResearchVisuals } from './DomainBrief.jsx';

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
