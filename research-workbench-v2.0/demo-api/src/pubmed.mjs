import { SaxesParser } from 'saxes';
import { setTimeout as delay } from 'node:timers/promises';
import { DomainError, requireThat } from './errors.mjs';

// No DTD retrieval or custom entity expansion. Only the bounded returned XML is parsed.
export function parsePubmed(xml) {
  requireThat(typeof xml === 'string' && xml.length <= 4_000_000, 'retrieval_invalid', 'PubMed 返回的记录超过本轮读取范围。', 502);
  const root = { children: [], text: '' }, stack = [root];
  const parser = new SaxesParser();
  parser.on('opentag', node => { const child = { name: node.name, attrs: node.attributes, text: '', children: [] }; stack.at(-1).children.push(child); stack.push(child); });
  parser.on('text', text => { stack.at(-1).text += text; });
  parser.on('cdata', text => { stack.at(-1).text += text; });
  parser.on('closetag', () => { const node = stack.pop(); stack.at(-1).text += node.text; });
  try { parser.write(xml).close(); } catch { throw new DomainError('retrieval_invalid', 502, 'PubMed 返回的 XML 无法解析，未生成研究结论。'); }
  const child = (node, name) => node?.children.find(c => c.name === name);
  const all = (node, name) => node ? [...(node.name === name ? [node] : []), ...node.children.flatMap(c => all(c, name))] : [];
  return all(root, 'PubmedArticle').map(item => {
    const citation = child(item, 'MedlineCitation'), article = child(citation, 'Article');
    const pmid = child(citation, 'PMID')?.text.trim(), title = child(article, 'ArticleTitle')?.text.trim();
    const abstract = child(article, 'Abstract');
    const text = (abstract?.children ?? []).filter(n => n.name === 'AbstractText').map(n => `${n.attrs.Label ? `${n.attrs.Label}: ` : ''}${n.text.trim()}`).join('\n');
    const doi = all(item, 'ArticleId').find(n => n.attrs.IdType === 'doi')?.text.trim() ?? null;
    const published = all(article, 'PubDate')[0];
    const authors = (child(article, 'AuthorList')?.children ?? []).filter(n => n.name === 'Author').map(author =>
      child(author, 'CollectiveName')?.text.trim() || [child(author, 'LastName')?.text.trim(), child(author, 'ForeName')?.text.trim() || child(author, 'Initials')?.text.trim()].filter(Boolean).join(' ')).filter(Boolean);
    const year = child(published, 'Year')?.text.trim() ?? child(published, 'MedlineDate')?.text.match(/\b\d{4}\b/)?.[0] ?? null;
    return { pmid, title, text, doi, authors, year, journal: child(child(article, 'Journal'), 'Title')?.text.trim() ?? '',
      published: published?.children.map(n => n.text.trim()).join(' ') ?? '', level: text ? 'abstract' : 'title', url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` };
  }).filter(item => /^\d+$/.test(item.pmid) && item.title);
}
export function createPubmed({ fetchImpl = globalThis.fetch, intervalMs = 350 } = {}) {
  let nextAt = 0, queue = Promise.resolve();
  async function fetchText(path, params, signal) {
    const turn = queue.then(async () => { if (nextAt > Date.now()) await delay(nextAt - Date.now(), undefined, { signal }); nextAt = Date.now() + intervalMs; });
    queue = turn.catch(() => {}); await turn;
    const requestSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20_000)]);
    const url = new URL(path, 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/');
    url.search = new URLSearchParams({ db: 'pubmed', tool: 'research_workbench_v2', ...params });
    try {
      const response = await fetchImpl(url, { signal: requestSignal, redirect: 'error' });
      if (!response.ok) { await response.body?.cancel(); throw new DomainError('retrieval_http', 502, `PubMed 请求未完成（HTTP ${response.status}），可稍后手动重试。`); }
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 4_000_000) { await reader.cancel(); throw new DomainError('retrieval_invalid', 502, 'PubMed 返回超过本轮大小限制。'); } chunks.push(value); } }
      finally { reader.releaseLock(); }
      return Buffer.concat(chunks).toString('utf8');
    } catch (e) { if (e instanceof DomainError) throw e; throw new DomainError(signal?.aborted ? 'cancelled' : 'retrieval_network', 502, signal?.aborted ? '检索已停止。' : '无法完成 PubMed 请求；这不代表没有相关文献。'); }
  }
  async function queryPage(query, { sort = 'relevance', limit = 20, offset = 0, signal } = {}) {
    requireThat(typeof query === 'string' && query.trim() && query.length <= 3000, 'invalid_query', '请提供本题检索式。');
    requireThat(['relevance','pub_date'].includes(sort) && Number.isInteger(limit) && limit >= 0 && limit <= 10000 && offset >= 0 && offset + limit <= 10000, 'invalid_scope', 'PubMed 单个检索最多访问前 10,000 条，需按日期分段。');
    let result;
    try { result = JSON.parse(await fetchText('esearch.fcgi', { term:query, sort, retmax:String(limit), retstart:String(offset), retmode:'json' }, signal)).esearchresult; }
    catch(e) { if(e instanceof DomainError)throw e; throw new DomainError('retrieval_invalid',502,'PubMed 检索响应无法解析。'); }
    requireThat(result && /^\d+$/.test(String(result.count)) && Array.isArray(result.idlist) && result.idlist.every(id=>/^\d+$/.test(id)) && !result.errorlist && !result.ERROR, 'retrieval_invalid', 'PubMed 未能完整解释检索式，请核对词群。', 502);
    return { total:Number(result.count), ids:[...new Set(result.idlist)], queryTranslation:result.querytranslation??query, warnings:result.warninglist??null };
  }
  async function planCollection(query, { limit=500, sort='pub_date', state, onProgress=async()=>{}, signal }={}) {
    // Persist a PMID manifest before EFetch. Recursion partitions only publication
    // dates; an explicit complement retains undated/out-of-range records.
    let plan=state?structuredClone(state):null;
    if(!plan) {
      const count=await queryPage(query,{sort,limit:0,signal});
      const target=limit==='all'?count.total:Math.min(limit,count.total);
      requireThat(count.total<=10000 || sort==='pub_date', 'retrieval_partition_sort', '超过 10,000 条时请按发表时间收集；分段检索不能保持全库相关性排名。');
      plan={query,total:count.total,target,sort,ids:[],partitions:[],complete:false,startedAt:new Date().toISOString(),
        queue:count.total<=10000?[{query,total:count.total}]:[{from:'1000-01-01',to:'3000-12-31'},{query:`(${query}) NOT ("1000/01/01"[Date - Publication] : "3000/12/31"[Date - Publication])`,undated:true}]};
      await onProgress(plan);
    }
    requireThat(plan.query===query&&plan.sort===sort,'invalid_scope','续收计划与原检索范围不一致。');
    while(plan.queue.length&&plan.ids.length<plan.target) {
      signal?.throwIfAborted();
      const part=plan.queue[0], partQuery=part.query??`(${query}) AND ("${part.from}"[Date - Publication] : "${part.to}"[Date - Publication])`;
      const count=part.total===undefined?await queryPage(partQuery,{sort,limit:0,signal}):{total:part.total};
      if(count.total>10000) {
        requireThat(part.from&&part.from<part.to,'retrieval_partition_limit','一个日期分段仍超过 10,000 条，已保留已定位清单；请进一步收窄范围。',422);
        const start=Date.parse(part.from),end=Date.parse(part.to),mid=start+Math.floor((end-start)/86400000/2)*86400000;
        const date=ms=>new Date(ms).toISOString().slice(0,10);
        plan.queue.splice(0,1,{from:date(mid+86400000),to:part.to},{from:part.from,to:date(mid)});
        await onProgress(plan);continue;
      }
      const response=await queryPage(partQuery,{sort,limit:count.total,signal});
      requireThat(response.ids.length===count.total,'retrieval_manifest_incomplete','这段检索的 PMID 清单尚未完整取得，已保留进度；可继续重试。',502);
      const before=plan.ids.length,seen=new Set(plan.ids);
      for(const id of response.ids)if(!seen.has(id)&&plan.ids.length<plan.target){plan.ids.push(id);seen.add(id);}
      plan.partitions.push({...part,query:partQuery,total:count.total,selected:plan.ids.length-before,at:new Date().toISOString()});plan.queue.shift();
      await onProgress(plan);
    }
    requireThat(plan.ids.length>=plan.target,'retrieval_manifest_changed','数据库记录或日期范围在收集期间有变化，清单尚未达到所选数量；已保留进度。',502);
    plan.complete=true;plan.finishedAt=new Date().toISOString();await onProgress(plan);return plan;
  }
  return {
    queryPage, planCollection,
    async metadata(pmids, { signal } = {}) {
      requireThat(Array.isArray(pmids) && pmids.every(id => /^\d+$/.test(id)), 'invalid_scope', '文献标识不合法。');
      const records = [], ids = [...new Set(pmids)];
      for (let offset = 0; offset < ids.length; offset += 100) {
        const batch = ids.slice(offset, offset + 100);
        records.push(...parsePubmed(await fetchText('efetch.fcgi', { id: batch.join(','), retmode: 'xml' }, signal)).filter(r => batch.includes(r.pmid)));
      }
      return records;
    },
    async search(query, { signal } = {}) {
    requireThat(typeof query === 'string' && query.trim() && query.length <= 2000, 'invalid_query', '请提供本次 PubMed 检索式。');
    const searches = [], warnings = []; let ids = [];
    for (const sort of ['relevance', 'pub_date']) {
      try {
        const body = JSON.parse(await fetchText('esearch.fcgi', { term: query, sort, retmax: '20', retmode: 'json' }, signal));
        const result = body.esearchresult;
        requireThat(result && /^\d+$/.test(String(result.count)) && Array.isArray(result.idlist) && result.idlist.every(id => /^\d+$/.test(id)), 'retrieval_invalid', 'PubMed 检索响应不完整。', 502);
        const selected = result.idlist.slice(0, 20);
        searches.push({ sort, total: Number(result.count), ids: selected, queryTranslation: result.querytranslation ?? query, warnings: result.warninglist ?? null });
        ids.push(...selected);
      } catch (e) { if (signal?.aborted) throw e; warnings.push({ sort, message: e instanceof DomainError ? e.message : '检索响应无法解析。' }); }
    }
    requireThat(searches.length, 'retrieval_failed', '两次 PubMed 检索均未完成，请稍后手动重试。', 502);
    ids = [...new Set(ids)].slice(0, 40);
    let records = [];
    if (ids.length) {
      try { records = parsePubmed(await fetchText('efetch.fcgi', { id: ids.join(','), retmode: 'xml' }, signal)).filter(r => ids.includes(r.pmid)); }
      catch (e) { if (signal?.aborted) throw e; warnings.push({ message: e instanceof DomainError ? e.message : '记录获取失败。' }); }
    }
    const byId = new Map(records.map(r => [r.pmid, r])); records = ids.map(id => byId.get(id)).filter(Boolean);
    return { query, database: 'PubMed', searchedAt: new Date().toISOString(), dateRange: '遵循本次检索式的日期条件；未额外添加年份限制', searches, records,
      missingIds: ids.filter(id => !byId.has(id)), warnings, coverage: '相关性与发表时间排序各取前 20 条，去重后读取题名／摘要；属于初步扫描。' };
  } };
}
