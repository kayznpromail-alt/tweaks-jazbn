import { useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { DetailPositions } from "./agent-views";
import { CodeText } from "./markdown";
import { displayText, theme } from "./theme";
import type { ToolDraft } from "./live-work";

export function AgentPages({ agents, selected, onSelect }: {
  agents: { id: string; title: string; status: string; handoff?: string }[]; selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  useKeyboard((key) => {
    if (key.ctrl || key.meta || key.option) return;
    if (/^[0-9]$/.test(key.name)) {
      key.preventDefault(); key.stopPropagation();
      const index = Number(key.name) - 1;
      if (index === -1) onSelect(null);
      else if (agents[index]) onSelect(agents[index]!.id);
    } else if (["left", "right"].includes(key.name) && agents.length) {
      key.preventDefault(); key.stopPropagation();
      const current = agents.findIndex((agent) => agent.id === selected);
      const index = current < 0 ? (key.name === "right" ? 0 : agents.length - 1)
        : (current + (key.name === "right" ? 1 : -1) + agents.length) % agents.length;
      onSelect(agents[index]!.id);
    }
  });
  return <box flexDirection="column" flexShrink={0} paddingBottom={1}>
    <box flexDirection="row" gap={1} flexShrink={0}>
      <text id="agent-page:0" fg={selected === null ? theme.accent : theme.muted} onMouseDown={() => onSelect(null)}>0 all</text>
      {agents.map((agent, index) => <text id={`agent-page:${index + 1}`} key={agent.id}
        fg={agent.id === selected ? theme.accentBright : agent.status === "failed" ? theme.error : theme.muted}
        onMouseDown={() => onSelect(agent.id)}>{` ${index + 1}${agent.status === "running" ? "●" : agent.handoff ? "↪" : agent.status === "completed" ? "✓" : "·"} `}</text>)}
    </box>
    <text fg={theme.muted}>0 overview · 1–9 agent · ← → switch</text>
  </box>;
}

export function DraftPage({ draft, initialFile, positions, onOutput }: {
  draft: ToolDraft; initialFile: number; positions: DetailPositions; onOutput: () => void;
}) {
  const latest = useRef(draft);
  if (draft.bytes >= latest.current.bytes) latest.current = draft;
  const current = latest.current;
  const files = current.files ?? [];
  const [selected, setSelected] = useState(initialFile);
  const index = Math.min(selected, Math.max(0, files.length - 1));
  const file = files[index];
  const identity = `${current.runId}:${current.requestId}:${current.index}:${index}`;
  const source = displayText(file?.content ?? current.preview);
  const lines = source.split("\n");
  const box = useRef<ScrollBoxRenderable>(null);
  const restored = useRef("");
  useKeyboard((key) => {
    if (key.ctrl && key.name === "o") { key.preventDefault(); key.stopPropagation(); onOutput(); }
    if (key.ctrl || key.meta || key.option) return;
    if (key.name === "[" || key.name === "]") {
      key.preventDefault(); key.stopPropagation();
      setSelected((value) => Math.max(0, Math.min(files.length - 1, value + (key.name === "]" ? 1 : -1))));
    } else if (/^[1-9]$/.test(key.name) && files[Number(key.name) - 1]) {
      key.preventDefault(); key.stopPropagation(); setSelected(Number(key.name) - 1);
    }
  });
  return <box id="live-code-page" flexDirection="column" flexGrow={1} minHeight={0}>
    <text fg={theme.accent} flexShrink={0} maxHeight={2}>{displayText(file?.path ?? current.name)}</text>
    <text fg={theme.muted} flexShrink={0}>{`file ${index + 1}/${Math.max(1, files.length)} · ${lines.length} lines · draft`}</text>
    <box flexDirection="row" flexShrink={0} gap={1}>
      <text id="draft-prev" fg={theme.accent} onMouseDown={() => setSelected(Math.max(0, index - 1))}>[ prev</text>
      {files.slice(Math.floor(index / 4) * 4, Math.floor(index / 4) * 4 + 4).map((item, offset) => {
        const page = Math.floor(index / 4) * 4 + offset;
        return <text key={page} id={`file-page:${page + 1}`} fg={index === page ? theme.accentBright : theme.muted} onMouseDown={() => setSelected(page)}>{` ${page + 1} `}</text>;
      })}
      <text id="draft-next" fg={theme.accent} onMouseDown={() => setSelected(Math.max(0, Math.min(files.length - 1, index + 1)))}>next ]</text>
    </box>
    <scrollbox key={identity} id="live-code-scroll" ref={box} focused flexGrow={1} minHeight={0} scrollX={false} scrollY contentOptions={{ paddingRight: 1 }}
      stickyScroll stickyStart="top" renderAfter={() => {
        if (!box.current) return;
        if (restored.current !== identity) {
          const saved = positions.get(identity);
          if (saved !== undefined) box.current.scrollTo(saved);
          restored.current = identity;
        }
        positions.set(identity, box.current.scrollTop);
      }}>
      <CodeText source={lines.map((line, i) => `${String(i + 1).padStart(String(lines.length).length)}  ${line}`).join("\n")}
        language={file?.path.split(".").at(-1) ?? ""} />
    </scrollbox>
    <text fg={theme.muted} flexShrink={0}>↑↓ / pgup / pgdn scroll · [ ] files</text>
    <text fg={theme.muted} flexShrink={0}>esc chat · ctrl+o recorded output</text>
  </box>;
}
