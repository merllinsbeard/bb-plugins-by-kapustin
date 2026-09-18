import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {initialize} from './initializer.ts';
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
test('initializer rejects relative or non-BB destinations before running commands',async()=>{
 await assert.rejects(initialize({checkout:'relative',target:'/tmp/anything',mode:'check'},'/tmp'),/absolute/);
 await assert.rejects(initialize({checkout:'/tmp/source',target:'/tmp/anything',mode:'initialize'},'/tmp'),/bb-app/);
});
test('restore protects newer installations and restores only the matching saved frontend',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lock-area-test-'));const target=join(root,'node_modules/bb-app/app/dist');const backup=join(root,'backup');
 try{
  await mkdir(target,{recursive:true});await mkdir(join(backup,'dist'),{recursive:true});
  await writeFile(join(target,'../../package.json'),JSON.stringify({name:'bb-app',version:'0.43.1'}));
  await writeFile(join(target,'index.html'),'newer');await writeFile(join(backup,'dist/index.html'),'original');
  await writeFile(join(backup,'lock-area-backup.json'),JSON.stringify({target,after:digest('patched')}));
  const input={checkout:root,target,mode:'restore' as const,backup};
  await assert.rejects(initialize(input,root),/changed/);assert.equal(await readFile(join(target,'index.html'),'utf8'),'newer');
  await writeFile(join(target,'index.html'),'patched');await initialize(input,root);assert.equal(await readFile(join(target,'index.html'),'utf8'),'original');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('unsupported installed versions fail before source mutation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lock-area-version-'));const target=join(root,'node_modules/bb-app/app/dist');
 try{await mkdir(target,{recursive:true});await writeFile(join(target,'../../package.json'),JSON.stringify({name:'bb-app',version:'0.99.0'}));await assert.rejects(initialize({checkout:root,target,mode:'initialize'},root),/0.43.1 only/);}
 finally{await rm(root,{recursive:true,force:true});}
});

test('concurrent operations cannot enter the same installation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lock-area-lock-'));const target=join(root,'node_modules/bb-app/app/dist');
 try{await mkdir(target,{recursive:true});await mkdir(join(target,'../.lock-area-operation'));await assert.rejects(initialize({checkout:root,target,mode:'check'},root),/Another Lock Area operation/);}
 finally{await rm(root,{recursive:true,force:true});}
});
