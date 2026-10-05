import type {Gateway,ChatRequest,PrivateMode} from '../types';
import {ApiError} from './errors';
export const privateModels = {'astra-private':'gpt-6-astra','opus-private':'claude-opus-5'} as const;
export const privateModeId = (model:string) => (Object.keys(privateModels) as PrivateMode['id'][]).find(id=>privateModels[id]===model);
export function readPrivateMode(value:unknown):PrivateMode {
 const v=value as PrivateMode;
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['id','revision','overheadTokens'].includes(k))||!Object.hasOwn(privateModels,v.id)||typeof v.revision!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(v.revision)||!Number.isSafeInteger(v.overheadTokens)||v.overheadTokens<1||v.overheadTokens>262144)throw new ApiError('invalid_response');
 return {id:v.id,revision:v.revision,overheadTokens:v.overheadTokens};
}
export function withPrivateMode(gateway:Gateway,mode:PrivateMode|undefined,onApplied:(mode:PrivateMode)=>void):Gateway {
 if(!mode)return gateway;const snapshot=readPrivateMode(mode);let reservation=snapshot.overheadTokens;
 return {contextReservation:model=>model===privateModels[snapshot.id]?reservation:0,listModels:signal=>gateway.listModels(signal),privateCapabilities:gateway.privateCapabilities?.bind(gateway),modelMetadata:gateway.modelMetadata?.bind(gateway),modelContext:gateway.modelContext?.bind(gateway),diagnostics:gateway.diagnostics?.bind(gateway),
  streamChat:async(request:ChatRequest)=>{
   if(request.model!==privateModels[snapshot.id])throw new ApiError('jailbreak_model_mismatch');
   const available=await gateway.privateCapabilities?.(request.signal);
   const current=available?.find(item=>item.id===snapshot.id);
   if(!current)throw new ApiError('jailbreak_not_allowed');
   if(current.revision!==snapshot.revision)throw new ApiError('jailbreak_revision_changed');
   reservation=Math.max(reservation,current.overheadTokens);
   snapshot.overheadTokens=reservation;
   return gateway.streamChat({...request,privateMode:snapshot,onPrivateModeApplied:()=>{onApplied(snapshot);request.onPrivateModeApplied?.(snapshot);}});
  }};
}
