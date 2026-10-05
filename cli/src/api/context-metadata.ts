export interface ModelContext {
  version: 1; context_tokens: number; source: "provider_catalog" | "operator_verified_cycle";
}

export function parseModelContext(value: unknown): ModelContext | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const v = value as ModelContext;
  if (Object.keys(v).sort().join() !== "context_tokens,source,version" || v.version !== 1
    || !["provider_catalog", "operator_verified_cycle"].includes(v.source)
    || !Number.isSafeInteger(v.context_tokens) || v.context_tokens < 1024 || v.context_tokens > 10000000) return;
  return { ...v };
}

