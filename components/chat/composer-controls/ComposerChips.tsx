"use client";

import { BookOpen, Loader2, Paperclip, Sparkles, X } from "lucide-react";
import { useLanguage } from "@/components/language/LanguageProvider";
import type { ChatSkill } from "@/lib/types";
import {
  getAttachmentDetailLabel,
  getPendingAttachmentStatusLabel,
  isKnowledgeAttachment,
} from "./attachment-helpers";
import type { PendingChatAttachment } from "./types";

export function ActiveSkillChip({
  skill,
  disabled,
  onRemove,
}: {
  skill: ChatSkill;
  disabled: boolean;
  onRemove: () => void;
}) {
  const { copy } = useLanguage();

  return (
    <div
      aria-label={`${copy.chat.skillActive}: ${skill.name}`}
      data-testid="active-skill-chip"
      className="inline-flex max-w-full items-center gap-2 rounded-full border border-brand-200 bg-brand-50/70 px-3 py-1.5 text-xs font-bold text-brand-800"
    >
      <Sparkles size={14} className="shrink-0" />
      <span className="min-w-0 truncate">{skill.name}</span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={copy.chat.skillRemove}
        data-testid="remove-active-skill-button"
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-brand-700 transition hover:bg-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <X size={13} />
      </button>
    </div>
  );
}

export function PendingAttachmentChips({
  attachments,
  disabled,
  onRemove,
}: {
  attachments: PendingChatAttachment[];
  disabled: boolean;
  onRemove: (attachmentId: string) => void;
}) {
  const { copy } = useLanguage();

  if (attachments.length === 0) return null;

  return (
    <ul
      aria-label={copy.chat.pendingAttachments}
      data-testid="pending-attachment-list"
      className="flex flex-wrap gap-2"
    >
      {attachments.map((attachment) => (
        <li
          key={attachment.id}
          data-testid="pending-attachment-chip"
          className="inline-flex max-w-full items-center gap-2 rounded-full bg-white/75 px-3 py-1.5 text-xs font-bold text-neutral-700"
        >
          {attachment.uploadStatus === "uploading" ||
          attachment.uploadStatus === "queued" ||
          attachment.uploadStatus === "indexing" ? (
            <Loader2 size={14} className="shrink-0 animate-spin" />
          ) : isKnowledgeAttachment(attachment) ? (
            <BookOpen size={14} className="shrink-0" />
          ) : (
            <Paperclip size={14} className="shrink-0" />
          )}
          <span className="min-w-0 truncate">{attachment.name}</span>
          <span className="shrink-0 opacity-65">
            {getAttachmentDetailLabel(attachment, {
              knowledgePdf: copy.chat.knowledgePdf,
              knowledgeCurriculum: copy.chat.knowledgeCurriculum,
              unknownType: copy.chat.unknownType,
            })}
          </span>
          {getPendingAttachmentStatusLabel(attachment, {
            failed: copy.chat.failed,
            indexed: copy.chat.indexed,
            ingesting: copy.chat.ingesting,
            uploading: copy.chat.uploading,
          }) && (
            <span className="shrink-0 text-brand-700">
              {getPendingAttachmentStatusLabel(attachment, {
                failed: copy.chat.failed,
                indexed: copy.chat.indexed,
                ingesting: copy.chat.ingesting,
                uploading: copy.chat.uploading,
              })}
            </span>
          )}
          {attachment.uploadStatus === "failed" && attachment.errorRequestId && (
            <span className="max-w-36 shrink truncate font-mono text-[11px] text-danger-600">
              Ref: {attachment.errorRequestId}
            </span>
          )}
          <button
            type="button"
            onClick={() => onRemove(attachment.id)}
            disabled={disabled}
            aria-label={`${copy.common.close} ${attachment.name}`}
            data-testid="remove-pending-attachment-button"
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-neutral-600 transition hover:bg-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={13} />
          </button>
        </li>
      ))}
    </ul>
  );
}
