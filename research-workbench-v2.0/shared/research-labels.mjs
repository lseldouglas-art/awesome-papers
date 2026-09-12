// Product headings are distinct from stored scientific claims and source text.
export const TOPIC_AXES = [{id:'evidence',label:'现有证据与研究进展'}, {id:'gap',label:'研究缺口与竞争解释'}, {id:'design',label:'研究设计与证据增量'}];
const legacyHeadings = {
  'topic-evidence-heading':['已有研究究竟做到哪里',TOPIC_AXES[0].label],
  'topic-gap-heading':['关键缺口是否成立',TOPIC_AXES[1].label],
  'topic-design-heading':['什么设计才能增加有效证据',TOPIC_AXES[2].label],
  'research-next-heading':['建议的下一步','后续研究方向'],
};
export function researchHeading(block) {
  const replacement=legacyHeadings[block.id];
  return replacement&&block.type==='heading'&&block.text===replacement[0]?replacement[1]:block.text;
}
