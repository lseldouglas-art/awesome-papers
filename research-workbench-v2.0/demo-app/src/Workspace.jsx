import {chapterForBlock} from '../../shared/domain-chapters.mjs';
import {CurrentResearch,ResearchContinuity} from './ResearchContinuity.jsx';
import { DomainSupplement } from './DomainSupplement.jsx';
import {researchHeading} from '../../shared/research-labels.mjs';
import {ResearchTemplates} from './ResearchTemplates.jsx';
import {templateModes} from '../../shared/research-templates.mjs';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon, IconButton } from './icons.jsx';
import { useDraft } from './useDraft.js';
import { api, date, levels, Modal, download, markdown } from './ui.jsx';
import { ResearchEntry, TargetedMaterialSearch, TaskActivity, SavedBatches } from './ResearchEntry.jsx';
import { ResearchOutline } from './ResearchOutline.jsx';
import { COVERAGE_LABELS, INFORMATION_LABELS } from '../../shared/domain-landscape.mjs';
import { MaterialReview, ResearchCoverage } from './ResearchMaterials.jsx';
import { uniqueAccessIds, referenceNumbers } from '../../shared/material-scope.mjs';
import { ModelForm, SourceForm, ProjectForm } from './Forms.jsx';
import { ArtifactPicker, ResearchJourney } from './ResearchJourney.jsx';
import { ResearchPathNav, ResearchBreadcrumbs, BriefContinuity, ResearchVisuals, ScientificReading } from './ResearchReading.jsx';
import { parentReference } from '../../shared/research-path.mjs';
import { isContinueNavigation, isTopicReviewRequest, continuationQuestion, savedInvestigations } from '../../shared/research-guidance.mjs';
import { ReadingGuide, QuestionRoute } from './ReadingGuide.jsx';
import { TopicLibraryWorkbench } from './TopicLibraryWorkbench.jsx';
import { topicTaskModes } from '../../shared/topic-library-workflow.mjs';
import { searchesForArtifact, topicQueryState } from '../../shared/topic-search.mjs';
import { BuildNotice, BuildLabel } from './BuildNotice.jsx';
const labels = { intent: '当前想法', understanding: '已有认识', unknown: '待继续了解', next: '下一步' };
const hints = { intent: '记录研究问题或探索方向…', understanding: '记录当前认识及其依据…', unknown: '记录未决问题与待验证假设…', next: '记录后续研究安排，不自动执行。' };
const statuses = { queued: '准备中', running: '进行中', completed: '已完成本步', failed: '本步未完成', cancelled: '已停止', interrupted: '已中断' };
const saveLabels = { saved: '已保存到本机', dirty: '等待保存', saving: '正在保存…', error: '尚未保存', conflict: '保存有冲突' };
const isRunning = task => task && ['queued', 'running'].includes(task.status);
function AutoNote({ label, value, placeholder, onChange, onBlur, disabled, composing }) {
  const ref = useRef();
  useLayoutEffect(() => { const el = ref.current; el.style.height = '0px'; el.style.height = `${Math.max(45, el.scrollHeight)}px`; }, [value]);
  return <textarea ref={ref} className="inline-note" aria-label={label} value={value} placeholder={placeholder} disabled={disabled} maxLength={100000}
    onChange={e => onChange(e.target.value)} onBlur={onBlur} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; queueMicrotask(onBlur); }} rows={1}/>;
}
function CitationButtons({ citations, blockId, onSource, numbers }) {
  const seen = new Set();
  return <span className="citation-links">{citations.filter(c => c.blockId === blockId).filter(c => { const n = numbers[c.sourceId]; if (seen.has(n)) return false; seen.add(n); return true; }).map(c => <button key={c.accessId} onClick={() => onSource(c.accessId, c)} aria-label={`查看文献 ${numbers[c.sourceId]} 的依据`}>[{numbers[c.sourceId]}]</button>)}</span>;
}
function ResultBlocks({ blocks, citations = [], numbers, selected, onSelect, onNote, onSource, prefix = '' }) {
  return blocks.map((block, index) => {
    if (block.type === 'candidate') {
      if (blocks[index - 1]?.type === 'candidate') return null;
      const group = []; for (let i = index; i < blocks.length && blocks[i].type === 'candidate'; i++) group.push(blocks[i]);
      return <div className="research-map" key={block.id}><div className="map-branches result-branches">{group.map((b, i) => <div id={`${prefix}block-${b.id}`} className={`map-branch ${selected === b.id ? 'chosen' : ''}`} key={b.id}><Icon name={['user', 'book', 'chart'][i % 3]} size={25}/><button onClick={() => onSelect(b.id)}>{b.text}</button><CitationButtons numbers={numbers} citations={citations} blockId={b.id} onSource={onSource}/></div>)}</div><div className="map-caption">根据本次材料整理的研究分支</div></div>;
    }
    return <section id={`${prefix}block-${block.id}`} className={`content-block ${block.type} ${selected === block.id ? 'focused-block' : ''}`} key={block.id} onClick={() => onSelect(block.id)}>
      {block.type === 'heading' ? <><h2>{researchHeading(block)}</h2>{block.dimensionCoverage && <details className="dimension-boundary"><summary>{COVERAGE_LABELS[block.dimensionCoverage]} · 查看边界</summary><p>{block.dimensionLimitation}</p></details>}</> : block.type === 'table' ? <div className="table-scroll"><table><thead><tr>{block.columns.map(c => <th key={c.id}>{c.label}</th>)}</tr></thead><tbody>{block.rows.map(r => <tr key={r.id}>{block.columns.map(c => <td key={c.id}>{r.cells[c.id]}</td>)}</tr>)}</tbody></table></div> : <><p>{block.text}<CitationButtons numbers={numbers} citations={citations} blockId={block.id} onSource={onSource}/></p>{block.informationStatus && block.informationStatus !== 'reported' && <small className="information-state">{INFORMATION_LABELS[block.informationStatus] || '信息状态未知'}</small>}{block.recordAnchor&&<details><summary>查看本次执行记录依据</summary><p>{block.recordAnchor.title} · 第 {block.recordAnchor.number} 版</p><blockquote>{block.recordAnchor.quote}</blockquote><small>实际执行者：{block.recordAnchor.performedBy||'未记录'}；原记录定位不代表独立核验。</small></details>}{onNote && <div className="block-actions"><button onClick={() => onNote(block.id)}><Icon name="comment" size={14}/>批注</button></div>}</>}
    </section>;
  });
}
export function Workspace(props) {
  const { project } = props;
  const [artifactId, setArtifactId] = useState(() => project.researchState?.position?.artifactId ?? Object.keys(project.artifacts)[0]);
  const validId = project.artifacts[artifactId] ? artifactId : Object.keys(project.artifacts)[0];
  return <ArtifactWorkspace {...props} key={validId} artifactId={validId} onArtifact={setArtifactId}/>;
}
function ArtifactWorkspace({ project, setProject, onProjects, onHome, artifactId, onArtifact }) {
  const pRef = useRef(project); pRef.current = project;
  const artifact = project.artifacts[artifactId];
  const [selectedQuestion, setSelectedQuestion] = useState(() => { const ref = artifact.branchQuestion, item = project.researchItems?.[ref?.itemId], revision = item?.revisions.find(r => r.id === ref.revisionId); return revision ? { id: item.id, revisionId: revision.id, text: revision.text, scope: revision.scope, kind: item.kind, evidence: (revision.evidenceIds ?? []).map(id => project.evidence[id]).filter(Boolean) } : null; });
  const numbers = referenceNumbers(project);
  const [left, setLeft] = useState(() => window.innerWidth >= 1100), [panel, setPanel] = useState(null), [viewId, setViewId] = useState(() => (project.researchState?.positions?.[artifactId] ?? (project.researchState?.position?.artifactId === artifactId ? project.researchState.position : null))?.revisionId ?? null);
  const [selected, setSelected] = useState(() => (project.researchState?.positions?.[artifactId] ?? (project.researchState?.position?.artifactId === artifactId ? project.researchState.position : null))?.blockId ?? ''), [focusSource, setFocusSource] = useState(null), [focusCitation, setFocusCitation] = useState(null);
  const [busy, setBusy] = useState(false), busyRef = useRef(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [modal, setModal] = useState(null), [compared, setCompared] = useState(null), [checkpointName, setCheckpointName] = useState('');
  const [caps, setCaps] = useState(null), [calls, setCalls] = useState([]);
  const cacheKey = `rw2:conversation-draft:${project.id}:${artifactId}`;
  const [cached] = useState(() => { try { return JSON.parse(localStorage.getItem(cacheKey)) ?? {}; } catch { return {}; } });
  const startKey = `rw2:pending-start:${project.id}`;
  const [pendingStart, setPendingStart] = useState(() => { try { return JSON.parse(localStorage.getItem(startKey)); } catch { return null; } });
  const [replyTask, setReplyTask] = useState(cached.replyTask ?? null);
  const [message, setMessageState] = useState(cached.message ?? ''), [note, setNote] = useState(cached.note ?? '');
  const scopedQuery = () => artifact.kind === 'topic_library' ? (artifact.topicWorkspace?.savedPlan?.query ?? topicQueryState(pRef.current, artifact).query) : topicQueryState(pRef.current, artifact).query;
  const initialTopicQuery = topicQueryState(project, artifact);
  const [previousQuery] = useState(cached.previousQuery ?? (artifact.kind === 'topic_library' && cached.queryOwner !== artifactId && cached.query !== initialTopicQuery.query ? cached.query ?? '' : ''));
  const [searchScopeMode, setSearchScopeMode] = useState(cached.queryOwner === artifactId && ['focused','expanded'].includes(cached.searchScopeMode) ? cached.searchScopeMode : initialTopicQuery.scopeMode);
  const [mode, setMode] = useState(() => artifact.kind==='topic_library' ? (cached.mode==='record'?'record':cached.topicStep&&cached.topicStep!=='scope'||artifact.topicWorkspace?.confirmedOutlineId?'ask':'topic-plan') : ['clarify', 'ask', 'revise', 'record'].includes(cached.mode) ? cached.mode : artifact.draft.resultId ? 'ask' : 'clarify'), [query, setQuery] = useState((artifact.kind !== 'topic_library' || cached.queryOwner === artifactId) && cached.queryBase === scopedQuery() && typeof cached.query === 'string' ? cached.query : scopedQuery());
  const [topicStep,setTopicStep]=useState(()=>cached.topicStep??(artifact.topicWorkspace?.confirmedOutlineId?'write':'scope'));
  const [notesTab,setNotesTab]=useState('annotations');
  const openTemplates=()=>{setNotesTab('templates');setPanel('notes');};
  const [topicOptions,setTopicOptions]=useState((cached.queryOwner===artifactId?cached.topicOptions:null)??artifact.topicWorkspace?.savedPlan?.options??{sort:'pub_date',limit:500,from:'',to:''});
  const searchConversation=artifact.kind==='topic_library'&&mode==='topic-plan';
  const artifactSearches = searchesForArtifact(project, artifact);
  const latestSearch = artifactSearches.at(-1);
  const savedOutline=artifact.topicWorkspace?.outlines?.find(o=>o.id===artifact.topicWorkspace.activeOutlineId);
  const priorAnalysis=[...Object.values(project.researchTasks??{})].reverse().find(t=>t.artifactId===artifactId&&['topic-outline','topic-review'].includes(t.mode)&&t.input.materials?.length);
  const [materialIds, setMaterialIds] = useState(() => uniqueAccessIds(project, (cached.materialIds ?? (artifact.kind==='topic_library'?(savedOutline?.papers.map(m=>m.accessId)??priorAnalysis?.input.materials.map(m=>m.accessId)):Object.values(project.researchTasks ?? {}).reverse().find(t => t.artifactId===artifactId&&t.input.materials?.length)?.input.materials.map(m => m.accessId)) ?? latestSearch?.accessIds ?? artifact.draft.sourceAccessIds).filter(id => artifact.draft.sourceAccessIds.includes(id) && project.sources[project.accesses[id]?.sourceId]?.origin !== 'synthetic_fixture')));
  const [materialChoice, setMaterialChoice] = useState(false);
  const [readingMode, setReadingMode] = useState(() => localStorage.getItem(artifact.kind === 'brief' ? 'rw2:domain-reading-mode:v029' : 'rw2:reading-mode') ?? 'visual');
  const [previewResult, setPreviewResult] = useState(null);
  const [domainSupplement, setDomainSupplement] = useState(null);
  const [domainEvidence,setDomainEvidence]=useState(null);
  const [domainComposerOpen, setDomainComposerOpen] = useState(false);
  const [continuityOpen,setContinuityOpen]=useState(false);
  const readRef = useRef(), composerRef = useRef(), messageValue = useRef(message);
  const persistComposer = () => { try { localStorage.setItem(cacheKey, JSON.stringify({ message: messageValue.current, note, mode, materialIds, replyTask, query, queryBase: scopedQuery(), queryOwner: artifactId, searchScopeMode, previousQuery, topicOptions, topicStep })); return true; } catch { setError('浏览器无法保存尚未发送的内容，请先复制保留。'); return false; } };
  const setMessage = text => { messageValue.current = text; setMessageState(text); persistComposer(); };
  const changeTopicStep=step=>{setTopicStep(step);readRef.current?.scrollTo({top:0});setMode(m=>m==='record'?m:step==='scope'?'topic-plan':'ask');};
  const searchHelp=()=>{setTopicStep('scope');setMode('topic-plan');setPanel(null);composerRef.current?.focus();};
  const focusConversation = () => { setDomainComposerOpen(true); setPanel(window.innerWidth < 1100 ? null : 'discussion'); requestAnimationFrame(() => composerRef.current?.focus()); };
  const commitProject = p => { pRef.current = p; setProject(p); };
  const refresh = async () => { const p = await api.workspace(project.id); commitProject(p); return p; };
  const refreshCaps = async () => { const c = await api.capabilities(); setCaps(c); return c; };
  const draft = useDraft({ api, projectId: project.id, artifact, onSaved: ack => {
    const p = pRef.current, a = p.artifacts[artifactId]; commitProject({ ...p, artifacts: { ...p.artifacts, [artifactId]: { ...a, draft: { ...a.draft, ...ack } } } });
  } });
  const revision = viewId ? artifact.revisions.find(r => r.id === viewId) ?? null : null, historical = Boolean(revision);
  const currentResult = artifact.draft.resultId ? project.researchResults[artifact.draft.resultId] : null;
  useEffect(()=>{if(artifact.kind==='topic_library'&&currentResult?.library){const included=new Set(currentResult.library.entries.filter(e=>e.decision==='included').map(e=>e.accessId));setMaterialIds(ids=>ids.every(id=>included.has(id))?ids:ids.filter(id=>included.has(id)));}},[currentResult?.id]);
  const displayedResult = revision?.resultId ? project.researchResults[revision.resultId] : historical ? null : currentResult;
  const modelBlocks = displayedResult?.blocks ?? (project.example ? artifact.revisions[0].blocks : []);
  const noteBlocks = Object.entries(labels).flatMap(([key, label]) => [{ id: `note-${key}-heading`, type: 'heading', text: label }, { id: `note-${key}`, type: 'paragraph', text: draft.notes[key], owner: 'user' }]);
  const blocks = historical ? revision?.blocks ?? [] : [...modelBlocks, ...noteBlocks];
  const selectedBlock = blocks.find(b => b.id === selected);
  const visibleAccessIds = historical ? revision.sourceAccessIds : uniqueAccessIds(project, [...materialIds, ...artifact.draft.sourceAccessIds].filter(id => artifact.draft.sourceAccessIds.includes(id)));
  const accesses = [...new Set([...visibleAccessIds, ...(!historical && focusSource && project.accesses[focusSource] ? [focusSource] : [])])].map(id => project.accesses[id]).filter(Boolean);
  const annotations = Object.values(project.annotations).filter(a => a.target.artifactId === artifactId);
  const tasks = Object.values(project.researchTasks ?? {}).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const activeTask = tasks.find(isRunning), latestTask = tasks.filter(t => t.artifactId === artifactId).at(-1);
  const continueQuestion = continuationQuestion(project, artifact, selectedQuestion);
  const investigations = savedInvestigations(project, continueQuestion);
  const lastInvestigation = investigations.at(-1);
  const hasInvestigation = Boolean(currentResult?.investigationResultId || lastInvestigation);
  const shownTasks = tasks.filter(t => t.artifactId === artifactId || t.outputArtifactId === artifactId);
  const primaryTaskId = (shownTasks.at(-1) ?? tasks.at(-1))?.id;
  const action = async fn => { if (busyRef.current) return false; busyRef.current = true; setBusy(true); setError(''); try { return await fn(); } catch (e) { setError(e.message || '操作未完成，现有内容保留。'); return false; } finally { busyRef.current = false; setBusy(false); } };
  const navigate = fn => action(async () => { if (persistComposer() && await draft.flush()) return fn(); });
  const receiveTask = async (task, p) => {
    if (!task || task.artifactId !== artifactId) return;
    if (['failed', 'interrupted', 'cancelled'].includes(task.status)) { setNotice('这一步尚未完成；已有成果与材料保留，可查看原因后继续。'); return; }
    if (task.status !== 'completed') return;
    if(task.mode==='topic-plan') {setNotice('新检索建议已保存在检索与范围，当前编辑稿保留。可以继续阅读，稍后选择并校准。');return;}
    setNotice(task.staleInput ? '本步结果已保存，使用的是修改前的输入；请查看后决定如何接续。' : '本步结果已保存，可以查看、追问或继续探索。');
    if (task.executionMode === 'local_revalidation') setNotice('保存的完整输出已通过本地校验；没有再次调用模型。');
    if (['ask', 'deepen'].includes(task.mode)) setReplyTask(task.id);
    const next = task.outputArtifactId ?? p.researchResults[task.resultId]?.artifactId;
    if (next && next !== artifactId && await draft.flush()) { await api.command(project.id, 'set-position', { artifactId: next }); await refresh(); onArtifact(next); }
  };
  useEffect(() => { refreshCaps().catch(e => setError(e.message)); }, []);
  const activeProposal = topicQueryState(project, artifact).proposal;
  const priorResult = useRef(artifact.draft.resultId), priorProposal = useRef(activeProposal?.taskId);
  useEffect(() => { if (artifact.draft.resultId && artifact.draft.resultId !== priorResult.current) setMode(m => m === 'record' ? m : 'ask'); priorResult.current = artifact.draft.resultId; }, [artifact.draft.resultId]);
  useEffect(() => { persistComposer(); }, [message, note, mode, materialIds, query, replyTask, searchScopeMode, topicOptions, topicStep]);
  useEffect(() => { if (activeProposal?.taskId !== priorProposal.current) { if (activeProposal?.query) { setQuery(activeProposal.query); setSearchScopeMode(project.researchTasks[activeProposal.taskId]?.input.searchScopeMode ?? 'focused'); } priorProposal.current = activeProposal?.taskId; } }, [activeProposal?.taskId]);
  const priorSearch = useRef(latestSearch?.id);
  useEffect(() => { if (artifact.kind !== 'topic_library' && latestSearch && latestSearch.accessIds.length > 0 && latestSearch.id !== priorSearch.current && latestSearch.accessIds.every(id => artifact.draft.sourceAccessIds.includes(id))) { setMaterialIds(ids => uniqueAccessIds(project, [...ids, ...latestSearch.accessIds])); setMaterialChoice(true); } priorSearch.current = latestSearch?.id; }, [latestSearch?.id]);
  useEffect(() => {
    if (!activeTask) return;
    let stopped = false, timer;
    const poll = async () => { try { const task = await api.request(`/api/projects/${project.id}/research-tasks/${activeTask.id}`); if (stopped) return; if (isRunning(task)) { if(topicTaskModes.includes(task.mode)&&task.progress!==pRef.current.researchTasks[task.id]?.progress)await refresh(); const p = pRef.current; commitProject({ ...p, researchTasks: { ...p.researchTasks, [task.id]: task } }); timer = setTimeout(poll, 1400); } else { const p = await refresh(); await refreshCaps(); await receiveTask(task, p); } } catch (e) { if (!stopped) { setError('暂时无法读取任务状态；请求不会自动重新执行。'); timer = setTimeout(poll, 3000); } } };
    timer = setTimeout(poll, 700); return () => { stopped = true; clearTimeout(timer); };
  }, [activeTask?.id]);
  const jump = id => { setSelected(id);if(!historical&&currentResult?.kind==='brief'&&readingMode==='visual'){const section=chapterForBlock(currentResult,id);if(section){document.getElementById(`domain-chapter-${section.id}`)?.scrollIntoView({behavior:'smooth',block:'start'});if(window.innerWidth<1100)setLeft(false);return;}}if(!historical&&id.startsWith('note-')){setPanel('notes');setNotesTab('records');if(window.innerWidth<1100)setLeft(false);return;} const el = document.getElementById(`block-${id}`); let detail = el?.closest('details'); while (detail) { detail.open = true; detail = detail.parentElement?.closest('details'); } el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); if (window.innerWidth < 1100) setLeft(false); };
  const source = (id, citation = null) => { setFocusSource(id); setFocusCitation(citation); setPanel('sources'); };
  const command = (name, body = {}) => api.command(project.id, name, { artifactId, baseVersion: draft.version(), ...body });
  const selectArtifact = id => navigate(async () => { if (id === artifactId) { readRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); return; } const position = pRef.current.researchState.positions?.[id]; await api.command(project.id, 'set-position', { artifactId: id, revisionId: position?.revisionId ?? null, blockId: position?.blockId ?? null }); await refresh(); onArtifact(id); });
  const openTarget = target => navigate(async () => {
    if (!pRef.current.artifacts[target.artifactId]?.revisions.some(r => r.id === target.revisionId)) throw new Error('当时的原文版本不存在，请检查项目记录。');
    await api.command(project.id, 'set-position', target); await refresh();
    if (target.artifactId !== artifactId) onArtifact(target.artifactId);
    else { setViewId(target.revisionId ?? null); setSelected(target.blockId ?? ''); }
  });
  const researchCommand = (name, body = {}) => action(async () => {
    if (!(await draft.flush())) return false;
    let input = {};
    if (name === 'compose-brief') {
      const sourceId = body.inputArtifactId ?? (body.artifactId ? parentReference(pRef.current, pRef.current.artifacts[body.artifactId])?.artifactId : artifactId);
      if (sourceId) { const a = pRef.current.artifacts[sourceId]; const saved = await api.command(project.id, 'capture-current', { artifactId: sourceId, baseVersion: a.draft.version }); input = { inputArtifactId: sourceId, inputRevisionId: saved.revisionId }; }
    }
    const result = await api.command(project.id, name, { baseStateVersion: pRef.current.researchState?.version, ...input, ...body });
    const p = await refresh();
    if (result.artifactId === artifactId) draft.acceptServer(p.artifacts[artifactId].draft);
    if (result.artifactId && result.artifactId !== artifactId && p.artifacts[result.artifactId]) { await api.command(project.id, 'set-position', { artifactId: result.artifactId }); onArtifact(result.artifactId); }
    setNotice('这次操作及其依据已保存。'); return result;
  });
  const attachExistingMaterials = async accessIds => {
    if (!(await draft.flush())) return false;
    const linked = pRef.current.artifacts[artifactId].draft.sourceAccessIds;
    const missing = [...new Set(accessIds)].filter(id => !linked.includes(id));
    if (missing.length) {
      await command('attach-existing-materials', { accessIds: missing });
      const p = await refresh(); draft.acceptServer(p.artifacts[artifactId].draft);
    }
    return true;
  };
  const runDeepenQuestion = async (q, { recordExplore = true, text } = {}) => {
    if (!(await draft.flush())) return false;
    const referenced = [...new Set((q.evidence ?? []).map(e => e.accessId).filter(Boolean))];
    if (!(await attachExistingMaterials(referenced))) return false;
    const selectedIds = materialIds.length ? materialIds : referenced;
    if (!selectedIds.length) throw new Error('请先补查或选择本次使用的实际材料，再深入了解这个问题。');
    if (recordExplore) {
      await api.command(project.id, 'decide-question', { itemId: q.id, itemRevisionId: q.revisionId, choice: 'explore', baseStateVersion: pRef.current.researchState.version });
      await refresh();
    }
    setMaterialIds(selectedIds); setSelectedQuestion(q); setReplyTask(null);
    return startTask('deepen', text ?? `请深入了解这个问题：${q.text}。解释已有依据、分歧、未知和下一项可以补查的内容。`, { itemId: q.id, itemRevisionId: q.revisionId, accessIds: selectedIds });
  };
  const openQuestion = async q => {
    if (!persistComposer()) return false;
    if (!q) { setNotice('先点击下方一个题目，再进入独立的论证页面。'); return false; }
    if (!(await draft.flush())) return false;
    const a = pRef.current.artifacts[artifactId];
    const saved = await command('capture-current');
    const result = await api.command(project.id, 'open-branch', { inputArtifactId: artifactId, inputRevisionId: saved.revisionId, baseInputVersion: a.draft.version,
      baseStateVersion: pRef.current.researchState.version, itemId: q.id, itemRevisionId: q.revisionId, accessIds: materialIds });
    await api.command(project.id, 'set-position', { artifactId: result.artifactId }); await refresh(); onArtifact(result.artifactId); return true;
  };
  const openLibrary = async () => {
    if (!persistComposer() || !(await draft.flush())) return false;
    const saved = await command('capture-current'), a = pRef.current.artifacts[artifactId];
    const result = await api.command(project.id,'open-topic-library',{inputArtifactId:artifactId,inputRevisionId:saved.revisionId,baseInputVersion:a.draft.version,baseStateVersion:pRef.current.researchState.version});
    await api.command(project.id,'set-position',{artifactId:result.artifactId});await refresh();onArtifact(result.artifactId);return true;
  };
  const screenLibrary = (ids, decision, reason = '') => action(async()=>{
    if (!(await draft.flush())) return false;
    await api.command(project.id,'update-topic-library',{artifactId,baseVersion:pRef.current.artifacts[artifactId].draft.version,decisions:ids.map(accessId=>({accessId,decision,reason}))});
    const p=await refresh();draft.acceptServer(p.artifacts[artifactId].draft);setNotice('文献筛选已保存。');return true;
  });
  const syncLibrary = ids => action(async()=>{
    if (!(await draft.flush())) return false;
    await api.command(project.id,'update-topic-library',{artifactId,baseVersion:pRef.current.artifacts[artifactId].draft.version,addAccessIds:ids});const p=await refresh();draft.acceptServer(p.artifacts[artifactId].draft);setMaterialIds(v=>[...new Set([...v,...ids])]);
  });
  const editTemplates = body => action(async()=>{if(!(await draft.flush()))return false;await api.command(project.id,'update-research-templates',{artifactId,baseTemplateVersion:pRef.current.templateLibrary?.version??1,...body});await refresh();return true;});
  const editLibrary = body => action(async()=>{if(!(await draft.flush()))return false;await api.command(project.id,'update-topic-workspace',{artifactId,baseWorkspaceVersion:pRef.current.artifacts[artifactId].topicWorkspace?.version??1,...body});const p=await refresh();draft.acceptServer(p.artifacts[artifactId].draft);if(['screening-policy','undo-screening-policy'].includes(body.action))setMaterialIds(p.researchResults[p.artifacts[artifactId].draft.resultId].library.entries.filter(e=>e.decision==='included').map(e=>e.accessId));return true;});
  const showSearch = () => {const el=readRef.current?.querySelector('.targeted-material-search');if(el){el.open=true;el.scrollIntoView({behavior:'smooth',block:'start'});}};
  const deepenQuestion = q => action(() => openQuestion(q));
  const continueSelected = () => action(() => openQuestion(continuationQuestion(pRef.current, artifact, selectedQuestion)));
  const investigate = () => action(() => runDeepenQuestion(continuationQuestion(pRef.current, artifact, selectedQuestion), { recordExplore: false }));
  const viewInvestigation = () => jump(currentResult?.investigationResultId ? 'investigation-heading' : 'saved-investigation');
  const selectMaterial = (accessId, checked) => action(async () => {
    if (checked && !(await attachExistingMaterials([accessId]))) return false;
    setMaterialIds(ids => checked ? [...new Set([...ids, accessId])] : ids.filter(id => id !== accessId));
    if (checked) setNotice('材料已关联到当前成果，并选入本次交流。');
  });
  const replyTo = task => {
    const p = pRef.current, target = task.input.itemTarget, item = target && p.researchItems?.[target.itemId];
    const version = item?.revisions.find(r => r.id === target.revisionId);
    setSelectedQuestion(version ? { id: item.id, revisionId: version.id, kind: item.kind, text: version.text, scope: version.scope,
      evidence: (version.evidenceIds ?? []).map(id => p.evidence[id]).filter(Boolean) } : null);
    setSelected(''); setReplyTask(task.id); setMode('ask'); focusConversation();
  };
  const revalidateTask = task => action(async () => {
    if (!(await draft.flush())) return false;
    const accepted = await api.request(`/api/projects/${project.id}/research-tasks/${task.id}/revalidate`, { method: 'POST', body: { extractLeadingJson: true }, requestId: crypto.randomUUID() });
    const p = await refresh(), refreshedTask = p.researchTasks[accepted.taskId]; draft.acceptServer(p.artifacts[artifactId].draft); await receiveTask(refreshedTask, p);
    setNotice(refreshedTask?.status === 'completed' ? '保存的完整输出已通过本地校验；没有再次调用模型。' : refreshedTask?.status === 'failed' ? '本地校验未通过，请查看本步说明；没有再次调用模型。' : '已开始在本机重新核对保存的输出；不会再次调用模型。');
  });
  const currentTarget = () => ({ artifactId, ...(viewId ? { revisionId: viewId } : {}), blockId: selected });
  const startTask = async (kind, text = '', options = {}) => {
    if (!(await draft.flush())) return false;
    if(options.retryOf&&templateModes.includes(kind)){openTemplates();setNotice('请在模板文献或原段落中重新开始。');return false;}
    if (options.retryOf && topicTaskModes.includes(kind)) {const prior=pRef.current.researchTasks[options.retryOf];if(prior)options={...options,query:prior.input.query,accessIds:prior.input.materials.map(m=>m.accessId),topicOptions:{...prior.input.topicOptions,...(prior.collectionId?{resumeId:prior.collectionId}:{})}};}
    if (['topic-review','topic-outline'].includes(kind)) {const a=pRef.current.artifacts[artifactId],entries=pRef.current.researchResults[a.draft.resultId]?.library?.entries??[],chosen=options.accessIds??materialIds;if(chosen.some(id=>!entries.some(e=>e.accessId===id&&e.decision==='included'))){setError('请先在专题库纳入认可的材料，再选择用于本次分析的范围。');return false;}}
    if (!['retrieve','topic-collect','topic-preview'].includes(kind) && (!caps?.models.configured || !caps.models.enabled)) { setModal('model'); return false; }
    if (pendingStart) { setError('上次开始请求尚未确认，请先确认它的状态。'); return false; }
    const submission = { requestId: crypto.randomUUID(), body: { artifactId, baseVersion: draft.version(), mode: kind,
      ...(text.trim() ? { text: text.trim() } : {}), ...(kind === 'retrieve' ? { retrievalOffset: options.retrievalOffset ?? (options.retryOf ? pRef.current.researchTasks[options.retryOf]?.input.retrievalOffset ?? 0 : 0) } : {}), ...(artifact.kind === 'topic_library' && ['clarify','retrieve'].includes(kind) ? { searchScopeMode: options.searchScopeMode ?? searchScopeMode } : {}), ...(['retrieve', 'landscape','clarify'].includes(kind) ? { query: options.search?.query ?? query, ...(options.search ? { reuseSearchId: options.search.id } : {}) } : {}), accessIds: kind === 'clarify' ? (options.accessIds ?? []) : ['connection', 'retrieve'].includes(kind) ? [] : (options.accessIds ?? materialIds),
      ...(kind==='figure-compose'?{figureOptions:options.figureOptions??{},accessIds:[]}:{}),
      ...(templateModes.includes(kind)?{templateOptions:options.templateOptions??{},accessIds:[]}:{}),
      ...(topicTaskModes.includes(kind)?{query:options.query??query,accessIds:options.accessIds??(kind==='topic-outline'?materialIds:[]),topicOptions:options.topicOptions??(kind==='topic-plan'?topicOptions:{})}:{}),
      ...(!historical && !selectedQuestion && !options.itemId && selectedBlock && !['connection','topic-writing','manuscript-writing'].includes(kind) && !(kind === 'ask' && replyTask) ? { blockId: selected } : {}),
      ...(options.itemId ? { itemId: options.itemId, itemRevisionId: options.itemRevisionId } : selectedQuestion ? { itemId: selectedQuestion.id, itemRevisionId: selectedQuestion.revisionId } : {}),
      ...(options.retryOf && !topicTaskModes.includes(kind) ? { retryTaskId: options.retryOf } : {}),
      ...(kind === 'ask' && replyTask ? { replyToTaskId: replyTask } : {}) } };
    localStorage.setItem(startKey, JSON.stringify(submission)); setPendingStart(submission);
    let taskId;
    try { const accepted = await api.request(`/api/projects/${project.id}/research-tasks`, { method: 'POST', ...submission }); taskId = accepted.taskId; }
    catch (e) { if (e.status && e.status < 500) { localStorage.removeItem(startKey); setPendingStart(null); } throw e; }
    localStorage.removeItem(startKey); setPendingStart(null);
    const p = await refresh(); await receiveTask(p.researchTasks[taskId], p); if(templateModes.includes(kind)){if(kind!=='template-optimize')openTemplates();}else if (kind === 'ask') setPanel('discussion'); else { setPanel(null); if(!['topic-plan','topic-writing','manuscript-writing'].includes(kind))readRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); } setModal(null); if (isRunning(p.researchTasks[taskId])) setNotice('本步正在进行，已有成果与材料保留。'); return true;
  };
  const postMessage = () => action(async () => {
    if(searchConversation){if(await startTask('topic-plan',message,{accessIds:[],query,topicOptions}))setMessage('');return;}
    if (mode !== 'record' && isContinueNavigation(message)) {
      if (!(await draft.flush())) return;
      await command('record-message', { conversationId: Object.keys(project.conversations)[0], text: message.trim() });
      localStorage.setItem(cacheKey, JSON.stringify({ message: '', note, mode, materialIds, replyTask: null, query, queryBase: scopedQuery(), queryOwner: artifactId, searchScopeMode, previousQuery, topicOptions }));
      setMessage(''); setReplyTask(null);
      if (artifact.kind === 'research_branch') { await refresh(); await openLibrary(); return; }
      if (artifact.kind === 'topic_library') {changeTopicStep(artifact.topicWorkspace?.confirmedOutlineId?'write':'use');setNotice('已进入下一步工作页面。');return;}
      await refresh(); await openQuestion(continuationQuestion(pRef.current, artifact, selectedQuestion)); return;
    }
    if (mode === 'record') { if (!(await draft.flush())) return; await command('record-message', { conversationId: Object.keys(project.conversations)[0], text: message.trim(), ...(selectedBlock ? { target: currentTarget() } : {}) }); await refresh(); setMessage(''); setPanel('discussion'); setNotice('想法已记录，未调用模型。'); }
    else {
      if (!(await draft.flush())) return;
      if (artifact.kind === 'topic_library' && isTopicReviewRequest(message)) {if(await startTask(/大纲|章节|编排/.test(message)?'topic-outline':'topic-review',message))setMessage('');return;}
      const intent = await api.command(project.id, 'research-intent', { text: message, ...(selectedQuestion ? { target: { itemId: selectedQuestion.id, itemRevisionId: selectedQuestion.revisionId } } : {}) });
      if (intent.handled) { await refresh(); setMessage(''); setNotice('已按你的明确表达记录取舍。'); if (intent.decision?.choice === 'explore' && selectedQuestion) await runDeepenQuestion(selectedQuestion, { recordExplore: false, text: message }); }
      else if (await startTask(mode, message)) setMessage('');
    }
  });
  const addNote = () => action(async () => { if (!selectedBlock || !note.trim() || !(await draft.flush())) return; await command('annotate-current', { target: currentTarget(), text: note.trim() }); setNote(''); await refresh(); setNotice('批注与当时的原文已保留。'); });
  const exportFile = format => action(async () => { if (!(await draft.flush())) return; const id = viewId ?? (await command('capture-current')).revisionId; const data = await api.exportRevision(project.id, artifactId, id); download(`${artifact.title}-${historical ? '历史进展' : '当前内容'}.${format}`, format === 'json' ? JSON.stringify(data, null, 2) : markdown(data), format === 'json' ? 'application/json' : 'text/markdown'); await refresh(); setNotice(`已导出${historical ? '所选历史进展' : '当前保存内容'}。`); });
  const restore = () => action(async () => { if (!(await draft.flush())) return; await command('restore-progress', { revisionId: viewId }); const p = await refresh(); draft.acceptServer(p.artifacts[artifactId].draft); setViewId(null); setNotice('已恢复为新的研究进展；恢复前内容仍可找回。'); });
  const adopt = resultId => action(async () => { if (!(await draft.flush())) return; await command('adopt-result', { resultId }); const p = await refresh(); draft.acceptServer(p.artifacts[artifactId].draft); setPreviewResult(null); setNotice('已使用这份简报继续；个人认识保持你的最新输入。'); });
  const openHistory = () => setPanel(panel === 'history' ? null : 'history');
  const returnCurrent = () => navigate(async () => { await api.command(project.id, 'set-position', { artifactId, revisionId: null }); setSelected(''); setViewId(null); });
  const viewRevision = id => navigate(async () => { await api.command(project.id, 'set-position', { artifactId, revisionId: id }); setViewId(id); setSelected(''); });
  useEffect(() => {
    const timer = setTimeout(() => { api.command(project.id, 'set-position', { artifactId, passive: true, ...(selected ? { blockId: selected } : {}), ...(viewId ? { revisionId: viewId } : {}) }).catch(() => {}); }, 500);
    return () => clearTimeout(timer);
  }, [artifactId, selected, viewId]);
  useEffect(() => {
    const id = (project.researchState?.positions?.[artifactId] ?? (project.researchState?.position?.artifactId === artifactId ? project.researchState.position : null))?.blockId;
    if (id && !(artifact.kind === 'brief' && readingMode === 'visual' && !historical)) requestAnimationFrame(() => jump(id));
  }, []);
  const openDomainEvidence=id=>{const section=chapterForBlock(currentResult,id);if(section)setDomainEvidence({resultId:currentResult.id,blockId:id,sectionId:section.id});};
  const domainEvidenceResult=domainEvidence&&project.researchResults[domainEvidence.resultId];
  const domainEvidenceSection=domainEvidence&&chapterForBlock(domainEvidenceResult,domainEvidence.blockId);
  const proposal = activeProposal;
  const matchingSearch = artifactSearches.slice().reverse().find(s => s.query.trim() === query.trim() && s.accessIds.every(id => artifact.draft.sourceAccessIds.includes(id)));
  const entryFailure = latestTask && ['clarify', 'retrieve', 'landscape'].includes(latestTask.mode) && ['failed', 'interrupted', 'cancelled'].includes(latestTask.status) ? latestTask : null;
  const pendingResults = Object.values(project.researchResults ?? {}).filter(r => r.artifactId === artifactId && r.kind === 'brief' && r.id !== artifact.draft.resultId && !r.adoptedAt);
  const renderDomainSupplement = (request, inline = false) => <DomainSupplement request={request} inline={inline} goal={project.goal} onClose={() => setDomainSupplement(null)} query={query} onQuery={setQuery} proposal={proposal} search={matchingSearch} task={activeTask} busy={busy || !caps} configurationPending={!caps} configured={caps?.models.configured} recipient={caps?.models.configured ? new URL(caps.models.baseUrl).hostname : null} failure={entryFailure} onPrepare={text => action(() => startTask('clarify', text))} onSearch={() => action(() => startTask('retrieve'))} onMore={() => action(() => startTask('retrieve', '', { retrievalOffset: (matchingSearch?.offset ?? 0) + 20 }))} onResume={focus => action(async () => { if (await startTask('landscape', `结合原有材料与新增材料，更新领域认识。重点回答：${focus || request.focus}。保留其他有依据的认识，明确哪些理解发生变化。`, { search: matchingSearch })) setDomainSupplement(null); })} onModel={() => { setDomainSupplement(null); setModal('model'); }} selectedCount={materialIds.length} materialReview={matchingSearch && <MaterialReview project={project} ids={uniqueAccessIds(project, artifact.draft.sourceAccessIds)} selectedIds={materialIds} onSelection={setMaterialIds} disabled={busy || Boolean(activeTask)} onSource={(...args) => { setDomainSupplement(null); source(...args); }}/>}/>;
  const targetedSearch = !historical && ['questions', 'research_brief', 'research_branch'].includes(currentResult?.kind) && <TargetedMaterialSearch query={query} onQuery={setQuery} proposal={proposal} search={matchingSearch} task={activeTask} busy={busy || !caps} configurationPending={!caps} configured={caps?.models.configured} recipient={caps?.models.configured ? new URL(caps.models.baseUrl).hostname : null} focusText={continueQuestion?.text} scopeMode={searchScopeMode} previousQuery={previousQuery} previousSearch={latestSearch} searches={artifactSearches} failure={entryFailure} libraryReady={artifact.kind==='topic_library'} onLibrary={artifact.kind==='research_branch'?()=>action(openLibrary):undefined} onPrepare={(text, scopeMode, calibrate) => action(() => startTask('clarify', text, { searchScopeMode: scopeMode, ...(calibrate ? { accessIds: matchingSearch?.accessIds ?? [] } : {}) }))} onSearch={() => action(() => startTask('retrieve'))} onModel={() => setModal('model')} materialReview={artifact.kind !== 'topic_library' && matchingSearch && <MaterialReview project={project} ids={uniqueAccessIds(project, matchingSearch.accessIds)} selectedIds={materialIds} onSelection={setMaterialIds} disabled={busy || Boolean(activeTask)} onSource={source}/>}/>;
  return <div className={`app-shell ${currentResult?.kind === 'brief' ? `domain-page ${domainComposerOpen || panel === 'discussion' ? 'domain-chat-open' : ''}` : ''} ${artifact.kind==='topic_library'?'topic-library-page':''} guided-reading ${artifact.kind==='topic_library'&&topicStep==='figures'?'figure-active':''} ${readingMode === 'visual' ? 'visual-first' : 'full-reading'} ${left ? 'left-open' : ''} ${panel ? 'right-open' : ''}`}>
    <nav className="rail" aria-label="工作区导航"><div className="brand-symbol"><Icon name="leaf" size={31}/></div><IconButton name="edit" label="新建课题" onClick={() => navigate(onHome)}/><IconButton name="folder" label="我的课题" onClick={() => navigate(onProjects)}/><IconButton name="clock" label="研究进展" onClick={openHistory}/><div className="rail-bottom"><IconButton name="info" label="本机模型与说明" onClick={() => setModal('model')}/></div></nav>
    <header className="topbar"><button className="project-title" onClick={() => navigate(() => setModal('project'))}><Icon name="folder" size={22}/><span>{project.name}</span></button><div className="top-actions"><BuildLabel/><span className={`save-state ${draft.status}`} aria-live="polite">{saveLabels[draft.status]}</span><button aria-expanded={left} className={left ? 'active' : ''} onClick={() => setLeft(!left)}><Icon name="outline"/>大纲</button><button aria-expanded={panel === 'notes'} className={panel === 'notes' ? 'active' : ''} onClick={() => setPanel(panel === 'notes' ? null : 'notes')}><Icon name="comment"/>批注</button><button aria-controls="research-inspector" aria-expanded={panel === 'discussion'} className={panel === 'discussion' ? 'active' : ''} onClick={() => { setDomainComposerOpen(panel !== 'discussion'); setPanel(panel === 'discussion' ? null : 'discussion'); }}><Icon name="comment"/>交流</button></div></header>
    {left && <aside className="outline-panel"><ResearchPathNav project={project} activeId={artifactId} onOpen={selectArtifact} disabled={busy}/><div className="panel-heading"><h2>本页大纲</h2><IconButton name="chevron" label="收起大纲" onClick={() => setLeft(false)}/></div><ResearchOutline artifactLabel={artifact.kind === 'research_branch' ? '本题的论证与设计' : artifact.title} blocks={historical?blocks:modelBlocks} selected={selected} onJump={jump} onTop={() => { readRef.current.scrollTop = 0; if (window.innerWidth < 1100) setLeft(false); }} onSources={() => setPanel('sources')} sourceCount={accesses.length}/><div className="outline-bottom"><Icon name="link" size={16}/>内容与来源，一起保留</div></aside>}
    <main className="workspace-main">
      <BuildNotice onReload={() => action(async () => { if (!(await draft.flush())) return; if (persistComposer()) window.location.reload(); })}/>
      {(draft.error || draft.storageError || error) && <div role="alert" className="error-banner"><span>{draft.error || draft.storageError || error}</span>{['error', 'conflict'].includes(draft.status) && <><button onClick={() => download('未保存的个人认识.json', JSON.stringify(draft.notes, null, 2))}>下载草稿</button>{draft.status === 'error' ? <button onClick={draft.retry}>重试保存</button> : <button onClick={() => action(async () => { setCompared(await api.workspace(project.id)); setModal('conflict'); })}>对照修改</button>}</>}</div>}
      {pendingStart && <div className="history-banner"><span>上次开始请求尚未确认，输入已保留。</span><button onClick={() => action(async () => { await api.request(`/api/projects/${project.id}/research-tasks`, { method: 'POST', ...pendingStart }); localStorage.removeItem(startKey); setPendingStart(null); await refresh(); setPanel('discussion'); setNotice('已确认上次请求，未重复创建任务。'); })}>确认上次请求状态</button></div>}
      {draft.legacy && <div className="history-banner"><span>发现旧页面尚未提交的草稿，原文仍保留。</span><button onClick={() => setModal('legacy')}>查看并迁入</button></div>}
      {historical && <div className="history-banner"><span>正在查看历史内容 · {date(revision.createdAt)}</span><button disabled={busy} onClick={returnCurrent}>返回当前</button><button disabled={busy} onClick={restore}>恢复这份进展</button></div>}
      {activeTask && <TaskActivity project={project} onSource={source} task={activeTask} onStop={() => action(async () => { await api.request(`/api/projects/${project.id}/research-tasks/${activeTask.id}/stop`, { method: 'POST', body: {} }); await refresh(); })}/>}
      {!activeTask&&latestTask&&<SavedBatches task={latestTask} project={project} onSource={source}/>}
      {!activeTask && latestTask && ['failed', 'interrupted', 'cancelled'].includes(latestTask.status) && <div className="task-outcome" role="status"><div><strong>{latestTask.localRecovery?'已恢复此前生成的正文':'这一步尚未完成，已有成果保留'}</strong><p>{latestTask.localRecovery?'可以继续完成本节，再核对依据与优化表达。':latestTask.error || statuses[latestTask.status]}</p></div><button onClick={() => setPanel('discussion')}>查看原因与继续方式</button></div>}
      <div className="reading-scroll" ref={readRef}><article className={currentResult ? "document has-result" : "document"}>
        {!historical && <CurrentResearch historical={historical} project={project} artifactId={artifactId} onOpen={()=>setContinuityOpen(true)} onDiscuss={text=>{setMessage(text);focusConversation();}}/>}
        <div className="reading-toolbar"><ResearchBreadcrumbs project={project} artifact={artifact} onOpen={selectArtifact} onVersion={openTarget}/><details className="reading-options"><summary>阅读与成果</summary><div className="reading-mode"><span>阅读方式</span>{[['visual','图解优先'],['full','完整阅读']].map(([id,label])=><button key={id} aria-pressed={readingMode===id} onClick={()=>{setReadingMode(id);localStorage.setItem(artifact.kind === 'brief' ? 'rw2:domain-reading-mode:v029' : 'rw2:reading-mode',id);}}>{label}</button>)}</div><ArtifactPicker project={project} value={artifactId} onChange={selectArtifact} disabled={busy}/></details></div>{artifact.kind !== 'topic_library' && <div className="intent-bubble">{revision?.projectContext?.goal ?? project.goal}</div>}<div className="document-meta">{project.example ? '虚构交互示例 · 你的研究记录' : artifact.kind === 'topic_library' ? '选定专题 · 检索与证据分析' : currentResult?.kind === 'questions' ? '研究问题 · 比较与取舍' : currentResult?.kind === 'research_brief' ? '课题工作简报 · 继续研究' : artifact.kind === 'research_branch' ? '选题探索 · 论证与研究设计' : '领域理解 · 材料与认识'}</div><div className="document-title"><h1>{artifact.kind === 'research_branch' ? '选题论证' : artifact.title}</h1></div>
        {!historical && !['questions','research_branch'].includes(artifact.kind) && <ReadingGuide project={project} artifact={artifact} question={continueQuestion} disabled={busy} running={Boolean(activeTask)} onContinue={continueSelected} hasInvestigation={hasInvestigation} onInvestigate={investigate} onOpenLibrary={()=>action(openLibrary)} onViewInvestigation={viewInvestigation}/>}
        {!historical && (!currentResult || currentResult.kind === 'brief') && <ResearchEntry query={query} onQuery={setQuery} proposal={proposal} search={matchingSearch} task={activeTask} busy={busy || !caps} configurationPending={!caps} currentResult={currentResult} configured={caps?.models.configured} recipient={caps?.models.configured ? new URL(caps.models.baseUrl).hostname : null} failure={entryFailure} onPrepare={text => action(() => startTask('clarify', text))} onSearch={() => action(() => startTask('retrieve'))} onMore={() => action(() => startTask('retrieve', '', { retrievalOffset: (matchingSearch?.offset ?? 0) + 20 }))} onResume={() => action(() => startTask('landscape', '', { search: matchingSearch }))} onModel={() => setModal('model')} selectedCount={materialIds.length} materialReview={matchingSearch && <MaterialReview project={project} ids={uniqueAccessIds(project, artifact.draft.sourceAccessIds)} selectedIds={materialIds} onSelection={setMaterialIds} disabled={busy || Boolean(activeTask)} onSource={source}/>}/>}
        {!['questions','research_branch'].includes(artifact.kind) && targetedSearch}
        {!historical && artifact.kind==='topic_library' && <TopicLibraryWorkbench step={topicStep} onStep={changeTopicStep} options={topicOptions} onOptions={setTopicOptions} onSearchHelp={searchHelp} project={project} artifact={artifact} result={currentResult} question={continueQuestion} query={query} onQuery={setQuery} onRun={(kind,options)=>action(()=>startTask(kind,options.text??'',options))} onEdit={editLibrary} onRefresh={refresh} operationError={error} onTemplateEdit={editTemplates} onTemplates={()=>openTemplates()} onScreen={screenLibrary} onSource={source} selectedIds={materialIds} onSelection={setMaterialIds} onAnalyze={()=>action(()=>startTask('topic-outline','复用所选材料的已存发现，按本题成果路线编排二级大纲、证据映射与待补需求。'))} disabled={busy||Boolean(activeTask)||!caps} reviewDisabled={busy||!caps} task={activeTask} readingMode={readingMode} recipient={caps?.models.configured?new URL(caps.models.baseUrl).hostname:null}/>}
        {!historical && <BriefContinuity project={project} artifact={artifact} result={currentResult} disabled={busy || Boolean(activeTask)} onOpen={selectArtifact} onRepair={inputArtifactId => researchCommand('compose-brief', { artifactId, ...(inputArtifactId ? { inputArtifactId } : {}) })}/>}
        {!historical && !(currentResult?.kind==='brief'&&readingMode==='full') && <ResearchVisuals renderSupplement={request => renderDomainSupplement(request, true)} onSupplement={setDomainSupplement} project={project} artifact={artifact} onOpen={selectArtifact} result={currentResult} numbers={numbers} onJump={currentResult?.kind==='brief'?openDomainEvidence:jump} onSource={source} onDeepen={deepenQuestion} disabled={busy || Boolean(activeTask)} onCompare={() => action(() => startTask('compare', '依据所选材料先比较领域选题的可行性、潜在创新、投入价值、月份周期与星级难度，再提供具体研究设计与核查路径。'))}/>}
        {!historical && artifact.kind === 'research_branch' && <QuestionRoute question={continueQuestion} onDetails={jump} project={project} numbers={numbers} onSource={source}/>}
        {!historical && artifact.kind === 'research_branch' && <ReadingGuide project={project} artifact={artifact} question={continueQuestion} disabled={busy} running={Boolean(activeTask)} onContinue={continueSelected} hasInvestigation={hasInvestigation} onInvestigate={investigate} onOpenLibrary={()=>action(openLibrary)} onViewInvestigation={viewInvestigation}/>}
        {!historical && artifact.kind === 'research_branch' && lastInvestigation && !currentResult?.investigationResultId && <details id="block-saved-investigation" className="saved-investigation"><summary>此前已完成的选题论证 · 展开阅读</summary><p>承接同一问题版本的已保存讨论 · {date(lastInvestigation.createdAt)}</p><ScientificReading blocks={project.researchResults[lastInvestigation.resultId].blocks} renderBlocks={subset=><ResultBlocks numbers={numbers} blocks={subset} citations={project.researchResults[lastInvestigation.resultId].citations} selected={selected} onSelect={setSelected} onSource={source}/>}/><button onClick={investigate} disabled={busy || Boolean(activeTask)}>补充材料后重新论证</button></details>}

        {!historical && !['brief', 'research_branch', 'topic_library'].includes(currentResult?.kind) && <ResearchJourney project={project} artifact={artifact} numbers={numbers} disabled={busy || Boolean(activeTask)} onCommand={researchCommand} onCompare={() => action(() => startTask('compare', '先比较领域选题的价值、潜在创新与个人可行性，给出有假设和依据的月份区间和 1–5 星执行难度；再附拟议研究设计及反证，不保证发表。'))} onDeepen={deepenQuestion} onContinue={continueSelected} onSource={source} onArtifact={selectArtifact} onFocusQuestion={q => { setSelectedQuestion(q); setReplyTask(null); focusConversation(); }}/>}
        {historical ? <ResultBlocks numbers={numbers} blocks={blocks} citations={displayedResult?.citations} selected={selected} onSelect={setSelected} onNote={id => { setSelected(id); setNotesTab('annotations'); setPanel('notes'); }} onSource={source}/>
          : <>{modelBlocks.length > 0 && artifact.kind!=='topic_library' && <><p className="result-label">{currentResult ? currentResult.kind === 'research_brief' ? '基于已保存的研究问题、依据与决定 · 保留原有适用范围' : '模型辅助分析 · 基于实际访问材料 · 由研究者审阅' : '虚构交互示例，不作为真实研究依据'}</p>{currentResult?.kind === 'brief' && <details className="full-evidence"><summary>查看逐篇整理与材料覆盖</summary><ResearchCoverage project={project} result={currentResult} onSource={source}/></details>}{currentResult?.kind==='brief'&&readingMode==='visual'&&<button className="atlas-text-link" onClick={()=>setReadingMode('full')}>阅读完整文字报告</button>}{currentResult?.kind==='brief'&&readingMode==='full'&&<div className="domain-full-reading-return"><button onClick={()=>setReadingMode('visual')}>返回完整领域图解</button></div>}{currentResult?.kind !== 'questions' && !(currentResult?.kind==='brief'&&readingMode==='visual') && <details key={readingMode} className="full-evidence" open={readingMode === 'full'}><summary>展开完整论证与原文依据</summary><ScientificReading blocks={modelBlocks} renderBlocks={subset => <ResultBlocks numbers={numbers} blocks={subset} citations={currentResult?.citations} selected={selected} onSelect={setSelected} onNote={id => { setSelected(id); setNotesTab('annotations'); setPanel('notes'); }} onSource={source}/>}/></details>}</>}
        {!historical && ['brief', 'research_branch'].includes(currentResult?.kind) && <ResearchJourney project={project} artifact={artifact} numbers={numbers} disabled={busy || Boolean(activeTask)} onCommand={researchCommand} onCompare={() => action(() => startTask('compare', '先比较领域选题的价值、潜在创新与个人可行性，给出有假设和依据的月份区间和 1–5 星执行难度；再附拟议研究设计及反证，不保证发表。'))} onDeepen={deepenQuestion} onContinue={continueSelected} onSource={source} onArtifact={selectArtifact} onFocusQuestion={q => { setSelectedQuestion(q); setReplyTask(null); focusConversation(); }}/>}
        {['questions','research_branch'].includes(artifact.kind) && targetedSearch}
</>}
        {!historical && pendingResults.length > 0 && <div className="pending-results"><h2>可查看的简报更新</h2>{pendingResults.slice().reverse().map(r => <div key={r.id}><span>{date(r.createdAt)} · {project.researchTasks[r.taskId]?.staleInput ? '基于较早的输入' : '待你查看'}</span><button onClick={() => setPreviewResult(r.id)}>查看这次更新</button></div>)}</div>}
        <div className="source-strip"><button onClick={() => setPanel('sources')}><Icon name="book"/><span>{accesses.length ? `${accesses.length} 份参考材料 · 查看实际读取范围` : '尚未关联参考材料'}</span><span className="source-cta">查看依据<Icon name="link" size={16}/></span></button></div>
        <div className="document-actions"><button disabled={historical || busy} onClick={() => navigate(() => setModal('source'))}><Icon name="plus" size={16}/>补充参考材料</button><button disabled={historical || busy} onClick={() => navigate(() => { setCheckpointName(''); setModal('checkpoint'); })}><Icon name="clock" size={16}/>保留当前进展</button><button onClick={() => exportFile('md')} disabled={busy}><Icon name="download" size={16}/>导出</button></div>
        <p className="document-boundary">{currentResult ? '这是本次材料范围内的初步认识，不代表完整综述或已证实的研究空白。' : '个人记录与研究依据分别保留。你可以从任何已有认识开始。'}</p>
      </article></div>
      <div className="composer-area"><form className={`composer ${message ? 'has-input' : ''} ${searchConversation?'search-conversation':''}`} onSubmit={e => { e.preventDefault(); postMessage(); }}><div className="composer-input"><textarea rows={1} ref={composerRef} aria-label={searchConversation?"检索调整要求":"课题交流"} value={message} onChange={e => setMessage(e.target.value)} placeholder={searchConversation?"例如：相关文献太少，请保留本题核心对象，放宽次要限制…":"继续提问或记录想法…"}/><button className="send-button" aria-label={searchConversation?'生成检索建议':mode === 'record' ? '记录想法' : isContinueNavigation(message) ? '进入下一步' : '发送并开始本步'} disabled={!message.trim() || busy || ((searchConversation||!isContinueNavigation(message)) && (Boolean(activeTask) || (historical && mode !== 'record')))}><Icon name="arrow" size={21}/></button></div><button type="button" className="composer-idle-scope" onClick={()=>composerRef.current?.focus()}>{searchConversation?'调整本题检索式 · 自动结合当前校准与日期条件':mode === 'record' ? '仅记录想法 · 本机保存' : `${materialIds.length} 份本次材料 · 点击输入后调整交流范围`}</button><div className="composer-bottom"><div className="composer-context">{replyTask && <button type="button" className="context-chip" onClick={() => setReplyTask(null)}>接着上一步答复 · 取消</button>}{selectedQuestion && <button type="button" className="context-chip" onClick={() => setSelectedQuestion(null)}>围绕：{selectedQuestion.text.slice(0, 18)} · 取消</button>}{!selectedQuestion && selectedBlock && <button type="button" className="context-chip" onClick={() => jump(selected)}>“{selectedBlock.text?.slice(0, 16) || '当前段落'}”</button>}<select aria-label="本次交流方式" value={mode} onChange={e => setMode(e.target.value)}>{artifact.kind==='topic_library'&&<option value="topic-plan">调整本题检索式</option>}<option value="clarify">梳理探索范围</option><option value="ask">围绕材料追问</option><option value="revise">根据反馈更新简报</option><option value="record">仅记录想法</option></select><button type="button" className="text-button" onClick={() => { setPanel('sources'); setMaterialChoice(true); }}>{searchConversation?'查看材料':`${materialIds.length} 份本次材料`}</button></div></div><div className="send-scope">{searchConversation ? '生成后在页面选择并修改；不会自动检索或收集。' : mode === 'record' ? '仅保存到本机' : isContinueNavigation(message) ? '打开当前选题的工作页面 · 本次不调用模型' : caps?.models.configured ? `发送本次课题记录、相关交流与所选材料至 ${new URL(caps.models.baseUrl).hostname}` : '模型尚未配置 · 先保留想法，随时接入'}</div></form><div className="live-notice" role="status">{saveLabels[draft.status]}{notice ? ` · ${notice}` : ''}</div></div>
    </main>
    {domainSupplement && renderDomainSupplement(domainSupplement)}
    {domainEvidenceSection&&<Modal title={`${domainEvidenceSection.heading.text} · 原文与依据`} onClose={()=>setDomainEvidence(null)}><div className="domain-original-section"><p className="source-callout">查看本节保存的完整论证与原文定位。</p>{domainEvidenceSection.heading.dimensionLimitation&&<p className="source-callout">{domainEvidenceSection.heading.dimensionLimitation}</p>}{domainEvidenceSection.items.map(b=><div key={b.id}>{b.headline&&<h3>{b.headline}</h3>}<ResultBlocks blocks={[b]} numbers={numbers} citations={domainEvidenceResult.citations} selected={domainEvidence.blockId} onSelect={setSelected} onSource={(...args)=>{setDomainEvidence(null);source(...args);}} onNote={id=>{setDomainEvidence(null);setSelected(id);setNotesTab('annotations');setPanel('notes');}}/></div>)}</div></Modal>}
    {panel && <aside className="inspector" id="research-inspector"><div className="panel-heading"><h2>{({ notes: '批注', sources: '参考材料', history: '研究进展', discussion: '课题交流', usage: '本机调用记录' })[panel]}</h2><IconButton name="close" label="收起辅助面板" onClick={() => setPanel(null)}/></div><div className="inspector-body">
      {panel === 'notes' && <><div className="notes-tabs" role="tablist" aria-label="批注内容">{[['annotations','文段批注'],['records','研究记录'],['templates','模板文献']].map(([id,label])=><button key={id} role="tab" id={`notes-tab-${id}`} aria-controls={`notes-panel-${id}`} aria-selected={notesTab===id} tabIndex={notesTab===id?0:-1} onClick={()=>setNotesTab(id)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const ids=['annotations','records','templates'],next=e.key==='Home'?0:e.key==='End'?2:(ids.indexOf(id)+(e.key==='ArrowRight'?1:2))%3;setNotesTab(ids[next]);requestAnimationFrame(()=>document.getElementById(`notes-tab-${ids[next]}`)?.focus());}}}>{label}</button>)}</div><div hidden={notesTab!=='templates'} role="tabpanel" id="notes-panel-templates" aria-labelledby="notes-tab-templates"><ResearchTemplates onRefresh={refresh} key={artifact.id} project={project} artifact={artifact} disabled={busy||historical||Boolean(activeTask)} onEdit={editTemplates} onReadZotero={async(paperId,attachmentKey)=>{await api.request(`/api/projects/${project.id}/templates/${paperId}/zotero-text`,{method:'POST',requestId:crypto.randomUUID(),body:{artifactId,attachmentKey,baseTemplateVersion:pRef.current.templateLibrary?.version??1}});await refresh();return true;}} onRun={(kind,options)=>action(()=>startTask(kind,options.text??'',options))} task={activeTask} recipient={caps?.models.configured?new URL(caps.models.baseUrl).hostname:null}/></div>{notesTab==='templates'?null:notesTab==='records'?<div role="tabpanel" id="notes-panel-records" aria-labelledby="notes-tab-records"><p className="personal-notes-help">记录研究设想、当前认识与后续安排，自动保存。</p>{Object.entries(labels).map(([key,label])=><section className="personal-section" key={key}><h3>{label}</h3><AutoNote label={label} value={draft.notes[key]} placeholder={hints[key]} onChange={text=>draft.setNotes(n=>({...n,[key]:text}))} onBlur={draft.flush} composing={draft.composing} disabled={busy||historical}/></section>)}</div>:<div role="tabpanel" id="notes-panel-annotations" aria-labelledby="notes-tab-annotations"><p className="label">关联原文 · {historical ? '历史内容' : '当前内容'}</p><blockquote>{selectedBlock?.text || '选择原文后添加批注。'}</blockquote><label className="note-label">我的批注<textarea aria-label="我的批注" value={note} onChange={e => setNote(e.target.value)} maxLength={10000}/></label><button className="primary" disabled={!selectedBlock || !note.trim() || busy} onClick={addNote}>保存批注</button><div className="annotation-list">{annotations.slice().reverse().map(a => <div className="annotation" key={a.id}><button className="annotation-anchor" onClick={() => openTarget(a.target)}>查看当时原文<Icon name="return" size={14}/></button><p>{a.text}</p><small>{date(a.createdAt)} · {a.status === 'resolved' ? '已处理' : '待处理'}</small><button className="text-button" onClick={() => action(async () => { await api.command(project.id, 'resolve-annotation', { annotationId: a.id, baseVersion: a.version, status: a.status === 'open' ? 'resolved' : 'open' }); await refresh(); })}>{a.status === 'open' ? '标记已处理' : '重新打开'}</button></div>)}</div></div>}</>}
      {panel === 'history' && <><p className="muted">日常输入自动保存。这里保留阶段成果与你手动留下的进展。</p><button className={!historical ? 'current-progress selected' : 'current-progress'} disabled={busy} onClick={returnCurrent}>当前内容 · 持续保存中</button><div className="version-list">{artifact.checkpoints.slice().reverse().map(c => <div className="checkpoint-row" key={c.id}><button className={viewId === c.revisionId ? 'selected' : ''} onClick={() => viewRevision(c.revisionId)}><Icon name="clock"/><span><strong>{c.name}</strong><small>{date(c.createdAt)}{c.type === 'generated' ? ' · 已生成，非科学采纳' : ''}</small></span></button>{c.beforeRevisionId && <button className="text-button" onClick={() => viewRevision(c.beforeRevisionId)}>查看恢复前内容</button>}</div>)}{!artifact.checkpoints.length && <p className="muted">还没有阶段留档。形成领域结果时会自动保存，也可以手动保留当前进展。</p>}</div><details><summary>旧版历史（{artifact.legacyRevisionIds.length}）</summary><div className="version-list">{artifact.legacyRevisionIds.slice().reverse().map(id => { const r = artifact.revisions.find(r => r.id === id); return <button key={id} onClick={() => viewRevision(id)}>旧版本 {r.number} · {date(r.createdAt)}</button>; })}</div></details><p className="label">导出{historical ? '正在查看的历史内容' : '当前内容'}</p><div className="export-actions"><button onClick={() => exportFile('md')}>Markdown</button><button onClick={() => exportFile('json')}>完整 JSON</button></div></>}
      {panel === 'sources' && <><p className="muted">题名、摘要和你提供的文本分别标注。引用核对通过，仍不等于结论经过人工核验。</p>{latestSearch && <details open><summary>本次检索范围</summary><p className="source-text">{latestSearch.query}</p><p className="muted">{latestSearch.coverage}<br/>取得 {latestSearch.retrievedCount} 条，检索时送入模型 {latestSearch.modelAccessIds.length} 条（后续分析见简报覆盖记录）；未取得 {latestSearch.missingIds.length} 条。{latestSearch.warnings.map(w => w.message).join(' ')}</p></details>}<label className="check-label"><input type="checkbox" checked={materialChoice} onChange={e => setMaterialChoice(e.target.checked)}/>选择本次发送给模型的材料</label>{materialChoice && <div className="start-actions"><button disabled={historical || busy || Boolean(activeTask)} onClick={() => setMaterialIds(accesses.filter(a => artifact.draft.sourceAccessIds.includes(a.id) && project.sources[a.sourceId].origin !== 'synthetic_fixture').map(a => a.id))}>全选</button><button disabled={historical || busy || Boolean(activeTask)} onClick={() => setMaterialIds([])}>清空</button><span>已选 {materialIds.length} 份</span></div>}{accesses.length === 0 && <p>还没有材料，可以先检索或手动补充。</p>}{[...accesses].sort((a, b) => Number(b.id === focusSource) - Number(a.id === focusSource)).map(access => { const s = project.sources[access.sourceId]; const citations = (focusCitation && access.id === focusSource ? [focusCitation] : (displayedResult?.citations ?? []).filter(c => c.accessId === access.id && (!selected || c.blockId === selected))); return <section className={`source-detail ${focusSource === access.id ? 'source-focused' : ''}`} key={access.id}>{materialChoice && s.origin !== 'synthetic_fixture' && <label className="check-label"><input type="checkbox" aria-label={`使用材料 ${s.title}`} checked={materialIds.includes(access.id)} disabled={historical || busy || Boolean(activeTask)} onChange={e => selectMaterial(access.id, e.target.checked)}/>{artifact.draft.sourceAccessIds.includes(access.id) ? '用于本次交流' : '关联到当前成果并用于本次交流'}</label>}<h3><span className="paper-number">[{numbers[s.id]}] </span>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title}</h3><small>{s.year || s.published || '年份未取得'} · {s.authors?.join(', ') || '作者未取得'}</small><div className="source-tags"><span>{levels[access.level]}</span><span>{s.origin === 'pubmed' ? 'PubMed' : s.origin === 'synthetic_fixture' ? '虚构示例' : '你提供的内容'}</span><span>未人工核验</span></div>{citations.map((c, i) => <blockquote key={i}>{c.quote}</blockquote>)}<details open={focusSource === access.id}><summary>查看实际读取的文本</summary><p className="source-text">{access.text}</p></details></section>; })}<button disabled={historical || busy} onClick={() => navigate(() => setModal('source'))}>补充材料</button><p className="muted"><a href="https://www.ncbi.nlm.nih.gov/home/about/policies/" target="_blank" rel="noreferrer">NCBI 使用与版权说明</a></p></>}
      {panel === 'discussion' && <><div className="discussion-guide"><p>原文留在中央，围绕当前内容随时交流。</p><button onClick={focusConversation}>在下方输入框继续交流</button></div>{tasks.slice().reverse().map(t => { const r = t.resultId ? project.researchResults[t.resultId] : null; return <details className="task-card" key={t.id} open={t.id === primaryTaskId}><summary>{date(t.createdAt)} · {statuses[t.status]} · {t.input.text ? t.input.text.slice(0, 24) : '研究任务'}</summary><small>{date(t.createdAt)} · {statuses[t.status]}</small>{t.input.text && <blockquote className="task-question">{t.input.text}</blockquote>}<p>{t.error || t.progress}</p>{t.staleInput && <p className="muted">生成期间你的记录已有更新；这次结果基于较早输入。</p>}{t.proposal && <><p>{t.proposal.explanation}</p><ul>{t.proposal.questions.map(q => <li key={q}>{q}</li>)}</ul><p>{t.proposal.scope}</p></>}{['questions', 'research_brief', 'research_branch','topic_review'].includes(r?.kind) && <button onClick={() => selectArtifact(r.artifactId)}>打开{r.kind === 'questions' ? '候选比较' : r.kind==='topic_review'?'专题文献分析':'课题工作简报'}</button>}{r?.kind === 'answer' && <ResultBlocks numbers={numbers} blocks={r.blocks} citations={r.citations} selected="" onSelect={() => {}} onSource={source} prefix={`answer-${r.id}-`}/>} {r?.kind === 'brief' && <button onClick={() => setPreviewResult(r.id)}>查看领域简报</button>}{['failed', 'interrupted', 'cancelled'].includes(t.status) && <button disabled={busy || Boolean(activeTask)} onClick={() => action(() => startTask(t.mode, t.input.text, { retryOf: t.id, search: t.mode === 'landscape' && project.searches[t.searchId]?.accessIds.length ? project.searches[t.searchId] : null }))}>{t.mode === 'landscape' && project.searches[t.searchId]?.accessIds.length ? '用这次已取得的材料继续整理' : '按当前输入重新运行'}</button>}{t.status === 'failed' && !templateModes.includes(t.mode) && !['topic-writing','manuscript-writing'].includes(t.mode) && t.calls.length > 0 && <div className="saved-output-recheck"><button disabled={busy || Boolean(activeTask)} onClick={() => revalidateTask(t)}>重新校验已保存输出</button><small>保留原始输出和额外说明；只核对完整结果，不再调用模型。</small></div>}{t.status === 'completed' && <button onClick={() => replyTo(t)}>接着这一步交流</button>}<small>模型调用 {t.calls.length} 次 · 费用{t.cost?.status === 'unknown' ? '未知' : t.cost?.amount ?? '未知'}</small></details>; })}{Object.values(project.messages).filter(m => !tasks.some(t => t.messageId === m.id)).slice().reverse().map(m => <div className="message" key={m.id}><small>你的记录 · {date(m.createdAt)}</small><p>{m.text}</p>{m.target && <button className="text-button" onClick={() => openTarget(m.target)}>查看当时原文</button>}</div>)}</>}
      {panel === 'usage' && <><p>累计请求 {caps?.budget.used ?? 0} 次 · Demo 不设固定次数上限。失败和取消的调用也保留记录，服务商的账户额度仍以其平台为准。</p>{calls.slice().reverse().map(c => <div className="task-card" key={c.id}><strong>{c.model}</strong><p>{c.provider} · {c.status}</p><small>{date(c.startedAt)} · tokens {c.usage?.total_tokens ?? '未知'} · 费用未知</small></div>)}</>}
    </div><div className="inspector-foot"><button className="text-button" onClick={() => action(async () => { setCalls(await api.request('/api/model-calls')); await refreshCaps(); setPanel('usage'); })}>查看调用记录</button><span>本机保存</span></div></aside>}
    {modal === 'model' && <ModelForm capabilities={caps} onClose={() => setModal(null)} onSaved={refreshCaps} onTest={() => action(() => startTask('connection'))} busy={busy}/>}
    {modal === 'source' && <SourceForm busy={busy} error={error} onClose={() => setModal(null)} onSubmit={body => action(async () => { if (!(await draft.flush())) return; await command('attach-material', body); const p = await refresh(); draft.acceptServer(p.artifacts[artifactId].draft); setModal(null); setPanel('sources'); setMaterialChoice(true); setNotice('材料已保存；可选择是否用于模型交流。'); })}/>}
    {modal === 'project' && <ProjectForm project={project} busy={busy} error={error} onClose={() => setModal(null)} onSubmit={body => action(async () => { if (!(await draft.flush())) return; await api.command(project.id, 'update-project', body); await refresh(); setModal(null); })}/>}
    {continuityOpen && <ResearchContinuity project={project} artifactId={artifactId} onProject={commitProject} onClose={()=>setContinuityOpen(false)} onDiscuss={text=>{setMessage(text);focusConversation();}} onTarget={target=>{if(target.type==='research_item'){setContinuityOpen(true);return;}if(target.artifactId&&target.artifactId!==artifactId){selectArtifact(target.artifactId);return;}if(target.type==='writing'){changeTopicStep('write');editLibrary({action:'writing-select',outlineId:target.outlineId,sectionId:target.sectionId});}else if(target.type==='figure')changeTopicStep('figures');else if(target.type==='outline')changeTopicStep('outline');else if(target.revisionId)openTarget({artifactId:target.artifactId??target.id,revisionId:target.revisionId});}}/>}
    {modal === 'checkpoint' && <Modal title="保留当前进展" onClose={() => setModal(null)}><p>留下值得回看的当前内容。日常修改仍会自动保存，无须每次留档。</p><label>名称（可不填）<input aria-label="进展名称" maxLength={120} value={checkpointName} onChange={e => setCheckpointName(e.target.value)} placeholder="保留当前进展"/></label><div className="modal-actions"><button className="primary" disabled={busy} onClick={() => action(async () => { if (!(await draft.flush())) return; await command('checkpoint', { name: checkpointName }); await refresh(); setModal(null); setPanel('history'); setNotice('进展已保留，相同内容不会重复留档。'); })}>保留这份进展</button></div></Modal>}
    {modal === 'legacy' && <Modal title="对照旧页面的未提交草稿" onClose={() => setModal(null)}><p>仅把可对应的个人正文迁入固定章节。旧标题及其他内容仍保存在原草稿中，可完整下载。</p><pre className="legacy-preview">{JSON.stringify(draft.legacy, null, 2)}</pre><div className="modal-actions"><button onClick={() => download('旧页面完整草稿.json', JSON.stringify(draft.legacy, null, 2))}>下载完整旧草稿</button><button className="primary" onClick={() => { draft.importLegacy(); setModal(null); }}>迁入个人正文</button></div></Modal>}
    {modal === 'conflict' && compared && <Modal title="对照两份个人认识" onClose={() => setModal(null)}><p>保留你正在输入的内容，与本机已保存的另一份修改对照。</p><div className="conflict-comparison"><div><h3>你的输入</h3><pre>{Object.entries(draft.notes).map(([k, v]) => `${labels[k]}\n${v}`).join('\n\n')}</pre></div><div><h3>本机保存内容</h3><pre>{Object.entries(compared.artifacts[artifactId].draft.notes).map(([k, v]) => `${labels[k]}\n${v}`).join('\n\n')}</pre></div></div><div className="modal-actions"><button onClick={() => download('我的个人认识.json', JSON.stringify(draft.notes, null, 2))}>下载我的输入</button><button className="primary" onClick={() => action(async () => { if (await draft.saveOnCompared(compared.artifacts[artifactId].draft)) { await refresh(); setModal(null); } })}>保留我的这份修改</button></div></Modal>}
    {previewResult && project.researchResults[previewResult] && <Modal title="查看这次领域简报" onClose={() => setPreviewResult(null)}><p>AI 根据当时选定的材料整理。采用后更新研究内容，保留你的最新个人认识。</p><ResearchCoverage project={project} result={project.researchResults[previewResult]} onSource={(id, citation) => { setPreviewResult(null); source(id, citation); }}/><ResultBlocks numbers={numbers} blocks={project.researchResults[previewResult].blocks} citations={project.researchResults[previewResult].citations} selected="" onSelect={() => {}} onSource={(id, citation) => { setPreviewResult(null); source(id, citation); }} prefix="preview-"/><div className="modal-actions"><button onClick={() => setPreviewResult(null)}>继续查看当前内容</button>{artifact.draft.resultId !== previewResult && <button className="primary" disabled={busy} onClick={() => adopt(previewResult)}>用这份继续</button>}</div></Modal>}
  </div>;
}
