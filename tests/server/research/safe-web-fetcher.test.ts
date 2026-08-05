import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpSafeWebFetcher } from "@/lib/research/http-safe-web-fetcher";
import { MockSafeWebFetcher } from "@/lib/research/mock-safe-web-fetcher";
import {
  assertPublicHttpsUrl,
  assertPublicIpAddress,
  getSafeWebFetcher,
  type SafeFetchedPage,
} from "@/lib/research/safe-web-fetcher";

function getThrown(url: string) {
  try {
    assertPublicHttpsUrl(url);
  } catch (error) {
    return error;
  }
  return null;
}

describe("assertPublicHttpsUrl", () => {
  it.each([
    "https://example.com/path?q=1#section",
    "https://sub.example.co.uk/",
    "https://93.184.216.34/docs",
    "https://[2606:4700:4700::1111]/",
    // Public addresses just outside the private 172.16.0.0/12 range.
    "https://172.15.0.1/",
    "https://172.32.0.1/",
  ])("allows public https URL %s", (url) => {
    expect(assertPublicHttpsUrl(url)).toBeInstanceOf(URL);
  });

  it.each([
    "http://example.com/",
    "file:///etc/passwd",
    "ftp://example.com/file",
    "ws://example.com/",
  ])("rejects non-https URL %s", (url) => {
    expect(getThrown(url)).toMatchObject({
      name: "SafeWebFetchError",
      code: "SSRF_URL_REJECTED",
    });
  });

  it("rejects malformed URLs", () => {
    expect(getThrown("not a url at all")).toMatchObject({
      name: "SafeWebFetchError",
      code: "SSRF_URL_INVALID",
    });
  });

  it.each([
    "https://localhost/",
    "https://localhost./",
    "https://api.localhost/",
    "https://127.0.0.1/",
    // Shorthand/decimal IPv4 literals normalize to 127.0.0.1.
    "https://127.1/",
    "https://2130706433/",
    "https://10.0.0.1/",
    "https://10.255.255.255/",
    "https://172.16.0.1/",
    "https://172.31.255.255/",
    "https://192.168.0.1/",
    "https://192.168.255.255/",
    // Link-local, including the cloud metadata address.
    "https://169.254.1.1/",
    "https://169.254.169.254/",
    "https://169.254.169.254/latest/meta-data",
    "https://0.0.0.0/",
    "https://100.64.0.1/",
    "https://255.255.255.255/",
  ])("rejects private or reserved IPv4 URL %s", (url) => {
    expect(getThrown(url)).toMatchObject({
      name: "SafeWebFetchError",
      code: "SSRF_URL_REJECTED",
    });
  });

  it.each([
    "https://[::1]/",
    "https://[::]/",
    "https://[fd12::1]/",
    "https://[fe80::1]/",
    "https://[ff02::1]/",
    // IPv4-mapped and IPv4-compatible IPv6 literals inherit the IPv4 rules.
    "https://[::ffff:127.0.0.1]/",
    "https://[::ffff:a9fe:a9fe]/",
    "https://[::a9fe:a9fe]/",
  ])("rejects private or reserved IPv6 URL %s", (url) => {
    expect(getThrown(url)).toMatchObject({
      name: "SafeWebFetchError",
      code: "SSRF_URL_REJECTED",
    });
  });
});

describe("MockSafeWebFetcher", () => {
  const fixturePage: SafeFetchedPage = {
    url: "https://example.com/report",
    canonicalUrl: "https://example.com/report",
    title: "Annual Report",
    content: "Fixture page content.",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    truncated: false,
  };

  it("returns fixture pages for known URLs", async () => {
    const fetcher = new MockSafeWebFetcher({
      "https://example.com/report": fixturePage,
    });

    await expect(
      fetcher.fetch("https://example.com/report"),
    ).resolves.toEqual(fixturePage);
  });

  it("generates deterministic pages for unknown URLs", async () => {
    const fetcher = new MockSafeWebFetcher();
    const first = await fetcher.fetch("https://example.com/unknown");
    const second = await fetcher.fetch("https://example.com/unknown");

    expect(first).toEqual(second);
    expect(first.content).toContain("https://example.com/unknown");
    expect(first.truncated).toBe(false);
  });

  it("still enforces the SSRF policy on fixture URLs", async () => {
    const fetcher = new MockSafeWebFetcher({
      "https://169.254.169.254/latest/meta-data": fixturePage,
    });

    await expect(
      fetcher.fetch("https://169.254.169.254/latest/meta-data"),
    ).rejects.toMatchObject({
      name: "SafeWebFetchError",
      code: "SSRF_URL_REJECTED",
    });
  });
});

describe("NotImplementedSafeWebFetcher removal (Phase 2b)", () => {
  it("rejects non-default ports at the URL policy level", () => {
    expect(getThrown("https://example.com:8443/")).toMatchObject({
      name: "SafeWebFetchError",
      code: "SSRF_URL_REJECTED",
    });
    // An explicit default port is normalized away by the URL parser.
    expect(assertPublicHttpsUrl("https://example.com:443/")).toBeInstanceOf(URL);
  });
});

describe("assertPublicIpAddress", () => {
  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])(
    "allows public address %s",
    (address) => {
      expect(() => assertPublicIpAddress(address, "https://example.com/")).not.toThrow();
    },
  );

  it.each([
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "127.0.0.1",
    "169.254.169.254",
    "0.0.0.0",
    "::1",
    "fd12::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("rejects private or reserved address %s", (address) => {
    try {
      assertPublicIpAddress(address, "https://example.com/");
      expect.unreachable("expected assertPublicIpAddress to throw");
    } catch (error) {
      expect(error).toMatchObject({
        name: "SafeWebFetchError",
        code: "WEB_FETCH_FORBIDDEN_HOST",
      });
    }
  });

  it("rejects unparseable addresses defensively", () => {
    expect(() => assertPublicIpAddress("not-an-ip", "https://example.com/")).toThrowError(
      /unparseable/,
    );
  });
});

describe("getSafeWebFetcher", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the HTTP fetcher by default and for WEB_FETCHER=http", () => {
    expect(getSafeWebFetcher()).toBeInstanceOf(HttpSafeWebFetcher);
    vi.stubEnv("WEB_FETCHER", "http");
    expect(getSafeWebFetcher()).toBeInstanceOf(HttpSafeWebFetcher);
  });

  it("returns the mock fetcher for WEB_FETCHER=mock", () => {
    vi.stubEnv("WEB_FETCHER", "mock");
    expect(getSafeWebFetcher()).toBeInstanceOf(MockSafeWebFetcher);
  });
});
