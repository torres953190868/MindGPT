import { describe, expect, it, vi } from "vitest";

const captureException = vi.hoisted(() => vi.fn());

vi.mock("@sentry/nextjs", () => ({ captureException }));

import { logApiError } from "@/lib/server/http";

describe("logApiError Sentry reporting", () => {
  it("reports 5xx errors with the request id and identifiers only", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = Object.assign(new Error("db down"), { code: "DB_WRITE_FAILED" });

    logApiError(error, 500, "req_123", { action: "stream-node", projectId: "project_1" });

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error, {
      tags: {
        request_id: "req_123",
        status_code: "500",
        error_code: "DB_WRITE_FAILED",
        action: "stream-node",
      },
    });
  });

  it("does not report client errors", () => {
    logApiError(new Error("bad input"), 400, "req_456");

    expect(captureException).not.toHaveBeenCalled();
  });
});
