import * as vscode from 'vscode';
import { createServer, type Server as HttpServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema, isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

const string={type:'string'}, integer={type:'integer',minimum:0};
const pathArgs={path:string}, positionArgs={...pathArgs,line:integer,character:integer};
const defs=[
  ['list_documents','list open documents in the paired workspace',{},[]],
  ['active_editor','read active editor path, document version and selected text',{},[]],
  ['read_document','read current buffer, including unsaved changes',pathArgs,['path']],
  ['diagnostics','read problems for the workspace',{},[]],
  ['document_symbols','find document symbols',pathArgs,['path']],
  ['definition','find definition at zero-based line and character',positionArgs,['path','line','character']],
  ['references','find references at zero-based line and character',positionArgs,['path','line','character']],
  ['open_document','open a file at zero-based line and character',positionArgs,['path','line','character']],
  ['prepare_edit','preview replacement of one document; does not apply or save',{...pathArgs,expectedVersion:integer,text:string},['path','expectedVersion','text']],
  ['apply_edit','request editor confirmation and apply a prepared edit; no save',{ticket:string},['ticket']],
] as const;
const tools=defs.map(([name,description,properties,required])=>({name,description,inputSchema:{type:'object' as const,properties,required:[...required],additionalProperties:false}}));
type Pending={uri:vscode.Uri;version:number;text:string;created:number};
let host:HttpServer|undefined, token='', windowId='', workspace='';
const sessions=new Map<string,{server:Server;transport:StreamableHTTPServerTransport}>();
const pending=new Map<string,Pending>();
const previews=new Map<string,string>();
let port=0;
function contained(path:string){const rel=relative(workspace,realpathSync(path));return rel!== '..'&&!rel.startsWith('..\\')&&!rel.startsWith('../')&&!isAbsolute(rel);}
function uri(path:unknown){if(typeof path!=='string'||path.length>4096)throw Error();const file=resolve(workspace,path);if(!contained(file))throw Error();return vscode.Uri.file(file);}
function allowed(u:vscode.Uri){try{return u.scheme==='file'&&contained(u.fsPath);}catch{return false;}}
function pack(value:unknown){const text=JSON.stringify(value);if(Buffer.byteLength(text)>256*1024)throw Error();return {content:[{type:'text' as const,text}]};}
function validate(name:string,args:Record<string,unknown>){const def=tools.find(t=>t.name===name);if(!def)throw Error();const props=def.inputSchema.properties as Record<string,{type:string}>;if(Object.keys(args).some(k=>!Object.hasOwn(props,k))||def.inputSchema.required.some(k=>!Object.hasOwn(args,k)))throw Error();for(const [k,v] of Object.entries(args)){if(props[k].type==='integer'?!(Number.isSafeInteger(v)&&Number(v)>=0):typeof v!=='string')throw Error();}return args;}
export async function invoke(name:string,args:Record<string,unknown>,signal:AbortSignal):Promise<unknown>{
  if(!vscode.workspace.isTrusted||signal.aborted||!vscode.workspace.workspaceFolders?.some(f=>f.uri.scheme==='file'&&realpathSync(f.uri.fsPath)===workspace))throw Error();validate(name,args);
  const docs=()=>vscode.workspace.textDocuments.filter(d=>allowed(d.uri));
  if(name==='list_documents')return docs().map(d=>({path:d.uri.fsPath,version:d.version,dirty:d.isDirty,language:d.languageId}));
  if(name==='active_editor'){const e=vscode.window.activeTextEditor;if(!e||!allowed(e.document.uri))return null;return {path:e.document.uri.fsPath,version:e.document.version,selection:e.selection,selectedText:e.document.getText(e.selection)};}
  if(name==='diagnostics')return vscode.languages.getDiagnostics().filter(([u])=>allowed(u)).map(([u,d])=>({path:u.fsPath,diagnostics:d.map(x=>({message:x.message,severity:x.severity,range:x.range,source:x.source}))}));
  if(name==='apply_edit'){
    const ticket=String(args.ticket),edit=pending.get(ticket),editWindow=windowId;if(!edit||Date.now()-edit.created>300000)throw Error();
    const doc=await vscode.workspace.openTextDocument(edit.uri);if(doc.version!==edit.version)throw Error();
    await vscode.commands.executeCommand('vscode.diff',edit.uri,vscode.Uri.parse('edgey-preview:'+ticket),'edgey: review edit');
    const choice=await vscode.window.showWarningMessage('Apply the edgey edit to '+relative(workspace,edit.uri.fsPath)+'? The file will remain unsaved.',{modal:true},'Apply');
    pending.delete(ticket);previews.delete(ticket);
    if(choice!=='Apply')return {applied:false,reason:'user declined'};
    if(signal.aborted||!host||windowId!==editWindow||!vscode.workspace.isTrusted||doc.version!==edit.version||!allowed(edit.uri)||!vscode.workspace.workspaceFolders?.some(f=>f.uri.scheme==='file'&&realpathSync(f.uri.fsPath)===workspace))throw Error();
    const change=new vscode.WorkspaceEdit();change.replace(edit.uri,new vscode.Range(doc.positionAt(0),doc.positionAt(doc.getText().length)),edit.text);
    const applied=await vscode.workspace.applyEdit(change);return {applied,path:doc.uri.fsPath,version:doc.version,saved:false};
  }
  const u=uri(args.path),doc=await vscode.workspace.openTextDocument(u);
  if(name==='read_document')return {path:u.fsPath,version:doc.version,dirty:doc.isDirty,text:doc.getText()};
  if(name==='prepare_edit'){
    for(const [key,value] of pending)if(Date.now()-value.created>300000){pending.delete(key);previews.delete(key);}
    if(doc.version!==args.expectedVersion||Buffer.byteLength(String(args.text))>256*1024||pending.size>=16)throw Error();
    const ticket=randomUUID();pending.set(ticket,{uri:u,version:doc.version,text:String(args.text),created:Date.now()});previews.set(ticket,String(args.text));
    await vscode.commands.executeCommand('vscode.diff',u,vscode.Uri.parse('edgey-preview:'+ticket),'edgey: proposed edit');return {ticket,path:u.fsPath,expectedVersion:doc.version,applied:false};
  }
  if(name==='document_symbols')return await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider',u)??[];
  const position=new vscode.Position(Number(args.line),Number(args.character));if(!doc.validatePosition(position).isEqual(position))throw Error();
  if(name==='open_document'){await vscode.window.showTextDocument(doc,{selection:new vscode.Range(position,position)});return {opened:true};}
  const results=await vscode.commands.executeCommand<any[]>(name==='definition'?'vscode.executeDefinitionProvider':'vscode.executeReferenceProvider',u,position)??[];
  return results.filter(r=>allowed(r.uri??r.targetUri)).map(r=>({path:(r.uri??r.targetUri).fsPath,range:r.range??r.targetSelectionRange}));
}
export async function stop(){const old=host;host=undefined;token='';port=0;pending.clear();previews.clear();await Promise.all([...sessions.values()].map(s=>s.server.close().catch(()=>{})));sessions.clear();if(old)await new Promise<void>(r=>{old.close(()=>r());old.closeAllConnections();});}
export async function start(folder?:string){
  if(host)return;
  if(!vscode.workspace.isTrusted||vscode.env.remoteName)throw Error('a trusted local workspace is required');
  const folders=vscode.workspace.workspaceFolders?.filter(f=>f.uri.scheme==='file')??[];
  const selected=folder?folders.find(f=>realpathSync(f.uri.fsPath)===realpathSync(folder)):folders.length===1?folders[0]:await vscode.window.showWorkspaceFolderPick();
  if(!selected)throw Error('choose a local workspace folder');
  workspace=realpathSync(selected.uri.fsPath);token=randomBytes(32).toString('hex');windowId=randomBytes(8).toString('hex');
  host=createServer(async(req,res)=>{
    const auth=Buffer.from(String(req.headers.authorization??'')),expected=Buffer.from('Bearer '+token);
    if(req.url!=='/mcp'||req.headers.host!==`127.0.0.1:${port}`||req.headers.origin||auth.length!==expected.length||!timingSafeEqual(auth,expected)||!vscode.workspace.isTrusted){res.writeHead(403).end();return;}
    try{
      const id=String(req.headers['mcp-session-id']??'');let session=sessions.get(id);
      let body:any;
      if(req.method==='POST'){
        const chunks:Buffer[]=[];let bytes=0;
        for await(const chunk of req){const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=buffer.length;if(bytes>1024*1024)throw Error();chunks.push(buffer);}
        body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      }
      if(!session){if(id||!isInitializeRequest(body)||sessions.size>=8){res.writeHead(400).end();return;}
        const server=new Server({name:'edgey-vscode',version:'0.1.0'},{capabilities:{tools:{}}});
        const transport=new StreamableHTTPServerTransport({sessionIdGenerator:randomUUID,onsessioninitialized:sid=>{sessions.set(sid,{server,transport});},enableJsonResponse:true});
        server.setRequestHandler(ListToolsRequestSchema,async()=>({tools}));
        server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{try{return pack(await invoke(request.params.name,request.params.arguments??{},extra.signal));}catch{return {isError:true,content:[{type:'text',text:'bridge operation failed, cancelled, outside workspace, or document version changed; inspect editor before retrying'}]};}});
        transport.onclose=()=>{if(transport.sessionId)sessions.delete(transport.sessionId);};await server.connect(transport);session={server,transport};
      }
      await session.transport.handleRequest(req,res,body);
    }catch{if(!res.headersSent)res.writeHead(400);res.end();}
  });
  host.requestTimeout=15000;host.headersTimeout=10000;
  await new Promise<void>((resolve,reject)=>{host!.once('error',reject);host!.listen(0,'127.0.0.1',()=>resolve());});port=(host.address() as {port:number}).port;
}
export function pairing(){if(!host)throw Error();return Buffer.from(JSON.stringify({version:1,url:`http://127.0.0.1:${port}/mcp`,token,window:windowId,workspace})).toString('base64url');}
export function activate(context:vscode.ExtensionContext){
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('edgey-preview',{provideTextDocumentContent:u=>previews.get(u.path)??''}));
  const run=(fn:()=>Promise<void>)=>async()=>{try{await fn();}catch{void vscode.window.showErrorMessage('edgey MCP could not start; open a trusted local workspace.');}};
  context.subscriptions.push(vscode.commands.registerCommand('edgeyMcp.start',run(async()=>{await start();void vscode.window.showInformationMessage('edgey MCP bridge started on loopback.');})),vscode.commands.registerCommand('edgeyMcp.stop',stop),vscode.commands.registerCommand('edgeyMcp.pair',run(async()=>{await start();const code=pairing();await vscode.env.clipboard.writeText(code);setTimeout(()=>{void vscode.env.clipboard.readText().then(v=>{if(v===code)return vscode.env.clipboard.writeText('');});},60000).unref();void vscode.window.showInformationMessage('Pairing code copied. In edgeyCLI open /mcp and enter pair followed by the code.');})));
  return {start,stop,pairing,invoke};
}
export async function deactivate(){await stop();}
