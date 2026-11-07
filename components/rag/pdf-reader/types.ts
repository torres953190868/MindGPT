export type DocumentStatus =
  | "queued"
  | "uploaded"
  | "parsing"
  | "parsed"
  | "indexing"
  | "indexed"
  | "failed";

export type RagDocument = {
  id: string;
  fileName: string;
  mimeType?: string;
  pageCount: number;
  title: string | null;
  status: DocumentStatus;
  errorMessage: string | null;
  errorCode: string | null;
  errorStage: string | null;
  errorRequestId: string | null;
  updatedAt: string;
};

export type RagSection = {
  id: string;
  title: string;
  headingPath: string[];
  level: number;
  pageStart: number;
  pageEnd: number;
  source: string;
};

export type RagPage = {
  pageNumber: number;
  cleanText: string;
  tokenCount: number;
};

export type RagChunk = {
  id: string;
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  headingPath: string[];
  tokenCount: number;
  content: string;
  metadata: unknown;
};

export type RagCitation = {
  pageStart: number;
  pageEnd: number;
  chunkId: string;
  headingPath: string[];
  quote: string;
};

export type RagQueryResponse = {
  answer: string;
  citations: RagCitation[];
  retrievedChunks: Array<{
    chunkId: string;
    score: number;
    pageStart: number;
    pageEnd: number;
    headingPath: string[];
    preview: string;
  }>;
};

export type DocumentDetails = {
  document: RagDocument;
  sections: RagSection[];
  chunkCount: number;
};

export type TocNode = {
  section: RagSection;
  children: TocNode[];
};

export type PdfViewport = {
  width: number;
  height: number;
};

export type PdfRenderTask = {
  promise: Promise<void>;
  cancel: () => void;
};

export type PdfPageProxy = {
  getViewport: (options: { scale: number }) => PdfViewport;
  render: (params: {
    canvas: HTMLCanvasElement;
    viewport: PdfViewport;
  }) => PdfRenderTask;
};

export type PdfDocumentProxy = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPageProxy>;
  destroy: () => Promise<void> | void;
};

export type PdfLoadingTask = {
  promise: Promise<PdfDocumentProxy>;
  destroy?: () => Promise<void> | void;
};

export type ReaderActionOptions = {
  actionId?: number;
  loadExtractedText?: boolean;
};

export type LocalPdfPreview = {
  fileName: string;
  url: string;
};

export type PdfJsModule = {
  getDocument: (options: {
    url: string;
    disableAutoFetch?: boolean;
    disableStream?: boolean;
    rangeChunkSize?: number;
    withCredentials?: boolean;
  }) => PdfLoadingTask;
  GlobalWorkerOptions: {
    workerSrc: string;
  };
};

export type PdfSidebarSide = "documents" | "tools";

export type PdfSidebarResizeBoundsOptions = {
  side: PdfSidebarSide;
  gridWidth: number;
  documentsSidebarWidth: number;
  toolsSidebarWidth: number;
};

export const MIN_SCALE = 0.65;
export const MAX_SCALE = 2.25;
export const SCALE_STEP = 0.15;
export const PDF_RANGE_CHUNK_SIZE = 256 * 1024;
export const PDF_PROCESSING_POLL_INTERVAL_MS = 2_500;
export const PDF_DOCUMENTS_SIDEBAR_DEFAULT_WIDTH = 280;
export const PDF_TOOLS_SIDEBAR_DEFAULT_WIDTH = 260;
export const PDF_SIDEBAR_MIN_WIDTH = 210;
export const PDF_VIEWER_MIN_WIDTH = 360;
export const PDF_RESIZE_HANDLE_WIDTH = 8;
export const PDF_MOBILE_MEDIA_QUERY = "(max-width: 1023px)";
