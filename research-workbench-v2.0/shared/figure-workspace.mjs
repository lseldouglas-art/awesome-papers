// Shared scene contract. Native SVG provides the canvas and publication export.
export const FIGURE_SCHEMA=1;
export const edgeKinds={activation:'促进 / 指向',inhibition:'抑制',association:'关联',hypothesis:'推测 / 待验证'};
export const emptyScene=()=>({schemaVersion:FIGURE_SCHEMA,id:`drawing-${globalThis.crypto.randomUUID()}`,title:'未命名图稿',caption:'',sourceText:'',width:1200,height:800,nodes:[],edges:[]});
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const text=(v,max)=>typeof v==='string'&&v.length<=max;
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,90}$/.test(v);
const num=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
export function validateScene(raw,catalog){
 assert(raw?.schemaVersion===1&&id(raw.id),'图稿格式或编号不正确。');
 assert(text(raw.title,200)&&raw.title.trim()&&text(raw.caption,6000)&&text(raw.sourceText,24000),'请提供图题，图注或依据文字过长。');
 assert(num(raw.width,400,2400)&&num(raw.height,300,2000),'画布尺寸超出支持范围。');
 assert(Array.isArray(raw.nodes)&&raw.nodes.length<=80&&Array.isArray(raw.edges)&&raw.edges.length<=100,'单幅图支持最多 80 个元素和 100 条关系。');
 const ids=new Set(),known=new Set(catalog.assets.map(a=>a.id));
 const nodes=raw.nodes.map(n=>{
  assert(id(n.id)&&!ids.has(n.id),'元素编号重复或不正确。');ids.add(n.id);
  assert(['asset','text','box'].includes(n.type)&&text(n.label,400),'请选择素材、文字或区室。');
  assert(num(n.x,0,raw.width)&&num(n.y,0,raw.height)&&num(n.w,20,raw.width)&&num(n.h,20,raw.height)&&n.x+n.w<=raw.width+.1&&n.y+n.h<=raw.height+.1,'元素必须位于画布内。');
  assert(num(n.fontSize,10,80)&&/^#[0-9a-f]{6}$/i.test(n.color)&&/^#[0-9a-f]{6}$/i.test(n.fill),'字号或颜色不正确。');
  if(n.type==='asset')assert(known.has(n.assetId),'图稿引用了素材库中不存在的素材。');
  return {id:n.id,type:n.type,label:n.label,x:n.x,y:n.y,w:n.w,h:n.h,fontSize:n.fontSize,color:n.color,fill:n.fill,...(n.type==='asset'?{assetId:n.assetId}:{}),flip:Boolean(n.flip)};
 });
 const edges=raw.edges.map(e=>{
  assert(id(e.id)&&!ids.has(e.id),'关系编号重复。');ids.add(e.id);
  assert(nodes.some(n=>n.id===e.from)&&nodes.some(n=>n.id===e.to)&&e.from!==e.to&&Object.hasOwn(edgeKinds,e.kind),'关系需要连接两个不同元素。');
  assert(text(e.label,180)&&text(e.quote??'',2000)&&/^#[0-9a-f]{6}$/i.test(e.color),'关系文字、颜色或依据不正确。');
  return {id:e.id,from:e.from,to:e.to,kind:e.kind,label:e.label,quote:e.quote??'',color:e.color};
 });
 return {schemaVersion:1,id:raw.id,title:raw.title,caption:raw.caption,sourceText:raw.sourceText,width:raw.width,height:raw.height,nodes,edges};
}
export function connector(scene,e){
 const a=scene.nodes.find(n=>n.id===e.from),b=scene.nodes.find(n=>n.id===e.to);if(!a||!b)return null;
 const ax=a.x+a.w/2,ay=a.y+a.h/2,bx=b.x+b.w/2,by=b.y+b.h/2,dx=bx-ax,dy=by-ay;
 if(!dx&&!dy)return {x1:ax,y1:ay,x2:bx,y2:by};
 const f=n=>Math.min(Math.abs(n.w/2/(dx||.0001)),Math.abs(n.h/2/(dy||.0001)));
 return {x1:ax+dx*f(a),y1:ay+dy*f(a),x2:bx-dx*f(b),y2:by-dy*f(b)};
}
export function nodeLabelLines(label,limit=22){
 const lines=[];for(const line of label.split('\n')){let current='',size=0;for(const c of line){const weight=c.charCodeAt(0)>255?1:.55;if(size+weight>limit){lines.push(current);current='';size=0;}current+=c;size+=weight;}lines.push(current);}return lines;
}
export function figureCredits(scene,catalog){
 return [...new Set(scene.nodes.filter(n=>n.type==='asset').map(n=>n.assetId))].map(id=>{const a=catalog.assets.find(a=>a.id===id);return a.source.kind==='ai-generated'?`${a.name}: AI-generated with ${a.source.tool}, ${a.source.generatedAt}; ${a.review.note}`:`${a.englishName} by ${a.source.author}, via Bioicons (${a.source.url}), ${a.license.id} (${a.license.url}). 组合修改：在本图放置与缩放${scene.nodes.some(n=>n.assetId===id&&n.flip)?'，含水平翻转':''}；素材原文件未重绘。`;}).join('\n');
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function sceneSvg(raw,catalog,assetData,widthMm=180){
 const scene=validateScene(raw,catalog);assert(num(widthMm,50,400),'请选择有效的最终印刷宽度。');
 const marks=scene.edges.map(e=>{const p=connector(scene,e),dx=p.x2-p.x1,dy=p.y2-p.y1,angle=Math.atan2(dy,dx),back=10,side=5;
  const tip=e.kind==='inhibition'?`<path d="M${p.x2+Math.sin(angle)*7} ${p.y2-Math.cos(angle)*7}L${p.x2-Math.sin(angle)*7} ${p.y2+Math.cos(angle)*7}" stroke="${e.color}" stroke-width="2.5"/>`:e.kind==='association'?'':`<path d="M${p.x2} ${p.y2}L${p.x2-Math.cos(angle)*back+Math.sin(angle)*side} ${p.y2-Math.sin(angle)*back-Math.cos(angle)*side}L${p.x2-Math.cos(angle)*back-Math.sin(angle)*side} ${p.y2-Math.sin(angle)*back+Math.cos(angle)*side}Z" fill="${e.color}"/>`;
  return `<g><line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" stroke="${e.color}" stroke-width="2.3"${e.kind==='hypothesis'?' stroke-dasharray="7 5"':''}/>${tip}<text x="${(p.x1+p.x2)/2}" y="${(p.y1+p.y2)/2-10}" text-anchor="middle" font-size="18" fill="${e.color}">${esc(e.label)}</text></g>`;
 }).join('');
 const renderNode=n=>{
  let shape='';if(n.type==='asset'){const data=assetData[n.assetId];assert(typeof data==='string'&&/^data:image\/(png|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(data),'素材未完整加载，不能导出缺图文件。');shape=`<image x="0" y="0" width="${n.w}" height="${Math.max(20,n.h-nodeLabelLines(n.label,Math.max(3,n.w/n.fontSize-1)).length*n.fontSize*1.25-5)}" href="${data}" preserveAspectRatio="xMidYMid meet"${n.flip?` transform="translate(${n.w} 0) scale(-1 1)"`:''}/>`;}

  const lines=nodeLabelLines(n.label,Math.max(3,n.w/n.fontSize-1));const y=n.type==='asset'?n.h-lines.length*n.fontSize*1.25+n.fontSize:n.type==='box'?n.fontSize+14:n.fontSize;
  return `<g transform="translate(${n.x} ${n.y})">${shape}<text x="${n.w/2}" y="${y}" text-anchor="middle" font-size="${n.fontSize}" fill="${n.color}">${lines.map((l,i)=>`<tspan x="${n.w/2}" dy="${i?n.fontSize*1.25:0}">${esc(l)}</tspan>`).join('')}</text></g>`;
 };
 const background=scene.nodes.filter(n=>n.type==='box').map(n=>`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="12" fill="${n.fill}" stroke="${n.color}" stroke-width="1.5"/>`).join('');
 const nodes=scene.nodes.map(renderNode).join('');
 const credits=figureCredits(scene,catalog);return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${widthMm*scene.height/scene.width}mm" viewBox="0 0 ${scene.width} ${scene.height}"><title>${esc(scene.title)}</title><desc>${esc('待审阅图稿；导出不代表科学核查或期刊认可。\n'+scene.caption+'\n'+credits)}</desc><metadata>${esc(JSON.stringify({status:'draft',scene,catalogVersion:catalog.version,credits}))}</metadata><rect width="100%" height="100%" fill="white"/><g font-family="Arial, Helvetica, sans-serif">${background}${marks}${nodes}</g></svg>`;
}
export function arrangeScene(scene,layout='horizontal'){
 const movable=scene.nodes.filter(n=>n.type!=='box'),cols=layout==='vertical'?Math.max(1,Math.ceil(movable.length/6)):layout==='grid'?Math.ceil(Math.sqrt(movable.length)):Math.min(4,movable.length),rows=Math.ceil(movable.length/(cols||1));
 return {...scene,nodes:scene.nodes.map(n=>{const i=movable.indexOf(n);if(i<0)return n;const cw=(scene.width-100)/(cols||1),ch=(scene.height-100)/(rows||1);return {...n,x:50+i%cols*cw,y:50+Math.floor(i/cols)*ch,w:Math.min(n.w,cw-20),h:Math.min(n.h,ch-20)};})};
}
export function validateComposition(data,input,catalog){
 assert(data&&Array.isArray(data.nodes)&&data.nodes.length>0&&data.nodes.length<=20&&Array.isArray(data.edges)&&data.edges.length<=30,'模型需要返回最多 20 个元素与 30 条关系。');
 assert(text(data.explanation,2000)&&['horizontal','vertical','grid'].includes(data.layout),'模型需要说明布局。');
 const known=new Set(catalog.assets.map(a=>a.id));
 const nodes=data.nodes.map((n,i)=>{assert(id(n.id)&&text(n.label,100)&&n.label.trim()&&(n.assetId===null||known.has(n.assetId)),'模型返回了未知素材或空标签。');return {id:n.id,type:n.assetId?'asset':'text',assetId:n.assetId,label:n.label,x:50,y:50,w:200,h:150,fontSize:22,color:'#304d4c',fill:'#edf4f0',flip:false};});
 const edges=data.edges.map((e,i)=>{assert(text(e.quote,2000)&&e.quote.trim()&&input.text.includes(e.quote),'模型关系必须引用本次提供文字中的原句。');return {...e,id:`edge-${i+1}`,color:'#416d69'};});
 const scene=arrangeScene({...emptyScene(),title:input.title,sourceText:input.text,caption:data.explanation,nodes,edges},data.layout);
 return {scene:validateScene(scene,catalog),explanation:data.explanation};
}
export function sceneTemplate(kind){
 const scene=emptyScene();scene.title={signal:'信号传导 · 结构模板',interaction:'细胞互作 · 结构模板',experiment:'实验流程 · 结构模板'}[kind];scene.caption='结构模板；请替换占位文字并补充实际研究依据。虚线表示关系待核对。';
 const items=kind==='signal'?[['bio-membrane-2d-bluelight','细胞膜'],[null,'受体 / 分子 A'],[null,'胞内分子 B'],['bio-nucleus','细胞核'],[null,'表型 / 待核对']]:kind==='interaction'?[['bio-t-lymphocyte','细胞 A'],[null,'信号 / 待核对'],['bio-cancerous-cell-1','细胞 B']]:[['bio-mouse-gray','动物 / 品系待填'],[null,'干预与对照'],['bio-microtube-open-blue','采样'],[null,'检测 / 终点']];
 scene.nodes=items.map(([assetId,label],i)=>({id:`template-${i}`,type:assetId?'asset':'text',...(assetId?{assetId}:{}),label,x:50+i*215,y:i%2?290:180,w:180,h:170,fontSize:24,color:'#304d4c',fill:'#edf4f0',flip:false}));
 scene.edges=scene.nodes.slice(1).map((n,i)=>({id:`template-edge-${i}`,from:scene.nodes[i].id,to:n.id,kind:'hypothesis',label:'',quote:'',color:'#5b8279'}));
 return scene;
}
