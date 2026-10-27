import JSZip from "jszip";
import type { PageSettings } from "@/editor/document";
import { normalizePageSettings } from "@/editor/document";

/** Limits prevent a small compressed upload from expanding without bounds. */
export async function openDocumentPackage(data: ArrayBuffer | Uint8Array): Promise<JSZip> {
  if (data.byteLength > 64 * 1024 * 1024) throw new Error("64 MB 이하의 문서만 가져올 수 있습니다.");
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(data, { checkCRC32: false }); }
  catch { throw new Error("정상적인 ZIP 기반 문서 파일이 아닙니다."); }
  const entries = Object.values(zip.files).filter(file => !file.dir);
  if (entries.length > 5000) throw new Error("문서에 포함된 파일 수가 너무 많습니다.");
  let total = 0;
  for (const entry of entries) {
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    if (size > 32 * 1024 * 1024) throw new Error("문서 내부 파일이 너무 큽니다.");
    total += size;
  }
  if (total > 128 * 1024 * 1024) throw new Error("압축 해제한 문서 크기가 너무 큽니다.");
  return zip;
}

export function parseXml(xml: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("외부 엔터티가 포함된 XML은 지원하지 않습니다.");
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length) throw new Error("문서 XML 구조가 잘못되었습니다.");
  return document;
}

export function children(element: Element, name?: string): Element[] {
  return Array.from(element.children).filter(child => !name || child.localName === name);
}
export function child(element: Element | undefined | null, name: string): Element | undefined {
  return element ? children(element, name)[0] : undefined;
}
export function all(element: Element | Document, name: string): Element[] {
  return Array.from(element.getElementsByTagNameNS("*", name));
}
export function attr(element: Element | undefined | null, name: string): string {
  if (!element) return "";
  return Array.from(element.attributes).find(attribute => attribute.localName === name)?.value ?? "";
}
export function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export function imageMime(path: string): string | undefined {
  const ext = path.split(".").pop()?.toLowerCase();
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" } as Record<string, string>)[ext ?? ""];
}

/** App-only roundtrip data; ignored when an external editor changes XML parts. */
export async function writeSnapshot(zip: JSZip, content: string, pageSettings: PageSettings, paths: string[]) {
  const hashes: Record<string, string> = {};
  for (const path of paths) { const entry = zip.file(path); if (entry) hashes[path] = await hash(await entry.async("uint8array")); }
  zip.file("HanWeb/document.json", JSON.stringify({ version: 1, content, pageSettings, hashes }));
}
export async function readSnapshot(zip: JSZip): Promise<{ content: string; pageSettings: PageSettings } | undefined> {
  const file = zip.file("HanWeb/document.json");
  if (!file) return;
  try {
    const json = JSON.parse(await file.async("string"));
    if (json.version !== 1 || typeof json.content !== "string" || json.content.length > 32 * 1024 * 1024 || !json.hashes || typeof json.hashes !== "object" || Object.keys(json.hashes).length === 0) return;
    for (const [path, expected] of Object.entries(json.hashes)) {
      const entry = zip.file(path);
      if (!entry || await hash(await entry.async("uint8array")) !== expected) return;
    }
    const doc = new DOMParser().parseFromString(json.content, "text/html");
    for (const element of Array.from(doc.body.querySelectorAll("script,style,iframe,object,embed,link,meta,form,input,button"))) element.remove();
    for (const element of Array.from(doc.body.querySelectorAll("*"))) {
      for (const attribute of Array.from(element.attributes)) {
        if (/^on/i.test(attribute.name) || attribute.name === "srcdoc" || (attribute.name === "href" && !/^(https?:|mailto:|#)/i.test(attribute.value)) || (attribute.name === "src" && !/^data:image\/(png|jpeg|gif|webp|bmp);base64,/i.test(attribute.value))) element.removeAttribute(attribute.name);
      }
      if (/url\s*\(|expression\s*\(/i.test(element.getAttribute("style") ?? "")) element.removeAttribute("style");
    }
    return { content: doc.body.innerHTML, pageSettings: normalizePageSettings(json.pageSettings) };
  } catch { return; }
}
async function hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
