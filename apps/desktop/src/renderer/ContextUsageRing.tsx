export interface ContextUsage {
  usedCharacters: number;
  limitCharacters: number;
  compactThreshold: number;
  ratio: number;
  estimatedTokens?: number;
  lastRequest?: { inputTokens?: number; outputTokens?: number; model?: string; timestamp?: number } | null;
}

export function ContextUsageRing({ usage }: { usage: ContextUsage | null }) {
  const ratio = usage ? Math.max(0, Math.min(1, usage.ratio)) : 0;
  const percent = Math.round(ratio * 100);
  const format = (value: number) => value.toLocaleString('zh-CN');
  const request = usage?.lastRequest;
  const description = usage ? [
    `对话上下文：${format(usage.usedCharacters)} / ${format(usage.limitCharacters)} 字符（${percent}%）`,
    '包含保留消息及最近一次请求的系统提示、工具定义开销，不含未发送草稿。',
    `达到 ${format(usage.compactThreshold)} 字符后，在完整工具交互边界尝试归档和摘要压缩。`,
    `估算 ${format(usage.estimatedTokens ?? Math.ceil(usage.usedCharacters / 4))} tokens；实际用量见最近请求。`,
    '圆环表示应用的字符预算，不是模型 token 窗口。',
    request?.inputTokens != null ? `最近一次模型请求：输入 ${format(request.inputTokens)} tokens${request.outputTokens != null ? `，输出 ${format(request.outputTokens)} tokens` : ''}（${request.model ?? '当前模型'}）` : '模型 token 用量暂无数据。'
  ].join('\n') : '上下文统计加载中';
  return <span className={`context-usage${usage && usage.usedCharacters >= usage.compactThreshold ? ' is-high' : ''}`} tabIndex={0}
    title={description} aria-label={description}>
    <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
      <circle className="context-usage-track" cx="14" cy="14" r="10" fill="none" strokeWidth="1.5" />
      <circle className="context-usage-fill" cx="14" cy="14" r="10" fill="none" strokeWidth="4" pathLength="100"
        strokeDasharray={`${ratio * 100} 100`} transform="rotate(-90 14 14)" />
    </svg>
    <span>{usage ? `${percent}%` : '—'}</span>
  </span>;
}
