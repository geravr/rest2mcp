import { describe, expect, it } from "vitest";
import {
  serverDetailSearchSchema,
  serverDetailTabValues,
} from "./servers-search";

describe("serverDetailSearchSchema", () => {
  it("accepts every server detail tab", () => {
    for (const tab of serverDetailTabValues) {
      expect(serverDetailSearchSchema.parse({ tab })).toEqual({ tab });
    }
  });

  it("orders tabs as work loop then setup", () => {
    expect(serverDetailTabValues).toEqual([
      "tools",
      "playground",
      "logs",
      "connection",
      "settings",
    ]);
  });

  it("rejects an unknown tab", () => {
    expect(serverDetailSearchSchema.parse({ tab: "workspace" })).toEqual({
      tab: undefined,
    });
  });
});
