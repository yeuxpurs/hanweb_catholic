import type { PageSettings } from "./document";

const PX_PER_MM = 96 / 25.4;

export interface PaginationResult {
  pages: string[];
  settings: PageSettings;
  widthMm: number;
  heightMm: number;
  warnings: string[];
}

export function paperDimensions(settings: PageSettings) {
  const size = settings.paperSize === "A3" ? [297, 420] : [210, 297];
  return settings.orientation === "landscape"
    ? { widthMm: size[1], heightMm: size[0] }
    : { widthMm: size[0], heightMm: size[1] };
}

export function escapePrintText(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}

/** The measuring frame, preview and printing use the same isolated stylesheet. */
export function printStyles(settings: PageSettings) {
  const { widthMm, heightMm } = paperDimensions(settings);
  const { top, right, bottom, left } = settings.margins;
  const bodyHeight = heightMm - top - bottom;
  return `
    * { box-sizing:border-box; }
    html,body { margin:0; padding:0; }
    body { background:#e5e9ef; font-family:"Malgun Gothic","맑은 고딕",sans-serif; }
    .hanweb-sheet { position:relative; width:${widthMm}mm; height:${heightMm}mm; margin:18px auto; padding:${top}mm ${right}mm ${bottom}mm ${left}mm; background:white; color:#000; box-shadow:0 2px 14px #0002; overflow:hidden; }
    .hanweb-page-body { height:${bodyHeight}mm; width:100%; display:flow-root; font-family:"함초롬바탕","HCR Batang","Malgun Gothic","맑은 고딕","Noto Serif KR",serif; font-size:10pt; line-height:1.6; overflow-wrap:anywhere; }
    .hanweb-page-body p { margin:0; padding:0; }
    .hanweb-page-body h1 { font-size:2em; }
    .hanweb-page-body h2 { font-size:1.5em; }
    .hanweb-page-body h3 { font-size:1.17em; }
    .hanweb-page-body h4,.hanweb-page-body h5,.hanweb-page-body h6 { font-size:1em; }
    .hanweb-page-body h1,.hanweb-page-body h2,.hanweb-page-body h3,.hanweb-page-body h4,.hanweb-page-body h5,.hanweb-page-body h6 { margin:0.65em 0 0.35em; font-weight:bold; }
    .hanweb-page-body ul,.hanweb-page-body ol { padding-left:2em; margin:0; }
    .hanweb-page-body blockquote { margin:0 0 0 1em; border-left:3px solid #bbb; padding-left:1em; }
    .hanweb-page-body table { border-collapse:collapse; width:100%; max-width:100%; min-width:0; table-layout:fixed; margin:8px 0; }
    .hanweb-page-body td,.hanweb-page-body th { border:1px solid #000; padding:4px 6px; min-width:25px; vertical-align:top; word-break:break-word; }
    .hanweb-page-body th { background:#f5f5f5; font-weight:bold; }
    .hanweb-page-body img { max-width:100%; max-height:${bodyHeight}mm; height:auto; display:block; margin:8px 0; object-fit:contain; }
    .hanweb-page-body figure { margin:10px 0; max-width:100%; }
    .hanweb-page-body figure img { margin:0; }
    .hanweb-page-body figure[data-alignment="center"] { margin-left:auto; margin-right:auto; }
    .hanweb-page-body figure[data-alignment="right"] { margin-left:auto; margin-right:0; }
    .hanweb-page-body figcaption { text-align:center; color:#516070; font-size:9pt; margin-top:5px; }
    .hanweb-page-body pre { white-space:pre-wrap; }
    .hanweb-page-body a { color:inherit; text-decoration:underline; }
    .hanweb-page-header,.hanweb-page-footer { position:absolute; left:${left}mm; right:${right}mm; overflow:hidden; white-space:pre-wrap; overflow-wrap:anywhere; font-size:9pt; line-height:1.3; }
    .hanweb-page-header { top:4mm; max-height:${Math.max(0, top - 6)}mm; }
    .hanweb-page-footer { bottom:4mm; max-height:${Math.max(0, bottom - 6)}mm; display:flex; justify-content:space-between; gap:8px; }
    .hanweb-page-number { flex-shrink:0; }
    .hanweb-page-body [data-type="page-break"],.hanweb-page-body [data-page-break] { display:none; }
    .hanweb-page-label { position:absolute; top:3px; right:5px; color:#a4abb5; font:10px sans-serif; }
    @page { size:${widthMm}mm ${heightMm}mm; margin:0; }
    @media print {
      html,body { background:white; }
      .hanweb-sheet { margin:0; box-shadow:none; break-after:page; page-break-after:always; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
      .hanweb-sheet:last-child { break-after:auto; page-break-after:auto; }
      .hanweb-page-label { display:none; }
    }
  `;
}

function sanitizePrintContent(doc: Document, html: string) {
  const source = doc.createElement("div");
  source.innerHTML = html;
  source.querySelectorAll("script,style,iframe,object,embed,link,meta,form,input,button,textarea,select").forEach(node => node.remove());
  source.querySelectorAll("*").forEach(element => {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || /^(srcdoc|contenteditable)$/i.test(attribute.name)) element.removeAttribute(attribute.name);
      if (/^(href|src)$/i.test(attribute.name) && /^\s*(javascript|vbscript):/i.test(attribute.value)) element.removeAttribute(attribute.name);
    }
    element.removeAttribute("id");
  });
  // Editor table wrappers affect neither the document nor the printed dimensions.
  source.querySelectorAll(".tableWrapper").forEach(wrapper => wrapper.replaceWith(...wrapper.childNodes));
  source.querySelectorAll<HTMLTableElement>("table").forEach(table => {
    table.style.removeProperty("min-width");
    const columns = [...table.querySelectorAll<HTMLTableColElement>("colgroup > col")];
    const widths = columns.map(column => Number.parseFloat(column.style.width || column.getAttribute("width") || ""));
    if (columns.length && widths.every(width => Number.isFinite(width) && width > 0) && columns.some(column => !column.style.width.endsWith("%"))) {
      const total = widths.reduce((sum, width) => sum + width, 0);
      columns.forEach((column, index) => { column.style.width = `${widths[index] / total * 100}%`; column.removeAttribute("width"); });
    }
  });
  source.querySelectorAll<HTMLImageElement>("img[data-caption]").forEach(img => {
    if (!img.dataset.caption || img.closest("figure")) return;
    const figure = doc.createElement("figure");
    figure.dataset.alignment = img.dataset.alignment || "left";
    if (img.width) figure.style.width = `${img.width}px`;
    else figure.style.width = "fit-content";
    const caption = doc.createElement("figcaption");
    caption.textContent = img.dataset.caption;
    img.replaceWith(figure); figure.append(img, caption);
  });
  return source;
}

async function waitForAssets(doc: Document) {
  await doc.fonts.ready;
  await Promise.all([...doc.images].map(img => img.complete ? Promise.resolve() : new Promise<void>(resolve => {
    const finish = () => resolve();
    img.addEventListener("load", finish, { once: true });
    img.addEventListener("error", finish, { once: true });
    setTimeout(finish, 5000);
  })));
}

function isPageBreak(node: HTMLElement) {
  return node.dataset.type === "page-break" || node.hasAttribute("data-page-break") || node.style.breakBefore === "page" || node.style.pageBreakBefore === "always";
}

interface TextBoundary { node: Text; offset: number }

function textBoundaries(node: HTMLElement): TextBoundary[] {
  const walker = node.ownerDocument.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const boundaries: TextBoundary[] = [];
  let text: Text | null;
  while ((text = walker.nextNode() as Text | null)) {
    // Grapheme clusters keep Korean syllables, surrogate pairs and combining marks together.
    const segmenter = typeof Intl.Segmenter !== "undefined" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
    if (segmenter) {
      for (const segment of segmenter.segment(text.data)) boundaries.push({ node: text, offset: segment.index + segment.segment.length });
    } else {
      let offset = 0;
      for (const char of text.data) { offset += char.length; boundaries.push({ node: text, offset }); }
    }
  }
  return boundaries;
}

function splitAt(node: HTMLElement, boundary: TextBoundary) {
  const doc = node.ownerDocument;
  const before = node.cloneNode(false) as HTMLElement;
  const after = node.cloneNode(false) as HTMLElement;
  const range = doc.createRange();
  range.setStart(node, 0);
  range.setEnd(boundary.node, boundary.offset);
  before.append(range.cloneContents());
  range.setStart(boundary.node, boundary.offset);
  range.setEnd(node, node.childNodes.length);
  after.append(range.cloneContents());
  before.style.marginBottom = "0";
  after.style.marginTop = "0";
  after.style.textIndent = "0";
  return [before, after] as const;
}

/**
 * Paginate a snapshot, never the editable ProseMirror DOM. Measurements use actual
 * laid out blocks. Paragraphs split at grapheme boundaries, tables at safe row
 * boundaries and headings stay with the next block when possible.
 */
export async function preparePrintDocument(html: string, settings: PageSettings): Promise<PaginationResult> {
  const { widthMm, heightMm } = paperDimensions(settings);
  const bodyHeight = (heightMm - settings.margins.top - settings.margins.bottom) * PX_PER_MM;
  const bodyWidth = widthMm - settings.margins.left - settings.margins.right;
  if (bodyHeight < 50 || bodyWidth < 20) throw new Error("용지 여백이 너무 커서 본문을 배치할 수 없습니다.");
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;left:-20000px;top:0;width:1800px;height:1800px;border:0;pointer-events:none";
  document.body.append(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${printStyles(settings)}</style></head><body></body></html>`);
  doc.close();
  const source = sanitizePrintContent(doc, html);
  source.style.cssText = `position:absolute;left:0;top:0;width:${bodyWidth}mm;visibility:hidden`;
  source.className = "hanweb-page-body";
  doc.body.append(source);
  const warnings = new Set<string>();
  const pages: HTMLElement[] = [];
  let current!: HTMLElement;
  const newPage = () => {
    const sheet = doc.createElement("section");
    sheet.className = "hanweb-sheet";
    current = doc.createElement("div");
    current.className = "hanweb-page-body";
    sheet.append(current);
    doc.body.append(sheet);
    pages.push(current);
  };
  const overflows = () => current.scrollHeight > current.clientHeight + 1;
  const tryAppend = (node: HTMLElement) => {
    current.append(node);
    if (!overflows()) return true;
    node.remove();
    return false;
  };
  const appendScaled = (node: HTMLElement) => {
    current.append(node);
    const scale = Math.min(1, bodyHeight / (node.getBoundingClientRect().height + 16));
    node.style.zoom = String(scale);
    warnings.add("한 페이지보다 큰 표 행 또는 개체를 페이지 안에 맞추기 위해 축소했습니다. 출력 전 글자 크기를 확인하세요.");
  };
  const splitTextBlock = async (initial: HTMLElement) => {
    let node = initial;
    let guard = 0;
    while (++guard < 10000) {
      if (guard % 4 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (tryAppend(node)) return;
      const points = textBoundaries(node);
      if (points.length < 2) {
        if (current.childNodes.length) newPage();
        if (!tryAppend(node)) appendScaled(node);
        return;
      }
      let low = 0;
      let high = points.length - 1;
      let best = -1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const [prefix] = splitAt(node, points[middle]);
        if (tryAppend(prefix)) { prefix.remove(); best = middle; low = middle + 1; }
        else high = middle - 1;
      }
      if (best < 0) { newPage(); continue; }
      let [prefix, suffix] = splitAt(node, points[best]);
      current.append(prefix);
      const lineHeight = Number.parseFloat(doc.defaultView!.getComputedStyle(prefix).lineHeight) || 21;
      const widowControl = node.dataset.widowControl !== "false";
      if (widowControl && prefix.getBoundingClientRect().height < 1.75 * lineHeight && current.childNodes.length > 1) {
        prefix.remove(); newPage(); continue;
      }
      // Avoid leaving a final line alone where this can be measured without
      // disturbing the editable document. Keep two lines on the next page.
      const probe = doc.createElement("div");
      probe.className = "hanweb-page-body";
      probe.style.cssText = `position:absolute;left:0;top:0;width:${bodyWidth}mm;height:auto;visibility:hidden`;
      probe.append(suffix); doc.body.append(probe);
      const suffixHeight = suffix.getBoundingClientRect().height;
      probe.remove();
      if (widowControl && suffixHeight > 0 && suffixHeight < lineHeight * 1.75 && best > 0 && prefix.getBoundingClientRect().height >= lineHeight * 3) {
        const targetHeight = prefix.getBoundingClientRect().height - lineHeight;
        prefix.remove();
        low = 0; high = best; let safer = 0;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          const [candidate] = splitAt(node, points[middle]);
          current.append(candidate);
          const fits = candidate.getBoundingClientRect().height <= targetHeight + 1;
          candidate.remove();
          if (fits) { safer = middle; low = middle + 1; } else high = middle - 1;
        }
        [prefix, suffix] = splitAt(node, points[safer]);
        current.append(prefix);
      }
      if (!suffix.textContent && !suffix.querySelector("img,br")) return;
      newPage(); node = suffix;
    }
    throw new Error("문단 페이지 배치가 반복 한도를 초과했습니다.");
  };
  const paginateList = (list: HTMLElement) => {
    const items = [...list.children].filter(node => node.tagName === "LI") as HTMLElement[];
    let segment: HTMLElement | null = null;
    let index = 0;
    const start = Number(list.getAttribute("start")) || 1;
    for (const original of items) {
      const item = original.cloneNode(true) as HTMLElement;
      if (!segment) {
        segment = list.cloneNode(false) as HTMLElement;
        if (list.tagName === "OL") segment.setAttribute("start", String(start + index));
        current.append(segment);
      }
      segment.append(item);
      if (overflows()) {
        item.remove();
        if (!segment.childNodes.length) segment.remove();
        if (current.childNodes.length) newPage();
        segment = list.cloneNode(false) as HTMLElement;
        if (list.tagName === "OL") segment.setAttribute("start", String(start + index));
        current.append(segment); segment.append(item);
        if (overflows()) {
          // Keep the numbering context and all nested content even if an
          // unusually tall list item needs to be reduced.
          appendScaled(segment); newPage(); segment = null;
        }
      }
      index++;
    }
  };
  const paginateTable = (table: HTMLTableElement) => {
    const rows = [...table.rows];
    const hasHeader = rows.length > 1 && [...rows[0].cells].every(cell => cell.tagName === "TH" && cell.rowSpan <= 1);
    const header = hasHeader ? rows.shift()! : null;
    let segment: HTMLTableElement | null = null;
    let tbody: HTMLTableSectionElement | null = null;
    const startSegment = () => {
      segment = table.cloneNode(false) as HTMLTableElement;
      [...table.children].filter(child => child.tagName === "COLGROUP" || child.tagName === "CAPTION").forEach(child => segment!.append(child.cloneNode(true)));
      if (header) { const head = doc.createElement("thead"); head.append(header.cloneNode(true)); segment.append(head); }
      tbody = doc.createElement("tbody"); segment.append(tbody); current.append(segment);
    };
    for (let index = 0; index < rows.length;) {
      let end = index + 1;
      // Never tear a merged cell across a table segment.
      for (let cursor = index; cursor < end && cursor < rows.length; cursor++) {
        for (const cell of [...rows[cursor].cells]) end = Math.max(end, Math.min(rows.length, cursor + cell.rowSpan));
      }
      const group = rows.slice(index, end).map(row => row.cloneNode(true) as HTMLTableRowElement);
      if (!segment) startSegment();
      group.forEach(row => tbody!.append(row));
      if (overflows()) {
        group.forEach(row => row.remove());
        if (!tbody!.rows.length) segment!.remove();
        if (current.childNodes.length) newPage();
        startSegment(); group.forEach(row => tbody!.append(row));
        if (overflows()) { appendScaled(segment!); newPage(); segment = null; tbody = null; }
      }
      index = end;
    }
    if (!rows.length) tryAppend(table);
  };
  try {
    await waitForAssets(doc);
    newPage();
    const blocks = [...source.children] as HTMLElement[];
    let lastYield = performance.now();
    for (let index = 0; index < blocks.length; index++) {
      if (performance.now() - lastYield > 40) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        lastYield = performance.now();
      }
      const original = blocks[index];
      if (isPageBreak(original)) { newPage(); continue; }
      const node = original.cloneNode(true) as HTMLElement;
      if (/^H[1-6]$/.test(node.tagName) || node.dataset.keepWithNext === "true") {
        const next = blocks[index + 1];
        if (next && !isPageBreak(next) && current.childNodes.length) {
          const following = next.cloneNode(true) as HTMLElement;
          current.append(node, following);
          const followsTooTall = following.getBoundingClientRect().height > bodyHeight;
          const nextLineHeight = Number.parseFloat(doc.defaultView!.getComputedStyle(following).lineHeight) || 21;
          const needsNextPage = followsTooTall
            ? node.getBoundingClientRect().bottom + nextLineHeight * 2 > current.getBoundingClientRect().top + bodyHeight
            : overflows();
          node.remove(); following.remove();
          if (needsNextPage) newPage();
        }
      }
      if (tryAppend(node)) continue;
      if (node.tagName === "TABLE") { paginateTable(node as HTMLTableElement); continue; }
      if (node.tagName === "UL" || node.tagName === "OL") { paginateList(node); continue; }
      if (/^(P|H[1-6]|BLOCKQUOTE|PRE)$/.test(node.tagName) && node.textContent) { await splitTextBlock(node); continue; }
      if (current.childNodes.length) newPage();
      if (!tryAppend(node)) appendScaled(node);
    }
    // A scaler may have prepared a new page after the last object. An explicit
    // final page break, however, legitimately creates a final blank page.
    const finalIsBreak = blocks.length > 0 && isPageBreak(blocks[blocks.length - 1]);
    if (!finalIsBreak) while (pages.length > 1 && !pages[pages.length - 1].childNodes.length) pages.pop();
    for (const part of ["header", "footer"] as const) {
      if (!settings[part]) continue;
      const probe = doc.createElement("div");
      probe.className = `hanweb-page-${part}`;
      probe.textContent = settings[part];
      pages[0].parentElement!.append(probe);
      if (probe.scrollHeight > probe.clientHeight + 1) warnings.add(`${part === "header" ? "머리말" : "꼬리말"}이 여백 영역보다 큽니다. ${part === "header" ? "위" : "아래"} 여백을 늘리거나 내용을 줄여 주세요.`);
      probe.remove();
    }
    return { pages: pages.map(page => page.innerHTML), settings: structuredClone(settings), widthMm, heightMm, warnings: [...warnings] };
  } finally {
    frame.remove();
  }
}

export function createPrintHTML(result: PaginationResult, title = "HanWeb 문서", zoom = 1) {
  const total = result.pages.length;
  const pages = result.pages.map((html, index) => `<section class="hanweb-sheet" data-page="${index + 1}"><div class="hanweb-page-label">${index + 1} / ${total}</div><header class="hanweb-page-header">${escapePrintText(result.settings.header || "")}</header><div class="hanweb-page-body">${html}</div><footer class="hanweb-page-footer"><span>${escapePrintText(result.settings.footer || "")}</span>${result.settings.pageNumbers ? `<span class="hanweb-page-number">${index + 1} / ${total}</span>` : ""}</footer></section>`).join("");
  // CSS zoom changes font/row rounding and can change wrapping near a page
  // boundary. Transform an already laid out stack instead: screen scale never
  // participates in the measured document's layout or the printed dimensions.
  const safeZoom = Math.max(0.1, Math.min(3, Number.isFinite(zoom) ? zoom : 1));
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapePrintText(title)}</title><style>${printStyles(result.settings)}
    @media screen {
      body { min-width:calc(${result.widthMm}mm * ${safeZoom}); }
      .hanweb-preview-sizer { width:calc(${result.widthMm}mm * ${safeZoom}); height:calc((${result.heightMm * total}mm + ${(total + 1) * 18}px) * ${safeZoom}); margin:0 auto; overflow:hidden; }
      .hanweb-preview-stack { display:flow-root; width:${result.widthMm}mm; transform:scale(${safeZoom}); transform-origin:top left; }
    }
  </style></head><body><div class="hanweb-preview-sizer"><div class="hanweb-preview-stack">${pages}</div></div></body></html>`;
}

export async function printDocument(result: PaginationResult, title = "HanWeb 문서") {
  const frame = document.createElement("iframe");
  frame.title = "HanWeb 인쇄 문서";
  frame.style.cssText = "position:fixed;left:-20000px;top:0;width:1800px;height:1800px;border:0";
  document.body.append(frame);
  const doc = frame.contentDocument!;
  doc.open(); doc.write(createPrintHTML(result, title)); doc.close();
  await waitForAssets(doc);
  const win = frame.contentWindow!;
  win.addEventListener("afterprint", () => frame.remove(), { once: true });
  win.focus(); win.print();
  // Browsers which omit afterprint still release the isolated snapshot later.
  setTimeout(() => frame.remove(), 120000);
}
