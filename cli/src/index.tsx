import { parseArgs } from "node:util";
// @ts-ignore shared native runtime directory
import { runtimeEnvironment } from "../bin/install-paths.mjs";
import { CLI_VERSION } from "./version";
import { join } from "node:path";
import { readFileSync, realpathSync } from "node:fs";
import { defaultArtifactDirectory } from "./workspace/artifacts";
import { findGit } from "./tools/git";
import { shellCommand } from "./tools/process";
import { ChatController } from "./core";
import { safeError } from "./core/errors";
import { loadEffortCatalog } from "./api/effort";
import { loadProfiles } from "./profiles";
import { getPaths, LocalStore, SystemCredentials } from "./storage";
import { SessionWorkflows } from "./core/session-workflows";
import { previewCleanup, applyCleanup } from "./storage/cleanup";
import { loadPermissionRules } from "./agent/permission-rules";

// set before dynamically importing the renderer, which caches environment values.
delete process.env.OTUI_STDIN_LOG;
process.env.OTUI_DEBUG = "false";
process.env.OTUI_DEBUG_FFI = "false";
process.env.OTUI_TRACE_FFI = "false";

async function main() {
  let options: ReturnType<typeof parseArgs>;
  try {
    options = parseArgs({ args: process.argv.slice(2), strict: true, allowPositionals: false, options: {
      help: { type: "boolean", short: "h" }, version: { type: "boolean" }, doctor: { type: "boolean" },
      project: { type: "string" },
      sessions: { type: "boolean" }, session: { type: "string" }, rename: { type: "string" }, fork: { type: "boolean" },
      export: { type: "string" }, diagnostics: { type: "string" }, storage: { type: "boolean" }, cleanup: { type: "string" },
    } });
  } catch {
    process.stderr.write("invalid arguments. run with --help.\n");
    process.exitCode = 1;
    return;
  }
  if (options.values.help) {
    process.stdout.write("local maintenance: --sessions [--project path]; --session id --rename title | --fork | --export new-file\n--diagnostics new-file; --storage --project path; --cleanup preview-digest --project path\nsee CODING_WORKFLOWS.md for scoped permission rules and acceptance limits.\n\n");
    process.stdout.write("edgey cli\n\nedgey [--project directory]\n\n--project   open a project directory\napi         https://api.edgey.shop/v1\n--version   show version\n--doctor    local runtime and tool availability (no credentials or api calls)\n\nctrl+p: commands · enter: send · shift+enter / ctrl+j: new line\n/messages: message actions · /diagnostics: local support report\nctrl+o: models · ctrl+s: sessions · ctrl+n: new conversation\nctrl+t: cycle supported effort · /effort: choose a level\nesc / ctrl+c: interrupt response · double esc: stop and compose next prompt\nctrl+c: copy selection first; idle does not exit · /quit: save and quit\n");
    return;
  }
  if (options.values.version) { process.stdout.write(`edgey ${CLI_VERSION}\n`); return; }
  Object.assign(process.env, runtimeEnvironment());
  if (options.values.doctor) {
    await import("@opentui/core");
    await import("@opentui/react");
    const manifest = {version:CLI_VERSION};
    const shell = process.platform === "win32" ? "powershell" : "sh";
    let shellAvailable = false;
    try { shellCommand(shell, "exit 0"); shellAvailable = true; } catch { /* report capability only */ }
    process.stdout.write(JSON.stringify({ application: "edgey", version: manifest.version, runtime: { bun: Bun.version, node: process.versions.node,
      platform: process.platform, arch: process.arch }, features: { agent: true, defaultMode: "review", fileReview: true,
      continuation: true, explicitRecovery: true, instructionTrust: true }, git: { available: !!findGit() },
      shell: { name: shell, available: shellAvailable }, provider: "not probed", credentials: "not accessed" }, null, 2) + "\n");
    return;
  }
  if (options.values.sessions || options.values.session || options.values.diagnostics || options.values.storage || options.values.cleanup) {
    const paths = getPaths(), local = new LocalStore(paths.database);
    try {
      const workflows = new SessionWorkflows(local);
      const id = options.values.session as string | undefined;
      let result: unknown;
      if (options.values.diagnostics) result = workflows.diagnostics(options.values.diagnostics as string);
      else if (options.values.storage || options.values.cleanup) {
        const { realpathSync } = await import("node:fs");
        const project = realpathSync(options.values.project as string ?? process.cwd());
        const artifacts = defaultArtifactDirectory(paths.directory, project);
        result = options.values.cleanup ? await applyCleanup(local, artifacts, project, options.values.cleanup as string)
          : previewCleanup(local, artifacts, project);
      } else if (id && options.values.rename) result = workflows.rename(id, options.values.rename as string);
      else if (id && options.values.fork) result = workflows.fork(id);
      else if (id && options.values.export) result = workflows.export(id, options.values.export as string);
      else result = local.listSessions(options.values.project as string ?? process.cwd());
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : "local operation failed"}\n`); process.exitCode = 1; }
    finally { local.close(); }
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("run the cli in an interactive terminal. commands: npm start -- --help\n");
    process.exitCode = 1;
    return;
  }

  let store: LocalStore | undefined;
  let controller: ChatController | undefined;
  let renderer: { destroy(): void } | undefined;
  let closing: Promise<void> | undefined;
  const shutdown = () => closing ??= (async () => {
    let failure: string | undefined;
    try { await controller?.dispose(); } catch { failure = "the conversation was not fully saved; check the latest session checkpoint."; }
    renderer?.destroy();
    process.off("SIGTERM", signalExit);
    process.off("SIGINT", signalExit);
    process.off("SIGHUP", signalExit);
    if (failure) { process.stderr.write(`${failure}\n`); process.exitCode = 1; }
  })();
  const signalExit = () => { void shutdown(); };

  try {
    const paths = getPaths();
    const profiles = await loadProfiles(paths.profiles);
    store = new LocalStore(paths.database);
    store.saveSettings({ ...store.getSettings(), baseUrl: "https://api.edgey.shop/v1" });
    controller = new ChatController({ store, credentials: new SystemCredentials(), profiles,
      effortCatalog: await loadEffortCatalog(join(paths.directory, "reasoning-models.json")),
      agent: { artifactDir: join(paths.directory, "artifacts"), dataDirectory: paths.directory, mode: "review", permissionRules: loadPermissionRules(join(paths.directory, "permissions.json")) },
      project: typeof options.values.project === "string" ? options.values.project : undefined });
    const { createCliRenderer } = await import("@opentui/core");
    const { createRoot } = await import("@opentui/react");
    const { createElement } = await import("react");
    const { App } = await import("./ui/app");
    const terminal = await createCliRenderer({ screenMode: "alternate-screen", exitOnCtrlC: false, useMouse: true });
    renderer = terminal;
    process.on("SIGTERM", signalExit);
    process.on("SIGINT", signalExit);
    process.on("SIGHUP", signalExit);
    createRoot(terminal).render(createElement(App, { controller, onExit: shutdown, profileDirectory: paths.profiles }));
  } catch (error) {
    renderer?.destroy();
    if (controller) await controller.dispose().catch(() => {});
    else store?.close();
    process.stderr.write(`${safeError(error)}\n`);
    process.exitCode = 1;
  }
}

await main();
