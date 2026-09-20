// Offline native SDK integration: synthetic material, loopback provider, no paid model calls.
import {createServer} from 'node:http';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createAgentPilot} from '../demo-api/src/agent-pilot.mjs';
let requests=0, readReceipts=0;const requestKinds=[];
const server=createServer(async(req,res)=>{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);
 let body={};try{body=JSON.parse(Buffer.concat(chunks))}catch{}
 requestKinds.push({method:req.method,path:req.url,tools:body.tools?.map(t=>t.name)});
 if(req.url.includes('count_tokens')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({input_tokens:10}));return;}
 if(!req.url.includes('/messages')){res.writeHead(200,{'content-type':'application/json'});res.end('{}');return;}
 requests++;
 const readTool=(body.tools??[]).find(t=>t.name==='mcp__research__read_material');
 const shouldRead=readTool&&readReceipts===0;
 const structured=(body.tools??[]).find(t=>/structured/i.test(t.name));
 const block=shouldRead?{type:'tool_use',id:'tool_smoke_1',name:readTool.name,input:{ref:'R1'}}:structured?{type:'tool_use',id:'tool_smoke_output_'+requests,name:structured.name,input:{answer:'synthetic evidence checked'}}:{type:'text',text:'{"answer":"synthetic evidence checked"}'};
 const message={id:'msg_smoke_'+requests,type:'message',role:'assistant',model:'claude-sonnet-4-6',content:[block],stop_reason:block.type==='tool_use'?'tool_use':'end_turn',stop_sequence:null,usage:{input_tokens:10,output_tokens:10}};
 if(!body.stream){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(message));return;}
 res.writeHead(200,{'content-type':'text/event-stream'});
 const emit=(type,data)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n');
 emit('message_start',{message:{...message,content:[],stop_reason:null}});
 emit('content_block_start',{index:0,content_block:block.type==='tool_use'?{...block,input:{}}:{type:'text',text:''}});
 emit('content_block_delta',{index:0,delta:block.type==='tool_use'?{type:'input_json_delta',partial_json:JSON.stringify(block.input)}:{type:'text_delta',text:block.text}});
 emit('content_block_stop',{index:0});emit('message_delta',{delta:{stop_reason:message.stop_reason,stop_sequence:null},usage:{output_tokens:10}});emit('message_stop',{});res.end();
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const directory=await mkdtemp(join(tmpdir(),'rw-sdk-native-'));
try{
 const output=await createAgentPilot({enabled:true,baseUrl:`http://127.0.0.1:${server.address().port}`,provider:'127.0.0.1',model:'claude-sonnet-4-6',apiKey:'synthetic-test-key',effort:'low',maxTurns:4},{directory,timeoutMs:40000,onRead:async()=>readReceipts++}).generate({requestId:'native-smoke',instruction:'Read R1 using read_material then return JSON {answer:string}. This is synthetic test data.',materials:[{ref:'R1',sourceId:'s1',accessId:'a1',title:'Synthetic fixture',level:'abstract',text:'Synthetic evidence only.'}],outputSchema:{type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false}});
 assert.equal(JSON.parse(output.text).answer,'synthetic evidence checked');assert.equal(readReceipts,1);assert.ok(requests>=2);
 await writeFile(join(directory,'report.json'),JSON.stringify({passed:true,requests,readReceipts,requestKinds,metrics:output.runtimeMetrics,directory},null,2));console.log(JSON.stringify({passed:true,requests,readReceipts,metrics:output.runtimeMetrics}));
}catch(e){console.log(JSON.stringify({passed:false,code:e.code,requests,readReceipts,requestKinds,directory}));throw e;}
finally{await new Promise(r=>server.close(r));}
