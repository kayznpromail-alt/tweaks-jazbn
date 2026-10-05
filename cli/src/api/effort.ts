import type { ReasoningEffort } from "../types";
import { normalizeBaseUrl } from "./url";

export const effortLevels = ["none", "low", "medium", "high", "xhigh", "max"] as const;

// Reasoning levels come from this provider or an explicit local catalogue.
export const edgeyEfforts = (_model: string): ReasoningEffort[] | undefined => undefined;

export function isEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (effortLevels as readonly string[]).includes(value);
}
export function parseEfforts(value: unknown): ReasoningEffort[] | undefined {
  if (!Array.isArray(value) || value.length > 16 || !value.every(isEffort)) return undefined;
  return effortLevels.filter((level) => value.includes(level));
}

export interface EffortCatalog {
  baseUrl: string;
  models: { id: string; levels: ReasoningEffort[]; source: string }[];
}

// operator-supplied declarations are exact-model and exact-origin scoped.
export async function loadEffortCatalog(path: string): Promise<EffortCatalog | undefined> {
  const file = Bun.file(path);
  if (!await file.exists()) return undefined;
  if (file.size > 65536) throw new Error("reasoning catalog exceeds 64 kib");
  const value = await file.json();
  if (!value || typeof value.baseUrl !== "string" || !Array.isArray(value.models) || value.models.length > 256) throw new Error("invalid reasoning catalog");
  const ids = new Set<string>();
  const models = value.models.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("invalid reasoning model");
    const entry = item as Record<string, unknown>, levels = parseEfforts(entry.levels);
    if (typeof entry.id !== "string" || !entry.id.trim() || entry.id.length > 256 || /[\x00-\x1f\x7f]/.test(entry.id)
      || ids.has(entry.id) || !levels?.length || typeof entry.source !== "string" || !entry.source.trim() || entry.source.length > 2048) throw new Error("invalid reasoning model");
    ids.add(entry.id);
    return { id: entry.id, levels, source: entry.source };
  });
  return { baseUrl: normalizeBaseUrl(value.baseUrl), models };
}
