/**
 * Legacy HWP importer.
 *
 * HWP 5.x files are OLE compound files. This importer reads BodyText section
 * streams, inflates compressed sections when needed, and extracts PARA_TEXT
 * records. It does not preserve full layout yet, but avoids the previous
 * "scan the whole binary" behavior that mixed document text with container data.
 */
import * as CFB from "cfb";
import { inflate, inflateRaw } from "pako";
import { hwpToHwpx } from "hwp-convert";
import type { ImportResult } from "@/hwpx/importer";
import { importHwpxArrayBuffer } from "@/hwpx/importer";
import { decodeReadableTextBytes, repairKoreanMojibake } from "@/utils/textEncoding";

const HWP_TAG_PARA_TEXT = 67;
const MIN_MEANINGFUL_CHARS = 1;
const MAX_PARAGRAPHS = 2000;

interface HwpFlags {
  compressed: boolean;
  passwordProtected: boolean;
  distribution: boolean;
}

export interface ImportHwpOptions { mode?: "auto" | "text" }

export async function importLegacyHwp(file: Blob, options: ImportHwpOptions = {}): Promise<ImportResult> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength > 64 * 1024 * 1024) throw new Error("64 MB 이하의 HWP 파일만 가져올 수 있습니다.");
  if (![0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1].every((value, index) => bytes[index] === value)) throw new Error("HWP 5.x OLE 파일이 아닙니다. 확장자만 바꾼 파일은 열 수 없습니다.");
  const container = CFB.read(bytes, { type: "array" });
  const header = findEntry(container, "FileHeader");
  if (!header || !new TextDecoder().decode(toUint8Array(header.content).slice(0, 32)).startsWith("HWP Document File")) throw new Error("HWP 파일 머리 정보가 잘못되었습니다.");
  const flags = readHwpFlags(container);
  if (flags.passwordProtected || flags.distribution) throw new Error("암호 문서와 배포용 HWP는 이 브라우저 가져오기에서 지원하지 않습니다.");

  if (options.mode !== "text") {
    try {
      const hwpxBytes = await hwpToHwpx(bytes, {
        title: "HanWeb converted document",
        creator: "HanWeb",
      });
      const result = await importHwpxArrayBuffer(hwpxBytes);
      return { ...result, warnings: ["HWP를 HWPX 구조로 변환하여 가져왔습니다. 일부 서식·개체가 손실될 수 있습니다. 실제 HWP 원본 호환성은 미검증이며 HWP 원형식 저장은 지원하지 않습니다.", ...(result.warnings ?? [])] };
    } catch (error) {
      console.warn("HWP rich conversion failed; falling back to text extraction.", error);
    }
  }

  let paragraphs: string[] = [];
  try {
    paragraphs = extractFromOle(bytes);
  } catch (error) {
    console.warn("HWP structured import failed; falling back to preview text.", error);
  }

  if (countMeaningfulCharacters(paragraphs.join("")) < MIN_MEANINGFUL_CHARS) {
    throw new Error("레거시 HWP에서 본문 텍스트를 충분히 추출하지 못했습니다. 암호화되었거나 지원하지 않는 압축/배포용 문서일 수 있습니다.");
  }

  return {
    content: paragraphs.slice(0, MAX_PARAGRAPHS).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join(""),
    meta: {},
    warnings: [`${options.mode === "text" ? "선택한 텍스트 전용 가져오기로" : "HWP 상세 변환에 실패하여"} 본문/미리보기 텍스트만 추출했습니다. 서식·표·그림·용지 설정은 보존되지 않습니다. HWPX 또는 DOCX로 저장하세요.`],
  };
}

function extractFromOle(bytes: Uint8Array): string[] {
  const container = CFB.read(bytes, { type: "array" });
  const flags = readHwpFlags(container);

  if (flags.passwordProtected) {
    throw new Error("암호가 걸린 HWP 파일은 브라우저에서 열 수 없습니다.");
  }

  const bodyEntries = container.FileIndex
    .filter((entry) => isBodyTextSection(entry.name) || isBodyTextSection(pathForEntry(container, entry.name)))
    .sort((a, b) => sectionNumber(a.name) - sectionNumber(b.name));

  const paragraphs: string[] = [];

  for (const entry of bodyEntries) {
    const sectionBytes = decodeSection(toUint8Array(entry.content), flags.compressed);
    paragraphs.push(...extractParagraphTextRecords(sectionBytes));
  }

  if (paragraphs.length > 0) {
    return paragraphs.map(cleanupText).filter(Boolean).slice(0, MAX_PARAGRAPHS);
  }

  const preview = readPreviewText(container);
  return preview ? normalizeFragments([preview], true) : [];
}

function readHwpFlags(container: CFB.CFB$Container): HwpFlags {
  const fileHeader = findEntry(container, "FileHeader");
  if (!fileHeader) {
    return { compressed: false, passwordProtected: false, distribution: false };
  }

  const header = toUint8Array(fileHeader.content);
  const flags = header.length >= 40 ? readUint32LE(header, 36) : 0;

  return {
    compressed: (flags & 0x01) !== 0,
    passwordProtected: (flags & 0x02) !== 0,
    distribution: (flags & 0x04) !== 0,
  };
}

function decodeSection(bytes: Uint8Array, compressed: boolean): Uint8Array {
  if (!compressed) return bytes;

  try {
    return inflateRaw(bytes);
  } catch {
    return inflate(bytes);
  }
}

function extractParagraphTextRecords(bytes: Uint8Array): string[] {
  const paragraphs: string[] = [];
  let offset = 0;

  while (offset + 4 <= bytes.length) {
    const header = readUint32LE(bytes, offset);
    offset += 4;

    const tagId = header & 0x3ff;
    let size = (header >>> 20) & 0xfff;
    if (size === 0xfff) {
      if (offset + 4 > bytes.length) break;
      size = readUint32LE(bytes, offset);
      offset += 4;
    }

    if (size < 0 || offset + size > bytes.length) break;

    if (tagId === HWP_TAG_PARA_TEXT && size > 0) {
      const payload = bytes.slice(offset, offset + size);
      const text = cleanupHwpText(new TextDecoder("utf-16le").decode(payload));
      if (text) paragraphs.push(text);
    }

    offset += size;
  }

  return paragraphs;
}

function readPreviewText(container: CFB.CFB$Container): string {
  const preview = findEntry(container, "PrvText");
  if (!preview) return "";

  const bytes = toUint8Array(preview.content);
  const utf16 = cleanupText(new TextDecoder("utf-16le").decode(bytes));
  const decoded = cleanupText(decodeReadableTextBytes(bytes));

  return countMeaningfulCharacters(utf16) >= countMeaningfulCharacters(decoded) ? utf16 : decoded;
}

function findEntry(container: CFB.CFB$Container, name: string): CFB.CFB$Entry | null {
  return (
    CFB.find(container, name) ??
    container.FileIndex.find((entry) => entry.name.toLowerCase() === name.toLowerCase()) ??
    null
  );
}

function pathForEntry(container: CFB.CFB$Container, entryName: string): string {
  const index = container.FileIndex.findIndex((entry) => entry.name === entryName);
  return index >= 0 ? container.FullPaths[index] ?? entryName : entryName;
}

function isBodyTextSection(path: string): boolean {
  return /(^|\/)bodytext\/section\d+$/i.test(path.replace(/\\/g, "/"));
}

function sectionNumber(path: string): number {
  const match = path.match(/section(\d+)$/i);
  return match ? Number(match[1]) : 0;
}

function toUint8Array(content: CFB.CFB$Blob): Uint8Array {
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function cleanupHwpText(value: string): string {
  return cleanupText(
    Array.from(value)
      .map((char) => {
        const code = char.codePointAt(0) ?? 0;
        if (char === "\t") return " ";
        if (char === "\r" || char === "\n") return "\n";
        if (code === 0 || code < 0x20) return "";
        if (code >= 0xe000 && code <= 0xf8ff) return "";
        return char;
      })
      .join("")
  );
}

function collectReadableFragments(bytes: Uint8Array): string[] {
  const fragments: string[] = [];

  fragments.push(...extractRuns(decodeReadableTextBytes(bytes)));
  fragments.push(...extractUtf16Runs(bytes, 0));
  fragments.push(...extractUtf16Runs(bytes, 1));

  return fragments;
}

function extractUtf16Runs(bytes: Uint8Array, offset: 0 | 1): string[] {
  let run = "";
  const runs: string[] = [];

  for (let i = offset; i + 1 < bytes.length; i += 2) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    const char = String.fromCharCode(code);

    if (isReadableChar(char)) {
      run += normalizeWhitespaceChar(char);
    } else {
      pushRun(runs, run);
      run = "";
    }
  }

  pushRun(runs, run);
  return runs;
}

function extractRuns(text: string): string[] {
  let run = "";
  const runs: string[] = [];

  for (const char of text) {
    if (isReadableChar(char)) {
      run += normalizeWhitespaceChar(char);
    } else {
      pushRun(runs, run);
      run = "";
    }
  }

  pushRun(runs, run);
  return runs;
}

function pushRun(runs: string[], value: string) {
  const cleaned = cleanupText(value);
  if (cleaned.length >= 4 && looksMeaningful(cleaned) && !isKnownContainerName(cleaned)) {
    runs.push(cleaned);
  }
}

function normalizeFragments(fragments: string[], splitLines: boolean): string[] {
  const seen = new Set<string>();
  const paragraphs: string[] = [];

  for (const fragment of fragments) {
    const candidates = splitLines ? fragment.split(/\n+/) : [fragment];
    for (const candidate of candidates) {
      const cleaned = cleanupText(candidate);
      const dedupeKey = cleaned.toLowerCase();
      if (!cleaned || seen.has(dedupeKey) || !looksMeaningful(cleaned) || isKnownContainerName(cleaned)) continue;
      seen.add(dedupeKey);
      paragraphs.push(cleaned);
      if (paragraphs.length >= MAX_PARAGRAPHS) return paragraphs;
    }
  }

  return paragraphs;
}

function cleanupText(value: string): string {
  return repairKoreanMojibake(value)
    .replace(/\u0000/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeWhitespaceChar(char: string): string {
  return char === "\r" || char === "\t" ? " " : char;
}

function isReadableChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;

  if (char === "\n" || char === "\r" || char === "\t" || char === " ") return true;
  if (code >= 0x21 && code <= 0x7e) return true;
  if (code >= 0xac00 && code <= 0xd7a3) return true;
  if (code >= 0x3130 && code <= 0x318f) return true;
  if (code >= 0x4e00 && code <= 0x9fff) return true;
  if (code >= 0x3000 && code <= 0x303f) return true;

  return false;
}

function looksMeaningful(text: string): boolean {
  const meaningful = countMeaningfulCharacters(text);
  if (meaningful < 3) return false;

  const symbolCount = Array.from(text).filter((char) => {
    const code = char.codePointAt(0) ?? 0;
    return !(isAsciiLetterOrDigit(code) || isHangul(code) || isCjk(code) || /\s/.test(char));
  }).length;

  return symbolCount / Math.max(text.length, 1) < 0.35;
}

function countMeaningfulCharacters(text: string): number {
  return Array.from(text).filter((char) => {
    const code = char.codePointAt(0) ?? 0;
    return isAsciiLetterOrDigit(code) || isHangul(code) || isCjk(code);
  }).length;
}

function isAsciiLetterOrDigit(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isHangul(code: number): boolean {
  return (code >= 0xac00 && code <= 0xd7a3) || (code >= 0x3130 && code <= 0x318f);
}

function isCjk(code: number): boolean {
  return code >= 0x4e00 && code <= 0x9fff;
}

function isKnownContainerName(text: string): boolean {
  return /^(FileHeader|DocInfo|BodyText|Section\d*|BinData|PrvText|PrvImage|Scripts|DefaultJScript)$/i.test(text);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
