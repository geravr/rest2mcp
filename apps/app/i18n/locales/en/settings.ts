export const enSettings = {
  settings: {
    title: "Settings",
    description: "Manage your account, security, and privacy.",
    tabProfile: "Profile",
    tabSecurity: "Security",
    tabPrivacy: "Privacy & Cookies",

    profile: {
      title: "Profile",
      unavailableDescription: "Profile data is unavailable.",
      errorDescription: "Failed to load your profile.",
      photoLabel: "Profile photo",
      photoDescription: "Upload a JPG, PNG, or WebP image up to 5 MB.",
      uploadAvatar: "Upload Avatar",
      uploadingAvatar: "Uploading...",
      invalidAvatarType: "Upload a JPG, PNG, or WebP image.",
      avatarTooLarge: "Avatar images must be 5 MB or smaller.",
      nameLabel: "Name",
      namePlaceholder: "Enter your name",
      nameRequired: "Name is required",
      emailLabel: "Email address",
      emailSectionDescription:
        "Changes require approval from your current email before the new address is applied.",
      currentEmailLabel: "Current email: {email}",
      verifiedBadge: "Verified",
      unverifiedBadge: "Unverified",
      emailRequiredDifferent: "Enter a different email address to continue.",
      emailInvalid: "Enter a valid email address",
      emailChangeFailed: "Failed to request email change.",
      requestEmailChange: "Request Email Change",
      requestingEmailChange: "Requesting...",
      emailChangeNote:
        "Check your current email to approve this email change request.",
      saveChanges: "Save Changes",
      saving: "Saving...",
    },

    security: {
      title: "Security",
      errorDescription: "Failed to load security details.",
      verifiedEmail: "Verified email",
      verifiedEmailDescription: "Your primary email is verified.",
      unverifiedEmailDescription: "Your primary email is not verified yet.",
      sendVerificationTo: "Send a new verification link to {email}.",
      sendVerificationEmail: "Send verification email",
      sendingVerification: "Sending verification...",
      verificationEmailFailed: "Failed to send verification email.",
      verificationEmailSent: "Verification email sent.",
      revokeOtherSessionsButton: "Revoke Other Sessions",
      revokingButton: "Revoking...",
      sessionsLabel: "Active sessions",
      sessionActions: "Session actions",
      sessionActionsDescription:
        "Revoke individual sessions or sign out other devices.",
      sessionsLoadFailed: "Failed to load sessions.",
      noSessions: "No active sessions found.",
      unknownDevice: "Unknown device",
      sessionCreatedAt: "Created {date}",
      sessionCreatedRecently: "Created recently",
      sessionExpiresAt: "Expires {date}",
      sessionRevokeFailed: "Failed to revoke selected session.",
      sessionRevoked: "Session revoked.",
      revokeButton: "Revoke",
      revokeThisSession: "Revoke this session",
      revokeOtherSessionsFailed: "Failed to revoke other sessions.",
      otherSessionsRevoked: "Other sessions revoked.",
      currentSession: "Current session",
    },

    privacy: {
      title: "Privacy & Cookies",
      errorDescription: "Failed to load privacy and cookie settings.",
      unavailableDescription:
        "Privacy and cookie settings are currently unavailable.",
      consentStatus: "Cookie consent",
      allowed: "Allowed",
      disabled: "Disabled",
      pending: "Pending decision",
      consentDescriptionAllowed:
        "Diagnostics cookies and product telemetry are active under your preferences.",
      consentDescriptionDisabled:
        "The application will keep browser-side diagnostic cookies disabled.",
      consentDescriptionPending:
        "Choose whether we can use cookies to collect sanitized telemetry and diagnostics from this browser.",
      lastUpdated: "Last updated {date}",
      allowObservability: "Accept cookies",
      disableObservability: "Decline cookies",
      declineObservability: "Decline",
      goToSettings: "Customize",
      consentBannerTitle: "Cookie & Privacy Settings",
      consentBannerDescription:
        "We use cookies and tracking technologies to capture sanitized product analytics.",
      errorTracking: "Error tracking cookies",
      errorTrackingDescription:
        "Capture unexpected UI failures and high-severity handled errors. Validation and routine 4xx failures stay out.",
      sessionReplay: "Session replay cookies",
      sessionReplayDescription:
        "Record masked replays to debug production issues faster. Inputs are obscured, sensitive blocks are excluded, and request bodies are redacted.",
      browserKeyMissing:
        "This environment does not expose a browser PostHog key, so frontend telemetry is currently inactive even if you opt in.",
      privacyDefaults: "Cookie & privacy defaults",
      privacyDefaultsDescription:
        "Inputs and elements marked with sensitive selectors are masked. Embedded checkout frames and blocked regions are excluded from replay. Sensitive headers, emails, tokens, and request bodies are redacted before browser-side capture.",
    },
  },
} as const;
