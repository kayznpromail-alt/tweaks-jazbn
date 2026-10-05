import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type McpServer = { id:string; transport:'stdio'|'http'; command?:string; args?:string[]; url?:string; secretRef?:string; workspace?:string; env?:Record<string,string> };
const blockedEnv = /^(?:PATH|PATHEXT|COMSPEC|SYSTEMROOT|WINDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|SHELL|ENV|BASH_ENV|IFS|CDPATH|ZDOTDIR|GIT_.*|NODE_.*|BUN_.*|LD_.*|DYLD_.*|PYTHON.*|PERL.*|RUBY.*|JAVA.*|JDK_.*|_JAVA_.*|DOTNET_.*|COMPLUS_.*|EDGEY.*|NPM_.*|npm_config_.*)$/i;
function validateEnv(value:unknown): asserts value is Record<string,string> {
  if(!value || typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>32)throw new Error('invalid mcp environment');
  let bytes=0; const names=new Set<string>();
  for(const [name,v] of Object.entries(value)) {
    if(!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)||blockedEnv.test(name)||['__PROTO__','CONSTRUCTOR','PROTOTYPE'].includes(name.toUpperCase())||names.has(name.toUpperCase())||typeof v!=='string'||v.length>4096||/[\u0000\r\n]/.test(v))throw new Error('invalid or reserved mcp environment variable');
    names.add(name.toUpperCase());bytes+=Buffer.byteLength(name)+Buffer.byteLength(v);
  }
  if(bytes>16384)throw new Error('mcp environment exceeds limit');
}
/** Values are private even when a variable is not an API credential. */
export function publicServerConfig(config:McpServer):McpServer {
  return {...config,...(config.env?{env:Object.fromEntries(Object.keys(config.env).map(k=>[k,'[redacted]']))}:{})};
}
export const hash = (v:unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function serverConfig(value:unknown):McpServer {
  const c=value as McpServer;
  if(!c || typeof c!=='object' || Array.isArray(c) || Object.keys(c).some(k=>!['id','transport','command','args','url','secretRef','workspace','env'].includes(k)) || !/^[a-z][a-z0-9-]{0,23}$/.test(c.id)) throw new Error('invalid mcp server configuration');
  if(c.env!==undefined)validateEnv(c.env);
  if(c.secretRef!==undefined && !/^[a-z0-9-]{1,64}$/.test(c.secretRef)) throw new Error('invalid secret reference');
  if(c.workspace!==undefined && (typeof c.workspace!=='string'||c.workspace.length>4096)) throw new Error('invalid workspace');
  if(c.transport==='stdio') {
    if(typeof c.command!=='string'||!c.command||c.command.length>4096||c.url||c.secretRef||c.workspace||!Array.isArray(c.args)||c.args.length>64||c.args.some(a=>typeof a!=='string'||a.length>4096))throw new Error('stdio requires command and args');
  } else if(c.transport==='http') {
    const u=new URL(c.url!);
    if(c.env!==undefined||c.command||c.args||u.username||u.password||u.hash||u.search||!(u.protocol==='https:'||(u.protocol==='http:'&&u.hostname==='127.0.0.1')))throw new Error('use https or local 127.0.0.1 http, without credentials or query');
  } else throw new Error('unsupported mcp transport');
  return JSON.parse(JSON.stringify(c));
}
function read(path:string):any {
  if(!existsSync(path))return {};
  if(lstatSync(path).isSymbolicLink()||lstatSync(path).size>128*1024)throw new Error('invalid mcp configuration file');
  try{return JSON.parse(readFileSync(path,'utf8'));}catch{throw new Error('invalid mcp configuration json');}
}
function entries(data:any):McpServer[] {
  if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('invalid mcp configuration');
  if(data.mcpServers!==undefined) {
    if(data.servers!==undefined||!data.mcpServers||typeof data.mcpServers!=='object'||Array.isArray(data.mcpServers)||Object.keys(data.mcpServers).length>32)throw new Error('invalid mcpServers configuration');
    return Object.entries(data.mcpServers).map(([id,value])=>{
      if(!value||typeof value!=='object'||Array.isArray(value)||'id' in value)throw new Error('invalid mcp server configuration');
      return serverConfig({id,transport:'stdio',args:[],...value});
    });
  }
  if(data.servers===undefined)return [];
  if(data.version!==1||!Array.isArray(data.servers)||data.servers.length>32)throw new Error('invalid mcp config: expected version 1 and servers array');
  return data.servers.map(serverConfig);
}
function write(path:string,value:unknown) {
  mkdirSync(dirname(path),{recursive:true});
  if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw new Error('linked mcp configuration rejected');
  const temp=path+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(temp,path);
}
export class McpConfig {
  constructor(readonly directory:string){}
  servers(project:string):{config:McpServer;source:string;fingerprint:string;trusted:boolean;selected:string[]}[] {
    const state=read(join(this.directory,'mcp-state.json'));const rows:{config:McpServer;source:string;fingerprint:string;trusted:boolean;selected:string[]}[]=[];
    for(const [source,path] of [['user',join(this.directory,'mcp.json')],['project',join(project,'.edgey','mcp.json')]]) {
      const data=read(path!);
      for(const v of entries(data)) {
        const config=serverConfig(v),fingerprint=hash({config,project:realpathSync(project),source});
        if(rows.some(r=>r.config.id===config.id))throw new Error('duplicate mcp server id between user and project');
        const selected=state[fingerprint]?.selected;
        rows.push({config,source:source!,fingerprint,trusted:state[fingerprint]?.trusted===true,selected:Array.isArray(selected)&&selected.every((s:unknown)=>typeof s==='string')?selected:[]});
      }
    }return rows;
  }
  add(config:McpServer) {
    const path=join(this.directory,'mcp.json'),data=read(path);const servers=entries(data);
    if(servers.some(c=>c.id===config.id)||servers.length>=32)throw new Error('server id already exists or limit reached');
    write(path,{version:1,servers:[...servers,serverConfig(config)]});
  }
  trust(project:string,id:string,fingerprint:string){const row=this.servers(project).find(r=>r.config.id===id);if(!row||row.fingerprint!==fingerprint)throw new Error('configuration changed; review again');this.update(fingerprint,{trusted:true});}
  select(fingerprint:string,selected:string[]){this.update(fingerprint,{selected});}
  remove(id:string){const path=join(this.directory,'mcp.json'),servers=entries(read(path));if(!servers.some(c=>c.id===id))throw new Error('edit project mcp.json to remove a project server');write(path,{version:1,servers:servers.filter(c=>c.id!==id)});}
  private update(fingerprint:string,patch:object){const path=join(this.directory,'mcp-state.json'),state=read(path);write(path,{...state,[fingerprint]:{...state[fingerprint],...patch}});}
}
export class McpSecrets {
  constructor(private backend:typeof Bun.secrets=Bun.secrets){}
  get(name:string){return this.backend.get({service:'com.edgey.mcp',name});}
  delete(name:string){return this.backend.delete({service:'com.edgey.mcp',name});}
  async set(name:string,value:string){if(!value||value.length>4096||/[^\x21-\x7e]/.test(value))throw new Error('invalid bearer token');await this.backend.set({service:'com.edgey.mcp',name,value});}
}
