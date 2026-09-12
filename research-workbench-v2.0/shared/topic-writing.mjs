export const WRITING_VERSION = 'section-writing-v1';
export const auditLabels = { consistent:'依据一致', deeper:'待更深证据确认', supplement:'建议补充', correct:'需要更正', researcher:'请研究者判断' };
export const writingSections = outline => outline.sections.flatMap((chapter,i)=>chapter.children.map((section,j)=>({...section,chapter:chapter.heading,number:`${i+1}.${j+1}`})));
export const sectionAccessIds = section => [...new Set(section.evidence.map(e=>e.accessId))];
export const currentSectionVersion = section => section?.versions?.find(v=>v.id===section.activeVersionId);
export function manuscriptSnapshot(outline,workspace){
  const sectionVersions={},chapters=outline.sections.map((chapter,i)=>({number:String(i+1),heading:chapter.heading,sections:chapter.children.map((section,j)=>{
    const version=currentSectionVersion(workspace?.sections?.[section.id]);sectionVersions[section.id]=version?.id??null;
    return {id:section.id,number:`${i+1}.${j+1}`,heading:section.heading,complete:Boolean(version?.status==='completed'&&version.paragraphs.length),paragraphs:(version?.paragraphs??[]).map(p=>p.text)};
  })}));
  const sections=chapters.flatMap(c=>c.sections);
  const abstract=workspace?.abstract&&JSON.stringify(workspace.abstract.sectionVersions)===JSON.stringify(sectionVersions)?workspace.abstract:null;
  return {title:outline.title,outlineId:outline.id,abstract,sectionVersions,chapters,complete:sections.length>0&&sections.every(s=>s.complete),completedSections:sections.filter(s=>s.complete).length,totalSections:sections.length};
}
export function manuscriptMarkdown(manuscript){
  return [`# ${manuscript.title}`,...(manuscript.abstract?['## 摘要',manuscript.abstract.text,`关键词：${manuscript.abstract.keywords.join('；')}`]:[]),...manuscript.chapters.filter(c=>c.sections.some(s=>s.paragraphs.length)).flatMap(c=>[`## ${c.number} ${c.heading}`,...c.sections.filter(s=>s.paragraphs.length).flatMap(s=>[`### ${s.number} ${s.heading}`,...s.paragraphs])])].join('\n\n')+'\n';
}
export const writingMarkdown=(outline,workspace)=>manuscriptMarkdown(manuscriptSnapshot(outline,workspace));
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function manuscriptHtml(manuscript){
  return `<!doctype html><html lang="zh"><meta charset="utf-8"><title>${escapeHtml(manuscript.title)}</title><style>@page{size:A4;margin:25mm}body{max-width:760px;margin:48px auto;padding:0 24px;color:#111;background:white;font-family:"Songti SC","SimSun","Times New Roman",serif;font-size:12pt;line-height:1.8}h1{font-size:20pt;text-align:center;line-height:1.5;margin-bottom:30px}h2{font-size:16pt;margin-top:28px}h3{font-size:13pt;margin-top:22px}h1,h2,h3{break-after:avoid}p{margin:0 0 12pt;orphans:3;widows:3;white-space:pre-wrap;overflow-wrap:break-word}@media print{body{max-width:none;margin:0;padding:0}}</style><body><article><h1>${escapeHtml(manuscript.title)}</h1>${manuscript.abstract?`<h2>摘要</h2><p>${escapeHtml(manuscript.abstract.text)}</p><p>关键词：${manuscript.abstract.keywords.map(escapeHtml).join('；')}</p>`:''}${manuscript.chapters.filter(c=>c.sections.some(s=>s.paragraphs.length)).map(c=>`<h2>${c.number} ${escapeHtml(c.heading)}</h2>${c.sections.filter(s=>s.paragraphs.length).map(s=>`<h3>${s.number} ${escapeHtml(s.heading)}</h3>${s.paragraphs.map(p=>`<p>${escapeHtml(p)}</p>`).join('')}`).join('')}`).join('')}</article></body></html>`;
}
