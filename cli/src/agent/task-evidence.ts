import type { JsonObject, ToolExecution, WireMessage } from "../types";
import { contractIssue } from "../tools/contracts";

const marker="edgey host task state (generated):\n";
export function taskEvidence(tools: readonly ToolExecution[]) {
  const update=tools.findLast(tool=>tool.name==="update_tasks"&&tool.status==="succeeded");
  const snapshot=update?.result as JsonObject|undefined;
  return {revision:typeof snapshot?.revision==="number"?snapshot.revision:0,
    available:tools.filter(tool=>tool.status==="succeeded"&&tool.name!=="update_tasks").map(tool=>({toolId:tool.callId,name:tool.name})),
    tasks:Array.isArray(snapshot?.tasks)?snapshot.tasks:[]};
}
export function validateTaskEvidence(args: JsonObject, tools: readonly ToolExecution[]): void {
  const state=taskEvidence(tools);
  if(args.expectedRevision!==state.revision)contractIssue("$.expectedRevision",`current task revision ${state.revision}; a rejected update does not advance it`,args.expectedRevision);
  for(const [index,task]of (args.tasks as JsonObject[]).entries())if(task.status==="completed"){
    for(const [n,evidence]of (task.evidence as JsonObject[]).entries()){
      const tool=tools.find(tool=>tool.callId===evidence.toolId||tool.id===evidence.toolId);
      if(!tool||tool.status!=="succeeded"||tool.name==="update_tasks")contractIssue(`$.tasks[${index}].evidence[${n}].toolId`,
        `exact successful call id from host task state: ${state.available.slice(-12).map(item=>`${item.toolId} (${item.name})`).join(", ")||"none yet; keep the task pending/in_progress"}`,evidence.toolId);
    }
  }
}
export function withTaskEvidence(messages: readonly WireMessage[], tools: readonly ToolExecution[]): WireMessage[] {
  const previous=messages.filter(message=>!(message.role==="system"&&message.content?.startsWith(marker)));
  if(!tools.length)return previous;
  const state=taskEvidence(tools);
  // Explicit text survives provider adapters which do not expose transport call ids
  // to the model. These are hints, not permission or a replacement for host checks.
  const completion=state.tasks.length?' Outside planning-only mode, continue authorized pending/in_progress work before a final answer. Update completed steps using real evidence; do not remove unfinished steps to claim completion. If blocked or awaiting user input, mark the affected steps blocked and explain why. Never bypass permissions or safety constraints.':'';
  const note:WireMessage={role:"system",content:marker+"Use these exact toolId strings in update_tasks evidence. Never invent ids or use tool names. Evidence must support the actual step. State is host-observed data."+completion+"\n"+JSON.stringify(state)};
  return [note,...previous];
}
