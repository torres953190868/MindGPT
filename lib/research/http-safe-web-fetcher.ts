// Real SSRF-safe web fetcher for the research agent (spec §11.2, decision D7
// in docs/agent-refactor-impact.md). Defense in depth on every request:
//
//   1. URL policy via assertPublicHttpsUrl (https only, default port, no
//      localhost/private/reserved IP literals).
//   2. DNS resolution via node:dns/promises; EVERY resolved address must pass
//      assertPublicIpAddress, so a rebinding answer that mixes a private
//      record into public ones is rejected outright.
//   3. Redirects are followed manually (max 4): each Location is resolved
//      (relative Locations against the current URL) and re-runs the full
//      URL + DNS validation before the next request.
//   4. Content-Type whitelist (text/html, application/xhtml+xml); a missing
//      header counts as a refusal.
//   5. The response body is streamed with a hard byte cap (default 1 MB);
//      oversized pages are truncated and flagged, not rejected.
//   6. One AbortController enforces a total timeout (default 15s) across the
//      whole redirect chain.
//
// The returned page carries the FINAL url of the redirect chain; the
// extracted canonical URL is itself validated against the URL policy and
// falls back to the final url when it fails.
//
// HTML cleaning is hand-rolled (no new dependencies): drop
// script/style/noscript/iframe/svg/template blocks and comments, turn
// block-level tag boundaries into newlines, strip the remaining tags, decode
// common named + numeric entities, and collapse whitespace.
//
import { lookup } from "node:dns/promises";
import {
  assertPublicHttpsUrl,
  assertPublicIpAddress,
  SafeWebFetchError,
  type SafeFetchedPage,
  type SafeWebFetcher,
} from "@/lib/research/safe-web-fetcher";
import { logPromptInjectionSignals } from "@/lib/research/prompt-injection";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 4;
const DEFAULT_MAX_BODY_BYTES = 1_048_576; // 1 MB
const USER_AGENT = "BranchMind-Research/1.0";

const ALLOWED_MIME_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// Elements whose entire subtree is never page text.
const BLOCKED_ELEMENT_PATTERN =
  /<(script|style|noscript|iframe|svg|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const UNCLOSED_BLOCKED_ELEMENT_PATTERN =
  /<(script|style|noscript|iframe|svg|template)\b[^>]*>[\s\S]*$/i;
// Block-level boundaries become newlines before tags are stripped, so the
// text keeps a readable paragraph structure.
const BLOCK_BOUNDARY_PATTERN =
  /<\/?(p|div|section|article|header|footer|main|aside|nav|ul|ol|li|dl|dt|dd|table|thead|tbody|tr|td|th|h[1-6]|blockquote|pre|figure|figcaption|form|fieldset|hr|br)\b[^>]*\/?>/gi;
// A tag must start with a letter (or /, !, ?) right after "<", so literal
// text like "1 < 2" or "<3" survives the strip.
const TAG_PATTERN = /<[a-zA-Z/?!][^>]*>?/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, entity: string) => {
    if (entity.startsWith("#")) {
      const isHex = entity[1] === "x" || entity[1] === "X";
      const codePoint = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        return whole;
      }
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

function cleanHtmlToText(html: string): string {
  let text = html.replace(BLOCKED_ELEMENT_PATTERN, " ");
  text = text.replace(UNCLOSED_BLOCKED_ELEMENT_PATTERN, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<!--[\s\S]*$/g, " ");
  text = text.replace(BLOCK_BOUNDARY_PATTERN, "\n");
  text = text.replace(TAG_PATTERN, " ");
  text = decodeHtmlEntities(text);
  text = text.replace(/[ \t\f\v ]+/g, " ");
  text = text.replace(/ *\n */g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function extractTitle(html: string): string | undefined {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  if (!match) return undefined;
  const title = decodeHtmlEntities(match[1].replace(TAG_PATTERN, " "))
    .replace(/\s+/g, " ")
    .trim();
  return title || undefined;
}

function readAttribute(tag: string, name: string): string | null {
  const pattern = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const match = pattern.exec(tag);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

// Extracts the <link rel="canonical" href="..."> target, resolved against the
// page url. rel is matched token-wise so rel="canonical alternate" works.
function extractCanonicalHref(html: string): string | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = readAttribute(tag, "rel");
    if (!rel || !rel.toLowerCase().split(/\s+/).includes("canonical")) continue;
    const href = readAttribute(tag, "href");
    if (href?.trim()) return decodeHtmlEntities(href.trim());
  }
  return null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function mapNetworkError(error: unknown, timeoutMs: number): SafeWebFetchError {
  if (isAbortError(error)) {
    return new SafeWebFetchError(
      `Web fetch timed out after ${timeoutMs}ms.`,
      "WEB_FETCH_TIMEOUT",
    );
  }
  return new SafeWebFetchError(
    `Web fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    "WEB_FETCH_NETWORK_ERROR",
  );
}

// Every resolved record must be public (spec §11.2 DNS re-validation).
async function assertDnsResolvesPublicly(hostname: string, url: string): Promise<void> {
  // WHATWG keeps IPv6 literals bracketed in .hostname; dns.lookup wants them bare.
  const lookupHost = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(lookupHost, { all: true, verbatim: true });
  } catch (error) {
    throw new SafeWebFetchError(
      `DNS lookup failed for ${lookupHost}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "WEB_FETCH_DNS_FAILED",
    );
  }
  if (addresses.length === 0) {
    throw new SafeWebFetchError(
      `DNS lookup returned no addresses for ${lookupHost}.`,
      "WEB_FETCH_DNS_FAILED",
    );
  }
  for (const { address } of addresses) {
    assertPublicIpAddress(address, url);
  }
}

async function readBodyWithLimit(
  response: Response,
  maxBodyBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    return {
      text: new TextDecoder("utf-8").decode(bytes.subarray(0, maxBodyBytes)),
      truncated: bytes.byteLength > maxBodyBytes,
    };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    received += value.byteLength;
    if (received > maxBodyBytes) {
      truncated = true;
      chunks.push(value.subarray(0, value.byteLength - (received - maxBodyBytes)));
      try {
        await reader.cancel();
      } catch {
        // Cancelling a truncated stream is best-effort.
      }
      break;
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(Math.min(received, maxBodyBytes));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // A mid-codepoint cut decodes to U+FFFD at the boundary; acceptable for a
  // truncated page.
  return { text: new TextDecoder("utf-8").decode(merged), truncated };
}

export class HttpSafeWebFetcher implements SafeWebFetcher {
  readonly id = "http";

  private readonly timeoutMs: number;
  private readonly maxRedirects: number;
  private readonly maxBodyBytes: number;

  constructor(
    options: { timeoutMs?: number; maxRedirects?: number; maxBodyBytes?: number } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  }

  async fetch(url: string): Promise<SafeFetchedPage> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchWithRedirects(url, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchWithRedirects(url: string, signal: AbortSignal): Promise<SafeFetchedPage> {
    let current = assertPublicHttpsUrl(url).toString();
    let response: Response | null = null;

    for (let redirectCount = 0; ; redirectCount += 1) {
      const parsed = assertPublicHttpsUrl(current);
      await assertDnsResolvesPublicly(parsed.hostname, current);

      let hop: Response;
      try {
        hop = await fetch(current, {
          method: "GET",
          redirect: "manual",
          signal,
          headers: {
            accept: "text/html,application/xhtml+xml",
            "user-agent": USER_AGENT,
          },
        });
      } catch (error) {
        throw mapNetworkError(error, this.timeoutMs);
      }

      if (!REDIRECT_STATUSES.has(hop.status)) {
        response = hop;
        break;
      }

      const location = hop.headers.get("location");
      if (!location) {
        throw new SafeWebFetchError(
          `Redirect (HTTP ${hop.status}) without a Location header: ${current}`,
          "WEB_FETCH_HTTP_ERROR",
        );
      }
      if (redirectCount >= this.maxRedirects) {
        throw new SafeWebFetchError(
          `Too many redirects (>${this.maxRedirects}) fetching ${url}.`,
          "WEB_FETCH_TOO_MANY_REDIRECTS",
        );
      }

      let next: string;
      try {
        // Relative Locations resolve against the current URL (RFC 7231).
        next = new URL(location, current).toString();
      } catch {
        throw new SafeWebFetchError(
          `Invalid redirect Location "${location}": ${current}`,
          "WEB_FETCH_HTTP_ERROR",
        );
      }
      // Best-effort body discard before the next hop.
      try {
        await hop.body?.cancel();
      } catch {
        // Ignore.
      }
      current = next; // URL + DNS policy re-run at the top of the loop.
    }

    if (!response.ok) {
      throw new SafeWebFetchError(
        `HTTP ${response.status} while fetching ${current}.`,
        "WEB_FETCH_HTTP_ERROR",
      );
    }

    const contentType = response.headers.get("content-type");
    const mimeType = contentType?.split(";")[0]?.trim().toLowerCase();
    if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new SafeWebFetchError(
        `Unsupported Content-Type "${contentType ?? "(missing)"}": ${current}`,
        "WEB_FETCH_UNSUPPORTED_MIME",
      );
    }

    let body: { text: string; truncated: boolean };
    try {
      body = await readBodyWithLimit(response, this.maxBodyBytes);
    } catch (error) {
      throw mapNetworkError(error, this.timeoutMs);
    }

    let canonicalUrl = current;
    const canonicalHref = extractCanonicalHref(body.text);
    if (canonicalHref) {
      try {
        canonicalUrl = assertPublicHttpsUrl(
          new URL(canonicalHref, current).toString(),
        ).toString();
      } catch {
        // An untrusted canonical that fails the URL policy falls back to the
        // final fetch url.
        canonicalUrl = current;
      }
    }

    const cleanedContent = cleanHtmlToText(body.text);
    logPromptInjectionSignals(cleanedContent, canonicalUrl);

    return {
      url: current,
      canonicalUrl,
      title: extractTitle(body.text),
      content: cleanedContent,
      fetchedAt: new Date().toISOString(),
      truncated: body.truncated,
    };
  }
}
