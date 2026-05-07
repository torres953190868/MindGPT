import { z } from "zod";
import {
  CHAT_COMPLETIONS_PROVIDERS,
  DEEPSEEK_CHAT_COMPLETIONS_URL,
  DEFAULT_DEEPSEEK_ALLOWED_MODELS,
  DEFAULT_DEEPSEEK_MODEL,
  getChatCompletionsProvider,
  getProviderAllowedModels,
  getProviderApiKey,
  getProviderIds,
  getProviderUrl,
  type ChatCompletionsProvider,
} from "@/lib/server/ai-provider";
import type { MockMode, MockReply } from "@/lib/types";

export type ApiMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type BranchMindReplyRequest = {
  mode?: MockMode;
  instruction: string;
  contextTitles?: string[];
  messages?: ApiMessage[];
  sourceText?: string;
};

export type DeepSeekChoice = {
  message?: {
    content?: string | null;
  };
};

export class DeepSeekError extends Error {
  code: string;
  expose: boolean;
  retryable: boolean;
  status: number;

  constructor(
    message: string,
    status = 500,
    options: {
      code?: string;
      expose?: boolean;
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "DeepSeekError";
    this.code = options.code ?? "DEEPSEEK_ERROR";
    this.expose = options.expose ?? false;
    this.retryable = options.retryable ?? false;
    this.status = status;
  }
}

export const DEEPSEEK_URL = DEEPSEEK_CHAT_COMPLETIONS_URL;
export const DEFAULT_MODEL = DEFAULT_DEEPSEEK_MODEL;
export const DEEPSEEK_TIMEOUT_MS = 30_000;
export const MAX_DEEPSEEK_ATTEMPTS = 2;
export const RETRY_DELAY_MS = 300;
export const DEFAULT_ALLOWED_MODELS = DEFAULT_DEEPSEEK_ALLOWED_MODELS;

const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

const deepSeekResponseSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                content: z.string().nullable().optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
    error: z
      .object({
        message: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const deepSeekStreamChunkSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            delta: z
              .object({
                content: z.string().nullable().optional(),
                reasoning_content: z.string().nullable().optional(),
                role: z.string().optional(),
              })
              .passthrough()
              .optional(),
            finish_reason: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .optional(),
    error: z
      .object({
        message: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const branchMindReplySchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(280),
  content: z.string().trim().min(1).max(8_000),
});

export type DeepSeekResponse = z.infer<typeof deepSeekResponseSchema>;
export type DeepSeekStreamChunk = z.infer<typeof deepSeekStreamChunkSchema>;

export function compact(input: string, max = 42) {
  const text = input.trim().replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function safeReply(instruction: string, content: string): MockReply {
  const subject = compact(instruction || "DeepSeek response");
  return {
    title: `AI: ${subject}`,
    summary: compact(content, 96),
    content,
  };
}

function isEnabled(value: string | undefined) {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function isDeepSeekMockMode() {
  return (
    isEnabled(process.env.DEEPSEEK_MOCK_MODE) ||
    isEnabled(process.env.MOCK_DEEPSEEK) ||
    isEnabled(process.env.AI_MOCK_MODE)
  );
}

function providerCode(provider: ChatCompletionsProvider, suffix: string) {
  return `${provider.errorCodePrefix}_${suffix}`;
}

export function getActiveChatProvider() {
  const provider = getChatCompletionsProvider();

  if (!provider) {
    throw new DeepSeekError("Configured AI provider is not supported.", 500, {
      code: "AI_PROVIDER_NOT_SUPPORTED",
      expose: true,
    });
  }

  return provider;
}

export function getActiveChatApiKey(provider = getActiveChatProvider()) {
  const apiKey = getProviderApiKey(provider);

  if (!apiKey) {
    throw new DeepSeekError(`${provider.apiKeyEnv} is not configured.`, 500, {
      code: providerCode(provider, "NOT_CONFIGURED"),
    });
  }

  return apiKey;
}

export function getActiveChatUrl(provider = getActiveChatProvider()) {
  return getProviderUrl(provider);
}

export function getDeepSeekModel(provider = getActiveChatProvider()) {
  const model = (process.env[provider.modelEnv] ?? provider.defaultModel).trim();

  if (!getProviderAllowedModels(provider).has(model)) {
    throw new DeepSeekError(
      `Configured ${provider.displayName} model is not allowed.`,
      500,
      { code: providerCode(provider, "MODEL_NOT_ALLOWED") },
    );
  }

  return model;
}

export function getSupportedProviderIds() {
  return getProviderIds();
}

export function getOpenCodeGoAllowedModels() {
  return CHAT_COMPLETIONS_PROVIDERS["opencode-go"].defaultAllowedModels;
}

export function getActiveChatModel(provider = getActiveChatProvider()) {
  return getDeepSeekModel(provider);
}

export function assertConfiguredChatProvider() {
  const provider = getActiveChatProvider();
  getActiveChatApiKey(provider);
  return provider;
}

export function createProviderHttpError(
  provider: ChatCompletionsProvider,
  response: Response,
  data: DeepSeekResponse,
) {
  const retryable = isRetryableStatus(response.status);

  return new DeepSeekError(
    data.error?.message ?? `${provider.displayName} API call failed.`,
    response.status,
    {
      code: retryable
        ? providerCode(provider, "RETRYABLE_ERROR")
        : providerCode(provider, "HTTP_ERROR"),
      retryable,
    });
}

export function getMockReply(body: BranchMindReplyRequest): MockReply {
  const mode = body.mode ?? "root";
  const context = body.contextTitles?.length
    ? body.contextTitles.join(" / ")
    : "No prior path.";
  const source = body.sourceText
    ? ` Source text: ${compact(body.sourceText, 96)}`
    : "";
  const content = [
    `Mock mode is enabled for ${mode} mode.`,
    `Current path: ${context}.${source}`,
    `Instruction received: ${body.instruction}`,
    "Use this deterministic response for local development without sending data to DeepSeek.",
  ].join("\n\n");

  return safeReply(body.instruction, content);
}

function cleanReplyJson(raw: string) {
  return raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function normalizeParsedReply(reply: z.infer<typeof branchMindReplySchema>) {
  return {
    title: compact(reply.title, 48),
    summary: compact(reply.summary, 110),
    content: reply.content,
  };
}

export function parseReply(raw: string, instruction: string): MockReply {
  const cleaned = cleanReplyJson(raw);

  try {
    const parsed = branchMindReplySchema.safeParse(JSON.parse(cleaned));
    if (parsed.success) return normalizeParsedReply(parsed.data);
  } catch {
    return safeReply(instruction, raw);
  }

  return safeReply(instruction, raw);
}

export function parseRequiredReply(raw: string): MockReply {
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(cleanReplyJson(raw));
  } catch {
    throw new DeepSeekError("DeepSeek returned invalid streaming JSON.", 502, {
      code: "DEEPSEEK_INVALID_STREAMING_JSON",
      retryable: true,
    });
  }

  const parsed = branchMindReplySchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new DeepSeekError("DeepSeek streaming response failed validation.", 502, {
      code: "DEEPSEEK_INVALID_STREAMING_REPLY",
      retryable: true,
    });
  }

  return normalizeParsedReply(parsed.data);
}

export function buildMessages(body: BranchMindReplyRequest): ApiMessage[] {
  const mode = body.mode ?? "root";
  const context = body.contextTitles?.length
    ? body.contextTitles.join(" / ")
    : "No prior path.";
  const history = body.messages?.slice(-8) ?? [];
  const source = body.sourceText ? `\nSelected source text: ${body.sourceText}` : "";

  return [
    {
      role: "system",
      content:
        "You are BranchMind, a concise learning assistant. Return only valid JSON with keys title, summary, content. The title must be short. The summary must be 50-100 Chinese characters. The content must be 300-600 Chinese characters unless the user asks for another language.",
    },
    {
      role: "user",
      content: [
        `Node mode: ${mode}`,
        `Current path: ${context}`,
        `Recent node conversation: ${JSON.stringify(history)}`,
        `User instruction: ${body.instruction}${source}`,
      ].join("\n"),
    },
  ];
}

export function createDeepSeekPayload(
  body: BranchMindReplyRequest,
  provider: ChatCompletionsProvider,
  model: string,
  stream: boolean,
) {
  return {
    model,
    messages: buildMessages(body),
    response_format: { type: "json_object" },
    max_tokens: 900,
    stream,
    ...provider.payloadOptions,
  };
}

export function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function isRetryableStatus(status: number) {
  return RETRYABLE_STATUSES.has(status);
}

export function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function parseDeepSeekResponse(data: unknown) {
  const parsed = deepSeekResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new DeepSeekError("DeepSeek response failed validation.", 502, {
      code: "DEEPSEEK_INVALID_RESPONSE",
      retryable: true,
    });
  }

  return parsed.data;
}

export function createDeepSeekHttpError(response: Response, data: DeepSeekResponse) {
  return createProviderHttpError(CHAT_COMPLETIONS_PROVIDERS.deepseek, response, data);
}

export function getDeepSeekContent(data: DeepSeekResponse) {
  const firstChoice: DeepSeekChoice | undefined = data.choices?.[0];
  return firstChoice?.message?.content?.trim();
}
