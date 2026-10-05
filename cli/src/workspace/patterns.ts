import { fail } from "./errors";

// A small glob language: / separates segments; *, ?, and a whole-segment ** only.
// Dynamic programming avoids backtracking even for adversarial repeated stars.
export function globMatcher(pattern: string): (path: string) => boolean {
  if (typeof pattern !== "string" || pattern.length > 256 || !pattern || pattern.includes("\\")
    || /[\x00-\x1f\x7f:[\]{}()!]/.test(pattern) || pattern.startsWith("/")
    || (pattern.match(/[?*]/g)?.length ?? 0) > 32) fail("unsupported_pattern");
  const parts = pattern.split("/");
  if (parts.length > 32 || parts.some((p) => !p || p === "." || p === ".." || (p.includes("**") && p !== "**"))) fail("unsupported_pattern");
  const segment = (p: string, value: string): boolean => {
    const chars = [...value];
    let prev = new Uint8Array(chars.length + 1); prev[0] = 1;
    for (const c of p) {
      const next = new Uint8Array(chars.length + 1);
      if (c === "*") next[0] = prev[0];
      for (let j = 1; j <= chars.length; j++) next[j] = c === "*" ? (next[j - 1] | prev[j]) : ((c === "?" || c === chars[j - 1]) ? prev[j - 1] : 0);
      prev = next;
    }
    return prev[chars.length] === 1;
  };
  return (path) => {
    const names = path.split("/");
    let prev = new Uint8Array(names.length + 1); prev[0] = 1;
    for (const part of parts) {
      const next = new Uint8Array(names.length + 1);
      if (part === "**") next[0] = prev[0];
      for (let j = 1; j <= names.length; j++) next[j] = part === "**" ? (prev[j] | next[j - 1]) : (prev[j - 1] && segment(part, names[j - 1]) ? 1 : 0);
      prev = next;
    }
    return prev[names.length] === 1;
  };
}

/** Regex deliberately accepts only fixed-width atoms, anchors, character classes and escapes.
 * No repetition, groups, alternation, lookaround or backreferences reach the regex engine. */
export function textMatcher(query: string, regex = false, caseSensitive = true): (line: string) => number {
  if (typeof query !== "string" || !query || query.length > 256 || /[\r\n\x00]/.test(query) || !query.isWellFormed()) fail("unsupported_pattern");
  if (!regex) {
    const needle = caseSensitive ? query : query.toLowerCase();
    return (line) => (caseSensitive ? line : line.toLowerCase()).indexOf(needle);
  }
  let inClass = false;
  for (let i = 0; i < query.length; i++) {
    const c = query[i];
    if (c === "\\") {
      const escaped = query[++i];
      if (!escaped || !/^[dDsSwW.\[\]\\^$*+?{}()|\-]$/.test(escaped)) fail("unsupported_pattern");
    } else if (c === "[") {
      if (inClass) fail("unsupported_pattern");
      inClass = true;
    } else if (c === "]") {
      if (!inClass) fail("unsupported_pattern");
      inClass = false;
    } else if (!inClass && /[*+?{}()|]/.test(c)) fail("unsupported_pattern");
  }
  if (inClass) fail("unsupported_pattern");
  try {
    const expression = new RegExp(query, caseSensitive ? "u" : "iu");
    return (line) => expression.exec(line)?.index ?? -1;
  } catch { fail("unsupported_pattern"); }
}
