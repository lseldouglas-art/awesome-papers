import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {scientificCatalog,saveIllustration} from '../src/figure-workspace.mjs';
import {emptyScene,validateScene,sceneTemplate,sceneSvg,figureCredits,validateComposition,connector} from '../../shared/figure-workspace.mjs';
import {startServer} from '../src/server.mjs';
import {seedWriting} from './fixtures/writing.mjs';
const sampleText='小鼠用于取得样本。样本将用于检测，尚未实施。';
const response={layout:'horizontal',explanation:'研究流程候选；实验尚未实施。',nodes:[{id:'mouse',label:'小鼠',assetId:'bio-mouse-gray'},{id:'sample',label:'样本',assetId:'bio-microtube-open-blue'}],edges:[{from:'mouse',to:'sample',kind:'hypothesis',label:'采样计划',quote:'小鼠用于取得样本。'}]};
test('bundled 52 scientific assets have exact hashes, correct formats and item-level licenses',async()=>{
 assert.equal(scientificCatalog.assets.length,52);assert.equal(scientificCatalog.categories.length,10);assert.equal(new Set(scientificCatalog.assets.map(a=>a.id)).size,52);
 for(const a of scientificCatalog.assets){const b=await readFile(new URL(`../../scientific-assets/${a.file}`,import.meta.url));assert.equal(createHash('sha256').update(b).digest('hex'),a.sha256);assert.equal(b.length,a.bytes);if(a.format==='png'){assert.equal(b.readUInt32BE(16),a.width);assert.equal(b.readUInt32BE(20),a.height);assert.equal(b[25],6);}else {assert.match(b.toString(),/<svg/);assert.doesNotMatch(b.toString(),/<(?:script|foreignObject)\b|\son\w+\s*=/i);assert.ok(a.source.url&&a.license.url);}}
 const zip=await readFile(new URL('../../scientific-assets/biomedical-starter-1.0.0.zip',import.meta.url));assert.equal(zip.readUInt32LE(0),0x04034b50);
});
test('scene validation rejects invalid geometry/IDs/assets and export never omits missing images',()=>{
 const s=sceneTemplate('experiment');validateScene(s,scientificCatalog);const bad=structuredClone(s);bad.nodes[0].assetId='../../secret';assert.throws(()=>validateScene(bad,scientificCatalog));bad.nodes[0].assetId=s.nodes[0].assetId;bad.nodes[0].x=Infinity;assert.throws(()=>validateScene(bad,scientificCatalog));
 assert.throws(()=>sceneSvg(s,scientificCatalog,{}));s.title='<script>bad</script>';s.nodes[1].label='<unsafe>';const data=Object.fromEntries(s.nodes.filter(n=>n.assetId).map(n=>[n.assetId,'data:image/svg+xml;base64,PHN2Zy8+']));const xml=sceneSvg(s,scientificCatalog,data);assert.match(xml,/&lt;unsafe&gt;/);assert.doesNotMatch(xml,/<script>/);assert.match(xml,/<metadata>/);assert.match(xml,/待审阅图稿/);assert.match(xml,/&quot;status&quot;:&quot;draft&quot;/);assert.match(xml,/width="180mm"/);assert.match(figureCredits(s,scientificCatalog),/CC-BY-3.0/);
 const c=connector(s,s.edges[0]);s.nodes[1].x+=40;assert.notDeepEqual(connector(s,s.edges[0]),c);for(const kind of ['signal','interaction','experiment'])validateScene(sceneTemplate(kind),scientificCatalog);
});
test('model composition stays within catalog and exact source quotes, supports text fallback and cannot self-approve',()=>{
 const input={title:'流程',text:sampleText};const p=validateComposition(response,input,scientificCatalog);assert.equal(p.scene.edges[0].kind,'hypothesis');assert.equal(p.scene.sourceText,sampleText);
 assert.throws(()=>validateComposition({...response,edges:[{...response.edges[0],quote:'不存在的实验结果'}]},input,scientificCatalog));assert.throws(()=>validateComposition({...response,nodes:[{...response.nodes[0],assetId:'unknown'}]},input,scientificCatalog));assert.throws(()=>validateComposition({...response,edges:[{...response.edges[0],kind:'causally_proven'}]},input,scientificCatalog));
 const a={topicWorkspace:{version:1}},project={};const saved=saveIllustration(project,a,{scene:p.scene},'first');assert.equal(saved.status,'draft');assert.throws(()=>saveIllustration(project,a,{scene:p.scene,baseFigureId:null},'stale'),e=>e.code==='figure_conflict');const next=saveIllustration(project,a,{scene:{...p.scene,title:'修订'},baseFigureId:saved.id},'second');assert.equal(next.parentId,saved.id);assert.equal(a.topicWorkspace.figures.length,2);assert.equal(a.topicWorkspace.figures[0].title,'流程');
});
test('full task/API loop saves only a candidate, records one text call, protects local assets and project versions',async()=>{
 let calls=0;const app=await startServer({directory:await mkdtemp(join(tmpdir(),'rw-figure-test-')),port:0,researchOptions:{modelFactory:()=>({generate:async({instruction,materials})=>{calls++;assert.equal(materials.length,0);assert.ok(instruction.includes(sampleText));assert.ok(!instruction.includes('Engineering fixture'));return {text:JSON.stringify(response),usage:{total_tokens:20},cost:{status:'not_applicable',amount:0},provenance:{provider:'test.invalid',model:'figure-fixture'}};}})}});
 try{await app.research.settings.save({baseUrl:'https://test.invalid/v1',model:'figure-fixture',apiKey:'isolated',enabled:true});const {p,a}=await app.store.update(seedWriting);
 const {taskId}=await app.research.start(p.id,{mode:'figure-compose',artifactId:a.id,baseVersion:a.draft.version,accessIds:[],text:sampleText,figureOptions:{title:'工程流程'}},randomUUID());await app.research.running.get(taskId)?.promise;
 const saved=await app.store.read(s=>s.projects[p.id]);assert.equal(saved.researchTasks[taskId].status,'completed',saved.researchTasks[taskId].error);assert.equal(calls,1);assert.equal(saved.artifacts[a.id].topicWorkspace.figureProposals.length,1);assert.equal(saved.artifacts[a.id].topicWorkspace.figures?.length??0,0);
 for(const [path,mime] of [['/api/scientific-assets','application/json'],['/api/scientific-assets/gen-h-pylori','image/png'],['/api/scientific-assets/bio-mouse-gray','image/svg+xml'],['/api/scientific-assets/pack','application/zip']]){const r=await fetch(app.url+path);assert.equal(r.status,200);assert.ok(r.headers.get('content-type').startsWith(mime));}
 assert.equal((await fetch(app.url+'/api/scientific-assets/unknown')).status,404);assert.equal((await fetch(app.url+'/api/scientific-assets',{headers:{origin:'https://evil.invalid'}})).status,403);
 const proposal=saved.artifacts[a.id].topicWorkspace.figureProposals[0],command={artifactId:a.id,baseTemplateVersion:1,action:'save-illustration',scene:proposal.scene,proposalId:proposal.id,baseFigureId:null},rid=randomUUID();
 const post=()=>fetch(`${app.url}/api/projects/${p.id}/commands/update-research-templates`,{method:'POST',headers:{'Content-Type':'application/json','X-Request-Id':rid},body:JSON.stringify(command)});
 assert.equal((await post()).status,200);assert.equal((await post()).status,200);const result=await app.store.read(s=>s.projects[p.id]);assert.equal(result.artifacts[a.id].topicWorkspace.figures.length,1);assert.equal(result.templateLibrary.events.at(-1).actor,'local_user');
 }finally{await app.close();}
});
