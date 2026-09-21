/**
 * Deterministic verification fingerprints and the bounded capability
 * snapshot persisted with a model selection. The fingerprint binds readiness
 * to provider, credential revision, adapter version, model, route/protocol,
 * and capability-profile version; any constituent change invalidates the
 * selection until it is verified again.
 */
import { createHash } from "node:crypto";
import type { AiModelProtocol, AiProviderKind } from "@repo/core";

export type AiFingerprintInput = {
  providerKind: AiProviderKind;
  credentialRevision: number;
  adapterVersion: number;
  modelId: string;
  protocol: AiModelProtocol;
  routeOrigin: string;
  profileId: string;
  profileVersion: number;
};

export type AiCapabilitySnapshot = {
  contextWindowTokens: number | null;
  fingerprintInput: AiFingerprintInput;
};

/** Canonical SHA-256 hex fingerprint over the sorted JSON of the input. */
export function computeVerificationFingerprint(
  input: AiFingerprintInput,
): string {
  const canonical = JSON.stringify(input, Object.keys(input).sort());
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function buildCapabilitySnapshot(input: {
  contextWindowTokens: number | null;
  fingerprintInput: AiFingerprintInput;
}): AiCapabilitySnapshot {
  return {
    contextWindowTokens: input.contextWindowTokens,
    fingerprintInput: input.fingerprintInput,
  };
}

/** Parses stored snapshot JSON; returns null when the shape is not current. */
export function parseCapabilitySnapshot(
  raw: unknown,
): AiCapabilitySnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const contextWindowTokens =
    typeof source.contextWindowTokens === "number" &&
    Number.isFinite(source.contextWindowTokens)
      ? source.contextWindowTokens
      : null;
  const fingerprintInput = parseFingerprintInput(source.fingerprintInput);
  if (!fingerprintInput) return null;
  return { contextWindowTokens, fingerprintInput };
}

function parseFingerprintInput(raw: unknown): AiFingerprintInput | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  if (
    typeof source.providerKind !== "string" ||
    typeof source.credentialRevision !== "number" ||
    typeof source.adapterVersion !== "number" ||
    typeof source.modelId !== "string" ||
    typeof source.protocol !== "string" ||
    typeof source.routeOrigin !== "string" ||
    typeof source.profileId !== "string" ||
    typeof source.profileVersion !== "number"
  ) {
    return null;
  }
  return {
    providerKind: source.providerKind as AiProviderKind,
    credentialRevision: source.credentialRevision,
    adapterVersion: source.adapterVersion,
    modelId: source.modelId,
    protocol: source.protocol as AiModelProtocol,
    routeOrigin: source.routeOrigin,
    profileId: source.profileId,
    profileVersion: source.profileVersion,
  };
}
