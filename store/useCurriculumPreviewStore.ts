import { create } from "zustand";
import type {
  CurriculumDto,
  CurriculumVersionContentResponse,
  CurriculumVersionSummary,
} from "@/lib/client/curriculum-api";

export type CurriculumPreviewCacheEntry = {
  curriculum: CurriculumDto;
  versions: CurriculumVersionSummary[];
  contents: Record<string, CurriculumVersionContentResponse>;
};

type CurriculumPreviewStore = {
  entries: Record<string, CurriculumPreviewCacheEntry>;
  setOverview: (
    curriculumId: string,
    overview: {
      curriculum: CurriculumDto;
      versions: CurriculumVersionSummary[];
      defaultVersion: CurriculumVersionContentResponse | null;
    },
  ) => void;
  setContent: (curriculumId: string, content: CurriculumVersionContentResponse) => void;
  setVersionSummary: (curriculumId: string, version: CurriculumVersionSummary) => void;
};

export const useCurriculumPreviewStore = create<CurriculumPreviewStore>((set) => ({
  entries: {},
  setOverview: (curriculumId, overview) =>
    set((state) => {
      const previous = state.entries[curriculumId];
      const contents = { ...(previous?.contents ?? {}) };
      if (overview.defaultVersion) {
        contents[overview.defaultVersion.version.id] = overview.defaultVersion;
      }
      return {
        entries: {
          ...state.entries,
          [curriculumId]: {
            curriculum: overview.curriculum,
            versions: overview.versions,
            contents,
          },
        },
      };
    }),
  setContent: (curriculumId, content) =>
    set((state) => {
      const previous = state.entries[curriculumId];
      if (!previous) return state;
      return {
        entries: {
          ...state.entries,
          [curriculumId]: {
            ...previous,
            contents: { ...previous.contents, [content.version.id]: content },
          },
        },
      };
    }),
  setVersionSummary: (curriculumId, version) =>
    set((state) => {
      const previous = state.entries[curriculumId];
      if (!previous) return state;
      return {
        entries: {
          ...state.entries,
          [curriculumId]: {
            ...previous,
            versions: previous.versions.map((current) =>
              current.id === version.id ? version : current,
            ),
          },
        },
      };
    }),
}));
