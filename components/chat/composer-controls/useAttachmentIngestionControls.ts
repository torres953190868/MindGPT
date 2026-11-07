import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ApiRequestError } from "@/lib/client/api";
import { createId } from "@/lib/ids";
import {
  CURRICULUM_ATTACHMENT_MIME_TYPE,
  ingestPdfAttachment,
  isPdfAttachment,
  replacePendingAttachment,
  toSendableAttachment,
} from "./attachment-helpers";
import type {
  AttachableCurriculumItem,
  KnowledgeDocument,
  PendingChatAttachment,
} from "./types";

export function useAttachmentIngestionControls({
  isBusy,
  maxAttachments,
  autoPreparePdfAttachments,
  pdfUploadFailedLabel,
  onCloseKnowledgeMenus,
}: {
  isBusy: boolean;
  maxAttachments: number;
  autoPreparePdfAttachments: boolean;
  pdfUploadFailedLabel: string;
  onCloseKnowledgeMenus: () => void;
}) {
  const [pendingAttachments, setPendingAttachments] = useState<PendingChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isPreparingAttachments, setIsPreparingAttachments] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingAttachmentsRef = useRef<PendingChatAttachment[]>([]);
  const inFlightIngestionRef = useRef(new Map<string, Promise<PendingChatAttachment>>());
  const ingestionRunIdsRef = useRef(new Map<string, number>());
  const nextIngestionRunIdRef = useRef(0);
  const isMountedRef = useRef(true);

  const controlsBusy = isBusy || isPreparingAttachments;

  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments;
  }, [pendingAttachments]);

  useEffect(() => {
    const inFlightIngestion = inFlightIngestionRef.current;
    const ingestionRunIds = ingestionRunIdsRef.current;

    return () => {
      isMountedRef.current = false;
      inFlightIngestion.clear();
      ingestionRunIds.clear();
    };
  }, []);

  function setAttachmentIngestionProgress(next: PendingChatAttachment) {
    setPendingAttachments((current) => replacePendingAttachment(current, next));
  }

  function hasPendingAttachment(attachmentId: string) {
    return pendingAttachmentsRef.current.some(
      (attachment) => attachment.id === attachmentId,
    );
  }

  function isCurrentIngestionRun(attachmentId: string, runId: number) {
    return ingestionRunIdsRef.current.get(attachmentId) === runId;
  }

  function startPdfIngestion(attachment: PendingChatAttachment) {
    if (
      !isPdfAttachment(attachment) ||
      !attachment.file ||
      attachment.documentStatus === "indexed" ||
      inFlightIngestionRef.current.has(attachment.id)
    ) {
      return;
    }

    const runId = nextIngestionRunIdRef.current + 1;
    nextIngestionRunIdRef.current = runId;
    ingestionRunIdsRef.current.set(attachment.id, runId);

    const ingestion = ingestPdfAttachment(attachment, (next) => {
      if (!isMountedRef.current || !isCurrentIngestionRun(attachment.id, runId)) {
        return;
      }
      setAttachmentIngestionProgress(next);
    });

    inFlightIngestionRef.current.set(attachment.id, ingestion);

    void ingestion
      .catch((ingestionError) => {
        if (
          !isMountedRef.current ||
          !isCurrentIngestionRun(attachment.id, runId) ||
          !hasPendingAttachment(attachment.id)
        ) {
          return;
        }

        const message =
          ingestionError instanceof Error ? ingestionError.message : pdfUploadFailedLabel;
        const errorRequestId =
          ingestionError instanceof ApiRequestError ? ingestionError.requestId : null;
        setAttachmentError(message);
        setPendingAttachments((current) =>
          current.map((item) =>
            item.id === attachment.id
              ? {
                  ...item,
                  uploadStatus: "failed",
                  errorMessage: message,
                  errorRequestId,
                }
              : item,
          ),
        );
      })
      .finally(() => {
        if (isCurrentIngestionRun(attachment.id, runId)) {
          inFlightIngestionRef.current.delete(attachment.id);
        }
      });
  }

  async function prepareAttachmentsForSend() {
    if (isPreparingAttachments) return null;

    let prepared = pendingAttachments;
    const needsPdfPreparation = prepared.some(
      (attachment) =>
        isPdfAttachment(attachment) &&
        attachment.file &&
        attachment.documentStatus !== "indexed",
    );

    if (!needsPdfPreparation) {
      setAttachmentError(null);
      return prepared.map(toSendableAttachment);
    }

    setAttachmentError(null);
    setIsPreparingAttachments(true);

    try {
      for (const attachment of pendingAttachments) {
        if (
          !isPdfAttachment(attachment) ||
          !attachment.file ||
          attachment.documentStatus === "indexed"
        ) {
          continue;
        }

        const inFlightIngestion = inFlightIngestionRef.current.get(attachment.id);
        const indexed = inFlightIngestion
          ? await inFlightIngestion
          : await ingestPdfAttachment(attachment, (next) => {
              prepared = replacePendingAttachment(prepared, next);
              setPendingAttachments(prepared);
            });
        const current = {
          ...indexed,
          uploadStatus: "indexed" as const,
        };
        prepared = replacePendingAttachment(prepared, current);
        setPendingAttachments(prepared);
      }

      return prepared.map(toSendableAttachment);
    } catch (uploadError) {
      const message =
        uploadError instanceof Error ? uploadError.message : pdfUploadFailedLabel;
      const errorRequestId =
        uploadError instanceof ApiRequestError ? uploadError.requestId : null;
      setAttachmentError(message);
      setPendingAttachments((current) =>
        current.map((attachment) =>
          attachment.uploadStatus === "uploading" ||
          attachment.uploadStatus === "indexing" ||
          attachment.uploadStatus === "queued"
            ? {
                ...attachment,
                uploadStatus: "failed",
                errorMessage: message,
                errorRequestId,
              }
            : attachment,
        ),
      );
      return null;
    } finally {
      setIsPreparingAttachments(false);
    }
  }

  function selectKnowledgeDocument(document: KnowledgeDocument) {
    if (
      controlsBusy ||
      document.status !== "indexed" ||
      pendingAttachments.length >= maxAttachments
    ) {
      return;
    }

    setAttachmentError(null);
    setPendingAttachments((current) => {
      if (
        current.length >= maxAttachments ||
        current.some((attachment) => attachment.documentId === document.id)
      ) {
        return current;
      }

      return [
        ...current,
        {
          id: createId("attachment"),
          name: document.fileName,
          mimeType: document.mimeType || "application/pdf",
          size: 0,
          createdAt: new Date().toISOString(),
          documentId: document.id,
          documentStatus: "indexed",
          uploadStatus: "indexed",
        },
      ];
    });
    onCloseKnowledgeMenus();
  }

  function selectKnowledgeCurriculum(curriculum: AttachableCurriculumItem) {
    if (controlsBusy || pendingAttachments.length >= maxAttachments) {
      return;
    }

    setAttachmentError(null);
    setPendingAttachments((current) => {
      if (
        current.length >= maxAttachments ||
        current.some(
          (attachment) => attachment.curriculumId === curriculum.curriculumId,
        )
      ) {
        return current;
      }

      return [
        ...current,
        {
          id: createId("attachment"),
          name: curriculum.title,
          mimeType: CURRICULUM_ATTACHMENT_MIME_TYPE,
          size: 0,
          createdAt: new Date().toISOString(),
          curriculumId: curriculum.curriculumId,
        },
      ];
    });
    onCloseKnowledgeMenus();
  }

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    const remainingSlots = Math.max(0, maxAttachments - pendingAttachments.length);
    const createdAt = new Date().toISOString();
    const nextAttachments: PendingChatAttachment[] = files
      .slice(0, remainingSlots)
      .map((file) => ({
        id: createId("attachment"),
        name: file.name,
        mimeType: file.type,
        size: file.size,
        createdAt,
        file,
      }));

    setAttachmentError(null);
    pendingAttachmentsRef.current = [...pendingAttachmentsRef.current, ...nextAttachments];
    setPendingAttachments((current) => {
      return [...current, ...nextAttachments];
    });
    if (autoPreparePdfAttachments) {
      nextAttachments.forEach(startPdfIngestion);
    }
    event.target.value = "";
  }

  function removePendingAttachment(attachmentId: string) {
    setAttachmentError(null);
    ingestionRunIdsRef.current.delete(attachmentId);
    inFlightIngestionRef.current.delete(attachmentId);
    pendingAttachmentsRef.current = pendingAttachmentsRef.current.filter(
      (attachment) => attachment.id !== attachmentId,
    );
    setPendingAttachments((current) =>
      current.filter((attachment) => attachment.id !== attachmentId),
    );
  }

  const resetAttachments = useCallback(() => {
    inFlightIngestionRef.current.clear();
    ingestionRunIdsRef.current.clear();
    pendingAttachmentsRef.current = [];
    setPendingAttachments([]);
    setAttachmentError(null);
    onCloseKnowledgeMenus();
  }, [onCloseKnowledgeMenus]);

  return {
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
  };
}
