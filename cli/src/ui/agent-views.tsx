import { TextAttributes, type InputRenderable, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useMemo, useRef, useState } from "react";
import type { ChatController } from "../core";
import type { AgentMode, AgentState } from "../types";
import { CodeText } from "./markdown";
import { displayText, theme } from "./theme";

export const agentModes: { id: AgentMode; name: string }[] = [
  { id: "chat", name: "chat — conversation only; no tools" },
  { id: "plan", name: "plan — inspect and plan; no writes or commands" },
  { id: "review", name: "manual — ask before changes and commands" },
  { id: "trusted", name: "accept edits — automatically accept project file edits" },
  { id: "auto", name: "auto — project actions automatic; external actions reviewed" },
  { id: "bypass", name: "bypass permissions — automatic approvals and files outside the project" },
];

export const modeLabels: Record<AgentMode, string> = { chat: "chat", plan: "plan", review: "manual", trusted: "accept edits", auto: "auto", bypass: "bypass permissions" };

export type DetailPositions = Map<string, number>;

export function TextDetails({ title, source, identity, positions, hint }: {
  title: string; source: string; identity: string; positions: DetailPositions; hint?: string;
}) {
  const box = useRef<ScrollBoxRenderable>(null);
  const restored = useRef(false);
  return <box flexDirection="column" flexGrow={1} minHeight={0}>
    <text fg={theme.accent} attributes={TextAttributes.BOLD} flexShrink={0}>{displayText(title)}</text>
    <scrollbox id="agent-details" ref={box} focused flexGrow={1} minHeight={0} scrollX={false} scrollY renderAfter={() => {
      if (!box.current) return;
      if (!restored.current) { box.current.scrollTo(positions.get(identity) ?? 0); restored.current = true; }
      positions.set(identity, box.current.scrollTop);
    }}>
      <text fg={theme.text} wrapMode="word">{displayText(source)}</text>
    </scrollbox>
    <text fg={theme.muted} flexShrink={0}>{hint ?? "↑↓ / pgup / pgdn scroll · ctrl+r refresh"}</text>
  </box>;
}

export function ApprovalView({ approval, project }: { approval: NonNullable<AgentState["approval"]>; project: string }) {
  const cwd = typeof approval.args.cwd === "string" ? approval.args.cwd : project;
  return <box id="agent-approval" flexDirection="column" flexGrow={1} minHeight={0}>
    <text fg={theme.warning} attributes={TextAttributes.BOLD} flexShrink={0}>permission review · default deny</text>
    <scrollbox id="approval-review" focused flexGrow={1} minHeight={0} scrollX={false} scrollY>
      <box flexDirection="column" flexShrink={0}>
      <text fg={theme.accent}>{displayText(`${approval.name} · ${approval.scope}`)}</text>
      <text fg={theme.muted}>{displayText(`project: ${project}\ncwd: ${cwd}\ntool id: ${approval.toolId}`)}</text>
      <text fg={theme.text}>{displayText(`exact tool arguments:\n${JSON.stringify(approval.args, null, 2)}`)}</text>
      {approval.preview !== null ? <>
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>prepared unified diff · exact paths and changes</text>
        <text fg={theme.text} wrapMode="word">{displayText(approval.preview)}</text>
      </> : <text fg={theme.muted}>no file diff supplied for this operation</text>}
      </box>
    </scrollbox>
    <text fg={theme.warning} flexShrink={0}>ctrl+y allow once · ctrl+n deny</text>
    <text fg={theme.muted} flexShrink={0}>esc deny · ctrl+c cancel run</text>
  </box>;
}

export function CopyPreview({ source, language, result }: { source: string; language: string; result: string | null }) {
  return <box flexDirection="column" flexGrow={1} minHeight={0}>
    <text fg={theme.accent}>copy code · explicit clipboard action</text>
    <scrollbox focused flexGrow={1} minHeight={0}><CodeText source={source} language={language} /></scrollbox>
    <text fg={theme.muted}>{result ?? "ctrl+y copy exact source · esc back"}</text>
  </box>;
}

// An explicit standalone @ token attaches without also submitting a message.
// Paths, including quoted spaces and optional ranges, still pass through controller.attachFile.
export function attachmentInput(text: string): { path: string; startLine?: number; limit?: number } | null {
  const match = /^\s*@?(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"']+))(?:\s+(\d+)(?:\s+(\d+))?)?\s*$/.exec(text);
  if (!match) return null;
  const startLine = match[4] === undefined ? undefined : Number(match[4]);
  const limit = match[5] === undefined ? undefined : Number(match[5]);
  if ((startLine !== undefined && (!Number.isSafeInteger(startLine) || startLine < 1)) || (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))) return null;
  return { path: match[1] ?? match[2] ?? match[3], startLine, limit };
}

export function AttachmentPicker({ controller, value, onInput, onAttach, onInvalid, height }: {
  controller: ChatController; value: string; onInput: (value: string) => void;
  onAttach: (file: NonNullable<ReturnType<typeof attachmentInput>>) => void;
  onInvalid: () => void; height: number;
}) {
  const input = useRef<InputRenderable>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const parsed = attachmentInput(value);
  const query = parsed?.path ?? value.replace(/^\s*@?["']?/, "");
  const candidates = useMemo(() => controller.getAttachmentCandidates(query), [controller, query]);
  const selected = Math.max(0, candidates.findIndex((file) => file.path === selectedId));
  const change = (text: string) => { onInput(text); setSelectedId(null); };
  const choose = () => {
    if (parsed?.startLine !== undefined) onAttach(parsed);
    else if (candidates[selected]) onAttach({ path: candidates[selected].path });
    else if (parsed) onAttach(parsed);
    else onInvalid();
  };
  useKeyboard((key) => {
    if (controller.getSnapshot().agent?.approval) return;
    if (["up", "down"].includes(key.name)) {
      key.preventDefault(); key.stopPropagation();
      const next = Math.max(0, Math.min(candidates.length - 1, selected + (key.name === "down" ? 1 : -1)));
      setSelectedId(candidates[next]?.path ?? null);
    } else if (key.name === "tab" && candidates[selected]) {
      key.preventDefault(); key.stopPropagation();
      const path = candidates[selected].path;
      const quote = path.includes('"') ? "'" : '"';
      const text = `${quote}${path}${quote}`;
      change(text);
      if (input.current) { input.current.value = text; input.current.cursorOffset = text.length; }
    }
  });
  return <box id="attachment-picker" flexDirection="column" gap={1} flexGrow={1} minHeight={0}>
    <text fg={theme.accent} attributes={TextAttributes.BOLD}>attach project file</text>
    <text fg={theme.muted} flexShrink={0}>{'search or "path" [start line] [line count]'}</text>
    <box border borderStyle="rounded" borderColor={theme.accent} backgroundColor={theme.background} height={3} paddingX={1} flexShrink={0} flexDirection="row">
      <text height={1} width={2} flexShrink={0} fg={theme.accent} selectable={false}>{"› "}</text>
      <input id="attachment-path" ref={input} focused value={value} placeholder="search project files…" textColor={theme.text} flexGrow={1}
        backgroundColor={theme.background} focusedBackgroundColor={theme.background} onInput={change} onSubmit={choose} />
    </box>
    {candidates.length ? <select options={candidates.map(({ path }) => ({ name: displayText(path), description: "", value: path }))}
      selectedIndex={selected} height={Math.max(1, height - 11)} flexGrow={1} minHeight={1} showDescription={false}
      textColor={theme.text} backgroundColor={theme.background} selectedBackgroundColor={theme.surface} selectedTextColor={theme.accent}
      onChange={(next) => setSelectedId(candidates[Math.max(0, next)]?.path ?? null)}
      onSelect={(_, option) => { if (option) onAttach({ path: option.value as string }); }} />
      : <text fg={theme.muted}>no matching files · type an explicit path</text>}
    <text height={1} wrapMode="none" flexShrink={0} fg={theme.muted}>↑↓ select · tab complete · enter attach</text>
  </box>;
}

export function changedPaths(agent: AgentState): string[] {
  const paths = new Set<string>();
  for (const tool of agent.tools) {
    if (!["prepare_change", "apply_change", "undo_change"].includes(tool.name)) continue;
    const result = typeof tool.result === "string" ? tool.result : JSON.stringify(tool.result ?? "");
    for (const match of result.matchAll(/"(?:path|to)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
      try { paths.add(JSON.parse(`"${match[1]}"`) as string); } catch { /* bounded previews can end mid-string */ }
    }
    if (Array.isArray(tool.args.operations)) for (const operation of tool.args.operations) {
      if (operation && typeof operation === "object" && !Array.isArray(operation)) {
        if (typeof operation.path === "string") paths.add(operation.path);
        if (typeof operation.to === "string") paths.add(operation.to);
      }
    }
  }
  return [...paths].slice(-12);
}

export function agentRequestCount(report: string): number | null {
  const match = /^raw request reports: ([\d,]+)(?:\r?\n|$)/.exec(report);
  if (!match) return report === "no agent request reports." ? 0 : null;
  const count = Number(match[1].replaceAll(",", ""));
  return Number.isSafeInteger(count) ? count : null;
}
