import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatRelativeTime } from "./relative-time";

describe("formatRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats seconds, minutes, hours, and days in English", () => {
    const now = Date.now();
    expect(formatRelativeTime(new Date(now - 10_000), "en")).toBe(
      "10 seconds ago",
    );
    expect(formatRelativeTime(new Date(now - 5 * 60_000), "en")).toBe(
      "5 minutes ago",
    );
    expect(formatRelativeTime(new Date(now - 3 * 3_600_000), "en")).toBe(
      "3 hours ago",
    );
    expect(formatRelativeTime(new Date(now - 2 * 86_400_000), "en")).toBe(
      "2 days ago",
    );
  });

  it("uses auto numeric phrasing for yesterday", () => {
    const now = Date.now();
    expect(formatRelativeTime(new Date(now - 86_400_000), "en")).toBe(
      "yesterday",
    );
  });

  it("formats weeks, months, and years", () => {
    const now = Date.now();
    expect(formatRelativeTime(new Date(now - 14 * 86_400_000), "en")).toBe(
      "2 weeks ago",
    );
    expect(formatRelativeTime(new Date(now - 90 * 86_400_000), "en")).toBe(
      "3 months ago",
    );
    expect(formatRelativeTime(new Date(now - 800 * 86_400_000), "en")).toBe(
      "2 years ago",
    );
  });

  it("localizes the output", () => {
    const now = Date.now();
    expect(formatRelativeTime(new Date(now - 5 * 60_000), "es")).toBe(
      "hace 5 minutos",
    );
  });
});
