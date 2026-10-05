import {useState,useSyncExternalStore} from 'react';
import {useKeyboard} from '@opentui/react';
import type {ChatController} from '../core';
import {Picker} from './picker';
import {theme,displayText} from './theme';
export function UserInstructions({controller,height,skills,onBack}:{controller:ChatController;height:number;skills:boolean;onBack:()=>void}){
 const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot),[error,setError]=useState<string|null>(null);
 useKeyboard(key=>{if(key.name==='escape'){key.preventDefault();key.stopPropagation();onBack();}else if(!skills&&key.ctrl&&key.name==='d'){key.preventDefault();key.stopPropagation();for(const source of controller.getSnapshot().session?.instructionSources??[])if(source.kind==='markdown')controller.removeInstruction(source.id);}});
 const selected=state.session?.instructionSources??[];
 let failure=error;
 let items:{id:string;name:string}[]=[];
 try {items=skills?controller.listSkills().map(s=>({id:s.id,name:`${selected.some(v=>v.id===s.id)?'[on]':'[off]'} ${s.id} · ${s.name}`})):selected.map(s=>({id:s.id,name:`remove ${s.name}`}));}catch{failure??='could not load skills; check SKILL.md format and file permissions.';}
 const run=(fn:()=>void)=>{try{fn();setError(null);}catch{setError('could not select this source; check path, size and format.');}};
 return <box flexDirection="column" flexGrow={1}>
  <text fg={theme.accent}>{skills?'skills · enter toggle · esc back':'your markdown · project-relative path · enter select · esc back'}</text>
  <text fg={theme.muted}>profile and private model instructions stay independent</text>
  {failure?<text fg={theme.error}>{displayText(failure)}</text>:null}
  {!skills?<input focused backgroundColor={theme.surface} textColor={theme.text} placeholder="rules.md" onSubmit={value=>{if(typeof value==="string")run(()=>controller.selectMarkdown(value));}}/>:null}
  {skills?<Picker title={skills?'available skills':'selected sources · enter remove'} height={Math.max(3,height-5)} items={items} onSelect={id=>run(()=>skills?controller.toggleSkill(id):controller.removeInstruction(id))}/>:<text fg={theme.muted}>{selected.filter(s=>s.kind==="markdown").map(s=>`selected: ${s.name}`).join("\n") || "no markdown selected"} · ctrl+d clear</text>}
 </box>;
}
