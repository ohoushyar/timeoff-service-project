import { describe, it, expect } from 'vitest';
import { dimensionsHash, normalizeDimensions } from '../../../../src/lib/dimensions.js';
import { collectionDocument, buildPaginationLinks } from '../../../../src/serializers/jsonapi/document.js';

describe('dimensions', () => {
  it('hash is stable across key order', () => {
    const a = dimensionsHash({ locationId: 'US-NY', dept: 'Eng' });
    const b = dimensionsHash({ dept: 'Eng', locationId: 'US-NY' });
    expect(a).toBe(b);
  });

  it('normalizeDimensions sorts keys', () => {
    expect(Object.keys(normalizeDimensions({ b: 1, a: 2 }))).toEqual(['a', 'b']);
  });
});

describe('JSON:API document', () => {
  it('builds collection with pagination', () => {
    const doc = collectionDocument(
      'leave-types',
      [{ id: '1', attributes: { code: 'vacation' } }],
      { basePath: '/api/v1/leave-types', pageNumber: 1, pageSize: 25, totalCount: 50 },
    );
    expect(doc.data[0].type).toBe('leave-types');
    expect(doc.meta?.totalCount).toBe(50);
    expect(doc.links?.next).toContain('page[number]=2');
  });

  it('buildPaginationLinks includes prev on page 2', () => {
    const links = buildPaginationLinks('/items', 2, 25, 50);
    expect(links.prev).toBeDefined();
    expect(links.next).toBeUndefined();
  });
});
