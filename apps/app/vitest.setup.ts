import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Pin the detected locale so copy assertions don't depend on the runner.
// Guarded: some suites in this workspace run without a DOM.
if (typeof window !== "undefined" && window.navigator) {
  Object.defineProperty(window.navigator, "language", {
    value: "en",
    configurable: true,
  });
}

afterEach(cleanup);
