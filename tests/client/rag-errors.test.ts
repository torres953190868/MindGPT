import { describe, expect, it } from "vitest";
import { ApiRequestError } from "@/lib/client/api";
import {
  getRagRequestErrorMessage,
  getRagServiceErrorMessage,
} from "@/lib/client/rag-errors";

const copy = {
  serviceNotReady: "文档服务尚未完成初始化，请稍后重试或联系管理员。",
  serviceUnavailable: "文档服务暂时不可用，请稍后重试。",
};

describe("RAG reader error messages", () => {
  it("maps the Supabase schema error code to the localized setup message", () => {
    const error = new ApiRequestError(
      "Request failed. (HTTP 500, RAG_SUPABASE_SCHEMA_ERROR, requestId: req_schema)",
      {
        code: "RAG_SUPABASE_SCHEMA_ERROR",
        requestId: "req_schema",
        status: 500,
      },
    );

    expect(getRagRequestErrorMessage(error, "Upload failed.", copy)).toBe(
      copy.serviceNotReady,
    );
  });

  it("maps the generic Supabase error code to the localized unavailable message", () => {
    const error = new ApiRequestError("Request failed.", {
      code: "RAG_SUPABASE_ERROR",
      requestId: "req_generic",
      status: 500,
    });

    expect(getRagRequestErrorMessage(error, "Upload failed.", copy)).toBe(
      copy.serviceUnavailable,
    );
  });

  it("keeps the formatted message for other API error codes", () => {
    const error = new ApiRequestError("This PDF is too large. (Reference: req_large)", {
      code: "PDF_TOO_LARGE",
      requestId: "req_large",
      status: 413,
    });

    expect(getRagRequestErrorMessage(error, "Upload failed.", copy)).toBe(
      "This PDF is too large. (Reference: req_large)",
    );
  });

  it("falls back to the error message or fallback text for non-API errors", () => {
    expect(getRagRequestErrorMessage(new Error("boom"), "Upload failed.", copy)).toBe(
      "boom",
    );
    expect(getRagRequestErrorMessage("nope", "Upload failed.", copy)).toBe(
      "Upload failed.",
    );
  });

  it("maps stored document error codes and ignores others", () => {
    expect(getRagServiceErrorMessage("RAG_SUPABASE_SCHEMA_ERROR", copy)).toBe(
      copy.serviceNotReady,
    );
    expect(getRagServiceErrorMessage("RAG_SUPABASE_ERROR", copy)).toBe(
      copy.serviceUnavailable,
    );
    expect(getRagServiceErrorMessage("PDF_TEXT_EMPTY", copy)).toBeNull();
    expect(getRagServiceErrorMessage(null, copy)).toBeNull();
  });
});
