// Versioned planning contract. Historical assessments stay immutable.
export const decisionTemplates = Object.freeze({
  comparison: { name: '图表比较', use: '多个方向需要按同一尺度比较', image: '01-comparison.png', reference:'design-explorations/2026-09-10-adaptive-research/02-topic-investment-chart-v3.png' },
  reading: { name:'文字比较', use:'研究切口与投入理由需要连贯解释', image:'02-topic-investment-reading-v3.png', reference:'design-explorations/2026-09-10-adaptive-research/02-topic-investment-reading-v3.png' },
  accordion: { name: '悬停折页', use: '逐个浏览选题，原位展开理由', image: '02-accordion.png' },
  brief: { name: '研究者简报', use: '区分研究价值与个人条件', image: '03-brief.png' },
  landscape: { name: '领域全景', use: '先理解不同问题方向及其关系', image: '04-landscape.png' },
  timeline: { name: '投入与周期', use: '时间或资源依赖是主要取舍', image: '05-timeline.png' },
});
const text = v => typeof v === 'string' && v.trim().length > 0;
const texts = v => Array.isArray(v) && v.length > 0 && v.every(text);
const units = ['个月', '小时/周', '人'];
export const validDifficulty = d => Boolean(d && Number.isInteger(d.level) && d.level >= 1 && d.level <= 5 && text(d.rationale) && texts(d.assumptions));
const validFocus = f => Boolean(f && text(f.question) && texts(f.nextChecks) && (!f.axes || (Array.isArray(f.axes) && f.axes.length === 2 && f.axes.every(a => text(a.label) && text(a.description)) && text(f.relation))));
export function validAssessment(a) {
  return Boolean(a && ['summary','feasibility','innovation','value'].every(k => text(a[k]) && !/^(待确认|待估|未知|待核查)[。！!]*$/.test(a[k].trim()))
    && texts(a.risks) && Array.isArray(a.estimates) && (a.version === 2 || a.difficulty ? a.estimates.some(e => e?.unit === '个月') && !a.estimates.some(e => e?.unit === '小时/周') && validDifficulty(a.difficulty) : ['个月','小时/周'].every(unit => a.estimates.some(e => e?.unit === unit)))
    && (a.focus === undefined || validFocus(a.focus))
    && a.estimates.every(e => e && text(e.label) && units.includes(e.unit) && Number.isFinite(e.min) && e.min > 0 && Number.isFinite(e.max) && e.max >= e.min
      && texts(e.assumptions) && text(e.basis) && text(e.sensitivity)));
}
export function decisionPresentation(value, fallback = 'brief') {
  const valid = value && Object.hasOwn(decisionTemplates, value.template) && text(value.reason)
    && Object.keys(value).every(k => ['template','reason','origin'].includes(k));
  return valid ? { template: value.template, reason: value.reason, origin: 'agent' }
    : { template: fallback, reason: decisionTemplates[fallback].use, origin: 'default' };
}
export function normalizeAssessment(a) {
  if (!validAssessment(a)) return null;
  return { version: a.version === 2 || a.difficulty ? 2 : 1, origin: 'agent', kind: 'planning_estimate',
    ...Object.fromEntries(['summary','feasibility','innovation','value'].map(k => [k,a[k].trim()])), risks: [...a.risks],
    estimates: a.estimates.map(e => ({ label:e.label, min:e.min, max:e.max, unit:e.unit, assumptions:[...e.assumptions], basis:e.basis, sensitivity:e.sensitivity })),
    ...(a.difficulty ? {difficulty:{level:a.difficulty.level,rationale:a.difficulty.rationale,assumptions:[...a.difficulty.assumptions],origin:'agent'}} : {}),
    ...(a.focus ? {focus:{question:a.focus.question,nextChecks:[...a.focus.nextChecks],...(a.focus.axes ? {axes:a.focus.axes.map(v=>({label:v.label,description:v.description})),relation:a.focus.relation} : {})}} : {}),
    presentation: decisionPresentation(a.presentation), citations: structuredClone(a.citations ?? []) };
}

// Legacy records have no assessment. These are explicit planning scenarios,
// not model conclusions or claimed discipline benchmarks. No old record is edited.
const scenarios = {
  prospective: { name:'新建临床研究', stages:[['准备与协作',2,4],['收集与随访',6,18],['分析与写作',3,6]], difficulty:4, difficultyReason:'新建研究依赖临床协作、招募与随访，多环节需要协调',
    assumptions:['假设有 1 个合作中心、1 名主要研究者及统计支持','假设收集与随访可在 6–18 个月内完成；未按本题样本量核算'], sensitivity:'招募或随访每延长 3 个月，总周期约增加 3 个月。' },
  laboratory: { name:'机制与实验研究', stages:[['平台与预实验',2,4],['实验与复核',6,12],['分析与写作',3,6]], difficulty:5, difficultyReason:'依赖实验平台、重复验证与专业操作，技术和协作环节较多',
    assumptions:['假设已有实验平台、1 名主要研究者与平台支持','按 1 条主线、2 轮实验与复核安排；不是样本量或成功率计算'], sensitivity:'关键实验增加 1 轮，按本情景另留 2–4 个月；新建平台时间另计。' },
  existing: { name:'已有数据研究', stages:[['准备与数据整理',1,2],['分析与复核',2,4],['写作与修订',2,3]], difficulty:2, difficultyReason:'在现成数据与统计支持的假设下，可从单一分析主线起步',
    assumptions:['假设已有获准使用的数据及统计支持','不含重新招募、长期随访或新建实验平台；1 名主要研究者'], sensitivity:'若需重新收集数据，本区间不再适用，应按新建研究重新估算。' },
  review: { name:'证据综合研究', stages:[['范围与检索',1,2],['筛选与整理',2,4],['综合与写作',2,3]], difficulty:3, difficultyReason:'需要系统检索、双人复核和一致的证据综合方法',
    assumptions:['假设资料可访问，并有第 2 位研究者支持关键筛选复核','按 1 个聚焦问题安排，不将检索量当作已知事实'], sensitivity:'若资料获取或筛选量超出假设，另留 1–3 个月；不保证发表周期。' },
};
function scenarioFor(q) {
  const content = [q.text,q.question,q.scope,q.proposal?.design].filter(Boolean).join(' ');
  if (/前瞻|随机对照|新建队列|prospective|randomi[sz]ed/i.test(content)) return scenarios.prospective;
  if (/回顾|二次分析|公开数据|数据库|retrospective|secondary data/i.test(content)) return scenarios.existing;
  if (/实验|类器官|小鼠|体外|共培养|in vitro|organoid|mice/i.test(content)) return scenarios.laboratory;
  if (/综述|荟萃|meta.analysis|systematic review/i.test(content)) return scenarios.review;
  return scenarios.existing;
}
export function assessmentFor(q = {}) {
  const saved = normalizeAssessment(q.assessment);
  if (saved && !q.assessmentNeedsReview && saved.version === 2) return saved;
  const s = scenarioFor(q), duration = s.stages.reduce((v, [,lo,hi]) => [v[0]+lo,v[1]+hi],[0,0]);
  const basis = `起始规划假设，按步骤相加：${s.stages.map(([n,lo,hi])=>`${n} ${lo}–${hi} 个月`).join('；')}。不是文献统计或本题实测。`;
  const difficulty = {level:s.difficulty,rationale:s.difficultyReason,assumptions:[...s.assumptions],origin:'scenario'};
  if (saved && !q.assessmentNeedsReview) return {...saved, version:2, estimates:saved.estimates.filter(e=>e.unit !== '小时/周'),difficulty};
  return { version:2, origin:'scenario', kind:'planning_estimate', difficulty,
    summary:q.title || q.text || '选题投入与价值',
    feasibility:`按“${s.name}”情景可规划；以以下资源假设为前提`,
    innovation:q.proposal?.noveltyCheck || '先核查最接近研究与本题增量，创新性须由实际对照研究支持。',
    value:q.proposal?.contribution || q.rationale || '先论证具体问题能带来什么可验证贡献，再决定是否投入完整研究。',
    risks:[...(q.unknowns ?? []).map(v=>typeof v==='string'?v:v.text).filter(Boolean), '周期以初稿为终点，不包含投稿、审稿和不可预见的审批等待。'],
    estimates:[{label:'研究至初稿',min:duration[0],max:duration[1],unit:'个月',assumptions:[...s.assumptions],basis,sensitivity:s.sensitivity}],
    presentation:{template:'comparison',reason:q.assessmentNeedsReview?'问题已修订，先展示新问题的条件情景；原估算保留在旧版本。':'旧内容尚无本题估算，先展示可调整的规划情景。',origin:'default'}, citations:[] };
}
export const estimateText = e => `${e.min === e.max ? e.min : `${e.min}–${e.max}`} ${e.unit}`;
export function assessmentText(a) {
  return [`选题评价：${a.summary}`,`可行性：${a.feasibility}`,`潜在创新：${a.innovation}`,`投入价值：${a.value}`,
    ...(a.difficulty ? [`执行难度：${a.difficulty.level}/5 星（条件估计）\n理由：${a.difficulty.rationale}\n假设：${a.difficulty.assumptions.join('；')}`] : []),
    ...a.estimates.map(e=>`${e.label}：${estimateText(e)}（规划预估）\n假设：${e.assumptions.join('；')}\n依据：${e.basis}\n变化因素：${e.sensitivity}`),`风险与边界：${a.risks.join('；')}`].join('\n\n');
}
export const assessmentInstructions = `选题评价优先于实验设计：先说明能否做、值得做的理由、潜在创新、个人条件匹配及投入。title 使用可理解的选题方向短名，具体论文题目和实验步骤放入后续 proposal。
每个 question 必须含 assessment:{version:2,summary,feasibility,innovation,value,risks:[字符串],difficulty:{level,rationale,assumptions:[字符串]},estimates:[{label,min,max,unit,assumptions:[字符串],basis,sensitivity}],focus:{question,nextChecks:[字符串]},presentation:{template,reason}}。title 用 12–22 字的领域选题短名；feasibility、innovation、value 各用一句 15–35 字实质判断，summary 说明首要取舍；详细论证归入 rationale 与 proposal。四个判断用简短实质结论，不能只写待确认。创新与价值要回扣 supporting/conflicting 的实际依据；不能用预计成功率、科学价值总分或文献数量替代论证。
estimates 必须至少包含总研究周期（unit:"个月"，到初稿为止）；不输出每周工时。difficulty.level 为 1–5 的整数：1 星为既有资源下少量标准操作，2 星为单一成熟方法，3 星为多方法或双人协作，4 星为跨团队协作或新建随访，5 星为高技术依赖与多轮验证；必须写明本题的执行障碍与所假设资源。它不是科研质量、创新程度或成功概率。不能由旧工时换算星级。可另给所需协作人数（unit:"人"）。min/max 为正数，max>=min。给区间、成立假设、估算分解依据、主要变化因素。条件不全时主动选取并写出保守且合理的资源情景，仍给出数值预估，不用待估或待确认代替；如果两种条件影响很大，可给两个有独立假设的周期情景。不要照抄其他课题的数字。
规划预估与文献报告的事实严格分开。不能编造文献结果、效应量、实际样本、招募能力、费用或已做过的统计计算。需要样本量/预算时缺少参数，应明确假设并作情景推算，不能声称完成正式功效分析。周期不含不可知的审稿等待。创新程度用增量、竞争解释和依据表述，不制造无依据百分比。
focus.question 用一句话说明本题的研究切口，nextChecks 列出最先核查的 1–3 个条件；仅当内容自然存在两个需要联合考察的维度时，另给 axes:[{label,description},{label,description}] 与 relation，标签各 2–8 字，关系只表达拟议比较或观察，不画成已证实因果。缺少这种结构时省略 axes。
template 只选 comparison（图表比较）、reading（文字比较）、accordion（原位逐题预览）、brief（价值与个人条件）、landscape（领域问题分布）、timeline（周期与资源取舍）；reason 说明内容为何适合此版式。可按每题选不同模板，不能返回 HTML/CSS、可执行内容或自行省略四项判断。渲染器负责数据图；模型只提供结构化内容。图表版在右栏只展示一次月份区间，左栏给研究判断与难度；文字版将月份放入比较表、右栏解释切口与障碍。`;
