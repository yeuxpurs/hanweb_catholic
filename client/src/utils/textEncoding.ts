const TEXT_ENCODINGS = ["utf-8", "utf-16le", "utf-16be", "euc-kr", "windows-1252"];

const WINDOWS_1252_REVERSE: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

export function decodeXmlBytes(bytes: Uint8Array): string {
  return decodeBytesWithCandidates(bytes, [detectBomEncoding(bytes), detectXmlDeclaredEncoding(bytes), ...TEXT_ENCODINGS], "xml");
}

export function decodeReadableTextBytes(bytes: Uint8Array): string {
  return decodeBytesWithCandidates(bytes, [detectBomEncoding(bytes), "utf-16le", "utf-8", "euc-kr", "utf-16be"], "text");
}

export function repairKoreanMojibake(text: string): string {
  if (!hasLikelyMojibake(text)) return text;

  const bytes = singleByteStringToBytes(text);
  if (!bytes) return text;

  let best = text;
  let bestScore = scoreDecodedText(text);

  for (const encoding of ["utf-8", "euc-kr"]) {
    const decoded = tryDecode(bytes, encoding);
    if (!decoded) continue;

    const candidate = stripByteOrderMark(decoded);
    const score = scoreDecodedText(candidate);
    if (score > bestScore + 3) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function decodeBytesWithCandidates(bytes: Uint8Array, labels: Array<string | null>, mode: "xml" | "text"): string {
  const candidates = uniqueLabels(labels.map((label) => (label ? normalizeEncodingLabel(label) : null)));
  let best = "";
  let bestScore = -Infinity;

  for (const label of candidates) {
    const decoded = tryDecode(bytes, label);
    if (!decoded) continue;

    const variants = new Set([stripByteOrderMark(decoded), repairKoreanMojibake(stripByteOrderMark(decoded))]);
    for (const variant of variants) {
      const score = mode === "xml" ? scoreDecodedXml(variant) : scoreDecodedText(variant);
      if (score > bestScore) {
        best = variant;
        bestScore = score;
      }
    }
  }

  return best || stripByteOrderMark(new TextDecoder().decode(bytes));
}

function detectBomEncoding(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return null;
}

function detectXmlDeclaredEncoding(bytes: Uint8Array): string | null {
  const prefix = bytes.subarray(0, Math.min(bytes.length, 512));
  const probes = [
    bytesToSingleByteString(prefix),
    tryDecode(prefix, "utf-8") ?? "",
    tryDecode(prefix, "utf-16le") ?? "",
    tryDecode(prefix, "utf-16be") ?? "",
  ];

  for (const probe of probes) {
    const match = probe.match(/encoding=["']([^"']+)["']/i);
    if (match) return normalizeEncodingLabel(match[1]);
  }

  return null;
}

function normalizeEncodingLabel(label: string): string {
  const normalized = label.trim().toLowerCase().replace(/_/g, "-");
  const compact = normalized.replace(/-/g, "");

  if (compact === "utf8") return "utf-8";
  if (compact === "utf16" || normalized === "utf-16") return "utf-16le";
  if (compact === "utf16le") return "utf-16le";
  if (compact === "utf16be") return "utf-16be";

  if (
    compact === "euckr" ||
    compact === "ksc5601" ||
    compact === "cp949" ||
    compact === "ms949" ||
    compact === "windows949" ||
    normalized === "ks-c-5601-1987" ||
    normalized === "x-windows-949"
  ) {
    return "euc-kr";
  }

  if (normalized === "latin1" || normalized === "iso-8859-1") return "windows-1252";

  return normalized;
}

function uniqueLabels(labels: Array<string | null>): string[] {
  return Array.from(new Set(labels.filter((label): label is string => Boolean(label))));
}

function tryDecode(bytes: Uint8Array, label: string): string | null {
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

function scoreDecodedXml(text: string): number {
  let score = scoreDecodedText(text);

  const markupCount = countMatches(text, /[<>]/g);
  score += Math.min(markupCount, 500);
  if (text.includes("<?xml")) score += 120;
  if (/<[A-Za-z_][\w:.-]*/.test(text)) score += 100;

  if (typeof DOMParser !== "undefined" && text.includes("<")) {
    const doc = new DOMParser().parseFromString(text, "text/xml");
    score += doc.getElementsByTagName("parsererror").length > 0 ? -5000 : 1000;
  }

  return score;
}

function scoreDecodedText(text: string): number {
  let score = 0;

  for (const char of Array.from(text)) {
    const code = char.codePointAt(0) ?? 0;

    if (char === "\uFFFD") {
      score -= 40;
    } else if (code === 0 || (code < 0x20 && char !== "\n" && char !== "\r" && char !== "\t")) {
      score -= 12;
    } else if (isHangul(code)) {
      score += 8;
    } else if (isAsciiLetterOrDigit(code)) {
      score += 1;
    } else if (isCjk(code)) {
      score += 2;
    } else if (isSuspiciousSingleByteGlyph(code)) {
      score -= 2;
    }
  }

  score -= countMatches(text, /[\uFFFD]/g) * 20;
  score -= countMatches(text, /[\u0080-\u00ff\u2018-\u2026\u02c6\u02dc]/g) * 2;

  return score;
}

function hasLikelyMojibake(text: string): boolean {
  const suspicious = countMatches(text, /[\u0080-\u00ff\u2018-\u2026\u02c6\u02dc]/g);
  if (suspicious === 0) return false;

  const hangul = countHangul(text);
  return hangul === 0 || suspicious > hangul * 2;
}

function singleByteStringToBytes(text: string): Uint8Array | null {
  const bytes: number[] = [];

  for (const char of Array.from(text)) {
    const code = char.codePointAt(0) ?? 0;

    if (code <= 0xff) {
      bytes.push(code);
      continue;
    }

    const windowsByte = WINDOWS_1252_REVERSE[code];
    if (windowsByte !== undefined) {
      bytes.push(windowsByte);
      continue;
    }

    if (code === 0xfeff) continue;

    return null;
  }

  return new Uint8Array(bytes);
}

function bytesToSingleByteString(bytes: Uint8Array): string {
  let value = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    value += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return value;
}

function stripByteOrderMark(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function countHangul(text: string): number {
  return Array.from(text).filter((char) => isHangul(char.codePointAt(0) ?? 0)).length;
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

function isSuspiciousSingleByteGlyph(code: number): boolean {
  return (code >= 0x80 && code <= 0xff) || WINDOWS_1252_REVERSE[code] !== undefined;
}
