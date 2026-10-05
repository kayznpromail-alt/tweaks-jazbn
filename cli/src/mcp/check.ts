import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {McpManager} from './manager';
import {mkdtempSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
export async function mcpFixture(){const server=new Server({name:'edgey-check',version:'1'},{capabilities:{tools:{}}});server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'echo',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}}]}));server.setRequestHandler(CallToolRequestSchema,async r=>({content:[{type:'text',text:String(r.params.arguments?.text)}]}));await server.connect(new StdioServerTransport());}
export async function mcpCheck(){const dir=mkdtempSync(join(tmpdir(),'edgey-native-mcp-')),project=realpathSync(dir);const manager=new McpManager(dir);try{manager.config.add({id:'native',transport:'stdio',command:process.execPath,args:['--edgey-mcp-fixture']});manager.config.trust(project,'native',manager.status(project)[0]!.fingerprint);await manager.connect(project,'native');manager.select(project,'native',['echo'],[]);const result=await manager.tools(project)[0]!.execute({text:'native mcp ok'},{project,runId:'check',requestId:'check',toolId:'check',signal:new AbortController().signal});if(!JSON.stringify(result).includes('native mcp ok'))throw Error();console.log(JSON.stringify({nativeMcp:true,stdio:true,credentials:'not accessed'}));}finally{await manager.dispose();}}
