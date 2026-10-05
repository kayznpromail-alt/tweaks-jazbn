import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { McpConfig, McpSecrets, hash, serverConfig, publicServerConfig } from './config';
import { AgentError } from '../agent/errors';
import { validateTools } from '../api/tool-schema';
import type { AgentTool } from '../agent/registry';
import type { JsonValue, ToolDefinition } from '../types';
import { realpathSync } from 'node:fs';

type Link={client:Client; fingerprint:string; project:string; token:string|null; changed:boolean; live:boolean; tools:AgentTool[]; names:string[]; rejected:string[];closed:AbortController};
export class McpManager {
  readonly config:McpConfig;
  private links=new Map<string,Link>();
  private runGrants=new Map<string,Map<string,Link>>();
  constructor(directory:string,private secrets=new McpSecrets(), private callTimeoutMs=60000){this.config=new McpConfig(directory);}
  status(project:string){return this.config.servers(project).map(r=>{const l=this.links.get(r.config.id);return {...r,config:publicServerConfig(r.config),status:l?.project===project&&l.fingerprint===r.fingerprint?(l.changed?'tools changed; reconnect':l.live?'connected':'disconnected'):'disconnected',tools:l?.names??[],unsupported:l?.rejected??[]};});}
  grantRun(project:string,runId:string,id:string){
    const link=this.links.get(id);
    if(!link?.live||link.changed||link.project!==project)throw new Error('connect the server first');
    let grants=this.runGrants.get(runId);if(!grants)this.runGrants.set(runId,grants=new Map());
    grants.set(id,link);
  }
  runTools(project:string,runId:string,id:string):AgentTool[]|undefined {
    const link=this.runGrants.get(runId)?.get(id);
    if(!link||link!==this.links.get(id)||!link.live||link.changed||link.project!==project)return;
    if(!this.config.servers(project).some(r=>r.config.id===id&&r.fingerprint===link.fingerprint&&r.trusted))return;
    return [...link.tools];
  }
  async connect(project:string,id:string,signal?:AbortSignal){
    const row=this.config.servers(project).find(r=>r.config.id===id);if(!row?.trusted)throw new Error('review configuration and trust its fingerprint first');
    if(row.config.workspace&&realpathSync(row.config.workspace)!==realpathSync(project))throw new Error('bridge belongs to another workspace');
    await this.disconnect(id);
    const c=row.config,token=c.secretRef?await this.secrets.get(c.secretRef):null;
    if(c.secretRef&&!token)throw new Error('missing mcp bearer token');
    const privateValues=[token,...Object.values(c.env??{})].filter((v):v is string=>typeof v==='string'&&v.length>0).sort((a,b)=>b.length-a.length);
    const redactText=(text:string)=>{
      for(const value of privateValues)for(const form of new Set([JSON.stringify(value).slice(1,-1),value]))text=text.split(form).join('[redacted]');
      return text;
    };
    const redact=(value:any):any=>typeof value==='string'?redactText(value):Array.isArray(value)?value.map(redact):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[redactText(k),redact(v)])):value;
    const client=new Client({name:'edgey-cli',version:'1.0.0'},{capabilities:{}});
    const link:Link={client,fingerprint:row.fingerprint,project,token,changed:false,live:false,tools:[],names:[],rejected:[],closed:new AbortController()};
    client.onerror=()=>{};client.onclose=()=>{link.live=false;link.closed.abort();};
    client.setNotificationHandler(ToolListChangedNotificationSchema,()=>{link.changed=true;});
    const transport=c.transport==='stdio'?new StdioClientTransport({command:c.command!,args:c.args!,cwd:project,stderr:'pipe',env:{PATH:process.env.PATH??'',SystemRoot:process.env.SystemRoot??'',TEMP:process.env.TEMP??'',TMP:process.env.TMP??'',USERPROFILE:process.env.USERPROFILE??'',HOME:process.env.HOME??'',...c.env}}):new StreamableHTTPClientTransport(new URL(c.url!),{requestInit:{headers:token?{Authorization:'Bearer '+token}:{},redirect:'error'}});
    // Drain server diagnostics without copying credentials or arbitrary logs into the UI.
    if(transport instanceof StdioClientTransport)transport.stderr?.on('data',()=>{});
    try {
      const connectionSignal=AbortSignal.any([AbortSignal.timeout(20000),...(signal?[signal]:[])]);
      await client.connect(transport,{timeout:10000,signal:connectionSignal});
      const tools=[];let cursor:string|undefined;const seen=new Set<string>();
      do {const page=await client.listTools(cursor?{cursor}:{},{timeout:10000,signal:connectionSignal});tools.push(...page.tools);if(tools.length>256)throw new Error('server exposes too many tools');cursor=page.nextCursor;if(seen.size>=10)throw new Error('too many tool pages');if(cursor&&seen.has(cursor))throw new Error('invalid tool pagination');if(cursor)seen.add(cursor);}while(cursor);
      for(const t of tools){
        if(privateValues.some(value=>t.name.includes(value)))throw new Error('private value in mcp tool name');
        if(link.names.includes(t.name))throw new Error('duplicate server tool');link.names.push(t.name);
        const name='mcp_'+c.id+'_'+hash(t.name).slice(0,16);
        try {
          const definition=validateTools(redact([{type:'function',function:{name,description:`${c.id}: ${t.name}. ${t.description??''}`,parameters:t.inputSchema}}]))[0]!;
          const version=hash({fingerprint:row.fingerprint,tool:t});
          link.tools.push({name,version,schemaVersion:version,definition,effect:'execute',scope:'external',timeoutMs:this.callTimeoutMs,validate:()=>true,execute:async(args,context)=>{
            if(!link.live||link.changed||this.links.get(id)!==link||!this.config.servers(project).some(r=>r.fingerprint===link.fingerprint&&r.trusted))throw new AgentError('registry_changed');
            try {
              const signal=AbortSignal.any([context.signal,link.closed.signal,AbortSignal.timeout(this.callTimeoutMs)]);
              const request=client.callTool({name:t.name,arguments:args},undefined,{signal,timeout:this.callTimeoutMs});
              let cancel:()=>void=()=>{};
              const result=await Promise.race([request,new Promise<never>((_,reject)=>{cancel=()=>reject(new Error('mcp interrupted'));signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();})]).finally(()=>signal.removeEventListener('abort',cancel));
              if(result.isError)throw new Error('mcp tool reported error');
              const safe={content:result.content,structuredContent:result.structuredContent};const json=JSON.stringify(redact(safe));
              if(Buffer.byteLength(json)>256*1024)throw new Error('mcp result exceeds limit');
              return JSON.parse(json) as JsonValue;
            }catch{throw new AgentError('outcome_unknown');}
          }});
        }catch{link.rejected.push(t.name);}
      }
      if(row.selected.some(n=>!link.names.includes(n)||link.rejected.includes(n)))throw new Error('selected tools changed; review selection');
      link.live=true;this.links.set(id,link);
    }catch{await client.close().catch(()=>{});throw new Error('mcp connection failed; check server, token and supported tools');}
  }
  tools(project:string):AgentTool[]{
    // A malformed optional config must not prevent built-in tools or login. A resumed
    // MCP run still fails the runner's persisted registry fingerprint check.
    let rows:ReturnType<McpConfig['servers']>;
    try { rows=this.config.servers(project); } catch { return []; }
    return rows.flatMap(r=>{const l=this.links.get(r.config.id);if(!l||l.project!==project||l.fingerprint!==r.fingerprint)return [];return l.tools.filter(t=>r.selected.includes(l.names.find(n=>'mcp_'+r.config.id+'_'+hash(n).slice(0,16)===t.name)??''));});
  }
  select(project:string,id:string,names:string[],base:ToolDefinition[]){
    const row=this.config.servers(project).find(r=>r.config.id===id),l=this.links.get(id);
    if(!row)throw new Error('unknown server');
    if(names.length===0){this.config.select(row.fingerprint,[]);return;}
    if(!l?.live||l.changed||l.project!==project||l.fingerprint!==row.fingerprint)throw new Error('connect the server first');
    if(names.some(n=>!l.names.includes(n)||l.rejected.includes(n)))throw new Error('unknown or unsupported tool schema');
    const old=row.selected;this.config.select(row.fingerprint,[...new Set(names)]);
    try{
      const definitions=[...base,...this.tools(project).map(t=>t.definition)];
      validateTools(definitions);
      // The runner adds delegate_tasks after the base registry is constructed.
      if(definitions.length>63||Buffer.byteLength(JSON.stringify(definitions))>124*1024)throw new Error('reserved delegation capacity');
    }catch{this.config.select(row.fingerprint,old);throw new Error('tool limit exceeded; select fewer mcp tools');}
  }
  async disconnect(id:string){const l=this.links.get(id);this.links.delete(id);for(const [run,grants] of this.runGrants){grants.delete(id);if(!grants.size)this.runGrants.delete(run);}if(l){l.live=false;l.closed.abort();await l.client.close().catch(()=>{});}}
  async dispose(){await Promise.all([...this.links.keys()].map(id=>this.disconnect(id)));}
  async remove(id:string,project:string){const row=this.config.servers(project).find(r=>r.config.id===id);if(!row||row.source!=='user')throw new Error('edit project mcp.json to remove a project server');await this.disconnect(id);this.config.remove(id);/* Credentials may be shared with other project configs; do not erase them here. */}
  async pair(code:string,project:string){
    let p:any;try{p=JSON.parse(Buffer.from(code,'base64url').toString('utf8'));}catch{throw new Error('invalid pairing code');}
    if(p?.version!==1||typeof p.token!=='string'||!/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(p.url)||typeof p.window!=='string'||!/^[a-f0-9]{16}$/.test(p.window)||realpathSync(p.workspace)!==realpathSync(project))throw new Error('pairing code belongs to another workspace or is invalid');
    const id='vscode-'+p.window,c=serverConfig({id,transport:'http',url:p.url,workspace:p.workspace,secretRef:id});
    await this.secrets.set(id,p.token);this.config.add(c);const row=this.config.servers(project).find(r=>r.config.id===id)!;this.config.trust(project,id,row.fingerprint);await this.connect(project,id);
  }
  async token(id:string,value:string,project:string){const c=this.config.servers(project).find(r=>r.config.id===id)?.config;if(!c?.secretRef)throw new Error('configure secretRef first');await this.secrets.set(c.secretRef,value);}
}
