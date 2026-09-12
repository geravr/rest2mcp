import { Button, Heading, Section, Text } from "@react-email/components";
import type { EmailCopy } from "../i18n/index.js";
import { BaseTemplate, colors } from "../components/BaseTemplate";

interface PlatformInvitationEmailProps {
  inviteUrl: string;
  appName?: string;
  appUrl?: string;
  expiresInDays?: number;
  copy: EmailCopy["platformInvitation"];
}

function interpolate(
  template: string,
  values: Record<string, string | number>,
) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(values[key] ?? ""),
  );
}

export function PlatformInvitationEmail({
  inviteUrl,
  appName,
  appUrl,
  expiresInDays = 7,
  copy,
}: PlatformInvitationEmailProps) {
  const resolvedAppName = appName || "Charro Stack";
  const preview = interpolate(copy.preview, { appName: resolvedAppName });

  return (
    <BaseTemplate preview={preview} appName={resolvedAppName} appUrl={appUrl}>
      <Heading style={heading}>
        {interpolate(copy.heading, { appName: resolvedAppName })}
      </Heading>

      <Text style={paragraph}>{copy.greeting}</Text>

      <Text style={paragraph}>
        {interpolate(copy.intro, { appName: resolvedAppName })}
      </Text>

      <Section style={buttonContainer}>
        <Button href={inviteUrl} style={button}>
          {copy.button}
        </Button>
      </Section>

      <Text style={paragraph}>{copy.copyUrl}</Text>

      <Text style={linkText}>{inviteUrl}</Text>

      <Text style={paragraph}>
        {interpolate(copy.expires, { days: expiresInDays })}
      </Text>
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
