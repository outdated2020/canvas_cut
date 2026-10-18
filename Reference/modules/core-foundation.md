# core 公共契约与基础设施

## 作用

提供共享类型载体、统一错误与通用 hash/日志能力，以及命令发现清单和包入口。领域类型虽然集中存放，行为语义归各领域模块，不由本模块重复定义。

## 对应源码

[types.ts](../../packages/core/src/types.ts)、[errors.ts](../../packages/core/src/errors.ts)、[hash.ts](../../packages/core/src/hash.ts)、[logger.ts](../../packages/core/src/logger.ts)、[cli-manifest.ts](../../packages/core/src/cli-manifest.ts)、[index.ts](../../packages/core/src/index.ts)。

## 负责事项

- 维护跨包共享的 TypeScript 类型、兼容的导出表面、CliCommandManifest 数据结构。
- canonicalJson/stableJson/sha256 基元；不决定哪些图字段或节点输入纳入 hash。
- CanvasCutError、toStructuredError 与统一错误结构；进程内 Logger 缓冲、监听和可选文件输出。
- CLI_MANIFEST 的命令/参数发现元数据；它不是执行路由，也不是模型工具自动注册器。

## 不负责事项

不执行图、剪辑、任务、Provider 或持久化；不重复解释每种领域类型的状态语义。不将 Node 主入口自动视为浏览器安全入口。

## 接口与依赖

共享结构按所属文档解释：[ProjectFile/AssetRef](core-storage.md)、[CanvasGraph/CanvasPreset](core-canvas.md)、[TimelineFile/RenderPlan](core-timeline.md)、[GenerationProvider/GenerationJob](core-provider.md)、[JobRecord](desktop-jobs.md)。types.ts 是源码接口事实来源，文档以链接引用，避免第二套 Schema。

CanvasGraph.name 为可选展示字段，旧文件无须迁移；名称校验及不影响 hash/缓存的规则归[画布](core-canvas.md)。CLI_MANIFEST 包含 canvas.rename（位置参数 canvasId 与 --name），实际路由和在线/离线适配归[CLI](cli.md)。

五类云端生成请求的 model?:string 属于 Provider 请求契约，CanvasRenderPlan.modelDefaults 属于画布执行计划；模型优先级和缓存语义分别见上述所属模块，公共类型不自行解释模型能力。

包入口另导出 listGenerationModels、GenerationModelOption 及目录来源/核对日期；目录维护与筛选语义唯一归 [Provider](core-provider.md)。renderer 只使用不含 Node I/O 的 model-catalog 深层入口，构建适配见[工程](engineering.md)。

StructuredError 为 {code,message,retryable}；CanvasCutError 可附 details/cause，toJSON 对外只输出上述三项。错误包括 PROJECT_NOT_FOUND/EXISTS、CANVAS_NOT_FOUND、NODE_NOT_FOUND、EDGE_INVALID、INVALID_PARAMS、ASSET_NOT_FOUND、JOB_NOT_FOUND/CANCELLED、DAEMON_UNAVAILABLE、GENERATION_TIMEOUT、PROVIDER_ERROR、RENDER_FAILED、LOCK_TIMEOUT 与 IPC_*；未归类错误归 INTERNAL_ERROR。额外预设/轨道/片段错误可由实际业务产生，CLI 退出码归[CLI](cli.md)。

## 数据和副作用

类型/manifest/hash 不保存项目数据；Logger 可写 logFile、输出 console/stderr 并维护进程内缓冲。MCP/CLI 启动必须避免将普通日志写到协议 stdout。

## 验证入口

[core.test.mjs](../../tests/core.test.mjs)验证 canonical hash 行为，[cli.test.mjs](../../tests/cli.test.mjs)验证 manifest/输出；跨包接口以 TypeScript 构建检查。本轮没有执行测试。

## 已知边界偏差

types.ts 聚合多个领域类型但未拆分导出；浏览器白模使用深层入口，见 [H-05](../issues.md#h-05)。manifest 与 CLI 实际路由需要共同核对，不能只改发现描述。框架无关不等于无 Node I/O，core 包包含文件系统和媒体进程模块。
