import { describe, expect, it } from "vitest";
import { formatApiErrorMessage, formatRequestReference } from "@/lib/client/api";

describe("client API errors", () => {
  it("keeps specific server messages readable", () => {
    expect(
      formatApiErrorMessage(
        {
          error: {
            code: "PDF_TEXT_EMPTY",
            message: "This MVP only supports text-based PDFs.",
            requestId: "req_specific",
          },
        },
        422,
      ),
    ).toBe("This MVP only supports text-based PDFs. (Reference: req_specific)");
  });

  it("adds status, code, and request id to generic server errors", () => {
    expect(
      formatApiErrorMessage(
        {
          error: {
            code: "RAG_SUPABASE_ERROR",
            message: "Request failed.",
            requestId: "req_generic",
          },
        },
        500,
      ),
    ).toBe("Request failed. (HTTP 500, RAG_SUPABASE_ERROR, requestId: req_generic)");
  });

  it("formats request references for user-facing PDF failure cards", () => {
    expect(formatRequestReference("req_pdf_failed")).toBe("Reference: req_pdf_failed");
    expect(formatRequestReference(null)).toBeNull();
  });
});
