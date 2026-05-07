import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseJsonBody } from "@/lib/server/validation";

const payloadSchema = z.object({
  topic: z.string().trim().min(1).max(10),
});

function jsonRequest(body: string, headers: Record<string, string> = {}) {
  return new Request("https://branchmind.example/api/projects", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body,
  });
}

describe("JSON request validation", () => {
  it("rejects missing JSON content type", async () => {
    await expect(
      parseJsonBody(
        new Request("https://branchmind.example/api/projects", {
          method: "POST",
          body: JSON.stringify({ topic: "hello" }),
        }),
        payloadSchema,
      ),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_CONTENT_TYPE",
      status: 415,
    });
  });

  it("rejects invalid JSON, oversized bodies, and schema failures", async () => {
    await expect(parseJsonBody(jsonRequest("{"), payloadSchema)).rejects.toMatchObject({
      code: "INVALID_JSON",
      status: 400,
    });

    await expect(
      parseJsonBody(jsonRequest(JSON.stringify({ topic: "too large" })), payloadSchema, {
        maxBytes: 4,
      }),
    ).rejects.toMatchObject({
      code: "BODY_TOO_LARGE",
      status: 413,
    });

    await expect(
      parseJsonBody(jsonRequest(JSON.stringify({ topic: "x".repeat(11) })), payloadSchema),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
    });
  });
});
