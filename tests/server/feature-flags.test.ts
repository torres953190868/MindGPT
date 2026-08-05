import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isCurriculumAgentEnabled,
  isTutorAgentEnabled,
} from "@/lib/server/feature-flags";

describe("feature flags", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to disabled when the env vars are unset or empty", () => {
    vi.stubEnv("ENABLE_CURRICULUM_AGENT", "");
    vi.stubEnv("ENABLE_TUTOR_AGENT", "");

    expect(isCurriculumAgentEnabled()).toBe(false);
    expect(isTutorAgentEnabled()).toBe(false);
  });

  it.each(["1", "true", "TRUE", " yes ", "on", "On"])(
    'treats "%s" as enabled',
    (value) => {
      vi.stubEnv("ENABLE_CURRICULUM_AGENT", value);
      vi.stubEnv("ENABLE_TUTOR_AGENT", value);

      expect(isCurriculumAgentEnabled()).toBe(true);
      expect(isTutorAgentEnabled()).toBe(true);
    },
  );

  it.each(["0", "false", "no", "off", "2", "enabled"])(
    'treats "%s" as disabled',
    (value) => {
      vi.stubEnv("ENABLE_CURRICULUM_AGENT", value);
      vi.stubEnv("ENABLE_TUTOR_AGENT", value);

      expect(isCurriculumAgentEnabled()).toBe(false);
      expect(isTutorAgentEnabled()).toBe(false);
    },
  );

  it("toggles the two flags independently", () => {
    vi.stubEnv("ENABLE_CURRICULUM_AGENT", "true");
    vi.stubEnv("ENABLE_TUTOR_AGENT", "false");

    expect(isCurriculumAgentEnabled()).toBe(true);
    expect(isTutorAgentEnabled()).toBe(false);
  });
});
