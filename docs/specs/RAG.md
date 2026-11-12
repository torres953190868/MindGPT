PDF Parsing Requirements

Implement parser module:

parsePdf(file): ParsedDocument

or Python equivalent.

Output shape:

type ParsedPage = {
  pageNumber: number
  rawText: string
  cleanText: string
  blocks?: Array<{
    text: string
    bbox?: [number, number, number, number]
    fontSize?: number
    fontName?: string
    isBold?: boolean
  }>
}

type ParsedSection = {
  title: string
  level: number
  headingPath: string[]
  pageStart: number
  pageEnd: number
  source: "pdf_outline" | "font_heuristic" | "regex" | "fallback"
}

Parsing rules:

Extract text per page.
Preserve page_number.
Prefer extracting blocks/spans if available.
Try PDF outline/bookmarks first for TOC.
If no outline exists, detect headings using:
repeated patterns: Chapter, CHAPTER, 第X章, 第X节, 1., 1.1, 一、
short standalone lines
font-size / bold information if available
If heading detection fails, fallback to page-based sections:
every 5–10 pages as a section
section title: Pages 1-10
Detect text-based vs scanned PDF:
if average extracted characters per page is very low, mark as failed
error message: This MVP only supports text-based PDFs. OCR is not implemented yet.
Text Cleaning Requirements

Implement cleaning function:

cleanPageText(rawText: string): string

Rules:

Normalize whitespace.
Fix excessive line breaks.
Preserve paragraph breaks.
Remove obvious repeated headers/footers only if safely detected.
Do not over-clean.
Keep original raw_text in DB.
Chunking Strategy

Implement heading-aware recursive chunking.

Default config:

const CHUNK_CONFIG = {
  strategy: "heading_recursive_v1",
  childChunkSizeTokens: 512,
  childOverlapTokens: 64,
  parentChunkSizeTokens: 1500,
  parentOverlapTokens: 120,
  minChunkTokens: 80,
  maxChunkTokens: 800,
  retrievalTopK: 20,
  finalContextChunks: 6
}

Chunking rules:

Group page text under detected sections.
If a section is smaller than max chunk size, keep it as one chunk.
If too large, recursively split by separators:
\n\n
\n
Chinese punctuation: 。, ！, ？, ；
English punctuation: ., !, ?, ;
comma-level fallback
hard split fallback
Each chunk must preserve:
document_id
section_id
heading_path
page_start
page_end
chunk_index
token_count
Add overlap between adjacent chunks.
Avoid cutting inside a sentence when possible.
Avoid tiny chunks; merge chunks below minChunkTokens with neighbors.
Implement content_hash to avoid duplicate indexing.

Optional but recommended:

Implement parent-child retrieval structure:

Parent chunks: 1200–1800 tokens, stored as larger context blocks.
Child chunks: 250–512 tokens, embedded for retrieval.
Query retrieves child chunks, then expands to parent or neighboring chunks.

For MVP, embedding child chunks is enough. Parent expansion can be implemented if simple.

Embedding Provider

Create provider interface:

interface EmbeddingProvider {
  embedTexts(texts: string[]): Promise<number[][]>
  embedQuery(query: string): Promise<number[]>
  model: string
  dimensions?: number
}

Requirements:

Use env var:
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=...
EMBEDDING_MODEL=text-embedding-3-small
Batch embedding requests.
Add retry with exponential backoff.
Store embedding_model on each chunk.
If no API key exists, tests may use deterministic mock embeddings, but production indexing must fail clearly.
Indexing Pipeline

Implement pipeline:

indexDocument(documentId: string): Promise<void>

Steps:

Set document status to parsing.
Extract pages and sections.
Save document_pages.
Save document_sections.
Set status to indexing.
Generate chunks.
Generate embeddings.
Save document_chunks.
Create/update vector index if needed.
Set status to indexed.
On error, set status to failed and save error_message.

This can run synchronously for MVP. If existing project has queues, use the queue.

Search / Retrieval

Create API:

POST /api/documents/:documentId/query

Input:

{
  "question": "作者怎么看长期记忆？",
  "topK": 20
}

Pipeline:

Validate document is indexed.
Embed user question.
Retrieve topK chunks by vector similarity.
Also run keyword/full-text search if DB supports it.
Merge results.
Deduplicate by chunk id.
Prefer diverse pages/sections instead of 10 nearly identical chunks.
Optional rerank if reranker provider exists.
Return final 5–8 context chunks to LLM.
Generate answer.

Recommended output:

{
  "answer": "...",
  "citations": [
    {
      "pageStart": 12,
      "pageEnd": 13,
      "chunkId": "...",
      "headingPath": ["Chapter 2", "2.1 Memory"],
      "quote": "short excerpt..."
    }
  ],
  "retrievedChunks": [
    {
      "chunkId": "...",
      "score": 0.82,
      "pageStart": 12,
      "pageEnd": 13,
      "headingPath": ["Chapter 2", "2.1 Memory"],
      "preview": "..."
    }
  ]
}
LLM Answer Prompt

Use this prompt inside the query pipeline:

You are a PDF reading assistant.

You will receive:
1. A compressed document outline.
2. Retrieved context chunks from the PDF.
3. The user's question.

Use the document outline only to understand the PDF's structure, chapter hierarchy, and where the retrieved chunks sit in the whole document. The outline is metadata, not primary evidence.

Answer the user's question using ONLY the retrieved context chunks as factual evidence.

Rules:
1. If the retrieved chunks do not contain enough evidence, say: "文档中没有找到明确依据。"
2. Do not invent facts from the outline.
3. Use the outline to organize the answer when helpful, especially for cross-chapter, summary, comparison, or "what is this document about" questions.
4. Cite page numbers after important claims.
5. If retrieved chunks come from different chapters, explain how those chapters relate.
6. Prefer concise, structured Chinese.
7. At the end, provide a "来源" section listing pages and section titles.

Document outline:
{{documentOutline}}

Retrieved context chunks:
{{context}}

User question:
{{question}}

Document outline format:

- Chapter 1 Introduction, pp. 1-5
  - 1.1 Background, pp. 2-3
  - 1.2 Key Concepts, pp. 4-5
- Chapter 2 Method, pp. 6-18

Context format:

[Chunk id: xxx | Pages 12-13 | Section: Chapter 2 > 2.1 Memory]
...chunk content...
Frontend Requirements

Add minimal UI if frontend exists:

Upload page/component
Upload PDF
Show document status:
uploaded
parsing
indexing
indexed
failed
Show page_count when ready
Show detected sections / TOC
Ask PDF panel
Textarea input
Ask button
Loading state
Answer display
Citation display
Clicking citation should navigate to PDF page if PDF preview exists
Show retrieved chunks in collapsible debug panel
PDF preview

Use existing PDF viewer if available. Otherwise add basic page navigation.

API Endpoints

Implement according to project conventions.

Minimum endpoints:

POST /api/documents/upload
GET /api/documents/:documentId
POST /api/documents/:documentId/index
POST /api/documents/:documentId/query
GET /api/documents/:documentId/pages/:pageNumber
GET /api/documents/:documentId/chunks
Error Handling

Handle these cases:

Non-PDF upload
PDF too large
Text extraction empty
Missing embedding API key
Embedding API failure
Document not indexed
Query has no relevant chunks
LLM API failure
DB vector extension missing

Return useful error messages. Do not crash silently.

Tests

Add tests for:

PDF parser returns pages with page numbers.
Cleaner preserves paragraph structure.
Heading detector detects:
Chapter 1
1.1 Background
第1章
一、研究背景
Chunker:
does not exceed max tokens
preserves page_start/page_end
preserves heading_path
adds overlap
merges tiny chunks
Embedding provider mock works.
Retrieval returns chunks with citations.
Query endpoint refuses unindexed docs.
Empty/scanned PDF fails with clear message.

Use synthetic fixtures if real PDFs are not available.

Acceptance Criteria

The implementation is complete only if:

I can upload a text-based PDF.
The system extracts page-level text.
The system detects or creates a basic TOC/section list.
The system chunks content with page metadata.
The system generates embeddings and stores them.
The system can retrieve relevant chunks for a question.
The LLM answer uses only retrieved chunks.
The answer includes page citations.
The frontend shows answer + citations.
There is a debug view showing retrieved chunks.
Tests pass.
No API keys are hardcoded.
README explains setup, env vars, and limitations.
Implementation Order

Work in this order:

Repo inspection and short implementation plan.
DB schema / migrations.
PDF parser.
Page + section persistence.
Chunker.
Embedding provider.
Indexing pipeline.
Retrieval query.
LLM answer generation.
Frontend upload/query UI.
Tests.
README.
Run lint/test/build.
Fix failures.
Provide final summary with changed files and how to run.
Env Vars

Support these:

OPENAI_API_KEY=
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
LLM_PROVIDER=openai
LLM_MODEL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
MAX_PDF_SIZE_MB=50

Use only the env vars required by the detected project stack.

Important Engineering Constraints
Do not implement OCR.
Do not build advanced semantic chunking first.
Do not send the whole PDF to the LLM.
Do not answer without retrieved context.
Do not lose page numbers.
Do not store only embeddings; store raw text and metadata too.
Do not break existing app routes.
Do not introduce unnecessary heavy dependencies.
Keep modules isolated:
parser
cleaner
chunker
embedding
indexer
retriever
answer generator
Prefer simple, testable code over clever abstractions.
Final Output Required From Codex

After implementation, report:

Files changed
DB migrations added
How to run locally
Required env vars
Current limitations
Test results
Manual verification steps
