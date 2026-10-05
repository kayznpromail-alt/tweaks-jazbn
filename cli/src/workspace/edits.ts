import { fail, WorkspaceError } from "./errors";
import { lines, newline, validText, workspaceLimits } from "./text";

export interface PatchHunk { startLine: number; oldText: string; newText: string }

/** Literal, unique matching, including overlapping occurrences. No fuzzy/regex edits. */
export function replaceExact(source: string, oldText: string, newText: string): string {
  if (!oldText) fail("invalid_change");
  const start = source.indexOf(oldText);
  if (start < 0) fail("match_not_found");
  if (source.indexOf(oldText, start + 1) >= 0) fail("ambiguous_change");
  const result = source.slice(0, start) + newText + source.slice(start + oldText.length);
  validText(result);
  if (result === source) fail("invalid_change");
  return result;
}

/** Coordinates refer to the original file. Every hunk replaces whole, exact lines. */
export function patchExact(source: string, hunks: readonly PatchHunk[]): string {
  if (!hunks.length) fail("invalid_patch");
  const offsets = [0];
  for (const line of lines(source)) offsets.push(offsets.at(-1)! + line.length);
  const boundaries = new Set(offsets);
  let end = 0, previousStart = -1;
  const parts: string[] = [];
  for (const [hunkIndex, hunk] of hunks.entries()) {
    const start = offsets[hunk.startLine - 1];
    if (start === undefined || start < end || start <= previousStart) fail("invalid_patch");
    if (!hunk.oldText && start === source.length && source && !source.endsWith("\n")) fail("invalid_patch");
    const next = start + hunk.oldText.length;
    if (!source.startsWith(hunk.oldText, start) || !boundaries.has(next)) throw new WorkspaceError("patch_mismatch", {
      hunkIndex, startLine: hunk.startLine, newline: newline(source),
      reason: source.startsWith(hunk.oldText, start) ? "whole_lines_required" : "text_mismatch",
    });
    // Do not join a new unfinished line to untouched following content.
    if (next < source.length && hunk.newText && !hunk.newText.endsWith("\n")) fail("invalid_patch");
    parts.push(source.slice(end, start), hunk.newText);
    end = next; previousStart = start;
  }
  const result = parts.join("") + source.slice(end);
  validText(result, workspaceLimits.fileBytes);
  if (result === source) fail("invalid_change");
  return result;
}
