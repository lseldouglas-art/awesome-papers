import { useEffect, useRef, useState } from 'react';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
export function useDraft({ api, projectId, artifact, onSaved }) {
  const key = `rw2:notes:${projectId}:${artifact.id}`;
  const legacyKey = `rw2:draft:${projectId}:${artifact.id}`;
  const [legacy, setLegacy] = useState(() => read(legacyKey));
  const [cached] = useState(() => read(key));
  const source = artifact.draft;
  const [notes, setState] = useState(cached?.notes ?? source.notes);
  const value = useRef(notes), base = useRef(cached?.base ?? source.version), saved = useRef(source.notes), pending = useRef(cached?.pending ?? null);
  const blocked = useRef(Boolean(cached && !cached.pending && cached.base !== source.version));
  const composing = useRef(false), running = useRef(null);
  const [status, setStatus] = useState(blocked.current ? 'conflict' : 'saved');
  const [error, setError] = useState(blocked.current ? '发现未保存草稿，请先与本机当前内容对照。' : '');
  const [storageError, setStorageError] = useState('');
  const onSavedRef = useRef(onSaved); onSavedRef.current = onSaved;
  const backup = () => { try { localStorage.setItem(key, JSON.stringify({ notes: value.current, base: base.current, pending: pending.current })); setStorageError(''); } catch { setStorageError('浏览器未能保留临时草稿，请保持页面打开并等待本机保存。'); } };
  const dirty = () => Boolean(pending.current || !same(value.current, saved.current));
  const setNotes = next => { value.current = typeof next === 'function' ? next(value.current) : next; setState(value.current); backup(); if (!blocked.current) setStatus('dirty'); };
  const flush = () => {
    if (running.current) return running.current;
    if (blocked.current || composing.current) return Promise.resolve(false);
    running.current = (async () => {
      try {
        while (dirty()) {
          setStatus('saving');
          pending.current ??= { requestId: crypto.randomUUID(), notes: structuredClone(value.current), base: base.current }; backup();
          const sent = pending.current;
          const ack = await api.command(projectId, 'save-notes', { artifactId: artifact.id, baseVersion: sent.base, notes: sent.notes }, { requestId: sent.requestId });
          base.current = ack.version; saved.current = sent.notes; pending.current = null;
          onSavedRef.current({ ...ack, notes: sent.notes }); backup();
        }
        setError(''); setStatus('saved'); try { localStorage.removeItem(key); } catch {} return true;
      } catch (e) { blocked.current = true; setStatus(e.status === 409 ? 'conflict' : 'error'); setError(e.message || '无法连接本机服务，草稿仍保留。'); backup(); return false; }
    })().finally(() => { running.current = null; });
    return running.current;
  };
  const acceptServer = draft => {
    if (draft.version === base.current || running.current || pending.current) return;
    if (dirty()) { blocked.current = true; setStatus('conflict'); setError('当前内容已更新，你的输入已保留，请对照后继续。'); backup(); }
    else { base.current = draft.version; saved.current = draft.notes; value.current = draft.notes; setState(draft.notes); setStatus('saved'); }
  };
  useEffect(() => { if (!blocked.current && dirty()) { const id = setTimeout(flush, 650); return () => clearTimeout(id); } }, [notes]);
  useEffect(() => { acceptServer(source); }, [source.version]);
  useEffect(() => { const warn = e => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, []);
  return { notes, setNotes, status, error, storageError, flush, isDirty: dirty, version: () => base.current,
    acceptServer, composing, legacy,
    importLegacy: () => { const incoming = legacy?.blocks ?? []; const next = { ...value.current }; for (const key of Object.keys(next)) { const old = incoming.find(b => b.id === key && b.type === 'paragraph'); if (old) next[key] = old.text; } setNotes(next); setLegacy(null); },
    hideLegacy: () => setLegacy(null),
    retry: () => { blocked.current = false; return flush(); },
    saveOnCompared: draft => { base.current = draft.version; saved.current = draft.notes; pending.current = null; blocked.current = false; return flush(); },
  };
}
