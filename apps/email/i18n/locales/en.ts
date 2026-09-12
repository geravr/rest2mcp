import type { Widened } from "../schema.js";

export const enEmailCopy = {
  otp: {
    signInPreview: "Your Sign In code: {otp}",
    emailVerificationPreview: "Your Email Verification code: {otp}",
    signInTitle: "Sign in with your code",
    emailVerificationTitle: "Your Email Verification code",
    signInDescription: "complete your sign in",
    emailVerificationDescription: "verify your email address",
    bodyIntro:
      "Use the verification code below to {description}. This code is short-lived and only works once.",
    codeLabel: "Verification code",
    codeHint: "Enter this code in the sign-in window to continue.",
    importantTitle: "Important",
    expiresIn: "This code expires in {minutes} minutes for security reasons.",
    ignore:
      "If you didn't request this code, you can safely ignore this email.",
    subjectSignIn: "Your Sign In code",
    subjectEmailVerification: "Your Email Verification code",
  },
  emailVerification: {
    preview: "Verify your email address for {appName}",
    heading: "Verify your email address",
    greeting: "Hi{userName}",
    intro:
      "Thanks for signing up! Please click the button below to verify your email address and complete your account setup.",
    button: "Verify Email Address",
    copyUrl: "Or copy and paste this URL into your browser:",
    expires:
      "This verification link will expire in 24 hours for security reasons.",
    ignore:
      "If you didn't create an account with us, you can safely ignore this email.",
    subject: "Verify your email address",
  },
  platformInvitation: {
    preview: "You're invited to join {appName}",
    heading: "You have been invited to join {appName}",
    greeting: "Hi,",
    intro:
      "A super admin invited you to create an account on {appName}. Use the button below to open the signup flow and finish your registration.",
    button: "Accept Invitation",
    copyUrl: "Or copy and paste this URL into your browser:",
    expires:
      "This invitation expires in {days} days. If you were not expecting this email, you can safely ignore it.",
    subject: "Your {appName} invitation",
  },
} as const;

export type EmailCopy = Widened<typeof enEmailCopy>;
