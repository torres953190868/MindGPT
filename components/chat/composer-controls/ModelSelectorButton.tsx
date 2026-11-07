"use client";

import {
  Check,
  ChevronDown,
  Infinity as InfinityIcon,
  Loader2,
  LockKeyhole,
} from "lucide-react";
import { useLanguage } from "@/components/language/LanguageProvider";
import {
  getHighlightedActionClass,
  useHighlightedAction,
} from "@/components/ui/highlighted-action";
import {
  getMenuPlacementClass,
  stopFloatingMenuWheelPropagation,
} from "./floating-menu";
import { formatModelLabel, matchesModelSelection } from "./model-helpers";
import type { FloatingMenuAlignment, FloatingMenuPlacement } from "./types";
import type { ChatComposerControlsState } from "./useChatComposerControls";

export function ModelLogo({
  model,
  size = "md",
}: {
  model: string;
  size?: "sm" | "md";
}) {
  const normalizedModel = model.toLowerCase();
  const boxClass = size === "sm" ? "h-5 w-5" : "h-8 w-8";
  const textClass = size === "sm" ? "text-[10px]" : "text-xs";
  const logo = normalizedModel.includes("kimi")
    ? { path: "/model-logos/kimi.svg", background: "#050505", scale: "68%" }
    : normalizedModel.includes("mimo")
      ? { path: "/model-logos/mimo.svg", background: "#ffffff", scale: "88%" }
      : normalizedModel.includes("deepseek")
        ? { path: "/model-logos/deepseek.svg", background: "#ffffff", scale: "72%" }
        : normalizedModel.includes("glm")
          ? { path: "/model-logos/glm.svg", background: "#ffffff", scale: "72%" }
          : normalizedModel.includes("qwen")
            ? { path: "/model-logos/qwen.svg", background: "#ffffff", scale: "72%" }
            : normalizedModel.includes("gemini")
              ? { path: "/model-logos/gemini.svg", background: "#ffffff", scale: "68%" }
              : normalizedModel.includes("gpt") || normalizedModel.includes("openai")
                ? { path: "/model-logos/openai.svg", background: "#ffffff", scale: "68%" }
                : normalizedModel.includes("claude")
                  ? { path: "/model-logos/claude.svg", background: "#ffffff", scale: "68%" }
                  : null;

  if (logo) {
    return (
      <span
        aria-hidden="true"
        className={`${boxClass} shrink-0 rounded-full border border-neutral-200 bg-center bg-no-repeat`}
        style={{
          backgroundColor: logo.background,
          backgroundImage: `url("${logo.path}")`,
          backgroundSize: logo.scale,
        }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`grid ${boxClass} shrink-0 place-items-center rounded-full border border-neutral-200 bg-white font-black text-neutral-700 ${textClass}`}
    >
      {model.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function ModelSelectorButton({
  controls,
  placement = "above",
  alignment = "start",
}: {
  controls: ChatComposerControlsState;
  placement?: FloatingMenuPlacement;
  alignment?: FloatingMenuAlignment;
}) {
  const { copy } = useLanguage();
  const modelHighlight = useHighlightedAction<"model">();

  return (
    <div ref={controls.modelMenuRef} className="relative min-w-0 shrink">
      <button
        type="button"
        onClick={controls.toggleModelMenu}
        {...modelHighlight.getPointerHoverHandlers("model", {
          clearOnMouseLeave: true,
        })}
        disabled={controls.controlsBusy}
        aria-label={copy.chat.chooseChatModel}
        aria-haspopup="listbox"
        aria-expanded={controls.isModelMenuOpen}
        data-testid="chat-model-selector-button"
        data-highlighted={modelHighlight.getDataHighlighted("model")}
        className={`inline-flex h-9 w-full min-w-0 max-w-[150px] items-center justify-center gap-1.5 rounded-[18px] border border-brand-200 px-2.5 text-xs font-black shadow-sm transition hover:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-50 ${getHighlightedActionClass(
          modelHighlight.isHighlighted("model"),
          "bg-white/82 text-neutral-800",
        )}`}
      >
        {controls.isAutoSelected ? (
          <InfinityIcon size={18} strokeWidth={2.4} className="shrink-0 text-neutral-800" />
        ) : (
          <ModelLogo model={controls.selectedModel.model} size="sm" />
        )}
        <span className="min-w-0 truncate">{controls.selectedModelLabel}</span>
        <ChevronDown
          size={13}
          className={`shrink-0 text-neutral-500 transition ${
            controls.isModelMenuOpen ? "rotate-180" : ""
          }`}
        />
      </button>
      {controls.isModelMenuOpen && (
        <div
          role="listbox"
          aria-label={copy.chat.chatModels}
          data-testid="chat-model-menu"
          onWheel={stopFloatingMenuWheelPropagation}
          className={`${getMenuPlacementClass(placement, alignment)} chat-model-menu-scrollable nowheel max-h-[min(11rem,calc(100svh-8rem))] w-[min(14rem,calc(100vw-1rem))] overflow-auto overscroll-contain rounded-[18px] border border-[var(--theme-border-default)] bg-white/95 p-1 shadow-xl shadow-neutral-900/10 backdrop-blur`}
        >
          <button
            type="button"
            role="option"
            aria-selected={controls.isAutoSelected}
            disabled={controls.controlsBusy}
            onClick={controls.selectAutoModel}
            data-testid="chat-model-auto-option"
            className={`chat-menu-highlightable mb-0.5 flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-45 ${
              controls.isAutoSelected
                ? "text-neutral-900"
                : "text-neutral-700 hover:bg-brand-50"
            }`}
          >
            <span className="chat-menu-item-icon grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[var(--theme-border-default)] bg-transparent text-neutral-800">
              <InfinityIcon size={16} strokeWidth={2.2} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
              {copy.chat.autoModel}
            </span>
            {controls.isAutoSelected && (
              <Check size={16} className="shrink-0 text-neutral-900" />
            )}
          </button>
          {controls.isLoadingModelCatalog && !controls.hasLoadedModelCatalog && (
            <div
              role="status"
              data-testid="chat-model-loading"
              className="flex items-center gap-2 px-2.5 py-2 text-[13px] font-medium text-neutral-500"
            >
              <Loader2 size={15} className="animate-spin" />
              {copy.chat.modelCatalogLoading}
            </div>
          )}
          {controls.modelCatalogError && !controls.isLoadingModelCatalog && (
            <button
              type="button"
              onClick={controls.refreshModelCatalog}
              data-testid="retry-chat-model-catalog-button"
              className="flex w-full items-center justify-between gap-2 rounded-[10px] px-2.5 py-2 text-left text-[13px] font-medium text-danger-600 transition hover:bg-danger-50 focus:outline-none focus:ring-2 focus:ring-danger-100"
            >
              <span className="truncate">{controls.modelCatalogError}</span>
              <span className="shrink-0 font-bold">{copy.chat.retryModelCatalog}</span>
            </button>
          )}
          {controls.isLoadingModelCatalog && controls.hasLoadedModelCatalog && (
            <div
              role="status"
              className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-medium text-neutral-500"
            >
              <Loader2 size={13} className="animate-spin" />
              {copy.chat.modelCatalogLoading}
            </div>
          )}
          {controls.hasLoadedModelCatalog &&
            controls.modelOptions.map((option) => {
              const isSelected = matchesModelSelection(option, controls.selectedModel);
              const isLocked = option.locked || !option.configured;

              return (
                <button
                  key={`${option.providerId}:${option.model}`}
                  type="button"
                  role="option"
                  aria-selected={!controls.isAutoSelected && isSelected}
                  aria-disabled={isLocked || controls.controlsBusy}
                  disabled={controls.controlsBusy}
                  onClick={() => controls.selectModel(option)}
                  data-testid="chat-model-option"
                  className={`chat-menu-highlightable flex w-full min-w-0 items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-45 ${
                    isLocked
                      ? "cursor-not-allowed text-neutral-600"
                      : !controls.isAutoSelected && isSelected
                        ? "bg-brand-50 text-brand-800"
                        : "text-neutral-700 hover:bg-brand-50"
                  }`}
                >
                  <ModelLogo model={option.model} size="md" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                    {formatModelLabel(option.model)}
                  </span>
                  {isLocked ? (
                    <LockKeyhole
                      size={16}
                      className="shrink-0 text-neutral-300"
                      aria-label={
                        !option.configured
                          ? copy.chat.modelApiNotConfigured
                          : copy.chat.modelLocked
                      }
                    />
                  ) : (
                    !controls.isAutoSelected &&
                    isSelected && <Check size={16} className="shrink-0 text-neutral-900" />
                  )}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
