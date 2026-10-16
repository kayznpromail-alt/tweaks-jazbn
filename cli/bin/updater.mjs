import {createHash,randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync,lstatSync,chmodSync,openSync,closeSync,fsyncSync,rmdirSync} from 'node:fs';
import {join} from 'node:path';
import {installRoot,migrateLegacyInstallation} from './install-paths.mjs';
export {installRoot} from './install-paths.mjs';
import {spawnSync} from 'node:child_process';
import {verifyReleaseManifest} from './release-manifest.mjs';
import {releaseTrustKeys} from './release-trust.mjs';
const validVersion=/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
export const distributionOrigin='https://api.edgey.shop';
export function compareVersions(a,b){for(let i=0;i<3;i++){const d=Number(a.split('.')[i])-Number(b.split('.')[i]);if(d)return d;}return 0;}
export function validateManifest(value,platform){
 if(!value||typeof value.version!=='string'||!validVersion.test(value.version)||!value.assets||Array.isArray(value.assets))throw new Error('invalid update manifest');
 const asset=value.assets[platform];if(!asset)return null;
 if(asset.url!==`${distributionOrigin}/v1/cli-release?version=${value.version}&platform=${platform}`||!/^[a-f0-9]{64}$/.test(asset.sha256)||!Number.isSafeInteger(asset.bytes)||asset.bytes<1||asset.bytes>268435456)throw new Error('invalid update asset');
 return asset;
}
function atomicJson(path,value){const temp=path+'.'+randomBytes(6).toString('hex');let fd;try{fd=openSync(temp,'wx',0o600);writeFileSync(fd,JSON.stringify(value));fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temp,path);}finally{if(fd!==undefined)closeSync(fd);if(existsSync(temp))unlinkSync(temp);}}
function regular(path){const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw new Error('unsafe installation file');return stat;}
export async function selectExecutable(options={}){
 const root=options.root??migrateLegacyInstallation(),platform=options.platform??`${process.platform}-${process.arch}`,fetcher=options.fetcher??fetch;
 const notice=options.notice??(message=>process.stderr.write(message+'\n'));
 mkdirSync(root,{recursive:true,mode:0o700});if(lstatSync(root).isSymbolicLink())throw new Error('unsafe installation directory');
 const versions=join(root,'versions');mkdirSync(versions,{recursive:true,mode:0o700});if(lstatSync(versions).isSymbolicLink())throw new Error('unsafe versions directory');
 const pointer=join(root,'current.json'),lock=join(root,'update.lock');
 const executable=version=>join(versions,version+(platform.startsWith('win32')?'.exe':''));
 let current=null;
 if(existsSync(pointer)){
  regular(pointer);try{const value=JSON.parse(readFileSync(pointer,'utf8'));if(typeof value.version==='string'&&validVersion.test(value.version)&&value.platform===platform&&existsSync(executable(value.version))){regular(executable(value.version));current=value;}}catch{notice('saved cli version is unavailable; checking for a release.');}
 }
 if(options.offline)return current?executable(current.version):null;
 let acquired=false,temp;
 try{
  try{const fd=openSync(lock,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid}));closeSync(fd);acquired=true;}
  catch(error){
   if(error.code!=='EEXIST')throw error;
   // Serialize stale-owner recovery. A crash inside this small section blocks
   // updates until installation repair; it never blocks running the current CLI.
   const recovery=join(root,'update-recovery.lock');let recovering=false;
   try{
    try{mkdirSync(recovery,{mode:0o700});recovering=true;}catch(e){if(e.code==='EEXIST')return current?executable(current.version):null;throw e;}
    if(existsSync(lock)){
      regular(lock);const stat=lstatSync(lock);let owner;try{owner=JSON.parse(readFileSync(lock,'utf8')).pid;}catch{}
      if(Number.isInteger(owner)&&owner>0){try{process.kill(owner,0);notice('another edgey process is checking updates.');return current?executable(current.version):null;}catch(e){if(e.code!=='ESRCH')return current?executable(current.version):null;}}
      else if(Date.now()-stat.mtimeMs<60000)return current?executable(current.version):null;
      unlinkSync(lock);
    }
    const fd=openSync(lock,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid}));closeSync(fd);acquired=true;
   }finally{if(recovering)rmdirSync(recovery);}
  }
  const channel=options.channel??'stable';if(!['stable','pilot'].includes(channel))throw new Error('invalid release channel');
  const manifestUrl=distributionOrigin+'/v1/cli-release'+(options.protocol2?`?schema=2&channel=${channel}&platform=${platform}`:'');
  const response=await fetcher(manifestUrl,{redirect:'error',cache:'no-store',signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error('update service unavailable');
  let manifestText='';if(!response.body)throw new Error('empty manifest');
  for await(const part of response.body){manifestText+=Buffer.from(part).toString('utf8');if(Buffer.byteLength(manifestText)>32768)throw new Error('manifest too large');}
  let value=JSON.parse(manifestText).release;if(!value)return current?executable(current.version):null;
  let asset;
  if(options.protocol2){
    const manifest=verifyReleaseManifest(value,{channel,platform,keys:options.trustKeys??releaseTrustKeys});
    if(options.component!=='launcher'&&compareVersions(manifest.minimumLauncher,options.launcherVersion??'0.0.0')>0)throw new Error('a newer launcher is required; run the current installer');
    const component=manifest[options.component==='launcher'?'launcher':'application'];if(!component)return current?executable(current.version):null;
    value={version:component.version};asset=component.asset;
  }else asset=validateManifest(value,platform);
  if(!asset)return current?executable(current.version):null;
  if(current&&compareVersions(value.version,current.version)<=0)return executable(current.version);
  if(options.minimumVersion&&compareVersions(value.version,options.minimumVersion)<=0&&!current)return null;
  notice(`downloading edgey ${options.component==='launcher'?'launcher ':''}${value.version} · ctrl+c cancels update`);
  const download=await fetcher(asset.url,{redirect:'error',signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(300000)]):AbortSignal.timeout(300000)});
  if(!download.ok||!download.body)throw new Error('download failed');
  temp=join(versions,`.download-${randomBytes(8).toString('hex')}`);const fd=openSync(temp,'wx',0o700);let size=0;const hash=createHash('sha256');
  let progress=-1;
  try{for await(const chunk of download.body){if(options.signal?.aborted)throw new Error('update cancelled');size+=chunk.length;if(size>asset.bytes)throw new Error('download too large');hash.update(chunk);writeFileSync(fd,chunk);const step=Math.floor(size/asset.bytes*10);if(step!==progress){progress=step;notice(`download ${Math.floor(size/asset.bytes*100)}% · ${size}/${asset.bytes} bytes`);}}fsyncSync(fd);}finally{closeSync(fd);}
  if(size!==asset.bytes||hash.digest('hex')!==asset.sha256)throw new Error('download checksum mismatch');
  chmodSync(temp,0o700);
  const target=executable(value.version);
  // Windows requires an .exe extension even for a staging executable.
  const candidate=temp+(platform.startsWith('win32')?'.exe':'');if(candidate!==temp){renameSync(temp,candidate);temp=candidate;}
  const probe=options.probe??((path,version)=>{const launcher=options.component==='launcher';const result=spawnSync(path,[launcher?'--launcher-version':'--version'],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:65536});return result.status===0&&result.stdout.trim()===`edgey ${launcher?'launcher ':''}${version}`;});
  if(!await probe(temp,value.version))throw new Error('new cli failed its version check');
  if(existsSync(target)){regular(target);if(createHash('sha256').update(readFileSync(target)).digest('hex')!==asset.sha256)throw new Error('existing version differs');unlinkSync(temp);}else renameSync(temp,target);
  temp=undefined;
  atomicJson(pointer,{version:value.version,platform,previous:current?.version??null});
  options.onStatus?.('updated');notice(`edgey ${value.version} is ready.`);return target;
 }catch(error){options.onStatus?.(options.signal?.aborted?'cancelled':'failed');notice('cli update failed; keeping the installed version. '+(error?.message??'unknown error'));return current?executable(current.version):null;}
 finally{if(temp&&existsSync(temp))unlinkSync(temp);if(acquired&&existsSync(lock))unlinkSync(lock);}
}
