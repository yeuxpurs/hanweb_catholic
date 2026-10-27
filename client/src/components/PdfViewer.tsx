import { useEffect, useState } from "react";
import "./document-previews.css";

interface PdfViewerProps { file: File; onClose: () => void }

/** Chrome/Edge's native viewer supplies page count, zoom, page navigation and text search. */
export default function PdfViewer({ file, onClose }: PdfViewerProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;
    setUrl(""); setError("");
    file.slice(0, 1024).arrayBuffer().then(bytes => {
      const prefix = new TextDecoder("ascii").decode(bytes);
      if (!prefix.includes("%PDF-")) throw new Error("PDF 파일 서명이 없습니다. 확장자를 바꾼 파일은 PDF로 열 수 없습니다.");
      if (!cancelled) { objectUrl = URL.createObjectURL(file); setUrl(objectUrl); }
    }).catch(reason => { if (!cancelled) setError((reason as Error).message); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="document-preview-dialog" role="dialog" aria-modal="true" aria-label="PDF 보기">
    <div className="document-preview-toolbar"><strong title={file.name}>{file.name} · PDF 보기</strong>{url && <a href={url} target="_blank" rel="noreferrer">새 탭에서 보기</a>}<button autoFocus onClick={onClose}>닫기 (Esc)</button></div>
    <div className="document-preview-notice">Chrome·Edge의 PDF 도구로 확대, 페이지 이동, 검색(Ctrl+F)을 사용할 수 있습니다. 스캔 이미지의 텍스트 검색은 지원하지 않습니다. 현재 편집 문서는 그대로 유지됩니다.</div>
    {error && <p role="alert" className="document-preview-error">{error}</p>}
    {url && navigator.pdfViewerEnabled === false && <p className="document-preview-warning">이 브라우저에는 내장 PDF 뷰어가 없습니다. ‘새 탭에서 보기’로 파일을 여세요. 검색과 페이지 이동은 사용 중인 PDF 프로그램에서 제공됩니다.</p>}
    {url && <iframe className="document-preview-frame" title={`${file.name} PDF 원본`} src={`${url}#toolbar=1&navpanes=1&view=FitH`} />}
  </div>;
}
