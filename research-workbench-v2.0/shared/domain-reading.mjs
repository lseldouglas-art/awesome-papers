// A display-only projection. Source identities, citations and saved versions stay intact.
const passageToken = 'P\\d+(?:[–—-]P?\\d+)?';
const citationToken = `R\\d+(?:(?:\\s*[-–—:]\\s*|\\s+)${passageToken}(?:\\s*[、,，]\\s*${passageToken})*)?`;
const citationGroup = `${citationToken}(?:\\s*[、,，;；与和及]\\s*${citationToken})*`;
const technicalSuffix = /^(?:受体|表达|蛋白|基因|通路|细胞|信号|值|系数|评分|期|型|组|比|[A-Za-z0-9²])/;

export function readingText(text = '', references = []) {
  const known = new Set(references.map(r => typeof r === 'string' ? r : r.ref).filter(Boolean));
  const isCitation = text => [...text.matchAll(/R\d+/g)].every(m => known.has(m[0]));
  return String(text)
    .replace(new RegExp(`[（(\\[]\\s*(${citationGroup})\\s*[）)\\]]`, 'g'), (all, refs) => isCitation(refs) ? '' : all)
    .replace(new RegExp(`(?<![A-Za-z0-9])${citationGroup}`, 'g'), (all, offset, original) => {
      if (!isCitation(all) || technicalSuffix.test(original.slice(offset + all.length))) return all;
      return '相关研究';
    })
    .replace(/相关研究(?:\s*、\s*相关研究)+/g, '相关研究')
    .replace(/\bgaps(?=\s*中)/g, '证据空缺')
    .replace(/\bpapers(?=\s*记录)/g, '逐篇整理')
    .trim();
}

export function readingResult(result) {
  const refs = [...(result.materialManifest || []), ...(result.citations || [])];
  const clean = text => readingText(text, refs);
  const visual = value => {
    if (typeof value === 'string') return clean(value);
    if (Array.isArray(value)) return value.map(visual);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, ['id','sourceId','accessId','blockId','ref','passage','quote','quotes'].includes(k) ? v : visual(v)]));
    return value;
  };
  return {...result,
    blocks: (result.blocks || []).map(b => ({...b, text:clean(b.text), ...(b.headline ? {headline:clean(b.headline)} : {}), ...(b.dimensionLimitation ? {dimensionLimitation:clean(b.dimensionLimitation)} : {}), ...(b.visual ? {visual:visual(b.visual)} : {})})),
    paperNotes: (result.paperNotes || []).map(n => ({...n, fields:Object.fromEntries(Object.entries(n.fields || {}).map(([k,v]) => [k, {...v, text:clean(v.text)}]))})),
  };
}
