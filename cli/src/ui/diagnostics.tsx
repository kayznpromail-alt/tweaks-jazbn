import { useMemo,useState } from "react";
import { useKeyboard } from "@opentui/react";
import { join } from "node:path";
import { getDataDirectory } from "../storage/paths";
import type { ChatController } from "../core";
import type { ClipboardAdapter } from "./clipboard";
import { theme,displayText } from "./theme";
export function Diagnostics({controller,clipboard}:{controller:ChatController;clipboard:ClipboardAdapter}) {
  const report=useMemo(()=>controller.getDiagnostics(clipboard.available()),[controller,clipboard]);
  const [path,setPath]=useState(join(getDataDirectory(),`diagnostics-${Date.now()}.json`)),[notice,setNotice]=useState("");
  useKeyboard(key=>{if(key.ctrl&&key.name==="e"&&!key.repeated){key.preventDefault();key.stopPropagation();try{controller.exportDiagnostics(path,report);setNotice("diagnostics saved locally · no upload");}catch{setNotice("could not save report · choose a new writable file");}}});
  return <box flexDirection="column" flexGrow={1} minHeight={0}>
    <text fg={theme.accent}>local diagnostics · no prompts, files or credentials</text>
    <scrollbox flexGrow={1} minHeight={0}><text fg={theme.text}>{displayText(JSON.stringify(report,null,2))}</text></scrollbox>
    <input focused value={path} onInput={setPath} textColor={theme.text} backgroundColor={theme.surface}/>
    <text fg={theme.info}>{notice||"ctrl+e save report · esc back"}</text>
  </box>;
}
