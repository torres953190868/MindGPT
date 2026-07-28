import { describe, expect, it } from "vitest";
import {
  MAX_BUG_SCREENSHOT_BYTES,
  normalizeBugReportInput,
  validateBugScreenshot,
} from "@/lib/server/bug-reports";

describe("bug report validation", () => {
  it("normalizes optional fields", () => {
    expect(
      normalizeBugReportInput({
        title: "  Broken node  ",
        description: "  It failed while streaming.  ",
        contactEmail: "",
        currentUrl: "  https://branchmind.example/workspace/123  ",
        userAgent: "",
      }),
    ).toEqual({
      title: "Broken node",
      description: "It failed while streaming.",
      contactEmail: null,
      currentUrl: "https://branchmind.example/workspace/123",
      userAgent: null,
    });
  });

  it("accepts one supported image screenshot", () => {
    const file = new File(["png"], "bug.png", { type: "image/png" });
    expect(validateBugScreenshot(file)).toBe(file);
  });

  it("rejects unsupported screenshot types and oversized files", () => {
    expect(() =>
      validateBugScreenshot(new File(["text"], "bug.txt", { type: "text/plain" })),
    ).toThrow("Screenshot must be a PNG, JPG, or WebP image.");

    const bytes = new Uint8Array(MAX_BUG_SCREENSHOT_BYTES + 1);
    expect(() =>
      validateBugScreenshot(new File([bytes], "bug.png", { type: "image/png" })),
    ).toThrow("Screenshot must be 5 MB or smaller.");
  });
});
