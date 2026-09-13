// Display and request contracts. The existing research items remain authoritative.
export const investigationVersion = 'question-investigation-v1';
export const investigationSections = {
  importance: '为什么值得研究', closest: '最接近的研究', gap: '缺口及检索边界',
  alternative: '竞争解释与区分办法', fit: '结合你的条件', routes: '研究路线的取舍', reversal: '什么会改变推荐',
};
export const recommendationLabels = { advance: '优先推进', conditional: '有条件推进', narrow: '建议缩小', defer: '暂缓判断' };
export const investigationPhaseLabels = { initial: '初步判断', challenge: '最值得核查的问题', revised: '核查后的判断' };
export function investigationTasks(project, target) {
  return Object.values(project.researchTasks ?? {}).filter(t => t.mode === 'question-investigation'
    && t.input?.itemTarget?.itemId === (target?.id ?? target?.itemId));
}
export function investigationRequest(question, accessIds, options = {}) {
  return { itemId: question.id, itemRevisionId: question.revisionId, accessIds,
    investigationOptions: { search: 'saved', ...options } };
}
export const qualityCases = [
  ['recommendation', '候选比较与推荐理由'], ['closest', '最接近的既有研究'], ['counterexample', '最强反例核查'],
  ['resources', '个人条件约束'], ['design', '研究设计取舍'], ['correction', '纠正条件后的重新判断'],
].map(([id, label]) => ({ id, label, core: ['recommendation', 'counterexample', 'design'].includes(id) }));
export const qualityDimensions = { understanding: '问题理解', evidence: '证据相关性', comparison: '比较深度',
  counterargument: '反证与替代解释', fit: '个人条件适配', actionable: '建议可执行性', boundary: '结论边界' };
export const qualityCauses = { retrieval: '材料未取得', unused: '材料未使用', context: '背景遗漏', reasoning: '推论不足',
  tool: '工具失败', truncation: '输出截断', display: '展示掩盖重点', other: '其他／尚未确定' };
