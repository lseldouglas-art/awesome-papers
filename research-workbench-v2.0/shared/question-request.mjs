// Route only a direct request from the researcher, never text from a paper or an AI answer.
export function questionRequest(text, artifactKind, previous = null) {
  if (!['brief', 'questions'].includes(artifactKind) || typeof text !== 'string') return null;
  const value = text.trim().replace(/“[^”]*”|「[^」]*」|```[\s\S]*?```/g, '');
  if (/不要(?:再)?(?:重新)?(?:选题|生成|推荐|刷新|更换)|不(?:需要|用)(?:再)?(?:重新)?(?:选题|生成|推荐)|只(?:需|要)?(?:解释|讨论|记录)|先别|暂不|如果.*(?:重新|换)/.test(value)) return null;
  const topics = /选题|题目|候选|研究方向/.test(value);
  const replacement = /重新|重做|再(?:给|推荐|生成)|换(?:一批|几个|些|一组)|刷新|不(?:喜欢|满意|符合)|质量不高/.test(value);
  const action = /给我|帮我|请|推荐|生成|提供|刷新|换|进行|怎么选题|如何选题/.test(value);
  const review = /(?:想|要|准备|打算|计划|改为|改成|只做|只写).{0,12}(?:综述|[Rr]eview)|综述(?:选题|方向|题目)/.test(value);
  if (!(topics && action && (replacement || review || /推荐|生成|给我|提供/.test(value)))
    && !(artifactKind === 'questions' && /(?:再给我|换一批|重新推荐|重新生成)/.test(value))) return null;
  const original = /(?:不写|不要|不做)综述|(?:改做|改为|想做|要做).{0,8}(?:原始研究|实验|临床研究)/.test(value);
  return { version: 1, purpose: original ? 'research' : review ? 'review' : previous?.purpose ?? 'research',
    text: text.trim(), replace: artifactKind === 'questions', previousRequest: previous?.text ?? null,
    feedback: [...(previous?.feedback ?? (previous?.text ? [previous.text] : [])), text.trim()] };
}

export function candidateInstructions(request) {
  if (!request) return '';
  return `\n本轮是研究者明确要求重新生成候选。以 context.candidateRequest 的最新意图、反馈和已有候选为准。旧候选是待重新考虑的设想，不是原始证据，也不是用户已经采用的题目。说明这次如何回应不满意点，不只改标题重复旧题。材料不足时给出具体未知，不编造创新。${request.purpose === 'review' ? `
研究者本轮明确要写综述：所有候选必须是文献综合能回答的问题。不要把新建临床队列、实验或多轮专家 Delphi 共识作为本轮拟议研究；可把这些列为原文研究设计或未来研究建议，但不能拿它们替代综述选题。
各题明确适合的综述类型及理由（叙述性、范围、系统综述等，只有数据可合并时才建议 Meta 分析）、具体综合问题与边界、最接近综述的已知覆盖及待查增量、可获取证据与方法取舍。避免宽泛的“某领域研究进展”、未经核查的“首次”，不能将当前未检到当作没有综述。
沿用 proposal 字段：design 描述综述类型和方法；primaryOutcome 描述综合的核心问题或结局（不适用量化结局时明确说明）；analysisPlan 描述文献比较/综合方法；dataRequirements 仅列所需文献与已确认/未知的方法条件。沿用完整八项论证，但假设、反例、设计与资源均围绕综述任务。` : '\n按研究者最新指定的研究类型比较候选，不沿用已经更正的综述限制。'}`;
}
