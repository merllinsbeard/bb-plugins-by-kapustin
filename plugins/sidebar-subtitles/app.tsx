import {useCallback,useEffect,useState} from 'react';
import {definePluginApp,useRpc,useRealtime,experimental_Icon as Icon,type ExperimentalSidebarNavigationProps} from '@get-bb/plugin-sdk/app';
import type {rpcContract} from './server';
import './style.css';
function HeadingEditor({label,value,onSave}:{label:string;value:string;onSave:(title:string)=>Promise<void>}){
 const [editing,setEditing]=useState(false);const [draft,setDraft]=useState(value);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const save=async(title:string)=>{setBusy(true);setError('');try{await onSave(title.trim());setEditing(false);}catch{setError('Could not save. Your draft is kept; try again.');}finally{setBusy(false);}};
 if(!editing)return <button type="button" className="subtitle-edit" onClick={()=>{setDraft(value);setError('');setEditing(true);}} aria-label={'Heading before '+label}>{value||'+ Add subtitle'}</button>;
 return <div className="subtitle-editor" onKeyDown={e=>{if(e.key==='Escape'&&!busy){e.preventDefault();e.stopPropagation();setEditing(false);}}}><input autoFocus aria-label={'Heading before '+label} maxLength={120} value={draft} disabled={busy} placeholder="Group name" onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();e.stopPropagation();void save(draft);}}}/><small>Enter to save · Escape to cancel</small><div><button disabled={busy} onClick={()=>void save(draft)}>Save</button><button disabled={busy} onClick={()=>setEditing(false)}>Cancel</button>{value&&<button disabled={busy} onClick={()=>void save('')}>Delete</button>}</div>{error&&<p role="alert">{error}</p>}</div>;
}
function Navigation(props:ExperimentalSidebarNavigationProps){
 const rpc=useRpc<typeof rpcContract>();const [headings,setHeadings]=useState<Record<string,string>>({});const [editing,setEditing]=useState(false);const [error,setError]=useState('');
 const load=useCallback(()=>{rpc.call('get',null).then(r=>{setHeadings(r.headings);setError('');}).catch(()=>setError('Subtitles could not load.'));},[rpc]);
 useEffect(load,[load]);useRealtime('headings-changed',load);
 useEffect(()=>{window.addEventListener('focus',load);return()=>window.removeEventListener('focus',load);},[load]);
 return <nav className="sidebar-subtitles" aria-label="Workspace navigation"><div className="subtitle-toolbar"><button onClick={()=>setEditing(v=>!v)} aria-pressed={editing}>{editing?'Done':'Edit subtitles'}</button></div>{error&&<small role="alert">{error}</small>}{props.items.map(item=><div key={item.id} data-sidebar-navigation-item={item.id}>{editing?<HeadingEditor label={item.label} value={headings[item.id]||''} onSave={async title=>{const result=await rpc.call('save',{key:item.id,title});setHeadings(result.headings);}}/>:headings[item.id]?<h2>{headings[item.id]}</h2>:null}<button className="subtitle-nav-item" type="button" {...item.experimental_splitProps} disabled={item.isDisabled} aria-current={props.activeItemId===item.id?'page':undefined} aria-label={item.label} onClick={e=>props.experimental_activate(item.id,{openInSplit:e.metaKey||e.ctrlKey})}><Icon name={item.icon.kind==='host'?(item.icon.name==='new-thread'?'MessageSquarePlus':item.icon.name==='search'?'Search':'Puzzle'):(item.icon.icon||'Puzzle')}/><span>{item.label}</span></button></div>)}</nav>;
}
export default definePluginApp(app=>{app.slots.experimental_sidebarNavigation({id:'subtitles',title:'Sidebar Subtitles',description:'Native destinations grouped by editable subtitles.',component:Navigation});});
