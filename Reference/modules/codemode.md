# Code Mode 工具编排

## 作用

提供通用工具发现和受限 JavaScript 编排，唯一负责目录/Schema 校验、QuickJS 执行及资源预算，不定义 Canvas Cut 业务。

## 对应源码

[index.ts](../../packages/codemode/src/index.ts)、[catalog.ts](../../packages/codemode/src/catalog.ts)、[executor.ts](../../packages/codemode/src/executor.ts)、[worker.ts](../../packages/codemode/src/worker.ts)、[config.ts](../../packages/codemode/src/config.ts)。

## 负责事项

- Catalog 注册 ToolDefinition、生成调用别名、JSON Schema 校验、分页搜索和 TypeScript 调用提示。
- CodeModeService 提供 search_tools/execute，管理同时执行数量与 MCP text/isError 包装。
- executor 创建独立 Node Worker、桥接工具 Promise、统计调用/消息预算和超时取消；worker 在 QuickJS/WASM 中执行普通 JavaScript 异步函数体。

## 不负责事项

不实现业务工具、不替代 IPC、Provider 或 Agent 模型循环；不直接读写项目数据。工具目录的 TypeScript 提示不可当作执行源码。

## 接口与依赖

ToolDefinition 包含 name/description/inputSchema/outputSchema?/execute，Catalog 描述以源码为准。CodeModeService(tools,limits?) 的 call(name,args,signal) 返回 MCP 包装；成功 text 内为 JSON，失败 isError:true。

search_tools({query?,offset?,limit?}) 按空格分词全部匹配，空查询列工具；limit 1–20、默认 10，返回 nextOffset、输入/输出 Schema 和调用提示。execute({code}) 的 code 是普通 JS async function body，支持 await/return/Promise.all/try-catch，不加函数包装或 TypeScript 注解。

每次新 Worker/QuickJS，脚本只看到冻结的 tools、console 等受控对象；没有 process/require/fetch/文件系统/模块导入/定时器。宿主根据别名调用注册工具，返回真实结果，内部错误可被脚本捕获。顶层 execute 结果 {result,logs,calls} 序列化在 content[0].text；业务工具 structuredContent 由注册适配器定义，归[CLI MCP](cli-mcp.md)。ID/变量不会跨执行保留。

| 默认限制 | 值 |
| --- | --- |
| 执行时间 | 30000ms |
| guest heap | 32 MiB |
| 工具调用 | 32 次 |
| 源码 | 64 KiB（executor 字节限制，外部 Schema 另有字符限制） |
| 输出（含日志） | 1 MiB |
| 同时执行 | 4 |
| 日志 | 64 KiB，另受总输出预算限制 |
| 工具返回桥累计 | 4 MiB |

## 数据和副作用

目录/执行状态在进程内，创建 Worker、与宿主传递消息。脚本本身无 Node 权限，但每个注册工具可产生实际副作用；超时、失败、取消只中止编排/等待，不回滚已保存编辑或自动取消业务 job。调用 Agent 工具可间接启动可信本地运行，不能称整个调用链沙箱化。

## 验证入口

[codemode.test.mjs](../../packages/codemode/test/codemode.test.mjs)覆盖发现、隔离、并行/串联、校验、CPU/Promise 超时、预算和取消；[canvas-codemode.test.mjs](../../tests/canvas-codemode.test.mjs)覆盖真实业务桥。本轮未运行。

## 已知边界偏差

目前通用编排无持久恢复；具体工具的副作用约束需要调用方遵守。当前注册的原生画布工具没有时间线 trim/export 能力，不能由 JS 编排接口推断全部 CLI 命令都已暴露。
