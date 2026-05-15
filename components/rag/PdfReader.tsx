"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  RefreshCcw,
  Search,
  Upload,
} from "lucide-react";

type DocumentStatus =
  | "uploaded"
  | "parsing"
  | "parsed"
  | "indexing"
  | "indexed"
  | "failed";

type RagDocument = {
  id: string;
  fileName: string;
  pageCount: number;
  title: string | null;
  status: DocumentStatus;
  errorMessage: string | null;
  updatedAt: string;
};

type RagSection = {
  id: string;
  title: string;
  headingPath: string[];
  level: number;
  pageStart: number;
  pageEnd: number;
  source: string;
};

type RagPage = {
  pageNumber: number;
  cleanText: string;
  tokenCount: number;
};

type RagQueryResult = {
  answer: string;
  citations: Array<{
    pageStart: number;
    pageEnd: number;
    chunkId: string;
    headingPath: string[];
    quote: string;
  }>;
  retrievedChunks: Array<{
    chunkId: string;
    score: number;
    pageStart: number;
    pageEnd: number;
    headingPath: string[];
    preview: string;
  }>;
};

type DocumentDetails = {
  document: RagDocument;
  sections: RagSection[];
  chunkCount: number;
};

async function readApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const message =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof (data as { error?: { message?: unknown } }).error?.message === "string"
        ? (data as { error: { message: string } }).error.message
        : "Request failed.";
    throw new Error(
      message,
    );
  }

  return data as T;
}

function statusLabel(status: DocumentStatus) {
  const labels: Record<DocumentStatus, string> = {
    uploaded: "Uploaded",
    parsing: "Parsing",
    parsed: "Parsed",
    indexing: "Indexing",
    indexed: "Indexed",
    failed: "Failed",
  };
  return labels[status];
}

function pagesLabel(start: number, end: number) {
  return start === end ? `p. ${start}` : `pp. ${start}-${end}`;
}

export function PdfReader() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<DocumentDetails | null>(null);
  const [page, setPage] = useState<RagPage | null>(null);
  const [question, setQuestion] = useState("");
  const [queryResult, setQueryResult] = useState<RagQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [querying, setQuerying] = useState(false);

  const selectedDocument = details?.document ?? null;
  const canAsk = selectedDocument?.status === "indexed" && !querying;

  const loadDocuments = useCallback(async () => {
    const data = await readApi<{ documents: RagDocument[] }>("/api/documents");
    setDocuments(data.documents);
    return data.documents;
  }, []);

  const loadPage = useCallback(async (documentId: string, pageNumber: number) => {
    const data = await readApi<{ page: RagPage }>(
      `/api/documents/${documentId}/pages/${pageNumber}`,
    );
    setPage(data.page);
  }, []);

  const selectDocument = useCallback(async (documentId: string, pageNumber?: number) => {
    setSelectedId(documentId);
    const nextDetails = await readApi<DocumentDetails>(
      `/api/documents/${documentId}`,
    );
    setDetails(nextDetails);
    setQueryResult(null);

    const firstPage =
      pageNumber ??
      nextDetails.sections[0]?.pageStart ??
      (nextDetails.document.pageCount > 0 ? 1 : null);
    if (firstPage) await loadPage(documentId, firstPage);
    else setPage(null);
  }, [loadPage]);

  useEffect(() => {
    loadDocuments()
      .then((items) => {
        if (items[0]) return selectDocument(items[0].id);
        return undefined;
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "Load failed.");
      });
  }, [loadDocuments, selectDocument]);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file || uploading || indexing) return;

    const formData = new FormData();
    formData.set("file", file);
    let uploadedId: string | null = null;

    try {
      setError(null);
      setUploading(true);
      const upload = await readApi<{ document: RagDocument }>(
        "/api/documents/upload",
        {
          method: "POST",
          body: formData,
        },
      );
      uploadedId = upload.document.id;
      await loadDocuments();
      await selectDocument(uploadedId);

      setIndexing(true);
      await readApi(`/api/documents/${uploadedId}/index`, { method: "POST" });
      await loadDocuments();
      await selectDocument(uploadedId);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Upload failed.",
      );
      if (uploadedId) await selectDocument(uploadedId).catch(() => undefined);
    } finally {
      setUploading(false);
      setIndexing(false);
    }
  }

  async function handleReindex() {
    if (!selectedId || indexing) return;

    try {
      setError(null);
      setIndexing(true);
      await readApi(`/api/documents/${selectedId}/index`, { method: "POST" });
      await loadDocuments();
      await selectDocument(selectedId, page?.pageNumber);
    } catch (indexError) {
      setError(indexError instanceof Error ? indexError.message : "Index failed.");
      await selectDocument(selectedId, page?.pageNumber).catch(() => undefined);
    } finally {
      setIndexing(false);
    }
  }

  async function handleAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !question.trim() || !canAsk) return;

    try {
      setError(null);
      setQuerying(true);
      const result = await readApi<RagQueryResult>(
        `/api/documents/${selectedId}/query`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: question.trim() }),
        },
      );
      setQueryResult(result);
    } catch (queryError) {
      setError(queryError instanceof Error ? queryError.message : "Query failed.");
    } finally {
      setQuerying(false);
    }
  }

  const sortedSections = useMemo(
    () =>
      [...(details?.sections ?? [])].sort(
        (left, right) => left.pageStart - right.pageStart || left.level - right.level,
      ),
    [details],
  );

  return (
    <section className="grid w-full min-w-0 max-w-full gap-5 overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)] lg:overflow-visible">
      <aside className="min-w-0 space-y-4 rounded-[24px] border border-white/80 bg-white/70 p-4 shadow-lg shadow-[#e8dcef]/35">
        <form onSubmit={handleUpload} className="space-y-3">
          <label
            htmlFor="pdf-upload"
            className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-[18px] border border-dashed border-[#b79acb] bg-[#fbf8ff] px-4 text-center text-sm font-extrabold text-[#594468]"
          >
            <Upload size={22} />
            <span>Upload PDF</span>
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
            disabled={uploading || indexing}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[18px] bg-[#5f7f6a] px-4 text-sm font-black text-white shadow-md shadow-[#9bc7aa]/30 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-65 disabled:hover:translate-y-0"
          >
            {uploading || indexing ? <Loader2 size={17} className="animate-spin" /> : <Upload size={17} />}
            {uploading ? "Uploading" : indexing ? "Indexing" : "Upload and Index"}
          </button>
        </form>

        <div className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-normal text-[#76667f]">
            Documents
          </h2>
          <div className="space-y-2">
            {documents.map((document) => (
              <button
                key={document.id}
                type="button"
                onClick={() => selectDocument(document.id).catch((loadError: unknown) => {
                  setError(loadError instanceof Error ? loadError.message : "Load failed.");
                })}
                className={`w-full min-w-0 rounded-[18px] border px-3 py-3 text-left transition ${
                  selectedId === document.id
                    ? "border-[#7c5fb1] bg-[#f5efff]"
                    : "border-white/80 bg-white/80 hover:bg-white"
                }`}
              >
                <span className="flex items-start gap-2">
                  <FileText size={17} className="mt-0.5 shrink-0 text-[#6c5784]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-black text-[#332b38]">
                      {document.title || document.fileName}
                    </span>
                    <span className="mt-1 block text-xs font-bold text-[#76667f]">
                      {statusLabel(document.status)} - {document.pageCount || "-"} pages
                    </span>
                  </span>
                </span>
              </button>
            ))}
            {documents.length === 0 && (
              <p className="rounded-[18px] bg-white/70 px-3 py-4 text-sm font-bold text-[#76667f]">
                No PDFs yet.
              </p>
            )}
          </div>
        </div>
      </aside>

      <div className="grid min-w-0 max-w-full gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <main className="min-w-0 max-w-full space-y-4">
          <div className="min-w-0 rounded-[24px] border border-white/80 bg-white/70 p-5 shadow-lg shadow-[#e8dcef]/35">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black uppercase tracking-normal text-[#76667f]">
                  Reader
                </p>
                <h2 className="mt-1 truncate text-2xl font-black text-[#332b38]">
                  {selectedDocument?.title || selectedDocument?.fileName || "Select a PDF"}
                </h2>
              </div>
              {selectedDocument && (
                <button
                  type="button"
                  onClick={handleReindex}
                  disabled={indexing}
                  className="inline-flex min-h-11 items-center gap-2 rounded-[16px] bg-[#eef8f1] px-3 text-sm font-black text-[#3f6d50] transition hover:bg-[#dff0e5] disabled:opacity-60"
                >
                  {indexing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
                  Re-index
                </button>
              )}
            </div>

            {selectedDocument?.status === "failed" && selectedDocument.errorMessage && (
              <p className="mt-4 flex items-start gap-2 rounded-[18px] bg-[#ffeceb] px-4 py-3 text-sm font-bold text-[#8f3f3a]">
                <AlertCircle size={17} className="mt-0.5 shrink-0" />
                {selectedDocument.errorMessage}
              </p>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[16px] bg-white/75 px-4 py-3">
                <p className="text-xs font-black uppercase tracking-normal text-[#76667f]">
                  Status
                </p>
                <p className="mt-1 text-lg font-black text-[#332b38]">
                  {selectedDocument ? statusLabel(selectedDocument.status) : "-"}
                </p>
              </div>
              <div className="rounded-[16px] bg-white/75 px-4 py-3">
                <p className="text-xs font-black uppercase tracking-normal text-[#76667f]">
                  Pages
                </p>
                <p className="mt-1 text-lg font-black text-[#332b38]">
                  {selectedDocument?.pageCount || "-"}
                </p>
              </div>
              <div className="rounded-[16px] bg-white/75 px-4 py-3">
                <p className="text-xs font-black uppercase tracking-normal text-[#76667f]">
                  Chunks
                </p>
                <p className="mt-1 text-lg font-black text-[#332b38]">
                  {details?.chunkCount ?? "-"}
                </p>
              </div>
            </div>
          </div>

          <div className="min-w-0 rounded-[24px] border border-white/80 bg-white/70 p-5 shadow-lg shadow-[#e8dcef]/35">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="inline-flex items-center gap-2 text-lg font-black text-[#332b38]">
                <BookOpen size={19} />
                Page {page?.pageNumber ?? "-"}
              </h2>
              {selectedDocument && page && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={page.pageNumber <= 1}
                    onClick={() => loadPage(selectedDocument.id, page.pageNumber - 1)}
                    className="grid h-11 w-11 place-items-center rounded-full bg-white/80 font-black text-[#554665] disabled:opacity-45"
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    type="button"
                    disabled={page.pageNumber >= selectedDocument.pageCount}
                    onClick={() => loadPage(selectedDocument.id, page.pageNumber + 1)}
                    className="grid h-11 w-11 place-items-center rounded-full bg-white/80 font-black text-[#554665] disabled:opacity-45"
                    aria-label="Next page"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </div>
            <pre className="max-h-[560px] min-h-72 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-[18px] bg-[#fffcfd] p-4 text-sm leading-7 text-[#372f3c]">
              {page?.cleanText || "No page text loaded."}
            </pre>
          </div>
        </main>

        <aside className="min-w-0 space-y-4">
          <div className="min-w-0 rounded-[24px] border border-white/80 bg-white/70 p-4 shadow-lg shadow-[#e8dcef]/35">
            <h2 className="text-sm font-black uppercase tracking-normal text-[#76667f]">
              TOC
            </h2>
            <div className="mt-3 max-h-72 space-y-2 overflow-auto pr-1">
              {sortedSections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() =>
                    selectedId
                      ? loadPage(selectedId, section.pageStart).catch((loadError: unknown) => {
                          setError(loadError instanceof Error ? loadError.message : "Load failed.");
                        })
                      : undefined
                  }
                  className="w-full min-w-0 rounded-[16px] bg-white/75 px-3 py-2 text-left text-sm font-bold text-[#554665] transition hover:bg-white"
                  style={{ paddingLeft: `${Math.min(section.level, 4) * 10 + 12}px` }}
                >
                  <span className="block truncate">{section.title}</span>
                  <span className="text-xs text-[#82758b]">
                    {pagesLabel(section.pageStart, section.pageEnd)}
                  </span>
                </button>
              ))}
              {sortedSections.length === 0 && (
                <p className="rounded-[16px] bg-white/70 px-3 py-4 text-sm font-bold text-[#76667f]">
                  No sections detected yet.
                </p>
              )}
            </div>
          </div>

          <div className="min-w-0 rounded-[24px] border border-white/80 bg-white/70 p-4 shadow-lg shadow-[#e8dcef]/35">
            <form onSubmit={handleAsk} className="space-y-3">
              <label
                htmlFor="rag-question"
                className="text-sm font-black uppercase tracking-normal text-[#76667f]"
              >
                Ask PDF
              </label>
              <textarea
                id="rag-question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                disabled={!selectedDocument || querying}
                rows={4}
                className="w-full resize-none rounded-[18px] border border-white/80 bg-white/85 p-3 text-sm leading-6 text-[#332b38] outline-none focus:border-[#8caf9a] focus:ring-4 focus:ring-[#dcefe4]"
                placeholder="作者怎么看长期记忆？"
              />
              <button
                type="submit"
                disabled={!canAsk || !question.trim()}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[18px] bg-[#7c5fb1] px-4 text-sm font-black text-white shadow-md shadow-[#b99adb]/30 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-65 disabled:hover:translate-y-0"
              >
                {querying ? <Loader2 size={17} className="animate-spin" /> : <Search size={17} />}
                Ask
              </button>
            </form>
          </div>

          {error && (
            <p className="flex items-start gap-2 rounded-[18px] bg-[#ffeceb] px-4 py-3 text-sm font-bold text-[#8f3f3a]">
              <AlertCircle size={17} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}

          {queryResult && (
            <div className="min-w-0 space-y-4 rounded-[24px] border border-white/80 bg-white/70 p-4 shadow-lg shadow-[#e8dcef]/35">
              <div>
                <h2 className="text-sm font-black uppercase tracking-normal text-[#76667f]">
                  Answer
                </h2>
                <div className="mt-3 whitespace-pre-wrap rounded-[18px] bg-white/80 p-4 text-sm leading-7 text-[#332b38]">
                  {queryResult.answer}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-black uppercase tracking-normal text-[#76667f]">
                  Citations
                </h3>
                <div className="mt-2 space-y-2">
                  {queryResult.citations.map((citation) => (
                    <button
                      key={citation.chunkId}
                      type="button"
                      onClick={() =>
                        selectedId
                          ? loadPage(selectedId, citation.pageStart).catch(() => undefined)
                          : undefined
                      }
                      className="w-full rounded-[16px] bg-[#f8fff9] px-3 py-2 text-left text-sm font-bold text-[#3f6d50] transition hover:bg-[#eef8f1]"
                    >
                      <span className="block">{pagesLabel(citation.pageStart, citation.pageEnd)}</span>
                      <span className="mt-1 block text-xs leading-5 text-[#5b7663]">
                        {citation.quote}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <details className="rounded-[18px] bg-white/75 p-3">
                <summary className="cursor-pointer text-sm font-black text-[#554665]">
                  Retrieved chunks
                </summary>
                <div className="mt-3 space-y-2">
                  {queryResult.retrievedChunks.map((chunk) => (
                    <div
                      key={chunk.chunkId}
                      className="rounded-[14px] bg-[#fffcfd] p-3 text-xs leading-5 text-[#5e5367]"
                    >
                      <p className="font-black text-[#3c3342]">
                        {pagesLabel(chunk.pageStart, chunk.pageEnd)} - score {chunk.score}
                      </p>
                      <p className="mt-1">{chunk.preview}</p>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
