# BranchMind

BranchMind is a Next.js App Router app for branching AI learning workflows. It now includes a text-PDF reader + RAG MVP for selectable-text PDFs.

## Local Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000/reader` for the PDF reader.

## Environment

Copy `.env.example` to `.env.local` and fill the providers you want to use.

Required for PDF embeddings with DashScope:

```bash
EMBEDDING_PROVIDER=dashscope
EMBEDDING_MODEL=text-embedding-v4
EMBEDDING_DIMENSIONS=1024
DASHSCOPE_API_KEY=
```

Or with Gemini:

```bash
EMBEDDING_PROVIDER=gemini
EMBEDDING_MODEL=gemini-embedding-2
EMBEDDING_DIMENSIONS=1024
GEMINI_API_KEY=
```

Optional retry tuning for transient provider 429s:

```bash
EMBEDDING_RETRY_ATTEMPTS=5
EMBEDDING_RETRY_DELAY_MS=250
EMBEDDING_RETRY_MAX_DELAY_MS=8000
```

Required for grounded answer generation, unless `AI_MOCK_MODE=true`:

```bash
LLM_PROVIDER=deepseek
LLM_MODEL=deepseek-v4-flash
DEEPSEEK_API_KEY=
```

Storage:

```bash
BRANCHMIND_RAG_BACKEND=auto
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
# Either this or NEXT_PUBLIC_SUPABASE_ANON_KEY works.
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

`auto` uses Supabase when configured and local file storage under `data/` otherwise. Production requires Supabase configuration.

PDF indexing uses Vercel Queues in production. In local `next dev`, BranchMind
runs indexing inline in the dev server process by default, avoiding Vercel OIDC
requirements. Set `BRANCHMIND_RAG_QUEUE_MODE=queue` to force queue-only behavior,
or `BRANCHMIND_RAG_QUEUE_MODE=inline` to force inline processing explicitly.

## Database

Apply Supabase migrations in `supabase/migrations`, including:

- `20260514010000_pdf_rag_foundation.sql`
- `20260516010000_pdf_rag_diagnostics.sql`
- `20260524000000_pdf_rag_queued_status.sql`
- `20260524010000_branchmind_message_citations.sql`

The RAG migration creates:

- `documents`
- `document_pages`
- `document_sections`
- `document_chunks`
- `pgvector` embedding storage with `vector(1024)`

## PDF Reader Flow

1. Upload a PDF at `/reader`.
2. The server extracts selectable text page by page with `pdfjs-dist`.
3. It detects PDF outline entries or simple chapter/heading patterns.
4. It stores pages, sections, chunks, page ranges, hashes, and metadata.
5. It embeds chunks with the configured provider: DashScope or Gemini.
6. Questions retrieve relevant chunks and ask the configured chat provider to answer only from that context.
7. Answers return page citations and retrieved chunk debug metadata.

## Limitations

- No OCR for scanned PDFs.
- No image understanding.
- No table-accurate extraction.
- No formula parsing.
- No multi-document cross-query.
- Retrieval is single-document and intentionally simple for the MVP.
- Supabase vector storage is fixed at 1024 dimensions; keep `EMBEDDING_DIMENSIONS=1024` unless you also migrate the vector column.

## Verification

```bash
npm run test
npm run lint
npm run typecheck
npm run build
```
