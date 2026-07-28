import { z } from "zod";

export const updateDocumentSchema = z.object({
  name: z.string().trim().min(1).max(240),
});
