# Agent、Skills 与 CLI 编排

实现说明、工具参数、配置和恢复行为见 [AGENT_RUNTIME.md](AGENT_RUNTIME.md)。

桌面通过 Electron IPC 调用通用 AgentSessionService。Runtime 使用 AI SDK 单步流式模型调用，经 ToolRegistry 调度文件、apply_patch、Skills、Shell/PTY 和外部 MCP 工具。

Canvas Cut 业务提示和 CLI launcher 由桌面宿主注入；CLI 仍通过 core / Local IPC → Daemon → Worker 执行业务任务。Agent 取消只停止当前 run 的模型与本地进程，不自动取消已提交的远端生成任务。

现有 CLI MCP 服务继续向外提供共享 Agent 会话和截图能力；它与 runtime 新增的外部 MCP 客户端是两个方向的接口。
