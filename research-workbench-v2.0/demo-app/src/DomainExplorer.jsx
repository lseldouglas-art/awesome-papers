import { useState } from 'react';
import { explorationNodes } from '../../shared/domain-exploration.mjs';
import './domain-explorer.css';

const levels = { title: '题名', abstract: '摘要', excerpt: '正文片段', fulltext: '全文', full_text: '全文' };
function Evidence({ node, result, project, onSource, onEvidence, children }) {
  const refs = (result.citations ?? []).filter(c => c.blockId === node.blockId && (!node.id || node.id === node.blockId ? !c.nodeId : c.nodeId === node.id));
  const [open, setOpen] = useState(false);
  if (!refs.length && !children) return null;
  return <details className="domain-evidence-fold" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>证据与原文 · {new Set(refs.map(c => c.accessId)).size} 份来源</summary>
    {open && <div>{refs.map((c, i) => <section key={`${c.accessId}-${i}`}><button onClick={() => onSource(c.accessId, c)}>{project.sources[c.sourceId]?.title || c.ref || '查看来源'}</button><small>{levels[project.accesses[c.accessId]?.level] || '实际访问片段'}</small><blockquote>{c.quote}</blockquote></section>)}{children}<button className="text-button" onClick={() => onEvidence(node.blockId)}>查看本节完整论证与依据</button></div>}
  </details>;
}
function Child({ node, kind, depth, ...props }) {
  const [open, setOpen] = useState(false);
  const label = depth === 2 ? (kind === 'hotspots' ? '二级热点' : '子分支') : '具体研究问题';
  return <details className="domain-subtopic" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary><small>{label}</small><strong>{node.title}</strong><span>{open ? '收起' : '展开'}</span></summary>
    {open && <div className="domain-subtopic-body"><p>{node.text}</p>{['unknown','suggestion'].includes(node.status) && <small className="domain-node-status">{node.status === 'unknown' ? '尚待明确' : '可继续探索的问题'}</small>}
      {node.children.map(child => <Child key={child.id} node={child} kind={kind} depth={depth + 1} {...props}/>)}
      <Evidence node={node} {...props}/></div>}
  </details>;
}
export function DomainExplorer({ section, result, project, onSource, onEvidence, onDiscuss }) {
  const nodes = explorationNodes(section), kind = section.id;
  const [selected, setSelected] = useState(null);
  const node = nodes.find(n => n.id === selected) ?? nodes[0];
  if (!node) return null;
  return <div className="domain-explorer" aria-label={kind === 'hotspots' ? '逐层理解热点' : '逐层理解研究分支'}>
    <div className="domain-explorer-guide">{kind === 'hotspots' ? '一级热点 → 二级热点 → 具体问题' : '研究分支 → 子分支 → 具体发现'}<span>先理解内容，需要时展开证据</span></div>
    <div className="domain-explorer-layout"><nav aria-label={kind === 'hotspots' ? '一级热点' : '研究分支'}>{nodes.map((n, i) => <button key={n.id} aria-pressed={n.id === node.id} onClick={() => setSelected(n.id)}><small>{String(i + 1).padStart(2,'0')}</small><span>{n.title}</span></button>)}</nav>
      <article className="domain-explorer-detail" key={node.id}><span className="domain-node-label">{kind === 'hotspots' ? '一级热点' : '研究分支'}</span><h3>{node.title}</h3><p className="domain-node-intro">{node.text}</p>
        {node.children.map(child => <Child key={child.id} node={child} kind={kind} depth={2} {...{result, project, onSource, onEvidence}}/>)}
        {node.legacy && <div className="domain-legacy-detail"><h4>进一步理解</h4>{node.facets.map((f,i) => <section key={i}><h5>{f.title}</h5><p>{f.text}</p></section>)}{node.fullText !== node.text && <p>{node.fullText}</p>}<p className="domain-legacy-note">本版报告尚未细分{kind === 'hotspots' ? '二级热点' : '子分支'}；这里保留已保存的完整解释。</p></div>}
        {node.boundary && <p className="domain-node-boundary"><strong>认识边界：</strong>{node.boundary}</p>}
        <Evidence node={node} {...{result, project, onSource, onEvidence}}/>
        <button className="domain-discuss-node" disabled={!onDiscuss} onClick={() => onDiscuss?.(node)}>围绕这一{kind === 'hotspots' ? '热点' : '分支'}深入交流 →</button>
      </article></div>
    {section.summary?.analysisRole === 'comparison' && <details className="domain-synthesis-fold"><summary>{kind === 'hotspots' ? '这些热点之间有什么联系' : '分支之间的联系与区别'}</summary><p>{section.summary.text}</p><button className="text-button" onClick={() => onEvidence(section.summary.id)}>查看综合依据</button></details>}
  </div>;
}
