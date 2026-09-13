const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function setRetrievalRange(options = {}, range = 'recent5', today = new Date().toISOString().slice(0, 10)) {
  const next = { type: 'reviews', limit: 'all', sort: 'pub_date', ...options, range, from: '', to: '' };
  if (range === 'recent5' || range === 'custom') {
    const end = new Date(`${today}T00:00:00Z`), year = end.getUTCFullYear() - 5;
    const day = Math.min(end.getUTCDate(), new Date(Date.UTC(year, end.getUTCMonth() + 1, 0)).getUTCDate());
    next.from = new Date(Date.UTC(year, end.getUTCMonth(), day)).toISOString().slice(0, 10);
    next.to = today;
  }
  return next;
}

export function retrievalScopeError(o) {
  if (!o || !['recent5', 'all', 'custom'].includes(o.range) || !['reviews', 'systematic', 'any'].includes(o.type) || !['pub_date', 'relevance'].includes(o.sort)) return '请选择有效的时间、文献类型与排序。';
  if (o.limit !== 'all' && !(Number.isSafeInteger(o.limit) && o.limit > 0)) return '请选择全部获取或有效的文献数量。';
  if (o.range !== 'all' && (!validDate(o.from) || !validDate(o.to) || o.from > o.to)) return '请输入有效的起止日期，开始日期不能晚于结束日期。';
  if (o.range === 'all' && (o.from || o.to)) return '全部年份不应附加日期限制。';
  return '';
}

export function retrievalOptions(o) {
  return { range: o.range, from: o.from || '', to: o.to || '', type: o.type, limit: o.limit, sort: o.sort };
}

export function retrievalQuery(query, options) {
  const filters = [];
  if (options.type === 'reviews') filters.push('(Review[pt] OR Systematic Review[pt] OR Meta-Analysis[pt])');
  if (options.type === 'systematic') filters.push('(Systematic Review[pt] OR Meta-Analysis[pt])');
  if (options.from && options.to) filters.push(`("${options.from.replaceAll('-', '/')}"[Date - Publication] : "${options.to.replaceAll('-', '/')}"[Date - Publication])`);
  return filters.length ? `(${query.trim()}) AND ${filters.join(' AND ')}` : query.trim();
}

export function matchesRetrievalScope(search, query, options) {
  return Boolean(search?.retrievalOptions && search.baseQuery === query.trim() && JSON.stringify(retrievalOptions(search.retrievalOptions)) === JSON.stringify(retrievalOptions(options)));
}

export function retrievalRangeLabel(o) {
  return o.range === 'all' ? '全部年份' : `${o.from} 至 ${o.to}`;
}
