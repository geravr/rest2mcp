export type AuthStep = "email" | "otp";

const VALID_TRANSITIONS: Record<AuthStep, AuthStep[]> = {
  email: ["otp"],
  otp: ["email"],
};

export function canTransitionAuthStep(
  current: AuthStep,
  next: AuthStep,
): boolean {
  return VALID_TRANSITIONS[current].includes(next);
}

export function defaultAuthStep(initialStep?: AuthStep): AuthStep {
  return initialStep ?? "email";
}
