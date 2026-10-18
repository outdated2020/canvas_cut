# Agent 工具注册与本地执行

## 作用

唯一负责通用工具的 Schema 注册与本地文件/补丁、Shell/PTY 执行；工具的业务含义与运行持久化由调用者负责。

## 对应源码

[tools.ts](../../packages/agent/src/tools.ts)、[files.ts](../../packages/agent/src/files.ts)、[host.ts](../../packages/agent/src/host.ts)、[pty.ts](../../packages/agent/src/pty.ts)。

## 负责事项

- ToolRegistry 注册 ToolDefinition，Ajv 校验参数，拒绝重复名称；不静默覆盖工具。
- LocalAgentHost 分发文件/进程操作，清理常见凭证环境变量，限制输出和所属 Run，处理取消/结束清理。
- FileTools 处理 UTF-8、查找、完整读取快照、独占创建、哈希覆盖与可回滚补丁。
- PtyProcesses 处理真实交互终端、输入/输出、尺寸、超时和进程树终止。

## 不负责事项

不实现模型循环、会话记录、Canvas Cut 业务、MCP 协议或 Skill 解析。本地工具不是文件系统沙箱；命令 cwd 仅是工作目录。

## 接口与依赖

ToolDefinition 含 name/description/inputSchema/execute(input,context)，ToolContext 含 sessionId/runId/toolCallId?/signal。基础工具参数拒绝未知字段；当前没有 edit_file。

| 文件工具 | 必填 | 可选/默认 |
| --- | --- | --- |
| list_files | path | depth 1–5（1）、offset 0–100000（0）、limit 1–500（100）、includeHidden false |
| search_files | pattern | path .、exclude []、includeHidden false、respectGitignore true、offset 0、limit 100 |
| search_text | 非空 query | path .、regex false、caseSensitive true、include [**/*]、exclude []、contextLines 0–5（0）、分页/隐藏/忽略选项同上 |
| read_file | path | startLine 1–10000000（1）、lineCount 1–2000（200） |
| write_file | path、content | mode create/overwrite（create）、createDirectories false；overwrite 必须 expectedHash，create 禁止 expectedHash |
| apply_patch | patch | 无 |

文件路径绝对或相对 cwd，不展开 ~、环境变量或 Shell；行号从 1、分页 offset 从 0。读取返回原换行 content/totalLines/nextLine/fileHash/sizeBytes/lineEnding/hasBom，hash 包含 BOM/换行原始字节。读取 UTF-8 文件 ≤16 MiB，写 content ≤1 MiB；覆盖保留 BOM。目录遍历不跟随符号链接目录，文件操作解析链接目标（含删除）。搜索默认忽略 .git、隐藏与嵌套 gitignore，返回 nextOffset，文本附上下文/textTruncated；优先 rg，缺少时 Node fallback，单行 regex 不支持 lookaround/backreferences，复杂 Unicode 引擎可能不同。

补丁语法支持 Begin/End Patch、Add/Update/Delete File、Move to、@@/精确 anchor、End of File。现有文件须在当前 Run 完整分页读取后才可更新/移动/删除；上下文必须唯一精确匹配，不能模糊定位。混合换行更新拒绝；保留既有 BOM/换行/末尾换行，新文件 LF；目标改变返回 FILE_CHANGED，新增/移动目标必须不存在。限制 1 MiB patch、100 操作、单文件 16 MiB、总 before/after 64 MiB。

```text
*** Begin Patch
*** Add File: src/new.ts
+export const value = 1;
*** Update File: src/old.ts
*** Move to: src/renamed.ts
@@
-export const name = "old";
+export const name = "new";
*** Delete File: src/unused.ts
*** End Patch
```

| 终端工具 | 参数 |
| --- | --- |
| exec_command | command 必填；cwd/shell:bash或powershell、tty false；yieldTimeMs 0–10000（1000）、timeoutMs 100–1800000（1800000）、cols 10–500（100）、rows 2–300（30） |
| write_stdin | processId 必填；chars ''、action write/eof/interrupt、waitMs 0–10000（1000）、stdoutOffset/stderrOffset 0 |
| read_process_output | processId 必填；waitMs、stdoutOffset、stderrOffset 同上 |
| terminate_process | processId 必填 |
| resize_terminal | processId、cols、rows 必填 |

结果含 processId/status/exitCode、stdout/stderr 字节游标；PTY 输出合并 stdout 并保留控制序列。空 write_stdin 轮询不写入；管道 EOF 关闭 stdin；PTY EOF 需传终端控制字符。interrupt 对 PTY 发送 Ctrl-C，Windows 管道使用终止。输入 ≤1 MiB，日志 ≤64 MiB/进程。Windows 默认 PowerShell，bashPath 支持 Git Bash/常见路径探测，未做 WSL 路径映射。

## 数据和副作用

读写任意授权本地路径、补丁 journal、进程日志，启动本地进程。补丁先多文件预检查/记 before-after journal，再逐文件原子替换，整体不是 OS 原子事务；失败仅回滚仍匹配自身结果的文件，外部冲突保留并报告备份。recoverPatches 在启动恢复未完成 journal；无自动保留清理，失败可能留空目录。host.atomicText 只为 Agent 自身数据服务，不定义 Canvas Cut 项目锁协议。

进程按 session/run 隔离访问，结束/取消清理所属本地进程，不能以此取消已提交业务 job。node-pty 固定 1.1.0，有 Windows console cleanup 的私有 adapter 补丁，升级须检验兼容性。通用输出截断的历史记录策略由[Runtime](agent-runtime.md)规定。

## 验证入口

[runtime.test.mjs](../../tests/runtime.test.mjs)、[agent.test.mjs](../../tests/agent.test.mjs)、[runtime-native.test.mjs](../../tests/runtime-native.test.mjs)、[runtime-mcp.test.mjs](../../tests/runtime-mcp.test.mjs)覆盖补丁/回滚/UTF-8、真实管道和 Node/Electron PTY。本轮未执行。原生测试不等于 Linux/macOS 已验收。

## 已知边界偏差

暂无 SandboxAgentHost、目录/网络权限/审批或资源隔离；journal/日志保留、跨进程文件协作需完善。Windows PTY 私有接口 workaround 是版本约束，不能随意提升依赖版本。后续见 [PLAN](../../PLAN.md)。
