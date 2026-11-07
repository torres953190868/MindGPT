import {
  type FormEvent,
  type RefObject,
  useEffect,
  useRef,
} from "react";
import {
  Check,
  FileText,
  Loader2,
  Pencil,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useLanguage } from "@/components/language/LanguageProvider";
import { documentStatusDotClass, statusLabel } from "./helpers";
import type { RagDocument } from "./types";

export type PdfDocumentsSidebarProps = {
  fileInputRef: RefObject<HTMLInputElement | null>;
  documents: RagDocument[];
  selectedId: string | null;
  busy: boolean;
  uploading: boolean;
  renamingDocumentId: string | null;
  renameValue: string;
  renameSaving: boolean;
  deletingDocumentId: string | null;
  onUpload: (event: FormEvent<HTMLFormElement>) => void;
  onSelectDocument: (documentId: string) => void;
  onRenameValueChange: (value: string) => void;
  onStartRename: (document: RagDocument) => void;
  onCancelRename: () => void;
  onSubmitRename: (
    event: FormEvent<HTMLFormElement>,
    document: RagDocument,
  ) => void;
  onDeleteDocument: (document: RagDocument) => void;
};

export function PdfDocumentsSidebar({
  fileInputRef,
  documents,
  selectedId,
  busy,
  uploading,
  renamingDocumentId,
  renameValue,
  renameSaving,
  deletingDocumentId,
  onUpload,
  onSelectDocument,
  onRenameValueChange,
  onStartRename,
  onCancelRename,
  onSubmitRename,
  onDeleteDocument,
}: PdfDocumentsSidebarProps) {
  const { copy, language } = useLanguage();
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!renamingDocumentId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingDocumentId]);

  return (
    <aside
      data-testid="pdf-documents-sidebar"
      className="order-2 min-w-0 border-t border-neutral-200 bg-neutral-50 p-3 sm:p-4 lg:order-5 lg:max-h-[calc(100svh-92px)] lg:overflow-hidden lg:border-b-0 lg:border-l lg:border-t-0"
    >
      <div className="mb-4">
        <h2 className="text-xs font-black uppercase tracking-wider text-neutral-800">
          {copy.reader.documents}
        </h2>
      </div>

      <form onSubmit={onUpload} className="space-y-3">
        <label
          htmlFor="pdf-upload"
          className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-300 bg-white px-4 text-center text-xs font-extrabold text-neutral-600 transition hover:border-brand-300 hover:bg-brand-50"
        >
          <Upload size={20} className="text-neutral-400" />
          <span>{copy.reader.uploadPdf}</span>
          <span className="text-[11px] font-bold text-neutral-500">
            {language === "zh" ? "或拖拽到这里" : "or drag and drop"}
          </span>
          <input
            ref={fileInputRef}
            id="pdf-upload"
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-3 text-xs font-black text-white shadow-md shadow-brand-200/50 transition hover:bg-brand-700 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-65"
        >
          {busy ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Upload size={15} />
          )}
          {uploading ? copy.reader.uploading : copy.reader.uploadPdf}
        </button>
      </form>

      <div className="mt-5 max-h-64 space-y-2 overflow-auto pr-1 sm:max-h-80 lg:max-h-[calc(100svh-370px)]">
        {documents.map((document) => {
          const isSelected = selectedId === document.id;
          const isRenaming = renamingDocumentId === document.id;
          return (
            <div
              key={document.id}
              data-testid="pdf-document-row"
              data-document-id={document.id}
              className={`group w-full min-w-0 rounded-lg border px-3 py-3 text-left transition ${
                isSelected
                  ? "border-success-200 bg-success-50 shadow-sm"
                  : "border-transparent bg-transparent hover:bg-white hover:shadow-sm"
              }`}
            >
              {isRenaming ? (
                <form
                  onSubmit={(event) => onSubmitRename(event, document)}
                  className="flex min-w-0 items-start gap-2"
                >
                  <FileText
                    size={16}
                    className="mt-2 shrink-0 text-success-600"
                  />
                  <span className="min-w-0 flex-1">
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(event) =>
                        onRenameValueChange(event.target.value)
                      }
                      disabled={renameSaving}
                      aria-label={copy.reader.title}
                      className="h-8 w-full rounded-md border border-brand-300 bg-white px-2 text-xs font-black text-text-primary outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <span className="mt-1 block text-[11px] font-bold text-text-muted">
                      {language === "zh"
                        ? `${document.pageCount || "-"} 页`
                        : `${document.pageCount || "-"} pages`}
                    </span>
                  </span>
                  <span className="mt-0.5 flex shrink-0 items-center gap-1">
                    <button
                      type="submit"
                      disabled={!renameValue.trim() || renameSaving}
                      aria-label={copy.reader.savePdfName}
                      className="grid h-7 w-7 place-items-center rounded-md bg-success-500 text-white transition hover:bg-success-600 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {renameSaving ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Check size={13} />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={onCancelRename}
                      disabled={renameSaving}
                      aria-label={copy.common.cancel}
                      className="grid h-7 w-7 place-items-center rounded-md border border-border-default bg-white text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <X size={13} />
                    </button>
                  </span>
                </form>
              ) : (
                <div className="flex min-w-0 items-start gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectDocument(document.id)}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  >
                    <FileText
                      size={16}
                      className={`mt-0.5 shrink-0 ${isSelected ? "text-success-600" : "text-neutral-500"}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-black text-neutral-900">
                        {document.title || document.fileName}
                      </span>
                      <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-neutral-600">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${documentStatusDotClass(document.status)}`}
                        />
                        <span
                          className={
                            document.status === "failed"
                              ? "text-danger-600"
                              : undefined
                          }
                        >
                          {statusLabel(document.status, language)}
                          {document.pageCount > 0
                            ? language === "zh"
                              ? ` · ${document.pageCount} 页`
                              : ` · ${document.pageCount} pages`
                            : ""}
                        </span>
                      </span>
                    </span>
                    {isSelected && (
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-success-500" />
                    )}
                  </button>
                  <span
                    role="group"
                    aria-label={`${document.title || document.fileName} actions`}
                    className={`mt-0.5 flex shrink-0 items-center gap-1 opacity-100 transition ${
                      isSelected
                        ? "sm:opacity-100"
                        : "sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onStartRename(document)}
                      disabled={
                        busy || renameSaving || Boolean(deletingDocumentId)
                      }
                      aria-label={`Rename ${document.title || document.fileName}`}
                      title={copy.reader.renamePdf}
                      data-testid="rename-pdf-button"
                      className="grid h-7 w-7 place-items-center rounded-md border border-border-default bg-white text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteDocument(document)}
                      disabled={busy || Boolean(deletingDocumentId)}
                      aria-label={`Delete ${document.title || document.fileName}`}
                      title={copy.reader.deletePdf}
                      data-testid="delete-pdf-button"
                      className="grid h-7 w-7 place-items-center rounded-md border border-danger-200 bg-white text-danger-600 transition hover:bg-danger-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {deletingDocumentId === document.id ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Trash2 size={13} />
                      )}
                    </button>
                  </span>
                </div>
              )}
            </div>
          );
        })}
        {documents.length === 0 && (
          <div className="flex flex-col items-center rounded-lg bg-white px-3 py-6 text-center">
            <FileText size={24} className="text-neutral-300" />
            <p className="mt-2 text-sm font-bold text-neutral-600">
              {copy.reader.noPdfs}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
