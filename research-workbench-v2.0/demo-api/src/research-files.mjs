import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {requireThat} from './errors.mjs';
export const RESEARCH_FILE_LIMIT=24*1024*1024;
const types={'.txt':'text/plain','.md':'text/plain','.csv':'text/csv','.json':'application/json','.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg'};
export function createResearchFiles(directory) {
  const root=join(directory,'research-attachments');
  return {
    async save(body) {
      requireThat(typeof body.name==='string'&&body.name.length<=500&&Object.hasOwn(types,extname(body.name).toLowerCase()),'invalid_file','支持文本、Markdown、CSV、JSON、PDF、PNG和JPEG文件。');
      requireThat(typeof body.base64==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64)&&body.base64.length%4===0,'invalid_file','文件内容编码不完整。');
      const bytes=Buffer.from(body.base64,'base64');
      requireThat(bytes.length>0&&bytes.length<=RESEARCH_FILE_LIMIT,'invalid_file','单个附件应在24MB以内；更大的文件可先记录其外部位置。');
      const mime=types[extname(body.name).toLowerCase()];
      if(mime==='application/pdf')requireThat(bytes.subarray(0,5).toString()==='%PDF-','invalid_file','文件不是可识别的PDF。');
      if(mime==='image/png')requireThat(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'invalid_file','文件不是PNG。');
      if(mime==='image/jpeg')requireThat(bytes[0]===255&&bytes[1]===216&&bytes[2]===255,'invalid_file','文件不是JPEG。');
      if(mime.startsWith('text/')||mime==='application/json') {
        let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{requireThat(false,'invalid_file','请将文本文件保存为UTF-8后导入。');}
        if(mime==='application/json')try{JSON.parse(text);}catch{requireThat(false,'invalid_file','JSON文件无法解析。');}
      }
      const sha256=createHash('sha256').update(bytes).digest('hex');await mkdir(root,{recursive:true});
      try{await writeFile(join(root,sha256),bytes,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;const prior=await readFile(join(root,sha256));requireThat(createHash('sha256').update(prior).digest('hex')===sha256,'file_integrity','已有附件内容需要核对。',409);}
      return {name:body.name,sha256,size:bytes.length,mime,storedAt:new Date().toISOString(),access:'stored_not_read',inputRefs:[]};
    },
    async read(meta) {
      requireThat(/^[a-f0-9]{64}$/.test(meta?.sha256),'not_found','附件标识无效。',404);
      let bytes;try{bytes=await readFile(join(root,meta.sha256));}catch(e){if(e.code==='ENOENT')requireThat(false,'attachment_missing','原附件目前不可用，保存的来源与版本信息仍保留。',404);throw e;}
      requireThat(bytes.length===meta.size&&createHash('sha256').update(bytes).digest('hex')===meta.sha256,'file_integrity','附件内容与保存时的版本不一致。',409);return bytes;
    }
  };
}
