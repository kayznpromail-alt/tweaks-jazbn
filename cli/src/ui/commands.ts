import {userCommandPattern,type UserCommand} from '../instructions/commands';
export const commands = [
  { id: "models", slash: "/models", name: "select model", shortcut: "ctrl+o", duringOperation: false },
  { id: "new", slash: "/new", name: "new conversation", shortcut: "ctrl+n", duringOperation: false },
  { id: "sessions", slash: "/sessions", name: "resume session", shortcut: "ctrl+s", duringOperation: false },
  { id: "project", slash: "/project", name: "open project", shortcut: "", duringOperation: false },
  { id: "key", slash: "/key", name: "change api key", shortcut: "", duringOperation: false },
  { id: "retry", slash: "/retry", name: "retry interrupted response", shortcut: "", duringOperation: false },
  { id: "cancel", slash: "/cancel", name: "cancel current operation", shortcut: "esc", duringOperation: true },
  { id: "forceclose", slash: "/forceclose", name: "stop this task and start a fresh session here", shortcut: "", duringOperation: true },
  { id: "usage", slash: "/usage", name: "token usage and billing", shortcut: "", duringOperation: true },
  { id: "account", slash: "/account", name: "plan, quota and account status", shortcut: "", duringOperation: true },
  { id: "profile", slash: "/profile", name: "active profile and setup", shortcut: "", duringOperation: true },
  { id: "effort", slash: "/effort", name: "reasoning effort for this model", shortcut: "ctrl+t", duringOperation: false },
  { id: "sidebar", slash: "/sidebar", name: "show / hide sessions", shortcut: "ctrl+b", duringOperation: true },
  { id: "bottom", slash: "/bottom", name: "jump to latest message", shortcut: "", duringOperation: true },
  { id: "forget", slash: "/logout", name: "remove saved key and disconnect", shortcut: "", duringOperation: false },
  { id: "help", slash: "/help", name: "commands and shortcuts", shortcut: "ctrl+p", duringOperation: true },
  { id: "exit", slash: "/quit", name: "save and quit", shortcut: "", duringOperation: true },
  { id: "mode", slash: "/mode", name: "auto / manual / accept edits / plan / bypass permissions", shortcut: "tab", duringOperation: false },
  { id: "tools", slash: "/tools", name: "tool timeline and results", shortcut: "", duringOperation: true },
  { id: "transcript", slash: "/transcript", name: "conversation and agent activity", shortcut: "ctrl+r", duringOperation: true },
  { id: "diff", slash: "/diff", name: "review file diffs", shortcut: "", duringOperation: true },
  { id: "tasks", slash: "/tasks", name: "agent tasks", shortcut: "", duringOperation: true },
  { id: "permissions", slash: "/permissions", name: "permissions and pending review", shortcut: "", duringOperation: true },
  { id: "context", slash: "/context", name: "instructions and attachment context", shortcut: "", duringOperation: true },
  { id: "jobs", slash: "/jobs", name: "process jobs", shortcut: "", duringOperation: true },
  { id: "git", slash: "/git", name: "recorded git results", shortcut: "", duringOperation: true },
  { id: "undo", slash: "/undo", name: "review undo of last file change", shortcut: "", duringOperation: false },
  { id: "continue", slash: "/continue", name: "continue interrupted agent run", shortcut: "", duringOperation: false },
  { id: "attach", slash: "/attach", name: "attach a project file or line range", shortcut: "", duringOperation: false },
  { id: "attachments", slash: "/attachments", name: "inspect or clear attachments", shortcut: "", duringOperation: true },
  { id: "copy", slash: "/copy", name: "choose a code block to copy", shortcut: "", duringOperation: true },
  { id: "recover", slash: "/recover", name: "review stale run recovery", shortcut: "", duringOperation: false },
  { id: "instructions", slash: "/instructions", name: "select personal instructions and review project rules", shortcut: "", duringOperation: true },
  { id: "output", slash: "/output", name: "page durable request and tool output", shortcut: "", duringOperation: true },
  { id: "jailbreak", slash: "/jailbreak", name: "toggle private / purple mode", shortcut: "", duringOperation: false },
  {id:"skills",slash:"/skills",name:"select your skills",shortcut:"",duringOperation:false},
  {id:"markdown",slash:"/markdown",name:"select your markdown instructions",shortcut:"",duringOperation:false},
  { id: "messages", slash: "/messages", name: "message actions and copying", shortcut: "", duringOperation: true },
  { id: "diagnostics", slash: "/diagnostics", name: "local diagnostics and support report", shortcut: "", duringOperation: true },
  {id:"browser",slash:"/browser",name:"open or inspect the ai browser",shortcut:"",duringOperation:true},
  {id:"image",slash:"/image",name:"attach an image from a file",shortcut:"ctrl+v image",duringOperation:false},
  {id:"mcp",slash:"/mcp",name:"manage mcp servers and tools",shortcut:"",duringOperation:false},
] as const;

export type Command = typeof commands[number];
export type CommandId = Command["id"];

export const agentCommandIds: ReadonlySet<string> = new Set([
  "mode", "tools", "diff", "tasks", "permissions", "context", "jobs", "git", "undo", "continue", "attach", "copy",
  "recover", "output",
]);

export function visibleCommands(agent: boolean): readonly Command[] {
  return agent ? commands : commands.filter((entry) => !agentCommandIds.has(entry.id));
}

export function commandSuggestions(text: string): readonly Command[];
export function commandSuggestions(text: string, custom: readonly UserCommand[]): readonly (Command|UserCommand)[];
export function commandSuggestions(text: string, custom: readonly UserCommand[]=[]): readonly (Command|UserCommand)[] {
  const query = text.trimStart();
  if (!/^\/[a-z0-9_:-]*$/i.test(query)) return [];
  return [...commands,...custom].filter((command) => command.slash.startsWith(query.toLowerCase()));
}

export type ParsedInput = { kind: "message"; text: string }
  | { kind: "user-command"; text:string }
  | { kind: "command"; command: Command }
  | { kind: "error"; message: string };

export function parseInput(text: string): ParsedInput {
  const query = text.trim();
  if (!query.startsWith("/")) return { kind: "message", text };
  if (query.startsWith("//")) return { kind: "message", text: text.replace("//", "/") };
  if(userCommandPattern.test(query))return {kind:"user-command",text};
  const [name, ...args] = query.split(/\s+/);
  const command = commands.find((item) => item.slash === (name.toLowerCase()==='/recovery'?'/recover':name.toLowerCase()));
  if (!command) return { kind: "error", message: "unknown command. use /help or ctrl+p. use // to send literal text starting with /." };
  if (args.length) return { kind: "error", message: `${command.slash} takes no arguments; it opens a view. use // to send literal text.` };
  return { kind: "command", command };
}
