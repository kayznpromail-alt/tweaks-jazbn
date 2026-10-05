/** Detect protocol markup in prose, never parse it into executable arguments. */
export function textToolCall(text:string,names:readonly string[]):string|undefined {
  // Documentation examples in fenced/inline code are ordinary answers.
  const prose=text.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`/g,'');
  const registered=new Set(names);
  for(const match of prose.matchAll(/<tool_call>\s*([A-Za-z_][A-Za-z0-9_.-]{0,63})\s*(?=[\[\{\(\n])|<function=([A-Za-z_][A-Za-z0-9_.-]{0,63})>/g)) {
    const name=match[1]??match[2];if(registered.has(name))return name;
  }
  for(const match of prose.matchAll(/<tool_call>\s*\{/g)) {
    const header=prose.slice(match.index!+match[0].length,match.index!+match[0].length+256);
    const name=/^\s*"name"\s*:\s*"([A-Za-z_][A-Za-z0-9_.-]{0,63})"/.exec(header)?.[1];
    if(name&&registered.has(name))return name;
  }
}
