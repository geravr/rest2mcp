import {
  EMAIL_LOGO_DATA_URI,
  EMAIL_LOGO_HEIGHT,
  EMAIL_LOGO_WIDTH,
} from "../assets/brand-logo";
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

interface BaseTemplateProps {
  preview: string;
  children: ReactNode;
  appName?: string;
  appUrl?: string;
}

// Color constants aligned with packages/ui zinc light tokens (email is light-only)
const colors = {
  primary: "#18181b",
  primaryForeground: "#fafafa",
  text: "#09090b",
  textMuted: "#71717a",
  textLight: "#a1a1aa",
  border: "#e4e4e7",
  background: "#fafafa",
  white: "#ffffff",
  surface: "#f4f4f5",
  destructive: "#ef4444",
  warning: "#fff7ed",
  warningBorder: "#fed7aa",
} as const;

export function BaseTemplate({
  preview,
  children,
  appName = "Charro Stack",
  appUrl = "https://example.com",
}: BaseTemplateProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Img
              src={EMAIL_LOGO_DATA_URI}
              alt={appName}
              width={EMAIL_LOGO_WIDTH}
              height={EMAIL_LOGO_HEIGHT}
              style={{
                display: "block",
                margin: "0 auto",
                borderRadius: "10px",
              }}
            />
          </Section>

          {/* Main Content */}
          <Section style={content}>{children}</Section>

          {/* Footer */}
          <Hr style={hr} />
          <Section style={footer}>
            <Text style={footerText}>
              This email was sent by {appName}. If you didn't expect this email,
              you can safely ignore it.
            </Text>
            {appUrl ? (
              <Text style={footerText}>
                <Link href={`${appUrl}/privacy`} style={footerLink}>
                  Privacy Policy
                </Link>
              </Text>
            ) : null}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: colors.background,
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: colors.white,
  margin: "24px auto",
  padding: "28px 0 40px",
  marginBottom: "64px",
  maxWidth: "600px",
  border: `1px solid ${colors.border}`,
  borderRadius: "16px",
};

const header = {
  padding: "0 48px",
  textAlign: "center" as const,
  borderBottom: `1px solid ${colors.border}`,
  paddingBottom: "24px",
  marginBottom: "32px",
};

const content = {
  padding: "0 48px",
};

const hr = {
  borderColor: colors.border,
  margin: "20px 0",
};

const footer = {
  padding: "0 48px",
};

const footerText = {
  color: colors.textLight,
  fontSize: "12px",
  lineHeight: "16px",
  textAlign: "center" as const,
  margin: "0 0 8px 0",
};

const footerLink = {
  color: colors.primary,
  textDecoration: "underline",
};

export { colors };
