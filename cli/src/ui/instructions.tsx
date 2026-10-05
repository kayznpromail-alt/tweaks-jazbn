import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {useKeyboard} from '@opentui/react';
import type {ChatController} from '../core';
import type {InstructionSelection} from '../instructions/selection';
import {InstructionsView as ProjectInstructionsView} from './agent-lifecycle';
import {TextDetails} from './agent-views';
import {Picker,type PickItem} from './picker';
import {displayText,theme} from './theme';

export function InstructionsView({controller,height,onBack}:{controller:ChatController;height:number;onBack:()=>void}) {
 const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot);
 const [project,setProject]=useState(false);
 useKeyboard(key=>{
  if(key.ctrl&&key.name==='g'&&state.agent&&!state.agent.approval){key.preventDefault();key.stopPropagation();if(!key.repeated)setProject(value=>!value);}
 });
 return <box flexDirection="column" flexGrow={1} minHeight={0}>
  <box height={1} flexShrink={0} flexDirection="row" gap={2}>
   <text id="instructions-personal-tab" fg={project?theme.muted:theme.accent} selectable={false} onMouseDown={()=>setProject(false)}>{project?'personal':'[personal]'}</text>
   {state.agent?<text id="instructions-project-tab" fg={project?theme.accent:theme.muted} selectable={false} onMouseDown={()=>setProject(true)}>{project?'[project]':'project'} · ctrl+g</text>:null}
  </box>
  {project&&state.agent?<ProjectInstructionsView controller={controller} height={height-1} onBack={onBack}/>
   :<PersonalInstructions controller={controller} height={height-1} onBack={onBack}/>}
 </box>;
}

function PersonalInstructions({controller,height,onBack}:{controller:ChatController;height:number;onBack:()=>void}) {
 const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot);
 const [files,setFiles]=useState<ReturnType<ChatController['listPersonalInstructions']>>([]);
 const [preview,setPreview]=useState<{source:InstructionSelection;saved:boolean}|null>(null);
 const [error,setError]=useState<string|null>(null);
 const positions=useRef(new Map<string,number>());
 const active=state.session?.instructionSources?.find(source=>source.kind==='markdown');
 const refresh=()=>{
  setPreview(null);
  try{setFiles(controller.listPersonalInstructions());setError(null);}
  catch{setFiles([]);setError('could not list instructions; check directory permissions, links and the 128-file limit.');}
 };
 useEffect(refresh,[controller]);
 const change=(fn:()=>void)=>{
  if(controller.getSnapshot().busy){setError('finish or cancel the current operation before changing instructions.');return;}
  try{fn();setError(null);}
  catch{setError('choice not saved; refresh and review the file. use UTF-8 markdown up to 128 kib.');}
 };
 const open=(id:string)=>{
  if(id==='saved'&&active){setPreview({source:active,saved:true});setError(null);return;}
  if(id==='none'){change(()=>controller.clearMarkdownInstructions());return;}
  const file=files.find(item=>item.id===id);if(!file)return;
  try{setPreview({source:controller.previewPersonalInstruction(file.name),saved:false});setError(null);}
  catch{setError('could not read this file; use nonempty UTF-8 markdown up to 128 kib, without file links.');}
 };
 useKeyboard(key=>{
  if(controller.getSnapshot().agent?.approval)return;
  const consume=()=>{key.preventDefault();key.stopPropagation();};
  if(key.name==='escape'){consume();if(preview)setPreview(null);else onBack();}
  else if(['return','kpenter'].includes(key.name)&&preview&&!preview.saved){consume();if(!key.repeated)change(()=>controller.selectPersonalInstruction(preview.source.name,preview.source.hash));}
  else if(key.ctrl&&key.name==='r'){consume();if(!key.repeated)refresh();}
  else if(key.ctrl&&key.name==='d'){consume();if(!key.repeated)change(()=>controller.clearMarkdownInstructions());}
  else if(key.ctrl&&key.name==='i'&&preview&&!preview.saved){consume();if(!key.repeated)change(()=>controller.selectPersonalInstruction(preview.source.name,preview.source.hash));}
 });
 const items:PickItem[]=[
  ...files.map(file=>({...file,group:'files · enter preview',active:file.id===active?.id})),
  ...(active?[{id:'saved',name:`active: ${active.name} · saved version`,group:'current selection',active:true}]:[]),
  {id:'none',name:'none · disable own markdown',group:'current selection',active:!active},
 ];
 return <box id="personal-instructions" flexDirection="column" flexGrow={1} minHeight={0}>
  {error?<text fg={theme.error} height={height<18?2:3} flexShrink={0} wrapMode="word">{error}</text>:null}
  {preview?<><TextDetails key={`${preview.source.hash}:${preview.saved}`} title={`${preview.saved?'saved instructions':'preview'} · ${preview.source.name}`}
   identity={`${preview.source.path}:${preview.source.hash}`} positions={positions.current}
   source={`${preview.source.path}\nsha256: ${preview.source.hash}\n${active?.id===preview.source.id&&active.hash===preview.source.hash?'active saved version':'not applied'}\nmodel and server instructions take precedence\n${preview.saved?'saved snapshot; refresh and choose a file to review disk changes':'enter or ctrl+i applies this reviewed version to new tasks'}\n\n${preview.source.content}`}
   hint="ctrl+r refresh · esc back"/>
   <box height={1} flexShrink={0} flexDirection="row" gap={2}>
    {!preview.saved?<text id="instructions-apply" selectable={false} fg={state.busy?theme.muted:theme.accent}
     onMouseDown={()=>change(()=>controller.selectPersonalInstruction(preview.source.name,preview.source.hash))}>enter apply</text>:null}
    <text id="instructions-disable" selectable={false} fg={state.busy?theme.muted:theme.accent}
     onMouseDown={()=>change(()=>controller.clearMarkdownInstructions())}>ctrl+d disable</text>
   </box>
  </>
   :<>
    <text height={1} wrapMode="none" fg={theme.muted} flexShrink={0}>{displayText(controller.getPersonalInstructionsDirectory())}</text>
    <text height={1} wrapMode="none" fg={theme.muted} flexShrink={0}>model and server instructions take precedence</text>
    <Picker title={files.length?'your instructions · ctrl+r refresh': 'add .md files here · ctrl+r refresh'} items={items} height={Math.max(3,height-3)} onSelect={open}/>
   </>}
 </box>;
}
