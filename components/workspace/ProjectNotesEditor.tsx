"use client";

import {
  type ChangeEvent,
  type FormEvent,
  forwardRef,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Extension, InputRule, wrappingInputRule, type Editor } from "@tiptap/core";
import { Blockquote } from "@tiptap/extension-blockquote";
import { CharacterCount } from "@tiptap/extension-character-count";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { Link } from "@tiptap/extension-link";
import { BlockMath } from "@tiptap/extension-mathematics";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useLanguage } from "@/components/language/LanguageProvider";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import {
  Code2,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListCollapse,
  ListOrdered,
  ListTodo,
  Minus,
  Pilcrow,
  Radical,
  Table2,
  TextQuote,
  type LucideIcon,
} from "lucide-react";

type ProjectNotesEditorProps = {
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  placeholder: string;
  ariaLabel: string;
  ariaDescribedBy?: string;
  testId: string;
};

export type ProjectNotesEditorHandle = {
  focusEnd: () => void;
  getPrintableHtml: () => string;
};

type SlashMenuRange = {
  from: number;
  to: number;
};

type SlashMenuState = {
  activeIndex: number;
  left: number;
  query: string;
  range: SlashMenuRange;
  top: number;
};

type MathFormulaDialogState =
  | {
      latex: string;
      mode: "insert";
      range: SlashMenuRange;
    }
  | {
      latex: string;
      mode: "edit";
      pos: number;
    };

type SlashCommandHelpers = {
  openMathFormulaDialog: (range: SlashMenuRange) => void;
};

type SlashCommand = {
  aliases: string[];
  hint: string;
  Icon: LucideIcon;
  id: string;
  label: string;
  shortcut: string;
  run: (editor: Editor, range: SlashMenuRange, helpers: SlashCommandHelpers) => boolean;
};

const NotionBlockquote = Blockquote.extend({
  addInputRules() {
    return [
      wrappingInputRule({
        find: /^\s*"\s$/,
        type: this.type,
      }),
    ];
  },
});

const NotionToggleInputRule = Extension.create({
  name: "notionToggleInputRule",

  addInputRules() {
    return [
      new InputRule({
        find: /^\s*>\s$/,
        handler: ({ range, chain }) => {
          chain().deleteRange(range).setDetails().run();
        },
      }),
    ];
  },
});

const SLASH_MENU_WIDTH = 320;
const SLASH_MENU_MARGIN = 12;

const slashCommands: SlashCommand[] = [
  {
    id: "text",
    label: "Text",
    hint: "Plain paragraph",
    shortcut: "text",
    aliases: ["paragraph", "plain", "body"],
    Icon: Pilcrow,
    run: (editor, range) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    id: "heading-1",
    label: "Heading 1",
    hint: "Large section title",
    shortcut: "#",
    aliases: ["h1", "title", "header 1"],
    Icon: Heading1,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    id: "heading-2",
    label: "Heading 2",
    hint: "Medium section title",
    shortcut: "##",
    aliases: ["h2", "subtitle", "header 2"],
    Icon: Heading2,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    id: "heading-3",
    label: "Heading 3",
    hint: "Small section title",
    shortcut: "###",
    aliases: ["h3", "subheading", "header 3"],
    Icon: Heading3,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    id: "bulleted-list",
    label: "Bulleted list",
    hint: "Simple unordered list",
    shortcut: "-",
    aliases: ["bullet", "ul", "unordered list"],
    Icon: List,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: "numbered-list",
    label: "Numbered list",
    hint: "Ordered list",
    shortcut: "1.",
    aliases: ["number", "ordered", "ol"],
    Icon: ListOrdered,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: "todo-list",
    label: "To-do list",
    hint: "Track tasks with checkboxes",
    shortcut: "[]",
    aliases: ["todo", "task", "checkbox", "checklist"],
    Icon: ListTodo,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: "toggle-list",
    label: "Toggle list",
    hint: "Collapsible note section",
    shortcut: ">",
    aliases: ["toggle", "fold", "details", "collapse"],
    Icon: ListCollapse,
    run: (editor, range) => editor.chain().focus().deleteRange(range).setDetails().run(),
  },
  {
    id: "quote",
    label: "Quote",
    hint: "Call out a note or citation",
    shortcut: '"',
    aliases: ["blockquote", "citation"],
    Icon: TextQuote,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: "code-block",
    label: "Code block",
    hint: "Preformatted code",
    shortcut: "```",
    aliases: ["code", "pre"],
    Icon: Code2,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    id: "math-equation",
    label: "Math formula",
    hint: "Display a LaTeX equation",
    shortcut: "$$",
    aliases: ["math", "formula", "equation", "latex"],
    Icon: Radical,
    run: (_editor, range, helpers) => {
      helpers.openMathFormulaDialog(range);
      return true;
    },
  },
  {
    id: "divider",
    label: "Divider",
    hint: "Horizontal separator",
    shortcut: "---",
    aliases: ["separator", "hr", "rule"],
    Icon: Minus,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    id: "table",
    label: "Table",
    hint: "Insert a 3 x 3 table",
    shortcut: "3x3",
    aliases: ["grid", "rows", "columns"],
    Icon: Table2,
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
];

function createEditorExtensions(onBlockMathClick: (node: ProseMirrorNode, pos: number) => void) {
  return [
    StarterKit.configure({
      blockquote: false,
      link: false,
    }),
    NotionBlockquote.configure({
      HTMLAttributes: {
        class: "project-notes-editor-blockquote",
      },
    }),
    Link.configure({
      autolink: true,
      linkOnPaste: true,
      openOnClick: false,
      HTMLAttributes: {
        rel: "noopener noreferrer",
        target: "_blank",
      },
      isAllowedUri: (url, { defaultValidate }) => {
        if (url.startsWith("#") || url.startsWith("/") || url.startsWith("./")) return true;

        try {
          const parsedUrl = new URL(url, "https://branchmind.local");
          return (
            ["http:", "https:", "mailto:"].includes(parsedUrl.protocol) &&
            defaultValidate(url)
          );
        } catch {
          return false;
        }
      },
    }),
    TaskList.configure({
      HTMLAttributes: {
        class: "project-notes-editor-task-list",
      },
    }),
    TaskItem.configure({
      nested: true,
      HTMLAttributes: {
        class: "project-notes-editor-task-item",
      },
    }),
    Details.configure({
      persist: true,
      HTMLAttributes: {
        class: "project-notes-editor-details",
      },
      renderToggleButton: ({ element, isOpen, node }) => {
        const label = node.textContent.trim() || "toggle";
        element.setAttribute("aria-label", isOpen ? `Collapse ${label}` : `Expand ${label}`);
        element.textContent = isOpen ? "-" : "+";
      },
    }),
    DetailsSummary.configure({
      HTMLAttributes: {
        class: "project-notes-editor-details-summary",
      },
    }),
    DetailsContent.configure({
      HTMLAttributes: {
        class: "project-notes-editor-details-content",
      },
    }),
    NotionToggleInputRule,
    Table.configure({
      HTMLAttributes: {
        class: "project-notes-editor-table",
      },
    }),
    TableRow,
    TableHeader,
    TableCell,
    BlockMath.configure({
      katexOptions: {
        displayMode: true,
        throwOnError: false,
      },
      onClick: onBlockMathClick,
    }),
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === "heading") return "Heading";
        if (node.type.name === "detailsSummary") return "Toggle title";
        return "Project notes...";
      },
    }),
    CharacterCount,
    Markdown.configure({
      indentation: {
        style: "space",
        size: 2,
      },
      markedOptions: {
        gfm: true,
        breaks: false,
      },
    }),
  ];
}

function filterSlashCommands(query: string) {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) return slashCommands;

  return slashCommands.filter((command) => {
    const searchText = [
      command.label,
      command.hint,
      command.shortcut,
      ...command.aliases,
    ]
      .join(" ")
      .toLowerCase();

    return terms.every((term) => searchText.includes(term));
  });
}

function getSlashMenuState(editor: Editor, previousState: SlashMenuState | null) {
  const { selection } = editor.state;
  const { $from, empty, from } = selection;

  if (!editor.isFocused || !empty || !$from.parent.isTextblock) return null;
  if ($from.parent.type.name !== "paragraph") return null;

  const textBeforeCursor = $from.parent.textBetween(0, $from.parentOffset, "\n", "\0");
  const currentLine = textBeforeCursor.slice(textBeforeCursor.lastIndexOf("\n") + 1);
  const match = currentLine.match(/^\/([^/]*)$/);

  if (!match) return null;

  const query = match[1].trim().toLowerCase();
  const range = {
    from: from - currentLine.length,
    to: from,
  };
  const coords = editor.view.coordsAtPos(from);
  const left = Math.min(
    Math.max(coords.left, SLASH_MENU_MARGIN),
    Math.max(SLASH_MENU_MARGIN, window.innerWidth - SLASH_MENU_WIDTH - SLASH_MENU_MARGIN),
  );
  const estimatedMenuHeight = 320;
  const hasMoreSpaceAbove = coords.top > estimatedMenuHeight;
  const top =
    coords.bottom + estimatedMenuHeight + SLASH_MENU_MARGIN > window.innerHeight &&
    hasMoreSpaceAbove
      ? coords.top - estimatedMenuHeight - 8
      : Math.min(coords.bottom + 8, Math.max(SLASH_MENU_MARGIN, window.innerHeight - 120));
  const commandCount = filterSlashCommands(query).length;
  const activeIndex =
    previousState?.range.from === range.from && previousState.query === query
      ? Math.min(previousState.activeIndex, Math.max(commandCount - 1, 0))
      : 0;

  return {
    activeIndex,
    left,
    query,
    range,
    top,
  };
}

export const ProjectNotesEditor = forwardRef<ProjectNotesEditorHandle, ProjectNotesEditorProps>(
  function ProjectNotesEditor(
    { value, onChange, maxLength, placeholder, ariaLabel, ariaDescribedBy, testId },
    ref,
  ) {
    const { copy } = useLanguage();
    const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null);
    const [mathFormulaDialog, setMathFormulaDialog] =
      useState<MathFormulaDialogState | null>(null);
    const onChangeRef = useRef(onChange);
    const editorRef = useRef<Editor | null>(null);
    const mathFormulaInputRef = useRef<HTMLTextAreaElement | null>(null);
    const slashMenuListRef = useRef<HTMLDivElement | null>(null);
    const slashMenuRef = useRef<SlashMenuState | null>(null);
    const filteredSlashCommands = useMemo(
      () => filterSlashCommands(slashMenu?.query ?? ""),
      [slashMenu?.query],
    );
    const activeSlashCommandId =
      slashMenu && filteredSlashCommands.length > 0
        ? filteredSlashCommands[
            Math.min(slashMenu.activeIndex, filteredSlashCommands.length - 1)
          ].id
        : null;
    const mathFormulaFocusKey =
      mathFormulaDialog?.mode === "edit"
        ? `edit-${mathFormulaDialog.pos}`
        : mathFormulaDialog
          ? `insert-${mathFormulaDialog.range.from}-${mathFormulaDialog.range.to}`
          : null;

    const openMathFormulaDialog = useCallback((range: SlashMenuRange) => {
      setMathFormulaDialog({
        latex: "",
        mode: "insert",
        range,
      });
    }, []);

    const handleBlockMathClick = useCallback((node: ProseMirrorNode, pos: number) => {
      setMathFormulaDialog({
        latex: String(node.attrs.latex ?? ""),
        mode: "edit",
        pos,
      });
    }, []);

    const editorExtensions = useMemo(
      () => createEditorExtensions(handleBlockMathClick),
      [handleBlockMathClick],
    );

    const updateSlashMenu = useCallback((currentEditor: Editor) => {
      const nextState = getSlashMenuState(currentEditor, slashMenuRef.current);
      slashMenuRef.current = nextState;
      setSlashMenu(nextState);
    }, []);

    const hideSlashMenu = useCallback(() => {
      slashMenuRef.current = null;
      setSlashMenu(null);
    }, []);

    const runSlashCommand = useCallback(
      (command: SlashCommand) => {
        const currentEditor = editorRef.current;
        const currentSlashMenu = slashMenuRef.current;
        if (!currentEditor || !currentSlashMenu) return false;

        const didRun = command.run(currentEditor, currentSlashMenu.range, {
          openMathFormulaDialog,
        });
        hideSlashMenu();
        return didRun;
      },
      [hideSlashMenu, openMathFormulaDialog],
    );

    const handleEditorKeyDown = useCallback(
      (_view: EditorView, event: KeyboardEvent) => {
        const currentSlashMenu = slashMenuRef.current;
        if (!currentSlashMenu) return false;

        const items = filterSlashCommands(currentSlashMenu.query);

        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          if (items.length === 0) return true;

          const direction = event.key === "ArrowDown" ? 1 : -1;
          const activeIndex = (currentSlashMenu.activeIndex + direction + items.length) % items.length;
          const nextState = { ...currentSlashMenu, activeIndex };
          slashMenuRef.current = nextState;
          setSlashMenu(nextState);

          return true;
        }

        if (event.key === "Enter" || event.key === "Tab") {
          if (items.length === 0) return false;

          event.preventDefault();
          event.stopPropagation();
          const activeItem =
            items[Math.min(currentSlashMenu.activeIndex, items.length - 1)] ?? items[0];
          return runSlashCommand(activeItem);
        }

        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          hideSlashMenu();
          return true;
        }

        return false;
      },
      [hideSlashMenu, runSlashCommand],
    );

    const editorAttributes = useMemo(() => {
      const attributes: Record<string, string> = {
        "aria-label": ariaLabel,
        "data-placeholder": placeholder,
        "data-testid": testId,
        "data-max-length": String(maxLength),
        class: "project-notes-editor",
      };

      if (ariaDescribedBy) {
        attributes["aria-describedby"] = ariaDescribedBy;
      }

      return attributes;
    }, [ariaDescribedBy, ariaLabel, maxLength, placeholder, testId]);
    const editorProps = useMemo(
      () => ({
        attributes: editorAttributes,
        handleKeyDown: handleEditorKeyDown,
      }),
      [editorAttributes, handleEditorKeyDown],
    );

    const editor = useEditor({
      extensions: editorExtensions,
      content: value,
      contentType: "markdown",
      immediatelyRender: false,
      editorProps,
      onUpdate: ({ editor: currentEditor }) => {
        onChangeRef.current(currentEditor.getMarkdown());
        updateSlashMenu(currentEditor);
      },
      onSelectionUpdate: ({ editor: currentEditor }) => {
        updateSlashMenu(currentEditor);
      },
      onFocus: ({ editor: currentEditor }) => {
        updateSlashMenu(currentEditor);
      },
      onBlur: () => {
        hideSlashMenu();
      },
    });

    useEffect(() => {
      editorRef.current = editor;
    }, [editor]);

    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
      editor?.setOptions({
        editorProps,
      });
    }, [editor, editorProps]);

    useImperativeHandle(
      ref,
      () => ({
        focusEnd: () => {
          editor?.commands.focus("end");
        },
        getPrintableHtml: () => {
          if (!editor) return "";

          const clone = editor.view.dom.cloneNode(true) as HTMLElement;
          clone.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((input) => {
            if (input.checked) {
              input.setAttribute("checked", "");
            } else {
              input.removeAttribute("checked");
            }
          });

          return clone.innerHTML;
        },
      }),
      [editor],
    );

    useEffect(() => {
      if (!editor) return;

      const currentValue = editor.getMarkdown();
      if (currentValue === value) return;

      editor.commands.setContent(value, {
        contentType: "markdown",
        emitUpdate: false,
      });
    }, [editor, value]);

    useEffect(() => {
      if (!editor || !slashMenu) return undefined;

      const refreshMenuPosition = () => {
        updateSlashMenu(editor);
      };

      window.addEventListener("resize", refreshMenuPosition);
      window.addEventListener("scroll", refreshMenuPosition, true);

      return () => {
        window.removeEventListener("resize", refreshMenuPosition);
        window.removeEventListener("scroll", refreshMenuPosition, true);
      };
    }, [editor, slashMenu, updateSlashMenu]);

    useEffect(() => {
      if (!activeSlashCommandId) return;

      const activeElement = slashMenuListRef.current?.querySelector<HTMLElement>(
        `#project-notes-slash-menu-item-${activeSlashCommandId}`,
      );
      activeElement?.scrollIntoView({ block: "nearest" });
    }, [activeSlashCommandId]);

    useEffect(() => {
      if (!mathFormulaFocusKey) return undefined;

      const animationFrame = window.requestAnimationFrame(() => {
        mathFormulaInputRef.current?.focus();
        mathFormulaInputRef.current?.select();
      });

      return () => {
        window.cancelAnimationFrame(animationFrame);
      };
    }, [mathFormulaFocusKey]);

    const closeMathFormulaDialog = useCallback(() => {
      setMathFormulaDialog(null);
      window.requestAnimationFrame(() => {
        editorRef.current?.commands.focus();
      });
    }, []);

    const handleMathFormulaInputChange = useCallback(
      (event: ChangeEvent<HTMLTextAreaElement>) => {
        const latex = event.currentTarget.value;
        setMathFormulaDialog((currentDialog) =>
          currentDialog ? { ...currentDialog, latex } : currentDialog,
        );
      },
      [],
    );

    const handleMathFormulaInputKeyDown = useCallback(
      (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeMathFormulaDialog();
          return;
        }

        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }
      },
      [closeMathFormulaDialog],
    );

    const handleMathFormulaSubmit = useCallback(
      (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const currentEditor = editorRef.current;
        const currentDialog = mathFormulaDialog;
        if (!currentEditor || !currentDialog) return;

        const latex = currentDialog.latex.trim();
        if (!latex) {
          closeMathFormulaDialog();
          return;
        }

        const didRun =
          currentDialog.mode === "insert"
            ? currentEditor
                .chain()
                .focus()
                .insertContentAt(currentDialog.range, {
                  attrs: { latex },
                  type: "blockMath",
                })
                .run()
            : currentEditor
                .chain()
                .focus()
                .updateBlockMath({ latex, pos: currentDialog.pos })
                .run();

        if (didRun) {
          setMathFormulaDialog(null);
        }
      },
      [closeMathFormulaDialog, mathFormulaDialog],
    );

    return (
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-[20px]">
        <EditorContent editor={editor} className="min-h-0 flex-1" />
        {slashMenu && (
          <div
            role="listbox"
            aria-label="Project notes blocks"
            aria-activedescendant={
              activeSlashCommandId
                ? `project-notes-slash-menu-item-${activeSlashCommandId}`
                : undefined
            }
            className="project-notes-slash-menu"
            data-testid="project-notes-slash-menu"
            style={{ left: slashMenu.left, top: slashMenu.top }}
          >
            <div className="project-notes-slash-menu-search">Blocks</div>
            <div
              ref={slashMenuListRef}
              className="project-notes-slash-menu-list"
              data-testid="project-notes-slash-menu-list"
            >
              {filteredSlashCommands.map((command, index) => {
                const isActive = index === slashMenu.activeIndex;
                const { Icon } = command;

                return (
                  <button
                    key={command.id}
                    id={`project-notes-slash-menu-item-${command.id}`}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    className={`project-notes-slash-menu-item ${isActive ? "is-active" : ""}`}
                    data-testid={`project-notes-slash-menu-item-${command.id}`}
                    onMouseEnter={() => {
                      setSlashMenu((previousState) => {
                        if (!previousState) return previousState;

                        const nextState = { ...previousState, activeIndex: index };
                        slashMenuRef.current = nextState;
                        return nextState;
                      });
                    }}
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={() => {
                      runSlashCommand(command);
                    }}
                  >
                    <span className="project-notes-slash-menu-icon" aria-hidden="true">
                      <Icon size={17} />
                    </span>
                    <span className="project-notes-slash-menu-copy">
                      <span className="project-notes-slash-menu-label">{command.label}</span>
                      <span className="project-notes-slash-menu-hint">{command.hint}</span>
                    </span>
                    <span className="project-notes-slash-menu-shortcut">{command.shortcut}</span>
                  </button>
                );
              })}

              {filteredSlashCommands.length === 0 && (
                <p
                  className="project-notes-slash-menu-empty"
                  data-testid="project-notes-slash-menu-empty"
                >
                  No blocks found
                </p>
              )}
            </div>
          </div>
        )}
        {mathFormulaDialog && (
          <div
            role="dialog"
            aria-label={
              mathFormulaDialog.mode === "edit"
                ? copy.workspace.mathFormulaEdit
                : copy.workspace.mathFormulaInsert
            }
            className="project-notes-math-popover"
            data-testid="project-notes-math-popover"
          >
            <form className="project-notes-math-form" onSubmit={handleMathFormulaSubmit}>
              <div className="project-notes-math-header">
                <span className="project-notes-math-title">{copy.workspace.mathFormulaTitle}</span>
              </div>
              <textarea
                ref={mathFormulaInputRef}
                aria-label="LaTeX formula"
                className="project-notes-math-input"
                data-testid="project-notes-math-input"
                onChange={handleMathFormulaInputChange}
                onKeyDown={handleMathFormulaInputKeyDown}
                placeholder="E = mc^2"
                rows={3}
                spellCheck={false}
                value={mathFormulaDialog.latex}
              />
              <div className="project-notes-math-actions">
                <button
                  type="button"
                  className="project-notes-math-button project-notes-math-button-secondary"
                  data-testid="project-notes-math-cancel"
                  onClick={closeMathFormulaDialog}
                >
                  {copy.common.cancel}
                </button>
                <button
                  type="submit"
                  className="project-notes-math-button project-notes-math-button-primary"
                  data-testid="project-notes-math-submit"
                  disabled={mathFormulaDialog.latex.trim().length === 0}
                >
                  {mathFormulaDialog.mode === "edit"
                    ? copy.workspace.mathFormulaSubmitUpdate
                    : copy.workspace.mathFormulaSubmitInsert}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    );
  },
);
