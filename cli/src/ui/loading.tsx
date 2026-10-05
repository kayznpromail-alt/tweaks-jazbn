import { useEffect, useRef } from "react";
import { useRenderer } from "@opentui/react";
import type { TextRenderable } from "@opentui/core";
import { displayText, theme } from "./theme";

type Renderer = ReturnType<typeof useRenderer>;
type Listener = (frame: number) => void;
// One animation subscription per renderer, irrespective of active tool/child count.
const clocks = new WeakMap<Renderer, { listeners: Set<Listener>; tick: (delta: number) => Promise<void> }>();
const rings = ["◐", "◓", "◑", "◒"];
export function subscribeWorkClock(renderer: Renderer, listener: Listener): () => void {
  if (process.env.EDGEY_CLI_ANIMATIONS === "0") return () => {};
  let clock = clocks.get(renderer);
  if (!clock) {
    const listeners = new Set<Listener>(); let elapsed=0, frame=0;
    const tick = async (delta:number) => {
      elapsed+=delta;if(elapsed<125)return;elapsed%=125;frame++;
      for(const subscriber of listeners)subscriber(frame);
    };
    clock={listeners,tick};clocks.set(renderer,clock);renderer.setFrameCallback(tick);renderer.requestLive();
  }
  clock.listeners.add(listener);
  return () => {
    if(!clock!.listeners.delete(listener))return;
    if(!clock!.listeners.size){renderer.removeFrameCallback(clock!.tick);renderer.dropLive();clocks.delete(renderer);}
  };
}
export function Loading({ label, color=theme.accent, id, onMouseDown, startedAt }: {
  label:string; color?:string; id?:string; onMouseDown?:()=>void; startedAt?:string;
}) {
  const renderer=useRenderer(), node=useRef<TextRenderable>(null), props=useRef({label,startedAt});
  props.current={label,startedAt};
  const text=(frame:number)=>{
    const {label,startedAt}=props.current, start=startedAt?Date.parse(startedAt):NaN;
    const seconds=Number.isFinite(start)?Math.max(0,Math.floor((Date.now()-start)/1000)):null;
    return `${rings[frame%rings.length]} ${displayText(label)}${seconds===null?"":` · ${seconds<60?`${seconds}s`:`${Math.floor(seconds/60)}m ${seconds%60}s`}`}`;
  };
  useEffect(()=>subscribeWorkClock(renderer,frame=>{if(node.current)node.current.content=text(frame);}),[renderer]);
  return <text ref={node} id={id} fg={color} flexShrink={0} wrapMode="word" onMouseDown={onMouseDown}>{text(0)}</text>;
}
