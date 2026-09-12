import { PAPER_FIELDS, COVERAGE_LABELS, INFORMATION_LABELS } from '../../shared/domain-landscape.mjs';
import { referenceNumbers } from '../../shared/material-scope.mjs';

export function MaterialReview({ project, ids, selectedIds, onSelection, disabled, onSource }) {
  const numbers = referenceNumbers(project);
  return <div className="material-review" aria-label="检索结果与材料筛选">
    <div className="material-review-toolbar"><strong>已取得 {ids.length} 篇 · 已选 {ids.filter(id => selectedIds.includes(id)).length} 篇</strong><div><button className="text-button" disabled={disabled} onClick={() => onSelection([...new Set([...selectedIds, ...ids])])}>全选</button><button className="text-button" disabled={disabled} onClick={() => onSelection(selectedIds.filter(id => !ids.includes(id)))}>清空本组</button></div></div>
    {selectedIds.some(id => !ids.includes(id)) && <p className="muted">另选 {selectedIds.filter(id => !ids.includes(id)).length} 份已有材料。<button className="text-button" onClick={() => onSource(null)}>查看全部所选材料</button></p>}
    <p className="muted">新检索结果默认全选。可查看题名、摘要并排除不相关材料；选择只决定本次分析范围，不会删除文献。</p>
    <details><summary>查看与筛选 {ids.length} 篇文献</summary><ul className="material-review-list">{ids.map(id => {
      const access = project.accesses[id], source = project.sources[access.sourceId];
      return <li key={id}><input type="checkbox" aria-label={`分析文献 ${numbers[source.id]} ${source.title}`} checked={selectedIds.includes(id)} disabled={disabled} onChange={e => onSelection(e.target.checked ? [...new Set([...selectedIds, id])] : selectedIds.filter(value => value !== id))}/><div><button className="paper-title" onClick={() => onSource(id)}>[{numbers[source.id]}] {source.title}</button><small>{source.year || source.published || '年份未取得'} · {source.authors?.join(', ') || '作者未取得'} · {access.level === 'abstract' ? '摘要' : access.level === 'title' ? '仅题名' : '已提供文本'}</small></div></li>;
    })}</ul></details>
  </div>;
}

export function ResearchCoverage({ project, result, onSource }) {
  if (!result) return null;
  const numbers = referenceNumbers(project);
  const cited = new Set(result.citations.map(c => numbers[c.sourceId]));
  return <div className="research-coverage" aria-label="本次分析覆盖">
    <p>送入模型 <strong>{result.accessIds.length}</strong> 份材料 · 简报引用 <strong>{cited.size}</strong> 篇{result.paperNotes && <> · 逐篇整理 <strong>{result.paperNotes.length}</strong> 份</>}</p>
    {result.materialCoverage && <p className="muted">所选材料年份：{result.materialCoverage.minYear ? `${result.materialCoverage.minYear}—${result.materialCoverage.maxYear}` : '未取得'}{result.materialCoverage.unknownYearCount > 0 && `；另有 ${result.materialCoverage.unknownYearCount} 份年份未知`}。年份跨度不代表历史完整覆盖。</p>}
    {result.dimensions ? <details className="dimension-summary"><summary>七个分析维度与覆盖边界</summary><ul>{result.dimensions.map(d => <li key={d.id}><strong>{d.label}</strong><span>{COVERAGE_LABELS[d.coverage]}</span><p>{d.limitation}</p></li>)}</ul></details> : <p className="muted">这份旧简报尚未按七个维度整理。可在底部选择“根据反馈更新简报”，使用当前所选材料补充分析。</p>}
    <details><summary>{result.paperNotes ? '查看逐篇整理与依据' : '查看本简报使用的材料'}</summary>
      {!result.paperNotes && <p className="muted">旧简报没有保存逐篇整理记录；送入材料数量不代表每篇都已核验。可以使用已存材料重新分析。</p>}
      <ol className="paper-notes">{result.accessIds.map(id => {
        const access = project.accesses[id], source = project.sources[access?.sourceId];
        if (!source) return null;
        const note = result.paperNotes?.find(n => n.accessId === id);
        return <li key={id}><button className="paper-title" onClick={() => onSource(id)}>[{numbers[source.id]}] {source.title}</button><small>{source.year || source.published || '年份未取得'} · {cited.has(numbers[source.id]) ? '简报已引用' : '简报未引用'}</small>{note && <><p>{note.summary}</p>{note.fields ? <details className="paper-fields"><summary>对象、方法、发现与局限</summary><dl>{Object.entries(PAPER_FIELDS).map(([key, label]) => { const field = note.fields[key]; return <div key={key}><dt>{label}</dt><dd><p>{field.text}</p><small>{INFORMATION_LABELS[field.status]}</small>{field.quotes.map((quote, i) => <button className="text-button" key={i} onClick={() => onSource(id, { accessId: id, sourceId: source.id, quote, passage: field.passages[i] })}>查看原文{field.quotes.length > 1 ? ` ${i + 1}` : ''}</button>)}</dd></div>; })}</dl></details> : <>{note.status === 'unknown' && <small>摘要未报告 / 尚不清楚</small>}{note.quote && <blockquote>{note.quote}</blockquote>}</>}</>}</li>;
      })}</ol>
    </details>
    <small>{result.paperNotes ? '逐篇整理来自 AI，摘录与实际材料对应；科学判断仍由你作出。' : '引用编号在本课题内保持一致；旧简报尚无逐篇整理记录。'}</small>
  </div>;
}
