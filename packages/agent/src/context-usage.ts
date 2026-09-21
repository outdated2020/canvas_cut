export const CONTEXT_CHARACTER_LIMIT = 200000;
export const CONTEXT_COMPACT_THRESHOLD = 120000;

export function contextUsage(messages: unknown[]) {
  const usedCharacters = messages.length ? JSON.stringify(messages).length : 0;
  return {
    usedCharacters,
    limitCharacters: CONTEXT_CHARACTER_LIMIT,
    compactThreshold: CONTEXT_COMPACT_THRESHOLD,
    ratio: Math.min(1, usedCharacters / CONTEXT_CHARACTER_LIMIT)
  };
}
