// searchProjectDocuments tool for the CurriculumBuilderAgent (spec §3.6).
// Read-only retrieval over the PDFs the owner already uploaded, reusing the
// existing owner-scoped RAG (lib/server/rag/service.ts). Permission is
// re-checked server-side on EVERY call (spec §11.3): the default searcher
// verifies the project belongs to the owner before searching, regardless of
// what the agent context claims. Returns only the necessary snippets with
// file id / page range / chunk id for citation.

import { z } from "zod";
import { toolError, toolOk, type ToolResult } from "@/lib/agents/curriculum-builder/tools/tool-result";
import { readProjectsForSession } from "@/lib/server/projects-repository";
import {
  getWorkspaceDocumentContextsForOwner,
  listDocumentsForOwner,
} from "@/lib/server/rag/service";
import type { ChatAttachment } from "@/lib/types";

export const PROJECT_DOCUMENTS_TOOL_LIMITS = {
  maxTopK: 10,
  defaultTopK: 5,
  maxDocuments: 3,
} as const;

export const searchProjectDocumentsToolInputSchema = z.object({
  projectId: z.string().trim().min(1).max(120),
  query: z.string().trim().min(1).max(300),
  topK: z.number().int().positive().max(PROJECT_DOCUMENTS_TOOL_LIMITS.maxTopK).optional(),
});
export type SearchProjectDocumentsToolInput = z.infer<
  typeof searchProjectDocumentsToolInputSchema
>;

export type ProjectDocumentSnippet = {
  documentId: string;
  fileName: string;
  chunkId: string;
  pageStart: number;
  pageEnd: number;
  excerpt: string;
  score: number;
};

export type ProjectDocumentsSearcher = (input: {
  ownerId: string;
  projectId: string;
  query: string;
  topK: number;
}) => Promise<ProjectDocumentSnippet[]>;

export class ProjectDocumentsSearchError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ProjectDocumentsSearchError";
    this.code = code;
  }
}

// Default searcher: owner check first (a forged projectId yields
// PROJECT_NOT_FOUND, indistinguishable from a missing one), then owner-scoped
// RAG retrieval over the owner's indexed documents. Note the RAG store has no
// project linkage yet, so the owner's indexed PDFs stand in for the project's
// documents — owner scoping is the permission boundary either way (same
// approach as SourceContentService.searchCourseSources).
export function createDefaultProjectDocumentsSearcher(): ProjectDocumentsSearcher {
  return async ({ ownerId, projectId, query, topK }) => {
    const projects = await readProjectsForSession(ownerId);
    if (!projects.some((project) => project.id === projectId)) {
      throw new ProjectDocumentsSearchError(
        "Project was not found.",
        "PROJECT_NOT_FOUND",
      );
    }

    const documents = (await listDocumentsForOwner(ownerId))
      .filter((document) => document.status === "indexed")
      .slice(0, PROJECT_DOCUMENTS_TOOL_LIMITS.maxDocuments);
    if (documents.length === 0) return [];

    const attachments: ChatAttachment[] = documents.map((document) => ({
      id: `curriculum-tool-${document.id}`,
      name: document.fileName,
      mimeType: "application/pdf",
      size: 0,
      createdAt: document.createdAt,
      documentId: document.id,
    }));
    const contexts = await getWorkspaceDocumentContextsForOwner(ownerId, attachments, query);

    return contexts
      .flatMap((context) =>
        context.snippets.map((snippet) => ({
          documentId: context.documentId,
          fileName: context.fileName,
          chunkId: snippet.chunkId,
          pageStart: snippet.pageStart,
          pageEnd: snippet.pageEnd,
          excerpt: snippet.content,
          score: snippet.score ?? 0,
        })),
      )
      .slice(0, topK);
  };
}

export type SearchProjectDocumentsToolDeps = {
  ownerId: string;
  searcher: ProjectDocumentsSearcher;
};

export async function executeSearchProjectDocumentsTool(
  rawInput: SearchProjectDocumentsToolInput,
  deps: SearchProjectDocumentsToolDeps,
): Promise<ToolResult<{ snippets: ProjectDocumentSnippet[] }>> {
  const input = searchProjectDocumentsToolInputSchema.parse(rawInput);
  const topK = input.topK ?? PROJECT_DOCUMENTS_TOOL_LIMITS.defaultTopK;

  try {
    const snippets = await deps.searcher({
      ownerId: deps.ownerId,
      projectId: input.projectId,
      query: input.query,
      topK,
    });
    return toolOk({ snippets });
  } catch (error) {
    if (error instanceof ProjectDocumentsSearchError) {
      return toolError(error.code, error.message);
    }
    return toolError(
      "PROJECT_DOCUMENTS_SEARCH_FAILED",
      error instanceof Error ? error.message : "Searching project documents failed.",
    );
  }
}
