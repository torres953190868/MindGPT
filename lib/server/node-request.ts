import { z } from "zod";
import { MAX_CHAT_ATTACHMENTS } from "@/lib/chat-attachments";

const documentStatusSchema = z.enum([
  "uploaded",
  "parsing",
  "parsed",
  "indexing",
  "indexed",
  "failed",
]);

const chatAttachmentSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(240),
  mimeType: z.string().trim().max(120),
  size: z.number().int().nonnegative(),
  createdAt: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid attachment timestamp."),
  documentId: z.string().trim().min(1).max(120).optional(),
  documentStatus: documentStatusSchema.optional(),
  errorMessage: z.string().trim().max(500).nullable().optional(),
});

export const chatModelSelectionSchema = z.object({
  providerId: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(120),
});

export const createNodeSchema = z.object({
  parentId: z.string().trim().min(1),
  mode: z.enum(["continue", "branch"]),
  instruction: z.string().trim().min(1).max(1_500),
  sourceText: z.string().trim().max(4_000).optional(),
  attachments: z.array(chatAttachmentSchema).max(MAX_CHAT_ATTACHMENTS).optional().default([]),
  modelSelection: chatModelSelectionSchema.optional(),
});

export const regenerateNodeSchema = z
  .object({
    instruction: z.string().trim().min(1).max(1_500).optional(),
    userMessageId: z.string().trim().min(1).optional(),
    assistantMessageId: z.string().trim().min(1).optional(),
    modelSelection: chatModelSelectionSchema.optional(),
  })
  .refine(
    (body) => Boolean(body.instruction || body.userMessageId || body.assistantMessageId),
    "Choose a message to edit or retry.",
  );

export const CREATE_NODE_LIMIT = 10;
export const CREATE_NODE_WINDOW_MS = 60_000;
