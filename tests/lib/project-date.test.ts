import { describe, expect, it } from "vitest";
import { createProjectDateFormatter, formatProjectDate } from "@/lib/project-date";

const updatedAt = "2026-07-29T12:34:56.000Z";

describe("project date formatting", () => {
  it("formats dates in English for the English interface", () => {
    const formatter = createProjectDateFormatter("en");
    expect(formatProjectDate(updatedAt, formatter)).toBe("Jul 29, 2026");
  });

  it("formats dates in Chinese for the Chinese interface", () => {
    const formatter = createProjectDateFormatter("zh");
    expect(formatProjectDate(updatedAt, formatter)).toBe("2026年7月29日");
  });

  it("returns Unknown for invalid dates", () => {
    const formatter = createProjectDateFormatter("en");
    expect(formatProjectDate("not-a-date", formatter)).toBe("Unknown");
  });
});
