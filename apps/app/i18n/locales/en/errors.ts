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
        "A request binding has no matching server value or agent input.",
      [APP_ERROR_CODES.MCP_VARIABLE_NAME_CONFLICT]:
        "A variable with this name already exists on the server.",
      [APP_ERROR_CODES.MCP_PLAINTEXT_SECRET]:
        "Store secrets in a secret variable and reference it with {{name}} instead of pasting them literally.",
      [APP_ERROR_CODES.MCP_COMPILE_INVALID]:
        "This tool definition is invalid and cannot be enabled.",
      [APP_ERROR_CODES.MCP_TOOL_DISABLED]: "This tool is disabled.",
      [APP_ERROR_CODES.MCP_SERVER_PAUSED]:
        "This MCP server is paused and has no callable tools.",
      [APP_ERROR_CODES.MCP_RATE_LIMITED]:
        "Too many requests. Wait and try again.",
      [APP_ERROR_CODES.MCP_TIMEOUT]: "The upstream request timed out.",
      [APP_ERROR_CODES.MCP_REDIRECT_REJECTED]:
        "The upstream redirect was rejected by policy.",
      [APP_ERROR_CODES.MCP_PATH_ESCAPE]:
        "The request path would escape the configured base path.",
      [APP_ERROR_CODES.MCP_ORIGIN_INVALID]:
        "The Origin header is not allowed for this endpoint.",
      [APP_ERROR_CODES.MCP_REQUEST_TOO_LARGE]: "The request body is too large.",
      [APP_ERROR_CODES.MCP_SCOPE_DENIED]:
        "This platform token does not include the required scope.",
      [APP_ERROR_CODES.MCP_DESTRUCTIVE_CONFIRMATION_REQUIRED]:
        "Confirm the resource name to continue this destructive operation.",
      [APP_ERROR_CODES.MCP_VALUE_IN_USE]:
        "This server value is still referenced and cannot be deleted.",
      [APP_ERROR_CODES.MCP_AUTH_ACK_REQUIRED]:
        "Query authentication requires explicit acknowledgement of secret exposure.",
      [APP_ERROR_CODES.MCP_UPSTREAM_HTTP_ERROR]:
        "The upstream API returned an HTTP error.",
      [APP_ERROR_CODES.MCP_MUTATION_INDETERMINATE]:
        "The mutation may have completed, but the final upstream outcome is unknown.",
      [APP_ERROR_CODES.MCP_BINARY_UNSUPPORTED]:
        "Binary upstream responses are not returned as text.",
      [APP_ERROR_CODES.MCP_WRITE_CONFLICT]:
        "This server changed elsewhere. Reload the latest configuration and try again.",
      [APP_ERROR_CODES.MCP_TRANSIENT_WRITE_FAILURE]:
        "The change did not save because of a temporary database issue. It is safe to retry.",
      [APP_ERROR_CODES.MCP_PAT_SCOPE_INVALID]:
        "These token scopes are not valid together. Add the required dependency or remove the extra scope.",
      [APP_ERROR_CODES.MCP_STEP_UP_REQUIRED]:
        "This high-risk token needs a fresh email confirmation code.",
      [APP_ERROR_CODES.MCP_STEP_UP_EXPIRED]:
        "That confirmation code expired or was already used. Request a new one.",
      [APP_ERROR_CODES.MCP_PAT_LIMIT_REACHED]:
        "You reached the maximum number of active platform tokens.",
      [APP_ERROR_CODES.MCP_POLICY_CONFLICT]:
        "The requested token policy is not consistent. Review the scopes and resource mode.",
      [APP_ERROR_CODES.MCP_RESOURCE_DENIED]:
        "This token is not allowed to access that resource.",
      [APP_ERROR_CODES.MCP_POLICY_VERSION_UNSUPPORTED]:
        "This platform token uses an unsupported policy version and must be recreated.",

      [APP_ERROR_CODES.MCP_PUBLISH_NOT_READY]:
        "This draft has blocking issues and cannot be published yet.",
      [APP_ERROR_CODES.MCP_PUBLISH_STALE_DRAFT]:
        "The draft changed after you previewed. Review the latest changes and publish again.",
      [APP_ERROR_CODES.MCP_PUBLISH_STALE_REVISION]:
        "The published revision changed. Reload the server before publishing.",
      [APP_ERROR_CODES.MCP_PUBLISH_CANDIDATE_CHANGED]:
        "The draft changed since the preview. Re-run the publish preview.",
      [APP_ERROR_CODES.MCP_PUBLISH_WARNINGS_UNACKNOWLEDGED]:
        "Acknowledge the publication warnings before publishing.",
      [APP_ERROR_CODES.MCP_PUBLISH_NO_CHANGES]:
        "There are no publishable changes in this draft.",
      [APP_ERROR_CODES.MCP_PUBLISH_IDEMPOTENCY_CONFLICT]:
        "This publish request was already used for different content.",
      [APP_ERROR_CODES.MCP_PUBLISH_MISSING_SECRET]:
        "A published tool references a secret or value that no longer exists.",
      [APP_ERROR_CODES.MCP_REVISION_NOT_FOUND]: "Published revision not found.",
      [APP_ERROR_CODES.MCP_REVISION_NOT_RESTORABLE]:
        "This revision cannot be restored to the draft as-is.",
      [APP_ERROR_CODES.MCP_ACTIVE_SECRET_IN_USE]:
        "This secret is used by the active published revision and cannot be deleted.",

      [APP_ERROR_CODES.MCP_TOOL_GROUP_NOT_FOUND]:
        "That tool group does not exist on this server.",
      [APP_ERROR_CODES.MCP_TOOL_GROUP_NAME_CONFLICT]:
        "A group with that name already exists on this server.",
      [APP_ERROR_CODES.MCP_TOOL_GROUP_LIMIT_REACHED]:
        "This server has reached its tool group limit.",
      [APP_ERROR_CODES.MCP_TOOL_LIMIT_REACHED]:
        "This server has reached its tool limit.",

      [APP_ERROR_CODES.MCP_OPENAPI_INVALID]:
        "That file is not a valid OpenAPI JSON document.",
      [APP_ERROR_CODES.MCP_OPENAPI_VERSION_UNSUPPORTED]:
        "Only OpenAPI 3.0 and 3.1 JSON documents can be imported.",
      [APP_ERROR_CODES.MCP_OPENAPI_LIMIT_EXCEEDED]:
        "The document is too large or declares too many operations to import.",
      [APP_ERROR_CODES.MCP_OPENAPI_SOURCE_UNAVAILABLE]:
        "The document URL could not be retrieved safely from the public internet.",
      [APP_ERROR_CODES.MCP_OPENAPI_STALE_PREVIEW]:
        "The document changed since the preview. Preview it again before importing.",
      [APP_ERROR_CODES.MCP_OPENAPI_INVALID_SELECTION]:
        "Check the selected operations, names, and group before importing.",

      [APP_ERROR_CODES.AI_PROVIDER_UNSUPPORTED]:
        "That AI provider is not supported.",
      [APP_ERROR_CODES.AI_CONNECTION_NOT_FOUND]:
        "AI provider connection not found.",
      [APP_ERROR_CODES.AI_CONNECTION_REVISION_CONFLICT]:
        "This AI connection changed elsewhere. Reload and try again.",
      [APP_ERROR_CODES.AI_PROVIDER_CREDENTIAL_INVALID]:
        "The provider rejected this credential. Check the key and try again.",
      [APP_ERROR_CODES.AI_PROVIDER_REQUEST_REJECTED]:
        "The provider rejected the request. Check the provider setup and try again.",
      [APP_ERROR_CODES.AI_PROVIDER_TRANSIENT_FAILURE]:
        "The provider is temporarily unavailable. Try again shortly.",
      [APP_ERROR_CODES.AI_PROVIDER_TIMEOUT]:
        "The provider did not respond in time. Try again shortly.",
      [APP_ERROR_CODES.AI_PROVIDER_REDIRECT_BLOCKED]:
        "The provider redirected outside its approved endpoints.",
      [APP_ERROR_CODES.AI_PROVIDER_RESPONSE_TOO_LARGE]:
        "The provider response was too large to process.",
      [APP_ERROR_CODES.AI_DISCOVERY_UNAVAILABLE]:
        "The model catalog could not be refreshed right now. Try again shortly.",
      [APP_ERROR_CODES.AI_MODEL_NOT_SELECTABLE]:
        "This model is not selectable for the required capabilities.",
      [APP_ERROR_CODES.AI_MODEL_VERIFICATION_FAILED]:
        "This model did not pass the structured-output verification. No changes were saved.",
      [APP_ERROR_CODES.AI_FEATURE_NOT_READY]:
        "AI is not configured yet. Connect a provider and verify a model in AI Settings.",
      [APP_ERROR_CODES.AI_CREDENTIAL_UNAVAILABLE]:
        "AI credentials are temporarily unavailable. Contact support if this persists.",

      [APP_ERROR_CODES.ROUTE_NOT_FOUND]: "This API route does not exist.",
      [APP_ERROR_CODES.INTERNAL_ERROR]:
        "An unexpected error occurred. Please try again.",
    },
  },
} as const;
