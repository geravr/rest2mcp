import { describe, expect, it } from "vitest";
import { getAvatarSrc } from "./avatar";

describe("getAvatarSrc", () => {
  it("returns the uploaded image when present", () => {
    const image = "https://cdn.example.com/avatar.png";

    expect(getAvatarSrc({ id: "user-1", image })).toBe(image);
  });

  it("returns a local data URI Lorelei Neutral fallback when image is missing", () => {
    const src = getAvatarSrc({ id: "user-2", image: null });

    expect(src.startsWith("data:image/svg+xml")).toBe(true);
    expect(src.includes("api.dicebear.com")).toBe(false);
  });

  it("is deterministic for the same user id", () => {
    const first = getAvatarSrc({ id: "user-3" });
    const second = getAvatarSrc({ id: "user-3", image: undefined });

    expect(first).toBe(second);
  });

  it("produces different fallbacks for different user ids", () => {
    const first = getAvatarSrc({ id: "user-a" });
    const second = getAvatarSrc({ id: "user-b" });

    expect(first).not.toBe(second);
  });
});
