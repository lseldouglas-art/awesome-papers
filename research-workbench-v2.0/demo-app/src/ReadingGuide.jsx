import { concise } from '../../shared/research-guidance.mjs';
import './reading-guide.css';
import { QuestionDecisions } from './QuestionDecisions.jsx';

export function ReadingGuide({ project, artifact, question, onContinue, disabled, running, hasInvestigation, onInvestigate, onViewInvestigation, onOpenLibrary }) {
  const branch = artifact.kind === 'research_branch';
  if (!project.researchResults[artifact.draft.resultId] || (!branch && !question) || !['research_branch','questions','research_brief'].includes(artifact.kind)) return null;
  return <section className="reading-guide" aria-label="当前位置与下一步"><div className="next-action-guide">
    <div><span className="eyebrow">{branch ? '选题论证' : '当前关注的问题'}</span><h2>{concise(question?.title || question?.proposal?.paperTitle || question?.text || '研究问题与论证路径',58)}</h2><p>{branch ? '围绕本题检索、筛选文献，进一步核查缺口与研究设计。' : '进一步论证当前选题，保留其他候选与研究决定。'}</p></div>
    {branch ? <div className="guide-action-stack"><button className="primary guide-primary" disabled={disabled} onClick={onOpenLibrary}>进入专题文献库 →</button><button className="text-button" disabled={disabled||(!hasInvestigation&&running)} onClick={hasInvestigation?onViewInvestigation:onInvestigate}>{hasInvestigation?'回看已有选题论证':'深入论证选题'}</button></div> : <button className="primary guide-primary" disabled={disabled} onClick={onContinue}>继续探索此题 →</button>}
  </div></section>;
}
export function QuestionRoute({ question, onDetails, project, numbers, onSource }) {
  if (!question) return null;
  const proposal=question.proposal, nodes=[['01','研究对象',question.scope || question.text,'branch-question'],['02','拟议设计',proposal?.design || '尚未形成设计，需要继续论证','branch-design'],['03','主要结局',proposal?.primaryOutcome || '主要结局需要明确','branch-primaryOutcome']];
  return <><QuestionDecisions key={`${question.id}:${question.revisionId}`} questions={[question]} project={project} numbers={numbers} onSource={onSource}/><details className="deferred-research-design"><summary>研究对象、设计与结局</summary><section className="question-route" aria-label="选题研究路径图"><div className="section-kicker"><h2>研究实施路径</h2><span>拟议路径</span></div><ol>{nodes.map(([n,title,text,target])=><li key={n}><span className="node-number">{n}</span><h3>{title}</h3><p>{concise(text,74)}</p><button onClick={()=>onDetails(target)}>展开完整内容 ↗</button></li>)}</ol></section></details></>;
}
