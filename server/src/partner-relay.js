import {errorBody} from './relay.js';

const codes = new Set(['rate_limited','rate_limit_error','concurrency_limited','quota_exceeded','model_forbidden','key_expired','key_paused','jailbreak_not_allowed','jailbreak_model_mismatch','jailbreak_revision_changed','model_pricing_unavailable','context_length_exceeded','invalid_request','unauthorized','forbidden']);

// The upstream owns partner aliases, permissions and billing. Preserve its wire
// protocol without locally remapping models, charging again or retrying generation.
export async function partnerRelay({cfg,kind,path,body,incoming,key}) {
 const headers=new Headers({'content-type':'application/json',authorization:`Bearer ${key}`});
 for(const name of ['accept','anthropic-version','anthropic-beta']) {
  const value=incoming.headers.get(name);if(value)headers.set(name,value);
 }
 if(kind==='anthropic'&&!headers.has('anthropic-version'))headers.set('anthropic-version','2023-06-01');
 let response;
 try {
  response=await fetch(`${cfg.partnerBase.replace(/\/+$/,'').replace(/\/v1$/,'')}/v1${path}`,{
   method:'POST',headers,body:JSON.stringify(body),redirect:'error',
   signal:AbortSignal.any([incoming.signal,AbortSignal.timeout(120_000)]),
  });
 } catch {
  return Response.json(errorBody(kind,502,'upstream_unavailable','The model provider did not respond. Try again.'),{status:502,headers:{'cache-control':'no-store'}});
 }
 const outgoing=new Headers({'cache-control':'no-store','x-accel-buffering':'no'});
 for(const name of ['x-request-id','retry-after']) {
  const value=response.headers.get(name);if(value)outgoing.set(name,value);
 }
 if(!response.ok) {
  let code;
  try {
   const value=await response.json();code=value?.error?.code??value?.error?.type;
   // This gateway currently uses rate_limited for both RPM and exhausted model
   // budgets. Recognize only its exact known quota errors, never arbitrary text.
   if(response.status===429&&code==='rate_limited'&&['Wyczerpano limit jednostek dla wybranego modelu.','Wyczerpano limit jednostek rozliczeniowych.'].includes(value?.error?.message))code='quota_exceeded';
  } catch {}
  if(!codes.has(code))code=({401:'unauthorized',402:'quota_exceeded',403:'forbidden',429:'rate_limited'})[response.status]??(response.status>=500?'upstream_unavailable':'invalid_request');
  const message=code==='quota_exceeded'?'The account or model token allowance is exhausted. Contact the key owner.':response.status===429?'Request limit reached. Retry after the indicated delay.':response.status>=500?'The model is temporarily unavailable.':'The request was rejected. Check model access, mode revision and account limits.';
  return Response.json(errorBody(kind,response.status,code,message),{status:response.status,headers:outgoing});
 }
 for(const suffix of ['mode','mode-revision']) {
  const value=response.headers.get(`x-dawvq-${suffix}`)??response.headers.get(`x-edgey-${suffix}`);
  if(value)outgoing.set(`x-edgey-${suffix}`,value);
 }
 const contentType=response.headers.get('content-type')??'';
 if(!/^(application\/json|text\/event-stream)(?:\s*;|$)/i.test(contentType)) {
  await response.body?.cancel();
  return Response.json(errorBody(kind,502,'upstream_unavailable','Unexpected model response format.'),{status:502,headers:outgoing});
 }
 outgoing.set('content-type',contentType);
 return new Response(response.body,{status:response.status,headers:outgoing});
}
