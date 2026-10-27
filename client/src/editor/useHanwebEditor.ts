import { useEditor, type Editor } from "@tiptap/react";
import { useState, useCallback } from "react";
import StarterKit from "@tiptap/starter-kit";
import { TextAlign } from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { FontFamily } from "@tiptap/extension-font-family";
import { Highlight } from "@tiptap/extension-highlight";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Superscript } from "@tiptap/extension-superscript";
import { Subscript } from "@tiptap/extension-subscript";
import { CharacterCount } from "@tiptap/extension-character-count";
import { Placeholder } from "@tiptap/extension-placeholder";
import { DocumentFormatting, DocumentImage, PageBreak, ImageFiles } from "./DocumentExtensions";
import { SearchHighlights } from "./search";
import "./editing-tools.css";

export interface DocMeta {
  fileName: string;
  modified: boolean;
  currentPage: number;
  pageCount: number;
  currentLine: number;
  currentColumn: number;
}

export function useHanwebEditor() {
  const [docMeta, setDocMeta] = useState<DocMeta>({
    fileName: "새 문서",
    modified: false,
    currentPage: 1,
    pageCount: 1,
    currentLine: 1,
    currentColumn: 1,
  });

  const updateCursorPosition = useCallback((e: Editor) => {
    const { from } = e.state.selection;
    const resolved = e.state.doc.resolve(from);
    let paragraph = 1;
    const blockStart = resolved.depth > 0 ? resolved.before(resolved.depth) : from;
    e.state.doc.nodesBetween(0, from, (node, pos) => {
      if (node.isTextblock && pos < blockStart) paragraph++;
    });
    const textBefore = resolved.parent.textBetween(0, resolved.parentOffset, "", "\uFFFC");
    const column = typeof Intl.Segmenter === "function"
      ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(textBefore)).length + 1
      : Array.from(textBefore).length + 1;
    setDocMeta(prev => ({ ...prev, currentLine: paragraph, currentColumn: column }));
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      Color,
      FontFamily,
      Highlight.configure({ multicolor: true }),
      Table.configure({
        resizable: true,
        allowTableNodeSelection: true,
      }),
      TableRow,
      TableCell,
      TableHeader,
      DocumentFormatting,
      SearchHighlights,
      PageBreak,
      ImageFiles,
      DocumentImage.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: {
          class: "hanweb-image",
        },
      }),
      Superscript,
      Subscript,
      CharacterCount,
      Placeholder.configure({ placeholder: "여기에 입력하세요..." }),
    ],
    content: "",
    editorProps: {
      attributes: { role: "textbox", "aria-multiline": "true", "aria-label": "문서 본문 편집", spellcheck: "false", lang: "ko" },
    },
    onUpdate: ({ editor: e }) => {
      setDocMeta((prev) => ({ ...prev, modified: true }));
      updateCursorPosition(e);
    },
    onSelectionUpdate: ({ editor: e }) => {
      updateCursorPosition(e);
    },
  }, []);

  const setFileName = useCallback((name: string) => {
    setDocMeta((prev) => ({ ...prev, fileName: name }));
  }, []);

  const setModified = useCallback((modified: boolean) => {
    setDocMeta((prev) => ({ ...prev, modified }));
  }, []);

  const setPageInfo = useCallback((currentPage: number, pageCount: number) => {
    setDocMeta((prev) => {
      const safePageCount = Math.max(1, pageCount);
      const safeCurrentPage = Math.min(Math.max(1, currentPage), safePageCount);
      if (prev.currentPage === safeCurrentPage && prev.pageCount === safePageCount) return prev;
      return { ...prev, currentPage: safeCurrentPage, pageCount: safePageCount };
    });
  }, []);

  return { editor, docMeta, setFileName, setModified, setPageInfo };
}
