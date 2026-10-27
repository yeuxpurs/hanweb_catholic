/**
 * HWPX Importer - parses ZIP-based OWPML/HWPX files into TipTap-friendly HTML.
 */
import JSZip from "jszip";
import { HwpxReader } from "hwp-convert";
import { decodeXmlBytes, repairKoreanMojibake } from "@/utils/textEncoding";
import { normalizePageSettings, type PageSettings } from "@/editor/document";
import { all, attr, child, openDocumentPackage, parseXml, readSnapshot } from "@/docx/xml";

export interface ImportResult {
  content: string;
  meta?: { title?: string; author?: string };
  pageSettings?: PageSettings;
  warnings?: string[];
}

const BLOCK_NAMES = new Set(["p", "para", "tbl", "table", "pic", "image", "img", "picture"]);
const PARA_NAMES = new Set(["p", "para"]);
const TABLE_NAMES = new Set(["tbl", "table"]);
const ROW_NAMES = new Set(["tr"]);
const CELL_NAMES = new Set(["tc", "td", "th"]);
const IMAGE_NAMES = new Set(["pic", "image", "img", "picture"]);
const XML_EXT = /\.xml$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|webp)$/i;
type ImageMap = Map<string, string>;

export async function importHwpx(file: Blob): Promise<ImportResult> {
  const buffer = await file.arrayBuffer();
  return importHwpxArrayBuffer(buffer);
}

export async function importHwpxArrayBuffer(data: ArrayBuffer | Uint8Array): Promise<ImportResult> {
  const buffer = toStandaloneArrayBuffer(data);
  const zip = await openDocumentPackage(buffer);
  const sections = findSectionFiles(zip);
  if (!zip.file("Contents/header.xml") || sections.length === 0) throw new Error("HWPX의 필수 머리 정보와 본문 섹션을 찾을 수 없습니다.");
  const sectionDocs = [];
  for (const path of sections) sectionDocs.push(parseXml(await readZipText(zip.file(path)!)));
  const snapshot = await readSnapshot(zip);
  const page = all(sectionDocs[0], "pagePr")[0];
  const margin = child(page, "margin");
  const hwpMm = (name: string) => Number(attr(margin, name)) * 25.4 / 7200;
  const settings = normalizePageSettings({ paperSize: Number(attr(page, "height")) > 100000 ? "A3" : "A4", orientation: attr(page, "landscape") === "NARROWLY" ? "landscape" : "portrait", margins: { top: hwpMm("top") || 25, right: hwpMm("right") || 30, bottom: hwpMm("bottom") || 25, left: hwpMm("left") || 30 } });
  const warnings = ["HWPX의 주요 본문 서식·표·그림을 가져옵니다. 구역·머리말·꼬리말·각주·수식·추적 변경 등 고급 요소의 보존은 제한됩니다. 원본을 보관하세요."];
  if (sections.length > 1) warnings.push("여러 구역의 용지 설정은 첫 구역의 단일 문서 설정으로 가져옵니다.");
  if (snapshot) return { ...snapshot, warnings: [...warnings, "HanWeb에서 저장한 편집 상태를 복원했습니다. 외부 프로그램의 배치와는 차이가 있을 수 있습니다."] };
  try {
    return { ...await importWithHwpConvert(buffer), pageSettings: settings, warnings };
  } catch (error) {
    console.warn("HWPX rich import failed; falling back to lightweight parser.", error);
    return { ...await importHwpxFallback(buffer), pageSettings: settings, warnings: [...warnings, "상세 서식 변환에 실패하여 간단한 본문·표·그림 파서로 가져왔습니다. 일부 서식이 손실될 수 있습니다."] };
  }
}

async function importWithHwpConvert(buffer: ArrayBuffer): Promise<ImportResult> {
  const reader = new HwpxReader();
  await reader.loadFromArrayBuffer(buffer);

  const [html, info] = await Promise.all([
    reader.extractHtml({
      paragraphTag: "p",
      renderImages: true,
      renderTables: true,
      renderStyles: true,
      embedImages: true,
      tableHeaderFirstRow: false,
    }),
    reader.getDocumentInfo().catch(() => null),
  ]);

  const content = html.trim() || textToParagraphs(await reader.extractText().catch(() => "")) || "<p></p>";

  return {
    content,
    meta: {
      title: info?.metadata.title,
      author: info?.metadata.creator,
    },
  };
}

async function importHwpxFallback(buffer: ArrayBuffer): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(buffer);
  const sectionFiles = findSectionFiles(zip);
  const imageMap = await buildImageMap(zip);

  if (sectionFiles.length === 0) {
    throw new Error("HWPX 파일에서 본문 섹션을 찾을 수 없습니다.");
  }

  let html = "";
  for (const sectionPath of sectionFiles) {
    const sectionFile = zip.file(sectionPath);
    if (!sectionFile) continue;

    const xmlStr = await readZipText(sectionFile);
    html += parseSection(xmlStr, imageMap);
  }

  return { content: html || "<p></p>" };
}

function toStandaloneArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;

  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function findSectionFiles(zip: JSZip): string[] {
  const sectionFiles: string[] = [];

  zip.forEach((path) => {
    if (/^Contents\/[Ss]ection\d*\.xml$/.test(path)) {
      sectionFiles.push(path);
    }
  });

  if (sectionFiles.length === 0) {
    zip.forEach((path) => {
      const normalized = path.toLowerCase();
      if (normalized.startsWith("contents/") && /section\d*\.xml$/.test(normalized)) {
        sectionFiles.push(path);
      }
    });
  }

  return sectionFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function addHeaderImageAliases(xml: string, imageMap: ImageMap) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");
  if (doc.getElementsByTagName("parsererror")[0]) return;

  for (const element of Array.from(doc.getElementsByTagName("*"))) {
    const attrs = Array.from(element.attributes);
    const attrValues = attrs.map((attr) => attr.value).filter(Boolean);
    const imagePath = attrValues.find((value) => looksLikeImageReference(value));
    if (!imagePath) continue;

    const url = findImageAlias(imageMap, imagePath);
    if (!url) continue;

    for (const attr of attrs) {
      if (["id", "name", "refid", "refId", "binaryItemID", "binaryItemIDRef"].includes(attr.name)) {
        addImageAlias(imageMap, attr.value, url);
      }
    }
  }
}

function addImageAlias(imageMap: ImageMap, key: string, url: string) {
  for (const alias of imageAliases(key)) {
    imageMap.set(alias, url);
  }
}

function findImageAlias(imageMap: ImageMap, key: string): string | null {
  for (const alias of imageAliases(key)) {
    const url = imageMap.get(alias);
    if (url) return url;
  }

  return null;
}

function imageAliases(value: string): string[] {
  const normalized = normalizeRef(value);
  if (!normalized) return [];

  const parts = normalized.split("/");
  const baseName = parts[parts.length - 1];
  const withoutExt = baseName.replace(IMAGE_EXT, "");

  return Array.from(new Set([normalized, baseName, withoutExt]));
}

function normalizeRef(value: string): string {
  return value
    .replace(/^#/, "")
    .replace(/^\.?\//, "")
    .replace(/\\/g, "/")
    .replace(/^contents\//i, "")
    .toLowerCase()
    .trim();
}

function looksLikeImageReference(value: string): boolean {
  const normalized = normalizeRef(value);
  return IMAGE_EXT.test(normalized) || normalized.includes("bindata/");
}

function mimeFromImage(path: string, bytes: Uint8Array): string | null {
  const normalized = path.toLowerCase();
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg";
  if (normalized.endsWith(".gif")) return "image/gif";
  if (normalized.endsWith(".bmp")) return "image/bmp";
  if (normalized.endsWith(".webp")) return "image/webp";

  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

async function buildImageMap(zip: JSZip): Promise<ImageMap> {
  const imageMap: ImageMap = new Map();
  const imagePaths: string[] = [];
  const xmlPaths: string[] = [];

  zip.forEach((path, entry) => {
    if (entry.dir) return;
    if (IMAGE_EXT.test(path) || path.toLowerCase().includes("/bindata/")) {
      imagePaths.push(path);
    }
    if (XML_EXT.test(path)) {
      xmlPaths.push(path);
    }
  });

  for (const path of imagePaths) {
    const file = zip.file(path);
    if (!file) continue;

    const bytes = await file.async("uint8array");
    const mime = mimeFromImage(path, bytes);
    if (!mime) continue;

    const data = uint8ArrayToBase64(bytes);
    const url = `data:${mime};base64,${data}`;
    addImageAlias(imageMap, path, url);
  }

  for (const path of xmlPaths) {
    const file = zip.file(path);
    if (!file) continue;

    try {
      const xml = await readZipText(file);
      addHeaderImageAliases(xml, imageMap);
    } catch {
      // Ignore non-text XML-like entries.
    }
  }

  return imageMap;
}

async function readZipText(file: JSZip.JSZipObject): Promise<string> {
  const bytes = await file.async("uint8array");
  return decodeXmlBytes(bytes);
}

function parseSection(xml: string, imageMap: ImageMap): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");
  const parseError = doc.getElementsByTagName("parsererror")[0];
  if (parseError) {
    throw new Error("HWPX XML을 읽는 중 오류가 발생했습니다.");
  }

  const section = firstByLocalName(doc.documentElement, ["sec", "section", "body"]) ?? doc.documentElement;
  const html = blocksToHtml(section, imageMap);
  if (html) return html;

  const fallbackText = cleanupText(section.textContent ?? "");
  return fallbackText ? textToParagraphs(fallbackText) : "<p></p>";
}

function blocksToHtml(container: Element, imageMap: ImageMap): string {
  let html = "";

  for (const child of elementChildren(container)) {
    const name = localName(child);

    if (PARA_NAMES.has(name)) {
      html += paragraphToHtml(child, imageMap);
      continue;
    }

    if (TABLE_NAMES.has(name)) {
      html += tableToHtml(child, imageMap);
      continue;
    }

    if (IMAGE_NAMES.has(name)) {
      html += imageToHtml(child, imageMap, true);
      continue;
    }

    if (containsBlock(child)) {
      html += blocksToHtml(child, imageMap);
    }
  }

  return html;
}

function paragraphToHtml(para: Element, imageMap: ImageMap): string {
  if (hasTableOrImage(para)) {
    let html = "";
    const align = readAlign(para);
    const inline = inlineContentToHtml(para, imageMap, true).trim();
    if (inline) {
      const style = align ? ` style="text-align: ${align}"` : "";
      html += `<p${style}>${inline}</p>`;
    }
    for (const table of topLevelDescendants(para, TABLE_NAMES)) {
      html += tableToHtml(table, imageMap);
    }
    for (const image of topLevelDescendants(para, IMAGE_NAMES)) {
      html += imageToHtml(image, imageMap, true);
    }
    return html || "<p><br /></p>";
  }

  const align = readAlign(para);
  const content = inlineContentToHtml(para, imageMap, false).trim();
  const style = align ? ` style="text-align: ${align}"` : "";
  return `<p${style}>${content || "<br />"}</p>`;
}

function inlineContentToHtml(element: Element, imageMap: ImageMap, skipBlockControls: boolean): string {
  let html = "";

  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = cleanupInlineText(child.textContent ?? "");
      if (text) html += esc(text);
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const childEl = child as Element;
    const name = localName(childEl);

    if (skipBlockControls && (TABLE_NAMES.has(name) || IMAGE_NAMES.has(name) || hasTableOrImage(childEl))) {
      continue;
    }

    if (name === "t") {
      html += esc(childEl.textContent ?? "");
      continue;
    }

    if (name === "linebreak" || name === "br") {
      html += "<br />";
      continue;
    }

    if (name === "tab") {
      html += "&emsp;";
      continue;
    }

    if (name === "tbl" || name === "table") {
      html += tableToHtml(childEl, imageMap);
      continue;
    }

    if (IMAGE_NAMES.has(name)) {
      html += imageToHtml(childEl, imageMap, false);
      continue;
    }

    if (name === "charpr" || name === "parapr" || name === "ppr" || name === "rpr") {
      continue;
    }

    const nested = inlineContentToHtml(childEl, imageMap, skipBlockControls);
    html += applyInlineMarks(childEl, nested);
  }

  return html;
}

function tableToHtml(table: Element, imageMap: ImageMap): string {
  const rows = tableRows(table);
  if (rows.length === 0) {
    const text = cleanupText(table.textContent ?? "");
    return text ? textToParagraphs(text) : "";
  }

  let html = "<table><tbody>";

  rows.forEach((row, rowIndex) => {
    const cells = elementChildren(row).filter((child) => CELL_NAMES.has(localName(child)));
    if (cells.length === 0) return;

    html += "<tr>";
    cells.forEach((cell) => {
      const tag = rowIndex === 0 ? "th" : "td";
      const spanAttrs = spanAttributes(cell);
      const cellContent = cellToHtml(cell, imageMap);
      html += `<${tag}${spanAttrs}>${cellContent || "<p></p>"}</${tag}>`;
    });
    html += "</tr>";
  });

  html += "</tbody></table>";
  return html;
}

function cellToHtml(cell: Element, imageMap: ImageMap): string {
  const blockHtml = blocksToHtml(cell, imageMap);
  if (blockHtml) return blockHtml;

  const text = cleanupText(cell.textContent ?? "");
  return text ? textToParagraphs(text) : "";
}

function imageToHtml(image: Element, imageMap: ImageMap, block: boolean): string {
  const url = resolveImageUrl(image, imageMap);
  if (!url) {
    return block ? "<p><em>[그림]</em></p>" : "<span>[그림]</span>";
  }

  const alt = esc(readImageAlt(image));
  const html = `<img src="${url}" alt="${alt}" />`;
  return block ? html : html;
}

function tableRows(table: Element): Element[] {
  const directRows = elementChildren(table).filter((child) => ROW_NAMES.has(localName(child)));
  if (directRows.length > 0) return directRows;

  return topLevelDescendants(table, ROW_NAMES);
}

function spanAttributes(cell: Element): string {
  const colSpan = readSpan(cell, "col");
  const rowSpan = readSpan(cell, "row");
  const attrs: string[] = [];

  if (colSpan > 1) attrs.push(`colspan="${colSpan}"`);
  if (rowSpan > 1) attrs.push(`rowspan="${rowSpan}"`);

  return attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
}

function readSpan(cell: Element, axis: "row" | "col"): number {
  const attrNames =
    axis === "row"
      ? ["rowspan", "rowSpan", "rowCnt", "rowCount"]
      : ["colspan", "colSpan", "colCnt", "colCount", "gridSpan"];
  const candidates = [cell, ...descendantsByLocalName(cell, new Set(["cellspan", "cellSpan", "span"]))];

  for (const element of candidates) {
    for (const attr of attrNames) {
      const raw = element.getAttribute(attr);
      const parsed = raw ? Number.parseInt(raw, 10) : 0;
      if (Number.isFinite(parsed) && parsed > 1) return Math.min(parsed, 100);
    }
  }

  return 1;
}

function hasTableOrImage(element: Element): boolean {
  return topLevelDescendants(element, TABLE_NAMES).length > 0 || topLevelDescendants(element, IMAGE_NAMES).length > 0;
}

function topLevelDescendants(root: Element, names: Set<string>): Element[] {
  const matches: Element[] = [];

  const visit = (element: Element) => {
    for (const child of elementChildren(element)) {
      const childName = localName(child);
      if (names.has(childName)) {
        matches.push(child);
        continue;
      }
      visit(child);
    }
  };

  visit(root);
  return matches;
}

function resolveImageUrl(image: Element, imageMap: ImageMap): string | null {
  for (const value of collectAttributeValues(image)) {
    const direct = findImageAlias(imageMap, value);
    if (direct) return direct;

    const cleaned = value.replace(/^#/, "");
    const cleanedMatch = findImageAlias(imageMap, cleaned);
    if (cleanedMatch) return cleanedMatch;
  }

  return null;
}

function collectAttributeValues(element: Element): string[] {
  const values: string[] = [];
  const visit = (current: Element) => {
    for (const attr of Array.from(current.attributes)) {
      if (attr.value) values.push(attr.value);
    }
    for (const child of elementChildren(current)) {
      visit(child);
    }
  };

  visit(element);
  return values;
}

function readImageAlt(image: Element): string {
  for (const element of [image, ...descendantsByLocalName(image, IMAGE_NAMES)]) {
    const alt = element.getAttribute("alt") ?? element.getAttribute("desc") ?? element.getAttribute("name") ?? "";
    if (alt.trim()) return alt.trim();
  }

  return "그림";
}

function applyInlineMarks(element: Element, html: string): string {
  if (!html) return "";

  const attrs = attributesAsText(element).toLowerCase();
  let result = html;

  if (/\bbold\s*=\s*["']?(true|1)|font-weight\s*:\s*bold/.test(attrs)) {
    result = `<strong>${result}</strong>`;
  }
  if (/\bitalic\s*=\s*["']?(true|1)|font-style\s*:\s*italic/.test(attrs)) {
    result = `<em>${result}</em>`;
  }
  if (/\bunderline\s*=\s*["']?(?!none|false)|text-decoration\s*:\s*underline/.test(attrs)) {
    result = `<u>${result}</u>`;
  }

  return result;
}

function readAlign(para: Element): string {
  const paraPr = firstChildByLocalName(para, ["paraPr", "pPr"]);
  const raw =
    para.getAttribute("align") ??
    para.getAttribute("textAlign") ??
    paraPr?.getAttribute("align") ??
    paraPr?.getAttribute("textAlign") ??
    "";

  const value = raw.toLowerCase();
  const map: Record<string, string> = {
    left: "left",
    start: "left",
    center: "center",
    centre: "center",
    right: "right",
    end: "right",
    justify: "justify",
    both: "justify",
  };

  return map[value] ?? "";
}

function textToParagraphs(text: string): string {
  const paragraphs = cleanupText(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  return paragraphs.map((line) => `<p>${esc(line)}</p>`).join("") || "<p></p>";
}

function containsBlock(element: Element): boolean {
  return descendantsByLocalName(element, BLOCK_NAMES).length > 0;
}

function descendantsByLocalName(root: Element, names: Set<string>): Element[] {
  const matches: Element[] = [];
  const visit = (element: Element) => {
    for (const child of elementChildren(element)) {
      if (names.has(localName(child))) {
        matches.push(child);
      }
      visit(child);
    }
  };
  visit(root);
  return matches;
}

function firstByLocalName(root: Element, names: string[]): Element | null {
  if (names.includes(localName(root))) return root;

  for (const child of elementChildren(root)) {
    const match = firstByLocalName(child, names);
    if (match) return match;
  }

  return null;
}

function firstChildByLocalName(root: Element, names: string[]): Element | null {
  const normalized = names.map((name) => name.toLowerCase());
  return elementChildren(root).find((child) => normalized.includes(localName(child))) ?? null;
}

function elementChildren(element: Element): Element[] {
  return Array.from(element.children);
}

function localName(element: Element): string {
  return (element.localName || element.nodeName.split(":").pop() || "").toLowerCase();
}

function attributesAsText(element: Element): string {
  return Array.from(element.attributes)
    .map((attr) => `${attr.name}=${attr.value}`)
    .join(" ");
}

function cleanupInlineText(text: string): string {
  return repairKoreanMojibake(text).replace(/\s+/g, " ");
}

function cleanupText(text: string): string {
  return repairKoreanMojibake(text).replace(/\r/g, "\n").replace(/[ \t\f\v]+/g, " ").replace(/\n\s+/g, "\n").trim();
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
