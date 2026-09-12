/**
 * In-process OTP send throttle keyed by normalized email and client IP.
 * Best-effort for single-instance deployments; resets on process restart.
 */

const EMAIL_WINDOW_MS = 60_000;
const IP_WINDOW_MS = 60_000;
const IP_MAX_SENDS = 10;

type Bucket = { count: number; resetAt: number };

const emailBuckets = new Map<string, Bucket>();
const ipBuckets = new Map<string, Bucket>();

function touch(
  bucket: Map<string, Bucket>,
  key: string,
  windowMs: number,
  max: number,
) {
  const now = Date.now();
  const current = bucket.get(key);

  if (!current || current.resetAt <= now) {
    bucket.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (current.count >= max) {
    return false;
  }

  current.count += 1;
  return true;
}

export function assertOtpSendAllowed(
  email: string,
  ip: string | null,
): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  if (!touch(emailBuckets, normalizedEmail, EMAIL_WINDOW_MS, 1)) {
    return false;
  }

  if (ip) {
    if (!touch(ipBuckets, ip, IP_WINDOW_MS, IP_MAX_SENDS)) {
      // Roll back the email bucket so a blocked IP spray does not lock the email.
      emailBuckets.delete(normalizedEmail);
      return false;
    }
  }

  return true;
}

/** Test helper — clears in-process throttle state. */
export function resetOtpSendLimiter() {
  emailBuckets.clear();
  ipBuckets.clear();
}
