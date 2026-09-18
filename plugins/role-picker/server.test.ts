import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import plugin from './server.ts';
import { route, matches, decorate } from './submit-bridge.ts';
const role = {id:'r1', slug:'qa', name:'QA', description:'Checks', instructions:'Check the acceptance criteria.', color:'gray'};
function setup() {
  const writes: unknown[] = [];
  const host = createFakePluginHost({ pluginId:'role-picker', sdk: { plugins: { callRpc: () => ({roles:[role]}) }, threads: {
    getPluginMetadata: () => ({roleSlug:'qa'}), updatePluginMetadata: args => { writes.push(args); return args.set; },
  } } });
  plugin(host.bb); return {...host, writes};
}
test('existing thread receives role metadata without creating or sending a thread', async () => {
  const {harness,writes} = setup(); try {
    const result: any = await harness.callRpc('prepare', {threadId:'current', roleSlug:'qa'});
    assert.match(result.context, /Check the acceptance criteria/);
    assert.deepEqual(writes, [{threadId:'current', pluginId:'agent-roles', set:{roleId:'r1',roleSlug:'qa',roleName:'QA',roleColor:'gray'}}]);
    assert.equal(harness.sdk.callsTo('threads.spawn').length,0);
    assert.equal(harness.sdk.callsTo('threads.send').length,0);
  } finally {await harness.dispose();}
});
test('new thread preparation creates no thread; invalid role fails closed; clear overrides legacy role', async () => {
 const {harness,writes} = setup(); try {
   await harness.callRpc('prepare',{threadId:null,roleSlug:'qa'}); assert.equal(writes.length,0);
   await assert.rejects(harness.callRpc('prepare',{threadId:'current',roleSlug:'missing'})); assert.equal(writes.length,0);
   const result: any = await harness.callRpc('prepare',{threadId:'current',roleSlug:null}); assert.equal(result.metadata.roleSlug,'');
   assert.match(result.context,/deselected/);
   assert.deepEqual(await harness.callRpc('current',{threadId:'current'}),{roleSlug:'qa'});
 } finally {await harness.dispose();}
});
test('only same-origin native create/send endpoints are decorated', () => {
 assert.deepEqual(route('/api/v1/threads/t1/send','https://bb.test','POST'),{threadId:'t1'});
 assert.deepEqual(route('/api/v1/threads','https://bb.test','POST'),{threadId:null});
 for(const url of ['https://evil.test/api/v1/threads','/api/v1/threads/t1/retry','/api/v1/plugins/role-picker/rpc/prepare']) assert.equal(route(url,'https://bb.test','POST'),null);
 assert.equal(route('/api/v1/threads','https://bb.test','GET'),null);
});
test('new composer matching excludes unrelated projects, forks, plugins and drafts', () => {
 const selection={roleSlug:'qa',threadId:null,projectId:'p1',text:'Hello'};
 const body={projectId:'p1',origin:'web',input:[{type:'text',text:'Hello'}]};
 assert.equal(matches(selection,null,body),true);
 for (const patch of [{projectId:'p2'},{origin:'plugin'},{parentThreadId:'t1'},{input:[{type:'text',text:'Other'}]}]) assert.equal(matches(selection,null,{...body,...patch}),false);
});
test('decoration preserves native attachments, mentions, settings, schedule and original text', () => {
 const input=[{type:'text',text:'Hello',mentions:[{start:0,end:5,resource:{kind:'file',path:'a'}}]},{type:'localFile',path:'/tmp/a'}];
 const original={input,projectId:'p1',model:'model',environment:{type:'reuse',environmentId:'e1'},sendAt:123,mode:'queue'};
 const prepared={metadata:{roleSlug:'qa'},context:'Role instructions'};
 const next=decorate(original,prepared,true);
 assert.equal(next.originPluginId,'agent-roles'); assert.deepEqual(next.pluginMetadata,{roleSlug:'qa'});
 assert.deepEqual((next.input as any[]).slice(0,2),input);
 assert.equal((next.input as any[])[2].visibility,'agent-only'); assert.equal(input.length,2);
 for(const key of ['projectId','model','environment','sendAt','mode']) assert.deepEqual(next[key],original[key as keyof typeof original]);
 assert.equal(decorate(original,prepared,false).originPluginId,undefined);
});
