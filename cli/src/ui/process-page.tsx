import { useKeyboard } from "@opentui/react";
import type { TextareaRenderable } from "@opentui/core";
import { useEffect, useRef, useState } from "react";
import type { ChatController } from "../core";
import type { ProcessDetail, ProcessOutputPage } from "../tools/process";
import { TextDetails } from "./agent-views";
import { theme } from "./theme";

/** Only the open page polls output; process chunks never enter the chat snapshot. */
export function ProcessPage({ controller, jobId, onBack }: { controller: ChatController; jobId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<ProcessDetail | null>(null);
  const [stream, setStream] = useState<"stdout" | "stderr">("stdout");
  const [live, setLive] = useState(true);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<ProcessOutputPage | null>(null);
  const [error, setError] = useState("");
  const positions = useRef(new Map<string, number>());
  const [input, setInput] = useState(false);
  const [sending, setSending] = useState(false);
  const editor = useRef<TextareaRenderable>(null);
  const send = async (eof: boolean) => {
    if (sending) return;
    setSending(true);
    try {
      await controller.sendAgentJobInput(jobId, editor.current?.plainText ?? "", eof);
      editor.current?.clear(); setInput(false); setError("");
    } catch { setError("input not sent or completion unknown; inspect job status before retrying."); }
    finally { setSending(false); }
  };
  useEffect(() => {
    const refresh = () => {
      try {
        setDetail(controller.getAgentJobDetail(jobId));
      } catch { setError("process details unavailable; owner or output may have changed."); }
    };
    refresh();
    const timer = setInterval(refresh, 250);
    return () => clearInterval(timer);
  }, [controller, jobId, live, stream, offset]);
  useEffect(() => {
    if (!live) {
      try { setPage(controller.readAgentJobOutput(jobId, stream, offset)); }
      catch { setError("output page unavailable."); }
    }
  }, [controller, jobId, live, stream, offset]);
  useKeyboard((key) => {
    if (controller.getSnapshot().agent?.approval) return;
    if (key.name === "escape") { key.preventDefault(); key.stopPropagation(); if (input) setInput(false); else onBack(); return; }
    if (key.ctrl && ["i", "y", "d"].includes(key.name)) {
      key.preventDefault(); key.stopPropagation();
      if (key.repeated) return;
      if (key.name === "i" && detail?.stdinState === "open") setInput(true);
      if (input && ["y", "d"].includes(key.name)) void send(key.name === "d");
      return;
    }
    if (key.ctrl && ["x", "o", "e", "l"].includes(key.name)) {
      key.preventDefault(); key.stopPropagation();
      if (key.repeated) return;
      if (key.name === "x") void controller.stopAgentJob(jobId);
      if (key.name === "o" || key.name === "e") { setStream(key.name === "o" ? "stdout" : "stderr"); setOffset(0); }
      if (key.name === "l") { setLive((value) => !value); setOffset(0); }
    }
    if (!live && ["pageup", "pagedown"].includes(key.name)) {
      key.preventDefault(); key.stopPropagation();
      setOffset(key.name === "pageup" ? Math.max(0, offset - 8192) : page?.nextOffset ?? offset);
    }
  });
  return <box id="process-detail" flexGrow={1} minHeight={0} flexDirection="column">
    <text fg={theme.accent} flexShrink={0}>process · {detail?.category ?? "legacy"} · {detail?.status ?? "loading"}</text>
    <text fg={theme.muted} flexShrink={0}>{`exit ${detail?.exitCode ?? "pending"} · ${detail?.durationMs ?? 0}ms · cleanup ${detail?.cleanup ?? "pending"}`}</text>
    <text fg={theme.muted} flexShrink={0}>{`run-scoped · deadline ${detail?.timeoutMs ?? "unknown"}ms · ${live ? "live tail" : `page ${offset}`} · ${stream}${(live ? detail?.liveTruncated : page?.truncated) ? " · truncated" : ""}`}</text>
    {error ? <text fg={theme.error}>{error}</text> : null}
    {input ? <>
      <text fg={theme.warning} flexShrink={0}>pipe input · enter adds newline · no credentials</text>
      <textarea id="process-input" ref={editor} focused flexGrow={1} minHeight={1} initialValue=""
        textColor={theme.text} backgroundColor={theme.background} focusedBackgroundColor={theme.background}
        keyBindings={[{ name: "return", action: "newline" }, { name: "kpenter", action: "newline" }]} />
      <text fg={theme.muted} flexShrink={0}>{sending ? "sending; awaiting pipe" : "ctrl+y send exact text · ctrl+d send + eof"}</text>
    </> : <TextDetails title={jobId} source={live ? detail?.[stream] ?? "" : page?.content ?? ""}
      identity={`${jobId}:${stream}:${live ? "live" : offset}`} positions={positions.current}
      hint="ctrl+o stdout · ctrl+e stderr · ctrl+l live/page" />}
    <text fg={theme.muted} flexShrink={0}>{`ctrl+x stop · ctrl+i input (${detail?.stdinState ?? "unknown"}) · esc back`}</text>
  </box>;
}
