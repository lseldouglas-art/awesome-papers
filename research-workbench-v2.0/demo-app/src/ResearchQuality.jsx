import { useState } from 'react';
import { qualityCases, qualityDimensions, qualityCauses } from '../../shared/question-investigation.mjs';

export function QualityComparison({ project, onCommand }) {
  const tasks = Object.values(project.researchTasks ?? {}).filter(t => t.status === 'completed' && t.resultId && project.researchResults[t.resultId]);
  const [caseId, setCase] = useState('recommendation'), [first, setFirst] = useState(''), [second, setSecond] = useState('');
  const [pairId, setPairId] = useState(null), [preference, setPreference] = useState('equal'), [reason, setReason] = useState('');
  const [cause, setCause] = useState('other'), [dimensions, setDimensions] = useState(() => Object.fromEntries(Object.keys(qualityDimensions).map(k => [k, { rating: 'not_checked', location: '' }])));
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const pair = project.researchEvents.find(e => e.id === pairId), reviewed = project.researchEvents.some(e => e.type === 'quality_review' && e.detail.comparisonId === pairId);
  const perform = async fn => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  return <div className="research-quality"><p>比较已保存的真实输出，先看 A／B，再记录哪份更能帮助研究。评价保存在本机；它不代替科学核验。</p>
    <label>本次质量用例<select value={caseId} onChange={e => setCase(e.target.value)}>{qualityCases.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
    {[['第一份输出', first, setFirst], ['第二份输出', second, setSecond]].map(([label, value, set]) => <label key={label}>{label}<select value={value} onChange={e => set(e.target.value)}><option value="">选择实际保存的输出</option>{tasks.map(t => <option key={t.id} value={t.id}>{t.input.text || t.mode} · {t.createdAt}</option>)}</select></label>)}
    <button disabled={busy || !first || !second || first === second} onClick={() => perform(async () => { const r = await onCommand('create-quality-comparison', { caseId, taskIds: [first, second] }); setPairId(r.id); })}>隐藏版本名，开始比较</button>
    {pair && <><div className="quality-versions">{pair.detail.versions.map(v => {
      const task = project.researchTasks[v.taskId], judgment = task.investigation?.phases.find(p => p.key === 'revised')?.value;
      return <article key={v.label}><h3>输出 {v.label}</h3>{judgment?.reason && <p>{judgment.reason}</p>}{project.researchResults[v.resultId]?.blocks.map((b, i) => <section key={b.id}><h4>{v.label}-{i + 1} · {b.headline ?? ''}</h4><p>{b.text}</p></section>)}
        {reviewed && <p>模型 {v.model} · {task.mode} · {task.calls.length} 次调用 · {task.usage?.total_tokens ?? '未知'} tokens · 费用{task.cost?.amount ?? '未知'}</p>}</article>;
    })}</div><label>哪份更有帮助<select value={preference} onChange={e => setPreference(e.target.value)}><option value="equal">差异不明显</option><option value="A">A</option><option value="B">B</option><option value="neither">都未达到要求</option></select></label>
      <label>具体改善、退步或问题<textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="例如：B-3 找到相近研究，改变了我对新颖性的判断…"/></label>
      <details><summary>逐项质量记录（可保留未核对）</summary>{Object.entries(qualityDimensions).map(([k, label]) => <label key={k}>{label}<select value={dimensions[k].rating} onChange={e => setDimensions({ ...dimensions, [k]: { ...dimensions[k], rating: e.target.value } })}>
        <option value="not_checked">未核对</option><option value="missing">缺失</option><option value="generic">泛泛</option><option value="specific">具体充分</option></select><input aria-label={`${label}原文位置`} value={dimensions[k].location} onChange={e => setDimensions({ ...dimensions, [k]: { ...dimensions[k], location: e.target.value } })} placeholder="注明 A／B 段落及理由"/></label>)}</details>
      <label>主要问题归因<select value={cause} onChange={e => setCause(e.target.value)}>{Object.entries(qualityCauses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <button disabled={busy || !reason.trim()} onClick={() => perform(() => onCommand('record-quality-review', { comparisonId: pair.id, preference, reason, dimensions, cause }))}>保存评价并揭示版本</button>
      {reviewed && <p role="status">评价已保存。两份输出的输入、材料和模型可能不同，需据实际条件解释差异。</p>}</>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
