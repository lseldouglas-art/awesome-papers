import { useState } from 'react';
import { download } from './ui.jsx';
import { literatureRis, pubmedPaperUrl } from '../../shared/literature-links.mjs';

async function localRead(path) {
  const response=await fetch(path);
  const result=await response.json();
  if(!response.ok)throw new Error(result.error?.message??'本机连接失败');
  return result.data;
}
export function ZoteroStatus() {
  const [state,setState]=useState(null),[busy,setBusy]=useState(false);
  return <div className="zotero-status"><button disabled={busy} onClick={async()=>{setBusy(true);try{setState(await localRead('/api/zotero/status'));}catch(e){setState({message:e.message});}finally{setBusy(false);}}}>{busy?'正在连接…':'连接本机 Zotero'}</button><span role="status">{state?`${state.message}${state.version?` · ${state.version}`:''}`:'定位已有条目，或将所选文献导出到 Zotero'}</span></div>;
}
export function PaperAccess({row,projectId}) {
  const [state,setState]=useState(null),[busy,setBusy]=useState(false);
  const url=pubmedPaperUrl(row.source.pmid);
  return <div className="paper-access"><div>{url&&<a href={url} target="_blank" rel="noreferrer">PubMed 文献页 ↗</a>}<button disabled={busy} onClick={async()=>{setBusy(true);try{setState(await localRead(`/api/projects/${encodeURIComponent(projectId)}/zotero-match/${encodeURIComponent(row.id)}`));}catch(e){setState({message:e.message});}finally{setBusy(false);}}}>{busy?'正在定位…':'在 Zotero 中定位'}</button><button onClick={()=>download('文献.ris',literatureRis([row]),'application/x-research-info-systems')}>导出这篇 RIS</button></div>{state&&<div role="status"><small>{state.message}</small>{state.matches?.map(item=><a key={item.key} href={item.href}>打开 Zotero 条目 · {item.matchedBy}匹配 ↗</a>)}</div>}</div>;
}
