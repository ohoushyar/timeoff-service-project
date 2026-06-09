export function parsePagination(query: Record<string, unknown>) {
  const page = query.page as Record<string, string> | undefined;
  const pageNumber = Math.max(1, Number(page?.number ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(page?.size ?? 25)));
  return { pageNumber, pageSize };
}
