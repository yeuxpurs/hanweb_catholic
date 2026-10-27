import type { JSONContent } from "@tiptap/react";
import { normalizePageSettings, type PageSettings } from "./document";

export interface PortableImport {
  content: string | JSONContent;
  warnings: string[];
}

/** JSON text nodes keep literal markup, tabs, blank lines and Unicode intact. */
export function importPlainText(source: string): PortableImport {
  const lines = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\0/g, "").split("\n");
  return {
    content: { type: "doc", content: lines.map(text => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] })) },
    warnings: [],
  };
}

export function exportPlainText(text: string): Blob {
  // A BOM makes downloaded Korean text readable in older Windows editors too.
  return new Blob(["\uFEFF", text.replace(/\r\n?/g, "\n")], { type: "text/plain;charset=utf-8" });
}

export function isSafePortableLink(value: string): boolean {
  const url = value.trim();
  if (!url || /[\u0000-\u0020\u007f]/.test(url)) return false;
  if (url.startsWith("#")) return true;
  try { return ["http:", "https:", "mailto:"].includes(new URL(url).protocol); }
  catch { return false; }
}

const allowedTags = new Set(["P", "BR", "H1", "H2", "H3", "H4", "H5", "H6", "STRONG", "B", "EM", "I", "U", "S", "DEL", "SPAN", "SUP", "SUB", "MARK", "A", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "CODE", "HR", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TH", "TD", "IMG", "DIV"]);
const discardedTags = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "BASE", "TITLE", "HEAD", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "OPTION", "SVG", "MATH", "VIDEO", "AUDIO", "SOURCE", "TRACK", "CANVAS", "TEMPLATE", "NOSCRIPT"]);
const allowedStyles = new Set(["font-family", "font-size", "font-weight", "font-style", "text-decoration", "text-align", "color", "background-color", "line-height", "margin-top", "margin-bottom", "margin-left", "margin-right", "text-indent", "padding", "border-color", "border-width", "border-style", "vertical-align", "width", "height", "break-after", "page-break-after", "orphans", "widows"]);

/** Uses an inert template so importing HTML never loads its remote resources. */
export function sanitizePortableHtml(source: string): string {
  const template = document.createElement("template");
  template.innerHTML = source;
  const clean = (parent: ParentNode) => {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.COMMENT_NODE) { child.parentNode?.removeChild(child); continue; }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const element = child as HTMLElement;
      if (discardedTags.has(element.tagName)) { element.remove(); continue; }
      clean(element);
      if (!allowedTags.has(element.tagName)) { element.replaceWith(...Array.from(element.childNodes)); continue; }
      const attributes: Record<string, string> = {};
      for (const name of ["title", "alt"]) {
        if (element.hasAttribute(name)) attributes[name] = element.getAttribute(name)!;
      }
      if (element.tagName === "A") {
        const href = element.getAttribute("href")?.trim() ?? "";
        if (isSafePortableLink(href)) { attributes.href = href; attributes.rel = "noopener noreferrer"; }
      }
      if (element.tagName === "IMG") {
        const src = element.getAttribute("src") ?? "";
        if (!/^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[a-z\d+/=\s]+$/i.test(src)) {
          element.replaceWith(document.createTextNode(element.getAttribute("alt") ? `[그림: ${element.getAttribute("alt")}]` : "[외부 그림 제외]"));
          continue;
        }
        attributes.src = src;
        for (const name of ["width", "height"]) {
          const value = Number(element.getAttribute(name));
          if (Number.isFinite(value) && value > 0) attributes[name] = String(Math.min(10000, Math.round(value)));
        }
        for (const name of ["data-caption", "data-alignment"]) if (element.hasAttribute(name)) attributes[name] = element.getAttribute(name)!;
      }
      if (["TD", "TH"].includes(element.tagName)) {
        for (const name of ["colspan", "rowspan"]) {
          const value = Number(element.getAttribute(name));
          if (Number.isInteger(value) && value > 0) attributes[name] = String(Math.min(100, value));
        }
        const colwidth = element.getAttribute("data-colwidth");
        if (colwidth && /^\d{1,4}(,\d{1,4}){0,99}$/.test(colwidth)) attributes["data-colwidth"] = colwidth;
      }
      if (element.tagName === "OL") {
        const start = Number(element.getAttribute("start"));
        if (Number.isInteger(start) && start > 0 && start <= 100000) attributes.start = String(start);
      }
      if (element.tagName === "TABLE" && ["left", "center", "right"].includes(element.dataset.tableAlignment ?? "")) attributes["data-table-alignment"] = element.dataset.tableAlignment!;
      if (["DIV", "HR"].includes(element.tagName) && (element.hasAttribute("data-page-break") || element.dataset.type === "page-break")) {
        attributes["data-page-break"] = "true";
        attributes["data-type"] = "page-break";
      }
      if (["P", "H1", "H2", "H3", "H4", "H5", "H6"].includes(element.tagName) && element.dataset.widowControl === "false") attributes["data-widow-control"] = "false";
      const safeStyle = document.createElement("span").style;
      for (const property of Array.from(element.style)) {
        const value = element.style.getPropertyValue(property);
        if (allowedStyles.has(property) && !/(?:url|expression|var|attr)\s*\(|[\\@<>]/i.test(value)) safeStyle.setProperty(property, value);
      }
      for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name);
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
      if (safeStyle.cssText) element.setAttribute("style", safeStyle.cssText);
    }
  };
  clean(template.content);
  return template.innerHTML.trim() || "<p></p>";
}

export function importHtmlDocument(source: string): PortableImport {
  return {
    content: sanitizePortableHtml(source),
    warnings: ["HTML의 본문·주요 인라인 서식·표·내장 그림을 가져왔습니다. 스크립트, 외부 그림·스타일과 웹페이지 전용 기능은 제외됩니다. 용지 설정은 편집기에서 확인하세요."],
  };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function exportHtmlDocument(content: string, title: string, pageSettings?: PageSettings): Blob {
  const settings = normalizePageSettings(pageSettings);
  const { top, right, bottom, left } = settings.margins;
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title><style>
    body{margin:0;background:#eef1f5;font-family:'Malgun Gothic','맑은 고딕',sans-serif;color:#111;font-size:11pt;line-height:1.6}
    article{box-sizing:border-box;max-width:1000px;min-height:80vh;margin:24px auto;background:white;padding:${top}mm ${right}mm ${bottom}mm ${left}mm;overflow-wrap:anywhere}
    p{margin:0}h1,h2,h3,h4,h5,h6{break-after:avoid}table{border-collapse:collapse;width:100%;table-layout:fixed;margin:8px 0}td,th{border:1px solid #222;padding:5px;vertical-align:top}th{background:#f1f4f8}img{max-width:100%;height:auto}header,footer{font-size:9pt;color:#555;white-space:pre-wrap}header{margin-bottom:16px}footer{margin-top:16px}[data-page-break]{break-after:page;page-break-after:always}
    @page{size:${settings.paperSize} ${settings.orientation};margin:${top}mm ${right}mm ${bottom}mm ${left}mm}@media print{body{background:white}article{max-width:none;margin:0;padding:0;min-height:0}}@media(max-width:600px){article{margin:0;padding:20px}}
    </style></head><body><article>${settings.header ? `<header>${escapeHtml(settings.header)}</header>` : ""}${sanitizePortableHtml(content)}${settings.footer ? `<footer>${escapeHtml(settings.footer)}</footer>` : ""}</article></body></html>`;
  return new Blob([html], { type: "text/html;charset=utf-8" });
}
