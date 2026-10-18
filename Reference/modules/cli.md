# CLI 与本地 IPC 客户端

## 作用

将命令行输入转换为领域/桌面服务调用，输出稳定机器可读结果，供用户、Skills 和 Agent Shell 使用。

## 对应源码

[CLI src](../../apps/cli/src)除 mcp 目录外：index.ts 路由，args.ts 参数解析，output.ts 输出/退出码，context.ts 项目定位/锁，commands 目录适配命令，ipc/client.ts 实现 LocalIpcClient。命令发现清单源码归[公共契约](core-foundation.md)，MCP 服务归[对外 MCP](cli-mcp.md)。

## 负责事项

- project/generate/job/canvas/timeline/asset/preset 命令路由，--help/manifest 发现，参数文件读取和类型转换。
- 使用 --project/-p 或 cwd 向上查找 project.json；短命令调用 core，长任务和 job 查询通过 IPC。
- LocalIpcClient 查实例、核对版本/PID、连接端点、带 token/requestId 请求，匹配响应、管理传输超时/取消。
- JSON result 和退出码、stderr 诊断；不污染 stdio MCP 的 stdout。

## 不负责事项

不定义节点/剪辑业务规则，不拥有 SQLite、Provider 或任务 worker。不能在长任务缺少桌面服务时悄悄切换为另一种执行后端。CLI 参数 Schema 描述调用形式，不保证供应商支持相同尺寸/时长。

## 接口与依赖

入口为 node apps/cli/dist/index.js；--json、--project、--dry-run、--help 等全局选项按 args/index 实现。--params-file 与 --params 用于节点 JSON 参数；具体优先级和命令参数见 [args.ts](../../apps/cli/src/args.ts)及 [manifest](../../packages/core/src/cli-manifest.ts)。dry-run 仅支持 generate.*、canvas.render、timeline.export，其他命令明确拒绝，不是假定所有写命令都有 dry-run。

生成节点可通过 params.model 设置单节点模型 ID/接入点；空字符串或 null 恢复项目默认。canvas.render 的 dry-run 会读取项目默认模型并注入 core 计划，优先级和缓存语义见[画布](core-canvas.md)，CLI 不定义模型能力。

| 命令族 | 当前适配能力 |
| --- | --- |
| project / asset | 项目初始化/打开/状态；素材列表/导入 |
| canvas | 创建/读取/重命名/删除/列表/状态；节点增删/参数合并、连线增删、渲染 |
| generate | 文生图/视频、图生图/视频、视频编辑/延长 |
| timeline | 初始化/读取/刷新画布引用；轨道/素材/画布/音频/字幕添加，分割/裁剪/移动，变换/透明度/速度/音量/转场、删除和导出 |
| preset / job | 预设保存/列表/应用；任务 status/wait/cancel/list（clear 当前仅由桌面/本地 IPC 提供，传统 CLI 未注册） |

--json 输出 {ok,data,error,requestId}；error 结构引用[基础契约](core-foundation.md)。退出码：0 成功，2 参数/图/锁错误，3 对象不存在，4 DAEMON_UNAVAILABLE，5 等待/IPC 超时，6 JOB_CANCELLED，其他错误为 1。

canvas create --name 保存可选名称；canvas get/list 返回已保存名称。`canvas rename <canvasId> --name "新名称"` 先用只读 ping 探测桌面：在线经 IPC 调用共享 canvas.rename 并发布 UI 通知，桌面不可用时直接调用 CanvasOperations 的锁内事务；发出重命名请求后出现的超时/断线不回退重放。名称规则唯一见[画布](core-canvas.md)，不在 CLI 复制。该离线编辑路径只用于短事务，不是生成任务的后端回退。

LocalIpcClient.request(method,payload,timeoutMs=30000,signal?) 使用[本地协议](desktop-bridge.md)，默认每个请求生成幂等键，显式 --idempotency-key 用于同一次不确定提交重试。job wait 的传输期限需长于业务等待期限。实例目录为 APPDATA/canvas-cut，未提供 APPDATA 时回退 ~/.canvas-cut；服务不可用返回 DAEMON_UNAVAILABLE。非 Windows 桌面 userData 与客户端默认目录是否一致须实机核对。

## 数据和副作用

短命令在锁内读写项目文件，使用 core 规则；生成/导出返回 jobId，由[任务](desktop-jobs.md)实际执行。IPC 信号取消只关闭等待，已投递操作可能完成；超时后先查 job/状态。客户端不自动重放副作用。

## 验证入口

[cli.test.mjs](../../tests/cli.test.mjs)覆盖项目、画布、dry-run、manifest、参数文件及等待；[agent-e2e.test.mjs](../../tests/agent-e2e.test.mjs)验证实际 Shell/CLI/IPC。本轮未运行。

## 已知边界偏差

传统画布命令绕过 CanvasOperations 的完整参数校验和通知，见 [H-02](../issues.md#h-02)；时间线/预设事务与桌面重复，见 [H-03](../issues.md#h-03)。目标是保留 CLI 适配层并调用统一领域入口。当前由 tsc 构建为 Node 程序，没有 esbuild 单文件或 pkg/SEA 独立可执行分发。
