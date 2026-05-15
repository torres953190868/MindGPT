import {
  getChatCompletionsProvider,
  getProviderAllowedModels,
  getProviderApiKey,
  getProviderUrl,
  type ChatCompletionsProvider,
} from "@/lib/server/ai-provider";
import { RagError } from "./errors";
import { compactText } from "./text";
import type {
  RagCitation,
  RagQueryResponse,
  RagSection,
  RetrievedChunk,
} from "./types";

const MAX_OUTLINE_ITEMS = 80;

type ChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

function isMockMode() {
  const value = process.env.AI_MOCK_MODE ?? process.env.LLM_MOCK_MODE;
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

function providerId() {
  return (process.env.LLM_PROVIDER ?? process.env.AI_PROVIDER ?? "deepseek")
    .trim()
    .toLowerCase();
}

function getProvider() {
  const provider = getChatCompletionsProvider(providerId());
  if (!provider) {
    throw new RagError("Configured LLM provider is not supported.", {
      code: "LLM_PROVIDER_NOT_SUPPORTED",
      status: 500,
    });
  }
  return provider;
}

function getModel(provider: ChatCompletionsProvider) {
  const model = (
    process.env.LLM_MODEL ??
    process.env[provider.modelEnv] ??
    provider.defaultModel
  ).trim();

  if (!getProviderAllowedModels(provider).has(model)) {
    throw new RagError(`Configured ${provider.displayName} model is not allowed.`, {
      code: "LLM_MODEL_NOT_ALLOWED",
      status: 500,
    });
  }

  return model;
}

function getApiKey(provider: ChatCompletionsProvider) {
  const apiKey = getProviderApiKey(provider);
  if (!apiKey) {
    throw new RagError(`${provider.apiKeyEnv} is not configured.`, {
      code: "LLM_API_KEY_MISSING",
      status: 500,
    });
  }
  return apiKey;
}

function contextForPrompt(retrieved: RetrievedChunk[]) {
  return retrieved
    .map(({ chunk }) => {
      const pages =
        chunk.pageStart === chunk.pageEnd
          ? `${chunk.pageStart}`
          : `${chunk.pageStart}-${chunk.pageEnd}`;
      const section = chunk.headingPath.length
        ? chunk.headingPath.join(" > ")
        : "Untitled section";
      return [
        `[Chunk id: ${chunk.id} | Pages ${pages} | Section: ${section}]`,
        chunk.content,
      ].join("\n");
    })
    .join("\n\n");
}

function formatPageRange(section: RagSection) {
  return section.pageStart === section.pageEnd
    ? `pp. ${section.pageStart}`
    : `pp. ${section.pageStart}-${section.pageEnd}`;
}

function formatDocumentOutline(sections: RagSection[]) {
  if (sections.length === 0) {
    return "(No document outline was retrieved.)";
  }

  const outline = [...sections]
    .sort(
      (left, right) =>
        left.pageStart - right.pageStart ||
        left.level - right.level ||
        left.pageEnd - right.pageEnd ||
        left.title.localeCompare(right.title),
    )
    .slice(0, MAX_OUTLINE_ITEMS)
    .map((section) => {
      const depth = Math.max(0, section.level - 1);
      const indent = "  ".repeat(Math.min(depth, 5));
      return `${indent}- ${section.title}, ${formatPageRange(section)}`;
    });

  if (sections.length > MAX_OUTLINE_ITEMS) {
    outline.push(
      `- ... (${sections.length - MAX_OUTLINE_ITEMS} more sections omitted)`,
    );
  }

  return outline.join("\n");
}

function buildPrompt(
  question: string,
  retrieved: RetrievedChunk[],
  sections: RagSection[] = [],
) {
  return [
    "You are a PDF reading assistant.",
    "",
    "You will receive:",
    "1. A compressed document outline.",
    "2. Retrieved context chunks from the PDF.",
    "3. The user's question.",
    "",
    "Use the document outline only to understand the PDF's structure, chapter hierarchy, and where the retrieved chunks sit in the whole document. The outline is metadata, not primary evidence.",
    "",
    "Answer the user's question using ONLY the retrieved context chunks as factual evidence.",
    "",
    "Rules:",
    '1. If the retrieved chunks do not contain enough evidence, say: "文档中没有找到明确依据。"',
    "2. Do not invent facts from the outline.",
    '3. Use the outline to organize the answer when helpful, especially for cross-chapter, summary, comparison, or "what is this document about" questions.',
    "4. Cite page numbers after important claims.",
    "5. If retrieved chunks come from different chapters, explain how those chapters relate.",
    "6. Prefer concise, structured Chinese.",
    '7. At the end, provide a "来源" section listing pages and section titles.',
    "",
    "Document outline:",
    formatDocumentOutline(sections),
    "",
    "Retrieved context chunks:",
    contextForPrompt(retrieved),
    "",
    "User question:",
    question,
  ].join("\n");
}

function parseContent(data: unknown) {
  if (!data || typeof data !== "object") {
    throw new RagError("LLM provider returned invalid JSON.", {
      code: "LLM_INVALID_RESPONSE",
      status: 502,
    });
  }

  const response = data as ChatResponse;
  const content = response.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new RagError(response.error?.message ?? "LLM returned an empty answer.", {
      code: "LLM_EMPTY_RESPONSE",
      status: 502,
    });
  }
  return content;
}

function citationsFromChunks(retrieved: RetrievedChunk[]): RagCitation[] {
  return retrieved.map(({ chunk }) => ({
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    chunkId: chunk.id,
    headingPath: chunk.headingPath,
    quote: compactText(chunk.content, 180),
  }));
}

function retrievedChunkDtos(retrieved: RetrievedChunk[]) {
  return retrieved.map(({ chunk, score }) => ({
    chunkId: chunk.id,
    score: Number(score.toFixed(4)),
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    headingPath: chunk.headingPath,
    preview: compactText(chunk.content, 220),
  }));
}

async function requestAnswer(
  question: string,
  retrieved: RetrievedChunk[],
  sections: RagSection[],
) {
  if (isMockMode()) {
    const sources = retrieved
      .map(({ chunk }) => {
        const pages =
          chunk.pageStart === chunk.pageEnd
            ? `第 ${chunk.pageStart} 页`
            : `第 ${chunk.pageStart}-${chunk.pageEnd} 页`;
        return `- ${pages}: ${chunk.headingPath.join(" > ") || "Untitled section"}`;
      })
      .join("\n");
    return `根据检索到的片段，问题可以从这些页面寻找依据。(${retrieved[0]?.chunk.pageStart ?? "?"}页)\n\n来源\n${sources}`;
  }

  const provider = getProvider();
  const model = getModel(provider);
  const apiKey = getApiKey(provider);
  const response = await fetch(getProviderUrl(provider), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You answer questions over retrieved PDF excerpts. Use only provided context.",
        },
        { role: "user", content: buildPrompt(question, retrieved, sections) },
      ],
      max_tokens: 900,
      stream: false,
      ...provider.payloadOptions,
    }),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof (data as { error?: { message?: unknown } }).error?.message === "string"
        ? (data as { error: { message: string } }).error.message
        : `${provider.displayName} answer request failed.`;
    throw new RagError(message, {
      code: "LLM_REQUEST_FAILED",
      status: response.status >= 400 ? response.status : 502,
    });
  }

  return parseContent(data);
}

export async function generateGroundedAnswer(
  question: string,
  retrieved: RetrievedChunk[],
  sections: RagSection[] = [],
): Promise<RagQueryResponse> {
  if (retrieved.length === 0) {
    return {
      answer: "文档中没有找到明确依据。",
      citations: [],
      retrievedChunks: [],
    };
  }

  return {
    answer: await requestAnswer(question, retrieved, sections),
    citations: citationsFromChunks(retrieved),
    retrievedChunks: retrievedChunkDtos(retrieved),
  };
}
