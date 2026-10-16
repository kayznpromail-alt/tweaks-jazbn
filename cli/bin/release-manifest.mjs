import { createPublicKey, verify } from 'node:crypto';
const version=/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const origin='https://api.edgey.shop';
export function canonical(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
export function verifyReleaseManifest(value,{channel,platform,keys={}}){
  const fail=()=>{throw new Error('invalid or untrusted release manifest');};
  if(!value||value.schemaVersion!==2||value.channel!==channel||value.platform!==platform
    ||!['stable','pilot'].includes(channel)||typeof value.minimumLauncher!=='string'||!version.test(value.minimumLauncher)
    ||Object.keys(value).some(k=>!['schemaVersion','channel','platform','minimumLauncher','application','launcher','signature'].includes(k)))fail();
  for(const component of ['application','launcher']){
    const item=value[component];if(component==='launcher'&&item===undefined)continue;
    if(!item||typeof item.version!=='string'||!version.test(item.version)||Object.keys(item).sort().join()!=='asset,version')fail();
    const asset=item.asset;
    if(!asset||Object.keys(asset).sort().join()!=='bytes,sha256,url'||!/^[a-f0-9]{64}$/.test(asset.sha256)
      ||!Number.isSafeInteger(asset.bytes)||asset.bytes<1||asset.bytes>268435456)fail();
    const url=`${origin}/v1/cli-release?version=${value.application.version}&platform=${platform}${component==='launcher'?'&component=launcher':''}`;
    if(asset.url!==url)fail();
  }
  const {signature,...payload}=value;
  if(signature){
    if(signature.algorithm!=='Ed25519'||typeof signature.keyId!=='string'||!Object.hasOwn(keys,signature.keyId)
      ||typeof signature.value!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(signature.value))fail();
    try{if(!verify(null,Buffer.from(canonical(payload)),createPublicKey(keys[signature.keyId]),Buffer.from(signature.value,'base64')))fail();}catch{fail();}
  }else if(Object.keys(keys).length)fail();
  return payload;
}
