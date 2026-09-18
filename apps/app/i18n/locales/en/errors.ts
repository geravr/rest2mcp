import { APP_ERROR_CODES } from "@repo/core";

export const enErrors = {
  errors: {
    auth: {
      failedToLoadSession: "Failed to load session.",
    },
    notFound: {
      code: "404",
      message: "The page you\u2019re looking for doesn\u2019t exist.",
      goHome: "Go Home",
    },
    errorBoundary: {
      title: "Something went wrong",
      tryAgain: "Try Again",
    },
    unexpected: "An unexpected error occurred. Please try again.",
    codes: {
      [APP_ERROR_CODES.AUTHENTICATION_REQUIRED]: "Authentication required.",
      [APP_ERROR_CODES.ACCOUNT_SUSPENDED]:
        "Your account has been suspended. Contact an administrator.",
      [APP_ERROR_CODES.SUPER_ADMIN_REQUIRED]: "Super-admin access required.",
      [APP_ERROR_CODES.AUTH_UNAVAILABLE]:
        "Authentication service is unavailable. Try again later.",

      [APP_ERROR_CODES.INVALID_EMAIL]: "Enter a valid email address.",
      [APP_ERROR_CODES.INVALID_INPUT]: "Check your input and try again.",
      [APP_ERROR_CODES.OTP_SEND_RATE_LIMITED]:
        "Too many verification emails. Try again shortly.",
      [APP_ERROR_CODES.OTP_VERIFY_FAILED]:
        "Unable to complete verification with this email and code.",

      [APP_ERROR_CODES.REGISTRATION_DISABLED]:
        "Registration is currently closed. You need an invitation to sign up.",
      [APP_ERROR_CODES.INVITATION_EMAIL_MISMATCH]:
        "This invitation is for a different email address.",
      [APP_ERROR_CODES.NO_TOKEN_PROVIDED]: "No invitation token provided.",
      [APP_ERROR_CODES.INVALID_INVITATION]:
        "This invitation is invalid or has expired.",
      [APP_ERROR_CODES.INVITATION_NOT_FOUND]: "Invitation not found.",
      [APP_ERROR_CODES.INVITATION_ALREADY_EXISTS]:
        "A pending invitation already exists for this email.",
      [APP_ERROR_CODES.INVITATION_INVALID_STATUS]:
        "This invitation cannot be revoked in its current state.",
      [APP_ERROR_CODES.INVITATION_EMAIL_FAILED]:
        "Failed to send the invitation email.",

      [APP_ERROR_CODES.USER_NOT_FOUND]: "User not found.",
      [APP_ERROR_CODES.USER_ALREADY_EXISTS]:
        "A user with this email already exists.",
      [APP_ERROR_CODES.CANNOT_BAN_SELF]: "You cannot suspend yourself.",
      [APP_ERROR_CODES.CANNOT_BAN_SUPER_ADMIN]: "Cannot suspend a super-admin.",
      [APP_ERROR_CODES.USER_NOT_BANNED]: "User is not suspended.",

      [APP_ERROR_CODES.S3_NOT_CONFIGURED]: "File storage is not configured.",
      [APP_ERROR_CODES.FILE_UPLOAD_FAILED]: "Failed to upload file.",
      [APP_ERROR_CODES.FILE_REQUIRED]: "File is required.",
      [APP_ERROR_CODES.INVALID_DIRECTORY]:
        "Directory contains invalid characters.",
      [APP_ERROR_CODES.DIRECTORY_TOO_LONG]: "Directory is too long.",
      [APP_ERROR_CODES.FILE_EMPTY]: "File is empty.",
      [APP_ERROR_CODES.FILE_TOO_LARGE]: "File is too large.",
      [APP_ERROR_CODES.STORAGE_KEY_REQUIRED]: "Storage key is required.",
      [APP_ERROR_CODES.STORAGE_ACCESS_DENIED]:
        "You do not have access to this object.",

      [APP_ERROR_CODES.MCP_SERVER_NOT_FOUND]: "MCP server not found.",
      [APP_ERROR_CODES.MCP_TOOL_NOT_FOUND]: "MCP tool not found.",
      [APP_ERROR_CODES.MCP_HOST_NOT_ALLOWED]:
        "The request target is not on the allowed host list.",
      [APP_ERROR_CODES.MCP_MUTATION_NOT_ALLOWED]:
        "Mutating this tool is not allowed until you enable it.",
      [APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID]:
        "This agent token is invalid or revoked.",
      [APP_ERROR_CODES.MCP_UPSTREAM_ERROR]:
        "The upstream API returned an error.",
      [APP_ERROR_CODES.MCP_CURL_INVALID]:
        "That curl command could not be parsed.",
      [APP_ERROR_CODES.MCP_TOOL_NAME_CONFLICT]:
        "A tool with this name already exists on the server.",
      [APP_ERROR_CODES.MCP_SERVER_SLUG_CONFLICT]:
        "A server with this slug already exists on your account.",
      [APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED]:
        "Template placeholder {name} has no matching argument or variable.",
      [APP_ERROR_CODES.MCP_VARIABLE_NAME_CONFLICT]:
        "A variable with this name already exists on the server.",
      [APP_ERROR_CODES.MCP_PLAINTEXT_SECRET]:
        "Store secrets in a secret variable and reference it with {{name}} instead of pasting them literally.",

      [APP_ERROR_CODES.ROUTE_NOT_FOUND]: "This API route does not exist.",
      [APP_ERROR_CODES.INTERNAL_ERROR]:
        "An unexpected error occurred. Please try again.",
    },
  },
} as const;
