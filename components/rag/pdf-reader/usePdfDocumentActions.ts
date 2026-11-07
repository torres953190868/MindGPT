import {
  type Dispatch,
  type FormEvent,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
  useRef,
  useState,
} from "react";
import { useLanguage } from "@/components/language/LanguageProvider";
import { readJsonApi } from "@/lib/client/api";
import { getRagRequestErrorMessage } from "@/lib/client/rag-errors";
import type {
  DocumentDetails,
  LocalPdfPreview,
  RagChunk,
  RagDocument,
  RagPage,
  RagQueryResponse,
} from "./types";

type ReaderCopy = ReturnType<typeof useLanguage>["copy"]["reader"];

export type UsePdfDocumentActionsOptions = {
  readerCopy: ReaderCopy;
  selectedId: string | null;
  selectedDocument: RagDocument | null;
  pageNumber: number | null;
  selectedIdRef: MutableRefObject<string | null>;
  pageNumberRef: MutableRefObject<number | null>;
  sourceChunkIdRef: MutableRefObject<string | null>;
  nextReaderActionId: () => number;
  loadDocuments: () => Promise<RagDocument[]>;
  selectDocument: (
    documentId: string,
    options?: {
      pageNumber?: number | null;
      chunkId?: string | null;
      updateUrl?: boolean;
    },
  ) => Promise<void>;
  clearSelectedDocument: () => void;
  setDocuments: Dispatch<SetStateAction<RagDocument[]>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setDetails: Dispatch<SetStateAction<DocumentDetails | null>>;
  setPage: Dispatch<SetStateAction<RagPage | null>>;
  setSourceChunk: Dispatch<SetStateAction<RagChunk | null>>;
  setPageNumber: Dispatch<SetStateAction<number | null>>;
  setPageInput: Dispatch<SetStateAction<string>>;
  setLocalPreview: Dispatch<SetStateAction<LocalPdfPreview | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setAskResult: Dispatch<SetStateAction<RagQueryResponse | null>>;
  setAskError: Dispatch<SetStateAction<string | null>>;
};

export type UsePdfDocumentActionsResult = {
  fileInputRef: RefObject<HTMLInputElement | null>;
  uploading: boolean;
  indexing: boolean;
  busy: boolean;
  renamingDocumentId: string | null;
  renameValue: string;
  renameSaving: boolean;
  deletingDocumentId: string | null;
  askQuestion: string;
  askLoading: boolean;
  setRenameValue: Dispatch<SetStateAction<string>>;
  setAskQuestion: Dispatch<SetStateAction<string>>;
  handleUpload: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  startRenameDocument: (document: RagDocument) => void;
  cancelRenameDocument: () => void;
  handleRenameDocument: (
    event: FormEvent<HTMLFormElement>,
    document: RagDocument,
  ) => Promise<void>;
  handleDeleteDocument: (document: RagDocument) => Promise<void>;
  handleReindex: () => Promise<void>;
  handleAskPdf: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};

export function usePdfDocumentActions({
  readerCopy,
  selectedId,
  selectedDocument,
  pageNumber,
  selectedIdRef,
  pageNumberRef,
  sourceChunkIdRef,
  nextReaderActionId,
  loadDocuments,
  selectDocument,
  clearSelectedDocument,
  setDocuments,
  setSelectedId,
  setDetails,
  setPage,
  setSourceChunk,
  setPageNumber,
  setPageInput,
  setLocalPreview,
  setError,
  setAskResult,
  setAskError,
}: UsePdfDocumentActionsOptions): UsePdfDocumentActionsResult {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [renamingDocumentId, setRenamingDocumentId] = useState<string | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(
    null,
  );
  const [uploading, setUploading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [askQuestion, setAskQuestion] = useState("");
  const [askLoading, setAskLoading] = useState(false);

  const busy = uploading || indexing;

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file || busy) return;

    const previewUrl = URL.createObjectURL(file);
    const formData = new FormData();
    formData.set("file", file);
    let uploadedId: string | null = null;

    try {
      nextReaderActionId();
      selectedIdRef.current = null;
      setSelectedId(null);
      setDetails(null);
      setPage(null);
      setSourceChunk(null);
      setPageNumber(1);
      setPageInput("1");
      setAskResult(null);
      setAskError(null);
      setLocalPreview({ fileName: file.name, url: previewUrl });
      setError(null);
      setUploading(true);
      const upload = await readJsonApi<{ document: RagDocument }>(
        "/api/documents/upload",
        {
          method: "POST",
          body: formData,
        },
      );
      uploadedId = upload.document.id;
      setUploading(false);
      await loadDocuments();
      setLocalPreview(null);
      await selectDocument(uploadedId, { updateUrl: true });
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (uploadError) {
      setError(
        getRagRequestErrorMessage(uploadError, "Upload failed.", readerCopy),
      );
      if (uploadedId) {
        await selectDocument(uploadedId, { pageNumber }).catch(() => undefined);
      }
    } finally {
      setUploading(false);
    }
  }

  function startRenameDocument(document: RagDocument) {
    if (busy || renameSaving || deletingDocumentId) return;
    setError(null);
    setRenamingDocumentId(document.id);
    setRenameValue(document.title || document.fileName);
  }

  function cancelRenameDocument() {
    setRenamingDocumentId(null);
    setRenameValue("");
  }

  async function handleRenameDocument(
    event: FormEvent<HTMLFormElement>,
    document: RagDocument,
  ) {
    event.preventDefault();
    const name = renameValue.trim();
    if (!name || renameSaving) return;

    try {
      setError(null);
      setRenameSaving(true);
      const data = await readJsonApi<{ document: RagDocument }>(
        `/api/documents/${document.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        },
      );
      await loadDocuments();
      if (selectedIdRef.current === document.id) {
        setDetails((current) =>
          current && current.document.id === document.id
            ? { ...current, document: data.document }
            : current,
        );
      }
      setRenamingDocumentId(null);
      setRenameValue("");
    } catch (renameError) {
      setError(
        getRagRequestErrorMessage(renameError, "Rename failed.", readerCopy),
      );
    } finally {
      setRenameSaving(false);
    }
  }

  async function handleDeleteDocument(document: RagDocument) {
    if (busy || deletingDocumentId) return;
    const label = document.title || document.fileName;
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;

    try {
      setError(null);
      setDeletingDocumentId(document.id);
      const data = await readJsonApi<{ documents: RagDocument[] }>(
        `/api/documents/${document.id}`,
        { method: "DELETE" },
      );
      setDocuments(data.documents);
      setRenamingDocumentId(null);
      setRenameValue("");

      if (selectedIdRef.current === document.id) {
        const nextDocument = data.documents[0] ?? null;
        if (nextDocument) {
          await selectDocument(nextDocument.id, { updateUrl: true });
        } else {
          clearSelectedDocument();
        }
      }
    } catch (deleteError) {
      setError(
        getRagRequestErrorMessage(deleteError, "Delete failed.", readerCopy),
      );
    } finally {
      setDeletingDocumentId(null);
    }
  }

  async function handleReindex() {
    if (!selectedId || indexing) return;

    try {
      setError(null);
      setAskError(null);
      setIndexing(true);
      await readJsonApi(`/api/documents/${selectedId}/index`, {
        method: "POST",
      });
      await loadDocuments();
      await selectDocument(selectedId, {
        pageNumber: pageNumberRef.current,
        chunkId: sourceChunkIdRef.current,
      });
    } catch (indexError) {
      setError(
        getRagRequestErrorMessage(indexError, "Index failed.", readerCopy),
      );
      await selectDocument(selectedId, { pageNumber }).catch(() => undefined);
    } finally {
      setIndexing(false);
    }
  }

  async function handleAskPdf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = askQuestion.trim();
    if (
      !selectedId ||
      !selectedDocument ||
      selectedDocument.status !== "indexed"
    ) {
      return;
    }
    if (!question || askLoading) return;

    try {
      setAskError(null);
      setAskLoading(true);
      const result = await readJsonApi<RagQueryResponse>(
        `/api/documents/${selectedId}/query`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
        },
      );
      setAskResult(result);
    } catch (askRequestError) {
      setAskError(
        getRagRequestErrorMessage(
          askRequestError,
          "Ask PDF failed.",
          readerCopy,
        ),
      );
    } finally {
      setAskLoading(false);
    }
  }

  return {
    fileInputRef,
    uploading,
    indexing,
    busy,
    renamingDocumentId,
    renameValue,
    renameSaving,
    deletingDocumentId,
    askQuestion,
    askLoading,
    setRenameValue,
    setAskQuestion,
    handleUpload,
    startRenameDocument,
    cancelRenameDocument,
    handleRenameDocument,
    handleDeleteDocument,
    handleReindex,
    handleAskPdf,
  };
}
