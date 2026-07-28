import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANGUAGE,
  getBranchMindLanguage,
  getHtmlLanguage,
  isBranchMindLanguage,
} from "@/lib/language";

describe("language preferences", () => {
  it("defaults to Chinese for unknown values", () => {
    expect(DEFAULT_LANGUAGE).toBe("zh");
    expect(getBranchMindLanguage(null)).toBe("zh");
    expect(getBranchMindLanguage("fr")).toBe("zh");
  });

  it("accepts supported languages and resolves html lang", () => {
    expect(isBranchMindLanguage("zh")).toBe(true);
    expect(isBranchMindLanguage("en")).toBe(true);
    expect(getHtmlLanguage("zh")).toBe("zh-CN");
    expect(getHtmlLanguage("en")).toBe("en");
  });
});
