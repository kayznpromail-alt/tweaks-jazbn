import { TextAttributes, decodePasteBytes } from "@opentui/core";
import { useKeyboard, usePaste } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { theme } from "./theme";
import type { ClipboardAdapter } from "./clipboard";

export function SecretField({ disabled, onSubmit, clipboard }: {
  disabled: boolean;
  onSubmit: (key: string, remember: boolean) => void;
  clipboard?: ClipboardAdapter;
}) {
  const secret = useRef("");
  const [length, setLength] = useState(0);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const pasteGeneration=useRef(0);
  const disabledNow=useRef(disabled);disabledNow.current=disabled;
  const nativePasteReceipt=useRef<{text:string;at:number}|null>(null);

  function replace(value: string) {
    secret.current = value;
    setLength(value.length);
  }

  function append(value: string) {
    if (!/^[\x21-\x7e]*$/.test(value) || secret.current.length + value.length > 4096) {
      setError("use ascii characters without spaces; maximum 4096 characters.");
      return;
    }
    setError("");
    replace(secret.current + value);
  }

  useEffect(() => () => { secret.current = ""; nativePasteReceipt.current=null;pasteGeneration.current++; }, []);
  usePaste((event) => {
    pasteGeneration.current++;
    event.preventDefault();
    event.stopPropagation();
    const value=decodePasteBytes(event.bytes).trim(),receipt=nativePasteReceipt.current;nativePasteReceipt.current=null;
    if(receipt&&receipt.text===value&&Date.now()-receipt.at<500)return;
    if (!disabled) append(value);
  });
  useKeyboard((key) => {
    nativePasteReceipt.current=null;
    // application shortcuts pass through to the parent view.
    if ((key.ctrl && ["c", "p"].includes(key.name)) || key.name === "escape") return;
    key.preventDefault();
    key.stopPropagation();
    if (disabled) return;
    if(((key.ctrl&&key.name==="v")||(key.shift&&key.name==="insert"))&&clipboard){
      if(key.repeated)return;const generation=++pasteGeneration.current;
      void clipboard.read().then(value=>{if(generation===pasteGeneration.current&&!disabledNow.current){append(value.trim());nativePasteReceipt.current={text:value.trim(),at:Date.now()};}}).catch(()=>{if(generation===pasteGeneration.current&&!disabledNow.current)setError("system paste unavailable; use terminal paste");});return;
    }
    if (key.name === "tab") setRemember((value) => !value);
    else if (key.name === "backspace") replace(secret.current.slice(0, -1));
    else if (key.ctrl && key.name === "u") replace("");
    else if (["return", "kpenter", "linefeed"].includes(key.name)) {
      if (!secret.current) { setError("enter your api key."); return; }
      const value = secret.current;
      replace("");
      onSubmit(value, remember);
    } else if (!key.ctrl && !key.meta && !key.super) append(key.sequence);
  });

  return <box flexDirection="column" gap={1}>
    <text fg={theme.accent} attributes={TextAttributes.BOLD}>connect your api key</text>
    <box border borderStyle="rounded" borderColor={theme.accent} backgroundColor={theme.background} paddingX={1} minHeight={3} flexDirection="row">
      <text selectable={false} fg={theme.accent}>{"› "}</text>
      <text selectable={false} flexShrink={1} minWidth={0} fg={length ? theme.text : theme.muted}>{length ? secret.current : "type or paste your key"}</text>
    </box>
    <text fg={theme.text}>{remember ? "storage: system credential store" : "storage: memory for this run only"}</text>
    <text fg={theme.muted}>tab change storage · ctrl+u clear · enter connect</text>
    {error ? <text fg={theme.error}>{error}</text> : null}
    {disabled ? <text fg={theme.accent}>checking your key…</text> : null}
  </box>;
}
