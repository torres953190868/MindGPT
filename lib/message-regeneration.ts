import type { ChatMessage } from "@/lib/types";

export type RegenerateTargetInput = {
  userMessageId?: string;
  assistantMessageId?: string;
  instruction?: string;
};

export type RegenerateTargets = {
  userMessage: ChatMessage;
  userMessageIndex: number;
  assistantMessage: ChatMessage;
  assistantMessageIndex: number;
  isLatestAssistant: boolean;
};

function findLastAssistantMessageIndex(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") return index;
  }

  return -1;
}

function findNearestUserBeforeIndex(messages: ChatMessage[], startIndex: number) {
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") return index;
  }

  return -1;
}

function findPairedAssistantIndex(messages: ChatMessage[], userMessageIndex: number) {
  for (let index = userMessageIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === "user") return -1;
    if (message.role === "assistant") return index;
  }

  return -1;
}

function findFirstUserMessageIndex(messages: ChatMessage[]) {
  return messages.findIndex((message) => message.role === "user");
}

export function resolveRegenerateTargets(
  messages: ChatMessage[],
  input: RegenerateTargetInput,
): RegenerateTargets | null {
  const assistantMessageIndex =
    typeof input.assistantMessageId === "string"
      ? messages.findIndex(
          (message) =>
            message.id === input.assistantMessageId && message.role === "assistant",
        )
      : typeof input.userMessageId === "string"
        ? -1
        : findLastAssistantMessageIndex(messages);

  let userMessageIndex =
    typeof input.userMessageId === "string"
      ? messages.findIndex(
          (message) => message.id === input.userMessageId && message.role === "user",
        )
      : assistantMessageIndex >= 0
        ? findNearestUserBeforeIndex(messages, assistantMessageIndex)
        : findFirstUserMessageIndex(messages);

  if (userMessageIndex < 0) return null;

  const pairedAssistantIndex = findPairedAssistantIndex(messages, userMessageIndex);
  const resolvedAssistantMessageIndex =
    typeof input.assistantMessageId === "string"
      ? assistantMessageIndex
      : pairedAssistantIndex;

  if (resolvedAssistantMessageIndex < 0) return null;

  if (
    typeof input.userMessageId === "string" &&
    typeof input.assistantMessageId === "string" &&
    pairedAssistantIndex !== resolvedAssistantMessageIndex
  ) {
    return null;
  }

  if (typeof input.userMessageId !== "string") {
    userMessageIndex = findNearestUserBeforeIndex(messages, resolvedAssistantMessageIndex);
    if (userMessageIndex < 0) return null;
  }

  const userMessage = messages[userMessageIndex];
  const assistantMessage = messages[resolvedAssistantMessageIndex];
  if (userMessage.role !== "user" || assistantMessage.role !== "assistant") return null;

  return {
    userMessage,
    userMessageIndex,
    assistantMessage,
    assistantMessageIndex: resolvedAssistantMessageIndex,
    isLatestAssistant:
      resolvedAssistantMessageIndex === findLastAssistantMessageIndex(messages),
  };
}

export function getRegenerateConversationPrefix(
  messages: ChatMessage[],
  targets: RegenerateTargets,
) {
  return messages.slice(0, targets.userMessageIndex);
}
