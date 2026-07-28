import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addStoredChatSkill,
  CHAT_SKILL_STORAGE_KEY,
  DEFAULT_PROGRESSIVE_LEARNING_SKILL_ID,
  findChatSkillById,
  getDefaultChatSkills,
  isDefaultChatSkill,
  MAX_CHAT_SKILL_DESCRIPTION_LENGTH,
  MAX_CHAT_SKILL_INSTRUCTIONS_LENGTH,
  MAX_CHAT_SKILL_NAME_LENGTH,
  parseSkillMarkdown,
  readAvailableChatSkills,
  readSkillFromFileList,
  readStoredChatSkills,
  removeStoredChatSkill,
  validateChatSkillForSend,
} from "@/lib/chat-skills";
import type { ChatSkill } from "@/lib/types";

function makeSkillFile(name: string, content: string): File {
  return new File([content], "SKILL.md", {
    type: "text/markdown",
    lastModified: Date.now(),
  });
}

function makeFileList(files: File[]): FileList {
  return {
    length: files.length,
    item: (index: number) => files[index] ?? null,
    [Symbol.iterator]: function* () {
      for (const file of files) yield file;
    },
  } as unknown as FileList;
}

function installStorage(storage: Map<string, string>) {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
}

describe("parseSkillMarkdown", () => {
  it("parses valid frontmatter and uses the Markdown body as instructions", () => {
    const result = parseSkillMarkdown(
      "FolderName",
      ["---", "name: My Skill", "description: A helpful skill", "---", "", "Teach step by step."].join(
        "\n",
      ),
    );

    expect(result.success).toBe(true);
    const skill = (result as { success: true; skill: ChatSkill }).skill;
    expect(skill.name).toBe("My Skill");
    expect(skill.description).toBe("A helpful skill");
    expect(skill.instructions).toBe("Teach step by step.");
    expect(skill.version).toMatch(/^[a-f0-9]{8}$/);
  });

  it("falls back to the folder name when frontmatter is absent", () => {
    const result = parseSkillMarkdown("FolderName", "Just the body.");

    expect(result.success).toBe(true);
    const skill = (result as { success: true; skill: ChatSkill }).skill;
    expect(skill.name).toBe("FolderName");
    expect(skill.description).toBe("");
    expect(skill.instructions).toBe("Just the body.");
  });

  it("rejects empty instructions", () => {
    const result = parseSkillMarkdown("FolderName", "   ");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("empty-instructions");
    }
  });

  it("rejects frontmatter-only content with no body", () => {
    const result = parseSkillMarkdown("FolderName", "---\nname: My Skill\n---\n");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("empty-instructions");
    }
  });

  it("rejects names that exceed the maximum length", () => {
    const longName = "a".repeat(MAX_CHAT_SKILL_NAME_LENGTH + 1);
    const result = parseSkillMarkdown("FolderName", `---\nname: ${longName}\n---\nBody.`);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("name-too-long");
    }
  });

  it("rejects descriptions that exceed the maximum length", () => {
    const longDescription = "a".repeat(MAX_CHAT_SKILL_DESCRIPTION_LENGTH + 1);
    const result = parseSkillMarkdown(
      "FolderName",
      `---\ndescription: ${longDescription}\n---\nBody.`,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("description-too-long");
    }
  });

  it("rejects instructions that exceed the maximum length", () => {
    const longInstructions = "a".repeat(MAX_CHAT_SKILL_INSTRUCTIONS_LENGTH + 1);
    const result = parseSkillMarkdown("FolderName", longInstructions);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("instructions-too-long");
    }
  });

  it("strips quoted wrappers from scalar values", () => {
    const result = parseSkillMarkdown(
      "FolderName",
      ['---', 'name: "Quoted Skill"', "description: 'Quoted description'", "---", "Body."].join("\n"),
    );

    expect(result.success).toBe(true);
    const skill = (result as { success: true; skill: ChatSkill }).skill;
    expect(skill.name).toBe("Quoted Skill");
    expect(skill.description).toBe("Quoted description");
  });
});

describe("readSkillFromFileList", () => {
  it("accepts a directory containing a root SKILL.md", async () => {
    const skillFile = makeSkillFile("SKILL.md", "# Instructions\n\nTeach step by step.");
    Object.defineProperty(skillFile, "webkitRelativePath", {
      value: "my-skill/SKILL.md",
      writable: false,
    });

    const result = await readSkillFromFileList(makeFileList([skillFile]));

    expect(result.success).toBe(true);
    const skill = (result as { success: true; skill: ChatSkill }).skill;
    expect(skill.name).toBe("my-skill");
    expect(skill.instructions).toContain("Teach step by step.");
  });

  it("rejects a selection without a root SKILL.md", async () => {
    const otherFile = makeSkillFile("README.md", "# Readme");
    Object.defineProperty(otherFile, "webkitRelativePath", {
      value: "my-skill/README.md",
      writable: false,
    });

    const result = await readSkillFromFileList(makeFileList([otherFile]));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("missing-skill-md");
    }
  });

  it("ignores nested SKILL.md files", async () => {
    const nestedSkill = makeSkillFile("SKILL.md", "Nested.");
    Object.defineProperty(nestedSkill, "webkitRelativePath", {
      value: "my-skill/nested/SKILL.md",
      writable: false,
    });

    const result = await readSkillFromFileList(makeFileList([nestedSkill]));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("missing-skill-md");
    }
  });
});

describe("stored chat skills", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists and retrieves skills in versioned localStorage", () => {
    const storage = new Map<string, string>();
    installStorage(storage);

    const skill: ChatSkill = {
      id: "skill_test",
      name: "Test Skill",
      description: "A test skill",
      instructions: "Teach step by step.",
      version: "abc12345",
    };

    addStoredChatSkill(skill);
    const skills = readStoredChatSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0]).toEqual(skill);
  });

  it("deduplicates skills with identical content", () => {
    const storage = new Map<string, string>();
    installStorage(storage);

    const skill: ChatSkill = {
      id: "skill_first",
      name: "Same",
      description: "Same",
      instructions: "Same.",
      version: "abc12345",
    };

    addStoredChatSkill(skill);
    addStoredChatSkill({ ...skill, id: "skill_second" });

    expect(readStoredChatSkills()).toHaveLength(1);
  });

  it("removes stored skills by id", () => {
    const storage = new Map<string, string>();
    installStorage(storage);

    const skill: ChatSkill = {
      id: "skill_remove",
      name: "Remove Me",
      description: "",
      instructions: "Body.",
      version: "abc12345",
    };

    addStoredChatSkill(skill);
    removeStoredChatSkill(skill.id);

    expect(readStoredChatSkills()).toHaveLength(0);
  });

  it("returns an empty array when localStorage is unavailable", () => {
    vi.stubGlobal("window", undefined);
    expect(readStoredChatSkills()).toEqual([]);
  });

  it("returns an empty array for invalid stored data", () => {
    const storage = new Map<string, string>();
    storage.set(CHAT_SKILL_STORAGE_KEY, "not-json");
    installStorage(storage);

    expect(readStoredChatSkills()).toEqual([]);
  });
});

describe("validateChatSkillForSend", () => {
  it("returns a valid skill", () => {
    const skill: ChatSkill = {
      id: "skill_valid",
      name: "Valid",
      description: "",
      instructions: "Body.",
      version: "abc12345",
    };

    expect(validateChatSkillForSend(skill)).toEqual(skill);
  });

  it("returns null for null input", () => {
    expect(validateChatSkillForSend(null)).toBeNull();
  });

  it("returns null when instructions are empty", () => {
    const skill: ChatSkill = {
      id: "skill_empty",
      name: "Empty",
      description: "",
      instructions: "   ",
      version: "abc12345",
    };

    expect(validateChatSkillForSend(skill)).toBeNull();
  });

  it("returns null when fields exceed limits", () => {
    const skill: ChatSkill = {
      id: "skill_oversized",
      name: "a".repeat(MAX_CHAT_SKILL_NAME_LENGTH + 1),
      description: "",
      instructions: "Body.",
      version: "abc12345",
    };

    expect(validateChatSkillForSend(skill)).toBeNull();
  });
});

describe("default chat skills", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes the bundled progressive-learning skill with a stable id", () => {
    const defaults = getDefaultChatSkills();

    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe(DEFAULT_PROGRESSIVE_LEARNING_SKILL_ID);
    expect(defaults[0]?.name).toBe("progressive-learning");
    expect(defaults[0]?.description).toContain("渐进式学习教练");
    expect(defaults[0]?.instructions).toContain("教学循环");
    expect(defaults[0]?.version).toMatch(/^[a-f0-9]{8}$/);
  });

  it("identifies the default skill id", () => {
    expect(isDefaultChatSkill(DEFAULT_PROGRESSIVE_LEARNING_SKILL_ID)).toBe(true);
    expect(isDefaultChatSkill("skill_imported")).toBe(false);
  });

  it("includes default skills in available skills", () => {
    vi.stubGlobal("window", undefined);

    const available = readAvailableChatSkills();

    expect(available).toHaveLength(1);
    expect(available[0]?.id).toBe(DEFAULT_PROGRESSIVE_LEARNING_SKILL_ID);
  });

  it("merges stored skills with default skills", () => {
    const storage = new Map<string, string>();
    installStorage(storage);

    const imported: ChatSkill = {
      id: "skill_imported",
      name: "Imported",
      description: "An imported skill",
      instructions: "Teach step by step.",
      version: "abc12345",
    };
    addStoredChatSkill(imported);

    const available = readAvailableChatSkills();
    expect(available).toHaveLength(2);
    expect(available[0]?.id).toBe(DEFAULT_PROGRESSIVE_LEARNING_SKILL_ID);
    expect(available[1]?.id).toBe("skill_imported");
  });

  it("deduplicates available skills when stored content matches a default", () => {
    const storage = new Map<string, string>();
    installStorage(storage);

    const defaultSkill = getDefaultChatSkills()[0];
    if (!defaultSkill) {
      throw new Error("Default skill should exist");
    }

    addStoredChatSkill({ ...defaultSkill, id: "skill_duplicate" });

    const available = readAvailableChatSkills();
    expect(available).toHaveLength(1);
    expect(available[0]?.id).toBe(DEFAULT_PROGRESSIVE_LEARNING_SKILL_ID);
  });

  it("finds default skills by id", () => {
    const found = findChatSkillById(DEFAULT_PROGRESSIVE_LEARNING_SKILL_ID);

    expect(found).not.toBeNull();
    expect(found?.id).toBe(DEFAULT_PROGRESSIVE_LEARNING_SKILL_ID);
    expect(found?.name).toBe("progressive-learning");
  });

  it("returns null when no skill matches the id", () => {
    expect(findChatSkillById("skill_missing")).toBeNull();
    expect(findChatSkillById(null)).toBeNull();
  });
});
