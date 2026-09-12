import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { APP_ERROR_CODES, appError } from "./app-error.js";

const METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "metadata",
]);

function ipToLong(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

function inCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  const ipValue = ipToLong(ip);
  const baseValue = ipToLong(base);
  if (ipValue === null || baseValue === null || Number.isNaN(bits)) {
    return false;
  }
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipValue & mask) === (baseValue & mask);
}

function expandIpv6(ip: string): string | null {
  if (ip.includes(".")) {
    const [left, ipv4] = ip.split(/:(?=\d+\.\d+\.\d+\.\d+$)/);
    const ipv4Long = ipToLong(ipv4);
    if (ipv4Long === null) return null;
    const hi = ((ipv4Long >>> 16) & 0xffff).toString(16);
    const lo = (ipv4Long & 0xffff).toString(16);
    return expandIpv6(`${left}:${hi}:${lo}`);
  }

  const [head, tail] = ip.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (missing < 0) return null;
  const parts = [
    ...headParts,
    ...Array.from({ length: missing }, () => "0"),
    ...tailParts,
  ];
  if (parts.length !== 8) return null;
  return parts.map((part) => part.padStart(4, "0")).join(":");
}

function isBlockedIpv4(ip: string): boolean {
  return (
    inCidr(ip, "0.0.0.0/8") ||
    inCidr(ip, "10.0.0.0/8") ||
    inCidr(ip, "100.64.0.0/10") ||
    inCidr(ip, "127.0.0.0/8") ||
    inCidr(ip, "169.254.0.0/16") ||
    inCidr(ip, "172.16.0.0/12") ||
    inCidr(ip, "192.0.0.0/24") ||
    inCidr(ip, "192.168.0.0/16") ||
    inCidr(ip, "198.18.0.0/15") ||
    inCidr(ip, "224.0.0.0/4") ||
    inCidr(ip, "240.0.0.0/4") ||
    ip === "255.255.255.255"
  );
}

function isBlockedIpv6(ip: string): boolean {
  const expanded = expandIpv6(ip);
  if (!expanded) return true;
  if (expanded === "0000:0000:0000:0000:0000:0000:0000:0001") return true;
  if (expanded === "0000:0000:0000:0000:0000:0000:0000:0000") return true;
  if (expanded.startsWith("fe80:")) return true;
  if (expanded.startsWith("fc") || expanded.startsWith("fd")) return true;
  if (expanded.startsWith("ff")) return true;
  if (expanded.startsWith("2001:0db8")) return true;

  if (
    expanded.startsWith("0000:0000:0000:0000:0000:ffff:") ||
    expanded.startsWith("0000:0000:0000:0000:0000:0000:")
  ) {
    const groups = expanded.split(":");
    const ipv4 = [
      Number.parseInt(groups[6], 16) >> 8,
      Number.parseInt(groups[6], 16) & 0xff,
      Number.parseInt(groups[7], 16) >> 8,
      Number.parseInt(groups[7], 16) & 0xff,
    ].join(".");
    return isBlockedIpv4(ipv4);
  }

  return false;
}

export function isBlockedIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  return true;
}

function hostNotAllowed(): never {
  throw appError({
    appCode: APP_ERROR_CODES.MCP_HOST_NOT_ALLOWED,
    message: "The request target is not allowed.",
    status: 403,
  });
}

export function assertHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    hostNotAllowed();
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    hostNotAllowed();
  }
  if (url.username || url.password) {
    hostNotAllowed();
  }
  return url;
}

export function assertHostAllowed(url: URL, allowedHosts: string[]): void {
  const hostname = url.hostname.toLowerCase();
  const allowed = allowedHosts.map((host) => host.toLowerCase());
  if (!allowed.includes(hostname)) {
    hostNotAllowed();
  }
  if (METADATA_HOSTS.has(hostname) || hostname.endsWith(".internal")) {
    hostNotAllowed();
  }
  if (isIP(hostname) && isBlockedIpAddress(hostname)) {
    hostNotAllowed();
  }
}

export async function assertResolvedAddressesSafe(
  hostname: string,
): Promise<void> {
  if (isIP(hostname)) {
    if (isBlockedIpAddress(hostname)) {
      hostNotAllowed();
    }
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    hostNotAllowed();
  }

  if (addresses.length === 0) {
    hostNotAllowed();
  }

  for (const entry of addresses) {
    if (isBlockedIpAddress(entry.address)) {
      hostNotAllowed();
    }
  }
}

export function assertSameHostRedirect(from: URL, location: string): URL {
  const next = new URL(location, from);
  if (next.hostname.toLowerCase() !== from.hostname.toLowerCase()) {
    hostNotAllowed();
  }
  if (next.protocol !== "http:" && next.protocol !== "https:") {
    hostNotAllowed();
  }
  return next;
}

export async function assertUpstreamUrlSafe(
  rawUrl: string,
  allowedHosts: string[],
): Promise<URL> {
  const url = assertHttpUrl(rawUrl);
  assertHostAllowed(url, allowedHosts);
  await assertResolvedAddressesSafe(url.hostname);
  return url;
}
