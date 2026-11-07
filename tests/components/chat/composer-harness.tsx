import { vi } from "vitest";
import {
  ActiveSkillChip,
  AttachmentMenuButton,
  ModelSelectorButton,
  PendingAttachmentChips,
  useChatComposerControls,
} from "@/components/chat/ChatComposerControls";
import { jsonResponse } from "../../setup/render";

/**
 * Renders the real composer controls hook with its UI pieces, the way the
 * node detail panel and inline composers wire them together. `selection`
 * exposes the model selection a send would use.
 */
export function ComposerControlsHarness({ isBusy = false }: { isBusy?: boolean }) {
  const controls = useChatComposerControls({ isBusy });

  return (
    <div>
      <button type="button">Outside</button>
      <PendingAttachmentChips
        attachments={controls.pendingAttachments}
        disabled={controls.controlsBusy}
        onRemove={controls.removePendingAttachment}
      />
      {controls.activeSkill && (
        <ActiveSkillChip
          skill={controls.activeSkill}
          disabled={controls.controlsBusy}
          onRemove={controls.removeActiveSkill}
        />
      )}
      <AttachmentMenuButton controls={controls} />
      <ModelSelectorButton controls={controls} />
      <output data-testid="model-selection">
        {controls.modelSelection
          ? `${controls.modelSelection.providerId}:${controls.modelSelection.model}`
          : "auto"}
      </output>
    </div>
  );
}

type RouteMap = Record<string, unknown>;

/** Routes `fetch` by pathname to JSON bodies; unknown routes return 404. */
export function mockFetchRoutes(routes: RouteMap) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const pathname = new URL(url, "http://localhost").pathname;
    if (pathname in routes) return jsonResponse(routes[pathname]);
    return jsonResponse({ error: `No fetch mock for ${pathname}` }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export const MODEL_CATALOG = {
  defaultSelection: { providerId: "deepseek", model: "deepseek-v4-flash" },
  providers: [
    {
      id: "deepseek",
      displayName: "DeepSeek",
      configured: true,
      models: ["deepseek-v4-flash"],
      lockedModels: ["deepseek-v4-pro"],
    },
    {
      id: "qwen",
      displayName: "Qwen",
      configured: true,
      models: ["qwen3.6-plus"],
    },
  ],
};
