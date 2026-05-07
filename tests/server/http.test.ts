import { describe, expect, it } from "vitest";
import {
  createApiErrorBody,
  getSafeErrorMessage,
  getSafeErrorStatus,
} from "@/lib/server/http";

describe("API error helpers", () => {
  it("puts requestId inside the public error object", () => {
    expect(createApiErrorBody("Bad input.", 400, "req_public_contract")).toEqual({
      error: {
        code: "BAD_REQUEST",
        message: "Bad input.",
        requestId: "req_public_contract",
      },
    });
  });

  it("allows only HTTP error status codes through", () => {
    expect(getSafeErrorStatus({ status: 400 })).toBe(400);
    expect(getSafeErrorStatus({ status: "429" })).toBe(429);
    expect(getSafeErrorStatus({ status: 599 })).toBe(599);
    expect(getSafeErrorStatus({ status: 302 })).toBe(500);
    expect(getSafeErrorStatus({ status: 600 })).toBe(500);
    expect(getSafeErrorStatus(null)).toBe(500);
  });

  it("does not leak upstream error details to clients", () => {
    expect(getSafeErrorMessage(429)).toBe("Too many requests.");
    expect(getSafeErrorMessage(500)).toBe("Request failed.");
    expect(getSafeErrorMessage(400)).toBe("Request failed.");
  });
});
