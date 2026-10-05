// Compiled executables cannot run `bun -e`. Dispatch the owned IPC helper before
// importing the CLI, renderer, credentials or history.
export {};
if (process.argv.length === 3 && process.argv[2] === "--edgey-mcp-check") {
  try { await (await import("./mcp/check")).mcpCheck(); } catch { console.error("native mcp acceptance failed");process.exitCode=1; }
} else if (process.argv.length === 3 && process.argv[2] === "--edgey-mcp-fixture") {
  await (await import("./mcp/check")).mcpFixture();
} else if (process.argv.length === 3 && process.argv[2] === "--edgey-browser-check") {
  try { await (await import("./browser/check")).browserCheck(); }
  catch { console.error("native browser acceptance failed"); process.exitCode=1; }
} else if (process.argv.length === 3 && process.argv[2] === "--edgey-process-host") {
  if (typeof process.send !== "function" || !process.env.EDGEY_PROCESS_ARGV) {
    process.stderr.write("process host requires an owned ipc connection.\n");
    process.exitCode = 1;
  } else {
    const { supervisor } = await import("./tools/process-supervisor");
    // Only the bundled constant is evaluated; command arguments travel as JSON.
    new Function(supervisor)();
  }
} else {
  await import("./index");
}
