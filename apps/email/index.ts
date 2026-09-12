export {
  getEmailCopy,
  type EmailCopy,
  type EmailLocale,
} from "./i18n/index.js";
export { EmailVerification } from "./templates/email-verification.js";
export { OTPEmail } from "./templates/otp-email.js";
export { PlatformInvitationEmail } from "./templates/platform-invitation.js";
export { renderEmailToHtml, renderEmailToText } from "./utils/render.js";
