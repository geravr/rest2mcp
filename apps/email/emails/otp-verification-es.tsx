import { getEmailCopy } from "../i18n/index.js";
import { OTPEmail } from "../templates/otp-email";

export default function OTPVerificationEsPreview() {
  return (
    <OTPEmail
      otp="789012"
      type="email-verification"
      appName="Charro Stack"
      appUrl="https://example.com"
      copy={getEmailCopy("es").otp}
    />
  );
}
