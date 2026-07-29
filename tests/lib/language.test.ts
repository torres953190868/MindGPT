import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANGUAGE,
  getBranchMindLanguage,
  getHtmlLanguage,
  isBranchMindLanguage,
  resolveAccountLanguage,
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

describe("resolveAccountLanguage", () => {
  it("applies the account preference when nothing is stored locally", () => {
    expect(resolveAccountLanguage("en", null)).toEqual({
      language: "en",
      shouldSyncAccount: false,
    });
  });

  it("keeps the stored local choice and asks for an account re-sync", () => {
    expect(resolveAccountLanguage("zh", "en")).toEqual({
      language: "en",
      shouldSyncAccount: true,
    });
    expect(resolveAccountLanguage("en", "zh")).toEqual({
      language: "zh",
      shouldSyncAccount: true,
    });
  });

  it("does not re-sync when the account already matches the stored choice", () => {
    expect(resolveAccountLanguage("en", "en")).toEqual({
      language: "en",
      shouldSyncAccount: false,
    });
  });

  it("treats an invalid stored value as no local choice", () => {
    expect(resolveAccountLanguage("en", "fr")).toEqual({
      language: "en",
      shouldSyncAccount: false,
    });
  });

  it("keeps the stored choice when the account preference is unknown", () => {
    expect(resolveAccountLanguage(undefined, "en")).toEqual({
      language: "en",
      shouldSyncAccount: true,
    });
  });

  it("falls back to the default language when both values are unknown", () => {
    expect(resolveAccountLanguage("fr", null)).toEqual({
      language: DEFAULT_LANGUAGE,
      shouldSyncAccount: false,
    });
  });
});
