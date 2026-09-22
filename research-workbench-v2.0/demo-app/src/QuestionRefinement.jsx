import {useState} from 'react';

export function QuestionRefinement({target, revision, proposal, sourceTaskId, blocked, onApply}) {
  const [title,setTitle]=useState(proposal?.title || revision.title || revision.text);
  const [text,setText]=useState(proposal?.question || revision.text);
  const [scope,setScope]=useState(proposal?.scope ?? revision.scope ?? '');
  const [error,setError]=useState(''),[saving,setSaving]=useState(false);
  const changed=title!==revision.title || text!==revision.text || scope!==(revision.scope ?? '');
  return <details className="partner-refinement" open={proposal ? true : undefined}>
    <summary>{proposal ? '将交流建议更新到当前选题' : '微调当前选题'}</summary>
    {proposal && <p>{proposal.reason}</p>}
    <details><summary>修改前的题目</summary><p>{revision.title || revision.text}</p><p>{revision.text}</p><p>{revision.scope}</p></details>
    <form onSubmit={async e=>{e.preventDefault();if(blocked||saving)return;setSaving(true);setError('');try{await onApply({itemId:target.id,baseRevisionId:target.revisionId,title:title.trim(),text:text.trim(),scope:scope.trim(),...(sourceTaskId ? {sourceTaskId} : {})});}catch(e){setError(e.message);}finally{setSaving(false);}}}>
      <label>选题名称<input required value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label>具体研究问题<textarea required rows={4} value={text} onChange={e=>setText(e.target.value)}/></label>
      <label>研究范围<textarea rows={3} value={scope} onChange={e=>setScope(e.target.value)}/></label>
      <p>保存后同步主页面和原候选比较中的本题，旧版本保留。改变问题或范围后，需要重新核查价值、周期与设计；采用的研究方案由你另行决定。</p>
      <button className="primary" disabled={blocked||saving||!changed||!title.trim()||!text.trim()}>{saving?'正在更新…':'更新当前选题'}</button>
      {error && <p role="alert">{error}</p>}
    </form>
  </details>;
}
