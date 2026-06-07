export interface JsonApiResource<T extends string = string> {
  type: T;
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data: { type: string; id: string } | null }>;
}

export interface PaginationMeta {
  totalCount: number;
  pageNumber: number;
  pageSize: number;
}

export interface CollectionDocument<T extends string = string> {
  jsonapi: { version: '1.1' };
  data: JsonApiResource<T>[];
  links?: Record<string, string>;
  meta?: PaginationMeta & Record<string, unknown>;
}

export interface SingleDocument<T extends string = string> {
  jsonapi: { version: '1.1' };
  data: JsonApiResource<T>;
  meta?: Record<string, unknown>;
}

export function buildPaginationLinks(
  basePath: string,
  pageNumber: number,
  pageSize: number,
  totalCount: number,
): Record<string, string> {
  const links: Record<string, string> = {
    self: `${basePath}?page[number]=${pageNumber}&page[size]=${pageSize}`,
  };
  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  if (pageNumber < totalPages) {
    links.next = `${basePath}?page[number]=${pageNumber + 1}&page[size]=${pageSize}`;
  }
  if (pageNumber > 1) {
    links.prev = `${basePath}?page[number]=${pageNumber - 1}&page[size]=${pageSize}`;
  }
  return links;
}

export function collectionDocument<T extends string>(
  type: T,
  items: Array<{ id: string; attributes: Record<string, unknown>; relationships?: JsonApiResource['relationships'] }>,
  options: { basePath: string; pageNumber: number; pageSize: number; totalCount: number; meta?: Record<string, unknown> },
): CollectionDocument<T> {
  return {
    jsonapi: { version: '1.1' },
    data: items.map((item) => ({
      type,
      id: item.id,
      attributes: item.attributes,
      ...(item.relationships ? { relationships: item.relationships } : {}),
    })),
    links: buildPaginationLinks(options.basePath, options.pageNumber, options.pageSize, options.totalCount),
    meta: {
      totalCount: options.totalCount,
      pageNumber: options.pageNumber,
      pageSize: options.pageSize,
      ...options.meta,
    },
  };
}

export function singleDocument<T extends string>(
  type: T,
  id: string,
  attributes: Record<string, unknown>,
  relationships?: JsonApiResource['relationships'],
): SingleDocument<T> {
  return {
    jsonapi: { version: '1.1' },
    data: {
      type,
      id,
      attributes,
      ...(relationships ? { relationships } : {}),
    },
  };
}

export function omitNulls<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== null && v !== undefined),
  ) as Partial<T>;
}
