import type { Message } from "../types";

/** Request snapshots, not unique history tokens or billed units. */
export function summarizeUsage(messages: readonly Message[]) {
  let input = 0n;
  let output = 0n;
  let total = 0n;
  let computedTotal = 0n;
  let reportedTotal = 0n;
  let calculatedTotal = 0n;
  let legacyTotal = 0n;
  let cached = 0n;
  let reported = 0;
  let missing = 0;
  let pending = 0;
  let cacheReports = 0;
  let inconsistent = 0;
  let reportedTotals = 0;
  let calculatedTotals = 0;
  let legacyTotals = 0;
  let unconfirmed = 0;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    if (message.status === "streaming") pending++;
    if (!message.usage) {
      if (message.status !== "streaming") missing++;
      continue;
    }
    const usage = message.usage;
    reported++;
    if (message.status !== "complete") unconfirmed++;
    input += BigInt(usage.inputTokens);
    output += BigInt(usage.outputTokens);
    const storedTotal = BigInt(usage.totalTokens);
    const computed = BigInt(usage.inputTokens) + BigInt(usage.outputTokens);
    total += storedTotal;
    computedTotal += computed;
    if (storedTotal !== computed) inconsistent++;
    if (usage.totalSource === "reported") {
      reportedTotal += storedTotal;
      reportedTotals++;
    } else if (usage.totalSource === "calculated") {
      calculatedTotal += storedTotal;
      calculatedTotals++;
    } else {
      legacyTotal += storedTotal;
      legacyTotals++;
    }
    if (usage.cachedInputTokens !== undefined) {
      cacheReports++;
      cached += BigInt(usage.cachedInputTokens);
    }
  }
  return {
    input, output, total, computedTotal, reportedTotal, calculatedTotal, legacyTotal, cached,
    reported, missing, pending, cacheReports, inconsistent, reportedTotals, calculatedTotals, legacyTotals, unconfirmed,
  };
}

export function formatTokens(value: number | bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function usageLabel(message: Message): string {
  const usage = message.usage;
  if (!usage) return message.status === "streaming"
    ? "api tokens: awaiting report; usage unknown"
    : "api tokens: no report; usage unknown";
  const source = usage.totalSource === "reported" ? "reported total"
    : usage.totalSource === "calculated" ? "calculated total" : "legacy total (source unknown)";
  return `api tokens: ${formatTokens(usage.inputTokens)} input · ${formatTokens(usage.outputTokens)} output · ${formatTokens(usage.totalTokens)} ${source}`
    + ` · input + output: ${formatTokens(BigInt(usage.inputTokens) + BigInt(usage.outputTokens))}`
    + (usage.cachedInputTokens !== undefined ? ` · cache: ${formatTokens(usage.cachedInputTokens)} within input` : "")
    + (message.status !== "complete" ? " · unconfirmed" : "")
    + " · billing: /usage";
}
