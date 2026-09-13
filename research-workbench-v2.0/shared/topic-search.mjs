// A topic owns its query history even when its materials came from a broader scan.
export function searchesForArtifact(project, artifact) {
  const owners = new Map(Object.values(project.researchTasks ?? {}).filter(t => t.searchId).map(t => [t.searchId, t.artifactId]));
  return Object.values(project.searches ?? {}).filter(s => {
    const owner = s.artifactId ?? owners.get(s.id);
    return owner ? owner === artifact.id : artifact.kind !== 'topic_library' && s.accessIds.length > 0 && s.accessIds.every(id => artifact.draft.sourceAccessIds.includes(id));
  }).sort((a, b) => (a.searchedAt ?? '').localeCompare(b.searchedAt ?? ''));
}

export function topicQueryState(project, artifact) {
  const proposals = Object.values(project.researchTasks ?? {}).filter(t => t.artifactId === artifact.id && t.status === 'completed' && !t.staleInput && t.proposal)
    .sort((a, b) => (a.finishedAt ?? a.createdAt).localeCompare(b.finishedAt ?? b.createdAt));
  const task = proposals.at(-1), search = searchesForArtifact(project, artifact).at(-1);
  const proposal = task ? { ...task.proposal, taskId: task.id } : null;
  const searchedLast = search && (!task || search.searchedAt > (task.finishedAt ?? task.createdAt));
  const searchQuery = search?.baseQuery ?? search?.query;
  return { proposal, query: (searchedLast ? searchQuery : proposal?.query ?? searchQuery) ?? '',
    scopeMode: (searchedLast ? search.scopeMode : task?.input?.searchScopeMode ?? search?.scopeMode) ?? 'focused' };
}

export function searchTotals(search) {
  const totals = [...new Set((search?.searches ?? []).map(s => s.total).filter(n => Number.isSafeInteger(n) && n >= 0))];
  return totals.length ? { min: Math.min(...totals), max: Math.max(...totals), consistent: totals.length === 1 } : null;
}

// Adapted from the saved query-strategy and calibration methods, not their old runtime limits.
export const topicSearchMethod = `专题检索以 primaryResearchObject 的具体问题及版本为首要研究对象；原课题目标、历史报告、相邻主题只作背景，不能替换专题。
先识别单一概念或复合概念：单一主题保留一个完整词群，不把“研究现状”当检索实体；复合主题拆为真正必要的核心概念，不机械把全部 PICO 逐项 AND。组内以 OR 连接 MeSH、题名摘要同义词、缩写、下位词和拼写变体，组间 AND；不能虚构 MeSH，不确定时用题名摘要自由词。遵守 PubMed 语法，不用 Scopus/WOS 语法，不自行加入高风险 NOT、年份、语言或文献类型限制。
searchScopeMode=focused 时围绕同一专题补全词群；searchScopeMode=expanded 表示用户请求扩展候选范围，保留核心研究对象，明确放宽的场景或次要限制，以及所得间接材料不能直接外推的边界。扩展不能偷偷换题。说明写入 scope 和 explanation，生成候选检索式供用户查看后运行。
searchFeedback 是实际检索记录；各排序命中量不能相加，命中数与读到的样本量分开。结果过少先检查词群、拼写、标引与 AND 过严；噪声较多先核对题名摘要与词义歧义。只有实际给出的材料才能作样本校准，不能声称读过未提供的摘要。数量波动不等于研究趋势、检索失败、创新性或不存在研究；没有真实运行时不得声称新检索式命中更多。不得为凑数量丢掉本题锚点。`;
