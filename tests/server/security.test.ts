import type { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { validateRequestOrigin } from "@/lib/server/security";

function request(
  method: string,
  headers: Record<string, string> = {},
): NextRequest {
  return {
    method,
    url: "https://branchmind.example/api/projects",
    headers: new Headers(headers),
  } as unknown as NextRequest;
}

describe("request origin validation", () => {
  it("allows safe methods without an origin", () => {
    expect(validateRequestOrigin(request("GET"))).toMatchObject({
      allowed: true,
      source: "safe-method",
    });
  });

  it("allows same-origin mutation requests from Origin or Referer", () => {
    expect(
      validateRequestOrigin(request("POST", { Origin: "https://branchmind.example" })),
    ).toMatchObject({ allowed: true, source: "origin" });

    expect(
      validateRequestOrigin(
        request("PATCH", { Referer: "https://branchmind.example/projects" }),
      ),
    ).toMatchObject({ allowed: true, source: "referer" });
  });

  it("rejects missing or cross-site origins for mutations", () => {
    expect(validateRequestOrigin(request("DELETE"))).toMatchObject({
      allowed: false,
      code: "FORBIDDEN_ORIGIN",
      reason: "missing-origin",
      status: 403,
    });

    expect(
      validateRequestOrigin(request("POST", { Origin: "https://attacker.example" })),
    ).toMatchObject({
      allowed: false,
      code: "FORBIDDEN_ORIGIN",
      reason: "untrusted-origin",
      status: 403,
    });
  });
});
