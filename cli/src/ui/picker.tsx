import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useMemo, useState, useRef, useLayoutEffect } from "react";
import { theme, displayText } from "./theme";

export interface PickItem { id:string; name:string; description?:string; group?:string; active?:boolean; disabled?:boolean }
export function Picker({title,items,height,onSelect,onFavorite,onDelete,onStop,onQuery,initialQuery=""}: {
  title:string;items:PickItem[];height:number;onSelect?:(id:string)=>void;onFavorite?:(id:string)=>void;
  onDelete?:(id:string)=>void;onStop?:(id:string)=>void;onQuery?:(value:string)=>void;initialQuery?:string;
}) {
  const [query,setQuery]=useState(initialQuery),[selectedId,setSelectedId]=useState<string|null>(null),[armedId,setArmedId]=useState<string|null>(null);
  useLayoutEffect(()=>setQuery(initialQuery),[initialQuery]);
  const scroll=useRef<ScrollBoxRenderable>(null);
  const click=useRef<{id:string;x:number;y:number}|null>(null);
  const filtered=useMemo(()=>items.filter(item=>`${item.id} ${item.name} ${item.description??""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())),[items,query]);
  const exact=filtered.findIndex(item=>item.id.toLowerCase()===query.replace(/^\//,"").toLowerCase());
  const selected=Math.max(0,selectedId===null?exact:filtered.findIndex(item=>item.id===selectedId)),item=filtered[selected];
  const rows=useMemo(()=>{let group:string|undefined;const result:{id:string;heading?:string;item?:PickItem}[]=[];for(const value of filtered){if(value.group&&group!==value.group)result.push({heading:value.group,id:`group:${value.group}`});group=value.group;result.push({item:value,id:value.id});}return result;},[filtered]);
  useLayoutEffect(()=>{const row=rows.findIndex(value=>value.id===item?.id);if(scroll.current&&row>=0)scroll.current.scrollTo(Math.max(0,row-Math.floor(Math.max(1,height-9)/2)));},[selected,item?.id,query]);
  const choose=()=>{if(item&&!item.disabled)onSelect?.(item.id);};
  useKeyboard(key=>{
    if(["up","down","return","kpenter","tab"].includes(key.name)){
      key.preventDefault();key.stopPropagation();if(key.repeated&&["return","kpenter"].includes(key.name))return;
      if(["return","kpenter"].includes(key.name)){choose();return;}
      if(key.name==="tab"){if(item)setQuery(item.name.split(" — ")[0]!.replace(/^\//,""));return;}
      setSelectedId(filtered[Math.max(0,Math.min(filtered.length-1,selected+(key.name==="down"?1:-1)))]?.id??null);setArmedId(null);
    } else if(key.ctrl&&["f","d","x"].includes(key.name)){
      if(key.name==="f"&&onFavorite){key.preventDefault();key.stopPropagation();if(item){setSelectedId(item.id);onFavorite(item.id);}}
      if(key.name==="x"&&onStop){key.preventDefault();key.stopPropagation();if(item&&!key.repeated)onStop(item.id);}
      if(key.name==="d"&&onDelete){key.preventDefault();key.stopPropagation();if(item&&!key.repeated){if(armedId===item.id){setArmedId(null);onDelete(item.id);}else setArmedId(item.id);}}
    }
  });
  return <box flexDirection="column" flexGrow={1} minHeight={0}>
    <text fg={theme.accent} attributes={TextAttributes.BOLD} flexShrink={0} height={1}>{title}</text>
    <box border borderStyle="rounded" borderColor={theme.border} height={3} flexShrink={0} flexDirection="row" paddingX={1}>
      <text selectable={false} fg={theme.accent} width={2}>› </text>
      <input id="picker-search" focused value={query} placeholder="search…" flexGrow={1} textColor={theme.text} backgroundColor={theme.background} focusedBackgroundColor={theme.background}
        onInput={value=>{setQuery(value);setSelectedId(null);setArmedId(null);onQuery?.(value);}}/>
    </box>
    <scrollbox ref={scroll} flexGrow={1} minHeight={1} scrollX={false} scrollY>
      {rows.map(row=>row.heading?<text key={row.id} fg={theme.muted} height={1} selectable={false}>{row.heading}</text>:<box key={row.id} id={`picker-item:${row.id}`} width="100%" height={1} flexShrink={0}
        backgroundColor={row.id===item?.id?theme.border:theme.background}
        onMouseDown={event=>{event.stopPropagation();click.current={id:row.id,x:event.x,y:event.y};setSelectedId(row.id);setArmedId(null);}}
        onMouseDrag={()=>{click.current=null;}}
        onMouseUp={event=>{event.stopPropagation();const down=click.current;click.current=null;if(down?.id===row.id&&down.x===event.x&&down.y===event.y&&!row.item!.disabled)onSelect?.(row.id);}}>
        <text height={1} wrapMode="none" selectable={false} fg={row.item!.disabled?theme.muted:row.id===item?.id?theme.accentBright:theme.text}>{displayText(`${row.id===item?.id?"›":" "} ${row.item!.active===undefined?"":row.item!.active?"✓ ":"  "}${row.item!.name}`)}</text>
      </box>)}
      {!rows.length?<text fg={theme.muted}>no results</text>:null}
    </scrollbox>
    {item?.description&&height>=11?<text fg={theme.info} height={2} wrapMode="word" flexShrink={0}>{displayText(item.description)}</text>:null}
    <text id={armedId&&armedId===item?.id?"picker-confirm":undefined} fg={armedId===item?.id?theme.warning:theme.muted} height={1} wrapMode="none" flexShrink={0}>{armedId&&armedId===item?.id?`delete "${item.name}"? ctrl+d again to confirm · ↑↓ cancel`:`↑↓ select · enter open${onFavorite?" · ctrl+f favorite":onDelete?" · ctrl+d delete":onStop?" · ctrl+x stop":" · tab complete"}`}</text>
  </box>;
}
