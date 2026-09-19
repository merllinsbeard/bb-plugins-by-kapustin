import test from 'node:test';
import assert from 'node:assert/strict';
import {createFakePluginHost} from '@get-bb/plugin-sdk/testing';
import plugin from './server.ts';
import {setNavigationHeading, readNavigationHeadings} from './headings.ts';
import {navigationKey, orderedKeys, visibleKeys} from './navigation.ts';
function setup(order: string[], visible: string[] | null = null) {
 const preferences = {'sidebar.pluginPanelOrder': {revision: 1, value: order}, 'sidebar.visiblePluginPanels': {revision: 1, value: visible}};
 const host = createFakePluginHost({pluginId: 'sidebar-subtitles', sdk: {system: {uiPreferences: {
  list: () => ({preferences: structuredClone(preferences)}),
  set: args => {const entry = preferences[args.key as keyof typeof preferences]; assert.equal(args.expectedRevision, entry.revision, 'Preference revision conflict'); entry.revision++; entry.value = args.value as string[]; return {preference: structuredClone(entry)};},
 }}}});
 plugin(host.bb); return {...host, preferences};
}
test('maps SDK IDs to native preference keys, including Automations', () => {
 assert.equal(navigationKey('new-thread'), '__bb__/new-thread');
 assert.equal(navigationKey('plugin-panel:tools/main'), 'tools/main');
 assert.equal(navigationKey('plugin-panel:automations/automations'), '__bb__/automations');
});
test('respects native order and null versus all-hidden visibility', () => {
 const keys = ['__bb__/new-thread', '__bb__/search-threads', 'one/panel', 'two/panel'];
 assert.deepEqual(orderedKeys(keys, ['two/panel', '__bb_heading__/[]', 'missing/panel', 'one/panel']), ['two/panel', 'one/panel', '__bb__/new-thread', '__bb__/search-threads']);
 assert.deepEqual(visibleKeys(keys, null), ['__bb__/new-thread', 'one/panel', 'two/panel']);
 assert.deepEqual(visibleKeys(keys, []), []);
});
test('heading aliases rename and delete together without changing destination order', () => {
 const order = ['one/panel', 'two/panel', '__bb_heading__/["one/panel","Old"]', '__bb_heading__/["plugin-panel:one/panel","Current"]'];
 assert.deepEqual(Object.fromEntries(readNavigationHeadings(order)), {'one/panel': 'Current'});
 const changed = setNavigationHeading(order, 'plugin-panel:one/panel', ' Renamed ');
 assert.deepEqual(changed.slice(0, 2), ['one/panel', 'two/panel']);
 assert.deepEqual(Object.fromEntries(readNavigationHeadings(changed)), {'one/panel': 'Renamed'});
 assert.equal(readNavigationHeadings(setNavigationHeading(changed, 'one/panel', '')).size, 0);
});
test('simultaneous heading edits preserve each other', async () => {
 const h = setup(['one/panel', 'two/panel']);
 try {await Promise.all([h.harness.callRpc('save', {key:'one/panel', title:'Work'}), h.harness.callRpc('save', {key:'two/panel',title:'Tools'})]);
 assert.deepEqual(Object.fromEntries(readNavigationHeadings(h.preferences['sidebar.pluginPanelOrder'].value)), {'one/panel':'Work','two/panel':'Tools'});
 } finally {await h.harness.dispose();}
});
test('move preserves hidden and uninstalled destinations and headings; rejects stale reorder', async () => {
 const h = setup(setNavigationHeading(['one/panel','hidden/panel','two/panel','uninstalled/panel'],'one/panel','Work'), ['one/panel','two/panel']);
 try {
  const input={key:'two/panel',target:'one/panel',keys:['one/panel','hidden/panel','two/panel'],expectedRevision:1};
  await h.harness.callRpc('move',input);
  assert.deepEqual(h.preferences['sidebar.pluginPanelOrder'].value.slice(0,4),['two/panel','one/panel','hidden/panel','uninstalled/panel']);
  assert.deepEqual(Object.fromEntries(readNavigationHeadings(h.preferences['sidebar.pluginPanelOrder'].value)),{'one/panel':'Work'});
  assert.deepEqual(h.preferences['sidebar.visiblePluginPanels'].value,['one/panel','two/panel']);
  await assert.rejects(h.harness.callRpc('move',input),/changed elsewhere/);
 } finally {await h.harness.dispose();}
});
test('hide/show preserves unrelated visibility and order; rejects stale toggles', async () => {
 const h=setup(['one/panel','two/panel'],['one/panel','uninstalled/panel']);
 try {
  const input={key:'one/panel',visible:false,keys:['one/panel','two/panel'],expectedRevision:1};
  await h.harness.callRpc('visibility',input);
  assert.deepEqual(h.preferences['sidebar.visiblePluginPanels'].value,['uninstalled/panel']);
  await h.harness.callRpc('visibility',{...input,key:'plugin-panel:two/panel',visible:true,expectedRevision:2});
  assert.deepEqual(h.preferences['sidebar.visiblePluginPanels'].value,['uninstalled/panel','two/panel']);
  await assert.rejects(h.harness.callRpc('visibility',input),/changed elsewhere/);
  assert.deepEqual(h.preferences['sidebar.pluginPanelOrder'].value,['one/panel','two/panel']);
 } finally {await h.harness.dispose();}
});
test('first hide uses native defaults and does not reveal Search', async () => {
 const h=setup([]);
 try {await h.harness.callRpc('visibility',{key:'one/panel',visible:false,keys:['__bb__/new-thread','__bb__/search-threads','one/panel'],expectedRevision:1});
 assert.deepEqual(h.preferences['sidebar.visiblePluginPanels'].value,['__bb__/new-thread']);
 } finally {await h.harness.dispose();}
});
test('storage conflicts propagate without erasing saved headings', async () => {
 const initial=setNavigationHeading(['one/panel'],'one/panel','Saved');
 const h=createFakePluginHost({pluginId:'sidebar-subtitles',sdk:{system:{uiPreferences:{list:()=>({preferences:{'sidebar.pluginPanelOrder':{revision:1,value:initial},'sidebar.visiblePluginPanels':{revision:0,value:null}}}),set:()=>{throw new Error('Preference revision conflict');}}}}});
 try {plugin(h.bb);await assert.rejects(h.harness.callRpc('save',{key:'one/panel',title:'Draft'}),/conflict/);assert.deepEqual((await h.harness.callRpc('get',null) as {headings:object}).headings,{'one/panel':'Saved'});}finally{await h.harness.dispose();}
});
