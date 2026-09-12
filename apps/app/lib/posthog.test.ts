import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { shouldCaptureHandledPostHogError } from "./posthog";

describe("shouldCaptureHandledPostHogError", () => {
  it("captures handled 5xx errors by default", () => {
    expect(
      shouldCaptureHandledPostHogError({
        status: 500,
      }),
    ).toBe(true);
  });

  it("does not capture handled 4xx errors by default", () => {
    expect(
      shouldCaptureHandledPostHogError({
        status: 409,
      }),
    ).toBe(false);
  });

  it("can capture selected 4xx errors when explicitly requested", () => {
    expect(
      shouldCaptureHandledPostHogError(
        {
          status: 409,
        },
        { includeStatuses: [400, 404, 409, 412] },
      ),
    ).toBe(true);
  });
});

describe("identifyPostHogUser single-user surface", () => {
  it("does not attach organization group or active organization id", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "posthog.ts"),
      "utf8",
    );

    expect(source).not.toContain("active_organization_id");
    expect(source).not.toContain("activeOrganizationId");
    expect(source).not.toContain("organization.created");
  });

  it("does not identify users with an onboarding_completed property", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "posthog.ts"),
      "utf8",
    );

    expect(source).not.toContain("onboarding_completed");
    expect(source).not.toContain("onboardingCompletedAt");
  });
});
