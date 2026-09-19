import { describe, expect, it } from "vitest";
import { getServerIconSrc } from "./server-icon";

describe("getServerIconSrc", () => {
  it("returns the resolved asset URL when present", () => {
    const iconUrl =
      "http://localhost:5173/api/storage/object?key=users%2Fusr_1%2Ficon.png";

    expect(getServerIconSrc({ id: "mcs_1", iconUrl })).toBe(iconUrl);
  });

  it("returns a local rings data URI when no icon URL is present", () => {
    const src = getServerIconSrc({ id: "mcs_2", iconUrl: null });

    expect(src.startsWith("data:image/svg+xml")).toBe(true);
    expect(src.includes("api.dicebear.com")).toBe(false);
  });

  it("is deterministic for the same server id", () => {
    const first = getServerIconSrc({ id: "mcs_3" });
    const second = getServerIconSrc({ id: "mcs_3", iconUrl: undefined });

    expect(first).toBe(second);
  });

  it("produces different fallbacks for different server ids", () => {
    const first = getServerIconSrc({ id: "mcs-a" });
    const second = getServerIconSrc({ id: "mcs-b" });

    expect(first).not.toBe(second);
  });
});
