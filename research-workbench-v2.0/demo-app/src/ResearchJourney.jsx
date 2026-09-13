import { useState } from 'react';
import { levels, date } from './ui.jsx';
import './research-journey.css';
import { concise } from '../../shared/research-guidance.mjs';
import { QuestionDecisions } from './QuestionDecisions.jsx';

const choices = { explore: '深入论证', keep: '暂保留', adopt: '采用', reject: '排除', defer: '保留未决' };
const relations = { supports: '支持', support: '支持', contradicts: '相反依据', conflict: '相反依据', context: '背景', background: '背景', contextualizes: '背景' };
export function ArtifactPicker({ project, value, onChange, disabled }) {
  const kindLabels = { brief: '领域理解', questions: '候选比较', research_brief: '工作简报', research_branch: '选题探索', topic_library: '专题文献库' };
  return <label className="artifact-picker"><span>正在阅读</span><select aria-label="切换研究成果" value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>{Object.values(project.artifacts).map(a => <option value={a.id} key={a.id}>{kindLabels[a.kind] ? `${kindLabels[a.kind]} · ` : ''}{a.title}</option>)}</select></label>;
}
function Evidence({ question, project, numbers, onSource }) {
  const entries = question.evidence ?? [];
  return <details className="question-evidence"><summary>依据与访问范围 · {entries.length} 条</summary>{entries.length ? entries.map((e, i) => {
    const a = project.accesses[e.accessId], s = a && project.sources[a.sourceId];
    return <div key={e.id ?? `${e.accessId}-${i}`}><small>{relations[e.relation] ?? '关系待核查'} · {levels[a?.level] ?? '访问范围未知'}</small><button className="evidence-source" disabled={!a} onClick={() => onSource(e.accessId, e)}>[{numbers[s?.id] ?? '?'}] {s?.title ?? '来源待核查'}</button>{e.quote && <blockquote>{e.quote}</blockquote>}</div>;
  }) : <p>当前没有可以定位的依据，需要继续查证。</p>}</details>;
}
function QuestionCard({ index, question: q, project, numbers, disabled, onCommand, onDeepen, onSource, onFocusQuestion, detailOnly=false }) {
  const [editing, setEditing] = useState(false), [text, setText] = useState(q.text), [scope, setScope] = useState(q.scope ?? '');
  const reviews = Object.values(project.annotations).filter(a => a.actor === 'assistant_review' && a.status === 'open' && a.target.itemId === q.id && a.target.itemRevisionId === q.revisionId);
  const choose = async choice => { const result = await onCommand('decide-question', { itemId:q.id,itemRevisionId:q.revisionId,choice }); if (result && choice === 'adopt') await onDeepen(q); };
  return <article className={`question-card ${q.isAdopted ? 'adopted' : ''}`} aria-label={`候选问题：${q.text}`}>
    {!detailOnly && <><div className="question-meta">{index !== undefined && <span className="node-number">{String(index + 1).padStart(2,'0')}</span>}<span>{q.isAdopted ? '✓ 当前采用的问题' : choices[q.choice] ?? '待比较的问题'}</span><small>第 {q.version ?? 1} 版</small></div>
    <button className="topic-open" disabled={disabled} onClick={()=>onDeepen(q)} aria-label={`进入选题探索：${(!q.proposalNeedsReview && q.proposal?.paperTitle) || q.text}`}><h3>{concise(q.title || q.text,65)}</h3></button>
    {q.rationale && <p className="candidate-rationale" aria-label="选题理由摘录">{concise(q.rationale,105)}</p>}<div className="topic-glance"><span>◇ {q.unknowns?.length ?? 0} 项待核查</span><span>↗ {q.proposal ? '已有拟议研究设计' : '研究设计待论证'}</span>{reviews.length>0 && <span>! {reviews.length} 条复核意见</span>}</div>
    <div className="journey-actions"><button className="primary topic-explore" disabled={disabled} onClick={()=>onDeepen(q)}>进入选题论证 →</button></div></>}
    {editing && <form className="question-editor" onSubmit={async e=>{e.preventDefault();if(await onCommand('revise-question',{itemId:q.id,baseRevisionId:q.revisionId,text,scope}))setEditing(false);}}><label>问题表达<textarea required aria-label="修改问题表达" value={text} onChange={e=>setText(e.target.value)}/></label><label>研究范围<textarea aria-label="修改研究范围" value={scope} onChange={e=>setScope(e.target.value)}/></label><div className="journey-actions"><button className="primary" disabled={disabled || !text.trim()}>保存问题新版本</button><button type="button" onClick={()=>setEditing(false)}>取消</button></div></form>}
    <details className="topic-details"><summary>展开题目、缺口依据与研究设计</summary>
      <p className="full-paper-title"><strong>论文工作题目</strong><br/>{(!q.proposalNeedsReview && q.proposal?.paperTitle) || q.text}</p>
      <p><strong>研究问题</strong><br/>{q.text}</p>{q.scope && <p><strong>范围</strong><br/>{q.scope}</p>}
      {reviews.length>0 && <aside className="candidate-review" aria-label="这个版本的 AI 复核意见"><strong>AI 复核 · 尚待处理</strong>{reviews.map(a=><p key={a.id}>{a.text}</p>)}</aside>}
      {q.rationale && <p><strong>缺口依据与选题理由</strong><br/>{q.rationale}</p>}
      {q.proposal && <><div className="proposal-grid"><div><strong>拟议研究设计</strong><p>{q.proposal.design}</p></div><div><strong>主要结局</strong><p>{q.proposal.primaryOutcome}</p></div></div><details className="proposal-detail"><summary>分析路径、创新性核查与所需条件</summary>{[['analysisPlan','分析路径'],['noveltyCheck','创新性核查'],['contribution','预期贡献'],['dataRequirements','所需条件']].map(([key,label])=><p key={key}><strong>{label}</strong><br/>{Array.isArray(q.proposal[key])?q.proposal[key].join('；'):q.proposal[key]}</p>)}</details></>}
      {q.proposalNeedsReview && <p className="muted">问题已修订，设计沿用此前版本，需重新论证。</p>}{q.evidenceNeedsReview && <p className="muted">问题范围已改变，原有依据的适用性需复核。</p>}
      <Evidence question={q} project={project} numbers={numbers} onSource={onSource}/>
      <details className="question-boundary-detail"><summary>未知事项与可行性</summary><ul>{q.unknowns?.map((u,i)=><li key={i}>{typeof u==='string'?u:u.text}</li>)}</ul><p>{typeof q.feasibility==='string'?q.feasibility:[...(q.feasibility?.known??[]),...(q.feasibility?.unknown??[]).map(x=>`待核查：${x}`)].join('；') || '条件待核查'}</p></details>
    </details>
    <details className="question-options"><summary>采用、保留或修改</summary><div className="journey-actions"><button disabled={disabled || q.isAdopted} onClick={()=>choose('adopt')}>{q.isAdopted?'已采用这一版本':'采用并进入论证'}</button><button disabled={disabled || q.choice==='keep'} onClick={()=>choose('keep')}>暂保留</button><button disabled={disabled || q.choice==='reject'} onClick={()=>choose('reject')}>排除</button><button disabled={disabled} onClick={()=>onFocusQuestion?.(q)}>围绕这个问题交流</button><button disabled={disabled} onClick={()=>setEditing(!editing)}>修改表达或范围</button></div></details>
  </article>;
}
export function ResearchJourney({ project, artifact, numbers, disabled, onCommand, onCompare, onAnalyze, onDeepen, onSource, onArtifact, onFocusQuestion, historical }) {
  const state = project.researchState;
  const [creating, setCreating] = useState(false), [text, setText] = useState(''), [scope, setScope] = useState('');
  if (!state || historical) return null;
  const current = state.currentQuestion;
  const result = project.researchResults[artifact.draft.resultId];
  const ids = artifact.branchQuestion ? [artifact.branchQuestion.itemId] : result?.questionIds ?? result?.questionRefs?.map(r => r.itemId);
  const questions = (state.questions ?? []).filter(q => !ids?.length || ids.includes(q.id));
  const directions = (state.directions ?? []).filter(d => d.origin?.resultId === result?.id);
  const showQuestions = result?.kind === 'questions' || artifact.kind === 'questions';
  const impacts = (state.impacts ?? []).filter(i => !['updated', 'resolved', 'kept'].includes(i.status) && !['updated', 'keep'].includes(i.choice));
  const impactGroups = Object.values(impacts.reduce((groups, impact) => { (groups[impact.artifactId] ??= { artifactId: impact.artifactId, records: [] }).records.push(impact); return groups; }, {}));
  const resolveGroup = async (group, choice, revisionId) => { for (const impact of group.records) { if (!(await onCommand('resolve-impact', { impactId: impact.id, choice, ...(revisionId ? { updatedArtifactRevisionId: revisionId } : {}) }))) return false; } return true; };
  return <section className="research-journey" aria-label="研究问题与接续">
    {current && artifact.kind === 'brief' && <div className="research-focus"><small>当前研究问题</small><p>{current?.text ?? '还没有采用具体问题。可以继续探索，也可以带着未决事项整理简报。'}</p>{current && <span>采用第 {current.version ?? 1} 版 · 继续探索其他问题时，这项选择仍保留。</span>}</div>}
    {impactGroups.length > 0 && <details className="impact-list"><summary>有 {impactGroups.length} 份成果需要重看</summary><p>研究输入发生了变化。原内容和当时依据仍然保留，由你判断是否更新。</p>{impactGroups.map(g => <div className="impact-item" key={g.artifactId}><strong>{project.artifacts[g.artifactId]?.title ?? '关联成果'}</strong><p>{g.records.at(-1).explanation ?? '这份成果使用了较早的研究输入。'}</p><details><summary>涉及 {new Set(g.records.map(i => i.artifactRevisionId)).size} 个保存版本 · 查看变化来历</summary>{g.records.map(i => <p key={i.id}>第 {project.artifacts[g.artifactId]?.revisions.find(r => r.id === i.artifactRevisionId)?.number ?? '?'} 版：{i.explanation}</p>)}</details><button onClick={() => onArtifact(g.artifactId)}>查看这份成果</button><div className="journey-actions">{project.artifacts[g.artifactId]?.kind === 'research_brief' && <button disabled={disabled} onClick={async () => { const updated = await onCommand('compose-brief', { artifactId: g.artifactId }); if (updated?.revisionId) await resolveGroup(g, 'updated', updated.revisionId); }}>按当前选择更新这份简报</button>}<button disabled={disabled} onClick={() => resolveGroup(g, 'keep')}>保留这些版本的原内容</button><button disabled={disabled || g.records.every(i => i.status === 'deferred')} onClick={() => resolveGroup(g, 'defer')}>暂缓处理</button></div></div>)}</details>}
    {directions.length > 0 && <details className="saved-directions"><summary>可以继续深入的方向 · {directions.length}</summary>{directions.map(d => <div className="direction-option" key={d.id}><p>{d.text}</p><button disabled={disabled} onClick={() => onDeepen(d)}>深入这个方向</button><button disabled={disabled} onClick={() => onFocusQuestion?.(d)}>围绕这个方向交流</button></div>)}</details>}
    {showQuestions && <QuestionDecisions key={artifact.id} questions={questions} project={project} numbers={numbers} disabled={disabled} onAnalyze={onAnalyze} onDeepen={onDeepen} onSource={onSource} renderDetails={q=><details className="decision-full-record"><summary>完整选题记录、依据与我的取舍</summary><QuestionCard detailOnly question={q} project={project} numbers={numbers} disabled={disabled} onCommand={onCommand} onDeepen={onDeepen} onSource={onSource} onFocusQuestion={onFocusQuestion}/></details>}/>}
    <details className="additional-actions"><summary>补充材料、整理简报或保留未决</summary><div className="journey-actions journey-next"><button disabled={disabled} onClick={onCompare}>{showQuestions ? '补充材料后重新比较' : '形成候选问题并比较'}</button><button disabled={disabled} onClick={() => onCommand('compose-brief', result?.kind === 'research_brief' ? { artifactId: artifact.id } : {})}>{result?.kind === 'research_brief' ? '按当前问题与取舍更新这份简报' : '整理课题工作简报'}</button><button disabled={disabled} onClick={() => setCreating(!creating)}>写下自己的研究问题</button>{questions.length > 0 && <button disabled={disabled} onClick={() => onCommand('decide-question', { choice: 'defer' })}>当前保留未决</button>}</div></details>
    {creating && <form className="question-editor" onSubmit={async e => { e.preventDefault(); if (await onCommand('create-question', { text, scope })) { setCreating(false); setText(''); setScope(''); } }}><label>候选研究问题<textarea aria-label="候选研究问题" value={text} required onChange={e => setText(e.target.value)}/></label><label>研究范围（可稍后补充）<textarea aria-label="新问题的研究范围" value={scope} onChange={e => setScope(e.target.value)}/></label><button className="primary" disabled={disabled || !text.trim()}>保存为候选问题</button></form>}
    {!showQuestions && questions.length > 0 && <details><summary>已保存的候选问题 · {questions.length}</summary>{questions.map(q => <QuestionCard key={`${q.id}:${q.revisionId}`} question={q} project={project} numbers={numbers} disabled={disabled} onCommand={onCommand} onDeepen={onDeepen} onSource={onSource} onFocusQuestion={onFocusQuestion}/>)}</details>}
    {state.decisionHistory?.length > 0 && <details className="decision-history"><summary>研究决定记录 · {state.decisionHistory.length}</summary>{state.decisionHistory.slice().reverse().map(d => <div key={d.id}><span>{choices[d.choice] ?? d.label ?? '研究决定'}</span><p>{d.text ?? project.researchItems[d.target?.itemId]?.revisions.find(r => r.id === d.target?.itemRevisionId)?.text ?? d.intent?.text ?? '本轮保留未决。'}</p><small>{date(d.createdAt)}</small></div>)}</details>}
  </section>;
}
