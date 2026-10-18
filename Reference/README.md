# Reference：模块职责索引

核对日期：2026-10-11；依据是当前工作区源码（包含未提交改动）。本目录是当前详细架构说明来源；概览见 [AGENTS](../AGENTS.md)，使用见 [README](../README.md)，里程碑与历史验收见 [PLAN](../PLAN.md)。本轮仅改文档，没有重跑业务测试或真实服务验收。

## 阅读顺序与归属规则

先查下表确定修改归属，再读模块的八个固定栏目。一个职责只能有一个所有者；调用方负责参数适配和展示，不能重新定义被调用模块的规则。目标边界与当前实现不同的地方必须链接到 [问题记录](issues.md)，不能用文档约定代替代码整改。

| 模块 | 唯一负责的能力 | 主要源码归属 |
| --- | --- | --- |
| [桌面启动与设置](modules/desktop-shell.md) | 应用生命周期、窗口、配置与凭证保存、服务装配 | apps/desktop/src/main/main.ts |
| [桌面任务](modules/desktop-jobs.md) | 业务 job 调度/持久化/执行、上传、本地白模输出 | main 下 daemon.ts、job-store.ts、job-worker.ts、uploader.ts、white-model-renderer.ts |
| [桌面桥接](modules/desktop-bridge.md) | 本地 IPC 服务、preload、画布变更传输、截图接口 | main/ipc-server.ts、main/ui-capture.ts、src/preload 全部 |
| [桌面 UI](modules/desktop-ui.md) | React 交互、图展示、时间线预览、会话/任务展示、three.js 场景 | apps/desktop/src/renderer 全部、三个 HTML 页面 |
| [Agent 宿主](modules/desktop-agent-host.md) | Canvas Cut 应用提示、CLI launcher、项目/技能/模型注入 | main/agent-service.ts |
| [CLI](modules/cli.md) | 命令解析、结果/退出码、业务入口适配、本地 IPC 客户端 | apps/cli/src 除 mcp 目录以外 |
| [对外 MCP 服务](modules/cli-mcp.md) | stdio JSON-RPC、外部工具注册、Code Mode 业务桥 | apps/cli/src/mcp 全部 |
| [core 公共契约](modules/core-foundation.md) | 共享类型载体、错误、hash 基元、日志、命令发现清单与包导出 | core/src 下 types.ts、errors.ts、hash.ts、logger.ts、cli-manifest.ts、index.ts |
| [项目存储](modules/core-storage.md) | 项目目录、JSON/资产/预设读写、文件锁与原子写 | core/src/project、core/src/fs |
| [画布](modules/core-canvas.md) | 图/端口规则、编辑事务、请求语义、执行计划与节点缓存键算法 | core/src/canvas 全部 |
| [节点缓存存储](modules/core-cache.md) | 缓存索引读写和资产存在性检查 | core/src/cache |
| [时间线](modules/core-timeline.md) | 片段/轨道编辑、画布引用解析、渲染计划 | core/src/timeline |
| [Provider](modules/core-provider.md) | 外部生成请求/状态转换、供应商工厂和传输接口 | core/src/provider |
| [媒体执行](modules/core-media.md) | FFmpeg 参数构建、子进程与 ffprobe 探测 | core/src/ffmpeg |
| [Agent Runtime](modules/agent-runtime.md) | 模型循环、上下文预算、会话与事件恢复、运行配置契约 | agent/src 下 runtime.ts、sessions.ts、context-usage.ts、config.ts、index.ts |
| [Agent 工具执行](modules/agent-tools.md) | 工具注册、文件/补丁和 Shell/PTY 执行 | agent/src 下 tools.ts、files.ts、host.ts、pty.ts |
| [Agent Skills/MCP 客户端](modules/agent-integrations.md) | Skill 发现/加载、外部 MCP 工具/资源/附件接入 | agent/src 下 skills.ts、mcp.ts |
| [Code Mode](modules/codemode.md) | 工具目录与 Schema 校验、受限 JS 编排、资源限制 | packages/codemode/src 全部 |
| [工程支持](modules/engineering.md) | workspaces/TS/Vite 构建配置、启动脚本、测试组织和内置 Skill 内容 | 各 manifest/tsconfig、desktop/vite.config.ts、scripts、tests、codemode/test、skills |

main.ts 中尚存的业务编辑处理、ProjectStore 中尚存的跨域业务，是已记录的边界偏差；物理源码归属表不赋予它们重复定义业务规则的权利。类型文件存放多个领域结构，各结构的行为语义仍归对应领域模块。

## 协作接口

- 画布 graph/hash/节点参数由[画布](modules/core-canvas.md)定义，缓存索引由[缓存存储](modules/core-cache.md)保存；两者不共同定义缓存键。
- 时间线[渲染计划](modules/core-timeline.md)描述输出，实际命令转换归[媒体执行](modules/core-media.md)，排队与任务状态归[桌面任务](modules/desktop-jobs.md)。
- 白模参数契约归画布，场景插值与绘制归 UI，隐藏窗口/帧落盘/输出清理归任务；通道传输归桥接。
- 对外 [CLI MCP 服务](modules/cli-mcp.md)和 Agent 的[外部 MCP 客户端](modules/agent-integrations.md)是相反方向的接口。
- 项目文件、任务数据库、Agent 会话和运行时凭证分别归项目存储、桌面任务、Runtime、桌面设置，不能统称一个存储模块。

## 其他文档

- [产品说明](product.md)：受众、创作流程、验收场景与范围。
- [问题记录](issues.md)：现有不合理边界、影响、建议与验证状态。
- [必要历史决策](decisions.md)：保留有效设计背景和未实现方向。
- [旧文档迁移](migration.md)：合并重写的来源与新位置。

## 维护约定

模块说明固定为作用、对应源码、负责事项、不负责事项、接口与依赖、数据和副作用、验证入口、已知边界偏差。职责、接口或数据归属改变时同步更新所属模块和本表。未实现的接口不能写在现行接口列表；历史验证必须注明日期，不能当作本轮结果。
