import {
  MAX_CONCEPT_NAME_CHARS,
  MAX_CONCEPT_NOTE_CHARS,
  MAX_PREFERRED_STYLE_CHARS,
  MAX_PROFILE_SUMMARY_CHARS,
  type UserMemoryConceptStatus,
} from "@/lib/server/user-memory/types";

export type ExtractedProfileAndStyleSignals = {
  profileHint?: string;
  styleHint?: string;
};

export type ExtractedConceptSignal = {
  concept: string;
  conceptKey: string;
  status: UserMemoryConceptStatus;
  note: string;
};

export type ParentConceptRef = {
  concept: string;
  conceptKey: string;
};

export type ExtractCanvasConceptUpdatesInput = {
  mode: "root" | "continue" | "branch";
  instruction: string;
  sourceText?: string;
  reply: {
    title: string;
    summary: string;
  };
  contextSummaries?: string[];
};

export type CanvasConceptUpdates = {
  currentConcept?: ExtractedConceptSignal;
  explicitMasteredParent?: ParentConceptRef;
  promoteParentIfLearning?: ParentConceptRef;
  isConfusion: boolean;
  hasExplicitMastery: boolean;
};

function safeSliceUtf16(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  let end = Math.max(0, Math.floor(maxLength));
  if (end > 0) {
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      end -= 1;
    }
  }
  return text.slice(0, end);
}

export function truncateMemoryText(input: string, maxChars: number): string {
  const budget = Math.floor(maxChars);
  if (budget <= 0) return "";
  const normalized = input.trim().replace(/\s+/g, " ");
  if (normalized.length <= budget) return normalized;
  if (budget <= 3) return safeSliceUtf16(normalized, budget);
  return `${safeSliceUtf16(normalized, budget - 3).trimEnd()}...`;
}

function stripConceptDecorations(raw: string): string {
  let text = raw.trim();
  // Strip leading markdown headers and list markers
  text = text.replace(/^(?:#{1,6}\s+|[-*+]\s+)+/, "").trim();
  // Strip trailing punctuation and outer markdown emphasis / code / quote wrappers repeatedly
  for (let i = 0; i < 4; i += 1) {
    const next = text
      .replace(/[.。!！?？:：;；,，]+$/g, "")
      .trim()
      .replace(/^\*\*(.+)\*\*$/, "$1")
      .replace(/^\*(.+)\*$/, "$1")
      .replace(/^`(.+)`$/, "$1")
      .replace(/^"(.+)"$/, "$1")
      .replace(/^“(.+)”$/, "$1")
      .replace(/^「(.+)」$/, "$1")
      .replace(/^『(.+)』$/, "$1")
      .replace(/^《(.+)》$/, "$1")
      .trim();
    if (next === text) break;
    text = next;
  }
  // Strip leading "AI:", "Re:", "Reply:" prefixes
  text = text.replace(/^(?:(?:ai|re|reply)\s*[:：\-—]\s*)+/i, "").trim();
  // Strip remaining inline markdown bold/code wrappers
  text = text.replace(/\*\*|`/g, "");
  // Collapse whitespace and strip trailing punctuation
  text = text.replace(/\s+/g, " ").replace(/[.。!！?？:：;；,，]+$/g, "").trim();
  return text;
}

/**
 * Normalizes a concept name into a stable deduplication key:
 * strips "AI:" / "Re:" / markdown wrappers, collapses whitespace, and lowercases
 * ASCII letters while preserving CJK characters and mathematical symbols.
 */
export function normalizeConceptKey(concept: string): string {
  const cleaned = stripConceptDecorations(concept);
  if (!cleaned) return "";
  return cleaned.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
}

export function cleanConceptTitle(
  raw: string,
  maxChars: number = MAX_CONCEPT_NAME_CHARS,
): string {
  const cleaned = stripConceptDecorations(raw);
  if (!cleaned) return "";
  return truncateMemoryText(cleaned, maxChars);
}

const GENERIC_TITLES = new Set([
  "response",
  "assistant response",
  "ai response",
  "deepseek response",
  "chat title",
  "regenerated",
  "untitled",
  "new node",
  "blank node",
  "exploring idea",
  "exploring idea...",
  "summary",
  "reply",
  "标题",
  "新节点",
  "空白节点",
  "正在探索",
  "正在探索...",
  "回答",
  "回复",
  "总结",
]);

export function isGenericConceptTitle(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (/^ai\s*:\s+/i.test(trimmed)) return true;

  const cleaned = stripConceptDecorations(trimmed);
  if (!cleaned) return true;

  const key = cleaned.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
  if (GENERIC_TITLES.has(key)) return true;

  const hasCjk = /[\u4e00-\u9fff]/.test(cleaned);
  if (!hasCjk && cleaned.length < 2) return true;

  return false;
}

function normalizeClauseForDedup(clause: string): string {
  return clause
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.。!！?？,，;；:：]+$/g, "")
    .replace(/[A-Z]/g, (ch) => ch.toLowerCase());
}

function cleanClause(clause: string): string {
  return clause
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^[;；,，.。:\s]+|[;；,，.。\s]+$/g, "")
    .trim();
}

/**
 * Merges semicolon-delimited memory clauses idempotently without duplicate bloat,
 * bounding total length to `maxChars` while preferring newer updates when full.
 */
export function mergeMemoryText(
  existing: string,
  incoming: string | undefined,
  maxChars: number,
): string {
  const budget = Math.floor(maxChars);
  if (budget <= 0) return "";

  const rawClauses = [
    ...existing.split(/\s*[;；]\s*/),
    ...(incoming ? incoming.split(/\s*[;；]\s*/) : []),
  ];

  const clauses: string[] = [];
  const keys: string[] = [];

  for (const raw of rawClauses) {
    const cleaned = cleanClause(raw);
    if (!cleaned) continue;
    const key = normalizeClauseForDedup(cleaned);
    if (!key) continue;

    const exactIdx = keys.indexOf(key);
    if (exactIdx !== -1) {
      continue;
    }

    // Skip if already covered as a substring of an existing clause
    if (keys.some((existingKey) => existingKey.includes(key))) {
      continue;
    }

    // Replace an existing shorter clause if the incoming clause strictly expands it
    const expandedIdx = keys.findIndex((existingKey) => key.includes(existingKey));
    if (expandedIdx !== -1) {
      clauses[expandedIdx] = cleaned;
      keys[expandedIdx] = key;
      continue;
    }

    clauses.push(cleaned);
    keys.push(key);
  }

  if (clauses.length === 0) return "";

  const joined = clauses.join("; ");
  if (joined.length <= budget) {
    return joined;
  }

  // Keep newest clauses preferentially when over budget
  const keptFromNewest: string[] = [];
  let currentLength = 0;
  for (let i = clauses.length - 1; i >= 0; i -= 1) {
    const clause = clauses[i];
    const separatorCost = keptFromNewest.length > 0 ? 2 : 0;
    if (currentLength + separatorCost + clause.length <= budget) {
      keptFromNewest.push(clause);
      currentLength += separatorCost + clause.length;
    } else if (keptFromNewest.length === 0) {
      keptFromNewest.push(truncateMemoryText(clause, budget));
      break;
    }
  }

  return keptFromNewest.reverse().join("; ");
}

const ZH_PROFILE_FALSE_POSITIVE_PREFIX =
  /^(?:说|指|想|不是|觉得|认为|希望|好奇|问|来|在问|想问|想了解|想知道|看|为了|因为|那|这)/;

const ZH_PROFILE_ROLE_KEYWORDS =
  /(?:学生|大学生|本科|研究生|硕士|博士|博后|高中生|初中生|大一|大二|大三|大四|研一|研二|研三|年级|专业|方向|科班|非科班|转码|转行|零基础|初学者|新手|入门|小白|自学|备考|考研|考公|前端|后端|全栈|工程师|开发者|程序员|算法|研究员|产品经理|设计师|数据分析|医生|教师|老师|从业者)/;

const EN_PROFILE_FALSE_POSITIVE =
  /^(?:confused|wondering|asking|trying\s+to|not\s+sure|unsure|stuck|lost|curious|looking\s+for|here\s+to|having\s+trouble|struggling)\b/i;

const EN_PROFILE_ROLE_KEYWORDS =
  /\b(?:student|undergrad|undergraduate|grad|graduate|phd|doctoral|postdoc|freshman|sophomore|junior|senior|beginner|novice|newbie|self-taught|engineer|developer|programmer|researcher|scientist|analyst|designer|product\s+manager|major|majoring|studying|preparing\s+for|switching\s+from|career\s+changer)\b/i;

function extractProfileClauses(instruction: string): string[] {
  const results: string[] = [];
  const segments = instruction
    .split(/[\r\n。！？!?；;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const subClauses = segment
      .split(/[，,]\s*/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const clause of subClauses) {
      // 1. Chinese "我是..." with strict false-positive rejection + role validation
      const zhSelfMatch = /(?:^|本人)我是(?:一名|一个|个)?\s*([^，。！？；\n]{2,60})/.exec(
        clause,
      );
      if (zhSelfMatch) {
        const body = zhSelfMatch[1].trim();
        if (
          !ZH_PROFILE_FALSE_POSITIVE_PREFIX.test(body) &&
          ZH_PROFILE_ROLE_KEYWORDS.test(body) &&
          !/[?？吗呢]$/.test(body)
        ) {
          results.push(`我是${body}`);
          continue;
        }
      }

      // 2. Chinese explicit background / prior coursework
      const zhBgMatch =
        /(?:我的(?:专业|背景|基础|职业|工作|方向|水平)是\s*([^，。！？；\n]{2,70})|我目前(?:在读|就读于|从事|主攻)\s*([^，。！？；\n]{2,70}))/.exec(
          clause,
        );
      if (zhBgMatch) {
        const matched = cleanClause(zhBgMatch[0]);
        if (matched && !/[?？吗]$/.test(matched)) {
          results.push(matched);
          continue;
        }
      }

      const zhLearnedMatch =
        /^我(?:之前|以前|已经)?(?:系统)?(?:学过|掌握了|熟悉)\s*([^，。！？；\n?？]{2,60})/.exec(
          clause,
        );
      if (zhLearnedMatch) {
        const subject = zhLearnedMatch[1].trim();
        if (!/^(?:什么|哪些|吗|呢|问题|疑问)/.test(subject)) {
          results.push(cleanClause(zhLearnedMatch[0]));
          continue;
        }
      }

      const zhFoundationMatch =
        /^(?:(?:但|但是|不过|而且|并且)?\s*(?:我|本人)?(?:从来|之前|以前|还)?(?:没(?:有)?接触过|没(?:有)?学过)\s*[^，。！？；\n?？]{2,40}|(?:我|本人)(?:对[^，。！？；\n]{1,25}零基础|零基础|有\s*[^，。！？；\n?？]{1,40}(?:基础|背景|经验)))/.exec(
          clause,
        );
      if (zhFoundationMatch) {
        const matched = cleanClause(zhFoundationMatch[0]);
        if (matched && !/问题|疑问|什么|哪些|[吗呢]$/.test(matched)) {
          results.push(matched);
          continue;
        }
      }

      // 3. English "I am / I'm ..." with strict false-positive guard + role check
      const enSelfMatch =
        /\b(?:I\s+am|I'm)\s+(?:currently\s+)?(?:a|an)?\s*([^.,!?;:\n]{3,90})/i.exec(
          clause,
        );
      if (enSelfMatch) {
        const body = enSelfMatch[1].trim();
        if (
          !EN_PROFILE_FALSE_POSITIVE.test(body) &&
          EN_PROFILE_ROLE_KEYWORDS.test(body) &&
          !clause.endsWith("?")
        ) {
          results.push(cleanClause(enSelfMatch[0]));
        }
      }

      // 4. English "My background is..." / "I have studied..." / "I have a background in..."
      const enBgMatch =
        /\b(?:My\s+background\s+is(?:\s+in)?\s+[^.,!?;:\n]{3,80}|I\s+(?:have|'ve)\s+(?:already\s+)?(?:a\s+background\s+in|experience\s+(?:with|in)|studied|learned)\s+[^.,!?;:\n]{2,80})/i.exec(
          clause,
        );
      if (enBgMatch && !clause.endsWith("?")) {
        results.push(cleanClause(enBgMatch[0]));
      }
    }
  }

  return results;
}

const ZH_STYLE_PATTERNS: RegExp[] = [
  /请?(?:尽量|多|先)?用[^，。！？；\n]{0,20}(?:通俗|白话|大白话|直觉|直观|类比|比喻|例子|实例|代码|示例|图示|形式化|严格推导)[^，。！？；\n]{0,24}/,
  /(?:先给|多给|给一些|先讲)(?:直觉|直观解释|物理直觉|几何直觉|例子|代码示例|类比|结论|整体框架)[^，。！？；\n]{0,20}/,
  /(?:不要|别|少)(?:跳步|省略步骤|太抽象|堆砌术语|用太多公式|太啰嗦)[^，。！？；\n]{0,20}/,
  /(?:请)?(?:一步一步|循序渐进|由浅入深|手把手|分步骤)[^，。！？；\n]{0,24}/,
  /(?:多举例子|多举些例子|结合代码|用代码示例|配上代码示例|附带代码)[^，。！？；\n]{0,20}/,
  /(?:尽量)?(?:简洁一点|简明扼要|言简意赅|保持简洁|直接给结论|偏数学严格推导|偏重数学推导|严格数学证明|通俗易懂一点|通俗易懂)[^，。！？；\n]{0,20}/,
];

const EN_STYLE_PATTERNS: RegExp[] = [
  /\b(?:please\s+)?explain\s+(?:it\s+|things\s+)?(?:intuitively|in\s+plain\s+english|in\s+simple\s+terms|like\s+I'm\s+five|eli5|step[- ]by[- ]step|with\s+(?:concrete\s+|code\s+)?examples|with\s+analogies|rigorously|formally)[^.,!?;:\n]{0,35}/i,
  /\b(?:start\s+with|lead\s+with|give\s+me)\s+(?:intuition|an\s+intuitive\s+explanation|concrete\s+examples|code\s+examples|a\s+high-level\s+overview)[^.,!?;:\n]{0,35}/i,
  /\b(?:go\s+)?(?:step[- ]by[- ]step|don't\s+skip\s+steps|do\s+not\s+skip\s+steps|avoid\s+jargon|no\s+hand-waving)[^.,!?;:\n]{0,30}/i,
  /\b(?:please\s+)?(?:use|include|provide|prefer)\s+(?:code\s+examples|concrete\s+examples|analogies|visual\s+analogies|formal\s+proofs?|mathematical\s+derivations?|rigorous\s+proofs?)[^.,!?;:\n]{0,35}/i,
  /\b(?:keep\s+it|be)\s+(?:concise|brief|short\s+and\s+direct|rigorous|intuitive)[^.,!?;:\n]{0,25}/i,
  /\b(?:formal\s+proof|rigorous\s+math|intuition\s+first)\b[^.,!?;:\n]{0,25}/i,
];

function extractStyleClauses(instruction: string): string[] {
  const results: string[] = [];
  const segments = instruction
    .split(/[\r\n。！？!?；;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const subClauses = segment
      .split(/[，,]\s*/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const clause of subClauses) {
      for (const pattern of ZH_STYLE_PATTERNS) {
        const match = pattern.exec(clause);
        if (match) {
          results.push(cleanClause(match[0]));
          break;
        }
      }

      for (const pattern of EN_STYLE_PATTERNS) {
        const match = pattern.exec(clause);
        if (match) {
          results.push(cleanClause(match[0]));
          break;
        }
      }
    }
  }

  return results;
}

/**
 * Deterministically extracts explicit learner profile background and style
 * preferences from Chinese and English user instructions with zero LLM latency.
 */
export function extractProfileAndStyleSignals(
  instruction: string,
): ExtractedProfileAndStyleSignals {
  if (!instruction || !instruction.trim()) {
    return {};
  }

  const profileClauses = extractProfileClauses(instruction);
  const styleClauses = extractStyleClauses(instruction);

  const profileHint =
    profileClauses.length > 0
      ? mergeMemoryText("", profileClauses.join("; "), MAX_PROFILE_SUMMARY_CHARS)
      : undefined;
  const styleHint =
    styleClauses.length > 0
      ? mergeMemoryText("", styleClauses.join("; "), MAX_PREFERRED_STYLE_CHARS)
      : undefined;

  return {
    ...(profileHint ? { profileHint } : {}),
    ...(styleHint ? { styleHint } : {}),
  };
}

const ZH_CONFUSION_CUE =
  /(?:没看懂|看不懂|没听懂|没搞懂|搞不懂|还是不懂|完全不懂|不太懂|没懂|不懂|不理解|不太理解|没理解|搞不清|分不清|弄不清|混淆|卡住|卡壳|很困惑|有点困惑|困惑|一头雾水|绕晕|晕了|为什么会|为什么这里|为什么是|怎么理解|怎么来的|什么意思|啥意思|是指什么)/;

const EN_CONFUSION_CUE =
  /\b(?:confused|confusing|don't\s+understand|do\s+not\s+understand|doesn't\s+make\s+sense|does\s+not\s+make\s+sense|struggling\s+with|struggling\s+to|stuck\s+on|lost\s+on|can't\s+wrap\s+my\s+head\s+around|why\s+does|why\s+is|how\s+come|what\s+does\s+.+\s+mean|what\s+is\s+meant\s+by)\b/i;

const ZH_PAST_CONFUSION_QUALIFIER =
  /(?:之前|以前|刚才|原本|本来)[^，。！？；\n]{0,6}(?:没看懂|看不懂|不懂|不理解|没懂|搞不清)/;

const ZH_EXPLICIT_MASTERY_CUE =
  /(?<![没不未难])(?:完全懂了|看懂了|听懂了|搞懂了|弄懂了|懂了|明白了|理解了|学会了|掌握了|清晰了|清楚了|通透了|豁然开朗)(?![吗呢?？])/;

const EN_EXPLICIT_MASTERY_CUE =
  /(?<!\b(?:don't|do\s+not|not|never|haven't|hardly)\s+)(?:\bi\s+got\s+it\b|\bgot\s+it(?:\s+now)?\b|\bmakes\s+sense(?:\s+now)?\b|\bthat\s+makes\s+sense\b|\bi\s+understand(?:\s+it)?\s+now\b|\bunderstood\b|\bcrystal\s+clear(?:\s+now)?\b|\bclear\s+now\b|\bfigured\s+it\s+out\b)(?!\s*\?)/i;

export function hasExplicitMasteryCue(instruction: string): boolean {
  const trimmed = instruction.trim();
  if (!trimmed) return false;
  return (
    ZH_EXPLICIT_MASTERY_CUE.test(trimmed) ||
    EN_EXPLICIT_MASTERY_CUE.test(trimmed)
  );
}

export function isConfusionPrompt(instruction: string): boolean {
  const trimmed = instruction.trim();
  if (!trimmed) return false;

  if (EN_CONFUSION_CUE.test(trimmed)) {
    return true;
  }

  if (ZH_CONFUSION_CUE.test(trimmed)) {
    // Guard against "之前没看懂，现在明白了，继续下一步"
    const strippedPast = trimmed.replace(ZH_PAST_CONFUSION_QUALIFIER, "");
    if (
      hasExplicitMasteryCue(trimmed) &&
      !ZH_CONFUSION_CUE.test(strippedPast)
    ) {
      return false;
    }
    return true;
  }

  return false;
}

export function extractParentConceptFromContextSummaries(
  contextSummaries?: string[],
): ParentConceptRef | undefined {
  if (!contextSummaries || contextSummaries.length === 0) {
    return undefined;
  }

  for (let i = contextSummaries.length - 1; i >= 0; i -= 1) {
    const raw = contextSummaries[i]?.trim();
    if (!raw) continue;

    const colonIndex = raw.indexOf(": ");
    const titlePart = colonIndex >= 0 ? raw.slice(0, colonIndex).trim() : raw;
    if (isGenericConceptTitle(titlePart)) {
      continue;
    }

    const concept = cleanConceptTitle(titlePart, MAX_CONCEPT_NAME_CHARS);
    const conceptKey = normalizeConceptKey(concept);
    if (concept && conceptKey) {
      return { concept, conceptKey };
    }
  }

  return undefined;
}

function resolveCurrentConceptName(
  replyTitle: string,
  sourceText?: string,
): string | undefined {
  if (!isGenericConceptTitle(replyTitle)) {
    const cleaned = cleanConceptTitle(replyTitle, MAX_CONCEPT_NAME_CHARS);
    if (cleaned) return cleaned;
  }

  if (sourceText) {
    const normalizedSource = sourceText.trim().replace(/\s+/g, " ");
    if (normalizedSource.length > 0 && normalizedSource.length <= 60) {
      if (!isGenericConceptTitle(normalizedSource)) {
        const cleanedSource = cleanConceptTitle(normalizedSource, 60);
        if (cleanedSource) return cleanedSource;
      }
    }
  }

  return undefined;
}

/**
 * Extracts concept mastery / struggle updates from BranchMind's canvas tree
 * topology (`root` | `continue` | `branch`), selected `sourceText`, user prompt
 * cues, ancestor `contextSummaries`, and the structured AI `reply`.
 */
export function extractCanvasConceptUpdates(
  input: ExtractCanvasConceptUpdatesInput,
): CanvasConceptUpdates {
  const isConfusion = isConfusionPrompt(input.instruction);
  const hasExplicitMastery =
    !isConfusion && hasExplicitMasteryCue(input.instruction);

  const parentRef = extractParentConceptFromContextSummaries(
    input.contextSummaries,
  );

  const explicitMasteredParent =
    hasExplicitMastery && parentRef ? parentRef : undefined;

  const promoteParentIfLearning =
    !hasExplicitMastery &&
    !isConfusion &&
    input.mode === "continue" &&
    parentRef
      ? parentRef
      : undefined;

  const conceptName = resolveCurrentConceptName(
    input.reply.title,
    input.sourceText,
  );
  const conceptKey = conceptName ? normalizeConceptKey(conceptName) : "";

  let currentConcept: ExtractedConceptSignal | undefined;
  if (conceptName && conceptKey) {
    let status: UserMemoryConceptStatus;
    if (isConfusion) {
      status = "struggling";
    } else if (
      explicitMasteredParent &&
      explicitMasteredParent.conceptKey === conceptKey
    ) {
      status = "mastered";
    } else if (input.mode === "branch") {
      status = "learning";
    } else {
      status = "learning";
    }

    const note = truncateMemoryText(
      input.reply.summary || "",
      MAX_CONCEPT_NOTE_CHARS,
    );

    currentConcept = {
      concept: conceptName,
      conceptKey,
      status,
      note,
    };
  }

  return {
    ...(currentConcept ? { currentConcept } : {}),
    ...(explicitMasteredParent ? { explicitMasteredParent } : {}),
    ...(promoteParentIfLearning ? { promoteParentIfLearning } : {}),
    isConfusion,
    hasExplicitMastery,
  };
}
