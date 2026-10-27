/** Browser-only OOXML import. No macros, remote images, or active content run. */
import JSZip from "jszip";
import type { ImportResult } from "@/hwpx/importer";
import type { PageSettings } from "@/editor/document";
import { all, attr, base64, child, children, escapeXml as esc, imageMime, openDocumentPackage, parseXml, readSnapshot } from "./xml";

interface Relationship { path: string; external: boolean }
interface Context {
  zip: JSZip;
  relationships: Map<string, Relationship>;
  styles: Map<string, Element>;
  numbering: Map<string, { ordered: boolean; start: number }>;
  defaults?: Element;
  warnings: Set<string>;
}
interface Block { html: string; list?: { id: string; level: number; ordered: boolean; start: number } }

export async function importDocx(file: Blob): Promise<ImportResult> {
  return importDocxArrayBuffer(await file.arrayBuffer());
}

export async function importDocxArrayBuffer(data: ArrayBuffer | Uint8Array): Promise<ImportResult> {
  const zip = await openDocumentPackage(data);
  const typesFile = zip.file("[Content_Types].xml");
  const bodyFile = zip.file("word/document.xml");
  if (!typesFile || !bodyFile) throw new Error("DOCX의 필수 문서 구조를 찾을 수 없습니다. DOC 파일은 지원하지 않습니다.");
  const types = parseXml(await typesFile.async("string"));
  const mainType = all(types, "Override").find(item => attr(item, "PartName") === "/word/document.xml");
  if (!attr(mainType, "ContentType").includes("wordprocessingml.document.main+xml")) throw new Error("이 파일은 지원하는 DOCX 문서가 아닙니다.");
  const doc = parseXml(await bodyFile.async("string"));
  const body = all(doc, "body")[0];
  if (!body) throw new Error("DOCX에서 본문을 찾을 수 없습니다.");
  const ctx: Context = { zip, relationships: new Map(), styles: new Map(), numbering: new Map(), warnings: new Set() };
  const relationships = zip.file("word/_rels/document.xml.rels");
  if (relationships) {
    for (const rel of all(parseXml(await relationships.async("string")), "Relationship")) {
      const target = attr(rel, "Target");
      const external = attr(rel, "TargetMode") === "External";
      const segments = (target.startsWith("/") ? target.slice(1) : `word/${target}`).split("/");
      const parts: string[] = [];
      for (const segment of segments) { if (segment === "..") parts.pop(); else if (segment && segment !== ".") parts.push(segment); }
      ctx.relationships.set(attr(rel, "Id"), { path: external ? target : parts.join("/"), external });
    }
  }
  const stylesFile = zip.file("word/styles.xml");
  if (stylesFile) {
    const styles = parseXml(await stylesFile.async("string"));
    for (const style of all(styles, "style")) ctx.styles.set(attr(style, "styleId"), style);
    ctx.defaults = all(styles, "docDefaults")[0];
  }
  await readNumbering(ctx);
  for (const name of ["ins", "del", "commentRangeStart", "footnoteReference", "endnoteReference", "oMath", "sdt", "altChunk", "txbxContent"]) {
    if (all(body, name).length) ctx.warnings.add("변경 추적·주석·각주·수식·콘텐츠 컨트롤 등 고급 요소는 완전히 보존되지 않습니다. 원본 파일을 보관하세요.");
  }
  if (all(body, "sectPr").length > 1) ctx.warnings.add("여러 구역의 용지 설정은 마지막 구역의 단일 문서 설정으로 가져옵니다.");
  const blocks = await readBlocks(body, ctx);
  const pageSettings = await readPageSettings(body, ctx);
  const coreFile = zip.file("docProps/core.xml");
  const core = coreFile ? parseXml(await coreFile.async("string")) : null;
  ctx.warnings.add("DOCX 가져오기는 본문·주요 서식·목록·표·인라인 그림·단일 용지 설정을 지원합니다. Word와 글꼴 및 줄바꿈이 달라질 수 있습니다.");
  const snapshot = await readSnapshot(zip);
  if (snapshot) ctx.warnings.add("HanWeb에서 저장한 편집 상태를 복원했습니다. 외부 프로그램의 표시 결과와 동일함을 보장하는 것은 아닙니다.");
  return { content: snapshot?.content ?? (groupLists(blocks) || "<p></p>"), pageSettings: snapshot?.pageSettings ?? pageSettings, warnings: [...ctx.warnings], meta: { title: core ? all(core, "title")[0]?.textContent ?? undefined : undefined, author: core ? all(core, "creator")[0]?.textContent ?? undefined : undefined } };
}

async function readNumbering(ctx: Context) {
  const file = ctx.zip.file("word/numbering.xml");
  if (!file) return;
  const doc = parseXml(await file.async("string"));
  for (const num of all(doc, "num")) {
    const abstractId = attr(child(num, "abstractNumId"), "val");
    const abstract = all(doc, "abstractNum").find(item => attr(item, "abstractNumId") === abstractId);
    if (!abstract) continue;
    for (const level of children(abstract, "lvl")) {
      const override = children(num, "lvlOverride").find(item => attr(item, "ilvl") === attr(level, "ilvl"));
      const format = attr(child(level, "numFmt"), "val");
      if (!["decimal", "bullet"].includes(format)) ctx.warnings.add("일부 번호 목록 형식은 일반 숫자 목록으로 가져옵니다.");
      ctx.numbering.set(`${attr(num, "numId")}:${attr(level, "ilvl")}`, { ordered: format !== "bullet", start: Number(attr(child(override, "startOverride"), "val") || attr(child(level, "start"), "val") || 1) });
    }
  }
}

function styleChain(id: string, ctx: Context, seen = new Set<string>()): Element[] {
  if (!id || seen.has(id)) return [];
  seen.add(id);
  const style = ctx.styles.get(id);
  return style ? [...styleChain(attr(child(style, "basedOn"), "val"), ctx, seen), style] : [];
}

function paragraphProperties(p: Element, ctx: Context): Element[] {
  const properties = child(p, "pPr");
  const chain = styleChain(attr(child(properties, "pStyle"), "val"), ctx);
  return [...[child(child(ctx.defaults, "pPrDefault"), "pPr")], ...chain.map(item => child(item, "pPr")), properties].filter((item): item is Element => !!item);
}

function propertiesToStyle(properties: Element[], run = false): string {
  const css: Record<string, string> = {};
  for (const props of properties) {
    if (run) {
      const fonts = child(props, "rFonts");
      const font = attr(fonts, "eastAsia") || attr(fonts, "ascii");
      if (font) css["font-family"] = `'${font.replace(/[;'"]/g, "")}'`;
      const size = Number(attr(child(props, "sz"), "val"));
      if (size > 0 && size < 1000) css["font-size"] = `${size / 2}pt`;
      const color = attr(child(props, "color"), "val");
      if (/^[0-9a-f]{6}$/i.test(color)) css.color = `#${color}`;
      const fill = attr(child(props, "shd"), "fill");
      if (/^[0-9a-f]{6}$/i.test(fill)) css["background-color"] = `#${fill}`;
      const highlight = attr(child(props, "highlight"), "val");
      const colors: Record<string,string> = { yellow: "#ffff00", green: "#00ff00", cyan: "#00ffff", magenta: "#ff00ff", blue: "#0000ff", red: "#ff0000", darkYellow: "#808000", lightGray: "#d3d3d3" };
      if (colors[highlight]) css["background-color"] = colors[highlight];
    } else {
      const align = attr(child(props, "jc"), "val");
      if (["left", "right", "center", "both", "justify"].includes(align)) css["text-align"] = align === "both" ? "justify" : align;
      const ind = child(props, "ind");
      for (const [key, cssName] of [["left", "margin-left"], ["right", "margin-right"], ["firstLine", "text-indent"]]) {
        const value = attr(ind, key); if (value && Number.isFinite(Number(value))) css[cssName] = `${Number(value) / 20}pt`;
      }
      const hanging = attr(ind, "hanging"); if (hanging) css["text-indent"] = `${-Number(hanging) / 20}pt`;
      const spacing = child(props, "spacing");
      if (attr(spacing, "before")) css["margin-top"] = `${Number(attr(spacing, "before")) / 20}pt`;
      if (attr(spacing, "after")) css["margin-bottom"] = `${Number(attr(spacing, "after")) / 20}pt`;
      if (attr(spacing, "line")) css["line-height"] = attr(spacing, "lineRule") === "exact" ? `${Number(attr(spacing, "line")) / 20}pt` : String(Number(attr(spacing, "line")) / 240);
      if (child(props, "keepNext") && !["0", "false", "off"].includes(attr(child(props, "keepNext"), "val"))) css["break-after"] = "avoid";
    }
  }
  return Object.entries(css).map(([key, value]) => `${key}: ${value}`).join("; ");
}

async function readBlocks(parent: Element, ctx: Context): Promise<Block[]> {
  const blocks: Block[] = [];
  for (const element of children(parent)) {
    if (element.localName === "p") blocks.push(await readParagraph(element, ctx));
    else if (element.localName === "tbl") blocks.push({ html: await readTable(element, ctx) });
    else if (["sdt", "sdtContent", "ins"].includes(element.localName)) blocks.push(...await readBlocks(element, ctx));
  }
  return blocks;
}

async function readParagraph(p: Element, ctx: Context): Promise<Block> {
  const properties = paragraphProperties(p, ctx);
  const styleId = attr(child(child(p, "pPr"), "pStyle"), "val");
  const level = Number(/(?:heading|제목)\s*([1-6])/i.exec(styleId || attr(child(ctx.styles.get(styleId), "name"), "val"))?.[1]);
  const tag = level ? `h${level}` : "p";
  const style = propertiesToStyle(properties);
  const runProperties = styleChain(styleId, ctx).map(item => child(item, "rPr")).filter((item): item is Element => !!item);
  const html = await readInline(p, ctx, runProperties);
  const breakBefore = properties.some(props => !!child(props, "pageBreakBefore") && !["0", "false", "off"].includes(attr(child(props, "pageBreakBefore"), "val")));
  const numPr = properties.map(props => child(props, "numPr")).filter(Boolean).pop();
  const id = attr(child(numPr, "numId"), "val");
  const listLevel = Math.min(8, Math.max(0, Number(attr(child(numPr, "ilvl"), "val") || 0)));
  const number = ctx.numbering.get(`${id}:${listLevel}`);
  return { html: `${breakBefore ? '<div data-type="page-break"></div>' : ""}<${tag}${style ? ` style="${esc(style)}"` : ""}>${html || "<br>"}</${tag}>`, list: id && id !== "0" ? { id, level: listLevel, ordered: number?.ordered ?? true, start: number?.start ?? 1 } : undefined };
}

async function readInline(parent: Element, ctx: Context, inherited: Element[]): Promise<string> {
  let html = "";
  for (const element of children(parent)) {
    if (element.localName === "r") {
      const props = [...[child(child(ctx.defaults, "rPrDefault"), "rPr")], ...inherited, child(element, "rPr")].filter((item): item is Element => !!item);
      let text = "";
      for (const part of children(element)) {
        if (part.localName === "t") text += esc(part.textContent ?? "");
        else if (part.localName === "tab") text += "&emsp;";
        else if (part.localName === "br") text += attr(part, "type") === "page" ? '</p><div data-type="page-break"></div><p>' : "<br>";
        else if (part.localName === "cr") text += "<br>";
        else if (part.localName === "drawing") text += await readImage(part, ctx);
        else if (part.localName === "pict" || part.localName === "object") { text += "[지원하지 않는 개체]"; ctx.warnings.add("레거시 그림·OLE 개체는 가져오지 못했습니다."); }
      }
      const css = propertiesToStyle(props, true);
      if (css) text = `<span style="${esc(css)}">${text}</span>`;
      const toggles = (name: string) => { let value = false; for (const prop of props) { const toggle = child(prop, name); if (toggle) value = !["0", "false", "off", "none"].includes(attr(toggle, "val")); } return value; };
      if (toggles("b")) text = `<strong>${text}</strong>`;
      if (toggles("i")) text = `<em>${text}</em>`;
      if (toggles("u")) text = `<u>${text}</u>`;
      if (toggles("strike")) text = `<s>${text}</s>`;
      const vertical = props.map(prop => attr(child(prop, "vertAlign"), "val")).filter(Boolean).pop();
      if (vertical === "superscript") text = `<sup>${text}</sup>`;
      if (vertical === "subscript") text = `<sub>${text}</sub>`;
      html += text;
    } else if (["hyperlink", "ins", "sdt", "sdtContent", "smartTag", "fldSimple"].includes(element.localName)) {
      const text = await readInline(element, ctx, inherited);
      const href = ctx.relationships.get(attr(element, "id"))?.path;
      html += element.localName === "hyperlink" && href && /^(https?:|mailto:)/i.test(href) ? `<a href="${esc(href)}">${text}</a>` : text;
    }
  }
  return html;
}

async function readImage(drawing: Element, ctx: Context): Promise<string> {
  if (all(drawing, "anchor").length) ctx.warnings.add("떠 있는 그림은 본문 안 그림으로 가져옵니다.");
  const relationship = ctx.relationships.get(attr(all(drawing, "blip")[0], "embed"));
  const mime = relationship && !relationship.external ? imageMime(relationship.path) : undefined;
  const file = relationship && !relationship.external ? ctx.zip.file(relationship.path) : null;
  if (!file || !mime) { ctx.warnings.add("외부 연결 그림 또는 지원하지 않는 그림 형식을 가져오지 못했습니다."); return "[그림]"; }
  const bytes = await file.async("uint8array");
  const extent = all(drawing, "extent")[0];
  const width = Number(attr(extent, "cx")) / 9525;
  const height = Number(attr(extent, "cy")) / 9525;
  const description = all(drawing, "docPr")[0];
  return `<img src="data:${mime};base64,${base64(bytes)}" alt="${esc(attr(description, "descr") || attr(description, "name"))}"${width > 0 ? ` width="${Math.round(width)}"` : ""}${height > 0 ? ` height="${Math.round(height)}"` : ""}>`;
}

async function readTable(table: Element, ctx: Context): Promise<string> {
  const matrix: ({ html: string; rowSpan: number; colSpan: number; style: string; width: number; header: boolean } | null)[][] = [];
  const active = new Map<number, NonNullable<typeof matrix[number][number]>>();
  const grid = children(child(table, "tblGrid") ?? table, "gridCol").map(col => Number(attr(col, "w")) / 15);
  for (const [rowIndex, row] of children(table, "tr").entries()) {
    const cells: typeof matrix[number] = [];
    let col = Number(attr(child(child(row, "trPr"), "gridBefore"), "val")) || 0;
    const touched = new Set<number>();
    for (const tc of children(row, "tc")) {
      const props = child(tc, "tcPr");
      const span = Math.max(1, Math.min(100, Number(attr(child(props, "gridSpan"), "val")) || 1));
      const merge = child(props, "vMerge");
      const old = active.get(col);
      if (merge && attr(merge, "val") !== "restart" && old) {
        old.rowSpan++;
        for (let i = 0; i < span; i++) { touched.add(col + i); cells[col + i] = null; }
      } else {
        const fill = attr(child(props, "shd"), "fill");
        const valign = attr(child(props, "vAlign"), "val");
        let css = `${/^[a-f0-9]{6}$/i.test(fill) ? `background-color: #${fill}; ` : ""}${["top", "center", "bottom"].includes(valign) ? `vertical-align: ${valign === "center" ? "middle" : valign}; ` : ""}`;
        const tcMar = child(props, "tcMar");
        for (const side of ["top", "right", "bottom", "left"]) { const value = attr(child(tcMar, side), "w"); if (value && Number.isFinite(Number(value))) css += `padding-${side}: ${Number(value) / 20}pt; `; }
        const border = child(child(props, "tcBorders"), "top");
        const borderColor = attr(border, "color");
        const borderWidth = attr(border, "sz");
        const borderType = attr(border, "val");
        if (/^[a-f0-9]{6}$/i.test(borderColor)) css += `border-color: #${borderColor}; `;
        if (borderWidth && Number.isFinite(Number(borderWidth))) css += `border-width: ${Number(borderWidth) / 8}pt; `;
        if (borderType) css += `border-style: ${["dashed", "dotted", "double"].includes(borderType) ? borderType : ["nil", "none"].includes(borderType) ? "none" : "solid"}; `;
        const rowHeight = attr(child(child(row, "trPr"), "trHeight"), "val");
        if (rowHeight && Number.isFinite(Number(rowHeight))) css += `min-height: ${Number(rowHeight) / 20}pt; `;
        const value = { html: groupLists(await readBlocks(tc, ctx)) || "<p></p>", rowSpan: 1, colSpan: span, style: css, width: Number(attr(child(props, "tcW"), "w")) / 15 || grid.slice(col, col + span).reduce((a, b) => a + b, 0), header: !!child(child(row, "trPr"), "tblHeader") };
        cells[col] = value;
        for (let i = 0; i < span; i++) { if (merge) { active.set(col + i, value); touched.add(col + i); } else active.delete(col + i); if (i) cells[col + i] = null; }
      }
      col += span;
    }
    for (const key of active.keys()) if (!touched.has(key)) active.delete(key);
    matrix[rowIndex] = cells;
  }
  const align = attr(child(child(table, "tblPr"), "jc"), "val");
  const tableWidth = child(child(table, "tblPr"), "tblW");
  const width = Number(attr(tableWidth, "w"));
  const tableCss = `${["center", "right"].includes(align) ? `margin-left: auto; margin-right: ${align === "center" ? "auto" : "0"}; ` : ""}${width > 0 ? `width: ${attr(tableWidth, "type") === "pct" ? width / 50 + "%" : width / 20 + "pt"};` : ""}`;
  return `<table${tableCss ? ` style="${tableCss}"` : ""}><tbody>${matrix.map(row => `<tr>${row.filter(Boolean).map(cell => {
    if (!cell) return "";
    const tag = cell.header ? "th" : "td";
    return `<${tag}${cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : ""}${cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : ""}${cell.width > 0 ? ` data-colwidth="${Array.from({ length: cell.colSpan }, () => Math.round(cell.width / cell.colSpan)).join(",")}"` : ""}${cell.style ? ` style="${esc(cell.style)}"` : ""}>${cell.html}</${tag}>`;
  }).join("")}</tr>`).join("")}</tbody></table>`;
}

function groupLists(blocks: Block[]): string {
  let index = 0;
  function consume(level: number, id: string, ordered: boolean, start: number): string {
    const tag = ordered ? "ol" : "ul";
    let html = `<${tag}${ordered && start !== 1 ? ` start="${start}"` : ""}>`;
    while (index < blocks.length) {
      const block = blocks[index];
      if (!block.list || block.list.level < level || (block.list.level === level && block.list.id !== id)) break;
      if (block.list.level > level) { const nested = consume(block.list.level, block.list.id, block.list.ordered, block.list.start); html = html.endsWith("</li>") ? html.slice(0, -5) + nested + "</li>" : html + `<li><p></p>${nested}</li>`; }
      else { index++; html += `<li>${block.html}</li>`; }
    }
    return html + `</${tag}>`;
  }
  let html = "";
  while (index < blocks.length) {
    const block = blocks[index];
    if (block.list) html += consume(block.list.level, block.list.id, block.list.ordered, block.list.start);
    else { html += block.html; index++; }
  }
  return html;
}

async function readPageSettings(body: Element, ctx: Context): Promise<PageSettings> {
  const section = all(body, "sectPr").pop();
  const size = child(section, "pgSz");
  const w = Number(attr(size, "w")) / (1440 / 25.4);
  const h = Number(attr(size, "h")) / (1440 / 25.4);
  const orientation = attr(size, "orient") === "landscape" || w > h ? "landscape" : "portrait";
  const longer = Math.max(w, h);
  const paperSize = longer > 350 ? "A3" : "A4";
  if (longer && Math.abs(longer - (paperSize === "A3" ? 420 : 297)) > 5) ctx.warnings.add("사용자 지정 용지 크기는 가장 가까운 A4 또는 A3로 가져옵니다.");
  const margins = child(section, "pgMar");
  const mm = (name: string) => { const raw = attr(margins, name); return raw && Number.isFinite(Number(raw)) ? Math.max(0, Math.round(Number(raw) / (1440 / 25.4) * 100) / 100) : 20; };
  async function headerFooter(kind: "header" | "footer") {
    const ref = children(section ?? body, `${kind}Reference`).find(item => attr(item, "type") === "default") ?? child(section, `${kind}Reference`);
    const rel = ctx.relationships.get(attr(ref, "id"));
    const file = rel && !rel.external ? ctx.zip.file(rel.path) : null;
    if (!file) return { text: "", numbers: false };
    const doc = parseXml(await file.async("string"));
    if (all(doc, "tbl").length || all(doc, "drawing").length) ctx.warnings.add("머리말·꼬리말의 표와 그림은 텍스트로 단순화됩니다.");
    const paragraphs = all(doc, "p").map(readHeaderFooterParagraph);
    return { text: paragraphs.filter(p => p.text || !p.hasPageField).map(p => p.text).join("\n"), numbers: paragraphs.some(p => p.hasPageField) };
  }
  const header = await headerFooter("header");
  const footer = await headerFooter("footer");
  return { paperSize, orientation, margins: { top: mm("top"), right: mm("right"), bottom: mm("bottom"), left: mm("left") }, header: header.text, footer: footer.text, pageNumbers: header.numbers || footer.numbers };
}

/** A PAGE field's cached result is a display value, not ordinary footer text. */
function readHeaderFooterParagraph(paragraph: Element): { text: string; hasPageField: boolean } {
  let text = "";
  let hasPageField = false;
  const fields: { instruction: string }[] = [];
  const isPage = (instruction: string) => /\bPAGE\b/i.test(instruction);
  function visit(element: Element) {
    if (element.localName === "fldSimple" && isPage(attr(element, "instr"))) {
      hasPageField = true;
      return;
    }
    if (element.localName === "fldChar") {
      const type = attr(element, "fldCharType");
      if (type === "begin") fields.push({ instruction: "" });
      else if (type === "end") fields.pop();
      return;
    }
    if (element.localName === "instrText") {
      const field = fields[fields.length - 1];
      if (field) { field.instruction += element.textContent ?? ""; if (isPage(field.instruction)) hasPageField = true; }
      return;
    }
    if (element.localName === "t") {
      if (!fields.some(field => isPage(field.instruction))) text += element.textContent ?? "";
      return;
    }
    if (element.localName === "tab") { if (!fields.some(field => isPage(field.instruction))) text += "\t"; return; }
    if (element.localName === "br") { if (!fields.some(field => isPage(field.instruction))) text += "\n"; return; }
    for (const nested of children(element)) visit(nested);
  }
  visit(paragraph);
  return { text, hasPageField };
}
