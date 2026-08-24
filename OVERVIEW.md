# 技术方案总览（OVERVIEW）

> 状态：Phase 0 主要代码已实现，真实生成/导出待接入密钥后联调
> 更新日期：2026-08-19

## 1. 项目一句话

一款面向普通用户的桌面端生成式视频创作工具，支持节点式画布生成、多轨道时间线剪辑和 Agent 自动编排。

## 2. 文档索引

- PLAN.md：开工执行计划与里程碑
- PRD.md：产品需求
- TECH_DESIGN.md：技术选型与缺口状态
- CORE_ENGINE_DESIGN.md：画布、时间线、Provider 核心引擎
- CANVAS_PROTOCOL.md：画布节点图文件、端口校验与 preset schema
- PROVIDER_ADAPTER_DESIGN.md：火山引擎 Seedream / Seedance 对接
- CLI_DESIGN.md：CLI 命令层与 Electron 通信
- AGENT_ORCHESTRATION_DESIGN.md：SKILL.md 与 Mastra Agent
- TIMELINE_RENDER_DESIGN.md：多轨渲染计划
- PROJECT_STATE_PROTOCOL.md：项目状态文件协议
- LOCAL_IPC_PROTOCOL.md：本地 IPC 协议（CLI / Agent / 主进程）
- REPO_STRUCTURE.md：monorepo 目录结构
- FLOWS.md：核心流程图与时序图
- REVIEW_ACTIONS.md：设计评审问题与修订记录

## 3. 关键决策汇总

| 领域 | 决策 |
| --- | --- |
| 产品形态 | 桌面应用，Windows + macOS |
| 核心定位 | 剪映式时间线 + ComfyUI 式画布 + Agent 编排 |
| 生成能力 | 文生图 / 文生视频 / 图生图 / 图生视频 / 视频编辑与延长 |
| 生成模型 | 火山引擎 Seedream（图）、Seedance（视频） |
| 桌面壳 | Electron（验证阶段） |
| UI | React + TypeScript + Vite + React Flow |
| 核心引擎 | 框架无关 TypeScript |
| Agent | Mastra，OpenAI 兼容 Base URL + API Key |
| 能力暴露 | 独立可执行 CLI（生成/渲染需桌面端运行，headless serve 待 Phase 2+） |
| 技能 | SKILL.md，LLM 直接选择 + skills 工具 |
| 导出 | FFmpeg sidecar |
| 预览 | WebGL 实时合成 + 本地低清代理（画布按导出分辨率一次生成） |
| 存储 | JSON + 文件锁/原子写，jobs 用 SQLite（better-sqlite3，主进程独占） |
| API Key | 用户提供，本地 Keychain |
| 稳定阶段 | 媒体核心迁移 C++，硬件加速编解码 |
| 稳定阶段桌面壳 | MVP 完成后切换 Qt 等原生方案 |

## 4. 已确定的核心机制

- 画布只做生成链，惰性更新，最多两层嵌套，可保存预设
- 画布片段 = 对画布输出节点的引用
- 生成任务返回 jobId，父子任务树聚合
- 节点级缓存，并发上限默认 3 可配置
- CLI 命令统一 `--json`、`--dry-run`、稳定错误码
- Agent 复杂任务确认，简单任务直接执行

## 5. 仍待补充

### P1

- Seedance 高级能力已纳入 MVP（多模态参考、视频编辑、延长）
- 预览与导出一致性：已决策为「一次生成 + 本地代理」；特效 / 贴纸双后端一致性待设计
- 转场类型范围
- 音频混音细节
- 字幕样式与软字幕
- 自动保存与版本迁移

### P2

- 包名与 CLI 可执行文件名
- 测试策略
- 双平台打包、签名、公证、自动更新
- Prompt 注入与内容安全

### 暂缓

- 商业模式
