import { z } from "zod";
import { MAX_CHAT_ATTACHMENTS } from "@/lib/chat-attachments";
import {
  MAX_CHAT_SKILL_DESCRIPTION_LENGTH,
  MAX_CHAT_SKILL_INSTRUCTIONS_LENGTH,
  MAX_CHAT_SKILL_NAME_LENGTH,
} from "@/lib/chat-skills";

const documentStatusSchema = z.enum([
  "queued",
  "uploaded",
  "parsing",
  "parsed",
  "indexing",
  "indexed",
  "failed",
]);

export const chatAttachmentSchema = z.object({
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
  errorRequestId: z.string().trim().max(160).nullable().optional(),
});

export const chatCitationSchema = z.object({
  index: z.number().int().min(1).max(999),
  documentId: z.string().trim().min(1).max(160),
  documentName: z.string().trim().min(1).max(260),
  chunkId: z.string().trim().min(1).max(160),
  pageStart: z.number().int().min(1),
  pageEnd: z.number().int().min(1),
  headingPath: z.array(z.string().trim().min(1).max(180)).max(8).default([]),
  quote: z.string().trim().min(1).max(700),
});

export const chatModelSelectionSchema = z.object({
  providerId: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(120),
});

export const chatSkillSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(MAX_CHAT_SKILL_NAME_LENGTH),
  description: z.string().trim().max(MAX_CHAT_SKILL_DESCRIPTION_LENGTH),
  instructions: z.string().trim().min(1).max(MAX_CHAT_SKILL_INSTRUCTIONS_LENGTH),
  version: z.string().trim().min(1).max(80),
});

export const createNodeSchema = z.object({
  parentId: z.string().trim().min(1),
  mode: z.enum(["continue", "branch"]),
  instruction: z.string().trim().min(1).max(1_500),
  sourceText: z.string().trim().max(4_000).optional(),
  attachments: z.array(chatAttachmentSchema).max(MAX_CHAT_ATTACHMENTS).optional().default([]),
  modelSelection: chatModelSelectionSchema.optional(),
  skill: chatSkillSchema.optional(),
});

export const createBlankNodeSchema = z.object({
  parentId: z.string().trim().min(1),
  mode: z.enum(["continue", "branch"]),
  blank: z.literal(true),
  nodeId: z.string().trim().min(1).max(160).optional(),
});

export const createNodeRequestSchema = z.union([
  createBlankNodeSchema,
  createNodeSchema,
]);

export const populateBlankNodeSchema = z.object({
  instruction: z.string().trim().min(1).max(1_500),
  attachments: z.array(chatAttachmentSchema).max(MAX_CHAT_ATTACHMENTS).optional().default([]),
  modelSelection: chatModelSelectionSchema.optional(),
  skill: chatSkillSchema.optional(),
});

export const regenerateNodeSchema = z
  .object({
    instruction: z.string().trim().min(1).max(1_500).optional(),
    userMessageId: z.string().trim().min(1).optional(),
    assistantMessageId: z.string().trim().min(1).optional(),
    modelSelection: chatModelSelectionSchema.optional(),
    skill: chatSkillSchema.optional(),
  })
  .refine(
    (body) => Boolean(body.instruction || body.userMessageId || body.assistantMessageId),
    "Choose a message to edit or retry.",
  );

export const CREATE_NODE_LIMIT = 10;
export const CREATE_NODE_WINDOW_MS = 60_000;
