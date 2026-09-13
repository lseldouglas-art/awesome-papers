import { matchesRetrievalScope, retrievalQuery, retrievalRangeLabel, retrievalScopeError, setRetrievalRange } from '../../shared/retrieval-scope.mjs';
import './retrieval-scope.css';

export function RetrievalScope({ query, options, onChange, onSearch, search, disabled }) {
  const error = retrievalScopeError(options), same = !error && matchesRetrievalScope(search, query, options);
  const resume = same && ['running', 'incomplete', 'paused'].includes(search.status);
  const plan = search?.plan, obtained = search?.retrievedCount ?? search?.accessIds?.length ?? 0;
  const failed = search?.missingIds?.length ?? 0;
  const actualQuery = !error ? retrievalQuery(query, options) : '';
  const change = patch => onChange({ ...options, ...patch });
  return <section className="retrieval-scope" aria-label="直接选择文献获取范围">
    <fieldset disabled={disabled}><legend>选择范围，一次获取</legend>
      <div className="retrieval-controls">
        <label>时间范围<select aria-label="时间范围" value={options.range} onChange={e => onChange(setRetrievalRange(options, e.target.value))}>
          <option value="recent5">近五年</option><option value="all">全部年份（含早期综述）</option><option value="custom">自定义日期</option>
        </select></label>
        <label>文献类型<select aria-label="文献类型" value={options.type} onChange={e => change({ type: e.target.value })}>
          <option value="reviews">综述（含系统综述与 Meta 分析）</option><option value="systematic">系统综述与 Meta 分析</option><option value="any">沿用检索式，不额外限制</option>
        </select></label>
        <label>获取数量<select aria-label="获取数量" value={options.limit} onChange={e => change({ limit: e.target.value === 'all' ? 'all' : Number(e.target.value) })}>
          <option value="all">范围内全部</option><option value="100">先获取 100 篇</option><option value="500">先获取 500 篇</option><option value="1000">先获取 1000 篇</option>
        </select></label>
        <label>排序<select aria-label="排序" value={options.sort} onChange={e => change({ sort: e.target.value })}>
          <option value="pub_date">发表时间：新到旧</option><option value="relevance">相关性</option>
        </select></label>
      </div>
      {options.range === 'custom' && <div className="retrieval-dates"><label>开始日期<input type="date" value={options.from} onChange={e => change({ from: e.target.value })}/></label><label>结束日期<input type="date" value={options.to} onChange={e => change({ to: e.target.value })}/></label></div>}
      <p className="retrieval-hint">{retrievalRangeLabel(options)} · 获取题名与摘要，无需等待模型；已有材料和报告保留。</p>
      {options.range === 'all' ? <p className="retrieval-hint">完整获取历年候选后，可按内容挑选代表性综述；相关性排名不等于代表性。</p> : <p className="retrieval-hint">需要早期代表作时，切换“全部年份”；先前选中的早期材料不会被移除。</p>}
      {error && <p role="alert" className="entry-feedback">{error}</p>}
      <div className="retrieval-actions"><button className="primary" disabled={disabled || Boolean(error) || !query.trim()} onClick={() => onSearch({ retrievalOptions: options, ...(resume ? { resumeSearchId: search.id } : {}) })}>
        {resume ? '继续获取未完成文献' : options.limit === 'all' ? '获取范围内全部文献' : `获取前 ${options.limit} 篇`}
      </button>{actualQuery && <a href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(actualQuery)}&sort=${options.sort === 'pub_date' ? 'date' : 'relevance'}`} target="_blank" rel="noreferrer">在 PubMed 查看同一检索范围 ↗</a>}</div>
    </fieldset>
    {search && <div className="retrieval-receipt" role="status">
      <strong>{same ? search.status === 'completed' ? '所选获取范围已完成' : '本次获取进度' : '上次检索记录（下次按上方选择获取）'}</strong>
      {plan ? <><div className="retrieval-counts"><span>范围命中 <b>{plan.total}</b></span><span>计划获取 <b>{plan.target}</b></span><span>已保存 <b>{obtained}</b></span><span>尚待获取 <b>{Math.max(0, plan.target - obtained - failed)}</b></span>{failed > 0 && <span>未取到 <b>{failed}</b></span>}</div><small>{search.dateRange}{search.reusedCount > 0 ? ` · 复用已存 ${search.reusedCount} 篇` : ''} · 获取完成不等于筛选或分析完成</small></> : <p>此前取样已保存 {obtained} 篇；可直接改为获取完整范围。</p>}
    </div>}
    <details className="retrieval-effective"><summary>查看实际检索条件</summary><code>{actualQuery || query}</code><p>上方选择会附加到当前检索式；式中原有的年份、类型和语言条件仍然生效，可在检索式中直接修改。</p></details>
  </section>;
}
