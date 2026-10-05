import { open, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import type { Profile } from "../types";

const maxProfileBytes = 128 * 1024;

/** filesystem injection keeps link rejection testable without symlink privileges. */
export interface ProfileFileSystem {
  readDirectory(directory: string): Promise<Array<Pick<Dirent, "name" | "isDirectory" | "isFile">>>;
  openFile: typeof open;
}

const profileFileSystem: ProfileFileSystem = {
  readDirectory: (directory) => readdir(directory, { withFileTypes: true }),
  openFile: open,
};
const errors = {
  directory: "could not read the profiles directory.",
  file: "could not read the profile file.",
  too_large: "the profile file exceeds the 128 kib limit.",
  invalid: "invalid profile format.",
  duplicate_id: "profile ids must be unique.",
  model_conflict: "multiple automatic profiles are assigned to the same model.",
  default_conflict: "only one default profile is allowed.",
} as const;

export type ProfileErrorCode = keyof typeof errors;

export class ProfileError extends Error {
  readonly code: ProfileErrorCode;

  constructor(code: ProfileErrorCode) {
    const safeCode = Object.hasOwn(errors, code) ? code : "invalid";
    super(errors[safeCode]);
    this.name = "ProfileError";
    this.code = safeCode;
  }
}

function label(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value
    && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function readProfile(value: unknown): Profile {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ProfileError("invalid");
  const profile = value as Record<string, unknown>;
  if (Object.keys(profile).some((key) => !["id", "name", "version", "instructions", "models", "auto", "default"].includes(key))
    || !label(profile.id) || !label(profile.name) || !label(profile.version)
    || typeof profile.instructions !== "string" || !profile.instructions.trim()
    || !Array.isArray(profile.models) || !Array.from(profile.models).every(label)
    || (Object.hasOwn(profile, "auto") && typeof profile.auto !== "boolean")
    || (Object.hasOwn(profile, "default") && typeof profile.default !== "boolean")) {
    throw new ProfileError("invalid");
  }
  return {
    id: profile.id, name: profile.name, version: profile.version, instructions: profile.instructions,
    models: [...profile.models], auto: (profile.auto as boolean | undefined) ?? true,
    default: (profile.default as boolean | undefined) ?? false,
  };
}

function assertNoConflicts(profiles: Profile[]): void {
  const ids = new Set<string>();
  const models = new Set<string>();
  let hasDefault = false;
  for (const profile of profiles) {
    if (ids.has(profile.id)) throw new ProfileError("duplicate_id");
    ids.add(profile.id);
    if (profile.default) {
      if (hasDefault) throw new ProfileError("default_conflict");
      hasDefault = true;
    }
    if (!profile.auto) continue;
    for (const model of new Set(profile.models)) {
      if (models.has(model)) throw new ProfileError("model_conflict");
      models.add(model);
    }
  }
}

async function readProfileFile(filename: string, filesystem: ProfileFileSystem): Promise<Profile> {
  const handle = await filesystem.openFile(filename, "r").catch(() => { throw new ProfileError("file"); });
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new ProfileError("file");
    if (stat.size > maxProfileBytes) throw new ProfileError("too_large");
    // limit obowiązuje także wtedy, gdy plik rośnie po stat().
    const bytes = Buffer.alloc(maxProfileBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > maxProfileBytes) throw new ProfileError("too_large");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
    return readProfile(JSON.parse(text));
  } catch (error) {
    if (error instanceof ProfileError) throw error;
    throw new ProfileError("invalid");
  } finally {
    await handle.close().catch(() => { throw new ProfileError("file"); });
  }
}

export async function loadProfiles(directory: string, filesystem: ProfileFileSystem = profileFileSystem): Promise<Profile[]> {
  const entries = await filesystem.readDirectory(directory).catch((error: unknown) => {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw new ProfileError("directory");
  });
  const profiles: Profile[] = [];
  for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (!entry.name.toLowerCase().endsWith(".json") || entry.isDirectory()) continue;
    if (!entry.isFile()) throw new ProfileError("file");
    profiles.push(await readProfileFile(join(directory, entry.name), filesystem));
  }
  assertNoConflicts(profiles);
  return profiles;
}

export function selectProfile(profiles: Profile[], model: string): Profile | null {
  if (!Array.isArray(profiles) || !label(model)) throw new ProfileError("invalid");
  // walidacja również dla kolekcji utworzonych bez loadera; konflikt blokuje cały wybór.
  const checked = Array.from(profiles, readProfile);
  assertNoConflicts(checked);
  const exact = checked.findIndex((profile) => profile.auto && profile.models.includes(model));
  const index = exact !== -1 ? exact : checked.findIndex((profile) => profile.auto && profile.default);
  return index === -1 ? null : profiles[index];
}
