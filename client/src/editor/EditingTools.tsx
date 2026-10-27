import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { Mark, Node as ProseMirrorNode } from "@tiptap/pm/model";
import { toast } from "sonner";
import { koreanDateLabel, normalizeLinkUrl, SPECIAL_CHARACTERS } from "./editingHelpers";

const paragraphKeys = ["lineHeight", "spaceBefore", "spaceAfter", "textIndent", "marginLeft", "marginRight", "textAlign", "keepWithNext", "widowControl"];
function colorHex(value: unknown, fallback: string): string {
  const color = String(value || "");
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  if (/^#[0-9a-f]{3}$/i.test(color)) return `#${color.slice(1).split("").map(char => char + char).join("")}`;
  const rgb = color.match(/^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/);
  return rgb ? `#${rgb.slice(1, 4).map(channel => Math.min(255, Number(channel)).toString(16).padStart(2, "0")).join("")}` : fallback;
}

/** undefined = no applicable nodes, null = genuinely mixed selection. */
export function selectionAttribute(editor: Editor, types: string[], attribute: string, fallback: unknown = ""): unknown {
  const { from, to, empty, $from } = editor.state.selection;
  if (empty) {
    if (types.includes("textStyle")) return editor.getAttributes("textStyle")[attribute] ?? fallback;
    for (let depth = $from.depth; depth >= 0; depth--) {
      const node = $from.node(depth);
      if (types.includes(node.type.name)) return node.attrs[attribute] ?? fallback;
    }
    return undefined;
  }
  const values: unknown[] = [];
  editor.state.doc.nodesBetween(from, to, node => {
    if (types.includes("textStyle") && node.isText) values.push(node.marks.find(mark => mark.type.name === "textStyle")?.attrs[attribute] ?? fallback);
    else if (types.includes(node.type.name)) values.push(node.attrs[attribute] ?? fallback);
  });
  if (!values.length) return undefined;
  return values.every(value => value === values[0]) ? values[0] : null;
}

export function markSelectionState(editor: Editor, name: string): "on" | "off" | "mixed" {
  if (editor.state.selection.empty) return editor.isActive(name) ? "on" : "off";
  let marked = false;
  let unmarked = false;
  editor.state.doc.nodesBetween(editor.state.selection.from, editor.state.selection.to, node => {
    if (!node.isText) return;
    if (node.marks.some(mark => mark.type.name === name)) marked = true; else unmarked = true;
  });
  return marked && unmarked ? "mixed" : marked ? "on" : "off";
}

function NumberSetting({ label, value, suffix = "pt", min = -100, max = 300, onCommit }: { label: string; value: unknown; suffix?: string; min?: number; max?: number; onCommit: (value: string) => void }) {
  const raw = String(value ?? "");
  const measurement = raw.match(/^(-?\d+(?:\.\d+)?)(pt|px|mm|cm|in|%)?$/);
  let displayed = raw;
  if (measurement) {
    let number = Number(measurement[1]);
    if (suffix === "pt") number *= ({ px: 0.75, mm: 72 / 25.4, cm: 72 / 2.54, in: 72, pt: 1 } as Record<string, number>)[measurement[2]] || 1;
    if (suffix === "" && measurement[2] === "%") number /= 100;
    displayed = String(Math.round(number * 100) / 100);
  }
  if (value === null) displayed = "";
  const [draft, setDraft] = useState(displayed);
  useEffect(() => { setDraft(displayed); }, [displayed]);
  return <label className="hanweb-number-setting">{label}<input type="text" inputMode="decimal" value={draft} placeholder={value === null ? "혼합" : "기본"} aria-label={`${label} ${suffix}`} onChange={event => setDraft(event.target.value)} onBlur={() => {
    if (draft === displayed) return;
    if (!draft.trim()) { onCommit(""); return; }
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) { toast.error(`${label}: ${min}~${max} 범위를 입력하세요.`); setDraft(displayed); return; }
    onCommit(`${parsed}${suffix}`);
  }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />{suffix}</label>;
}

export function EditingTools({ editor }: { editor: Editor }) {
  const [, rerender] = useState(0);
  const [copied, setCopied] = useState<{ marks: readonly Mark[]; paragraph: Record<string, unknown> } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [insertPanel, setInsertPanel] = useState<"link" | "symbol" | null>(null);
  const [linkAddress, setLinkAddress] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkError, setLinkError] = useState("");
  const insertionDialog = useRef<HTMLDialogElement>(null);
  const insertionTarget = useRef<{ from: number; to: number; doc: ProseMirrorNode; existingLink: boolean } | null>(null);
  useEffect(() => {
    const dialog = insertionDialog.current;
    if (!dialog) return;
    if (insertPanel && !dialog.open) dialog.showModal();
    if (!insertPanel && dialog.open) dialog.close();
  }, [insertPanel]);
  const openInsertion = (panel: "link" | "symbol") => {
    if (!editor.isEditable || editor.view.composing) return;
    const { from, to } = editor.state.selection;
    insertionTarget.current = { from, to, doc: editor.state.doc, existingLink: editor.isActive("link") };
    setLinkAddress(editor.getAttributes("link").href || "");
    setLinkLabel("");
    setLinkError("");
    setInsertPanel(panel);
  };
  const targetIsCurrent = () => {
    const target = insertionTarget.current;
    if (!target || editor.isDestroyed || !editor.isEditable || editor.view.composing || editor.state.doc !== target.doc) {
      toast.info("문서가 변경되었습니다. 삽입할 위치를 다시 선택하세요.");
      setInsertPanel(null);
      return false;
    }
    return true;
  };
  const closeInsertion = () => {
    setInsertPanel(null);
    requestAnimationFrame(() => { if (!editor.isDestroyed) editor.commands.focus(); });
  };
  useEffect(() => {
    const update = () => rerender(value => value + 1);
    editor.on("selectionUpdate", update);
    editor.on("update", update);
    return () => { editor.off("selectionUpdate", update); editor.off("update", update); };
  }, [editor]);
  const paragraphValue = (key: string, fallback?: unknown) => selectionAttribute(editor, ["paragraph", "heading"], key, fallback);
  const paragraphAttrs = editor.isActive("heading") ? editor.getAttributes("heading") : editor.getAttributes("paragraph");
  const applyParagraph = (attrs: Record<string, unknown>) => {
    if (editor.view.composing) return;
    editor.chain().updateAttributes("paragraph", attrs).updateAttributes("heading", attrs).run();
  };
  const setCell = (key: string, value: unknown) => {
    if (!editor.view.composing) editor.commands.setCellAttribute(key, value);
  };
  const headingLevel = selectionAttribute(editor, ["heading", "paragraph"], "level", 0);
  const style = headingLevel === null ? "mixed" : headingLevel ? `h${headingLevel}` : "body";
  const image = editor.getAttributes("image");
  const selectedTable = editor.getAttributes("table");
  const selectedCell = Object.fromEntries(["verticalAlign", "backgroundColor", "padding", "minHeight", "borderStyle", "borderWidth", "borderColor"].map(key => [key, selectionAttribute(editor, ["tableCell", "tableHeader"], key, key === "verticalAlign" ? "top" : "")]));
  const applyImage = (attrs: Record<string, unknown>) => { if (!editor.view.composing) editor.commands.updateAttributes("image", attrs); };
  return <div className="hanweb-editing-tools no-print">
    <div role="toolbar" aria-label="문서 서식 및 문단 도구" className="hanweb-tools-row">
      <label>스타일 <select value={style} aria-label="문단 스타일" onChange={event => {
        const value = event.target.value;
        if (value === "body") editor.chain().focus().setParagraph().run();
        else editor.chain().focus().setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run();
      }}><option value="mixed" disabled>혼합</option><option value="body">본문</option><option value="h1">제목 1</option><option value="h2">제목 2</option><option value="h3">제목 3 · 부제목</option><option value="h4">제목 4</option><option value="h5">제목 5</option><option value="h6">제목 6</option></select></label>
      <button onClick={() => {
        const marks = editor.state.storedMarks || editor.state.selection.$from.marks();
        setCopied({ marks, paragraph: Object.fromEntries(paragraphKeys.map(key => [key, paragraphAttrs[key]])) });
        toast.success("커서 위치의 서식을 복사했습니다. 적용할 내용을 선택하세요.");
      }} title="커서 위치의 글자·문단 서식을 복사">서식 복사</button>
      <button disabled={!copied} title={!copied ? "먼저 서식을 복사하세요" : "선택 영역에 복사한 서식 적용"} onClick={() => {
        if (!copied || editor.view.composing) return;
        let chain = editor.chain().focus().unsetAllMarks();
        copied.marks.forEach(mark => { chain = chain.setMark(mark.type.name, mark.attrs); });
        chain.updateAttributes("paragraph", copied.paragraph).updateAttributes("heading", copied.paragraph).run();
      }}>서식 적용</button>
      <button onClick={() => {
        const reset = Object.fromEntries(paragraphKeys.map(key => [key, key === "widowControl" ? true : key === "keepWithNext" ? false : null]));
        editor.chain().focus().unsetAllMarks().clearNodes().updateAttributes("paragraph", reset).run();
      }} title="선택한 글자와 문단의 직접 서식 지우기">서식 지우기</button>
      <button onClick={async () => {
        try {
          if (!navigator.clipboard?.readText) throw new Error("clipboard");
          const sourceDocument = editor.state.doc;
          const text = await navigator.clipboard.readText();
          if (editor.isDestroyed || !editor.isEditable || editor.view.composing) return;
          if (editor.state.doc !== sourceDocument) { toast.info("문서가 변경되어 붙여넣기를 중단했습니다. 다시 시도하세요."); return; }
          const paragraphs = text.replace(/\r\n?/g, "\n").split("\n").map(line => ({ type: "paragraph", content: line ? [{ type: "text", text: line }] : [] }));
          editor.chain().focus().insertContent(paragraphs).run();
        } catch { toast.info("클립보드 읽기가 허용되지 않았습니다. 본문에서 Ctrl+Shift+V로 서식 없이 붙여넣으세요."); }
      }} title="서식 없이 붙여넣기 (Ctrl+Shift+V)">텍스트 붙여넣기</button>
      <button onClick={() => openInsertion("link")} aria-haspopup="dialog" title="선택한 텍스트에 웹·이메일·전화 링크 추가 또는 수정">링크</button>
      <button disabled={!editor.isActive("link")} onClick={() => { if (editor.isEditable && !editor.view.composing) editor.chain().focus().extendMarkRange("link").unsetLink().run(); }}>링크 해제</button>
      <button onClick={() => openInsertion("symbol")} aria-haspopup="dialog">특수문자</button>
      <button onClick={() => { if (editor.isEditable && !editor.view.composing) editor.chain().focus().insertContent({ type: "text", text: koreanDateLabel() }).run(); }} title="서울 시간 기준 오늘 날짜를 일반 텍스트로 삽입">오늘 날짜</button>
      <button onClick={() => editor.chain().focus().insertContent({ type: "pageBreak" }).run()} title="명시적 페이지 나누기 (Ctrl+Enter)">쪽 나누기</button>
      <button onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>{expanded ? "문단 상세 닫기" : "문단 상세"}</button>
      <span className="hanweb-tools-hint">목록 수준: Tab / Shift+Tab · 셀 이동: Tab</span>
    </div>
    {expanded && <div className="hanweb-tools-row" role="group" aria-label="문단 간격과 들여쓰기">
      <NumberSetting label="줄 간격" value={paragraphValue("lineHeight")} suffix="" min={0.8} max={5} onCommit={value => applyParagraph({ lineHeight: value || null })} />
      <NumberSetting label="문단 앞" value={paragraphValue("spaceBefore")} min={0} onCommit={value => applyParagraph({ spaceBefore: value || null })} />
      <NumberSetting label="문단 뒤" value={paragraphValue("spaceAfter")} min={0} onCommit={value => applyParagraph({ spaceAfter: value || null })} />
      <NumberSetting label="첫 줄" value={paragraphValue("textIndent")} onCommit={value => applyParagraph({ textIndent: value || null })} />
      <NumberSetting label="왼쪽" value={paragraphValue("marginLeft")} min={0} onCommit={value => applyParagraph({ marginLeft: value || null })} />
      <NumberSetting label="오른쪽" value={paragraphValue("marginRight")} min={0} onCommit={value => applyParagraph({ marginRight: value || null })} />
      <label><input type="checkbox" checked={paragraphValue("keepWithNext", false) === true} onChange={event => applyParagraph({ keepWithNext: event.target.checked })} />다음 문단과 함께</label>
      <label><input type="checkbox" checked={paragraphValue("widowControl", true) === true} onChange={event => applyParagraph({ widowControl: event.target.checked })} />외톨이 줄 방지</label>
    </div>}
    {editor.isActive("table") && <div className="hanweb-tools-row" role="group" aria-label="표와 셀 속성">
      <strong>표·셀 속성</strong>
      <NumberSetting label="표 너비" value={selectedTable.width} suffix="%" min={10} max={100} onCommit={value => editor.commands.updateAttributes("table", { width: value || null })} />
      <label>표 정렬 <select aria-label="표 정렬" value={selectedTable.alignment || "left"} onChange={event => editor.commands.updateAttributes("table", { alignment: event.target.value })}><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option></select></label>
      <label>셀 세로 <select aria-label="셀 세로 정렬" value={selectedCell.verticalAlign === null ? "mixed" : String(selectedCell.verticalAlign || "top")} onChange={event => setCell("verticalAlign", event.target.value)}><option value="mixed" disabled>혼합</option><option value="top">위</option><option value="middle">가운데</option><option value="bottom">아래</option></select></label>
      <label>셀 배경{selectedCell.backgroundColor === null ? " (혼합)" : ""} <input type="color" aria-label="셀 배경색" value={colorHex(selectedCell.backgroundColor, "#ffffff")} onChange={event => setCell("backgroundColor", event.target.value)} /></label>
      <NumberSetting label="셀 여백" value={selectedCell.padding} min={0} max={72} onCommit={value => setCell("padding", value || null)} />
      <NumberSetting label="행 최소 높이" value={selectedCell.minHeight} min={0} max={300} onCommit={value => setCell("minHeight", value || null)} />
      <label>테두리 <select aria-label="셀 테두리 종류" value={selectedCell.borderStyle === null ? "mixed" : String(selectedCell.borderStyle || "solid")} onChange={event => setCell("borderStyle", event.target.value)}><option value="mixed" disabled>혼합</option><option value="solid">실선</option><option value="dashed">파선</option><option value="dotted">점선</option><option value="double">이중선</option><option value="none">없음</option></select></label>
      <NumberSetting label="선 두께" value={selectedCell.borderWidth} min={0} max={10} onCommit={value => setCell("borderWidth", value || null)} />
      <input type="color" aria-label="셀 테두리 색" title={selectedCell.borderColor === null ? "여러 색이 섞여 있습니다" : "셀 테두리 색"} value={colorHex(selectedCell.borderColor, "#666666")} onChange={event => setCell("borderColor", event.target.value)} />
      <button title="첫 행을 제목 행으로 전환; 인쇄 시 제목 행 반복" onClick={() => editor.chain().focus().toggleHeaderRow().run()}>제목 행 전환</button>
    </div>}
    {editor.isActive("image") && <div className="hanweb-tools-row" role="group" aria-label="그림 속성">
      <strong>그림 속성</strong>
      <NumberSetting label="너비" value={image.width} suffix="px" min={32} max={2000} onCommit={value => {
        const width = Number.parseFloat(value);
        if (width && image.width && image.height) applyImage({ width, height: Math.round(width * image.height / image.width) });
      }} />
      <NumberSetting label="높이" value={image.height} suffix="px" min={32} max={2000} onCommit={value => {
        const height = Number.parseFloat(value);
        if (height && image.width && image.height) applyImage({ height, width: Math.round(height * image.width / image.height) });
      }} />
      <label>정렬 <select aria-label="그림 정렬" value={image.alignment || "left"} onChange={event => applyImage({ alignment: event.target.value })}><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option></select></label>
      <label>대체 텍스트 <input aria-label="그림 대체 텍스트" value={image.alt || ""} onChange={event => applyImage({ alt: event.target.value })} /></label>
      <label>캡션 <input aria-label="그림 캡션" value={image.caption || ""} onChange={event => applyImage({ caption: event.target.value })} /></label>
      <button onClick={() => editor.chain().focus().deleteSelection().run()}>그림 삭제</button>
      <span className="hanweb-tools-hint">모서리 핸들을 드래그하면 비율을 유지합니다.</span>
    </div>}
    <dialog ref={insertionDialog} className="hanweb-insert-dialog no-print" aria-labelledby="insertion-title" onClose={() => setInsertPanel(null)} onCancel={event => {
      if ((event.nativeEvent as KeyboardEvent).isComposing) event.preventDefault();
    }}>
      <div className="hanweb-insert-heading"><h2 id="insertion-title">{insertPanel === "link" ? "링크 삽입·수정" : "특수문자 삽입"}</h2><button type="button" onClick={closeInsertion} aria-label="삽입 창 닫기">닫기</button></div>
      {insertPanel === "link" && <form onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} onSubmit={event => {
        event.preventDefault();
        const href = normalizeLinkUrl(linkAddress);
        if (!href) { setLinkError("https://, http://, mailto: 또는 tel:로 시작하는 올바른 주소를 입력하세요."); return; }
        if (!targetIsCurrent()) return;
        const target = insertionTarget.current!;
        const chain = editor.chain().focus().setTextSelection({ from: target.from, to: target.to });
        const applied = target.from === target.to && !target.existingLink
          ? chain.insertContent({ type: "text", text: linkLabel.trim() || href, marks: [{ type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer" } }] }).run()
          : chain.extendMarkRange("link").setLink({ href }).run();
        if (applied) closeInsertion();
        else setLinkError("이 위치에는 링크를 넣을 수 없습니다. 본문을 선택한 뒤 다시 시도하세요.");
      }}>
        <label>주소<input autoFocus type="text" inputMode="url" value={linkAddress} onChange={event => { setLinkAddress(event.target.value); setLinkError(""); }} placeholder="https://example.org" aria-describedby="link-help link-error" /></label>
        {insertionTarget.current?.from === insertionTarget.current?.to && !insertionTarget.current?.existingLink && <label>표시할 텍스트<input value={linkLabel} onChange={event => setLinkLabel(event.target.value)} placeholder="비워 두면 주소 표시" /></label>}
        <p id="link-help">본문을 선택한 경우 글자는 그대로 두고 연결 주소만 바꿉니다.</p>
        <p id="link-error" role="alert">{linkError}</p>
        <div className="hanweb-insert-actions"><button type="button" onClick={closeInsertion}>취소</button><button type="submit">링크 적용</button></div>
      </form>}
      {insertPanel === "symbol" && <><p>문자를 선택하면 커서 위치에 넣습니다.</p><div className="hanweb-symbol-grid">{SPECIAL_CHARACTERS.map(character => <button type="button" key={character} aria-label={`${character} 삽입`} onClick={() => {
        if (!targetIsCurrent()) return;
        const target = insertionTarget.current!;
        editor.chain().focus().setTextSelection({ from: target.from, to: target.to }).insertContent({ type: "text", text: character }).run();
        closeInsertion();
      }}>{character}</button>)}</div></>}
    </dialog>
  </div>;
}
