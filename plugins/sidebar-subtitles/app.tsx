import {useCallback, useEffect, useRef, useState} from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import {definePluginApp, useRpc, useRealtime, experimental_Icon as Icon, type ExperimentalSidebarNavigationProps} from '@get-bb/plugin-sdk/app';
import type {rpcContract} from './server';
import {navigationKey, orderedKeys, visibleKeys} from './navigation';
import {usePortalScopeProps} from './lib/portal-scope';
import './style.css';

type NavigationState = {headings: Record<string, string>; order: string[]; visible: string[] | null; orderRevision: number; visibleRevision: number};
function HeadingEditor({label, value, onSave, onClose}: {label: string; value: string; onSave: (title: string) => Promise<void>; onClose: () => void}) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (title: string) => {
    setBusy(true); setError('');
    try {await onSave(title.trim()); onClose();}
    catch {setError('Could not save. Your draft is kept; try again.');}
    finally {setBusy(false);}
  };
  return <div className="subtitle-editor" onKeyDown={event => {
    if (event.key === 'Escape' && !busy) {event.preventDefault(); event.stopPropagation(); onClose();}
  }}>
    <label>Heading before {label}<input autoFocus aria-label={'Heading before ' + label} maxLength={120} value={draft} disabled={busy} placeholder="Group name"
      onChange={event => setDraft(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {event.preventDefault(); void save(draft);}
      }}/></label>
    <div><button disabled={busy} onClick={() => void save(draft)}>Save</button><button disabled={busy} onClick={onClose}>Cancel</button>
      {value && <button className="subtitle-delete" disabled={busy} onClick={() => void save('')}>Delete</button>}</div>
    {error && <p role="alert">{error}</p>}
  </div>;
}
function Navigation(props: ExperimentalSidebarNavigationProps) {
  const rpc = useRpc<typeof rpcContract>();
  const portal = usePortalScopeProps();
  const [state, setState] = useState<NavigationState | null>(null);
  const [editing, setEditing] = useState(false);
  const [headingKey, setHeadingKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
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
  function destination(key: string, inMore = false) {
    const item = items.get(key)!;
    return <button className="subtitle-nav-item" type="button" {...item.experimental_splitProps} disabled={item.isDisabled}
      aria-current={props.activeItemId === item.id ? 'page' : undefined} aria-label={item.label}
      aria-keyshortcuts={item.shortcut?.ariaKeyShortcuts} title={item.shortcut ? `${item.label} (${item.shortcut.label})` : item.label}
      onClick={event => {props.experimental_activate(item.id, {openInSplit: event.metaKey || event.ctrlKey}); if (inMore) setMoreOpen(false);}}>
      <Icon name={item.icon.kind === 'host' ? (item.icon.name === 'new-thread' ? 'MessageSquarePlus' : item.icon.name === 'search' ? 'Search' : 'Puzzle') : (item.icon.icon || 'Puzzle')} /><span>{item.label}</span>
    </button>;
  }
  return <nav className="sidebar-subtitles" data-editing={editing || undefined} data-compact={props.isCompactViewport || undefined} aria-label="Workspace navigation">
    {editing && <div className="subtitle-toolbar"><span>Customize sidebar</span><button onClick={() => {setEditing(false); setHeadingKey(null);}} disabled={busy}>Done</button></div>}
    {error && <div className="subtitle-error" role="alert">{error} <button onClick={load} disabled={busy}>Refresh</button></div>}
    {rows.map((key, index) => {
      const item = items.get(key)!;
      return <div key={key} data-sidebar-navigation-item={item.id} className="subtitle-section" data-hidden={!visible.has(key) || undefined} data-drop-target={dropTarget === key || undefined}
        onDragOver={event => {if (dragged && dragged !== key && !busy) {event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(key);}}}
        onDrop={event => {event.preventDefault(); if (dragged && dragged !== key && !busy) move(dragged, key); setDragged(null); setDropTarget(null);}}>
        {headingKey === key ? <HeadingEditor key={key} label={item.label} value={state.headings[key] || ''} onClose={() => setHeadingKey(null)} onSave={async title => {
          request.current++; const result = await rpc.call('save', {key, title}); request.current++; setState(result);
        }} /> : state.headings[key] ? <h2>{editing ? <button className="subtitle-edit" aria-label={'Heading before ' + item.label} onClick={() => setHeadingKey(key)}>{state.headings[key]}<Icon name="Edit" /></button> : state.headings[key]}</h2> : null}
        <div className="subtitle-row">
          {editing && <button className="subtitle-icon-button subtitle-handle" aria-label={'Drag ' + item.label} title="Drag to reorder; section menu also has move controls" draggable={!busy}
            onDragStart={event => {event.dataTransfer.setData('text/plain', key); event.dataTransfer.effectAllowed = 'move'; setDragged(key);}}
            onDragEnd={() => {setDragged(null); setDropTarget(null);}}><Icon name="DragDropVertical" /></button>}
          {destination(key)}
          {editing && <button className="subtitle-icon-button subtitle-visibility" disabled={busy} aria-label={(visible.has(key) ? 'Hide ' : 'Show ') + item.label} aria-pressed={visible.has(key)}
            title={visible.has(key) ? 'Hide section' : 'Show section'} onClick={() => toggle(key, !visible.has(key))}><Icon name={visible.has(key) ? 'Eye' : 'EyeOff'} /></button>}
          <Menu.Root><Menu.Trigger asChild><button className="subtitle-icon-button subtitle-options" aria-label={item.label + ' panel options'} title="Section options"><Icon name="MoreHorizontal" /></button></Menu.Trigger>
            <Menu.Portal><Menu.Content {...portal} className="subtitle-menu" align="end" sideOffset={4}>
              <Menu.Item disabled={busy || index === 0} onSelect={() => move(key, rows[index - 1]!)}><Icon name="ArrowUp" />Move up</Menu.Item>
              <Menu.Item disabled={busy || index === rows.length - 1} onSelect={() => move(rows[index + 1]!, key)}><Icon name="ArrowDown" />Move down</Menu.Item>
              <Menu.Item disabled={busy} onSelect={() => toggle(key, !visible.has(key))}><Icon name={visible.has(key) ? 'EyeOff' : 'Eye'} />{visible.has(key) ? 'Hide section' : 'Show section'}</Menu.Item>
              <Menu.Separator />
              <Menu.Item onSelect={() => setHeadingKey(key)}><Icon name="Edit" />{state.headings[key] ? 'Edit heading' : 'Add heading above'}</Menu.Item>
              <Menu.Item onSelect={() => setEditing(true)}><Icon name="SlidersHorizontal" />Customize sidebar</Menu.Item>
            </Menu.Content></Menu.Portal>
          </Menu.Root>
        </div>
      </div>;
    })}
    {!editing && <div className="subtitle-footer">
      {hidden.length > 0 && <Popover.Root open={moreOpen} onOpenChange={setMoreOpen}><Popover.Trigger asChild><button className="subtitle-nav-item subtitle-more" aria-label="More sidebar navigation"><Icon name="MoreHorizontal" /><span>More</span></button></Popover.Trigger>
        <Popover.Portal><Popover.Content {...portal} className="subtitle-popover" side="right" align="end" sideOffset={8} aria-label="Hidden sidebar sections">
          <div className="subtitle-popover-title">Hidden sections</div>{hidden.map(key => <div key={key} className="subtitle-row">{destination(key, true)}<button className="subtitle-icon-button" disabled={busy} title="Show in sidebar" aria-label={'Show ' + items.get(key)!.label + ' in sidebar'} onClick={() => toggle(key, true)}><Icon name="Eye" /></button></div>)}
        </Popover.Content></Popover.Portal>
      </Popover.Root>}
      <button className="subtitle-icon-button subtitle-customize" aria-label="Customize sidebar" title="Customize sidebar" onClick={() => setEditing(true)}><Icon name="SlidersHorizontal" /></button>
    </div>}
  </nav>;
}
export default definePluginApp(app => {app.slots.experimental_sidebarNavigation({id: 'subtitles', title: 'Sidebar Subtitles', description: 'Editable headings with section order and visibility controls.', component: Navigation});});
