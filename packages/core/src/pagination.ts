import { z } from "zod";

export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE: PageSize = 10;

export const pageSizeSchema = z.union([
  z.literal(10),
  z.literal(20),
  z.literal(50),
]);

export const paginationInputSchema = z.object({
  page: z.number().int().min(1).default(DEFAULT_PAGE),
  pageSize: pageSizeSchema.default(DEFAULT_PAGE_SIZE),
});

export type PaginationInput = z.infer<typeof paginationInputSchema>;

export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: PageSize;
  total: number;
};
