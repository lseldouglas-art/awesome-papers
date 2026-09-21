import { useEffect, useState } from 'react';
import { reasoningProfile } from '../../shared/model-analysis.mjs';
import { Modal, api, levels } from './ui.jsx';

export function ModelForm({ capabilities, onClose, onSaved, onTest, busy }) {
  const [url, setUrl] = useState(capabilities?.models.baseUrl ?? ''), [model, setModel] = useState(capabilities?.models.model ?? '');
  const [effort,setEffort]=useState(capabilities?.models.reasoningEffort??'low'), [batchSize,setBatchSize]=useState(capabilities?.models.paperBatchSize??50);
  const [extractionEffort,setExtractionEffort]=useState(capabilities?.models.extractionReasoningEffort??'inherit'), [concurrency,setConcurrency]=useState(capabilities?.models.extractionConcurrency??2);
  const reasoning=reasoningProfile(model,url), selectedEffort=reasoning.options.some(o=>o.value===effort)?effort:reasoning.defaultValue;
  const [inputLimit, setInputLimit] = useState(capabilities?.models.contextLimits?.maxInputTokens ?? '');
  const [outputLimit,setOutputLimit]=useState(capabilities?.models.contextLimits?.maxOutputTokens||'');
  const [key, setKey] = useState(''), [enabled, setEnabled] = useState(capabilities?.models.configured ? capabilities.models.enabled : true);
  const [error, setError] = useState(''), [saving, setSaving] = useState(false), [saved, setSaved] = useState(false);
  const submit = async e => { e.preventDefault(); setError(''); setSaving(true); try { await api.request('/api/model-settings', { method: 'POST', body: { baseUrl: url, model, apiKey: key, enabled, reasoningEffort:selectedEffort, paperBatchSize:Number(batchSize), extractionReasoningEffort:reasoning.options.some(o=>o.value===extractionEffort)?extractionEffort:'inherit', extractionConcurrency:Number(concurrency), contextLimits: inputLimit === '' && outputLimit === '' ? null : { maxInputTokens: inputLimit === '' ? null : Number(inputLimit), maxOutputTokens: outputLimit === '' ? null : Number(outputLimit) } } }); setKey(''); setSaved(true); await onSaved(); } catch (e) { setError(e.message); } finally { setSaving(false); } };
  return <Modal title="本机模型配置" onClose={onClose}><p>使用你的兼容 API。密钥只保存在本机服务的私有配置中，不写入项目、浏览器缓存或导出文件。</p><form onSubmit={submit}>
    {capabilities?.agentPilot?.enabled && <p role="status">选题与方案研判正在使用独立试点：{capabilities.agentPilot.model} · {capabilities.agentPilot.effort}。以下配置用于常规任务和逐篇整理，试点以本机单独配置为准。</p>}
    {capabilities?.agentPilot?.invalid && <p role="alert" className="error-text">科研 Agent 试点配置无效，请修正或关闭本机试点配置后继续选题研判。</p>}
    <label>服务地址<input aria-label="模型服务地址" required type="url" placeholder="https://你的服务地址/v1" value={url} onChange={e => { setUrl(e.target.value); setSaved(false); }}/></label>
    <label>模型名<input aria-label="模型名" required value={model} onChange={e => { setModel(e.target.value); setSaved(false); }}/></label>
    <label>API 密钥<input aria-label="API 密钥" type="password" autoComplete="new-password" value={key} onChange={e => { setKey(e.target.value); setSaved(false); }} placeholder={capabilities?.models.hasKey ? '留空保留同一服务的现有密钥' : '仅在本机填写'}/></label>
    <label>思考模式<select aria-label="思考模式" value={selectedEffort} onChange={e=>{setEffort(e.target.value);setSaved(false);}}>{reasoning.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
    <p className="muted">{reasoning.note} {reasoning.source&&<a href={reasoning.source} target="_blank" rel="noreferrer">官方说明 ↗</a>}</p>
    <label>每批整理篇数<input aria-label="每批整理篇数" type="number" min="1" step="1" required value={batchSize} onChange={e=>{setBatchSize(e.target.value);setSaved(false);}}/></label>
    <p className="muted">默认 50 篇，可按模型能力调小。输入额度或实际输出容量不足时会拆分，保留已完成整理，完整处理所选材料。设置对下一次开始或接续的任务生效。</p>
    <label>逐篇整理思考档位<select aria-label="逐篇整理思考档位" value={reasoning.options.some(o=>o.value===extractionEffort)?extractionEffort:'inherit'} onChange={e=>{setExtractionEffort(e.target.value);setSaved(false);}}><option value="inherit">跟随本次任务档位</option>{reasoning.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
    <p className="muted">仅用于逐篇提取；综合领域认识与选题判断仍使用本次任务档位。低档可能更快，提取质量需结合原文核对。</p>
    <label>同时整理批数<select aria-label="同时整理批数" value={concurrency} onChange={e=>{setConcurrency(e.target.value);setSaved(false);}}>{[1,2,3,4].map(n=><option key={n} value={n}>{n===1?'1 · 逐批处理':`${n} · 并行处理`}</option>)}</select></label>
    <p className="muted">默认同时处理 2 批独立材料，请按服务商并发额度调整。遇到错误停止派发新批，保存已返回成果；不会自动重发失败请求。设置用于下一次开始或接续，正在运行的任务保持原设置。</p>
    <details><summary>服务商的材料处理能力（可选）</summary>{reasoning.source&&<><label>单次输出额度（tokens）<input aria-label="模型输出额度" type="number" min="1" max="131072" step="1" value={outputLimit} onChange={e=>{setOutputLimit(e.target.value);setSaved(false);}} placeholder="自动：最高档综合64K，其余32K"/></label><p className="muted">留空时最高档的领域／专题综合使用64K，其余请求32K；显式填写后覆盖自动值。模型可提前结束。更大额度可能增加等待与费用，不代表内容质量更高；自动64K配置的等待上限为24分钟，手动额度相应调整，可随时停止。</p></>}<p className="muted">仅在服务商明确给出输入额度时填写。超出单次额度会完整分批整理并保留覆盖记录；不填时不设置材料数量限制。</p><label>单次实际可用输入额度（tokens）<input aria-label="模型输入额度" type="number" min="1" step="1" value={inputLimit} onChange={e => setInputLimit(e.target.value)} placeholder="按服务商的真实限制填写"/></label></details>
    <label className="check-label"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}/>启用这项模型服务</label>
    <p className="muted">Demo 不设固定调用次数上限，累计请求 {capabilities?.budget.used ?? 0} 次。连接测试、失败与取消的调用均保留记录；文献格式或覆盖错误最多补救一次；输出容量不足时拆分剩余材料，网络与服务错误不会自动重发。费用按实际返回记录，未知时显示未知。</p>
    {error && <p role="alert" className="error-text">{error}</p>}{saved && <p role="status">配置已保存，可以开始测试或返回课题。</p>}
    <div className="modal-actions"><button type="button" disabled={!onTest || !saved || !enabled || busy} onClick={onTest}>测试连接（1 次）</button><button className="primary" disabled={saving}>{saving ? '正在保存…' : '保存配置'}</button></div>
  </form></Modal>;
}
export function SourceForm({ busy, onClose, onSubmit, error }) {
  const [title, setTitle] = useState(''), [text, setText] = useState(''), [level, setLevel] = useState('excerpt');
  return <Modal title="补充参考材料" onClose={onClose}><form onSubmit={e => { e.preventDefault(); onSubmit({ title, text, contentLevel: level }); }}><p>保存你实际提供的内容。发送给模型前，可在本次材料范围中选择。</p><label>材料题名<input required maxLength={1000} value={title} onChange={e => setTitle(e.target.value)}/></label><label>提供范围<select value={level} onChange={e => setLevel(e.target.value)}>{Object.entries(levels).map(([key, name]) => <option value={key} key={key}>{name}</option>)}</select></label>{level !== 'title' && <label>实际文本<textarea required rows={6} maxLength={500000} value={text} onChange={e => setText(e.target.value)}/></label>}<p className="muted">标注为“你提供的内容 · 未核验”。</p>{error && <p role="alert" className="error-text">{error}</p>}<div className="modal-actions"><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={busy}>保存并关联</button></div></form></Modal>;
}
export function ProjectForm({ onIntake, project, busy, onClose, onSubmit, error }) {
  const [name, setName] = useState(project.name), [goal, setGoal] = useState(project.goal), [conditions, setConditions] = useState(project.conditions ?? '');
  return <Modal title="课题信息" onClose={onClose}>{onIntake&&<button className="text-button" disabled={busy} onClick={onIntake}>查看或补充研究画像与起步计划</button>}<form onSubmit={e => { e.preventDefault(); onSubmit({ name, goal, conditions, baseVersion: project.metadataVersion }); }}><label>课题名称<input value={name} required maxLength={200} onChange={e => setName(e.target.value)}/></label><label>当前目标<textarea rows={3} maxLength={10000} value={goal} onChange={e => setGoal(e.target.value)}/></label><label>现实条件<textarea rows={3} maxLength={10000} value={conditions} onChange={e => setConditions(e.target.value)}/></label><details><summary>查看原始想法与调整记录</summary><blockquote>{project.originalGoal}</blockquote>{project.metadataHistory.map((h, i) => <p key={i}>{h.goal}</p>)}</details>{error && <p role="alert" className="error-text">{error}</p>}<div className="modal-actions"><button className="primary" disabled={busy}>保存课题信息</button></div></form></Modal>;
}
