import { z } from "zod";

export const PROJECT_NOTES_MAX_LENGTH = 60_000;

export const updateProjectSchema = z.object({
  notes: z.string().max(PROJECT_NOTES_MAX_LENGTH).optional(),
});
