import {readFile,writeFile,mkdir,mkdtemp,cp,rename,access,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve,isAbsolute,join} from 'node:path';
import {createHash} from 'node:crypto';
import {BASE_COMMIT,PATCH} from './patch-data.ts';
const execute=promisify(execFile);
const hash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
async function initializeUnlocked(input:{checkout:string;target:string;mode:'check'|'initialize'|'restore';backup?:string},scratch:string,signal?:AbortSignal){
 if(!isAbsolute(input.checkout)||!isAbsolute(input.target))throw new Error('Checkout and target must be absolute paths.');
 const checkout=resolve(input.checkout);const target=resolve(input.target);
 if(!target.endsWith('/node_modules/bb-app/app/dist'))throw new Error('Target must be the bb-app/app/dist directory in an existing BB installation.');
 const run=async(command:string,args:string[])=>{try{return (await execute(command,args,{cwd:checkout,signal,maxBuffer:8*1024*1024,timeout:20*60*1000})).stdout.trim();}catch{throw new Error(command+' failed. The installation was not replaced; inspect the checkout build locally.');}};
 const installed=JSON.parse(await readFile(join(target,'../../package.json'),'utf8'));
 if(installed.name!=='bb-app'||installed.version!=='0.43.1')throw new Error('Initializer supports BB 0.43.1 only. Use native locking on other versions or wait for a tested adapter.');
 const entry=join(target,'index.html');
 const originalIndexHash=hash(await readFile(entry));
 if(input.mode==='restore'){
  if(!input.backup||!isAbsolute(input.backup))throw new Error('Provide the absolute backup path from initialization.');
  const manifest=JSON.parse(await readFile(join(input.backup,'lock-area-backup.json'),'utf8'));
  if(manifest.target!==target||hash(await readFile(entry))!==manifest.after)throw new Error('BB has changed since this backup. Refusing to overwrite a newer installation.');
  await cp(join(input.backup,'dist'),target,{recursive:true});
  return {message:'Restored the saved frontend. Refresh BB.',backup:input.backup};
 }
 const commit=await run('git',['rev-parse','HEAD']);
 if(commit!==BASE_COMMIT)throw new Error('Use a BB source checkout at the supported commit '+BASE_COMMIT+'.');
 if(await run('git',['status','--porcelain']))throw new Error('The source checkout contains changes. Use a separate clean checkout to preserve your work.');
 const patchFile=join(scratch,'lock-area.patch');await writeFile(patchFile,PATCH);
 await run('git',['apply','--check',patchFile]);
 if(input.mode==='check')return {message:'Compatible source checkout and installation. Initialization can build and deploy the native lock enhancement.',backup:null};
 await access(join(checkout,'node_modules'));
 await run('git',['apply',patchFile]);
 await run('pnpm',['exec','turbo','run','test','--filter=@bb/app','--','src/lib/split-layout/locking.test.ts']);
 await run('pnpm',['exec','turbo','run','build','typecheck','--filter=@bb/app']);
 const built=join(checkout,'apps/app/dist');await access(join(built,'index.html'));
 if(hash(await readFile(entry))!==originalIndexHash)throw new Error('The installed frontend changed during the build. Nothing was deployed.');
 const backup=join(target,'../lock-area-backup-'+Date.now());await mkdir(backup,{recursive:true});
 await cp(target,join(backup,'dist'),{recursive:true});
 const before=hash(await readFile(entry));const after=hash(await readFile(join(built,'index.html')));
 await writeFile(join(backup,'lock-area-backup.json'),JSON.stringify({target,before,after,baseCommit:BASE_COMMIT},null,2));
 const staging=join(scratch,'frontend');await cp(built,staging,{recursive:true});
 await rm(join(staging,'index.html'));
 for(const suffix of ['.br','.gz'])await rm(join(staging,'index.html'+suffix),{force:true});
 await cp(staging,target,{recursive:true});
 await writeFile(join(target,'index.html.lock-area-next'),await readFile(join(built,'index.html')));
 await rename(join(target,'index.html.lock-area-next'),entry);
 for(const suffix of ['.br','.gz'])await rm(join(target,'index.html'+suffix),{force:true});
 if(hash(await readFile(entry))!==after)throw new Error('Deployment verification failed. Restore from the backup.');
 return {message:'Native pane locking initialized. Refresh BB. Existing hashed assets were retained.',backup};
}

export async function initialize(input:{checkout:string;target:string;mode:'check'|'initialize'|'restore';backup?:string},scratch:string,signal?:AbortSignal){
 if(!isAbsolute(input.checkout)||!isAbsolute(input.target))throw new Error('Checkout and target must be absolute paths.');
 const target=resolve(input.target);
 if(!target.endsWith('/node_modules/bb-app/app/dist'))throw new Error('Target must be the bb-app/app/dist directory in an existing BB installation.');
 const lock=join(target,'../.lock-area-operation');
 try{await mkdir(lock);}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new Error('Another Lock Area operation is active. If its process stopped, remove the stale .lock-area-operation directory beside app/dist before retrying.');throw e;}
 let work:string|undefined;
 try{await mkdir(scratch,{recursive:true});work=await mkdtemp(join(scratch,'lock-area-'));return await initializeUnlocked(input,work,signal);}
 finally{if(work)await rm(work,{recursive:true,force:true});await rm(lock,{recursive:true,force:true});}
}
