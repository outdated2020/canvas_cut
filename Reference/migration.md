# 旧文档迁移对照

核对日期：2026-10-11。迁移依据为当前工作区源码，包含已有未提交的白模功能。旧设计不是实现证据；本表保留迁移来源名称，不保留被替代文件的链接。

## 内容归属

| 旧文档 | 新的唯一内容归属 | 处理方式 |
| --- | --- | --- |
| OVERVIEW.md | 根目录 AGENTS.md、[索引](README.md)、[产品](product.md) | 重写总览；删除旧技术选型口径。 |
| TECH_DESIGN.md | AGENTS.md、[工程](modules/engineering.md)、[问题记录](issues.md)、[决策](decisions.md) | 按 manifest 和源码更新栈；未实现能力进入待办。 |
| REPO_STRUCTURE.md | [索引](README.md)、[工程](modules/engineering.md) | 用实际源码归属替代未创建的 job/storage/resources 等目录。 |
| CORE_ENGINE_DESIGN.md | core 的[画布](modules/core-canvas.md)、[时间线](modules/core-timeline.md)、[Provider](modules/core-provider.md)、[缓存](modules/core-cache.md)、[媒体](modules/core-media.md)，桌面[任务](modules/desktop-jobs.md) | 拆分领域算法、外部适配、调度与持久化；接口指向源码。 |
| CANVAS_PROTOCOL.md | [画布](modules/core-canvas.md)、[缓存](modules/core-cache.md) | 保留图、端口、hash、执行、预设契约；嵌套传播、输入槽位和迁移按实现状态标注。 |
| PROJECT_STATE_PROTOCOL.md | [项目存储](modules/core-storage.md)、[任务](modules/desktop-jobs.md)、[启动与设置](modules/desktop-shell.md) | 分离项目 JSON、任务 SQLite、运行时凭证；纠正相对路径和 Keychain 的泛化表述。 |
| PROVIDER_ADAPTER_DESIGN.md | [Provider](modules/core-provider.md)、[任务](modules/desktop-jobs.md) | 按当前适配器说明请求转换，TOS 实现归桌面任务；云端模型规格不作为保证。 |
| CLI_DESIGN.md | [CLI](modules/cli.md)、[基础契约](modules/core-foundation.md)、[桥接](modules/desktop-bridge.md) | 命令参数以源码 manifest/help 为准；删除 UI spawn CLI、esbuild/pkg 已实现的暗示。 |
| LOCAL_IPC_PROTOCOL.md | [桥接](modules/desktop-bridge.md)、[CLI 客户端](modules/cli.md) | 保留 envelope、端点、认证、路由和错误；通用 state 方法、大 payload 引用、事件推送等列为旧设计待办。 |
| AGENT_ORCHESTRATION_DESIGN.md | [Agent 宿主](modules/desktop-agent-host.md)、[Runtime](modules/agent-runtime.md) | 业务注入归宿主；通用模型循环归 Runtime。 |
| AGENT_RUNTIME.md | [Runtime](modules/agent-runtime.md)、[工具执行](modules/agent-tools.md)、[Skills/MCP 客户端](modules/agent-integrations.md)、[宿主](modules/desktop-agent-host.md) | 中文重写；保留文件与终端参数、补丁限制、会话恢复、MCP 配置及附件限制。 |
| TIMELINE_RENDER_DESIGN.md | [时间线](modules/core-timeline.md)、[媒体](modules/core-media.md)、[UI](modules/desktop-ui.md) | 当前是单个 FFmpeg filter graph 和 HTML 预览；分段缓存、xfade/acrossfade、ASS、代理视频保留为待办。 |
| UI_LAYOUT_DESIGN.md | [UI](modules/desktop-ui.md)、[产品](product.md)、[决策](decisions.md)、根目录 PLAN.md | 保留画布优先、左侧 Agent、查看器/时间线关系；旧尺寸、快捷键和占位功能不当作当前契约。 |
| FLOWS.md | AGENTS.md、[桥接](modules/desktop-bridge.md)、[任务](modules/desktop-jobs.md)、[Runtime](modules/agent-runtime.md) | 在归属模块描述当前流程，移除 Mastra、UI spawn CLI、job:update 已接线及自动审批流程的旧假设。 |
| PRD.md | [产品](product.md)、[决策](decisions.md)、根目录 PLAN.md | 保留用户、创作场景、非目标、阶段和风险；架构内容改为模块链接。 |
| REVIEW_ACTIONS.md | [决策](decisions.md)、[问题记录](issues.md)、根目录 PLAN.md | 保留 H/M/L/N/S 评审条目的有效决策和未完成事项；“设计已解决”不等于代码/实机验收。 |

## 保留的入口与材料

- 根目录 README.md 负责启动、配置、MCP 使用示例和排障；架构细节链接到本目录。
- 根目录 PLAN.md 保留原有阶段、日期、历史测试记录与未完成事项，仅更新文档引用和本轮治理状态。
- 评审目录、截图、HTML 设计附件、修补脚本、demo-project、agent-smoke 和用户文件保留原位；不迁移或清理。
- 旧文档有效接口通过模块文档链接到源码，避免复制一套随实现漂移的 Schema。过期设计条款在对应模块“已知边界偏差”中明确标注。

## 验收要求

删除旧文件前完成表中全部目标内容；检查源码链接、模块八个固定栏目和职责唯一归属。删除后检查维护文档不再链接旧文件。历史评审材料中的旧文件名允许保留为当时上下文，不是现行维护入口。

## 本轮验收记录

2026-10-11：16 份旧根目录文档完成合并重写并删除，新增 AGENTS.md 和 24 份 Reference 文档，其中 19 份模块说明。维护文档本地链接/锚点、八栏目、源码归属、迁移覆盖和空白检查通过；84 个应用/包 src 下 TS/TSX 文件各有唯一主要归属，配置/测试/脚本/内置 Skill 另归工程支持。源码归属检查不证明现有代码职责已收敛。

非 Markdown 文件与开始时的 272 个文件 SHA-256 对照一致，既有代码、依赖、媒体和运行数据未被本轮修改。README/PLAN 仅做文档入口收敛和引用更新，历史待办/验证日期保留；旧 README 的白模说明和开发端口排障内容已迁入所属模块。本轮没有执行业务测试、构建、实机媒体验收或付费服务调用。
