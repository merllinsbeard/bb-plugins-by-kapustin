import { useEffect, useRef, useState } from 'react';
import { definePluginApp, useComposer, useRpc } from '@get-bb/plugin-sdk/app';
import * as Popover from '@radix-ui/react-popover';
import { Button } from './components/ui/button';
import type { Role, rpcContract } from './server';
import './app.css';
import { targets, mountBridge, type Selection, type Target } from './submit-bridge';

function RolePicker() {
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const [open, setOpen] = useState(false);
  const [roles, setRoles] = useState<Role[]>([]);
  const [selected, setSelected] = useState<Role | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [changed, setChanged] = useState(false);
  const touched = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const snapshot = useRef<Selection | null>(null);
  const scope = composer.scope;
  snapshot.current = selected || changed ? { roleSlug: selected?.slug ?? null, threadId: scope.kind === 'thread' ? scope.threadId : null, projectId: scope.kind === 'new-thread' ? scope.projectId : null, text: composer.text } : null;
  useEffect(() => {
    const target: Target = { element: () => root.current, read: () => snapshot.current, prepare: selection => rpc.call('prepare', { roleSlug: selection.roleSlug, threadId: selection.threadId }) };
    targets.add(target);
    return () => { targets.delete(target); };
  }, [rpc]);
  const scopeKey = JSON.stringify(composer.scope);
  useEffect(() => {
    let alive = true;
    touched.current = false;
    setSelected(null); setChanged(false); setOpen(false);
    if (composer.scope.kind === 'thread') {
      Promise.all([rpc.call('current', { threadId: composer.scope.threadId }), rpc.call('roles', null)]).then(([current, list]) => {
        if (alive && !touched.current) setSelected(list.roles.find(r => r.slug === current.roleSlug) ?? null);
      }).catch(() => { if (alive) setError('Не удалось прочитать роль треда.'); });
    }
    return () => { alive = false; };
  }, [scopeKey, rpc]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true); setError('');
    rpc.call('roles', null).then(result => {
      if (alive) { setRoles(result.roles); setSelected(previous => result.roles.find(r => r.slug === previous?.slug) ?? null); }
    }).catch(() => { if (alive) setError('Не удалось загрузить роли. Проверьте, что Agent Roles включён.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, rpc]);
  return <div className="role-picker" ref={root}>
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild><Button type="button" variant="ghost" size="sm" aria-label={selected ? `Ролевой агент: ${selected.name}` : 'Выбрать ролевого агента'} className="role-picker-trigger" data-selected={Boolean(selected)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.25"/><path d="M5.5 20v-1.5a6.5 6.5 0 0 1 13 0V20"/></svg>
        {selected && <span>{selected.name}</span>}
      </Button></Popover.Trigger>
      <Popover.Portal><Popover.Content side="top" align="end" sideOffset={8} className="role-picker-menu" aria-label="Выбор агента">
        <div className="role-picker-heading">Агент</div>
        {loading ? <p role="status">Загрузка…</p> : error ? <p role="alert">{error}</p> : <div className="role-picker-list">
          <button type="button" aria-pressed={!selected} onClick={() => { touched.current = true; setSelected(null); setChanged(true); setOpen(false); }}><span>Без роли</span>{!selected && <Check />}</button>
          {roles.map(role => <button type="button" key={role.slug} title={role.description} aria-pressed={selected?.slug === role.slug} onClick={() => { touched.current = true; setSelected(role); setChanged(true); setOpen(false); }}><span>{role.name}</span>{selected?.slug === role.slug && <Check />}</button>)}
          {!roles.length && <p>Создайте роль в Agent Roles.</p>}
        </div>}
        <div className="role-picker-note">{composer.scope.kind === 'new-thread' ? 'Роль с первого сообщения' : 'Роль со следующего сообщения'} · в этом чате</div>
      </Popover.Content></Popover.Portal>
    </Popover.Root>

  </div>;
}
function Check() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>;

}
export default definePluginApp(app => {
  app.contentScripts.register({ id: 'native-role-submit', mount: mountBridge });
  app.composer.customize({ id: 'role-picker', scopes: ['thread', 'new-thread'], actions: [{ id: 'choose-role', component: RolePicker }] });
});
