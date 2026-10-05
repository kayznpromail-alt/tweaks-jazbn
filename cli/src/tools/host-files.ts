import { isAbsolute, join, parse, relative, resolve } from "node:path";
import type { AgentTool, ToolInvocationContext } from "../agent/registry";
import { AgentError } from "../agent/errors";
import type { JsonObject, JsonValue } from "../types";
import { Workspace } from "../workspace";
import { ArtifactStore } from "../workspace/artifacts";
import { contained, pathKey, protectedPath, WorkspacePaths } from "../workspace/paths";
import { fail, safeError } from "../workspace/errors";
import { createFileTools } from "./files";
import { fileToolPath } from "./file-paths";

/** Host-selected bypass access. Models cannot enable it through arguments or file text. */
export class HostFileTools {
  readonly tools: AgentTool[];
  private readonly routes: ArtifactStore;
  private readonly volumes = new Map<string, Workspace>();
  constructor(private readonly project: Workspace, private readonly options: {
    artifactDir: string; secrets: readonly string[]; bypass: () => boolean;
    beforeEffect: (context: ToolInvocationContext) => void;
  }) {
    this.routes = new ArtifactStore(options.artifactDir, project.root);
    this.tools = createFileTools(project, options).map(tool => ({ ...tool,
      execute: (args, context) => this.execute(tool, args, context),
    }));
  }

  private absolute(value: unknown, allowRoot = false): string {
    const path = fileToolPath(value, allowRoot);
    return isAbsolute(path) ? resolve(path) : resolve(this.project.root, path);
  }

  private volume(root: string): Workspace {
    const key = pathKey(root);
    let workspace = this.volumes.get(key);
    if (!workspace) {
      workspace = new Workspace({ root, secrets: this.options.secrets, allowProtectedFiles: true,
        artifactDir: join(this.options.artifactDir, ".edgey-artifacts", "host-files") });
      this.volumes.set(key, workspace);
    }
    return workspace;
  }

  private routeName(id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error("invalid change id");
    return `host-change-${id}.json`;
  }

  /** Reviews/explicit undo retain the signed target after restart or a mode change. */
  workspaceForChange(id: string, digest: string): Workspace {
    const name = this.routeName(id);
    if (!this.routes.exists(name)) return this.project;
    const route = this.routes.read(name) as JsonObject;
    if (route.version !== 1 || route.project !== this.project.root || route.changeId !== id || route.digest !== digest
      || typeof route.root !== "string" || parse(route.root).root !== route.root) throw new Error("invalid host change route");
    return this.volume(route.root);
  }

  private result(value: JsonValue, root: string, key = ""): JsonValue {
    if (typeof value === "string" && (key === "path" || key === "paths")) return resolve(root, value);
    if (Array.isArray(value)) return value.map(item => this.result(item, root, key));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, this.result(item, root, name)]));
    return value;
  }

  private async execute(tool: AgentTool, args: Readonly<JsonObject>, context: ToolInvocationContext): Promise<JsonValue> {
    try {
      if (!tool.validate(args)) fail("invalid_input");
      if (pathKey(new WorkspacePaths(context.project).root) !== pathKey(this.project.root)) fail("outside_workspace");
      if (tool.name === "apply_change" || tool.name === "undo_change") {
        const target = this.workspaceForChange(args.changeId as string, args.digest as string);
        if (target === this.project) return tool.execute(args, context);
        if (!this.options.bypass()) return { ok: false, error: { code: "bypass_required",
          message: "this change targets files outside the project or protected files. enable bypass permissions to apply it." } };
        this.options.beforeEffect(context);
        const hostTool = createFileTools(target, this.options).find(candidate => candidate.name === tool.name)!;
        return this.result(await hostTool.execute(args, { ...context, project: target.root }), target.root);
      }
      if (!this.options.bypass()) return tool.execute(args, context);
      const copy = structuredClone(args) as JsonObject;
      const operations = tool.name === "prepare_change" ? copy.operations as JsonObject[] : undefined;
      const targets = operations ? operations.flatMap(operation => [this.absolute(operation.path),
        ...(operation.to === undefined ? [] : [this.absolute(operation.to)])]) : [this.absolute(copy.path ?? ".", tool.name !== "read_file")];
      // Keep ordinary project changes in their existing journal and mutation lock.
      if (targets.every(path => contained(this.project.root, path) && !protectedPath(relative(this.project.root, path).replaceAll("\\", "/")))) {
        return tool.execute(args, context);
      }
      const root = parse(targets[0]!).root;
      if (targets.some(path => pathKey(parse(path).root) !== pathKey(root))) return { ok: false, error: {
        code: "multiple_volumes", message: "split this change into one prepare_change call per filesystem volume." } };
      const target = this.volume(root);
      const local = (path: unknown, allowRoot = false) => relative(root, this.absolute(path, allowRoot)).replaceAll("\\", "/") || ".";
      if (operations) for (const operation of operations) {
        operation.path = local(operation.path);
        if (operation.to !== undefined) operation.to = local(operation.to);
      } else {
        copy.path = local(copy.path ?? ".", tool.name !== "read_file");
      }
      this.options.beforeEffect(context);
      if (tool.name === "glob_files" || tool.name === "search_text") {
        // Absolute directory names are literal, never part of the model's glob syntax.
        const search = { ...copy, path: copy.path as string, pattern: (copy.pattern as string | undefined) ?? "**",
          patternBase: copy.path as string, signal: context.signal };
        const output = tool.name === "glob_files" ? target.glob(search) : target.search({ ...search, query: copy.query as string });
        return this.result(output as unknown as JsonValue, root);
      }
      const hostTool = createFileTools(target, this.options).find(candidate => candidate.name === tool.name)!;
      const output = await hostTool.execute(copy, { ...context, project: target.root });
      if (tool.name === "prepare_change" && output && typeof output === "object" && !Array.isArray(output)
        && typeof output.changeId === "string" && typeof output.digest === "string") {
        this.routes.create(this.routeName(output.changeId), { version: 1, project: this.project.root, root,
          changeId: output.changeId, digest: output.digest });
      }
      return this.result(output, root);
    } catch (error) {
      if (error instanceof AgentError) throw error;
      const safe = safeError(error);
      return { ok: false, error: { code: safe.code, message: safe.message } };
    }
  }
}
