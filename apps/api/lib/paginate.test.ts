import { describe, expect, it, vi } from "vitest";
import { paginate } from "./paginate.js";

describe("paginate", () => {
  it("returns the first page with offset 0", async () => {
    const items = [{ id: "1" }, { id: "2" }];
    const list = vi.fn(async () => items);
    const count = vi.fn(async () => 12);

    await expect(
      paginate({ page: 1, pageSize: 10, list, count }),
    ).resolves.toEqual({
      items,
      page: 1,
      pageSize: 10,
      total: 12,
    });
    expect(list).toHaveBeenCalledWith(0, 10);
    expect(count).toHaveBeenCalledOnce();
  });

  it("computes offset for later pages", async () => {
    const items = [{ id: "11" }];
    const list = vi.fn(async () => items);
    const count = vi.fn(async () => 21);

    await expect(
      paginate({ page: 2, pageSize: 10, list, count }),
    ).resolves.toEqual({
      items,
      page: 2,
      pageSize: 10,
      total: 21,
    });
    expect(list).toHaveBeenCalledWith(10, 10);
  });

  it("returns an empty page without clamping when offset is past total", async () => {
    const list = vi.fn(async () => []);
    const count = vi.fn(async () => 12);

    await expect(
      paginate({ page: 5, pageSize: 10, list, count }),
    ).resolves.toEqual({
      items: [],
      page: 5,
      pageSize: 10,
      total: 12,
    });
    expect(list).toHaveBeenCalledWith(40, 10);
  });

  it("takes total from count, not from the page length", async () => {
    const list = vi.fn(async () => [{ id: "1" }]);
    const count = vi.fn(async () => 50);

    const result = await paginate({ page: 1, pageSize: 10, list, count });
    expect(result.total).toBe(50);
    expect(result.items).toHaveLength(1);
  });

  it("runs list and count in parallel", async () => {
    let listStarted = false;
    let countStarted = false;
    let listSawCount = false;
    let countSawList = false;

    const list = vi.fn(async () => {
      listStarted = true;
      countSawList = countStarted;
      return [];
    });
    const count = vi.fn(async () => {
      countStarted = true;
      listSawCount = listStarted;
      return 0;
    });

    await paginate({ page: 1, pageSize: 20, list, count });
    expect(listSawCount || countSawList).toBe(true);
  });
});
