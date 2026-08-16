import { describe, expect, it } from "vitest";
import {
  MAX_CHAT_ATTACHMENTS,
  normalizeChatAttachments,
} from "@/lib/chat-attachments";

describe("chat attachment normalization", () => {
  it("sanitizes persisted attachment metadata and drops unusable entries", () => {
    const fallbackCreatedAt = "2026-01-01T00:00:00.000Z";
    const attachments = normalizeChatAttachments(
      [
        {
          id: "  attachment-1  ",
          name: "  Research notes.pdf  ",
          mimeType: "  application/pdf  ",
          size: 42.9,
          createdAt: "2026-01-02T00:00:00.000Z",
          documentId: "  document-1  ",
          documentStatus: "indexed",
          errorMessage: "  Retry succeeded  ",
          errorRequestId: "  req-1  ",
        },
        {
          id: "attachment-course",
          name: "Deep Learning Foundations",
          mimeType: "application/x-branchmind-curriculum",
          size: 0,
          createdAt: "2026-01-02T00:00:00.000Z",
          curriculumId: "  curriculum-1  ",
        },
        {
          name: "Generated fallback id.txt",
          size: -10,
          createdAt: "not-a-date",
          documentStatus: "unknown",
        },
        { id: "missing-name", name: "   " },
        "not an attachment",
      ],
      {
        createId: () => "generated-attachment-id",
        fallbackCreatedAt,
      },
    );

    expect(attachments).toEqual([
      {
        id: "attachment-1",
        name: "Research notes.pdf",
        mimeType: "application/pdf",
        size: 42,
        createdAt: "2026-01-02T00:00:00.000Z",
        documentId: "document-1",
        documentStatus: "indexed",
        errorMessage: "Retry succeeded",
        errorRequestId: "req-1",
      },
      {
        id: "attachment-course",
        name: "Deep Learning Foundations",
        mimeType: "application/x-branchmind-curriculum",
        size: 0,
        createdAt: "2026-01-02T00:00:00.000Z",
        curriculumId: "curriculum-1",
      },
      {
        id: "generated-attachment-id",
        name: "Generated fallback id.txt",
        mimeType: "",
        size: 0,
        createdAt: fallbackCreatedAt,
      },
    ]);
  });

  it("limits normalized attachments to the supported chat payload size", () => {
    const attachments = normalizeChatAttachments(
      Array.from({ length: MAX_CHAT_ATTACHMENTS + 2 }, (_, index) => ({
        id: `attachment-${index + 1}`,
        name: `Attachment ${index + 1}`,
        mimeType: "text/plain",
        size: index,
        createdAt: "2026-01-01T00:00:00.000Z",
      })),
    );

    expect(attachments).toHaveLength(MAX_CHAT_ATTACHMENTS);
    expect(attachments.at(-1)?.id).toBe(`attachment-${MAX_CHAT_ATTACHMENTS}`);
  });
});
