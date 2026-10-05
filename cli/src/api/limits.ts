// limits are utf-8 bytes. this is the executable boundary for one complete
// tool-call argument, its validation and its display preview.
export const EXECUTABLE_ARGUMENT_BYTES = 64 * 1024;
export const API_LIMITS = Object.freeze({
  requestTimeoutMs: 120_000,
  // No separate first-byte deadline; generationMaxMs still bounds the request.
  generationFirstResponseMs: null,
  generationIdleMs: 10 * 60_000,
  generationMaxMs: 30 * 60_000,
  eventBytes: 256 * 1024,
  bodyBytes: 16 * 1024 * 1024,
  outputBytes: 4 * 1024 * 1024,
  requestBytes: 16 * 1024 * 1024,
  tools: 64,
  toolCalls: 64,
  toolIdBytes: 256,
  toolArgumentsBytes: EXECUTABLE_ARGUMENT_BYTES,
  // A response may contain several executable calls, but each call remains
  // bounded by EXECUTABLE_ARGUMENT_BYTES before it can be dispatched.
  totalToolArgumentsBytes: EXECUTABLE_ARGUMENT_BYTES * 4,
  toolDefinitionsBytes: 128 * 1024,
  schemaDepth: 16,
  schemaNodes: 1024,
  schemaProperties: 128,
  schemaEnumValues: 128,
  argumentDepth: 32,
  argumentNodes: 16_384,
});
