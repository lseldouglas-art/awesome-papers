import {readableBatches} from '../../shared/research-continuity.mjs';
import { useEffect, useState, useRef } from 'react';
import { searchTotals } from '../../shared/topic-search.mjs';
import { taskPurposes } from '../../shared/research-guidance.mjs';

export function SavedBatches({task,project,onSource}) {
  const batches=readableBatches(task);
  if(!batches.length)return null;
  const labels={subject:'研究对象与问题',methods:'方法概述',findings:'主要发现',relevance:'与课题的关系',unreported:'未报告与局限'};
  return <details className="readable-batches"><summary>{batches.length} 批材料已保存，可先阅读</summary><p>这里是已处理片段的阶段整理，尚不能代表全部材料的综合结论。</p>{batches.map((b,i)=><details key={b.id}><summary>第 {i+1} 批 · 已完成片段</summary>{Array.isArray(b.content)&&b.content.map((paper,j)=><article key={j}><h4>{project?.sources?.[paper.sourceId]?.title??paper.ref}</h4>{Object.entries(paper.fields??{}).map(([field,v])=><div key={field}><strong>{labels[field]??'材料发现'} · {v.status==='unknown'?'未知':v.status==='inference'?'AI解释':'材料报告'}</strong><p>{v.text}</p>{v.citations?.map((c,n)=><button key={n} onClick={()=>onSource?.(paper.accessId,c)}>查看原文片段 {n+1}</button>)}</div>)}</article>)}</details>)}</details>;
}
export function TaskActivity({ task, onStop, project, onSource }) {
  return <div><div className="task-status" role="status"><span className="activity-dot"/><div><span>{task.progress || taskPurposes[task.mode]}</span><small>已保存内容可继续阅读；停止后保留已完成工作。</small></div><button onClick={onStop}>停止</button></div><SavedBatches task={task} project={project} onSource={onSource}/></div>;
}

export function SearchReceipt({ search, previous }) {
  const totals = searchTotals(search), earlier = searchTotals(previous);
  const count = totals ? totals.consistent ? totals.min.toLocaleString() : `${totals.min.toLocaleString()}–${totals.max.toLocaleString()}` : '未知';
  return <div className="search-receipt">
    <div className="search-receipt-counts"><span><strong>{count}</strong>数据库命中</span><span aria-hidden="true">→</span><span><strong>{search.accessIds.length}</strong>实际取得</span><span><strong>{search.missingIds?.length ?? 0}</strong>未取得</span></div>
    <p>{search.searchedAt ? new Date(search.searchedAt).toLocaleString('zh-CN') : '时间未记录'} · 相关性／发表时间各取第 {(search.offset ?? 0) + 1}–{(search.offset ?? 0) + 20} 条，去重后读取题名与摘要。</p>
    {totals && !totals.consistent && <p>两次排序返回的命中量不同，分别保留；不相加。</p>}
    {previous && <p>{previous.query.trim() === search.query.trim() ? '同一检索式上次命中' : '调整前检索式命中'} {earlier ? earlier.consistent ? earlier.min.toLocaleString() : `${earlier.min}–${earlier.max}` : '未知'} 条。{previous.query.trim() === search.query.trim() ? '数据库更新或返回差异都可能影响数量。' : '检索范围有变化，不能据此判断研究趋势。'}</p>}
    {totals?.max === 0 && <p>本次未命中，不等于没有相关研究；可先补全同义词或检查限制条件。</p>}
    {(search.warnings ?? []).map((w,i)=><p key={i} role="status">{w.message}</p>)}
  </div>;
}

export function TargetedMaterialSearch({ query, onQuery, proposal, search, searches = [], previousQuery = '', previousSearch, scopeMode = 'focused', task, busy, configured, configurationPending, recipient, failure, onPrepare, onSearch, onModel, materialReview, focusText, onLibrary, libraryReady }) {
  const disabled = busy || Boolean(task), exactProposal = proposal?.query.trim() === query.trim();
  const prepare = (scope = 'focused', calibrate = false) => onPrepare(`请以${focusText ? `选定专题“${focusText}”` : '当前问题'}为首要研究对象，构建 PubMed 检索式。${scope === 'expanded' ? '我希望查看扩大范围的候选：保留本题的核心对象，说明放宽了哪些场景或次要条件，哪些材料只能间接参考。' : '优先覆盖本题，补全同义词与必要概念，不退回原始宽泛领域。'}${calibrate ? '根据这次实际取得的完整题名／摘要校准，解释噪声或漏检线索及每项词群调整。' : '承接当前检索式与既有反馈。'}不为了凑数量换题，不擅自限定年份、语言或文献类型。`, scope, calibrate);
  const prior = search ? searches[searches.findIndex(s=>s.id===search.id)-1] : null;
  return <details className="scope-details targeted-material-search"><summary>{libraryReady ? '围绕选定专题检索 · 可扩大范围' : '定向检索 · 扩充材料'}</summary>
    <section className="research-entry" aria-label="定向补查材料">
      <div className="topic-search-focus"><span className="eyebrow">{scopeMode === 'expanded' ? '扩展候选范围 · 核心专题保留' : '本题优先'}</span><p>{focusText || '围绕当前问题、分歧或未知，补充下一步需要的材料。'}</p></div>
      <div className="start-actions">{!query.trim() && <button className="primary" disabled={disabled} onClick={()=>prepare()}>为本题构建检索式</button>}{!configured && <button disabled={configurationPending} onClick={onModel}>{configurationPending ? '正在读取模型配置…' : '配置我的模型'}</button>}</div>
      {exactProposal && <div className="scope-summary"><p>{proposal.scope}</p><details className="scope-reason"><summary>词群、范围与调整依据</summary><p>{proposal.explanation}</p><ul>{proposal.questions.map(q => <li key={q}>{q}</li>)}</ul></details></div>}
      <details className="query-settings" open={Boolean(query.trim()) && !exactProposal}><summary>查看或调整检索式{!query.trim() ? ' · 也可直接填写' : ''}</summary><label>PubMed 检索式<textarea aria-label="定向补查 PubMed 检索式" rows={3} value={query} disabled={disabled} onChange={e => onQuery(e.target.value)} placeholder="填写本专题检索式，或先按本题构建"/></label></details>
      {query.trim() && <div className="start-actions"><button className="primary" disabled={disabled} onClick={onSearch}>{task?.mode === 'retrieve' ? '正在获取题名与摘要…' : '检索并查看文献'}</button><button disabled={disabled} onClick={()=>prepare()}>重构本题检索式</button></div>}
      {previousQuery && previousQuery !== query && <details className="search-history"><summary>此前保存的检索草稿</summary><p className="muted">旧草稿保留在这里，可对照本专题后继续使用。</p><code>{previousQuery}</code><div><button disabled={disabled} onClick={()=>onQuery(previousQuery)}>使用这份检索草稿</button></div></details>}
      <div className="scope-expansion"><div><strong>扩展至相邻研究</strong><p>可放宽场景或次要限制，核心专题继续保留。</p></div><button disabled={disabled} onClick={()=>prepare('expanded')}>生成扩大范围的检索式</button></div>
      {search && <><SearchReceipt search={search} previous={prior}/>{search.accessIds.length > 0 && <button disabled={disabled} onClick={()=>prepare(scopeMode,true)}>用本次题名／摘要校准检索式</button>}{libraryReady ? <p className="muted">{search.accessIds.length ? '取得的材料已保存到文献库，纳入与分析范围由你选择。' : '此前材料与筛选保留，可以调整后继续检索。'}</p> : materialReview}{onLibrary && <button disabled={disabled} onClick={onLibrary}>查看专题文献库 →</button>}</>}
      {!search && previousSearch && <p className="muted">检索式已调整，尚未运行。上次材料和记录仍保留。</p>}
      {searches.length > 0 && <details className="search-history"><summary>本专题检索记录 · {searches.length} 次</summary>{[...searches].reverse().map(s=><div key={s.id}><SearchReceipt search={s}/><code>{s.query}</code></div>)}</details>}
      {failure && <p className="entry-feedback" role="status">上次尝试：{failure.error || failure.progress}</p>}
      <p className="entry-boundary">题名与摘要用于初筛；精确方法核查及正式写作按需访问关键全文。{recipient && <span>生成与校准发送至 {recipient}，校准使用本次实际取得的材料；检索式发送至 PubMed。</span>}</p>
    </section>
  </details>;
}

export function ResearchEntry({ query, onQuery, proposal, search, task, busy, currentResult, configured, configurationPending, recipient, failure, onPrepare, onSearch, onResume, onModel, materialReview, selectedCount, embedded = false, prepareLabel, prepareDisabled = false, onMore }) {
  const ready = Boolean(query.trim());
  const queryRef = useRef(), wasTyping = useRef(false);
  const [manualOpen, setManualOpen] = useState(false);
  useEffect(() => { if (wasTyping.current) { queryRef.current?.focus(); wasTyping.current = false; } }, [ready]);
  const exactProposal = proposal?.query.trim() === query.trim();
  const reusable = search?.accessIds.length > 0 && search.query.trim() === query.trim();
  const disabled = busy || Boolean(task);
  const prepare = () => onPrepare('请以当前领域为研究对象，从历年综述内容理解主要发现和认识变化，先构建包含综述的 PubMed 检索式；不默认限定近年，随后按具体内容缺口补代表性研究，篇数随内容覆盖决定，不替我确定题目。');
  const queryEditor = <label>PubMed 检索式<textarea ref={queryRef} aria-label="PubMed 检索式" rows={3} value={query} disabled={disabled} onChange={e => { wasTyping.current = true; setManualOpen(true); onQuery(e.target.value); }} placeholder="输入英文关键词，或用上方按钮生成"/></label>;
  const content = <section className="research-entry" aria-label="开始领域理解">
    {!currentResult && <>
      <ol className="exploration-steps" aria-label="领域理解步骤"><li className={!ready ? 'current' : 'done'}>1 范围与检索式</li><li className={ready && !reusable ? 'current' : reusable ? 'done' : ''}>2 查看与筛选文献</li><li className={reusable ? 'current' : ''}>3 理解与反馈</li></ol>
      <h2>{task ? task.mode === 'clarify' ? '正在构建检索策略…' : task.mode === 'retrieve' ? '正在获取题名与摘要…' : '正在提取文献信息并综合领域证据…' : reusable ? '文献已保存，可开展领域分析' : ready ? '检索范围待确认' : '研究范围与检索策略'}</h2>
    </>}
    {!ready && <><div className="start-actions"><button className="primary" disabled={disabled || prepareDisabled} onClick={prepare}>{prepareLabel || '从历年综述开始'}</button><button className="text-button" disabled={configurationPending} onClick={onModel}>{configurationPending ? '正在读取模型配置…' : configured ? '模型设置' : '配置我的模型'}</button></div><p>按问题与认识的覆盖补充材料，所需篇数随内容决定。</p><details className="scope-details" open={manualOpen} onToggle={e => setManualOpen(e.currentTarget.open)}><summary>填写已有检索式</summary>{queryEditor}</details></>}
    {ready && <div className="scope-summary">
      <p className="eyebrow">{reusable ? '本次检索范围' : '本次准备了解的范围'}</p>
      <p>{exactProposal ? proposal.scope : '按下方检索式开展初步扫描，年份、文献类型和语言条件以检索式为准。'}</p>
      {exactProposal && <details className="scope-reason"><summary>检索依据与未决问题</summary><p>{proposal.explanation}</p>{proposal.questions.length > 0 && <><ul>{proposal.questions.map(q => <li key={q}>{q}</li>)}</ul><p className="muted">可以现在交流，也可以先了解整体，无需逐项填写。</p></>}</details>}
      {reusable ? <><p className="muted">本批取得 {search.accessIds.length} 条题名／摘要；未取得 {search.missingIds?.length ?? 0} 条。{search.warnings?.map(w => w.message).join(' ')}</p>{materialReview}<div className="start-actions"><button className="primary" disabled={disabled || !selectedCount} onClick={onResume}>{task ? '本步正在进行…' : currentResult ? '更新领域认识' : '生成领域认识'}</button>{onMore && search.searches?.some(s => s.total > (search.offset ?? 0) + 20) && <button disabled={disabled} onClick={onMore}>再获取下一批</button>}</div><details className="scope-details"><summary>调整检索范围或重新检索</summary>{queryEditor}<div className="start-actions"><button disabled={disabled} onClick={onSearch}>重新检索</button><button className="text-button" disabled={disabled} onClick={prepare}>根据当前想法重构检索式</button></div></details></>
        : <><details className="query-settings" open={!exactProposal}><summary>查看或调整检索式</summary>{queryEditor}</details><p className="muted">先取相关性和发表时间排序各一批（20 条），可按内容缺口继续获取；批次大小不是分析篇数上限。</p><div className="start-actions"><button className="primary" disabled={disabled} onClick={onSearch}>{task ? '本步正在进行…' : '检索并查看文献'}</button><button className="text-button" disabled={disabled} onClick={prepare}>根据反馈调整范围</button></div></>}
    </div>}
    {failure && <p className="entry-feedback" role="status">上次尝试：{failure.error || failure.progress}</p>}
    <p className="entry-boundary">初步扫描以实际题名、摘要为依据，可随时交流，不代表完整覆盖。{recipient && <span>模型任务的课题记录与所选材料发送至 {recipient}；检索式发送至 PubMed。</span>}</p>
  </section>;
  return currentResult && !embedded ? <details className="scope-details research-entry-shell"><summary>检索范围与材料</summary>{content}</details> : content;
}
