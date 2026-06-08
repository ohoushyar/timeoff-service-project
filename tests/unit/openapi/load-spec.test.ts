import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadOpenApiSpec, resolveOpenApiSpecPath } from '../../../src/openapi/load-spec.js';

describe('openapi/load-spec', () => {
  it('resolves the spec from project root, not dist/', () => {
    const specPath = resolveOpenApiSpecPath();
    expect(specPath).toBe(join(process.cwd(), 'docs', 'openapi.yaml'));
  });

  it('loads the OpenAPI document with implemented paths', () => {
    const spec = loadOpenApiSpec();
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info).toMatchObject({
      title: 'Time Off Service API',
      version: '0.1.0',
    });

    const paths = spec.paths as Record<string, unknown>;
    expect(Object.keys(paths)).toEqual(
      expect.arrayContaining([
        '/health/live',
        '/health/ready',
        '/api/v1/leave-requests',
        '/api/v1/sync/time-off',
        '/api/v1/sync-runs',
        '/api/v1/reports/leave-usage',
        '/api/v1/approvals/pending',
      ]),
    );
    expect(Object.keys(paths)).toHaveLength(20);

    const operationCount = Object.values(paths).reduce(
      (count, pathItem) =>
        count +
        ['get', 'post', 'put', 'patch', 'delete'].filter(
          (method) => (pathItem as Record<string, unknown>)[method] !== undefined,
        ).length,
      0,
    );
    expect(operationCount).toBe(21);
  });
});
