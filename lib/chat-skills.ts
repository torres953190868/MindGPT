import { createId } from "@/lib/ids";
import type { ChatSkill } from "@/lib/types";

export const MAX_CHAT_SKILL_NAME_LENGTH = 80;
export const MAX_CHAT_SKILL_DESCRIPTION_LENGTH = 240;
export const MAX_CHAT_SKILL_INSTRUCTIONS_LENGTH = 8_000;
export const CHAT_SKILL_STORAGE_KEY = "branchmind.chatSkills.v1";

export type ChatSkillParseError =
  | "missing-skill-md"
  | "empty-instructions"
  | "invalid-selection"
  | "name-too-long"
  | "description-too-long"
  | "instructions-too-long";

export type ParsedChatSkill =
  | { success: true; skill: ChatSkill }
  | { success: false; error: ChatSkillParseError };

type StoredChatSkills = {
  version: 1;
  skills: ChatSkill[];
};

function trimLines(value: string): string {
  return value
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function parseYamlScalar(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function parseSimpleFrontmatter(
  text: string,
): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const trimmed = text.replace(/^\uFEFF/, "").trim();

  if (!trimmed.startsWith("---")) {
    return { frontmatter: {}, body: trimmed };
  }

  const endIndex = trimmed.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: trimmed };
  }

  const frontmatterText = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 4).trim();
  const frontmatter: Record<string, unknown> = {};

  for (const line of frontmatterText.split("\n")) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) continue;

    const colonIndex = trimmedLine.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmedLine.slice(0, colonIndex).trim();
    let rawValue = trimmedLine.slice(colonIndex + 1).trim();

    if (
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
    ) {
      rawValue = rawValue.slice(1, -1);
    }

    frontmatter[key] = rawValue;
  }

  return { frontmatter, body };
}

function computeSkillVersion(skill: Omit<ChatSkill, "id" | "version">): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(`${skill.name}\0${skill.description}\0${skill.instructions}`);
  let hash = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    hash = (hash << 5) - hash + bytes[i];
    hash |= 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function parseSkillMarkdown(name: string, source: string): ParsedChatSkill {
  const trimmedSource = source.replace(/^\uFEFF/, "").trim();
  if (!trimmedSource) {
    return { success: false, error: "empty-instructions" };
  }

  const { frontmatter, body } = parseSimpleFrontmatter(trimmedSource);
  const instructions = trimLines(body);

  if (!instructions) {
    return { success: false, error: "empty-instructions" };
  }

  const parsedName = parseYamlScalar(frontmatter.name) ?? name;
  const description = parseYamlScalar(frontmatter.description) ?? "";

  if (parsedName.length > MAX_CHAT_SKILL_NAME_LENGTH) {
    return { success: false, error: "name-too-long" };
  }

  if (description.length > MAX_CHAT_SKILL_DESCRIPTION_LENGTH) {
    return { success: false, error: "description-too-long" };
  }

  if (instructions.length > MAX_CHAT_SKILL_INSTRUCTIONS_LENGTH) {
    return { success: false, error: "instructions-too-long" };
  }

  const skill: ChatSkill = {
    id: createId("skill"),
    name: parsedName || name,
    description,
    instructions,
    version: computeSkillVersion({
      name: parsedName || name,
      description,
      instructions,
    }),
  };

  return { success: true, skill };
}

export const DEFAULT_PROGRESSIVE_LEARNING_SKILL_ID = "skill_default_progressive_learning";

const PROGRESSIVE_LEARNING_SKILL_SOURCE = `---
name: progressive-learning
description: 把 agent 转变为渐进式学习教练，帮助用户循序渐进地学习任何领域的新知识。当用户想学习新概念、入门新领域、深入理解某个主题时使用，典型触发语包括"教我X""我想学X""X是什么""帮我理解X""给我讲讲X的原理"，以及对话中暴露出知识盲区、需要由浅入深讲解的场景。也适用于用户说"没懂""再解释一下"时自动降低讲解层级。采用混合式教学：结构化渐进讲解为主，穿插提问、小练习和费曼复述。
---

# Progressive Learning 渐进式学习教练

## 概述

将每一次知识问答转化为一个微型教学循环：先定位用户已有基础，首轮生成教学大纲并与用户确认学习路线，再沿大纲由浅入深逐模块讲解，穿插提问与练习确认理解，确认掌握后才进入下一模块。目标是让用户真正学会，而不只是收到答案。

## 核心原则

1. **最近发展区**：每次只教用户当前水平"跳一跳够得着"的内容，不灌输远超其基础的知识。
2. **一次一个新概念**：单轮回复最多引入一个核心新概念；其余术语先给出工作定义，后续再展开。
3. **先心智模型，后细节**：先让用户建立对整体的正确直觉，再补充机制、公式、实现细节。
4. **理解要验证，不要假设**：每个关键节点用提问或小练习确认，禁止连续多轮单向输出而不检查。
5. **误解是线索**：用户答错时优先诊断其错误心智模型，针对性纠正，而非简单重复讲解。

## 教学循环

收到学习类请求后，按以下流程执行。简单事实性问题可直接回答，不必走完整个循环。

### 1. 定位起点

用 1-2 个轻量问题探测先备知识，或从用户措辞、上下文推断水平。不要在用户明显是专家或问题本身很基础时刻意提问。

推断信号：
- 措辞（"听说""大概"→ 初学者；准确使用术语 → 有基础）
- 用户背景（对话历史、已掌握的相关知识）
- 用户自我声明的水平

### 2. 生成教学大纲（首轮必做）

确定起点后，先向用户展示教学大纲，再开始正式讲解。大纲把主题按概念依赖拆成有序模块，包含：

- **模块划分**：有序学习单元，每个模块聚焦一个核心概念
- **目标与深度**：每个模块学到什么程度（L1/L2/L3）
- **起点适配**：探测中发现用户已掌握的内容，标注"跳过"或"快速过"
- **检查点**：标注每个模块的巩固方式（提问 / 练习 / 复述）

大纲格式：

\`\`\`markdown
# X 学习大纲
起点：你已了解 A、B，直接从模块 2 开始

| 模块 | 内容 | 深度 | 检查方式 |
|------|------|------|----------|
| 1 | ...（已掌握，跳过） | — | — |
| 2 | ... | L1→L2 | 1 道应用题 |
| 3 | ... | L2 | 费曼复述 |
\`\`\`

给出大纲后，用一句话请用户确认或调整（顺序、深度、想跳过的部分），随即从第一个未掌握模块开始教学，不必等用户回复"开始"。大纲是活文档：后续根据用户进度动态增删模块，调整时告知用户变更点。

**例外**：用户的问题一轮即可讲完（单一概念、事实性疑问）时，跳过大纲直接回答。

### 3. 分层讲解

按三个层级递进，根据用户起点选择从哪层进入：

| 层级 | 内容 | 深度控制 |
|------|------|----------|
| L1 直觉层 | 是什么、解决什么问题、与已知事物的联系 | 零基础入口 |
| L2 机制层 | 如何运作、核心原理、关键机制 | 掌握 L1 后进入 |
| L3 深入层 | 形式化定义、边界条件、实现细节、常见误区 | 用户主动深挖或 L2 巩固后 |

每层讲解控制在用户一次能消化的长度，结尾带一个理解检查（见第 4 步）。术语首次出现即给工作定义。

### 4. 穿插检查

在关键节点混合使用三种检查手段：

- **提问**：抛出一个小问题让用户预测、解释或判断（"你觉得这种情况下会发生什么？"）
- **小练习**：一道梯度合适的应用题，让用户动手
- **费曼复述**：请用户用自己的话讲回来，暴露理解缺口

不要每句话都提问；一轮讲解配一个检查点即可。

### 5. 根据反馈调整

- **答对且轻松** → 加速，跳到更高层级或下一概念
- **答对但犹豫** → 给一个变式题巩固后继续
- **答错** → 诊断误解类型（概念混淆 / 缺失前提 / 过度泛化），换一个角度重讲，再给一道同类题验证
- **用户说"没懂"** → 自动降一层，换更基础的讲法，不要原样重复
- **用户说"太简单了"** → 直接跳到 L2/L3

### 6. 收尾固化

阶段性结束时：
1. 用简短小结串联已学概念及其关系
2. 指出常见误区或易忘点
3. 给出下一步学习建议（延伸阅读方向、进阶主题、可做的实践）

## 讲解风格

- 优先直接解释机制和原理；类比仅作为可选辅助工具，使用前确认用户接受，且类比后必须说明其在何处失效
- 代码、公式、图表示例优先于纯文字描述
- 用户用中文提问就用中文教学；专业术语保留英文原词并附中文释义
- 不确定的事实时明确说明，必要时联网核实，不要为了流畅而编造

## 深度参考

以下场景读取 [references/teaching-strategies.md](references/teaching-strategies.md) 获取具体策略与话术模板：

- 需要设计探测问题、检查题或梯度练习时
- 用户反复答错、需要诊断误解模式时
- 用户要求制定跨多轮会话的系统性学习计划时
- 需要处理"完全零基础如何入门一个大领域"时

## 反模式

- ❌ 一次回复塞入多个新概念，不做检查直接继续
- ❌ 用户答错后原样重复刚才的讲解
- ❌ 用"你学会了吗？"代替具体的理解检查题
- ❌ 无视用户已声明的水平，从"什么是计算机"讲起
- ❌ 为追求系统性而拒绝直接回答用户的当前问题——教学服务于用户目标，不是障碍`;

let defaultChatSkillsCache: ChatSkill[] | null = null;

export function getDefaultChatSkills(): ChatSkill[] {
  if (defaultChatSkillsCache) return defaultChatSkillsCache;

  const parsed = parseSkillMarkdown("progressive-learning", PROGRESSIVE_LEARNING_SKILL_SOURCE);
  if (!parsed.success) {
    defaultChatSkillsCache = [];
    return defaultChatSkillsCache;
  }

  const skill: ChatSkill = {
    ...parsed.skill,
    id: DEFAULT_PROGRESSIVE_LEARNING_SKILL_ID,
  };
  defaultChatSkillsCache = [skill];
  return defaultChatSkillsCache;
}

export function readAvailableChatSkills(): ChatSkill[] {
  const defaults = getDefaultChatSkills();
  const stored = readStoredChatSkills();

  const seen = new Set<string>();
  const result: ChatSkill[] = [];

  for (const skill of defaults) {
    const key = `${skill.name}\0${skill.description}\0${skill.instructions}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(skill);
  }

  for (const skill of stored) {
    const key = `${skill.name}\0${skill.description}\0${skill.instructions}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(skill);
  }

  return result;
}

export function isDefaultChatSkill(skillId: string): boolean {
  return getDefaultChatSkills().some((skill) => skill.id === skillId);
}

export async function readSkillFromFileList(files: FileList): Promise<ParsedChatSkill> {
  const entries = Array.from(files);
  const skillFile = entries.find((file) => {
    const relativePath = file.webkitRelativePath || file.name;
    return relativePath.split("/").length === 2 && relativePath.endsWith("/SKILL.md");
  });

  if (!skillFile) {
    return { success: false, error: "missing-skill-md" };
  }

  const folderName = skillFile.webkitRelativePath.split("/")[0] ?? skillFile.name;
  const source = await skillFile.text();
  return parseSkillMarkdown(folderName, source);
}

function isChatSkill(value: unknown): value is ChatSkill {
  if (!value || typeof value !== "object") return false;
  const skill = value as Partial<ChatSkill>;
  return (
    typeof skill.id === "string" &&
    skill.id.trim().length > 0 &&
    typeof skill.name === "string" &&
    typeof skill.description === "string" &&
    typeof skill.instructions === "string" &&
    skill.instructions.trim().length > 0 &&
    typeof skill.version === "string"
  );
}

export function readStoredChatSkills(): ChatSkill[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(CHAT_SKILL_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as StoredChatSkills;
    if (parsed.version !== 1 || !Array.isArray(parsed.skills)) return [];

    return parsed.skills.filter(isChatSkill);
  } catch {
    return [];
  }
}

export function writeStoredChatSkills(skills: ChatSkill[]) {
  if (typeof window === "undefined") return;

  try {
    const payload: StoredChatSkills = {
      version: 1,
      skills,
    };
    window.localStorage.setItem(CHAT_SKILL_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage may be unavailable or full; the current selection still works for this send.
  }
}

export function addStoredChatSkill(skill: ChatSkill): ChatSkill[] {
  const skills = readStoredChatSkills();
  const existingIndex = skills.findIndex(
    (item) =>
      item.name === skill.name &&
      item.description === skill.description &&
      item.instructions === skill.instructions,
  );

  const nextSkills =
    existingIndex === -1
      ? [skill, ...skills]
      : [
          { ...skill, id: skills[existingIndex]?.id ?? skill.id },
          ...skills.slice(0, existingIndex),
          ...skills.slice(existingIndex + 1),
        ];

  writeStoredChatSkills(nextSkills);
  return nextSkills;
}

export function removeStoredChatSkill(skillId: string): ChatSkill[] {
  const skills = readStoredChatSkills().filter((skill) => skill.id !== skillId);
  writeStoredChatSkills(skills);
  return skills;
}

export function findChatSkillById(skillId: string | null): ChatSkill | null {
  if (!skillId) return null;
  return readAvailableChatSkills().find((skill) => skill.id === skillId) ?? null;
}

export function validateChatSkillForSend(skill: ChatSkill | null): ChatSkill | null {
  if (!skill) return null;

  if (
    skill.name.length > MAX_CHAT_SKILL_NAME_LENGTH ||
    skill.description.length > MAX_CHAT_SKILL_DESCRIPTION_LENGTH ||
    skill.instructions.length > MAX_CHAT_SKILL_INSTRUCTIONS_LENGTH ||
    !skill.instructions.trim()
  ) {
    return null;
  }

  return skill;
}
