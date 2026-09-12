import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  paginationInputSchema,
} from "./pagination.js";

describe("paginationInputSchema", () => {
  it("defaults page and pageSize when omitted", () => {
    expect(paginationInputSchema.parse({})).toEqual({
      page: DEFAULT_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
    });
    expect(DEFAULT_PAGE).toBe(1);
    expect(DEFAULT_PAGE_SIZE).toBe(10);
  });

  it.each(PAGE_SIZE_OPTIONS)("accepts pageSize %s", (pageSize) => {
    expect(paginationInputSchema.parse({ page: 2, pageSize })).toEqual({
      page: 2,
      pageSize,
    });
  });

  it.each([15, 200, 0, 25])("rejects pageSize %s", (pageSize) => {
    expect(paginationInputSchema.safeParse({ pageSize }).success).toBe(false);
  });

  it("rejects page below 1", () => {
    expect(paginationInputSchema.safeParse({ page: 0 }).success).toBe(false);
  });
});
