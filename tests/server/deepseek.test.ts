import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestDeepSeekReply } from "@/lib/server/deepseek";
import {
  appendLengthTruncationNotice,
  buildMessages,
  createDeepSeekPayload,
  DEFAULT_CHAT_MAX_TOKENS,
  MAX_REPLY_CONTENT_LENGTH,
} from "@/lib/server/deepseek-core";
import {
  getJsonStringValuePrefix,
  streamDeepSeekReply,
  type DeepSeekStreamingEvent,
} from "@/lib/server/deepseek-streaming";

beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "deepseek");
  vi.stubEnv("AI_MOCK_MODE", "false");
  vi.stubEnv("DEEPSEEK_MOCK_MODE", "false");
  vi.stubEnv("MOCK_DEEPSEEK", "false");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("buildMessages", () => {
  it("separates scannable node metadata from adaptive reading-panel content without a hardcoded 300-600 char cap", () => {
    const bareMessages = buildMessages({
      instruction: "Derive the Euler-Lagrange equation step by step.",
    });

    const systemPrompt = bareMessages[0].content;
    expect(bareMessages[0].role).toBe("system");
    expect(systemPrompt.indexOf("You are BranchMind,")).toBe(0);
    expect(systemPrompt).not.toContain("300-600");
    expect(systemPrompt).not.toContain("300–600");
    expect(systemPrompt).not.toContain("concise learning assistant");
    expect(systemPrompt).not.toContain("Workspace context:");

    // JSON schema & language contracts preserved
    expect(systemPrompt).toContain(
      "Return only valid JSON with keys title, summary, content.",
    );
    expect(systemPrompt).toContain(
      "Match the user's language: answer in English when the user writes in English, and answer in Chinese when the user writes in Chinese.",
    );

    // Distinct field guidance for title, summary, and content
    expect(systemPrompt).toContain("- title:");
    expect(systemPrompt).toContain("canvas node card");
    expect(systemPrompt).toContain("<= 40 characters");
    expect(systemPrompt).toContain("- summary:");
    expect(systemPrompt).toContain("<= 100 characters");
    expect(systemPrompt).toContain("This node explains...");
    expect(systemPrompt).toContain("- content:");
    expect(systemPrompt).toContain(
      "depth, structure, and length adapt to the question's complexity and user intent",
    );
    expect(systemPrompt).toContain("simple factual or definition questions");
    expect(systemPrompt).toContain("mathematical derivations");
    expect(systemPrompt).toContain("User learning memory");

    // LaTeX + JSON backslash-escaping guidance
    expect(systemPrompt).toContain("$...$");
    expect(systemPrompt).toContain("$$...$$");
    expect(systemPrompt).toContain("\\\\frac");
    expect(systemPrompt).toContain("\\\\theta");
    expect(systemPrompt).toContain("\\f, \\t, \\b");

    // Static prefix remains at offset 0 followed by Workspace context when userMemory/treeContext is present
    const withMemoryMessages = buildMessages({
      instruction: "Derive the Euler-Lagrange equation step by step.",
      userMemory: {
        profileSummary: "Graduate physics student",
        preferredStyle: "Rigorous variational derivations",
      },
    });
    const systemWithWorkspace = withMemoryMessages[0].content;
    expect(systemWithWorkspace.indexOf("You are BranchMind,")).toBe(0);
    expect(systemWithWorkspace.startsWith(systemPrompt)).toBe(true);
    const workspaceIndex = systemWithWorkspace.indexOf("Workspace context:");
    expect(workspaceIndex).toBeGreaterThan(systemPrompt.length);
    expect(systemWithWorkspace).toContain("User learning memory:");
  });
});

describe("requestDeepSeekReply", () => {
  it("requires an API key before making the outbound request", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestDeepSeekReply({ instruction: "Explain trees" }),
    ).rejects.toMatchObject({
      name: "AIProviderError",
      status: 500,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects models outside the allowlist before calling DeepSeek", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "unapproved-model");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "deepseek-chat");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestDeepSeekReply({ instruction: "Explain allowlists" }),
    ).rejects.toMatchObject({
      code: "DEEPSEEK_MODEL_NOT_ALLOWED",
      status: 500,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses JSON replies and trims user-facing fields", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "test-model");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "test-model");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "  A compact branch title  ",
                  summary: "  This summary is normalized for display.  ",
                  content: "  The full response is preserved after trimming.  ",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const reply = await requestDeepSeekReply({
      mode: "branch",
      instruction: "Map supervised learning",
      contextTitles: ["Root", "Algorithms"],
      messages: [{ role: "user", content: "previous question" }],
      sourceText: "selected source",
    });

    expect(reply).toEqual({
      title: "A compact branch title",
      summary: "This summary is normalized for display.",
      content: "The full response is preserved after trimming.",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deepseek.com/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        }),
      }),
    );

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody).toMatchObject({
      model: "test-model",
      response_format: { type: "json_object" },
      max_tokens: DEFAULT_CHAT_MAX_TOKENS,
      stream: false,
    });
    expect(DEFAULT_CHAT_MAX_TOKENS).toBe(4096);
    expect(requestBody.messages[1].content).toContain("Selected source text: selected source");
  });

  it("supports AI_MAX_OUTPUT_TOKENS override, clamps bounds, falls back on invalid values, and preserves provider payloadOptions", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "test-model");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "test-model");
    vi.stubEnv("AI_MAX_OUTPUT_TOKENS", "2048");

    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: "Token budget",
                    summary: "Configurable output ceiling.",
                    content: "Configured max_tokens applied.",
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await requestDeepSeekReply({ instruction: "Test custom max_tokens" });
    const customBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(customBody.max_tokens).toBe(2048);

    for (const invalid of ["", "not-a-number", "-100", "0", "1024.5"]) {
      vi.stubEnv("AI_MAX_OUTPUT_TOKENS", invalid);
      const payload = createDeepSeekPayload(
        { instruction: "Fallback check" },
        { payloadOptions: {} },
        "test-model",
        false,
      );
      expect(payload.max_tokens).toBe(4096);
    }

    vi.stubEnv("AI_MAX_OUTPUT_TOKENS", "100");
    expect(
      createDeepSeekPayload(
        { instruction: "Min clamp" },
        { payloadOptions: {} },
        "test-model",
        false,
      ).max_tokens,
    ).toBe(256);

    vi.stubEnv("AI_MAX_OUTPUT_TOKENS", "99999");
    expect(
      createDeepSeekPayload(
        { instruction: "Max clamp" },
        { payloadOptions: {} },
        "test-model",
        false,
      ).max_tokens,
    ).toBe(16_384);

    vi.stubEnv("AI_MAX_OUTPUT_TOKENS", "2048");
    expect(
      createDeepSeekPayload(
        { instruction: "Admin override" },
        { payloadOptions: { max_tokens: 8192 } },
        "test-model",
        false,
      ).max_tokens,
    ).toBe(8192);
  });

  it("accepts long structured replies exceeding 8,000 characters without failing validation", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "test-model");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "test-model");
    expect(MAX_REPLY_CONTENT_LENGTH).toBe(24_000);

    const longDerivation = `$$\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0}$$\n${"Step derivation detail. ".repeat(450)}`.trim();
    expect(longDerivation.length).toBeGreaterThan(10_000);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  title: "Gauss's Law Full Derivation",
                  summary: "Complete integral-to-differential derivation.",
                  content: longDerivation,
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const reply = await requestDeepSeekReply({
      instruction: "Give a thorough derivation of Gauss's law",
    });

    expect(reply).toEqual({
      title: "Gauss's Law Full Derivation",
      summary: "Complete integral-to-differential derivation.",
      content: longDerivation,
    });
  });

  it("recovers partial JSON fields and appends a truncation notice on non-streaming finish_reason === 'length'", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "test-model");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "test-model");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "length",
                message: {
                  content:
                    '{"title":"Matrix Calculus","summary":"Chain rule proof","content":"Step 1: Let $J_f$ denote the Jacobian matrix',
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "length",
                message: {
                  content:
                    '{"title":"高斯定律推导","summary":"从通量积分推导散度形式","content":"第一步：由散度定理可知闭合曲面积分等于体积分',
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const englishReply = await requestDeepSeekReply({
      instruction: "Derive the matrix chain rule",
    });
    expect(englishReply).toEqual({
      title: "Matrix Calculus",
      summary: "Chain rule proof",
      content:
        "Step 1: Let $J_f$ denote the Jacobian matrix\n\n*(Response reached the output token limit; ask a follow-up to continue.)*",
    });

    const chineseReply = await requestDeepSeekReply({
      instruction: "请推导高斯定律的微分形式",
    });
    expect(chineseReply).toEqual({
      title: "高斯定律推导",
      summary: "从通量积分推导散度形式",
      content:
        "第一步：由散度定理可知闭合曲面积分等于体积分\n\n*（回答已达单次输出长度上限，可继续追问展开后续内容。）*",
    });

    expect(appendLengthTruncationNotice(englishReply.content)).toBe(
      englishReply.content,
    );
    expect(appendLengthTruncationNotice(chineseReply.content)).toBe(
      chineseReply.content,
    );
  });

  it("includes retrieved PDF context in node reply prompts", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "test-model");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "test-model");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "PDF answer",
                  summary: "Uses PDF context.",
                  content: "The attached PDF discusses retrieval cues [[cite:1]].",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const reply = await requestDeepSeekReply({
      instruction: "Summarize the attached PDF.",
      documentContexts: [
        {
          documentId: "doc_memory",
          fileName: "memory.pdf",
          title: "Memory Systems",
          snippets: [
            {
              chunkId: "chunk_memory",
              pageStart: 3,
              pageEnd: 3,
              headingPath: ["Chapter 1", "Retrieval"],
              content: "Retrieval cues help long term memory recall.",
            },
          ],
        },
      ],
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.messages[0].content).toContain(
      "When retrieved PDF context is provided",
    );
    expect(requestBody.messages[0].content).toContain("[[cite:N]]");
    expect(requestBody.messages[1].content).toContain("Retrieved PDF context:");
    expect(requestBody.messages[1].content).toContain("PDF: memory.pdf (Memory Systems)");
    expect(requestBody.messages[1].content).not.toContain("Document outline (structural map only");
    expect(requestBody.messages[1].content).toContain(
      "[source 1; cite as [[cite:1]]] p. 3 | Chapter 1 > Retrieval | chunk chunk_memory",
    );
    expect(requestBody.messages[1].content).toContain(
      "Retrieval cues help long term memory recall.",
    );
    expect(reply.citations).toEqual([
      expect.objectContaining({
        index: 1,
        documentId: "doc_memory",
        documentName: "Memory Systems",
        chunkId: "chunk_memory",
        pageStart: 3,
        pageEnd: 3,
      }),
    ]);
  });

  it("renders ChatDocumentContext.outline alongside numbered snippets without adding outline to citations", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "test-model");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "test-model");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Chapter 2 Overview",
                  summary: "Contextualizes Retrieval within the textbook structure.",
                  content:
                    "Following the Chapter 1 foundations, Retrieval is covered in Chapter 2 [[cite:1]].",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const outline = [
      "- Chapter 1: Encoding (pp. 1-2)",
      "- Chapter 2: Retrieval (pp. 3-6)",
      "  - 2.1 Retrieval Cues (pp. 3-4)",
    ].join("\n");

    const reply = await requestDeepSeekReply({
      instruction: "How is the PDF structured around retrieval cues?",
      documentContexts: [
        {
          documentId: "doc_memory",
          fileName: "memory.pdf",
          title: "Memory Systems",
          outline,
          snippets: [
            {
              chunkId: "chunk_memory",
              pageStart: 3,
              pageEnd: 3,
              headingPath: ["Chapter 2: Retrieval", "2.1 Retrieval Cues"],
              content: "Retrieval cues help long term memory recall.",
            },
          ],
        },
      ],
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.messages[0].content).toContain("document outline");
    expect(requestBody.messages[0].content).toContain("[[cite:N]]");
    expect(requestBody.messages[1].content).toContain(
      [
        "PDF: memory.pdf (Memory Systems)",
        "Document outline (structural map only — cite factual claims only from numbered snippets):",
        outline,
        "[source 1; cite as [[cite:1]]] p. 3 | Chapter 2: Retrieval > 2.1 Retrieval Cues | chunk chunk_memory",
        "Retrieval cues help long term memory recall.",
      ].join("\n"),
    );
    expect(reply.citations).toHaveLength(1);
    expect(reply.citations).toEqual([
      expect.objectContaining({
        index: 1,
        documentId: "doc_memory",
        chunkId: "chunk_memory",
      }),
    ]);
  });

  it("includes attached course material in node reply prompts", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "test-model");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "test-model");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Course answer",
                  summary: "Uses course material.",
                  content: "Per the attached course, gradient descent follows the loss gradient.",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const reply = await requestDeepSeekReply({
      instruction: "How does gradient descent work?",
      curriculumContexts: [
        {
          curriculumId: "cur_dl",
          versionId: "ver_dl_1",
          title: "Deep Learning Foundations",
          versionLabel: "v1",
          outline: "- Foundations\n  - Optimization: Gradient descent basics.",
          snippets: [
            {
              chunkId: "chunk_gd",
              sourceId: "src_textbook",
              excerpt:
                "Gradient descent optimizes neural networks by following the loss gradient.",
              score: 1.5,
            },
          ],
        },
      ],
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.messages[0].content).toContain(
      "When course material is attached",
    );
    expect(requestBody.messages[0].content).not.toContain("[[cite:N]]");
    expect(requestBody.messages[1].content).toContain("Attached course material:");
    expect(requestBody.messages[1].content).toContain(
      "Course: Deep Learning Foundations (version v1)",
    );
    expect(requestBody.messages[1].content).toContain(
      "- Foundations\n  - Optimization: Gradient descent basics.",
    );
    expect(requestBody.messages[1].content).toContain("[excerpt 1 | chunk chunk_gd]");
    expect(requestBody.messages[1].content).toContain(
      "Gradient descent optimizes neural networks by following the loss gradient.",
    );
    // Course material never enters the [[cite:N]] catalog.
    expect(reply.citations).toBeUndefined();
  });

  it("accepts single-bracket PDF citation markers from model replies", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "test-model");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "test-model");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "PDF answer",
                  summary: "Uses PDF context.",
                  content: "The attached PDF discusses retrieval cues [cite:1].",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const reply = await requestDeepSeekReply({
      instruction: "Summarize the attached PDF.",
      documentContexts: [
        {
          documentId: "doc_memory",
          fileName: "memory.pdf",
          title: "Memory Systems",
          snippets: [
            {
              chunkId: "chunk_memory",
              pageStart: 3,
              pageEnd: 3,
              headingPath: ["Chapter 1", "Retrieval"],
              content: "Retrieval cues help long term memory recall.",
            },
          ],
        },
      ],
    });

    expect(reply.citations).toEqual([
      expect.objectContaining({
        index: 1,
        documentId: "doc_memory",
        documentName: "Memory Systems",
        chunkId: "chunk_memory",
      }),
    ]);
  });

  it("includes an active skill as a separate user message before the instruction", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "test-model");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "test-model");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Skill title",
                  summary: "Skill summary.",
                  content: "Skill content.",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await requestDeepSeekReply({
      instruction: "Explain trees",
      skill: {
        id: "skill_trees",
        name: "Tree Tutor",
        description: "Teaches like a patient tutor",
        instructions: "Use analogies from nature.",
        version: "v1",
      },
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.messages).toHaveLength(3);
    expect(requestBody.messages[0].role).toBe("system");
    expect(requestBody.messages[1].role).toBe("user");
    expect(requestBody.messages[1].content).toContain("Active skill customization:");
    expect(requestBody.messages[1].content).toContain("Tree Tutor");
    expect(requestBody.messages[1].content).toContain("Teaches like a patient tutor");
    expect(requestBody.messages[1].content).toContain("Use analogies from nature.");
    expect(requestBody.messages[2].role).toBe("user");
    expect(requestBody.messages[2].content).toContain("User instruction: Explain trees");
  });

  it("does not add a skill block when no skill is active", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "test-model");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "test-model");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "No skill",
                  summary: "No skill summary.",
                  content: "No skill content.",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await requestDeepSeekReply({ instruction: "Explain trees" });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.messages).toHaveLength(2);
    expect(requestBody.messages[0].role).toBe("system");
    expect(requestBody.messages[1].role).toBe("user");
    expect(requestBody.messages[1].content).not.toContain("Active skill customization");
  });

  it("uses a per-request provider and model selection", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Selected model",
                  summary: "Selected model summary",
                  content: "Selected model response.",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const reply = await requestDeepSeekReply({
      instruction: "Use the selected model",
      modelSelection: {
        providerId: "gemini",
        model: "gemini-3.5-flash",
      },
    });

    expect(reply.title).toBe("Selected model");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer gemini-key",
        }),
      }),
    );
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.model).toBe("gemini-3.5-flash");
  });

  it("rejects disallowed per-request model selections as client errors", async () => {
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "deepseek-chat");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestDeepSeekReply({
        instruction: "Use a blocked model",
        modelSelection: {
          providerId: "deepseek",
          model: "not-allowed",
        },
      }),
    ).rejects.toMatchObject({
      code: "DEEPSEEK_MODEL_NOT_ALLOWED",
      message: "Selected AI model is not allowed.",
      status: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries retryable upstream API failures once", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    const fetchMock = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { message: "quota exceeded" } }), {
            status: 429,
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestDeepSeekReply({ instruction: "Explain rate limits" }),
    ).rejects.toMatchObject({
      status: 429,
      message: "quota exceeded",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps 500, invalid JSON, and empty responses to stable DeepSeekError codes", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");

    const cases = [
      {
        response: new Response(JSON.stringify({ error: { message: "server down" } }), {
          status: 500,
        }),
        expected: { code: "DEEPSEEK_RETRYABLE_ERROR", status: 500 },
      },
      {
        response: new Response("not-json", { status: 200 }),
        expected: { code: "DEEPSEEK_INVALID_JSON", status: 502 },
      },
      {
        response: new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), {
          status: 200,
        }),
        expected: { code: "DEEPSEEK_EMPTY_RESPONSE", status: 502 },
      },
    ];

    for (const testCase of cases) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(() => Promise.resolve(testCase.response.clone())),
      );

      await expect(
        requestDeepSeekReply({ instruction: "Exercise error handling" }),
      ).rejects.toMatchObject(testCase.expected);
    }
  });

  it("maps aborted requests to timeout errors", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    await expect(
      requestDeepSeekReply({ instruction: "Exercise timeout handling" }),
    ).rejects.toMatchObject({
      code: "DEEPSEEK_TIMEOUT",
      status: 504,
    });
  });
});

function createSseChunk(
  content: string | null,
  finishReason: string | null = null,
) {
  return `data: ${JSON.stringify({
    choices: [
      {
        delta: content === null ? {} : { content },
        finish_reason: finishReason,
        index: 0,
      },
    ],
  })}\n\n`;
}

function createSseResponse(parts: string[]) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) {
          controller.enqueue(encoder.encode(part));
        }
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" }, status: 200 },
  );
}

async function collectStreamingEvents() {
  const events: DeepSeekStreamingEvent[] = [];

  for await (const event of streamDeepSeekReply({
    instruction: "Explain streaming",
  })) {
    events.push(event);
  }

  return events;
}

describe("streamDeepSeekReply", () => {
  it("streams only visible content deltas from split SSE JSON chunks", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "test-model");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "test-model");
    const rawReply = JSON.stringify({
      title: "Streaming title",
      summary: "Streaming summary",
      content: "Line one\nLine \"two\" and unicode: \u4f60\u597d",
    });
    const body = [
      createSseChunk(rawReply.slice(0, 18)),
      createSseChunk(rawReply.slice(18, 52)),
      createSseChunk(rawReply.slice(52)),
      "data: [DONE]\n\n",
    ].join("");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createSseResponse([body.slice(0, 41), body.slice(41, 103), body.slice(103)]),
      ),
    );

    const events = await collectStreamingEvents();
    const streamedContent = events
      .filter((event): event is Extract<DeepSeekStreamingEvent, { type: "delta" }> =>
        event.type === "delta",
      )
      .map((event) => event.contentDelta)
      .join("");
    const complete = events.find(
      (event): event is Extract<DeepSeekStreamingEvent, { type: "complete" }> =>
        event.type === "complete",
    );

    expect(streamedContent).toBe("Line one\nLine \"two\" and unicode: \u4f60\u597d");
    expect(complete?.reply).toMatchObject({
      title: "Streaming title",
      summary: "Streaming summary",
      content: streamedContent,
    });
  });

  it("does not emit an incomplete escaped JSON sequence", () => {
    expect(getJsonStringValuePrefix('{"content":"hello\\nwor', "content")).toMatchObject({
      complete: false,
      value: "hello\nwor",
    });
    expect(getJsonStringValuePrefix('{"content":"hello\\u4f', "content")).toMatchObject({
      complete: false,
      value: "hello",
    });
  });

  it("rejects invalid final streaming JSON", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "test-model");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "test-model");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          createSseResponse([createSseChunk('{"title":'), "data: [DONE]\n\n"]),
        ),
      ),
    );

    await expect(collectStreamingEvents()).rejects.toMatchObject({
      code: "DEEPSEEK_INVALID_STREAMING_JSON",
      status: 502,
    });
  });

  it("retries retryable upstream streaming failures before emitting deltas", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "test-model");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "test-model");
    const rawReply = JSON.stringify({
      title: "Retried stream",
      summary: "The retry succeeded.",
      content: "Recovered after an upstream failure.",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "try again" } }), {
          status: 502,
        }),
      )
      .mockResolvedValueOnce(
        createSseResponse([createSseChunk(rawReply), "data: [DONE]\n\n"]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const events = await collectStreamingEvents();
    const complete = events.find(
      (event): event is Extract<DeepSeekStreamingEvent, { type: "complete" }> =>
        event.type === "complete",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(complete?.reply).toMatchObject({
      title: "Retried stream",
      content: "Recovered after an upstream failure.",
    });
  });

  it("falls back to visible streamed content when final JSON is truncated", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "test-model");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "test-model");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createSseResponse([
          createSseChunk('{"title":"Recovered","summary":"Recovered","content":"Recovered body'),
          "data: [DONE]\n\n",
        ]),
      ),
    );

    const events = await collectStreamingEvents();
    const streamedContent = events
      .filter((event): event is Extract<DeepSeekStreamingEvent, { type: "delta" }> =>
        event.type === "delta",
      )
      .map((event) => event.contentDelta)
      .join("");
    const complete = events.find(
      (event): event is Extract<DeepSeekStreamingEvent, { type: "complete" }> =>
        event.type === "complete",
    );

    expect(streamedContent).toBe("Recovered body");
    expect(complete?.reply).toMatchObject({
      title: "Recovered",
      summary: "Recovered",
      content: "Recovered body",
    });
  });

  it("gracefully recovers mid-JSON streaming truncation when finish_reason is 'length'", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "test-model");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "test-model");

    const truncatedJson =
      '{"title":"Matrix Calculus","summary":"Chain rule proof","content":"Step 1: Let $\\\\mathbf{Y} = f(\\\\mathbf{X})$ and apply the total differential';
    const ssePayload = [
      createSseChunk(truncatedJson.slice(0, 45)),
      createSseChunk(truncatedJson.slice(45, 95)),
      createSseChunk(truncatedJson.slice(95)),
      createSseChunk(null, "length"),
      `data: ${JSON.stringify({ choices: [], usage: { completion_tokens: 4096 } })}\n\n`,
      "data: [DONE]\n\n",
    ].join("");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(createSseResponse([ssePayload])),
    );

    const events = await collectStreamingEvents();
    const deltas = events
      .filter((event): event is Extract<DeepSeekStreamingEvent, { type: "delta" }> =>
        event.type === "delta",
      )
      .map((event) => event.contentDelta);
    const streamedContent = deltas.join("");
    const complete = events.find(
      (event): event is Extract<DeepSeekStreamingEvent, { type: "complete" }> =>
        event.type === "complete",
    );

    const expectedNotice =
      "\n\n*(Response reached the output token limit; ask a follow-up to continue.)*";
    expect(deltas.at(-1)).toBe(expectedNotice);
    expect(streamedContent).toBe(
      `Step 1: Let $\\mathbf{Y} = f(\\mathbf{X})$ and apply the total differential${expectedNotice}`,
    );
    expect(complete?.reply).toEqual({
      title: "Matrix Calculus",
      summary: "Chain rule proof",
      content: streamedContent,
    });
  });

  it("streams CJK truncation notice and recovers when finish_reason is 'length' before content starts", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "test-model");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "test-model");

    const truncatedBeforeContent =
      '{"title":"矩阵微积分","summary":"雅可比矩阵链式法则推导';
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createSseResponse([
          createSseChunk(truncatedBeforeContent, "length"),
          "data: [DONE]\n\n",
        ]),
      ),
    );

    const events: DeepSeekStreamingEvent[] = [];
    for await (const event of streamDeepSeekReply({
      instruction: "请推导矩阵微积分链式法则",
    })) {
      events.push(event);
    }

    const streamedContent = events
      .filter((event): event is Extract<DeepSeekStreamingEvent, { type: "delta" }> =>
        event.type === "delta",
      )
      .map((event) => event.contentDelta)
      .join("");
    const complete = events.find(
      (event): event is Extract<DeepSeekStreamingEvent, { type: "complete" }> =>
        event.type === "complete",
    );

    expect(streamedContent).toBe(
      "雅可比矩阵链式法则推导\n\n*（回答已达单次输出长度上限，可继续追问展开后续内容。）*",
    );
    expect(complete?.reply).toEqual({
      title: "矩阵微积分",
      summary: "雅可比矩阵链式法则推导",
      content: streamedContent,
    });
  });

  it("streams long (> 8,000 char) valid JSON replies without failing schema validation", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "test-model");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "test-model");

    const longContent = "Detailed proof paragraph with $x^2 + y^2 = r^2$. ".repeat(220).trim();
    expect(longContent.length).toBeGreaterThan(10_000);
    const rawReply = JSON.stringify({
      title: "Long Streaming Derivation",
      summary: "Full proof streamed cleanly.",
      content: longContent,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createSseResponse([
          createSseChunk(rawReply.slice(0, 4000)),
          createSseChunk(rawReply.slice(4000), "stop"),
          "data: [DONE]\n\n",
        ]),
      ),
    );

    const events = await collectStreamingEvents();
    const streamedContent = events
      .filter((event): event is Extract<DeepSeekStreamingEvent, { type: "delta" }> =>
        event.type === "delta",
      )
      .map((event) => event.contentDelta)
      .join("");
    const complete = events.find(
      (event): event is Extract<DeepSeekStreamingEvent, { type: "complete" }> =>
        event.type === "complete",
    );

    expect(streamedContent).toBe(longContent);
    expect(complete?.reply).toEqual({
      title: "Long Streaming Derivation",
      summary: "Full proof streamed cleanly.",
      content: longContent,
    });
  });

  it("streams deterministic mock replies without calling DeepSeek", async () => {
    vi.stubEnv("AI_MOCK_MODE", "true");
    vi.stubEnv("DEEPSEEK_MOCK_STREAM_DELAY_MS", "0");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const events = await collectStreamingEvents();
    const streamedContent = events
      .filter((event): event is Extract<DeepSeekStreamingEvent, { type: "delta" }> =>
        event.type === "delta",
      )
      .map((event) => event.contentDelta)
      .join("");
    const complete = events.find(
      (event): event is Extract<DeepSeekStreamingEvent, { type: "complete" }> =>
        event.type === "complete",
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(streamedContent).toContain("Mock mode is enabled");
    expect(complete?.reply.content).toBe(streamedContent);
  });
});
