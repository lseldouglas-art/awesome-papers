import {TOPIC_AXES} from '../../shared/research-labels.mjs';
import { RELEVANCE_VERSION, topicRelations, legacyRelations, relevanceLabel } from '../../shared/topic-relevance.mjs';
import { useEffect, useLayoutEffect, useState } from 'react';
import { concise } from '../../shared/research-guidance.mjs';
import { referenceNumbers } from '../../shared/material-scope.mjs';
import { topicPresentation, topicLayouts, comparisonRows } from '../../shared/topic-presentation.mjs';
import { INFORMATION_LABELS } from '../../shared/domain-landscape.mjs';
import { Icon } from './icons.jsx';
import { download } from './ui.jsx';
import './topic-library.css';

const historicalLabels={...legacyRelations,peripheral:topicRelations.peripheral};
const decisions={pending:'待判断',included:'纳入',excluded:'排除'};
export function TopicLibrary({project,artifact,result,question,focusBlock,selectedIds,onSelection,onSource,onScreen,onAnalyze,onSync,onSearch,disabled,readingMode='visual'}) {
  const [view,setView]=useState(result.topicSections?'analysis':'library');
  useEffect(()=>{if(result.reviewResultId)setView('analysis');},[result.reviewResultId]);
  useLayoutEffect(()=>{if(focusBlock?.startsWith('topic-'))setView('analysis');},[focusBlock]);
  useEffect(()=>{if(!focusBlock?.startsWith('topic-') || view!=='analysis')return;const el=document.getElementById(`block-${focusBlock}`);let detail=el?.closest('details');while(detail){detail.open=true;detail=detail.parentElement?.closest('details');}el?.scrollIntoView({block:'center'});},[focusBlock,view]);
  const [filter,setFilter]=useState('all'),[query,setQuery]=useState('');
  const numbers=referenceNumbers(project),notes=result?.paperNotes??[];
  const ids=artifact.draft.sourceAccessIds,entries=result.library.entries;
  const rows=ids.map(id=>{const access=project.accesses[id],source=project.sources[access.sourceId];return {id,access,source,entry:entries.find(e=>e.accessId===id)??{decision:'pending'},note:notes.find(n=>n.accessId===id)};});
  const relationLabels=notes.every(n=>n.criteriaVersion===RELEVANCE_VERSION)?topicRelations:historicalLabels;
  const counts=Object.fromEntries(Object.keys(relationLabels).map(key=>[key,rows.filter(r=>r.note?.relationship===key).length]));
  const pending=rows.filter(r=>!r.note).length,visible=rows.filter(r=>(filter==='all'||filter==='unread'&&!r.note||filter===r.note?.relationship)&&(!query||`${r.source.title} ${r.source.pmid??''}`.toLowerCase().includes(query.toLowerCase())));
  const parent=project.artifacts[artifact.lineage.artifactId],newIds=parent.draft.sourceAccessIds.filter(id=>!ids.includes(id));
  const allChecked=visible.length>0&&visible.every(r=>selectedIds.includes(r.id));
  const exportRis=()=>{const clean=v=>String(v??'').replace(/[\r\n]+/g,' '); const text=rows.filter(r=>r.entry.decision==='included').map(({source:s})=>['TY  - JOUR',`TI  - ${clean(s.title)}`,...(s.authors??[]).map(a=>`AU  - ${clean(a)}`),`PY  - ${clean(s.year)}`,...(s.doi?[`DO  - ${clean(s.doi)}`]:[]),...(s.url?[`UR  - ${clean(s.url)}`]:[]),'ER  -'].join('\n')).join('\n\n');download('专题文献库-已纳入.ris',text,'application/x-research-info-systems');};
  return <section className="topic-library" aria-label="专题文献库">
    <div className="library-heading"><div><span className="eyebrow">当前选定专题</span><h2>{question?.title||question?.text||"围绕这一个选题，建立证据基础"}</h2><p>筛选文献，再分析它们怎样支持、限制或改变你的研究。</p></div><div className="library-heading-actions">{view==='library' && <button className="primary" disabled={disabled||!selectedIds.length} onClick={onAnalyze}>{result.reviewResultId?'重新分析所选':'分析所选'} {selectedIds.length} 份文献 →</button>}<button className="text-button" onClick={onSearch}>继续定向检索</button></div></div>
    {newIds.length>0&&<div className="library-incoming">选题页又有 {newIds.length} 份材料。<button disabled={disabled} onClick={()=>onSync(newIds)}>加入本专题库</button></div>}
    <p className="library-scope-note">{result.reviewResultId?`最近综合使用 ${result.reviewAccessIds?.length??0} 份材料。`:'下一步：逐篇整理，再深入分析。'}当前选择 {selectedIds.length} 份；纳入与排除由你决定。</p>
    {result.topicSections&&<div className="library-view-tabs" aria-label="专题库阅读方式"><button aria-pressed={view==='analysis'} onClick={()=>setView('analysis')}>核心论证与题目</button><button aria-pressed={view==='library'} onClick={()=>setView('library')}>文献库与筛选 · {ids.length}</button></div>}
    {view==='analysis'&&result.topicSections?<><TopicEvidenceMap project={project} result={result} onSource={onSource} numbers={numbers}/><TopicArgument project={project} result={result} onSource={onSource} numbers={numbers} readingMode={readingMode}/></>:<>
    <div className="library-stats"><div><strong>{ids.length}</strong><span>已保存材料</span></div><div><strong>{rows.filter(r=>r.entry.decision==='included').length}</strong><span>你已纳入</span></div><div><strong>{notes.length}</strong><span>AI 逐篇整理</span></div><div><strong>{pending}</strong><span>尚未分析</span></div></div>
    {notes.length>0&&<section className="evidence-distribution" aria-label="专题证据分布图"><h3>这些材料离研究问题有多近</h3><div className="evidence-bar">{Object.entries(counts).filter(([,n])=>n).map(([key,n])=><button key={key} className={key} style={{flex:n}} onClick={()=>setFilter(key)} aria-label={`${relationLabels[key]} ${n} 篇`}>{n}</button>)}</div><div className="distribution-legend">{Object.entries(counts).map(([key,n])=><button key={key} onClick={()=>setFilter(key)}><i className={key}/>{relationLabels[key]} {n}</button>)}</div><small>AI 按实际题名／摘要判断相关性；数量不代表证据强度。</small></section>}
    <div className="library-tools"><label>查找文献<input aria-label="查找专题文献" placeholder="题名或 PMID" value={query} onChange={e=>setQuery(e.target.value)}/></label><label>显示范围<select aria-label="专题文献显示范围" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">全部文献</option><option value="unread">尚未分析</option>{Object.entries(relationLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><button disabled={!rows.some(r=>r.entry.decision==='included')} onClick={exportRis}>导出已纳入 · RIS</button></div>
    <div className="library-selection"><label><input type="checkbox" checked={allChecked} disabled={disabled||!visible.length} onChange={e=>onSelection(e.target.checked?[...new Set([...selectedIds,...visible.map(r=>r.id)])]:selectedIds.filter(id=>!visible.some(r=>r.id===id)))}/>选择当前显示的 {visible.length} 份</label><button disabled={disabled||!selectedIds.length} onClick={()=>onScreen(selectedIds,'included')}>纳入所选</button><button disabled={disabled||!selectedIds.length} onClick={()=>onSelection([])}>清空分析选择</button></div>
    <div className="library-table-wrap"><table className="library-table"><thead><tr><th>分析</th><th>文献与实际访问</th><th>AI 整理与相关性</th><th>你的筛选</th></tr></thead><tbody>{visible.map(r=><tr key={r.id}><td><input type="checkbox" aria-label={`分析专题文献 ${numbers[r.source.id]}`} checked={selectedIds.includes(r.id)} disabled={disabled} onChange={e=>onSelection(e.target.checked?[...selectedIds,r.id]:selectedIds.filter(id=>id!==r.id))}/></td><td><button className="paper-title" onClick={()=>onSource(r.id)}>[{numbers[r.source.id]}] {r.source.title}</button><small>{r.source.year||'年份未知'} · {r.access.level==='abstract'?'摘要':r.access.level==='title'?'仅题名':r.access.level==='full_text'?'已读全文':'实际访问文本'}</small></td><td>{r.note?<><span className={`relation-badge ${r.note.relationship}`}>{relevanceLabel(r.note)}</span><p>{concise(r.note.fields.relevance.text,90)}</p><details><summary>对象、方法、发现与局限</summary>{Object.entries({subject:'研究对象',methods:'方法',findings:'发现',unreported:'未报告与局限'}).map(([key,label])=><div key={key}><strong>{label}</strong><p>{r.note.fields[key].text}</p>{r.note.fields[key].quotes?.length>0&&<button className="text-button" onClick={()=>onSource(r.id,{accessId:r.id,sourceId:r.source.id,quote:r.note.fields[key].quotes[0]})}>查看对应原文</button>}</div>)}</details></>:<span className="muted">尚未逐篇分析</span>}</td><td><select aria-label={`文献 ${numbers[r.source.id]} 的筛选决定`} disabled={disabled} value={r.entry.decision} onChange={e=>onScreen([r.id],e.target.value)}>{Object.entries(decisions).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></td></tr>)}</tbody></table>{!visible.length&&<p>这个范围内暂无文献。</p>}</div>
    </>}
  </section>;
}

export function TopicEvidenceMap({ project, result, onSource, numbers }) {
  const reviewIds = result.reviewAccessIds ?? result.accessIds ?? [];
  const ids = new Set(reviewIds), notes = (result.paperNotes ?? []).filter(n=>ids.has(n.accessId));
  if (!notes.length) return null;
  const relationLabels=notes.every(n=>n.criteriaVersion===RELEVANCE_VERSION)?topicRelations:historicalLabels;
  const groups = Object.entries(relationLabels).map(([key,label])=>({key,label,notes:notes.filter(n=>n.relationship===key)}));
  const levels = reviewIds.reduce((out,id)=>{const level=project.accesses[id]?.level ?? 'unknown';out[level]=(out[level]??0)+1;return out;},{});
  return <figure className="topic-evidence-map" aria-label="本次综合的证据分布图">
    <figcaption><div><span className="eyebrow">文献相关性与适用范围</span><h3>本次综合的材料分布</h3></div><span className="map-total"><strong>{reviewIds.length}</strong> 份材料</span></figcaption>
    <div className="evidence-lanes">{groups.map(g=><div className={`evidence-lane lane-${g.key}`} key={g.key}><div className="evidence-lane-title"><span>{g.label}</span><strong>{g.notes.length}</strong></div><div className="evidence-paper-marks">{g.notes.map(n=><button key={n.accessId} title={`[${numbers[n.sourceId]}] ${project.sources[n.sourceId]?.title}`} aria-label={`打开分布图文献 ${numbers[n.sourceId]}`} onClick={()=>onSource(n.accessId)}><span aria-hidden="true"/></button>)}{!g.notes.length&&<span className="muted">本次未归入</span>}</div></div>)}</div>
    <div className="evidence-map-caption"><span>每个标记对应一份材料，可查看原文。按相关性分类，数量不代表证据强度。</span><span>{Object.entries(levels).map(([key,n])=>`${({abstract:'摘要',title:'仅题名',full_text:'全文',user_upload:'上传文本'})[key]??'实际文本'} ${n}`).join(' · ')}</span></div>
  </figure>;
}

function ArgumentCitations({ result, block, numbers, onSource }) {
  const seen = new Set();
  return <span className="citation-links">{(result.citations??[]).filter(c=>c.blockId===block.id).filter(c=>{if(seen.has(c.accessId))return false;seen.add(c.accessId);return true;}).map(c=><button key={c.accessId} onClick={()=>onSource(c.accessId,c)} aria-label={`查看文献 ${numbers[c.sourceId]} 的依据`}>[{numbers[c.sourceId]}]</button>)}</span>;
}
function StudyComparison({project,result,section,onSource,numbers}) {
  const rows = comparisonRows(project,result,[section.judgmentId,...section.reasoningIds]);
  if (!rows.length) return null;
  const fields = [['subject','对象与问题'],['methods','方法与比较条件'],['findings','实际研究发现'],['unreported','未报告与局限']];
  const levels = {title:'仅题名',abstract:'摘要',full_text:'全文',user_upload:'上传文本'};
  return <details className="study-comparison"><summary>逐篇对照研究发现与适用条件 · {rows.length} 份材料</summary>
    <p>对照本段实际引用的已存整理。不同研究的结果须结合设计、结局与观察时点解释。</p>
    <div className="study-comparison-scroll" tabIndex={0} role="region" aria-label="文献研究结果对照，可横向滚动"><table>
      <caption>本段引用文献的对象、方法、发现与局限；原文可逐篇打开。</caption>
      <thead><tr><th scope="col">研究与访问层级</th>{fields.map(([key,label])=><th scope="col" key={key}>{label}</th>)}</tr></thead>
      <tbody>{rows.map(row=><tr key={row.accessId}><th scope="row"><button onClick={()=>onSource(row.accessId)}>[{numbers[row.source.id]??'—'}] {row.source.title}</button><small>{row.source.year??'年份未知'} · {levels[row.level]??'访问层级未知'}</small></th>{fields.map(([key])=>{const field=row.fields?.[key];return <td key={key}><p>{field?.text||'当前访问内容未报告'}</p><small>{INFORMATION_LABELS[field?.status]??'尚未确认'}</small>{field?.quotes?.length>0&&<details><summary>原文依据</summary>{field.quotes.map((quote,i)=><blockquote key={i}>{quote}</blockquote>)}</details>}</td>;})}</tr>)}</tbody>
    </table></div>
  </details>;
}
export function TopicArgument({project,result,onSource,numbers,readingMode='visual'}) {
  if(!result.topicSections)return null;
  const blocks = new Map(result.blocks.map(b=>[b.id,b]));
  const cite = block => <ArgumentCitations result={result} block={block} numbers={numbers} onSource={onSource}/>;
  const state = b => <span className={`argument-status status-${b.informationStatus}`}>{INFORMATION_LABELS[b.informationStatus] ?? '信息状态未知'}</span>;
  return <section className="topic-argument" aria-label="选题的三项核心论证"><h2>证据、缺口与下一步设计</h2>
    {result.topicSections.map((s,i)=>{const judgment=blocks.get(s.judgmentId), layout=topicPresentation(s.presentation && {layout:s.presentation.layout},s.id).layout;return <article className={`argument-section section-${s.id}`} key={s.id} id={`block-topic-${s.id}-heading`}>
      <div className="argument-section-heading"><span className="argument-section-icon"><Icon name={['book','info','outline'][i]} size={24}/></span><div><span className="eyebrow">0{i+1} · {topicLayouts[layout]}</span><h3>{TOPIC_AXES.find(axis=>axis.id===s.id)?.label??s.label}</h3></div></div>
      {judgment&&<div className="argument-judgment" id={`block-${judgment.id}`}>{state(judgment)}<strong>{judgment.headline || judgment.text}</strong>{cite(judgment)}{judgment.headline&&<details key={readingMode} open={readingMode==='full'}><summary>判断依据</summary><p>{judgment.text}</p></details>}</div>}
      <div className={`argument-layout layout-${layout}`} aria-label={topicLayouts[layout]}>{s.reasoningIds.map((id,j)=>{const b=blocks.get(id);if(!b)return null;return <div className="argument-node" key={id} id={`block-${id}`}>
        <div className="argument-node-meta"><span className="argument-node-number">{String(j+1).padStart(2,'0')}</span>{state(b)}</div><h4>{b.headline||b.text}</h4>{cite(b)}
        {b.headline&&<details key={readingMode} open={readingMode==='full'}><summary>证据与解释</summary><p>{b.text}</p></details>}
      </div>;})}</div>{layout==='sequence'&&<p className="argument-sequence-note">按论证顺序阅读；连线不表示已证实的因果关系。</p>}
      {project&&s.id==='evidence'&&<StudyComparison project={project} result={result} section={s} onSource={onSource} numbers={numbers}/>}
    </article>;})}
    <div className="paper-plan"><span className="eyebrow">把认识转成下一步 · 工作题目待验证</span><h3>{result.paperTitle}</h3><details key={readingMode} open={readingMode==='full'}><summary>查看对应的写作大纲</summary><ol>{result.outline.map((o,i)=><li key={i}><strong>{o.heading}</strong><p>{o.purpose}</p></li>)}</ol></details></div><small>基于本次实际访问材料的 AI 分析；专题选择、文献纳排及研究判断由你作出。</small>
  </section>;
}
