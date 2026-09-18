import {defineRpcContract,type BbPluginApi} from '@get-bb/plugin-sdk';
import {z} from 'zod';
import {readNavigationHeadings,setNavigationHeading} from './headings.ts';
const output=z.object({headings:z.record(z.string(),z.string())});
export const rpcContract=defineRpcContract({get:{input:z.null(),output},save:{input:z.object({key:z.string().min(1).max(200),title:z.string().trim().max(120)}).strict(),output}});
export default function plugin(bb:BbPluginApi){
 const get=async()=>{const {preferences}=await bb.sdk.system.uiPreferences.list();return {headings:Object.fromEntries(readNavigationHeadings(preferences['sidebar.pluginPanelOrder'].value))};};
 let pending:Promise<unknown>=Promise.resolve();
 const save=({key,title}:{key:string;title:string})=>{
  const work=pending.catch(()=>undefined).then(async()=>{
   const {preferences}=await bb.sdk.system.uiPreferences.list();const current=preferences['sidebar.pluginPanelOrder'];
   await bb.sdk.system.uiPreferences.set({key:'sidebar.pluginPanelOrder',expectedRevision:current.revision,value:setNavigationHeading(current.value,key,title)});
   bb.realtime.publish('headings-changed',{});return get();
  });pending=work;return work;
 };
 bb.rpc.register(rpcContract,{get,save});
}
