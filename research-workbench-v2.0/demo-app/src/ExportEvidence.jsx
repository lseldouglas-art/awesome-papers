import {useState} from 'react';
import {api,download} from './ui.jsx';
import {exportZip} from '../../shared/export-bundle.mjs';
export function ExportEvidence({projectId,refs,files,title='研究成果',draft,disabled}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  return <><button disabled={disabled||busy} onClick={async()=>{setBusy(true);setError('');try{
    // Capture the displayed content and references together before awaiting I/O.
    const chosen=structuredClone({refs,files,draft});
    const manifest=await api.request(`/api/projects/${projectId}/provenance`,{method:'POST',body:{refs:chosen.refs}});
    if(chosen.draft)manifest.unsavedFigure={input:chosen.draft,boundary:'导出时的本机输入，尚未保存为版本；不推定使用当前方案或结果。'};
    download(`${title}-成果与依据.zip`,exportZip([...chosen.files,{name:'依据与版本.json',content:JSON.stringify(manifest,null,2)}]),'application/zip');
  }catch(e){setError(e.message);}finally{setBusy(false);}}}>{busy?'正在打包…':'成果与依据 · ZIP'}</button>{error&&<span role="alert">导出未完成：{error}</span>}</>;
}
