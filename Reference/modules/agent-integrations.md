# Agent Skills 与外部 MCP 客户端

## 作用

唯一负责发现和加载外部说明/能力：Skills 提供工作流指引，MCP 客户端接入其他服务工具、资源和附件。二者不承接 Canvas Cut 领域业务。

## 对应源码

[skills.ts](../../packages/agent/src/skills.ts)、[mcp.ts](../../packages/agent/src/mcp.ts)。内置 Skill 正文归[工程支持](engineering.md)，目录由[宿主](desktop-agent-host.md)注入；对外服务端归 [CLI MCP](cli-mcp.md)。

## 负责事项

- parseSkill 校验 YAML frontmatter，SkillRegistry 按顺序扫描目录、同名覆盖、排序并返回 diagnostics。
- list_skills/load_skill 按需提供元数据/分页正文（工具接线位于 Runtime）；不通过 Skill 动态注册工具。
- McpManager 管理 stdio/Streamable HTTP 连接、发现工具/资源、命名空间、附件保存和断线诊断。

## 不负责事项

不注册 Canvas Cut CLI 的外部 MCP 服务，不生成应用提示、不管理模型会话或启动业务 job；不把来自工具/Skill/资源的文本升级为系统指令。

## 接口与依赖

Skill 文件格式为 YAML frontmatter + Markdown，必须有效 name（小写字母/数字/连字符）和非空 description；version/inputs/triggers/outputs 可选。每次 Run 重新发现；目录按低→高优先级遍历，通常内置→用户→项目，同名后者覆盖。错误进入 diagnostics，不把全盘扫描当作安装/热更新服务。加载正文遵循 nextLine，关联资源按 baseDirectory 解析。

McpServerConfig：name/transport 必填；stdio 需 command，可传 args/cwd/env；http 需无内嵌用户名密码的 HTTP(S) url，可传 headers；另可传 enabled、timeoutMs 1000–120000。配置校验/脱敏归[Runtime](agent-runtime.md)。连接默认 15s，调用默认 30s。示例：

```json
{"mcpServers":[{"name":"local","transport":"stdio","command":"node","args":["/absolute/server.js"]},{"name":"remote","transport":"http","url":"https://example.com/mcp","headers":{"Authorization":"Bearer replace-me"}}]}
```

工具使用 MCP SDK Client，按 server/tool 生成可调用命名空间和 hash 后缀，输入 Schema 由 ToolRegistry 校验，发现分页检查重复 cursor。每步边界刷新连接/工具目录，当前步工具映射固定；断线在后续步骤重连，不重放不确定的工具调用。

资源工具为 mcp_list_resources(server,cursor?)、mcp_list_resource_templates(server,cursor?)、mcp_read_resource(server,uri)。当前 transport 仅 stdio/http，不支持 OAuth、旧 SSE、prompts、sampling、elicitation。

## 数据和副作用

可以启动配置的 stdio 服务器、连接 HTTP、执行远端工具；env/headers 仅传配置连接，不作为普通模型消息或普通 Shell 环境。stdio stderr 被消费而不持久化可能包含凭证的诊断。二进制内容存 logDir 的 .attachment，单附件 ≤32 MiB，返回路径/大小/MIME；supportsImages=true 时每次最多 4 张、每张 ≤4 MiB 图片可传模型，其他内容仍是附件文件。此能力不等于用户上传图片链路已完成。

## 验证入口

[agent.test.mjs](../../tests/agent.test.mjs)包含 Skill YAML/覆盖/错误诊断；[runtime-mcp.test.mjs](../../tests/runtime-mcp.test.mjs)覆盖真实本地 stdio/HTTP、命名空间、Schema 和资源。本轮未运行或连接用户配置的服务。

## 已知边界偏差

Skill 安装/版本/依赖管理、运行中热更新和完整阅读强制机制、OAuth/交互扩展仍未实现；当前完整加载主要依赖工具描述及模型遵循。服务器测试会启动配置的本地服务，不能当作纯文本校验。后续见 [PLAN](../../PLAN.md)。
