import type { UI } from "@/i18n";
import { z } from "zod";

function authMessages(t: Pick<UI, "auth">) {
  return t.auth;
}

export function createAuthEmailSchema(t: Pick<UI, "auth">) {
  const auth = authMessages(t);

  return z.object({
    email: z.email(auth.enterValidEmail),
  });
}

export function createAuthEmailWithOptionalNameSchema(t: Pick<UI, "auth">) {
  const auth = authMessages(t);

  return createAuthEmailSchema(t).extend({
    name: z.string().trim().max(128, auth.nameTooLong),
  });
}

export function createAuthSignupEmailSchema(t: Pick<UI, "auth">) {
  return createAuthEmailWithOptionalNameSchema(t).refine(
    (value) => value.name.trim().length > 0,
    {
      path: ["name"],
      message: authMessages(t).nameRequired,
    },
  );
}

export function createAuthOtpSchema(t: Pick<UI, "auth">) {
  return z.object({
    otp: z.string().regex(/^\d{6}$/, authMessages(t).enterVerificationCode),
  });
}
