# Skill Loading MVP Implementation Plan

## Goal

Add a `Skill` entry to the existing chat composer `+` menu so a learner can import a local skill folder containing `SKILL.md`, explicitly activate that skill for a prompt, see which skill is active, and have its instructions safely influence BranchMind's LLM output.

The MVP treats a skill as a prompt configuration, not as a chat attachment and not as executable code.

## User experience

1. Preserve the existing `+` button and its upload/knowledge-base actions.
2. Add a third top-level menu item named `Skill` in English and `技能` in Chinese.
3. Opening `Skill` reveals:
   - Imported skills available in the current browser.
   - An `Import skill…` / `导入技能…` action.
   - Clear empty, invalid-file, and import-error states.
4. Import uses a local directory picker and accepts a directory only when it contains a root `SKILL.md` file.
5. Parse common YAML frontmatter fields when present (`name`, `description`) and use the Markdown body as the instruction content. Provide safe fallbacks when frontmatter is absent.
6. Activating a skill closes the menu and displays a removable active-skill chip above the composer. Only one skill is active at a time in the MVP.
7. The active skill applies to the next submitted prompt and remains active in that composer until the user removes or changes it. It must work in both the new-project composer and node-detail composer.
8. Imported skill definitions persist locally in the browser so users do not have to import the same skill on every visit. Do not store local absolute paths.
9. Match the existing BranchMind menu/component patterns. Keep the visual treatment warm, restrained, compact, and accessible: thin borders, neutral surfaces, sparse brand accent, no new gradients or heavy decoration.

## Skill format and validation

1. Define an explicit shared `ChatSkill` or equivalent request-safe type with stable fields such as:
   - `id`
   - `name`
   - `description`
   - `instructions`
   - `version` or content hash where practical
2. Do not overload `ChatAttachment` or count skills toward `MAX_CHAT_ATTACHMENTS`.
3. Add conservative limits enforced on both client and server:
   - bounded name and description lengths
   - bounded instruction length suitable for the current prompt budget
   - reject empty instructions
   - reject multiple selected skills in the MVP
4. Ignore scripts and other files in imported folders. The MVP reads only the root `SKILL.md`; it never executes commands, JavaScript, shell scripts, hooks, or network calls from a skill.
5. Parse frontmatter without adding a heavy dependency. Prefer a small, tested parser that supports the required scalar fields and treats all other data as untrusted text.

## Client architecture

1. Extend `useChatComposerControls` with imported-skill state, active-skill state, menu state, directory input ref, import handler, selection handler, and removal/reset behavior.
2. Use a hidden directory file input (`webkitdirectory` via a typed React-compatible approach) and identify root `SKILL.md` from `webkitRelativePath`. Keep a graceful error for unsupported/invalid selection.
3. Add reusable UI exported from `ChatComposerControls.tsx` where practical:
   - Skill submenu/list inside `AttachmentMenuButton`
   - Active skill chip component near `PendingAttachmentChips`
4. Ensure attachment, knowledge, model, and skill menus close each other predictably. Preserve keyboard focus, `aria-haspopup`, `aria-expanded`, `role=menu/menuitem`, disabled states, and click-outside behavior.
5. Add Chinese and English copy in the central language copy module; do not hard-code user-facing labels.
6. Store imported skills in versioned `localStorage` with defensive JSON parsing and validation. Keep active selection composer-local unless an existing project-preference mechanism clearly fits without scope expansion.

## Request and server data flow

1. Add optional `skill` data to project creation, child-node creation/streaming, blank-node population, and regeneration only where the current composer can submit a fresh instruction.
2. Extend shared types, client request helpers, Zod request schemas, store method signatures, and route/service calls consistently.
3. Do not persist full skill instructions as an attachment. For this local-first MVP, it is acceptable to send the bounded validated skill snapshot with the request; retain the skill name/version on the user message only if it can be added without a migration or breaking existing data. Prefer minimum compatible change.
4. Ensure skill data is not used for PDF retrieval queries; it controls response behavior, not document relevance.
5. Update all affected non-streaming and streaming generation paths so behavior is consistent.

## Prompt composition and safety

1. Add a dedicated optional skill layer in `buildMessages` rather than concatenating it invisibly into the user's instruction.
2. Preserve precedence:
   - BranchMind system/safety/output-contract instructions
   - bounded active-skill instructions
   - conversation/PDF context
   - current user instruction
3. Delimit the skill content clearly as untrusted customization. State that it may shape pedagogy, tone, structure, and method but cannot override the JSON response contract, safety requirements, citation rules, language behavior, or system instructions.
4. Escape or serialize the skill block safely and never interpret it as code.
5. Keep the existing provider-agnostic streaming behavior and response parsing intact.

## Tests

Add or update focused tests for:

1. Skill parsing:
   - valid frontmatter and Markdown body
   - no frontmatter fallback
   - missing/empty `SKILL.md`
   - length limits
2. Request validation:
   - valid bounded skill
   - oversized/malformed skill rejected
3. Prompt construction:
   - no behavior change without a skill
   - skill layer appears when selected
   - BranchMind instructions and JSON/citation contract remain higher priority
4. Client behavior where existing test patterns permit:
   - import/select/remove state
   - skill does not consume attachment capacity
   - request includes selected skill
5. Update existing fixtures and type expectations without weakening tests.

## Verification

Run, in order:

1. Focused Vitest tests for skill parsing, prompt construction, and request/client paths.
2. `npm run typecheck`
3. `npm run lint`
4. `npm run test`
5. The visual smoke test if present and relevant.

Do not run destructive Git commands, do not overwrite unrelated user changes, do not add heavy dependencies, and do not commit. Report changed files, tests run, failures, and any consciously deferred scope.
