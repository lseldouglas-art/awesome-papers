import {useEffect,useState} from 'react';
import {api} from './ui.jsx';

// Receipts are fetched only when requested; raw model output remains server-side.
export function RuntimeReceipts({projectId,task}) {
  const [open,setOpen]=useState(false),[calls,setCalls]=useState(null),[error,setError]=useState('');
  useEffect(()=>{
    setCalls(null);setError('');
    if(!open)return;
    const controller=new AbortController();let alive=true;
    api.request(`/api/model-calls?view=summary&projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(task.id)}`,{signal:controller.signal})
      .then(v=>{if(alive)setCalls(v);}).catch(e=>{if(alive)setError(e.message);});
    return()=>{alive=false;controller.abort();};
  },[open,projectId,task.id,task.status,task.calls.length]);
  return <details className="runtime-receipts" onToggle={e=>{if(e.target===e.currentTarget)setOpen(e.currentTarget.open);}}>
    <summary>调用记录 · {task.calls.length} 条 · 查看模型与耗时</summary>
    {open&&(error?<p role="alert">{error}</p>:!calls?<p>正在读取调用记录…</p>:calls.map(c=><div key={c.id}>
      <p><b>{c.provenance?.model??c.model??'模型未记录'}</b> · {c.runtime==='claude-agent-sdk'?'科研 Agent':'直接模型请求'} · {c.finishedAt?`${Math.max(0,Math.round((Date.parse(c.finishedAt)-Date.parse(c.startedAt))/1000))} 秒`:'尚未结束'}</p>
      {c.runtime==='claude-agent-sdk'?<small>SDK 查询 {c.runtimeMetrics?.sdkQueries??'未知'} 次 · 运行轮次 {c.runtimeMetrics?.sdkTurns??'未知'} · 底层模型请求 {c.runtimeMetrics?.physicalCallCount??'未知'} 次</small>:<small>直接请求记录 1 条 · 输入约 {c.inputCharacters?.toLocaleString()??'未知'} 字符</small>}
      {c.runtime==='claude-agent-sdk'&&<p>工具可读材料 {c.inputBreakdown?.toolMaterialCount??'未记录'} 份 · 本次读取记录 {c.readReceiptCount??'未知'} 条</p>}
      {c.runtime!=='claude-agent-sdk'&&c.inputBreakdown&&<p>随请求发送 {c.inputBreakdown.materialCount} 份材料 · 材料约 {c.inputBreakdown.materialCharacters.toLocaleString()} 字符 · 指令与上下文约 {c.inputBreakdown.instructionCharacters.toLocaleString()} 字符</p>}
      <small>费用{c.cost?.status==='unknown'||c.cost?.amount==null?'未知':`${c.cost.amount} ${c.cost.currency??''}`}</small>
    </div>))}
  </details>;
}
