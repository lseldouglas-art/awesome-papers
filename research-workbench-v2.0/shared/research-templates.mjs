import {researchPath} from './research-path.mjs';
export const templateModes=['template-recommend','template-study','template-optimize','template-refine'];
export const articleTypes={review:'综述',original:'原创研究',protocol:'研究方案',systematic:'系统综述 / Meta分析'};
export function templateSelection(project,artifact) {
  const library=project.templateLibrary;
  for(const a of researchPath(project,artifact).reverse()) {
    const selection=library?.selections?.[a.id];
    if(selection)return {...selection,artifactId:a.id,inherited:a.id!==artifact.id,paper:library.papers[selection.paperId]??null};
  }
  return {paper:null,inherited:false};
}
export const latestTemplateRecommendation=(project,artifactId)=>project.templateLibrary?.recommendations?.findLast(r=>r.artifactId===artifactId);
export const templateStudy=(project,paper)=>paper&&project.templateLibrary?.studies?.findLast(s=>s.paperId===paper.id&&s.textVersion===(paper.textVersion??1));

export const hasFulltext=paper=>Boolean(paper?.level==='fulltext'&&paper.document?.identityMatched&&paper.document.complete&&paper.document.readable&&paper.document.pages?.length===paper.document.pageCount);
export const completeTemplateStudy=(project,paper,artifact)=>paper&&project.templateLibrary?.studies?.findLast(s=>s.paperId===paper.id&&s.textVersion===paper.textVersion&&s.documentHash===paper.document?.sha256&&(!artifact||s.artifactId===artifact.id)&&s.status==='completed'&&s.coveredPages?.length===paper.document.pageCount);
export const templateReady=(project,paper,artifact)=>Boolean(hasFulltext(paper)&&completeTemplateStudy(project,paper,artifact));
