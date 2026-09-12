// M03 §11 and execution matrix A14/A16, interpreted under foundational logic v1.0.
// A schema verifies completeness and provenance, never scientific validity.
export const LANDSCAPE_FRAMEWORK = 'domain-landscape-v1';
export const DOMAIN_DIMENSIONS = [
  { id: 'history', label: '领域历史', question: '梳理核心问题的发展过程。依据材料指出时间、转折及研究问题变化；只有近年文献时不能推演完整历史。' },
  { id: 'branches', label: '主要分支与发现', question: '区分主要对象、问题和分支；解释各分支已有发现与彼此关系，不只列名词或药物名称。' },
  { id: 'hotspots', label: '当前热点', question: '识别本次材料集中讨论的问题及其科学意义。区分关注度、科学价值和用户相关性；不能以排序样本频次断言全领域热度。' },
  { id: 'disagreements', label: '关键争议', question: '并列支持、反对或不一致结果，比较对象、方法与结局是否可比；区分真正冲突、异质性与尚无直接比较。' },
  { id: 'methods', label: '技术与方法演进', question: '分析方法与工具对研究问题可解性的影响。说明方法概述、解决的限制、遗留瓶颈与适用条件，不补造摘要未报告的方法细节。' },
  { id: 'gaps', label: '证据空缺与未知', question: '分别识别本次材料未覆盖、摘要未报告、作者指出的限制及候选研究问题；说明验证缺口需要什么证据，不能直接宣布无人研究。' },
  { id: 'maturity', label: '研究成熟度', question: '按分支讨论描述/关联、机制、验证与应用证据所处状态，以及重复验证、外部适用性和转化瓶颈；不以文献数量、模型分数或热度裁决成熟度。' },
];
export const LANDSCAPE_SECTIONS = [{ id: 'overview', label: '领域概览' }, ...DOMAIN_DIMENSIONS, { id: 'next', label: '后续研究方向' }];
export const PAPER_FIELDS = { subject: '研究对象与问题', methods: '方法概述', findings: '主要发现', relevance: '与当前课题的关系', unreported: '摘要未报告与局限' };
export const COVERAGE_LABELS = { supported: '本次材料有依据', partial: '仅有局部依据', insufficient: '本次材料不足' };
export const INFORMATION_LABELS = { reported: '材料报告', inference: '综合推论', unknown: '尚未确认', suggestion: '研究建议' };

export function materialCoverage(materials) {
  const years = materials.map(m => m.year).filter(y => typeof y === 'string' && /^\d{4}$/.test(y)).sort();
  const levels = {};
  for (const m of materials) levels[m.level || 'unknown'] = (levels[m.level || 'unknown'] || 0) + 1;
  return { selectedCount: materials.length, pubmedCount: materials.filter(m => m.pmid).length,
    minYear: years[0] ?? null, maxYear: years.at(-1) ?? null, unknownYearCount: materials.length - years.length, levels };
}

export function landscapeInstructions() {
  return `领域分析框架版本 ${LANDSCAPE_FRAMEWORK}。返回 {framework:"${LANDSCAPE_FRAMEWORK}",papers:[{ref,fields:{${Object.keys(PAPER_FIELDS).map(k => `${k}:{text,status,passages:[]}`).join(',')}}}],sections:[{id,items:[...],coverage,limitation,comparison}]}。
sections 按顺序包含 ${LANDSCAPE_SECTIONS.map(d => d.id).join(',')}。overview 说明核心概念、主要问题和本轮来源边界；检索式、时间、命中数只按上下文 searchScope 的真实记录说明，searchScope 为空说明这是已有材料分析、检索过程尚未提供，不得编造检索范围或时间，next 解释可供用户选择的下一步；这两节只需 id、items。
其余七节必须包括 coverage（supported/partial/insufficient，针对本次材料，不是全局可信度）、limitation（具体未覆盖内容，不能空白）、comparison（一个与 items 相同格式的陈述，解释跨文献关系及对当前理解的意义）。
${DOMAIN_DIMENSIONS.map(d => `${d.id}「${d.label}」：${d.question}`).join('\n')}
表达规则：面向研究者使用准确的学术中文，采用“核心判断—研究证据—解释与适用范围”的论证顺序。每个 item/comparison 添加 headline，概括一个明确论点，正文围绕这个论点展开；headline 不得比正文证据更强。overview 首先给出对该领域的核心认识，重要性顺序优先于逐篇罗列。避免口语化建议、重复免责声明与文献编号串联；必要术语首次解释。history 明确问题与方法如何演变，只使用来源支持的历史线索，不以论文年份猜测学科转折。gaps 将缺口表述为可检验的问题，并说明核查路径。不得为了措辞显得高级而扩大因果、创新性或发表保证。
硬格式规则：任何 items 或 comparison 的 citations 为空数组时，status 只允许 unknown 或 suggestion，绝对不能标 reported/inference。概览也遵守此规则。不要把来源范围说明、分析方法提醒、免责声明放进 items；来源数量与检索过程由界面展示，方法与覆盖提醒写入对应维度的 limitation 字段。
比较的深度来自解释适用条件，不来自扩大结论。不同药物、不同人群或不同结局的研究不能证明获益随疾病阶段递减等因果规律；只能提出待验证的解释。宣称指南采用、证据链完整、人体验证缺失或学界共识必须有对应材料明确报告，不能由主题相近推演。摘要未报告的内容不能写成未实施或不存在。
先完整阅读全部材料并逐篇提取，再综合。每个 fields 字段包含 text、status、passages 数组（本篇的 P 编号）；研究对象、方法与发现来自原文，相关性可以是 inference，未报告项明确 unknown。全部 ${Object.keys(PAPER_FIELDS).length} 项都要填，未知也不得省略。每个 ref 恰好一次；不复写题名作者年份，不复制长原文。不同字段用各自支持片段，不能用无关片段给未知内容背书。
综合维度要对主要子问题展开论证，按证据实际需要组织段落，不限制为一两条短摘要，也不为凑条数重复内容。区分材料直接报告（reported）和基于材料的比较解释（inference）；比较应引用实际参与比较的不同论文，只有一篇时明确无法作跨文献比较。不要把题材无关的研究强行对比。保留反例、适用人群与方法差别。综述可能纳入相同研究，不能将每篇都视为独立证据。
材料不足的维度仍要展示：coverage=insufficient，items/comparison 用 unknown 或 suggestion 解释不能回答什么、如何补查；不得用想象填满。有局部依据用 partial，给出已有认识及缺失部分。热点与成熟度是有边界的解释，不等于已经证实的趋势或科学通过。下一步只建议补查或深入方向，不自动选题、改变目标、执行检索或以阅读全文作为整体认识的前提。`;
}
