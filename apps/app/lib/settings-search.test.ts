import { describe, expect, it } from "vitest";
import { settingsSearchSchema, settingsTabValues } from "./settings-search";

describe("settingsSearchSchema", () => {
  it("accepts remaining settings tabs", () => {
    for (const tab of settingsTabValues) {
      expect(settingsSearchSchema.parse({ tab })).toEqual({ tab });
    }
  });

  it("rejects tab=workspace as an invalid settings tab", () => {
    expect(settingsSearchSchema.parse({ tab: "workspace" })).toEqual({
      tab: undefined,
    });
  });

  it("does not list workspace among valid settings tabs", () => {
    expect(settingsTabValues).not.toContain("workspace");
  });
});
