import { getEmailCopy } from "../i18n/index.js";
import { EmailVerification } from "../templates/email-verification";

export default function EmailVerificationEsPreview() {
  return (
    <EmailVerification
      userName="Mar\u00eda"
      verificationUrl="https://example.com/verify?token=abc123"
      appName="Charro Stack"
      appUrl="https://example.com"
      copy={getEmailCopy("es").emailVerification}
    />
  );
}
