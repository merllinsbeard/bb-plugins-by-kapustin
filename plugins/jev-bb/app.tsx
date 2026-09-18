import {useCallback,useEffect,useState} from 'react';
import {definePluginApp,useRpc,useRealtime} from '@get-bb/plugin-sdk/app';
import type {rpcContract} from './server';
import './style.css';
function EcoToggle({threadId}:{threadId:string}) {
 const rpc=useRpc<typeof rpcContract>();const [confirming,setConfirming]=useState(false);const [enabled,setEnabled]=useState(false);const [ready,setReady]=useState(false);const [busy,setBusy]=useState(true);const [error,setError]=useState('');const [counts,setCounts]=useState({reads:0,inputChars:0,returnedChars:0});
 const load=useCallback(()=>{rpc.call('status',{threadId}).then(s=>{setEnabled(s.enabled);setReady(s.ready);setCounts(s.stats);setError('');}).catch(()=>setError('Could not read Eco Mode.')).finally(()=>setBusy(false));},[rpc,threadId]);
 useEffect(load,[load]);useRealtime('eco-changed',load);
 const toggle=async(confirmed=false)=>{
  if(!enabled){try{const current=await rpc.call('status',{threadId});setReady(current.ready);if(!current.ready){setError('Add your Typesafe API key in Jev x bb plugin settings.');return;}}catch{setError('Could not check Jev settings.');return;}}
  if(!enabled&&!confirmed){setConfirming(true);return;}
  setConfirming(false);
  setBusy(true);try{const state=await rpc.call('toggle',{threadId,enabled:!enabled});setEnabled(state.enabled);setError('');}catch(e){setError(e instanceof Error?e.message:'Could not change Eco Mode.');}finally{setBusy(false);}
 };
 return <div className="jev-eco"><button type="button" role="switch" aria-checked={enabled} aria-label="Eco Mode" disabled={busy} onClick={()=>void toggle()} title={counts.reads+' reads · '+(counts.inputChars-counts.returnedChars)+' source characters omitted. Changes guide the next provider session; existing history stays intact.'} data-on={enabled}><span aria-hidden="true">✦</span> Eco Mode <span className="jev-switch"/></button>{confirming?<div role="dialog" aria-label="Enable Eco Mode" className="jev-disclosure"><strong>Enable Eco Mode?</strong><p>Jev reads send the requested file range and task to Typesafe. Use only files you are allowed to share. Your main provider stays unchanged.</p><div><button onClick={()=>void toggle(true)}>Enable for this thread</button><button onClick={()=>setConfirming(false)}>Cancel</button></div></div>:null}{error?<span role="alert" className="jev-error">{error}</span>:null}</div>;
}
export default definePluginApp(app=>{app.slots.experimental_threadHeaderAction({id:'eco-mode',title:'Eco Mode',component:EcoToggle});});
