type ProjectNotesPdfOptions = {
  exportedAt?: Date;
  notesHtml: string;
  notesMarkdown: string;
  projectTitle: string;
};

const PRINT_FRAME_CLEANUP_DELAY_MS = 750;
const PRINT_FRAME_FALLBACK_CLEANUP_DELAY_MS = 60_000;

const PROJECT_NOTES_PRINT_STYLES = `
  @page {
    margin: 18mm;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    background: #ffffff;
    color: #27212d;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 11pt;
    line-height: 1.55;
  }

  .project-notes-pdf {
    max-width: 760px;
    margin: 0 auto;
  }

  .project-notes-pdf-header {
    margin-bottom: 18pt;
    border-bottom: 1px solid #d8d0df;
    padding-bottom: 11pt;
  }

  .project-notes-pdf-kicker {
    margin: 0 0 5pt;
    color: #6b6074;
    font-size: 8pt;
    font-weight: 800;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  .project-notes-pdf-title {
    margin: 0;
    color: #241d2a;
    font-size: 22pt;
    line-height: 1.16;
  }

  .project-notes-pdf-meta {
    margin: 7pt 0 0;
    color: #6b6074;
    font-size: 8.5pt;
  }

  .project-notes-pdf-content {
    overflow-wrap: anywhere;
  }

  .project-notes-pdf-content > *:first-child {
    margin-top: 0;
  }

  .project-notes-pdf-content > *:last-child {
    margin-bottom: 0;
  }

  .project-notes-pdf-content p {
    margin: 7pt 0;
  }

  .project-notes-pdf-content h1,
  .project-notes-pdf-content h2,
  .project-notes-pdf-content h3 {
    break-after: avoid;
    margin: 16pt 0 7pt;
    color: #241d2a;
    font-weight: 850;
    line-height: 1.22;
  }

  .project-notes-pdf-content h1 {
    font-size: 17pt;
  }

  .project-notes-pdf-content h2 {
    font-size: 14pt;
  }

  .project-notes-pdf-content h3 {
    font-size: 12pt;
  }

  .project-notes-pdf-content ul,
  .project-notes-pdf-content ol {
    margin: 7pt 0;
    padding-left: 18pt;
  }

  .project-notes-pdf-content li {
    margin: 3pt 0;
  }

  .project-notes-pdf-content blockquote,
  .project-notes-editor-blockquote {
    margin: 10pt 0;
    border-left: 3pt solid #c8b4dd;
    padding-left: 10pt;
    color: #42354c;
  }

  .project-notes-pdf-content pre {
    margin: 10pt 0;
    border: 1px solid #d8d0df;
    border-radius: 6pt;
    background: #f8f6fa;
    padding: 9pt;
    white-space: pre-wrap;
  }

  .project-notes-pdf-content code {
    border-radius: 3pt;
    background: #f3eff7;
    padding: 1pt 3pt;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size: 0.9em;
  }

  .project-notes-pdf-content pre code {
    background: transparent;
    padding: 0;
  }

  .project-notes-pdf-content a {
    color: #5b3f88;
    font-weight: 700;
    text-decoration: underline;
  }

  .project-notes-pdf-content hr {
    margin: 12pt 0;
    border: 0;
    border-top: 1px solid #d8d0df;
  }

  .project-notes-pdf-content table,
  .project-notes-editor-table {
    width: 100%;
    margin: 10pt 0;
    border-collapse: collapse;
    font-size: 9.5pt;
  }

  .project-notes-pdf-content th,
  .project-notes-pdf-content td,
  .project-notes-editor-table th,
  .project-notes-editor-table td {
    border: 1px solid #cfc6d8;
    padding: 5pt 6pt;
    vertical-align: top;
  }

  .project-notes-pdf-content th,
  .project-notes-editor-table th {
    background: #f3eff7;
    font-weight: 800;
  }

  .project-notes-editor-task-list {
    list-style: none;
    padding-left: 0;
  }

  .project-notes-editor-task-item {
    display: flex;
    gap: 6pt;
    align-items: flex-start;
  }

  .project-notes-editor-task-item input[type="checkbox"] {
    margin-top: 3pt;
  }

  .project-notes-editor-task-item > div {
    min-width: 0;
    flex: 1;
  }

  .project-notes-editor-details {
    margin: 10pt 0;
    border: 1px solid #d8d0df;
    border-radius: 6pt;
    padding: 8pt;
  }

  .project-notes-editor-details > button {
    display: none;
  }

  .project-notes-editor-details-summary {
    font-weight: 800;
  }

  .project-notes-editor-details-content {
    margin-top: 6pt;
  }

  .tiptap-mathematics-render[data-type="block-math"] {
    display: block;
    margin: 10pt 0;
    overflow-x: visible;
    border: 1px solid #d8d0df;
    border-radius: 6pt;
    background: #fbfafd;
    padding: 9pt;
    text-align: center;
  }

  .project-notes-pdf-plain {
    white-space: pre-wrap;
  }

  .project-notes-pdf-empty {
    color: #6b6074;
    font-style: italic;
  }

  @media print {
    a[href]::after {
      content: " (" attr(href) ")";
      color: #6b6074;
      font-size: 0.86em;
      font-weight: 400;
      text-decoration: none;
    }
  }
`;

function getProjectNotesExportTitle(projectTitle: string) {
  const trimmedTitle = projectTitle.trim();
  return trimmedTitle ? trimmedTitle : "Project notes";
}

function formatExportTimestamp(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function appendProjectNotesContent(
  printDocument: Document,
  container: HTMLElement,
  options: ProjectNotesPdfOptions,
) {
  if (options.notesMarkdown.trim()) {
    if (options.notesHtml.trim()) {
      container.innerHTML = options.notesHtml;
      return;
    }

    const fallback = printDocument.createElement("pre");
    fallback.className = "project-notes-pdf-plain";
    fallback.textContent = options.notesMarkdown.trim();
    container.append(fallback);
    return;
  }

  const emptyState = printDocument.createElement("p");
  emptyState.className = "project-notes-pdf-empty";
  emptyState.textContent = "No notes yet.";
  container.append(emptyState);
}

function populatePrintDocument(printDocument: Document, options: ProjectNotesPdfOptions) {
  const exportTitle = getProjectNotesExportTitle(options.projectTitle);
  const exportedAt = options.exportedAt ?? new Date();

  printDocument.title = `${exportTitle} - Project notes`;

  const style = printDocument.createElement("style");
  style.textContent = PROJECT_NOTES_PRINT_STYLES;
  printDocument.head.append(style);

  const article = printDocument.createElement("article");
  article.className = "project-notes-pdf";

  const header = printDocument.createElement("header");
  header.className = "project-notes-pdf-header";

  const kicker = printDocument.createElement("p");
  kicker.className = "project-notes-pdf-kicker";
  kicker.textContent = "BranchMind project notes";

  const title = printDocument.createElement("h1");
  title.className = "project-notes-pdf-title";
  title.textContent = exportTitle;

  const meta = printDocument.createElement("p");
  meta.className = "project-notes-pdf-meta";
  meta.textContent = `Exported ${formatExportTimestamp(exportedAt)}`;

  header.append(kicker, title, meta);

  const content = printDocument.createElement("section");
  content.className = "project-notes-pdf-content";
  appendProjectNotesContent(printDocument, content, options);

  article.append(header, content);
  printDocument.body.replaceChildren(article);
}

export function exportProjectNotesPdf(options: ProjectNotesPdfOptions) {
  if (
    typeof document === "undefined" ||
    typeof window === "undefined" ||
    !document.body
  ) {
    return false;
  }

  const printFrame = document.createElement("iframe");
  printFrame.setAttribute("aria-hidden", "true");
  printFrame.title = "Project notes PDF export";
  printFrame.style.position = "fixed";
  printFrame.style.left = "-10000px";
  printFrame.style.top = "0";
  printFrame.style.width = "794px";
  printFrame.style.height = "1123px";
  printFrame.style.border = "0";
  printFrame.style.opacity = "0";
  printFrame.style.pointerEvents = "none";

  document.body.append(printFrame);

  const printWindow = printFrame.contentWindow;
  const printDocument = printFrame.contentDocument ?? printWindow?.document ?? null;

  if (!printWindow || !printDocument) {
    printFrame.remove();
    return false;
  }

  printDocument.open();
  printDocument.write(
    '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>',
  );
  printDocument.close();
  populatePrintDocument(printDocument, options);

  const removePrintFrame = () => {
    printFrame.remove();
  };
  const cleanupAfterPrint = () => {
    window.setTimeout(removePrintFrame, PRINT_FRAME_CLEANUP_DELAY_MS);
  };

  printWindow.addEventListener("afterprint", cleanupAfterPrint, { once: true });
  window.setTimeout(removePrintFrame, PRINT_FRAME_FALLBACK_CLEANUP_DELAY_MS);
  printWindow.setTimeout(() => {
    try {
      printWindow.focus();
      printWindow.print();
    } catch {
      removePrintFrame();
    }
  }, 50);

  return true;
}
