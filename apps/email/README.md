# Email Templates

Transactional email templates built with React Email.

## Running

```bash
bun email:dev         # Start email preview server at http://localhost:3001
bun email:build       # Build email templates
bun email:export      # Export static email templates
```

See the [root README](../../README.md) for the full command reference.

## Templates

- **EmailVerification** — Email verification with verification link
- **OTPEmail** — One-time password codes for sign-in or email verification
- **PlatformInvitationEmail** — Platform invitation with signup link

## Usage

```typescript
import { EmailVerification, renderEmailToHtml } from "@repo/email";

const component = EmailVerification({
  userName: "John Doe",
  verificationUrl: "https://example.com/verify?token=abc123",
  appName: "My App",
  appUrl: "https://example.com",
});

const html = await renderEmailToHtml(component);
```
