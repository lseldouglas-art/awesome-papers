// Only direct, whole-message commands can mutate a protocol. Unrecognized or
// tentative language stays a discussion; source text is never passed here.
const fields = { '主要结局': 'primaryOutcome', '主要终点': 'primaryOutcome', '核心比较': 'primaryOutcome',
  '研究问题': 'question', '本轮目标': 'objective', '研究方法': 'design', '研究路线': 'design',
  '次要结局': 'secondaryOutcomes', '分析单位': 'analysisUnit', '分析方法': 'analysisPlan',
  '数据需求': 'dataRequirements', '纳排标准': 'criteria', '下一步': 'next' };
export function protocolIntent(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text.length > 10000) return null;
  if (/[?？]|是否|可能|要不要|应该|假如|如果|不要|别|暂不|不采用/.test(text)) return null;
  if (/^(?:请)?(?:采用|使用)(?:这|当前)(?:一)?版方案[。！!]?$/u.test(text)) return { type: 'adopt' };
  const match = text.match(/^(?:请)?(?:把|将)?(.+?)(?:修改为|改为|改成|设为)\s*(.+?)(?:(?:[，,；;]\s*(?:并)?|\s*并)(采用(?:这(?:一)?版|该版)?(?:方案)?))?[。！!]?$/u);
  if (!match || !Object.hasOwn(fields, match[1].trim())) return null;
  const value = match[2].trim().replace(/^[“「"](.+)[”」"]$/u, '$1');
  if (!value || /[\n；;]|采用|采纳|删除|修改|改为|改成|设为/.test(value)) return null;
  return { type: 'patch', field: fields[match[1].trim()], value, adopt: Boolean(match[3]) };
}
