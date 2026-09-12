export const enAuth = {
  auth: {
    // Page shells
    loginTitle: "Access your account.",
    loginDescription:
      "Log in to your dashboard to manage your account and resources.",
    signupTitle: "Create your account.",
    signupDescription: "Get started by setting up your profile in seconds.",

    // Auth form
    termsText: "By signing up, you agree to our",
    termsOfService: "Terms of Service",
    and: "and",
    privacyPolicy: "Privacy Policy",
    registrationClosed: "Registration closed",
    publicSignupUnavailable: "Public signup is unavailable",
    invitationRequired:
      "An invitation is currently required to create a new account.",
    invitationNote:
      "Ask an administrator for an invitation or log in with an existing account.",
    goToLogin: "Go to login",
    goToHomepage: "Go to homepage",
    emailCode: "Email code",
    alreadyHaveAccount: "Already have an account?",
    logIn: "Log in",
    dontHaveAccount: "Don't have an account?",
    signUp: "Sign up",
    signupClosedShort: "Public signup is currently closed.",
    fullNameLabel: "Name",
    emailLabel: "Email",
    enterNameAndEmail: "Enter your name and email.",
    enterEmail: "Enter your email.",
    fullNamePlaceholder: "Your full name",
    emailInputPlaceholder: "you@company.com",
    sendCode: "Send code",
    checkYourEmail: "Check your email",
    codeIfUsableSentTo: "If this email can be used, we sent a code to",
    backToEmail: "Back to email",

    // OTP
    otpLabel: "Verification code",
    enterCode: "Enter 6-digit code",
    verifyCode: "Verify code",
    resendCodeIn: "Resend code in",
    resendCodeSeconds: "s",
    resendCode: "Resend code",
    tooManyAttempts: "Too many failed attempts. Please request a new code.",
    codeExpired: "Code has expired. Please request a new one.",
    otpSoftHintLogin: "Don't have an account yet?",
    otpSoftHintSignup: "Already have an account?",
    otpVerifyFailedLogin:
      "Couldn't verify that code. Double-check it, or sign up if you don't have an account yet.",
    otpVerifyFailedSignup:
      "Couldn't verify that code. Double-check it, or log in if you already have an account.",
    invalidCode: "Invalid verification code",
    failedToVerify: "Failed to verify code",
    failedToSendOtp: "Failed to send OTP",
    failedToSendVerificationCode: "Failed to send verification code",

    // Auth form errors
    somethingWentWrong: "Something went wrong. Please try again.",

    // Validation
    enterValidEmail: "Enter a valid email address.",
    nameTooLong: "Name must be 128 characters or fewer.",
    nameRequired: "Name is required.",
    enterVerificationCode: "Enter the 6-digit verification code.",

    // Auth error boundary
    authRequired: "Authentication Required",
    signInToAccess: "Please sign in to access this page.",
    signIn: "Sign In",
    somethingWentWrongTitle: "Something went wrong",
  },

  verifyEmail: {
    shellTitle: "Verify your identity and continue.",
    shellDescription: "Confirm your email to continue to your account.",
    innerTitle: "Email verification",
    verifying: "Verifying your email...",
    invalidOrExpired: "This verification link is invalid or has expired.",
    missingInfo: "This verification link is missing required information.",
    success: "Your email address has been verified.",
    buttonVerifying: "Verifying...",
    buttonContinue: "Continue",
    buttonGoToLogin: "Go to login",
    backToLogin: "Back to login",
  },
} as const;
