import { normalizePageSettings, type HanDocument } from '../editor/document';
// GitHub Pages projects share one origin: keep this edition's drafts isolated.
export const DOCUMENT_STORAGE = {
  database: 'hanweb_catholic-autosave',
  lastDocument: 'hanweb_catholic-last-document',
  emergencyPrefix: 'hanweb_catholic-emergency-',
} as const;
const DB_NAME = DOCUMENT_STORAGE.database;
const STORE = 'documents';
export class SaveConflictError extends Error {
  constructor() { super('다른 탭에서 이 문서를 저장했습니다. 현재 내용을 별도 복구본으로 보존하세요.'); }
}
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'snapshotId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('이전 hanweb_catholic 탭을 닫은 뒤 저장을 다시 시도하세요.'));
  });
}
export function migrateDocument(data: any): HanDocument {
  return { ...data, schemaVersion: 2, content: String(data.content ?? ''), fileName: String(data.fileName ?? '새 문서'),
    pageSettings: normalizePageSettings(data.pageSettings ?? { paperSize: data.paperSize }),
    revision: Number(data.revision) || 0, tabId: String(data.tabId ?? ''), savedAt: Number(data.savedAt) || 0 };
}
export async function listDocuments(): Promise<HanDocument[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    tx.oncomplete = () => { db.close(); resolve(request.result.map(migrateDocument).sort((a,b) => b.savedAt-a.savedAt)); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export async function saveDocument(document: HanDocument, expectedRevision: number, snapshot = false): Promise<HanDocument> {
  const db = await openDB();
  const saved = { ...document, revision: expectedRevision + 1, savedAt: Date.now() };
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, 'snapshots'], 'readwrite');
    let conflict = false;
    const store = tx.objectStore(STORE);
    const request = store.get(document.id);
    request.onsuccess = () => {
      if ((request.result?.revision ?? 0) !== expectedRevision) { conflict = true; tx.abort(); return; }
      store.put(saved);
      if (snapshot) tx.objectStore('snapshots').put({ ...saved, snapshotId: crypto.randomUUID() });
    };
    tx.oncomplete = () => { db.close(); resolve(saved); };
    tx.onabort = tx.onerror = () => { db.close(); reject(conflict ? new SaveConflictError() : tx.error ?? new Error('자동 저장 실패')); };
  });
}
export async function listSnapshots(): Promise<(HanDocument & { snapshotId: string })[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readonly');
    const req = tx.objectStore('snapshots').getAll();
    tx.oncomplete = () => { db.close(); resolve(req.result.map(migrateDocument).sort((a,b) => b.savedAt-a.savedAt) as any); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export async function deleteRecovery(id: string, snapshot = false): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(snapshot ? 'snapshots' : STORE, 'readwrite');
    tx.objectStore(snapshot ? 'snapshots' : STORE).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export function formatAutosaveTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}
