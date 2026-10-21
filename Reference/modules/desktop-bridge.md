# 桌面桥接与本地 IPC

## 作用

负责 renderer/外部本地进程与桌面服务之间的传输、认证、路由和返回适配；不拥有被调用的业务规则。

## 对应源码

[ipc-server.ts](../../apps/desktop/src/main/ipc-server.ts)、[ui-capture.ts](../../apps/desktop/src/main/ui-capture.ts)、[preload.ts](../../apps/desktop/src/preload/preload.ts)、[white-model-preload.ts](../../apps/desktop/src/preload/white-model-preload.ts)。客户端实现归 [CLI](cli.md)。

## 负责事项

- LocalIpcServer 发布实例信息，建立 Node net 服务，解码按换行分隔的 JSON，请求校验版本/token 并路由。
- preload 暴露 window.api.invoke 与 onCanvasChanged，并限制允许通道；白模 preload 只暴露 config/frame/complete。
- 将 core 的画布变更通知传递给 renderer；捕获主窗口 PNG 并返回路径/尺寸信息。

## 不负责事项

不持有 job 队列、重复实现 CanvasOperations、访问模型或组织时间线编辑。白模动态通道在任务执行器内注册，其身份检查属于该执行会话；桥接只负责 preload 消息转换。

## 接口与依赖

Windows endpoint 为命名管道，其他平台为 userData/ipc 下 Unix socket。实例文件 userData/ipc/instance.json 包含 protocolVersion:1、instanceId、pid、endpoint、token、startedAt，以临时文件 rename 发布。请求为：

```json
{"protocolVersion":1,"requestId":"uuid","method":"job.status","projectPath":"C:/Projects/video","idempotencyKey":"optional","token":"instance-token","payload":{"jobId":"job-id"}}
```

响应包含 protocolVersion/requestId/ok/data/error；error 为 code/message/retryable。conversationId 位于 Agent 请求的 payload，不是独立的顶层路由字段。调用方显式携带 projectPath，不跟随 UI 当前项目。

当前方法：ping；CANVAS_API 中的画布编辑/发现方法与 canvas.render；job.submit/status/wait/cancel/list/clear；agent.start/get-run/history/cancel/chat；ui.screenshot。具体参数来自相应模块源码，不存在通用 state.read、state.write 或 command.dispatch。

renderer 使用 invoke(channel, payload)，只通过单个 canvas-cut:invoke 通道调用主进程；画布变更事件为 canvas-cut:canvas-changed。主进程还提供会话管理、Runtime 设置、配置、项目/资产/预设/时间线等 UI 通道，白名单见 preload 源码。主窗口业务 handler 由[启动模块](desktop-shell.md)装配。

preload 白名单包含 canvas.rename；主进程将 name 原样传给 CanvasOperations，创建同样保留 name，不再丢弃旧占位参数。重命名返回 canvasId/name/version，并复用既有变更事件刷新列表与当前画布；命名校验和持久化归[画布](core-canvas.md)。

## 数据和副作用

renderer 白名单包含 `settings.export-model-api`、`settings.import-model-api`，均仅在桌面主进程调用系统文件对话框，不向 CLI/MCP 暴露文件读写入口。参数、文件格式和保存语义归[桌面设置](desktop-shell.md)；取消返回 cancelled:true，导入配置只返回白名单字段给表单。

建立本地端点、写实例文件、发送消息、写截图 userData/ui-screenshots/main-window-latest.png；不新增网络监听端口。stop 关闭服务并移除实例文件/socket。截图可被 MCP 读取并作为图片返回，图片是 UI 捕获而非生成素材。连接/调用取消不自动回滚已发送的业务请求，任务取消应调用[任务接口](desktop-jobs.md)。

## 验证入口

[canvas-codemode.test.mjs](../../tests/canvas-codemode.test.mjs)、[mcp.test.mjs](../../tests/mcp.test.mjs)、[canvas-sync.test.mjs](../../tests/canvas-sync.test.mjs)分别覆盖 IPC 业务桥、会话桥和刷新通知。真实窗口截图、白模通道、macOS socket 需实机验收，本轮未运行。

## 已知边界偏差

桥接仍为字符串/通用对象接口，缺少完整共享类型映射，见 [H-04](../issues.md#h-04)。旧设计的大 payload 临时引用、通用 state 方法、job:update 推送和全局方法 Schema 生成没有完整接线；当前任务/Agent UI 主要轮询。主窗口的 sender 校验与白模通道不同，不能据白模实现宣称所有桥接安全策略相同。
