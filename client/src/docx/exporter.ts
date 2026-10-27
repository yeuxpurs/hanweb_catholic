/**
 * DOCX Exporter - Converts TipTap editor content to a Microsoft Word (.docx) file.
 * Builds a minimal WordprocessingML (OOXML) package directly with JSZip, so no
 * additional npm dependency is required (JSZip is already used by the HWPX exporter).
 */
import type { Editor } from "@tiptap/react";
import JSZip from "jszip";
import { normalizePageSettings, pageDimensions, type PageSettings } from "@/editor/document";
import { writeSnapshot } from "./xml";

export interface ExportDocxOptions {
  paperSize?: "A4" | "A3";
  title?: string;
  pageSettings?: PageSettings;
}

const TWIPS_PER_EMU_SCALE = 635; // 1 twip = 635 EMU
const EMU_PER_PX = 9525; // assumes 96 DPI source images


interface ImagePart {
  relId: string;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}

interface ConvertContext {
  images: ImagePart[];
  contentWidthTwips: number;
  drawingId: number;
  lists: { id: number; ordered: boolean; start: number }[];
  hyperlinks: { id: string; url: string }[];
}
export const DOCX_EXPORT_WARNING = "DOCX는 본문·주요 서식·목록·병합 표·인라인 그림·캡션 텍스트·외부 하이퍼링크·단일 용지 설정·텍스트 머리말/꼬리말·쪽 번호를 저장합니다. 자동 캡션 번호·고급 개체·구역별 설정·각주·변경 추적은 보존이 제한되며 Word의 줄바꿈 일치는 미검증입니다. 원본을 보관하세요.";

export async function exportDocx(editor: Editor, options: ExportDocxOptions = {}): Promise<Blob> {
  return exportDocxHtml(editor.getHTML(), options);
}

export async function exportDocxHtml(html: string, options: ExportDocxOptions = {}): Promise<Blob> {
  const settings = normalizePageSettings(options.pageSettings ?? { paperSize: options.paperSize ?? "A4" });
  const title = options.title ?? "HanWeb document";
  const dimensions = pageDimensions(settings);
  const page = { w: mmToTwips(dimensions.widthMm), h: mmToTwips(dimensions.heightMm) };

  const context: ConvertContext = {
    images: [],
    contentWidthTwips: page.w - mmToTwips(settings.margins.left + settings.margins.right),
    drawingId: 1,
    lists: [],
    hyperlinks: [],
  };

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const bodyXml = await nodeListToXml(Array.from(doc.body.childNodes), {}, context);

  const documentXml = buildDocumentXml(bodyXml, page, settings);
  const zip = new JSZip();

  zip.file("[Content_Types].xml", buildContentTypesXml(context.images, settings));
  zip.folder("_rels")!.file(".rels", RELS_XML);
  zip.folder("docProps")!.file("core.xml", buildCoreXml(title));
  zip.folder("docProps")!.file("app.xml", APP_XML);

  const wordFolder = zip.folder("word")!;
  wordFolder.file("document.xml", documentXml);
  wordFolder.file("styles.xml", STYLES_XML);
  wordFolder.file("numbering.xml", buildNumberingXml(context));
  if (settings.header) wordFolder.file("header1.xml", buildHeaderFooterXml("hdr", settings.header, false));
  if (settings.footer || settings.pageNumbers) wordFolder.file("footer1.xml", buildHeaderFooterXml("ftr", settings.footer, settings.pageNumbers));
  wordFolder.folder("_rels")!.file("document.xml.rels", buildDocumentRelsXml(context.images, settings, context.hyperlinks));

  if (context.images.length > 0) {
    const mediaFolder = wordFolder.folder("media")!;
    for (const image of context.images) {
      mediaFolder.file(image.fileName, image.bytes);
    }
  }

  await writeSnapshot(zip, html, settings, Object.keys(zip.files).filter(path => path.startsWith("word/") && !zip.files[path].dir));
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return bytesToDocxBlob(bytes);
}

function bytesToDocxBlob(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

// ─── HTML → OOXML conversion ────────────────────────────────────────────────

interface RunStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  color?: string;
  highlight?: string;
  fontSizePt?: number;
  fontFamily?: string;
}

const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "div"]);

async function nodeListToXml(nodes: ChildNode[], inherited: RunStyle, ctx: ConvertContext): Promise<string> {
  let xml = "";
  for (const node of nodes) {
    xml += await nodeToXml(node, inherited, ctx);
  }
  return xml;
}

async function nodeToXml(node: ChildNode, inherited: RunStyle, ctx: ConvertContext): Promise<string> {
  if (node.nodeType === Node.TEXT_NODE) {
    // Bare text nodes at the block level (rare) — wrap in their own paragraph.
    const text = node.textContent ?? "";
    if (!text.trim()) return "";
    return paragraphXml(await runXml(text, inherited, ctx), {});
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (el.hasAttribute("data-page-break") || ["page-break", "pageBreak"].includes(el.getAttribute("data-type") || "")) {
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  }

  if (tag === "table") return tableXml(el, ctx);
  if (tag === "ul" || tag === "ol") return listXml(el, tag === "ol", inherited, ctx);
  if (tag === "img") return paragraphXml(await imageRunXml(el, ctx), {}) + imageCaptionXml(el);
  if (tag === "br") return "";

  if (BLOCK_TAGS.has(tag)) {
    const align = alignmentOf(el);
    const headingLevel = /^h[1-6]$/.test(tag) ? Number(tag[1]) : undefined;
    const runs = await runsFromInline(Array.from(el.childNodes), { ...inherited, ...styleFromElement(el, tag) }, ctx);
    const captions = Array.from(el.querySelectorAll("img[data-caption]")).map(image => imageCaptionXml(image as HTMLElement)).join("");
    return paragraphXml(runs || emptyRunXml(inherited), { align, headingLevel, element: el }) + captions;
  }

  // Unknown wrapper element (e.g. a stray <span> at block level) — recurse into children.
  return nodeListToXml(Array.from(el.childNodes), inherited, ctx);
}

async function runsFromInline(nodes: ChildNode[], inherited: RunStyle, ctx: ConvertContext): Promise<string> {
  let xml = "";
  for (const node of nodes) {
    xml += await inlineNodeToXml(node, inherited, ctx);
  }
  return xml;
}

async function inlineNodeToXml(node: ChildNode, inherited: RunStyle, ctx: ConvertContext): Promise<string> {
  if (node.nodeType === Node.TEXT_NODE) {
    return runXml(node.textContent ?? "", inherited, ctx);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (tag === "br") return "<w:r><w:br/></w:r>";
  if (tag === "img") return imageRunXml(el, ctx);
  if (tag === "ul" || tag === "ol") return "";

  const style: RunStyle = { ...inherited, ...styleFromElement(el, tag) };
  if (tag === "a") {
    const href = el.getAttribute("href") || "";
    const content = await runsFromInline(Array.from(el.childNodes), style, ctx);
    if (/^(https?:|mailto:)/i.test(href)) {
      let relationship = ctx.hyperlinks.find(item => item.url === href);
      if (!relationship) { relationship = { id: `rIdLink${ctx.hyperlinks.length + 1}`, url: href }; ctx.hyperlinks.push(relationship); }
      return `<w:hyperlink r:id="${relationship.id}" w:history="1">${content}</w:hyperlink>`;
    }
    return content;
  }
  return runsFromInline(Array.from(el.childNodes), style, ctx);
}

function imageCaptionXml(image: HTMLElement): string {
  const caption = image.getAttribute("data-caption")?.trim();
  return caption ? `<w:p><w:pPr><w:pStyle w:val="Caption"/><w:jc w:val="center"/><w:keepNext w:val="false"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(caption)}</w:t></w:r></w:p>` : "";
}

function styleFromElement(el: HTMLElement, tag: string): Partial<RunStyle> {
  const patch: Partial<RunStyle> = {};
  if (tag === "strong" || tag === "b") patch.bold = true;
  if (tag === "em" || tag === "i") patch.italic = true;
  if (tag === "u") patch.underline = true;
  if (tag === "s" || tag === "strike" || tag === "del") patch.strike = true;
  if (tag === "sup") patch.superscript = true;
  if (tag === "sub") patch.subscript = true;

  const styleAttr = el.getAttribute("style") || "";
  const color = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(styleAttr)?.[1]?.trim();
  const bg = /background-color\s*:\s*([^;]+)/i.exec(styleAttr)?.[1]?.trim();
  const fontSize = /font-size\s*:\s*([\d.]+)(pt|px)/i.exec(styleAttr);
  const fontFamily = /font-family\s*:\s*([^;]+)/i.exec(styleAttr)?.[1]?.trim();

  if (color) patch.color = normalizeHexColor(color);
  if (bg) patch.highlight = normalizeHexColor(bg);
  if (fontSize) patch.fontSizePt = Number.parseFloat(fontSize[1]) * (fontSize[2].toLowerCase() === "px" ? .75 : 1);
  if (fontFamily) patch.fontFamily = fontFamily.replace(/['"]/g, "").split(",")[0]?.trim();
  if (tag === "mark" && !bg) patch.highlight = "#FFFF00";

  return patch;
}

function normalizeHexColor(value: string): string | undefined {
  const hexMatch = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(value.trim());
  if (!hexMatch) {
    const rgb = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value);
    return rgb ? rgb.slice(1, 4).map(channel => Math.min(255, Number(channel)).toString(16).padStart(2, "0")).join("").toUpperCase() : undefined;
  }
  let hex = hexMatch[1];
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  return hex.toUpperCase();
}

function alignmentOf(el: HTMLElement): string | undefined {
  const styleAttr = el.getAttribute("style") || "";
  const match = /text-align\s*:\s*(left|center|right|justify)/i.exec(styleAttr);
  const value = (match?.[1] || el.getAttribute("align") || "").toLowerCase();
  if (value === "center") return "center";
  if (value === "right") return "right";
  if (value === "justify") return "both";
  if (value === "left") return "left";
  return undefined;
}

async function listXml(listEl: HTMLElement, ordered: boolean, inherited: RunStyle, ctx: ConvertContext, level = 0, parentId?: number): Promise<string> {
  let xml = "";
  const parent = ctx.lists.find(item => item.id === parentId);
  const id = parent?.ordered === ordered ? parent.id : ctx.lists.length + 1;
  if (!parent || parent.ordered !== ordered) ctx.lists.push({ id, ordered, start: Math.max(1, Number(listEl.getAttribute("start")) || 1) });
  for (const child of Array.from(listEl.children)) {
    if (child.tagName.toLowerCase() !== "li") continue;
    const blockChildren = Array.from(child.childNodes).filter(
      (n) => n.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((n as HTMLElement).tagName.toLowerCase())
    );
    if (blockChildren.length > 0) {
      let first = true;
      for (const blockChild of blockChildren) {
        const el = blockChild as HTMLElement;
        const runs = await runsFromInline(Array.from(el.childNodes), inherited, ctx);
        xml += paragraphXml(runs, { listId: first ? id : undefined, level, element: el });
        first = false;
      }
    } else {
      const runs = await runsFromInline(Array.from(child.childNodes), inherited, ctx);
      xml += paragraphXml(runs, { listId: id, level });
    }
    for (const nested of Array.from(child.children).filter(element => ["ul", "ol"].includes(element.tagName.toLowerCase()))) {
      xml += await listXml(nested as HTMLElement, nested.tagName.toLowerCase() === "ol", inherited, ctx, Math.min(8, level + 1), id);
    }
  }
  return xml;
}

async function tableXml(tableEl: HTMLElement, ctx: ConvertContext): Promise<string> {
  const rows = Array.from(tableEl.querySelectorAll(":scope > tbody > tr, :scope > thead > tr, :scope > tfoot > tr, :scope > tr"));
  if (rows.length === 0) return "";
  type Slot = { element: HTMLElement; origin: boolean; span: number; rowSpan: number };
  const matrix: (Slot | undefined)[][] = [];
  const widths: number[] = [];
  for (const [r, row] of rows.entries()) {
    matrix[r] ??= [];
    let col = 0;
    for (const cell of Array.from(row.children) as HTMLElement[]) {
      while (matrix[r][col]) col++;
      const span = Math.max(1, Math.min(100, Number(cell.getAttribute("colspan")) || 1));
      const rowSpan = Math.max(1, Math.min(rows.length - r, Number(cell.getAttribute("rowspan")) || 1));
      const given = (cell.getAttribute("data-colwidth") ?? "").split(",").map(Number);
      for (let down = 0; down < rowSpan; down++) {
        matrix[r + down] ??= [];
        for (let across = 0; across < span; across++) matrix[r + down][col + across] = { element: cell, origin: down === 0 && across === 0, span: across === 0 ? span : 0, rowSpan };
      }
      for (let across = 0; across < span; across++) if (given[across] > 0) widths[col + across] = Math.round(given[across] * 15);
      col += span;
    }
  }
  const colCount = Math.max(1, ...matrix.map(row => row.length));
  for (let col = 0; col < colCount; col++) widths[col] ||= Math.floor(ctx.contentWidthTwips / colCount);

  let gridXml = "";
  for (let i = 0; i < colCount; i++) gridXml += `<w:gridCol w:w="${widths[i]}"/>`;

  let rowsXml = "";
  for (const [rowIndex, row] of matrix.entries()) {
    let cellsXml = "";
    for (let col = 0; col < colCount; col++) {
      const slot = row[col];
      if (slot && !slot.span) continue;
      const span = slot?.span ?? 1;
      const cellEl = slot?.element;
      let props = `<w:tcW w:w="${widths.slice(col, col + span).reduce((a, b) => a + b, 0)}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ""}`;
      if (slot && slot.rowSpan > 1) props += `<w:vMerge${slot.origin ? ' w:val="restart"' : ""}/>`;
      const style = cellEl?.style;
      if (style) {
        const fill = normalizeHexColor(style.backgroundColor); if (fill) props += `<w:shd w:val="clear" w:fill="${fill}"/>`;
        if (["top", "middle", "bottom"].includes(style.verticalAlign)) props += `<w:vAlign w:val="${style.verticalAlign === "middle" ? "center" : style.verticalAlign}"/>`;
        const sides = ["top", "right", "bottom", "left"];
        const padding = sides.map(side => { const value = cssPoints(style.getPropertyValue(`padding-${side}`)); return value !== undefined ? `<w:${side} w:w="${Math.round(value * 20)}" w:type="dxa"/>` : ""; }).join("");
        if (padding) props += `<w:tcMar>${padding}</w:tcMar>`;
        const borderColor = normalizeHexColor(style.borderColor); const borderWidth = cssPoints(style.borderWidth);
        if (borderColor || borderWidth || style.borderStyle) props += `<w:tcBorders>${sides.map(side => `<w:${side} w:val="${style.borderStyle === "dashed" ? "dashed" : style.borderStyle === "dotted" ? "dotted" : style.borderStyle === "double" ? "double" : style.borderStyle === "none" ? "nil" : "single"}" w:sz="${Math.round((borderWidth ?? .5) * 8)}" w:color="${borderColor ?? "999999"}"/>`).join("")}</w:tcBorders>`;
      }
      let contentXml = slot?.origin && cellEl ? await nodeListToXml(Array.from(cellEl.childNodes), {}, ctx) : "";
      if (!contentXml || !contentXml.endsWith("</w:p>")) contentXml += paragraphXml("", {});
      cellsXml += `<w:tc><w:tcPr>${props}</w:tcPr>${contentXml}</w:tc>`;
    }
    const header = Array.from(rows[rowIndex].children).every(cell => cell.tagName.toLowerCase() === "th");
    const cellHeights = Array.from(rows[rowIndex].children).map(cell => cssPoints((cell as HTMLElement).style.minHeight) ?? 0);
    const height = cssPoints((rows[rowIndex] as HTMLElement).style.height) || Math.max(...cellHeights);
    rowsXml += `<w:tr><w:trPr>${header ? "<w:tblHeader/>" : ""}${height ? `<w:trHeight w:val="${Math.round(height * 20)}" w:hRule="atLeast"/>` : ""}</w:trPr>${cellsXml}</w:tr>`;
  }

  const borders = ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`)
    .join("");

  const align = tableEl.style.marginLeft === "auto" ? tableEl.style.marginRight === "auto" ? "center" : "right" : "left";
  const tableWidth = tableEl.style.width;
  const widthXml = tableWidth.endsWith("%") ? `<w:tblW w:w="${Math.round(Number.parseFloat(tableWidth) * 50)}" w:type="pct"/>` : tableWidth ? `<w:tblW w:w="${Math.round((cssPoints(tableWidth) ?? 0) * 20)}" w:type="dxa"/>` : '<w:tblW w:w="0" w:type="auto"/>';
  return `<w:tbl><w:tblPr>${widthXml}<w:jc w:val="${align}"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr><w:tblGrid>${gridXml}</w:tblGrid>${rowsXml}</w:tbl>`;
}

async function imageRunXml(imgEl: HTMLElement, ctx: ConvertContext): Promise<string> {
  const src = imgEl.getAttribute("src") || "";
  const decoded = decodeDataUrl(src);
  if (!decoded) throw new Error("DOCX 저장: 지원하지 않는 그림 형식 또는 외부 연결 그림이 있습니다. PNG/JPEG 파일을 다시 삽입하세요.");

  const drawingId = ctx.drawingId++;
  const relId = `rIdImage${drawingId}`;
  const fileName = `image${drawingId}.${decoded.extension}`;
  ctx.images.push({ relId, fileName, contentType: decoded.contentType, bytes: decoded.bytes });

  let width = Number(imgEl.getAttribute("width")) || (cssPoints(imgEl.style.width) ?? 0) / .75;
  let height = Number(imgEl.getAttribute("height")) || (cssPoints(imgEl.style.height) ?? 0) / .75;
  if (!width || !height) { const natural = await naturalImageSize(src); width ||= natural.width; height ||= natural.height; }
  let cx = width * EMU_PER_PX;
  let cy = height * EMU_PER_PX;
  const maxCx = ctx.contentWidthTwips * TWIPS_PER_EMU_SCALE;
  if (cx > maxCx) {
    const scale = maxCx / cx;
    cx = maxCx;
    cy = Math.round(cy * scale);
  }

  const alt = escapeXml(imgEl.getAttribute("alt") ?? "");
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${drawingId}" name="Picture ${drawingId}" descr="${alt}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${drawingId}" name="Picture ${drawingId}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function decodeDataUrl(src: string): { bytes: Uint8Array; contentType: string; extension: string } | null {
  const match = /^data:(image\/(?:png|jpeg|gif|bmp|webp));base64,([a-z\d+/=\s]+)$/is.exec(src);
  if (!match) return null;
  const contentType = match[1];
  const base64 = match[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const extension = (contentType.split("/")[1] || "png").replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "");
  return { bytes, contentType, extension };
}

function naturalImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timeout = setTimeout(() => reject(new Error("DOCX 저장: 이미지 크기를 확인하지 못했습니다.")), 5000);
    img.onload = () => { clearTimeout(timeout); resolve({ width: img.naturalWidth || 400, height: img.naturalHeight || 300 }); };
    img.onerror = () => { clearTimeout(timeout); reject(new Error("DOCX 저장: 이미지가 손상되었습니다.")); };
    img.src = src;
  });
}

function runXml(text: string, style: RunStyle, ctx: ConvertContext): string {
  void ctx;
  if (!text) return "";
  const rPr = runPropsXml(style);
  const escaped = escapeXml(text);
  const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
  return `<w:r>${rPr}<w:t${space}>${escaped}</w:t></w:r>`;
}

function emptyRunXml(style: RunStyle): string {
  return `<w:r>${runPropsXml(style)}</w:r>`;
}

function runPropsXml(style: RunStyle): string {
  let xml = "";
  if (style.fontFamily) {
    const f = escapeXml(style.fontFamily);
    xml += `<w:rFonts w:ascii="${f}" w:eastAsia="${f}" w:hAnsi="${f}" w:cs="${f}"/>`;
  }
  if (style.bold) xml += `<w:b/>`;
  if (style.italic) xml += `<w:i/>`;
  if (style.underline) xml += `<w:u w:val="single"/>`;
  if (style.strike) xml += `<w:strike/>`;
  if (style.superscript) xml += `<w:vertAlign w:val="superscript"/>`;
  if (style.subscript) xml += `<w:vertAlign w:val="subscript"/>`;
  if (style.color) xml += `<w:color w:val="${style.color}"/>`;
  if (style.highlight) xml += `<w:shd w:val="clear" w:fill="${style.highlight}"/>`;
  if (style.fontSizePt) {
    const half = Math.round(style.fontSizePt * 2);
    xml += `<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>`;
  }
  return xml ? `<w:rPr>${xml}</w:rPr>` : "";
}

function paragraphXml(runsXml: string, opts: { align?: string; headingLevel?: number; indent?: boolean; listId?: number; level?: number; element?: HTMLElement }): string {
  let pPr = "<w:widowControl/>";
  if (opts.headingLevel) pPr += `<w:pStyle w:val="Heading${opts.headingLevel}"/><w:keepNext/>`;
  if (opts.align && opts.align !== "left") pPr += `<w:jc w:val="${opts.align}"/>`;
  if (opts.indent) pPr += `<w:ind w:left="360"/>`;
  if (opts.listId) pPr += `<w:numPr><w:ilvl w:val="${opts.level ?? 0}"/><w:numId w:val="${opts.listId}"/></w:numPr>`;
  const style = opts.element?.style;
  if (style) {
    const before = cssPoints(style.marginTop), after = cssPoints(style.marginBottom);
    const line = style.lineHeight;
    const lineValue = line ? /(?:pt|px|mm|cm)$/.test(line) ? Math.round((cssPoints(line) ?? 12) * 20) : Math.round(Number(line) * 240) : undefined;
    if (before !== undefined || after !== undefined || lineValue) pPr += `<w:spacing${before !== undefined ? ` w:before="${Math.round(before * 20)}"` : ""}${after !== undefined ? ` w:after="${Math.round(after * 20)}"` : ""}${lineValue ? ` w:line="${lineValue}" w:lineRule="${/(?:pt|px|mm|cm)$/.test(line) ? "exact" : "auto"}"` : ""}/>`;
    const left = cssPoints(style.marginLeft), right = cssPoints(style.marginRight), first = cssPoints(style.textIndent);
    if (left !== undefined || right !== undefined || first !== undefined) pPr += `<w:ind${left !== undefined ? ` w:left="${Math.round(left * 20)}"` : ""}${right !== undefined ? ` w:right="${Math.round(right * 20)}"` : ""}${first !== undefined ? ` w:${first < 0 ? "hanging" : "firstLine"}="${Math.round(Math.abs(first) * 20)}"` : ""}/>`;
    if (style.breakAfter === "avoid" || opts.element?.getAttribute("data-keep-with-next") === "true") pPr += "<w:keepNext/>";
  }
  const pPrXml = pPr ? `<w:pPr>${pPr}</w:pPr>` : "";
  return `<w:p>${pPrXml}${runsXml}</w:p>`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─── Static OOXML parts ──────────────────────────────────────────────────────

function buildDocumentXml(bodyXml: string, page: { w: number; h: number }, settings: PageSettings): string {
  const references = `${settings.header ? '<w:headerReference w:type="default" r:id="rIdHeader"/>' : ""}${settings.footer || settings.pageNumbers ? '<w:footerReference w:type="default" r:id="rIdFooter"/>' : ""}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${bodyXml || paragraphXml("", {})}<w:sectPr>${references}<w:pgSz w:w="${page.w}" w:h="${page.h}"${settings.orientation === "landscape" ? ' w:orient="landscape"' : ""}/><w:pgMar w:top="${mmToTwips(settings.margins.top)}" w:right="${mmToTwips(settings.margins.right)}" w:bottom="${mmToTwips(settings.margins.bottom)}" w:left="${mmToTwips(settings.margins.left)}" w:header="${mmToTwips(settings.margins.top / 2)}" w:footer="${mmToTwips(settings.margins.bottom / 2)}" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

function buildContentTypesXml(images: ImagePart[], settings: PageSettings): string {
  const extensions = new Set(images.map((i) => i.fileName.split(".").pop() || "png"));
  const extensionTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    svg: "image/svg+xml",
  };
  let imageDefaults = "";
  for (const ext of extensions) {
    imageDefaults += `<Default Extension="${ext}" ContentType="${extensionTypes[ext] || "image/png"}"/>`;
  }
  const additional = `<Default Extension="json" ContentType="application/json"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>${settings.header ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ""}${settings.footer || settings.pageNumbers ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : ""}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageDefaults}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${additional}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

function buildDocumentRelsXml(images: ImagePart[], settings: PageSettings, hyperlinks: ConvertContext["hyperlinks"]): string {
  let rels = `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
  rels += '<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>';
  if (settings.header) rels += '<Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>';
  if (settings.footer || settings.pageNumbers) rels += '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>';
  for (const hyperlink of hyperlinks) rels += `<Relationship Id="${hyperlink.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(hyperlink.url)}" TargetMode="External"/>`;
  for (const image of images) {
    rels += `<Relationship Id="${image.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${image.fileName}"/>`;
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

function mmToTwips(mm: number): number { return Math.round(mm / 25.4 * 1440); }
function cssPoints(value: string): number | undefined {
  const number = Number.parseFloat(value); if (!Number.isFinite(number)) return undefined;
  return value.endsWith("px") ? number * .75 : value.endsWith("mm") ? number * 72 / 25.4 : value.endsWith("cm") ? number * 72 / 2.54 : number;
}
function buildNumberingXml(ctx: ConvertContext): string {
  const definitions = [false, true].map((ordered, index) => `<w:abstractNum w:abstractNumId="${index}"><w:multiLevelType w:val="multilevel"/>${Array.from({ length: 9 }, (_, level) => `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${ordered ? "decimal" : "bullet"}"/><w:lvlText w:val="${ordered ? `%${level + 1}.` : "•"}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="${(level + 1) * 360}"/></w:tabs><w:ind w:left="${(level + 1) * 360}" w:hanging="360"/></w:pPr></w:lvl>`).join("")}</w:abstractNum>`).join("");
  const nums = ctx.lists.map(item => `<w:num w:numId="${item.id}"><w:abstractNumId w:val="${item.ordered ? 1 : 0}"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${item.start}"/></w:lvlOverride></w:num>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${definitions}${nums}</w:numbering>`;
}
function buildHeaderFooterXml(tag: "hdr" | "ftr", text: string, numbers: boolean): string {
  const paragraphs = text.split("\n").filter(Boolean).map(line => paragraphXml(`<w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`, {})).join("");
  const field = numbers ? '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' : "";
  return `<?xml version="1.0" encoding="UTF-8"?><w:${tag} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${paragraphs}${field}</w:${tag}>`;
}

function buildCoreXml(title: string): string {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dc:creator>HanWeb</dc:creator><cp:lastModifiedBy>HanWeb</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rIdCore" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rIdApp" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;

const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>HanWeb</Application></Properties>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="맑은 고딕" w:eastAsia="맑은 고딕" w:hAnsi="맑은 고딕" w:cs="맑은 고딕"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="200" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="160" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading5"><w:name w:val="heading 5"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading6"><w:name w:val="heading 6"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="60" w:after="120"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr></w:style></w:styles>`;
