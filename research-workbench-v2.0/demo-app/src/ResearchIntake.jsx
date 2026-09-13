import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import { api } from './ui.jsx';
import { intakeQuestions, intakeAnswerText, initialIntake, researcherPlan, RESOURCE_STATES } from '../../shared/researcher-intake.mjs';

export function ResearchIntake({project,onSaved,onHome,onDone}) {
  const saved = project.researcherIntake ?? {...initialIntake(project.goal),version:0};
  const cacheKey = `rw2:intake:${project.id}`;
  const [answers,setAnswers]=useState(()=> { try { const cache=JSON.parse(localStorage.getItem(cacheKey)); if(cache?.version===saved.version)return cache.answers; }catch{} return saved.answers; });
  const [version,setVersion]=useState(saved.version);
  const [index,setIndex]=useState(()=> { const missing=intakeQuestions.findIndex(q=>!saved.answers[q.id]); return missing<0?intakeQuestions.length:missing; });
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const heading=useRef(null);
  const question=intakeQuestions[index], answer=question ? answers[question.id]??{} : null;
  const answered=intakeQuestions.filter(q=>Object.hasOwn(answers,q.id)).length;
  const plan=researcherPlan(answers);
  useEffect(()=>{heading.current?.focus();},[index]);
  useEffect(()=>{try{localStorage.setItem(cacheKey,JSON.stringify({version,answers}));}catch{setError('浏览器未能保留未提交的回答，请先复制保留。');}},[answers,version,cacheKey]);
  const change=patch=>setAnswers(old=>({...old,[question.id]:{...(old[question.id]??{}),...patch}}));
  const changeValue=(label,value)=>change({values:{...answer.values,[label]:value}});
  const persist=async(confirm=false,nextAnswers=answers)=>{
    if(busy)return;setBusy(true);setError('');
    try{
      const result=await api.command(project.id,'save-researcher-intake',{baseVersion:version,answers:nextAnswers,confirm});
      setVersion(result.version);setAnswers(nextAnswers);
      const fresh=await api.workspace(project.id);onSaved(fresh);
      if(confirm){localStorage.removeItem(cacheKey);onDone();}
      else {const missing=intakeQuestions.findIndex((q,i)=>i>index&&!nextAnswers[q.id]);setIndex(missing<0?intakeQuestions.length:missing);}
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  const next=()=>persist(false,{...answers,[question.id]:question.resources ? {...answer,values:Object.fromEntries(question.resources.map(label=>[label,answer.values?.[label]??'未知']))} : answers[question.id]??{note:'未知，待后续明确'}});
  return <div className="intake-page">
    <header className="intake-header"><span className="brand"><Icon name="leaf" size={28}/>科研工作台</span><button disabled={busy} onClick={project.researcherProfile?onDone:onHome}>{project.researcherProfile?'返回课题':'稍后继续'}<Icon name="return"/></button></header>
    <main className={`intake-layout${question?'':' intake-summary-layout'}`}>
      <section className="intake-conversation" aria-label="了解你的研究现状">
        <p className="eyebrow">从你的现状出发</p>
        <div className="intake-path" aria-label="起步流程"><span className={question?'active':''}>了解你</span><span>→</span><span className={!question?'active':''}>画像与计划</span><span>→</span><span>领域认识</span></div>
        {question ? <>
          <p className="intake-kicker">{question.label} <span>{answered} / {intakeQuestions.length} 项已记录</span></p>
          <h1 ref={heading} tabIndex={-1}>{question.title}</h1><p className="intake-why">{question.why}</p>
          {index===1 && answers.startingPoint?.choice===intakeQuestions[0].options[3] && <p className="intake-followup">你已经有了方法。可以先说它想解释的现象、研究对象，或你期待发现什么；暂时说不清也可以。</p>}
          {question.options && <div className="intake-options">{question.options.map(option=><button key={option} disabled={busy} aria-pressed={answer.choice===option} className={answer.choice===option?'selected':''} onClick={()=>change({choice:option})}>{option}<span aria-hidden="true">{answer.choice===option?'✓':'○'}</span></button>)}</div>}
          {question.fields && <div className="intake-fields">{question.fields.map(([key,label])=><label key={key}>{label}<textarea rows={2} maxLength={4000} disabled={busy} value={answer.values?.[label]??''} onChange={e=>changeValue(label,e.target.value)} placeholder="未确定可留空"/></label>)}</div>}
          {question.resources && <div className="intake-resources">{question.resources.map(label=><label key={label}><span>{label}</span><select aria-label={label} disabled={busy} value={answer.values?.[label]??'未知'} onChange={e=>changeValue(label,e.target.value)}>{RESOURCE_STATES.map(state=><option key={state}>{state}</option>)}</select></label>)}</div>}
          {question.privacy && <label className="intake-free">资料使用范围<select aria-label="资料使用范围" disabled={busy} value={answer.privacy??'尚不确定'} onChange={e=>change({privacy:e.target.value})}>{['尚不确定','目前只使用公开资料','涉及受限或敏感资料'].map(v=><option key={v}>{v}</option>)}</select></label>}
          <label className="intake-free">{question.fields||question.resources?'补充说明（可选）':'也可以用自己的话说'}<textarea aria-label="补充回答" rows={3} maxLength={4000} disabled={busy} value={answer.note??''} onChange={e=>change({note:e.target.value})} placeholder={question.placeholder??'写下你的实际情况；不需要使用专业术语。'}/></label>
          <div className="intake-actions"><button disabled={busy||index===0} onClick={()=>setIndex(index-1)}>上一项</button><button className="text-button" disabled={busy} onClick={()=>persist(false,{...answers,[question.id]:{note:'未知，待后续明确'}})}>暂时不确定</button><button className="primary" disabled={busy} onClick={next}>{busy?'正在保存…':'记录并继续'}<Icon name="arrow"/></button></div>
        </> : <>
          <p className="intake-kicker">先核对，再开始</p><h1 ref={heading} tabIndex={-1}>让下一步，适合现在的你。</h1><p className="intake-why">这是根据你的原话与回答整理的研究画像。可以逐项修改，未知的条件继续保留。</p>
          <div className="intake-review">{intakeQuestions.map((q,i)=><div key={q.id}><h2>{q.label}</h2><p>{intakeAnswerText(answers[q.id])}</p><button className="text-button" disabled={busy} onClick={()=>setIndex(i)}>修改<span className="sr-only">{q.label}</span></button></div>)}</div>
          <section className="intake-plan" aria-label="本轮起步计划"><p className="eyebrow">由你的现状出发</p><h2>{plan.title}</h2><ol>{plan.steps.map((step,i)=><li key={step.title}><span>0{i+1}</span><div><h3>{step.title}</h3><p>{step.text}</p></div></li>)}</ol>{plan.constraints.length>0&&<div className="intake-constraints"><h3>安排时要考虑</h3><ul>{plan.constraints.map(item=><li key={item}>{item}</li>)}</ul></div>}<p className="muted">{plan.scope}</p><button className="primary" disabled={busy} onClick={()=>persist(true)}>{busy?'正在保存…':'确认画像与起步计划'}<Icon name="arrow"/></button></section>
        </>}
        {error&&<p role="alert" className="error-text">{error}</p>}
        <p className="intake-footnote">回答保存在本机。确认后带入后续研究；研究目标和现实条件都可以继续调整。</p>
      </section>
      {question && <aside className="intake-notebook" aria-label="已记录的研究现状"><Icon name="leaf" size={28}/><p className="eyebrow">你的起点</p><blockquote>{project.originalGoal||project.goal}</blockquote><hr/><h2>已记下的现状</h2>{answered ? <ul>{intakeQuestions.filter(q=>answers[q.id]).map(q=><li key={q.id}><button className="text-button" disabled={busy} onClick={()=>setIndex(intakeQuestions.indexOf(q))}>{q.label}</button><p>{intakeAnswerText(answers[q.id])}</p></li>)}</ul>:<p>从这次回答开始，逐步形成画像。</p>}<p className="muted">不确定，可以留下。计划也会随着认识改变。</p></aside>}
    </main>
  </div>;
}
