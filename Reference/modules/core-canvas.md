# 画布领域、编辑与执行计划

## 作用

唯一定义图结构、节点/端口规则、参数和输入语义、版本/hash、编辑事务与拓扑执行。图只组织生成链，不承担时间线合成。

## 对应源码

[graph.ts](../../packages/core/src/canvas/graph.ts)、[registry.ts](../../packages/core/src/canvas/registry.ts)、[api.ts](../../packages/core/src/canvas/api.ts)、[operations.ts](../../packages/core/src/canvas/operations.ts)、[engine.ts](../../packages/core/src/canvas/engine.ts)、[white-model.ts](../../packages/core/src/canvas/white-model.ts)。共享类型载体见 [types.ts](../../packages/core/src/types.ts)。

## 负责事项

- registry 定义 NodeType、端口、生成类别；graph 实现节点/连线变更、版本/hash 更新、验证和拓扑排序。
- api 定义 CANVAS_API 业务方法、输入/输出 JSON Schema、nodeTypeCatalog 与节点参数描述；不保证云模型支持所有结构合法参数。
- CanvasOperations 校验输入/已知节点参数、锁内读改写、提交后 best-effort 通知；通知失败不改变已保存操作的成功状态。
- engine 解析依赖/参数，计算节点缓存键，建立全图执行计划，通过注入的 executor 执行。
- 白模请求 Schema、默认场景、参数规范化与数值限制；具体绘制/视频编码归 UI/任务模块。

## 不负责事项

不保存 job、不调度系统队列、不实现云端 HTTP 或 three.js/FFmpeg，不存缓存索引。预设文件读写归[存储](core-storage.md)，跨进程适配归 CLI/桥接。

## 接口与依赖

CanvasGraph 含 schemaVersion:1、id、可选 name、version、graphHash、nodes、edges；旧文件缺少 name 仍可读取，不自动写回迁移。CanvasNode 含 id/type/params/inputs/outputs/status/cachedResult，CanvasEdge 含 id/source/sourcePort/target/targetPort。节点状态含 idle 和业务运行态。端口 ID/类型见 registry：

| 节点 | 输入 | 输出 |
| --- | --- | --- |
| text-input / image-input / video-input | 无 | text / image / video |
| canvas-reference | 无 | video |
| text-to-image / text-to-video | text | image / video |
| image-to-image / image-to-video | image、text | image / video |
| video-to-video | video、text | video |
| white-model-video | 无 | video |
| output | image、video（接入一个） | image、video（透传实际素材） |

编辑允许暂不完整的图；连线验证端口存在、类型、目标端口单入边、自连和环。生成验证整张图，要求恰好一个连通 output 和完整必需输入。非空上游文本优先于 params.prompt；文本输入使用 params.text，空文本回退 prompt；媒体连线优先于 params.asset。

图变更递增 version 并重算 graphHash，output 状态/缓存失效；hash 包含 schemaVersion/id/排序节点和边，节点忽略 status/cachedResult，params 使用稳定序列化。节点参数修改重置该节点结果；不将 version 或执行状态纳入图内容 hash。

名称属于展示元数据：createCanvas(id,name?) 保存可选名称；normalizeCanvasName 去首尾空白，要求 1–100 个字符且无换行/控制字符。renameCanvas 只在规范化名称改变时更新 name 并递增 version，保留 graphHash、节点状态、生成结果和缓存，不使时间线引用过期。CanvasOperations 的 canvas.rename 在项目锁内执行读改写并发送原有画布变更通知；canvas.list/get 返回已保存的可选 name。允许重名，ID 和 JSON 文件名不变。

节点缓存键 = sha256([node.type, canonicalJson(params), canonicalJson(排序后的输入摘要), 项目 width×height@fps].join('\n'))；五类云端生成节点的 params.model 先规范化为实际模型 ID（节点非空值优先，再取项目图像/视频默认值）。因此更换节点模型或其继承的项目模型会换键，显式指定模型不受项目默认值变更影响；白模等非云端节点键不变。文本摘要用 sha256，媒体用 AssetRef.id，项目 fps 当前也参与图片缓存键。算法唯一归本模块，持久化见[缓存存储](core-cache.md)。

buildCanvasRenderPlan(graph,settings,{force,nodeId},cache?) 总是构建全图；nodeId 强制该节点及下游，force 强制全部生成节点，不是单节点执行或暂停点。executeCanvasPlan 使用真正上游结果重新计算键、查询缓存并经 GenerationExecutor 调用实际后端，返回 output/outputType/nodeResults。两层子画布限制由当前任务执行递归检查，编辑期深度/反向校验与更新传播仍待补。

计划选项另接受 modelDefaults:{imageModel,videoModel}，在 CanvasRenderPlan 中保留一份副本，确保执行阶段的请求与缓存使用同一实际模型；buildProviderRequest/nodeCacheKey 也接受可选第四参数 modelDefaults。桌面任务与 CLI dry-run 从项目配置注入，不在这些调用层重复定义优先级。生成节点 params.model 接受字符串/null，去首尾空白后为空即继承默认；数值等错误类型在编辑 Schema 和请求构建中拒绝。默认值未注入的直接库调用会保留未指定模型，由 Provider 默认配置兜底；此类调用如需按默认模型区分缓存，应显式传入 modelDefaults。

CANVAS_API 暴露 list/get/node-types/create/rename、node.add/set-param/remove、edge.connect/remove、render、job.status/cancel 的元数据；create 接受可选 name，rename 接受 canvasId/name 并返回 canvasId/name/version。job 方法实际实现归[任务](desktop-jobs.md)。顶层输入通常拒绝未知字段；params 允许扩展并校验已知字段。set-param 是浅合并；未提供字段保留。canvas.remove 当前不在这组共享编辑方法里，由存储删除入口处理。

白模参数默认场景 1280×720、30fps、5000ms；渲染宽高缺省可继承项目 settings，显式参数优先。宽高 64–1920、偶数、总像素 ≤1920×1080；fps 1–60 整数；durationMs 100–30000；1–100 个 box/sphere/cylinder，XYZ 位置/尺寸/角度及可选终点，旋转用度；相机 start/end/target/fov 10–100，背景六位十六进制、ground、lightIntensity 0–10。frameCount=max(1,round(durationMs×fps/1000))。GLB/骨骼动画未实现。

CanvasPreset 含 schemaVersion/id/name/version、graph.nodes/edges、inputs；节点只保存结构/参数。输入槽位类型存在，但当前 apply 没有完整 $input 槽位绑定/跨项目引用处理。

## 数据和副作用

底层 graph 函数修改内存对象；CanvasOperations 通过存储在项目锁内保存图，再通知。engine 通过注入 executor/cache 可产生实际副作用；建计划本身不提交 Provider。AssetRef 是路径引用，不是媒体像素；渲染成功与素材实际尺寸/质量需分别检查。

## 验证入口

[core.test.mjs](../../tests/core.test.mjs)、[canvas-operations.test.mjs](../../tests/canvas-operations.test.mjs)、[canvas-codemode.test.mjs](../../tests/canvas-codemode.test.mjs)、[white-model.test.mjs](../../tests/white-model.test.mjs)覆盖图/hash/计划、校验/合并、业务桥和白模契约。本轮未运行。

名称验证由 canvas-operations 覆盖：中文/emoji、创建/列表/读取持久化、旧文件兼容、非法名称无写入、同名不增版本、并发改名/节点编辑不丢失，以及 hash/结果/节点缓存/时间线 fresh 状态保留；CLI 和 MCP 入口分别见对应模块。

2026-10-17：canvas-operations/cli/canvas-codemode/canvas-sync 共 15 项测试通过，包含离线 CLI 与在线 CLI/MCP 的名称写入；未触发真实生成服务。

单节点模型覆盖见 [node-model.test.mjs](../../tests/node-model.test.mjs)：五类请求的模型回退、参数类型校验、模型变更的缓存隔离，以及混合模型 Worker 执行和继承默认值变更。2026-10-16：与 core/canvas-operations/white-model/audit 共 32 项测试通过，使用模拟 Provider；未调用真实付费生成。

## 已知边界偏差

传统 CLI 未完全进入统一编辑事务，见 [H-02](../issues.md#h-02)；预设实例化仍在 CLI/主进程重复。节点远端恢复、子画布依赖传播、编辑期跨图深度校验、Provider 参数执行期统一校验、版本迁移与 Undo/Redo 待补；结构合法不等于云端规格合法。
