type RecordValue = Record<string, any>;

// Message snapshots are committed at step boundaries; an in-flight stream lives
// in the event journal. Restore it when returning to a running conversation.
export function restoreChatMessages(session: RecordValue): RecordValue[] {
  const messages: RecordValue[] = (session.messages ?? []).filter((message: RecordValue) => message.role === 'user' || message.role === 'assistant').map((message: RecordValue) => ({
    role: message.role,
    text: typeof message.content === 'string' ? message.content : (message.content ?? []).filter((part: RecordValue) => part.type === 'text').map((part: RecordValue) => part.text).join('\n')
  })).filter((message: RecordValue) => message.text);
  if (session.run?.status !== 'running') return messages;
  const pending = new Map<string, string>();
  for (const event of session.events ?? []) {
    if (event.runId !== session.run.id || !event.data?.messageId) continue;
    const { messageId, text } = event.data;
    if (event.type === 'assistant-delta') pending.set(messageId, (pending.get(messageId) ?? '') + text);
    if (event.type === 'assistant') pending.delete(messageId);
  }
  for (const [id, text] of pending) {
    const last = messages.at(-1);
    if (last?.role === 'assistant' && last.text === text) last.id = id;
    else messages.push({ id, role: 'assistant', text });
  }
  return messages;
}
