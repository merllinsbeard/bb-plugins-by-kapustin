import { defineRpcContract, type BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { safePath, containsCredential, chunkLines, selectChunks, renderSelection } from './selector.ts';
const threadInput=z.object({threadId:z.string().min(1).max(200)}).strict();
const stats=z.object({reads:z.number(),inputChars:z.number(),returnedChars:z.number()});
const state=z.object({enabled:z.boolean(),ready:z.boolean(),stats});
export const rpcContract=defineRpcContract({status:{input:threadInput,output:state},toggle:{input:threadInput.extend({enabled:z.boolean()}),output:state}});
const readInput=z.object({path:z.string().min(1).max(500),task:z.string().trim().min(1).max(2000),startLine:z.number().int().positive().default(1),endLine:z.number().int().positive().optional()}).strict();
export default function plugin(bb:BbPluginApi) {
 const settings=bb.settings.define({apiKey:{type:'string',label:'Typesafe API key',secret:true,default:'',description:'Stored only in BB secret storage. Requests go to api.typesafe.ai.'}});
 const getStats=(id:string)=>stats.catch({reads:0,inputChars:0,returnedChars:0}).parse(bb.storage.kv.get('stats:'+id));
 const status=async({threadId}:{threadId:string})=>({enabled:(await bb.sdk.threads.getPluginMetadata({threadId})).ecoMode===true,ready:Boolean((await settings.get()).apiKey),stats:getStats(threadId)});
 const toggle=async({threadId,enabled}:{threadId:string;enabled:boolean})=>{
  if(enabled && !(await settings.get()).apiKey) throw new Error('Add your Typesafe API key in Jev x bb settings first.');
  await bb.sdk.threads.updatePluginMetadata({threadId,set:{ecoMode:enabled}});
  bb.realtime.publish('eco-changed',{threadId});return status({threadId});
 };
 bb.rpc.register(rpcContract,{status,toggle});
 const read=async(input:z.infer<typeof readInput>,threadId:string,signal?:AbortSignal)=>{
  if(!(await status({threadId})).enabled) throw new Error('Eco Mode is off for this thread.');
  if(!safePath(input.path)) throw new Error('Choose a non-hidden, workspace-relative text file. Credential files are excluded.');
  const thread=await bb.sdk.threads.get({threadId});
  if(!thread.environmentId) throw new Error('This thread has no workspace environment.');
  const env=await bb.sdk.environments.get({environmentId:thread.environmentId});
  if(!env.path) throw new Error('This environment has no workspace path.');
  const file=await bb.sdk.files.read({hostId:env.hostId,rootPath:env.path,path:env.path.replace(/\/$/,'')+'/'+input.path,signal});
  if(file.contentEncoding!=='utf8' || file.sizeBytes>1_000_000) throw new Error('Choose a UTF-8 text file smaller than 1 MB.');
  const lines=file.content.split('\n');const end=input.endLine ?? Math.min(lines.length,input.startLine+399);
  if(end<input.startLine || end-input.startLine>=600 || input.startLine>lines.length) throw new Error('Choose an existing range of at most 600 lines.');
  const text=lines.slice(input.startLine-1,end).join('\n');
  if(text.length>60_000) throw new Error('This range exceeds 60,000 characters. Choose fewer lines.');
  if(containsCredential(text)||containsCredential(input.task)) throw new Error('Possible credentials detected. Nothing was sent to Typesafe.');
  const key=(await settings.get()).apiKey;if(!key) throw new Error('Configure the Typesafe API key.');
  const chunks=chunkLines(text,input.startLine);
  if(/(^|\/)(AGENTS|CLAUDE|SKILL)\.md$/i.test(input.path)) chunks.forEach(c=>c.keep=true);
  const result=await selectChunks(chunks,input.task,key,signal);
  const previous=getStats(threadId);bb.storage.kv.set('stats:'+threadId,{reads:previous.reads+1,inputChars:previous.inputChars+result.inputChars,returnedChars:previous.returnedChars+result.outputChars});
  bb.realtime.publish('eco-changed',{threadId});
  return renderSelection(input.path,result)+'\n\nFile has '+lines.length+' lines; requested '+input.startLine+'–'+Math.min(end,lines.length)+'. Other lines were not evaluated.';
 };
 bb.agents.registerTool({name:'jev_read',description:'Read a workspace file range through Jev relevance selection in Eco Mode. Sends the selected source range and task to Typesafe. Returns original relevant text and explicit omitted line ranges. Use normal reads for complete verification.',parameters:readInput,execute:(input,ctx)=>read(input,ctx.threadId,ctx.signal)});
 bb.agents.configure(ctx=>({tools:['jev_read'],skills:['jev-bb'],instructions:ctx.pluginMetadata.ecoMode===true?'Eco Mode is enabled. Prefer jev_read for initial exploration of non-sensitive workspace text. Its selected ranges can be incomplete: read omitted ranges with your normal tools before editing or making claims about absence. Never send secrets, personal data, or confidential files. This does not rewrite conversation history.':'Eco Mode is off. Use your normal readers; do not call jev_read.'}));
 bb.cli.register({name:'jev',summary:'Jev context selection and per-thread Eco Mode',commands:[{name:'status',summary:'Show Eco Mode and character counts',usage:'bb jev status'},{name:'read',summary:'Read selected source ranges',usage:'bb jev read <relative-path> --task <text> [--start <line>] [--end <line>]'}],async run(args,ctx){
  if(!ctx.threadId) return {exitCode:1,stderr:'Run this command inside a BB thread.'};
  try {
   const command=args[0];
   if(command==='status')return {exitCode:0,stdout:JSON.stringify(await status({threadId:ctx.threadId}))};
   if(command==='off')return {exitCode:0,stdout:JSON.stringify(await toggle({threadId:ctx.threadId,enabled:false}))};
   if(command==='read') {
    const flags=new Map<string,string>();for(let i=2;i<args.length;i+=2){if(!['--task','--start','--end'].includes(args[i]!)||!args[i+1])throw new Error('Invalid read arguments.');flags.set(args[i]!,args[i+1]!);}
    const input=readInput.parse({path:args[1],task:flags.get('--task'),startLine:flags.has('--start')?Number(flags.get('--start')):1,endLine:flags.has('--end')?Number(flags.get('--end')):undefined});
    return {exitCode:0,stdout:await read(input,ctx.threadId,ctx.signal)};
   }
   return {exitCode:1,stderr:'Usage: bb jev status | off | read <path> --task <text> [--start <line>] [--end <line>]. Enable Eco Mode using the thread toggle.'};
  }catch(error){return {exitCode:1,stderr:error instanceof Error?error.message:'Jev read failed.'};}
 }});
}
