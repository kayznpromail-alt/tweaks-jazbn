import type { InstructionResult, Workspace } from "./workspace";

/** Compose once per request; sources carry their exact hashes and scopes. Host ignore choices
 * are not model tool arguments. Repository text cannot authorize effects or change policy. */
export function loadWorkspaceInstructions(workspace: Workspace, targets: readonly string[] = ["."],
  options: { signal?: AbortSignal; ignore?: readonly string[] } = {}): InstructionResult {
  return workspace.instructions(targets, options);
}
