// A small, uncompressed UTF-8 ZIP writer. Files stay byte-for-byte unchanged.
const encoder=new TextEncoder();
export function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
export function exportZip(files) {
  const parts=[],central=[];let offset=0;
  for(const file of files){
    const name=encoder.encode(file.name.replace(/[\\/]/g,'-')),data=typeof file.content==='string'?encoder.encode(file.content):file.content;
    if(!(data instanceof Uint8Array)||name.length>65535||data.length>0xffffffff)throw Error('无法打包这份文件。');
    const crc=crc32(data),local=new Uint8Array(30),v=new DataView(local.buffer);
    v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);
    const header=new Uint8Array(46),h=new DataView(header.buffer);
    h.setUint32(0,0x02014b50,true);h.setUint16(4,20,true);h.setUint16(6,20,true);h.setUint16(8,0x800,true);h.setUint32(16,crc,true);h.setUint32(20,data.length,true);h.setUint32(24,data.length,true);h.setUint16(28,name.length,true);h.setUint32(42,offset,true);
    parts.push(local,name,data);central.push(header,name);offset+=local.length+name.length+data.length;
  }
  const size=central.reduce((n,p)=>n+p.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
  const output=new Uint8Array(offset+size+22);let cursor=0;for(const part of [...parts,...central,end]){output.set(part,cursor);cursor+=part.length;}return output;
}
