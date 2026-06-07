import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const SPEC_RELATIVE_PATH = join('docs', 'openapi.yaml');

/** Resolve docs/openapi.yaml from project root (works in src/ and dist/src/ layouts). */
export function resolveOpenApiSpecPath(): string {
  let dir = dirname(fileURLToPath(import.meta.url));

  while (true) {
    const candidate = join(dir, SPEC_RELATIVE_PATH);
    if (existsSync(candidate)) return candidate;

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(`OpenAPI spec not found at ${SPEC_RELATIVE_PATH}`);
}

export function loadOpenApiSpec(): Record<string, unknown> {
  return parseYaml(readFileSync(resolveOpenApiSpecPath(), 'utf8')) as Record<string, unknown>;
}
