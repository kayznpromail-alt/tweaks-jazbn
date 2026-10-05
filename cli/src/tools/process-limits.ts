export const PROCESS_LIMITS = Object.freeze({ timeoutMs: 120_000, cleanupMs: 20_000,
  toolTimeoutMs: 150_000, modelBytes: 1024 * 1024, artifactBytes: 16 * 1024 * 1024,
  activeJobs: 16, retainedJobs: 256, inputBytes: 1024 * 1024, inputChunkBytes: 16384, inputWaitMs: 5000,
  liveBytes: 16 * 1024, pageCharacters: 16384, scriptBytes: 60 * 1024, waitMs: 120000 });
export const PROCESS_POLICIES = Object.freeze({
  short: Object.freeze({ defaultMs: 120_000, maxMs: 120_000 }),
  build: Object.freeze({ defaultMs: 600_000, maxMs: 3_600_000 }),
  server: Object.freeze({ defaultMs: 3_600_000, maxMs: 28_800_000 }),
});
