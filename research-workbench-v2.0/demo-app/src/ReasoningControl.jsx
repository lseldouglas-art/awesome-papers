import { useEffect, useState } from 'react';
import { reasoningProfile } from '../../shared/model-analysis.mjs';
import './reasoning-control.css';

const changeEvent = 'rw-reasoning-choice';
export function useReasoningChoice(model) {
  const profile = model?.reasoning ?? reasoningProfile(model?.model, model?.baseUrl);
  const key = model?.model ? `rw2:reasoning-choice:v1:${model.baseUrl}:${model.model}` : '';
  const read = () => { try { return key ? localStorage.getItem(key) : null; } catch { return null; } };
  const [choice, setChoice] = useState(() => ({ key, value: read() }));
  useEffect(() => {
    const update = () => setChoice({ key, value: read() });
    update(); window.addEventListener(changeEvent, update); window.addEventListener('storage', update);
    return () => { window.removeEventListener(changeEvent, update); window.removeEventListener('storage', update); };
  }, [key]);
  const stored = choice.key === key ? choice.value : read();
  const value = profile.options.some(o => o.value === stored) ? stored : model?.reasoningEffort ?? profile.defaultValue;
  return { value, onChange: value => {
    try { localStorage.setItem(key, value); window.dispatchEvent(new Event(changeEvent)); } catch { /* Keep this choice in memory. */ }
    setChoice({ key, value });
  } };
}

export function ReasoningControl({ model, value, onChange, disabled, onConfigure }) {
  if (!model?.configured) return <button type="button" className="reasoning-unconfigured" disabled={!model || disabled} onClick={onConfigure}>{model ? '配置科研模型' : '读取模型设置…'}</button>;
  const profile = model.reasoning ?? reasoningProfile(model.model, model.baseUrl);
  return <div className="reasoning-control"><span className="reasoning-model" title={model.model}>{model.model}</span>
    <label><span>思考</span><select aria-label="模型思考程度" value={value} disabled={disabled || profile.options.length < 2} onChange={e => onChange(e.target.value)} title="用于下一次开始的任务；已开始任务保持原档位">
      {profile.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select></label>
  </div>;
}
