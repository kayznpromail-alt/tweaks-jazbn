import { normalizeBaseUrl } from "./url";

export const CHAT_TOOL_ADAPTER_REVISION = "chat-completions-tools-v1";

export interface CapabilityTarget {
  baseUrl: string;
  model: string;
  adapterRevision: string;
}

export type ToolCapability =
  | { state: "unknown" }
  | { state: "supported"; evidence: "completed_provider_cycle"; observedAt: string }
  | { state: "unsupported"; evidence: "explicit_provider_rejection"; observedAt: string };

export type ToolCapabilityObservation = Exclude<ToolCapability, { state: "unknown" }>;

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512
    && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function key(target: CapabilityTarget): string {
  if (!target || !identifier(target.model) || !identifier(target.adapterRevision)
    || typeof target.baseUrl !== "string" || !target.baseUrl.trim()) {
    throw new Error("invalid capability target");
  }
  // keep the full api base: separate routes on the same host can use different providers.
  return JSON.stringify([normalizeBaseUrl(target.baseUrl), target.model, target.adapterRevision]);
}

/** caller supplies actual provider evidence; this registry never probes or infers support. */
export class ToolCapabilityRegistry {
  private readonly observations = new Map<string, ToolCapabilityObservation>();

  constructor(private readonly maxEntries = 256) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 4096) {
      throw new Error("invalid capability capacity");
    }
  }

  get(target: CapabilityTarget): ToolCapability {
    const observation = this.observations.get(key(target));
    return observation ? { ...observation } : { state: "unknown" };
  }

  record(target: CapabilityTarget, observation: ToolCapabilityObservation): void {
    const targetKey = key(target);
    if (!observation || !(
      observation.state === "supported" && observation.evidence === "completed_provider_cycle"
      || observation.state === "unsupported" && observation.evidence === "explicit_provider_rejection"
    ) || typeof observation.observedAt !== "string"
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(observation.observedAt)) {
      throw new Error("invalid capability evidence");
    }
    const timestamp = Date.parse(observation.observedAt);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== observation.observedAt) {
      throw new Error("invalid capability evidence");
    }
    const prior = this.observations.get(targetKey);
    if (prior && prior.observedAt > observation.observedAt) {
      throw new Error("stale capability evidence");
    }
    this.observations.delete(targetKey);
    this.observations.set(targetKey, {
      state: observation.state, evidence: observation.evidence, observedAt: observation.observedAt,
    } as ToolCapabilityObservation);
    if (this.observations.size > this.maxEntries) {
      this.observations.delete(this.observations.keys().next().value!);
    }
  }

  forget(target: CapabilityTarget): boolean {
    return this.observations.delete(key(target));
  }
}
