/**
 * @file Session-bound, single-use Platform step-up approvals.
 *
 * A high-risk PAT issuance must present a step-up grant created after a
 * successful email OTP verification. The grant is bound to the authenticated
 * session and to the exact canonical grant fingerprint it authorizes, and is
 * consumed atomically inside the lifecycle transaction.
 */
import { mcpPlatformStepUpGrant, verification } from "@repo/db";
import { randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { MCP_PLATFORM_STEP_UP_TTL_MS } from "@repo/core";
import { APP_ERROR_CODES, appError } from "../lib/app-error.js";
import { sendOTP } from "../lib/email.js";
import { assertOtpSendAllowed } from "../lib/otp-send-limiter.js";
import type { Env } from "../lib/env.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;
type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

const STEP_UP_CODE_TTL_MS = 5 * 60 * 1000;
const OTP_ALLOWED_ATTEMPTS = 3;
const OTP_LENGTH = 6;

function stepUpOtpIdentifier(userId: string): string {
  return `platform-stepup-otp-${userId}`;
}

function generateCode(): string {
  return randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, "0");
}

function splitAtLastColon(input: string): [string, string] {
  const idx = input.lastIndexOf(":");
  if (idx === -1) return [input, ""];
  return [input.slice(0, idx), input.slice(idx + 1)];
}

export async function requestPlatformStepUpOtp(
  db: DB,
  env: Env,
  input: {
    userId: string;
    email: string;
    ip: string | null;
    locale?: "en" | "es";
  },
): Promise<void> {
  if (!assertOtpSendAllowed(input.email, input.ip)) {
    throw appError({
      appCode: APP_ERROR_CODES.OTP_SEND_RATE_LIMITED,
      message: "Please wait before requesting another code.",
      status: 429,
    });
  }

  const identifier = stepUpOtpIdentifier(input.userId);
  const code = generateCode();
  const expiresAt = new Date(Date.now() + STEP_UP_CODE_TTL_MS);

  await db.transaction(async (tx) => {
    await tx
      .delete(verification)
      .where(eq(verification.identifier, identifier));
    await tx.insert(verification).values({
      identifier,
      value: `${code}:0`,
      expiresAt,
    });
  });

  await sendOTP(env, {
    email: input.email,
    otp: code,
    type: "sign-in",
    ...(input.locale ? { locale: input.locale } : {}),
  });
}

/**
 * Verifies and clears a step-up OTP. Returns false on mismatch or attempts
 * exhaustion; throws only for misconfiguration-free validation errors.
 */
export async function verifyPlatformStepUpOtp(
  db: DB,
  input: { userId: string; otp: string },
): Promise<boolean> {
  const identifier = stepUpOtpIdentifier(input.userId);
  // Lock the newest code row so concurrent guesses cannot race the attempt
  // counter and exceed the lockout budget.
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: verification.id,
        value: verification.value,
        expiresAt: verification.expiresAt,
      })
      .from(verification)
      .where(eq(verification.identifier, identifier))
      .orderBy(desc(verification.createdAt))
      .limit(1)
      .for("update");

    if (!row) return false;
    if (row.expiresAt < new Date()) {
      await tx
        .delete(verification)
        .where(eq(verification.identifier, identifier));
      return false;
    }

    const [storedCode, attemptsRaw] = splitAtLastColon(row.value);
    const attempts = Number.parseInt(attemptsRaw || "0", 10);
    if (attempts >= OTP_ALLOWED_ATTEMPTS) {
      await tx
        .delete(verification)
        .where(eq(verification.identifier, identifier));
      return false;
    }

    if (storedCode !== input.otp) {
      await tx
        .update(verification)
        .set({ value: `${storedCode}:${attempts + 1}` })
        .where(eq(verification.id, row.id));
      return false;
    }

    await tx
      .delete(verification)
      .where(eq(verification.identifier, identifier));
    return true;
  });
}

export async function createPlatformStepUpGrant(
  db: DB,
  input: { userId: string; sessionId: string; fingerprint: string },
): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + MCP_PLATFORM_STEP_UP_TTL_MS);
  const [row] = await db
    .insert(mcpPlatformStepUpGrant)
    .values({
      userId: input.userId,
      sessionId: input.sessionId,
      fingerprint: input.fingerprint,
      expiresAt,
    })
    .returning({ id: mcpPlatformStepUpGrant.id });
  return { id: row.id, expiresAt };
}

/**
 * Atomically consumes a matching unconsumed, unexpired step-up grant inside
 * the caller's transaction. Missing and expired/consumed grants surface as
 * distinct stable codes while never revealing another session's grant.
 */
export async function consumePlatformStepUpGrant(
  tx: Tx,
  input: { userId: string; sessionId: string; fingerprint: string },
): Promise<void> {
  const consumed = await tx
    .update(mcpPlatformStepUpGrant)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(mcpPlatformStepUpGrant.userId, input.userId),
        eq(mcpPlatformStepUpGrant.sessionId, input.sessionId),
        eq(mcpPlatformStepUpGrant.fingerprint, input.fingerprint),
        isNull(mcpPlatformStepUpGrant.consumedAt),
        gt(mcpPlatformStepUpGrant.expiresAt, new Date()),
      ),
    )
    .returning({ id: mcpPlatformStepUpGrant.id });

  if (consumed.length > 0) return;

  // Scope the probe to this session so another session's grant existence is
  // never revealed (a cross-session grant reports REQUIRED, like no grant).
  const [existing] = await tx
    .select({ id: mcpPlatformStepUpGrant.id })
    .from(mcpPlatformStepUpGrant)
    .where(
      and(
        eq(mcpPlatformStepUpGrant.userId, input.userId),
        eq(mcpPlatformStepUpGrant.sessionId, input.sessionId),
        eq(mcpPlatformStepUpGrant.fingerprint, input.fingerprint),
      ),
    )
    .limit(1);

  throw appError({
    appCode: existing
      ? APP_ERROR_CODES.MCP_STEP_UP_EXPIRED
      : APP_ERROR_CODES.MCP_STEP_UP_REQUIRED,
    message: existing
      ? "The step-up approval is no longer valid. Request a new code."
      : "A fresh step-up approval is required for this request.",
    status: 403,
  });
}

export async function cleanupExpiredPlatformStepUpGrants(
  db: DB,
): Promise<number> {
  const deleted = await db
    .delete(mcpPlatformStepUpGrant)
    .where(lt(mcpPlatformStepUpGrant.expiresAt, new Date()))
    .returning({ id: mcpPlatformStepUpGrant.id });
  return deleted.length;
}
