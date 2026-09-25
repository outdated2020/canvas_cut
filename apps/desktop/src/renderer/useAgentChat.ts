import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContextUsage } from './ContextUsageRing';
import { restoreChatMessages } from './chat-history';
type RecordValue = Record<string, any>;
export function useAgentChat(projectPath: string, conversationId: string, refreshProject: () => Promise<unknown>, onExternalPrompt?: () => void) {
  const [messages, setMessages] = useState<RecordValue[]>([]);
  const [events, setEvents] = useState<RecordValue[]>([]);
  const [run, setRun] = useState<RecordValue | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [ready, setReady] = useState(false);
  const key = JSON.stringify([projectPath, conversationId]);
  const identity = useRef({ key, epoch: 0 });
  if (identity.current.key !== key) identity.current = { key, epoch: identity.current.epoch + 1 };
  const epoch = identity.current.epoch;
  const revision = useRef(0);
  const cursor = useRef(0);
  const refresh = useRef(refreshProject); refresh.current = refreshProject;
  const sendingRef = useRef(false);
  const external = useRef(onExternalPrompt); external.current = onExternalPrompt;
  const history = useCallback(async () => {
    if (!conversationId) return;
    const version = revision.current;
    const result = await window.api.invoke('agent.history', { path: projectPath, conversationId }) as RecordValue;
    if (identity.current.epoch !== epoch || revision.current !== version) return;
    setReady(true);
    setMessages(restoreChatMessages(result));
    setContextUsage(result.contextUsage ?? null);
    setRun(result.run ?? null); setEvents((result.events ?? []).slice(-200));
    cursor.current = result.events?.at(-1)?.sequence ?? 0;
  }, [projectPath, conversationId, epoch]);
  useEffect(() => {
    let disposed = false;
    setReady(false); setSending(false); sendingRef.current = false;
    setMessages([]); setEvents([]); setRun(null); setError(''); setContextUsage(null); cursor.current = 0;
    void history().catch((error) => { if (!disposed && identity.current.epoch === epoch) setError(String(error)); });
    return () => { disposed = true; };
  }, [history]);
  useEffect(() => {
    if (!ready || !conversationId || !projectPath || run?.status === 'running') return;
    let disposed = false; let pending = false;
    const timer = setInterval(async () => {
      if (pending || sendingRef.current) return;
      pending = true;
      const version = revision.current;
      try {
        const result = await window.api.invoke('agent.get-run', { path: projectPath, conversationId, after: cursor.current }) as RecordValue;
        if (disposed || identity.current.epoch !== epoch || sendingRef.current || revision.current !== version) return;
        setContextUsage(result.contextUsage ?? null);
        if (result.run && (result.run.id !== run?.id || result.run.status !== run?.status || result.events.length)) {
          await history();
          if (!disposed) { external.current?.(); await refresh.current(); }
        }
      } catch (error) { if (!disposed) setError(String(error)); }
      finally { pending = false; }
    }, 1000);
    return () => { disposed = true; clearInterval(timer); };
  }, [projectPath, run?.id, run?.status, history, conversationId, epoch, ready]);
  useEffect(() => {
    if (!ready || !conversationId || run?.status !== 'running') return;
    let disposed = false; let pending = false;
    const tick = async () => {
      if (pending) return; pending = true;
      try {
        const result = await window.api.invoke('agent.get-run', { path: projectPath, conversationId, after: cursor.current }) as RecordValue;
        if (disposed || identity.current.epoch !== epoch) return;
        setContextUsage(result.contextUsage ?? null);
        cursor.current = result.cursor;
        setEvents((events) => [...events, ...result.events].slice(-200));
        for (const event of result.events) if (event.type === 'assistant' || event.type === 'assistant-delta') setMessages((messages) => {
          const id = event.data.messageId;
          const index = id ? messages.findIndex(message => message.id === id) : -1;
          if (index < 0) return [...messages, { id, role: 'assistant', text: event.data.text }];
          return messages.map((message, i) => i === index ? { ...message, text: event.type === 'assistant' ? event.data.text : message.text + event.data.text } : message);
        });
        if (result.events.some((event: RecordValue) => event.type === 'tool-result')) await refresh.current();
        if (disposed || identity.current.epoch !== epoch) return;
        if (result.run?.status !== 'running') { await history(); if (!disposed && identity.current.epoch === epoch) await refresh.current(); }
        else setRun(result.run);
      } catch (error) { if (!disposed) setError(String(error)); }
      finally { pending = false; }
    };
    void tick(); const timer = setInterval(() => void tick(), 200);
    return () => { disposed = true; clearInterval(timer); };
  }, [run?.id, run?.status, history, projectPath, conversationId, epoch, ready]);
  const send = async (text: string) => {
    if (!ready || !conversationId || sendingRef.current || run?.status === 'running' || !text.trim()) return false;
    revision.current++; sendingRef.current = true; setSending(true); setError('');
    try {
      const result = await window.api.invoke('agent.start', { path: projectPath, conversationId, message: text }) as RecordValue;
      if (identity.current.epoch !== epoch) return false;
      setMessages((messages) => [...messages, { role: 'user', text }]);
      setRun({ id: result.runId, status: 'running' }); return true;
    } catch (error) { if (identity.current.epoch === epoch) setError(String(error)); return false; }
    finally { if (identity.current.epoch === epoch) { sendingRef.current = false; setSending(false); } }
  };
  const stop = async () => {
    try { await window.api.invoke('agent.cancel', { path: projectPath, conversationId }); }
    catch (error) { if (identity.current.epoch === epoch) setError(String(error)); }
  };
  return { messages, setMessages, events, run, contextUsage, error, ready, busy: sending || run?.status === 'running', send, stop, history };
}
