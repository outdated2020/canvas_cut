import { createHash } from 'node:crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function sortObjectDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectDeep);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortObjectDeep(record[key]);
    }
    return sorted;
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortObjectDeep(value));
}

export function canonicalJson(value: unknown): string {
  return stableJson(value);
}

export function canonicalHash(value: unknown): string {
  return sha256(canonicalJson(value));
}
