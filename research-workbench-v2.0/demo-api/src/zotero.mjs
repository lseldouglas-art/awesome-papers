import { request } from 'node:http';
import {requireThat} from './errors.mjs';

// Fixed loopback endpoint, no environment proxy, no redirects, no arbitrary
// URLs or file system paths. Attachment text is read only through an exact,
// matched template item; this bridge never writes to Zotero.
function localGet(path) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname:'127.0.0.1', port:23119, path, method:'GET',
      headers:{ 'Zotero-API-Version':'3', 'User-Agent':'ResearchWorkbench/0.15', Accept:'application/json' } }, res => {
      res.setEncoding('utf8');
      let text='', bytes=0;
      res.on('data', chunk => { bytes+=Buffer.byteLength(chunk); if(bytes>2_000_000) req.destroy(new Error('response_too_large')); else text+=chunk; });
      res.on('error', reject);
      res.on('end', () => resolve({status:res.statusCode,headers:res.headers,text}));
    });
    const timeout=setTimeout(()=>req.destroy(new Error('timeout')),4000);
    req.on('close',()=>clearTimeout(timeout));req.on('error',reject);req.end();
  });
}
const normalizeDoi = value => String(value ?? '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').trim().toLowerCase();
const normalizeTitle = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function createZotero({ get = localGet } = {}) {
  return {
    async status() {
      try {
        const response=await get('/api/');
        return {connected:response.status===200,version:response.headers['x-zotero-version']??response.headers['zotero-version']??null,
          message:response.status===200?'已连接本机 Zotero':response.status===403?'请在 Zotero 设置 → 高级中允许本机应用通信':'Zotero 本地接口暂不可用'};
      } catch { return {connected:false,version:null,message:'请打开 Zotero，再重试连接'}; }
    },
    async attachments(source) {
      const matched=await this.match(source);if(!matched.connected||!matched.matches.length)return {...matched,attachments:[]};
      const attachments=[];
      for(const item of matched.matches) {
        let response;try{response=await get(`/api/users/0/items/${item.key}/children?format=json`);}catch{return {...matched,attachments,message:'Zotero 附件列表读取中断，可以重试。'};}
        if(response.status!==200)continue;
        let children;try{children=JSON.parse(response.text);}catch{continue;}
        if(!Array.isArray(children))continue;
        for(const c of children){const d=c?.data;if(!/^[A-Z0-9]{8}$/.test(c?.key??'')||d?.itemType!=='attachment'||d.parentItem!==item.key)continue;attachments.push({key:c.key,parentKey:item.key,title:d.title||'文献附件',contentType:d.contentType??'',href:`zotero://open-pdf/library/items/${c.key}`});}
      }
      return {...matched,attachments,message:attachments.length?`找到 ${attachments.length} 份模板附件，可在 Zotero 打开或读取已索引文字。`:'条目已找到，尚无可读取附件。可在 Zotero 添加 PDF，或粘贴已取得原文。'};
    },
    async readTemplate(source,key) {
      requireThat(/^[A-Z0-9]{8}$/.test(key??''),'invalid_scope','请选择模板的一个有效附件。');
      const result=await this.attachments(source),attachment=result.attachments.find(a=>a.key===key);
      requireThat(attachment,'invalid_scope',result.message||'附件不属于当前模板。',409);
      let response;try{response=await get(`/api/users/0/items/${key}/fulltext`);}catch{requireThat(false,'zotero_unavailable','Zotero 原文读取中断，请重试。',503);}
      requireThat(response.status===200,'zotero_unindexed','这份附件尚无可用索引文字。请在 Zotero 打开 PDF 或完成索引。',409);
      let data;try{data=JSON.parse(response.text);}catch{requireThat(false,'zotero_response','Zotero 返回的原文无法读取。',502);}
      requireThat(typeof data.content==='string'&&data.content.trim()&&data.content.length<=120000,'zotero_text_scope','附件文字为空或过长，请在 Zotero 阅读后选取目标段落。',409);
      const complete=Number(data.totalPages)>0&&Number(data.indexedPages)>=Number(data.totalPages)||Number(data.totalChars)>0&&Number(data.indexedChars)>=Number(data.totalChars);
      return {text:data.content,level:complete?'fulltext':'excerpt',location:`Zotero · ${attachment.title} · ${complete?'完整索引文字':'已索引文字，完整性未确认'}`,origin:{attachmentKey:key,parentKey:attachment.parentKey,indexedPages:data.indexedPages??null,totalPages:data.totalPages??null,indexedChars:data.indexedChars??null,totalChars:data.totalChars??null},attachment};
    },
    async match(source) {
      source={...source,pmid:/^\d+$/.test(String(source.pmid??''))?String(source.pmid):null};
      const status=await this.status();if(!status.connected)return {...status,matches:[]};
      const terms=[source.doi,source.pmid,source.title].filter(Boolean);
      for(const term of terms) {
        const params=new URLSearchParams({q:term,qmode:'everything',limit:'50',format:'json',include:'data'});
        let response;
        try {response=await get(`/api/users/0/items/top?${params}`);} catch {return {connected:false,matches:[],message:'本机 Zotero 查询中断，请重试'};}
        if(response.status!==200)return {...status,matches:[],message:'Zotero 查询失败，请重试'};
        let items;try{items=JSON.parse(response.text);}catch{return {...status,matches:[],message:'Zotero 返回格式无法读取'};}
        if(!Array.isArray(items))return {...status,matches:[],message:'Zotero 返回格式无法读取'};
        const matches=items.filter(item=>{
          if(!item||typeof item!=='object')return false;
          const d=item.data??{};if(['attachment','note','annotation'].includes(d.itemType)||!/^[A-Z0-9]{8}$/.test(item.key??''))return false;
          if(source.doi&&d.DOI&&normalizeDoi(source.doi)!==normalizeDoi(d.DOI))return false;
          const knownPmid=/(?:^|\n)PMID:\s*(\d+)\s*(?:$|\n)/i.exec(d.extra??'')?.[1];
          if(source.pmid&&knownPmid&&source.pmid!==knownPmid)return false;
          return (source.doi && normalizeDoi(d.DOI)===normalizeDoi(source.doi))
            || (source.pmid && new RegExp(`(?:^|\\n)PMID:\\s*${source.pmid}\\s*(?:$|\\n)`,'i').test(d.extra??''))
            || (source.title && normalizeTitle(d.title)===normalizeTitle(source.title));
        }).map(item=>({key:item.key,title:item.data.title,href:`zotero://select/library/items/${item.key}`,
          matchedBy:source.doi&&normalizeDoi(item.data.DOI)===normalizeDoi(source.doi)?'DOI':source.pmid&&new RegExp(`(?:^|\\n)PMID:\\s*${source.pmid}\\s*(?:$|\\n)`,'i').test(item.data.extra??'')?'PMID':'相同题名'}));
        if(matches.length)return {...status,matches,message:`本机个人库找到 ${matches.length} 条匹配`};
      }
      return {...status,matches:[],message:'本机个人库未找到匹配。可导出这篇 RIS，在 Zotero 导入；群组库暂未查询。'};
    }
  };
}
