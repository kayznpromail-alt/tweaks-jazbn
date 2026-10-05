import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

// @ts-ignore shared native/source installation paths
import { installRoot, migrateLegacyData } from "../../bin/install-paths.mjs";

export function getDataDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return env.EDGEY_CLI_HOME?.trim() ? resolve(env.EDGEY_CLI_HOME.trim()) : join(installRoot(env), "data");
}

export function getInstructionsDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.EDGEY_CLI_HOME?.trim() ? resolve(env.EDGEY_CLI_HOME.trim()) : installRoot(env), "instructions");
}

export function getCommandsDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.EDGEY_CLI_HOME?.trim() ? resolve(env.EDGEY_CLI_HOME.trim()) : installRoot(env), "commands");
}

export function getLegacyDataDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.EDGEY_CLI_HOME?.trim();
  if (override) return resolve(override);

  const home = (process.platform === "win32" ? env.USERPROFILE || env.HOME : env.HOME) || homedir();
  if (process.platform === "win32") {
    const local = env.LOCALAPPDATA;
    return resolve(local && isAbsolute(local) ? local : join(home, "AppData", "Local"), "edgey-cli");
  }
  if (process.platform === "darwin") {
    return resolve(home, "Library", "Application Support", "edgey-cli");
  }
  const xdg = env.XDG_DATA_HOME;
  return resolve(xdg && isAbsolute(xdg) ? xdg : join(home, ".local", "share"), "edgey-cli");
}

/** przygotowuje katalog danych i profili; sam plik bazy otwiera LocalStore. */
export function getPaths(dataDir?: string): { directory: string; database: string; profiles: string } {
  try {
    const input = dataDir ?? getDataDirectory();
    if (typeof input !== "string" || !input.trim()) throw new Error();
    const directory = resolve(input);
    if (dataDir === undefined && !process.env.EDGEY_CLI_HOME?.trim()) migrateLegacyData(directory, getLegacyDataDirectory());
    const profiles = join(directory, "profiles");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    mkdirSync(profiles, { recursive: true, mode: 0o700 });
    return { directory, database: join(directory, "cli.db"), profiles };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("close other edgey")) throw error;
    throw new Error("could not prepare the cli data directory. existing data was preserved; close other edgey windows and retry.");
  }
}
