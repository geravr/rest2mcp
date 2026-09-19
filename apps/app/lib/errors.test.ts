import { describe, expect, it } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import { getTranslations } from "@/i18n";
import {
  getAppCode,
  getErrorMessage,
  getErrorStatus,
  isUnauthenticatedError,
  resolveErrorMessage,
} from "./errors";

describe("getErrorStatus", () => {
  it("returns undefined for non-objects", () => {
    expect(getErrorStatus(null)).toBeUndefined();
    expect(getErrorStatus(undefined)).toBeUndefined();
    expect(getErrorStatus("string")).toBeUndefined();
    expect(getErrorStatus(123)).toBeUndefined();
  });

  it("extracts direct status property", () => {
    expect(getErrorStatus({ status: 401 })).toBe(401);
    expect(getErrorStatus({ status: 500 })).toBe(500);
  });

  it("ignores non-numeric status", () => {
    expect(getErrorStatus({ status: "401" })).toBeUndefined();
    expect(getErrorStatus({ status: null })).toBeUndefined();
  });

  it("extracts nested response.status (axios-style)", () => {
    expect(getErrorStatus({ response: { status: 403 } })).toBe(403);
  });

  it("follows error cause chain", () => {
    const nested = { status: 401 };
    const wrapper = { cause: nested };
    expect(getErrorStatus(wrapper)).toBe(401);
  });

  it("handles deep cause chains", () => {
    const deep = { cause: { cause: { cause: { status: 500 } } } };
    expect(getErrorStatus(deep)).toBe(500);
  });

  it("handles circular cause references without stack overflow", () => {
    const circular: Record<string, unknown> = { status: undefined };
    circular.cause = circular;
    expect(getErrorStatus(circular)).toBeUndefined();
  });

  it("prefers direct status over nested", () => {
    expect(getErrorStatus({ status: 401, response: { status: 500 } })).toBe(
      401,
    );
  });
});

describe("getErrorMessage", () => {
  it("extracts message from Error instances", () => {
    expect(getErrorMessage(new Error("Something broke"))).toBe(
      "Something broke",
    );
  });

  it("returns string errors directly", () => {
    expect(getErrorMessage("Direct error message")).toBe(
      "Direct error message",
    );
  });

  it("extracts statusText from Response-like objects", () => {
    expect(getErrorMessage({ statusText: "Not Found" })).toBe("Not Found");
  });

  it("returns fallback for unknown error shapes", () => {
    expect(getErrorMessage(null)).toBe("An unexpected error occurred");
    expect(getErrorMessage(undefined)).toBe("An unexpected error occurred");
    expect(getErrorMessage({})).toBe("An unexpected error occurred");
    expect(getErrorMessage({ statusText: "" })).toBe(
      "An unexpected error occurred",
    );
  });
});

describe("isUnauthenticatedError", () => {
  it("returns true for 401 status", () => {
    expect(isUnauthenticatedError({ status: 401 })).toBe(true);
  });

  it("returns false for 403 status (authorization, not authentication)", () => {
    expect(isUnauthenticatedError({ status: 403 })).toBe(false);
  });

  it("returns false for other status codes", () => {
    expect(isUnauthenticatedError({ status: 500 })).toBe(false);
    expect(isUnauthenticatedError({ status: 404 })).toBe(false);
  });

  it("returns false for non-error values", () => {
    expect(isUnauthenticatedError(null)).toBe(false);
    expect(isUnauthenticatedError("error")).toBe(false);
    expect(isUnauthenticatedError({})).toBe(false);
  });

  it("detects 401 in nested cause", () => {
    expect(isUnauthenticatedError({ cause: { status: 401 } })).toBe(true);
  });

  it("returns true for tRPC UNAUTHORIZED code", () => {
    expect(isUnauthenticatedError({ data: { code: "UNAUTHORIZED" } })).toBe(
      true,
    );
  });

  it("returns false for tRPC FORBIDDEN code", () => {
    expect(isUnauthenticatedError({ data: { code: "FORBIDDEN" } })).toBe(false);
  });
});

describe("resolveErrorMessage", () => {
  const t = getTranslations("en");

  it("maps tRPC appCode to localized copy", () => {
    expect(
      resolveErrorMessage(
        { data: { appCode: APP_ERROR_CODES.USER_NOT_FOUND } },
        t,
      ),
    ).toBe(t.errors.codes.USER_NOT_FOUND);
  });

  it("falls back to unexpected for unknown errors", () => {
    expect(resolveErrorMessage({}, t)).toBe(t.errors.unexpected);
  });

  it("maps Hono auth code responses", () => {
    expect(
      resolveErrorMessage({ code: APP_ERROR_CODES.INVALID_EMAIL }, t),
    ).toBe(t.errors.codes.INVALID_EMAIL);
  });

  it("does not treat a leftover { error } string as a catalog code", () => {
    expect(
      resolveErrorMessage({ error: APP_ERROR_CODES.USER_NOT_FOUND }, t),
    ).toBe(t.errors.unexpected);
  });

  it("preserves client-side localized Error messages", () => {
    expect(resolveErrorMessage(new Error("Tipo de archivo no válido"), t)).toBe(
      "Tipo de archivo no válido",
    );
  });

  it("returns Spanish copy when locale is es", () => {
    const es = getTranslations("es");
    expect(
      resolveErrorMessage(
        { data: { appCode: APP_ERROR_CODES.USER_NOT_FOUND } },
        es,
      ),
    ).toBe(es.errors.codes.USER_NOT_FOUND);
  });

  it("resolves MCP_TEMPLATE_UNRESOLVED without parsing a placeholder name", () => {
    expect(
      resolveErrorMessage(
        {
          data: {
            appCode: APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
            details: { placeholder: "limit" },
          },
        },
        t,
      ),
    ).toBe("A request binding has no matching server value or agent input.");
    expect(
      resolveErrorMessage(
        {
          shape: {
            data: {
              appCode: APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
            },
          },
        },
        t,
      ),
    ).toBe("A request binding has no matching server value or agent input.");
  });

  it("resolves MCP_TEMPLATE_UNRESOLVED in Spanish", () => {
    const es = getTranslations("es");
    expect(
      resolveErrorMessage(
        {
          data: {
            appCode: APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
          },
        },
        es,
      ),
    ).toBe(
      "Un enlace de la petición no tiene un valor de servidor ni una entrada de agente correspondiente.",
    );
  });

  it("detects MCP_WRITE_CONFLICT for centralized recovery", () => {
    expect(
      getAppCode({
        data: { appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT },
      }),
    ).toBe(APP_ERROR_CODES.MCP_WRITE_CONFLICT);
    expect(
      getAppCode({
        shape: { data: { appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT } },
      }),
    ).toBe(APP_ERROR_CODES.MCP_WRITE_CONFLICT);
  });

  it("renders localized conflict and transient copy in both locales", () => {
    const es = getTranslations("es");
    expect(
      resolveErrorMessage(
        { data: { appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT } },
        t,
      ),
    ).toBe(t.errors.codes.MCP_WRITE_CONFLICT);
    expect(
      resolveErrorMessage(
        { data: { appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT } },
        es,
      ),
    ).toBe(es.errors.codes.MCP_WRITE_CONFLICT);
    expect(
      resolveErrorMessage(
        { data: { appCode: APP_ERROR_CODES.MCP_TRANSIENT_WRITE_FAILURE } },
        t,
      ),
    ).toBe(t.errors.codes.MCP_TRANSIENT_WRITE_FAILURE);
  });
});
