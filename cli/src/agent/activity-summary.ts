import type { ToolExecution } from "../types";

export interface ActivitySummary {
  version: 1;
  action: string;
  target: string;
  status: string;
  files: { path: string; action: string; added?: number; removed?: number; status: string }[];
  omittedFiles: number;
  exitCode?: number;
  durationMs?: number;
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value.slice(0, 256) : "";
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** derive only from the complete journal value, before rendering truncates output. */
export function summarizeActivity(tool: ToolExecution): ActivitySummary {
  const result = object(tool.result), args = tool.args;
  const status = tool.status === "outcome_unknown" ? "outcome_unknown" : tool.status === "cancelled" ? "cancelled"
    : typeof result.status === "string" && ["partial", "partially_applied", "compensated", "compensation_failed"].includes(result.status) ? result.status
    : tool.status === "failed" ? "failed" : tool.status === "succeeded" && result.status === "applied" && result.ok === true ? "applied"
    : tool.status === "succeeded" && tool.name === "prepare_change" ? "prepared" : tool.status;
  const source = Array.isArray(result.summary) ? result.summary : [];
  const states = new Map((Array.isArray(result.files) ? result.files : []).map((item) => {
    const file = object(item); return [text(file.path), text(file.status ?? file.state)];
  }));
  const files = source.slice(0, 16).map((item) => {
    const file = object(item), added = count(file.added), removed = count(file.removed);
    return { path: text(file.path), action: text(file.action), status: states.get(text(file.path)) || status,
      ...(added === undefined ? {} : { added }), ...(removed === undefined ? {} : { removed }) };
  });
  const durationMs = count(result.durationMs) ?? (tool.startedAt && tool.completedAt ? Math.max(0, Date.parse(tool.completedAt) - Date.parse(tool.startedAt)) : undefined);
  return { version: 1, action: tool.name, target: text(args.url ?? result.url ?? args.ref ?? args.tabId ?? args.path ?? args.executable ?? args.pattern ?? args.query ?? args.changeId ?? args.jobId),
    status, files, omittedFiles: Math.max(0, source.length - files.length),
    ...(typeof result.exitCode === "number" && Number.isSafeInteger(result.exitCode) ? { exitCode: result.exitCode } : {}),
    ...(durationMs === undefined ? {} : { durationMs }) };
}
