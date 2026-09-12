import test from 'node:test';
import assert from 'node:assert/strict';
import { pubmedSearchUrl,pubmedManifestUrl,pubmedPaperUrl,literatureRis } from '../../shared/literature-links.mjs';
import { compactSearchFeedback } from '../../shared/search-repair-context.mjs';
import { createZotero } from '../src/zotero.mjs';

test('PubMed links preserve edited query, dates and backend sort without inheriting another pilot',()=>{
 const query='(gastric[tiab] OR "胃癌"[tiab]) AND AI[tiab]';
 const url=new URL(pubmedSearchUrl(query,{from:'2020-01-01',sort:'pub_date'}));
 assert.equal(url.origin,'https://pubmed.ncbi.nlm.nih.gov');assert.equal(url.searchParams.get('sort'),'pubdate');
 assert.equal(url.searchParams.get('term'),`(${query}) AND ("2020-01-01"[Date - Publication] : "3000-12-31"[Date - Publication])`);
 assert.equal(new URL(pubmedSearchUrl(query)).searchParams.get('term'),query);
 assert.equal(pubmedSearchUrl('  '),null);assert.equal(pubmedPaperUrl('javascript:1'),null);
 assert.equal(new URL(pubmedManifestUrl(['123','123','456','bad'])).searchParams.get('term'),'123[uid] OR 456[uid]');
});
test('RIS preserves observed metadata and abstract, excludes AI prose and prevents injected records',()=>{
 const ris=literatureRis([{source:{title:'Trial\nER  -',authors:['Alice\nTY  - BOOK'],year:'2025',doi:'10.1/a',pmid:'123',journal:'Test'},access:{level:'abstract',text:'Actual abstract.'},note:{reason:'AI opinion'}},{source:{title:'Title only'},access:{level:'title',text:'Title only'}}]);
 assert.equal(ris.split('\n').filter(line=>line==='ER  -').length,2);assert.match(ris,/AB  - Actual abstract\./);assert.match(ris,/DO  - 10.1\/a/);assert.match(ris,/PMID: 123/);assert.doesNotMatch(ris,/AI opinion|AB  - Title only/);
});
test('query repair digest retains all ranked rows and unknowns, bounds excerpts and leaves audit input untouched',()=>{
 const feedback={query:'current',calibration:{total:100,samples:Array.from({length:20},(_,i)=>({rank:i+1,pmid:String(i+1),title:`paper${i}`,relationship:i===0?'unclear':'direct',level:i===0?'not_accessed':'abstract',actor:'local_user',reason:'r'.repeat(300),quotes:['q'.repeat(10000),'second quote']}))},recentCalibrations:[{query:'old',total:42}],collectionScope:{from:'2020-01-01'}};
 const before=structuredClone(feedback),out=compactSearchFeedback(feedback);
 assert.deepEqual(feedback,before);assert.equal(out.calibration.samples.length,20);assert.equal(out.calibration.samples[0].level,'not_accessed');assert.equal(out.calibration.samples[19].rank,20);assert.equal(out.calibration.samples[19].actor,'local_user');assert.equal(out.calibration.samples[0].excerpted,true);assert.equal(out.calibration.samples[0].quotes[0].length,181);assert.ok(JSON.stringify(out).length<JSON.stringify(feedback).length/10);
 assert.equal(compactSearchFeedback(null),null);assert.equal(compactSearchFeedback({...feedback,calibration:null}).calibration,null);
});
test('Zotero lookup only reads fixed personal metadata routes and returns exact matches with safe deep links',async()=>{
 const paths=[];const z=createZotero({get:async path=>{paths.push(path);return path==='/api/'?{status:200,headers:{'x-zotero-version':'9.0.6'}}:{status:200,text:JSON.stringify([{key:'ABCD1234',data:{itemType:'journalArticle',title:'Trial',DOI:'https://doi.org/10.1/ABC'}},{key:'BAD',data:{title:'Trial',DOI:'10.1/abc'}}])};}});
 const out=await z.match({title:'Trial',doi:'10.1/abc'});assert.equal(out.version,'9.0.6');assert.equal(out.matches.length,1);assert.equal(out.matches[0].href,'zotero://select/library/items/ABCD1234');assert.equal(out.matches[0].matchedBy,'DOI');
 assert.ok(paths.every(p=>p==='/api/'||p.startsWith('/api/users/0/items/top?')));
});
test('Zotero handles offline, conflicting IDs, duplicate matches and no-match without writing',async()=>{
 assert.equal((await createZotero({get:async()=>{throw Error('offline');}}).status()).connected,false);
 const z=createZotero({get:async path=>path==='/api/'?{status:200,headers:{}}:{status:200,text:JSON.stringify([{key:'ABCD1234',data:{title:'same',DOI:'10.1/other'}},{key:'ABCD2345',data:{title:'same',extra:'PMID: 999'}}])}});
 assert.equal((await z.match({title:'same',doi:'10.1/a',pmid:'123'})).matches.length,0);
 const blocked=createZotero({get:async()=>({status:403,headers:{}})});assert.match((await blocked.status()).message,/高级/);
});

test('Zotero bridge inherits local origin guards and only resolves metadata from this project',async t=>{
 const {startServer}=await import('../src/server.mjs');const {mkdtemp}=await import('node:fs/promises');const {join}=await import('node:path');const {tmpdir}=await import('node:os');const {createWorkspace}=await import('../src/workspace.mjs');const {ensureKernel}=await import('../src/kernel.mjs');const {upgradeProject}=await import('../src/progress.mjs');
 let calls=0;
 const app=await startServer({directory:await mkdtemp(join(tmpdir(),'rw-zotero-test-')),port:0,zotero:{status:async()=>({connected:true}),match:async source=>{calls++;assert.deepEqual(Object.keys(source).sort(),['doi','pmid','title']);return {matches:[]};}}});t.after(()=>app.close());
 const p=await app.store.update(s=>{const p=ensureKernel(upgradeProject(createWorkspace(s,{name:'Test library',goal:'Test'},'create'),false));p.sources.s={id:'s',title:'Title',doi:'10.1234/test',pmid:'123',privateNote:'not sent'};p.accesses.a={id:'a',sourceId:'s',text:'not sent'};return p;});
 assert.equal((await fetch(`${app.url}/api/zotero/status`,{headers:{origin:'https://evil.invalid'}})).status,403);
 assert.equal((await fetch(`${app.url}/api/projects/${p.id}/zotero-match/not-saved`)).status,404);assert.equal(calls,0);
 assert.equal((await fetch(`${app.url}/api/projects/${p.id}/zotero-match/a`)).status,200);assert.equal(calls,1);
});
test('template reader only opens matched attachments and distinguishes partial indexed text from full text',async()=>{
 const paths=[],source={title:'Trial',doi:'10.1/abc'},z=createZotero({get:async path=>{
  paths.push(path);if(path==='/api/')return {status:200,headers:{}};
  if(path.includes('/items/top?'))return {status:200,text:JSON.stringify([{key:'ABCD1234',data:{itemType:'journalArticle',title:'Trial',DOI:'10.1/abc'}}])};
  if(path.includes('/ABCD1234/children'))return {status:200,text:JSON.stringify([{key:'PDFD1234',data:{itemType:'attachment',parentItem:'ABCD1234',title:'Template PDF',contentType:'application/pdf'}},{key:'WRONG123',data:{itemType:'attachment',parentItem:'OTHER123',title:'Other PDF'}}])};
  if(path.endsWith('/PDFD1234/fulltext'))return {status:200,text:JSON.stringify({content:'Original template paragraph.',indexedPages:2,totalPages:10})};
  throw Error('Unexpected route '+path);
 }});
 const a=await z.attachments(source);assert.equal(a.attachments.length,1);assert.equal(a.attachments[0].href,'zotero://open-pdf/library/items/PDFD1234');
 await assert.rejects(()=>z.readTemplate(source,'WRONG123'),e=>e.code==='invalid_scope');assert.ok(!paths.some(p=>p.includes('WRONG123')));
 const r=await z.readTemplate(source,'PDFD1234');assert.equal(r.level,'excerpt');assert.equal(r.origin.totalPages,10);assert.equal(r.text,'Original template paragraph.');assert.ok(!paths.some(p=>p.includes('/file/')));
});
