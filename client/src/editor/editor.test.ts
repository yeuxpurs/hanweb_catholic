import { describe, expect, it } from "vitest";
import { getSchema, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { closeHistory, history, undo } from "@tiptap/pm/history";
import { DocumentFormatting, DocumentImage, PageBreak } from "./DocumentExtensions";
import { findMatches } from "./search";
import { selectionAttribute, markSelectionState } from "./EditingTools";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { CellSelection, TableMap, mergeCells, splitCell, addRowAfter, deleteColumn } from "@tiptap/pm/tables";

const schema = getSchema([StarterKit, TextStyle, Table, TableRow, TableCell, TableHeader, DocumentFormatting, DocumentImage, PageBreak]);
const options = { query: "", caseSensitive: false, wholeWord: false };
const p = (text: string) => schema.node("paragraph", {}, text ? schema.text(text) : undefined);
const doc = (...nodes: ProseMirrorNode[]) => schema.node("doc", {}, nodes);

describe("literal search and safe replacement", () => {
  it("finds Korean/English/Japanese text across formatting boundaries", () => {
    const paragraph = schema.node("paragraph", {}, [schema.text("한글 기술 "), schema.text("Re", [schema.mark("bold")]), schema.text("port 日本語 ± ° μ Ø ㎜")]);
    const document = doc(paragraph);
    const [match] = findMatches(document, { ...options, query: "report" });
    expect(document.textBetween(match.from, match.to)).toBe("Report");
    expect(findMatches(document, { ...options, query: "㎜" })).toHaveLength(1);
    expect(findMatches(document, { ...options, query: "日本語" })).toHaveLength(1);
  });
  it("treats regular expression punctuation literally", () => {
    const document = doc(p("[a+b].* [a+b].*"));
    expect(findMatches(document, { ...options, query: "[a+b].*" })).toHaveLength(2);
  });
  it("respects Unicode whole-word boundaries and case", () => {
    const document = doc(p("보고서 보고서별 report Report REPORT reporting"));
    expect(findMatches(document, { ...options, query: "보고서", wholeWord: true })).toHaveLength(1);
    expect(findMatches(document, { ...options, query: "report", wholeWord: true })).toHaveLength(3);
    expect(findMatches(document, { ...options, query: "Report", caseSensitive: true })).toHaveLength(1);
  });
  it("does not merge paragraphs or separate table cells into a match", () => {
    const table = schema.node("table", {}, schema.node("tableRow", {}, [schema.node("tableCell", {}, p("앞")), schema.node("tableCell", {}, p("뒤"))]));
    expect(findMatches(doc(p("앞"), p("뒤"), table), { ...options, query: "앞뒤" })).toHaveLength(0);
  });
  it("replaces all occurrences in one undoable transaction without corrupting adjacent text", () => {
    const document = doc(p("한글 한글 日本語"), p("한글"));
    let state = EditorState.create({ schema, doc: document, plugins: [history()] });
    state = state.apply(state.tr.insertText("편집 ", 1));
    const beforeReplace = state.doc;
    const transaction = closeHistory(state.tr);
    const matches = findMatches(beforeReplace, { ...options, query: "한글" });
    [...matches].reverse().forEach(match => transaction.insertText("기술 보고서", match.from, match.to));
    state = state.apply(transaction);
    state = state.apply(closeHistory(state.tr));
    expect(state.doc.textContent).toBe("편집 기술 보고서 기술 보고서 日本語기술 보고서");
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.eq(beforeReplace)).toBe(true);
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.eq(document)).toBe(true);
  });
});

describe("document state and selection formatting", () => {
  it("round trips paragraph, image, page break, table and merged-cell properties in schema JSON", () => {
    const paragraph = schema.node("heading", { level: 2, lineHeight: "1.8", spaceBefore: "12pt", spaceAfter: "6pt", textIndent: "-10pt", marginLeft: "20pt", keepWithNext: true }, schema.text("보고서", [schema.mark("textStyle", { fontSize: "14pt" })]));
    const image = schema.node("image", { src: "data:image/png;base64,AA==", width: 200, height: 100, alt: "장비 사진", caption: "그림 1", alignment: "center" });
    const table = schema.node("table", { alignment: "center", width: "80%" }, [schema.node("tableRow", {}, schema.node("tableCell", { colspan: 2, rowspan: 2, colwidth: [80, 120], backgroundColor: "#ffff00", padding: "4pt", verticalAlign: "middle", borderWidth: "2pt" }, p("병합"))), schema.node("tableRow")]);
    const document = doc(paragraph, schema.node("pageBreak"), image, table);
    const restored = schema.nodeFromJSON(document.toJSON());
    expect(restored.eq(document)).toBe(true);
    expect(restored.child(0).attrs.keepWithNext).toBe(true);
    expect(restored.child(2).attrs.caption).toBe("그림 1");
    expect(restored.child(3).child(0).child(0).attrs.colspan).toBe(2);
    expect(TableMap.get(restored.child(3)).problems).toBe(null);
  });
  it("marks mixed font sizes and bold rather than selecting the first text format", () => {
    const paragraph = schema.node("paragraph", {}, [schema.text("굵게", [schema.mark("bold"), schema.mark("textStyle", { fontSize: "14pt" })]), schema.text("본문", [schema.mark("textStyle", { fontSize: "10pt" })])]);
    const document = doc(paragraph);
    const state = EditorState.create({ schema, doc: document, selection: TextSelection.create(document, 1, 5) });
    const editor = { state } as Editor;
    expect(selectionAttribute(editor, ["textStyle"], "fontSize", "10pt")).toBe(null);
    expect(markSelectionState(editor, "bold")).toBe("mixed");
  });
  it("marks mixed paragraph spacing correctly", () => {
    const document = doc(schema.node("paragraph", { spaceAfter: "6pt" }, schema.text("앞")), schema.node("paragraph", { spaceAfter: "12pt" }, schema.text("뒤")));
    const state = EditorState.create({ schema, doc: document, selection: TextSelection.create(document, 1, document.content.size - 1) });
    expect(selectionAttribute({ state } as Editor, ["paragraph"], "spaceAfter")).toBe(null);
  });
  it("keeps a valid table structure through merge, split and row/column changes", () => {
    const cell = (text: string) => schema.node("tableCell", { backgroundColor: "#ffff00", padding: "4pt" }, p(text));
    const table = schema.node("table", {}, [schema.node("tableRow", {}, [cell("A"), cell("B")]), schema.node("tableRow", {}, [cell("C"), cell("D")])]);
    const document = doc(table);
    const map = TableMap.get(table);
    let state = EditorState.create({ schema, doc: document, selection: CellSelection.create(document, 1 + map.map[0], 1 + map.map[3]), plugins: [history()] });
    for (const command of [mergeCells, splitCell, addRowAfter, deleteColumn]) {
      expect(command(state, tr => { state = state.apply(tr); }), command.name).toBe(true);
      expect(TableMap.get(state.doc.child(0)).problems).toBe(null);
      expect(schema.nodeFromJSON(state.doc.toJSON()).eq(state.doc)).toBe(true);
      state = state.apply(state.tr.setSelection(CellSelection.create(state.doc, 1 + TableMap.get(state.doc.child(0)).map[0])));
    }
  });
});
