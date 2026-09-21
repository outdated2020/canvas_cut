# Canvas Cut 执行计划

> 更新日期：2026-09-06
> 当前状态：原型骨架及基础交互已实现；本轮已修复一批预览、导出、任务与 Agent 闭环问题。Phase 0 尚未完成真实端到端验收。
> 进度口径：代码实现、自动化测试通过、真实服务联调、产品验收分别记录，不能互相替代。

## 1. 目标与下一个里程碑

桌面端生成式视频创作工具：时间线剪辑 + 节点画布 + Agent 编排。

**下一个里程碑：单画布生成、剪辑、预览、导出结果一致。**

验收路径：输入文本生成图片 → 图生视频 → 单画布执行 → 结果进入时间线 → 裁剪/变速/添加音轨 → 导出 MP4 → 回放核对画面、声音、时长。

## 2. 仓库结构与实际架构

| 目录 | 职责 |
| --- | --- |
| apps/desktop/src/main | Electron 主进程、IPC、Daemon、Job Worker、SQLite、TOS、运行时设置 |
| apps/desktop/src/preload | 渲染进程可调用命令白名单 |
| apps/desktop/src/renderer | React UI、节点画布、时间线、素材预览、多轨基础预览 |
| apps/cli | 命令行、到主进程的 IPC 客户端、MCP stdio 服务 |
| packages/core | 类型、项目存储、画布图与执行、缓存、Provider、时间线、FFmpeg |
| packages/agent | AI SDK 通用工具循环、LocalAgentHost、Skill 注册、会话持久化 |
| skills | image-to-video、storyboard-to-video 流程文档 |
| tests | core、CLI、Agent、任务与预览/导出回归测试 |
| scripts | 启动、联调及历史修补脚本 |

实际调用链：UI → Electron IPC → 主进程；CLI 的生成/渲染任务 → 本地 IPC → 主进程；CLI 部分编辑命令直接调用 core；Agent → 基础工具 → Shell → canvas-cut CLI → core / 本地 IPC → Daemon / Worker。画布功能不再注册为模型专用工具。

技术现状：npm workspaces + TypeScript；Electron + React + Vite + React Flow；better-sqlite3（JSON 兜底）；火山方舟 Provider；TOS；FFmpeg sidecar；Vercel AI SDK。保留 AI SDK，已移除未使用的 Mastra 直接依赖。

## 3. 阶段状态

| 阶段 | 状态 | 完成边界 |
| --- | --- | --- |
| Phase 0：单画布闭环 | 实现中、待真实验收 | 基础生成、画布、时间线、导出均有代码；不能按“接口存在”宣布完成 |
| Phase 1：多轨、惰性更新、预设、子画布 | 部分实现 | 多轨基础预览、过期检测与手动更新、预设命令、两层嵌套执行已有；高保真合成与完整预设复用待补 |
| Phase 2：Agent 自动编排 | 基础实现 | 通用工具、Skills + CLI、历史持久化与中断恢复已实现；真实模型多镜头创作验收待完成 |
| Phase 3：产品化 | 未开始 | 分发、自动更新、多 Provider；账号/计费仍后置 |

| 里程碑 | 状态 | 说明 |
| --- | --- | --- |
| M0 工程骨架 | 已实现 | workspaces、TS、Electron、启动与构建；独立安装包未完成 |
| M1 状态协议 | 基础实现 | JSON、原子写、锁、SQLite；版本迁移、跨文件事务与恢复仍需加强 |
| M2 Provider | 部分联调 | 历史记录：2026-08-30 文生图真实成功；本轮未调用付费生成 API |
| M3 画布引擎 | 基础实现 | DAG、拓扑执行、缓存、父子任务；本轮修正子任务调度与缓存查询、限制两层嵌套 |
| M4 CLI/MCP | 基础实现 | 命令和 manifest 已有；与 UI 的功能对齐仍需持续检查 |
| M5 主进程任务 | 部分完善 | 幂等提交、独立远端生成恢复、视频任务取消与 FFmpeg 中止已接线；画布中途恢复待补 |
| M6 UI | 基础交互与预览已实现 | 素材选择、播放器、时间线、多轨 HTML 媒体预览；尚未做 UI 端到端和高保真一致性验收 |
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
- [ ] 会话切换 UI、token 级流式输出和更精确的模型上下文预算。当前 UI 使用默认会话与步骤级事件。
- [ ] WebGL 与代理视频、缩略图/真实音频波形、媒体元数据索引、缓存清理。
- [ ] 预设/附件/历史等占位入口按实际功能实现或隐藏；语音输入后置。
- [x] 继续使用 AI SDK；移除 Mastra 直接依赖，同步 Agent 设计文档。
- [ ] Web Search：后续增加检索工具、来源引用和可配置搜索服务。
- [ ] SandboxAgentHost：补充目录挂载与权限、网络控制、进程资源配额和凭证代理；保留当前 Host 接口。当前 local-trusted 无目录隔离和逐条命令审批。

### P3：分发与工程治理

- [ ] Electron 安装包、CLI 独立分发、FFmpeg/ffprobe 随包部署；Windows/macOS smoke test。
- [ ] 应用签名、更新机制、故障诊断包；账号/计费/多 Provider 后置。
- [ ] CI 持续运行构建、单元、IPC/Worker、UI 与真实媒体集成测试。
- [ ] 归档截图、历史 patch/fix 脚本及评审产物；demo-project/agent-smoke 包含现有用户文件，本轮不删除。
- [ ] 同步 PRD/TECH_DESIGN 等旧文档的阶段状态、Agent 方案及实现边界。

## 6. 验证记录

2026-09-06 本轮：

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

- PRD.md：产品范围与验收场景
- TECH_DESIGN.md / CORE_ENGINE_DESIGN.md：技术与核心引擎
- CANVAS_PROTOCOL.md / PROJECT_STATE_PROTOCOL.md：图与状态协议
- PROVIDER_ADAPTER_DESIGN.md：Provider/TOS
- CLI_DESIGN.md / LOCAL_IPC_PROTOCOL.md：命令与进程通信
- AGENT_ORCHESTRATION_DESIGN.md：Agent/Skill 设计
- TIMELINE_RENDER_DESIGN.md：预览与导出
- REPO_STRUCTURE.md / UI_LAYOUT_DESIGN.md：目录与 UI
- REVIEW_ACTIONS.md：历史评审决策

## 9. 通用 Agent 实施记录（2026-09-08）

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
- [x] 桌面空闲时自动发现外部运行并加载历史，同一项目自动显示聊天视图。
- [x] README 提供外部 MCP 配置、轮询方法、并发及重试语义。
- [ ] 外部 MCP 客户端与 Electron 实际交互验收；自定义会话切换 UI 后续实现。
