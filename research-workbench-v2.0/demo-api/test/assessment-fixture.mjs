import { analysisDimensions } from '../../shared/question-analysis.mjs';
export const assessmentFixture = () => ({
  analysis:analysisDimensions.map(d=>({key:d.key,judgment:`工程测试：${d.label}`,reasoning:`工程测试情景中的${d.label}，需要核对本题输入条件。`,checks:[`核对本题${d.label}条件`],basis:"planning",supporting:[],conflicting:[]})),
  version:2,difficulty:{level:2,rationale:'已有数据场景下使用单一分析方法',assumptions:['已有获准使用的数据和统计支持']},
  summary:'工程测试：先比较投入与潜在价值',feasibility:'假设已有获准使用的数据，可安排小规模分析',innovation:'核查已有研究之外的测量增量',value:'判断关联是否值得进一步验证',risks:['数据完整性会影响排期'],
  estimates:[{label:'研究至初稿',min:5,max:9,unit:'个月',assumptions:['已有数据与统计支持'],basis:'准备 1–2、分析 2–4、写作 2–3 个月相加',sensitivity:'重新采集数据时应重估'}],
  presentation:{template:'brief',reason:'先区分研究价值与个人条件'},
});
