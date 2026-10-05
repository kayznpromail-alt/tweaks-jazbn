import { RGBA, type OptimizedBuffer } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { theme, logoPalette, dialogBackdropOpacity } from "./theme";
import { sampleJailbreakTransition, transitionDuration, waveAtRow } from "./jailbreak-animation";
const purple = {accent:"#b66bff",accentBright:"#dfb8ff",accentDeep:"#7438a8"};
const palette = new Map<string, {from:RGBA;to:RGBA}>();
const key=(b:Uint16Array,i=0)=>`${b[i]},${b[i+1]},${b[i+2]}`;
for(const [name,color] of Object.entries(purple)) {
 const from=RGBA.fromHex(theme[name as keyof typeof theme]);palette.set(key(from.buffer),{from,to:RGBA.fromHex(color)});
}
for(const [name,color] of Object.entries({"@":"#f1ddff","0":"#d39aff","o":"#9447ce","#":"#612b8b","%":"#34174e"})) {
 const from=RGBA.fromHex(logoPalette[name as keyof typeof logoPalette]);palette.set(key(from.buffer),{from,to:RGBA.fromHex(color)});
}
// Native opacity blends accent colors with neutral surfaces before post-processing.
// Include those same blended colors so opening a dialog cannot restore turquoise accents.
const opacity=Math.round(dialogBackdropOpacity*255)/255;
for(const {from,to} of [...palette.values()])for(let gray=0;gray<=255;gray++) {
 const blend=(color:RGBA)=>RGBA.fromInts(...[color.r,color.g,color.b].map(value=>Math.round(value*255*opacity+gray*(1-opacity))) as [number,number,number]);
 const dimFrom=blend(from),id=key(dimFrom.buffer);
 if(!palette.has(id))palette.set(id,{from:dimFrom,to:blend(to)});
}
/** recolor turquoise accents and logo tones; neutral backgrounds/text remain unchanged. */
export function applyPurpleSweep(buffer:OptimizedBuffer,progress:number,enabling:boolean):void {
 const {fg,bg}=buffer.buffers;
 const shades=new Map<number,Map<string,Uint16Array>>();
 for(let y=0;y<buffer.height;y++) {
  const amount=waveAtRow(y,buffer.height,progress,enabling);if(amount===0)continue;
  let converted=shades.get(amount);
  if(!converted){converted=new Map();for(const [id,{from,to}] of palette)converted.set(id,RGBA.fromValues(from.r+(to.r-from.r)*amount,from.g+(to.g-from.g)*amount,from.b+(to.b-from.b)*amount,1).buffer);shades.set(amount,converted);}
  for(let x=0;x<buffer.width;x++)for(const channel of [fg,bg]) {
   const offset=(y*buffer.width+x)*4, replacement=converted.get(key(channel,offset));
   if(replacement) {channel[offset]=replacement[0]!;channel[offset+1]=replacement[1]!;channel[offset+2]=replacement[2]!;channel[offset+3]=replacement[3]!;}
  }
 }
}
export function useJailbreakPresentation(enabled:boolean,sessionId:string|undefined,logoVisible:boolean) {
 const renderer=useRenderer();
 const state=useRef({enabled,sessionId,logoVisible,started:0,active:false,live:false});
 useLayoutEffect(()=>{state.current.logoVisible=logoVisible;},[logoVisible]);
 const finish=()=>{state.current.active=false;if(state.current.live){state.current.live=false;renderer.dropLive();}renderer.requestRender();};
 useEffect(()=>{state.current.enabled=enabled;if(state.current.sessionId!==sessionId){finish();state.current.sessionId=sessionId;}renderer.requestRender();},[enabled,sessionId]);
 useEffect(()=>{
  const process=(buffer:OptimizedBuffer)=>{
   const current=state.current,elapsed=current.active?performance.now()-current.started:transitionDuration;
   if(current.active&&elapsed>=transitionDuration)finish();
   const logo=current.active&&current.logoVisible?renderer.root.findDescendantById("edgey-logo"):undefined;
   if(logo&&!logo.isDestroyed&&logo.visible&&logo.width>0&&logo.height>0
     &&logo.x>=0&&logo.y>=0&&logo.x+logo.width<=buffer.width&&logo.y+logo.height<=buffer.height){
    const {width,height,x:left,y:top}=logo;
    buffer.fillRect(left,top,width,height,RGBA.fromHex(theme.background));
    const frame=sampleJailbreakTransition(Math.floor(elapsed / (1000/30)) * (1000/30),width,height,current.enabled);
    for(const [y,row] of frame.split("\n").entries()) buffer.drawText(row,left,top+y,RGBA.fromHex(theme.accentBright),RGBA.fromHex(theme.background));
   }
   if(current.active||current.enabled)applyPurpleSweep(buffer,current.active?Math.max(0,Math.min(1,(elapsed-300)/800)):1,current.enabled);
  };
  renderer.addPostProcessFn(process);
  return ()=>{renderer.removePostProcessFn(process);if(state.current.live){state.current.live=false;renderer.dropLive();}};
 },[renderer]);
 return {
  active:()=>state.current.active,
  skip:finish,
  start:(next:boolean,id:string|undefined)=>{state.current.enabled=next;state.current.sessionId=id;state.current.started=performance.now();
   if(process.env.EDGEY_CLI_ANIMATIONS==="0"){finish();return;}
   state.current.active=true;if(!state.current.live){state.current.live=true;renderer.requestLive();}renderer.requestRender();},
 };
}
