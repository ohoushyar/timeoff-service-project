import { createHash } from 'node:crypto';

export function normalizeDimensions(dimensions: Record<string, unknown>): Record<string, unknown> {
  const sorted = Object.keys(dimensions).sort();
  const normalized: Record<string, unknown> = {};
  for (const key of sorted) {
    normalized[key] = dimensions[key];
  }
  return normalized;
}

export function dimensionsHash(dimensions: Record<string, unknown>): string {
  const normalized = normalizeDimensions(dimensions);
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
