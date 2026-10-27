import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { findMatches, searchKey } from "./search";
import { toast } from "sonner";
import { closeHistory } from "@tiptap/pm/history";

export function FindReplace({ editor, open, onClose }: { editor: Editor; open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [active, setActive] = useState(-1);
  const [revision, setRevision] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const matches = findMatches(editor.state.doc, { query, caseSensitive, wholeWord });
  useEffect(() => {
    const update = () => setRevision(value => value + 1);
    editor.on("update", update);
    return () => { editor.off("update", update); };
  }, [editor]);
  useEffect(() => {
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(searchKey, { query: open ? query : "", caseSensitive, wholeWord, active }));
  }, [editor, query, caseSensitive, wholeWord, active, open, revision]);
  useEffect(() => { setActive(-1); }, [query, caseSensitive, wholeWord]);
  useEffect(() => {
    if (open) requestAnimationFrame(() => input.current?.focus());
  }, [open]);
  if (!open) return null;
  const next = (direction: number) => {
    if (!matches.length) return;
    let index = active;
    if (index < 0) {
      index = matches.findIndex(match => match.from >= editor.state.selection.from);
      if (index < 0) index = 0;
      if (direction < 0) index = (index + matches.length - 1) % matches.length;
    } else index = (index + direction + matches.length) % matches.length;
    setActive(index);
    editor.chain().setTextSelection(matches[index]).scrollIntoView().run();
  };
  const replace = () => {
    if (editor.view.composing) return;
    const current = matches.findIndex(match => match.from === editor.state.selection.from && match.to === editor.state.selection.to);
    if (current < 0) { next(1); return; }
    const match = matches[current];
    editor.view.dispatch(closeHistory(editor.state.tr).insertText(replacement, match.from, match.to));
    editor.view.dispatch(closeHistory(editor.state.tr));
    setActive(-1);
  };
  const replaceAll = () => {
    if (editor.view.composing || !matches.length) return;
    const transaction = closeHistory(editor.state.tr);
    for (const match of [...matches].reverse()) transaction.insertText(replacement, match.from, match.to);
    editor.view.dispatch(transaction.scrollIntoView());
    editor.view.dispatch(closeHistory(editor.state.tr));
    setActive(-1);
    toast.success(`${matches.length}곳을 바꿨습니다. Ctrl+Z로 되돌릴 수 있습니다.`);
  };
  return <section className="hanweb-find-panel no-print" role="search" aria-label="문서 찾기 및 바꾸기" onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") { onClose(); editor.commands.focus(); }
    if (event.key === "Enter") { event.preventDefault(); next(event.shiftKey ? -1 : 1); }
  }}>
    <label>찾기 <input ref={input} value={query} onChange={event => setQuery(event.target.value)} aria-label="찾을 내용" placeholder="찾을 내용" /></label>
    <span aria-live="polite">{matches.length ? `${active >= 0 && active < matches.length ? active + 1 : "–"} / ${matches.length}곳` : query ? "결과 없음" : "검색어 입력"}</span>
    <button onClick={() => next(-1)} disabled={!matches.length} title="이전 결과 (Shift+Enter)">이전</button>
    <button onClick={() => next(1)} disabled={!matches.length} title="다음 결과 (Enter)">다음</button>
    <label>바꾸기 <input value={replacement} onChange={event => setReplacement(event.target.value)} aria-label="바꿀 내용" placeholder="바꿀 내용" /></label>
    <button onClick={replace} disabled={!matches.length}>바꾸기</button>
    <button onClick={replaceAll} disabled={!matches.length}>전체 바꾸기</button>
    <label><input type="checkbox" checked={caseSensitive} onChange={event => setCaseSensitive(event.target.checked)} />대소문자 구분</label>
    <label><input type="checkbox" checked={wholeWord} onChange={event => setWholeWord(event.target.checked)} />단어 단위</label>
    <button onClick={() => { onClose(); editor.commands.focus(); }} aria-label="찾기 닫기">닫기</button>
  </section>;
}
