// Navigation is local and deterministic. A request about a next step remains a research question.
export function isContinueNavigation(text) {
  const value = String(text ?? '').trim().replace(/[\s，,。.!！；;]/g, '');
  return /^(?:(?:我)?(?:已|已经)?(?:选用|选择|采用)(?:了)?(?:这个|该)(?:主题|题目|选题|问题))?(?:(?:请|帮我)?(?:进入|继续|开始|到)(?:下一个阶段|下一阶段|下一步)|下一步)$/.test(value);
}
export function exactQuestion(project, ref) {
  const id = ref?.itemId ?? ref?.id, revisionId = ref?.itemRevisionId ?? ref?.revisionId;
  const item = project.researchItems?.[id], revision = item?.revisions.find(r => r.id === revisionId);
  return revision ? { ...revision, id: item.id, revisionId: revision.id, kind: item.kind, evidence: (revision.evidenceIds ?? []).map(id => project.evidence[id]).filter(Boolean) } : null;
}
export function continuationQuestion(project, artifact, focused) {
  return exactQuestion(project, artifact.branchQuestion) ?? exactQuestion(project, project.researchState?.currentQuestion) ?? exactQuestion(project, focused);
}
export function savedInvestigations(project, question) {
  if (!question) return [];
  return Object.values(project.researchTasks ?? {}).filter(t => t.status === 'completed' && !t.staleInput && t.mode === 'deepen'
    && t.input?.itemTarget?.itemId === question.id && t.input.itemTarget.revisionId === question.revisionId
    && project.researchResults[t.resultId]?.kind === 'answer').sort((a,b) => a.createdAt.localeCompare(b.createdAt));
}
export function concise(text, length = 64) {
  const value = String(text ?? '').trim();
  return value.length > length ? `${value.slice(0, length)}…` : value;
}
export const taskPurposes = Object.freeze({ 'template-recommend':'正在推荐模板文献', 'template-study':'正在分析模板写作特点', 'template-optimize':'正在优化当前段落', 'manuscript-writing':'正在生成完整初稿', 'topic-writing':'正在处理当前小节', 'topic-screen':'正在完成文献评级', 'topic-preview':'正在校准前 20 篇', 'topic-outline':'正在生成研究大纲', 'topic-review':'正在逐篇整理并分析专题证据', ask: '正在分析研究问题', deepen: '正在论证选题与研究设计', compare: '正在生成论文选题对照', clarify: '正在梳理补查范围', retrieve: '正在检索并保存文献', landscape: '正在形成领域认识', revise: '正在更新领域报告', brief: '正在整理工作简报', connection: '正在检查模型连接' });

export function isTopicReviewRequest(text) {
  const value=String(text??'').trim();
  if (/不要|不需要|别|如何|怎么|是否|吗[？?]?$/.test(value)) return false;
  return /(?:分析|整理|综合)(?:一下)?(?:现有|当前|这些|本次|所选|全部)?(?:的)?(?:专题)?(?:文献|材料)(?:库)?/.test(value);
}

// A successful re-fetch must not hide the latest unfinished domain analysis.
export function pendingDomainAnalysis(tasks, artifactId) {
  const latest = tasks.filter(t=>t.artifactId===artifactId && ['landscape','revise'].includes(t.mode))
    .sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).at(-1);
  return latest && ['failed','interrupted','cancelled'].includes(latest.status) ? latest : null;
}
