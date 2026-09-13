// Research intent and real constraints, aligned with M03 §10. Unknown is not absent.
export const intakeQuestions = [
 {id:'startingPoint', label:'领域基础', title:'你与这个领域，走到哪一步了？', why:'这决定先补基础认识，还是直接核对具体问题。', options:['刚接触，需要从基础了解','了解主要概念，想寻找问题','已有具体问题，需要核对证据','先有一种方法，还没确定科学问题']},
 {id:'intent', label:'近期目标', title:'这一轮结束时，你最想弄清什么？', why:'先确定这一次的成果，再决定后面的研究路径。', options:['理解领域现状与主要问题','比较方向，找到值得研究的问题','推进已有课题或方案','为论文或其他成果做准备']},
 {id:'background', label:'研究背景', title:'你平时做什么研究或工作？', why:'已有专业经验可以成为起点，不把领域新手等同于科研新手。', options:['在读学生','临床工作者','科研工作者','跨领域学习者']},
 {id:'abilities', label:'能力与协作', title:'哪些可以自己做，哪些需要学习或协作？', why:'把现有能力、可学习的能力和必须依赖的支持分开，后续计划才可执行。', fields:[['mastered','已经掌握'],['learnable','可以学习'],['collaboration','需要协作'],['unavailable','目前无法开展']], placeholder:'如文献阅读、统计分析、实验、编程、分子对接…'},
 {id:'resources', label:'可用资源', title:'开展研究时，你能用到哪些资源？', why:'资源未知不会被当成没有，也不会假设你已经拥有。', resources:['文献数据库与全文','数据或病例资料','样本与实验设备','计算资源与软件','统计支持','临床或实验协作']},
 {id:'schedule', label:'时间与成果要求', title:'时间上有什么要求？', why:'区分固定截止日期和可调整的预期；暂时没有期限也可以。', options:['没有固定期限，先理解清楚','有期望时间，可以调整','有必须遵守的截止日期'], placeholder:'可补充截止日期、每周投入时间；若已确定成果形式或目标期刊，也写在这里。'},
 {id:'boundaries', label:'约束与资料边界', title:'还有哪些条件会改变你的选择？', why:'提前保留不能改变的条件，以及数据使用边界。这里只需说明情况，不填写敏感资料。', fields:[['hard','必须遵守的条件'],['flexible','可以调整的条件']], privacy:true, placeholder:'如预算、必须使用的方法、合作要求；未确定可留空。'}
];
export const RESOURCE_STATES = ['未知','可以使用','需要协作','目前不可用'];
export function initialIntake(goal) {
 const answers = {};
 if (/不了解|刚接触|零基础|从零/.test(goal)) answers.startingPoint = {choice:intakeQuestions[0].options[0],note:'来自原始想法，请在确认画像时核对。'};
 if (/领域现状|了解.*领域|理解.*领域/.test(goal)) answers.intent = {choice:intakeQuestions[1].options[0],note:'来自原始想法，请在确认画像时核对。'};
 return {version:1, status:'draft', answers, history:[], confirmedAt:null};
}
export function intakeAnswerText(answer) {
 if (!answer) return '未知';
 return [answer.choice, answer.note, ...Object.entries(answer.values ?? {}).map(([k,v]) => `${k}：${v || '未知'}`), answer.privacy && `资料边界：${answer.privacy}`].filter(Boolean).join('；') || '未知';
}
export function researcherPlan(answers = {}) {
 const starter=answers.startingPoint?.choice, intent=answers.intent?.choice;
 const novice=starter===intakeQuestions[0].options[0], methodFirst=starter===intakeQuestions[0].options[3];
 const steps = [
  {title:methodFirst?'先说清方法要回答的问题':novice?'建立领域基础与问题地图':'梳理已有认识与待核对问题', text:methodFirst?'从关注的现象、对象和预期发现出发，确认这项方法能提供什么证据。':novice?'先解释核心概念、主要分支与它们的联系，再阅读代表性综述。':'把已有问题、材料和未确定之处分开，避免重复整理已明确的内容。'},
  {title:'确认检索范围，整理文献证据', text:'以实际题名和摘要理解主要发现、分歧、成熟度与未知；需要精确核验时再补关键全文。'},
  {title:intent===intakeQuestions[1].options[0]?'阅读领域简报，再决定深入方向':intent===intakeQuestions[1].options[1]?'比较候选问题与实施条件':'将证据与现有目标对照',text:intent===intakeQuestions[1].options[0]?'先得到能解释领域现状的认识，由你决定是否进入选题分析。':'结合你确认的能力、资源与约束，核对价值、证据基础和可实施性，再调整后续计划。'}
 ];
 const constraints=[];
 const missing=Object.entries(answers.resources?.values??{}).filter(([,v])=>['未知','需要协作','目前不可用'].includes(v));
 if(missing.length) constraints.push(`涉及这些资源的研究先核对条件：${missing.map(([k,v])=>`${k}（${v}）`).join('、')}。`);
 if(answers.schedule?.choice===intakeQuestions[5].options[2]) constraints.push(`先按固定期限缩小本轮范围，再安排后续研究。${answers.schedule.note || '具体截止时间尚待明确。'}`);
 else if(answers.schedule?.note)constraints.push(`安排工作时参考：${answers.schedule.note}`);
 if(answers.boundaries?.values?.['必须遵守的条件'])constraints.push(`必须遵守：${answers.boundaries.values['必须遵守的条件']}`);
 if(answers.abilities?.values?.['需要协作'])constraints.push(`相关工作先落实协作：${answers.abilities.values['需要协作']}`);
 if(answers.abilities?.values?.['目前无法开展'])constraints.push(`暂不安排需要这些能力的执行任务：${answers.abilities.values['目前无法开展']}`);
 if(answers.boundaries?.privacy==='涉及受限或敏感资料')constraints.push('先明确可使用的数据范围；本轮从公开文献开始。');
 return {title:'本轮起步计划',steps,constraints,scope:'这是起步安排，后续研究方案仍由你根据证据决定。'};
}
