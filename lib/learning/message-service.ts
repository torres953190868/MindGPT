import { z } from "zod";
import { createAgentModelAdapter } from "@/lib/agent-runtime/model-adapter";
import { getAssessmentRepository } from "@/lib/learning/assessment-repository";
import type { LearningMessage, LearningSession, TutorResponse } from "@/lib/learning/learning-types";
import type {
  CreateMessageInput,
  LearningRepository as LearningRepositoryContract,
} from "@/lib/learning/learning-repository";

export const LEARNING_SESSION_SUMMARY_THRESHOLD = 20;

const summaryActionSchema = z.object({
  summary: z.string().trim().min(1).max(2_000),
});

export async function listRecentLearningMessages(
  userId: string,
  enrollmentId: string,
  limit: number,
  repository: LearningRepositoryContract,
): Promise<LearningMessage[]> {
  return repository.listRecentMessages(userId, enrollmentId, limit);
}

function fallbackSummary(messages: LearningMessage[]) {
  return messages
    .slice(-6)
    .map((message) => `${message.role}: ${JSON.stringify(message.blocks).slice(0, 280)}`)
    .join("\n")
    .slice(0, 1_800);
}

async function refreshSessionSummaryIfNeeded(
  userId: string,
  enrollmentId: string,
  sessionId: string,
  session: LearningSession | undefined,
  repository: LearningRepositoryContract,
) {
  const messages = await repository.listRecentMessages(
    userId,
    enrollmentId,
    LEARNING_SESSION_SUMMARY_THRESHOLD + 30,
    sessionId,
  );
  if (messages.length <= LEARNING_SESSION_SUMMARY_THRESHOLD) return session;

  const oldSummary = session?.summary?.trim() ?? "";
  try {
    const adapter = createAgentModelAdapter({
      mockScript: [{
        action: {
          summary: fallbackSummary(messages),
        },
      }],
    });
    const result = await adapter.completeAction({
      task: "tutor_chat",
      systemPrompt:
        "将学习会话压缩为一段简洁的学习摘要，保留已掌握内容、困惑点和下一步。只返回 summary 字段。",
      contextMessages: [{
        role: "user",
        content: JSON.stringify({ oldSummary, messages: messages.map((message) => message.blocks) }),
      }],
      actionSchema: summaryActionSchema,
      maxOutputTokens: 500,
    });
    return (await repository.updateSessionSummary(
      userId,
      enrollmentId,
      sessionId,
      result.action.summary,
    )) ?? session;
  } catch {
    // A summary is an optimization and must never fail the tutor turn. When
    // there is no previous summary, retain a deterministic local fallback;
    // otherwise preserving the last successful summary avoids replacing good
    // context with a partial/error response.
    if (oldSummary) return session;
    return (await repository.updateSessionSummary(
      userId,
      enrollmentId,
      sessionId,
      fallbackSummary(messages),
    )) ?? session;
  }
}

async function registerTutorGeneratedBlocks(
  userId: string,
  enrollmentId: string,
  sessionId: string,
  response: TutorResponse,
) {
  const assessmentRepository = getAssessmentRepository();
  const blocks: TutorResponse["blocks"] = [];
  for (const block of response.blocks) {
    if (block.type !== "question" && block.type !== "exercise") {
      blocks.push(block);
      continue;
    }
    try {
      const registered = await assessmentRepository.registerGeneratedExercise({
        userId,
        sessionId,
        enrollmentId,
        nodeId: response.currentNodeId,
        prompt: block.type === "question" ? { markdown: block.markdown } : { prompt: block.prompt, markdown: block.markdown },
        rubric: block.type === "question" ? { expectedKeywords: [] } : { expectedKeywords: [] },
      });
      blocks.push(
        block.type === "question"
          ? { ...block, questionId: registered.id }
          : { ...block, exerciseId: registered.id },
      );
    } catch {
      // Never expose a client-only question id. Dropping the block is safer
      // than returning an assessment target the server cannot resolve.
    }
  }
  return {
    ...response,
    blocks: blocks.length > 0
      ? blocks
      : [{
          type: "explanation" as const,
          markdown: "当前练习暂时无法登记，请先继续阅读本节内容。",
        }],
  };
}

export type AppendTutorTurnResult = {
  messages: LearningMessage[];
  response: TutorResponse;
  session: LearningSession | undefined;
};

export async function appendTutorTurn(
  userId: string,
  enrollmentId: string,
  sessionId: string,
  input: { userMessage?: string; response: TutorResponse; session?: LearningSession },
  repository: LearningRepositoryContract,
): Promise<AppendTutorTurnResult> {
  const response = await registerTutorGeneratedBlocks(
    userId,
    enrollmentId,
    sessionId,
    input.response,
  );
  const messages: CreateMessageInput[] = input.userMessage?.trim()
    ? [{ role: "user" as const, blocks: [{ type: "text", text: input.userMessage.trim() }] }]
    : [];
  messages.push({ role: "assistant", blocks: response });
  if (response.progressProposal) {
    messages.push({
      role: "system_event",
      blocks: { type: "progress_proposal", proposal: response.progressProposal },
    });
  }
  const saved = await repository.appendMessages(userId, enrollmentId, sessionId, messages);
  const updatedSession = await refreshSessionSummaryIfNeeded(
    userId,
    enrollmentId,
    sessionId,
    input.session,
    repository,
  );
  return { messages: saved, response, session: updatedSession };
}
