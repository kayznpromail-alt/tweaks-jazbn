import { type TextareaRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import type { ChatController } from "../core";
import { TextDetails } from "./agent-views";
import { Picker } from "./picker";
import { displayText, theme } from "./theme";

type Resolutions = NonNullable<Parameters<ChatController["recoverAgent"]>[1]>;
type Resolution = Resolutions[number];
type Source = ReturnType<ChatController["getInstructionSources"]>[number];
interface UnknownTool { id: string; name: string; args: string }

function exactNumbers(value: unknown, depth = 0): boolean {
  if (depth > 64) return false;
  if (typeof value === "number") return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value));
  if (value && typeof value === "object") return Object.values(value).every((item) => exactNumbers(item, depth + 1));
  return true;
}

// The current façade exposes full recovery metadata as text; fail closed on partial/unrecognized records.
function recoverySnapshot(controller: ChatController) {
  const details = controller.getAgentRecoveryDetails();
  const section = details.split("unknown outcomes (provide explicit observed results; operations are never replayed):\n")[1];
  const tools: UnknownTool[] = [];
  let valid = section !== undefined;
  if (section !== undefined && section !== "none") {
    const lines = section.split("\n");
    for (let i = 0; i < lines.length; i += 2) {
      const match = /^(\S+) · call \S+ · (\S+) · (?:executing|outcome_unknown)$/.exec(lines[i]);
      try {
        if (!match || !lines[i + 1]) throw new Error();
        JSON.parse(lines[i + 1]);
        tools.push({ id: match[1], name: match[2], args: lines[i + 1] });
      } catch { valid = false; }
    }
  }
  return { details, tools, valid, runId: controller.getSnapshot().agent?.runId };
}

export function AdvancedRecoveryView({ controller, height, onBack, onRecovered }: { controller: ChatController; height: number; onBack: () => void; onRecovered?:()=>void }) {
  const [snapshot, setSnapshot] = useState(() => recoverySnapshot(controller));
  const [step, setStep] = useState<"review" | "tools" | "result">("review");
  const [selected, setSelected] = useState<UnknownTool | null>(null);
  const [resolutions, setResolutions] = useState<Resolution[]>([]);
  const [stopped, setStopped] = useState(false);
  const [status, setStatus] = useState<Resolution["status"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const editor = useRef<TextareaRenderable>(null);
  const positions = useRef(new Map<string, number>());
  const busy = () => submitting || controller.getSnapshot().busy;

  useKeyboard((key) => {
    if (controller.getSnapshot().agent?.approval) return;
    const consume = () => { key.preventDefault(); key.stopPropagation(); };
    if (key.name === "escape") {
      consume();
      if (busy()) { setError("recovery is running; ctrl+c cancels the run."); return; }
      if (step !== "review") { setStep("review"); setError(null); }
      else { void controller.recoverAgent(false); onBack(); }
      return;
    }
    if (key.ctrl && ["k", "t", "y", "s", "f", "r"].includes(key.name)) {
      consume();
      if (key.repeated) return;
      if (busy()) { setError("finish or cancel the current operation first."); return; }
      setError(null);
      if (step === "review") {
        if (key.name === "k") setStopped((value) => !value);
        if (key.name === "t") setStep("tools");
        if (key.name === "r") { setSnapshot(recoverySnapshot(controller)); setStopped(false); setResolutions([]); }
        if (key.name === "y") {
          if (!snapshot.valid) { setError("recovery metadata incomplete; refresh before proceeding."); return; }
          if (!stopped) { setError("acknowledge the executor and all descendants have stopped with ctrl+k."); return; }
          if (resolutions.length !== snapshot.tools.length) { setError("provide an observed JSON result and outcome for every unknown tool."); return; }
          const latest = recoverySnapshot(controller);
          if (latest.details !== snapshot.details || latest.runId !== snapshot.runId) {
            setSnapshot(latest); setStopped(false); setResolutions([]); setError("recovery state changed; review again."); return;
          }
          setSubmitting(true);
          void controller.recoverAgent(true, resolutions).then(() => {
            setStopped(false);
            if (!controller.getSnapshot().error) (onRecovered??onBack)();
          }).catch(() => setError("recovery could not complete; review the controller status.")).finally(() => setSubmitting(false));
        }
      } else if (step === "result") {
        if (key.name === "s") setStatus("succeeded");
        if (key.name === "f") setStatus("failed");
        if (key.name === "y" && selected) {
          if (!status) { setError("choose the observed outcome: ctrl+s succeeded or ctrl+f failed."); return; }
          const text = editor.current?.plainText ?? "";
          try {
            if (!text.trim() || Buffer.byteLength(text) > 131072) throw new Error();
            const result: Resolution["result"] = JSON.parse(text);
            if (!exactNumbers(result)) throw new Error();
            setResolutions((values) => [...values.filter((item) => item.toolId !== selected.id), { toolId: selected.id, status, result }]);
            setStopped(false); setStep("review");
          } catch { setError("enter valid observed JSON with finite, safe numbers (maximum 128 kib); no result is supplied automatically."); }
        }
      }
    }
  });

  return <box id="agent-recovery" flexDirection="column" flexGrow={1} minHeight={0}>
    {error ? <text fg={theme.error} flexShrink={0}>{error}</text> : null}
    {step === "review" ? <>
      <TextDetails title="stale run recovery · explicit confirmation" source={`1. inspect recorded results below; completed tools are preserved.\n2. verify each unknown effect in files or process output (ctrl+t).\n3. confirm the original executor and its children have stopped.\n4. recover locally; a new model request is a separate action.\n\n${snapshot.details}\n\nqueued observed resolutions:\n${resolutions.map((item) => `${item.toolId} · ${item.status}\n${JSON.stringify(item.result)}`).join("\n") || "none"}`}
        identity="recovery" positions={positions.current} hint="ctrl+t resolve tools · ctrl+r refresh" />
      <text fg={stopped ? theme.accent : theme.warning} flexShrink={0}>{stopped ? "stopped executor + descendants: acknowledged" : "executor + all descendants stopped: unconfirmed"}</text>
      <text fg={theme.warning} flexShrink={0}>ctrl+k acknowledge stopped · ctrl+y recover</text>
    </> : step === "tools" ? <Picker title="unknown effects · choose observed result" height={height - (error ? 2 : 0)}
      items={snapshot.tools.map((tool) => ({ id: tool.id, name: `${tool.name} · ${tool.id} · ${resolutions.find((item) => item.toolId === tool.id)?.status ?? "unresolved"}` }))}
      onSelect={(id) => { setSelected(snapshot.tools.find((tool) => tool.id === id)!); setStatus(null); setStep("result"); }} />
      : <>
        <text fg={theme.accent} flexShrink={0}>{displayText(`${selected?.name} · ${selected?.id}`)}</text>
        <scrollbox height={Math.max(2, Math.min(5, height - 9))} flexShrink={0}><text fg={theme.muted}>{displayText(selected?.args ?? "")}</text></scrollbox>
        <text fg={theme.warning} flexShrink={0}>{`observed outcome: ${status ?? "not selected"} · enter only adds a line`}</text>
        <textarea id="recovery-result" ref={editor} focused flexGrow={1} minHeight={1} initialValue="" placeholder="type the observed result as JSON; nothing is inferred"
          textColor={theme.text} backgroundColor={theme.background} focusedBackgroundColor={theme.background}
          keyBindings={[{ name: "return", action: "newline" }, { name: "kpenter", action: "newline" }]} />
        <text fg={theme.muted} flexShrink={0}>ctrl+s succeeded · ctrl+f failed</text>
        <text fg={theme.muted} flexShrink={0}>ctrl+y queue result · esc back</text>
      </>}
  </box>;
}

export function InstructionsView({ controller, height, onBack }: { controller: ChatController; height: number; onBack: () => void }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState<Source | null>(null);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const positions = useRef(new Map<string, number>());
  const refresh = () => {
    try { setSources(controller.getInstructionSources()); setSelected(null); setError(null); }
    catch { setError("instruction sources unavailable; refresh after the current operation."); }
  };
  useEffect(refresh, [controller]);
  useKeyboard((key) => {
    if (controller.getSnapshot().agent?.approval) return;
    const consume = () => { key.preventDefault(); key.stopPropagation(); };
    if (key.name === "escape") { consume(); if (selected) setSelected(null); else onBack(); }
    else if (key.ctrl && key.name === "r") { consume(); refresh(); }
    else if (key.ctrl && ["i", "d"].includes(key.name) && selected) {
      consume(); if (key.repeated) return;
      if (controller.getSnapshot().busy) { setError("finish or cancel the current operation before changing trust."); return; }
      try {
        controller.setInstructionTrust(selected.path, selected.hash, key.name === "i" ? "include" : "ignore");
        const next = controller.getInstructionSources(); setSources(next);
        setSelected(next.find((source) => source.path === selected.path && source.hash === selected.hash) ?? selected); setError(null);
      } catch { setError("choice not saved; refresh and review the current source hash."); }
    }
  });
  return <box id="agent-instructions" flexDirection="column" flexGrow={1} minHeight={0}>
    {error ? <text fg={theme.error} flexShrink={0}>{error}</text> : null}
    {selected ? <TextDetails title="instruction source · untrusted reference data" identity={`${selected.path}:${selected.hash}`} positions={positions.current}
      source={`${selected.path}\nscope: ${selected.scope}\nsha256: ${selected.hash}\ndecision: ${selected.decision} (${selected.explicit ? "explicit" : "project default"})\n\n${content}`}
      hint="ctrl+i include · ctrl+d ignore · ctrl+r refresh" />
      : <Picker title="instructions · root default include; nested/changed pending" items={sources.map((source) => ({ id: source.path,
        name: `${source.path} · ${source.decision} · ${source.explicit ? "explicit" : "project default"}`, description: source.hash }))} height={height}
        onSelect={(path) => { const source = sources.find((item) => item.path === path); if (source) { setSelected(source); setContent(controller.readInstructionSource(source.path, source.hash)); } }} />}
  </box>;
}

export function OutputView({ controller, height, onBack,initialId }: { controller: ChatController; height: number; onBack: () => void; initialId?:string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState<ReturnType<ChatController["readAgentOutput"]> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [manualId, setManualId] = useState("");
  const positions = useRef(new Map<string, number>());
  const pageSize = 8192;
  const load = (id: string, offset: number) => {
    try { setPage(controller.readAgentOutput(id, offset, pageSize)); setSelected(id); setError(null); setManual(false); }
    catch { setError("output unavailable in this session; choose or enter a valid durable id."); }
  };
  useKeyboard((key) => {
    if (controller.getSnapshot().agent?.approval) return;
    const consume = () => { key.preventDefault(); key.stopPropagation(); };
    if (key.name === "escape") { consume(); if(initialId)onBack();else if (selected || manual) { setSelected(null); setPage(null); setManual(false); setError(null); } else onBack(); }
    else if (key.ctrl && key.name === "o" && !selected) { consume(); setManual(true); }
    else if (selected && page && ["pageup", "pagedown"].includes(key.name)) {
      consume();
      if (key.name === "pageup") load(selected, Math.max(0, page.offset - pageSize));
      else if (page.nextOffset !== null) load(selected, page.nextOffset);
    } else if (selected && key.ctrl && key.name === "r") { consume(); load(selected, page?.offset ?? 0); }
  });
  useEffect(()=>{if(initialId)load(initialId,0);},[initialId]);
  return <box id="agent-output" flexDirection="column" flexGrow={1} minHeight={0}>
    {error ? <text fg={theme.error} flexShrink={0}>{error}</text> : null}
    {selected && page ? <>
      <TextDetails key={`${selected}:${page.offset}`} title={`output · ${selected}`} source={page.content || "no output recorded"}
        identity={`${selected}:${page.offset}`} positions={positions.current} hint="pgup / pgdn pages · ↑↓ scroll · ctrl+r refresh" />
      <text fg={theme.muted} flexShrink={0}>{`characters ${page.offset}-${page.offset + page.content.length} / ${page.total} · ${page.nextOffset === null ? "last page" : "more"}`}</text>
    </> : manual ? <>
      <text fg={theme.accent}>durable request or tool id</text>
      <input id="output-id" focused value={manualId} onInput={setManualId} onSubmit={(id) => load(String(id).trim(), 0)}
        textColor={theme.text} backgroundColor={theme.background} focusedBackgroundColor={theme.background} />
    </> : <>
      <Picker title="durable output · request / tool" items={controller.getAgentOutputEntries().map(({ id, label }) => ({ id, name: `${label} · ${id}` })).reverse()} height={height - 1}
        onSelect={(id) => load(id, 0)} />
      <text fg={theme.muted} flexShrink={0}>ctrl+o enter an older durable id</text>
    </>}
  </box>;
}
