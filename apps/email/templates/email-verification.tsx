import { Button, Heading, Section, Text } from "@react-email/components";
import type { EmailCopy } from "../i18n/index.js";
import { BaseTemplate, colors } from "../components/BaseTemplate";

interface EmailVerificationProps {
  userName?: string;
  verificationUrl: string;
  appName?: string;
  appUrl?: string;
  copy: EmailCopy["emailVerification"];
}

function interpolate(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

export function EmailVerification({
  userName,
  verificationUrl,
  appName,
  appUrl,
  copy,
}: EmailVerificationProps) {
  const resolvedAppName = appName || "Charro Stack";
  const preview = interpolate(copy.preview, { appName: resolvedAppName });
  const greeting = copy.greeting.replace(
    "{userName}",
    userName ? ` ${userName}` : "",
  );

  return (
    <BaseTemplate preview={preview} appName={resolvedAppName} appUrl={appUrl}>
      <Heading style={heading}>{copy.heading}</Heading>

      <Text style={paragraph}>{greeting},</Text>

      <Text style={paragraph}>{copy.intro}</Text>

      <Section style={buttonContainer}>
        <Button href={verificationUrl} style={button}>
          {copy.button}
        </Button>
      </Section>

      <Text style={paragraph}>{copy.copyUrl}</Text>

      <Text style={linkText}>{verificationUrl}</Text>

      <Text style={paragraph}>{copy.expires}</Text>

      <Text style={paragraph}>{copy.ignore}</Text>
    </BaseTemplate>
  );
}

const heading = {
  fontSize: "24px",
  fontWeight: "600",
  color: colors.text,
  margin: "0 0 24px",
};

const paragraph = {
  fontSize: "16px",
  lineHeight: "24px",
  color: colors.textMuted,
  margin: "0 0 16px",
};

const buttonContainer = {
  textAlign: "center" as const,
  margin: "32px 0",
};

const button = {
  backgroundColor: colors.primary,
  borderRadius: "6px",
  color: colors.primaryForeground,
  fontSize: "16px",
  fontWeight: "600",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "12px 24px",
  lineHeight: "20px",
};

const linkText = {
  fontSize: "14px",
  color: colors.textLight,
  wordBreak: "break-all" as const,
  margin: "0 0 16px",
  padding: "12px",
  backgroundColor: colors.surface,
  borderRadius: "4px",
  border: `1px solid ${colors.border}`,
};
