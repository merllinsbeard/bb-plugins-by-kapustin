import test from 'node:test';import assert from 'node:assert/strict';
import {safePath,containsCredential,chunkLines,selectChunks,renderSelection} from './selector.ts';
const chunks=[{id:'c0',start:1,end:20,text:'unrelated formatting output',keep:false},{id:'c1',start:21,end:40,text:'Error: connection refused',keep:true},{id:'c2',start:41,end:60,text:'connection settings',keep:false}];
const response=(answers:unknown,status=200)=>async()=>new Response(JSON.stringify({answers}),{status});
test('keeps critical content and uncertain matches, omits only strong negatives',async()=>{
 const result=await selectChunks(chunks,'Fix the connection','test-only',undefined,response({c0:{type:'noul',noul:.02},c2:{type:'noul',noul:.5}}));
 assert.deepEqual(result.chunks.map(c=>c.id),['c1','c2']);assert.deepEqual(result.omitted,[{start:1,end:20}]);assert.match(renderSelection('src/client.ts',result),/Read omitted ranges/);
});
test('errors and incomplete decisions return the entire original range',async()=>{
 for(const request of [response({},503),response({c0:{type:'noul',noul:0}}),async()=>{throw new Error('private response detail');}]){
  const result=await selectChunks(chunks,'Task','test-only',undefined,request);assert.equal(result.mode,'fallback');assert.deepEqual(result.chunks,chunks);assert.doesNotMatch(JSON.stringify(result),/private response/);
 }
});
test('blocks secret paths and credentials before a network request',async()=>{
 for(const path of ['../x','.env','src/.env.local','/etc/passwd','a/../b','id_rsa','cert.pem','a\\b','secrets/token'])assert.equal(safePath(path),false,path);
 assert.equal(safePath('src/app.ts'),true);assert.equal(containsCredential('API_KEY = '+ 'x'.repeat(30)),true);
 let called=false;await assert.rejects(selectChunks([{...chunks[0],text:'password='+ 'x'.repeat(30)}],'task','test-only',undefined,async()=>{called=true;return new Response();}),/Nothing was sent/);assert.equal(called,false);
});
test('chunking retains original line ranges and protects constraints',()=>{
 const result=chunkLines(Array.from({length:41},(_,i)=>i===21?'Never overwrite existing data':'line '+i).join('\n'),50);
 assert.deepEqual(result.map(c=>[c.start,c.end]),[[50,69],[70,89],[90,90]]);assert.equal(result[1].keep,true);
});
test('cancellation propagates instead of returning an apparently successful fallback',async()=>{
 const controller=new AbortController();controller.abort();await assert.rejects(selectChunks(chunks,'task','test-only',controller.signal,async()=>{throw new Error('abort');}),/cancelled/);
});
