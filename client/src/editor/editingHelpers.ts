/** Explicit protocols only: pasted link addresses must never become executable URLs. */
export function normalizeLinkUrl(value: string): string | null {
  const address = value.trim();
  if (!address || /[\u0000-\u0020\u007f]/.test(address)) return null;
  try {
    const url = new URL(address);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      if (!url.hostname || url.username || url.password) return null;
      return url.href;
    }
    if ((url.protocol === 'mailto:' || url.protocol === 'tel:') && url.pathname) return url.href;
  } catch { /* Invalid or relative address. */ }
  return null;
}

export function koreanDateLabel(date = new Date()): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  }).format(date);
}

export const SPECIAL_CHARACTERS = ['†', '✝', '☐', '☑', '✓', '※', '★', '☆', '●', '○', '■', '□', '◆', '◇', '→', '←', '↑', '↓', '·', '…', '—', '“', '”', '‘', '’', '℃', '°', '±', '×', '÷', '≤', '≥', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'] as const;
