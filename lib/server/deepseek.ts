import {
  createDeepSeekPayload,
  delay,
  DeepSeekError,
  getDeepSeekContent,
  getMockReply,
  isAbortError,
  isDeepSeekMockMode,
  MAX_DEEPSEEK_ATTEMPTS,
  parseDeepSeekResponse,
  parseReply,
  RETRY_DELAY_MS,
  type BranchMindReplyRequest,
  createProviderHttpError,
  withReplyCitations,
} from "@/lib/server/deepseek-core";
import {
  getLlmProviderApiKey,
  getLlmRequestTimeoutMs,
  resolveLlmCandidates,
  type LlmRuntimeProvider,
} from "@/lib/server/llm-router";

export { DeepSeekError, type BranchMindReplyRequest };

async function fetchDeepSeek(
  body: BranchMindReplyRequest,
  provider: LlmRuntimeProvider,
  apiKey: string,
  model: string,
) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    getLlmRequestTimeoutMs(provider),
  );

  try {
    return await fetch(provider.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(createDeepSeekPayload(body, provider, model, false)),
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new DeepSeekError(`${provider.displayName} request timed out.`, 504, {
        code: `${provider.errorCodePrefix}_TIMEOUT`,
        expose: true,
        retryable: true,
      });
    }

    throw new DeepSeekError(`${provider.displayName} API request failed.`, 502, {
      code: `${provider.errorCodePrefix}_NETWORK_ERROR`,
      retryable: true,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readDeepSeekResponse(response: Response) {
  const data = (await response.json().catch(() => null)) as unknown;

  if (data === null) {
    throw new DeepSeekError("DeepSeek returned invalid JSON.", 502, {
      code: "DEEPSEEK_INVALID_JSON",
      retryable: true,
    });
  }

  return parseDeepSeekResponse(data);
}

export async function requestDeepSeekReply(
  body: BranchMindReplyRequest,
): Promise<ReturnType<typeof getMockReply>> {
  if (isDeepSeekMockMode()) {
    return getMockReply(body);
  }

  let lastError: DeepSeekError | null = null;
  const candidates = await resolveLlmCandidates(
    body.llmTask ?? "branch_chat",
    body.modelSelection,
    { requireJson: true, accountPlan: body.userPlan },
  );

  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const candidate = candidates[candidateIndex];
    const provider = candidate.provider;
    const model = candidate.model.model;
    const apiKey = getLlmProviderApiKey(provider);
    if (!apiKey) {
      throw new DeepSeekError(`${provider.apiKeyEnv} is not configured.`, 500, {
        code: `${provider.errorCodePrefix}_NOT_CONFIGURED`,
      });
    }

    for (let attempt = 1; attempt <= MAX_DEEPSEEK_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetchDeepSeek(body, provider, apiKey, model);
        const data = await readDeepSeekResponse(response);

        if (!response.ok) {
          throw createProviderHttpError(provider, response, data);
        }

        const content = getDeepSeekContent(data);
        if (!content) {
          throw new DeepSeekError(`${provider.displayName} returned an empty response.`, 502, {
            code: `${provider.errorCodePrefix}_EMPTY_RESPONSE`,
            retryable: true,
          });
        }

        return withReplyCitations(
          parseReply(content, body.instruction),
          body.documentContexts,
        );
      } catch (error) {
        if (!(error instanceof DeepSeekError)) throw error;
        lastError = error;

        if (!error.retryable) throw error;
        if (attempt < MAX_DEEPSEEK_ATTEMPTS) {
          await delay(RETRY_DELAY_MS);
          continue;
        }

        if (candidateIndex >= candidates.length - 1) {
          throw error;
        }
      }
    }
  }

  throw lastError ?? new DeepSeekError("DeepSeek API call failed.");
}
