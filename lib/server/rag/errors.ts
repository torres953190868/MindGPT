export class RagError extends Error {
  code: string;
  details?: unknown;
  expose: boolean;
  status: number;

  constructor(
    message: string,
    options: {
      code?: string;
      details?: unknown;
      expose?: boolean;
      status?: number;
    } = {},
  ) {
    super(message);
    this.name = "RagError";
    this.code = options.code ?? "RAG_ERROR";
    this.details = options.details;
    this.expose = options.expose ?? true;
    this.status = options.status ?? 400;
  }
}
