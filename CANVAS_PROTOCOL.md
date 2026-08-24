# 画布协议设计（CANVAS PROTOCOL）

> 状态：设计阶段，尚未实现
> 更新日期：2026-08-15

## 1. 目标与范围

定义画布（节点生成链）的图文件 schema、节点注册表、端口连接规则、graphHash / 缓存键规范化、CanvasReference 引用、preset 序列化与版本迁移。本文档是 `CORE_ENGINE_DESIGN.md` 与 `PROJECT_STATE_PROTOCOL.md` 的细化。

画布只做生成链，不包含通用合成/调色节点。

## 2. 画布文件 schema

`canvases/<canvasId>.json`：

```ts
{
  schemaVersion: 1,
  id: string,
  version: number,
  graphHash: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
}
```

## 3. 节点与边

### 3.1 通用结构

```ts
type NodeType =
  | 'text-input'
  | 'image-input'
  | 'video-input'
  | 'canvas-reference'
  | 'text-to-image'
  | 'text-to-video'
  | 'image-to-image'
  | 'image-to-video'
  | 'video-to-video'
  | 'output'

type PortType = 'text' | 'image' | 'video'

interface NodePort {
  id: string
  type: PortType
}

interface CanvasNode {
  id: string
  type: NodeType
  params: Record<string, unknown>
  inputs: NodePort[]
  outputs: NodePort[]
  status: 'idle' | 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  cachedResult?: AssetRef
}

interface CanvasEdge {
  id: string
  source: string
  sourcePort: string
  target: string
  targetPort: string
}
```

`status` 与 `cachedResult` 是运行态字段，不参与 `graphHash` / 缓存键。

### 3.2 节点注册表

| 类型 | 输入端口 | 输出端口 | 参数 schema |
| --- | --- | --- | --- |
| `text-input` | - | `text` | `{ text: string }` |
| `image-input` | - | `image` | `{ asset: AssetRef }` |
| `video-input` | - | `video` | `{ asset: AssetRef }` |
| `canvas-reference` | - | `video` | `{ canvasId: string }` |
| `text-to-image` | `text` | `image` | `TextToImageParams` |
| `text-to-video` | `text` | `video` | `TextToVideoParams` |
| `image-to-image` | `image`, `text` | `image` | `ImageToImageParams` |
| `image-to-video` | `image`, `text` | `video` | `ImageToVideoParams` |
| `video-to-video` | `video`, `text` | `video` | `VideoToVideoParams` |
| `output` | `image` 或 `video` | 同输入 | 无额外参数 |

参数类型：

```ts
interface TextToImageParams {
  prompt: string
  negativePrompt?: string
  width?: number   // 缺省继承 project.json settings.width
  height?: number  // 缺省继承 project.json settings.height
  seed?: number
  style?: string
}

interface TextToVideoParams {
  prompt: string
  negativePrompt?: string
  durationMs?: number   // 缺省或 -1 自适应时，生成后回填实际时长
  fps?: number          // 缺省继承 project.json settings.fps
  width?: number
  height?: number
  seed?: number
  motionStrength?: number
}

interface ImageToImageParams {
  prompt: string
  negativePrompt?: string
  strength?: number
  width?: number
  height?: number
  seed?: number
}

interface ImageToVideoParams {
  prompt: string
  negativePrompt?: string
  durationMs?: number   // 缺省或 -1 自适应时，生成后回填实际时长
  fps?: number          // 缺省继承 project.json settings.fps
  width?: number
  height?: number
  seed?: number
  motionStrength?: number
}

interface VideoToVideoParams {
  prompt: string
  mode: 'edit' | 'extend'
  durationMs?: number   // 缺省或 -1 自适应时，生成后回填实际时长
  fps?: number          // 缺省继承 project.json settings.fps
  width?: number
  height?: number
  seed?: number
  motionStrength?: number
}
```

分辨率字段（`width / height / fps`）在节点层为可选覆盖；唯一来源仍是 `project.json`，画布最终结果按导出分辨率一次生成。

## 4. 端口连接校验

| 源端口类型 | 可连接目标端口 |
| --- | --- |
| `text` | `text-to-image.text`、`text-to-video.text`、`image-to-image.text`、`image-to-video.text`、`video-to-video.text` |
| `image` | `image-to-image.image`、`image-to-video.image`、`output.image` |
| `video` | `video-to-video.video`、`output.video` |

校验规则：

- 端口类型必须匹配
- 目标端口必须在目标节点声明过
- 图必须无环，节点不得自连
- 每个输入端口最多一条入边（MVP 简化；多输入文本合并在后续扩展）

## 5. graphHash 与 version

规范化序列化：

1. 剔除运行态字段（`status`、`cachedResult`）
2. 节点按 `id` 升序，边按 `id` 升序
3. 每个节点对象键排序，`params` 递归键排序
4. 使用稳定的 JSON 序列化（键有序、无多余空白）
5. `graphHash = sha256(canonicalJson)`

变更语义：

- 任何节点 / 边 / 参数变更，立即递增 `version` 并重算 `graphHash`
- 时间线与 CanvasClip 通过 `graphHash` 判断画布片段是否 stale
- 渲染结果绑定 `(canvasId, graphHash)`

## 6. 缓存键

```text
cacheKey = sha256(
  nodeType
  + "\n" + canonicalParams(params)
  + "\n" + canonicalInputs(node)
  + "\n" + resolution
)
```

- `canonicalParams`：与 graphHash 相同的键排序序列化
- `canonicalInputs`：按端口 `id` 排序；`text` 用文本 sha256，`image/video` 用资产内容 sha256 或 `AssetRef.id`
- `resolution`：`width x height @ fps`（视频节点包含 fps，图像节点可省略 fps）

命中即复用节点缓存；`reroll` / `--force` 绕过缓存。

## 7. 执行语义

1. 校验图（无环、端口匹配、必填输入完整）
2. 拓扑排序得到执行顺序
3. 逐节点计算缓存键，命中则复用
4. 未命中节点创建子任务 NodeJob，调用 Provider
5. 结果写入资产目录，回填 `cachedResult`
6. 父任务 CanvasRenderJob 聚合子任务状态
7. 渲染结果绑定 `(canvasId, graphHash)`

prompt 双通道：

- 连线优先：有连线时，连线上游输出作为主输入
- `params` 作为默认值：未连线时回退到 params

## 8. CanvasReference

- 通过 `params.canvasId` 指向子画布
- 渲染父画布时先递归渲染子画布
- 子画布 `graphHash` 变化时，父画布相关缓存失效
- 最多两层：被引用的子画布不得再包含 `canvas-reference`
- 反向校验：已被其他画布引用的画布，禁止再添加 `canvas-reference` 节点
- 子画布输出作为父画布的 `video` 输入进入 `output`

## 9. Output 语义

- `output` 接受 `image` 或 `video`，原样透传作为画布结果
- 画布结果可能是图片或视频，时间线画布片段同样支持两者
- 画布结果按导出分辨率生成一次，预览使用本地低清代理

## 10. preset schema

```ts
interface CanvasPreset {
  schemaVersion: 1
  id: string
  name: string
  version: number
  graph: {
    nodes: PresetNode[]
    edges: CanvasEdge[]
  }
  inputs: PresetInputSlot[]
}

interface PresetNode {
  id: string
  type: NodeType
  params: Record<string, unknown>  // 值可为 { "$input": "slotId" } 引用槽位
}

interface PresetInputSlot {
  id: string
  name: string
  type: PortType
  required: boolean
  description?: string
}
```

`preset apply` 时按 `inputs` 填充槽位生成具体 `CanvasGraph`；必填槽位缺失时报 `INVALID_PARAMS`。

## 11. schemaVersion 迁移

- 每个画布 JSON 含 `schemaVersion`
- 打开项目时按版本执行迁移
- 未知更高版本：只读打开并提示用户

## 12. 待定项

- 多输入文本端口：后续支持，MVP 不引入；确有合并需求时再增加 `text-concat` 节点
- 节点 `params` 的 JSON Schema 校验是否由 zod / manifest 统一生成
- `canvas-reference` 是否支持引用画布内非 Output 节点的中间结果（当前仅 Output）
