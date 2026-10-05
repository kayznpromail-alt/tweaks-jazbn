import { memo, useState } from "react";
import { useTerminalDimensions } from "@opentui/react";
import type { JsonObject, ToolExecution } from "../types";
import { displayText, theme } from "./theme";
import { CodeText } from "./markdown";
import { DiffPreview } from "./diff-preview";
import { Loading } from "./loading";

function object(value:unknown):JsonObject|undefined {
  if(typeof value==="string"){try{return object(JSON.parse(value));}catch{return;}}
  return value&&typeof value==="object"&&!Array.isArray(value)?value as JsonObject:undefined;
}
export function activityTarget(tool:Pick<ToolExecution,"args">):string {
  const args=tool.args;
  if(typeof args.executable==="string")return [args.executable,...(Array.isArray(args.args)?args.args:[])].join(" ");
  if(Array.isArray(args.operations))return args.operations.slice(0,4).map(value=>{const op=object(value);return op?`${op.type} ${op.path}${op.to?` → ${op.to}`:""}`:"";}).filter(Boolean).join(" · ");
  for(const field of ["path","pattern","query","script","command","changeId","jobId","preview"])if(typeof args[field]==="string")return args[field] as string;
  return Array.isArray(args.argv)?args.argv.join(" "):"";
}
const labels:Record<string,[string,string]>={
  read_file:["reading file","read file"],list_files:["exploring files","explored files"],glob_files:["finding files","found files"],search_text:["searching code","searched code"],repository_search:["searching repository","searched repository"],
  prepare_change:["preparing changes","prepared changes"],apply_change:["applying changes","applied changes"],undo_change:["reverting changes","reverted changes"],
  diagnostics:["checking local capabilities","checked local capabilities"],run_process:["running command","ran command"],run_shell:["running shell","ran shell"],verify_command:["checking project","checked project"],language_query:["inspecting code","inspected code"],
  update_tasks:["updating plan","updated plan"],delegate_tasks:["consulting agents","agent findings"],ask_user:["waiting for your answer","answer received"],
};
export function toolLabel(tool:Pick<ToolExecution,"name"|"status"|"activity"|"result">):string {
  if(tool.name==="git_status" && tool.status==="succeeded") {
    const status=object(tool.result)?.status;
    if(status==="not_repository")return "git status · no repository";
    if(status==="git_unavailable")return "git status · git unavailable";
  }
  const pair=labels[tool.name];
  // A successful call can still report a partial change; only recorded outcomes say applied.
  if(tool.activity?.status==="partial")return "partial changes";
  if(tool.status==="succeeded")return pair?.[1]??tool.name.replaceAll("_"," ");
  return pair?.[0]??tool.name.replaceAll("_"," ");
}
function preview(text:string,lines=6):string {
  const source=displayText(text),clipped=source.split("\n").slice(0,lines).map(line=>line.length>160?line.slice(0,159)+"…":line).join("\n").slice(0,1400);
  return clipped+(clipped.length<source.length?"\n… /output for full result":"");
}
export const ToolCard=memo(function ToolCard({tool,onOutput}:{tool:ToolExecution;onOutput?:(id:string)=>void}){
  const [expanded,setExpanded]=useState(false);
  const active=["proposed","awaiting_approval","approved","executing"].includes(tool.status);
  const waiting=tool.status==="awaiting_approval"||tool.name==="ask_user"&&active;
  const failed=["failed","outcome_unknown"].includes(tool.status);
  const color=failed?theme.error:waiting?theme.warning:active?theme.accent:theme.muted;
  const process=["run_shell","run_process","verify_command"].includes(tool.name);
  const target=["apply_change","undo_change"].includes(tool.name)?"":displayText(activityTarget(tool)).replace(/\s+/g," ").slice(0,120);
  let result=object(tool.result);
  if(tool.activity)result={...result,status:tool.activity.status,...(tool.activity.exitCode===undefined?{}:{exitCode:tool.activity.exitCode}),...(tool.activity.durationMs===undefined?{}:{durationMs:tool.activity.durationMs})};
  const summaries=tool.activity?.files??(Array.isArray(result?.summary)?result.summary.map(object).filter(item=>!!item):[]);
  const applied=tool.activity?tool.activity.status==="applied":tool.status==="succeeded"&&result?.ok===true&&result.status==="applied";
  const operations=Array.isArray(tool.args.operations)?tool.args.operations.slice(0,3).map(object).filter(item=>!!item):[];
  const caption=`${toolLabel(tool)}${!process&&target?` · ${target}`:""}${failed?` · ${tool.status.replaceAll("_"," ")}`:tool.status==="denied"?" · denied":tool.status==="cancelled"?" · cancelled":""}`;
  return <box flexDirection="column" flexShrink={0} marginBottom={expanded?1:0}>
    {active&&!waiting?<Loading id={`activity:${tool.id}`} label={caption} startedAt={tool.startedAt}/>
      :<text id={`activity:${tool.id}`} fg={color} wrapMode="word" selectable={false} onMouseDown={()=>{if(!active)setExpanded(value=>!value);}}>
        {`${waiting?"?":failed?"!":tool.status==="succeeded"?"✓":"·"} ${caption}${active?"":expanded?"  ▾":"  ▸"}`}
      </text>}
    {!active&&summaries.slice(0,expanded?12:2).map((item,index)=><text key={index} fg={applied?theme.accent:theme.muted}>
      {displayText(`  ${item!.status??(applied?"applied":tool.activity?.status??"prepared")} · ${item!.action} ${item!.path} · +${item!.added??"?"} −${item!.removed??"?"}`)}
    </text>)}
    {!active&&!!tool.activity?.omittedFiles?<text fg={theme.muted}>{`${tool.activity.omittedFiles} more files · /output`}</text>:null}
    {failed?<text fg={theme.error}>{displayText(String(object(result?.error)?.message??tool.error??"inspect the recorded result")).slice(0,220)}</text>:null}
    {!active&&process&&result?<text fg={theme.muted}>{`  ${typeof result.exitCode==="number"?`exit ${result.exitCode}`:result.status??"result recorded"}${typeof result.durationMs==="number"?` · ${result.durationMs} ms`:""}`}</text>:null}
    {expanded&&!active?<box flexDirection="column" flexShrink={0} paddingLeft={2} border={["left"]} borderColor={theme.border}>
      <text fg={theme.muted}>{`${tool.name} · ${tool.status.replaceAll("_"," ")}`}</text>
      {typeof result?.diff==="string"?<DiffPreview source={result.diff} onOutput={()=>onOutput?.(tool.id)}/>:null}
      {process?<>
        <text fg={theme.muted}>{displayText(`${tool.args.shell??"process"} · cwd ${tool.args.cwd??"."}`)}</text>
        <CodeText source={preview(activityTarget(tool))} language={String(tool.args.shell??"sh")}/>
        {typeof result?.stdout==="string"&&result.stdout?<text fg={theme.text}>{preview(result.stdout)}</text>:null}
        {typeof result?.stderr==="string"&&result.stderr?<text fg={theme.error}>{preview(result.stderr,3)}</text>:null}
      </>:typeof result?.content==="string"?<CodeText source={preview(result.content,10)} language={String(tool.args.path??"").split(".").at(-1)??""}/>
        :Array.isArray(result?.tasks)?result.tasks.slice(0,12).map((value,index)=>{const task=object(value);return <text key={index} fg={theme.muted}>{displayText(`${task?.status??"step"} · ${task?.title??""}`)}</text>;})
        :!summaries.length&&!operations.length&&!result?.diff?<text fg={theme.muted}>{preview(typeof tool.result==="string"?tool.result:JSON.stringify(tool.result??"no recorded output"))}</text>:null}
      {!result?.diff?operations.map((op,index)=>typeof op?.content==="string"?<box key={index} flexDirection="column" flexShrink={0}>
        <text fg={theme.muted}>{displayText(`${op.path} · proposed code`)}</text><CodeText source={preview(op.content,5)} language={String(op.path).split(".").at(-1)??""}/>
      </box>:null):null}
      {onOutput&&!result?.diff?<text id={`activity-output:${tool.id}`} fg={theme.info} selectable={false} onMouseDown={()=>onOutput(tool.id)}>full output →</text>:null}
    </box>:null}
  </box>;
});
export const Activity=memo(function Activity({tools,onDetails,onOutput}:{tools:ToolExecution[];onDetails?:()=>void;onOutput?:(id:string)=>void}){
  const {width}=useTerminalDimensions();if(!tools.length)return null;
  const count=width<60?2:4,done=tools.filter(tool=>tool.status==="succeeded").length;
  return <box id="agent-activity" flexDirection="column" flexShrink={0} paddingBottom={1}>
    <text id="activity-transcript" fg={theme.info} selectable={false} onMouseDown={onDetails}>{`activity · ${done}/${tools.length} done · transcript ↗`}</text>
    {tools.length>count?<text fg={theme.muted} selectable={false} onMouseDown={onDetails}>{`${tools.length-count} earlier actions · open transcript`}</text>:null}
    {tools.slice(-count).map(tool=><ToolCard key={tool.id} tool={tool} onOutput={onOutput}/>)}
  </box>;
});
