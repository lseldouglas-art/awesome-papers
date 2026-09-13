import {setRetrievalRange} from '../../shared/retrieval-scope.mjs';
import { useState } from 'react';
import { BookOpen, FileText, ChartBar, MagnifyingGlass } from '@phosphor-icons/react';
import { Modal } from './ui.jsx';
import { ResearchEntry } from './ResearchEntry.jsx';
import { domainSupplementPrompt } from '../../shared/domain-presentation.mjs';
const kindsInfo=[['历年综述','补齐研究问题与结论的变化',BookOpen],['代表性原始研究','查找支撑关键认识的研究',FileText],['后续验证与长期随访','查看结论是否被更新或修正',ChartBar]];
export function DomainSupplement({ request, goal, onClose, inline=false, ...entry }) {
  const [focus,setFocus]=useState(request.focus),[expanded,setExpanded]=useState(Boolean(request.expanded));
  const [kinds,setKinds]=useState(request.kinds||['历年综述','代表性原始研究']);
  const [originalProposal]=useState(entry.proposal?.taskId),[manual,setManual]=useState(false),[preparedKey,setPreparedKey]=useState(null);
  const planKey=JSON.stringify([focus,kinds,expanded]),fresh=preparedKey===planKey&&entry.proposal?.taskId&&entry.proposal.taskId!==originalProposal,ready=fresh||manual;
  const disabled=entry.busy||Boolean(entry.task);
  const content=<div className={`domain-search-modal ${inline?'is-inline':''}`}>
    <header className="domain-plan-header"><FileText size={38}/><div><h2>补齐这段认识</h2><p>围绕当前问题，补充能改变判断的材料。</p></div></header>
    <label className="domain-focus-label">要回答的问题<textarea className="domain-search-focus" aria-label="补充材料要回答的问题" rows={2} value={focus} disabled={disabled} onChange={e=>{setFocus(e.target.value);setManual(false);}}/></label>
    <h3 className="domain-plan-subtitle">准备获取</h3><div className="domain-search-kinds">{kindsInfo.map(([kind,caption,Icon])=><label key={kind}><input type="checkbox" checked={kinds.includes(kind)} disabled={disabled} onChange={e=>{setManual(false);setKinds(v=>e.target.checked?[...v,kind]:v.filter(k=>k!==kind));}}/><Icon size={30}/><span><strong>{kind}</strong><small>{caption}</small></span></label>)}</div>
    <div className="domain-object-preserved"><h3>保留研究对象</h3><span>{goal}</span></div>
    <label className="domain-expansion-choice"><input type="checkbox" checked={expanded} disabled={disabled} onChange={e=>{setManual(false);setExpanded(e.target.checked);}}/>扩大相邻范围，保留当前研究对象</label>
    <div className="domain-plan-search"><MagnifyingGlass size={18}/><span>PubMed · 按内容缺口补充综述与代表性研究</span></div>
    <ResearchEntry {...entry} onResume={()=>entry.onResume(focus)} embedded currentResult={{kind:'brief'}} query={ready?entry.query:''} search={ready?entry.search:null} proposal={fresh?entry.proposal:null} onQuery={value=>{setManual(true);entry.onQuery(value);}} prepareLabel="生成补充检索式" onPrepare={()=>{entry.onRetrievalOptions(setRetrievalRange({...entry.retrievalOptions,type:kinds.some(k=>k!=='历年综述')?'any':'reviews'},'all'));setPreparedKey(planKey);entry.onPrepare(domainSupplementPrompt({goal,focus,kinds,expanded}));}} prepareDisabled={!focus.trim()||!kinds.length}/>
  </div>;
  return inline?content:<Modal title="补充综述与代表性研究" onClose={onClose}>{content}</Modal>;
}
