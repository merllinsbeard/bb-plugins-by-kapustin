import {defineRpcContract, type BbPluginApi} from '@get-bb/plugin-sdk';
import {z} from 'zod';
import {readNavigationHeadings, setNavigationHeading} from './headings.ts';
import {moveBefore, navigationKey, visibleKeys} from './navigation.ts';
const key = z.string().min(1).max(200);
const revision = z.number().int().nonnegative();
const keys = z.array(key).max(1000);
const output = z.object({
  headings: z.record(z.string(), z.string()), order: keys, visible: keys.nullable(),
  orderRevision: revision, visibleRevision: revision,
});
export const rpcContract = defineRpcContract({
  get: {input: z.null(), output},
  save: {input: z.object({key, title: z.string().trim().max(120)}).strict(), output},
  move: {input: z.object({key, target: key, keys, expectedRevision: revision}).strict(), output},
  visibility: {input: z.object({key, visible: z.boolean(), keys, expectedRevision: revision}).strict(), output},
});
export default function plugin(bb: BbPluginApi) {
  const get = async () => {
    const {preferences} = await bb.sdk.system.uiPreferences.list();
    const order = preferences['sidebar.pluginPanelOrder'];
    const visible = preferences['sidebar.visiblePluginPanels'];
    return {headings: Object.fromEntries(readNavigationHeadings(order.value)), order: order.value,
      visible: visible.value, orderRevision: order.revision, visibleRevision: visible.revision};
  };
  let pending: Promise<unknown> = Promise.resolve();
  const serialize = <T,>(operation: () => Promise<T>): Promise<T> => {
    const work = pending.catch(() => undefined).then(operation);
    pending = work;
    return work;
  };
  const changed = () => {bb.realtime.publish('headings-changed', {}); return get();};
  bb.rpc.register(rpcContract, {
    get,
    save: ({key, title}) => serialize(async () => {
      const current = await get();
      await bb.sdk.system.uiPreferences.set({key: 'sidebar.pluginPanelOrder', expectedRevision: current.orderRevision,
        value: setNavigationHeading(current.order, key, title)});
      return changed();
    }),
    move: ({key, target, keys, expectedRevision}) => serialize(async () => {
      const current = await get();
      if (current.orderRevision !== expectedRevision) throw new Error('Navigation changed elsewhere. Refresh and try again.');
      if (navigationKey(key) === navigationKey(target)) return current;
      await bb.sdk.system.uiPreferences.set({key: 'sidebar.pluginPanelOrder', expectedRevision,
        value: moveBefore(current.order, keys, navigationKey(key), navigationKey(target))});
      return changed();
    }),
    visibility: ({key, visible, keys, expectedRevision}) => serialize(async () => {
      const current = await get();
      if (current.visibleRevision !== expectedRevision) throw new Error('Visibility changed elsewhere. Refresh and try again.');
      const canonical = navigationKey(key);
      if (!keys.map(navigationKey).includes(canonical)) throw new Error('Unknown navigation destination.');
      const previous = visibleKeys(keys.map(navigationKey), current.visible);
      const next = visible ? [...new Set([...previous, canonical])] : previous.filter(item => item !== canonical);
      await bb.sdk.system.uiPreferences.set({key: 'sidebar.visiblePluginPanels', expectedRevision, value: next});
      return changed();
    }),
  });
}
