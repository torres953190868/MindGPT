import { z } from "zod";
import { MAX_CHAT_ATTACHMENTS } from "@/lib/chat-attachments";
import { PROJECT_NOTES_MAX_LENGTH } from "@/lib/project-notes";
import {
  chatAttachmentSchema,
  chatCitationSchema,
  chatModelSelectionSchema,
  chatSkillSchema,
} from "@/lib/server/node-request";

export { PROJECT_NOTES_MAX_LENGTH };

export const updateProjectSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  notes: z.string().max(PROJECT_NOTES_MAX_LENGTH).optional(),
});

export const createProjectSchema = z.object({
  topic: z.string().trim().min(1).max(600),
  attachments: z.array(chatAttachmentSchema).max(MAX_CHAT_ATTACHMENTS).optional().default([]),
  modelSelection: chatModelSelectionSchema.optional(),
  skill: chatSkillSchema.optional(),
});

const isoDateStringSchema = z.string().refine(
  (value) => !Number.isNaN(Date.parse(value)),
  "Expected an ISO date string.",
);

const nodePositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

const chatMessageSchema = z.object({
  id: z.string().trim().min(1).max(160),
  role: z.enum(["user", "assistant"]),
  content: z.string().max(120_000),
  attachments: z.array(chatAttachmentSchema).max(MAX_CHAT_ATTACHMENTS).default([]),
  citations: z.array(chatCitationSchema).max(30).optional().default([]),
  createdAt: isoDateStringSchema,
});

const mindNodeSchema = z.object({
  id: z.string().trim().min(1).max(160),
  projectId: z.string().trim().min(1).max(160),
  parentId: z.string().trim().min(1).max(160).nullable(),
  title: z.string().trim().min(1).max(600),
  titleManuallyEdited: z.boolean().optional().default(false),
  summary: z.string().max(2_000),
  messages: z.array(chatMessageSchema).max(80),
  children: z.array(z.string().trim().min(1).max(160)).max(200),
  position: nodePositionSchema,
  branchType: z.enum(["root", "continue", "branch"]),
  collapsed: z.boolean(),
  createdAt: isoDateStringSchema,
  updatedAt: isoDateStringSchema,
});

export const syncProjectSchema = z.object({
  project: z.object({
    id: z.string().trim().min(1).max(160),
    ownerSessionId: z.string().optional(),
    title: z.string().trim().min(1).max(600),
    notes: z.string().max(PROJECT_NOTES_MAX_LENGTH).default(""),
    rootNodeId: z.string().trim().min(1).max(160),
    nodes: z.record(z.string(), mindNodeSchema),
    createdAt: isoDateStringSchema,
    updatedAt: isoDateStringSchema,
  }),
});
