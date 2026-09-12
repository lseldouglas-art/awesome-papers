// A query-repair projection, not evidence extraction. All pilot rows remain in
// rank order; full feedback is retained in the immutable task input.
export function compactSearchFeedback(feedback) {
  if (!feedback) return null;
  const clip = (value, size) => typeof value === 'string' && value.length > size ? `${value.slice(0, size)}…` : value;
  const { calibration, ...rest } = feedback;
  return { ...rest, projection: 'query-repair-digest-v1',
    boundary: '只供检索式诊断；理由最多160字、原文摘录最多180字，完整记录保留在本机；不是完整摘要或重新筛选。',
    calibration: calibration ? { ...calibration, samples: calibration.samples.map(sample => ({
      rank: sample.rank, pmid: sample.pmid, title: sample.title, level: sample.level,
      relationship: sample.relationship, criteriaVersion:sample.criteriaVersion, summary:clip(sample.summary,240), titleMatches:sample.titleMatches, actor: sample.actor,
      reason: clip(sample.reason, 160), quotes: (sample.quotes ?? []).slice(0, 1).map(q => clip(q, 180)),
      excerpted: (sample.reason?.length ?? 0) > 160 || (sample.quotes?.length ?? 0) > 1 || (sample.quotes?.[0]?.length ?? 0) > 180
    })) } : null };
}
