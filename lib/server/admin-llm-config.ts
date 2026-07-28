import { z } from "zod";
import { HttpError } from "@/lib/server/http";
import { getAdminLlmConfig } from "@/lib/server/llm-router";
import {
  getSupabaseAdminClient,
  hasSupabaseServerConfig,
} from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

const providerIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .transform((value) => value.toLowerCase());

const modelIdSchema = z.string().trim().min(1).max(160);

const payloadOptionsSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .default({});

export const adminLlmConfigActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("upsertProvider"),
    provider: z.object({
      providerId: providerIdSchema,
      displayName: z.string().trim().min(1).max(120),
      baseUrl: z.string().trim().url().max(500),
      apiKeyEnv: z.string().trim().min(1).max(120),
      enabled: z.boolean().default(true),
      timeoutMs: z.number().int().min(1000).max(300_000).nullable().optional(),
      payloadOptions: payloadOptionsSchema,
    }),
  }),
  z.object({
    action: z.literal("setProviderEnabled"),
    providerId: providerIdSchema,
    enabled: z.boolean(),
  }),
  z.object({
    action: z.literal("upsertModel"),
    model: z.object({
      providerId: providerIdSchema,
      model: modelIdSchema,
      displayName: z.string().trim().min(1).max(160),
      enabled: z.boolean().default(true),
      supportsStreaming: z.boolean().default(true),
      supportsJson: z.boolean().default(true),
      notes: z.string().trim().max(1_000).nullable().optional(),
      sortOrder: z.number().int().min(0).max(100_000).default(0),
    }),
  }),
  z.object({
    action: z.literal("setModelEnabled"),
    providerId: providerIdSchema,
    model: modelIdSchema,
    enabled: z.boolean(),
  }),
  z.object({
    action: z.literal("setRoute"),
    route: z.object({
      task: z.enum(["node_generation", "branch_chat", "pdf_qa"]),
      defaultProviderId: providerIdSchema,
      defaultModel: modelIdSchema,
      fallbackProviderId: providerIdSchema.nullable().optional(),
      fallbackModel: modelIdSchema.nullable().optional(),
    }),
  }),
]);

export type AdminLlmConfigAction = z.infer<typeof adminLlmConfigActionSchema>;

function requireSupabaseLlmConfig() {
  if (!hasSupabaseServerConfig()) {
    throw new HttpError("LLM admin config requires Supabase.", {
      code: "LLM_ADMIN_NOT_CONFIGURED",
      expose: true,
      status: 503,
    });
  }
}

function nowIso() {
  return new Date().toISOString();
}

export async function applyAdminLlmConfigAction(input: unknown) {
  requireSupabaseLlmConfig();

  const body = adminLlmConfigActionSchema.parse(input);
  const supabase = getSupabaseAdminClient();

  if (body.action === "upsertProvider") {
    const { provider } = body;
    const { error } = await supabase.from("branchmind_llm_providers").upsert({
      provider_id: provider.providerId,
      display_name: provider.displayName,
      base_url: provider.baseUrl,
      api_key_env: provider.apiKeyEnv,
      enabled: provider.enabled,
      timeout_ms: provider.timeoutMs ?? null,
      payload_options: provider.payloadOptions as Json,
      updated_at: nowIso(),
    });
    if (error) throw new HttpError("Failed to save LLM provider.", { status: 500 });
  }

  if (body.action === "setProviderEnabled") {
    const { error } = await supabase
      .from("branchmind_llm_providers")
      .update({ enabled: body.enabled, updated_at: nowIso() })
      .eq("provider_id", body.providerId);
    if (error) throw new HttpError("Failed to update LLM provider.", { status: 500 });
  }

  if (body.action === "upsertModel") {
    const { model } = body;
    const { error } = await supabase.from("branchmind_llm_models").upsert({
      provider_id: model.providerId,
      model: model.model,
      display_name: model.displayName,
      enabled: model.enabled,
      supports_streaming: model.supportsStreaming,
      supports_json: model.supportsJson,
      notes: model.notes ?? null,
      sort_order: model.sortOrder,
      updated_at: nowIso(),
    });
    if (error) throw new HttpError("Failed to save LLM model.", { status: 500 });
  }

  if (body.action === "setModelEnabled") {
    const { error } = await supabase
      .from("branchmind_llm_models")
      .update({ enabled: body.enabled, updated_at: nowIso() })
      .eq("provider_id", body.providerId)
      .eq("model", body.model);
    if (error) throw new HttpError("Failed to update LLM model.", { status: 500 });
  }

  if (body.action === "setRoute") {
    const { route } = body;
    const fallbackProviderId = route.fallbackProviderId?.trim() || null;
    const fallbackModel = route.fallbackModel?.trim() || null;

    if (Boolean(fallbackProviderId) !== Boolean(fallbackModel)) {
      throw new HttpError("Fallback provider and model must be set together.", {
        code: "LLM_ROUTE_FALLBACK_INVALID",
        expose: true,
        status: 400,
      });
    }

    const { error } = await supabase.from("branchmind_llm_routes").upsert({
      task: route.task,
      default_provider_id: route.defaultProviderId,
      default_model: route.defaultModel,
      fallback_provider_id: fallbackProviderId,
      fallback_model: fallbackModel,
      updated_at: nowIso(),
    });
    if (error) throw new HttpError("Failed to save LLM route.", { status: 500 });
  }

  return getAdminLlmConfig();
}
