import { collectionQuery } from './topic-library-workflow.mjs';

export function pubmedSearchUrl(query, options = {}) {
  if (!query?.trim()) return null;
  const url = new URL('https://pubmed.ncbi.nlm.nih.gov/');
  url.searchParams.set('term', collectionQuery(query, options));
  url.searchParams.set('sort', options.sort === 'pub_date' ? 'pubdate' : 'relevance');
  url.searchParams.set('size', '20');
  return url.href;
}
export function pubmedPaperUrl(pmid) {
  return /^\d+$/.test(String(pmid ?? '')) ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : null;
}
export function pubmedManifestUrl(pmids) {
  const ids = [...new Set(pmids.filter(id => /^\d+$/.test(String(id))))];
  return ids.length ? pubmedSearchUrl(ids.map(id => `${id}[uid]`).join(' OR ')) : null;
}
// Export only observed bibliography and the actual abstract snapshot. No AI prose
// is represented as a paper abstract, and RIS control lines cannot be injected.
export function literatureRis(rows) {
  const clean = value => String(value ?? '').replace(/[\r\n\u0000]+/g, ' ').trim();
  return rows.map(({ source:s, access:a }) => [
    'TY  - JOUR', `TI  - ${clean(s.title)}`,
    ...(s.authors ?? []).map(author => `AU  - ${clean(author)}`),
    ...(s.year ? [`PY  - ${clean(s.year)}`] : []),
    ...(s.journal ? [`JO  - ${clean(s.journal)}`] : []),
    ...(s.doi ? [`DO  - ${clean(s.doi)}`] : []),
    ...(s.pmid ? [`AN  - PMID: ${clean(s.pmid)}`] : []),
    ...(pubmedPaperUrl(s.pmid) ? [`UR  - ${pubmedPaperUrl(s.pmid)}`] : []),
    ...(a?.level === 'abstract' && a.text ? [`AB  - ${clean(a.text)}`] : []),
    'ER  -'
  ].join('\n')).join('\n\n');
}
