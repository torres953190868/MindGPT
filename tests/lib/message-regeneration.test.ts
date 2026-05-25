import { describe, expect, it } from "vitest";
import {
  getRegenerateConversationPrefix,
  resolveRegenerateTargets,
} from "@/lib/message-regeneration";
import type { ChatMessage } from "@/lib/types";

const timestamp = "2026-01-01T00:00:00.000Z";

function message(id: string, role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id,
    role,
    content,
    attachments: [],
    createdAt: timestamp,
  };
}

const conversation = [
  message("user-1", "user", "First prompt"),
  message("assistant-1", "assistant", "First answer"),
  message("user-2", "user", "Second prompt"),
  message("assistant-2", "assistant", "Second answer"),
];

describe("message regeneration target resolution", () => {
  it("defaults to the latest assistant and its nearest previous user message", () => {
    const targets = resolveRegenerateTargets(conversation, {});

    expect(targets).toMatchObject({
      userMessage: { id: "user-2" },
      userMessageIndex: 2,
      assistantMessage: { id: "assistant-2" },
      assistantMessageIndex: 3,
      isLatestAssistant: true,
    });
  });

  it("resolves an earlier user message to its paired assistant message", () => {
    const targets = resolveRegenerateTargets(conversation, {
      userMessageId: "user-1",
    });

    expect(targets).toMatchObject({
      userMessage: { id: "user-1" },
      userMessageIndex: 0,
      assistantMessage: { id: "assistant-1" },
      assistantMessageIndex: 1,
      isLatestAssistant: false,
    });
  });

  it("rejects explicit targets from different turns", () => {
    expect(
      resolveRegenerateTargets(conversation, {
        userMessageId: "user-1",
        assistantMessageId: "assistant-2",
      }),
    ).toBeNull();
  });

  it("returns the conversation prefix before the regenerated user message", () => {
    const targets = resolveRegenerateTargets(conversation, {
      userMessageId: "user-2",
    });

    expect(targets).not.toBeNull();
    expect(getRegenerateConversationPrefix(conversation, targets!)).toEqual([
      conversation[0],
      conversation[1],
    ]);
  });

  it("rejects a user message that has no assistant before the next user turn", () => {
    const targets = resolveRegenerateTargets(
      [
        message("user-1", "user", "First prompt"),
        message("user-2", "user", "Second prompt"),
        message("assistant-2", "assistant", "Second answer"),
      ],
      { userMessageId: "user-1" },
    );

    expect(targets).toBeNull();
  });
});
