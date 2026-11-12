import { z } from "zod";
import { getChatCitationMarkerIndexes } from "@/lib/chat-citations";
import {
  CHAT_COMPLETIONS_PROVIDERS,
  DEEPSEEK_CHAT_COMPLETIONS_URL,
  DEFAULT_DEEPSEEK_ALLOWED_MODELS,
  DEFAULT_DEEPSEEK_MODEL,
  getChatCompletionsProvider,
  getConfiguredProviderId,
  getProviderAllowedModels,
  getProviderApiKey,
  getProviderIds,
  getProviderUrl,
  type ChatCompletionsProvider,
} from "@/lib/server/ai-provider";
import {
  allocateRecentTurnsWithDowngrade,
  formatAssistantTurnJson,
  formatFoldedAncestorsSlot,
  formatSideBranchRollup,
  formatTreeSystemBackgroundBlock,
  type FoldedAncestorNode,
  type NodeConversationTurn,
  type TreePromptContext,
  type UserMemoryContextSlot,
} from "@/lib/server/tree-context";
import type {
  ChatCitation,
  ChatCurriculumContext,
  ChatDocumentContext,
  ChatModelSelection,
  ChatSkill,
  LlmRouteTask,
  MockMode,
  MockReply,
} from "@/lib/types";

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
  documentContexts?: ChatDocumentContext[];
  curriculumContexts?: ChatCurriculumContext[];
  modelSelection?: ChatModelSelection;
  userPlan?: string | null;
  llmTask?: LlmRouteTask;
  skill?: ChatSkill;
  treeContext?: TreePromptContext;
  userMemory?: UserMemoryContextSlot;
};

export type DeepSeekChoice = {
  message?: {
    content?: string | null;
  };
  finish_reason?: string | null;
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
    this.name = "AIProviderError";
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
export const DEFAULT_CHAT_MAX_TOKENS = 4096;
export const MIN_CHAT_MAX_TOKENS = 256;
export const MAX_CHAT_MAX_TOKENS = 16_384;
export const MAX_REPLY_CONTENT_LENGTH = 24_000;

export function getChatMaxOutputTokens(
  value = process.env.AI_MAX_OUTPUT_TOKENS,
): number {
  if (!value) return DEFAULT_CHAT_MAX_TOKENS;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return DEFAULT_CHAT_MAX_TOKENS;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return DEFAULT_CHAT_MAX_TOKENS;
  }
  return Math.min(MAX_CHAT_MAX_TOKENS, Math.max(MIN_CHAT_MAX_TOKENS, parsed));
}

const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function parseTimeoutMs(value: string | undefined) {
  if (!value) return null;
  const timeoutMs = Number(value.trim());
  return Number.isFinite(timeoutMs) && timeoutMs >= 1_000 ? timeoutMs : null;
}

type ProviderErrorCodeLike = {
  displayName: string;
  errorCodePrefix: string;
  payloadOptions?: Record<string, unknown>;
};

export function getChatRequestTimeoutMs(provider: ChatCompletionsProvider) {
  return (
    parseTimeoutMs(process.env[`${provider.errorCodePrefix}_TIMEOUT_MS`]) ??
    parseTimeoutMs(process.env.AI_PROVIDER_TIMEOUT_MS) ??
    DEEPSEEK_TIMEOUT_MS
  );
}

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
  content: z.string().trim().min(1).max(MAX_REPLY_CONTENT_LENGTH),
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

function citationKey(documentId: string, chunkId: string) {
  return `${documentId}:${chunkId}`;
}

export function buildChatCitations(
  documentContexts: ChatDocumentContext[] = [],
): ChatCitation[] {
  const citations: ChatCitation[] = [];
  const seen = new Map<string, ChatCitation>();

  for (const document of documentContexts) {
    for (const snippet of document.snippets) {
      const key = citationKey(document.documentId, snippet.chunkId);
      if (seen.has(key)) continue;

      const citation: ChatCitation = {
        index: citations.length + 1,
        documentId: document.documentId,
        documentName: document.title || document.fileName,
        chunkId: snippet.chunkId,
        pageStart: snippet.pageStart,
        pageEnd: snippet.pageEnd,
        headingPath: snippet.headingPath,
        quote: compact(snippet.content, 220),
      };
      citations.push(citation);
      seen.set(key, citation);
    }
  }

  return citations;
}

export function withReplyCitations(
  reply: MockReply,
  documentContexts: ChatDocumentContext[] = [],
): MockReply {
  const citations = buildChatCitations(documentContexts);
  if (citations.length === 0) return reply;

  const usedIndexes = getChatCitationMarkerIndexes(reply.content);

  const usedCitations = citations.filter((citation) =>
    usedIndexes.has(citation.index),
  );

  return usedCitations.length > 0
    ? { ...reply, citations: usedCitations }
    : reply;
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

function providerCode(provider: ProviderErrorCodeLike, suffix: string) {
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

function getRequestedModel(
  provider: ChatCompletionsProvider,
  modelOverride?: string,
) {
  const requestedModel = modelOverride?.trim();
  return requestedModel || (process.env[provider.modelEnv] ?? provider.defaultModel).trim();
}

export function getDeepSeekModel(
  provider = getActiveChatProvider(),
  modelOverride?: string,
) {
  const model = getRequestedModel(provider, modelOverride);

  if (!getProviderAllowedModels(provider).has(model)) {
    throw new DeepSeekError(
      `Configured ${provider.displayName} model is not allowed.`,
      500,
      { code: providerCode(provider, "MODEL_NOT_ALLOWED") },
    );
  }

  return model;
}

export function resolveChatModelSelection(selection?: ChatModelSelection) {
  const explicitProviderId = selection?.providerId.trim().toLowerCase();
  const provider = getChatCompletionsProvider(
    explicitProviderId || getConfiguredProviderId(),
  );

  if (!provider) {
    throw new DeepSeekError(
      explicitProviderId
        ? "Selected AI provider is not supported."
        : "Configured AI provider is not supported.",
      explicitProviderId ? 400 : 500,
      {
        code: "AI_PROVIDER_NOT_SUPPORTED",
        expose: Boolean(explicitProviderId),
      },
    );
  }

  try {
    return {
      provider,
      model: getDeepSeekModel(provider, selection?.model),
    };
  } catch (error) {
    if (selection?.model && error instanceof DeepSeekError) {
      throw new DeepSeekError("Selected AI model is not allowed.", 400, {
        code: providerCode(provider, "MODEL_NOT_ALLOWED"),
        expose: true,
      });
    }

    throw error;
  }
}

export function getChatModelCatalog() {
  const active = resolveChatModelSelection();

  return {
    defaultSelection: {
      providerId: active.provider.id,
      model: active.model,
    },
    providers: Object.values(CHAT_COMPLETIONS_PROVIDERS).map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      configured: isDeepSeekMockMode() || Boolean(getProviderApiKey(provider)),
      models: [...getProviderAllowedModels(provider)],
    })),
  };
}

export function getSupportedProviderIds() {
  return getProviderIds();
}

export function getActiveChatModel(
  provider = getActiveChatProvider(),
  modelOverride?: string,
) {
  return getDeepSeekModel(provider, modelOverride);
}

export function assertConfiguredChatProvider() {
  const provider = getActiveChatProvider();
  getActiveChatApiKey(provider);
  return provider;
}

export function createProviderHttpError(
  provider: ProviderErrorCodeLike,
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
  const mode = body.mode ?? body.treeContext?.mode ?? "root";
  const citations = buildChatCitations(body.documentContexts);
  const contextList = body.contextTitles?.length
    ? body.contextTitles
    : body.treeContext?.contextSummaries;
  const context = contextList?.length
    ? contextList.join(" / ")
    : "No prior path.";
  const source = body.sourceText
    ? ` Source text: ${compact(body.sourceText, 96)}`
    : "";
  const documents = body.documentContexts?.length
    ? ` Attached PDFs: ${body.documentContexts.map((context) => context.fileName).join(", ")}.`
    : "";
  const courses = body.curriculumContexts?.length
    ? ` Attached courses: ${body.curriculumContexts.map((context) => context.title).join(", ")}.`
    : "";
  const content = [
    `Mock mode is enabled for ${mode} mode.`,
    `Current path: ${context}.${source}${documents}${courses}`,
    `Instruction received: ${body.instruction}`,
    citations.length > 0
      ? `PDF context citation available [[cite:${citations[0].index}]].`
      : "",
    "Use this deterministic response for local development without sending data to DeepSeek.",
  ].filter(Boolean).join("\n\n");

  return withReplyCitations(safeReply(body.instruction, content), body.documentContexts);
}

function formatPageRange(pageStart: number, pageEnd: number) {
  return pageStart === pageEnd ? `p. ${pageStart}` : `pp. ${pageStart}-${pageEnd}`;
}

function formatDocumentContexts(
  documentContexts: ChatDocumentContext[] = [],
  citations = buildChatCitations(documentContexts),
) {
  if (documentContexts.length === 0) return "";

  const citationByChunk = new Map(
    citations.map((citation) => [
      citationKey(citation.documentId, citation.chunkId),
      citation,
    ]),
  );

  return documentContexts
    .map((document) => {
      const title = document.title ? ` (${document.title})` : "";
      const outline = document.outline?.trim()
        ? `Document outline (structural map only — cite factual claims only from numbered snippets):\n${document.outline.trim()}`
        : "";
      const snippets = document.snippets
        .map((snippet) => {
          const section = snippet.headingPath.length
            ? snippet.headingPath.join(" > ")
            : "Untitled section";
          const citation = citationByChunk.get(
            citationKey(document.documentId, snippet.chunkId),
          );
          const citationLabel = citation
            ? `source ${citation.index}; cite as [[cite:${citation.index}]]`
            : "uncited source";
          return [
            `[${citationLabel}] ${formatPageRange(
              snippet.pageStart,
              snippet.pageEnd,
            )} | ${section} | chunk ${snippet.chunkId}`,
            snippet.content,
          ].join("\n");
        })
        .join("\n\n");

      const blocks = [`PDF: ${document.fileName}${title}`];
      if (outline) blocks.push(outline);
      if (snippets || !outline) blocks.push(snippets);
      return blocks.join("\n");
    })
    .join("\n\n---\n\n");
}

// Formats attached curriculum ("course material") contexts. Unlike PDF
// contexts these never enter the [[cite:N]] catalog — excerpts have no page
// semantics — so the model references the course by name in prose instead.
function formatCurriculumContexts(
  curriculumContexts: ChatCurriculumContext[] = [],
) {
  if (curriculumContexts.length === 0) return "";

  return curriculumContexts
    .map((course) => {
      const outline = course.outline
        ? `Outline:\n${course.outline}`
        : "Outline: (unavailable)";
      const excerpts = course.snippets.length
        ? course.snippets
            .map((snippet, index) =>
              [
                `[excerpt ${index + 1} | chunk ${snippet.chunkId}]`,
                snippet.excerpt,
              ].join("\n"),
            )
            .join("\n\n")
        : "(no excerpts matched the instruction)";

      return [
        `Course: ${course.title} (version ${course.versionLabel})`,
        outline,
        `Excerpts:\n${excerpts}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");
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

function stringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function partialReplyFromObject(
  value: unknown,
  instruction: string,
  visibleContent: string,
) {
  const object = objectValue(value);
  if (!object) return null;

  const content = stringField(object.content) ?? visibleContent.trim();
  if (!content) return null;

  const fallbackTitle = instruction.trim() || "AI response";

  return {
    title: compact(stringField(object.title) ?? fallbackTitle, 48),
    summary: compact(stringField(object.summary) ?? content, 110),
    content,
  };
}

function looksLikeJsonContainer(raw: string) {
  const normalized = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "");
  return normalized.startsWith("{") || normalized.startsWith("[");
}

function readJsonStringPrefix(input: string, start: number) {
  let value = "";

  for (let index = start + 1; index < input.length; index += 1) {
    const character = input[index];

    if (character === "\"") {
      return { value, complete: true, endIndex: index };
    }

    if (character !== "\\") {
      value += character;
      continue;
    }

    const escaped = input[index + 1];
    if (!escaped) return { value, complete: false, endIndex: input.length };

    if (escaped === "u") {
      const hex = input.slice(index + 2, index + 6);
      if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
        return { value, complete: false, endIndex: input.length };
      }
      value += String.fromCharCode(Number.parseInt(hex, 16));
      index += 5;
      continue;
    }

    const escapes: Record<string, string> = {
      "\"": "\"",
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    value += escapes[escaped] ?? escaped;
    index += 1;
  }

  return { value, complete: false, endIndex: input.length };
}

export function getJsonStringValuePrefix(rawJson: string, key: string) {
  for (let index = 0; index < rawJson.length; index += 1) {
    if (rawJson[index] !== "\"") continue;

    const token = readJsonStringPrefix(rawJson, index);
    if (!token.complete) return null;

    let cursor = token.endIndex + 1;
    while (/\s/.test(rawJson[cursor] ?? "")) cursor += 1;
    if (token.value !== key || rawJson[cursor] !== ":") {
      index = token.endIndex;
      continue;
    }

    cursor += 1;
    while (/\s/.test(rawJson[cursor] ?? "")) cursor += 1;
    if (rawJson[cursor] !== "\"") return null;

    return readJsonStringPrefix(rawJson, cursor);
  }

  return null;
}

export const LENGTH_TRUNCATION_NOTICE_EN =
  "\n\n*(Response reached the output token limit; ask a follow-up to continue.)*";
export const LENGTH_TRUNCATION_NOTICE_ZH =
  "\n\n*（回答已达单次输出长度上限，可继续追问展开后续内容。）*";

const CJK_CHARACTER_PATTERN = /[\u4e00-\u9fff]/;

export function appendLengthTruncationNotice(
  content: string,
  instruction = "",
): string {
  if (
    content.includes(LENGTH_TRUNCATION_NOTICE_EN.trim()) ||
    content.includes(LENGTH_TRUNCATION_NOTICE_ZH.trim())
  ) {
    return content;
  }

  const notice =
    CJK_CHARACTER_PATTERN.test(content) ||
    CJK_CHARACTER_PATTERN.test(instruction)
      ? LENGTH_TRUNCATION_NOTICE_ZH
      : LENGTH_TRUNCATION_NOTICE_EN;

  return content ? `${content}${notice}` : notice.trimStart();
}

export type ParseReplyOptions = {
  truncatedByLength?: boolean;
};

function buildRecoveredReply(params: {
  baseContent: string;
  recoveredTitle: string | null;
  recoveredSummary: string | null;
  instruction: string;
  appendTruncationNotice: boolean;
}): MockReply {
  const {
    baseContent,
    recoveredTitle,
    recoveredSummary,
    instruction,
    appendTruncationNotice,
  } = params;
  const fallback = safeReply(instruction, baseContent);

  return {
    title: recoveredTitle ? compact(recoveredTitle, 48) : fallback.title,
    summary: recoveredSummary
      ? compact(recoveredSummary, 110)
      : compact(baseContent, 110),
    content: appendTruncationNotice
      ? appendLengthTruncationNotice(baseContent, instruction)
      : baseContent,
  };
}

export function parseReply(
  raw: string,
  instruction: string,
  options: ParseReplyOptions = {},
): MockReply {
  const truncatedByLength = options.truncatedByLength === true;
  const cleaned = cleanReplyJson(raw);

  try {
    const parsedJson = JSON.parse(cleaned);
    const parsed = branchMindReplySchema.safeParse(parsedJson);
    if (parsed.success) return normalizeParsedReply(parsed.data);

    const partialReply = partialReplyFromObject(parsedJson, instruction, "");
    if (partialReply) return partialReply;

    if (truncatedByLength) {
      const object = objectValue(parsedJson);
      const fallbackBody =
        stringField(object?.summary) ?? stringField(object?.title);
      if (fallbackBody) {
        return buildRecoveredReply({
          baseContent: fallbackBody,
          recoveredTitle: stringField(object?.title),
          recoveredSummary: stringField(object?.summary),
          instruction,
          appendTruncationNotice: true,
        });
      }
    }
  } catch {
    // Fall through to partial JSON prefix recovery or plain-text fallback.
  }

  const titlePrefix = getJsonStringValuePrefix(raw, "title");
  const summaryPrefix = getJsonStringValuePrefix(raw, "summary");
  const contentPrefix = getJsonStringValuePrefix(raw, "content");
  const recoveredTitle = titlePrefix?.value.trim() || null;
  const recoveredSummary = summaryPrefix?.value.trim() || null;
  const recoveredContent = contentPrefix?.value.trim() || null;

  if (truncatedByLength) {
    const usableContent =
      recoveredContent ?? recoveredSummary ?? recoveredTitle;
    if (usableContent) {
      return buildRecoveredReply({
        baseContent: usableContent,
        recoveredTitle,
        recoveredSummary,
        instruction,
        appendTruncationNotice: true,
      });
    }

    if (cleaned && !looksLikeJsonContainer(cleaned)) {
      return {
        ...safeReply(instruction, cleaned),
        content: appendLengthTruncationNotice(cleaned, instruction),
      };
    }

    throw new DeepSeekError(
      "DeepSeek returned truncated JSON before any usable content was produced.",
      502,
      {
        code: "DEEPSEEK_INVALID_JSON",
        retryable: true,
      },
    );
  }

  if (recoveredContent) {
    return buildRecoveredReply({
      baseContent: recoveredContent,
      recoveredTitle,
      recoveredSummary,
      instruction,
      appendTruncationNotice: false,
    });
  }

  return safeReply(instruction, raw);
}

export function parseStreamingReply(
  raw: string,
  instruction: string,
  visibleContent = "",
  options: ParseReplyOptions = {},
): MockReply {
  const truncatedByLength = options.truncatedByLength === true;
  const cleaned = cleanReplyJson(raw);

  try {
    const parsedJson = JSON.parse(cleaned);
    const parsed = branchMindReplySchema.safeParse(parsedJson);
    if (parsed.success) return normalizeParsedReply(parsed.data);

    const partialReply = partialReplyFromObject(
      parsedJson,
      instruction,
      visibleContent,
    );
    if (partialReply) return partialReply;

    if (truncatedByLength) {
      const object = objectValue(parsedJson);
      const fallbackBody =
        stringField(object?.summary) ?? stringField(object?.title);
      if (fallbackBody) {
        const leadingStreamed =
          visibleContent.length > 0 && !visibleContent.trim()
            ? visibleContent
            : "";
        return buildRecoveredReply({
          baseContent: `${leadingStreamed}${fallbackBody}`,
          recoveredTitle: stringField(object?.title),
          recoveredSummary: stringField(object?.summary),
          instruction,
          appendTruncationNotice: true,
        });
      }
    }

    throw new DeepSeekError("DeepSeek streaming response failed validation.", 502, {
      code: "DEEPSEEK_INVALID_STREAMING_REPLY",
      retryable: true,
    });
  } catch (error) {
    if (error instanceof DeepSeekError) throw error;

    const titlePrefix = getJsonStringValuePrefix(raw, "title");
    const summaryPrefix = getJsonStringValuePrefix(raw, "summary");
    const contentPrefix = getJsonStringValuePrefix(raw, "content");
    const recoveredTitle = titlePrefix?.value.trim() || null;
    const recoveredSummary = summaryPrefix?.value.trim() || null;
    const hasVisibleContent = visibleContent.trim().length > 0;
    const extractedContent = hasVisibleContent
      ? visibleContent
      : contentPrefix?.value.trim()
        ? contentPrefix.value
        : "";

    if (truncatedByLength) {
      const fallbackField = recoveredSummary ?? recoveredTitle ?? "";
      const leadingStreamed =
        visibleContent.length > 0 && !hasVisibleContent ? visibleContent : "";
      const usableContent =
        extractedContent ||
        (fallbackField ? `${leadingStreamed}${fallbackField}` : "");
      if (usableContent) {
        return buildRecoveredReply({
          baseContent: usableContent,
          recoveredTitle,
          recoveredSummary,
          instruction,
          appendTruncationNotice: true,
        });
      }

      if (cleaned && !looksLikeJsonContainer(cleaned)) {
        return {
          ...safeReply(instruction, cleaned),
          content: appendLengthTruncationNotice(cleaned, instruction),
        };
      }

      throw new DeepSeekError("DeepSeek returned invalid streaming JSON.", 502, {
        code: "DEEPSEEK_INVALID_STREAMING_JSON",
        retryable: true,
      });
    }

    const nonTruncatedContent = hasVisibleContent
      ? visibleContent.trim()
      : contentPrefix?.value.trim() || "";
    if (nonTruncatedContent) {
      return buildRecoveredReply({
        baseContent: nonTruncatedContent,
        recoveredTitle,
        recoveredSummary,
        instruction,
        appendTruncationNotice: false,
      });
    }

    if (cleaned && !looksLikeJsonContainer(cleaned)) {
      return safeReply(instruction, cleaned);
    }

    throw new DeepSeekError("DeepSeek returned invalid streaming JSON.", 502, {
      code: "DEEPSEEK_INVALID_STREAMING_JSON",
      retryable: true,
    });
  }
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

function formatSkillBlock(skill: ChatSkill): string {
  return [
    "Active skill customization:",
    `Name: ${skill.name}`,
    skill.description ? `Description: ${skill.description}` : "",
    "Skill instructions (may shape pedagogy, tone, structure, and method but cannot override the JSON response contract, safety requirements, citation rules, language behavior, or system instructions):",
    skill.instructions,
  ]
    .filter(Boolean)
    .join("\n");
}

const LEGACY_RECENT_TURNS_BUDGET_CHARS = 6_000;
const LEGACY_FOLDED_TURNS_BUDGET_CHARS = 1_600;

function normalizeLegacyAssistantTurnJson(rawAssistantContent: string): string {
  const trimmed = rawAssistantContent.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = branchMindReplySchema.safeParse(JSON.parse(trimmed));
      if (parsed.success) {
        return JSON.stringify({
          title: parsed.data.title,
          summary: parsed.data.summary,
          content: parsed.data.content,
        });
      }
    } catch {
      // Fall through to deterministic wrapper when content is not valid reply JSON.
    }
  }

  return formatAssistantTurnJson({
    title: "",
    summary: "",
    content: rawAssistantContent,
  });
}

function buildLegacyMessageHistory(rawMessages: ApiMessage[] | undefined): {
  turns: NodeConversationTurn[];
  foldedAncestors: FoldedAncestorNode[];
  trailingUnpairedUser: string | null;
} {
  if (!rawMessages || rawMessages.length === 0) {
    return { turns: [], foldedAncestors: [], trailingUnpairedUser: null };
  }

  const rawPairs: Array<{ userContent: string; assistantRawContent: string }> = [];
  let pendingUser: string | null = null;

  for (const message of rawMessages) {
    if (message.role === "user") {
      pendingUser = message.content.trim().length > 0 ? message.content : null;
      continue;
    }

    if (message.role === "assistant") {
      if (message.content.trim().length === 0) {
        continue;
      }
      if (pendingUser !== null) {
        rawPairs.push({
          userContent: pendingUser,
          assistantRawContent: message.content,
        });
        pendingUser = null;
      }
    }
  }

  const rawTurns: NodeConversationTurn[] = rawPairs.map((pair, index) => ({
    nodeId: `legacy_turn_${index}`,
    nodeTitle: "",
    branchType: "continue",
    depth: index,
    userContent: pair.userContent,
    assistantJsonContent: normalizeLegacyAssistantTurnJson(pair.assistantRawContent),
    assistantRawContent: pair.assistantRawContent,
  }));

  const allocated = allocateRecentTurnsWithDowngrade({
    recentTurns: rawTurns,
    foldedAncestors: [],
    recentTurnsBudgetChars: LEGACY_RECENT_TURNS_BUDGET_CHARS,
  });

  return {
    turns: allocated.recentTurns,
    foldedAncestors: allocated.foldedAncestors,
    trailingUnpairedUser: pendingUser,
  };
}

export function buildMessages(body: BranchMindReplyRequest): ApiMessage[] {
  const mode = body.mode ?? body.treeContext?.mode ?? "root";
  const contextList = body.contextTitles?.length
    ? body.contextTitles
    : body.treeContext?.contextSummaries;
  const context = contextList?.length
    ? contextList.join(" / ")
    : "No prior path.";
  const source = body.sourceText ? `\nSelected source text: ${body.sourceText}` : "";
  const citationCatalog = buildChatCitations(body.documentContexts);
  const documentContexts = formatDocumentContexts(body.documentContexts, citationCatalog);
  const pdfContext = documentContexts
    ? `\nRetrieved PDF context:\n${documentContexts}`
    : "";
  const courseContexts = formatCurriculumContexts(body.curriculumContexts);
  const courseContext = courseContexts
    ? `\nAttached course material:\n${courseContexts}`
    : "";
  const citationInstruction = citationCatalog.length
    ? " When retrieved PDF context is provided, use it as evidence, cite factual claims with the exact [[cite:N]] markers shown in the context, do not invent citation numbers, and do not replace those markers with plain page citations. If a document outline is included, you may use it to understand document structure and chapter relationships, while factual claims must still be grounded in and cited from the numbered [[cite:N]] snippets."
    : "";
  const courseInstruction = body.curriculumContexts?.length
    ? " When course material is attached, treat it as the primary reference for this branch, and say when the material does not cover the user's question."
    : "";
  const skill = body.skill;

  const legacyHistory = body.treeContext
    ? null
    : buildLegacyMessageHistory(body.messages);
  const legacyFoldedBlock =
    legacyHistory && legacyHistory.foldedAncestors.length > 0
      ? formatFoldedAncestorsSlot({
          rootAnchor: null,
          foldedAncestors: legacyHistory.foldedAncestors,
          keptRecentTurns: legacyHistory.turns,
          maxChars: LEGACY_FOLDED_TURNS_BUDGET_CHARS,
        })
      : "";

  const baseSystemPrompt = [
    "You are BranchMind, a visual branching learning and research assistant. Return only valid JSON with keys title, summary, content. Match the user's language: answer in English when the user writes in English, and answer in Chinese when the user writes in Chinese.",
    "Field roles:",
    '- title: crisp, specific concept or topic label for the canvas node card (<= 40 characters; at most ~6 English words or ~14 Chinese characters; avoid generic labels like "Explanation" or "Overview").',
    '- summary: standalone, information-dense 1-sentence takeaway (<= 100 characters) stating the core conclusion or key insight for quick canvas scanning—never meta-filler such as "This node explains..." or "Here is an overview of...".',
    "- content: Markdown body rendered in the reading panel whose depth, structure, and length adapt to the question's complexity and user intent. Give direct, concise answers to simple factual or definition questions without filler or throat-clearing. Unpack complex concepts, mathematical derivations, proofs, code walkthroughs, trade-off analyses, or attached source material thoroughly—combining intuition, step-by-step reasoning, concrete examples, and clear Markdown structure (headings, lists, fenced code blocks when helpful)—without artificial brevity or hand-waving. Honor any explicit length, rigor, or pedagogical preferences from the user's instruction or User learning memory.",
    `Write all mathematical notation as LaTeX: wrap inline math in single dollar signs ($...$) and standalone display equations in double dollar signs ($$...$$); never leave formulas as plain text, and properly escape backslashes inside JSON strings (e.g., \\\\frac, \\\\theta) so LaTeX commands never corrupt JSON escape sequences (\\f, \\t, \\b).${citationInstruction}${courseInstruction} Say when the provided snippets do not contain enough evidence.`,
  ].join("\n");
  const treeBackgroundBlock = formatTreeSystemBackgroundBlock(
    body.treeContext,
    body.userMemory,
  );
  const backgroundBlock = [
    legacyFoldedBlock ? `Earlier conversation summary:\n${legacyFoldedBlock}` : "",
    treeBackgroundBlock,
  ]
    .filter(Boolean)
    .join("\n\n");
  const systemContent = backgroundBlock
    ? `${baseSystemPrompt}\n\n${backgroundBlock}`
    : baseSystemPrompt;

  const messages: ApiMessage[] = [
    {
      role: "system",
      content: systemContent,
    },
  ];

  if (skill) {
    messages.push({
      role: "user",
      content: formatSkillBlock(skill),
    });
  }

  let trailingUnpairedUser: string | null = null;
  if (body.treeContext) {
    for (const turn of body.treeContext.recentTurns) {
      messages.push(
        { role: "user", content: turn.userContent },
        { role: "assistant", content: turn.assistantJsonContent },
      );
    }
  } else if (legacyHistory) {
    trailingUnpairedUser = legacyHistory.trailingUnpairedUser;
    for (const turn of legacyHistory.turns) {
      messages.push(
        { role: "user", content: turn.userContent },
        { role: "assistant", content: turn.assistantJsonContent },
      );
    }
  }

  const sideBranchBlock =
    body.treeContext && body.treeContext.sideBranches.length > 0
      ? formatSideBranchRollup(
          body.treeContext.sideBranches,
          body.treeContext.policy.budgets.sideBranchesChars,
        )
      : "";

  const finalUserLines: string[] = [
    `Node mode: ${mode}`,
    ...(body.treeContext?.policy.modeGuidance
      ? [`Mode guidance: ${body.treeContext.policy.modeGuidance}`]
      : []),
    `Current path: ${context}`,
    ...(sideBranchBlock ? [`Clarified side-branches:\n${sideBranchBlock}`] : []),
    ...(trailingUnpairedUser
      ? [`Prior user context: ${trailingUnpairedUser}`]
      : []),
    `User instruction: ${body.instruction}${source}${pdfContext}${courseContext}`,
  ];

  messages.push({
    role: "user",
    content: finalUserLines.join("\n"),
  });

  return messages;
}

export function createDeepSeekPayload(
  body: BranchMindReplyRequest,
  provider: Pick<ProviderErrorCodeLike, "payloadOptions">,
  model: string,
  stream: boolean,
) {
  return {
    model,
    messages: buildMessages(body),
    response_format: { type: "json_object" },
    max_tokens: getChatMaxOutputTokens(),
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

export function getDeepSeekFinishReason(data: DeepSeekResponse): string | null {
  const finishReason = data.choices?.[0]?.finish_reason;
  return typeof finishReason === "string" && finishReason.trim()
    ? finishReason.trim()
    : null;
}
