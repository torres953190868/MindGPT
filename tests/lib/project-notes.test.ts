import { describe, expect, it } from "vitest";
import {
  formatLatestReplyNoteSection,
  getNodeTitlePath,
  getNotesSearchSnippet,
} from "@/lib/project-notes";
import type { MindNode } from "@/lib/types";

const timestamp = "2026-01-01T00:00:00.000Z";

function node(id: string, title: string, parentId: string | null): MindNode {
  return {
    id,
    projectId: "project-1",
    parentId,
    title,
    titleManuallyEdited: false,
    summary: "",
    messages: [],
    children: [],
    position: { x: 0, y: 0 },
    branchType: parentId ? "continue" : "root",
    collapsed: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const nodes = Object.fromEntries(
  [
    node("root", "根节点", null),
    node("child", "子主题", "root"),
    node("grandchild", "  ", "child"),
  ].map((item) => [item.id, item]),
);

describe("getNodeTitlePath", () => {
  it("returns titles from the root down to the given node", () => {
    expect(getNodeTitlePath(nodes, "grandchild", "未命名节点")).toEqual([
      "根节点",
      "子主题",
      "未命名节点",
    ]);
  });

  it("returns only the root title for the root node", () => {
    expect(getNodeTitlePath(nodes, "root", "未命名节点")).toEqual(["根节点"]);
  });

  it("returns an empty path for an unknown node", () => {
    expect(getNodeTitlePath(nodes, "missing", "未命名节点")).toEqual([]);
  });
});

describe("formatLatestReplyNoteSection", () => {
  it("formats the section with a heading, source line, and trimmed content", () => {
    expect(
      formatLatestReplyNoteSection({
        content: "  回答正文  ",
        sourceLabel: "来自节点:根节点 → 子主题 · 2026/1/1",
        title: "子主题",
      }),
    ).toBe("## 子主题\n> 来自节点:根节点 → 子主题 · 2026/1/1\n\n回答正文");
  });
});

describe("getNotesSearchSnippet", () => {
  const notes = "第一段内容。\n\n这里有一段关于向量数据库的笔记。\n\n最后一段。";

  it("returns null for an empty query or no match", () => {
    expect(getNotesSearchSnippet(notes, "")).toBeNull();
    expect(getNotesSearchSnippet(notes, "不存在的词")).toBeNull();
  });

  it("matches case-insensitively and collapses whitespace", () => {
    expect(getNotesSearchSnippet("Some Alpha\nBeta notes", "alpha")).toBe(
      "Some Alpha Beta notes",
    );
  });

  it("returns a context window around the match with ellipses", () => {
    const longNotes = `${"前".repeat(50)}关键词${"后".repeat(50)}`;
    const snippet = getNotesSearchSnippet(longNotes, "关键词");
    expect(snippet).toContain("关键词");
    expect(snippet).toMatch(/^…/);
    expect(snippet).toMatch(/…$/);
  });
});
