export const topicLayouts = Object.freeze({ comparison: '证据对照', cards: '问题卡片', sequence: '推理路径' });

// Reuse exact, cited access snapshots; never substitute a newer paper record.
export function comparisonRows(project, result, blockIds) {
  const blocks = new Set(blockIds), scope = new Set(result.reviewAccessIds ?? result.accessIds ?? []);
  const ids = [...new Set((result.citations ?? []).filter(c => blocks.has(c.blockId) && scope.has(c.accessId)).map(c => c.accessId))];
  return ids.flatMap(accessId => {
    const access = project.accesses[accessId], source = access && project.sources[access.sourceId];
    const note = (result.paperNotes ?? []).find(n => n.accessId === accessId && n.sourceId === access?.sourceId);
    return source && note ? [{accessId, source, level: access.level, fields: note.fields}] : [];
  });
}
const defaults = { evidence: 'comparison', gap: 'cards', design: 'sequence' };

// Optional presentation cannot invalidate evidence or inject executable content.
export function topicPresentation(value, sectionId) {
  const allowed = value && Object.keys(value).every(k => k === 'layout') && Object.hasOwn(topicLayouts, value.layout);
  return { layout: allowed ? value.layout : defaults[sectionId] ?? 'cards', origin: allowed ? 'agent' : 'default' };
}

export const topicPresentationInstructions = `每个 section 可带 presentation:{layout:"comparison"|"cards"|"sequence"}，根据实际论证内容选择：comparison 用于研究/条件对照，cards 用于不同待核查问题，sequence 用于解释推理或设计步骤。三种可混用，不必每节照固定模板；不为了布局凑论点或省略反证。sequence 仅表示阅读/推理顺序，不能暗示因果关系或未经依据支持的时间线。headline 是保留证据边界的单一论点；完整解释、引用和信息状态放在原有 reasoning 中。不要返回 HTML、CSS、图片 URL 或自创图表数值；材料分布由程序根据实际所选材料计算。`;
