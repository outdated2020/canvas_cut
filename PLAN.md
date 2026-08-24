# 开工执行计划（KICKOFF PLAN）

> 状态：Phase 0 主要代码已实现，Agent/MCP 已落地；真实生成/导出待接入密钥后联调
> 更新日期：2026-08-21

## 1. 目标

桌面端生成式视频创作工具：剪映式时间线 + ComfyUI 式节点画布 + Agent 自动编排。

## 2. 已确认技术方案（快照）

| 领域 | 决定 |
| --- | --- |
| 形态 | Electron + TypeScript（MVP），完成后迁移 Qt/C++ |
| 平台 | Windows + macOS |
| 生成能力 | 文生图 / 文生视频 / 图生图 / 图生视频 / 视频编辑与延长 / 多模态参考 |
| 生成模型 | 火山方舟 Seedream 5.0 Pro（图）、Seedance 2.5（视频） |
| 执行模型 | UI / Agent 经 CLI -> 本地 IPC -> Electron 主进程（唯一 jobs.sqlite + Job Worker） |
| 本地存储 | JSON 项目文件（原子写 + `.lock`）+ jobs.sqlite（better-sqlite3，主进程独占） |
| 实例模型 | 单实例 + 多对话（projectPath + conversationId 路由） |
| 画布 | 节点生成链，惰性更新，最多两层嵌套，可存预设；10 类节点 |
| 预览 | WebGL 实时合成 + 本地低清代理；画布按导出分辨率一次生成 |
| 导出 | FFmpeg sidecar |
| 素材上传 | TOS（`@volcengine/tos-sdk`，AK/SK 存 Keychain，putObject + 预签名 + deleteObject） |
| Agent | Mastra + Vercel AI SDK + SKILL.md + CLI manifest 工具 |
| 代码结构 | monorepo：apps/desktop、apps/cli、packages/core、packages/agent、skills |

## 3. 文档索引

- `PRD.md`：产品需求与阶段
- `TECH_DESIGN.md`：技术选型与缺口
- `CORE_ENGINE_DESIGN.md`：核心引擎
- `CANVAS_PROTOCOL.md`：画布协议
- `PROVIDER_ADAPTER_DESIGN.md`：火山方舟适配 + TOS
- `CLI_DESIGN.md`：CLI 命令层 + Electron 通信
- `LOCAL_IPC_PROTOCOL.md`：本地 IPC 协议
- `AGENT_ORCHESTRATION_DESIGN.md`：SKILL.md + Mastra
- `TIMELINE_RENDER_DESIGN.md`：时间线渲染
- `PROJECT_STATE_PROTOCOL.md`：项目状态文件 + jobs.sqlite
- `REPO_STRUCTURE.md`：monorepo 目录
- `REVIEW_ACTIONS.md`：评审决策记录

## 4. Phase 计划

### Phase 0：单画布闭环（开工目标）

- t2i / i2i / i2v / t2v / v2v 生成
- 单画布节点图执行、节点缓存、任务树
- 画布结果进时间线
- FFmpeg 导出成片
- CLI + 本地 IPC + Electron 主进程最小闭环

### Phase 1：多轨道 + 惰性更新 + 预设 + 子画布

### Phase 2：Agent 自动编排（自然语言 / 分镜脚本 -> 节点图 + 时间线）

### Phase 3：产品化（账号 / 计费 / 多 API / 分发），商业模式暂缓

## 5. Phase 0 里程碑（建议开工顺序）

1. **M0 工程骨架**：monorepo + pnpm + TS + Electron + better-sqlite3 electron-rebuild + dev 脚本
2. **M1 状态协议**：project/config/canvas/timeline JSON schema + jobs.sqlite 建表/迁移
3. **M2 Provider 适配层**：VolcengineClient（HTTP）+ Seedream/Seedance 映射 + GenerationJob + TOS 上传
4. **M3 画布引擎**：图校验、拓扑执行、节点缓存、父子任务树
5. **M4 CLI**：project/generate/canvas/job/timeline 命令 + CLI manifest
6. **M5 本地 IPC + 主进程**：单实例、IPC server、Job Worker、progress 推送
7. **M6 UI 最小闭环**：项目页 + 画布 + 时间线 + 预览
8. **M7 导出**：FFmpeg 单轨成片 + 端到端跑通

## 5.1 当前实现进度（2026-08-21）

| 里程碑 | 状态 | 说明 |
| --- | --- | --- |
| M0 工程骨架 | 已完成 | npm workspaces、TypeScript、Electron v33、Vite、启动脚本；better-sqlite3 已装 |
| M1 状态协议 | 已完成 | project/config/canvas/timeline JSON、`.lock`、原子写；SqliteJobStore（WAL/busy_timeout/索引）+ JSON 兜底 |
| M2 Provider 适配层 | 部分完成 | VolcengineProvider 五类生成齐全、FileAssetDownloader、TosUploader（putObject+预签名，tos-sdk 已装）；待真实 API 联调 |
| M3 画布引擎 | 已完成 | 图校验、拓扑执行、graphHash、节点缓存、父子任务 |
| M4 CLI | 已完成 | project/generate/canvas/job/timeline/preset + manifest + `mcp` 子命令 |
| M5 本地 IPC + 主进程 | 已完成 | 单实例、named pipe IPC、DaemonService（多项目上下文/去重/reconcile）、Job Worker（并发限制 3 + 轮询） |
| M6 UI 最小闭环 | 已完成 | v2 布局：标题栏 / 左 AI 面板 / 中心资产-画布 / 查看器 / 时间线；Agent 对话 + 运行时设置已接入 |
| M7 导出 | 代码完成 | FFmpeg 命令构建与执行、canvas clip 解析、资产校验；本机缺 ffmpeg，未跑真实导出 |
| Agent 编排 | 已落地（基础） | Vercel AI SDK 多轮对话 + create/render/add-to-timeline 工具、SKILL.md 解析、30+ CLI 工具；SKILL 驱动编排待打磨 |
| MCP / UI 可观测 | 已完成 | CLI `mcp` stdio server + `ui_screenshot`、主窗口截图（启动自动 + 按需），供外部 Agent 观察 UI |

### 已完成能力

- monorepo：`apps/desktop`、`apps/cli`、`packages/core`、`packages/agent`、`skills`
- 可交互画布：拖拽、添加/删除节点、端口连线、双击编辑参数、节点状态颜色
- 可视化时间线：轨道、片段块、拖拽移动片段、播放头/缩放/吸附等工具条
- UI v2 布局：左 AI 面板（模板/对话）、中心资产/画布切换、右侧 Viewer、底部时间线
- Agent 闭环：自然语言 -> 创建画布 -> 渲染 -> 加入时间线（`agent.chat` IPC + UI 对话框）
- MCP / UI 截图：CLI `mcp` server 暴露 `ui_screenshot`，主进程启动自动截图 + 按需截图
- DaemonService：多项目上下文隔离、canvas render 去重、重启 reconcile、并发限制
- 运行时设置持久化：`runtime-settings.json`（ARK key、TOS 凭证、bucket/region/endpoint、ffmpeg 路径、Agent baseUrl/key/model）
- better-sqlite3 已安装，SqliteJobStore 完整实现
- CLI 本地命令与本地 IPC 已可用
- 测试：`npm test`，当前 17 个用例全部通过

### 仍待完成

- 真实 Seedream/Seedance 联调：需 `ARK_API_KEY`
- TOS 上传真实联调：需 bucket/AK/SK（`@volcengine/tos-sdk` v2.9.1 已声明并安装）
- `better-sqlite3` 的 `electron-rebuild`（native 模块在 Electron 主进程加载）
- 真实 FFmpeg 导出：需本机 `ffmpeg`（`FFMPEG_PATH` 已可配）
- idempotencyKey 真正去重（目前仅内存级 activeCanvasRenders 去重）
- SKILL.md 驱动的 Agent 动态编排（目前硬编码 3 工具，未按 skill 编排）
- 预览播放器、WebGL 预览、素材选择 UI
- Electron 打包、CLI 独立可执行文件打包
- 更多集成测试与真实 Provider mock 联调

## 6. 开工前仍需补 / 确认

### 阻塞项（写代码前需定）

- Seedream 图片接口是同步返回还是异步任务，及精确响应 / 错误结构
- Seedance `resolution / ratio / duration` 精确映射，图片/视频/音频输入格式要求

### 环境项（由用户提供）

- 开发用火山方舟 API Key
- TOS bucket / region / endpoint / AK/SK
- Agent LLM 的 OpenAI 兼容 Base URL + Key

### 依赖项（已就位）

- `electron` v33.2.1：位于 `apps/desktop/node_modules`（workspace 嵌套，非根目录）
- `@volcengine/tos-sdk` v2.9.1：已声明为 desktop 依赖并安装
- `better-sqlite3`：已安装，待 `electron-rebuild` 后方可在 Electron 主进程加载

### 待定项（可后置，但建议尽早定）

- npm 包名与 scope、CLI 可执行文件名
- 火山限流数值、错误码枚举（用于重试策略）

## 7. Phase 0 完成标准（DoD）

用户能完成：输入文本生成图片 -> 图片/文本生成视频 -> 单画布节点图执行 -> 结果进入时间线 -> 导出 mp4 成片。