# Canvas Cut 执行计划

> 更新日期：2026-10-11（文档治理；历史验证日期保留）
> 当前状态：原型骨架及基础交互已实现；通用 Agent Runtime、MCP 客户端、Shell/PTY、多会话 UI 和分层 System Prompt 已接入。Phase 0 尚未完成真实端到端验收。
> 进度口径：代码实现、自动化测试通过、真实服务联调、产品验收分别记录，不能互相替代。
> 当前 Runtime 状态以第 11、12 节及 [Agent Runtime](Reference/modules/agent-runtime.md) 为准；带日期的实施记录保留当时状态。

## 1. 目标与下一个里程碑

桌面端生成式视频创作工具：时间线剪辑 + 节点画布 + Agent 编排。

**下一个里程碑：单画布生成、剪辑、预览、导出结果一致。**

验收路径：输入文本生成图片 → 图生视频 → 单画布执行 → 结果进入时间线 → 裁剪/变速/添加音轨 → 导出 MP4 → 回放核对画面、声音、时长。

## 2. 仓库结构与实际架构

技术栈和调用链见 [AGENTS.md](AGENTS.md)；唯一模块职责与实际源码归属见 [Reference](Reference/README.md)。架构问题和目标边界见 [问题记录](Reference/issues.md)。本计划管理阶段、待办和历史验证，不另定义一套模块规则。

## 3. 阶段状态

| 阶段 | 状态 | 完成边界 |
| --- | --- | --- |
| Phase 0：单画布闭环 | 实现中、待真实验收 | 基础生成、画布、时间线、导出均有代码；不能按“接口存在”宣布完成 |
| Phase 1：多轨、惰性更新、预设、子画布 | 部分实现 | 多轨基础预览、过期检测与手动更新、预设命令、两层嵌套执行已有；高保真合成与完整预设复用待补 |
| Phase 2：Agent 自动编排 | Runtime 基础能力已实现 | 流式循环、文件/补丁、Skills、Shell/PTY、MCP、压缩与多会话 UI 已有；执行续跑、多 Agent 及真实模型多镜头创作验收待完成 |
| Phase 3：产品化 | 未开始 | 分发、自动更新、多 Provider；账号/计费仍后置 |

| 里程碑 | 状态 | 说明 |
| --- | --- | --- |
| M0 工程骨架 | 已实现 | workspaces、TS、Electron、启动与构建；独立安装包未完成 |
| M1 状态协议 | 基础实现 | JSON、原子写、锁、SQLite；版本迁移、跨文件事务与恢复仍需加强 |
| M2 Provider | 部分联调 | 历史记录：2026-08-30 文生图真实成功；本轮未调用付费生成 API |
| M3 画布引擎 | 基础实现 | DAG、拓扑执行、缓存、父子任务；本轮修正子任务调度与缓存查询、限制两层嵌套 |
| M4 CLI/MCP | 基础实现 | CLI/manifest、对外会话 MCP 与 Runtime 外部 MCP 客户端已有；OAuth、交互扩展和外部客户端实机验收待补 |
| M5 主进程任务 | 部分完善 | 幂等提交、独立远端生成恢复、视频任务取消与 FFmpeg 中止已接线；画布中途恢复待补 |
| M6 UI | 基础交互与预览已实现 | 素材、播放器、时间线、多轨预览、多会话及 Runtime 设置；尚未做 UI 端到端和高保真一致性验收 |
| M7 导出 | 初版实现、待 FFmpeg 实测 | 本轮修复导出配置、合成底图、原声、变换、画布图像与裁剪；真实编码结果尚未验证 |

## 4. 本轮已修复（2026-09-06）

- [x] 导出弹窗 width / height / fps / crf 贯通到任务快照和 FFmpeg；增加偶数分辨率、帧率、CRF 校验。
- [x] FFmpeg 使用全时间线黑色底图，按片段有效范围叠加；保留轨道/片段顺序，避免以首段长度充当整体长度。
- [x] 导出使用片段位移、缩放、旋转、不透明度；画布输出图片按静态图循环读取。
- [x] 导出前探测视频音轨，将原声和独立音轨混音；变速音频拆分 atempo，淡化在片段局部时间执行。
- [x] 媒体片段和画布片段的拆分、裁剪、变速保留素材入点；导出解析画布时不覆盖用户裁剪时长、不修改输入对象。
- [x] 预览区区分素材预览与时间线预览；暂停定位、空隙、多层画面、原声/独立音轨、字幕及变换已有基础实现。
- [x] 历史四工具循环已被通用运行时替换，当前默认最多 64 步，通过 CLI 等待业务任务。
- [x] Agent 工具改用显式 JSON Schema，解决本轮发现的 TypeScript 类型推导内存耗尽；桌面构建声明 agent 项目依赖。
- [x] Job Worker 只调度根任务；节点成功来自实际执行/缓存结果；失败时保留已成功节点状态。
- [x] 取消 FFmpeg 使用 AbortSignal；视频生成接入 Provider cancel；本地取消状态不被异常改成失败。
- [x] 使用请求幂等键派生稳定任务 ID，请求摘要随任务持久化；同键异参拒绝，同项目提交串行化；IPC 传递幂等键。
- [x] 重启后有 provider_task_id 的独立生成任务恢复查询，不重复提交；没有可恢复远端标识的任务仍明确失败。
- [x] 读取时间线检测画布过期；修改图使 output 失效；新增 Update canvas clips 手动更新引用，保留片段裁剪长度。
- [x] 子画布执行限制两层；节点缓存按实际上游结果重新查询，强制重跑仍绕过缓存。
- [x] 运行时凭证使用 Electron safeStorage 加密；读取旧明文设置时在系统加密可用的情况下迁移。
- [x] 修复 style.css 中残留的字面量反引号 n。
- [x] ffprobe 探测失败时明确阻止视频导出；支持从配置的 FFmpeg 同目录定位 ffprobe，并限制探测超时。
- [x] 素材拖放尊重目标轨道；左侧裁剪同时更新片段位置，拖拽裁剪换算素材速度。
- [x] 补充 README 的环境、构建、启动、配置与验收说明。

以上为源码修复，不等于真实 Provider、系统凭证迁移或媒体输出已经验收。

## 5. 剩余问题与能力补充

### P0：真实闭环与效果正确性

- [ ] i2i、t2v、i2v、v2v、TOS 上传分别完成真实联调，记录输入参数、远端任务、输出与耗时。
- [ ] 配置 FFmpeg/ffprobe 后真实导出：首段不从零开始、多段拼接、中间空隙、重叠轨道、原声、无声视频、中文字幕、画布图片、裁剪和变速。
- [ ] crossfade 仍沿用单片段淡入淡出，需设计相邻片段重叠与真正的交叉转场；不能宣称完整转场已完成。
- [ ] 验证预览/导出一致性：字号与字体、旋转边界、音量大于 1、视频结束和音画同步。HTML 预览的音量当前上限为 1；尚非 WebGL 引擎。
- [ ] 通过 UI 跑完整生成与导出流程，包括失败、取消及重复点击；本轮没有完成浏览器/Electron UI 自动化验收。

### P1：任务可靠性与编辑完整性

- [ ] 画布节点级远端任务持久化、断点恢复；目前仅独立 generate.* 任务可恢复远端轮询。
- [ ] 图像同步请求的 AbortSignal、下载/上传中止、关闭应用时 worker 排空；取消不能撤销已发生的远端费用。
- [ ] 429/网络/5xx 的有界退避重试；避免对未知提交结果直接重新生成。
- [ ] 幂等记录独立保留策略、清理历史后的语义（CLI 显式复用键已实现）；当前去重依赖保留的任务记录。
- [ ] Undo/Redo 与编辑操作历史；项目备份、崩溃恢复、素材丢失重定位。
- [ ] 预设可配置输入槽位、跨项目资产引用、预设导入导出与 UI 保存。
- [ ] 子画布依赖更新传播、全图提交前深度校验、执行前参数 schema 验证。
- [ ] 拆分 App.tsx 的项目/素材/对话/时间线/设置模块，收敛 UI/CLI/Agent 的业务命令入口。
- [ ] 安全存储在 Windows/macOS 上验收，加密不可用时的设置交互和迁移失败恢复。

### P2：Agent 与创作体验

- [x] SkillRegistry 接入运行时；索引注入、按需读取正文，通过 Shell 调用 CLI，manifest 只负责命令发现。
- [ ] 分镜解析与结构校验、多镜头生成、字幕/音乐/转场自动组装、失败重试与人工修改后继续。
- [x] 按项目与 conversationId 持久化消息、工具调用与结果；异步运行、增量事件、停止、重启中断恢复。
- [x] 多会话 UI：新建、切换、重命名、归档/恢复、软删除；消息、运行状态、停止操作和内存草稿按会话隔离。
- [x] 流式文本增量、稳定文本事件 ID、增量事件游标；UI 轮询展示，返回运行中对话时还原未完成文本。
- [x] 运行中摘要压缩和原历史归档；字符预算包含系统提示和工具定义，Token 估算用模型报告的用量校准。
- [ ] 精确 Token 预算、历史分页与 Run 视图、回收站、草稿持久化、事件推送；Runtime 详细待办见第 12 节。
- [ ] WebGL 与代理视频、缩略图/真实音频波形、媒体元数据索引、缓存清理。
- [ ] Add/Attach/More 占位入口实现或隐藏；用户附件链路待接入，语音输入后置。History 已接入对话管理。
- [x] 继续使用 AI SDK；移除 Mastra 直接依赖，同步 Agent 设计文档。
- [ ] Web Search：后续增加检索工具、来源引用和可配置搜索服务。
- [ ] SandboxAgentHost：补充目录挂载与权限、网络控制、进程资源配额和凭证代理；保留当前 Host 接口。当前 local-trusted 无目录隔离和逐条命令审批。

### P3：分发与工程治理

- [ ] Electron 安装包、CLI 独立分发、FFmpeg/ffprobe 随包部署；Windows/macOS smoke test。
- [ ] 应用签名、更新机制、故障诊断包；账号/计费/多 Provider 后置。
- [ ] CI 持续运行构建、单元、IPC/Worker、UI 与真实媒体集成测试。
- [ ] 归档截图、历史 patch/fix 脚本及评审产物；demo-project/agent-smoke 包含现有用户文件，本轮不删除。
- [x] 2026-10-11：创建 AGENTS.md 和 Reference，合并重写旧设计并明确实际模块边界；现有职责重叠仅记录，未修改业务代码。

## 6. 验证记录

最近一次完整验证（2026-09-25）：

- `npm test`：59 项通过；覆盖流式工具循环、文件/补丁、会话管理与中断恢复、真实管道、Windows PTY、Node/Electron 原生冒烟、stdio/HTTP MCP、CLI/业务闭环。
- 中断恢复测试验证下一次模型请求包含恢复上下文、不重放未完成工具，后续正常请求不再带恢复段；CLI 集成测试实际调用 `load_skill`。
- `npm run build:desktop`、`git diff --check`：通过；Vite 仍提示产物超过 500 kB。
- 未验收：真实付费模型规划质量、完整 Electron UI 交互、Linux/macOS 原生执行、安装包和真实媒体闭环。
- 2026-10-03 本次仅同步计划文档，未重新运行上述测试或宣称新增验收。

历史验证（2026-09-06）：

- `npm test`：26 个测试通过（原有 17 个 + 9 个行为回归）。
- `npm run build:desktop`：已通过，原 CSS 语法警告已修复。
- 新增覆盖：真实 AI SDK + mock HTTP 多步工具循环；媒体/画布变速拆分裁剪；播放头命中与空隙；导出配置/底图/变换/原声命令；子进程中止；根任务调度；远端生成恢复；同键去重/冲突；画布解析非破坏性与过期状态。
- 未验证：真实火山方舟/TOS、真实 FFmpeg 编码、多轨 UI 播放性能、系统凭证迁移、macOS、安装包。

## 7. 环境与验收材料

- 历史已有 ARK 与 Agent 配置；不把密钥写入仓库或测试。
- 联调需 TOS bucket/region/endpoint/AK/SK，以及可执行 FFmpeg/ffprobe。
- 每项真实验收记录：环境版本、输入素材、操作步骤、预期结果、实际输出、日志/截图、失败与重试结果。
- Phase 0 完成时，必须保留一份可回放 MP4，并核对总时长、片段入点、声音和预览效果。

## 8. 设计文档索引

- [Reference 索引](Reference/README.md)：模块职责、源码映射与协作接口
- [产品范围](Reference/product.md)：用户目标与成片验收
- [架构问题](Reference/issues.md)：源码证据、建议归属与整改方向
- [必要历史决策](Reference/decisions.md)：仍有价值的设计选择与未实施方向
- [迁移对照](Reference/migration.md)：旧内容的新归属

2026-10-11 本轮仅进行文档治理；下面原有实施记录和测试数字保持各自历史日期，不代表本轮业务验证结果。

## 9. 通用 Agent 实施记录（2026-09-08）

以下为历史记录：其中 `edit_file` 已由 `apply_patch` 替代，上下文压缩已升级为运行中摘要；当前能力见第 11 节。

- [x] 模型工具仅保留 list_files、read_file、write_file、edit_file、exec_command、read_process_output、terminate_process。
- [x] Windows PowerShell / macOS Bash；项目默认 cwd、绝对路径、进程 ID、增量 UTF-8 日志、退出码、30 分钟超时、停止进程树。
- [x] 命令环境剔除常见凭证变量；CLI launcher 固定应用运行时与入口，不依赖用户安装全局命令。
- [x] Skill 优先级为项目 > 用户 ~/.canvas-cut/skills > 内置；每轮重新扫描、YAML 解析、错误诊断。
- [x] 内置 canvas-cut、image-to-video、storyboard-to-video Skills；覆盖图编辑、渲染、任务检查、时间线与导出。
- [x] CLI manifest/help、画布/资产列表、资产导入、时间线刷新、params-file、幂等键、长等待传输期限与严格 dry-run。
- [x] 工具调用先落盘再执行；重启不自动重放副作用。超过 120000 上下文字符时跨轮归档，单轮超过 200000 字符或 64 步时保存并停止。
- [x] 工具结果限制 32 KiB，超出写日志并返回路径；工具历史与日志保存在 userData/agent/sessions。
- [x] 桌面 agent.start/get-run/cancel/history；工具进度、历史加载、停止按钮、CLI 操作后刷新项目。
- [x] 本地回归覆盖 SDK mock + 真实 Shell/CLI/IPC/Daemon/Worker + fake Provider 的创建、渲染、幂等提交、时间线追加闭环。

本轮不包含真实付费 Provider/FFmpeg 验收、macOS/安装包验收。模型调用以 mock HTTP 验证协议与执行流程，不代表真实模型的任务规划质量。停止 Agent 不会自动取消已经提交给业务队列的生成任务。

验证结果：npm test 共 32 项通过；npm run build:desktop 通过；git diff --check 通过。Electron UI 实际交互、真实模型和真实媒体输出未在本轮验收。

## 10. MCP 对话接入（2026-09-09）

- [x] 保留 stdio MCP 的 ui_screenshot，新增 agent_send_prompt、agent_get_run、agent_history、agent_cancel。
- [x] 通过现有认证 IPC 接入 AgentSessionService，复用桌面的会话、工具执行、持久化与取消行为。
- [x] 默认 default 会话；支持显式 projectPath/conversationId，发送立即返回 runId，增量查询使用 after/cursor。
- [x] 桌面空闲时轮询当前选中会话，发现该会话的外部运行后加载历史并显示聊天视图；其他会话可在列表查看状态并切换。
- [x] README 提供外部 MCP 配置、轮询方法、并发及重试语义。
- [x] 自定义会话切换 UI 已实现（后续 Runtime 扩展）。
- [ ] 外部 MCP 客户端与 Electron 实际交互验收。

## 11. 当前 Agent Runtime 已实现（截至 2026-10-03）

- [x] 通用 ReAct Loop：AI SDK 单步模型调用、流式输出、工具串行执行、取消、最大步数限制（默认 64 步）。
- [x] ToolRegistry：JSON Schema 参数校验、重复名称检查、独立调用时注入 `additionalTools`。
- [x] 文件工具：`list_files`、`search_files`、`search_text`、`read_file`、`write_file`、`apply_patch`；没有 `edit_file`。
- [x] 文件保护：默认独占创建、覆盖哈希校验、完整分页读取后补丁、多文件预检查、补丁日志、失败回滚与启动恢复；多文件提交不是操作系统级原子事务。
- [x] 终端工具：`exec_command`、`write_stdin`、`read_process_output`、`terminate_process`、`resize_terminal`；管道和真实 PTY、增量日志、超时、Session/Run 归属及结束清理。
- [x] Skills：每次 Run 扫描内置/用户/项目目录，后者覆盖同名 Skill；`list_skills` / `load_skill` 提供索引和分页正文。Skill 不会动态注册工具。
- [x] 外部 MCP：stdio、Streamable HTTP、工具发现与命名空间、参数校验、资源及模板读取、二进制附件落盘；启用 `supportsImages` 后可向模型传递受限数量/大小的图片。
- [x] 上下文：运行中摘要压缩、完整历史归档、字符预算、模型用量事件和 Token 估算。
- [x] 会话：按项目路径和 conversationId 隔离，JSON 快照与追加式 JSONL 事件、同会话单活跃 Run、不同会话可分别运行；启动/管理互斥、快照写入串行化。
- [x] 中断识别：回放完整事件、截断日志残尾、未结束 Run 标记 interrupted、补充未完成工具结果；下一次请求启动新 Run 并附恢复提示，不自动续跑或重放副作用。
- [x] UI：多会话管理、工具活动、流式文本、用量展示、停止、按会话内存草稿、记住所选会话；切换不终止后台 Run。
- [x] 设置：Shell 路径、步数/上下文预算、MCP 配置与连接测试、Skill 列表；Runtime 配置经 safeStorage 加密，env/headers 读取脱敏。
- [x] 分层 SP：Identity、Scope、Runtime context、Execution protocol、Application instructions、Skills、可选 Recovery context；仅保留 `applicationPrompt`，旧 `systemPrompt` 字段已删除。

当前执行为可信本地模式，cwd 不是权限边界；会话与日志明文保存。停止 Agent 会清理所属本地进程，不自动取消已提交的业务或远端任务。

## 12. Agent Runtime 后续计划

以下是能力待办及建议顺序，尚未开始实现；不替代第 1 节产品闭环里程碑。

### 第一阶段：数据模型与运行可靠性

- [ ] 显式 Run/Message 模型：保留完整 Run 历史、统一消息 ID/时间戳/Run 归属，提供按轮查询、消息分页和运行用量汇总。当前 `session.run` 只直接保存最近一次 Run，消息仍是连续数组。
- [ ] 用户交互：`request_user_input`、waiting_input/waiting_approval 状态、回答或审批后继续；运行中追加/排队消息。
- [ ] 执行恢复：检查点、暂停/继续、可恢复工具状态与副作用幂等策略；区分模型请求重试和工具操作重试。
- [ ] 超时与预算：模型请求超时、Run 总时限、累计 Token/费用预算、全局并发上限和任务队列；当前模型请求 `maxRetries: 0`。
- [ ] 错误分类及有界退避：针对可安全重试的网络/429/5xx 请求，未知结果的副作用操作仍需先查状态。

### 第二阶段：权限、存储与诊断

- [ ] SandboxAgentHost、目录/网络访问策略、工具授权及命令审批、进程资源配额；审批 UI 与等待状态协同实现。
- [ ] 存储维护：历史索引/搜索、日志及补丁保留与清理策略、跨进程写入协调、持久化格式迁移。
- [ ] 可观测性：按 Run 汇总耗时、工具结果、Token 和费用，提供故障诊断与敏感信息处理。
- [ ] 会话体验：历史 Run 视图、重新生成、消息编辑与分支、回收站、草稿持久化；事件推送替代轮询。

### 第三阶段：扩展能力

- [ ] 工具中间件及生命周期 Hooks、按会话启用工具、按需发现和只读工具并行执行。
- [ ] Skills 安装/版本及依赖管理、运行中热更新、加载完整性检查；当前完整阅读主要由模型遵循工具说明。
- [ ] MCP OAuth、prompts、sampling、elicitation；按实际服务需求决定是否支持旧版 SSE。
- [ ] 多 Agent：子 Agent、任务委派、独立上下文、并发控制与结果汇总。
- [ ] 上下文与记忆：精确 Token 预算、消息重要性管理、跨会话记忆和检索。
- [ ] 用户附件上传、本地图片读取工具和 Web Search；已有 MCP 图片输入不等于用户附件链路已完成。
- [ ] 模型适配与评测：扩展当前 OpenAI-compatible Chat 调用路径，验证模型能力差异，建立真实任务成功率与回归评测。

各阶段须分别记录代码完成、自动化验证和实机验收；现有测试不能替代真实模型质量、跨平台原生执行及 UI 交互验收。
