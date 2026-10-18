# 通用 Agent Runtime、会话与上下文

## 作用

提供与 Electron、Canvas Cut core 独立的 Node Agent 库，唯一负责模型循环、Run/会话、上下文预算和事件持久化恢复。

## 对应源码

[runtime.ts](../../packages/agent/src/runtime.ts)、[sessions.ts](../../packages/agent/src/sessions.ts)、[context-usage.ts](../../packages/agent/src/context-usage.ts)、[config.ts](../../packages/agent/src/config.ts)、[index.ts](../../packages/agent/src/index.ts)。

## 负责事项

- AI SDK 单步 Chat 调用，选择 OpenAI 或 DeepSeek 协议适配器，流式文本/工具调用收集，串行执行完整工具调用，步数与上下文限制。
- 模型调用前构造分层提示，运行中摘要压缩、完整历史归档、usage 事件和估计 Token 校准。
- 每会话单个活动 Run，消息/事件/快照持久化，管理会话元数据和中断恢复，不重放未知副作用。
- RuntimeConfig 校验、公开读取脱敏、敏感字段保留/清空合并规则；实际加密存储归[桌面设置](desktop-shell.md)。

## 不负责事项

不嵌入视频工作流或 CLI 业务、不操作 SQLite，不实现底层文件/进程执行、Skill 解析或 MCP transport。工具由[工具模块](agent-tools.md)和[集成模块](agent-integrations.md)提供，应用注入由[宿主](desktop-agent-host.md)提供。

## 接口与依赖

runAgentMessage(options) 接受 apiKey/baseUrl/model/fetch、host/skills/context/logDir、messages、save/emit；可传 streaming、maxSteps、applicationPrompt/recoveryContext、projectPath、mcpServers/supportsImages、字符预算与 additionalTools。返回 {text,status:completed|limited}。additionalTools 的定义/校验契约归工具模块。工具调用完整记录先 save，再执行；结果 save 后进入下一步，持久化失败不得先做副作用。流式默认为开，也支持 streaming:false；maxRetries 当前为 0。

当 baseUrl 的 hostname 为 api.deepseek.com，或 model 名称以 deepseek 开头（含斜线/冒号前缀，如 vendor/deepseek-v4-pro）时，使用 @ai-sdk/deepseek 的 Chat 适配器；其余使用 @ai-sdk/openai 的 Chat 适配器。保留配置的 baseUrl/model/API Key/fetch，未指定 baseUrl 时由所选适配器使用官方默认地址；摘要压缩和执行步骤复用同一模型。仅识别模型/端点，不改变用户模型的思考模式。通过未知代理且模型 ID 不含 deepseek 时不自动识别，未新增供应商选择字段。

DeepSeek 返回的 reasoning_content（含 SSE 增量）由适配器转换为标准 ModelMessage reasoning 内容段，随 responseMessages 在工具执行前保存。后续工具步骤及新用户轮次从会话恢复并按适配器协议回传，V4 包括之前普通最终回答的 reasoning_content；不把该内容当作 assistant 文本事件展示，也不使用临时内存映射替代持久化。旧版已丢弃的推理正文无法还原；SDK 对没有 reasoning 段的 V4 assistant 使用空字段兼容，不能据此宣称旧推理已恢复。协议依据见 [DeepSeek 思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)。

SystemPrompt 层次为 Identity、Scope and authority、Runtime context、Execution protocol、Application instructions、Skills、可选 Recovery context。Runtime context 包含 mode/platform/shell/cwd/projectPath/sessionId/runId/maxSteps/字符预算；Skill 元数据是按需匹配索引而非整个正文，业务说明使用 applicationPrompt，旧 systemPrompt 字段不再使用。

AgentSessionService 由 storageDir、configure、createHost、skillDirectories 等注入构建。start/getRun/history/cancel/chat、list/create/manage/shutdown 等公开接口以 sessions.ts 为准。projectPath 规范化后与 conversationId 共同生成会话键，缺省 default。归档会话须恢复才可发送；starting/running 时阻止冲突管理操作。软删除隐藏元数据，原快照/事件/日志保留；已知 ID 可通过 manage(...,'restore') 恢复，当前没有回收站 UI。

独立调用示例（配置地址和模型为占位）：

```ts
import { AgentSessionService, LocalAgentHost } from '@canvas-cut/agent';
const service = new AgentSessionService({
  storageDir: '/absolute/runtime/sessions',
  configure: async () => ({
    apiKey: process.env.AGENT_API_KEY!, baseUrl: 'https://example.com/v1',
    model: 'your-model', maxSteps: 64,
    contextLimitCharacters: 200000, compactThresholdCharacters: 120000
  }),
  createHost: (cwd, logDir) => new LocalAgentHost({
    cwd, logDir, journalDir: '/absolute/runtime/patches'
  }),
  skillDirectories: cwd => ['/absolute/builtin-skills', `${cwd}/skills`]
});
const { runId } = await service.start('/absolute/workspace', 'Complete my task');
// 使用 getRun(workspace, conversationId, cursor) 读取结果；退出前 await service.shutdown()。
```

RuntimeConfig 可设 bashPath/powershellPath、maxSteps 1–1000、contextLimitCharacters 10000–2000000、compactThresholdCharacters 5000–1900000、supportsImages、mcpServers（最多 30）。压缩阈值必须低于预算；默认最大 64 步、字符预算 200000、压缩阈值 120000，预算包含 system/tool 定义。Token 展示是模型用量校准的估算，不是精确计量或模型上下文窗口承诺。

publicRuntimeConfig 隐藏 MCP env/headers 并返回 hasCredentials；mergeRuntimeConfig 省略 env/headers 保留旧值，显式 {} 清空，服务器改名需重新输入凭证。MCP 的具体连接配置归[集成模块](agent-integrations.md)。

## 数据和副作用

桌面注入 userData/agent/sessions；会话 JSON 快照和追加 JSONL 事件保持消息、工具、运行/管理状态。AgentRun 状态为 running/completed/failed/cancelled/interrupted/limited。事件 cursor 单调递增，文本增量与最终文本使用稳定 ID；UI 以 cursor 查询，服务直接保存的 session.run 是最近运行而非完整结构化 Run 索引。

启动回放已提交事件、截断残尾，将未结束 Run 标 interrupted，补齐未完成工具结果。下一次请求启动新 Run 并附恢复提示，不能称为自动续跑；恢复段只在需要时注入。各会话可分别运行，工具在单轮串行，当前没有全局模型队列/费用预算。压缩保存原历史到归档。会话和日志为明文；机密配置由桌面安全存储，二者不能混称全加密。

取消终止模型请求和当前 run 所属本地进程；不自动取消已提交 Canvas Cut job 或远端任务。超过 32 KiB 的工具结果写日志后返回 preview/logPath，完整结果可分页读取。模型、工具和持久化调用均可能产生副作用。

## 验证入口

[agent.test.mjs](../../tests/agent.test.mjs)、[runtime.test.mjs](../../tests/runtime.test.mjs)、[conversations.test.mjs](../../tests/conversations.test.mjs)、[context-usage.test.mjs](../../tests/context-usage.test.mjs)覆盖提示、SDK mock、流式持久化、中断/压缩、会话与用量估算。本轮未运行；测试定义不证明真实模型规划质量。

[deepseek.test.mjs](../../tests/deepseek.test.mjs) 使用严格模拟接口检查连续工具步骤、跨用户轮次与重建会话服务后每条 assistant 的 reasoning_content 原样回传；覆盖流式 SSE 跨帧/UTF-8 边界、非流式、代理模型 ID 和官方端点别名，以及不会重复执行工具或将推理显示为普通文本。2026-10-17：上述测试与 Agent/Runtime/会话/上下文共 32 项回归及类型检查通过；未调用真实付费模型。

同日完整回归：并行首次为 95/96，唯一失败是原生 PTY 输出时序，单独重跑该文件 3 项通过；完整测试以文件串行运行后 96 项全部通过。DeepSeek 专项另在 Electron 内置 Node 下运行 4 项通过，未将单纯宿主 Node 验证当作桌面运行时兼容结论。

## 已知边界偏差

暂无 waiting_input/waiting_approval、检查点暂停/继续或自动重放；完整 Run/Message 查询模型、精确 Token/费用限制、全局并发队列、模型超时/可安全重试策略、历史分页和跨进程持久化协调仍待补。事件推送、消息分支/编辑、多 Agent 等计划保留于 [PLAN](../../PLAN.md)。
