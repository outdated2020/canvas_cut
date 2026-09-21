# Agent、Skills 与 CLI 编排

更新：2026-09-08。通用本地执行版本已实现，真实 Provider、macOS 与安装包待验收。

## 架构

```text
React Chat → Electron IPC → AgentSessionService → AI SDK
                                             ↓
                              七个基础工具 → AgentHost
                                             ↓
                                      LocalAgentHost
                                             ↓
                       PowerShell / Bash → canvas-cut CLI
                                             ↓
                                 core / IPC → Daemon → Worker
```

Agent 不注册画布、渲染或时间线专用工具。视频能力由 SKILL.md 描述操作流程，CLI 提供确定性的业务命令。CLI manifest 是命令发现数据，不自动转换成模型工具。

## 基础执行工具

| 工具 | 行为 |
| --- | --- |
| list_files | 有限深度和分页列目录，不跟随目录符号链接 |
| read_file | UTF-8 文本按行读取，单文件上限 16 MiB |
| write_file | 原子写入，单次上限 1 MiB |
| edit_file | 精确单次匹配替换，缺失或歧义返回错误 |
| exec_command | 新建独立非交互 Shell，返回 processId、日志偏移、状态与退出码 |
| read_process_output | 按字节偏移读取 stdout/stderr，单次最多等待 10 秒 |
| terminate_process | 终止当前会话拥有的进程树 |

Windows 使用 PowerShell，macOS 使用 Bash。cwd 默认项目目录，支持显式 cwd 和绝对路径。当前是 local-trusted 模式，不隔离文件系统或网络，也没有逐条命令审批。常见凭证环境变量从 Shell 子进程中剔除；这不构成凭证隔离，用户仍应按可信本地程序使用。

命令默认最多运行 30 分钟，首次约 1 秒后返回，长任务继续轮询。各次命令不共享 Shell 变量。工具结果超过 32 KiB 时完整内容存文件，模型收到摘要和日志路径。结束、取消或关闭应用会停止该轮存活的 Shell 进程。已经提交的业务生成任务继续由 Daemon 管理，需用 CLI job cancel 单独取消。

## Skills

每轮扫描，优先级从低到高：

1. 仓库内置 skills。
2. 用户 ~/.canvas-cut/skills。
3. 项目 skills。

每个 Skill 放在独立目录的 SKILL.md 中；必需 YAML 字段 name、description，支持 BOM、LF/CRLF、数组及多行值。同名 Skill 由高优先级覆盖，解析失败产生诊断而不终止其他 Skill 加载。

系统提示仅提供名称、说明、文件路径。模型使用 read_file 按需读取正文，再按流程调用 CLI。内置 canvas-cut 提供图编辑和时间线操作，image-to-video 与 storyboard-to-video 描述组合工作流。Skill 不是强制流程引擎，真实模型遵循情况需要场景评测。

## CLI 契约

桌面启动时在 userData/agent/bin 写入 canvas-cut launcher，绑定应用运行时与仓库构建的 CLI，并将此目录加入 Agent Shell PATH。开发构建需生成 apps/cli/dist/index.js；安装包资源定位和签名另行完成。

命令发现使用 canvas-cut manifest --json 或命令 --help。业务结果 stdout 使用 {ok,data} / {ok:false,error}，诊断日志写 stderr，失败退出码非零。复杂参数使用 UTF-8 JSON 文件和 --params-file，避免不同 Shell 的内联 JSON 转义问题。

渲染及生成返回 jobId，需 job wait/status 检查终态。job wait 的 IPC 传输期限比业务等待长 5 秒。显式 --idempotency-key 可跨进程复用；未知提交结果先查状态。--dry-run 仅允许生成、画布渲染、时间线导出，其余命令拒绝且不执行修改。

## 会话与桌面接口

AgentSessionService 按规范化项目路径与 conversationId 分隔会话，写入 userData/agent/sessions。会话保存 user/assistant 消息、tool-call/tool-result、带序号的事件与运行状态；配置密钥不写入历史。

- agent.start：提交并立即返回 runId；同一会话禁止并发提交。
- agent.get-run：按 after 序号获取增量事件和运行状态。
- agent.cancel：中断模型请求并终止 Shell 进程。
- agent.history：加载持久化消息和事件。
- agent.chat：兼容旧调用，等待同一服务返回最终结果。

模型每次返回的工具调用先落盘，再执行副作用，再落盘结果。重启发现 running 时标记 interrupted，并为未完成调用补充明确的中断结果；绝不自动重放。用户继续时要求模型先查看项目和任务状态。

默认每轮最多 64 步；上下文达到 200000 字符时保存并停止。新一轮超过 120000 字符时将完整旧历史归档，保留路径、标识符、状态和可容纳的最近一轮。这是字符预算和结构化摘要，不是 token 精确计算或语义压缩。

桌面当前使用默认会话，加载真实历史、显示工具步骤及结果、轮询运行状态、提供停止按钮，并在工具返回后刷新项目视图。尚未提供会话切换和 token 级流式显示。

## 后续扩展与验证

AgentHost 将执行能力与模型循环分开。后续实现 SandboxAgentHost 时补充文件挂载、目录权限、网络控制、资源配额和凭证代理，保持现有工具协议。Web Search 后续作为基础工具接入，需提供来源链接和检索服务配置。

测试覆盖真实 AI SDK/mock HTTP、文件操作、中文 Shell 日志、超时与停止、会话恢复、CLI launcher、参数文件和 dry-run，以及真实 Shell/CLI/IPC/Daemon/Worker 与 fake Provider 的渲染闭环。真实模型规划、多镜头内容质量、付费生成、真实 FFmpeg、Electron UI 交互及跨平台分发另行验收。
