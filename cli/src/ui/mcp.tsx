import { useState } from 'react';
import type { ChatController } from '../core';
import { theme, displayText } from './theme';

export function McpView({controller}:{controller:ChatController}) {
  const [input,setInput]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[revision,refresh]=useState(0);
  let rows:unknown;try{rows=controller.mcp().status(controller.getSnapshot().project);}catch{rows='invalid mcp configuration; inspect mcp.json';}
  async function submit(value:string){if(busy)return;setInput('');setBusy(true);try{await controller.mcpCommand(value);setMessage('done');}catch(e){setMessage(e instanceof Error?e.message:'mcp operation failed');}finally{setBusy(false);refresh(revision+1);}}
  return <box flexDirection="column" flexGrow={1} minHeight={0} gap={1}>
    <text fg={theme.accent}>mcp · local and remote tools</text>
    <text fg={theme.muted}>review config before trust. stdio programs run with your account permissions.</text>
    <scrollbox flexGrow={1} minHeight={0}><text fg={theme.text}>{displayText(JSON.stringify(rows,null,2))}</text></scrollbox>
    <text fg={theme.muted}>{'add {"id":"demo","transport":"stdio","command":"path-to-server","args":[]}\ntrust id fingerprint · connect id · disable id · remove id · select id tool1,tool2\ntoken id bearer-token · pair vscode-pairing-code · refresh\nselection replaces the enabled tool list; select id none disables its tools. secrets are not saved in history.'}</text>
    <text fg={theme.accent}>{busy?'connecting…':displayText(message)}</text>
    <input focused={!busy} value={input} onInput={setInput} onSubmit={value=>{if(typeof value==='string')void submit(value);}} placeholder="mcp command · esc back" textColor={theme.text} backgroundColor={theme.background}/>
  </box>;
}
