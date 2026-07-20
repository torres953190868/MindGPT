import { describe, expect, it } from "vitest";
import {
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
