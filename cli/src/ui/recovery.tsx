import {useEffect,useRef,useState} from 'react';
import {useKeyboard} from '@opentui/react';
import type {ChatController} from '../core';
import {AdvancedRecoveryView} from './agent-lifecycle';
import {theme,displayText} from './theme';

export function RecoveryView(props:{controller:ChatController;height:number;onBack:()=>void}){
 const [advanced,setAdvanced]=useState(false);
 return advanced?<AdvancedRecoveryView {...props} onRecovered={props.onBack} onBack={()=>setAdvanced(false)}/>:<SimpleRecovery {...props} onDetails={()=>setAdvanced(true)}/>;
}

function SimpleRecovery({controller,height,onBack,onDetails}:{controller:ChatController;height:number;onBack:()=>void;onDetails:()=>void}){
 type Summary=ReturnType<ChatController['getAgentRecoverySummary']>;
 const read=():Summary=>{try{return controller.getAgentRecoverySummary();}catch{return null;}};
 const [summary,setSummary]=useState(read),[review,setReview]=useState(false),[selected,setSelected]=useState<number|null>(0);
 const [observed,setObserved]=useState<{toolId:string;status:'succeeded'|'failed'}[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const pointer=useRef<{index:number;x:number;y:number;review:boolean}|null>(null);
 const inFlight=useRef(false);
 const running=controller.getSnapshot().busy;
 useEffect(()=>{if(busy&&running)onBack();},[busy,running,onBack]);
 const tool=summary?.tools[observed.length];
 const finish=async(items:typeof observed)=>{
  if(!summary||inFlight.current)return;inFlight.current=true;setBusy(true);setError(null);
  try{await controller.recoverObservedAndContinue(summary.runId,summary.fingerprint,items);
   if(controller.getSnapshot().agent?.phase!=='recovery_required'&&!controller.getSnapshot().error)onBack();
   else {setError(controller.getSnapshot().error??'could not resume. check the action or start a new conversation.');setSummary(read());setReview(false);setObserved([]);setSelected(0);}
  }catch{setError('could not resume. previous work is preserved.');}finally{inFlight.current=false;setBusy(false);}
 };
 const choose=(index:number)=>{
  if(inFlight.current||busy||controller.getSnapshot().busy||controller.getSnapshot().agent?.approval)return;
  if(review&&tool){
   const items=[...observed,{toolId:tool.id,status:index===0?'succeeded' as const:'failed' as const}];
   setObserved(items);setSelected(null);
   if(items.length===summary!.tools.length)void finish(items);
   return;
  }
  if(index===1){inFlight.current=true;setBusy(true);void controller.forceClose().then(()=>{if(!controller.getSnapshot().error)onBack();else setError(controller.getSnapshot().error);}).catch(()=>setError('could not create a conversation. previous work is preserved.')).finally(()=>{inFlight.current=false;setBusy(false);});return;}
  const current=read();setSummary(current);setObserved([]);setError(null);
  if(!current){setError('no saved task to resume. start a new conversation.');return;}
  if(current.blocked){setError(current.blocked);return;}
  if(current.tools.length){setReview(true);setSelected(null);return;}
  // Use the refreshed snapshot, not one captured before the key press.
  inFlight.current=true;setBusy(true);void controller.recoverObservedAndContinue(current.runId,current.fingerprint,[]).then(()=>{
   if(!controller.getSnapshot().error)onBack();else setError(controller.getSnapshot().error);
  }).catch(()=>setError('could not resume. previous work is preserved.')).finally(()=>{inFlight.current=false;setBusy(false);});
 };
 useKeyboard(key=>{
  if(controller.getSnapshot().agent?.approval)return;
  if(!['escape','up','down','return','kpenter'].includes(key.name)&&!(key.ctrl&&key.name==='d'))return;
  key.preventDefault();key.stopPropagation();if(key.repeated||busy)return;
  if(key.name==='escape'){if(review){setReview(false);setObserved([]);setSelected(0);setError(null);}else onBack();return;}
  if(key.ctrl&&key.name==='d'){onDetails();return;}
  if(key.name==='up'||key.name==='down'){setSelected(key.name==='up'?0:1);return;}
  if((key.name==='return'||key.name==='kpenter')&&selected!==null)choose(selected);
 });
 const labels=review?['i checked: action completed','i checked: action did not complete']:['resume saved work','start a new conversation'];
 return <box id="agent-recovery" flexDirection="column" flexGrow={1} minHeight={0}>
  <text fg={theme.accent} flexShrink={0}>{review?'check the uncertain action':'resume your work'}</text>
  <scrollbox flexGrow={1} minHeight={1}>
   <text fg={theme.text}>{review
    ?displayText(`${tool?.name.replaceAll('_',' ')}${tool?.target?'\n'+tool.target:''}\n\nCheck what happened before choosing. The previous task and its processes must be stopped. If unsure, press esc; you can start a new conversation.`)
    :`your saved messages and files are kept.\n${summary?.canContinueWithPrompt?'press esc and send a new prompt to continue in this chat. the uncertain browser action stays recorded; further effects require approval.':summary?.tools.length?`${summary.tools.length} action(s) need your check before resuming. completed actions will not be repeated.`:'resume continues from the saved task.'}\na new conversation leaves this task in /sessions.`}</text>
   {error?<text fg={theme.error}>{displayText(error)}</text>:null}
  </scrollbox>
  {labels.map((label,index)=><box key={`${review}:${index}`} id={`recovery-choice-${index}`} border borderStyle="rounded" borderColor={selected===index?theme.accent:theme.border} height={3} flexShrink={0}
    onMouseDown={event=>{event.stopPropagation();pointer.current={index,x:event.x,y:event.y,review};setSelected(index);}}
    onMouseDrag={()=>{pointer.current=null;}}
    onMouseUp={event=>{event.stopPropagation();const down=pointer.current;pointer.current=null;if(down?.index===index&&down.x===event.x&&down.y===event.y&&down.review===review)choose(index);}}>
    <text fg={busy?theme.muted:selected===index?theme.accent:theme.text}>{` ${selected===index?'›':' '} ${label}`}</text>
  </box>)}
  <text fg={theme.muted} flexShrink={0}>{busy?'resuming…':height<16?'↑↓ · enter · esc · ctrl+d details':'↑↓ select · enter confirm · esc back · ctrl+d details'}</text>
 </box>;
}
