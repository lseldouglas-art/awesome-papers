import { randomUUID } from 'node:crypto';
import { requireThat } from './errors.mjs';
import { isTerminalRun } from './workflows.mjs';
import { importTopicRecords } from './topic-library-workflow.mjs';
import { retrievalQuery, retrievalRangeLabel } from '../../shared/retrieval-scope.mjs';

// Reuse the topic-library PMID planner and importer. A retrieval is one user
// action, with persisted metadata batches; it never invokes the model.
export async function executeRangeRetrieval(service, task, signal) {
  const options = task.input.retrievalOptions, query = retrievalQuery(task.input.query, options);
  const id = task.input.resumeSearchId || `search_${randomUUID()}`;
  const write = fn => service.store.update(s => {
    const p = s.projects[task.projectId], t = p.researchTasks[task.id], a = p.artifacts[task.artifactId];
    signal.throwIfAborted();
    requireThat(!isTerminalRun(t.status), 'cancelled', '获取已停止，已保存材料保留。', 409);
    return fn(p, a, t);
  });
  const read = () => service.store.read(s => structuredClone(s.projects[task.projectId].searches[id]));
  await write((p, a, t) => {
    p.searches[id] ??= { id, query, baseQuery: task.input.query.trim(), executedQuery: query, retrievalOptions: options,
      database: 'PubMed', artifactId: a.id, scopeMode: task.input.searchScopeMode ?? null, topicTarget: task.input.itemTarget ?? null,
      searchedAt: new Date().toISOString(), dateRange: retrievalRangeLabel(options), searches: [], accessIds: [], accessByPmid: {},
      retrievedCount: 0, modelAccessIds: [], missingIds: [], warnings: [], plan: null, attemptTaskIds: [] };
    const search = p.searches[id]; search.status = 'running'; search.attemptTaskIds.push(task.id); search.warnings = [];
    t.searchId = id; t.progress = '正在查询范围内的文献总数';
  });
  await service.updateTask(task, { status: 'running' });
  try {
    const saved = await read();
    const plan = saved.plan?.complete ? saved.plan : await service.pubmed.planCollection(query, {
      limit: options.limit, sort: options.sort, state: saved.plan, signal,
      onProgress: plan => write((p, a, t) => {
        const search = p.searches[id]; search.plan = structuredClone(plan);
        search.searches = [{ sort: options.sort, total: plan.total, ids: [...plan.ids] }];
        t.progress = `范围内命中 ${plan.total} 篇 · 已定位 ${plan.ids.length} / ${plan.target} 篇`;
      })
    });
    // Reuse actual saved access snapshots. Repeating/expanding a search does not
    // discard exclusions, rewrite earlier reports or download the same data again.
    await write((p, a, t) => {
      const search = p.searches[id]; search.plan = structuredClone(plan);
      const existing = new Map();
      for (const access of Object.values(p.accesses)) {
        const source = p.sources[access.sourceId];
        if (source?.origin === 'pubmed' && source.pmid && ['title', 'abstract'].includes(access.level)) existing.set(source.pmid, access.id);
      }
      for (const pmid of plan.ids) if (!search.accessByPmid[pmid] && existing.has(pmid)) search.accessByPmid[pmid] = existing.get(pmid);
      search.accessIds = [...new Set(Object.values(search.accessByPmid))];
      search.reusedCount = search.accessIds.length;
      search.retrievedCount = search.accessIds.length;
      search.missingIds = search.missingIds.filter(pmid => !search.accessByPmid[pmid]);
      a.draft.sourceAccessIds = [...new Set([...a.draft.sourceAccessIds, ...search.accessIds])];
      t.retrievedCount = search.retrievedCount;
    });
    const current = await read(), remaining = plan.ids.filter(pmid => !current.accessByPmid[pmid]);
    for (let offset = 0; offset < remaining.length; offset += 100) {
      signal.throwIfAborted();
      const batch = remaining.slice(offset, offset + 100);
      await service.updateTask(task, { progress: `正在获取题名／摘要 · 已保存 ${(await read()).retrievedCount} / ${plan.target} 篇` });
      let records;
      try { records = await service.pubmed.metadata(batch, { signal }); }
      catch (error) {
        if (!signal.aborted) await write(p => { const search = p.searches[id]; search.missingIds = [...new Set([...search.missingIds, ...batch])]; });
        throw error;
      }
      await write((p, a, t) => {
        const search = p.searches[id], imported = importTopicRecords(p, a, records.filter(r => batch.includes(r.pmid)));
        Object.assign(search.accessByPmid, imported.accessByPmid);
        search.accessIds = [...new Set(Object.values(search.accessByPmid))]; search.retrievedCount = search.accessIds.length;
        search.missingIds = [...new Set([...search.missingIds, ...batch])].filter(pmid => !search.accessByPmid[pmid]);
        t.retrievedCount = search.retrievedCount;
        t.progress = `已保存 ${search.retrievedCount} / ${plan.target} 篇题名／摘要`;
      });
    }
    const result = await write((p, a, t) => {
      const search = p.searches[id]; search.missingIds = plan.ids.filter(pmid => !search.accessByPmid[pmid]);
      search.status = search.missingIds.length ? 'incomplete' : 'completed'; search.finishedAt = new Date().toISOString();
      search.coverage = `本次范围命中 ${plan.total} 篇，选择获取 ${plan.target} 篇，实际保存 ${search.retrievedCount} 篇题名／摘要；${search.missingIds.length ? `${search.missingIds.length} 篇未取得，可继续获取。` : '所选获取范围已完成。'} 获取不代表相关性、代表性或全文核查。`;
      t.cost = { status: 'not_applicable', amount: 0 }; return structuredClone(search);
    });
    await service.updateTask(task, { status: 'completed', finishedAt: new Date().toISOString(),
      outcome: result.missingIds.length ? 'retrieval_incomplete' : plan.target ? 'materials_ready' : 'no_results',
      retrievedCount: result.retrievedCount, progress: result.missingIds.length ? `已保存 ${result.retrievedCount} 篇，${result.missingIds.length} 篇未取得，可继续获取。` : `所选范围已取完：${result.retrievedCount} 篇；筛选或分析由你继续选择。` });
  } catch (error) {
    await service.store.update(s => {
      const search = s.projects[task.projectId].searches[id];
      search.status = signal.aborted ? 'paused' : 'incomplete';
      search.coverage = `已保存 ${search.retrievedCount} 篇题名／摘要；本次范围尚未取完，可按原范围继续。`;
    });
    throw error;
  }
}
