import { createRef } from "react";
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  PdfDocumentsSidebar,
  type PdfDocumentsSidebarProps,
} from "@/components/rag/pdf-reader/PdfDocumentsSidebar";
import type { RagDocument } from "@/components/rag/pdf-reader/types";
import { copy, renderWithProviders } from "../../../setup/render";

function makeDocument(overrides: Partial<RagDocument> & Pick<RagDocument, "id">): RagDocument {
  return {
    fileName: `${overrides.id}.pdf`,
    pageCount: 0,
    title: null,
    status: "indexed",
    errorMessage: null,
    errorCode: null,
    errorStage: null,
    errorRequestId: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const DOCUMENTS = [
  makeDocument({ id: "doc-1", title: "Biology Basics", pageCount: 12 }),
  makeDocument({ id: "doc-2", fileName: "chemistry.pdf" }),
];

function renderSidebar(overrides: Partial<PdfDocumentsSidebarProps> = {}) {
  const props: PdfDocumentsSidebarProps = {
    fileInputRef: createRef<HTMLInputElement>(),
    documents: DOCUMENTS,
    selectedId: null,
    busy: false,
    uploading: false,
    renamingDocumentId: null,
    renameValue: "",
    renameSaving: false,
    deletingDocumentId: null,
    onUpload: vi.fn((event) => event.preventDefault()),
    onSelectDocument: vi.fn(),
    onRenameValueChange: vi.fn(),
    onStartRename: vi.fn(),
    onCancelRename: vi.fn(),
    onSubmitRename: vi.fn((event) => event.preventDefault()),
    onDeleteDocument: vi.fn(),
    ...overrides,
  };
  const result = renderWithProviders(<PdfDocumentsSidebar {...props} />);
  return { ...result, props };
}

describe("PdfDocumentsSidebar", () => {
  it("lists documents by title, falling back to the file name", () => {
    renderSidebar();

    const rows = screen.getAllByTestId("pdf-document-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Biology Basics");
    expect(rows[0]).toHaveTextContent("12 pages");
    expect(rows[1]).toHaveTextContent("chemistry.pdf");
  });

  it("shows an empty state without documents", () => {
    renderSidebar({ documents: [] });

    expect(screen.getByText(copy.reader.noPdfs)).toBeInTheDocument();
  });

  it("selects, renames and deletes a specific document", async () => {
    const { user, props } = renderSidebar();

    await user.click(screen.getByRole("button", { name: /^Biology Basics/ }));
    expect(props.onSelectDocument).toHaveBeenCalledWith("doc-1");

    await user.click(screen.getByRole("button", { name: "Rename chemistry.pdf" }));
    expect(props.onStartRename).toHaveBeenCalledWith(DOCUMENTS[1]);

    await user.click(screen.getByRole("button", { name: "Delete Biology Basics" }));
    expect(props.onDeleteDocument).toHaveBeenCalledWith(DOCUMENTS[0]);
  });

  it("edits the name inline and submits or cancels the rename", async () => {
    const { user, props } = renderSidebar({
      renamingDocumentId: "doc-1",
      renameValue: "Biology Basics",
    });

    const input = screen.getByRole("textbox", { name: copy.reader.title });
    expect(input).toHaveFocus();
    await user.type(input, "!");
    expect(props.onRenameValueChange).toHaveBeenLastCalledWith("Biology Basics!");

    await user.click(screen.getByRole("button", { name: copy.reader.savePdfName }));
    expect(props.onSubmitRename).toHaveBeenCalledWith(expect.anything(), DOCUMENTS[0]);

    await user.click(screen.getByRole("button", { name: copy.common.cancel }));
    expect(props.onCancelRename).toHaveBeenCalledTimes(1);
  });

  it("disables saving an empty name", () => {
    renderSidebar({ renamingDocumentId: "doc-1", renameValue: "   " });

    expect(screen.getByRole("button", { name: copy.reader.savePdfName })).toBeDisabled();
  });

  it("locks row actions while a document is being deleted", () => {
    renderSidebar({ deletingDocumentId: "doc-2" });

    const row = screen.getAllByTestId("pdf-document-row")[0];
    expect(within(row).getByTestId("rename-pdf-button")).toBeDisabled();
    expect(within(row).getByTestId("delete-pdf-button")).toBeDisabled();
  });
});
