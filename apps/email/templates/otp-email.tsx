import { Heading, Section, Text } from "@react-email/components";
import type { EmailCopy } from "../i18n/index.js";
import { BaseTemplate, colors } from "../components/BaseTemplate";

interface OTPEmailProps {
  otp: string;
  type: "sign-in" | "email-verification";
  appName?: string;
  appUrl?: string;
  expiresInMinutes?: number;
  copy: EmailCopy["otp"];
}

function interpolate(
  template: string,
  values: Record<string, string | number>,
) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(values[key] ?? ""),
  );
}

export function OTPEmail({
  otp,
  type,
  appName,
  appUrl,
  expiresInMinutes = 5,
  copy,
}: OTPEmailProps) {
  const typeDescription =
    type === "sign-in"
      ? copy.signInDescription
      : copy.emailVerificationDescription;
  const title =
    type === "sign-in" ? copy.signInTitle : copy.emailVerificationTitle;
  const previewTemplate =
    type === "sign-in" ? copy.signInPreview : copy.emailVerificationPreview;
  const preview = interpolate(previewTemplate, { otp });

  return (
    <BaseTemplate preview={preview} appName={appName} appUrl={appUrl}>
      <Heading style={heading}>{title}</Heading>

      <Text style={paragraph}>
        {interpolate(copy.bodyIntro, { description: typeDescription })}
      </Text>

      <Section style={otpContainer}>
        <Text style={otpLabel}>{copy.codeLabel}</Text>
        <Text style={otpText}>{otp}</Text>
        <Text style={otpHint}>{copy.codeHint}</Text>
      </Section>

      <Section style={metaCard}>
        <Text style={metaTitle}>{copy.importantTitle}</Text>
        <Text style={metaText}>
          {interpolate(copy.expiresIn, { minutes: expiresInMinutes })}
        </Text>
      </Section>

      <Text style={paragraph}>{copy.ignore}</Text>
    </BaseTemplate>
  );
}

const heading = {
  fontSize: "24px",
  lineHeight: "32px",
  fontWeight: "600",
  color: colors.text,
  margin: "0 0 16px",
};

const paragraph = {
  fontSize: "16px",
  lineHeight: "24px",
  color: colors.textMuted,
  margin: "0 0 18px",
};

const otpContainer = {
  textAlign: "center" as const,
  margin: "28px 0",
  padding: "28px 24px",
  backgroundColor: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: "16px",
};

const otpLabel = {
  fontSize: "12px",
  lineHeight: "16px",
  color: colors.textLight,
  margin: "0 0 12px",
};

const otpText = {
  fontSize: "40px",
  fontWeight: "bold",
  letterSpacing: "0.2em",
  color: colors.primary,
  fontFamily: "Monaco, Consolas, monospace",
  margin: "0 0 12px",
  textAlign: "center" as const,
};

const otpHint = {
  fontSize: "14px",
  lineHeight: "20px",
  color: colors.textLight,
  margin: "0",
};

const metaCard = {
  margin: "0 0 20px",
  padding: "16px 18px",
  backgroundColor: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: "12px",
};

const metaTitle = {
  fontSize: "13px",
  lineHeight: "18px",
  fontWeight: "700",
  color: colors.text,
  margin: "0 0 6px",
};

const metaText = {
  fontSize: "14px",
  lineHeight: "22px",
  color: colors.textMuted,
  margin: "0",
};
