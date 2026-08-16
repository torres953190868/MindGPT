import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createId } from "@/lib/ids";
import {
  getSupabaseAdminClient,
  hasSupabaseServerConfig,
  requireSupabaseServerConfig,
} from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";

export type SecurityEventBackend = "file" | "supabase";

export type SecurityEvent = {
  id: string;
  userId: string | null;
  runId: string | null;
  rule: string;
  domain: string | null;
  contentHash: string;
  metadata: Json;
  createdAt: string;
};

export type CreateSecurityEventInput = {
  id?: string;
  userId?: string | null;
  runId?: string | null;
  rule: string;
  domain?: string | null;
  contentHash: string;
  metadata?: Json;
  createdAt?: string;
};

export type SecurityEventRepository = {
  backend: SecurityEventBackend;
  createSecurityEvent(input: CreateSecurityEventInput): Promise<SecurityEvent>;
};

type SecurityEventRow = Database["public"]["Tables"]["security_events"]["Row"];
type SecurityEventInsert = Database["public"]["Tables"]["security_events"]["Insert"];

type SecurityEventDataFile = {
  version: 1;
  events: SecurityEventRow[];
};

function nowIso() {
  return new Date().toISOString();
}

function toSecurityEvent(row: SecurityEventRow): SecurityEvent {
  return {
    id: row.id,
    userId: row.user_id,
    runId: row.run_id,
    rule: row.rule,
    domain: row.domain,
    contentHash: row.content_hash,
    metadata: row.metadata_json,
    createdAt: row.created_at,
  };
}

function getDataFilePath() {
  const directory =
    process.env.BRANCHMIND_SECURITY_EVENTS_DATA_DIR?.trim() ||
    process.env.BRANCHMIND_OBSERVABILITY_DATA_DIR?.trim() ||
    path.join(process.cwd(), "data");
  return path.join(directory, "branchmind-security-events.json");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function asData(value: unknown): SecurityEventDataFile {
  if (!value || typeof value !== "object") {
    return { version: 1, events: [] };
  }

  const record = value as Partial<SecurityEventDataFile>;
  return {
    version: 1,
    events: Array.isArray(record.events) ? record.events : [],
  };
}

async function readData(): Promise<SecurityEventDataFile> {
  try {
    return asData(JSON.parse(await readFile(getDataFilePath(), "utf8")));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return asData(null);
    }
    throw error;
  }
}

async function writeData(data: SecurityEventDataFile) {
  const filePath = getDataFilePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

let writeQueue: Promise<unknown> = Promise.resolve();

function mutate<T>(mutator: (data: SecurityEventDataFile) => T | Promise<T>) {
  const next = writeQueue.then(async () => {
    const data = await readData();
    const result = await mutator(data);
    await writeData(data);
    return result;
  });
  writeQueue = next.catch(() => undefined);
  return next;
}

function createRow(input: CreateSecurityEventInput): SecurityEventInsert {
  return {
    id: input.id ?? createId("security-event"),
    user_id: input.userId ?? null,
    run_id: input.runId ?? null,
    rule: input.rule,
    domain: input.domain ?? null,
    content_hash: input.contentHash,
    metadata_json: input.metadata ?? {},
    created_at: input.createdAt ?? nowIso(),
  };
}

const fileRepository: SecurityEventRepository = {
  backend: "file",

  createSecurityEvent: async (input) =>
    mutate((data) => {
      const row = createRow(input) as SecurityEventRow;
      data.events.push(row);
      return toSecurityEvent(row);
    }),
};

class SupabaseSecurityEventRepository implements SecurityEventRepository {
  backend = "supabase" as const;

  async createSecurityEvent(input: CreateSecurityEventInput) {
    const result = await getSupabaseAdminClient()
      .from("security_events")
      .insert(createRow(input))
      .select("*")
      .single();
    if (result.error) {
      throw new Error(`Supabase create security event failed: ${result.error.message}`);
    }
    return toSecurityEvent(result.data);
  }
}

let supabaseRepository: SupabaseSecurityEventRepository | null = null;

function getSupabaseRepository() {
  supabaseRepository ??= new SupabaseSecurityEventRepository();
  return supabaseRepository;
}

function getConfiguredBackend(): SecurityEventBackend | "auto" {
  const value = (
    process.env.BRANCHMIND_SECURITY_EVENTS_BACKEND ??
    process.env.BRANCHMIND_OBSERVABILITY_BACKEND
  )
    ?.trim()
    .toLowerCase();
  return value === "file" || value === "supabase" ? value : "auto";
}

export function getSecurityEventRepository(): SecurityEventRepository {
  const backend = getConfiguredBackend();

  if (backend === "file") {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.BRANCHMIND_ALLOW_FILE_STORE_IN_PRODUCTION !== "true"
    ) {
      throw new Error("File security event storage is not allowed in production.");
    }
    return fileRepository;
  }

  if (backend === "supabase") {
    requireSupabaseServerConfig();
    return getSupabaseRepository();
  }

  if (hasSupabaseServerConfig()) return getSupabaseRepository();
  if (process.env.NODE_ENV === "production") requireSupabaseServerConfig();
  return fileRepository;
}
