"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, Plus, Power, Save, Server } from "lucide-react";
import type {
  LlmModelConfig,
  LlmProviderConfig,
  LlmRouteConfig,
  LlmRouteTask,
} from "@/lib/types";

type AdminLlmConfigResponse = {
  source: "supabase" | "static";
  providers: Array<LlmProviderConfig & { errorCodePrefix: string }>;
  models: LlmModelConfig[];
  routes: LlmRouteConfig[];
};

type ProviderForm = {
  providerId: string;
  displayName: string;
  baseUrl: string;
  apiKeyEnv: string;
  timeoutMs: string;
  enabled: boolean;
  payloadOptionsText: string;
};

type ModelForm = {
  providerId: string;
  model: string;
  displayName: string;
  enabled: boolean;
  supportsStreaming: boolean;
  supportsJson: boolean;
  sortOrder: string;
  notes: string;
};

const TASK_LABELS: Record<LlmRouteTask, string> = {
  node_generation: "Node generation",
  branch_chat: "Branch chat",
  pdf_qa: "PDF Q&A",
  curriculum_research: "Curriculum research",
  curriculum_synthesis: "Curriculum synthesis",
  curriculum_validation: "Curriculum validation",
  tutor_chat: "Tutor chat",
  tutor_assessment: "Tutor assessment",
};

const emptyProviderForm: ProviderForm = {
  providerId: "",
  displayName: "",
  baseUrl: "",
  apiKeyEnv: "",
  timeoutMs: "",
  enabled: true,
  payloadOptionsText: "{}",
};

const emptyModelForm: ModelForm = {
  providerId: "",
  model: "",
  displayName: "",
  enabled: true,
  supportsStreaming: true,
  supportsJson: true,
  sortOrder: "0",
  notes: "",
};

const cardClassName =
  "rounded-lg border border-neutral-200 bg-surface-elevated p-5 shadow-[0_14px_34px_rgba(35,31,26,0.06)]";

const panelClassName = "rounded-lg border border-neutral-200 bg-surface-muted p-4";

const fieldClassName =
  "min-h-10 w-full rounded-lg border border-neutral-200 bg-surface-elevated px-3 py-2 text-sm font-semibold text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-neutral-600 focus:ring-2 focus:ring-neutral-200 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-surface-muted disabled:text-text-muted";

const codeFieldClassName =
  "min-h-10 w-full rounded-lg border border-neutral-200 bg-surface-elevated px-3 py-2 font-mono text-xs text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-neutral-600 focus:ring-2 focus:ring-neutral-200";

const primaryButtonClassName =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand-900 px-4 text-sm font-black text-white shadow-[0_12px_26px_rgba(60,45,30,0.2)] transition hover:-translate-y-0.5 hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-text-muted disabled:shadow-none disabled:hover:translate-y-0";

const secondaryButtonClassName =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-elevated px-3 text-sm font-black text-text-secondary shadow-[0_1px_2px_rgba(35,31,26,0.05)] transition hover:border-border-default hover:bg-white disabled:cursor-not-allowed disabled:opacity-60";

const enabledButtonClassName =
  "bg-success-50 text-success-700 hover:bg-success-100";

const disabledButtonClassName =
  "bg-neutral-100 text-text-muted hover:bg-neutral-200";

function optionValue(providerId: string, model: string) {
  return `${providerId}::${model}`;
}

function splitOptionValue(value: string) {
  const [providerId, model] = value.split("::");
  return { providerId, model };
}

async function postConfigAction(action: unknown) {
  const response = await fetch("/api/admin/llm-config", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
  const data = (await response.json().catch(() => null)) as AdminLlmConfigResponse | null;
  if (!response.ok || !data) {
    throw new Error("Failed to save LLM config.");
  }
  return data;
}

export function AdminModelsClient() {
  const [config, setConfig] = useState<AdminLlmConfigResponse | null>(null);
  const [providerForm, setProviderForm] = useState<ProviderForm>(emptyProviderForm);
  const [modelForm, setModelForm] = useState<ModelForm>(emptyModelForm);
  const [routeDrafts, setRouteDrafts] = useState<Record<string, { default: string; fallback: string }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/llm-config", {
        credentials: "same-origin",
      });
      const data = (await response.json().catch(() => null)) as AdminLlmConfigResponse | null;
      if (!response.ok || !data) throw new Error("Failed to load LLM config.");
      setConfig(data);
      setModelForm((current) => ({
        ...current,
        providerId: current.providerId || data.providers[0]?.providerId || "",
      }));
      setRouteDrafts(
        Object.fromEntries(
          data.routes.map((route) => [
            route.task,
            {
              default: optionValue(route.defaultProviderId, route.defaultModel),
              fallback:
                route.fallbackProviderId && route.fallbackModel
                  ? optionValue(route.fallbackProviderId, route.fallbackModel)
                  : "",
            },
          ]),
        ),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const modelOptions = useMemo(() => {
    if (!config) return [];
    return config.models
      .slice()
      .sort((left, right) => left.providerId.localeCompare(right.providerId) || left.sortOrder - right.sortOrder)
      .map((model) => ({
        value: optionValue(model.providerId, model.model),
        label: `${model.providerId}: ${model.displayName || model.model}`,
      }));
  }, [config]);

  async function saveProvider() {
    setSaving("provider");
    setError(null);
    setMessage(null);
    try {
      let payloadOptions: Record<string, unknown>;
      try {
        payloadOptions = JSON.parse(providerForm.payloadOptionsText || "{}") as Record<string, unknown>;
      } catch {
        throw new Error("Payload options must be valid JSON.");
      }

      const next = await postConfigAction({
        action: "upsertProvider",
        provider: {
          providerId: providerForm.providerId,
          displayName: providerForm.displayName,
          baseUrl: providerForm.baseUrl,
          apiKeyEnv: providerForm.apiKeyEnv,
          enabled: providerForm.enabled,
          timeoutMs: providerForm.timeoutMs ? Number(providerForm.timeoutMs) : null,
          payloadOptions,
        },
      });
      setConfig(next);
      setProviderForm(emptyProviderForm);
      setMessage("Provider saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save provider.");
    } finally {
      setSaving(null);
    }
  }

  async function saveModel() {
    setSaving("model");
    setError(null);
    setMessage(null);
    try {
      const next = await postConfigAction({
        action: "upsertModel",
        model: {
          providerId: modelForm.providerId,
          model: modelForm.model,
          displayName: modelForm.displayName || modelForm.model,
          enabled: modelForm.enabled,
          supportsStreaming: modelForm.supportsStreaming,
          supportsJson: modelForm.supportsJson,
          sortOrder: Number(modelForm.sortOrder || 0),
          notes: modelForm.notes || null,
        },
      });
      setConfig(next);
      setModelForm({ ...emptyModelForm, providerId: modelForm.providerId });
      setMessage("Model saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save model.");
    } finally {
      setSaving(null);
    }
  }

  async function toggleProvider(provider: LlmProviderConfig) {
    setSaving(provider.providerId);
    const next = await postConfigAction({
      action: "setProviderEnabled",
      providerId: provider.providerId,
      enabled: !provider.enabled,
    });
    setConfig(next);
    setSaving(null);
  }

  async function toggleModel(model: LlmModelConfig) {
    setSaving(`${model.providerId}:${model.model}`);
    const next = await postConfigAction({
      action: "setModelEnabled",
      providerId: model.providerId,
      model: model.model,
      enabled: !model.enabled,
    });
    setConfig(next);
    setSaving(null);
  }

  async function saveRoute(task: LlmRouteTask) {
    const draft = routeDrafts[task];
    if (!draft?.default) return;
    setSaving(task);
    setError(null);
    setMessage(null);
    try {
      const primary = splitOptionValue(draft.default);
      const fallback = draft.fallback ? splitOptionValue(draft.fallback) : null;
      const next = await postConfigAction({
        action: "setRoute",
        route: {
          task,
          defaultProviderId: primary.providerId,
          defaultModel: primary.model,
          fallbackProviderId: fallback?.providerId ?? null,
          fallbackModel: fallback?.model ?? null,
        },
      });
      setConfig(next);
      setMessage(`${TASK_LABELS[task]} route saved.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save route.");
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-80 place-items-center rounded-lg border border-neutral-200 bg-surface-elevated shadow-[0_14px_34px_rgba(35,31,26,0.06)]">
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="rounded-lg border border-danger-200 bg-danger-50 p-4 text-sm font-bold text-danger-600">
        {error ?? "LLM config is unavailable."}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {(message || error) && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm font-bold ${
            error
              ? "border-danger-200 bg-danger-50 text-danger-600"
              : "border-success-200 bg-success-50 text-success-700"
          }`}
        >
          {error ?? message}
        </div>
      )}

      <section className={cardClassName}>
        <div className="flex items-center gap-2">
          <Server size={18} className="text-success-600" />
          <h2 className="text-base font-black text-neutral-900">Providers</h2>
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-600">
            {config.source}
          </span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-[0.12em] text-text-muted">
              <tr className="border-b border-neutral-200">
                <th className="py-2 pr-4">Provider</th>
                <th className="py-2 pr-4">Base URL</th>
                <th className="py-2 pr-4">API key env</th>
                <th className="py-2">State</th>
              </tr>
            </thead>
            <tbody>
              {config.providers.map((provider) => (
                <tr key={provider.providerId} className="border-b border-neutral-200 last:border-0">
                  <td className="py-3 pr-4">
                    <p className="font-black text-neutral-900">{provider.displayName}</p>
                    <p className="font-mono text-xs text-text-muted">{provider.providerId}</p>
                  </td>
                  <td className="max-w-xs truncate py-3 pr-4 font-mono text-xs text-text-muted">{provider.baseUrl}</td>
                  <td className="py-3 pr-4 font-mono text-xs text-text-secondary">{provider.apiKeyEnv}</td>
                  <td className="py-3">
                    <button
                      type="button"
                      onClick={() => void toggleProvider(provider)}
                      disabled={saving === provider.providerId}
                      className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs font-black transition ${
                        provider.enabled ? enabledButtonClassName : disabledButtonClassName
                      } disabled:opacity-60`}
                    >
                      <Power size={14} />
                      {provider.enabled ? "Enabled" : "Disabled"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className={cardClassName}>
          <h2 className="text-base font-black text-neutral-900">Add or edit provider</h2>
          <div className="mt-4 grid gap-3">
            <input className={fieldClassName} placeholder="Provider id" value={providerForm.providerId} onChange={(event) => setProviderForm({ ...providerForm, providerId: event.target.value })} />
            <input className={fieldClassName} placeholder="Display name" value={providerForm.displayName} onChange={(event) => setProviderForm({ ...providerForm, displayName: event.target.value })} />
            <input className={fieldClassName} placeholder="https://provider.example/v1/chat/completions" value={providerForm.baseUrl} onChange={(event) => setProviderForm({ ...providerForm, baseUrl: event.target.value })} />
            <input className={fieldClassName} placeholder="API_KEY_ENV_NAME" value={providerForm.apiKeyEnv} onChange={(event) => setProviderForm({ ...providerForm, apiKeyEnv: event.target.value })} />
            <input className={fieldClassName} placeholder="Timeout ms, optional" inputMode="numeric" value={providerForm.timeoutMs} onChange={(event) => setProviderForm({ ...providerForm, timeoutMs: event.target.value })} />
            <textarea className={`${codeFieldClassName} min-h-24`} value={providerForm.payloadOptionsText} onChange={(event) => setProviderForm({ ...providerForm, payloadOptionsText: event.target.value })} />
            <label className="inline-flex items-center gap-2 text-sm font-bold text-text-secondary">
              <input type="checkbox" checked={providerForm.enabled} onChange={(event) => setProviderForm({ ...providerForm, enabled: event.target.checked })} className="h-4 w-4 accent-brand-900" />
              Enabled
            </label>
            <button type="button" onClick={() => void saveProvider()} disabled={saving === "provider"} className={primaryButtonClassName}>
              {saving === "provider" ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Save provider
            </button>
          </div>
        </div>

        <div className={cardClassName}>
          <h2 className="text-base font-black text-neutral-900">Add or edit model</h2>
          <div className="mt-4 grid gap-3">
            <select className={fieldClassName} value={modelForm.providerId} onChange={(event) => setModelForm({ ...modelForm, providerId: event.target.value })}>
              {config.providers.map((provider) => (
                <option key={provider.providerId} value={provider.providerId}>{provider.displayName}</option>
              ))}
            </select>
            <input className={fieldClassName} placeholder="Model id" value={modelForm.model} onChange={(event) => setModelForm({ ...modelForm, model: event.target.value })} />
            <input className={fieldClassName} placeholder="Display name" value={modelForm.displayName} onChange={(event) => setModelForm({ ...modelForm, displayName: event.target.value })} />
            <input className={fieldClassName} placeholder="Sort order" inputMode="numeric" value={modelForm.sortOrder} onChange={(event) => setModelForm({ ...modelForm, sortOrder: event.target.value })} />
            <textarea className={`${fieldClassName} min-h-20`} placeholder="Notes" value={modelForm.notes} onChange={(event) => setModelForm({ ...modelForm, notes: event.target.value })} />
            <div className="flex flex-wrap gap-4 text-sm font-bold text-text-secondary">
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={modelForm.enabled} onChange={(event) => setModelForm({ ...modelForm, enabled: event.target.checked })} className="h-4 w-4 accent-brand-900" /> Enabled</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={modelForm.supportsStreaming} onChange={(event) => setModelForm({ ...modelForm, supportsStreaming: event.target.checked })} className="h-4 w-4 accent-brand-900" /> Streaming</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={modelForm.supportsJson} onChange={(event) => setModelForm({ ...modelForm, supportsJson: event.target.checked })} className="h-4 w-4 accent-brand-900" /> JSON</label>
            </div>
            <button type="button" onClick={() => void saveModel()} disabled={saving === "model"} className={primaryButtonClassName}>
              {saving === "model" ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Save model
            </button>
          </div>
        </div>
      </section>

      <section className={cardClassName}>
        <h2 className="text-base font-black text-neutral-900">Task routing</h2>
        <div className="mt-4 grid gap-3">
          {config.routes.map((route) => (
            <div key={route.task} className={`grid gap-3 ${panelClassName} lg:grid-cols-[180px_1fr_1fr_auto] lg:items-center`}>
              <p className="font-black text-neutral-900">{TASK_LABELS[route.task]}</p>
              <select className={fieldClassName} value={routeDrafts[route.task]?.default ?? ""} onChange={(event) => setRouteDrafts({ ...routeDrafts, [route.task]: { ...(routeDrafts[route.task] ?? { fallback: "" }), default: event.target.value } })}>
                {modelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <select className={fieldClassName} value={routeDrafts[route.task]?.fallback ?? ""} onChange={(event) => setRouteDrafts({ ...routeDrafts, [route.task]: { ...(routeDrafts[route.task] ?? { default: "" }), fallback: event.target.value } })}>
                <option value="">No fallback</option>
                {modelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <button type="button" onClick={() => void saveRoute(route.task)} disabled={saving === route.task} className={secondaryButtonClassName}>
                {saving === route.task ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                Save
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className={cardClassName}>
        <h2 className="text-base font-black text-neutral-900">Models</h2>
        <div className="mt-4 grid gap-2">
          {config.models.map((model) => (
            <div key={`${model.providerId}:${model.model}`} className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-surface-muted p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-black text-neutral-900">{model.displayName}</p>
                <p className="font-mono text-xs text-text-muted">{model.providerId}:{model.model}</p>
                {model.notes && <p className="mt-1 text-sm text-text-muted">{model.notes}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {model.supportsStreaming && <span className="rounded-full bg-success-50 px-2 py-1 text-xs font-bold text-success-600">streaming</span>}
                {model.supportsJson && <span className="rounded-full bg-brand-50 px-2 py-1 text-xs font-bold text-brand-600">json</span>}
                <button type="button" onClick={() => void toggleModel(model)} disabled={saving === `${model.providerId}:${model.model}`} className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs font-black transition ${model.enabled ? enabledButtonClassName : disabledButtonClassName} disabled:opacity-60`}>
                  <Check size={14} />
                  {model.enabled ? "Enabled" : "Disabled"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
