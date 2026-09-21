/**
 * Gateway adapter for OpenCode Go. Routes are resolved per model from
 * registry metadata; see the shared gateway factory for discovery, route
 * resolution, and verification behavior.
 */
import { AI_PROVIDER_KINDS } from "@repo/core";
import { createOpencodeGatewayAdapter } from "./opencode-common.js";

export const opencodeGoAdapter = createOpencodeGatewayAdapter({
  kind: AI_PROVIDER_KINDS.OPENCODE_GO,
  origin: "https://opencode.ai",
  baseURL: "https://opencode.ai/zen/go/v1",
  providerName: "opencode_go",
  sessionHeader: true,
});
