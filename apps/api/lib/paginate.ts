import type { PageSize, Paginated } from "@repo/core";

export async function paginate<T>({
  page,
  pageSize,
  list,
  count,
}: {
  page: number;
  pageSize: PageSize;
  list: (offset: number, limit: number) => Promise<T[]>;
  count: () => Promise<number>;
}): Promise<Paginated<T>> {
  const offset = (page - 1) * pageSize;
  const [items, total] = await Promise.all([list(offset, pageSize), count()]);

  return { items, page, pageSize, total };
}
