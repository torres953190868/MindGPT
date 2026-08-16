// SSRF-safe web fetching for the research agent (spec §11.2).
// assertPublicHttpsUrl is the core URL-level defense (https only, no
// localhost/private/reserved IP literals, default port only) and
// assertPublicIpAddress applies the same rules to DNS-resolved addresses.
// HttpSafeWebFetcher (lib/research/http-safe-web-fetcher.ts) composes them
// with per-redirect re-validation, response size/MIME caps and timeouts.
// getSafeWebFetcher() selects the backend: WEB_FETCHER=mock gives the
// deterministic fake, anything else the real HTTP implementation.

import { HttpSafeWebFetcher } from "@/lib/research/http-safe-web-fetcher";
import { MockSafeWebFetcher } from "@/lib/research/mock-safe-web-fetcher";

export type SafeFetchedPage = {
  url: string;
  canonicalUrl: string;
  title?: string;
  content: string;
  fetchedAt: string;
  truncated: boolean;
  // Prompt-injection signal CATEGORY codes detected in the cleaned content
  // (never the matched text). Absent means clean; consumers use it to enforce
  // policy (e.g. quarantine) instead of relying on the security-event log.
  injectionSignals?: string[];
};

export interface SafeWebFetcher {
  readonly id: string;
  fetch(url: string): Promise<SafeFetchedPage>;
}

export class SafeWebFetchError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "SafeWebFetchError";
    this.code = code;
  }
}

// Non-public IPv4 ranges (RFC 6890 / OWASP SSRF guidance), stored as unsigned
// [network, mask] pairs. 169.254.0.0/16 covers the cloud metadata address
// 169.254.169.254.
const BLOCKED_IPV4_RANGES: Array<[number, number]> = [
  [0x00000000, 0xff000000], // 0.0.0.0/8 "this host"
  [0x0a000000, 0xff000000], // 10.0.0.0/8 private
  [0x64400000, 0xffc00000], // 100.64.0.0/10 carrier-grade NAT
  [0x7f000000, 0xff000000], // 127.0.0.0/8 loopback
  [0xa9fe0000, 0xffff0000], // 169.254.0.0/16 link-local + cloud metadata
  [0xac100000, 0xfff00000], // 172.16.0.0/12 private
  [0xc0000000, 0xffffff00], // 192.0.0.0/24 protocol assignments
  [0xc0000200, 0xffffff00], // 192.0.2.0/24 documentation (TEST-NET-1)
  [0xc0a80000, 0xffff0000], // 192.168.0.0/16 private
  [0xc6120000, 0xfffe0000], // 198.18.0.0/15 benchmarking
  [0xc6336400, 0xffffff00], // 198.51.100.0/24 documentation (TEST-NET-2)
  [0xcb007100, 0xffffff00], // 203.0.113.0/24 documentation (TEST-NET-3)
  [0xe0000000, 0xf0000000], // 224.0.0.0/4 multicast
  [0xf0000000, 0xf0000000], // 240.0.0.0/4 reserved (incl. 255.255.255.255)
];

// WHATWG URL parsing normalizes shorthand/hex/octal IPv4 literals (127.1,
// 0x7f000001, 2130706433) to dotted-quad form, so one parser covers them all.
function parseIpv4(hostname: string): number | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;

  let address = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    address = address * 256 + octet;
  }

  return address;
}

function isBlockedIpv4(address: number) {
  return BLOCKED_IPV4_RANGES.some(
    ([network, mask]) => (address & mask) >>> 0 === network,
  );
}

function parseIpv6Group(group: string): number[] | null {
  if (!group) return [];

  const parts = group.split(":");
  const last = parts[parts.length - 1];
  const hasEmbeddedIpv4 = last.includes(".");
  const hextetParts = hasEmbeddedIpv4 ? parts.slice(0, -1) : parts;
  const hextets: number[] = [];

  for (const part of hextetParts) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
    hextets.push(parseInt(part, 16));
  }

  if (hasEmbeddedIpv4) {
    const address = parseIpv4(last);
    if (address === null) return null;
    hextets.push(Math.floor(address / 0x10000), address % 0x10000);
  }

  return hextets;
}

// Expands an IPv6 literal (with or without brackets, "::" compression, or an
// embedded IPv4 tail) into eight 16-bit hextets. Returns null when the input
// is not an IPv6 literal.
function expandIpv6(hostname: string): number[] | null {
  const inner =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  if (!inner.includes(":")) return null;

  const halves = inner.split("::");
  if (halves.length > 2) return null;

  const left = parseIpv6Group(halves[0]);
  const right = halves.length === 2 ? parseIpv6Group(halves[1]) : [];
  if (left === null || right === null) return null;

  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }

  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;

  return [...left, ...Array(missing).fill(0), ...right];
}

function isBlockedIpv6(hextets: number[]) {
  const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets;

  // IPv4-mapped (::ffff:a.b.c.d) and deprecated IPv4-compatible (::a.b.c.d)
  // literals inherit the IPv4 rules.
  const ipv4Mapped =
    h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff;
  const ipv4Compatible =
    h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0 &&
    !(h6 === 0 && h7 <= 1);
  if (ipv4Mapped || ipv4Compatible) {
    return isBlockedIpv4(h6 * 0x10000 + h7);
  }

  if (hextets.every((hextet) => hextet === 0)) return true; // :: unspecified
  if (h7 === 1 && hextets.slice(0, 7).every((hextet) => hextet === 0)) {
    return true; // ::1 loopback
  }

  if ((h0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((h0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast

  return false;
}

function reject(url: string, reason: string): never {
  throw new SafeWebFetchError(`${reason}: ${url}`, "SSRF_URL_REJECTED");
}

// Validates that a URL is safe for server-side fetching: https only, default
// port only, and the host must not be localhost, a private/loopback/
// link-local/reserved IP literal, or a cloud metadata address. Returns the
// parsed URL on success.
export function assertPublicHttpsUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SafeWebFetchError(`Invalid URL: ${url}`, "SSRF_URL_INVALID");
  }

  if (parsed.protocol !== "https:") {
    reject(url, "Only https: URLs are allowed");
  }

  // URL normalizes an explicit ":443" away for https, so any remaining port
  // is non-default and rejected (spec §11.2 port restriction).
  if (parsed.port) {
    reject(url, "Only the default https port (443) is allowed");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    reject(url, "Localhost hostnames are not allowed");
  }

  const ipv4 = parseIpv4(hostname);
  if (ipv4 !== null && isBlockedIpv4(ipv4)) {
    reject(url, "Private or reserved IPv4 addresses are not allowed");
  }

  const ipv6 = expandIpv6(parsed.hostname.toLowerCase());
  if (ipv6 !== null && isBlockedIpv6(ipv6)) {
    reject(url, "Private or reserved IPv6 addresses are not allowed");
  }

  return parsed;
}

// Applies the same private/loopback/link-local/reserved rules to a single
// DNS-resolved address. The HTTP fetcher runs this on every address returned
// by DNS for every redirect hop, so a rebinding attempt that mixes a private
// record into otherwise-public answers is rejected outright.
export function assertPublicIpAddress(address: string, context: string): void {
  const fail = (reason: string): never => {
    throw new SafeWebFetchError(
      `${reason} (${address}): ${context}`,
      "WEB_FETCH_FORBIDDEN_HOST",
    );
  };

  const ipv4 = parseIpv4(address);
  if (ipv4 !== null) {
    if (isBlockedIpv4(ipv4)) fail("DNS resolved to a private or reserved IPv4 address");
    return;
  }

  const ipv6 = expandIpv6(address);
  if (ipv6 !== null) {
    if (isBlockedIpv6(ipv6)) fail("DNS resolved to a private or reserved IPv6 address");
    return;
  }

  fail("DNS returned an unparseable address");
}

// Backend selection (WEB_FETCHER): "mock" for deterministic tests/CI/E2E,
// otherwise the real SSRF-safe HTTP fetcher.
export function getSafeWebFetcher(): SafeWebFetcher {
  const fetcherId = (process.env.WEB_FETCHER ?? "").trim().toLowerCase();
  if (fetcherId === "mock") return new MockSafeWebFetcher();
  return new HttpSafeWebFetcher();
}
