import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { once } from "node:events";
import {
  delay,
  extractCookie,
  fetchWithTimeout,
  formatError,
  getAvailablePort,
  withCookie,
} from "./smoke-utils.mjs";
import {
  assertJsonStatus as assertJsonStatusForBase,
  readProjectCount as readProjectCountForBase,
} from "./smoke-api-assertions.mjs";

const projectRoot = process.cwd();
const host = process.env.SMOKE_HOST ?? "127.0.0.1";
const port = Number(process.env.SMOKE_PORT) || (await getAvailablePort(host));
const baseUrl = `http://${host}:${port}`;
const nextCli = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
const sessionCookieName = "branchmind_session";
const requiredBuildFiles = [
  path.join(projectRoot, ".next", "build-manifest.json"),
  path.join(projectRoot, ".next", "server", "app-paths-manifest.json"),
];
const serverEntryPath = path.join(projectRoot, ".next", "server", "app", "page.js");
const checks = [
  { path: "/", type: "html" },
  { path: "/projects", type: "html" },
  { path: "/workspace/smoke-missing-project", type: "html" },
  { path: "/api/projects", type: "json" },
];

for (const buildFile of requiredBuildFiles) {
  if (!existsSync(buildFile)) {
    throw new Error("Production build not found. Run `npm run build` first.");
  }
}

if (existsSync(serverEntryPath)) {
  const serverEntry = readFileSync(serverEntryPath, "utf8");
  if (serverEntry.includes("eval-source-map") || serverEntry.includes("isDev=true")) {
    throw new Error("Production build contains development server output. Run `npm run build` again.");
  }
}

const server = spawn(process.execPath, [nextCli, "start", "-H", host, "-p", String(port)], {
  cwd: projectRoot,
  env: {
    ...process.env,
    AI_MOCK_MODE: process.env.AI_MOCK_MODE ?? "true",
    BRANCHMIND_ALLOW_FILE_STORE_IN_PRODUCTION:
      process.env.BRANCHMIND_ALLOW_FILE_STORE_IN_PRODUCTION ?? "true",
    BRANCHMIND_PROJECTS_BACKEND: process.env.BRANCHMIND_PROJECTS_BACKEND ?? "file",
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? "smoke-mock-key",
    HOSTNAME: host,
    NODE_ENV: "production",
    PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  serverOutput += text;
  process.stdout.write(text);
});
server.stderr.on("data", (chunk) => {
  const text = chunk.toString();
  serverOutput += text;
  process.stderr.write(text);
});

try {
  await Promise.race([waitForServer(), waitForUnexpectedExit()]);

  for (const check of checks) {
    await assertRoute(check);
  }
  await assertApiGuards();

  console.log(`Production smoke passed at ${baseUrl}`);
} finally {
  await stopServer();
}

async function assertRoute({ path: routePath, type }) {
  const response = await fetchWithTimeout(`${baseUrl}${routePath}`, 10_000);
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`${routePath} returned ${response.status}: ${body.slice(0, 500)}`);
  }

  if (type === "html" && !body.includes("<html")) {
    throw new Error(`${routePath} did not return HTML.`);
  }

  if (type === "json") {
    const data = JSON.parse(body);
    if (!data || !Array.isArray(data.projects)) {
      throw new Error(`${routePath} did not return a projects array.`);
    }

    for (const project of data.projects) {
      const serialized = JSON.stringify(project);
      if (
        Object.prototype.hasOwnProperty.call(project, "ownerSessionId") ||
        serialized.includes("owner_session_id") ||
        serialized.includes(sessionCookieName)
      ) {
        throw new Error(`${routePath} leaked owner/session data in project JSON.`);
      }
    }
  }

  console.log(`Checked ${routePath}: ${response.status}`);
}

async function assertApiGuards() {
  const sessionCookie = await assertAuthGuards();
  await assertOriginGuards(sessionCookie);
  await assertInputGuards(sessionCookie);
  await assertImportGuards(sessionCookie);
  await assertWorkspaceGuards(sessionCookie);

  console.log("Checked API auth, import, workspace, and input guards");
}

async function assertOriginGuards(sessionCookie) {
  const before = await readProjectCount(sessionCookie);

  await assertJsonStatus(
    "/api/projects",
    403,
    withSession(sessionCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "Missing origin must not write" }),
    }),
    { code: "FORBIDDEN_ORIGIN", message: "Request origin is required." },
  );

  await assertJsonStatus(
    "/api/projects",
    403,
    withSession(sessionCookie, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://cross-site.example",
      },
      body: JSON.stringify({ topic: "Cross origin must not write" }),
    }),
    { code: "FORBIDDEN_ORIGIN", message: "Request origin is not allowed." },
  );

  const after = await readProjectCount(sessionCookie);
  if (before !== after) {
    throw new Error("Origin guard failure changed the project count.");
  }
}

async function assertAuthGuards() {
  const projectsResponse = await fetchWithTimeout(`${baseUrl}/api/projects`, 10_000);
  const setCookie = projectsResponse.headers.get("set-cookie") ?? "";
  const sessionCookie = extractSessionCookie(setCookie);
  if (!sessionCookie) {
    throw new Error("/api/projects did not set an anonymous session cookie.");
  }

  const repeatResponse = await fetchWithTimeout(
    `${baseUrl}/api/projects`,
    10_000,
    withSession(sessionCookie),
  );
  if (!repeatResponse.ok) {
    throw new Error(`/api/projects with a session returned ${repeatResponse.status}.`);
  }

  const repeatCookie = repeatResponse.headers.get("set-cookie") ?? "";
  if (repeatCookie.includes(`${sessionCookieName}=`)) {
    throw new Error("/api/projects replaced a valid session cookie.");
  }

  const invalidCookieResponse = await fetchWithTimeout(`${baseUrl}/api/projects`, 10_000, {
    headers: { Cookie: `${sessionCookieName}=bad` },
  });
  if (!extractSessionCookie(invalidCookieResponse.headers.get("set-cookie") ?? "")) {
    throw new Error("/api/projects did not replace a malformed session cookie.");
  }

  return sessionCookie;
}

async function assertInputGuards(sessionCookie) {
  const tooLongInstruction = "x".repeat(1_501);
  await assertJsonStatus(
    "/api/chat",
    400,
    withSession(sessionCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ instruction: tooLongInstruction }),
    }),
    { code: "VALIDATION_FAILED", message: "Request body failed validation." },
  );

  await assertJsonStatus(
    "/api/projects",
    400,
    withSession(sessionCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ topic: "x".repeat(601) }),
    }),
    { code: "VALIDATION_FAILED", message: "Request body failed validation." },
  );
}

async function assertImportGuards(sessionCookie) {
  await assertJsonStatus(
    "/api/projects/import",
    400,
    withSession(sessionCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ projects: [] }),
    }),
    {
      code: "NO_IMPORTABLE_PROJECTS",
      message: "Choose a BranchMind project JSON export.",
    },
  );

  await assertJsonStatus(
    "/api/projects/import",
    400,
    withSession(sessionCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ projects: [{ id: "invalid-project" }] }),
    }),
    {
      code: "NO_IMPORTABLE_PROJECTS",
      message: "Choose a BranchMind project JSON export.",
    },
  );
}

async function assertWorkspaceGuards(sessionCookie) {
  const missingProjectId = "smoke-missing-project";
  const missingNodeId = "smoke-missing-node";

  await assertJsonStatus(
    `/api/projects/${missingProjectId}`,
    404,
    withSession(sessionCookie, {
      method: "DELETE",
      headers: { Origin: baseUrl },
    }),
    { code: "NOT_FOUND", message: "Resource not found." },
  );

  await assertJsonStatus(
    `/api/projects/${missingProjectId}/nodes`,
    400,
    withSession(sessionCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ parentId: missingNodeId }),
    }),
    { code: "VALIDATION_FAILED", message: "Request body failed validation." },
  );

  await assertJsonStatus(
    `/api/projects/${missingProjectId}/nodes`,
    404,
    withSession(sessionCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        parentId: missingNodeId,
        mode: "continue",
        instruction: "Smoke workspace guard",
      }),
    }),
    { code: "NOT_FOUND", message: "Resource not found." },
  );

  await assertJsonStatus(
    `/api/projects/${missingProjectId}/nodes/${missingNodeId}`,
    404,
    withSession(sessionCookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ collapsed: true }),
    }),
    { code: "NOT_FOUND", message: "Resource not found." },
  );

  await assertJsonStatus(
    `/api/projects/${missingProjectId}/nodes/${missingNodeId}`,
    404,
    withSession(sessionCookie, {
      method: "DELETE",
      headers: { Origin: baseUrl },
    }),
    { code: "NOT_FOUND", message: "Resource not found." },
  );
}

function assertJsonStatus(routePath, expectedStatus, init, expectedError) {
  return assertJsonStatusForBase(baseUrl, routePath, expectedStatus, init, expectedError);
}

function readProjectCount(sessionCookie) {
  return readProjectCountForBase(baseUrl, sessionCookie);
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/`, 5_000);
      if (response.ok) return;
      lastError = new Error(`/ returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
      break;
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }

  throw new Error(`Timed out waiting for next start at ${baseUrl}. ${formatError(lastError)}`);
}

async function waitForUnexpectedExit() {
  const [code, signal] = await once(server, "exit");
  throw new Error(
    `next start exited before smoke completed. code=${code ?? "null"} signal=${signal ?? "null"}\n${serverOutput}`,
  );
}

function withSession(sessionCookie, init = {}) {
  return withCookie(sessionCookie, init);
}

function extractSessionCookie(setCookie) {
  return extractCookie(setCookie, sessionCookieName);
}

async function stopServer() {
  if (server.exitCode !== null || server.signalCode !== null) return;

  server.kill("SIGTERM");

  await Promise.race([once(server, "exit"), delay(5_000)]);
  if (server.exitCode === null && server.signalCode === null) {
    server.kill("SIGKILL");
    await Promise.race([once(server, "exit"), delay(2_000)]);
  }
}
