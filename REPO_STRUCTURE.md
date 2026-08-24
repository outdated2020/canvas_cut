# 项目目录结构设计（REPO STRUCTURE）

> 状态：设计阶段，尚未实现
> 更新日期：2026-08-15

## 1. 总体原则

- 使用 monorepo，共享 TypeScript 核心代码
- 核心引擎保持框架无关，不依赖 Electron / React / Mastra
- CLI 和 Electron 应用复用核心引擎
- 技能文件独立存放，便于扩展和分发

## 2. 目录结构

```text
canvas-cut/
├── package.json
├── package-lock.json
├── tsconfig.base.json
├── apps/
│   ├── desktop/                  # Electron 桌面应用
│   │   ├── src/
│   │   │   ├── main/             # Electron 主进程
│   │   │   ├── preload/          # contextBridge 桥接
│   │   │   └── renderer/         # React UI
│   │   ├── package.json
│   │   └── vite.config.ts
│   └── cli/                      # CLI 独立可执行程序
│       ├── src/
│       │   ├── index.ts
│       │   └── commands/         # 命令实现
│       ├── package.json
│       └── build.ts
├── packages/
│   ├── core/                     # 框架无关核心引擎
│   │   ├── src/
│   │   │   ├── canvas/           # 画布节点引擎
│   │   │   ├── timeline/         # 时间线引擎
│   │   │   ├── provider/         # Provider 适配层
│   │   │   ├── job/              # 任务管理与并发
│   │   │   ├── render/           # 渲染计划
│   │   │   └── storage/          # SQLite 与文件存储
│   │   └── package.json
│   └── agent/                    # Mastra Agent 编排
│       ├── src/
│       │   ├── agents/           # Agent 定义
│       │   ├── workflows/        # 工作流
│       │   ├── tools/            # CLI 工具注册
│       │   └── skills/           # 技能加载与匹配
│       └── package.json
├── skills/                       # 内置 SKILL.md 技能
│   ├── storyboard-to-video/
│   │   └── SKILL.md
│   └── image-to-video/
│       └── SKILL.md
├── scripts/                      # 构建、打包脚本
├── resources/
│   ├── ffmpeg/
│   │   ├── win32/
│   │   └── darwin/
│   └── icons/
└── docs/                         # 设计文档
```

## 3. 各模块职责

### apps/desktop

- Electron 主进程：调用 CLI、管理文件/SQLite、轮询任务
- preload：暴露类型化 API
- renderer：React 节点图、时间线、预览 UI

### apps/cli

- 依赖 `@canvas-cut/core`
- 打包成独立可执行文件
- 实现 project / generate / canvas / timeline / preset / job 命令

### packages/core

- 无 UI、无 Electron、无 Mastra 依赖
- 画布、时间线、Provider、任务、渲染、存储

### packages/agent

- 依赖 `@canvas-cut/core`
- 使用 Mastra 实现 Agent、Workflow、Tools
- 加载 SKILL.md，调用 CLI 工具

### skills

- 内置技能文件
- 随应用打包，也可由用户自定义

## 4. 包依赖方向

```text
apps/desktop -> packages/core, packages/agent
apps/cli     -> packages/core
packages/agent -> packages/core
```

依赖方向单向，避免循环依赖。

## 5. 包管理器

- MVP 使用 npm workspaces
- 后续如需要可迁移到 pnpm workspaces

## 6. 待确认

- 包名与作用域前缀
- 是否将 skills 也作为独立 package
