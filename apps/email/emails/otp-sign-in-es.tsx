import { getEmailCopy } from "../i18n/index.js";
import { OTPEmail } from "../templates/otp-email";

export default function OTPSignInEsPreview() {
  return (
    <OTPEmail
      otp="123456"
      type="sign-in"
      appName="Charro Stack"
      appUrl="https://example.com"
      copy={getEmailCopy("es").otp}
    />
  );
}
