import {scientificCatalog,serveScientificAsset} from './figure-workspace.mjs';
import {createFulltextService} from './template-fulltext.mjs';
import {editTemplates} from './research-templates.mjs';
import { createZotero } from './zotero.mjs';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SqliteStore as LocalStore } from './sqlite-store.mjs';
import { DomainError, requireThat } from './errors.mjs';
import { executeCommand, getProject, getRevision, exportRevision } from './domain.mjs';
import { createWorkspace } from './workspace.mjs';
import { progressCommand, upgradeProject, exportProgress } from './progress.mjs';
import { ResearchApplication as ResearchService } from './research-application.mjs';
import { ensureKernel, researchState, registerResearchResult, kernelCommands, kernelCommand, markProjectContextChange, resolveResearchIntent } from './kernel.mjs';
import { randomUUID } from 'node:crypto';

const allowedCommands = new Set(['update-project', 'add-annotation', 'resolve-annotation', 'append-message']);
const progressCommands = new Set(['save-notes', 'checkpoint', 'capture-current', 'restore-progress', 'attach-material', 'attach-existing-materials', 'annotate-current', 'record-message', 'adopt-result']);
async function jsonBody(req,limit=1024*1024) {
  requireThat(req.headers['content-type']?.split(';')[0] === 'application/json', 'content_type', '请使用 JSON 请求。', 415);
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; requireThat(size <= limit, 'body_too_large', '本次内容超过允许大小。', 413); chunks.push(chunk); }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new DomainError('invalid_json', 400, '请求内容无法解析。'); }
  requireThat(body && typeof body === 'object' && !Array.isArray(body), 'invalid_input', '请求内容需要是对象。');
  return body;
}
export async function startServer({ directory = fileURLToPath(new URL('../.local', import.meta.url)), port = 4318, frontend, researchOptions, zotero = createZotero(), fulltextOptions } = {}) {
  const store = await new LocalStore(directory).initialize();
  const fulltexts=createFulltextService(directory,fulltextOptions);
  let research;
  try {
    await store.update(s => {
      for (const p of Object.values(s.projects)) {
        ensureKernel(upgradeProject(p));
        for (const result of Object.values(p.researchResults)) if (['brief', 'answer'].includes(result.kind)) registerResearchResult(p, result, 'index-existing-results');
      }
    });
    research = await new ResearchService(store, researchOptions).initialize();
  }
  catch (e) { await store.close(); throw e; }
  const server = createServer(async (req, res) => {
    const requestId = req.headers['x-request-id'];
    const send = (status, envelope) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(typeof requestId === 'string' ? { 'X-Request-Id': requestId } : {}) }); res.end(JSON.stringify(envelope)); };
    try {
      const localPort = server.address().port;
      requireThat([`127.0.0.1:${localPort}`, `localhost:${localPort}`].includes(req.headers.host), 'invalid_host', '仅允许本机工作台地址。', 403);
      const origin = `http://${req.headers.host}`;
      requireThat(!req.headers.origin || req.headers.origin === origin, 'invalid_origin', '请求来源与工作台不一致。', 403);
      requireThat(!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] !== 'cross-site', 'invalid_origin', '不允许跨站读取本机项目。', 403);
      const url = new URL(req.url, origin);
      if (!url.pathname.startsWith('/api/')) {
        if (frontend) return frontend(req, res);
        return send(404, { error: { code: 'not_found', message: '请启动工作台前端。' } });
      }
      let data;
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if(req.method==='GET'&&url.pathname==='/api/scientific-assets') data=scientificCatalog;
      else if(req.method==='GET'&&url.pathname.startsWith('/api/scientific-assets/')) {requireThat(await serveScientificAsset(url.pathname,res),'not_found','没有这项科研素材。',404);return;}
      else if (req.method === 'GET' && url.pathname === '/api/capabilities') data = await research.capabilities();
      else if (req.method === 'GET' && url.pathname === '/api/zotero/status') data = await zotero.status();
      else if (req.method === 'GET' && url.pathname === '/api/model-calls') data = await store.read(s => s.modelCalls);
      else if (req.method === 'POST' && url.pathname === '/api/model-settings') data = await research.settings.save(await jsonBody(req));
      else if (url.pathname === '/api/projects' && req.method === 'GET') data = await store.read(s => Object.values(s.projects).map(p => ({ id: p.id, name: p.name, goal: p.goal, example: p.example, updatedAt: p.updatedAt })));
      else if (url.pathname === '/api/projects' && req.method === 'POST') {
        const body = await jsonBody(req);
        data = await store.transact(requestId, { operation: 'create-project', body }, s => { const p = ensureKernel(upgradeProject(createWorkspace(s, body, requestId), false)); return { ...p, researchState: researchState(p) }; });
      } else if (parts[1] === 'projects' && parts[2]) {
        const projectId = parts[2];
        if (parts.length === 3 && req.method === 'GET') data = await store.read(s => { const p = getProject(s, projectId); return { ...p, researchState: researchState(p) }; });
        else if(parts[3]==='templates'&&parts.length===6&&['fulltext','pdf'].includes(parts[5])) {
          const paper=await store.read(s=>{const p=getProject(s,projectId);const paper=p.templateLibrary?.papers?.[parts[4]];requireThat(paper,'not_found','没有这篇模板。',404);return structuredClone(paper);});
          if(parts[5]==='pdf'&&req.method==='GET'){
            const requested=url.searchParams.get('version')??paper.document?.sha256;
            requireThat(requested&&[paper.document,...(paper.textHistory??[]).map(h=>h.document)].some(d=>d?.sha256===requested),'not_found','没有这版原文。',404);
            const bytes=await fulltexts.read(requested);res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':bytes.length,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'});res.end(bytes);return;
          }
          requireThat(parts[5]==='fulltext'&&req.method==='POST','not_found','不支持此操作。',404);
          const body=await jsonBody(req,36*1024*1024);
          // Check permission/version before fetching; the transaction checks again after acquisition.
          await store.read(s=>{const p=getProject(s,projectId);requireThat(p.artifacts[body.artifactId]&&p.templateLibrary.version===body.baseTemplateVersion,'template_conflict','页面已有变化，请刷新后重试。',409);});
          const result=await fulltexts.acquire(paper,body);
          data=await store.transact(requestId,{operation:'template-fulltext',projectId,paperId:paper.id,sha:result.document.sha256,baseTemplateVersion:body.baseTemplateVersion},s=>{
            const p=getProject(s,projectId),a=p.artifacts[body.artifactId];
            const saved=editTemplates(p,a,{action:'register-pdf',paperId:paper.id,baseTemplateVersion:body.baseTemplateVersion},requestId,{fulltext:result});return saved;
          });
        }
        else if(parts[3]==='templates'&&parts.length===6&&['zotero','zotero-text'].includes(parts[5])) {
          const paper=await store.read(s=>{const p=getProject(s,projectId);requireThat(Object.hasOwn(p.templateLibrary?.papers??{},parts[4]),'not_found','本课题没有这篇模板文献。',404);return structuredClone(p.templateLibrary.papers[parts[4]]);});
          if(parts[5]==='zotero'&&req.method==='GET')data=await zotero.attachments(paper);
          else if(parts[5]==='zotero-text'&&req.method==='POST') {
            const body=await jsonBody(req),content=await zotero.readTemplate(paper,body.attachmentKey);
            data=await store.transact(requestId,{operation:'template-zotero-text',projectId,paperId:paper.id,body},s=>{const p=getProject(s,projectId),a=p.artifacts[body.artifactId];requireThat(a,'not_found','请打开所属研究页面。',404);const result=editTemplates(p,a,{action:'save-text',paperId:paper.id,baseTemplateVersion:body.baseTemplateVersion,text:content.text,level:content.level,location:content.location},requestId);Object.assign(p.templateLibrary.papers[paper.id],{providedBy:'zotero',zoteroOrigin:content.origin});return result;});
          }else requireThat(false,'not_found','此接口不支持该操作。',404);
        }
        else if (parts.length === 5 && parts[3] === 'zotero-match' && req.method === 'GET') {
          const source=await store.read(s=>{const p=getProject(s,projectId),a=p.accesses[parts[4]];requireThat(a,'not_found','没有这份本机材料。',404);const source=p.sources[a.sourceId];return {title:source.title,doi:source.doi,pmid:source.pmid};});
          data=await zotero.match(source);
        }
        else if (parts.length === 4 && parts[3] === 'research-state' && req.method === 'GET') data = await store.read(s => researchState(getProject(s, projectId)));
        else if (parts.length === 4 && parts[3] === 'artifacts' && req.method === 'GET') data = await store.read(s => researchState(getProject(s, projectId)).artifacts);
        else if (parts.length === 5 && parts[3] === 'artifacts' && req.method === 'GET') data = await store.read(s => { const p = getProject(s, projectId); requireThat(Object.hasOwn(p.artifacts, parts[4]), 'not_found', '本课题没有这份成果。', 404); return p.artifacts[parts[4]]; });
        else if (parts.length === 4 && parts[3] === 'research-tasks' && req.method === 'POST') data = await research.start(projectId, await jsonBody(req), requestId);
        else if (parts[3] === 'research-tasks' && parts.length === 5 && req.method === 'GET') data = await store.read(s => { const p = getProject(s, projectId); requireThat(Object.hasOwn(p.researchTasks, parts[4]), 'not_found', '没有这个任务。', 404); return p.researchTasks[parts[4]]; });
        else if (parts[3] === 'research-tasks' && parts.length === 6 && parts[5] === 'stop' && req.method === 'POST') { await jsonBody(req); data = await research.stop(projectId, parts[4], requestId); }
        else if (parts[3] === 'research-tasks' && parts.length === 6 && parts[5] === 'revalidate' && req.method === 'POST') data = await research.revalidateSavedOutput(projectId, parts[4], requestId, await jsonBody(req));
        else if (parts.length === 5 && parts[3] === 'commands' && req.method === 'POST') {
          const name = parts[4];
          requireThat(!['save-artifact', 'restore-artifact', 'attach-source'].includes(name), 'client_upgrade_required', '保存方式已升级，旧页面未提交的草稿仍应保留；请刷新后对照迁入。', 409);
          requireThat(allowedCommands.has(name) || progressCommands.has(name) || kernelCommands.has(name) || name === 'research-intent', 'not_implemented', '当前尚未提供此操作。', 404);
          const body = await jsonBody(req);
          data = await store.transact(requestId, { operation: name, projectId, body }, s => {
            const p = ensureKernel(getProject(s, projectId));
            if (name === 'research-intent') {
              const parsed = resolveResearchIntent(p, body.text, body.target);
              return parsed ? { handled: true, ...kernelCommand(s, projectId, parsed.command, parsed.body, requestId) } : { handled: false };
            }
            if (kernelCommands.has(name)) return kernelCommand(s, projectId, name, body, requestId);
            const previous = { goal: p.goal, conditions: p.conditions, metadataVersion: p.metadataVersion };
            const output = progressCommands.has(name) ? progressCommand(s, projectId, name, body, requestId) : executeCommand(s, projectId, name, body, requestId);
            if (['update-project', 'restore-progress'].includes(name)) markProjectContextChange(p, previous, requestId);
            s.events.push({ id: `event_${randomUUID()}`, type: name, actor: 'local_user', projectId, target: { artifactId: body.artifactId ?? null }, inputVersion: body.baseVersion ?? null, operationId: requestId, at: new Date().toISOString(), change: structuredClone(output) });
            return output;
          });
        } else if (parts[3] === 'artifacts' && parts[5] === 'revisions' && parts[6] && req.method === 'GET' && (parts.length === 7 || (parts.length === 8 && parts[7] === 'export'))) {
          data = await store.read(s => parts[7] === 'export' ? exportProgress(getProject(s, projectId), parts[4], parts[6]) : getRevision(getProject(s, projectId), parts[4], parts[6]));
        }
      }
      requireThat(data !== undefined, 'not_found', '没有找到这个项目或操作。', 404);
      send(200, { data, requestId });
    } catch (error) {
      const known = error instanceof DomainError;
      send(known ? error.status : 500, { error: { code: known ? error.code : 'internal_error', message: known ? error.message : '本地服务处理失败，修改尚未确认保存。', ...(known && error.details ? { details: error.details } : {}) }, requestId });
      if (!known) console.error('Workbench request failed:', error.code ?? error.name);
    }
  });
  server.requestTimeout = 15000;
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); }
  catch (error) { await research.close(); await store.close(); throw error; }
  return { server, store, research, url: `http://127.0.0.1:${server.address().port}`, close: async () => { await new Promise(resolve => server.close(resolve)); await research.close(); await store.close(); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await startServer(); console.log(`科研工作台 API：${app.url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
