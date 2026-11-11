import { describe, expect, it } from "vitest";
import {
  extractCanvasConceptUpdates,
  extractProfileAndStyleSignals,
  isConfusionPrompt,
  hasExplicitMasteryCue,
  mergeMemoryText,
  normalizeConceptKey,
} from "@/lib/server/user-memory";

describe("user-memory extractor", () => {
  describe("normalizeConceptKey", () => {
    it("strips AI/Re prefixes, markdown wrappers, and lowercases ASCII while preserving CJK and math", () => {
      expect(normalizeConceptKey("  AI: **Backpropagation**  ")).toBe(
        "backpropagation",
      );
      expect(normalizeConceptKey("### Re: `KL Divergence`?")).toBe(
        "kl divergence",
      );
      expect(normalizeConceptKey("「雅可比矩阵 ∇f(x)」。")).toBe(
        "雅可比矩阵 ∇f(x)",
      );
      expect(normalizeConceptKey("Time Complexity O(N log N)")).toBe(
        "time complexity o(n log n)",
      );
    });
  });

  describe("extractProfileAndStyleSignals", () => {
    it("extracts explicit Chinese learner background and style preferences", () => {
      const result = extractProfileAndStyleSignals(
        "我是一名计算机大二学生，我之前学过线性代数，没接触过概率论。请用通俗的语言解释，先给直觉，一步一步推导，不要跳步。",
      );

      expect(result.profileHint).toContain("计算机大二学生");
      expect(result.profileHint).toContain("学过线性代数");
      expect(result.profileHint).toContain("没接触过概率论");

      expect(result.styleHint).toContain("通俗");
      expect(result.styleHint).toContain("先给直觉");
      expect(result.styleHint).toContain("一步一步");
      expect(result.styleHint).toContain("不要跳步");
    });

    it("extracts explicit English learner background and style preferences", () => {
      const result = extractProfileAndStyleSignals(
        "I am a sophomore CS student and My background is in web development. Please explain intuitively, go step by step, use code examples, and keep it concise.",
      );

      expect(result.profileHint).toContain("sophomore CS student");
      expect(result.profileHint).toContain("background is in web development");

      expect(result.styleHint).toMatch(/explain intuitively/i);
      expect(result.styleHint).toMatch(/step by step/i);
      expect(result.styleHint).toMatch(/use code examples/i);
      expect(result.styleHint).toMatch(/keep it concise/i);
    });

    it("rejects conversational false positives in Chinese and English", () => {
      const falsePositives = [
        "我是说这里的矩阵维度为什么变了？",
        "我是不是理解错了这个公式？",
        "我是指第二个等号右边那一项",
        "我是想问反向传播怎么求导",
        "我有个问题想请教你",
        "I am confused about why the gradient vanishes here.",
        "I'm wondering what happens when k = 0.",
        "I am trying to understand eigenvectors.",
        "What have I learned from this chapter?",
      ];

      for (const prompt of falsePositives) {
        const extracted = extractProfileAndStyleSignals(prompt);
        expect(extracted.profileHint, `Prompt: ${prompt}`).toBeUndefined();
      }
    });
  });

  describe("mergeMemoryText", () => {
    it("deduplicates repeated or substring clauses idempotently and respects maxChars", () => {
      const step1 = mergeMemoryText("", "我是计算机大二学生; 学过线性代数", 500);
      const step2 = mergeMemoryText(
        step1,
        "学过线性代数; 我是计算机大二学生; 有Python基础",
        500,
      );
      expect(step2).toBe("我是计算机大二学生; 学过线性代数; 有Python基础");

      // Substring expansion replaces shorter clause cleanly
      const expanded = mergeMemoryText(
        "use code examples",
        "use code examples in Python",
        360,
      );
      expect(expanded).toBe("use code examples in Python");

      // Enforces maxChars while keeping newest clauses
      const capped = mergeMemoryText(
        "clause one; clause two; clause three",
        "newest preference",
        32,
      );
      expect(capped.length).toBeLessThanOrEqual(32);
      expect(capped).toContain("newest preference");
    });
  });

  describe("confusion & mastery cue helpers", () => {
    it("detects bilingual confusion prompts accurately", () => {
      expect(isConfusionPrompt("这一步我没看懂，为什么会消掉？")).toBe(true);
      expect(isConfusionPrompt("I'm struggling with the chain rule here.")).toBe(
        true,
      );
      expect(isConfusionPrompt("What does Hermitian matrix mean?")).toBe(true);
      expect(isConfusionPrompt("继续讲下一节矩阵分解的应用")).toBe(false);
    });

    it("handles past-confusion + present-mastery without false confusion", () => {
      const text = "之前没看懂，现在完全明白了，继续讲下一个知识点";
      expect(hasExplicitMasteryCue(text)).toBe(true);
      expect(isConfusionPrompt(text)).toBe(false);
      expect(hasExplicitMasteryCue("我还没懂了")).toBe(false);
      expect(hasExplicitMasteryCue("你明白了吗？")).toBe(false);
    });
  });

  describe("extractCanvasConceptUpdates", () => {
    it("marks branch drill-down with confusion cues as struggling", () => {
      const updates = extractCanvasConceptUpdates({
        mode: "branch",
        instruction: "这里的雅可比矩阵我搞不清怎么算出来的，没看懂",
        sourceText: "雅可比矩阵 J_f",
        reply: {
          title: "雅可比矩阵偏导排列",
          summary: "雅可比矩阵第 i 行第 j 列为 ∂f_i/∂x_j。",
        },
        contextSummaries: ["多元微积分基础: 向量值函数求导"],
      });

      expect(updates.isConfusion).toBe(true);
      expect(updates.currentConcept).toEqual({
        concept: "雅可比矩阵偏导排列",
        conceptKey: "雅可比矩阵偏导排列",
        status: "struggling",
        note: "雅可比矩阵第 i 行第 j 列为 ∂f_i/∂x_j。",
      });
      expect(updates.promoteParentIfLearning).toBeUndefined();
    });

    it("falls back to short sourceText when reply.title is generic AI: ...", () => {
      const updates = extractCanvasConceptUpdates({
        mode: "branch",
        instruction: "I don't understand this term",
        sourceText: "Hessian Matrix",
        reply: {
          title: "AI: I don't understand this term",
          summary: "Second-order partial derivatives matrix.",
        },
      });

      expect(updates.currentConcept).toEqual({
        concept: "Hessian Matrix",
        conceptKey: "hessian matrix",
        status: "struggling",
        note: "Second-order partial derivatives matrix.",
      });
    });

    it("marks exploratory branch without confusion cues as learning", () => {
      const updates = extractCanvasConceptUpdates({
        mode: "branch",
        instruction: "拓展讲一下自注意力机制在视觉模型里的变体",
        sourceText: "Self-Attention",
        reply: {
          title: "Vision Transformer 注意力变体",
          summary: "窗口注意力与线性注意力降低了二维图像序列复杂度。",
        },
        contextSummaries: ["Transformer 架构: 自注意力核心原理"],
      });

      expect(updates.isConfusion).toBe(false);
      expect(updates.currentConcept?.status).toBe("learning");
      expect(updates.promoteParentIfLearning).toBeUndefined();
    });

    it("emits promoteParentIfLearning on downward continue without confusion", () => {
      const updates = extractCanvasConceptUpdates({
        mode: "continue",
        instruction: "继续推导反向传播在隐藏层的误差项",
        reply: {
          title: "隐藏层误差项 δ 递推",
          summary: "通过下一层权重转置将误差反向传播至当前隐藏层。",
        },
        contextSummaries: [
          "神经网络概览: 前向计算",
          "输出层梯度推导: 损失函数对输出层权重的偏导",
        ],
      });

      expect(updates.promoteParentIfLearning).toEqual({
        concept: "输出层梯度推导",
        conceptKey: "输出层梯度推导",
      });
      expect(updates.currentConcept).toMatchObject({
        concept: "隐藏层误差项 δ 递推",
        status: "learning",
      });
    });

    it("promotes immediate parent to mastered on explicit mastery cues", () => {
      const updates = extractCanvasConceptUpdates({
        mode: "continue",
        instruction: "Got it, that makes sense now! Let's move on to momentum SGD.",
        reply: {
          title: "Momentum SGD",
          summary: "Accumulates an exponentially decaying moving average of past gradients.",
        },
        contextSummaries: ["Vanilla Gradient Descent: Steepest descent update rule"],
      });

      expect(updates.hasExplicitMastery).toBe(true);
      expect(updates.explicitMasteredParent).toEqual({
        concept: "Vanilla Gradient Descent",
        conceptKey: "vanilla gradient descent",
      });
      expect(updates.currentConcept).toMatchObject({
        concept: "Momentum SGD",
        status: "learning",
      });
    });
  });
});
