// BB 0.4.87 has no composer submit middleware. A scoped, full-trust content
// script decorates only the native send/create request, leaving its pipeline,
// draft restoration, uploads, mentions, execution tuple and response untouched.
export type Selection = { roleSlug: string | null; threadId: string | null; projectId: string | null; text: string };
export type Prepared = { metadata: Record<string, string>; context: string };
export type Target = { element: () => HTMLElement | null; read: () => Selection | null; prepare: (selection: Selection) => Promise<Prepared> };
export const targets = new Set<Target>();
export function route(url: string, origin: string, method: string): { threadId: string | null } | null {
  const parsed = new URL(url, origin);
  if (parsed.origin !== origin || method !== 'POST') return null;
  if (parsed.pathname === '/api/v1/threads') return { threadId: null };
  const match = /^\/api\/v1\/threads\/([^/]+)\/send$/.exec(parsed.pathname);
  return match ? { threadId: decodeURIComponent(match[1]!) } : null;
}
export function matches(selection: Selection, threadId: string | null, body: Record<string, unknown>): boolean {
  if (selection.threadId !== threadId || !Array.isArray(body.input)) return false;
  if (threadId) return true;
  if (body.origin === 'plugin' || body.parentThreadId || body.sourceThreadId || body.originKind) return false;
  return selection.projectId === body.projectId && body.input.filter(b => b.type === 'text' && b.visibility !== 'agent-only').map(b => b.text).join('').trim() === selection.text.trim();
}
export function decorate(body: Record<string, unknown>, prepared: Prepared, isNew: boolean): Record<string, unknown> {
  return { ...body,
    ...(isNew ? { origin: 'plugin', originPluginId: 'agent-roles', pluginMetadata: prepared.metadata } : {}),
    input: [...body.input as unknown[], { type: 'text', text: prepared.context, mentions: [], visibility: 'agent-only' }],
  };
}
export function mountBridge() {
  const previous = window.fetch;
  let alive = true;
  let active: { target: Target; selection: Selection | null } | null = null;
  const capture = (event: Event) => {
    if (!(event.target instanceof Node)) return;
    for (const target of targets) {
      const form = target.element()?.closest('form');
      if (form?.contains(event.target)) {
        const selection = target.read();
        active = { target, selection };
        return;
      }
    }
    active = null;
  };
  for (const event of ['pointerdown', 'focusin', 'keydown', 'submit']) document.addEventListener(event, capture, true);
  const wrapped: typeof fetch = async (input, init) => {
    if (!alive) return previous.call(window, input, init);
    const url = input instanceof Request ? input.url : String(input);
    const destination = route(url, location.origin, (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase());
    if (!destination) return previous.call(window, input, init);
    const actual = input instanceof Request ? new Request(input, init) : new Request(new URL(url, location.origin), init);
    const body = await actual.clone().json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return previous.call(window, input, init);
    const candidates = [...targets].map(target => ({ target, selection: target.read() })).filter((item): item is { target: Target; selection: Selection } => Boolean(item.selection && matches(item.selection, destination.threadId, body)));
    // An explicitly active composer with no role must never borrow a role
    // from another split pane with an identical draft.
    const chosen = active && targets.has(active.target)
      ? active.selection && matches(active.selection, destination.threadId, body) ? { target: active.target, selection: active.selection } : undefined
      : candidates.length === 1 ? candidates[0] : undefined;
    if (!chosen) return previous.call(window, input, init);
    const prepared = await chosen.target.prepare(chosen.selection);
    actual.signal.throwIfAborted();
    const headers = new Headers(actual.headers);
    headers.set('content-type', 'application/json');
    return previous.call(window, new Request(actual, { headers, body: JSON.stringify(decorate(body, prepared, destination.threadId === null)) }));
  };
  window.fetch = wrapped;
  return () => {
    alive = false;
    for (const event of ['pointerdown', 'focusin', 'keydown', 'submit']) document.removeEventListener(event, capture, true);
    if (window.fetch === wrapped) window.fetch = previous;
  };
}
