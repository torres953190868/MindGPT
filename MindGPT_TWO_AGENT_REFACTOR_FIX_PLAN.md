# MindGPT 双 Agent 重构 — 修补任务书

> 文档用途：交给 Coding Agent 作为修补实施说明。
> 上游文档：`MindGPT_TWO_AGENT_REFACTOR_SPEC.md`（下称 spec，本文引用其章节号）。
> 背景：2026-08-05 对仓库做了一轮完整验收（6 路代码核查 + lint/typecheck/775 单测全过）。主体已完成，本文列出全部未通过项，逐项给出措施与验收标准。

---

## 0. 执行要求（每个任务都必须遵守）

1. 动手前先读 `AGENTS.md` 和 `docs/agent-refactor-impact.md`，遵守仓库既有约定（API 路由横切流程、双后端 repository、Zod 校验、`createId` 等）。
2. **最小改动**：不重构无关代码，不改变既有公开行为，775 个现有测试必须保持全绿。
3. 每个任务完成后运行 `npm run lint && npm run typecheck && npm run test`，全绿才算完成。
4. 每个任务都必须新增或更新 Vitest 测试（`tests/` 下按既有目录结构放置），验收标准里列出的测试场景是最低要求。
5. 涉及数据库变更时：新建 `supabase/migrations/` 迁移（UTC 时间戳前缀）、同步更新手维护的 `lib/supabase/database.types.ts`、在 `tests/server/supabase-migration.test.ts` 补字符串断言守护。file 后端（`data/` JSON）是开发默认后端，所有 repository 改动必须双后端实现。
6. 新 API 一律走既有横切流程：feature flag 断言（404）→ `assertValidRequestOrigin()` → `getBranchMindAuthContext()` → Zod parse → `checkRateLimitAsync()` → 业务服务 → `jsonWithSession()` / `safeErrorWithSession()`。业务逻辑不得堆在 Route Handler。
7. 新配置数值集中定义，不要散落代码；沿用既有常量文件风格。
8. 任务间依赖：T2（题目落库）先于 T23（E2E 答题）；T6（会话摘要）先于 T10（上下文注入补全）；T1（迁移端点）与 T3（幂等接入）有交集时可合并提交。

---

# P0 — 功能缺失 / 硬规则违反

## T1. enrollment 版本迁移端点（spec §8.13、§7.8）

**现状**：整体缺失。`app/api/curricula/[curriculumId]/` 下无 `enrollments/` 目录，`lib/learning/` 无任何 migrate 逻辑。这是唯一整块缺失的 API。

**具体措施**：

1. 新增 `app/api/curricula/[curriculumId]/enrollments/[enrollmentId]/migrate/route.ts`（POST），请求体 Zod strict：
   ```ts
   { targetVersionId: string; confirmation: boolean }
   ```
2. 服务层在 `lib/learning/learning-service.ts` 新增 `migrateEnrollmentForOwner`（可选：顺势把 enrollment 逻辑拆出 `enrollment-service.ts`，非强制）：
   - 校验：enrollment 归属当前用户、属于该 curriculum；`targetVersionId` 属于同一 curriculum 且为 `published`；enrollment 当前版本 ≠ 目标版本。
   - `confirmation !== true` 时**只返回预览**：复用 `lib/curriculum/curriculum-version-diff-service.ts` 生成新旧版本 diff，并给出节点映射预览。
   - 节点映射规则（确定性代码，不调 LLM）：旧版本节点 → 新版本节点，按标题规范化（trim + 小写）精确匹配为主，`module orderIndex + node orderIndex` 位置匹配兜底；每个映射给出 `confidence: "title" | "position" | "unmatched"`。
   - `confirmation === true` 时执行迁移：enrollment 的 `curriculum_version_id` 指向新版本；为映射成功的节点在新版本下创建 `learning_node_progress` 行（状态沿用，mastery 沿用，`last_evidence_json` 追加 `MIGRATED_FROM_VERSION` 说明）；**旧进度行与 `learning_assessments` 历史一律不物理改写**（旧行保留，新版本按 `(enrollment_id, node_id)` 唯一约束天然不冲突，因为 node_id 属于新版本）。
   - 未映射的 `in_progress` 旧节点：新 progress 不创建，预览中显式列出，由用户在 UI 知悉。
3. 迁移完成后重算一次 LearningPath（现有 `buildLearningPath` 逻辑），返回新候选节点。

**验收标准**：

- [ ] 预览响应含 diff 摘要 + 节点映射列表（含 unmatched 项），不写任何数据。
- [ ] 确认执行后 enrollment 指向新版本，映射节点进度可继续学习；旧评估记录逐行未动。
- [ ] 目标版本非 `published` → 409；跨用户 → 404；重复迁移到同一版本 → 幂等返回当前状态。
- [ ] 新增测试：预览不写库、标题匹配、位置兜底、未映射节点列出、旧历史保留、权限拒绝。

---

## T2. Tutor 题目 ID 必须服务端可查（spec §4.7 硬规则）

**现状**：`lib/agents/tutor/tutor-agent.ts` 让模型编造 `question-${clientId}` / `generated-exercise-${clientId}` 块 ID，服务端不校验；客户端拿该 ID 提交答案被 `EXERCISE_NOT_IN_ENROLLMENT` 拒（`lib/learning/assessment-service.ts`）。spec 明令"不接受只在消息里出现、服务端查不到的裸 ID"。

**具体措施**：

1. `lib/learning/learning-service.ts` 在 `appendTutorTurn` 落库 assistant 消息**之前**，扫描 blocks 中的 `question` / `exercise` 块。
2. `lib/learning/assessment-service.ts` 新增 `registerGeneratedExercise`：把题干（prompt、rubric、节点归属）落库为 `learning_assessments` 行——`exercise_id = null`（现场生成题，`prompt_json` 存题干，spec §7.11 允许）、`answer_json`/`score` 留空待提交，返回真实服务端 ID。
3. 用真实 ID **替换** block 里的 `questionId`/`exerciseId` 再落库消息、再返回响应；模型自造 ID 不得出现在最终响应中。
4. 提交答案时（`/api/tutor/assessments`）按该 ID 找到待答记录并更新同一行（评分、answer_hash 去重逻辑沿用现有实现）。
5. 若题目持久化失败，降级策略：丢弃该 question/exercise 块（响应中不出现），不得放行裸 ID。

**验收标准**：

- [ ] tutor chat 返回的每个 exerciseId 都能在服务端查到对应记录。
- [ ] 用返回的 exerciseId 提交答案，正常评分并触发进度重算（不再有 `EXERCISE_NOT_IN_ENROLLMENT`）。
- [ ] 双击重复提交同一答案仍不重复计分（回归）。
- [ ] 新增测试：块 ID 替换、落库可查、提交评分闭环、持久化失败时块被丢弃。

---

## T3. `withIdempotency` 接入提交类路由（spec §11.5）

**现状**：`lib/server/idempotency.ts` 实现了 `(user, endpoint, key)` 24h 去重且单测齐全，但 **`app/api/` 下没有任何路由使用它**。publish / enroll / derive / assessments / 创建课程均不接受 `Idempotency-Key` 头。

**具体措施**：

1. 用 `withIdempotency` 包装以下 POST：`/api/curricula`（创建）、`/api/curricula/[id]/publish`、`/api/curricula/[id]/enroll`、`/api/curricula/[id]/versions/[id]/derive`、`/api/tutor/assessments`，以及 T1 新增的 migrate。
2. 重复请求（同 user + endpoint + key，24h 内）返回首个响应的原样副本，不重复执行业务。
3. `/api/curricula/generate` 保持 run 级幂等即可，但**去掉** `gen-${Date.now()}` 兜底——缺 `Idempotency-Key` 头时返回 400 要求客户端提供（前端 store 生成 UUID 带上）。
4. 注意 SSE 响应（generate/resume）与幂等缓存的兼容：流式响应不进 24h 响应缓存，只依赖 run 级幂等。

**验收标准**：

- [ ] 重复 `Idempotency-Key` 的 publish 只产生一次发布（版本状态不变、无重复副作用）。
- [ ] 双击式重复提交 assessments/enroll 只执行一次，返回与首次一致。
- [ ] generate 缺幂等头 → 400 可读错误。
- [ ] 新增测试覆盖每个接入路由的重复请求场景。

---

## T4. Tutor 预算强制 + token 计量 + 日用量汇总（spec §11.4、§11.6）

**现状**：`TUTOR_AGENT_BUDGET`（`lib/agent-runtime/agent-budget.ts`）生产代码零引用，是死常量；`runTutorAgent` 硬编码 `maxOutputTokens: 6_000` 且丢弃模型 usage；agent run 的 token/耗时写了 `usage_json` 但**没有任何代码汇总进 `branchmind_daily_ai_usage`**（该表只有 message_count 维度，`lib/server/ai-usage.ts`）。

**具体措施**：

1. `lib/agents/tutor/tutor-agent.ts` 接入 `AgentBudgetTracker`（`TUTOR_AGENT_BUDGET`）：
   - 每次 chat 计 1 个 agent step（`maxAgentSteps: 8` 在当前单次调用形态下作为每会话轮次上限的语义保留，可先只执行 token/运行时两类硬约束，并在代码注释说明形态差异）；
   - `maxTotalTokens: 60_000` 按 enrollment 会话窗口累计或按次执行（取实现成本低者，注释说明选择）；
   - `maxRuntimeMs: 90_000` 用 AbortController 强制；
   - `maxSourceSearches: 3` 对 `searchEnrolledCourseSources` 调用计数（当前每轮 1 次，为未来多轮检索预留）。
   - 超限返回可读错误（沿用 `agent-errors.ts` 风格），不得静默截断。
2. 记录 tutor 模型调用的 usage（prompt/completion tokens、耗时），随响应元数据返回并写入 `learning_messages` 的 assistant 行（`blocks_json` 元字段或 `agent_run_id` 语义复用，选其一并注释）。
3. 日用量汇总：
   - 迁移给 `branchmind_daily_ai_usage` 加列（如 `agent_tokens_total`、`agent_runs_count`，数值型默认 0），同步 `database.types.ts` 和迁移守护测试。
   - `lib/server/ai-usage.ts` 新增 `incrementDailyAgentUsage({ tokens, runsCount })`，双后端实现。
   - 接入点：curriculum runner `finishRun`（所有终态）+ tutor chat 请求完成。
4. Admin 用量展示（`components/admin/` 现有 analytics）如读取该表，顺带展示新列；不读则跳过。

**验收标准**：

- [ ] tutor 超 token/运行时预算被终止并返回可读错误码。
- [ ] curriculum run 结束后日用量表出现对应 token 汇总；tutor chat 后同样计入。
- [ ] 新增测试：预算超限、usage 记录、日用量累加（file 后端 + mock 时钟）。

---

## T5. 复习调度闭环（spec §4.9）

**现状**：`next_review_at` 会按 mastery 档位写入（`progress-rules.ts`），但 **`lib/learning/learning-path-service.ts` 从不读取它**——到期的 completed 节点不进入复习候选，复习调度只写不读。

**具体措施**：

1. `buildLearningPath` 计算候选时：找出 `next_review_at <= now` 且 `status = completed` 的节点，以独立优先级档（建议介于 `needs_review` 与 `available` 之间，常数进配置）进入候选，`reason` 标注 `"review_due"`。
2. 复习评估提交后走既有 `ProgressService.recomputeNode`：通过 → 按新 mastery 重算 `next_review_at`（已有规则）；`< 0.6` → 降级 `needs_review`（`COMPLETED_REVIEW_FAILED` 已存在，确认接线到该路径）。
3. `now` 可注入（沿用 `source-quality-service.ts` 的注入风格），方便测试。

**验收标准**：

- [ ] 到期 completed 节点出现在候选列表且排序合理；未到期不出现。
- [ ] 复习评估 ≥ 0.6 后 `next_review_at` 按新 mastery 重算；< 0.6 降级 `needs_review`。
- [ ] 新增测试：到期入选、未到期不入选、通过重算、失败降级。

---

## T6. 会话摘要生成（spec §7.16、§4.6）

**现状**：`learning_sessions.summary` 恒为 `""`（`lib/learning/learning-repository.ts` 两处硬编码），全仓无摘要生成逻辑；"最近会话摘要"因此也无法注入 tutor 上下文。

**具体措施**：

1. `lib/learning/message-service.ts` 新增摘要维护：当某 session 的消息数超过阈值（常数进配置，如 20 条）时，在 tutor chat 请求尾部触发摘要刷新——用 model-adapter（task: `tutor_chat`，低 maxOutputTokens）把"旧摘要 + 新增消息"压缩为一段中文/英文摘要（跟随课程语言）；失败不阻塞主流程（保留旧摘要）。
2. 摘要写入 `learning_sessions.summary`（repository 加 update 方法，双后端）。
3. MVP 允许确定性降级：模型不可用时用最近 N 条消息的截断拼接，注释标注。
4. 摘要注入 tutor 上下文并入 T10 一起做；本任务只保证写入链路。

**验收标准**：

- [ ] 消息超阈值后 `learning_sessions.summary` 非空且随轮次更新。
- [ ] 模型调用失败不影响 tutor chat 正常响应。
- [ ] 新增测试：摘要触发、更新、失败降级。

---

## T7. 用户指定节点与前置缺口（spec §4.6 规则 6）

**现状**：`TutorRequest`（`lib/learning/learning-types.ts`）无 nodeId 字段，用户无法指定学习节点；"若前置条件不足，应解释缺口"无实现。

**具体措施**：

1. `TutorRequest` 和 tutor chat 路由 schema 增加可选 `targetNodeId`。
2. `learning-path-service.ts` 新增 `evaluateRequestedNode(nodeId, progress, graph)`：节点 available/in_progress/needs_review → 允许；locked → 返回缺口列表（未完成的直接前置 + 传递前置中未完成的核心节点，按拓扑序）。
3. `chatWithTutorForOwner`：合法指定 → 本轮目标用指定节点（覆盖默认 `currentNodeId`）；锁定指定 → 不进入教学，响应以专用块（如 `lessonGoal` 文案 + 缺口列表）解释前置缺口，不落 progressProposal。
4. 前端 `TutorClient` 左侧学习路径允许点击节点发起指定学习（locked 节点点击展示缺口），可并入 T20 一起做。

**验收标准**：

- [ ] 指定合法节点后本轮围绕该节点教学。
- [ ] 指定 locked 节点返回结构化前置缺口，不产生教学内容和进度建议。
- [ ] 新增测试：合法指定、锁定缺口（含传递前置）、不存在节点 404/400。

---

# P1 — 接线与补全

## T8. 接入两个死工具（spec §3.6）

**现状**：`search-project-documents-tool.ts` 和 `get-existing-curriculum-tool.ts` 实现完整（含权限校验），但 `curriculum-runner.ts` 从未调用：planning 阶段硬编码 `existingCurricula: ""`，`projectDocumentExcerpts` 从不传入提取 prompt。教材生成实际用不到项目 PDF 和已有课程。

**具体措施**：

1. planning 阶段：调用 `getExistingCurriculum` 工具，把结果注入 planning prompt 的 `existingCurricula` 位。
2. extracting_concepts 阶段：当 run 输入带 `projectId` 时，对每个研究主题（或按提取 query 上限，常数进配置）调用 `searchProjectDocuments`，摘录经 `wrapUntrustedContent` 包裹后作为 `projectDocumentExcerpts` 注入提取 prompt。
3. 项目文档搜索计入 `maxSearchQueries` 预算或单列预算项（任选，注释说明）；工具调用经 `recordToolStep` 落 `agent_steps`（与 webSearch 一致）。
4. 权限沿用工具内既有 owner 校验，不得绕过。

**验收标准**：

- [ ] 带 projectId 的 run 中 `agent_steps` 出现项目文档检索记录，提取 prompt 实际携带摘录。
- [ ] planning prompt 中已有课程清单非硬编码空串。
- [ ] 伪造 projectId → `PROJECT_NOT_FOUND` 且不中断 run（降级为无项目资料继续）。
- [ ] 新增测试：两个工具被调用的 runner 集成场景 + 伪造 projectId 场景。

---

## T9. Tutor 系统提示词补全（spec §4.8）

**现状**：`tutor-agent.ts` 的 `buildPrompt` 只覆盖 spec 10 条规则中的约 4 条。

**具体措施**：补齐缺失规则（措辞可调整，语义必须覆盖）：

- 规则 2：教材决定讲什么；Skill 只决定怎么讲。
- 规则 4：不得选择前置知识尚未完成的锁定节点。
- 规则 5：不得声称用户已经掌握，除非存在可审查的学习证据。
- 规则 7：教材内容不足时明确指出，不得偷偷用临时知识重写教材。
- 规则 8：超纲内容可解释，但必须标记为"课程外补充"，且不能自动加入教材。

**验收标准**：

- [ ] 新增测试：prompt 文本包含 10 条规则的关键语义锚点（includes 断言，不做脆弱全串快照）。

---

## T10. Tutor 上下文注入策略补全（spec §4.6）

**现状**：只注入了当前节点上下文 + 全部非锁定节点的 `JSON.stringify` 整体 + 最近 12 条消息。缺：课程元信息与模块单行大纲、当前节点直接前置/后继摘要、会话摘要（依赖 T6）、掌握度/最近错误；节点量大时无截断策略。

**具体措施**：

1. 注入课程元信息（标题/学习目标）+ 模块/节点标题压缩单行清单。
2. 注入当前节点直接前置与后继节点的摘要（各一行级）。
3. 注入会话摘要（T6 产物）与当前节点掌握度；最近错误从 `learning_assessments` 近 5 次低分证据提取（`evidence_json` 的 weaknesses）。
4. eligible 节点清单改为优先级截断（如前 10 个，常数进配置），不整体 JSON 塞入。
5. 总注入量设字符上限，超出按 spec 优先级截断（当前节点完整上下文 > 前后置摘要 > 大纲 > 历史）。

**验收标准**：

- [ ] prompt 构成测试：元信息、大纲、前后置摘要、摘要、掌握度均出现；超量时按优先级截断。

---

## T11. 候选排序核心优先（spec §4.6 规则 4/5）

**现状**：`learning-path-service.ts` 的 available 档按 `10 + moduleOrderIndex*1000 + orderIndex` 排序，不区分核心/选修，orderIndex 靠前的选修会排在核心之前。

**具体措施**：同档候选内核心（`importance = "core"`）优先于 advanced/optional，再按官方顺序；权重常数进配置。

**验收标准**：

- [ ] 新增测试：同档下选修不抢占核心候选顺序；选修节点仍不阻塞核心解锁（回归）。

---

## T12. 安全事件日志持久化（spec §11.1）

**现状**：`lib/research/prompt-injection.ts` 命中后仅 `console.warn`，无持久化，生产无告警链路。

**具体措施**：

1. 新建 `security_events` 表迁移（`id, user_id nullable, run_id nullable, rule, domain, content_hash, metadata_json, created_at`；**不存正文原文**，沿用现有 hash-only 风格），同步 types 与守护测试。
2. `lib/observability/` 新增 security-event 写入模块，双后端（file 后端写 `data/` 下独立 JSON）。
3. `prompt-injection.ts` 命中处改为调用该模块（异步、失败不阻断主流程）。
4. 写入时串联 `request_id` / `run_id`（有则带上）。

**验收标准**：

- [ ] 注入样本触发后产生持久化记录，字段不含原文。
- [ ] 写入失败不影响教材生成主流程。
- [ ] 新增测试：命中落库、失败静默、无原文。

---

## T13. 草稿保存 DB 级 runId 幂等（spec §11.5）

**现状**：草稿按 runId 幂等只到 checkpoint 层（`curriculum-runner.ts` 检查 checkpoint 已存在才复用）；`curriculum_versions` 无 `agent_run_id` 列，"草稿已保存、checkpoint 未落库"崩溃窗口内 resume 会创建第二份草稿。

**具体措施**：

1. 迁移给 `curriculum_versions` 加 `agent_run_id`（nullable，引用 `agent_runs`，加索引），同步 types 与守护测试。
2. `createDraftVersionForOwner` 接受可选 `agentRunId`：非空时先按 `(curriculum_id, agent_run_id)` 查已有草稿，存在则直接返回（幂等）；repository 层用唯一索引兜底（部分唯一索引 `where agent_run_id is not null`），冲突时重查返回。
3. runner 保存草稿时传入 runId。

**验收标准**：

- [ ] 同一 run 重复保存草稿返回同一版本，不产生第二行。
- [ ] 新增测试：重复保存幂等、无 runId 的手工创建不受影响。

---

## T14. Tutor chat 流式 Parts（spec §8.6）

**现状**：`/api/tutor/chat` 返回一次性 JSON，spec 要求的流式 Parts（`text/tool-call/tool-result/lesson-block/exercise/source/progress-proposal/error/complete`）不存在。

**具体措施**（MVP 形态，避免过度工程）：

1. 响应改 SSE（`text/event-stream`，与 generate 路由同构，含 `x-request-id`、session cookie 提交）。
2. 服务端流程不变（确定性编排 + 单次结构化调用），产出 TutorResponse 后**按块逐个推送**：每个 lesson block 一条 `lesson-block` 事件、exercise 一条 `exercise`、source 一条 `source`、progressProposal 一条 `progress-proposal`，最后 `complete`（含最新进度摘要）；异常推 `error`。
3. `text` / `tool-call` / `tool-result` 三类事件在当前形态下无真实来源，协议类型里保留定义即可，不要求发送（注释说明：为将来 Tool Loop 形态预留）。
4. 前端 `TutorClient` 改为消费 SSE 逐块渲染；复用 `store/` 现有流式消费模式；保留轮询/重发兜底。
5. 消息落库时机不变（服务端同请求落库完整轮次），SSE 只是响应通道。

**验收标准**：

- [ ] 事件序列类型覆盖 `lesson-block/exercise/source/progress-proposal/complete`，顺序正确，前端逐块渲染无回归。
- [ ] 中途断开不影响消息落库（请求已完成的轮次完整保存）。
- [ ] 新增测试：路由级 SSE 事件序列断言。

---

## T15. 小修三件套

1. **repairing stage 事件**：`stream-events.ts` 已声明 `repairing` 状态但 runner 从不发出。修复路由（`pickRepairTarget` 命中后）先推 `stage_started{stage:"repairing"}` 再跳目标 stage，让前端能展示修复过程。
2. **LLM 独立评分持久化**：validating 阶段的独立模型评分目前只进事件/checkpoint，落库 `validation_json` 的是重算的确定性结果。把独立评分（5 个分数 + rubric 摘要）合并进版本的 `validation_json`（确定性 warnings 仍为判定依据，评分作为展示数据，注明来源 `independent_reviewer`）。
3. **enroll 字段兼容**：`/api/curricula/[id]/enroll` 当前只收 `curriculumVersionId`，spec 写的是 `versionId`。Zod schema 改为两者皆可（至少一个必填），响应与内部统一用 `curriculumVersionId`，注释标注 `versionId` 为兼容别名。

**验收标准**：

- [ ] 修复路径事件流出现 `repairing`；版本详情 API 返回的 validation 含独立评分；enroll 两种字段名均 200。
- [ ] 各补 1 个测试。

---

# P2 — 前端补全

## T16. 创建表单补两个字段（spec §14.1）

**现状**：`CurriculumGenerationTrigger.tsx` 缺 `includeMathDepth`（light/standard/deep）和 `includeProjects`（boolean），schema（`curriculum-types.ts`）早已支持。

**措施**：表单补字段并传入 generate 请求；沿用现有表单控件风格。

**验收**：提交体包含两字段并被 API 接受；组件测试或 e2e 覆盖。

## T17. 预览页渲染已有数据（spec §14.1）

**现状**：`CurriculumVersionPreview.tsx` 有数据不展示——`assumptions`/`exclusions`/`conflicts`/`estimatedWeeks`/`estimatedHours` 类型已返回但 UI 未渲染；节点来源只显示 raw sourceIds 字符串；diff 只渲染变更条数；发布确认用 `window.confirm`。

**措施**：

1. 预览页新增区块：假设与排除范围、来源冲突记录、总学习时长（周/小时）。
2. 节点来源 ID 解析为来源标题 + 可点链接（数据已在版本详情响应里）。
3. diff 渲染具体条目（模块/节点/边/来源的增删改列表，数据已有 `changedFields`）。
4. 发布确认改为正式 Dialog（展示版本号、blocking 警告数、不可变提示），替换 `window.confirm`。

**验收**：各区块可见；发布 Dialog 确认流程正常；组件渲染测试。

## T18. 教学页右栏 + 进度建议渲染（spec §14.2）

**现状**：`TutorClient.tsx` 只有两栏；`currentNode` 的学习目标/前置/来源/掌握度无展示位；`progressProposal` 返回了但不渲染。

**措施**：

1. 加右栏：当前节点目标、完成标准、前置知识、来源引用、掌握度（数据均已在 chat 响应/readContext 产物中，需 API 一并返回）。
2. `progressProposal` 渲染为证据卡片（建议状态、掌握度建议值、evidence 列表），文案注明"建议，最终以服务端评估为准"。

**验收**：三栏布局；建议卡渲染；组件测试。

## T19. 课程入口页与导航

**现状**：`app/curricula/` 无列表/创建页；全仓没有任何链接指向 `/curricula` 或 `/learn`，只能手输 URL。

**措施**：

1. 新建 `app/curricula/page.tsx`：课程列表（调 `GET /api/curricula`）+ 创建入口（复用 `CurriculumGenerationTrigger`），feature flag 关闭时 404。
2. 在既有导航/侧边栏（workspace 或主页入口，按现有导航结构选最合适位置）加入口链接，flag 关闭时不渲染。

**验收**：从导航可达课程列表 → 创建 → 详情 → 学习页全链路可走通。

## T20. 生成前预计耗时与配额提示（spec §11.6 末条）

**现状**：`CurriculumGenerationTrigger` 提交前无任何提示。

**措施**：

1. 新增轻量配额查询（如 `GET /api/curricula/generate/quota`，返回本月已用/上限，复用 `curriculum-generation-quota.ts` 计数逻辑）。
2. 提交按钮区域展示：本月剩余生成次数 + 预计耗时区间（inline 模式参考 `maxRuntimeMsInline` 量级，文案为约数）。

**验收**：生成前可见配额与耗时提示；配额耗尽时按钮禁用并给原因；测试。

---

# P3 — 测试补齐

## T21. 单元/集成测试补齐（spec §15，14 个缺失场景）

在既有测试文件（或同目录新文件）中补：

| # | spec | 场景 | 建议位置 |
|---|---|---|---|
| 1 | §15.3 | PATCH 已发布版本 → 409（服务代码已有 `CURRICULUM_VERSION_NOT_DRAFT`，仅缺测试） | `tests/curriculum/curriculum-routes.test.ts` |
| 2 | §15.4 | Skill 改变表达方式时 `currentNodeId` 保持不变（现有测试只断言文案） | `tests/learning/learning-service.test.ts` |
| 3 | §15.5 | 网页抓取失败不影响其他来源（单 URL 失败，其余来源继续处理） | `tests/agents/curriculum-builder/curriculum-runner.test.ts` |
| 4 | §15.5 | Tutor 不得调用开放 Web Search（静态依赖断言：tutor-agent import 不含 web-search-provider） | `tests/agents/tutor/` 新文件 |
| 5 | §15.5 | Prompt Injection 内容不能触发越权工具（注入样本进 fetch 内容，断言无额外工具调用、无写操作） | `tests/agents/curriculum-builder/` |
| 6 | §15.5 | 重试不能重复保存草稿（与 T13 联动） | runner 测试 |
| 7 | §15.5 | 单模块合成输出截断时只重试该模块（mock 模型对某模块先返回截断 JSON 后返回合法，断言只有该模块重试、其余模块不重跑） | runner 测试 |
| 8 | §15.5 | 修复预算耗尽 → run failed 且不保存草稿 | runner 测试 |
| 9 | §15.6 | 跨用户使用他人 enrollment → 404 | `tests/learning/` |
| 10 | §15.6 | 伪造 projectId 搜 PDF → `PROJECT_NOT_FOUND` | `tests/agents/curriculum-builder/` |
| 11 | §15.6 | 客户端伪造 mastery score 不生效（提交体带 masteryScore 被 Zod 拒/忽略，进度不变） | `tests/learning/` |
| 12 | §15.6 | draft 版本不能被 Tutor 使用（现有只覆盖 superseded） | `tests/learning/learning-service.test.ts` |
| 13 | §15.7 | cancel 后不再产新事件 | runner 测试 |
| 14 | §15.7 | resume 时已完成 stage 不重跑（行为级：已完成 stage 的模型/工具调用次数为 0） | runner 测试 |

**验收标准**：14 项全部有测试且通过；不通过改动被测生产代码语义来迁就测试。

## T22. E2E（spec §15.8）

新建 `e2e/curriculum.spec.ts`（Playwright，mock AI + mock 搜索 provider，feature flag 在 web server 环境打开）：

- [ ] 创建 → 生成 → 预览 → 发布完整流程；
- [ ] published 版本不可编辑，修改生成新版本（derive）；
- [ ] enrollment 绑定发布版本，Tutor 不越权访问锁定节点（UI 不展示/点击无效）；
- [ ] 提交答案后进度按服务端规则更新（UI 掌握度变化）。

依赖：T2（答题闭环）、T19（入口页）完成后编写；旧 `branchmind.spec.ts` 等必须保持通过。

---

# 明确不做的项（避免范围蔓延）

- 不把 Tutor 重写为完整 Tool Loop Agent（spec §2.2 允许受控实现；当前"确定性编排 + 单次调用"形态保留，T4/T14 只补齐预算、计量与流式通道；如需演进另行立项）。
- 不改 enroll 既有字段语义（只做兼容别名，T15.3）。
- 不做 embedding 向量召回（`curriculum_source_chunks.embedding` 列保留闲置，关键词检索 MVP 够用，`source-chunk-service.ts` 内 TODO 维持）。
- 不做 `estimatedHours` vs 节点总时长的交叉校验（spec §3.9 确定性清单只要求估时为正，已满足）。

---

# 总验收标准（全部任务完成后）

1. `npm run lint && npm run typecheck && npm run test` 全绿（含全部新增测试）。
2. `npm run e2e` 通过（含新 curriculum spec 与旧 spec）。
3. spec §18 Definition of Done 第 12、19 条转为通过；§8.13 落地。
4. 本文每个任务的验收 checkbox 逐项核对通过。
5. 输出变更说明：每个任务一段，列改动文件、新增迁移、新增测试与遗留限制。
