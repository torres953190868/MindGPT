import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { copy, renderWithProviders } from "../../setup/render";
import { ComposerControlsHarness, MODEL_CATALOG, mockFetchRoutes } from "./composer-harness";

const KNOWLEDGE_ROUTES = {
  "/api/chat/models": MODEL_CATALOG,
  "/api/documents": {
    documents: [
      {
        id: "doc-indexed",
        fileName: "biology.pdf",
        mimeType: "application/pdf",
        pageCount: 12,
        title: "Biology Basics",
        status: "indexed",
        errorMessage: null,
        errorRequestId: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "doc-parsing",
        fileName: "draft.pdf",
        mimeType: "application/pdf",
        pageCount: 0,
        title: null,
        status: "parsing",
        errorMessage: null,
        errorRequestId: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  },
  "/api/curricula/attachable": { items: [] },
};

function getAttachmentButton() {
  return screen.getByRole("button", { name: copy.chat.addFilesKnowledge });
}

describe("AttachmentMenuButton", () => {
  it("opens and closes the attachment menu from its button", async () => {
    mockFetchRoutes(KNOWLEDGE_ROUTES);
    const { user } = renderWithProviders(<ComposerControlsHarness />);

    expect(getAttachmentButton()).toHaveAttribute("aria-expanded", "false");
    await user.click(getAttachmentButton());

    const menu = screen.getByRole("menu", { name: copy.chat.addAttachment });
    expect(getAttachmentButton()).toHaveAttribute("aria-expanded", "true");
    expect(within(menu).getByRole("menuitem", { name: copy.chat.uploadNewFile })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: copy.chat.knowledgeBase })).toBeInTheDocument();

    await user.click(getAttachmentButton());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Escape and on an outside click", async () => {
    mockFetchRoutes(KNOWLEDGE_ROUTES);
    const { user } = renderWithProviders(<ComposerControlsHarness />);

    await user.click(getAttachmentButton());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(getAttachmentButton());
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes the model menu when opened", async () => {
    mockFetchRoutes(KNOWLEDGE_ROUTES);
    const { user } = renderWithProviders(<ComposerControlsHarness />);

    await user.click(screen.getByRole("button", { name: copy.chat.chooseChatModel }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.click(getAttachmentButton());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("menu", { name: copy.chat.addAttachment })).toBeInTheDocument();
  });

  it("attaches an indexed knowledge PDF as a pending chip and lets it be removed", async () => {
    mockFetchRoutes(KNOWLEDGE_ROUTES);
    const { user } = renderWithProviders(<ComposerControlsHarness />);

    await user.click(getAttachmentButton());
    await user.click(screen.getByRole("menuitem", { name: copy.chat.knowledgeBase }));

    const knowledgeMenu = screen.getByRole("menu", { name: copy.chat.knowledgePdfs });
    const options = await within(knowledgeMenu).findAllByTestId("knowledge-document-option");
    // Only indexed documents are offered.
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Biology Basics");
    expect(options[0]).toHaveTextContent("12 pages");

    await user.click(options[0]);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    const chip = screen.getByTestId("pending-attachment-chip");
    expect(chip).toHaveTextContent("biology.pdf");
    expect(chip).toHaveTextContent(copy.chat.knowledgePdf);

    await user.click(screen.getByRole("button", { name: `${copy.common.close} biology.pdf` }));
    expect(screen.queryByTestId("pending-attachment-chip")).not.toBeInTheDocument();
  });

  it("shows an empty state when no PDFs are indexed", async () => {
    mockFetchRoutes({ ...KNOWLEDGE_ROUTES, "/api/documents": { documents: [] } });
    const { user } = renderWithProviders(<ComposerControlsHarness />);

    await user.click(getAttachmentButton());
    await user.click(screen.getByRole("menuitem", { name: copy.chat.knowledgeBase }));

    expect(
      await within(screen.getByRole("menu", { name: copy.chat.knowledgePdfs })).findByText(
        copy.chat.noIndexedPdfs,
      ),
    ).toBeInTheDocument();
  });

  it("activates a skill from the skill menu and removes it from the chip", async () => {
    mockFetchRoutes(KNOWLEDGE_ROUTES);
    const { user } = renderWithProviders(<ComposerControlsHarness />);

    await user.click(getAttachmentButton());
    await user.click(screen.getByTestId("skill-menu-button"));

    const skillMenu = screen.getByTestId("skill-document-menu");
    const [firstSkill] = within(skillMenu).getAllByTestId("skill-option");
    const skillName = firstSkill.querySelector(".truncate")?.textContent ?? "";
    expect(skillName).not.toBe("");

    await user.click(firstSkill);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByTestId("active-skill-chip")).toHaveTextContent(skillName);

    await user.click(screen.getByRole("button", { name: copy.chat.skillRemove }));
    expect(screen.queryByTestId("active-skill-chip")).not.toBeInTheDocument();
  });

  it("is disabled while the composer is busy", async () => {
    mockFetchRoutes(KNOWLEDGE_ROUTES);
    renderWithProviders(<ComposerControlsHarness isBusy />);

    expect(getAttachmentButton()).toBeDisabled();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });
});
