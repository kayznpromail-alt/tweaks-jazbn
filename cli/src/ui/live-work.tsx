import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useRef, useState } from "react";
import type { AgentState, JsonObject } from "../types";
import { activityTarget, toolLabel } from "./activity";
import { CodeText, markdownParts } from "./markdown";
import type { DetailPositions } from "./agent-views";
import { Picker } from "./picker";
import { displayText, theme } from "./theme";

import { Loading } from "./loading";

const actions: Record<string, string> = {
  prepare_change: "writing file changes", apply_change: "applying file changes", read_file: "reading a file",
  list_files: "listing files", search_text: "searching code", glob_files: "finding files",
  run_shell: "preparing shell command", run_process: "preparing process", update_tasks: "planning next steps",
  delegate_tasks: "preparing subagent prompts",
};

type ChildAgent = Extract<AgentState["events"][number], { type: "subagent" }>;
export type ToolDraft = Extract<AgentState["events"][number], { type: "tool_draft" }>;

function target(args: JsonObject): string {
  // Child events carry a bounded JSON preview instead of their full arguments.
  if (typeof args.preview === "string") {
    try { const parsed: unknown = JSON.parse(args.preview); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as JsonObject; } catch { /* clipped preview */ }
  }
  const text = displayText(activityTarget({ args })).replace(/\s+/g, " ");
  return text ? ` · ${text.length > 64 ? text.slice(0, 63) + "…" : text}` : "";
}

export function childStatus(child: ChildAgent): string {
  return child.handoff ? "returned partial findings" : child.status;
}

export function childWorkLabel(child: ChildAgent, includeLast = false): string {
  if (child.status !== "running") return childStatus(child);
  if (child.phase === "repairing_arguments") return "correcting read arguments";
  const active = child.evidence?.findLast(item => item.status === "executing");
  if (active) return toolLabel({ name: active.name, status: "executing" }) + target(active.args as JsonObject);
  const request = child.requests ? ` · request ${child.requests}` : "";
  const last = child.evidence?.at(-1);
  return (child.text ? "receiving response" : "waiting for model response") + request
    + (includeLast && last ? ` · last: ${toolLabel({ name: last.name, status: last.status })}${target(last.args as JsonObject)}` : "");
}

// Events are hot projections, not a history. Keep the latest snapshot per identity
// and use a stable order even when concurrent children publish in a different order.
export function subagents(agent?: AgentState, taskId?: string | null): ChildAgent[] {
  const children = new Map<string, ChildAgent>();
  for (const event of agent?.events ?? []) {
    if (event.type === "subagent" && event.runId === agent?.runId
      && (taskId == null || event.taskId === taskId)) children.set(event.id, event);
  }
  return [...children.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function toolDrafts(agent: AgentState): ToolDraft[] {
  if (agent.phase !== "requesting_model") return [];
  const request = agent.events.findLast((event): event is Extract<AgentState["events"][number], { type: "request" }> =>
    event.type === "request" && event.runId === agent.runId);
  const drafts = new Map<number, ToolDraft>();
  for (const event of agent.events) {
    if (event.type === "tool_draft" && event.runId === agent.runId && (!request || event.requestId === request.requestId)) drafts.set(event.index, event);
  }
  return [...drafts.values()].sort((a, b) => a.index - b.index);
}

export function workLabel(agent: AgentState, hasText = false): string {
  if (agent.phase === "repairing_arguments") {
    const event = agent.events.findLast(event => event.type === "validation_repair");
    const issues=event?.type==='validation_repair'?event.issues:undefined;
    return `${issues?.some(issue=>issue.receivedType==='unfinished_tasks')?'continuing unfinished work':issues?.some(issue=>issue.receivedType==='text_tool_call')?'correcting tool format':'correcting arguments'} · attempt ${event?.type === "validation_repair" ? event.attempt : 1}/2`;
  }
  const draft = toolDrafts(agent).at(-1);
  if (draft) return actions[draft.name] ?? `preparing ${draft.name}`;
  if (agent.phase === "requesting_model") {
    const request = agent.events.findLast(event => event.type === "request" && event.runId === agent.runId);
    const receiving = request?.type === "request" ? agent.events.some(event => event.type === "output" && event.requestId === request.requestId && !!event.text) : hasText;
    const last = agent.tools.at(-1);
    return (receiving ? "receiving response" : "waiting for model response")
      + (request?.type === "request" ? ` · ${request.sequence + 1}` : "")
      + (last ? ` · last: ${last.status === "failed" ? "failed " : ""}${toolLabel(last)}${target(last.args)}` : "");
  }
  if (agent.phase === "executing_tools") {
    const tool = agent.tools.findLast((tool) => tool.status === "executing");
    if (tool?.name === "delegate_tasks" || subagents(agent).some(child => child.status === "running")) {
      const running = subagents(agent).filter(child => child.status === "running");
      return running.length ? `subagents working · ${running.length} active` : "collecting subagent findings";
    }
    return tool ? toolLabel(tool) + target(tool.args) : "executing tools";
  }
  return agentStatusLabel(agent);
}

/** Presentation only: durable failures and recovery fences remain truthful. */
export function agentStatusLabel(agent: Pick<AgentState, "phase" | "failureCode">): string {
  if (agent.phase === "failed") {
    if (agent.failureCode === "model_network") return "connection interrupted";
    if (agent.failureCode === "model_timeout") return "response timed out";
    if (agent.failureCode === "model_unavailable") return "api unavailable";
  }
  return agent.phase.replaceAll("_", " ");
}

function draftPreview(draft: ToolDraft): { source: string; language: string; path?: string; clipped: boolean } {
  // The runner supplies decoded, sanitized display fields, never executable JSON.
  const preview = displayText(draft.preview);
  const path = /^(?:path|to): ([^\n]*)/m.exec(preview)?.[1];
  const content = /^(?:content|script|command): /m.exec(preview);
  const source = content ? preview.slice(content.index + content[0].length) : preview;
  const tail = source.split("\n").slice(-5).join("\n").slice(-1600);
  return { source: tail, path, clipped: tail.length < source.length,
    language: draft.name === "run_shell" ? "powershell" : path?.split(".").at(-1) ?? "" };
}

export function LiveWork({ agent, onTasks, onTask, onAgents, onAgent, onDraft }: {
  agent: AgentState; onTasks: () => void; onTask: (id: string) => void;
  onAgents: () => void; onAgent: (id: string) => void; onDraft?: (draft: ToolDraft, file: number) => void;
}) {
  const {width}=useTerminalDimensions();
  const drafts = toolDrafts(agent).slice(-3);
  const tasks = agent.tasks.slice(0, width<60?1:3);
  const children = subagents(agent);
  const running = children.filter((child) => child.status === "running").length;
  // Keep the currently active step visible even with a longer plan.
  const active = agent.tasks.find((task) => task.status === "in_progress");
  if (active && !tasks.includes(active)) tasks[tasks.length - 1] = active;
  return <box id="live-work" flexDirection="column" flexShrink={0}>
    {children.length?<text id="live-subagents" fg={theme.muted} onMouseDown={onAgents}>{`subagents · ${running} running · ${children.filter((child) => child.status === "completed").length}/${children.length} returned · ctrl+g open`}</text>:null}
    {children.map((child) => child.status==="running"?<Loading key={child.id} id={`live-agent:${child.id}`} label={`${child.title} · ${childWorkLabel(child)}`} onMouseDown={()=>onAgent(child.id)}/>:<text key={child.id} id={`live-agent:${child.id}`} fg={child.status === "failed" ? theme.error : theme.muted} onMouseDown={() => onAgent(child.id)}>
      {displayText(`${child.handoff ? "↪" : child.status === "completed" ? "✓" : "!"} ${child.title} · ${childStatus(child)} · click to inspect`)}</text>)}
    {agent.tasks.length ? <box flexDirection="column" flexShrink={0} paddingBottom={1}>
      <text fg={theme.accent} onMouseDown={onTasks}>{`steps · ${agent.tasks.filter((task) => task.status === "completed").length}/${agent.tasks.length} · /tasks`}</text>
      {tasks.map((task) => task.status==="in_progress"&&!["idle","completed","failed","interrupted","recovery_required"].includes(agent.phase)?<Loading key={task.id} id={`live-task:${task.id}`} label={task.title} onMouseDown={()=>onTask(task.id)}/>:<text id={`live-task:${task.id}`} key={task.id} fg={task.status === "in_progress" ? theme.accent : theme.muted} onMouseDown={() => onTask(task.id)}>
        {displayText(`${task.status === "completed" ? "✓" : task.status === "in_progress" ? "›" : "·"} ${task.title} · ${task.status.replaceAll("_", " ")}`)}</text>)}
      <text fg={theme.muted} onMouseDown={onTasks}>{`${agent.tasks.length > tasks.length ? `${agent.tasks.length - tasks.length} more · ` : ""}/tasks · step details and evidence`}</text>
    </box> : null}
    {drafts.map((draft) => <box key={`${draft.requestId}:${draft.index}`} flexDirection="column" flexShrink={0}>
      <Loading label={`${actions[draft.name] ?? draft.name}…`} />
      {(draft.files ?? []).slice(-3).map((file, index, files) => <text key={index} id={`live-file:${draft.index}:${(draft.files?.length ?? 0) - files.length + index}`} fg={theme.muted}
        onMouseDown={() => onDraft?.(draft, (draft.files?.length ?? 0) - files.length + index)}>{displayText(`  ${file.path} · preparing`)}</text>)}
      {!draft.files?.length && draftPreview(draft).path ? <text fg={theme.muted}>{draftPreview(draft).path}</text> : null}
    </box>)}
  </box>;
}

export function TaskSteps({ agent, height, onTask }: { agent: AgentState; height: number; onTask: (id: string) => void }) {
  return <box id="agent-details" flexDirection="column" flexGrow={1} minHeight={0}>
    <Picker title="tasks · enter a step for details and evidence" height={height} onSelect={onTask}
      items={agent.tasks.map((task) => ({ id: task.id, name: `${task.title} · ${task.status.replaceAll("_", " ")}` }))} />
  </box>;
}

export function SubagentDetails({ child, identity, positions, onOutput }: {
  child?: ChildAgent; identity: string; positions: DetailPositions; onOutput: () => void;
}) {
  const [part, setPart] = useState<"prompt" | "response">("response");
  const box = useRef<ScrollBoxRenderable>(null);
  const restored = useRef<string | null>(null);
  const positionKey = `${identity}:${part}`;
  useKeyboard((key) => {
    if (key.ctrl && ["i", "r", "o"].includes(key.name)) {
      key.preventDefault(); key.stopPropagation();
      if (key.name === "o") onOutput();
      else setPart(key.name === "i" ? "prompt" : "response");
    }
  });
  return <box flexDirection="column" flexGrow={1} minHeight={0}>
    <text fg={theme.accent} flexShrink={0} maxHeight={2}>{displayText(child ? `${child.title} · ${childWorkLabel(child)}` : "subagent preview unavailable")}</text>
      {child ? <text fg={theme.muted} height={1} wrapMode="none">{displayText(child.model)}</text> : null}
      {child?.evidence?.slice(-3).map((item) => <text key={item.callId} fg={item.status === "executing" ? theme.accent : theme.muted} flexShrink={0} maxHeight={2}>{displayText(`${item.name} · ${item.status} · ${JSON.stringify(item.args).slice(0, 180)}`)}</text>)}
    <box flexDirection="row" flexShrink={0} gap={2}>
      <text id="subagent-prompt-tab" fg={part === "prompt" ? theme.accent : theme.muted} onMouseDown={() => setPart("prompt")}>ctrl+i prompt</text>
      <text id="subagent-response-tab" fg={part === "response" ? theme.accent : theme.muted} onMouseDown={() => setPart("response")}>ctrl+r response</text>
    </box>
    <scrollbox id="subagent-preview" key={part} ref={box} focused flexGrow={1} minHeight={0} scrollY scrollX={false}
      stickyScroll={part === "response"} stickyStart={positions.has(positionKey) ? "top" : "bottom"} renderAfter={() => {
        if (!box.current) return;
        if (restored.current !== positionKey) {
          box.current.scrollTo(positions.get(positionKey) ?? (part === "response" ? box.current.scrollHeight : 0));
          restored.current = positionKey;
        }
        positions.set(positionKey, box.current.scrollTop);
      }}>
      {!child ? <text fg={theme.muted}>this live preview is no longer available; inspect recorded results in /output</text>
        : part === "prompt" ? <text fg={theme.text}>{displayText(child.prompt)}</text>
        : child.text ? markdownParts(child.text).map((block, index) => block.kind === "code"
          ? <box key={index} border borderStyle="rounded" borderColor={theme.accentDeep} paddingX={1} flexDirection="column" flexShrink={0}>
            <text fg={theme.muted}>{displayText(`${block.language || "code"} · draft`)}</text>
            <CodeText source={block.source} language={block.language} />
          </box> : <text key={index} fg={theme.text}>{displayText(block.source)}</text>)
          : <text fg={theme.muted}>{child.status === "running" ? childWorkLabel(child, true) : "no response text received"}</text>}
      {part === "response" && child?.error ? <text fg={theme.error}>{displayText(`${child.error.code}: ${child.error.message}`)}</text> : null}
    </scrollbox>
    <text fg={theme.muted} flexShrink={0}>bounded preview · ctrl+o recorded output</text>
    <text fg={theme.muted} flexShrink={0}>↑↓ / pgup / pgdn scroll · esc subagents</text>
  </box>;
}
