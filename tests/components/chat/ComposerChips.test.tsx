import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ActiveSkillChip,
  PendingAttachmentChips,
  type PendingChatAttachment,
} from "@/components/chat/ChatComposerControls";
import { copy, renderWithProviders } from "../../setup/render";

function makeAttachment(overrides: Partial<PendingChatAttachment> & Pick<PendingChatAttachment, "id" | "name">): PendingChatAttachment {
  return {
    mimeType: "text/plain",
    size: 2048,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("PendingAttachmentChips", () => {
  it("renders nothing without attachments", () => {
    renderWithProviders(<PendingAttachmentChips attachments={[]} disabled={false} onRemove={vi.fn()} />);

    expect(screen.queryByTestId("pending-attachment-list")).not.toBeInTheDocument();
  });

  it("lists files, knowledge PDFs and course materials with their details", () => {
    renderWithProviders(
      <PendingAttachmentChips
        attachments={[
          makeAttachment({ id: "file", name: "notes.txt" }),
          makeAttachment({
            id: "pdf",
            name: "biology.pdf",
            mimeType: "application/pdf",
            size: 0,
            documentId: "doc-1",
            documentStatus: "indexed",
            uploadStatus: "indexed",
          }),
          makeAttachment({
            id: "course",
            name: "Cell biology",
            size: 0,
            curriculumId: "curriculum-1",
          }),
        ]}
        disabled={false}
        onRemove={vi.fn()}
      />,
    );

    const list = screen.getByRole("list", { name: copy.chat.pendingAttachments });
    const chips = within(list).getAllByRole("listitem");
    expect(chips).toHaveLength(3);
    expect(chips[0]).toHaveTextContent("notes.txt");
    expect(chips[0]).toHaveTextContent("text/plain - 2.0 KB");
    expect(chips[1]).toHaveTextContent(copy.chat.knowledgePdf);
    expect(chips[1]).toHaveTextContent(copy.chat.indexed);
    expect(chips[2]).toHaveTextContent(copy.chat.knowledgeCurriculum);
  });

  it("shows upload progress and failure references", () => {
    renderWithProviders(
      <PendingAttachmentChips
        attachments={[
          makeAttachment({ id: "a", name: "uploading.pdf", uploadStatus: "uploading" }),
          makeAttachment({
            id: "b",
            name: "broken.pdf",
            uploadStatus: "failed",
            errorRequestId: "req-123",
          }),
        ]}
        disabled={false}
        onRemove={vi.fn()}
      />,
    );

    const [uploading, failed] = screen.getAllByTestId("pending-attachment-chip");
    expect(uploading).toHaveTextContent(copy.chat.uploading);
    expect(failed).toHaveTextContent(copy.chat.failed);
    expect(failed).toHaveTextContent("Ref: req-123");
  });

  it("removes a specific attachment", async () => {
    const onRemove = vi.fn();
    const { user } = renderWithProviders(
      <PendingAttachmentChips
        attachments={[
          makeAttachment({ id: "first", name: "first.txt" }),
          makeAttachment({ id: "second", name: "second.txt" }),
        ]}
        disabled={false}
        onRemove={onRemove}
      />,
    );

    await user.click(screen.getByRole("button", { name: `${copy.common.close} second.txt` }));

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith("second");
  });

  it("disables removal while the composer is busy", () => {
    renderWithProviders(
      <PendingAttachmentChips
        attachments={[makeAttachment({ id: "first", name: "first.txt" })]}
        disabled
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByTestId("remove-pending-attachment-button")).toBeDisabled();
  });
});

describe("ActiveSkillChip", () => {
  const skill = {
    id: "skill-1",
    name: "Socratic tutor",
    description: "Asks guiding questions",
    instructions: "Ask questions.",
    version: "1",
  };

  it("names the active skill and removes it", async () => {
    const onRemove = vi.fn();
    const { user } = renderWithProviders(
      <ActiveSkillChip skill={skill} disabled={false} onRemove={onRemove} />,
    );

    expect(screen.getByLabelText(`${copy.chat.skillActive}: Socratic tutor`)).toHaveTextContent(
      "Socratic tutor",
    );
    await user.click(screen.getByRole("button", { name: copy.chat.skillRemove }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("cannot be removed while busy", () => {
    renderWithProviders(<ActiveSkillChip skill={skill} disabled onRemove={vi.fn()} />);

    expect(screen.getByRole("button", { name: copy.chat.skillRemove })).toBeDisabled();
  });
});
