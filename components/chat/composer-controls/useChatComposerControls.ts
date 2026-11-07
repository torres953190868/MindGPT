import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLanguage } from "@/components/language/LanguageProvider";
import { MAX_CHAT_ATTACHMENTS } from "@/lib/chat-attachments";
import {
  addStoredChatSkill,
  isDefaultChatSkill,
  readAvailableChatSkills,
  removeStoredChatSkill,
  validateChatSkillForSend,
  type ParsedChatSkill,
} from "@/lib/chat-skills";
import { readJsonApi } from "@/lib/client/api";
import type { ChatSkill } from "@/lib/types";
import type {
  AttachableCurriculaResponse,
  AttachableCurriculumItem,
  ChatModelOption,
  DocumentsResponse,
  KnowledgeDocument,
} from "./types";
import { useAttachmentIngestionControls } from "./useAttachmentIngestionControls";
import { useModelCatalogControls } from "./useModelCatalogControls";

export function useChatComposerControls({
  isBusy,
  maxAttachments = MAX_CHAT_ATTACHMENTS,
  autoPreparePdfAttachments = true,
}: {
  isBusy: boolean;
  maxAttachments?: number;
  autoPreparePdfAttachments?: boolean;
}) {
  const { copy } = useLanguage();
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const [isKnowledgeMenuOpen, setIsKnowledgeMenuOpen] = useState(false);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>([]);
  const [isLoadingKnowledgeDocuments, setIsLoadingKnowledgeDocuments] = useState(false);
  const [knowledgeDocumentError, setKnowledgeDocumentError] = useState<string | null>(null);
  const [attachableCurricula, setAttachableCurricula] = useState<AttachableCurriculumItem[]>([]);
  const [isLoadingAttachableCurricula, setIsLoadingAttachableCurricula] = useState(false);
  const [availableSkills, setAvailableSkills] = useState<ChatSkill[]>([]);
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const [isSkillMenuOpen, setIsSkillMenuOpen] = useState(false);
  const [skillImportError, setSkillImportError] = useState<string | null>(null);
  const [isImportingSkill, setIsImportingSkill] = useState(false);

  const skillDirectoryInputRef = useRef<HTMLInputElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);

  const handleCloseKnowledgeMenus = useCallback(() => {
    setIsAttachmentMenuOpen(false);
    setIsKnowledgeMenuOpen(false);
  }, []);

  const {
    attachmentError,
    controlsBusy,
    fileInputRef,
    handleAttachmentChange,
    isPreparingAttachments,
    pendingAttachments,
    prepareAttachmentsForSend,
    removePendingAttachment,
    resetAttachments,
    selectKnowledgeCurriculum,
    selectKnowledgeDocument,
  } = useAttachmentIngestionControls({
    isBusy,
    maxAttachments,
    autoPreparePdfAttachments,
    pdfUploadFailedLabel: copy.chat.pdfUploadFailed,
    onCloseKnowledgeMenus: handleCloseKnowledgeMenus,
  });

  const {
    applyAutoModelSelection,
    applyModelSelection,
    hasLoadedModelCatalog,
    isAutoSelected,
    isLoadingModelCatalog,
    modelCatalogError,
    modelOptions,
    modelSelection,
    refreshModelCatalog,
    selectedModel,
    selectedModelLabel,
  } = useModelCatalogControls({
    autoModelLabel: copy.chat.autoModel,
    modelCatalogLoadFailedLabel: copy.chat.modelCatalogLoadFailed,
  });

  const activeSkill = availableSkills.find((skill) => skill.id === activeSkillId) ?? null;
  const indexedKnowledgeDocuments = knowledgeDocuments.filter(
    (document) => document.status === "indexed",
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    setAvailableSkills(readAvailableChatSkills());
  }, []);

  useEffect(() => {
    if (!isModelMenuOpen) return undefined;

    function handlePointerDown(event: globalThis.PointerEvent) {
      const menu = modelMenuRef.current;
      if (!menu || menu.contains(event.target as Node)) return;
      setIsModelMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsModelMenuOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isModelMenuOpen]);

  useEffect(() => {
    if (!isAttachmentMenuOpen) return undefined;

    let cancelled = false;

    async function loadKnowledgeDocuments() {
      setIsLoadingKnowledgeDocuments(true);
      setKnowledgeDocumentError(null);

      try {
        const data = await readJsonApi<DocumentsResponse>("/api/documents", {
          method: "GET",
        });
        if (!cancelled) setKnowledgeDocuments(data.documents ?? []);
      } catch (loadError) {
        if (!cancelled) {
          setKnowledgeDocumentError(
            loadError instanceof Error ? loadError.message : copy.chat.couldNotLoadPdfs,
          );
        }
      } finally {
        if (!cancelled) setIsLoadingKnowledgeDocuments(false);
      }
    }

    async function loadAttachableCurricula() {
      setIsLoadingAttachableCurricula(true);

      try {
        const data = await readJsonApi<AttachableCurriculaResponse>(
          "/api/curricula/attachable",
          { method: "GET" },
        );
        if (!cancelled) setAttachableCurricula(data.items ?? []);
      } catch {
        // The endpoint 404s while ENABLE_CURRICULUM_AGENT is off; any failure
        // means "no course materials to offer", so the section stays hidden
        // instead of surfacing an error.
        if (!cancelled) setAttachableCurricula([]);
      } finally {
        if (!cancelled) setIsLoadingAttachableCurricula(false);
      }
    }

    void loadKnowledgeDocuments();
    void loadAttachableCurricula();

    return () => {
      cancelled = true;
    };
  }, [copy.chat.couldNotLoadPdfs, isAttachmentMenuOpen]);

  useEffect(() => {
    if (!isAttachmentMenuOpen) return undefined;

    function handlePointerDown(event: globalThis.PointerEvent) {
      const menu = attachmentMenuRef.current;
      if (!menu || menu.contains(event.target as Node)) return;
      setIsAttachmentMenuOpen(false);
      setIsKnowledgeMenuOpen(false);
      setIsSkillMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsAttachmentMenuOpen(false);
        setIsKnowledgeMenuOpen(false);
        setIsSkillMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAttachmentMenuOpen]);

  useEffect(() => {
    if (!isSkillMenuOpen) return undefined;

    function handlePointerDown(event: globalThis.PointerEvent) {
      const menu = attachmentMenuRef.current;
      if (!menu || menu.contains(event.target as Node)) return;
      setIsSkillMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsSkillMenuOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSkillMenuOpen]);

  function toggleAttachmentMenu() {
    if (controlsBusy || pendingAttachments.length >= maxAttachments) return;
    if (isAttachmentMenuOpen) {
      setIsKnowledgeMenuOpen(false);
      setIsSkillMenuOpen(false);
    }
    setIsAttachmentMenuOpen((isOpen) => !isOpen);
    setIsModelMenuOpen(false);
  }

  function openFilePicker() {
    setIsAttachmentMenuOpen(false);
    setIsKnowledgeMenuOpen(false);
    setIsSkillMenuOpen(false);
    fileInputRef.current?.click();
  }

  function openSkillDirectoryPicker() {
    setIsAttachmentMenuOpen(false);
    setIsKnowledgeMenuOpen(false);
    setIsSkillMenuOpen(false);
    skillDirectoryInputRef.current?.click();
  }

  async function handleSkillDirectoryChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setSkillImportError(null);
    setIsImportingSkill(true);

    try {
      const { readSkillFromFileList } = await import("@/lib/chat-skills");
      const result: ParsedChatSkill = await readSkillFromFileList(files);

      if (!result.success) {
        setSkillImportError(
          result.error === "missing-skill-md" || result.error === "invalid-selection"
            ? copy.chat.skillInvalidFile
            : copy.chat.skillImportError,
        );
        return;
      }

      addStoredChatSkill(result.skill);
      setAvailableSkills(readAvailableChatSkills());
      setActiveSkillId(result.skill.id);
      setIsSkillMenuOpen(false);
    } catch {
      setSkillImportError(copy.chat.skillImportError);
    } finally {
      setIsImportingSkill(false);
      event.target.value = "";
    }
  }

  function selectSkill(skillId: string) {
    if (controlsBusy) return;
    setActiveSkillId(skillId);
    setIsSkillMenuOpen(false);
    setIsAttachmentMenuOpen(false);
    setIsKnowledgeMenuOpen(false);
  }

  function removeActiveSkill() {
    if (controlsBusy) return;
    setActiveSkillId(null);
  }

  function removeImportedSkill(skillId: string) {
    if (isDefaultChatSkill(skillId)) return;
    removeStoredChatSkill(skillId);
    setAvailableSkills(readAvailableChatSkills());
    if (activeSkillId === skillId) {
      setActiveSkillId(null);
    }
  }

  function prepareSkillForSend(): ChatSkill | undefined {
    return validateChatSkillForSend(activeSkill) ?? undefined;
  }

  function selectModel(option: ChatModelOption) {
    if (!option.configured || option.locked || controlsBusy) return;
    applyModelSelection(option);
    setIsModelMenuOpen(false);
    setIsAttachmentMenuOpen(false);
    setIsKnowledgeMenuOpen(false);
    setIsSkillMenuOpen(false);
  }

  function selectAutoModel() {
    if (controlsBusy) return;
    applyAutoModelSelection();
    setIsModelMenuOpen(false);
    setIsAttachmentMenuOpen(false);
    setIsKnowledgeMenuOpen(false);
    setIsSkillMenuOpen(false);
  }

  function toggleModelMenu() {
    if (controlsBusy) return;
    setIsModelMenuOpen((isOpen) => !isOpen);
    setIsAttachmentMenuOpen(false);
    setIsKnowledgeMenuOpen(false);
    setIsSkillMenuOpen(false);
  }

  return {
    activeSkill,
    activeSkillId,
    attachableCurricula,
    attachmentError,
    attachmentMenuRef,
    controlsBusy,
    fileInputRef,
    handleAttachmentChange,
    handleSkillDirectoryChange,
    availableSkills,
    indexedKnowledgeDocuments,
    isAttachmentMenuOpen,
    isAutoSelected,
    isImportingSkill,
    isKnowledgeMenuOpen,
    hasLoadedModelCatalog,
    isLoadingAttachableCurricula,
    isLoadingModelCatalog,
    isLoadingKnowledgeDocuments,
    isModelMenuOpen,
    isPreparingAttachments,
    isSkillMenuOpen,
    knowledgeDocumentError,
    maxAttachments,
    modelMenuRef,
    modelOptions,
    modelCatalogError,
    openFilePicker,
    openSkillDirectoryPicker,
    pendingAttachments,
    prepareAttachmentsForSend,
    prepareSkillForSend,
    refreshModelCatalog,
    removeActiveSkill,
    removeImportedSkill,
    removePendingAttachment,
    resetAttachments,
    selectAutoModel,
    selectKnowledgeCurriculum,
    selectKnowledgeDocument,
    selectModel,
    selectSkill,
    selectedModel,
    modelSelection,
    selectedModelLabel,
    setIsKnowledgeMenuOpen,
    setIsSkillMenuOpen,
    skillDirectoryInputRef,
    skillImportError,
    toggleAttachmentMenu,
    toggleModelMenu,
  };
}

export type ChatComposerControlsState = ReturnType<typeof useChatComposerControls>;
