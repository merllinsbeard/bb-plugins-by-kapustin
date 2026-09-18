import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import plugin from './server.ts';

const profile = { id:'remote', slug:'analyst', name:'Remote analyst', description:'Imported profile', instructions:'Inspect the release.', providerId:null, model:null, reasoningLevel:null, permissionMode:null, color:'blue', sortOrder:0, createdAt:1, updatedAt:1 };
const workflow = { id:'remote-team', slug:'release', name:'Release', description:'Imported workflow', nodes:[{id:'inspect',roleSlug:'analyst',label:'Inspect',prompt:'{task}',inputs:[],final:true}], createdAt:1,updatedAt:1 };

test('standalone workflow profiles and graph CRUD need no companion RPC or Tasks', async () => {
 const host = createFakePluginHost({pluginId:'visual-workflows'});
 try {
  await plugin(host.bb);
  const roles:any = await host.harness.callRpc('roles_list',null);
  const teams:any = await host.harness.callRpc('teams_list',null);
  assert.equal(roles.roles.length,6); assert.ok(teams.teams.length >= 2);
  assert.equal(host.harness.sdk.callsTo('plugins.callRpc').length,0);
  await assert.rejects(host.harness.callRpc('teams_create',{slug:'bad',name:'Bad',description:'',nodes:[{...workflow.nodes[0],roleSlug:'missing'}]}),/unknown role/);
 } finally { await host.harness.dispose(); }
});

test('imports remap references, refresh copies and survive removal of the companion', async () => {
 let available = true; let name = profile.name;
 const host = createFakePluginHost({pluginId:'visual-workflows',sdk:{plugins:{
  list:()=>({plugins:available?[{id:'agent-roles',enabled:true,status:'running'}]:[]}),
  callRpc:args=>args.method==='roles_list'?{roles:[{...profile,name}]}:{teams:[workflow]},
 }}});
 try {
  await plugin(host.bb);
  assert.deepEqual(await host.harness.callRpc('import_companion',null),{roles:1,workflows:1});
  let roles:any = await host.harness.callRpc('roles_list',null);
  const imported = roles.roles.find((r:any)=>r.slug.startsWith('ar-'));
  assert.ok(imported); assert.notEqual(imported.slug,profile.slug);
  let teams:any = await host.harness.callRpc('teams_list',null);
  assert.equal(teams.teams.find((t:any)=>t.name==='Release').nodes[0].roleSlug,imported.slug);
  name='Refreshed analyst'; await host.harness.callRpc('import_companion',null);
  roles=await host.harness.callRpc('roles_list',null);
  assert.equal(roles.roles.length,7); assert.equal(roles.roles.find((r:any)=>r.id===imported.id).name,name);
  available=false;
  await assert.rejects(host.harness.callRpc('import_companion',null),/Enable Agent Roles/);
  roles=await host.harness.callRpc('roles_list',null);
  assert.equal(roles.roles.length,7);
  assert.equal(host.harness.sdk.callsTo('threads.spawn').length,0);
 } finally { await host.harness.dispose(); }
});

test('invalid companion workflow rolls back the import without adding profiles', async () => {
 const host=createFakePluginHost({pluginId:'visual-workflows',sdk:{plugins:{
  list:()=>({plugins:[{id:'agent-roles',enabled:true,status:'running'}]}),
  callRpc:args=>args.method==='roles_list'?{roles:[profile]}:{teams:[{...workflow,nodes:[{...workflow.nodes[0],roleSlug:'missing'}]}]},
 }}});
 try {await plugin(host.bb); await assert.rejects(host.harness.callRpc('import_companion',null),/missing roles/); const result:any=await host.harness.callRpc('roles_list',null);assert.equal(result.roles.length,6);}
 finally {await host.harness.dispose();}
});
