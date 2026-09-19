import { describe, expect, it, vi } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import { AppError } from "../lib/app-error.js";
import { withOwnedServerWrite } from "./mcp-server-command.js";

type ServerRow = { id: string; userId: string; configRevision: number };

const SERVER: ServerRow = {
  id: "mcs_1",
  userId: "usr_1",
  configRevision: 4,
};

type MockOptions = {
  server?: ServerRow | null;
  failures?: unknown[];
};

function makeDb(options: MockOptions = {}) {
  const server = options.server === undefined ? SERVER : options.server;
  const failures = [...(options.failures ?? [])];
  let attempts = 0;
  const setCalls: Array<Record<string, unknown>> = [];
  const forCalls: string[] = [];

  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: (mode: string) => {
            forCalls.push(mode);
            return { limit: async () => (server ? [server] : []) };
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        setCalls.push(values);
        return {
          where: () => ({
            returning: async () => [{ configRevision: values.configRevision }],
          }),
        };
      },
    }),
  };

  const db = {
    transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => {
      attempts += 1;
      if (failures.length > 0) throw failures.shift();
      return fn(tx);
    }),
    get attempts() {
      return attempts;
    },
    setCalls,
    forCalls,
  };
  return db;
}

function asDb(db: ReturnType<typeof makeDb>) {
  return db as unknown as Parameters<typeof withOwnedServerWrite>[0];
}

function pgError(code: string): Error & { code: string } {
  const error = new Error(`pg ${code}`) as Error & { code: string };
  error.code = code;
  return error;
}

describe("withOwnedServerWrite", () => {
  it("rejects a server the user does not own", async () => {
    const db = makeDb({ server: null });
    const command = vi.fn();
    await expect(
      withOwnedServerWrite(
        asDb(db),
        { userId: "usr_1", serverId: "mcs_x", expectedRevision: 1 },
        command,
      ),
    ).rejects.toMatchObject({ appCode: APP_ERROR_CODES.MCP_SERVER_NOT_FOUND });
    expect(command).not.toHaveBeenCalled();
  });

  it("locks the owned server before running the command", async () => {
    const db = makeDb();
    let forCallsAtCommand: string[] = [];
    await withOwnedServerWrite(
      asDb(db),
      { userId: "usr_1", serverId: "mcs_1", expectedRevision: 4 },
      async (ctx) => {
        forCallsAtCommand = [...db.forCalls];
        expect(ctx.server.id).toBe("mcs_1");
        expect(ctx.revision).toBe(4);
        return "ok";
      },
    );
    expect(forCallsAtCommand).toEqual(["update"]);
  });

  it("commits once and increments the revision exactly once", async () => {
    const db = makeDb();
    const outcome = await withOwnedServerWrite(
      asDb(db),
      { userId: "usr_1", serverId: "mcs_1", expectedRevision: 4 },
      async () => "done",
    );
    expect(outcome).toEqual({
      result: "done",
      revision: 5,
      serverId: "mcs_1",
    });
    expect(db.setCalls).toHaveLength(1);
    expect(db.setCalls[0]).toMatchObject({ configRevision: 5 });
  });

  it("rejects a stale revision without running the command", async () => {
    const db = makeDb();
    const command = vi.fn();
    await expect(
      withOwnedServerWrite(
        asDb(db),
        { userId: "usr_1", serverId: "mcs_1", expectedRevision: 3 },
        command,
      ),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT,
      details: { serverId: "mcs_1", currentRevision: 4 },
    });
    expect(command).not.toHaveBeenCalled();
    expect(db.attempts).toBe(1);
  });

  it("requires a positive integer revision", async () => {
    const db = makeDb();
    await expect(
      withOwnedServerWrite(
        asDb(db),
        { userId: "usr_1", serverId: "mcs_1", expectedRevision: 0 },
        async () => "no",
      ),
    ).rejects.toMatchObject({ appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT });
    expect(db.attempts).toBe(0);
  });

  it("retries a fully rolled back transient failure and then commits", async () => {
    const db = makeDb({ failures: [pgError("40001"), pgError("40P01")] });
    const outcome = await withOwnedServerWrite(
      asDb(db),
      { userId: "usr_1", serverId: "mcs_1", expectedRevision: 4 },
      async () => "retried",
    );
    expect(outcome.result).toBe("retried");
    expect(outcome.revision).toBe(5);
    expect(db.attempts).toBe(3);
  });

  it("translates exhausted retries to a retryable transient failure", async () => {
    const db = makeDb({
      failures: [
        pgError("40001"),
        pgError("40001"),
        pgError("40001"),
        pgError("40001"),
      ],
    });
    await expect(
      withOwnedServerWrite(
        asDb(db),
        { userId: "usr_1", serverId: "mcs_1", expectedRevision: 4 },
        async () => "never",
      ),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.MCP_TRANSIENT_WRITE_FAILURE,
      details: { retryable: true, serverId: "mcs_1" },
    });
    expect(db.attempts).toBe(3);
  });

  it("translates a unique violation to a stable write conflict", async () => {
    const db = makeDb({ failures: [pgError("23505")] });
    await expect(
      withOwnedServerWrite(
        asDb(db),
        { userId: "usr_1", serverId: "mcs_1", expectedRevision: 4 },
        async () => "never",
      ),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT,
      details: { serverId: "mcs_1" },
    });
    expect(db.attempts).toBe(1);
  });

  it("does not retry validation failures", async () => {
    const db = makeDb();
    await expect(
      withOwnedServerWrite(
        asDb(db),
        { userId: "usr_1", serverId: "mcs_1", expectedRevision: 4 },
        async () => {
          throw new AppError({
            appCode: APP_ERROR_CODES.INVALID_INPUT,
            message: "bad input",
            status: 400,
          });
        },
      ),
    ).rejects.toMatchObject({ appCode: APP_ERROR_CODES.INVALID_INPUT });
    expect(db.attempts).toBe(1);
  });

  it("runs post-commit hooks after commit and swallows hook failures", async () => {
    const db = makeDb();
    const ran: string[] = [];
    const outcome = await withOwnedServerWrite(
      asDb(db),
      { userId: "usr_1", serverId: "mcs_1", expectedRevision: 4 },
      async (ctx) => {
        ctx.onCommit(() => {
          ran.push("telemetry");
        });
        ctx.onCommit(() => {
          throw new Error("cleanup failed");
        });
        return "ok";
      },
    );
    expect(outcome.revision).toBe(5);
    expect(ran).toEqual(["telemetry"]);
  });

  it("discards hooks when the command rolls back", async () => {
    const db = makeDb();
    const ran: string[] = [];
    await expect(
      withOwnedServerWrite(
        asDb(db),
        { userId: "usr_1", serverId: "mcs_1", expectedRevision: 4 },
        async (ctx) => {
          ctx.onCommit(() => {
            ran.push("never");
          });
          throw new AppError({
            appCode: APP_ERROR_CODES.MCP_COMPILE_INVALID,
            message: "invalid",
            status: 409,
          });
        },
      ),
    ).rejects.toMatchObject({ appCode: APP_ERROR_CODES.MCP_COMPILE_INVALID });
    expect(ran).toEqual([]);
  });
});
