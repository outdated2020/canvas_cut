import { useCallback, useEffect, useRef, useState } from 'react';

interface Conversation { conversationId: string; title: string; archivedAt?: number; status?: string }
export function useConversations(path: string) {
  const [items, setItems] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const identity = useRef({ path, epoch: 0 });
  if (identity.current.path !== path) identity.current = { path, epoch: identity.current.epoch + 1 };
  const epoch = identity.current.epoch;
  const valid = () => identity.current.epoch === epoch;
  const requests = useRef(0);
  const reload = useCallback(async () => {
    const request = ++requests.current;
    const result = await window.api.invoke('agent.conversations.list', { path }) as Conversation[];
    if (identity.current.epoch !== epoch || request !== requests.current) return;
    setItems(result);
    setSelected(current => result.some(item => item.conversationId === current) ? current : result.find(item => !item.archivedAt)?.conversationId ?? result[0]?.conversationId ?? '');
  }, [path, epoch]);
  useEffect(() => {
    let disposed = false, loading = false;
    setItems([]); setSelected(''); setError(''); setPending(false);
    try { setSelected(localStorage.getItem(`agent.conversation:${path}`) ?? ''); } catch { /* storage unavailable */ }
    const tick = async () => {
      if (loading) return; loading = true;
      try { await reload(); } catch (error) { if (!disposed && valid()) setError(String(error)); }
      finally { loading = false; }
    };
    void tick(); const timer = setInterval(() => void tick(), 2000);
    return () => { disposed = true; clearInterval(timer); };
  }, [reload]);
  const select = (id: string) => {
    setSelected(id);
    try { localStorage.setItem(`agent.conversation:${path}`, id); } catch { /* storage unavailable */ }
  };
  const mutate = async (action: string, title?: string) => {
    if (pending) return false;
    requests.current++; setPending(true); setError('');
    try {
      const result = await window.api.invoke(action === 'create' ? 'agent.conversations.create' : 'agent.conversations.manage', { path, conversationId: selected, action, title }) as Conversation;
      if (!valid()) return false;
      await reload();
      if (!valid()) return false;
      if (action === 'create') select(result.conversationId);
      return true;
    } catch (error) { if (valid()) setError(String(error)); return false; }
    finally { if (valid()) setPending(false); }
  };
  return { items, selected, select, pending, error, mutate, current: items.find(item => item.conversationId === selected) };
}

export function Conversations({ model, busy }: { model: ReturnType<typeof useConversations>; busy: boolean }) {
  const [archived, setArchived] = useState(false);
  const [action, setAction] = useState<'rename' | 'delete' | null>(null);
  const [title, setTitle] = useState('');
  useEffect(() => { setAction(null); setArchived(Boolean(model.current?.archivedAt)); }, [model.selected, model.current?.archivedAt]);
  const items = model.items.filter(item => archived || !item.archivedAt || item.conversationId === model.selected);
  const disabled = model.pending || busy || model.current?.status === 'running';
  return <div className="conversation-manager">
    <div className="conversation-row">
      <select aria-label="切换对话" value={items.some(item => item.conversationId === model.selected) ? model.selected : ''} onChange={event => model.select(event.target.value)} disabled={model.pending}>
        <option value="" disabled>{items.length ? '选择对话' : '暂无对话'}</option>
        {items.map(item => <option key={item.conversationId} value={item.conversationId}>{item.status === 'running' ? '● ' : ''}{item.archivedAt ? '[已归档] ' : ''}{item.title}</option>)}
      </select>
      <button disabled={model.pending} onClick={() => void model.mutate('create')}>＋ 新建</button>
    </div>
    <div className="conversation-row conversation-actions">
      <label><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />含已归档</label>
      <button disabled={disabled || !model.current} onClick={() => { setTitle(model.current?.title ?? ''); setAction('rename'); }}>重命名</button>
      <button disabled={disabled || !model.current} onClick={() => void model.mutate(model.current?.archivedAt ? 'restore' : 'archive')}>{model.current?.archivedAt ? '恢复' : '归档'}</button>
      <button disabled={disabled || !model.current} onClick={() => setAction('delete')}>删除</button>
    </div>
    {action && <div className="conversation-confirm" role="group" aria-label={action === 'rename' ? '重命名对话' : '确认删除对话'}>
      {action === 'rename' ? <input aria-label="对话名称" autoFocus maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /> : <p>删除「{model.current?.title}」？将从列表隐藏，磁盘历史仍保留。</p>}
      <button disabled={disabled || (action === 'rename' && !title.trim())} onClick={async () => { if (await model.mutate(action, title)) setAction(null); }}>确认</button>
      <button disabled={model.pending} onClick={() => setAction(null)}>取消</button>
    </div>}
    {model.current?.archivedAt && <small>此对话已归档，恢复后可继续发送。</small>}
    {model.error && <div role="alert" className="agent-error">{model.error}</div>}
  </div>;
}
