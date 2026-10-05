import { useRef, useState, useMemo } from "react";
import { useKeyboard } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { ChatController } from "../core";
import type { AppState } from "../types";
import type { TranscriptFilter } from "../core/transcript";
import { AssistantMarkdown } from "./markdown";
import { ToolCard } from "./activity";
import { Loading } from "./loading";
import { displayText,theme } from "./theme";

export interface TranscriptPosition { offset?:number; filter:TranscriptFilter; top:number }
export function Transcript({controller,state,onOutput,positions,anchor}:{controller:ChatController;state:AppState;onOutput:(id:string)=>void;positions:Map<string,TranscriptPosition>;anchor?:string}) {
  const identity=state.session?.id??"new",saved=anchor?undefined:positions.get(identity);
  const [offset,setOffset]=useState<number|undefined>(saved?.offset),[filter,setFilter]=useState<TranscriptFilter>(saved?.filter??"all");
  const scroll=useRef<ScrollBoxRenderable>(null);
  const restored=useRef(false);
  const anchorUsed=useRef(false);
  const page=useMemo(()=>controller.getTranscriptPage(offset,filter,anchorUsed.current?undefined:anchor),[controller,state,offset,filter]);
  if(anchor&&!anchorUsed.current){anchorUsed.current=true;if(offset!==page.start)setOffset(page.start);}
  const change=(value:number|undefined)=>{setOffset(value);scroll.current?.scrollTo(value===undefined?scroll.current.scrollHeight:0);};
  const older=()=>change(Math.max(0,page.start-page.pageSize)),newer=()=>change(page.end>=page.total?undefined:page.end);
  const filters:TranscriptFilter[]=["all","tools","changes"];
  const choose=(value:TranscriptFilter)=>{setFilter(value);change(undefined);};
  useKeyboard(key=>{
    if(state.agent?.approval)return;
    if(key.ctrl&&["left","right","f","e"].includes(key.name)){
      key.preventDefault();key.stopPropagation();
      if(key.name==="left")older();else if(key.name==="right")newer();
      else if(key.name==="e"){change(undefined);scroll.current?.scrollTo(scroll.current.scrollHeight);}
      else choose(filters[(filters.indexOf(filter)+1)%filters.length]!);
    }
  });
  return <box id="transcript-view" flexDirection="column" flexGrow={1} minHeight={0}>
    <box flexDirection="row" flexShrink={0} gap={2}>
      <text fg={theme.accent}>transcript</text>
      {filters.map(value=><text key={value} id={`transcript-filter:${value}`} fg={filter===value?theme.accentBright:theme.muted} onMouseDown={()=>choose(value)}>{value}</text>)}
    </box>
    <text fg={theme.muted} flexShrink={0}>{`events ${page.total?page.start+1:0}–${page.end} / ${page.total} · ${state.busy?"live":"recorded"}`}</text>
    <scrollbox id="transcript-scroll" ref={scroll} focused flexGrow={1} minHeight={0} scrollY scrollX={false} stickyScroll stickyStart={saved||anchor?"top":"bottom"} renderAfter={()=>{
      const box=scroll.current;if(!box)return;
      if(!restored.current){if(anchor)box.scrollTo(0);else if(saved)box.scrollTo(saved.top);restored.current=true;}
      const atBottom=box.scrollTop>=Math.max(0,box.scrollHeight-box.viewport.height-1);
      if(offset===undefined&&!atBottom)setOffset(page.start);
      positions.set(identity,{offset:offset===undefined&&!atBottom?page.start:offset,filter,top:box.scrollTop});
    }}>
      {!page.entries.length?<text fg={theme.muted}>no recorded events in this view</text>:null}
      {page.start>0?<text id="transcript-older" fg={theme.info} onMouseDown={older}>↑ earlier events</text>:null}
      {page.entries.map(entry=><box key={entry.id} flexDirection="column" flexShrink={0} paddingBottom={entry.kind==="tool"?0:1}>
        {entry.tool?<ToolCard tool={entry.tool} onOutput={onOutput}/>:<>
          <text fg={entry.kind==="validation"?theme.warning:entry.kind==="user"?theme.accentBright:theme.muted} onMouseDown={()=>{if(entry.outputId)onOutput(entry.outputId);}}>
            {displayText(`${entry.kind==="user"?"›":"·"} ${entry.title}${entry.status?` · ${entry.status.replaceAll("_"," ")}`:""}`)}
          </text>
          {entry.content?<AssistantMarkdown source={entry.content}/>:entry.status==="streaming"?<Loading label="receiving response"/>:null}
        </>}
      </box>)}
      {page.end<page.total?<text id="transcript-newer" fg={theme.info} onMouseDown={newer}>↓ later events</text>:null}
    </scrollbox>
    <text fg={theme.muted} flexShrink={0} maxHeight={2}>ctrl+←/→ pages · ctrl+f filter · ctrl+e latest</text>
    <text fg={theme.muted} flexShrink={0}>ctrl+r / esc chat · click an action to expand</text>
  </box>;
}
