import type { DurableStore, Session, ToolExecution } from "../types";
import { toolProjection } from "./agent-service";
import { boundedText } from "../agent/data";

export interface TranscriptEntry {
  id:string; kind:"user"|"assistant"|"request"|"tool"|"validation";
  title:string; content:string; status?:string; outputId?:string; tool?:ToolExecution;
}
export type TranscriptFilter="all"|"tools"|"changes";
/** Display records only. Deliberately never traverses request.context or run.metadata. */
export function transcriptPage(session:Session|undefined,store:DurableStore|undefined,safe:(text:string)=>string,
  offset:number|undefined,filter:TranscriptFilter="all",limit=24,anchor?:string) {
  if(offset!==undefined&&(!Number.isSafeInteger(offset)||offset<0))throw new Error("invalid transcript offset");
  if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw new Error("invalid transcript page size");
  if(store?.readTranscriptPage&&session){
    const page=store.readTranscriptPage(session.id,offset,filter,limit,anchor);
    return {...page,entries:page.entries.map(entry=>({...entry,title:safe(entry.title),content:safe(entry.content),...(entry.tool?{tool:projectTool(entry.tool,safe)}:{})}))};
  }
  const entries:TranscriptEntry[]=[];
  for(const message of session?.messages??[]) {
    const run=message.role==="assistant"?store?.loadRun(message.id):undefined;
    if(!run||run.sessionId!==session?.id) {
      entries.push({id:message.id,kind:message.role,title:message.role==="user"?"you":safe(message.model??"assistant"),content:safe(message.content),status:message.status});continue;
    }
    const requests=store!.listRequestAttempts(run.id),tools=store!.listToolExecutions(run.id);
    if(!requests.length)entries.push({id:message.id,kind:"assistant",title:safe(message.model??"assistant"),content:safe(message.content),status:message.status});
    for(const request of requests){
      const content=safe(request.output?.content??"");
      entries.push({id:request.id,kind:"request",title:safe(`round ${request.sequence+1} · ${request.model}`),status:request.status,
        content:Buffer.byteLength(content)>16384?boundedText(content,16000)+"\n\n[preview shortened · click round heading for full output]":content,outputId:request.id});
      if(request.output?.validation){
        const validation=request.output.validation;
        entries.push({id:request.id+":validation",kind:"validation",title:validation.exhausted?"arguments rejected · correction limit reached":`arguments rejected · correction ${validation.repair}/2`,
          content:safe(validation.issues.map(issue=>`${issue.tool} → ${issue.path}\nexpected ${issue.expected}; received ${issue.receivedType}\nnot executed`).join("\n\n"))});
      }
      for(const tool of tools.filter(tool=>tool.requestId===request.id))entries.push({id:tool.id,kind:"tool",title:tool.name,content:"",status:tool.status,outputId:tool.id,tool});
    }
  }
  const selected=entries.filter(entry=>filter==="all"||filter==="tools"&&["tool","validation"].includes(entry.kind)||filter==="changes"&&entry.tool&&["prepare_change","apply_change","undo_change"].includes(entry.tool.name));
  const anchored=anchor?selected.findIndex(entry=>entry.id===anchor):-1;
  const start=anchored>=0?anchored:Math.min(offset??Math.max(0,selected.length-limit),Math.max(0,selected.length-1));
  return {entries:selected.slice(start,start+limit).map(entry=>{
    if(!entry.tool)return entry;
    const tool=toolProjection(entry.tool,safe),result=entry.tool.result;
    // Keep a bounded valid diff preview even when the generic JSON projection was truncated.
    if(result&&typeof result==="object"&&!Array.isArray(result)&&typeof result.diff==="string"){
      tool.result={diff:boundedText(safe(result.diff),12000),status:typeof result.status==="string"?safe(result.status):"recorded"};
    }
    return {...entry,tool};
  }),
    total:selected.length,start,end:Math.min(selected.length,start+limit),pageSize:limit};
}

function projectTool(source:ToolExecution,safe:(text:string)=>string){
  const tool=toolProjection(source,safe),result=source.result;
  if(result&&typeof result==="object"&&!Array.isArray(result)&&typeof result.diff==="string")tool.result={diff:boundedText(safe(result.diff),12000),status:typeof result.status==="string"?safe(result.status):"recorded"};
  return tool;
}
