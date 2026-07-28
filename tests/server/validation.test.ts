import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createProjectSchema,
  PROJECT_NOTES_MAX_LENGTH,
  updateProjectSchema,
} from "@/lib/server/project-request";
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

  it("rejects project notes that exceed the PATCH limit", () => {
    expect(updateProjectSchema.safeParse({ notes: "x".repeat(PROJECT_NOTES_MAX_LENGTH) }).success)
      .toBe(true);
    expect(
      updateProjectSchema.safeParse({ notes: "x".repeat(PROJECT_NOTES_MAX_LENGTH + 1) })
        .success,
    ).toBe(false);
  });

  it("validates project titles for PATCH requests", () => {
    expect(updateProjectSchema.parse({ title: "  Renamed workspace  " }).title).toBe(
      "Renamed workspace",
    );
    expect(updateProjectSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ title: "x".repeat(121) }).success).toBe(false);
  });

  it("accepts root project attachments and model selection", async () => {
    const body = await parseJsonBody(
      jsonRequest(
        JSON.stringify({
          topic: "  attached root  ",
          attachments: [
            {
              id: "attachment-root",
              name: "memory.pdf",
              mimeType: "application/pdf",
              size: 0,
              createdAt: "2026-01-01T00:00:00.000Z",
              documentId: "document-root",
              documentStatus: "indexed",
            },
          ],
          modelSelection: {
            providerId: "gemini",
            model: "gemini-3.5-flash",
          },
        }),
      ),
      createProjectSchema,
    );

    expect(body.topic).toBe("attached root");
    expect(body.attachments).toHaveLength(1);
    expect(body.modelSelection).toEqual({
      providerId: "gemini",
      model: "gemini-3.5-flash",
    });
  });

  it("rejects malformed root project attachments and model selections", async () => {
    await expect(
      parseJsonBody(
        jsonRequest(
          JSON.stringify({
            topic: "bad attachment",
            attachments: [{ id: "", name: "", mimeType: "", size: -1, createdAt: "nope" }],
          }),
        ),
        createProjectSchema,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
    });

    await expect(
      parseJsonBody(
        jsonRequest(
          JSON.stringify({
            topic: "bad model",
            modelSelection: { providerId: "", model: "" },
          }),
        ),
        createProjectSchema,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
    });
  });
});
