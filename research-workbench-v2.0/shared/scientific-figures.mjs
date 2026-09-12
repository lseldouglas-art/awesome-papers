export function figureFromInput(input,{preview=false}={}){
  if(preview)input={...input,title:input.title?.trim()||({bar:"柱状图",line:"折线图",flow:"研究流程图"})[input.type],caption:input.caption?.trim()||"预览草稿 · 出版信息待核对",source:input.source?.trim()||"来源待补充",xLabel:input.xLabel?.trim()||"分组",yLabel:input.yLabel?.trim()||"数值（单位待补充）"};
  const type=input.type;
  if(!['bar','line','flow'].includes(type))throw new Error('请选择柱状图、折线图或研究流程图。');
  for(const key of ['title','caption','source'])if(typeof input[key]!=='string'||!input[key].trim())throw new Error('请填写图题、图注和数据或方案来源。');
  if(type==='flow'){
    const steps=String(input.content??'').split('\n').map(s=>s.trim()).filter(Boolean);
    if(steps.length<2||steps.length>30||steps.some(s=>s.length>180))throw new Error('流程图需要 2–30 个步骤，每步不超过 180 字。');
    return {type,title:input.title,caption:input.caption,source:input.source,steps};
  }
  if(!input.xLabel?.trim()||!input.yLabel?.trim())throw new Error('请注明横轴、纵轴及相应单位。');
  const lines=String(input.content??'').trim().split(/\r?\n/);
  if(lines[0]?.trim()!=='label,value')throw new Error('数据首行应为 label,value，每行填写标签与数值。');
  const points=lines.slice(1).filter(l=>l.trim()).map(l=>{const match=/^(?:"((?:[^"]|"")*)"|([^,]+)),\s*([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*$/i.exec(l);if(!match)throw new Error('数据需为两列：标签、数值；含逗号的标签请用双引号包围。');return {label:(match[1]?.replace(/""/g,'"')??match[2]).trim(),value:Number(match[3])};});
  if(points.length<1||points.length>500||points.some(p=>!p.label||!Number.isFinite(p.value)))throw new Error('请提供 1–500 行有效数据。');
  return {type,title:input.title,caption:input.caption,source:input.source,xLabel:input.xLabel,yLabel:input.yLabel,points};
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const wrap=(value,limit)=>{
  const lines=[];let line='',units=0;
  for(const c of String(value)){const size=/[\u0020-\u007e]/.test(c)?0.6:1;if(c==='\n'||units+size>limit){lines.push(line);line='';units=0;if(c==='\n')continue;}line+=c;units+=size;}if(line)lines.push(line);return lines;
};
const textLines=(lines,x,y,size,anchor='start',fill='#23372e')=>`<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" fill="${fill}">${lines.map((line,i)=>`<tspan x="${x}" dy="${i?size*1.5:0}">${esc(line)}</tspan>`).join('')}</text>`;
export function figureSvg(f){
  const width=1000,title=wrap(f.title,35),caption=wrap(f.caption,66),source=wrap(f.source,72),top=74+(title.length-1)*36;
  let marks='',contentBottom;
  if(f.type==='flow'){
    let y=top;
    marks=f.steps.map((s,i)=>{const lines=wrap(s,36),boxHeight=Math.max(80,36+lines.length*26),part=`<rect x="150" y="${y}" width="700" height="${boxHeight}" rx="4" fill="#f0f4ed" stroke="#315f50"/>${textLines(lines,500,y+30,17,'middle')}${i<f.steps.length-1?`<path d="M500 ${y+boxHeight}v32m-7-9 7 9 7-9" fill="none" stroke="#315f50" stroke-width="2"/>`:''}`;y+=boxHeight+35;return part;}).join('');contentBottom=y;
  }else{
    const values=f.points.map(p=>p.value),max=Math.max(0,...values),min=Math.min(0,...values),span=max-min||1,chartBottom=top+496,y=v=>chartBottom-(v-min)/span*410,step=800/f.points.length,zero=y(0);
    marks=`<path d="M100 ${top+66}V${chartBottom}H900" fill="none" stroke="#333"/>`+Array.from({length:6},(_,i)=>{const v=min+span*i/5,py=y(v);return `<path d="M100 ${py}H900" stroke="#e4e7e0"/><text x="88" y="${py+5}" text-anchor="end" font-size="13">${Number(v.toPrecision(4))}</text>`;}).join('');
    const coords=f.points.map((p,i)=>({x:100+step*(i+.5),y:y(p.value),...p})),interval=Math.max(1,Math.ceil(coords.length/12));let labelRows=1;
    if(f.type==='line')marks+=`<polyline points="${coords.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="#315f50" stroke-width="3"/>`;
    marks+=coords.map((p,i)=>{const lines=wrap(p.label,Math.max(4,Math.min(20,step*interval/14)));if(i%interval===0)labelRows=Math.max(labelRows,lines.length);return (f.type==='bar'?`<rect x="${p.x-step*.3}" y="${Math.min(zero,p.y)}" width="${step*.6}" height="${Math.abs(p.y-zero)}" fill="#397c83"/>`:`<circle cx="${p.x}" cy="${p.y}" r="5" fill="#315f50"/>`)+(i%interval===0?textLines(lines,p.x,chartBottom+25,13,'middle'):'');}).join('');
    const xLines=wrap(f.xLabel,45),xY=chartBottom+45+labelRows*20;
    marks+=textLines(xLines,500,xY,16,'middle')+`<text x="28" y="${top+281}" text-anchor="middle" font-size="16" transform="rotate(-90 28 ${top+281})">${esc(f.yLabel)}</text>`;
    contentBottom=xY+xLines.length*24+20;
  }
  const captionY=contentBottom+12,sourceY=captionY+caption.length*20+15,height=sourceY+source.length*18+24;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(f.title)}"><rect width="100%" height="100%" fill="white"/><g font-family="Arial, sans-serif" fill="#23372e">${textLines(title,500,48,24,'middle')}${marks}${textLines(caption,50,captionY,13)}${textLines(source,50,sourceY,12,'start','#5b6b60')}</g></svg>`;
}
