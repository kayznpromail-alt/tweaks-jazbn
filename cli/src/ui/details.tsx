import type { AppState, Message } from "../types";
import { formatTokens, summarizeUsage } from "../core/usage";
import { visibleCommands } from "./commands";
import { TextAttributes } from "@opentui/core";
import { displayText, theme } from "./theme";

function RequestUsage({ message }: { message?: Message }) {
  const usage = message?.usage;
  if (!message) return <text fg={theme.muted}>no requests in this session</text>;
  if (!usage) return <text fg={theme.muted}>{message.status === "streaming" ? "awaiting report · usage unknown" : "unavailable · no usage report received"}</text>;
  const computed = BigInt(usage.inputTokens) + BigInt(usage.outputTokens);
  return <box flexDirection="column">
    <text fg={theme.text}>{`input ${formatTokens(usage.inputTokens)} · output ${formatTokens(usage.outputTokens)}`}</text>
    <text fg={theme.text}>{`total ${formatTokens(usage.totalTokens)} · ${usage.totalSource === "reported" ? "reported by api" : usage.totalSource === "calculated" ? "calculated" : "legacy source unknown"}`}</text>
    <text fg={theme.muted}>{`input + output ${formatTokens(computed)} · calculated by cli`}</text>
    {computed !== BigInt(usage.totalTokens) ? <text fg={theme.error}>inconsistent usage · the original total is preserved</text> : null}
    {message.status !== "complete" ? <text fg={theme.error}>unconfirmed · stream completion was not received</text> : null}
    <text fg={theme.muted}>{usage.cachedInputTokens === undefined ? "cache unavailable" : `cache ${formatTokens(usage.cachedInputTokens)} · included in input`}</text>
  </box>;
}

export function UsageView({ state }: { state: AppState }) {
  const usage = summarizeUsage(state.session?.messages ?? []);
  const last = state.session?.messages.findLast((message) => message.role === "assistant");
  return <scrollbox focused flexGrow={1} minHeight={0}>
    <box flexDirection="column" gap={1}>
      <text fg={theme.accent} attributes={TextAttributes.BOLD}>last request · exact token counts</text>
      <RequestUsage message={last} />
      <text fg={theme.accent} attributes={TextAttributes.BOLD}>session total · request snapshots</text>
      <text fg={theme.muted}>source: current session only · raw api response reports</text>
      <text fg={theme.muted} wrapMode="word">server key-wide billing counters used by discord are unavailable from the client api.</text>
      {usage.reported === 0
        ? <text fg={theme.muted}>unavailable · no complete usage report received</text>
        : <text fg={theme.text}>{`input: ${formatTokens(usage.input)} · output: ${formatTokens(usage.output)} · total: ${formatTokens(usage.total)}`}</text>}
      {usage.reported > 0 ? <text fg={theme.muted}>{`reported totals: ${formatTokens(usage.reportedTotal)} (${usage.reportedTotals} reports) · calculated totals: ${formatTokens(usage.calculatedTotal)} (${usage.calculatedTotals} reports)`}</text> : null}
      {usage.legacyTotals ? <text fg={theme.muted}>{`legacy totals: ${formatTokens(usage.legacyTotal)} (${usage.legacyTotals} reports) · source unknown`}</text> : null}
      <text fg={theme.text}>{`reports: ${usage.reported} · missing: ${usage.missing} · pending: ${usage.pending} · unconfirmed: ${usage.unconfirmed}`}</text>
      <text fg={theme.muted}>{usage.cacheReports ? `cache within input: ${formatTokens(usage.cached)} · available in ${usage.cacheReports}/${usage.reported} reports`
        : "cache: unavailable in received reports"}</text>
      {usage.inconsistent ? <text fg={theme.error}>{`inconsistent usage: ${usage.inconsistent} reports · computed input + output: ${formatTokens(usage.computedTotal)}`}</text> : null}
      {usage.unconfirmed ? <text fg={theme.error} wrapMode="word">warning: unconfirmed usage snapshots included · stream completion not received</text> : null}
      {usage.missing || usage.pending ? <text fg={theme.error}>partial total · missing reports do not imply zero cost</text> : null}
      <text fg={theme.accent} attributes={TextAttributes.BOLD}>billed units: unavailable from the client api</text>
      <text fg={theme.text} wrapMode="word">the gateway applies model multipliers, cache discounts, rounding and estimates when needed. its rates and billed cost are not included in the client response.</text>
      <text fg={theme.muted} wrapMode="word">input includes the history and profile sent with each request. totals include retries. cache is part of input, not an additional token charge.</text>
      <text fg={theme.muted}>esc back · ↑↓ / pgup / pgdn scroll</text>
    </box>
  </scrollbox>;
}

export function ProfileView({ state, directory }: { state: AppState; directory: string }) {
  const profile = state.profile;
  return <scrollbox focused flexGrow={1} minHeight={0}>
    <box flexDirection="column" gap={1}>
      <text fg={theme.accent} attributes={TextAttributes.BOLD}>instruction profile</text>
      <text fg={theme.text}>{profile ? displayText(`${profile.name} · ${profile.id}@${profile.version}`) : "no active profile"}</text>
      {profile ? <text fg={theme.text}>{profile.models.includes(state.settings.model ?? "") ? "assignment: exact model" : "assignment: default profile"}</text> : null}
      <text fg={theme.muted}>{displayText(`directory: ${directory}`)}</text>
      <text fg={theme.text} wrapMode="word">use one default profile for shared instructions: auto: true, default: true, models: []. an exact model assignment takes precedence.</text>
      <text fg={theme.text} wrapMode="word">the json file requires id, name, version, instructions and models. put your prepared prompt in instructions. restart the cli after changing a profile.</text>
      <text fg={theme.muted} wrapMode="word">the profile is sent once as system in each request. server configuration is needed to apply instructions outside this cli. the key authenticates access; it does not select a local profile.</text>
      <text fg={theme.muted}>esc back · ↑↓ / pgup / pgdn scroll</text>
    </box>
  </scrollbox>;
}

export function HelpView({ agent = false }: { agent?: boolean }) {
  return <scrollbox focused flexGrow={1} minHeight={0}>
    <box flexDirection="column" gap={1}>
      <text fg={theme.accent} attributes={TextAttributes.BOLD}>commands · type / in the editor</text>
      <text fg={theme.muted}>ctrl+r /transcript opens recorded messages, intermediate responses, tool results and rejected arguments. ctrl+f filters; ctrl+←/→ pages; ctrl+e returns to latest. esc restores chat and your draft. click an action to preview changes or open its full output.</text>
      {visibleCommands(agent).map((command) => <text key={command.id} fg={theme.text}>{`${command.slash} — ${command.name}${command.shortcut ? ` · ${command.shortcut}` : ""}`}</text>)}
      <text fg={theme.muted}>/instructions lists your .md files in ~/.edgey/instructions. enter previews; enter, ctrl+i or click applies the reviewed version. ctrl+d disables; ctrl+r refreshes. /new inherits the saved selection in the same project. model and server instructions take precedence. edits on disk require review and reapplication.</text>
      {agent ? <text fg={theme.muted}>permission review: ctrl+y allows once; ctrl+n or esc denies; ctrl+c cancels the run. enter and paste never approve. /tools expands tool results; esc collapses back to chat. /undo prepares an inverse diff only after ctrl+y, then requires its own approval. /copy opens code selection and preview; only ctrl+y copies. @"path with spaces" [start line] [line count] attaches a snapshot without sending a message.</text> : null}
      {agent ? <text fg={theme.muted}>/recover: ctrl+t queues observed JSON results for unknown effects; ctrl+s succeeded or ctrl+f failed. ctrl+k acknowledges the executor and all descendants have stopped; ctrl+y explicitly recovers. enter never confirms recovery. /instructions project tab (ctrl+g): preview path and hash, ctrl+i include or ctrl+d ignore; root defaults to included, nested and changed sources remain pending. choices apply to new tasks. /output: select a durable request/tool, pgup/pgdn loads pages, arrows scroll within a page; ctrl+o enters an older id. /diagnostics shows local capabilities and can save a content-free support report with ctrl+e; it never sends the report. edgey --doctor also works outside the interactive client.</text> : null}
      <text fg={theme.muted}>slash menu: ↑↓ select · tab complete · enter run · esc dismiss. // sends literal text starting with /. commands run locally and are not sent to the model.</text>
      {agent ? <text fg={theme.muted}>chat: tab / shift+tab changes permission mode while idle. /mode selects auto, manual, accept edits, plan or bypass permissions. bypass accepts every registered tool permission request and allows file paths outside the project with your operating-system account's access. auto uses local tool scope/effect rules. double esc stops a task before changing mode.</text> : null}
      <text fg={theme.muted}>in /sessions, ctrl+d marks the highlighted session for deletion and ctrl+d again removes it; ↑↓ or typing cancels. deleting the open conversation clears the screen and the next message starts a new one.</text>
      <text fg={theme.muted}>enter sends a message; shift+enter / ctrl+j adds a line. shift+p types uppercase p. paste never sends. esc goes back or cancels generation. double esc stops the run and returns to composing after cleanup; send a new task in the same conversation. ctrl+t cycles declared effort levels for new tasks; /effort opens the picker. ctrl+c copies selection first, otherwise cancels generation; while idle it does not exit. ctrl+shift+c copies only. ctrl+v / shift+insert pastes. windows terminal may intercept these: ctrl+alt+v reads the system clipboard directly; /image clipboard attaches a copied screenshot. ctrl+a / ctrl+x select all / cut in the active editor.</text>
    </box>
  </scrollbox>;
}
