import { z } from "zod";

export const createNodeSchema = z.object({
  parentId: z.string().trim().min(1),
  mode: z.enum(["continue", "branch"]),
  instruction: z.string().trim().min(1).max(1_500),
  sourceText: z.string().trim().max(4_000).optional(),
});

export const CREATE_NODE_LIMIT = 10;
export const CREATE_NODE_WINDOW_MS = 60_000;
