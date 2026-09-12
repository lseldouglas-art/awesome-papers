import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {SaxesParser} from 'saxes';
import {requireThat} from './errors.mjs';
const MAX=25*1024*1024;
const normalized=v=>String(v??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function pdfIdentity(paper,text){
  const value=normalized(text),doi=normalized(String(paper.doi??'').replace(/^https?:\/\/(dx\.)?doi.org\//,''));
  return Boolean(doi&&value.includes(doi)||normalized(paper.title).length>25&&value.includes(normalized(paper.title)));
}
export async function parseTemplatePdf(bytes,paper){
  requireThat(bytes.length<=MAX&&bytes.subarray(0,5).toString()==='%PDF-','invalid_pdf','请选择有效 PDF 文件（不超过 25 MB）。');
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  let doc,loading;try{loading=getDocument({data:new Uint8Array(bytes),useSystemFonts:true,isEvalSupported:false});doc=await loading.promise;}catch{requireThat(false,'invalid_pdf','PDF 无法读取或已加密，请提供可打开的原文。');}
  try{
    requireThat(doc.numPages<=250,'pdf_scope','本文超过 250 页，请将论文正文与附录分开导入。');
    const pages=[];
    for(let i=1;i<=doc.numPages;i++){const content=await (await doc.getPage(i)).getTextContent();pages.push({number:i,text:content.items.map(item=>item.str+(item.hasEOL?'\n':' ')).join('').trim()});}
    const text=pages.map(p=>p.text).join('\n\n');
    requireThat(text.length<=900000,'pdf_scope','本文文字量过大，请将正文与附录分开导入。');
    requireThat(pdfIdentity(paper,pages.slice(0,2).map(p=>p.text).join(' ')),'pdf_identity','PDF 首页的 DOI 或题名与所选模板不匹配，未替换现有原文。');
    const readable=pages.every(p=>p.text.replace(/\s/g,'').length>=40);
    return {text,document:{sha256:createHash('sha256').update(bytes).digest('hex'),pageCount:pages.length,pages,readable,identityMatched:true,bytes:bytes.length,acquiredAt:new Date().toISOString(),visualReview:'pending'}};
  }finally{await loading.destroy();}
}
// No arbitrary URL proxy: remote acquisition is restricted to the official Europe PMC service.
async function boundedFetch(fetcher,url,kind){
  const response=await fetcher(url,{signal:AbortSignal.timeout(45000),redirect:'error',headers:{Accept:kind==='pdf'?'application/pdf':'application/xml, application/json'}});
  requireThat(response.ok,'fulltext_unavailable','开放全文暂不可用，可从 Zotero 打开后导入 PDF。',502);
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;requireThat(size<=MAX,'pdf_scope','原文超过 25 MB，请手动导入正文 PDF。');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks);
}
export function jatsIdentity(xml){
  let idType='',inId=false;const ids={};const parser=new SaxesParser();
  parser.on('opentag',n=>{if(n.name==='article-id'){inId=true;idType=n.attributes['pub-id-type'];ids[idType]='';}});
  parser.on('text',t=>{if(inId)ids[idType]+=t;});parser.on('closetag',n=>{if(n.name==='article-id')inId=false;});parser.write(xml).close();return ids;
}
export function createFulltextService(directory,{fetcher=fetch}={}){
  const root=join(directory,'fulltexts');
  return {
    async acquire(paper,body){
      let bytes,origin;
      if(body.base64){requireThat(typeof body.base64==='string'&&/^[A-Za-z0-9+/=\r\n]+$/.test(body.base64),'invalid_pdf','PDF 数据无法读取。');bytes=Buffer.from(body.base64,'base64');origin={kind:'local_pdf',filename:String(body.filename??'原文.pdf').slice(0,250)};}
      else{
        const query=/^\d+$/.test(String(paper.pmid??''))?`EXT_ID:${paper.pmid} AND SRC:MED`:paper.doi?`DOI:"${String(paper.doi).replace(/["\\]/g,'')}"`:null;
        requireThat(query,'fulltext_identifier','这篇模板缺少 PMID 或 DOI，请导入 PDF。');
        const search=JSON.parse((await boundedFetch(fetcher,`https://www.ebi.ac.uk/europepmc/webservices/rest/search?${new URLSearchParams({query,format:'json',pageSize:'1'})}`,'json')).toString());
        const record=search.resultList?.result?.[0],pmcid=record?.pmcid;
        requireThat(/^PMC\d+$/.test(pmcid??''),'fulltext_unavailable','未找到开放全文；可从出版商或 Zotero 获取后导入 PDF。',409);
        const xml=(await boundedFetch(fetcher,`https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML`,'xml')).toString(),ids=jatsIdentity(xml);
        requireThat(paper.pmid&&String(ids.pmid)===String(paper.pmid)||paper.doi&&normalized(ids.doi)===normalized(paper.doi),'pdf_identity','全文标识与模板不符，未导入。');
        const url=`https://europepmc.org/api/getPdf?pmcid=${pmcid}`;
        bytes=await boundedFetch(fetcher,url,'pdf');origin={kind:'europe_pmc',pmcid,url,xmlUrl:`https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML`};
      }
      const result=await parseTemplatePdf(bytes,paper);
      requireThat(origin.kind!=='europe_pmc'||result.text.length>3000,'pdf_scope','开放服务返回的文件可能不含完整正文，请手动核对并导入。');
      await mkdir(root,{recursive:true});await writeFile(join(root,`${result.document.sha256}.pdf`),bytes,{flag:'w',mode:0o600});
      return {...result,document:{...result.document,complete:origin.kind==='europe_pmc',origin}};
    },
    async read(sha){requireThat(/^[a-f0-9]{64}$/.test(sha??''),'invalid_scope','没有这份 PDF。',404);return readFile(join(root,`${sha}.pdf`));}
  };
}
export function installFulltext(paper,result){
  paper.textHistory??=[];paper.textHistory.push({text:paper.text,level:paper.level,textVersion:paper.textVersion??1,document:paper.document??null,at:new Date().toISOString()});
  Object.assign(paper,{text:result.text,level:'fulltext',textVersion:(paper.textVersion??1)+1,document:result.document,location:`PDF · ${result.document.pageCount} 页`,providedBy:result.document.origin.kind});
}
