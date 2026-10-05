/** extract display text only; incomplete arguments never become executable data. */
export function draftText(source: string): string {
  const fields: string[] = [];
  const pattern = /"(path|to|content|script|command|executable|title|prompt|model|query|pattern)"\s*:\s*"((?:[^"\\]|\\.)*)("|$)/g;
  for (const match of source.matchAll(pattern)) {
    let value = match[2]!;
    // do not decode an incomplete escape or unicode sequence.
    value = value.replace(/\\(?:u[0-9a-fA-F]{0,3})?$/, "");
    try { value = JSON.parse(`"${value}"`) as string; } catch { continue; }
    fields.push(`${match[1]}: ${value}`);
  }
  return fields.join("\n");
}

export interface DraftFile { path: string; content: string; complete: boolean }

/** scan JSON string tokens without treating unfinished arguments as executable data. */
export function draftFiles(source: string): DraftFile[] {
  const objects = new Map<number, { path?: string; content?: string; complete: boolean }>();
  const stack: number[] = [];
  let cursor = 0;
  function string(): { value: string; complete: boolean } {
    const start = ++cursor;
    let complete = false;
    while (cursor < source.length) {
      if (source[cursor] === "\\") { cursor += 2; continue; }
      if (source[cursor] === '"') { complete = true; break; }
      cursor++;
    }
    let raw = source.slice(start, Math.min(cursor, source.length));
    if (complete) cursor++;
    else {
      const tail = /(\\+)(u[0-9a-fA-F]{0,3})?$/.exec(raw);
      if (tail && tail[1]!.length % 2) raw = raw.slice(0, raw.length - 1 - (tail[2]?.length ?? 0));
    }
    try { return { value: JSON.parse('"' + raw + '"') as string, complete }; }
    catch { return { value: "", complete: false }; }
  }
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "{") { stack.push(cursor++); continue; }
    if (char === "}") { stack.pop(); cursor++; continue; }
    if (char !== '"') { cursor++; continue; }
    const key = string();
    while (/\s/.test(source[cursor] ?? "") && cursor < source.length) cursor++;
    if (!key.complete || source[cursor] !== ":") continue;
    cursor++;
    while (/\s/.test(source[cursor] ?? "") && cursor < source.length) cursor++;
    if (source[cursor] !== '"') continue;
    const value = string();
    const object = stack.at(-1);
    if (object === undefined || !["path", "content"].includes(key.value)) continue;
    const fields = objects.get(object) ?? { complete: false };
    if (key.value === "path") { if (value.complete) fields.path = value.value; }
    else { fields.content = value.value; fields.complete = value.complete; }
    objects.set(object, fields);
  }
  return [...objects.values()].filter((file) => file.path !== undefined && file.content !== undefined)
    .map((file) => ({ path: file.path!, content: file.content!, complete: file.complete }));
}
