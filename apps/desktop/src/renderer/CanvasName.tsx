import { useEffect, useRef, useState } from 'react';

export function CanvasName({ name, fallback, onRename }: {
  name?: string; fallback: string; onRename: (name: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const display = name || fallback;
  useEffect(() => { if (editing) { input.current?.focus(); input.current?.select(); } }, [editing]);
  function start() { setDraft(display); setError(''); setEditing(true); }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true; setSaving(true); setError('');
    try { await onRename(draft); setEditing(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { busy.current = false; setSaving(false); }
  }
  return <div className={`canvas-name-editor${editing ? ' is-editing' : ''}`} onClick={event => event.stopPropagation()}>
    {editing ? <form onSubmit={save}>
      <input ref={input} aria-label="画布名称" value={draft} maxLength={100} required disabled={saving}
        onChange={event => { setDraft(event.target.value); setError(''); }}
        onKeyDown={event => {
          if (event.key === 'Escape' && !event.nativeEvent.isComposing && !saving) { event.preventDefault(); setEditing(false); setError(''); }
          if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
        }} />
      <button type="submit" aria-label="保存画布名称" title="保存（Enter）" disabled={saving}>{saving ? '…' : '✓'}</button>
      <button type="button" aria-label="取消重命名" title="取消（Esc）" disabled={saving} onClick={() => { setEditing(false); setError(''); }}>×</button>
    </form> : <>
      <button className="canvas-name-label" type="button" title={`${display} · 双击重命名`}
        onDoubleClick={start} onKeyDown={event => { if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); start(); } }}>{display}</button>
      <button className="canvas-name-edit" type="button" aria-label={`重命名画布 ${display}`} title="重命名画布" onClick={start}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" /></svg>
      </button>
    </>}
    {error ? <div className="canvas-name-error" role="alert">{error}</div> : null}
  </div>;
}
