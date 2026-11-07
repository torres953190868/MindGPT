"use client";

import { useRef } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  Check,
  ChevronRight,
  GraduationCap,
  Loader2,
  Plus,
  Sparkles,
  Upload,
} from "lucide-react";
import { useLanguage } from "@/components/language/LanguageProvider";
import {
  getHighlightedActionClass,
  useHighlightedAction,
} from "@/components/ui/highlighted-action";
import { isDefaultChatSkill } from "@/lib/chat-skills";
import {
  getMenuPlacementClass,
  stopFloatingMenuWheelPropagation,
  useFloatingSubmenuPosition,
} from "./floating-menu";
import type { FloatingMenuAlignment, FloatingMenuPlacement } from "./types";
import type { ChatComposerControlsState } from "./useChatComposerControls";

export function AttachmentMenuButton({
  controls,
  placement = "above",
  alignment = "start",
}: {
  controls: ChatComposerControlsState;
  placement?: FloatingMenuPlacement;
  alignment?: FloatingMenuAlignment;
}) {
  const { copy, language } = useLanguage();
  const attachmentHighlight = useHighlightedAction<"attachment">();
  const knowledgeMenuButtonRef = useRef<HTMLButtonElement>(null);
  const skillMenuButtonRef = useRef<HTMLButtonElement>(null);
  const submenuPosition = useFloatingSubmenuPosition({
    isKnowledgeMenuOpen: controls.isKnowledgeMenuOpen,
    isSkillMenuOpen: controls.isSkillMenuOpen,
    knowledgeMenuButtonRef,
    skillMenuButtonRef,
  });

  return (
    <>
      <input
        ref={controls.fileInputRef}
        type="file"
        multiple
        onChange={controls.handleAttachmentChange}
        disabled={
          controls.controlsBusy ||
          controls.pendingAttachments.length >= controls.maxAttachments
        }
        aria-label={copy.chat.chooseFiles}
        data-testid="message-attachment-input"
        className="sr-only"
      />
      <input
        ref={controls.skillDirectoryInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is a non-standard attribute needed for directory selection.
        webkitdirectory="true"
        directory=""
        onChange={controls.handleSkillDirectoryChange}
        disabled={controls.controlsBusy || controls.isImportingSkill}
        aria-label={copy.chat.skillImport}
        data-testid="skill-directory-input"
        className="sr-only"
      />
      <div ref={controls.attachmentMenuRef} className="relative shrink-0">
        <button
          type="button"
          onClick={controls.toggleAttachmentMenu}
          {...attachmentHighlight.getPointerHoverHandlers("attachment", {
            clearOnMouseLeave: true,
          })}
          disabled={
            controls.controlsBusy ||
            controls.pendingAttachments.length >= controls.maxAttachments
          }
          aria-label={copy.chat.addFilesKnowledge}
          aria-haspopup="menu"
          aria-expanded={controls.isAttachmentMenuOpen}
          title={copy.chat.addFilesKnowledge}
          data-testid="add-message-attachment-button"
          data-highlighted={attachmentHighlight.getDataHighlighted("attachment")}
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-[14px] border border-brand-200 text-brand-700 shadow-sm ring-1 ring-white/70 transition focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-50 ${getHighlightedActionClass(
            attachmentHighlight.isHighlighted("attachment"),
            "bg-white text-brand-700",
          )}`}
        >
          <Plus size={16} />
        </button>
        {controls.isAttachmentMenuOpen && (
          <div
            role="menu"
            aria-label={copy.chat.addAttachment}
            data-testid="attachment-menu"
            className={`${getMenuPlacementClass(placement, alignment)} chat-model-menu-scrollable nowheel max-h-[min(11rem,calc(100svh-8rem))] w-[min(14rem,calc(100vw-1rem))] overflow-visible overscroll-contain rounded-[14px] border border-neutral-200 bg-white/95 p-1 shadow-xl shadow-neutral-900/10 backdrop-blur`}
          >
            <button
              type="button"
              role="menuitem"
              onMouseEnter={() => controls.setIsKnowledgeMenuOpen(false)}
              onFocus={() => controls.setIsKnowledgeMenuOpen(false)}
              onClick={controls.openFilePicker}
              data-testid="upload-new-file-button"
              className="chat-menu-highlightable flex w-full items-center gap-3 rounded-[14px] px-3 py-2 text-left text-neutral-700 transition hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-300"
            >
              <span className="chat-menu-item-icon grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-neutral-200 bg-white text-brand-600">
                <Upload size={16} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-black">
                {copy.chat.uploadNewFile}
              </span>
            </button>

            <div className="relative">
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={controls.isKnowledgeMenuOpen}
                ref={knowledgeMenuButtonRef}
                onClick={() => {
                  controls.setIsKnowledgeMenuOpen((isOpen) => !isOpen);
                  controls.setIsSkillMenuOpen(false);
                }}
                data-testid="knowledge-menu-button"
                className="chat-menu-highlightable flex w-full items-center gap-3 rounded-[14px] px-3 py-2 text-left text-neutral-700 transition hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-300"
              >
                <span className="chat-menu-item-icon grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-neutral-200 bg-white text-brand-600">
                  <BookOpen size={16} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-black">
                  {copy.chat.knowledgeBase}
                </span>
                <ChevronRight
                  size={15}
                  className={`shrink-0 text-neutral-500 transition ${
                    controls.isKnowledgeMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {controls.isKnowledgeMenuOpen && typeof document !== "undefined"
                ? createPortal(
                    <div
                      onPointerDown={(event) => event.stopPropagation()}
                      role="menu"
                      aria-label={copy.chat.knowledgePdfs}
                      data-testid="knowledge-document-menu"
                      onWheel={stopFloatingMenuWheelPropagation}
                      style={{ top: submenuPosition.top, left: submenuPosition.left }}
                      className="nowheel fixed z-[100] max-h-64 w-[min(14rem,calc(100vw-1rem))] overflow-auto overscroll-contain rounded-[16px] border border-neutral-200 bg-brand-50 p-1 shadow-xl shadow-neutral-900/10"
                    >
                      {controls.isLoadingKnowledgeDocuments && (
                        <p
                          role="status"
                          className="flex items-center gap-2 rounded-[12px] px-3 py-3 text-sm font-bold text-neutral-600"
                        >
                          <Loader2 size={15} className="animate-spin" />
                          {copy.chat.loadingPdfs}
                        </p>
                      )}

                      {controls.knowledgeDocumentError && (
                        <p className="rounded-[12px] bg-danger-100 px-3 py-3 text-sm font-bold text-danger-600">
                          {controls.knowledgeDocumentError}
                        </p>
                      )}

                      {!controls.isLoadingKnowledgeDocuments &&
                        !controls.knowledgeDocumentError &&
                        controls.indexedKnowledgeDocuments.length === 0 && (
                          <p className="rounded-[12px] px-3 py-3 text-sm font-bold text-neutral-600">
                            {copy.chat.noIndexedPdfs}
                          </p>
                        )}

                      {!controls.isLoadingKnowledgeDocuments &&
                        !controls.knowledgeDocumentError &&
                        controls.indexedKnowledgeDocuments.map((documentItem) => {
                          const isAlreadySelected = controls.pendingAttachments.some(
                            (attachment) => attachment.documentId === documentItem.id,
                          );
                          const canSelect =
                            !isAlreadySelected &&
                            controls.pendingAttachments.length < controls.maxAttachments;
                          const title = documentItem.title || documentItem.fileName;
                          const detail = isAlreadySelected
                            ? copy.chat.selected
                            : language === "zh"
                              ? `${documentItem.pageCount || "-"} 页`
                              : `${documentItem.pageCount || "-"} pages`;

                          return (
                            <button
                              key={documentItem.id}
                              type="button"
                              role="menuitem"
                              disabled={!canSelect}
                              onClick={() => controls.selectKnowledgeDocument(documentItem)}
                              data-testid="knowledge-document-option"
                              className="chat-menu-highlightable flex w-full min-w-0 items-center gap-3 rounded-[12px] px-3 py-2 text-left text-neutral-700 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                            >
                              <span className="chat-menu-item-icon grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-neutral-200 bg-white text-brand-600">
                                <BookOpen size={16} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-black">
                                  {title}
                                </span>
                                <span className="block truncate text-xs font-bold text-neutral-500">
                                  {detail}
                                </span>
                              </span>
                            </button>
                          );
                        })}

                      {!controls.isLoadingAttachableCurricula &&
                        controls.attachableCurricula.length > 0 && (
                          <>
                            <p className="px-3 pb-1 pt-2 text-xs font-black uppercase tracking-wide text-neutral-500">
                              {copy.chat.knowledgeCurricula}
                            </p>
                            {controls.attachableCurricula.map((curriculum) => {
                              const isAlreadySelected = controls.pendingAttachments.some(
                                (attachment) =>
                                  attachment.curriculumId === curriculum.curriculumId,
                              );
                              const canSelect =
                                !isAlreadySelected &&
                                controls.pendingAttachments.length < controls.maxAttachments;

                              return (
                                <button
                                  key={curriculum.curriculumId}
                                  type="button"
                                  role="menuitem"
                                  disabled={!canSelect}
                                  onClick={() => controls.selectKnowledgeCurriculum(curriculum)}
                                  data-testid="knowledge-curriculum-option"
                                  className="chat-menu-highlightable flex w-full min-w-0 items-center gap-3 rounded-[12px] px-3 py-2 text-left text-neutral-700 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                                >
                                  <span className="chat-menu-item-icon grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-neutral-200 bg-white text-brand-600">
                                    <GraduationCap size={16} />
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-black">
                                      {curriculum.title}
                                    </span>
                                    <span className="block truncate text-xs font-bold text-neutral-500">
                                      {isAlreadySelected
                                        ? copy.chat.selected
                                        : curriculum.subject || curriculum.versionLabel}
                                    </span>
                                  </span>
                                </button>
                              );
                            })}
                          </>
                        )}
                    </div>,
                    document.body,
                  )
                : null}
            </div>

            <div className="relative">
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={controls.isSkillMenuOpen}
                ref={skillMenuButtonRef}
                onClick={() => {
                  controls.setIsSkillMenuOpen((isOpen) => !isOpen);
                  controls.setIsKnowledgeMenuOpen(false);
                }}
                data-testid="skill-menu-button"
                className="chat-menu-highlightable flex w-full items-center gap-3 rounded-[14px] px-3 py-2 text-left text-neutral-700 transition hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-300"
              >
                <span className="chat-menu-item-icon grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-neutral-200 bg-white text-brand-600">
                  <Sparkles size={16} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-black">
                  {copy.chat.skill}
                </span>
                <ChevronRight
                  size={15}
                  className={`shrink-0 text-neutral-500 transition ${
                    controls.isSkillMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {controls.isSkillMenuOpen && typeof document !== "undefined"
                ? createPortal(
                    <div
                      onPointerDown={(event) => event.stopPropagation()}
                      role="menu"
                      aria-label={copy.chat.skill}
                      data-testid="skill-document-menu"
                      onWheel={stopFloatingMenuWheelPropagation}
                      style={{ top: submenuPosition.top, left: submenuPosition.left }}
                      className="nowheel fixed z-[100] max-h-64 w-[min(14rem,calc(100vw-1rem))] overflow-auto overscroll-contain rounded-[16px] border border-neutral-200 bg-brand-50 p-1 shadow-xl shadow-neutral-900/10"
                    >
                      {controls.availableSkills.length === 0 && (
                        <p className="rounded-[12px] px-3 py-3 text-sm font-bold text-neutral-600">
                          {copy.chat.skillEmpty}
                        </p>
                      )}

                      {controls.availableSkills.map((skill) => {
                        const isSelected = controls.activeSkillId === skill.id;
                        const isDefault = isDefaultChatSkill(skill.id);

                        return (
                          <button
                            key={skill.id}
                            type="button"
                            role="menuitem"
                            onClick={() => controls.selectSkill(skill.id)}
                            data-testid="skill-option"
                            className={`chat-menu-highlightable flex w-full min-w-0 items-center gap-3 rounded-[12px] px-3 py-2 text-left transition focus:outline-none focus:ring-2 focus:ring-brand-300 ${
                              isSelected
                                ? "bg-white text-brand-800"
                                : "text-neutral-700 hover:bg-white"
                            }`}
                          >
                            <span className="chat-menu-item-icon grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-neutral-200 bg-white text-brand-600">
                              <Sparkles size={16} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                <span className="block truncate text-sm font-black">
                                  {skill.name}
                                </span>
                                {isDefault && (
                                  <span className="chat-menu-item-badge shrink-0 rounded-full border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700">
                                    {copy.chat.skillDefault}
                                  </span>
                                )}
                              </span>
                              {skill.description && (
                                <span className="block truncate text-xs font-bold text-neutral-500">
                                  {skill.description}
                                </span>
                              )}
                            </span>
                            {isSelected && (
                              <Check size={16} className="shrink-0 text-brand-700" />
                            )}
                          </button>
                        );
                      })}

                      <button
                        type="button"
                        role="menuitem"
                        onClick={controls.openSkillDirectoryPicker}
                        disabled={controls.isImportingSkill}
                        data-testid="import-skill-button"
                        className="chat-menu-highlightable flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left text-neutral-700 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span className="chat-menu-item-icon grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-neutral-200 bg-white text-brand-600">
                          <Upload size={16} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-black">
                          {copy.chat.skillImport}
                        </span>
                      </button>

                      {controls.skillImportError && (
                        <p className="rounded-[12px] bg-danger-100 px-3 py-3 text-sm font-bold text-danger-600">
                          {controls.skillImportError}
                        </p>
                      )}
                    </div>,
                    document.body,
                  )
                : null}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
