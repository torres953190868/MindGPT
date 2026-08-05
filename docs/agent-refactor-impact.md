# 双 Agent 学习系统重构 — 影响分析（Phase 0 交付物）

> 依据 `MindGPT_TWO_AGENT_REFACTOR_SPEC.md` §0 / Phase 0 要求，本文档记录仓库审计结论、关键差距、实施决策与分阶段落点。
> 审计日期：2026-08-04。审计基于 commit `6315c0b`。

---

## 1. 审计确认项（spec §0  checklist）

### 1.1 依赖版本（`package.json`）

| 依赖 | 版本 | 备注 |
|---|---|---|
| next | ^15.5.0 | App Router |
| react / react-dom | ^19.1.0 | |
| zod | ^4.4.2 | **zod v4**，注意 API 差异 |
| ai（Vercel AI SDK） | **未安装** | spec §2.2 的 ToolLoopAgent 不适用 |
| openai | 未安装 | 全部 LLM 调用为裸 fetch |
| @supabase/supabase-js / ssr | ^2.105.1 / ^0.10.2 | |
| @vercel/queue | ^0.2.0 | 仅 RAG 任务使用 |
| vitest / @playwright/test | ^4.1.5 / ^1.59.1 | |

### 1.2 聊天入口

- `app/api/chat/route.ts`：**非流式**，zod `chatSchema`（无 skill/attachments 字段），限流 10 次/分，调 `requestDeepSeekReply({ llmTask: "branch_chat" })`，一次性返回 `{title, summary, content, citations?}`。**当前无任何路由级测试**（回归高危区）。
- `app/api/chat/models/route.ts`：GET 模型目录，按套餐过滤。
- `app/api/projects/[projectId]/nodes/stream/route.ts`：流式节点生成，SSE 三事件 `delta/complete/error`（error 在流内、HTTP 恒 200），`complete` 携带的是持久化后的节点。regenerate/populate 路由复用同一模式。

### 1.3 模型路由（`lib/server/llm-router.ts`）

- 现有任务类型仅 3 个：`node_generation | branch_chat | pdf_qa`（`llm-router.ts:28-32`）。
- 配置双来源：Supabase 三张管理表（provider/model/route）或 env 静态配置，出错回退静态。
- `resolveLlmCandidatesFromConfig()` 支持 default+fallback 候选、套餐门控（`PLAN_MODEL_NOT_ALLOWED`）、`requireJson/requireStreaming` 选项。
- API key 恒从 env 读。provider 类型联合锁死 `deepseek | gemini`。

### 1.4 模型调用与流式协议

- `lib/server/deepseek-core.ts`：payload 构造（`response_format: json_object`，`max_tokens` 硬编码 900）、三档容错 JSON 解析（`parseReply/parseStreamingReply/parseRequiredReply`）、重试（2 次、可重试状态码集合）。**无 function calling**，响应 schema 丢弃 `tool_calls`。
- `lib/server/deepseek-streaming.ts`：内部事件仅 `delta | complete`，error 直接 throw；手写 SSE 解析；增量 delta 靠扫描累积 JSON 原文的 `content` 前缀；**吐出 delta 后不再重试/fallback**。
- RAG `lib/server/rag/answer.ts` 独立一套裸 fetch（`pdf_qa` 任务）。
- **结论**：Agent 工具循环所需的一切（tool 事件、多步协议、usage 记录）均不存在，需新建 `lib/agent-runtime/`，不动旧链路。

### 1.5 项目/节点/边、PDF、RAG、Skill、进度

- **项目模型**（`lib/types.ts`）：`Project → MindNode（parentId + children 派生边，无独立 Edge 实体）→ ChatMessage`。双后端 repository（`lib/server/projects-repository.ts`，file/supabase + `BRANCHMIND_PROJECTS_BACKEND` auto 切换）。
- **PDF RAG**（`lib/server/rag/`）：parser/cleaner/headings/chunker/embeddings/indexer/jobs/retriever/answer/store 齐备；embedding `vector(1024)` + HNSW；检索为进程内向量+关键词混合打分（`match_document_chunks` SQL 函数存在但应用未调用）；双后端 `RagRepository`；Vercel Queue inline/queue 双模式。
- **Skill**：纯 prompt 注入（`deepseek-core.ts:589` 作为额外 user 消息）+ localStorage 持久化（`lib/chat-skills.ts`），无服务端存储、无结构化字段。`/api/chat` 的 schema 甚至不接受 skill。
- **学习进度**：**完全不存在**，全库无 mastery/review/quiz 类实现。

### 1.6 数据库迁移与表结构

- 21 个迁移，`YYYYMMDDHHMMSS_描述.sql` 命名；统一 `enable RLS` + `revoke all from anon, authenticated`，service-role-only 访问。
- `lib/supabase/database.types.ts` **手写且不完整**（`branchmind_save_project`、`match_document_chunks` 未录入，靠松散类型逃生舱调用）。
- 事务先例：plpgsql RPC（`branchmind_save_project` 单事务整项目保存、`increment_daily_ai_usage` 原子自增）。**无 SELECT FOR UPDATE、无 API 级幂等机制**。
- 部分唯一索引先例：`branchmind_nodes_one_root_per_project_idx`（可复用于「同 curriculum 单活跃 run」）。
- 迁移守护：`tests/server/supabase-migration.test.ts` 用字符串断言迁移内容，**新增迁移必须同步补断言**。

### 1.7 鉴权、权限、限流、错误处理

- 鉴权：`getBranchMindAuthContext()`（`lib/server/auth.ts:43`）——Supabase user（要求 email 确认）或本地 httpOnly cookie session；统一 `principal.id`。
- 权限：全部在 service 层按 owner 过滤（`*ForOwner` 签名、`requireOwnedDocument` 404 模式）；service role 绕 RLS，**权限完全靠应用层**。
- 限流：`checkRateLimitAsync`（Supabase `rate_limits` 表优先、内存兜底，key = action+sessionId+fingerprint 哈希）。读-改-写两步非原子，有并发缝隙。
- 配额：`trackDailyAiMessageUsage`（RPC 原子自增，超限 429，**fail-open**）；套餐体系 `free/pro/max`（`lib/server/account-plan.ts` + 三张 plan 表）。
- 错误：`HttpError` + `safeErrorWithSession`（仅 5xx 打日志、`expose:true` 才透消息）+ `x-request-id` 全链路。
- Origin 校验：`assertValidRequestOrigin`，dev 下 `allowMissingOrigin`。

---

## 2. 关键差距与实施决策

### D1. 不用 Vercel AI SDK，采用「JSON 指令 + 代码执行工具」

spec §2.2 允许：项目未使用 AI SDK 时不照抄其 API。现有链路全是手写 fetch，且 DeepSeek/Gemini 的 OpenAI 兼容端点 tool calling 稳定性未验证。按 spec Phase 0 要求选择降级方案：

- 新建 `lib/agent-runtime/model-adapter.ts`：模型被要求输出严格 JSON（工具调用指令或最终答复），代码解析校验后执行工具，结果回注上下文。**与 `AI_MOCK_MODE` 天然统一**（mock 直接产出确定性 JSON 指令）。
- 复用 `llm-router.ts` 的 candidate/fallback/套餐门控；新增 5 个任务类型（见 D4）。
- 旧 `delta/complete/error` 链路完全不动。

### D2. 新域存储复用双后端 repository 范式

`lib/curriculum/`、`lib/learning/`、`lib/agent-runtime/` 各自定义 repository 接口 + file/supabase 双实现 + `BRANCHMIND_CURRICULUM_BACKEND`（curriculum/learning/agent-runs 共用一个开关）auto 切换，生产禁 file（复用 `BRANCHMIND_ALLOW_FILE_STORE_IN_PRODUCTION`）。file 后端落 `data/branchmind-curriculum.json`，供单测/E2E 无 Supabase 运行。

### D3. 事务与行锁靠 RPC，幂等新建机制

- 发布（含 supersede 旧版）、派生（version_number 加锁分配）写成 security definer plpgsql RPC，仿 `branchmind_save_project`；file 后端在进程内串行化模拟同等语义。
- API 幂等：新增 `idempotency_keys` 表（`(user_id, endpoint, key)` 24h 去重、存首个响应）+ file 实现 + 路由包装器 `lib/server/idempotency.ts`。`agent_runs.idempotency_key` 唯一约束兜底。
- 「同 curriculum 单非终态 run」用部分唯一索引实现。

### D4. LLM 路由扩展

`LlmRouteTask` 增加：`curriculum_research | curriculum_synthesis | curriculum_validation | tutor_chat | tutor_assessment`。第一版全部落现有 provider，`llm-router` 的 Supabase 路由表支持管理员后续拆分模型。`lib/types.ts` 同步扩展。

### D5. 配额计量：生成次数走 agent_runs 统计，消息走 daily_ai_usage

- `/api/curricula/generate`：查当月 `agent_runs`（type=curriculum_builder）次数做套餐配额（免费版次数进配置），run 的 token/耗时写 `usage_json`。
- `/api/tutor/chat`、`/api/tutor/assessments`：复用 `trackDailyAiMessageUsage`。
- 三端点全部接 `checkRateLimitAsync`（spec §11.6，第一天就接入）。

### D6. Mock 收敛

新 agent 链路统一从 `lib/agent-runtime/model-adapter.ts` 读 mock 开关（认 `AI_MOCK_MODE`），不各自读 env。Web Search / SafeWebFetcher 提供确定性 mock 实现（`lib/research/mock-*`），单测/CI/E2E 禁真实网络。

### D7. Web Search 第一版提供商

接口 `WebSearchProvider`（spec §10）+ 实现：`MockWebSearchProvider`（测试默认）、`TavilyWebSearchProvider`（`TAVILY_API_KEY` 存在且 `WEB_SEARCH_PROVIDER=tavily` 时启用）、缺省 `DisabledWebSearchProvider`（清晰报错，不静默失败）。SafeWebFetcher 按 OWASP SSRF 清单实现（仅 https、DNS 解析后校验 IP、拒私网/回环/元数据、重定向重新校验、大小/超时/MIME 限制）。

### D8. database.types.ts 继续手写 + 迁移守护测试同步补断言

本阶段不引入 `supabase gen types`（避免工具链变更扩大 diff）。新表 Row 类型手补进 `database.types.ts`；`tests/server/supabase-migration.test.ts` 同步加字符串断言。

---

## 3. 分阶段落点（spec §16 在本仓库的映射）

| Phase | 本仓库落点 | 关键交付 |
|---|---|---|
| 0 | 本文档；`lib/server/feature-flags.ts`（`ENABLE_CURRICULUM_AGENT`/`ENABLE_TUTOR_AGENT`）；`lib/research/` 接口+mock；补 `/api/chat` 路由测试 | 不改现有行为 |
| 1 | 迁移 `20260804000000_curriculum_foundation.sql`（curricula/versions/modules/nodes/edges/sources/node_sources/exercises/source_chunks 9 表 + 发布/派生 RPC）；`lib/curriculum/`（types/repository/service/graph-service/validation-service）；`app/api/curricula/*`（不含 generate） | 手工 API 可建/校验/发布；published 不可变 |
| 2 | `lib/agent-runtime/`（model-adapter/run-service/budget/errors/stream-events）；`lib/research/` 完整实现；`lib/agents/curriculum-builder/`；迁移 agent_runs/agent_steps/agent_run_events/idempotency_keys；`POST /api/curricula/generate` + `agent-runs/*` 路由；生成进度 UI | 状态机+checkpoint+resume+预算硬约束 |
| 3 | `components/curriculum/` 预览/编辑/发布/差异组件；PATCH versions、derive、diff 路由 | 发布前可改，发布后不可变 |
| 4 | 迁移 learning_enrollments/node_progress/sessions/messages；`lib/learning/`（enrollment/learning-path/message 服务）；`lib/agents/tutor/`；`SourceContentService`；Tutor UI | Tutor 只读已发布版本、不越权 |
| 5 | 迁移 learning_assessments；`lib/learning/progress-rules.ts`（纯函数）+ progress-service + assessment-service；`POST /api/tutor/assessments`；证据 UI | 进度只能由服务端规则产生 |
| 6 | 用量聚合、traces、安全事件日志、数据清理策略；E2E 全链路 | runbook 更新 |

每 Phase 完成后跑 `npm run lint && npm run typecheck && npm run test`，关键 Phase 加 `npm run build`。

---

## 4. 风险登记

1. **`/api/chat` 无测试** — Phase 0 先补，重构期间任何 llm-router 改动都有回归网。
2. **zod v4**：新 schema 用 v4 语法（避免 `.passthrough()` 等新写 deprecated API）。
3. **流式协议分叉**：旧聊天保留 `delta/complete/error`；新 Agent 用扩展事件（runId+seq 单调递增、事件先落库再推送）。两套协议共存，不合并。
4. **限流并发缝隙**：agent run 创建等硬配额场景用原子 RPC（`increment_daily_ai_usage` 模式）而非 rate_limits 两步写法。
5. **file 后端事务语义**：发布/派生等多步写在 file 实现里用单 writer 串行化，测试需覆盖「失败不产生半发布状态」。
6. **Supabase 权限靠应用层**：新表所有查询必须带 owner 过滤，权限测试（spec §15.6）逐条落实。
7. **教材生成成本**：是全站最贵操作；预算硬约束（`lib/agent-runtime/agent-budget.ts`）与配额必须与功能同天上（spec §11.6）。
