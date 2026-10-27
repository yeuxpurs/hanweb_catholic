/**
 * HWPX Exporter - Converts TipTap editor content to Hancom-compatible HWPX.
 */
import type { Editor } from "@tiptap/react";
import { htmlToHwpx } from "hwp-convert";
import JSZip from "jszip";
import { normalizePageSettings, type PageSettings } from "@/editor/document";
import { writeSnapshot } from "@/docx/xml";

export interface ExportHwpxOptions {
  paperSize?: "A4" | "A3";
  pageSettings?: PageSettings;
  title?: string;
}

export const HWPX_EXPORT_WARNING = "HWPX는 본문·주요 서식·표·그림·용지 설정을 변환합니다. 머리말·꼬리말·쪽 번호·명시적 쪽 나누기와 일부 고급 서식은 외부 프로그램에서 보존되지 않을 수 있습니다. HanWeb 재열기용 편집 상태는 별도로 포함됩니다. 원본과 독립 프로그램에서 확인하세요.";

export async function exportHwpx(editor: Editor, options: ExportHwpxOptions = {}): Promise<Blob> {
  return exportHwpxHtml(editor.getHTML(), options);
}
export async function exportHwpxHtml(html: string, options: ExportHwpxOptions = {}): Promise<Blob> {
  const settings = normalizePageSettings(options.pageSettings ?? { paperSize: options.paperSize ?? "A4" });
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const image of Array.from(doc.querySelectorAll("img"))) {
    if (!/^data:image\/(png|jpeg|gif|bmp|webp);base64,/i.test(image.getAttribute("src") ?? "")) throw new Error("HWPX 저장: 외부 연결 그림 또는 지원하지 않는 그림 형식이 있습니다.");
  }
  const bytes = await htmlToHwpx(html, {
    title: options.title ?? "HanWeb document",
    creator: "HanWeb",
    page: {
      size: settings.paperSize,
      orientation: settings.orientation,
      margins: { ...settings.margins, header: settings.margins.top / 2, footer: settings.margins.bottom / 2 },
    },
  });

  const zip = await JSZip.loadAsync(bytes);
  await writeSnapshot(zip, html, settings, Object.keys(zip.files).filter(path => !zip.files[path].dir));
  const mimetype = await zip.file("mimetype")?.async("string");
  if (!mimetype || !/hwp/i.test(mimetype)) throw new Error("HWPX 생성 결과의 필수 구조를 확인하지 못했습니다.");
  zip.file("mimetype", mimetype, { compression: "STORE" });
  return bytesToHwpxBlob(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

function bytesToHwpxBlob(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: "application/hwp+zip" });
}
