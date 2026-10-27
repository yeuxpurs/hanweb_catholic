import type { JSONContent } from '@tiptap/react';
export interface PageSettings {
  paperSize: 'A4' | 'A3';
  orientation: 'portrait' | 'landscape';
  margins: { top: number; right: number; bottom: number; left: number };
  header: string;
  footer: string;
  pageNumbers: boolean;
}
export const DEFAULT_PAGE_SETTINGS: PageSettings = {
  paperSize: 'A4', orientation: 'portrait', margins: { top: 25, right: 30, bottom: 25, left: 30 },
  header: '', footer: '', pageNumbers: false,
};
export function normalizePageSettings(input?: Partial<PageSettings> | null): PageSettings {
  const paperSize = input?.paperSize === 'A3' ? 'A3' : 'A4';
  const orientation = input?.orientation === 'landscape' ? 'landscape' : 'portrait';
  const margins = { ...DEFAULT_PAGE_SETTINGS.margins };
  for (const key of Object.keys(margins) as (keyof typeof margins)[]) {
    const value = input?.margins?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) margins[key] = Math.max(5, Math.min(80, value));
  }
  return { paperSize, orientation, margins, header: String(input?.header ?? ''), footer: String(input?.footer ?? ''), pageNumbers: !!input?.pageNumbers };
}
export function pageDimensions(settings: PageSettings) {
  const [width, height] = settings.paperSize === 'A3' ? [297, 420] : [210, 297];
  return settings.orientation === 'landscape' ? { widthMm: height, heightMm: width } : { widthMm: width, heightMm: height };
}
export interface HanDocument {
  schemaVersion: 2; id: string; content: string; json?: JSONContent; fileName: string;
  pageSettings: PageSettings; savedAt: number; revision: number; tabId: string;
}
