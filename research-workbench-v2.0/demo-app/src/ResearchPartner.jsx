import { useState } from 'react';
import { investigationTasks, investigationSections, recommendationLabels, investigationPhaseLabels } from '../../shared/question-investigation.mjs';
import { protocolFields } from '../../shared/research-continuity.mjs';
import { setRetrievalRange, retrievalScopeError } from '../../shared/retrieval-scope.mjs';
import { QualityComparison } from './ResearchQuality.jsx';
import './research-partner.css';

const running = t => ['queued', 'running'].includes(t?.status);
const stateLabels = { reported: '材料报告', inference: '据材料推论', unknown: '尚未确定', suggestion: '拟议判断' };
function Claims({ claims, project, onSource }) {
  return (claims ?? []).map((c, i) => <section className="partner-claim" key={`${c.key}-${i}`}>
    <h4>{c.headline || investigationSections[c.key] || '核查发现'}</h4><p>{c.text}</p><small>{stateLabels[c.status]}</small>
    {c.citations?.length > 0 && <details><summary>查看依据 · {c.citations.length}</summary>{c.citations.map((ref, j) =>
      <div key={j}><button className="text-button" onClick={() => onSource(ref.accessId, ref)}>{project.sources[ref.sourceId]?.title ?? ref.ref}</button>
        <small>{({ title: '题名', abstract: '摘要', fulltext: '全文' })[ref.level] ?? '实际访问片段'} · 原文定位</small><blockquote>{ref.quote}</blockquote></div>)}</details>}
  </section>);
}
function Judgment({ phase, project, onSource }) {
  const v = phase.value;
  return <div className="partner-judgment">
    <div className="partner-phase-title"><span>{investigationPhaseLabels[phase.key]}</span>{v.recommendation && <strong>{recommendationLabels[v.recommendation]}</strong>}</div>
    <p className="partner-reason">{v.reason ?? v.point}</p>
    {phase.key === 'initial' && <small>阶段结果 · 先读 {phase.readCount} 份或片段，本轮选择 {phase.selectedCount} 份；专项核查尚未完成。</small>}
    {v.why && <p>{v.why}</p>}{v.wouldChange && <p>改变判断的条件：{v.wouldChange}</p>}
    {v.changed && <p className="partner-change">{v.changed}</p>}
    <details className="partner-argument"><summary>展开具体比较与依据</summary><Claims claims={v.claims ?? v.findings} project={project} onSource={onSource}/></details>
    {v.unknowns?.length > 0 && <details><summary>仍未解决</summary><ul>{v.unknowns.map((u, i) => <li key={i}>{u}</li>)}</ul></details>}
    {v.next && <p><b>接下来：</b>{v.next}</p>}
  </div>;
}
export function ResearchPartner({ project, artifact, target, accessIds, disabled, activeTask, onRun, onStop, onCommand, onSource, onTarget, model }) {
  const key = `rw2:partner:v1:${project.id}:${target.id}:${target.revisionId}`;
  const [message, setMessage] = useState(() => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } });
  const [search, setSearch] = useState('saved'), [allowFulltext, setAllowFulltext] = useState(false), [options, setOptions] = useState(() => setRetrievalRange({ type: 'any' }, 'all'));
  const [error, setError] = useState(''), [working, setWorking] = useState(false), [quality, setQuality] = useState(false);
  const tasks = investigationTasks(project, target), latest = tasks.at(-1), phases = latest?.investigation?.phases ?? [];
  const sameVersion = latest?.input.itemTarget.revisionId === target.revisionId;
  const revision = project.researchItems[target.id]?.revisions.find(v => v.id === target.revisionId);
  const update = text => { setMessage(text); try { localStorage.setItem(key, text); } catch { /* Editing remains usable without storage. */ } };
  const execute = async fn => { if (working) return; setWorking(true); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setWorking(false); } };
  const submit = () => execute(async () => {
    if (!message.trim()) return;
    if (target.kind === 'protocol') {
      const result = await onCommand('research-partner-action', { itemId: target.id, revisionId: target.revisionId, userText: message });
      if (result.handled) { update(''); onTarget({ ...target, revisionId: result.revisionId }); return; }
    }
    const started = await onRun(message, { itemId: target.id, itemRevisionId: target.revisionId, accessIds,
      investigationOptions: { search, allowFulltext, ...(search === 'pubmed' ? { retrievalOptions: options } : {}) } });
    if (started) update('');
  });
  const revised = phases.find(v => v.key === 'revised'), latestPhase = revised ?? phases.at(-1);
  const blocked = disabled || working || Boolean(activeTask);
  return <section className="research-partner" aria-label="围绕当前题目与方案研判">
    <header className="partner-target"><small>正在讨论 · {target.kind === 'protocol' ? '研究方案' : '候选题目'} · 第 {revision?.number ?? 1} 版</small><h3>{target.title || target.text}</h3>
      <button className="text-button" aria-pressed={quality} onClick={() => setQuality(!quality)}>{quality ? '返回研判' : '比较研究质量'}</button></header>
    {quality ? <QualityComparison project={project} onCommand={onCommand}/> : <>
      {latestPhase && <Judgment phase={latestPhase} project={project} onSource={onSource}/>}
      <div className="partner-shortcuts">{(target.kind === 'protocol' ? ['比较两种设计的取舍', '解释这项主要结局为什么合适', '按我的条件缩小方案'] :
        ['结合我的条件，这个题到底值不值得做？', '找出最强反例，核查后更新建议', '比较最小可行方案与更强证据方案']).map(t => <button key={t} disabled={blocked} onClick={() => update(t)}>{t}</button>)}</div>
      <form onSubmit={e => { e.preventDefault(); submit(); }} className="partner-composer">
        <label htmlFor="partner-message">围绕当前内容继续<textarea id="partner-message" aria-label="围绕当前内容继续" value={message} rows={3} onChange={e => update(e.target.value)} placeholder="说明你的疑问，或补充一项现实条件…"/></label>
        <details className="partner-scope"><summary>本轮使用已选 {accessIds.length} 份材料 · {search === 'saved' ? '仅查已有材料' : '允许补查 PubMed'}</summary>
          <p>会完整整理所选资料，再按本次问题提取依据。可在材料列表调整选择；旧引用之外的已选材料也参与核查。</p>
          <label>核查范围<select value={search} disabled={blocked} onChange={e => setSearch(e.target.value)}><option value="saved">仅查本次所选材料</option><option value="pubmed">先查所选材料，再按需补查 PubMed</option></select></label>
          <label className="partner-fulltext-choice"><input type="checkbox" checked={allowFulltext} disabled={blocked} onChange={e=>setAllowFulltext(e.target.checked)}/>决定性方法或数值需要时，允许读取一篇关键开放全文</label>
          {search === 'pubmed' && <><label>年份<select value={options.range} disabled={blocked} onChange={e => setOptions(setRetrievalRange(options, e.target.value))}><option value="all">全部年份</option><option value="recent5">最近五年</option></select></label>
            <label>文献类型<select value={options.type} disabled={blocked} onChange={e => setOptions({ ...options, type: e.target.value })}><option value="any">所有研究类型</option><option value="reviews">综述</option><option value="systematic">系统综述或荟萃分析</option></select></label>
            <label>获取数量<input aria-label="补查获取数量" disabled={blocked} value={options.limit === 'all' ? '全部' : options.limit} onChange={e => setOptions({ ...options, limit: e.target.value === '全部' ? 'all' : Number(e.target.value) })}/></label><small>填“全部”或具体数量；按发表时间排序。只核查一个最可能改变建议的问题，不额外限制论文数。</small></>}
          <p>当前科研模型：{model?.model ?? '读取配置中'}。任务按已配置档位运行，费用以实际记录为准。</p>
        </details>
        <button className="primary" disabled={blocked || !message.trim() || search === 'pubmed' && Boolean(retrievalScopeError(options))}>给出初判并核查</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {activeTask?.mode === 'question-investigation' && activeTask.input.itemTarget?.itemId === target.id && <div className="partner-progress" role="status"><p>{activeTask.progress}</p><button onClick={() => execute(() => onStop(activeTask))}>停止本轮，保留已完成内容</button></div>}
      {latest && !sameVersion && <p className="partner-change">以下是此前题目版本的讨论；新一轮会带入你的纠正并重新判断。</p>}
      {latest?.staleInput && <p className="partner-change">任务期间研究条件或采用内容发生变化。这份判断保留原依据，请按当前内容继续核查。</p>}
      {revised?.value.protocol && <details className="partner-protocol"><summary>研究路线形成的方案草案</summary><p>模型拟议内容；保存草案后可精确编辑，采用会改变后续工作的依据。</p>
        {Object.entries(protocolFields).filter(([k]) => revised.value.protocol[k]).map(([k, label]) => <section key={k}><h4>{label}</h4><p>{revised.value.protocol[k]}</p></section>)}
        <div className="partner-actions">{[['save', '保存为方案草案'], ['adopt', '采用这份方案']].map(([action, label]) => <button key={action} disabled={blocked || !sameVersion || latest.staleInput} onClick={() => execute(async () => {
          const result = await onCommand('apply-research-proposal', { taskId: latest.id, action });
          onTarget({ id: result.itemId, revisionId: result.revisionId, text: revised.value.protocol.question, kind: 'protocol' });
        })}>{label}</button>)}</div></details>}
      {latest && ['failed', 'cancelled', 'interrupted'].includes(latest.status) && <div className="partner-progress"><p>{latest.error || '本轮中断，已完成阶段与材料整理保留。'}</p><button disabled={blocked} onClick={() => execute(() => onRun(latest.input.text, {
        itemId: latest.input.itemTarget.itemId, itemRevisionId: latest.input.itemTarget.revisionId, accessIds: latest.input.materials.map(m => m.accessId),
        investigationOptions: latest.input.investigation.options, retryOf: latest.id }))}>只继续未完成部分</button></div>}
      {latest && <details className="partner-history"><summary>本轮过程与实际范围</summary>{phases.filter(p => p !== latestPhase).map(p => <Judgment key={p.key} phase={p} project={project} onSource={onSource}/>)}
        {latest.investigation?.searches?.map(s => <p key={s.id}>{s.query}<br/>{s.coverage ?? '专项检索尚未完成'}</p>)}
        {latest.investigation?.fulltext && <p>关键全文：{latest.investigation.fulltext.status==='completed'?'已取得并纳入核查':'未取得，相关方法与数值仍待核对'} · {latest.investigation.fulltext.reason}</p>}
        <p>实际调用 {latest.calls.length} 次 · 科研模型 {latest.model} · 费用{latest.cost?.status === 'unknown' ? '未知' : latest.cost?.amount ?? '未知'}</p>
        {latest.investigation?.coverage && <p>选择 {latest.investigation.coverage.selected.length} 份 · 总共取得 {latest.investigation.coverage.acquired.length} 份 · 最终引用 {latest.investigation.coverage.cited.length} 份</p>}
        {phases.map(p => <p key={p.key}>{investigationPhaseLabels[p.key]}：{Math.round((Date.parse(p.finishedAt) - Date.parse(p.startedAt)) / 1000)} 秒</p>)}</details>}
      {tasks.length > 1 && <details className="partner-history"><summary>同一问题的此前讨论 · {tasks.length - 1}</summary>{tasks.slice(0, -1).reverse().map(t => <details key={t.id}><summary>{t.input.text || '此前研判'}</summary>
        {(t.investigation?.phases ?? []).filter(p => p.key === 'revised' || p.key === 'initial' && !t.investigation.phases.some(p => p.key === 'revised')).map(p => <Judgment key={p.key} phase={p} project={project} onSource={onSource}/>)}</details>)}</details>}
    </>}
  </section>;
}
