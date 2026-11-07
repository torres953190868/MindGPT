import { useEffect, useState } from "react";
import type { ChatModelSelection } from "@/lib/types";
import {
  AUTO_MODEL_SELECTION,
  AUTO_STORAGE_SELECTION,
  FALLBACK_MODEL_OPTIONS,
  cacheModelCatalog,
  formatModelLabel,
  isAutoModelSelection,
  matchesModelSelection,
  normalizeModelCatalog,
  readCachedModelCatalog,
  readStoredModelSelection,
  writeStoredModelSelection,
} from "./model-helpers";
import type { ChatModelCatalogResponse, ChatModelOption } from "./types";

export function useModelCatalogControls({
  autoModelLabel,
  modelCatalogLoadFailedLabel,
}: {
  autoModelLabel: string;
  modelCatalogLoadFailedLabel: string;
}) {
  const [initialModelCatalog] = useState(() => readCachedModelCatalog());
  const [modelOptions, setModelOptions] = useState<ChatModelOption[]>(
    () => initialModelCatalog?.options ?? FALLBACK_MODEL_OPTIONS,
  );
  const [selectedModel, setSelectedModel] = useState<ChatModelSelection>(
    AUTO_MODEL_SELECTION,
  );
  const [isAutoSelected, setIsAutoSelected] = useState(true);
  const [hasLoadedModelCatalog, setHasLoadedModelCatalog] = useState(
    Boolean(initialModelCatalog),
  );
  const [isLoadingModelCatalog, setIsLoadingModelCatalog] = useState(
    !initialModelCatalog,
  );
  const [modelCatalogError, setModelCatalogError] = useState<string | null>(null);
  const [modelCatalogRequestId, setModelCatalogRequestId] = useState(0);

  const selectedModelOption = modelOptions.find((option) =>
    matchesModelSelection(option, selectedModel),
  );
  const selectedModelLabel = isAutoSelected
    ? autoModelLabel
    : formatModelLabel(selectedModelOption?.model ?? selectedModel.model);
  const modelSelection = isAutoSelected ? undefined : selectedModel;

  useEffect(() => {
    const storedSelection = readStoredModelSelection();
    const storedAutoSelection = isAutoModelSelection(storedSelection);
    if (storedAutoSelection || !storedSelection) {
      setIsAutoSelected(true);
      setSelectedModel(AUTO_MODEL_SELECTION);
    } else if (
      !initialModelCatalog ||
      initialModelCatalog.options.some(
        (option) =>
          !option.locked &&
          option.configured &&
          matchesModelSelection(option, storedSelection),
      )
    ) {
      setIsAutoSelected(false);
      setSelectedModel(storedSelection);
    } else {
      setIsAutoSelected(true);
      setSelectedModel(AUTO_MODEL_SELECTION);
      writeStoredModelSelection(AUTO_STORAGE_SELECTION);
    }

    if (initialModelCatalog && modelCatalogRequestId === 0) return;

    let cancelled = false;

    async function loadModelOptions() {
      setIsLoadingModelCatalog(true);
      setModelCatalogError(null);

      try {
        const response = await fetch("/api/chat/models", {
          credentials: "same-origin",
        });
        const data = (await response.json().catch(() => null)) as
          | ChatModelCatalogResponse
          | null;
        if (!response.ok) throw new Error(modelCatalogLoadFailedLabel);

        const catalog = normalizeModelCatalog(data);
        if (!catalog || !data) throw new Error(modelCatalogLoadFailedLabel);
        if (cancelled) return;

        cacheModelCatalog(data);
        setModelOptions(catalog.options);
        setHasLoadedModelCatalog(true);
        setSelectedModel((current) => {
          const storedSelectionIsValid =
            storedSelection &&
            !storedAutoSelection &&
            catalog.options.some(
              (option) =>
                !option.locked &&
                option.configured &&
                matchesModelSelection(option, storedSelection),
            );
          if (storedAutoSelection || !storedSelection) return AUTO_MODEL_SELECTION;
          if (storedSelectionIsValid) return storedSelection;

          const currentSelectionIsValid = catalog.options.some((option) =>
            matchesModelSelection(option, current),
          );
          if (currentSelectionIsValid) {
            if (storedSelection && !storedSelectionIsValid) {
              writeStoredModelSelection(current);
            }
            return current;
          }

          setIsAutoSelected(true);
          writeStoredModelSelection(AUTO_STORAGE_SELECTION);
          return AUTO_MODEL_SELECTION;
        });
      } catch (error) {
        if (!cancelled) {
          setModelCatalogError(
            error instanceof Error ? error.message : modelCatalogLoadFailedLabel,
          );
        }
      } finally {
        if (!cancelled) setIsLoadingModelCatalog(false);
      }
    }

    void loadModelOptions();

    return () => {
      cancelled = true;
    };
  }, [modelCatalogLoadFailedLabel, initialModelCatalog, modelCatalogRequestId]);

  function applyModelSelection(option: ChatModelOption) {
    const selection = {
      providerId: option.providerId,
      model: option.model,
    };
    setIsAutoSelected(false);
    setSelectedModel(selection);
    writeStoredModelSelection(selection);
  }

  function applyAutoModelSelection() {
    setIsAutoSelected(true);
    setSelectedModel(AUTO_MODEL_SELECTION);
    writeStoredModelSelection(AUTO_STORAGE_SELECTION);
  }

  function refreshModelCatalog() {
    if (isLoadingModelCatalog) return;
    setModelCatalogRequestId((current) => current + 1);
  }

  return {
    applyAutoModelSelection,
    applyModelSelection,
    hasLoadedModelCatalog,
    isAutoSelected,
    isLoadingModelCatalog,
    modelCatalogError,
    modelOptions,
    modelSelection,
    refreshModelCatalog,
    selectedModel,
    selectedModelLabel,
  };
}
