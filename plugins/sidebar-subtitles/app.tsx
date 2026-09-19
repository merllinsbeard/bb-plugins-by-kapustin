import {useCallback, useEffect, useRef, useState} from 'react';
import {definePluginApp, useRpc, useRealtime, experimental_Icon as Icon, type ExperimentalSidebarNavigationProps} from '@get-bb/plugin-sdk/app';
import type {rpcContract} from './server';
import {navigationKey, orderedKeys, visibleKeys} from './navigation';
import './style.css';
function HeadingEditor({label,value,onSave}:{label:string;value:string;onSave:(title:string)=>Promise<void>}){
 const [editing,setEditing]=useState(false);const [draft,setDraft]=useState(value);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const save=async(title:string)=>{setBusy(true);setError('');try{await onSave(title.trim());setEditing(false);}catch{setError('Could not save. Your draft is kept; try again.');}finally{setBusy(false);}};
 if(!editing)return <button type="button" className="subtitle-edit" onClick={()=>{setDraft(value);setError('');setEditing(true);}} aria-label={'Heading before '+label}>{value||'+ Add subtitle'}</button>;
 return <div className="subtitle-editor" onKeyDown={e=>{if(e.key==='Escape'&&!busy){e.preventDefault();e.stopPropagation();setEditing(false);}}}><input autoFocus aria-label={'Heading before '+label} maxLength={120} value={draft} disabled={busy} placeholder="Group name" onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();e.stopPropagation();void save(draft);}}}/><small>Enter to save · Escape to cancel</small><div><button disabled={busy} onClick={()=>void save(draft)}>Save</button><button disabled={busy} onClick={()=>setEditing(false)}>Cancel</button>{value&&<button disabled={busy} onClick={()=>void save('')}>Delete</button>}</div>{error&&<p role="alert">{error}</p>}</div>;
}
type NavigationState = {headings: Record<string, string>; order: string[]; visible: string[] | null; orderRevision: number; visibleRevision: number};
function Navigation(props: ExperimentalSidebarNavigationProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<NavigationState | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragged, setDragged] = useState<string | null>(null);
  const request = useRef(0);
  const load = useCallback(() => {
    const id = ++request.current;
    void rpc.call('get', null).then(result => {if (id === request.current) {setState(result); setError('');}})
      .catch(() => {if (id === request.current) setError('Navigation could not load. Refresh to retry.');});
  }, [rpc]);
  useEffect(() => {load(); return () => {request.current++;};}, [load]);
  useRealtime('headings-changed', load);
  useEffect(() => {window.addEventListener('focus', load); return () => window.removeEventListener('focus', load);}, [load]);
  if (!state) {const Original = props.experimental_Original; return <><Original />{error && <button onClick={load}>{error}</button>}</>;}
  const items = new Map(props.items.map(item => [navigationKey(item.id), item]));
  const keys = [...items.keys()];
  const ordered = orderedKeys(keys, state.order);
  const visible = new Set(visibleKeys(keys, state.visible));
  const shown = ordered.filter(key => visible.has(key));
  const hidden = ordered.filter(key => !visible.has(key));
  const rows = editing ? ordered : shown;
  async function change(operation: () => Promise<NavigationState>) {
    if (busy) return;
    setBusy(true); setError(''); request.current++;
    try {const result = await operation(); request.current++; setState(result);}
    catch (cause) {request.current++; setError(cause instanceof Error ? cause.message : 'Could not save. Refresh and try again.');}
    finally {setBusy(false);}
  }
  const move = (key: string, target: string) => void change(() => rpc.call('move', {key, target, keys, expectedRevision: state.orderRevision}));
  const toggle = (key: string, value: boolean) => void change(() => rpc.call('visibility', {key, visible: value, keys, expectedRevision: state.visibleRevision}));
  function destination(key: string) {
    const item = items.get(key)!;
    return <button className="subtitle-nav-item" type="button" {...item.experimental_splitProps} disabled={item.isDisabled}
      aria-current={props.activeItemId === item.id ? 'page' : undefined} aria-label={item.label}
      onClick={event => props.experimental_activate(item.id, {openInSplit: event.metaKey || event.ctrlKey})}>
      <Icon name={item.icon.kind === 'host' ? (item.icon.name === 'new-thread' ? 'MessageSquarePlus' : item.icon.name === 'search' ? 'Search' : 'Puzzle') : (item.icon.icon || 'Puzzle')} /><span>{item.label}</span>
    </button>;
  }
  return <nav className="sidebar-subtitles" aria-label="Workspace navigation">
    <div className="subtitle-toolbar"><button onClick={() => setEditing(value => !value)} aria-pressed={editing} disabled={busy}>{editing ? 'Done' : 'Customize sidebar'}</button></div>
    {error && <div role="alert">{error} <button onClick={load} disabled={busy}>Refresh</button></div>}
    {editing && <p className="subtitle-help">Drag the handles or use the arrows to move sections. Hidden sections stay available under More.</p>}
    {rows.map((key, index) => {
      const item = items.get(key)!;
      return <div key={key} data-sidebar-navigation-item={item.id} className={!visible.has(key) ? 'subtitle-hidden' : undefined}
        onDragOver={event => {if (dragged && !busy) event.preventDefault();}}
        onDrop={event => {event.preventDefault(); if (dragged && dragged !== key && !busy) move(dragged, key); setDragged(null);}}>
        {editing ? <HeadingEditor label={item.label} value={state.headings[key] || ''} onSave={async title => {
          request.current++; const result = await rpc.call('save', {key, title}); request.current++; setState(result);
        }} /> : state.headings[key] ? <h2>{state.headings[key]}</h2> : null}
        <div className="subtitle-row">
          {editing && <button className="subtitle-handle" aria-label={'Drag ' + item.label} title="Drag to move before another section" draggable={!busy}
            onDragStart={event => {event.dataTransfer.setData('text/plain', key); event.dataTransfer.effectAllowed = 'move'; setDragged(key);}}
            onDragEnd={() => setDragged(null)}>⠿</button>}
          {destination(key)}
          <details className="subtitle-options"><summary aria-label={item.label + ' panel options'} title="Section options">⋯</summary><div>
            <button disabled={busy || index === 0} onClick={() => move(key, rows[index - 1]!)}>Move up</button>
            <button disabled={busy || index === rows.length - 1} onClick={() => move(rows[index + 1]!, key)}>Move down</button>
            <button disabled={busy} onClick={() => toggle(key, !visible.has(key))}>{visible.has(key) ? 'Hide section' : 'Show section'}</button>
          </div></details>
        </div>
        {editing && <div className="subtitle-controls">
          <button disabled={busy || index === 0} aria-label={'Move ' + item.label + ' up'} onClick={() => move(key, rows[index - 1]!)}>↑</button>
          <button disabled={busy || index === rows.length - 1} aria-label={'Move ' + item.label + ' down'} onClick={() => move(rows[index + 1]!, key)}>↓</button>
          <label><input type="checkbox" checked={visible.has(key)} disabled={busy} onChange={event => toggle(key, event.target.checked)} />Show {item.label}</label>
        </div>}
      </div>;
    })}
    {!editing && hidden.length > 0 && <details className="subtitle-more"><summary>More</summary>{hidden.map(key => <div key={key} className="subtitle-row">{destination(key)}<button className="subtitle-show" disabled={busy} aria-label={'Show ' + items.get(key)!.label + ' in sidebar'} onClick={() => toggle(key, true)}>Show</button></div>)}</details>}
  </nav>;
}
export default definePluginApp(app => {app.slots.experimental_sidebarNavigation({id: 'subtitles', title: 'Sidebar Subtitles', description: 'Editable headings with section order and visibility controls.', component: Navigation});});
