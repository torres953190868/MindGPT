"use client";

import { create } from "zustand";
import type { CurriculumDto } from "@/lib/client/curriculum-api";

type CurriculumListState = {
  curricula: CurriculumDto[];
  hasLoaded: boolean;
  setCurricula: (curricula: CurriculumDto[]) => void;
};

export const useCurriculumListStore = create<CurriculumListState>((set) => ({
  curricula: [],
  hasLoaded: false,
  setCurricula: (curricula) => set({ curricula, hasLoaded: true }),
}));
