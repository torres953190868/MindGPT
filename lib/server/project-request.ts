import { z } from "zod";
import { PROJECT_NOTES_MAX_LENGTH } from "@/lib/project-notes";

export { PROJECT_NOTES_MAX_LENGTH };

export const updateProjectSchema = z.object({
  notes: z.string().max(PROJECT_NOTES_MAX_LENGTH).optional(),
});
