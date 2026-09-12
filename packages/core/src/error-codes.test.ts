import { describe, expect, it } from "vitest";
import {
  APP_ERROR_CODES,
  assertUniqueAppErrorCodes,
  isAppErrorCode,
} from "./error-codes.js";

describe("APP_ERROR_CODES", () => {
  it("has no duplicate values", () => {
    expect(() => assertUniqueAppErrorCodes()).not.toThrow();
  });

  it("recognizes known codes", () => {
    expect(isAppErrorCode(APP_ERROR_CODES.USER_NOT_FOUND)).toBe(true);
    expect(isAppErrorCode("NOT_A_REAL_CODE")).toBe(false);
  });

  it("covers every exported code constant", () => {
    for (const code of Object.values(APP_ERROR_CODES)) {
      expect(isAppErrorCode(code)).toBe(true);
    }
  });
});
