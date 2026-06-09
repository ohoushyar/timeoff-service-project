import { randomUUID } from 'node:crypto';

export function resolveCorrelationId(
  header: string | string[] | undefined,
): string {
  if (typeof header === 'string' && header.length > 0) {
    return header;
  }
  return randomUUID();
}
