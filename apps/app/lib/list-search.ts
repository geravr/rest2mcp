import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  pageSizeSchema,
  type PageSize,
} from "@repo/core";
import { z } from "zod";

export const listPaginationSearchSchema = z.object({
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  pageSize: z.coerce.number().pipe(pageSizeSchema).optional().catch(undefined),
  q: z.string().optional().catch(undefined),
});

export function resolvePaginationSearch(search: {
  page?: number;
  pageSize?: PageSize;
  q?: string;
}): {
  page: number;
  pageSize: PageSize;
  q: string | undefined;
} {
  return {
    page: search.page ?? DEFAULT_PAGE,
    pageSize: search.pageSize ?? DEFAULT_PAGE_SIZE,
    q: search.q?.trim() || undefined,
  };
}

export function omitPaginationDefaults<
  T extends { page?: number; pageSize?: number; q?: string },
>(search: T): T {
  return {
    ...search,
    page: search.page && search.page !== DEFAULT_PAGE ? search.page : undefined,
    pageSize:
      search.pageSize && search.pageSize !== DEFAULT_PAGE_SIZE
        ? search.pageSize
        : undefined,
    q: search.q?.trim() ? search.q.trim() : undefined,
  };
}
