/**
 * HanWeb Editor - Main page component
 * Composes: TitleBar, MenuBar, RibbonToolbar, Ruler, EditorCanvas, StatusBar
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { deleteRecovery, formatAutosaveTime } from "@/utils/autosave";
import { useDocumentSession } from '@/editor/useDocumentSession';
import { pageDimensions, type PageSettings } from '@/editor/document';
import { FindReplace } from '@/editor/FindReplace';
import { EditingTools, selectionAttribute, markSelectionState } from '@/editor/EditingTools';
import { readImageFile } from '@/editor/DocumentExtensions';
import PrintPreview from '@/components/PrintPreview';
import PdfViewer from '@/components/PdfViewer';
import FormatSupport from '@/components/FormatSupport';
import {DocumentOutline} from '@/editor/DocumentOutline';
import { DOCUMENT_TEMPLATES, createTemplateDocument } from '@/editor/templates';
import { importPlainText, importHtmlDocument, exportPlainText, exportHtmlDocument } from '@/editor/portableFormats';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from "sonner";
import { EditorContent, type JSONContent } from "@tiptap/react";
import { useHanwebEditor } from "@/editor/useHanwebEditor";
import {
  Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter,
  AlignRight, AlignJustify, Undo2, Redo2, List, ListOrdered,
  Table, ImageIcon, IndentIncrease, IndentDecrease, Highlighter,
  Palette, ZoomIn, ZoomOut, FileText, Printer, Trash2,
  BetweenHorizontalStart, BetweenHorizontalEnd,
  BetweenVerticalStart, BetweenVerticalEnd,
  Rows3, Columns3, TableCellsMerge, TableCellsSplit,
} from "lucide-react";

// ─── Constants ───────────────────────────────────────────────────────────────
const FONT_FAMILIES = [
  { label: "함초롬바탕", value: "함초롬바탕, HCR Batang, serif" },
  { label: "함초롬돋움", value: "함초롬돋움, HCR Dotum, sans-serif" },
  { label: "맑은 고딕", value: "Malgun Gothic, 맑은 고딕, sans-serif" },
  { label: "바탕", value: "Batang, 바탕, serif" },
  { label: "돋움", value: "Dotum, 돋움, sans-serif" },
  { label: "굴림", value: "Gulim, 굴림, sans-serif" },
  { label: "궁서", value: "Gungsuh, 궁서, serif" },
];
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 48, 72];
const TEXT_COLORS = [
  "#000000", "#333333", "#666666", "#999999",
  "#CC0000", "#FF0000", "#FF6600", "#FF9900",
  "#006600", "#009900", "#009999", "#0000CC",
  "#0000FF", "#6600CC", "#9900CC", "#CC0099",
];
const HIGHLIGHT_COLORS = [
  "#FFFF00", "#00FF00", "#00FFFF", "#FF00FF",
  "#FFD700", "#90EE90", "#ADD8E6", "#FFB6C1",
];
const MAX_TABLE_ROWS = 60;
const MAX_TABLE_COLS = 30;
const DEFAULT_TABLE_ROWS = 5;
const DEFAULT_TABLE_COLS = 5;
const QUICK_TABLE_SIZE = 8;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PX_PER_MM = 96 / 25.4;

type PaperSizeName = "A4" | "A3";

const PAPER_SIZES: Record<PaperSizeName, { label: string; widthMm: number; heightMm: number }> = {
  A4: { label: "A4", widthMm: 210, heightMm: 297 },
  A3: { label: "A3", widthMm: 297, heightMm: 420 },
};

// ─── Menu definitions ────────────────────────────────────────────────────────
interface MenuItem { label: string; shortcut?: string; action?: () => void; divider?: boolean; disabled?: boolean; }
interface MenuDef { label: string; items: MenuItem[]; }
type TableCommandName =
  | "addRowBefore"
  | "addRowAfter"
  | "addColumnBefore"
  | "addColumnAfter"
  | "deleteRow"
  | "deleteColumn"
  | "mergeCells"
  | "splitCell"
  | "deleteTable";

// ─── Main Component ──────────────────────────────────────────────────────────
export default function HanWebEditor() {
  const { editor, docMeta, setFileName, setModified, setPageInfo } = useHanwebEditor();
  const [zoom, setZoom] = useState(1);
  const session = useDocumentSession(editor, docMeta.fileName, setFileName, setModified, getDefaultContent());
  const paperSize = session.settings.paperSize;
  const [showOutline,setShowOutline]=useState(false);
  const [showSupport,setShowSupport]=useState(false);
  const [showTemplates,setShowTemplates]=useState(false);
  const [showStatistics,setShowStatistics]=useState(false);
  const [focusMode,setFocusMode]=useState(false);
  const [offlineReady,setOfflineReady]=useState(false);
  const [online,setOnline]=useState(navigator.onLine);
  useEffect(() => {
    let active = true;
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.ready.then(() => { if (active) setOfflineReady(true); });
    }
    return () => { active = false; window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  const [showFind, setShowFind] = useState(false);
  const [showLayout, setShowLayout] = useState(false);
  const [previewHTML, setPreviewHTML] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [printPageCount, setPrintPageCount] = useState<number | null>(null);
  const [showParagraphMarks, setShowParagraphMarks] = useState(false);
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [tableRows, setTableRows] = useState(DEFAULT_TABLE_ROWS);
  const [tableCols, setTableCols] = useState(DEFAULT_TABLE_COLS);
  const [tableGridHover, setTableGridHover] = useState({ rows: 0, cols: 0 });
  const hwpImportModeRef = useRef<'auto'|'text'>('auto');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);
  const tablePickerRef = useRef<HTMLDivElement>(null);
  const canvasScrollRef = useRef<HTMLDivElement>(null);
  const pageSurfaceRef = useRef<HTMLDivElement>(null);
  const editorContentRef = useRef<HTMLDivElement>(null);
  const paper = { ...pageDimensions(session.settings), label: paperSize };
  const pageWidth = Math.round(paper.widthMm * PX_PER_MM);
  const pageHeight = Math.round(paper.heightMm * PX_PER_MM);
  const pageMarginX = Math.round(session.settings.margins.left * PX_PER_MM);
  const pageMarginY = Math.round(session.settings.margins.top * PX_PER_MM);

  // ─── File operations ─────────────────────────────────────────────────────
  const handleNewDocument = useCallback(async () => {
    if (busy || !session.ready) return;
    if (!await session.startDocument(getDefaultContent(), '새 문서')) toast.error('현재 문서를 보존하지 못했습니다. 저장을 다시 시도하거나 HanWeb 백업을 다운로드하세요.');
    setPrintPageCount(null);
  }, [busy, session.ready, session.startDocument]);

  const handleOpenFile = useCallback(() => {
    hwpImportModeRef.current = 'auto';
    if(fileInputRef.current)fileInputRef.current.accept='.hwpx,.hwp,.docx,.pdf,.hanweb,.txt,.html,.htm';
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !editor || busy) return;
    if (file.size > 50 * 1024 * 1024) { toast.error('50MB 이하 파일을 선택하세요.'); return; }
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (editor.view.composing) {toast.info('한글 조합 입력을 완료한 뒤 파일을 여세요.'); return;}
    setBusy(true);
    const openingRevision = editor.state.doc;
    editor.setEditable(false, false);
    try {
      if (ext === 'pdf') {
        const signature = new TextDecoder().decode(await file.slice(0,5).arrayBuffer());
        if (signature !== '%PDF-') throw new Error('정상적인 PDF 파일이 아닙니다.');
        if (!await session.flush(true)) throw new Error('현재 문서를 저장하지 못했습니다.');
        setPdfFile(file);
        return;
      }
      let result: {content: string | JSONContent; pageSettings?: PageSettings; warnings?: string[]};
      if (ext === 'txt') result = importPlainText(await file.text());
      else if (ext === 'html' || ext === 'htm') result = importHtmlDocument(await file.text());
      else if (ext === 'hwpx') result = await (await import('@/hwpx/importer')).importHwpx(file);
      else if (ext === 'docx') result = await (await import('@/docx/importer')).importDocx(file);
      else if (ext === 'hwp') {
        result = await (await import('@/hwp/importer')).importLegacyHwp(file,{mode:hwpImportModeRef.current});

      } else if (ext === 'hanweb') {
        const saved = JSON.parse(await file.text());
        if (saved.schemaVersion !== 2 || typeof saved.content !== 'string') throw new Error('올바른 HanWeb 백업이 아닙니다.');
        result = {content: saved.json ?? saved.content, pageSettings: saved.pageSettings};
      } else throw new Error('지원 형식: HWPX, HWP(텍스트), DOCX, TXT, HTML, PDF(보기), HanWeb 백업. DOC는 지원하지 않습니다.');
      if (editor.state.doc !== openingRevision) throw new Error('불러오는 동안 문서가 변경되어 중단했습니다.');
      const success = await session.startDocument(result.content, ext === 'hwp' ? file.name.replace(/\.hwp$/i,'.hwpx') : file.name, result.pageSettings);
      if (!success) throw new Error('문서 저장에 실패했습니다. 내용은 편집기 또는 복구본에 남아 있습니다.');
      setPrintPageCount(null);
      toast.success(`"${file.name}" 불러오기 완료`);
      for (const warning of result.warnings ?? []) toast.warning(warning, {duration: 12000});
    } catch (error) { toast.error(`불러오기 실패: ${(error as Error).message}`, {duration: 10000}); }
    finally { editor.setEditable(true, false); setBusy(false); }
  }, [editor, busy, session.startDocument, session.flush]);

  const handleSaveFile = useCallback(async () => {
    if (!editor || busy || editor.view.composing) return;
    const captured = session.capture();
    try {
      const { exportHwpxHtml, HWPX_EXPORT_WARNING } = await import('@/hwpx/exporter');
      const blob = await exportHwpxHtml(captured.content, {paperSize:captured.pageSettings.paperSize,pageSettings:captured.pageSettings,title:captured.fileName});
      const fileName = `${captured.fileName.replace(/\.[^.]+$/, '') || '새 문서'}.hwpx`;
      const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=fileName;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
      const latest=session.capture();
      if(latest.fileName===captured.fileName && latest.content===captured.content && JSON.stringify(latest.pageSettings)===JSON.stringify(captured.pageSettings))setModified(false);
      toast.success(`"${fileName}" 다운로드를 생성했습니다.`);
      toast.warning(HWPX_EXPORT_WARNING,{duration:15000});
    }catch(error){toast.error(`HWPX 생성 실패: ${(error as Error).message}`);}
  },[editor,busy,session.capture,setModified]);

  const handleExportDocx = useCallback(async () => {
    if (!editor || busy || editor.view.composing) return;
    const captured=session.capture();
    try {
      const {exportDocxHtml,DOCX_EXPORT_WARNING}=await import('@/docx/exporter');
      const blob=await exportDocxHtml(captured.content,{paperSize:captured.pageSettings.paperSize,pageSettings:captured.pageSettings,title:captured.fileName.replace(/\.[^.]+$/,'')});
      const fileName=`${captured.fileName.replace(/\.[^.]+$/,'') || '새 문서'}.docx`;
      const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=fileName;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
      toast.success(`"${fileName}" 다운로드를 생성했습니다.`);
      toast.warning(DOCX_EXPORT_WARNING,{duration:12000});
    }catch(error){toast.error(`DOCX 생성 실패: ${(error as Error).message}`);}
  },[editor,busy,session.capture]);

  const insertTable = useCallback((rows = tableRows, cols = tableCols) => {
    if (!editor) return;
    const safeRows = clampTableSize(rows, 1, MAX_TABLE_ROWS);
    const safeCols = clampTableSize(cols, 1, MAX_TABLE_COLS);
    const inserted = editor
      .chain()
      .focus()
      .insertTable({ rows: safeRows, cols: safeCols, withHeaderRow: false })
      .run();

    setShowTablePicker(false);
    setTableGridHover({ rows: 0, cols: 0 });
    if (inserted) {
      toast.success(`${safeRows} x ${safeCols} 표를 삽입했습니다.`);
    } else {
      toast.error("표를 삽입하지 못했습니다.");
    }
  }, [editor, tableRows, tableCols]);

  const runTableCommand = useCallback((command: TableCommandName) => {
    if (!editor || !editor.isActive("table")) {
      toast.info("표 안의 셀을 먼저 선택해주세요.");
      return;
    }

    const chain = editor.chain().focus();
    let succeeded = false;
    switch (command) {
      case "addRowBefore": succeeded = chain.addRowBefore().run(); break;
      case "addRowAfter": succeeded = chain.addRowAfter().run(); break;
      case "addColumnBefore": succeeded = chain.addColumnBefore().run(); break;
      case "addColumnAfter": succeeded = chain.addColumnAfter().run(); break;
      case "deleteRow": succeeded = chain.deleteRow().run(); break;
      case "deleteColumn": succeeded = chain.deleteColumn().run(); break;
      case "mergeCells": succeeded = chain.mergeCells().run(); break;
      case "splitCell": succeeded = chain.splitCell().run(); break;
      case "deleteTable": succeeded = chain.deleteTable().run(); break;
    }

    if (!succeeded) {
      toast.info(command === "mergeCells"
        ? "합칠 셀을 두 칸 이상 드래그해 선택해주세요."
        : "현재 선택에서는 이 표 작업을 실행할 수 없습니다.");
      return;
    }

    if (command === "deleteTable") {
      toast.success("표를 삭제했습니다. 되돌리기는 Ctrl+Z를 누르세요.");
    }
  }, [editor]);

  const handlePrint = useCallback(() => {
    if (editor && !editor.view.composing) setPreviewHTML(editor.getHTML());
  }, [editor]);

  const handleImageInsert = useCallback(() => {
    if (!editor) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const bookmark = editor.state.selection.getBookmark();
      let mapped = bookmark;
      const documentId = session.capture().id;
      const map=({transaction}: {transaction: import('@tiptap/pm/state').Transaction})=>{mapped=mapped.map(transaction.mapping);};
      editor.on('transaction',map);
      try {
        const attrs=await readImageFile(file);
        if (session.capture().id !== documentId) throw new Error('그림을 읽는 동안 문서가 전환되어 삽입을 중단했습니다.');
        if(editor.isDestroyed || editor.view.composing || !editor.isEditable)throw new Error('편집할 수 있는 상태에서 그림을 다시 삽입하세요.');
        const selection=mapped.resolve(editor.state.doc);
        const inserted=editor.chain().focus().insertContentAt({from:selection.from,to:selection.to},{type:'image',attrs}).run();
        if(!inserted)throw new Error('그림을 삽입하지 못했습니다.');
        toast.success(`"${file.name}" 그림을 삽입했습니다.`);
      }catch(error){toast.error((error as Error).message);}
      finally{editor.off('transaction',map);}
    };
    input.click();
  }, [editor, session.capture]);

  // ─── Keyboard shortcuts ──────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!editor || busy || !session.ready || pdfFile || previewHTML !== null || e.isComposing || editor.view.composing || e.keyCode === 229) return;
      const target = e.target as HTMLElement;
      if ((target.closest('input, textarea, select') || target.closest('[role="dialog"]')) && e.key.toLowerCase() !== 's') return;
      if (e.altKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        setShowTablePicker(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleExportDocx();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case "s": e.preventDefault(); handleSaveFile(); break;
          case "o": e.preventDefault(); handleOpenFile(); break;
          case "n": e.preventDefault(); handleNewDocument(); break;
          case "p": e.preventDefault(); handlePrint(); break;
          case "l": e.preventDefault(); editor.chain().focus().setTextAlign("left").run(); break;
          case "e": e.preventDefault(); editor.chain().focus().setTextAlign("center").run(); break;
          case "r": e.preventDefault(); editor.chain().focus().setTextAlign("right").run(); break;
          case "j": e.preventDefault(); editor.chain().focus().setTextAlign("justify").run(); break;
          case "f": e.preventDefault(); setShowFind(true); break;
          case "h": e.preventDefault(); setShowFind(true); break;
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editor, busy, session.ready, pdfFile, previewHTML, handleOpenFile, handleSaveFile, handleNewDocument, handlePrint, handleExportDocx]);

  // ─── Close menu on outside click ────────────────────────────────────────
  useEffect(() => {
    if (openMenu === null) return;
    const handler = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenu]);

  useEffect(() => {
    if (!showTablePicker) return;
    const handler = (e: MouseEvent) => {
      if (tablePickerRef.current && !tablePickerRef.current.contains(e.target as Node)) {
        setShowTablePicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showTablePicker]);

  useEffect(() => {
    const invalidate=()=>setPrintPageCount(null);
    editor?.on('update',invalidate);
    setPrintPageCount(null);
    return ()=>{editor?.off('update',invalidate);};
  },[editor,session.settings]);
  // Page counts are computed from actual print layout, never from editor height.
  const downloadBackup = (record = session.capture()) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], {type: 'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = `${record.fileName.replace(/\.[^.]+$/, '') || '복구본'}.hanweb`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  const handleTemplate = async (id: string) => {
    if (!editor || busy || !session.ready || editor.view.composing) return;
    const template = createTemplateDocument(id);
    setBusy(true);
    try {
      if (!await session.startDocument(template.content, template.fileName, template.pageSettings)) {
        toast.error('현재 문서를 보존하지 못했습니다. 백업을 다운로드한 뒤 다시 시도하세요.');
        return;
      }
      setShowTemplates(false);
      setPrintPageCount(null);
      toast.success('서식으로 새 문서를 만들었습니다. 이전 문서는 복구본에 보관됩니다.');
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  };
  const handlePortableExport = (format: 'txt' | 'html') => {
    if (!editor || busy || editor.view.composing) return;
    const saved = session.capture();
    const blob = format === 'txt' ? exportPlainText(editor.getText({blockSeparator:'\n'})) : exportHtmlDocument(saved.content, saved.fileName, saved.pageSettings);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url;
    link.download = (saved.fileName.replace(/\.[^.]+$/, '') || '새 문서') + '.' + format;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast.success(format === 'txt' ? '텍스트를 다운로드했습니다. 글자 서식은 포함하지 않습니다.' : 'HTML 문서를 다운로드했습니다.');
  };
  // ─── Menu definitions ────────────────────────────────────────────────────
  const menus: MenuDef[] = [
    { label: "파일", items: [
      { label: "새 문서", shortcut: "Ctrl+N", action: handleNewDocument },
      { label: "서식으로 새 문서", action: () => setShowTemplates(true) },
      { label: "불러오기", shortcut: "Ctrl+O", action: handleOpenFile },
      { label: "HWP 텍스트만 가져오기 (서식 제외)", action: () => {hwpImportModeRef.current='text';if(fileInputRef.current){fileInputRef.current.accept='.hwp';fileInputRef.current.click();}} },
      { label: "저장", shortcut: "Ctrl+S", action: handleSaveFile },
      { label: "HanWeb 백업 다운로드 (전체 편집 상태)", action: () => downloadBackup() },
      { label: "최근 문서 · 복구본", action: session.openRecovery },
      { label: "워드로 변환 (.docx)", shortcut: "Ctrl+Shift+S", action: handleExportDocx },
      { label: "텍스트로 다운로드 (.txt)", action: () => handlePortableExport("txt") },
      { label: "웹 문서로 다운로드 (.html)", action: () => handlePortableExport("html") },
      { label: "", divider: true },
      { label: "인쇄 미리보기 / PDF 저장", shortcut: "Ctrl+P", action: handlePrint },
    ]},
    { label: "편집", items: [
      { label: "되돌리기", shortcut: "Ctrl+Z", action: () => editor?.chain().focus().undo().run() },
      { label: "다시 실행", shortcut: "Ctrl+Y", action: () => editor?.chain().focus().redo().run() },
      { label: "", divider: true },
      { label: "찾기 · 바꾸기", shortcut: "Ctrl+F", action: () => setShowFind(true) },
      { label: "모두 선택", shortcut: "Ctrl+A", action: () => editor?.chain().focus().selectAll().run() },
    ]},
    { label: "보기", items: [
      { label: "제목 기반 문서 탐색", action:()=>setShowOutline(!showOutline) },
      { label: focusMode ? "집중 모드 끝내기" : "집중 모드", action:()=>setFocusMode(!focusMode) },
      { label: `문단 부호 ${showParagraphMarks ? "숨기기" : "보기"}`, action: () => setShowParagraphMarks(!showParagraphMarks) },
    ]},
    { label: "입력", items: [
      { label: "표 만들기", shortcut: "Alt+T", action: () => setShowTablePicker(true) },
      { label: "그림 삽입", action: handleImageInsert },
      { label: "쪽 나누기", shortcut: "Ctrl+Enter", action: () => editor?.chain().focus().insertContent({type:"pageBreak"}).run() },
    ]},
    { label: "표", items: [
      { label: "표 만들기", shortcut: "Alt+T", action: () => setShowTablePicker(true) },
      { label: "", divider: true },
      { label: "위에 행 추가", action: () => runTableCommand("addRowBefore"), disabled: !editor?.isActive("table") },
      { label: "아래에 행 추가", action: () => runTableCommand("addRowAfter"), disabled: !editor?.isActive("table") },
      { label: "왼쪽에 열 추가", action: () => runTableCommand("addColumnBefore"), disabled: !editor?.isActive("table") },
      { label: "오른쪽에 열 추가", action: () => runTableCommand("addColumnAfter"), disabled: !editor?.isActive("table") },
      { label: "", divider: true },
      { label: "선택한 행 삭제", action: () => runTableCommand("deleteRow"), disabled: !editor?.isActive("table") },
      { label: "선택한 열 삭제", action: () => runTableCommand("deleteColumn"), disabled: !editor?.isActive("table") },
      { label: "셀 합치기", action: () => runTableCommand("mergeCells"), disabled: !editor?.can().mergeCells() },
      { label: "셀 나누기", action: () => runTableCommand("splitCell"), disabled: !editor?.can().splitCell() },
      { label: "", divider: true },
      { label: "표 전체 삭제", action: () => runTableCommand("deleteTable"), disabled: !editor?.isActive("table") },
    ]},
    { label: "레이아웃", items: [{ label: "용지 · 여백 · 머리말 · 꼬리말", action: () => setShowLayout(true) }]},
    { label: "도구", items: [
      { label: "문서 통계 · 글자 수", action:()=>setShowStatistics(true) },
      { label: "파일 지원 범위", action:()=>setShowSupport(true) },
      { label: "맞춤법 검사 (미지원)", shortcut: "F7", disabled: true },
    ]},
  ];

  if (!editor) return null;

  const selectedFont=selectionAttribute(editor,['textStyle'],'fontFamily','');
  const selectedSize=selectionAttribute(editor,['textStyle'],'fontSize','10pt');
  const fontSizeNumber=parseFloat(String(selectedSize));
  const charCount = editor.storage.characterCount?.characters() ?? 0;
  const plainText = editor.getText({blockSeparator:'\n'});
  const selectedText = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n');
  let paragraphCount = 0; let tableCount = 0; let imageCount = 0;
  editor.state.doc.descendants(node => {if(node.type.name === 'paragraph') paragraphCount++; if(node.type.name === 'table') tableCount++; if(node.type.name === 'image') imageCount++;});

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div
      className={`hanweb-app${focusMode ? " focus-mode" : ""}`}
      data-hanweb-edition="catholic-free"
      style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".hwpx,.hwp,.docx,.pdf,.hanweb,.txt,.html,.htm"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* Title Bar */}
      <div style={{ height: 40, background: "#1B6AC9", display: "flex", alignItems: "center", padding: "0 12px", gap: 8, color: "white", fontSize: 12, flexShrink: 0 }} className="app-titlebar no-print">
        <FileText style={{ width: 16, height: 16 }} />
        <span style={{ fontWeight: 600 }}>hanweb_catholic</span>
        <span style={{ opacity: 0.7 }}>—</span>
        <span className="brand-description" style={{ opacity: 0.9 }}>누구나 쓰는 문서편집기</span>
        <span style={{ opacity: 0.7, margin: "0 4px" }}>|</span>
        <input aria-label="문서명" className="document-name" value={docMeta.fileName} onChange={event => {setFileName(event.target.value); session.markDirty();}} />
        <button className="title-action" onClick={handleSaveFile} disabled={busy || !session.ready}>HWPX 저장</button>
        <button className="title-action" onClick={()=>setShowTemplates(true)}>문서 서식</button>
        <button className="title-action" onClick={session.openRecovery}>복구본</button>
        <button className="title-action" onClick={()=>setFocusMode(!focusMode)}>{focusMode ? "도구 펼치기" : "집중 모드"}</button>
        <span style={{ marginLeft: 4 }}>
          {docMeta.modified ? <span style={{ color: "#FFD700" }} title="편집중">●</span> : <span style={{ color: "#90EE90" }} title="저장됨">✓</span>}
        </span>
        <span style={{ marginLeft: "auto", padding: "1px 6px", border: "1px solid rgba(255,255,255,0.35)", borderRadius: 2, fontSize: 10, background: "rgba(255,255,255,0.12)" }}>
          무료 · 광고 없음
        </span>
      </div>

      {/* Menu Bar */}
      <div ref={menuBarRef} style={{ height: 30, background: "#F3F3F3", borderBottom: "1px solid #D4D4D4", display: "flex", alignItems: "center", padding: "0 4px", fontSize: 11, flexShrink: 0 }} className="app-menubar no-print">
        {menus.map((menu, idx) => (
          <div key={menu.label} style={{ position: "relative" }}>
            <button
              style={{ padding: "2px 8px", borderRadius: 2, background: openMenu === idx ? "rgba(27,106,201,0.12)" : "transparent", color: openMenu === idx ? "#1B6AC9" : "inherit" }}
              aria-expanded={openMenu === idx}
              onClick={() => setOpenMenu(openMenu === idx ? null : idx)}
              onMouseEnter={() => { if (openMenu !== null) setOpenMenu(idx); }}
            >
              {menu.label}
            </button>
            {openMenu === idx && (
              <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 100, marginTop: 2, background: "white", border: "1px solid #E0E0E0", boxShadow: "0 4px 12px rgba(0,0,0,0.12)", borderRadius: 3, padding: "4px 0", minWidth: 180 }}>
                {menu.items.map((item, i) =>
                  item.divider ? (
                    <div key={i} style={{ height: 1, background: "#E8E8E8", margin: "4px 8px" }} />
                  ) : (
                    <button
                      key={i}
                      style={{ width: "100%", textAlign: "left", padding: "4px 12px", fontSize: 11, display: "flex", justifyContent: "space-between", opacity: item.disabled ? 0.4 : 1, background: "transparent", border: "none" }}
                      onClick={() => { if (!item.disabled && item.action) { item.action(); setOpenMenu(null); } }}
                      onMouseEnter={(e) => { if (!item.disabled) (e.target as HTMLElement).style.background = "rgba(27,106,201,0.08)"; }}
                      onMouseLeave={(e) => { (e.target as HTMLElement).style.background = "transparent"; }}
                      title={item.disabled ? "이 버전에서는 지원하지 않습니다." : item.label}
                      disabled={item.disabled}
                    >
                      <span>{item.label}</span>
                      {item.shortcut && <span style={{ color: "#999", marginLeft: 16, fontSize: 10 }}>{item.shortcut}</span>}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Ribbon Toolbar Row 1 */}
      <div style={{ display: "flex", alignItems: "center", padding: "2px 8px", gap: 2, height: 28, background: "#F8F8F8", borderBottom: "1px solid #E8E8E8", flexShrink: 0 }} className="app-ribbon no-print">
        {/* Font family */}
        <select
          style={{ height: 20, fontSize: 11, border: "1px solid #CCC", borderRadius: 2, padding: "0 4px", width: 110, background: "white" }}
          aria-label="글꼴"
          value={selectedFont === undefined ? "unavailable" : String(selectedFont ?? "mixed")}
          disabled={selectedFont === undefined}
          title={selectedFont === undefined ? "그림 등 글자가 없는 선택에는 글꼴을 적용할 수 없습니다." : "글꼴"}
          onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
        >
          <option value="unavailable" disabled>해당 없음</option><option value="">기본 글꼴</option><option value="mixed" disabled>혼합</option>
          {typeof selectedFont === 'string' && selectedFont && !FONT_FAMILIES.some(font=>font.value===selectedFont) && <option value={selectedFont}>{selectedFont} (문서)</option>}
          {FONT_FAMILIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>

        {/* Font size */}
        <select
          style={{ height: 20, fontSize: 11, border: "1px solid #CCC", borderRadius: 2, padding: "0 4px", width: 50, marginLeft: 4, background: "white" }}
          aria-label="글자 크기"
          value={selectedSize === null ? "mixed" : Number.isFinite(fontSizeNumber) ? fontSizeNumber : "unavailable"}
          disabled={selectedSize !== null && !Number.isFinite(fontSizeNumber)}
          title={selectedSize === undefined ? "그림 등 글자가 없는 선택에는 글자 크기를 적용할 수 없습니다." : "글자 크기"}
          onChange={(e) => editor.chain().focus().setMark("textStyle", { fontSize: `${e.target.value}pt` }).run()}
        >
          <option value="unavailable" disabled>해당 없음</option><option value="mixed" disabled>혼합</option>{Number.isFinite(fontSizeNumber) && !FONT_SIZES.includes(fontSizeNumber) && <option value={fontSizeNumber}>{fontSizeNumber}</option>}{FONT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <ToolDivider />
        <ToolBtn active={markSelectionState(editor, "bold") === 'on'} mixed={markSelectionState(editor, "bold") === 'mixed'} onClick={() => editor.chain().focus().toggleBold().run()} title="굵게 (Ctrl+B)"><Bold size={14} /></ToolBtn>
        <ToolBtn active={markSelectionState(editor, "italic") === 'on'} mixed={markSelectionState(editor, "italic") === 'mixed'} onClick={() => editor.chain().focus().toggleItalic().run()} title="기울임 (Ctrl+I)"><Italic size={14} /></ToolBtn>
        <ToolBtn active={markSelectionState(editor, "underline") === 'on'} mixed={markSelectionState(editor, "underline") === 'mixed'} onClick={() => editor.chain().focus().toggleUnderline().run()} title="밑줄 (Ctrl+U)"><Underline size={14} /></ToolBtn>
        <ToolBtn active={markSelectionState(editor, "strike") === 'on'} mixed={markSelectionState(editor, "strike") === 'mixed'} onClick={() => editor.chain().focus().toggleStrike().run()} title="취소선"><Strikethrough size={14} /></ToolBtn>

        <ToolDivider />
        {/* Color picker */}
        <div style={{ position: "relative" }}>
          <ToolBtn onClick={() => setShowColorPicker(!showColorPicker)} title="글자 색"><Palette size={14} /></ToolBtn>
          {showColorPicker && (
            <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 100, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 2, padding: 6, background: "white", border: "1px solid #DDD", boxShadow: "0 4px 8px rgba(0,0,0,0.1)", borderRadius: 3, marginTop: 2 }}>
              {TEXT_COLORS.map((c) => (
                <button key={c} style={{ width: 20, height: 20, background: c, border: "1px solid #CCC", borderRadius: 2 }}
                  onClick={() => { editor.chain().focus().setColor(c).run(); setShowColorPicker(false); }} />
              ))}
            </div>
          )}
        </div>
        {/* Highlight picker */}
        <div style={{ position: "relative" }}>
          <ToolBtn active={editor.isActive("highlight")} onClick={() => setShowHighlightPicker(!showHighlightPicker)} title="형광펜"><Highlighter size={14} /></ToolBtn>
          {showHighlightPicker && (
            <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 100, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 2, padding: 6, background: "white", border: "1px solid #DDD", boxShadow: "0 4px 8px rgba(0,0,0,0.1)", borderRadius: 3, marginTop: 2 }}>
              {HIGHLIGHT_COLORS.map((c) => (
                <button key={c} style={{ width: 20, height: 20, background: c, border: "1px solid #CCC", borderRadius: 2 }}
                  onClick={() => { editor.chain().focus().toggleHighlight({ color: c }).run(); setShowHighlightPicker(false); }} />
              ))}
            </div>
          )}
        </div>

        <ToolDivider />
        <ToolBtn active={editor.isActive("superscript")} onClick={() => editor.chain().focus().toggleSuperscript().run()} title="위 첨자"><span style={{ fontSize: 9, fontWeight: 700 }}>X<sup>2</sup></span></ToolBtn>
        <ToolBtn active={editor.isActive("subscript")} onClick={() => editor.chain().focus().toggleSubscript().run()} title="아래 첨자"><span style={{ fontSize: 9, fontWeight: 700 }}>X<sub>2</sub></span></ToolBtn>
      </div>

      {/* Ribbon Toolbar Row 2 */}
      <div style={{ display: "flex", alignItems: "center", padding: "2px 8px", gap: 2, height: 28, background: "#F8F8F8", borderBottom: "1px solid #D4D4D4", flexShrink: 0 }} className="app-ribbon no-print">
        <ToolBtn active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="왼쪽 정렬"><AlignLeft size={14} /></ToolBtn>
        <ToolBtn active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="가운데 정렬"><AlignCenter size={14} /></ToolBtn>
        <ToolBtn active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} title="오른쪽 정렬"><AlignRight size={14} /></ToolBtn>
        <ToolBtn active={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()} title="양쪽 정렬"><AlignJustify size={14} /></ToolBtn>

        <ToolDivider />
        <ToolBtn onClick={() => editor.chain().focus().sinkListItem("listItem").run()} title="들여쓰기"><IndentIncrease size={14} /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().liftListItem("listItem").run()} title="내어쓰기"><IndentDecrease size={14} /></ToolBtn>

        <ToolDivider />
        <ToolBtn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="글머리 기호"><List size={14} /></ToolBtn>
        <ToolBtn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="번호 매기기"><ListOrdered size={14} /></ToolBtn>

        <ToolDivider />
        <div ref={tablePickerRef} style={{ position: "relative" }}>
          <ToolBtn active={showTablePicker} onClick={() => setShowTablePicker((value) => !value)} title="표 만들기"><Table size={14} /></ToolBtn>
          {showTablePicker && (
            <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 110, marginTop: 3, width: 220, background: "white", border: "1px solid #D4D4D4", boxShadow: "0 6px 16px rgba(0,0,0,0.16)", borderRadius: 3, padding: 10, color: "#222", fontSize: 11 }}>
              <div style={{ fontWeight: 700, marginBottom: 7 }}>표 만들기</div>
              <div
                style={{ display: "grid", gridTemplateColumns: `repeat(${QUICK_TABLE_SIZE}, 18px)`, gap: 3, justifyContent: "center" }}
                onMouseLeave={() => setTableGridHover({ rows: 0, cols: 0 })}
              >
                {Array.from({ length: QUICK_TABLE_SIZE * QUICK_TABLE_SIZE }, (_, index) => {
                  const row = Math.floor(index / QUICK_TABLE_SIZE) + 1;
                  const col = (index % QUICK_TABLE_SIZE) + 1;
                  const selected = row <= tableGridHover.rows && col <= tableGridHover.cols;
                  return (
                    <button
                      key={`${row}-${col}`}
                      type="button"
                      aria-label={`${row}행 ${col}열 표 삽입`}
                      onMouseEnter={() => setTableGridHover({ rows: row, cols: col })}
                      onClick={() => insertTable(row, col)}
                      style={{ width: 18, height: 18, padding: 0, border: `1px solid ${selected ? "#1B6AC9" : "#B9C0C8"}`, background: selected ? "#DCEBFF" : "white", borderRadius: 1 }}
                    />
                  );
                })}
              </div>
              <div style={{ height: 22, display: "flex", alignItems: "center", justifyContent: "center", color: tableGridHover.rows ? "#1B6AC9" : "#777", fontWeight: tableGridHover.rows ? 700 : 400 }}>
                {tableGridHover.rows ? `${tableGridHover.rows}행 x ${tableGridHover.cols}열` : "빠른 크기 선택"}
              </div>
              <div style={{ height: 1, background: "#E5E5E5", margin: "2px 0 8px" }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  행
                  <input
                    type="number"
                    min={1}
                    max={MAX_TABLE_ROWS}
                    value={tableRows}
                    onChange={(e) => setTableRows(clampTableSize(e.target.value, 1, MAX_TABLE_ROWS))}
                    style={{ height: 24, border: "1px solid #C8C8C8", borderRadius: 2, padding: "0 5px", fontSize: 11 }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  열
                  <input
                    type="number"
                    min={1}
                    max={MAX_TABLE_COLS}
                    value={tableCols}
                    onChange={(e) => setTableCols(clampTableSize(e.target.value, 1, MAX_TABLE_COLS))}
                    style={{ height: 24, border: "1px solid #C8C8C8", borderRadius: 2, padding: "0 5px", fontSize: 11 }}
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => insertTable()}
                style={{ width: "100%", height: 26, marginTop: 8, border: "1px solid #1B6AC9", borderRadius: 2, background: "#1B6AC9", color: "white", fontSize: 11, fontWeight: 600 }}
              >
                {tableRows}행 x {tableCols}열 만들기
              </button>
              <div style={{ marginTop: 6, color: "#777", lineHeight: 1.4 }}>
                최대 {MAX_TABLE_ROWS}행 x {MAX_TABLE_COLS}열
              </div>
            </div>
          )}
        </div>
        <ToolBtn onClick={handleImageInsert} title="그림 삽입"><ImageIcon size={14} /></ToolBtn>

        <div style={{ flex: 1 }} />
        <select
          value={paperSize}
          onChange={(e) => {
            session.changeSettings({...session.settings, paperSize: e.target.value as PaperSizeName});
          }}
          title="편집 용지 크기"
          style={{ height: 22, fontSize: 11, border: "1px solid #CCC", borderRadius: 2, padding: "0 4px", background: "white" }}
        >
          {(Object.keys(PAPER_SIZES) as PaperSizeName[]).map((size) => (
            <option key={size} value={size}>{PAPER_SIZES[size].label}</option>
          ))}
        </select>
        <ToolBtn onClick={handlePrint} title="인쇄 미리보기 · PDF 저장 (Ctrl+P)"><Printer size={14} /></ToolBtn>
        <ToolBtn onClick={handleExportDocx} title="워드로 변환 (.docx) (Ctrl+Shift+S)"><FileText size={14} /></ToolBtn>
        <ToolDivider />
        <ToolBtn onClick={() => editor.chain().focus().undo().run()} title="되돌리기 (Ctrl+Z)"><Undo2 size={14} /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().redo().run()} title="다시 실행 (Ctrl+Y)"><Redo2 size={14} /></ToolBtn>
      </div>

      {editor.isActive("table") && (
        <div className="no-print table-context-toolbar" role="toolbar" aria-label="표 편집 도구">
          <span className="table-context-title"><Table size={14} /> 표 편집</span>
          <TableActionButton icon={<BetweenHorizontalStart size={14} />} label="위 행" title="현재 셀 위에 행 추가" onClick={() => runTableCommand("addRowBefore")} />
          <TableActionButton icon={<BetweenHorizontalEnd size={14} />} label="아래 행" title="현재 셀 아래에 행 추가" onClick={() => runTableCommand("addRowAfter")} />
          <TableActionButton icon={<BetweenVerticalStart size={14} />} label="왼쪽 열" title="현재 셀 왼쪽에 열 추가" onClick={() => runTableCommand("addColumnBefore")} />
          <TableActionButton icon={<BetweenVerticalEnd size={14} />} label="오른쪽 열" title="현재 셀 오른쪽에 열 추가" onClick={() => runTableCommand("addColumnAfter")} />
          <ToolDivider />
          <TableActionButton icon={<Rows3 size={14} />} label="행 삭제" title="선택한 행 삭제" onClick={() => runTableCommand("deleteRow")} />
          <TableActionButton icon={<Columns3 size={14} />} label="열 삭제" title="선택한 열 삭제" onClick={() => runTableCommand("deleteColumn")} />
          <ToolDivider />
          <TableActionButton icon={<TableCellsMerge size={14} />} label="셀 합치기" title="선택한 셀 합치기" disabled={!editor.can().mergeCells()} onClick={() => runTableCommand("mergeCells")} />
          <TableActionButton icon={<TableCellsSplit size={14} />} label="셀 나누기" title="합쳐진 셀 나누기" disabled={!editor.can().splitCell()} onClick={() => runTableCommand("splitCell")} />
          <span style={{ flex: 1 }} />
          <TableActionButton danger icon={<Trash2 size={14} />} label="표 삭제" title="표 전체 삭제" onClick={() => runTableCommand("deleteTable")} />
        </div>
      )}

      {/* Ruler */}
      <div style={{ height: 18, background: "#FAFAFA", borderBottom: "1px solid #E0E0E0", overflow: "hidden", flexShrink: 0, paddingLeft: 24 }} className="no-print">
        <svg width={pageWidth * zoom} height={18}>
          <rect x={0} y={0} width={pageMarginX * zoom} height={18} fill="#E8E8E8" />
          <rect x={(pageWidth - pageMarginX) * zoom} y={0} width={pageMarginX * zoom} height={18} fill="#E8E8E8" />
          <rect x={pageMarginX * zoom} y={0} width={(pageWidth - pageMarginX * 2) * zoom} height={18} fill="#FFF" />
          {Array.from({ length: Math.floor(paper.widthMm / 5) + 1 }, (_, i) => {
            const mm = i * 5;
            const x = mm * PX_PER_MM * zoom;
            const isCm = mm % 10 === 0;
            return (
              <g key={i}>
                <line x1={x} y1={isCm ? 8 : 12} x2={x} y2={18} stroke="#888" strokeWidth={isCm ? 1 : 0.5} />
                {isCm && mm > 0 && mm < paper.widthMm && (
                  <text x={x} y={7} textAnchor="middle" fontSize="8" fill="#666" fontFamily="sans-serif">{mm / 10}</text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="additional-tools no-print"><EditingTools editor={editor} /></div>
      <FindReplace editor={editor} open={showFind} onClose={() => setShowFind(false)} />
      <div className="document-view-controls no-print">
        <span>문서는 이 기기에 저장됩니다 · {offlineReady ? (online ? '오프라인 사용 준비 완료' : '오프라인 편집 중') : '서버 업로드 없음'}</span>
        <button onClick={()=>setShowOutline(!showOutline)}>문서 탐색</button>
        <button onClick={handlePrint}>쪽 미리보기 / PDF</button>
        <button onClick={() => setShowLayout(!showLayout)}>용지 설정</button>
        <button onClick={() => setZoom(Math.max(.5, Math.min(2, ((canvasScrollRef.current?.clientWidth ?? 900)-64)/pageWidth)))}>너비 맞춤</button>
      </div>
      {showLayout && <LayoutPanel settings={session.settings} onChange={session.changeSettings} onClose={() => setShowLayout(false)} />}
      {busy && <div className="notice no-print" role="status">파일을 확인하고 있습니다…</div>}
      <div className="editing-workspace" style={{display:"flex",flex:1,minHeight:0,position:"relative"}}>
      {showOutline && <DocumentOutline editor={editor} onClose={()=>setShowOutline(false)} />}
      <div key="canvas" ref={canvasScrollRef} className="editor-canvas" style={{flex:1,overflow:'auto',padding:24,background:'#e6eaf0'}}>
        <div className={`page-surface continuous-editor${showParagraphMarks ? ' show-paragraph-marks' : ''}`} style={{width:pageWidth, minHeight:pageHeight, zoom, margin:'0 auto', background:'white',boxShadow:'0 2px 12px #23334d20'}}>
          <div className="editor-content" style={{padding:`${session.settings.margins.top}mm ${session.settings.margins.right}mm ${session.settings.margins.bottom}mm ${session.settings.margins.left}mm`,minHeight:pageHeight,boxSizing:'border-box',userSelect:'text'}}>
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
      </div>
      <Dialog open={showTemplates} onOpenChange={setShowTemplates}>
        <DialogContent className="template-dialog no-print">
          <DialogHeader><DialogTitle>서식으로 시작하기</DialogTitle><DialogDescription>모든 서식은 무료입니다. 현재 문서는 자동 저장 후 새 문서로 전환합니다.</DialogDescription></DialogHeader>
          <div className="template-grid">{DOCUMENT_TEMPLATES.map(template => <button key={template.id} className="template-card" disabled={busy || !session.ready} onClick={()=>void handleTemplate(template.id)}><FileText size={24}/><strong>{template.title}</strong><span>{template.description}</span></button>)}</div>
        </DialogContent>
      </Dialog>
      <Dialog open={showStatistics} onOpenChange={setShowStatistics}>
        <DialogContent className="no-print"><DialogHeader><DialogTitle>문서 통계</DialogTitle><DialogDescription>현재 편집 문서의 텍스트와 개체 수입니다.</DialogDescription></DialogHeader>
          <dl className="document-statistics">{[
            ['글자 수 (공백 포함)', Array.from(plainText).length], ['글자 수 (공백 제외)', Array.from(plainText.replace(/\s/g,'')).length],
            ['단어 수 (띄어쓰기 기준)', plainText.trim() ? plainText.trim().split(/\s+/).length : 0],
            ['선택한 글자 수', Array.from(selectedText).length], ['문단',paragraphCount], ['표',tableCount], ['그림',imageCount]
          ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{Number(value).toLocaleString()}</dd></div>)}</dl>
        </DialogContent>
      </Dialog>
      {showSupport && <FormatSupport onClose={()=>setShowSupport(false)} />}
      {previewHTML !== null && <PrintPreview html={previewHTML} settings={session.settings} title={docMeta.fileName} onClose={() => setPreviewHTML(null)} onPageCount={count => {setPrintPageCount(count);setPageInfo(1,count);}} />}
      {pdfFile && <PdfViewer file={pdfFile} onClose={() => setPdfFile(null)} />}
      {session.showRecovery && <div className="recovery-backdrop no-print"><section role="dialog" aria-modal="true" aria-label="최근 문서와 복구본" className="recovery-panel">
        <div className="panel-heading"><h2>최근 문서 · 복구본</h2><button onClick={() => session.setShowRecovery(false)}>닫기</button></div>
        <p>복구본은 선택하지 않아도 유지됩니다. 복구하면 별도 문서로 열립니다.</p>
        {session.recovery.length === 0 && <p>저장된 복구본이 없습니다.</p>}
        {session.recovery.map((document, index) => {const snapshotId = (document as any).snapshotId;return <div className="recovery-row" key={snapshotId ?? `${document.id}-${index}`}>
          <div><strong>{document.fileName}</strong><small>{snapshotId ? '변경 전 스냅샷 · ' : ''}{formatAutosaveTime(document.savedAt)} · {document.pageSettings.paperSize} {document.pageSettings.orientation === 'landscape' ? '가로' : '세로'}</small></div>
          <button onClick={async () => {if(!await session.restore(document))toast.error("현재 문서를 보존하지 못해 복구를 중단했습니다. 복구본은 유지됩니다.");}}>복구</button>
          <button onClick={() => downloadBackup(document)}>백업</button>
          <button onClick={async () => {if (!window.confirm('이 복구본을 영구 삭제하시겠습니까?')) return; try {if(document.id.startsWith('emergency:')) localStorage.removeItem(document.id.slice(10));else await deleteRecovery(snapshotId ?? document.id,!!snapshotId);await session.refreshRecovery();} catch(error) {toast.error(`삭제 실패: ${(error as Error).message}`);}}}>삭제</button>
        </div>;})}
      </section></div>}



      {/* Status Bar */}
      <div style={{ height: 24, background: "#F0F0F0", borderTop: "1px solid #D4D4D4", display: "flex", alignItems: "center", padding: "0 8px", fontSize: 10, color: "#666", flexShrink: 0 }} className="app-statusbar no-print">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span>{printPageCount === null ? "연속 편집" : `출력: ${printPageCount}쪽`}</span>
          <span style={{ color: "#CCC" }}>|</span>
          <span>편집: {paper.label}</span>
          <span style={{ color: "#CCC" }}>|</span>
          <span>{session.settings.orientation === "landscape" ? "가로" : "세로"}</span>
          <span style={{ color: "#CCC" }}>|</span>
          <span>문단: {docMeta.currentLine}</span>
          <span style={{ color: "#CCC" }}>|</span>
          <span>칸: {docMeta.currentColumn}</span>
        </div>
        <div style={{ flex: 1, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
          <span>글자 수: {charCount.toLocaleString()}</span>
          {(session.status.includes('실패') || session.status.includes('충돌')) && <><button onClick={() => void session.flush()}>저장 재시도</button><button onClick={() => void session.saveCopy()}>복사본 저장</button><button onClick={() => downloadBackup()}>백업 다운로드</button></>}
          {session.status && (
            <span role="status" style={{ color: session.status.includes("실패") || session.status.includes("충돌") ? "#b42318" : "#237044", fontSize: 11, display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4CAF50", display: "inline-block" }} />
              {session.status}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ padding: "1px 4px", background: "#E0E0E0", borderRadius: 2, fontSize: 9 }}>삽입</span>
          <span style={{ padding: "1px 4px", background: "#E0E0E0", borderRadius: 2, fontSize: 9 }}>한</span>
          <span style={{ color: "#CCC" }}>|</span>
          <button onClick={() => setZoom(Math.max(0.5, zoom - 0.1))} title="축소" style={{ background: "none", border: "none", padding: 2 }}>
            <ZoomOut size={12} />
          </button>
          <input
            type="range" min="50" max="200"
            value={Math.round(zoom * 100)}
            onChange={(e) => setZoom(Number(e.target.value) / 100)}
            style={{ width: 64, height: 4 }}
            title={`${Math.round(zoom * 100)}%`}
          />
          <button onClick={() => setZoom(Math.min(2, zoom + 0.1))} title="확대" style={{ background: "none", border: "none", padding: 2 }}>
            <ZoomIn size={12} />
          </button>
          <span style={{ width: 32, textAlign: "right" }}>{Math.round(zoom * 100)}%</span>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────
function ToolBtn({ active, mixed, disabled, onClick, children, title }: { active?: boolean; mixed?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      style={{
        width: 26, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: 2, border: active ? "1px solid rgba(27,106,201,0.4)" : "1px solid transparent",
        background: mixed ? "repeating-linear-gradient(45deg,#e1eafa,#e1eafa 3px,transparent 3px,transparent 6px)" : active ? "rgba(27,106,201,0.08)" : "transparent",
        color: disabled ? "#AAA" : active ? "#1B6AC9" : "#333",
        opacity: disabled ? 0.55 : 1,
        transition: "background 0.1s",
      }}
      onMouseDown={event => event.preventDefault()}
      aria-label={title}
      aria-pressed={mixed ? "mixed" : !!active}
      onClick={onClick}
      title={title}
      disabled={disabled}
      onMouseEnter={(e) => { if (!active && !disabled) e.currentTarget.style.background = "#E8E8E8"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
    >
      {children}
    </button>
  );
}

function TableActionButton({ icon, label, title, disabled, danger, onClick }: {
  icon: React.ReactNode;
  label: string;
  title: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`table-action-button${danger ? " danger" : ""}`}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ToolDivider() {
  return <div style={{ width: 1, height: 18, background: "#D4D4D4", margin: "0 4px" }} />;
}

function clampTableSize(value: number | string, min: number, max: number): number {
  const numberValue = Number.parseInt(String(value), 10);
  if (Number.isNaN(numberValue)) return min;
  return Math.min(max, Math.max(min, numberValue));
}

function getDefaultContent(): string { return '<p></p>'; }

function LayoutPanel({settings, onChange, onClose}: {settings:PageSettings;onChange:(s:PageSettings)=>void;onClose:()=>void}) {
  return <section className="layout-panel no-print" aria-label="용지 설정">
    <strong>용지 설정</strong>
    <label>용지 <select value={settings.paperSize} onChange={e=>onChange({...settings,paperSize:e.target.value as PageSettings['paperSize']})}><option value="A4">A4</option><option value="A3">A3</option></select></label>
    <label>방향 <select value={settings.orientation} onChange={e => onChange({...settings,orientation:e.target.value as PageSettings['orientation']})}><option value="portrait">세로</option><option value="landscape">가로</option></select></label>
    {(Object.keys(settings.margins) as (keyof PageSettings['margins'])[]).map(key => <label key={key}>{({top:'위',right:'오른쪽',bottom:'아래',left:'왼쪽'})[key]} 여백 (mm) <input type="number" min={5} max={80} step={.5} value={settings.margins[key]} onChange={e => onChange({...settings,margins:{...settings.margins,[key]:Number(e.target.value)}})} /></label>)}
    <label>머리말 <input value={settings.header} onChange={e=>onChange({...settings,header:e.target.value})}/></label>
    <label>꼬리말 <input value={settings.footer} onChange={e=>onChange({...settings,footer:e.target.value})}/></label>
    <label><input type="checkbox" checked={settings.pageNumbers} onChange={e=>onChange({...settings,pageNumbers:e.target.checked})}/> 쪽 번호</label>
    <button onClick={onClose}>닫기</button>
  </section>;
}
