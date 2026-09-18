import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import plugin from './server.ts';
test('archives only the requested thread through the SDK and rejects invalid input', async () => {
 const host=createFakePluginHost({pluginId:'fast-archive',sdk:{threads:{archive:()=>({})}}});
 plugin(host.bb);
 try {
  assert.deepEqual(await host.harness.callRpc('archive',{threadId:'thread-demo'}),{ok:true});
  assert.equal(host.harness.sdk.callsTo('threads.archive').length,1);
  assert.equal(host.harness.sdk.callsTo('threads.delete').length,0);
  await assert.rejects(host.harness.callRpc('archive',{threadId:''}));
  assert.equal(host.harness.sdk.callsTo('threads.archive').length,1);
 } finally {await host.harness.dispose();}
});
