import { z } from "zod";
import { HttpError } from "@/lib/server/http";
import {
  getSupabaseAdminClient,
  hasSupabaseServerConfig,
} from "@/lib/supabase/server";
import type {
  AdminBugReportDto,
  BugReportDto,
  BugReportStatus,
  CreateBugReportInput,
} from "@/lib/types";

export const BUG_REPORT_ATTACHMENT_BUCKET = "branchmind-bug-attachments";
export const MAX_BUG_SCREENSHOT_BYTES = 5 * 1024 * 1024;

const BUG_SCREENSHOT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const BUG_REPORT_STATUSES: BugReportStatus[] = ["open", "triaged", "fixed", "closed"];

export const createBugReportSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(5_000),
  contactEmail: z
    .string()
    .trim()
    .email()
    .max(240)
    .nullable()
    .optional(),
  currentUrl: z.string().trim().max(2_000).nullable().optional(),
  userAgent: z.string().trim().max(1_000).nullable().optional(),
});

export const adminBugReportUpdateSchema = z.object({
  status: z.enum(BUG_REPORT_STATUSES).optional(),
  adminNotes: z.string().trim().max(5_000).nullable().optional(),
});

export type AdminBugReportUpdateInput = z.infer<typeof adminBugReportUpdateSchema>;

type BugReportRow = {
  id: string;
  reporter_user_id: string | null;
  reporter_email: string | null;
  contact_email: string | null;
  title: string;
  description: string;
  status: BugReportStatus;
  current_url: string | null;
  user_agent: string | null;
  screenshot_path: string | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
};

export function normalizeBugReportInput(input: CreateBugReportInput) {
  return createBugReportSchema.parse({
    title: input.title,
    description: input.description,
    contactEmail: input.contactEmail?.trim() ? input.contactEmail : null,
    currentUrl: input.currentUrl?.trim() ? input.currentUrl : null,
    userAgent: input.userAgent?.trim() ? input.userAgent : null,
  });
}

function requireBugReportStorage() {
  if (!hasSupabaseServerConfig()) {
    throw new HttpError("Bug reports require Supabase configuration.", {
      code: "BUG_REPORTS_NOT_CONFIGURED",
      expose: true,
      status: 503,
    });
  }
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "bin";
}

export function validateBugScreenshot(file: File | null | undefined) {
  if (!file || file.size === 0) return null;

  if (!BUG_SCREENSHOT_TYPES.has(file.type)) {
    throw new HttpError("Screenshot must be a PNG, JPG, or WebP image.", {
      code: "BUG_SCREENSHOT_TYPE_NOT_ALLOWED",
      expose: true,
      status: 400,
    });
  }

  if (file.size > MAX_BUG_SCREENSHOT_BYTES) {
    throw new HttpError("Screenshot must be 5 MB or smaller.", {
      code: "BUG_SCREENSHOT_TOO_LARGE",
      expose: true,
      status: 413,
    });
  }

  return file;
}

async function uploadBugScreenshot(file: File) {
  const supabase = getSupabaseAdminClient();
  const date = new Date().toISOString().slice(0, 10);
  const path = `${date}/${crypto.randomUUID()}.${extensionForMimeType(file.type)}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await supabase.storage
    .from(BUG_REPORT_ATTACHMENT_BUCKET)
    .upload(path, bytes, {
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    throw new HttpError("Failed to upload bug screenshot.", {
      code: "BUG_SCREENSHOT_UPLOAD_FAILED",
      status: 500,
    });
  }

  return path;
}

function toBugReportDto(row: BugReportRow): BugReportDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    contactEmail: row.contact_email,
    currentUrl: row.current_url,
    createdAt: row.created_at,
  };
}

async function createScreenshotUrl(path: string | null) {
  if (!path) return null;

  const { data, error } = await getSupabaseAdminClient().storage
    .from(BUG_REPORT_ATTACHMENT_BUCKET)
    .createSignedUrl(path, 60 * 60);

  if (error) return null;
  return data.signedUrl;
}

async function toAdminBugReportDto(row: BugReportRow): Promise<AdminBugReportDto> {
  return {
    ...toBugReportDto(row),
    reporterUserId: row.reporter_user_id,
    reporterEmail: row.reporter_email,
    userAgent: row.user_agent,
    screenshotPath: row.screenshot_path,
    screenshotUrl: await createScreenshotUrl(row.screenshot_path),
    adminNotes: row.admin_notes,
    updatedAt: row.updated_at,
  };
}

export async function createBugReportForUser({
  input,
  screenshot,
  reporter,
}: {
  input: CreateBugReportInput;
  screenshot?: File | null;
  reporter: { userId: string | null; email: string | null };
}) {
  requireBugReportStorage();

  const body = normalizeBugReportInput(input);
  const validScreenshot = validateBugScreenshot(screenshot);
  const screenshotPath = validScreenshot
    ? await uploadBugScreenshot(validScreenshot)
    : null;

  const { data, error } = await getSupabaseAdminClient()
    .from("branchmind_bug_reports")
    .insert({
      reporter_user_id: reporter.userId,
      reporter_email: reporter.email,
      contact_email: body.contactEmail ?? null,
      title: body.title,
      description: body.description,
      current_url: body.currentUrl ?? null,
      user_agent: body.userAgent ?? null,
      screenshot_path: screenshotPath,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new HttpError("Failed to create bug report.", {
      code: "BUG_REPORT_CREATE_FAILED",
      status: 500,
    });
  }

  return toBugReportDto(data);
}

export async function listAdminBugReports(status?: BugReportStatus | "all") {
  requireBugReportStorage();

  let query = getSupabaseAdminClient()
    .from("branchmind_bug_reports")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    throw new HttpError("Failed to load bug reports.", {
      code: "BUG_REPORTS_LOAD_FAILED",
      status: 500,
    });
  }

  return Promise.all((data ?? []).map((row) => toAdminBugReportDto(row)));
}

export async function updateAdminBugReport(
  id: string,
  update: AdminBugReportUpdateInput,
) {
  requireBugReportStorage();

  const body = adminBugReportUpdateSchema.parse(update);
  const patch: {
    status?: BugReportStatus;
    admin_notes?: string | null;
    updated_at: string;
  } = { updated_at: new Date().toISOString() };

  if (body.status !== undefined) patch.status = body.status;
  if (body.adminNotes !== undefined) patch.admin_notes = body.adminNotes;

  const { data, error } = await getSupabaseAdminClient()
    .from("branchmind_bug_reports")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    throw new HttpError("Failed to update bug report.", {
      code: "BUG_REPORT_UPDATE_FAILED",
      status: 500,
    });
  }

  return toAdminBugReportDto(data);
}

export async function getBugReportCounts() {
  requireBugReportStorage();

  const [openResult, allResult] = await Promise.all([
    getSupabaseAdminClient()
      .from("branchmind_bug_reports")
      .select("*", { count: "exact", head: true })
      .eq("status", "open"),
    getSupabaseAdminClient()
      .from("branchmind_bug_reports")
      .select("*", { count: "exact", head: true }),
  ]);

  if (openResult.error || allResult.error) {
    throw new HttpError("Failed to load bug report counts.", {
      code: "BUG_REPORT_COUNTS_FAILED",
      status: 500,
    });
  }

  return {
    open: openResult.count ?? 0,
    total: allResult.count ?? 0,
  };
}
