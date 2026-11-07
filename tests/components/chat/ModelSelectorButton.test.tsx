import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MODEL_SELECTION_STORAGE_KEY } from "@/components/chat/composer-controls/model-helpers";
import { copy, renderWithProviders } from "../../setup/render";
import { ComposerControlsHarness, MODEL_CATALOG, mockFetchRoutes } from "./composer-harness";

function getModelButton() {
  return screen.getByRole("button", { name: copy.chat.chooseChatModel });
}

async function openModelMenu(user: ReturnType<typeof renderWithProviders>["user"]) {
  await user.click(getModelButton());
  const menu = screen.getByRole("listbox", { name: copy.chat.chatModels });
  // Wait for the catalog request to populate the options.
  await within(menu).findAllByTestId("chat-model-option");
  return menu;
}

function getOption(menu: HTMLElement, label: string) {
  return within(menu).getByRole("option", { name: new RegExp(`^${label}`) });
}

describe("ModelSelectorButton", () => {
  it("defaults to automatic model selection", async () => {
    mockFetchRoutes({ "/api/chat/models": MODEL_CATALOG });
    const { user } = renderWithProviders(<ComposerControlsHarness />);

    expect(getModelButton()).toHaveTextContent(copy.chat.autoModel);
    expect(getModelButton()).toHaveAttribute("aria-expanded", "false");

    const menu = await openModelMenu(user);
    expect(getModelButton()).toHaveAttribute("aria-expanded", "true");
    expect(within(menu).getByTestId("chat-model-auto-option")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("model-selection")).toHaveTextContent("auto");
  });

  it("selects an available model, closes the menu and remembers the choice", async () => {
    mockFetchRoutes({ "/api/chat/models": MODEL_CATALOG });
    const { user } = renderWithProviders(<ComposerControlsHarness />);

    const menu = await openModelMenu(user);
    await user.click(getOption(menu, "Qwen 3.6 Plus"));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(getModelButton()).toHaveTextContent("Qwen 3.6 Plus");
    expect(screen.getByTestId("model-selection")).toHaveTextContent("qwen:qwen3.6-plus");
    expect(JSON.parse(window.localStorage.getItem(MODEL_SELECTION_STORAGE_KEY) ?? "null")).toEqual(
      { providerId: "qwen", model: "qwen3.6-plus" },
    );
  });

  it("does not select locked or unconfigured models", async () => {
    mockFetchRoutes({ "/api/chat/models": MODEL_CATALOG });
    const { user } = renderWithProviders(<ComposerControlsHarness />);

    const menu = await openModelMenu(user);
    const lockedOption = getOption(menu, "DeepSeek V4 Pro");
    expect(lockedOption).toHaveAttribute("aria-disabled", "true");
    expect(within(lockedOption).getByLabelText(copy.chat.modelLocked)).toBeInTheDocument();

    const unconfiguredOption = getOption(menu, "GPT-5.6 Sol");
    expect(unconfiguredOption).toHaveAttribute("aria-disabled", "true");
    expect(
      within(unconfiguredOption).getByLabelText(copy.chat.modelApiNotConfigured),
    ).toBeInTheDocument();

    await user.click(lockedOption);
    await user.click(unconfiguredOption);

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(getModelButton()).toHaveTextContent(copy.chat.autoModel);
    expect(screen.getByTestId("model-selection")).toHaveTextContent("auto");
  });

  it("switches back to automatic selection", async () => {
    mockFetchRoutes({ "/api/chat/models": MODEL_CATALOG });
    const { user } = renderWithProviders(<ComposerControlsHarness />);

    await user.click(getOption(await openModelMenu(user), "DeepSeek V4 Flash"));
    expect(screen.getByTestId("model-selection")).toHaveTextContent("deepseek:deepseek-v4-flash");

    await user.click(getModelButton());
    await user.click(screen.getByTestId("chat-model-auto-option"));

    expect(getModelButton()).toHaveTextContent(copy.chat.autoModel);
    expect(screen.getByTestId("model-selection")).toHaveTextContent("auto");
  });

  it("closes on Escape and on an outside click", async () => {
    mockFetchRoutes({ "/api/chat/models": MODEL_CATALOG });
    const { user } = renderWithProviders(<ComposerControlsHarness />);

    await openModelMenu(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.click(getModelButton());
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("offers a retry when the model catalog fails to load", async () => {
    const fetchMock = mockFetchRoutes({});
    const { user } = renderWithProviders(<ComposerControlsHarness />);

    await user.click(getModelButton());
    const retryButton = await screen.findByTestId("retry-chat-model-catalog-button");
    expect(retryButton).toHaveTextContent(copy.chat.retryModelCatalog);
    expect(screen.queryByTestId("chat-model-option")).not.toBeInTheDocument();

    mockFetchRoutes({ "/api/chat/models": MODEL_CATALOG });
    await user.click(retryButton);

    expect(await screen.findAllByTestId("chat-model-option")).not.toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledWith("/api/chat/models", expect.anything());
  });

  it("is disabled while the composer is busy", async () => {
    mockFetchRoutes({ "/api/chat/models": MODEL_CATALOG });
    renderWithProviders(<ComposerControlsHarness isBusy />);

    expect(getModelButton()).toBeDisabled();
    // Let the mount-time catalog request settle before the test ends.
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/chat/models", expect.anything()));
  });
});
