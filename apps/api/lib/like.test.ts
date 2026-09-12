import { describe, expect, it } from "vitest";
import {
  escapeLikePattern,
  likeContainsPattern,
  normalizeSearchQuery,
} from "./like.js";

describe("escapeLikePattern", () => {
  it("escapes LIKE metacharacters", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    expect(escapeLikePattern("foo\\bar")).toBe("foo\\\\bar");
  });
});

describe("likeContainsPattern", () => {
  it("wraps the escaped value in wildcards", () => {
    expect(likeContainsPattern("100%")).toBe("%100\\%%");
  });
});

describe("normalizeSearchQuery", () => {
  it("trims and treats blank values as no search", () => {
    expect(normalizeSearchQuery("  ana  ")).toBe("ana");
    expect(normalizeSearchQuery("   ")).toBeUndefined();
    expect(normalizeSearchQuery("")).toBeUndefined();
    expect(normalizeSearchQuery(undefined)).toBeUndefined();
  });
});
