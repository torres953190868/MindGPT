import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownMessageProps = {
  content: string;
  isStreaming?: boolean;
};

const markdownComponents: Components = {
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
  a: ({ children, href, ...props }) => (
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

const remarkPlugins = [remarkGfm];

export function MarkdownMessage({ content, isStreaming = false }: MarkdownMessageProps) {
  return (
    <div data-testid="conversation-message-content" className="overflow-x-auto break-words">
      <div data-testid={isStreaming ? "streaming-assistant-response" : undefined}>
        <ReactMarkdown components={markdownComponents} remarkPlugins={remarkPlugins}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
