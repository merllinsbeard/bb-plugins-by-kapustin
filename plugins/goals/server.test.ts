import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost, makePluginAgentConfigurationContext } from '@get-bb/plugin-sdk/testing';
import plugin from './server.ts';
test('version conflicts, global-only goals and current instructions', async () => {
 const { bb, harness } = createFakePluginHost({ pluginId: 'goals' });
 plugin(bb);
 try {
  const input = { scope: 'global', revision: 0, course: 'Shared course', priorities: '', constraints: '' };
  await harness.behavior.callRpc('save', input);
  await assert.rejects(() => harness.behavior.callRpc('save', input));
  await assert.rejects(() => harness.behavior.callRpc('save', { ...input, scope: 'another-project', course: 'OTHER PROJECT' }));
  const resolved = await harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext());
  assert.match(JSON.stringify(resolved), /When the user asks/);
  assert.doesNotMatch(JSON.stringify(resolved), /Shared course/);
  assert.doesNotMatch(JSON.stringify(resolved), /OTHER PROJECT/);
  await assert.rejects(() => harness.behavior.callRpc('save', { ...input, revision: 1, course: 'x'.repeat(801) }));
  const cli = await harness.behavior.runCli(['show']);
  assert.match(cli.stdout ?? '', /Shared course/);
 } finally { await harness.lifecycle.dispose(); }
});
test('board migrates legacy text, preserves order, excludes completed goals and rejects stale updates', async () => {
 const { bb, harness } = createFakePluginHost({ pluginId: 'goals' });
 plugin(bb);
 try {
  await harness.behavior.callRpc('save', { scope: 'global', revision: 0, course: 'Legacy course', priorities: 'Legacy focus', constraints: '' });
  const migrated = await harness.behavior.callRpc('boardRead', null) as any;
  assert.deepEqual(migrated.items.map((i: any) => i.text), ['Legacy course', 'Legacy focus']);
  const items = [{ id: 'b', text: 'First priority', done: false }, { id: 'a', text: 'Second priority', done: false }, { id: 'c', text: 'Finished', done: true }];
  await harness.behavior.callRpc('boardSave', { items, revision: 0 });
  await assert.rejects(() => harness.behavior.callRpc('boardSave', { items: [], revision: 0 }));
  const cli = await harness.behavior.runCli(['show']);
  assert.match(cli.stdout ?? '', /1\. First priority[\s\S]*2\. Second priority/);
  assert.doesNotMatch(cli.stdout ?? '', /Finished|Legacy course/);
  assert.deepEqual((await harness.behavior.callRpc('boardRead', null) as any).items, items);
 } finally { await harness.lifecycle.dispose(); }
});
