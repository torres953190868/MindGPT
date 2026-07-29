import { afterEach, describe, expect, it, vi } from "vitest";
import { patchAccountLanguage } from "@/lib/client/language-preference";

const accountPayload = {
  email: null,
  accountName: "learner",
  displayName: "Learner",
  languagePreference: "en",
  authMode: "supabase",
  authConfigured: true,
  plan: "free",
  subscriptionStatus: "inactive",
  usage: {
    projects: { used: 0, limit: 5 },
    nodes: { used: 0, limit: 100 },
    documents: { used: 0, limit: 3 },
    aiMessages: { used: 0, limit: 50 },
  },
};

describe("patchAccountLanguage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves the preference with a keepalive PATCH so it survives page unload", async () => {
    const fetchMock = vi.fn(async () => Response.json(accountPayload));
    vi.stubGlobal("fetch", fetchMock);

    const account = await patchAccountLanguage("en");

    expect(fetchMock).toHaveBeenCalledWith("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ languagePreference: "en" }),
      keepalive: true,
    });
    expect(account).toMatchObject({ languagePreference: "en" });
  });

  it("throws when the save fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({}, { status: 500 })),
    );

    await expect(patchAccountLanguage("zh")).rejects.toThrow(
      "Language preference could not be saved.",
    );
  });
});
