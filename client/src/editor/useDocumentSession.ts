import { useCallback, useEffect, useRef, useState } from 'react';
import { generateHTML, type Editor, type JSONContent } from '@tiptap/react';
import { EditorState } from '@tiptap/pm/state';
import { DEFAULT_PAGE_SETTINGS, normalizePageSettings, type HanDocument, type PageSettings } from './document';
import { listDocuments, listSnapshots, saveDocument, SaveConflictError, migrateDocument, DOCUMENT_STORAGE } from '../utils/autosave';

export function useDocumentSession(editor: Editor | null, fileName: string, setFileName: (name: string) => void, setModified: (value: boolean) => void, initialHTML: string) {
  const [settings, setSettings] = useState<PageSettings>(normalizePageSettings());
  const [status, setStatus] = useState('복구본 확인 중');
  const [ready, setReady] = useState(false);
  const [recovery, setRecovery] = useState<HanDocument[]>([]);
  const [showRecovery, setShowRecovery] = useState(false);
  const tabId = useRef(crypto.randomUUID());
  const identity = useRef<{ id: string; revision: number }>({ id: crypto.randomUUID(), revision: 0 });
  const latest = useRef({ fileName, settings });
  latest.current = { fileName, settings };
  const pending = useRef(true);
  const version = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const readyRef = useRef(false);
  const transitioning = useRef(false);
  const recoveryReadFailure = useRef<string | null>(null);
  const hasEmergencyRecovery = useRef(false);
  const emergencyKey = `${DOCUMENT_STORAGE.emergencyPrefix}${tabId.current}`;
  const capture = useCallback((): HanDocument => ({ schemaVersion: 2, ...identity.current, tabId: tabId.current, savedAt: Date.now(),
    content: editor?.getHTML() ?? '', json: editor?.getJSON(), fileName: latest.current.fileName, pageSettings: latest.current.settings }), [editor]);
  const markDirty = useCallback(() => {
    pending.current = true; version.current++; setStatus('저장 대기'); setModified(true);
  }, [setModified]);
  const flush = useCallback((snapshot = false, duringTransition = false): Promise<boolean> => {
    const run = async () => {
      if (!editor || !readyRef.current) return false;
      if (transitioning.current && !duringTransition) return false;
      if (editor.view.composing) { setStatus('입력 조합 완료 후 저장'); return false; }
      if (!pending.current && !snapshot) return true;
      const currentVersion = version.current;
      const document = capture();
      setStatus('저장 중');
      try {
        const saved = await saveDocument(document, identity.current.revision, snapshot);
        identity.current = { id: saved.id, revision: saved.revision };
        if (version.current === currentVersion) pending.current = false;
        setStatus(pending.current ? '저장 대기' : `자동 저장됨 · ${new Date(saved.savedAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
        try { localStorage.removeItem(emergencyKey); localStorage.setItem(DOCUMENT_STORAGE.lastDocument, saved.id); } catch { /* IndexedDB already committed */ }
        return true;
      } catch (error) {
        try {localStorage.setItem(emergencyKey,JSON.stringify(capture()));} catch { /* Keep editor and failure indicator. */ }
        setStatus(error instanceof SaveConflictError ? '다른 탭과 충돌 · 복사본 저장 필요' : `저장 실패 · ${(error as Error).message || '저장 공간을 확인하세요'}`);
        return false;
      }
    };
    const result = queue.current.then(run, run);
    queue.current = result;
    return result;
  }, [editor, capture, emergencyKey]);
  const refreshRecovery = useCallback(async () => {
    const records = await Promise.allSettled([listDocuments(), listSnapshots()]);
    const documents = records[0].status === 'fulfilled' ? records[0].value : [];
    const snapshots = records[1].status === 'fulfilled' ? records[1].value : [];
    const failure = records.find(record => record.status === 'rejected');
    recoveryReadFailure.current = failure?.status === 'rejected' ? String(failure.reason?.message || '저장소에 접근할 수 없습니다') : null;
    const emergencies: HanDocument[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(DOCUMENT_STORAGE.emergencyPrefix)) {
          const data = localStorage.getItem(key);
          if (data) {
            try { emergencies.push({ ...migrateDocument(JSON.parse(data)), id: `emergency:${key}` }); }
            catch { /* Leave a corrupt record untouched and continue to the next record. */ }
          }
        }
      }
    } catch { /* A corrupt emergency record must not hide IndexedDB recovery */ }
    setRecovery([...emergencies, ...documents, ...snapshots]);
    hasEmergencyRecovery.current = emergencies.length > 0;
    if (recoveryReadFailure.current) setStatus(`복구 저장소 접근 실패 · ${recoveryReadFailure.current}`);
    if (emergencies.length) setShowRecovery(true);
    return documents;
  }, []);
  const applyDocument = useCallback((document: HanDocument, copy = false) => {
    if (!editor) return;
    if (!editor.commands.setContent(document.json ?? document.content, { emitUpdate: false })) throw new Error('문서 내용을 복원하지 못했습니다.');
    // Undo belongs to a document. A new identity must never undo into its predecessor.
    editor.view.updateState(EditorState.create({ schema: editor.schema, doc: editor.state.doc, plugins: editor.state.plugins }));
    editor.emit('selectionUpdate', { editor, transaction: editor.state.tr });
    requestAnimationFrame(() => {
      if (!editor.isDestroyed) editor.view.dom.closest('.editor-canvas')?.scrollTo({ top: 0, left: 0 });
    });
    setFileName(document.fileName);
    const normalized = normalizePageSettings(document.pageSettings);
    setSettings(normalized);
    latest.current = { fileName: document.fileName, settings: normalized };
    const needsCopy = copy || document.id.startsWith('emergency:');
    identity.current = { id: needsCopy ? crypto.randomUUID() : document.id, revision: needsCopy ? 0 : document.revision };
    pending.current = needsCopy;
    version.current++;
    setModified(copy);
    setStatus(copy ? '복구 복사본 · 저장 대기' : '자동 저장본 복구됨');
    setShowRecovery(false);
  }, [editor, setFileName, setModified]);
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    const wasEditable = editor.isEditable;
    const initialVersion = version.current;
    const initialDocument = editor.state.doc;
    // Loading recovery is asynchronous. Input must not be overwritten when it resolves.
    editor.setEditable(false, false);
    void (async () => {
      try {
        const documents = await refreshRecovery();
        if (cancelled) return;
        let last: string | null = null;
        try { last = localStorage.getItem(DOCUMENT_STORAGE.lastDocument); } catch { /* optional pointer */ }
        const previous = documents.find(d => d.id === last) ?? documents[0];
        if (version.current !== initialVersion || editor.state.doc !== initialDocument) setStatus('초기 편집 내용 유지 · 저장 대기');
        else if (previous) applyDocument(previous);
        else { editor.commands.setContent(initialHTML, { emitUpdate: false }); setStatus('새 문서 · 저장 대기'); }
        if (recoveryReadFailure.current) setStatus(`복구 저장소 접근 실패 · ${recoveryReadFailure.current}`);
        if (hasEmergencyRecovery.current) setShowRecovery(true);
      } catch (error) {
        if (!cancelled) {
          if (version.current === initialVersion && editor.state.doc === initialDocument) editor.commands.setContent(initialHTML, { emitUpdate: false });
          setStatus(`복구 저장소 접근 실패 · ${(error as Error).message}`);
        }
      }
      if (!cancelled) { readyRef.current = true; editor.setEditable(wasEditable, false); setReady(true); }
    })();
    return () => { cancelled = true; readyRef.current = false; if (!editor.isDestroyed) editor.setEditable(wasEditable, false); };
  }, [editor, refreshRecovery, applyDocument, initialHTML]);
  useEffect(() => {
    if (!editor || !ready) return;
    let debounce: ReturnType<typeof setTimeout>;
    const onUpdate = () => { markDirty(); clearTimeout(debounce); debounce = setTimeout(() => void flush(), 900); };
    const onCompositionEnd = () => { clearTimeout(debounce); debounce = setTimeout(() => void flush(), 300); };
    editor.on('update', onUpdate);
    editor.view.dom.addEventListener('compositionend', onCompositionEnd);
    const interval = setInterval(() => void flush(), 10000);
    const onVisibility = () => { if (document.visibilityState === 'hidden') void flush(); };
    const onUnload = (event: BeforeUnloadEvent) => {
      if (!pending.current) return;
      try { localStorage.setItem(emergencyKey, JSON.stringify(capture())); } catch { /* Keep unload warning when storage fails */ }
      event.preventDefault(); event.returnValue = '';
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onUnload);
    return () => { editor.off('update', onUpdate); editor.view.dom.removeEventListener('compositionend', onCompositionEnd); clearTimeout(debounce); clearInterval(interval); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('beforeunload', onUnload); };
  }, [editor, ready, flush, markDirty, capture, emergencyKey]);
  const changeSettings = useCallback((value: PageSettings) => {
    const normalized = normalizePageSettings(value); setSettings(normalized); latest.current.settings = normalized; markDirty();
  }, [markDirty]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void flush(), 900);
    return () => clearTimeout(timer);
  }, [settings, fileName, ready, flush]);
  const startDocument = useCallback(async (content: string | JSONContent, name: string, pageSettings = DEFAULT_PAGE_SETTINGS) => {
    if (!editor || !readyRef.current || transitioning.current) return false;
    if (editor.view.composing) { setStatus('입력 조합을 마친 뒤 문서를 전환하세요'); return false; }
    // Validate a JSON backup against the active schema before saving or replacing anything.
    let html: string;
    try { html = typeof content === 'string' ? content : generateHTML(content, editor.extensionManager.extensions); }
    catch (error) { setStatus(`불러오기 실패 · ${(error as Error).message}`); return false; }
    transitioning.current = true;
    const wasEditable = editor.isEditable;
    editor.setEditable(false, false);
    try {
      if (!await flush(true, true)) return false;
      if (pending.current && !await flush(true, true)) return false;
      const savedVersion = version.current;
      const normalized = normalizePageSettings(pageSettings);
      const candidate: HanDocument = {schemaVersion:2,id:crypto.randomUUID(),revision:0,tabId:tabId.current,savedAt:Date.now(),content:html,json:typeof content === 'string' ? undefined : content,fileName:name,pageSettings:normalized};
      // Commit the candidate before changing the current editor. Failed writes
      // keep the original document and its identity completely intact.
      const saved = await saveDocument(candidate,0);
      // Read-only DOM still permits toolbar commands. Never overwrite those edits.
      if (version.current !== savedVersion) { setStatus('문서가 변경되어 전환 중단 · 기존 내용 유지'); return false; }
      applyDocument(saved);
      setStatus('자동 저장됨 · 문서 전환 완료');
      try {localStorage.setItem(DOCUMENT_STORAGE.lastDocument, saved.id);} catch { /* optional */ }
      return true;
    } catch(error) {setStatus(`저장 실패 · ${(error as Error).message}`);return false;}
    finally {transitioning.current = false; editor.setEditable(wasEditable, false);}
  }, [editor, flush, applyDocument]);
  const restore = useCallback(async (document: HanDocument) => {
    // Persist a distinct candidate before changing the visible document, just like import.
    return await startDocument(document.json ?? document.content, document.fileName, document.pageSettings);
  }, [startDocument]);
  const saveCopy = useCallback(async () => {
    if (!editor || !readyRef.current || transitioning.current) return false;
    if (editor.view.composing) { setStatus('입력 조합을 마친 뒤 복사본을 저장하세요'); return false; }
    transitioning.current = true;
    try {
      // An in-flight write must finish before a new identity is installed.
      await queue.current.catch(() => undefined);
      identity.current = { id: crypto.randomUUID(), revision: 0 };
      markDirty();
      return await flush(true, true);
    } finally { transitioning.current = false; }
  }, [editor, flush, markDirty]);
  const openRecovery = useCallback(async () => { try { await refreshRecovery(); setShowRecovery(true); } catch (error) { setStatus(`복구본 조회 실패 · ${(error as Error).message}`); } }, [refreshRecovery]);
  return { settings, changeSettings, status, ready, flush, startDocument, restore, saveCopy, markDirty, capture, recovery, showRecovery, setShowRecovery, openRecovery, refreshRecovery };
}
