export interface Limits {
  timeoutMs: number;
  memoryBytes: number;
  maxCalls: number;
  maxOutputBytes: number;
  maxConcurrent: number;
}
export const DEFAULT_LIMITS: Limits = {
  timeoutMs: 30000, memoryBytes: 32 * 1024 * 1024, maxCalls: 32,
  maxOutputBytes: 1024 * 1024, maxConcurrent: 4
};
