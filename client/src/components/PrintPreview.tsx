import { useEffect, useRef, useState } from "react";
import type { PageSettings } from "@/editor/document";
import { createPrintHTML, preparePrintDocument, printDocument, type PaginationResult } from "@/editor/pagination";
import "./document-previews.css";

interface PrintPreviewProps {
  html: string;
  settings: PageSettings;
  title: string;
  onClose: () => void;
  onPageCount?: (count: number) => void;
}

export default function PrintPreview({ html, settings, title, onClose, onPageCount }: PrintPreviewProps) {
  const [result, setResult] = useState<PaginationResult | null>(null);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(0.8);
  const [page, setPage] = useState(1);
  const [printing, setPrinting] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const countCallback = useRef(onPageCount);
  countCallback.current = onPageCount;
  useEffect(() => {
    let cancelled = false;
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    preparePrintDocument(html, settings).then(value => {
      if (cancelled) return;
      setResult(value); countCallback.current?.(value.pages.length);
    }).catch(reason => { if (!cancelled) setError((reason as Error).message); });
    return () => { cancelled = true; previousFocus?.focus(); };
  }, [html, settings]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const move = (next: number) => {
    if (!result) return;
    const target = Math.max(1, Math.min(result.pages.length, next));
    setPage(target);
    frame.current?.contentDocument?.querySelector(`[data-page="${target}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const print = async () => {
    if (!result) return;
    setPrinting(true);
    try { await printDocument(result, title); }
    catch (reason) { setError((reason as Error).message); }
    finally { setPrinting(false); }
  };
  return <div className="document-preview-dialog" role="dialog" aria-modal="true" aria-label="인쇄 및 PDF 미리보기">
    <div className="document-preview-toolbar">
      <strong title={title}>{title} · 인쇄 미리보기</strong>
      <button disabled={!result || printing} onClick={print}>인쇄 / PDF로 저장</button>
      <button disabled={page <= 1} onClick={() => move(page - 1)} aria-label="이전 페이지">◀</button>
      <label>페이지 <input type="number" min="1" max={result?.pages.length || 1} value={page} onChange={event => move(Number(event.target.value))} aria-label="미리보기 페이지 번호" /></label>
      <span>/ {result?.pages.length || "…"}</span>
      <button disabled={!result || page >= result.pages.length} onClick={() => move(page + 1)} aria-label="다음 페이지">▶</button>
      <label>배율 <select value={zoom} onChange={event => setZoom(Number(event.target.value))}><option value="0.5">50%</option><option value="0.8">80%</option><option value="1">100%</option><option value="1.25">125%</option></select></label>
      <button onClick={() => { const width = frame.current?.clientWidth || 800; setZoom(Math.min(1.5, Math.max(0.25, (width - 32) / ((result?.widthMm || 210) * 96 / 25.4)))); }}>너비 맞춤</button>
      <button ref={closeButton} onClick={onClose} aria-label="인쇄 미리보기 닫기">닫기 (Esc)</button>
    </div>
    <div className="document-preview-notice">브라우저 인쇄 창에서 ‘PDF로 저장’을 선택하세요. 용지 크기 자동 적용, 여백 없음, 배율 100%, 브라우저 머리글·바닥글 끄기로 출력하세요. 미리보기와 동일한 페이지를 출력하며 글자를 선택·검색할 수 있습니다.</div>
    {error && <p role="alert" className="document-preview-error">{error}</p>}
    {result?.warnings.map(warning => <p className="document-preview-warning" key={warning}>{warning}</p>)}
    {!result && !error && <p role="status" className="document-preview-loading">글꼴과 이미지를 확인하며 페이지를 배치하고 있습니다…</p>}
    {result && <iframe ref={frame} title={`${title} 인쇄 미리보기, ${result.pages.length}쪽`} className="document-preview-frame" srcDoc={createPrintHTML(result, title, zoom)} />}
  </div>;
}
