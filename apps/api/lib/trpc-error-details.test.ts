import { APP_ERROR_CODES } from "@repo/core";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it } from "vitest";
import {
  appError,
  extractDetailsFromTrpcCause,
  toTrpcError,
} from "./app-error.js";
import { createCallerFactory, publicProcedure, router } from "./trpc.js";

const boomRouter = router({
  boom: publicProcedure.query(() => {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
      message:
        'Template placeholder "limit" has no matching argument or server variable.',
      status: 400,
      details: { placeholder: "limit" },
    });
  }),
});

const createCaller = createCallerFactory(boomRouter);

describe("tRPC error details", () => {
  it("forwards details.placeholder through toTrpcError cause for the formatter", () => {
    const error = toTrpcError(
      appError({
        appCode: APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
        message:
          'Template placeholder "limit" has no matching argument or server variable.',
        status: 400,
        details: { placeholder: "limit" },
      }),
    );

    expect(extractDetailsFromTrpcCause(error.cause)).toEqual({
      placeholder: "limit",
    });
  });

  it("exposes placeholder on procedure errors after AppError translation", async () => {
    const caller = createCaller({
      db: {},
      user: null,
      session: null,
    } as never);

    try {
      await caller.boom();
      expect.unreachable();
    } catch (error) {
      expect(
        extractDetailsFromTrpcCause((error as { cause?: unknown }).cause),
      ).toEqual({ placeholder: "limit" });
    }
  });

  it("includes details.placeholder in formatted HTTP error data", async () => {
    const response = await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: new Request("http://localhost/api/trpc/boom"),
      router: boomRouter,
      createContext: async () =>
        ({
          db: {},
          user: null,
          session: null,
        }) as never,
    });

    expect(response.ok).toBe(false);
    const body = (await response.json()) as {
      error?: {
        data?: {
          appCode?: string;
          details?: { placeholder?: string };
        };
      };
    };
    expect(body.error?.data?.appCode).toBe(
      APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
    );
    expect(body.error?.data?.details).toEqual({ placeholder: "limit" });
  });
});
