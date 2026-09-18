import type {BbPluginApi} from '@get-bb/plugin-sdk';import {hostContract} from './contract.ts';
export default function plugin(bb:BbPluginApi){
 const host=bb.hosts.experimental_client({contract:hostContract});
 bb.cli.register({name:'lock-area',summary:'Check, initialize or restore native pane locking on a compatible BB installation',commands:[{name:'check',summary:'Check source and installation compatibility',usage:'bb lock-area check --host <id> --checkout <absolute-path> --target <bb-app/app/dist>'},{name:'initialize',summary:'Build, test, back up and deploy the native enhancement',usage:'bb lock-area initialize --host <id> --checkout <absolute-path> --target <bb-app/app/dist>'},{name:'restore',summary:'Restore an unchanged installation from a backup',usage:'bb lock-area restore --host <id> --checkout <absolute-path> --target <bb-app/app/dist> --backup <absolute-path>'}],async run(args,ctx){
  const mode=args[0];if(!['check','initialize','restore'].includes(mode||''))return {exitCode:1,stderr:'Use check, initialize or restore. Pass --host, --checkout and --target explicitly.'};
  const flags=new Map<string,string>();for(let i=1;i<args.length;i+=2){if(!['--host','--checkout','--target','--backup'].includes(args[i]!)||!args[i+1])return{exitCode:1,stderr:'Invalid arguments.'};flags.set(args[i]!,args[i+1]!);}
  const hostId=flags.get('--host'),checkout=flags.get('--checkout'),target=flags.get('--target');if(!hostId||!checkout||!target)return {exitCode:1,stderr:'Explicit --host, --checkout and --target are required.'};
  const result=await host.call('initialize',{mode:mode as 'check'|'initialize'|'restore',checkout,target,backup:flags.get('--backup')},{hostId,signal:ctx.signal,timeoutMs:20*60*1000});
  return {exitCode:0,stdout:JSON.stringify(result,null,2)};
 }});
}
