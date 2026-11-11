import { describe, expect, it } from "vitest";
import { formatLatestReplyNoteSection } from "@/lib/project-notes";
import {
  DEFAULT_PINNED_PROJECT_NOTES_MAX_CHARS,
  extractPinnedProjectNotes,
  resolveTreeContextModePolicy,
} from "@/lib/server/tree-context/mode-and-notes";

describe("extractPinnedProjectNotes", () => {
  it("returns empty string for nullish, empty, whitespace-only, or non-positive budgets", () => {
    expect(extractPinnedProjectNotes(undefined)).toBe("");
    expect(extractPinnedProjectNotes(null)).toBe("");
    expect(extractPinnedProjectNotes("")).toBe("");
    expect(extractPinnedProjectNotes("   \n\t\r\n  ")).toBe("");
    expect(extractPinnedProjectNotes("<p></p>")).toBe("");
    expect(extractPinnedProjectNotes("<p>   </p><p>&nbsp;</p>")).toBe("");
    expect(extractPinnedProjectNotes("<h2>   </h2><blockquote><p></p></blockquote><ul><li><p></p></li></ul>")).toBe("");
    expect(extractPinnedProjectNotes("Valid note", 0)).toBe("");
    expect(extractPinnedProjectNotes("Valid note", -25)).toBe("");
    expect(extractPinnedProjectNotes("Valid note", Number.NaN)).toBe("");
  });

  it("converts Tiptap HTML headings, blockquotes, paragraphs, and lists cleanly", () => {
    const tiptapHtml =
      '<h2>Title</h2><blockquote class="project-notes-editor-blockquote"><p>Root → Node</p></blockquote><p>Key formula: $E = mc^2$</p><ul><li><p>Point 1</p></li><li><p>Point 2 with <strong>bold</strong> and <a href="https://example.com">link</a></p></li></ul>';

    const extracted = extractPinnedProjectNotes(tiptapHtml);

    expect(extracted).toBe(
      [
        "## Title",
        "> Root → Node",
        "",
        "Key formula: $E = mc^2$",
        "- Point 1",
        "- Point 2 with bold and link",
      ].join("\n"),
    );
  });

  it("handles pretty-printed HTML, breaks, tables, code blocks, and Tiptap task/math blocks", () => {
    const html = `
      <h1>Main Topic</h1>
      <div>Line one<br/>Line two<br>Line three</div>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="true">
          <label><input type="checkbox" checked="checked"><span></span></label>
          <div><p>Review theorem</p></div>
        </li>
      </ul>
      <div data-type="block-math" data-latex="\\int_0^1 x^2 \\, dx = \\frac{1}{3}"></div>
      <table>
        <tr><th>Term</th><th>Meaning</th></tr>
        <tr><td>DAG</td><td>Directed acyclic graph</td></tr>
      </table>
      <pre><code>const k = 42;</code></pre>
    `;

    const extracted = extractPinnedProjectNotes(html);

    expect(extracted).toContain("# Main Topic");
    expect(extracted).toContain("Line one\nLine two\nLine three");
    expect(extracted).toContain("- Review theorem");
    expect(extracted).toContain("$$\\int_0^1 x^2 \\, dx = \\frac{1}{3}$$");
    expect(extracted).toContain("Term Meaning\nDAG Directed acyclic graph");
    expect(extracted).toContain("const k = 42;");
  });

  it("strips <script>, <style>, and HTML comments safely in linear time", () => {
    const html = [
      "<!-- internal editor comment -->",
      '<style type="text/css">.prose p { display: none; }</style>',
      "<h3>Safe Heading</h3>",
      '<SCRIPT defer>window.__evil = "<p>leak</p>"; alert(1);</SCRIPT>',
      "<p>Visible summary.</p>",
    ].join("");

    const extracted = extractPinnedProjectNotes(html);
    expect(extracted).toBe("### Safe Heading\nVisible summary.");
    expect(extracted).not.toContain("alert");
    expect(extracted).not.toContain("display: none");
    expect(extracted).not.toContain("comment");

    // Pathological unclosed tags must finish instantaneously in O(N) time without backtracking.
    const adversarial = `${"<script>".repeat(4000)}${"<div attr=".repeat(4000)}Tail note`;
    const startedAt = performance.now();
    const adversarialResult = extractPinnedProjectNotes(adversarial, 50_000);
    expect(performance.now() - startedAt).toBeLessThan(200);
    expect(adversarialResult).not.toContain("<script>");
    expect(adversarialResult).toContain("Tail note");
  });

  it("decodes named, decimal, and hex HTML entities safely without double-unescaping or throwing", () => {
    const html =
      "<p>Tom &amp; Jerry:&nbsp;&quot;1 &lt; 2 &amp;&amp; 3 &gt; 1&quot;, it&#39;s &apos;ok&apos; &#8594; &#x2192; &#X1F680;</p>" +
      "<p>Escaped tag stays text: &lt;script&gt;notExecuted()&lt;/script&gt; and &amp;lt;raw&amp;gt;</p>" +
      "<p>Invalid numeric entities stay safe: &#x110000; &#xD800; &#0; &#99999999999;</p>";

    const extracted = extractPinnedProjectNotes(html);

    expect(extracted).toContain(`Tom & Jerry: "1 < 2 && 3 > 1", it's 'ok' → → 🚀`);
    expect(extracted).toContain("Escaped tag stays text: <script>notExecuted()</script> and &lt;raw&gt;");
    expect(extracted).toContain("&#x110000; &#xD800; &#0; &#99999999999;");
  });

  it("preserves LaTeX math inequalities in Markdown and HTML notes without eating text between < and >", () => {
    const markdownNote = formatLatestReplyNoteSection({
      title: "Cauchy-Schwarz & Bounds",
      sourceLabel: "Root → Inequalities",
      content: [
        "Assume $a < b$ and $c > d$ for real scalars.",
        "",
        "Tightly spaced: $x<y$ and $z>w$, chained $x<y + z>0$, and display:",
        "$$0 < \\epsilon < \\delta \\implies |f(x) - L| > 0$$",
        "",
        "Generic type note: Promise<T> and Record<K, V>.",
      ].join("\n"),
    });

    const extracted = extractPinnedProjectNotes(markdownNote);

    expect(extracted).toContain("## Cauchy-Schwarz & Bounds");
    expect(extracted).toContain("> Root → Inequalities");
    expect(extracted).toContain("Assume $a < b$ and $c > d$ for real scalars.");
    expect(extracted).toContain("Tightly spaced: $x<y$ and $z>w$, chained $x<y + z>0$, and display:");
    expect(extracted).toContain("$$0 < \\epsilon < \\delta \\implies |f(x) - L| > 0$$");
    expect(extracted).toContain("Promise<T>");

    const htmlWithMath = "<p>When $a < b$ and $c > d$, the interval $(a, b)$ is non-empty.</p>";
    expect(extractPinnedProjectNotes(htmlWithMath)).toBe(
      "When $a < b$ and $c > d$, the interval $(a, b)$ is non-empty.",
    );
  });

  it("normalizes horizontal whitespace per line and collapses 3+ newlines to double newlines", () => {
    const messy = "  First   line\t\twith   tabs  \r\n\r\n\r\n\r\n  Second   line  \n\n\n   Third line ";
    expect(extractPinnedProjectNotes(messy)).toBe(
      "First line with tabs\n\nSecond line\n\nThird line",
    );
  });

  it("enforces maxChars strictly while preferring newline and word boundaries past 50% budget", () => {
    expect(DEFAULT_PINNED_PROJECT_NOTES_MAX_CHARS).toBe(1800);

    // Exact fit is returned untouched.
    const exact = "A".repeat(50);
    expect(extractPinnedProjectNotes(exact, 50)).toBe(exact);

    // Prefers newline boundary past 50% of budget and appends `\n...`.
    const multiLine = [
      "## Architecture Decisions",
      "- Keep root anchor intact across deep chains",
      "- Fold distant ancestors into compact summaries",
      "- Preserve recent multi-turn exchanges verbatim",
    ].join("\n");
    const lineTruncated = extractPinnedProjectNotes(multiLine, 95);
    expect(lineTruncated.length).toBeLessThanOrEqual(95);
    expect(lineTruncated.endsWith("\n...")).toBe(true);
    expect(lineTruncated).toBe(
      "## Architecture Decisions\n- Keep root anchor intact across deep chains\n...",
    );

    // Prefers word boundary when no newline exists past 50% of budget.
    const singleParagraph =
      "Gradient descent iteratively updates parameters in the opposite direction of the objective gradient.";
    const wordTruncated = extractPinnedProjectNotes(singleParagraph, 60);
    expect(wordTruncated.length).toBeLessThanOrEqual(60);
    expect(wordTruncated.endsWith("...")).toBe(true);
    expect(wordTruncated).toBe("Gradient descent iteratively updates parameters in the...");

    // Falls back cleanly on unbroken long strings and tiny budgets without exceeding maxChars.
    const unbroken = "x".repeat(200);
    for (const budget of [1, 2, 3, 4, 5, 10, 40]) {
      const out = extractPinnedProjectNotes(unbroken, budget);
      expect(out.length).toBeLessThanOrEqual(budget);
      expect(out.length).toBeGreaterThan(0);
    }

    // Avoids splitting UTF-16 surrogate pairs when hard-cutting emoji runs.
    const emojiRun = "🚀".repeat(30);
    const emojiTruncated = extractPinnedProjectNotes(emojiRun, 15);
    expect(emojiTruncated.length).toBeLessThanOrEqual(15);
    expect(emojiTruncated.endsWith("...")).toBe(true);
    expect(emojiTruncated).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe("resolveTreeContextModePolicy", () => {
  it("returns mainline-oriented policy for `continue` mode", () => {
    const policy = resolveTreeContextModePolicy("continue");

    expect(policy).toEqual({
      mode: "continue",
      hasSourceText: false,
      maxRecentFullNodes: 3,
      sideBranchLookbackDepth: 3,
      maxSideBranches: 5,
      includeProjectNotes: true,
      budgets: {
        recentTurnsChars: 6000,
        foldedAncestorsChars: 2200,
        sideBranchesChars: 1400,
        projectNotesChars: 1800,
        userMemoryChars: 1000,
      },
      modeGuidance: expect.stringContaining("Continue Down"),
    });
    expect(policy.modeGuidance.toLowerCase()).toContain("root");
    expect(policy.modeGuidance.toLowerCase()).toContain("project notes");

    expect(resolveTreeContextModePolicy("continue", { hasSourceText: true }).hasSourceText).toBe(
      true,
    );
  });

  it("differentiates general `branch` mode from selected-text (`hasSourceText: true`) `branch` mode", () => {
    const generalBranch = resolveTreeContextModePolicy("branch");
    const selectedTextBranch = resolveTreeContextModePolicy("branch", { hasSourceText: true });

    expect(generalBranch).toEqual({
      mode: "branch",
      hasSourceText: false,
      maxRecentFullNodes: 2,
      sideBranchLookbackDepth: 2,
      maxSideBranches: 3,
      includeProjectNotes: true,
      budgets: {
        recentTurnsChars: 4200,
        foldedAncestorsChars: 1400,
        sideBranchesChars: 900,
        projectNotesChars: 900,
        userMemoryChars: 800,
      },
      modeGuidance: expect.stringContaining("Branch Right"),
    });

    expect(selectedTextBranch).toEqual({
      mode: "branch",
      hasSourceText: true,
      maxRecentFullNodes: 1,
      sideBranchLookbackDepth: 1,
      maxSideBranches: 2,
      includeProjectNotes: false,
      budgets: {
        recentTurnsChars: 2800,
        foldedAncestorsChars: 900,
        sideBranchesChars: 700,
        projectNotesChars: 0,
        userMemoryChars: 800,
      },
      modeGuidance: expect.stringContaining("selected source text"),
    });

    // Selected-text inline deep dive anchors more tightly on the immediate parent than general branch or continue.
    const continuePolicy = resolveTreeContextModePolicy("continue");
    expect(continuePolicy.maxRecentFullNodes).toBeGreaterThan(generalBranch.maxRecentFullNodes);
    expect(generalBranch.maxRecentFullNodes).toBeGreaterThan(selectedTextBranch.maxRecentFullNodes);
    expect(continuePolicy.budgets.recentTurnsChars).toBeGreaterThan(
      generalBranch.budgets.recentTurnsChars,
    );
    expect(generalBranch.budgets.recentTurnsChars).toBeGreaterThan(
      selectedTextBranch.budgets.recentTurnsChars,
    );
  });

  it("returns entry-point policy for `root` mode with zero ancestor/side-branch lookback", () => {
    const rootPolicy = resolveTreeContextModePolicy("root");

    expect(rootPolicy).toEqual({
      mode: "root",
      hasSourceText: false,
      maxRecentFullNodes: 1,
      sideBranchLookbackDepth: 0,
      maxSideBranches: 0,
      includeProjectNotes: true,
      budgets: {
        recentTurnsChars: 3000,
        foldedAncestorsChars: 0,
        sideBranchesChars: 0,
        projectNotesChars: 1500,
        userMemoryChars: 1000,
      },
      modeGuidance: expect.stringContaining("Root"),
    });

    // Returns fresh budget objects per call so callers cannot mutate shared policy state.
    const secondRootPolicy = resolveTreeContextModePolicy("root");
    expect(secondRootPolicy.budgets).not.toBe(rootPolicy.budgets);
  });
});
