type Value = Record<string, any>;
const names: Record<string, string> = {
  list_files: '查看目录', read_file: '读取文件', write_file: '写入文件', apply_patch: '应用补丁', search_files: '搜索文件', search_text: '搜索内容',
  write_stdin: '终端输入', resize_terminal: '调整终端', list_skills: '查看技能', load_skill: '加载技能',
  exec_command: '执行命令', read_process_output: '检查运行结果', terminate_process: '停止命令'
};
const statuses: Record<string, string> = {
  running: '正在处理', completed: '已完成', failed: '执行失败', cancelled: '已停止',
  interrupted: '执行已中断', limited: '已达到本轮执行上限'
};

export function AgentActivity({ events, run }: { events: Value[]; run: Value | null }) {
  const groups = new Map<string, { time: number; calls: Map<string, Value>; notes: Value[] }>();
  for (const event of events) {
    if (!['tool-start', 'tool-result', 'diagnostic'].includes(event.type)) continue;
    const id = event.runId;
    if (!groups.has(id)) groups.set(id, { time: event.timestamp, calls: new Map(), notes: [] });
    const group = groups.get(id)!;
    if (event.type === 'diagnostic') { group.notes.push(event); continue; }
    const data = event.data;
    const call = group.calls.get(data.id) ?? { id: data.id, name: data.name };
    if (event.type === 'tool-start') call.input = data.input;
    else { call.result = data.result; call.finished = true; }
    group.calls.set(data.id, call);
  }
  if (run && !groups.has(run.id)) groups.set(run.id, { time: run.startedAt ?? Date.now(), calls: new Map(), notes: [] });
  return <div className="agent-activity" aria-label="执行记录">
    {[...groups].map(([id, group]) => {
      const current = id === run?.id;
      const active = current && run?.status === 'running';
      const calls = [...group.calls.values()];
      const pending = [...calls].reverse().find((call) => !call.finished);
      const label = active && pending ? names[pending.name] ?? '正在使用工具' : current ? statuses[run!.status] ?? '执行记录' : '执行记录';
      const warning = current && ['failed', 'interrupted', 'limited'].includes(run!.status);
      return <details className="activity-group" key={id}>
        <summary className="activity-summary">
          <span className={`activity-dot${active ? ' active' : ''}${warning ? ' warning' : ''}`} aria-hidden="true" />
          <span className="activity-label">{label}{active && pending ? '…' : ''}</span>
          <span className="activity-meta">{calls.length ? `${calls.length} 项操作` : '对话'} · {new Date(group.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
          <span className="activity-chevron" aria-hidden="true">›</span>
        </summary>
        <div className="activity-body">
          {current && run?.error && <p className="agent-error">{run.error}</p>}
          {!calls.length && <p className="activity-empty">{active ? '正在整理回复…' : '本轮未调用工具。'}</p>}
          {calls.map((call) => {
            const data = call.result?.data;
            const failed = call.result?.ok === false || ['failed', 'timed-out'].includes(data?.status);
            const state = failed ? '失败' : !call.finished ? active ? '进行中' : '未完成' : data?.status === 'running' ? '已启动' : data?.status === 'cancelled' ? '已停止' : '已返回';
            const target = call.input?.path ?? call.input?.command ?? call.input?.processId;
            return <details className="activity-tool" key={call.id}>
              <summary>
                <span className="activity-tool-name">{names[call.name] ?? call.name}</span>
                <span className="activity-target" title={target}>{target}</span>
                <span className={`activity-tool-state${failed ? ' error' : ''}`}>{state}</span>
              </summary>
              <div className="activity-payload">
                {call.input && <><span>参数</span><pre>{JSON.stringify(call.input, null, 2).slice(0, 10000)}</pre></>}
                {call.finished && <><span>结果</span><pre>{JSON.stringify(call.result, null, 2).slice(0, 10000)}</pre></>}
              </div>
            </details>;
          })}
          {group.notes.map((note) => <details className="activity-tool" key={note.sequence}><summary>扩展加载提示</summary><pre>{JSON.stringify(note.data, null, 2)}</pre></details>)}
        </div>
      </details>;
    })}
  </div>;
}
