# 对外 MCP 服务与业务桥

## 作用

向外部 MCP Client 提供 Canvas Cut 的 stdio 工具入口，将业务工具注册到 Code Mode，并通过本地 IPC 访问桌面能力。

## 对应源码

[server.ts](../../apps/cli/src/mcp/server.ts)、[canvas-tools.ts](../../apps/cli/src/mcp/canvas-tools.ts)。服务不是 Agent 的[外部 MCP 客户端](agent-integrations.md)。

## 负责事项

- 处理 initialize、tools/list、tools/call 等 JSON-RPC 与请求取消、stdio 编码和 MCP 结果包装。
- 注册 Code Mode 发现/执行入口、会话与截图工具，并桥接 CANVAS_API。
- 注入默认 --project，适配 projectPath/idempotencyKey/signal，不重新定义画布 Schema。

## 不负责事项

不执行模型循环、JS 沙箱内部实现或画布/任务业务；不直接写项目文件和数据库。工具声明不是获得文件权限的沙箱策略。

## 接口与依赖

通过 CLI 的 mcp 命令启动。对外工具包括 search_tools、execute、agent_send_prompt、agent_get_run、agent_history、agent_cancel、ui_screenshot。画布/job 内部方法经 search_tools 发现、execute 调用 tools.*，不能当作顶层 tools/call 方法使用。

canvasTools 读取 core CANVAS_API 的描述、输入/输出 Schema，添加 projectPath，再由 LocalIpcClient 调用 method；返回 JSON text 和 structuredContent。projectPath 默认 MCP 的 --project，必须为已初始化项目，不跟随桌面 UI；canvas.node-types 无需项目。确切方法集引用[画布](core-canvas.md)和[任务](desktop-jobs.md)。

共享目录包含 canvas_create 的可选 name 和 canvas_rename({canvasId,name})；后者仅修改展示名称，返回 canvasId/name/version，不触发生成。通过 search_tools 发现后在 execute 内调用 tools.canvas_rename，仍要求桌面本地 IPC 在线；校验、锁和通知归 CanvasOperations。list/get 返回已保存名称。

Agent 工具可传 conversationId（缺省 default）；发送立即返回 runId，get_run 用 after 读取增量事件，history 查询会话，cancel 只取消 Agent run。ui_screenshot 的 fresh=true 请求新捕获，false 读取保存截图，返回 PNG 图片内容。stdio 每行一个 JSON-RPC 消息，stdout 专用于协议。

## 数据和副作用

服务维护请求 AbortController 和 Code Mode 实例，调用桥接产生实际业务副作用；截图读取文件。execute 超时/取消不会回滚已经完成的画布编辑或自动撤销已提交 job。agent_send_prompt 会启动具有本地文件/Shell 能力的 Agent，不能据 Code Mode 隔离推断该操作也在受限目录运行。

## 验证入口

[mcp.test.mjs](../../tests/mcp.test.mjs)覆盖共享会话；[canvas-codemode.test.mjs](../../tests/canvas-codemode.test.mjs)覆盖发现/编辑/生成/取消与不可用桌面。本轮未运行。服务使用/客户端编码示例见[README](../../README.md)。

## 已知边界偏差

服务自实现 JSON-RPC 分发，不能因 agent 包采用 MCP SDK 就声称服务端所有扩展可用。新工具应保持 core 元数据/实际返回/发现提示一致，避免工具描述漂移，见 [H-01](../issues.md#h-01)。
