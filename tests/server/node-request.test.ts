import { describe, expect, it } from "vitest";
import { MAX_CHAT_ATTACHMENTS } from "@/lib/chat-attachments";
import {
  appendNodeMessageSchema,
  chatSkillSchema,
  createNodeSchema,
  populateBlankNodeSchema,
  regenerateNodeSchema,
} from "@/lib/server/node-request";
import {
  MAX_CHAT_SKILL_INSTRUCTIONS_LENGTH,
  MAX_CHAT_SKILL_NAME_LENGTH,
} from "@/lib/chat-skills";

describe("chatSkillSchema", () => {
  it("accepts a valid bounded skill", () => {
    const result = chatSkillSchema.safeParse({
      id: "skill_valid",
      name: "Valid Skill",
      description: "A valid skill description",
      instructions: "Teach step by step.",
      version: "v1",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an empty instruction field", () => {
    const result = chatSkillSchema.safeParse({
      id: "skill_empty",
      name: "Empty Skill",
      description: "",
      instructions: "   ",
      version: "v1",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an oversized name", () => {
    const result = chatSkillSchema.safeParse({
      id: "skill_oversized",
      name: "a".repeat(MAX_CHAT_SKILL_NAME_LENGTH + 1),
      description: "",
      instructions: "Body.",
      version: "v1",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an oversized instructions field", () => {
    const result = chatSkillSchema.safeParse({
      id: "skill_oversized_instructions",
      name: "Oversized",
      description: "",
      instructions: "a".repeat(MAX_CHAT_SKILL_INSTRUCTIONS_LENGTH + 1),
      version: "v1",
    });

    expect(result.success).toBe(false);
  });
});

describe("createNodeSchema with skill", () => {
  it("accepts a valid node creation request with a skill", () => {
    const result = createNodeSchema.safeParse({
      parentId: "node_parent",
      mode: "continue",
      instruction: "Explain this.",
      skill: {
        id: "skill_node",
        name: "Node Skill",
        description: "",
        instructions: "Be concise.",
        version: "v1",
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts a node creation request without a skill", () => {
    const result = createNodeSchema.safeParse({
      parentId: "node_parent",
      mode: "branch",
      instruction: "Explain this.",
    });

    expect(result.success).toBe(true);
  });
});

describe("populateBlankNodeSchema with skill", () => {
  it("accepts a valid blank-node population request with a skill", () => {
    const result = populateBlankNodeSchema.safeParse({
      instruction: "Populate this.",
      skill: {
        id: "skill_populate",
        name: "Populate Skill",
        description: "",
        instructions: "Use examples.",
        version: "v1",
      },
    });

    expect(result.success).toBe(true);
  });
});

describe("regenerateNodeSchema with skill", () => {
  it("accepts a valid regeneration request with a skill", () => {
    const result = regenerateNodeSchema.safeParse({
      instruction: "Try again.",
      userMessageId: "msg_user",
      skill: {
        id: "skill_regenerate",
        name: "Regenerate Skill",
        description: "",
        instructions: "Be more detailed.",
        version: "v1",
      },
    });

    expect(result.success).toBe(true);
  });
});

describe("appendNodeMessageSchema", () => {
  it("accepts a minimal request, trims instruction, and defaults attachments to []", () => {
    const result = appendNodeMessageSchema.safeParse({
      instruction: "  Give a concrete example.  ",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        instruction: "Give a concrete example.",
        attachments: [],
      });
    }
  });

  it("accepts optional sourceText, attachments, expectedNodeUpdatedAt, modelSelection, and skill", () => {
    const result = appendNodeMessageSchema.safeParse({
      instruction: "Explain this selected sentence.",
      sourceText: "  Gradient descent updates parameters along the negative gradient.  ",
      attachments: [
        {
          id: "att_1",
          name: "lecture.pdf",
          mimeType: "application/pdf",
          size: 1024,
          createdAt: "2026-01-01T00:00:00.000Z",
          documentId: "doc_1",
          documentStatus: "indexed",
        },
      ],
      expectedNodeUpdatedAt: "2026-01-01T00:00:00.000Z",
      modelSelection: {
        providerId: "deepseek",
        model: "deepseek-chat",
      },
      skill: {
        id: "skill_followup",
        name: "Follow-up Skill",
        description: "Guides follow-ups",
        instructions: "Stay focused on the current node.",
        version: "v1",
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sourceText).toBe(
        "Gradient descent updates parameters along the negative gradient.",
      );
      expect(result.data.attachments).toHaveLength(1);
      expect(result.data.expectedNodeUpdatedAt).toBe("2026-01-01T00:00:00.000Z");
    }
  });

  it("rejects empty or oversized instruction and sourceText", () => {
    expect(appendNodeMessageSchema.safeParse({ instruction: "   " }).success).toBe(false);
    expect(
      appendNodeMessageSchema.safeParse({ instruction: "a".repeat(1_501) }).success,
    ).toBe(false);
    expect(
      appendNodeMessageSchema.safeParse({
        instruction: "Valid",
        sourceText: "s".repeat(4_001),
      }).success,
    ).toBe(false);
    expect(
      appendNodeMessageSchema.safeParse({
        instruction: "Valid",
        expectedNodeUpdatedAt: "   ",
      }).success,
    ).toBe(false);
  });

  it("rejects attachment lists exceeding MAX_CHAT_ATTACHMENTS", () => {
    const attachments = Array.from({ length: MAX_CHAT_ATTACHMENTS + 1 }, (_, i) => ({
      id: `att_${i}`,
      name: `file-${i}.pdf`,
      mimeType: "application/pdf",
      size: 10,
      createdAt: "2026-01-01T00:00:00.000Z",
    }));

    const result = appendNodeMessageSchema.safeParse({
      instruction: "Too many attachments",
      attachments,
    });

    expect(result.success).toBe(false);
  });
});
