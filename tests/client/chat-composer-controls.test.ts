import { describe, expect, it, vi } from "vitest";
import {
  formatFileSize,
  getAttachmentDetailLabel,
  getPendingAttachmentStatusLabel,
  isIndexingStatus,
  isKnowledgeAttachment,
  isPdfAttachment,
  replacePendingAttachment,
  shouldEnqueueIndex,
  toSendableAttachment,
} from "@/components/chat/composer-controls/attachment-helpers";
import {
  computeFloatingSubmenuPosition,
  getMenuPlacementClass,
} from "@/components/chat/composer-controls/floating-menu";
import {
  AUTO_STORAGE_SELECTION,
  cacheModelCatalog,
  formatModelLabel,
  isAutoModelSelection,
  isStoredModelSelection,
  matchesModelSelection,
  normalizeModelCatalog,
  readCachedModelCatalog,
  readStoredModelSelection,
  writeStoredModelSelection,
} from "@/components/chat/composer-controls/model-helpers";
import type { PendingChatAttachment } from "@/components/chat/ChatComposerControls";

describe("composer-controls attachment helpers", () => {
  it("formats file sizes cleanly across units", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(-12)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(12 * 1024 * 1024)).toBe("12 MB");
  });

  it("identifies knowledge PDFs and curricula and formats detail labels", () => {
    const knowledgePdf: PendingChatAttachment = {
      id: "att_1",
      name: "guide.pdf",
      mimeType: "application/pdf",
      size: 0,
      createdAt: "2026-05-01T00:00:00.000Z",
      documentId: "doc_1",
    };
    const curriculum: PendingChatAttachment = {
      id: "att_2",
      name: "Linear Algebra",
      mimeType: "application/x-branchmind-curriculum",
      size: 0,
      createdAt: "2026-05-01T00:00:00.000Z",
      curriculumId: "curr_1",
    };
    const uploadedFile: PendingChatAttachment = {
      id: "att_3",
      name: "notes.txt",
      mimeType: "text/plain",
      size: 2048,
      createdAt: "2026-05-01T00:00:00.000Z",
    };

    expect(isKnowledgeAttachment(knowledgePdf)).toBe(true);
    expect(isKnowledgeAttachment(curriculum)).toBe(true);
    expect(isKnowledgeAttachment(uploadedFile)).toBe(false);

    expect(getAttachmentDetailLabel(knowledgePdf)).toBe("Knowledge PDF");
    expect(
      getAttachmentDetailLabel(curriculum, {
        knowledgePdf: "Knowledge PDF",
        unknownType: "Unknown",
        knowledgeCurriculum: "Course material",
      }),
    ).toBe("Course material");
    expect(getAttachmentDetailLabel(uploadedFile)).toBe("text/plain - 2.0 KB");
  });

  it("resolves pending attachment status labels and PDF status helpers", () => {
    const labels = {
      failed: "Failed",
      indexed: "Indexed",
      ingesting: "Ingesting",
      uploading: "Uploading",
    };
    const base: PendingChatAttachment = {
      id: "att_1",
      name: "paper.pdf",
      mimeType: "application/pdf",
      size: 1024,
      createdAt: "2026-05-01T00:00:00.000Z",
    };

    expect(getPendingAttachmentStatusLabel({ ...base, uploadStatus: "uploading" }, labels)).toBe(
      "Uploading",
    );
    expect(getPendingAttachmentStatusLabel({ ...base, uploadStatus: "queued" }, labels)).toBe(
      "Ingesting",
    );
    expect(getPendingAttachmentStatusLabel({ ...base, uploadStatus: "indexing" }, labels)).toBe(
      "Ingesting",
    );
    expect(getPendingAttachmentStatusLabel({ ...base, uploadStatus: "indexed" }, labels)).toBe(
      "Indexed",
    );
    expect(getPendingAttachmentStatusLabel({ ...base, uploadStatus: "failed" }, labels)).toBe(
      "Failed",
    );
    expect(isPdfAttachment(base)).toBe(true);
    expect(isIndexingStatus("indexing")).toBe(true);
    expect(shouldEnqueueIndex("uploaded")).toBe(true);
    expect(shouldEnqueueIndex("indexed")).toBe(false);
  });

  it("strips local file/uploadStatus fields in toSendableAttachment and replaces by id", () => {
    const first: PendingChatAttachment = {
      id: "att_1",
      name: "doc.pdf",
      mimeType: "application/pdf",
      size: 100,
      createdAt: "2026-05-01T00:00:00.000Z",
      documentId: "doc_1",
      documentStatus: "indexed",
      uploadStatus: "indexed",
    };
    const sendable = toSendableAttachment(first);
    expect(sendable).toEqual({
      id: "att_1",
      name: "doc.pdf",
      mimeType: "application/pdf",
      size: 100,
      createdAt: "2026-05-01T00:00:00.000Z",
      documentId: "doc_1",
      documentStatus: "indexed",
    });

    const updated = { ...first, name: "renamed.pdf" };
    expect(replacePendingAttachment([first], updated)).toEqual([updated]);
  });
});

describe("composer-controls model & floating menu helpers", () => {
  it("formats model labels and normalizes model catalog", () => {
    expect(formatModelLabel("deepseek-v4-flash")).toBe("DeepSeek V4 Flash");
    expect(formatModelLabel("gemini-2.5-pro")).toBe("Gemini 2.5 Pro");

    expect(isStoredModelSelection({ providerId: "deepseek", model: "deepseek-v4-flash" })).toBe(
      true,
    );
    expect(isStoredModelSelection({ providerId: "", model: "x" })).toBe(false);
    expect(isAutoModelSelection(AUTO_STORAGE_SELECTION)).toBe(true);
    expect(
      matchesModelSelection(
        { providerId: "deepseek", model: "deepseek-v4-flash" },
        { providerId: "deepseek", model: "deepseek-v4-flash" },
      ),
    ).toBe(true);

    const catalog = normalizeModelCatalog({
      defaultSelection: { providerId: "deepseek", model: "deepseek-v4-flash" },
      providers: [
        {
          id: "deepseek",
          displayName: "DeepSeek",
          configured: true,
          models: ["deepseek-v4-flash", "deepseek-v4-pro"],
        },
      ],
    });
    expect(catalog).not.toBeNull();
    expect(catalog?.defaultSelection).toEqual({
      providerId: "deepseek",
      model: "deepseek-v4-flash",
    });
  });

  it("computes floating menu placement classes and submenu coordinates", () => {
    expect(getMenuPlacementClass("above", "start")).toBe(
      "absolute bottom-full left-0 z-50 mb-2",
    );
    expect(getMenuPlacementClass("below", "end")).toBe(
      "absolute right-0 top-full z-50 mt-2",
    );

    const pos = computeFloatingSubmenuPosition(
      { top: 300, left: 400, right: 500 },
      1280,
      800,
    );
    expect(pos.top).toBe(300);
    expect(pos.left).toBe(400 - 224 - 8);
  });
});

describe("composer-controls model persistence with blocked storage", () => {
  it("falls back without throwing when localStorage/sessionStorage access is denied", () => {
    // Safari with cookies disabled or a sandboxed iframe throws on property access.
    const blockedWindow = {};
    for (const key of ["localStorage", "sessionStorage"]) {
      Object.defineProperty(blockedWindow, key, {
        get() {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
      });
    }
    vi.stubGlobal("window", blockedWindow);

    try {
      expect(readStoredModelSelection()).toBeNull();
      expect(() => writeStoredModelSelection({ providerId: "deepseek", model: "deepseek-chat" })).not.toThrow();
      expect(readCachedModelCatalog()).toBeNull();
      expect(() => cacheModelCatalog({ providers: [] })).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
