import { useEffect,useState } from 'react';
import { useKeyboard } from '@opentui/react';
import type { ChatController } from '../core';
import type { AccountSnapshot } from '../types';
import { userFacingError } from '../api/errors';
import { theme,displayText } from './theme';

export function AccountView({controller}:{controller:ChatController}) {
  const [generation,setGeneration]=useState(0),[data,setData]=useState<AccountSnapshot|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true);
  useEffect(()=>{const abort=new AbortController();setBusy(true);setError('');
    void controller.getAccount(abort.signal).then(value=>{if(!abort.signal.aborted)setData(value);}).catch(e=>{if(!abort.signal.aborted)setError(userFacingError(e));}).finally(()=>{if(!abort.signal.aborted)setBusy(false);});
    return ()=>abort.abort();
  },[controller,generation]);
  useKeyboard(key=>{if(key.ctrl&&key.name==='r'&&!key.repeated){key.preventDefault();key.stopPropagation();if(!busy)setGeneration(n=>n+1);}});
  const number=(n:number|null)=>n===null?'not specified':n.toLocaleString('en-US');
  const quotaText=data?.quota?`\n\nshared wallet\nlimit: ${number(data.quota.wallet.limit)}\nused: ${number(data.quota.wallet.used)}\nreserved: ${number(data.quota.wallet.reserved)}\navailable: ${number(data.quota.wallet.available)}\n\n${data.quota.key?`this api key\n${data.quota.key.limit===null?'uses shared wallet · no additional limit':`additional limit: ${number(data.quota.key.limit)}`}\nused: ${number(data.quota.key.used)}\nreserved: ${number(data.quota.key.reserved)}${data.quota.key.limit===null?'':`\nremaining key allowance: ${number(data.quota.key.available)}`}`:'no additional key limit'}\n\neffective available: ${number(data.available)}${data.quota.blockedBy.length?`\nblocked by: ${data.quota.blockedBy.map(x=>x==='wallet'?'shared wallet':'additional key limit').join(' and ')}`:''}`:'';
  return <box flexDirection="column" flexGrow={1} minHeight={0}>
    <text fg={theme.accent}>account · weighted billing units</text>
    <scrollbox flexGrow={1} minHeight={0}>
      {busy?<text fg={theme.info}>refreshing account…</text>:null}
      {error?<text fg={theme.warning}>{`could not refresh · ${error}${data?' · showing previous snapshot':''}`}</text>:null}
      {data?<text fg={theme.text}>{displayText(`status: ${data.status}\nplan: ${data.plan??'custom'}\nexpires: ${data.expiresAt??'no expiry'}${quotaText||`\n\nlimit: ${number(data.limit)}\nused: ${number(data.used)}\nreserved: ${number(data.reserved)}\navailable: ${number(data.available)}`}\nestimated requests: ${number(data.estimatedRequests)}\n\nupdated: ${data.updatedAt}\nraw token reports are available in /usage.`)}</text>:null}
    </scrollbox>
    <text fg={theme.muted}>ctrl+r refresh · esc back · no model request</text>
  </box>;
}
