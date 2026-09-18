import test from 'node:test';import assert from 'node:assert/strict';
import {createFakePluginHost} from '@get-bb/plugin-sdk/testing';import plugin from './server.ts';import {setNavigationHeading,readNavigationHeadings} from './headings.ts';
test('edits preserve order and other headings; empty title removes only the target',()=>{
 const initial=setNavigationHeading(['one/panel','two/panel'],'two/panel','Tools');
 const updated=setNavigationHeading(initial,'one/panel','  Work  ');
 assert.deepEqual(updated.slice(0,2),['one/panel','two/panel']);
 assert.deepEqual(Object.fromEntries(readNavigationHeadings(updated)),{'one/panel':'Work','two/panel':'Tools'});
 assert.deepEqual(Object.fromEntries(readNavigationHeadings(setNavigationHeading(updated,'one/panel',''))),{'two/panel':'Tools'});
});
test('writes use current preference revision and serialise simultaneous edits',async()=>{
 let entry={revision:1,value:['one/panel','two/panel']};
 const host=createFakePluginHost({pluginId:'sidebar-subtitles',sdk:{system:{uiPreferences:{list:()=>({preferences:{'sidebar.pluginPanelOrder':structuredClone(entry)}}),set:args=>{assert.equal(args.expectedRevision,entry.revision);entry={revision:entry.revision+1,value:args.value as string[]};return {preference:entry};}}}}});
 try{plugin(host.bb);await Promise.all([host.harness.callRpc('save',{key:'one/panel',title:'Work'}),host.harness.callRpc('save',{key:'two/panel',title:'Tools'})]);assert.deepEqual(await host.harness.callRpc('get',null),{headings:{'one/panel':'Work','two/panel':'Tools'}});}finally{await host.harness.dispose();}
});
test('a revision conflict is surfaced and does not erase the old headings',async()=>{
 const initial=setNavigationHeading(['one/panel'],'one/panel','Saved');
 const host=createFakePluginHost({pluginId:'sidebar-subtitles',sdk:{system:{uiPreferences:{list:()=>({preferences:{'sidebar.pluginPanelOrder':{revision:1,value:initial}}}),set:()=>{throw new Error('Preference revision conflict');}}}}});
 try{plugin(host.bb);await assert.rejects(host.harness.callRpc('save',{key:'one/panel',title:'Draft'}),/conflict/);assert.deepEqual(await host.harness.callRpc('get',null),{headings:{'one/panel':'Saved'}});}finally{await host.harness.dispose();}
});
