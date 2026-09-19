export function navigationKey(id: string): string {
  if (id === 'plugin-panel:automations/automations') return '__bb__/automations';
  if (id.startsWith('plugin-panel:')) return id.slice('plugin-panel:'.length);
  if (['new-thread', 'search-threads', 'extensions', 'skills', 'automations'].includes(id)) return `__bb__/${id}`;
  return id;
}

export function orderedKeys(keys: readonly string[], order: readonly string[]): string[] {
  const available = new Set(keys.map(navigationKey));
  return [...new Set([...order.map(navigationKey), ...available])].filter(key => available.has(key));
}

export function visibleKeys(keys: readonly string[], visible: readonly string[] | null): string[] {
  return visible === null ? keys.filter(key => key !== '__bb__/search-threads') : [...new Set(visible.map(navigationKey))];
}

export function moveBefore(order: readonly string[], available: readonly string[], key: string, target: string): string[] {
  const keys = orderedKeys(available, order);
  if (!keys.includes(key) || !keys.includes(target)) throw new Error('Navigation destination changed. Refresh and try again.');
  const next = keys.filter(item => item !== key);
  next.splice(next.indexOf(target), 0, key);
  return [...next, ...order.filter(item => !keys.includes(navigationKey(item)))];
}
