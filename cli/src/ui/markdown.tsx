import { TextAttributes } from "@opentui/core";
import { memo, useMemo } from "react";
import { displayText, theme } from "./theme";

export interface MarkdownPart { kind: "text" | "code"; source: string; language: string; complete: boolean }

// Keep source slices byte-for-byte for explicit copying; sanitize only at the display boundary.
export function markdownParts(source: string): MarkdownPart[] {
  const parts: MarkdownPart[] = [];
  const fence = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?\n/gm;
  let cursor = 0, match: RegExpExecArray | null;
  while ((match = fence.exec(source))) {
    if (match.index > cursor) parts.push({ kind: "text", source: source.slice(cursor, match.index), language: "", complete: true });
    const start = fence.lastIndex;
    const close = new RegExp(`^ {0,3}${match[1][0]}{${match[1].length},}[ \\t]*(?:\\r?\\n|$)`, "gm");
    close.lastIndex = start;
    const end = close.exec(source);
    parts.push({ kind: "code", source: source.slice(start, end?.index ?? source.length),
      language: match[2].trim().split(/\s/)[0] ?? "", complete: !!end });
    cursor = end ? close.lastIndex : source.length;
    fence.lastIndex = cursor;
    if (!end) break;
  }
  if (cursor < source.length || !parts.length) parts.push({ kind: "text", source: source.slice(cursor), language: "", complete: true });
  return parts;
}

// Deliberately small lexical colouring, with no grammar worker, parser fetch or terminal escapes.
export function codeTokens(source: string, language: string): { text: string; color: string }[] {
  const text = displayText(source);
  if (/^(?:html|xml|svg|css|scss)$/i.test(language) && text.length <= 32_768) {
    const result: { text: string; color: string }[] = [];
    const pattern = /<!--[\s\S]*?(?:-->|$)|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<\/?[\w:-]+|[\w-]+(?=\s*[:=])|#[\da-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%)?/g;
    let offset = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > offset) result.push({ text: text.slice(offset, match.index), color: theme.text });
      const value = match[0];
      result.push({ text: value, color: /^(<!--|\/\*)/.test(value) ? theme.muted : /^["']/.test(value) ? theme.accentBright
        : /^[#\d]/.test(value) ? theme.warning : theme.info });
      offset = match.index + value.length;
    }
    if (offset < text.length) result.push({ text: text.slice(offset), color: theme.text });
    return result;
  }
  if (!/^(?:js|jsx|javascript|ts|tsx|typescript|py|python|ps1|powershell|pwsh|sh|bash|zsh|json)$/i.test(language) || text.length > 32_768) return [{ text, color: theme.text }];
  const python = /^(py|python|ps1|powershell|pwsh|sh|bash|zsh)$/i.test(language);
  const tokens = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\n]*|#[^\n]*|\b(?:const|let|var|function|return|async|await|import|from|export|class|if|else|for|while|new|throw|try|catch|def|in|None|True|False|true|false|null|type|interface)\b|\b\d+(?:\.\d+)?\b)/g;
  const result: { text: string; color: string }[] = [];
  let offset = 0;
  for (const match of text.matchAll(tokens)) {
    if (match.index > offset) result.push({ text: text.slice(offset, match.index), color: theme.text });
    const value = match[0];
    const comment = python ? value.startsWith("#") : value.startsWith("//");
    result.push({ text: value, color: comment ? theme.muted : /^["'`]/.test(value) ? theme.accentBright
      : /^\d/.test(value) ? theme.warning : /^(#|\/\/)/.test(value) ? theme.text : theme.info });
    offset = match.index + value.length;
  }
  if (offset < text.length) result.push({ text: text.slice(offset), color: theme.text });
  return result;
}

export function CodeText({ source, language, wrap = true }: { source: string; language: string; wrap?: boolean }) {
  const tokens = useMemo(() => codeTokens(source, language), [source, language]);
  return <text fg={theme.text} flexShrink={0} wrapMode={wrap ? "word" : "none"}>{tokens.map((token, index) => <span key={index} fg={token.color}>{token.text}</span>)}</text>;
}

function Prose({ source }: { source: string }) {
  return <box flexDirection="column" flexShrink={0}>{displayText(source).replace(/\r?\n$/, "").split("\n").map((line, index) => {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const body = heading ? heading[2] : line.replace(/^\s*[-*+] /, "• ");
    return <text key={index} fg={heading ? theme.accent : theme.text} attributes={heading ? TextAttributes.BOLD : undefined} wrapMode="word">
      {body.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => part.startsWith("**") && part.endsWith("**")
        ? <span key={i} attributes={TextAttributes.BOLD}>{part.slice(2, -2)}</span>
        : part.startsWith("`") && part.endsWith("`") ? <span key={i} fg={theme.accentBright}>{part.slice(1, -1)}</span> : <span key={i}>{part || " "}</span>)}
    </text>;
  })}</box>;
}

export const AssistantMarkdown = memo(function AssistantMarkdown({ source }: { source: string }) {
  const parts = useMemo(() => markdownParts(source), [source]);
  return <box flexDirection="column" flexShrink={0}>{parts.map((part, index) => part.kind === "text"
    ? <Prose key={index} source={part.source || "…"} />
    : <box key={index} flexDirection="column" flexShrink={0} border borderStyle="rounded" borderColor={part.complete ? theme.border : theme.accentDeep} backgroundColor={theme.surface} paddingX={1} marginBottom={1}>
      <text fg={theme.accent}>{displayText(`${part.language || "code"} · /copy${part.complete ? "" : " · streaming"}`)}</text>
      <CodeText source={part.source} language={part.language} />
    </box>)}</box>;
});
