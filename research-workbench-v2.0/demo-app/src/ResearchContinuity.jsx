import {ExportEvidence} from './ExportEvidence.jsx';
import {useEffect,useRef,useState} from 'react';
import {api,date,download,Modal} from './ui.jsx';
import {currentWork,continuityLabels,protocolDraft,protocolFields,recordFields,outputModes,itemRef,itemVersion,continuityMarkdown,consistencyFindings,sameRef} from '../../shared/research-continuity.mjs';
import './research-continuity.css';

export function CurrentResearch({project,artifactId,onOpen,onDiscuss,historical}) {
  const work=currentWork(project,artifactId),s=work.snapshot;
  return <section className="current-research" aria-label="当前课题与下一步">
    <div className="current-research-line"><span className="current-research-label">{historical?'当前研究安排（下方为历史内容）':'当前课题'}</span><strong>{s.protocol?`采用方案 · 第 ${s.protocol.number} 版`:'研究方案尚未采用'}</strong><button onClick={onOpen}>方案与研究记录 →</button></div>
    <p>{work.next}</p><details><summary>查看当前问题、依据与未决{work.impacts.length?` · ${work.impacts.length} 项变化待处理`:''}</summary>
      <p>{work.question}</p><p className="muted">{work.questionAdopted?'已采用的问题':'当前探索范围'} · {work.nextReason}</p>
      {s.protocol&&<p>采用方案：{s.protocol.title} · {date(s.protocol.createdAt)}</p>}{s.result&&<p>后续使用：{s.result.title} · 第 {s.result.number} 版 · {continuityLabels[s.result.kind]}</p>}
      {work.unknowns.length?<ul>{work.unknowns.map((u,i)=><li key={i}>{u}</li>)}</ul>:<p>当前未决尚未整理，未记录不表示已经明确。</p>}
      <button onClick={()=>onDiscuss(`请结合当前采用的方案、所选结果与实际材料，解释下一项工作为什么是：${work.next}。先回答我的疑问，不自动改变采用方案。`)}>讨论下一步</button>
    </details>
  </section>;
}

function RecordEditor({project,artifactId,item,kind,onProject,onSaved,onDirty}) {
  const current=item?.revisions.find(r=>r.id===item.headRevisionId),work=currentWork(project,artifactId);
  const cacheKey=`rw2:continuity-draft:${project.id}:${artifactId}:${item?.id??kind}`;
  const [initial]=useState(()=>{try{return JSON.parse(localStorage.getItem(cacheKey));}catch{return null;}});
  const [draft,setDraft]=useState(()=>initial?.draft??(current?{title:current.title,payload:structuredClone(current.payload)}:kind==='protocol'?(()=>{const {title,...payload}=protocolDraft(project,artifactId);return {title,payload};})():{title:'',payload:{...Object.fromEntries(Object.keys(recordFields).map(k=>[k,''])),originKind:kind==='insight'?'external_ai':'user',verification:'unreviewed',executionStatus:'unknown',inputRefs:[work.snapshot.protocol?.ref,...(kind==='interpretation'&&work.snapshot.result?.kind==='execution'?[work.snapshot.result.ref]:[])].filter(Boolean)}}));
  const [base,setBase]=useState(initial?.base??current?.id??null),[dirty,setDirty]=useState(Boolean(initial)),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const latest=useRef(project);latest.current=project;
  const lock=useRef(false),pending=useRef(initial?.pending??null),compose=useRef(false);
  useEffect(()=>{onDirty(dirty||saving);return()=>onDirty(false);},[dirty,saving,onDirty]);
  const fields=kind==='protocol'?protocolFields:recordFields;
  const persist=(next,pendingValue=null)=>{try{localStorage.setItem(cacheKey,JSON.stringify({draft:next,base,pending:pendingValue}));}catch{setError('浏览器不能保留草稿，请立即保存或下载。');}};
  const change=(key,value)=>{const next=key==='title'?{...draft,title:value}:{...draft,payload:{...draft.payload,[key]:value}};setDraft(next);setDirty(true);persist(next);};
  const save=async()=>{
    if(lock.current||compose.current||!draft.title.trim()||!dirty&&item)return null;
    lock.current=true;setSaving(true);setError('');
    try {
      const request=pending.current??{requestId:crypto.randomUUID(),body:{artifactId,itemId:item?.id,kind,title:draft.title,payload:draft.payload,baseRevisionId:base,baseStateVersion:latest.current.researchState.version,prefilled:!item&&kind==='protocol'}};
      pending.current=request;persist(draft,request);
      const result=await api.request(`/api/projects/${project.id}/commands/save-continuity`,{method:'POST',...request});
      const next=await api.workspace(project.id);latest.current=next;onProject(next);setBase(result.revisionId);setDirty(false);pending.current=null;localStorage.removeItem(cacheKey);onSaved(result.itemId);return result;
    } catch(e){if(e.status===409||e.code==='revision_conflict'||e.code==='research_state_conflict'){pending.current=null;const next=await api.workspace(project.id);latest.current=next;onProject(next);}setError(e.message);return null;}
    finally{lock.current=false;setSaving(false);}
  };
  useEffect(()=>{if(!dirty||error)return;const timer=setTimeout(save,1000);return()=>clearTimeout(timer);},[draft,dirty,error]);
  const eligible=work.items.filter(i=>i.id!==item?.id&&i.kind!=='insight'&&(kind!=='protocol'||i.kind==='attachment'));
  const selectedRefs=draft.payload.inputRefs??[];
  const toggle=ref=>change('inputRefs',selectedRefs.some(r=>sameRef(r,ref))?selectedRefs.filter(r=>!sameRef(r,ref)):[...selectedRefs,ref]);
  const upload=async file=>{
    if(!file)return;setSaving(true);lock.current=true;setError('');
    try {
      const base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(file);});
      const result=await api.request(`/api/projects/${project.id}/research-files`,{method:'POST',requestId:crypto.randomUUID(),body:{artifactId,baseStateVersion:latest.current.researchState.version,name:file.name,base64}});
      const next=await api.workspace(project.id);latest.current=next;onProject(next);change('inputRefs',[...selectedRefs,{type:'research_item',id:result.itemId,revisionId:result.revisionId}]);
    }catch(e){setError(e.message);}finally{lock.current=false;setSaving(false);}
  };
  return <div className="continuity-editor" onCompositionStart={()=>{compose.current=true;}} onCompositionEnd={()=>{compose.current=false;setTimeout(save,0);}}>
    <div className="continuity-savebar"><span role="status">{saving?'正在保存…':error?'尚未确认保存':dirty?'编辑已在浏览器暂存，将自动保存':!item?'预填内容尚未保存；你可以修改后保存':'已保存内容与采用选择分别保留'}</span><button disabled={saving||!dirty&&Boolean(item)||!draft.title.trim()} onClick={save}>{pending.current?'核对并重试上次保存':'保存修改'}</button></div>
    {error&&<div role="alert" className="continuity-error"><p>{error}</p><button onClick={()=>download('未保存研究记录.json',JSON.stringify(draft,null,2))}>下载草稿</button>{item&&base!==current?.id&&<details><summary>对照服务器当前版本与我的输入</summary><h4>服务器已保存 · 第 {current.number} 版</h4><pre>{continuityMarkdown({kind,...current})}</pre><h4>我的输入</h4><pre>{continuityMarkdown({kind,...draft})}</pre><button onClick={()=>{setBase(current.id);pending.current=null;setError('');}}>已对照，以我的输入保存为新版本</button></details>}</div>}
    <fieldset disabled={saving||Boolean(pending.current)}><label>记录名称<input aria-label="记录名称" value={draft.title} onChange={e=>change('title',e.target.value)} maxLength={2000}/></label>
      {kind==='protocol'?<label>本轮成果用途<select aria-label="本轮成果用途" value={draft.payload.outputMode??'proposal'} onChange={e=>change('outputMode',e.target.value)}>{Object.entries(outputModes).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>:<div className="continuity-fields-row"><label>记录来源<select aria-label="记录来源" value={draft.payload.originKind??'user'} onChange={e=>change('originKind',e.target.value)}><option value="user">研究者提供</option>{kind!=='execution'&&<option value="external_ai">外部 AI 建议</option>}<option value="external_tool">外部工具输出</option></select></label>{kind==='execution'&&<label>实际执行状态<select aria-label="实际执行状态" value={draft.payload.executionStatus??'unknown'} onChange={e=>change('executionStatus',e.target.value)}><option value="unknown">尚未明确</option><option value="partial">部分完成</option><option value="completed">执行已完成</option><option value="failed">执行失败</option></select></label>}</div>}
      <div className="continuity-mainfields">{Object.entries(fields).map(([key,label])=><label key={key} className={['text','design'].includes(key)?'continuity-field-wide':undefined}>{label}<textarea aria-label={label} rows={['text','design','analysisPlan'].includes(key)?4:2} value={draft.payload[key]??''} onChange={e=>change(key,e.target.value)} placeholder="尚不清楚可留空；只记录实际已有信息"/></label>)}</div>
      <details className="continuity-inputs"><summary>所用版本与附件 · {selectedRefs.length} 项</summary><p className="muted">选择当时实际使用的方案、记录或附件。附件用于追溯；讨论使用记录正文，请将需要解释的实际结果写入正文。</p>
        {eligible.map(i=>{const refs=[itemRef(i),...selectedRefs.filter(r=>r.id===i.id&&!sameRef(r,itemRef(i)))];return refs.map(ref=>{const v=itemVersion(project,ref);return <label className="continuity-check" key={ref.id+ref.revisionId}><input type="checkbox" checked={selectedRefs.some(r=>sameRef(r,ref))} onChange={()=>toggle(ref)}/>{continuityLabels[i.kind]} · {v?.revision.title} · 第 {v?.revision.number} 版</label>;});})}
        <label>保存本地附件<input aria-label="保存本地附件" type="file" accept=".txt,.md,.csv,.json,.pdf,.png,.jpg,.jpeg" onChange={e=>upload(e.target.files[0])}/></label>
      </details>
      <label className="continuity-check"><input type="checkbox" checked={draft.payload.recordedAfterResults??false} onChange={e=>change('recordedAfterResults',e.target.checked)}/>这是获得结果后补充整理的记录</label>
    </fieldset>
    <p className="muted">保存不会改变当前采用版本。整理完成后，在上方选择用于后续工作。</p>
  </div>;
}

function RecordReading({kind,version}) {
  const fields=kind==='protocol'?protocolFields:recordFields;
  return <article className="continuity-record-reading"><h3>{version.title}</h3>{kind==='protocol'&&<p>{outputModes[version.payload.outputMode]}</p>}{Object.entries(fields).filter(([key])=>version.payload[key]).map(([key,label])=><section key={key}><h4>{label}</h4><p>{version.payload[key]}</p></section>)}</article>;
}
function AttachmentView({project,item}) {
  const v=item.revisions.at(-1),m=v.payload,url=`/api/projects/${project.id}/research-files/${item.id}/${v.id}`;
  const [text,setText]=useState(null),[error,setError]=useState('');
  return <div className="continuity-attachment"><strong>{m.name}</strong><p>{(m.size/1024).toFixed(1)} KB · 已保存，尚未独立核查</p><a href={url}>下载原附件</a>{m.mime.startsWith('text/')||m.mime==='application/json'?<button onClick={async()=>{const res=await fetch(url);if(!res.ok){setError('附件目前不可用，元信息仍保留。');return;}setText(await res.text());}}>查看文件内容</button>:<a href={`${url}?preview=1`} target="_blank" rel="noreferrer">打开预览</a>}{error&&<p role="alert">{error}</p>}{text!==null&&<pre>{text}</pre>}<details><summary>文件版本</summary><code>{m.sha256}</code></details></div>;
}

export function ResearchContinuity({project,artifactId,onProject,onClose,onDiscuss,onTarget}) {
  const work=currentWork(project,artifactId),[tab,setTab]=useState('protocol'),[kind,setKind]=useState('execution'),[selectedId,setSelectedId]=useState(work.snapshot.protocol?.ref.id??work.items.findLast(i=>i.kind==='protocol')?.id??null),[historyId,setHistoryId]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState(''),[path,setPath]=useState('workbench');
  const [editorDirty,setEditorDirty]=useState(false);
  const activeKind=tab==='protocol'?'protocol':kind;
  const items=work.items.filter(i=>i.kind===activeKind),selected=items.find(i=>i.id===selectedId)??null;
  const version=selected?.revisions.find(r=>r.id===(historyId??selected.headRevisionId));
  const currentSelection=activeKind==='protocol'?work.snapshot.protocol:work.snapshot.result;
  const run=async fn=>{if(busy)return;setBusy(true);setError('');try{const result=await fn();onProject(await api.workspace(project.id));return result;}catch(e){setError(e.message);}finally{setBusy(false);}};
  const command=(name,body)=>run(()=>api.command(project.id,name,{artifactId,baseStateVersion:project.researchState.version,...body}));
  const choose=(id)=>{setSelectedId(id);setHistoryId(null);};
  const visit=target=>{if(target.type==='research_item'){const item=project.researchItems[target.id];setTab(item.kind==='protocol'?'protocol':'records');setKind(item.kind);choose(item.id);setHistoryId(target.revisionId===item.headRevisionId?null:target.revisionId);}else{onTarget(target);onClose();}};
  const updatedTarget=i=>{const r=i.target;if(!r)return null;const a=project.artifacts[r.artifactId];let revisionId;if(r.type==='research_item')revisionId=project.researchItems[r.id]?.headRevisionId;else if(r.type==='writing')revisionId=a?.topicWorkspace?.writingWorkspaces?.[r.outlineId]?.sections[r.sectionId]?.activeVersionId;else if(r.type==='outline')revisionId=a?.topicWorkspace?.activeOutlineId;else if(r.type==='figure')revisionId=a?.topicWorkspace?.figures?.findLast(v=>v.parentId===r.revisionId)?.id;else revisionId=project.artifacts[r.id]?.headRevisionId;return revisionId&&revisionId!==r.revisionId?{...r,revisionId}:null;};
  const impacts=work.impacts,findings=consistencyFindings(project,artifactId);
  return <Modal title="方案与研究记录" onClose={onClose}><div className="continuity-workspace">
    <p className="continuity-purpose">让采用的方案、实际做过的工作和后续表达保持连续。</p>
    <nav className="continuity-tabs" aria-label="研究记录工作区">{[['protocol','研究方案'],['records','执行与结果'],['impacts','影响与核对'],['practice','实践记录']].map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>{setTab(id);choose(id==='protocol'?work.snapshot.protocol?.ref.id??null:id==='records'?work.snapshot.result?.ref.id??null:null);if(id==='records'&&work.snapshot.result)setKind(work.snapshot.result.kind);}}>{label}{id==='impacts'&&impacts.length?` · ${impacts.length}`:''}</button>)}</nav>
    {error&&<p className="continuity-error" role="alert">{error}</p>}
    {['protocol','records'].includes(tab)&&<>
      <div className="continuity-selection"><div><span className="eyebrow">{tab==='protocol'?'当前采用':'用于后续工作'}</span><p>{currentSelection?`${currentSelection.title} · 第 ${currentSelection.number} 版`:'尚未选择，保存草案后可继续讨论。'}</p></div>{currentSelection&&<button onClick={()=>{if(tab==='records')setKind(currentSelection.kind);choose(currentSelection.ref.id);setHistoryId(currentSelection.ref.revisionId);}}>查看采用版</button>}</div>
      <div className="continuity-fields-row">{tab==='records'&&<label>记录类型<select aria-label="记录类型" value={kind} onChange={e=>{setKind(e.target.value);choose(null);}}>{[['execution','执行与结果'],['interpretation','结果解释'],['insight','外部建议'],['attachment','附件']].map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>}<label>已有记录<select aria-label="已有记录" value={selectedId??''} onChange={e=>choose(e.target.value||null)}><option value="">{activeKind==='protocol'?'从已有论证整理新草案':'新建记录'}</option>{items.map(i=><option key={i.id} value={i.id}>{i.title}</option>)}</select></label></div>
      {selected&&activeKind!=='attachment'&&<div className="continuity-versionbar"><label>保存历史<select aria-label="保存历史" value={historyId??selected.headRevisionId} onChange={e=>setHistoryId(e.target.value===selected.headRevisionId?null:e.target.value)}>{selected.revisions.slice().reverse().map(r=><option key={r.id} value={r.id}>第 {r.number} 版 · {date(r.createdAt)}</option>)}</select></label><button disabled={busy||editorDirty||sameRef(currentSelection?.ref,itemRef(selected,version.id))||activeKind==='insight'&&work.snapshot.insights.some(i=>sameRef(i.ref,itemRef(selected,version.id)))} onClick={()=>command('decide-continuity',{itemId:selected.id,revisionId:version.id,choice:'adopt'})}>{activeKind==='protocol'?'采用这版方案':activeKind==='insight'?'采用为工作建议':'用于后续工作'}</button><ExportEvidence projectId={project.id} title={version.title} refs={[itemRef(selected,version.id)]} files={[{name:`${version.title}-第${version.number}版.md`,content:continuityMarkdown({kind:activeKind,...version})}]} disabled={busy||editorDirty}/><details><summary>记录取舍</summary>{[['keep','保留'],['defer','保持未决'],['reject','不采用']].map(([choice,label])=><button key={choice} disabled={busy||editorDirty} onClick={()=>command('decide-continuity',{itemId:selected.id,revisionId:version.id,choice})}>{label}</button>)}<small>方案与结果的当前采用版保持到你明确选择另一版。</small></details>{historyId&&<button disabled={busy} onClick={async()=>{const r=await command('restore-continuity',{itemId:selected.id,baseRevisionId:selected.headRevisionId,revisionId:historyId});if(r)setHistoryId(null);}}>恢复为新的草案</button>}</div>}
      {activeKind==='attachment'?selected?<AttachmentView project={project} item={selected}/>:<p>在方案或执行记录的“所用版本与附件”中保存文件。</p>:historyId?<div className="continuity-history"><p>正在查看第 {version.number} 版；当前草案与采用选择不变。</p><RecordReading kind={activeKind} version={version}/></div>:<RecordEditor key={`${activeKind}:${selected?.id??'new'}`} project={project} artifactId={artifactId} item={selected} kind={activeKind} onProject={onProject} onSaved={id=>setSelectedId(id)} onDirty={setEditorDirty}/>}
      <div className="continuity-discuss"><button onClick={()=>{onDiscuss(`请围绕当前采用方案、所选执行记录和结果解释，说明${activeKind==='protocol'?'问题、方法和所需证据是否匹配，还有哪些具体选择':'观察结果、可能解释与局限分别是什么'}。引用只限本次实际材料，先讨论，不自动采用或改写。`);onClose();}}>带着当前依据继续讨论</button></div>
    </>}
    {tab==='impacts'&&<div className="continuity-review"><h3>变化影响</h3>{impacts.length?impacts.map(i=><section key={i.id}><strong>{i.targetTitle??'相关研究成果'}</strong><p>{i.explanation}</p><small>{i.status==='deferred'?'已暂缓，仍需回看':'待判断'} · {date(i.createdAt)}</small><div className="continuity-actions"><button onClick={()=>visit(i.target??{type:'artifact',id:i.artifactId,artifactId:i.artifactId,revisionId:i.artifactRevisionId})}>前往相关内容</button><button disabled={busy} onClick={()=>command('resolve-impact',{impactId:i.id,choice:'keep'})}>核对后仍适用</button><button disabled={busy} onClick={()=>command('resolve-impact',{impactId:i.id,choice:'defer'})}>稍后处理</button>{updatedTarget(i)&&<button disabled={busy} onClick={()=>command('resolve-impact',{impactId:i.id,choice:'updated',updatedTarget:updatedTarget(i)})}>已更新相关内容，记录新版本</button>}</div></section>):<p>当前页面没有尚未处理的已知依赖变化。旧稿未记录的关系不能据此认定全部一致。</p>}<h3>关键表述核对</h3><p className="muted">核对采用方案中的明确结局名称和正文角色措辞，结果是待人工判断的线索；完整引文核查仍在原正文审阅中。</p>{findings.length?findings.map((f,i)=><section key={i}><strong>{f.location}</strong><blockquote>{f.text}</blockquote><p>{f.explanation}</p><button onClick={()=>visit(f.target)}>打开对应内容</button></section>):<p>本次未发现明确名称的主次角色冲突。这不等于所有科研表述已经核验。</p>}</div>}
    {tab==='practice'&&<div className="continuity-practice"><h3>只记录值得改进的断点</h3><p>在同一研究步骤两边分别产出后比较。额外求助可以继续真实研究，同时记录带回了什么。</p><label>本次路径<select value={path} onChange={e=>setPath(e.target.value)}><option value="workbench">科研工作台</option><option value="gpt">提示词＋GPT 网页版</option></select></label><label>卡在哪里，怎样继续，产生什么影响<textarea aria-label="卡在哪里，怎样继续，产生什么影响" value={note} onChange={e=>setNote(e.target.value)} rows={4}/></label><button disabled={busy||!note.trim()} onClick={async()=>{const r=await command('record-comparison-event',{path,text:note});if(r)setNote('');}}>保存这次观察</button><button onClick={()=>download('同题实践记录.json',JSON.stringify(project.researchEvents.filter(e=>e.type==='comparison_observation'),null,2))}>导出实践记录</button>{project.researchEvents.filter(e=>e.type==='comparison_observation'&&e.target.scopeId===work.snapshot.scope.id).slice().reverse().map(e=><section key={e.id}><strong>{e.detail.path==='gpt'?'GPT 网页版':'科研工作台'} · {date(e.at)}</strong><p>{e.detail.text}</p></section>)}</div>}
    <details className="continuity-decisions"><summary>已有选择与决定 · {work.decisions.length}</summary>{work.decisions.slice().reverse().map(d=><p key={d.id}>{date(d.createdAt)} · {({adopt:'采用',keep:'保留',defer:'保留未决',reject:'不采用',explore:'先深入'})[d.choice]??d.choice} · {itemVersion(project,d.target)?.revision.title??itemVersion(project,d.target)?.revision.text??'研究问题'}{d.intent?.text?`：${d.intent.text}`:''}</p>)}</details>
  </div></Modal>;
}
