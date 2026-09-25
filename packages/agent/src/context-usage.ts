export const CONTEXT_CHARACTER_LIMIT = 200000;
export const CONTEXT_COMPACT_THRESHOLD = 120000;

export function contextUsage(messages: unknown[], options: { limit?: number; threshold?: number; overhead?: number; charactersPerToken?: number } = {}) {
  const usedCharacters = (messages.length ? JSON.stringify(messages).length : 0) + (options.overhead ?? 0);
  const limit = options.limit ?? CONTEXT_CHARACTER_LIMIT;
  return {
    usedCharacters,
    limitCharacters: limit,
    compactThreshold: options.threshold ?? Math.floor(limit * .6),
    estimatedTokens: Math.ceil(usedCharacters / (options.charactersPerToken ?? 4)),
    overheadCharacters: options.overhead ?? 0,
    ratio: Math.min(1, usedCharacters / limit)
  };
}
