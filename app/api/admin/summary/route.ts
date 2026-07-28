import type { NextRequest } from "next/server";
import { requireAdminAccess } from "@/lib/server/admin-auth";
import { getBugReportCounts } from "@/lib/server/bug-reports";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { getAdminLlmConfig } from "@/lib/server/llm-router";
import { getOrCreateSession } from "@/lib/server/session";
import { hasSupabaseServerConfig } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const session = getOrCreateSession(request);

  try {
    await requireAdminAccess(request);
    const config = await getAdminLlmConfig();
    const bugReports = hasSupabaseServerConfig()
      ? await getBugReportCounts().catch(() => ({ open: 0, total: 0 }))
      : { open: 0, total: 0 };

    return jsonWithSession(
      {
        llm: {
          source: config.source,
          providerCount: config.providers.length,
          enabledProviderCount: config.providers.filter((provider) => provider.enabled).length,
          modelCount: config.models.length,
          enabledModelCount: config.models.filter((model) => model.enabled).length,
          routeCount: config.routes.length,
          configuredProviderCount: config.providers.filter(
            (provider) => Boolean(process.env[provider.apiKeyEnv]?.trim()),
          ).length,
        },
        bugReports,
      },
      session,
    );
  } catch (error) {
    return safeErrorWithSession(error, session);
  }
}
