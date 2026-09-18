import { useCallback, useEffect, useRef, useState } from 'react';
import { definePluginApp, useRpc, useRealtime } from '@get-bb/plugin-sdk/app';
import { Checkbox } from '@/components/ui/checkbox';
import { Icon } from '@/components/ui/icon';
import './style.css';
import { Button } from '@/components/ui/button';
import type { GoalBoard, rpcContract } from './server';
function GoalsPage() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [newText, setNewText] = useState('');
  const rpc = useRpc<typeof rpcContract>();
  const [board, setBoard] = useState<GoalBoard | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  useEffect(() => { if (editing && !dialog.current?.open) dialog.current?.showModal(); if (!editing && dialog.current?.open) dialog.current.close(); }, [editing]);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const load = useCallback(async () => { try { const next = await rpc.call('boardRead', null); if (!lock.current) setBoard(next); } catch(e) { setError(String(e)); } }, [rpc]);
  useEffect(() => { void load(); }, [load]);
  useRealtime('changed', () => { if (!lock.current) void load(); });
  async function save(items: GoalBoard['items']) {
    if (!board || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { setBoard(await rpc.call('boardSave', { items, revision: board.revision })); setEditing(null); setText(''); setNewText(''); }
    catch(e) { setError(String(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  function move(id: string, target: string) {
    if (!board || id === target || editing) return;
    const items = [...board.items]; const from = items.findIndex(i => i.id === id); const to = items.findIndex(i => i.id === target);
    if (from < 0 || to < 0) return;
    const [item] = items.splice(from, 1); items.splice(to, 0, item); void save(items);
  }
  const active = board?.items.filter(i => !i.done).length ?? 0;
  const editor = <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (!text.trim() || !board) return; void save(editing === 'new' ? [...board.items, { id: crypto.randomUUID(), text: text.trim(), done: false }] : board.items.map(i => i.id === editing ? { ...i, text: text.trim() } : i)); }}><textarea autoFocus aria-label="Goal text" className="min-h-28 w-full resize-y bg-transparent text-base leading-relaxed outline-none" maxLength={800} placeholder="What outcome do you want to achieve?" value={text} onChange={e => setText(e.target.value)} disabled={busy}/><div className="flex gap-2"><Button type="submit" disabled={busy || !text.trim()}>Save</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => { setEditing(null); setText(''); }}>Cancel</Button></div></form>;
  const rows = (items: GoalBoard['items']) => items.map((item, index) => <div key={item.id} className={`gl-row ${over === item.id ? 'gl-over' : ''} ${drag === item.id ? 'gl-dragging' : ''}`} onDragOver={e => { if (drag && !busy && !editing && !item.done) { e.preventDefault(); setOver(item.id); } }} onDrop={e => { e.preventDefault(); if (drag) move(drag, item.id); setDrag(null); setOver(null); }}>
    {!item.done && <button className="gl-grip" aria-label="Drag goal" title="Drag to change priority" disabled={busy} draggable={!busy} onDragStart={e => { e.dataTransfer.setData('text/plain', item.id); setDrag(item.id); }} onDragEnd={() => { setDrag(null); setOver(null); }} onKeyDown={e => { if (e.key === 'ArrowUp' && index > 0) { e.preventDefault(); move(item.id, items[index - 1].id); } if (e.key === 'ArrowDown' && index < items.length - 1) { e.preventDefault(); move(item.id, items[index + 1].id); } }}>⠿</button>}
    <Checkbox checked={item.done} disabled={busy} aria-label={`${item.done ? 'Mark as active' : 'Complete'}: ${item.text}`} onCheckedChange={v => { if (board) void save(board.items.map(i => i.id === item.id ? { ...i, done: v === true } : i)); }}/>
    <button className={`gl-row-main ${item.done ? 'gl-done' : ''}`} onClick={() => { setEditing(item.id); setText(item.text); }}>{item.text}</button>
    {!item.done && <div className="gl-order"><button aria-label="Move goal up" disabled={busy || index === 0} onClick={() => move(item.id, items[index - 1].id)}>↑</button><button aria-label="Move goal down" disabled={busy || index === items.length - 1} onClick={() => move(item.id, items[index + 1].id)}>↓</button></div>}
    <button className="gl-small" aria-label="Open goal" onClick={() => { setEditing(item.id); setText(item.text); }}><Icon name="ChevronRight" className="size-4" /></button>
  </div>);
  return <div className="gl-page"><main className="gl-main">
    <header className="gl-header"><h1>Goals</h1><p>Personal priorities for decisions and plans · Active: {active}</p></header>
    {error && <p className="gl-error" role="alert">{error} <button onClick={() => { setError(''); void load(); }}>Refresh</button></p>}
    {!board ? <p className="gl-muted">Loading goals…</p> : <section>
      <h2 className="gl-heading"><Icon name="Target" className="size-4" /><span>My goals</span><span className="gl-count">{active}</span></h2>
      <div className="gl-group">{rows(board.items.filter(i => !i.done))}
        <form className="gl-add" onSubmit={e => { e.preventDefault(); if (newText.trim()) void save([...board.items, { id: crypto.randomUUID(), text: newText.trim(), done: false }]); }}><Icon name="Plus" className="size-4" /><input aria-label="New goal" placeholder="Add a goal" maxLength={800} value={newText} disabled={busy || board.items.length >= 30} onChange={e => setNewText(e.target.value)}/>{newText.trim() && <Button size="sm" variant="ghost" disabled={busy || board.items.length >= 30} type="submit">Add</Button>}</form>
        {board.items.some(i => i.done) && <details className="gl-completed"><summary>Completed · {board.items.filter(i => i.done).length}</summary>{rows(board.items.filter(i => i.done))}</details>}
      </div><footer className="gl-footer"><span>Ask your agent: “How does this align with my goals?” Higher items have greater priority.</span><span role="status">{busy ? 'Saving…' : ''}</span></footer>
    </section>}
    <dialog ref={dialog} className="gl-popup" aria-label="Edit goal" onCancel={e => { e.preventDefault(); if (!busy) setEditing(null); }}><div className="gl-detail"><div className="gl-detail-heading"><h2>Goal</h2><button disabled={busy} aria-label="Close" onClick={() => setEditing(null)}><Icon name="X" className="size-4" /></button></div>{error && <p role="alert" className="gl-error">{error} <button disabled={busy} onClick={() => void load()}>Refresh list</button></p>}{editing && editor}</div></dialog>
  </main></div>;

}
export default definePluginApp(app => { app.slots.navPanel({ id: 'goals', title: 'Goals', icon: 'Target', path: 'goals', component: GoalsPage }); });
