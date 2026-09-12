// Deduplicate actual access text, without rewriting any historical source or citation.
export function uniqueAccessIds(project, ids) {
  const seen = new Set();
  return ids.filter(id => {
    const access = project.accesses[id], source = project.sources[access?.sourceId];
    if (!access || !source) return false;
    const key = JSON.stringify([source.origin === 'pubmed' && source.pmid ? `pmid:${source.pmid}` : access.sourceId, access.level, access.text]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function latestSavedQuery(project) {
  const proposal = project.researchProposal;
  const search = Object.values(project.searches ?? {}).at(-1);
  const proposalAt = project.researchTasks?.[proposal?.taskId]?.finishedAt ?? '';
  if (search && (!proposal || search.searchedAt > proposalAt)) return search.query;
  return proposal?.query ?? search?.query ?? '';
}

// Project sources are append-only. A paper keeps its number across paragraphs,
// tasks, reloads and historical views; different snapshots retain their access IDs.
export function referenceNumbers(project) {
  const identities = new Map(), numbers = {};
  for (const source of Object.values(project.sources ?? {})) {
    const identity = source.origin === 'pubmed' && source.pmid ? `pmid:${source.pmid}` : source.id;
    if (!identities.has(identity)) identities.set(identity, identities.size + 1);
    numbers[source.id] = identities.get(identity);
  }
  return numbers;
}

export function materialPacket(project, ids) {
  const numbers = referenceNumbers(project), versions = new Map();
  return uniqueAccessIds(project, ids).map(id => {
    const access = project.accesses[id], source = project.sources[access.sourceId];
    const number = numbers[source.id], version = (versions.get(number) ?? 0) + 1;
    versions.set(number, version);
    return { sourceId: source.id, accessId: id, ref: `R${number}${version > 1 ? `v${version}` : ''}`,
      title: source.title, authors: source.authors ?? [], year: source.year ?? source.published?.match(/\b\d{4}\b/)?.[0] ?? null,
      pmid: source.pmid ?? null, level: access.level, text: access.text };
  });
}

export function outlineGroups(blocks) {
  const groups = [];
  for (const block of blocks) {
    if (block.type === 'heading') groups.push({ ...block, children: [] });
    else if (groups.length) groups.at(-1).children.push(block);
  }
  return groups;
}

// A lossless partition for source anchors, not a context cutoff. Every character
// is retained in order; the model returns a passage ID instead of retyping quotes.
export function sourcePassages(text) {
  const passages = []; let start = 0;
  while (start < text.length) {
    let end = Math.min(start + 600, text.length);
    if (end < text.length) {
      const slice = text.slice(start, end), breaks = [...slice.matchAll(/[.!?。！？](?=\s)|\n/g)];
      const boundary = breaks.at(-1)?.index;
      if (boundary !== undefined && boundary > 100) end = start + boundary + 1;
    }
    passages.push({ id: `P${passages.length + 1}`, text: text.slice(start, end), start, end }); start = end;
  }
  return passages;
}
