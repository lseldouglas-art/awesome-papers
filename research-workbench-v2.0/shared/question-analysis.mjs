// Research-value and personal-fit dimensions from M03, without ranking or gates.
export const analysisDimensions = Object.freeze([
  {key:'gap', label:'科学问题与真实缺口', group:'value'},
  {key:'contribution', label:'创新增量与研究价值', group:'value'},
  {key:'testability', label:'可验证性与反证', group:'value'},
  {key:'feasibility', label:'资源与实施条件', group:'fit'},
  {key:'fit', label:'个人能力与时间匹配', group:'fit'},
  {key:'risk', label:'关键风险与替代路径', group:'fit'},
  {key:'design', label:'研究设计与偏倚控制', group:'route'},
  {key:'output', label:'成果边界与投稿条件', group:'route'},
]);
const text = v => typeof v === 'string' && Boolean(v.trim());
const texts = v => Array.isArray(v) && v.every(text);
const indexes = v => Array.isArray(v) && v.every(i => Number.isInteger(i) && i >= 0) && new Set(v).size === v.length;
const ungroundedPersonalFit = v => ['feasibility','fit'].includes(v.key) && v.basis === 'inference' && v.supporting.length + v.conflicting.length === 0;
export function validAnalysis(value) {
  return Array.isArray(value) && value.length === analysisDimensions.length
    && analysisDimensions.every(d => value.filter(v => v?.key === d.key).length === 1)
    && value.every(v => text(v.judgment) && text(v.reasoning) && texts(v.checks) && v.checks.length > 0
      && ['inference','planning','unknown'].includes(v.basis)
      && indexes(v.supporting) && indexes(v.conflicting)
      && (v.basis !== 'inference' || v.supporting.length + v.conflicting.length > 0 || ungroundedPersonalFit(v)));
}
export function normalizeAnalysis(value) {
  if (!validAnalysis(value)) return null;
  return analysisDimensions.map(({key}) => {
    const v = value.find(v => v.key === key);
    const reviewRequired = ungroundedPersonalFit(v) || (v.basis === 'unknown' && v.modelBasis === 'inference' && v.reviewRequired === true);
    return {key,judgment:v.judgment.trim(),reasoning:v.reasoning.trim(),checks:[...v.checks],basis:reviewRequired?'unknown':v.basis,supporting:[...v.supporting],conflicting:[...v.conflicting],
      ...(reviewRequired ? {modelBasis:'inference',reviewRequired:true,reviewReason:'这项个人条件判断未附可核对依据，需先确认资源与能力，不能视为已经确认可行。'} : {})};
  });
}
export function analysisStatements(q, item) {
  return [['supporting',q.supporting],['conflicting',q.conflicting]].flatMap(([key,values]) =>
    (item[key] ?? []).flatMap(index => values?.[index] ? [{...values[index],role:key}] : []));
}
const asText = v => typeof v === 'string' ? v : v?.text;
const lines = v => (Array.isArray(v) ? v.map(asText).filter(text) : text(v) ? [v] : []);
// Read-only projection of a single saved revision. Missing reasoning stays missing.
export function questionAnalysisFor(q, a) {
  const stale = q.assessmentNeedsReview || q.proposalNeedsReview || q.evidenceNeedsReview;
  const saved = !stale && normalizeAnalysis(q.assessment?.analysis);
  if (saved) return saved.map(item => ({...item,origin:'analysis',statements:analysisStatements(q,item)}));
  const proposal = q.proposalNeedsReview ? {} : q.proposal ?? {};
  const unknowns = lines(q.unknowns), checks = lines(a.focus?.nextChecks);
  const values = {
    gap:[q.text || q.question, q.rationale, unknowns],
    contribution:[a.innovation, proposal.noveltyCheck, [proposal.contribution]],
    testability:[null,null,[]],
    feasibility:[null,lines(proposal.dataRequirements).join('；'),lines(q.feasibility?.unknown)],
    fit:[null,a.difficulty?.rationale,lines(a.difficulty?.assumptions)],
    risk:[a.risks?.[0],lines(a.risks).slice(1).join('；'),unknowns],
    design:[proposal.design, [proposal.primaryOutcome,proposal.analysisPlan].filter(text).join('\n\n'),lines(proposal.dataRequirements)],
    output:[proposal.contribution,null,[]],
  };
  return analysisDimensions.map(({key}) => {
    const [judgment,reasoning,items] = values[key];
    return {key,judgment:judgment || '本版尚未形成这项判断',reasoning:reasoning || '需要围绕本题继续论证，不能从其他选题的评价推定。',
      checks:items.filter(text),basis:'planning',origin:stale?'stale':'saved_fields',missing:!judgment || !reasoning,
      supporting:[],conflicting:[],statements:[]};
  });
}
export const topicAnalysisInstructions = `
逐题深度论证：每个 question.assessment 另含 analysis 数组，八项 key 必须各出现一次：gap、contribution、testability、feasibility、fit、risk、design、output。
每项形如 {key,judgment,reasoning,checks:[字符串],basis,supporting:[整数],conflicting:[整数]}。judgment 是可快速阅读的结论，reasoning 用数句完整解释“本题依据—推理—限制—改变判断的条件”，不能重复短评、套用其他选题或以“门槛低、模板成熟、可发表”替代论证。checks 给出本题下一项具体核查与判断标准。
basis 仅可为 inference（据材料推论）、planning（拟议路径/条件假设）、unknown（材料不足）。supporting/conflicting 是本题相应陈述数组的从0开始索引，绝不能指向别题、直接返回新引用或凭空添加来源。inference 至少引用一项本题依据；已有引文能定位不等于支持整段推论，必须核对命题与原文一致。规划不伪装成已证实事实，unknown 要说明缺什么信息及怎样查清。
gap：明确具体科学问题、对象边界与最近相关研究；区分作者报告的局限、材料内部差异、本轮未覆盖；综述发表不意味着出现了新增独立试验，未检索到不证明无人研究。
contribution：把拟新增内容与最接近研究逐项比较，说明可能改变什么认识、临床/机制判断或方法；新对象、新组合不是天然创新，作者提到的局限不自动等于本题未被研究。
testability：什么可观测结果支持或削弱本题主张，竞争解释是什么，什么结果会使你缩小或放弃原主张；综述也需可检验的证据分类规则，不能只有通路罗列。
feasibility：逐项写明数据、文献、设备、软件、样本、协作等所需条件；用户明确已有的条件与假设、未知分开。方法可用不等于用户能完成；关键条件未提供时结论为有条件可行或尚不能判断。
fit：基于用户明确的能力、投入时间与目标，分别说明已有能力、可学习、需协作及未知；不得把假设资源说成用户已拥有。缺少硬期限时不判断能按期完成；说明周期估算的分解和敏感因素，不用三题统一结论。
risk：最可能使本题失败的科学或执行条件、尽早发现它的办法、可保持有效贡献的缩小/替代路径；没有替代路径时如实说明。
design：用适合本研究类型的对象—问题—证据路线—方法—结局组织；说明方法为何回答该问题、可比条件和偏倚控制。系统评价需核查独立研究、重复报告、结局与随访可比性；不凭I²机械决定统计模型，不把新增数量等同证据质量提升。叙述综述需范围、纳入边界与批判性证据框架；计算/对接需说明预测、结合可能性与实际机制/疗效验证的差别和外部验证需求。以上是设计核查任务，不声称已经完成分析。
output：界定本题在当前证据路线下可交付的最小成果、不能主张的结论、投稿所需补齐条件和退路；未明确期刊或未核对范围时保持未知，不编造分区、命中率、保底发表或已经符合目标期刊。
摘要级比较可交付；只为决定性方法/数值/因果主张列出少量需全文核查的关键文章，不要求全池阅读全文。不要把可行性、科学价值和个人适合度合并为一个总分，也不替用户决定。`;

export function topicAnalysisRequest(q) {
  return { text:`只重新分析这一具体选题，保持 question 与 scope 原文，不另换题目，不评估其他候选。返回唯一一个 question，完整论证八项维度，保存为独立结果供我比较，原记录保留。\n研究问题：${q.text}\n范围：${q.scope ?? ''}`,
    itemId:q.id,itemRevisionId:q.revisionId,accessIds:[...new Set((q.evidence ?? []).map(e=>e.accessId).filter(Boolean))] };
}
