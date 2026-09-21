import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContextUsage } from './ContextUsageRing';
type RecordValue = Record<string, any>;
function displayMessages(messages: RecordValue[]) {
  return messages.filter((message) => message.role === 'user' || message.role === 'assistant').map((message) => ({
    role: message.role,
    text: typeof message.content === 'string' ? message.content : (message.content ?? []).filter((part: RecordValue) => part.type === 'text').map((part: RecordValue) => part.text).join('\n')
  })).filter((message) => message.text);
}
export function useAgentChat(projectPath: string, refreshProject: () => Promise<unknown>, onExternalPrompt?: () => void) {
  const [messages, setMessages] = useState<RecordValue[]>([]);
  const [events, setEvents] = useState<RecordValue[]>([]);
  const [run, setRun] = useState<RecordValue | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const cursor = useRef(0);
  const refresh = useRef(refreshProject); refresh.current = refreshProject;
  const currentPath = useRef(projectPath); currentPath.current = projectPath;
  const sendingRef = useRef(false);
  const external = useRef(onExternalPrompt); external.current = onExternalPrompt;
  const history = useCallback(async () => {
    const result = await window.api.invoke('agent.history', { path: projectPath }) as RecordValue;
    if (currentPath.current !== projectPath) return;
    setMessages(displayMessages(result.messages ?? []));
    setContextUsage(result.contextUsage ?? null);
    setRun(result.run ?? null); setEvents((result.events ?? []).slice(-200));
    cursor.current = result.events?.at(-1)?.sequence ?? 0;
  }, [projectPath]);
  useEffect(() => {
    setMessages([]); setEvents([]); setRun(null); setError(''); setContextUsage(null); cursor.current = 0;
    void history().catch((error) => setError(String(error)));
  }, [history]);
  useEffect(() => {
    if (!projectPath || run?.status === 'running') return;
    let disposed = false; let pending = false;
    const timer = setInterval(async () => {
      if (pending || sendingRef.current) return;
      pending = true;
      try {
        const result = await window.api.invoke('agent.get-run', { path: projectPath, after: cursor.current }) as RecordValue;
        if (disposed || currentPath.current !== projectPath || sendingRef.current) return;
        setContextUsage(result.contextUsage ?? null);
        if (result.run && (result.run.id !== run?.id || result.run.status !== run?.status || result.events.length)) {
          await history();
          if (!disposed) { external.current?.(); await refresh.current(); }
        }
      } catch (error) { if (!disposed) setError(String(error)); }
      finally { pending = false; }
    }, 1000);
    return () => { disposed = true; clearInterval(timer); };
  }, [projectPath, run?.id, run?.status, history]);
  useEffect(() => {
    if (run?.status !== 'running') return;
    let disposed = false; let pending = false;
    const tick = async () => {
      if (pending) return; pending = true;
      try {
        const result = await window.api.invoke('agent.get-run', { path: projectPath, after: cursor.current }) as RecordValue;
        if (disposed || currentPath.current !== projectPath) return;
        setContextUsage(result.contextUsage ?? null);
        cursor.current = result.cursor;
        setEvents((events) => [...events, ...result.events].slice(-200));
        for (const event of result.events) if (event.type === 'assistant') setMessages((messages) => [...messages, { role: 'assistant', text: event.data.text }]);
        if (result.events.some((event: RecordValue) => event.type === 'tool-result')) await refresh.current();
        if (result.run?.status !== 'running') { await history(); await refresh.current(); }
        else setRun(result.run);
      } catch (error) { if (!disposed) setError(String(error)); }
      finally { pending = false; }
    };
    void tick(); const timer = setInterval(() => void tick(), 800);
    return () => { disposed = true; clearInterval(timer); };
  }, [run?.id, run?.status, history, projectPath]);
  const send = async (text: string) => {
    if (sendingRef.current || run?.status === 'running' || !text.trim()) return false;
    sendingRef.current = true; setSending(true); setError('');
    try {
      const result = await window.api.invoke('agent.start', { path: projectPath, message: text }) as RecordValue;
      if (currentPath.current !== projectPath) return false;
      setMessages((messages) => [...messages, { role: 'user', text }]);
      setRun({ id: result.runId, status: 'running' }); return true;
    } catch (error) { setError(String(error)); return false; }
    finally { sendingRef.current = false; setSending(false); }
  };
  const stop = async () => {
    try { await window.api.invoke('agent.cancel', { path: projectPath }); }
    catch (error) { setError(String(error)); }
  };
  return { messages, setMessages, events, run, contextUsage, error, busy: sending || run?.status === 'running', send, stop, history };
}
