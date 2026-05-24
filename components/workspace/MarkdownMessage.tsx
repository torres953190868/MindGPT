import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { replaceChatCitationMarkers } from "@/lib/chat-citations";
import type { ChatCitation } from "@/lib/types";

type MarkdownMessageProps = {
  content: string;
  citations?: ChatCitation[];
  isStreaming?: boolean;
  testId?: string;
};

function pagesLabel(start: number, end: number) {
  return start === end ? `p. ${start}` : `pp. ${start}-${end}`;
}

function citationHref(citation: ChatCitation) {
  const params = new URLSearchParams();
  params.set("document", citation.documentId);
  params.set("page", String(citation.pageStart));
  params.set("chunk", citation.chunkId);
  return `/reader?${params.toString()}`;
}

function renderCitationMarkers(content: string, citations: ChatCitation[]) {
  if (citations.length === 0) return content;

  const citationByIndex = new Map(
    citations.map((citation) => [citation.index, citation]),
  );

  return replaceChatCitationMarkers(content, (index, marker) => {
    const citation = citationByIndex.get(index);
    return citation ? `[${index}](${citationHref(citation)})` : marker;
  });
}

function isCitationLink(href: string | undefined) {
  return Boolean(href?.startsWith("/reader?"));
}

function createMarkdownComponents(): Components {
  return {
    h1: ({ children, ...props }) => (
      <h1 className="mb-2 mt-3 text-lg font-black leading-snug first:mt-0" {...props}>
        {children}
      </h1>
    ),
    h2: ({ children, ...props }) => (
      <h2 className="mb-2 mt-3 text-base font-black leading-snug first:mt-0" {...props}>
        {children}
      </h2>
    ),
    h3: ({ children, ...props }) => (
      <h3 className="mb-2 mt-3 text-sm font-black leading-snug first:mt-0" {...props}>
        {children}
      </h3>
    ),
    p: ({ children, ...props }) => (
      <p className="my-2 leading-6 first:mt-0 last:mb-0" {...props}>
        {children}
      </p>
    ),
    ul: ({ children, ...props }) => (
      <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0" {...props}>
        {children}
      </ul>
    ),
    ol: ({ children, ...props }) => (
      <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0" {...props}>
        {children}
      </ol>
    ),
    li: ({ children, ...props }) => (
      <li className="pl-1 leading-6" {...props}>
        {children}
      </li>
    ),
    blockquote: ({ children, ...props }) => (
      <blockquote
        className="my-2 border-l-4 border-current/25 pl-3 italic opacity-85 first:mt-0 last:mb-0"
        {...props}
      >
        {children}
      </blockquote>
    ),
    a: ({ children, href, ...props }) =>
      isCitationLink(href) ? (
        <a
          className="mx-0.5 inline-grid h-5 min-w-5 translate-y-[-1px] place-items-center rounded-full bg-brand-600 px-1.5 text-[11px] font-black leading-none text-white no-underline shadow-sm shadow-brand-200/70 transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-200"
          href={href}
          data-testid="message-citation-link"
          {...props}
        >
          {children}
        </a>
      ) : (
        <a
          className="font-black underline decoration-current/35 underline-offset-2 transition hover:decoration-current"
          href={href}
          rel="noreferrer"
          target={href?.startsWith("#") ? undefined : "_blank"}
          {...props}
        >
          {children}
        </a>
      ),
    code: ({ children, className, ...props }) => (
      <code
        className={`${className ?? ""} rounded bg-white/70 px-1 py-0.5 font-mono text-[0.86em]`}
        {...props}
      >
        {children}
      </code>
    ),
    pre: ({ children, ...props }) => (
      <pre
        className="my-2 overflow-x-auto rounded-[14px] bg-white/72 p-3 text-xs leading-5 first:mt-0 last:mb-0"
        {...props}
      >
        {children}
      </pre>
    ),
    table: ({ children, ...props }) => (
      <table className="my-2 w-full border-collapse text-left text-xs" {...props}>
        {children}
      </table>
    ),
    th: ({ children, ...props }) => (
      <th className="border border-current/20 bg-white/50 px-2 py-1 font-black" {...props}>
        {children}
      </th>
    ),
    td: ({ children, ...props }) => (
      <td className="border border-current/20 px-2 py-1 align-top" {...props}>
        {children}
      </td>
    ),
  };
}

const remarkPlugins = [remarkGfm];

export function MarkdownMessage({
  content,
  citations = [],
  isStreaming = false,
  testId = "conversation-message-content",
}: MarkdownMessageProps) {
  const renderedContent = renderCitationMarkers(content, citations);
  const markdownComponents = createMarkdownComponents();

  return (
    <div data-testid={testId} className="overflow-x-auto break-words">
      <div data-testid={isStreaming ? "streaming-assistant-response" : undefined}>
        <ReactMarkdown components={markdownComponents} remarkPlugins={remarkPlugins}>
          {renderedContent}
        </ReactMarkdown>
      </div>
      {citations.length > 0 && (
        <div
          data-testid="message-citation-list"
          className="mt-3 space-y-2 rounded-lg border border-brand-100 bg-white/55 p-2.5"
        >
          {citations.map((citation) => (
            <a
              key={`${citation.index}-${citation.documentId}-${citation.chunkId}`}
              href={citationHref(citation)}
              data-testid="message-citation-source"
              className="group flex min-w-0 gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-brand-200"
            >
              <span className="mt-0.5 grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand-600 px-1.5 text-[11px] font-black leading-none text-white">
                {citation.index}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-black text-neutral-800">
                  {citation.documentName} · {pagesLabel(citation.pageStart, citation.pageEnd)}
                </span>
                {citation.headingPath.length > 0 && (
                  <span className="mt-0.5 block truncate text-[11px] font-bold text-neutral-500">
                    {citation.headingPath.join(" / ")}
                  </span>
                )}
                <span className="mt-1 line-clamp-2 block text-xs leading-5 text-neutral-600">
                  {citation.quote}
                </span>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
