import { useEffect, useRef, useState } from 'react';
import { definePluginApp, experimental_useSidebarThreadActions, type PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk/app';
import './style.css';
function ArchiveButton({ threadId }: PluginThreadHeaderActionProps) {
  const actions = experimental_useSidebarThreadActions();
  const root = useRef<HTMLSpanElement>(null);
  const [native, setNative] = useState(false);
  useEffect(() => {
    const header = root.current?.closest('header');
    if (!header) return;
    const check = () => setNative(Boolean(header.querySelector('button[aria-label="Archive thread"]:not([data-fast-archive])')));
    check();
    const observer = new MutationObserver(check);
    observer.observe(header, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] });
    return () => observer.disconnect();
  }, [threadId]);
  return <span ref={root}>{native ? null : <button type="button" data-fast-archive="" className="fast-archive-button" aria-label="Archive thread" title="Archive thread" onClick={() => actions.archive(threadId)}>
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 8v12h16V8M3 4h18v4H3zM9 12h6" /></svg>
  </button>}</span>;
}
export default definePluginApp(app => {
  app.slots.experimental_threadHeaderAction({ id: 'archive', title: 'Fast Archive', component: ArchiveButton });
});
