import { useEffect, useState } from 'react';
export function BuildNotice({ onReload }) {
  const [next,setNext]=useState(null);
  useEffect(()=>{let stopped=false;const check=async()=>{try{const r=await fetch('/app-version.json',{cache:'no-store'});if(!r.ok)return;const v=await r.json();if(!stopped && v.buildId && v.buildId!==__APP_BUILD_ID__)setNext(v);}catch{}};check();const id=setInterval(check,30000);window.addEventListener('focus',check);return()=>{stopped=true;clearInterval(id);window.removeEventListener('focus',check);};},[]);
  return next ? <div className="build-notice" role="status"><span>新版界面已就绪，你的研究记录保留。</span><button onClick={onReload}>保存并更新界面</button></div> : null;
}
export function BuildLabel(){return <span className="build-label" title="当前页面版本">v{__APP_VERSION__}</span>;}
