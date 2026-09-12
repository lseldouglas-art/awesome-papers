import { COVERAGE_LABELS, PAPER_FIELDS, INFORMATION_LABELS } from '../../shared/domain-landscape.mjs';
import { useEffect, useRef } from 'react';
import { createClient } from '../../demo-api/src/client.mjs';
import { IconButton } from './icons.jsx';
const api = createClient({ baseUrl: window.location.origin });
const levels = { title: '题名', abstract: '摘要', excerpt: '片段', full_text: '全文文本' };
const date = value => new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const last = object => Object.values(object).at(-1);
function download(name, text, type = 'application/json') { const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a'); a.href = url; a.download = name.replace(/[\\/:*?"<>|]/g, '-'); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function markdown(data) {
  const number = id => data.sources.find(s => s.id === id)?.referenceNumber ?? '?';
  const citations = data.research?.citations ?? [];
  const body = data.revision.blocks.map(b => {
    if (b.type === 'heading') return `## ${b.text}${b.dimensionCoverage ? `\n\n${COVERAGE_LABELS[b.dimensionCoverage]}：${b.dimensionLimitation}` : ''}`;
    if (b.type === 'table') return [b.columns.map(c => c.label).join(' | '), b.columns.map(() => '---').join(' | '), ...b.rows.map(r => b.columns.map(c => r.cells[c.id]).join(' | '))].join('\n');
    const refs = [...new Set(citations.filter(c => c.blockId === b.id).map(c => number(c.sourceId)))];
    return `${b.text}${refs.map(n => ` [${n}]`).join('')}${b.informationStatus === 'inference' ? '\n\n（综合推论）' : ''}`;
  });
  const notes = data.research?.paperNotes?.flatMap(n => [`### [${number(n.sourceId)}] 逐篇整理`, ...(n.fields ? Object.entries(PAPER_FIELDS).flatMap(([key, label]) => [`**${label}**（${INFORMATION_LABELS[n.fields[key].status]}）`, n.fields[key].text, ...n.fields[key].quotes.map(q => `> ${q}`)]) : [n.summary, n.quote ? `> ${n.quote}` : '摘要未报告 / 尚不清楚'])]) ?? [];
  const sources = data.accesses.map(a => {
    const source = data.sources.find(s => s.id === a.sourceId), metadata = data.research?.materialManifest?.find(m => m.accessId === a.id);
    return `### [${number(a.sourceId)}] ${source?.title}\n${metadata ? `${metadata.authors?.join(', ') || '作者未取得'} · ${metadata.year || '年份未取得'}\n` : ''}提供范围：${levels[a.level]}；核验状态：未核验\n\n${a.text}`;
  });
  return [`# ${data.artifact.title}`, `保存版本 ${data.revision.number} · ${data.revision.createdAt}`, ...body,
    ...(notes.length ? ['## 本版本逐篇整理（AI）', ...notes] : []), '## 本版本参考材料', ...sources,
    '## 本版本批注', ...data.annotations.map(a => `> ${a.originalText}\n\n${a.text}`)].join('\n\n');
}
function Modal({ title, children, onClose }) {
  const ref = useRef();
  useEffect(() => { const el = ref.current; el.showModal(); return () => el.close(); }, []);
  return <dialog ref={ref} className="modal" onCancel={e => { e.preventDefault(); onClose(); }}><div className="panel-heading"><h2>{title}</h2><IconButton name="close" label="关闭对话框" onClick={onClose}/></div>{children}</dialog>;
}

export { api, levels, date, last, download, markdown, Modal };
