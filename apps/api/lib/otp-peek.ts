import { verification } from "@repo/db";
import { desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

const OTP_ALLOWED_ATTEMPTS = 3;

function splitAtLastColon(input: string): [string, string] {
  const idx = input.lastIndexOf(":");
  if (idx === -1) return [input, ""];
  return [input.slice(0, idx), input.slice(idx + 1)];
}

function signInOtpIdentifier(email: string) {
  return `sign-in-otp-${email.trim().toLowerCase()}`;
}

/**
 * Non-consuming check of a Better Auth sign-in OTP (plain storeOTP).
 * Matches Better Auth's newest-first lookup. Failed guesses increment attempts
 * so signup cannot bypass the 3-attempt cap that login gets via native verify.
 */
export async function isSignInOtpValid(
  db: DB,
  email: string,
  otp: string,
): Promise<boolean> {
  const identifier = signInOtpIdentifier(email);
  const [row] = await db
    .select({
      id: verification.id,
      value: verification.value,
      expiresAt: verification.expiresAt,
    })
    .from(verification)
    .where(eq(verification.identifier, identifier))
    .orderBy(desc(verification.createdAt))
    .limit(1);

  if (!row) return false;
  if (row.expiresAt < new Date()) {
    await db
      .delete(verification)
      .where(eq(verification.identifier, identifier));
    return false;
  }

  const [storedOtp, attemptsRaw] = splitAtLastColon(row.value);
  const attempts = Number.parseInt(attemptsRaw || "0", 10);
  if (attempts >= OTP_ALLOWED_ATTEMPTS) {
    await db
      .delete(verification)
      .where(eq(verification.identifier, identifier));
    return false;
  }

  if (storedOtp === otp) {
    return true;
  }

  await db
    .update(verification)
    .set({ value: `${storedOtp}:${attempts + 1}` })
    .where(eq(verification.id, row.id));

  return false;
}

/** Clears prior sign-in OTPs so resend keeps a single newest row. */
export async function clearSignInOtps(db: DB, email: string): Promise<void> {
  await db
    .delete(verification)
    .where(eq(verification.identifier, signInOtpIdentifier(email)));
}
