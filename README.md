# Canvas Cut

通用 Agent Runtime 的工具参数、MCP/Shell 配置和恢复机制见 [AGENT_RUNTIME.md](AGENT_RUNTIME.md)。

Electron 视频创作原型：节点生成画布、时间线、Agent 与本地 CLI。当前实现边界和待办见 [PLAN.md](PLAN.md)，尚未完成真实成片流程验收。

## 开发环境

- Node.js 20 以上、npm；当前测试环境为 Windows / Node.js 22。
- `npm install` 安装 workspaces；桌面包 postinstall 使用 electron-rebuild 重建 better-sqlite3。
- 导出需要 FFmpeg 与 ffprobe。可以把两者加入 PATH，或在运行时设置中填写 FFmpeg 完整路径并将 ffprobe 放在同一目录。也支持 FFMPEG_PATH / FFPROBE_PATH 环境变量。

## 常用命令

```powershell
npm run build
npm test
npm run start:desktop
npm run dev:desktop:app
node apps/cli/dist/index.js --help
```

启动脚本目前针对 Windows；其他平台可构建后在 apps/desktop 下执行 `npm start`，但 macOS 尚待验收。

## 配置与数据

在桌面 Settings 配置 ARK、Agent OpenAI 兼容地址/模型，以及需要上传时使用的 TOS bucket/region/endpoint/凭证。密钥不要加入仓库；桌面运行时设置通过 Electron safeStorage 加密敏感字段。

项目保存为 JSON、assets、缓存与任务数据库。生成/渲染命令需要桌面主进程运行。修改画布后先渲染，再点击时间线的 Update canvas clips 更新引用；更新保留现有片段裁剪长度。

## 验证

`npm test` 重新编译测试使用的模块，执行本地 mock 与行为回归，不调用付费生成服务。`npm run build:desktop` 验证生产打包构建，但不会生成可分发安装包。

真实验收至少覆盖：两段视频拼接、时间线空隙、原声音轨、独立音轨、画布图片、裁剪/变速、字幕、取消、重复提交与重启。保留导出文件并检查时长和音画；测试通过不代表 FFmpeg 或 Provider 已联调通过。

## 通用 Agent

在 Settings 配置 Agent 地址、模型和密钥，打开项目后在聊天框提交任务。Agent 只使用文件和命令基础工具；视频能力通过内置 Skills 与 `canvas-cut` CLI 执行。聊天面板显示工具进度、历史和停止按钮。

内置 Skill 位于 `skills`，用户扩展放在 `~/.canvas-cut/skills/<name>/SKILL.md`，项目扩展放在 `<project>/skills/<name>/SKILL.md`。项目覆盖用户，用户覆盖内置；每轮重新扫描。

当前采用本地可信执行：Windows PowerShell，macOS Bash；项目只是默认工作目录，不是沙箱，没有逐条命令审批。Web Search 和沙箱属于后续能力。停止 Agent 会终止该轮 Shell，已经提交的生成任务需要通过 `canvas-cut job cancel <jobId> --json` 单独取消。

会话与命令日志保存在桌面 userData 下的 `agent/sessions`。重启后保留工具历史，将未完成运行标记为中断，继续时先检查已有结果。CLI 在应用启动时自动配置到 Agent 的 PATH；开发环境需要先构建桌面与 CLI。架构和完整限制见 [AGENT_ORCHESTRATION_DESIGN.md](AGENT_ORCHESTRATION_DESIGN.md)。

## 外部 MCP 对话接入

桌面启动并配置 Agent 后，外部 MCP 客户端可启动本仓库的 stdio 服务。先构建 CLI（`npm run build:cli`）；使用 Node.js 22，CLI 入口和项目参数都填写绝对路径。例如客户端配置：

```json
{
  "mcpServers": {
    "canvas-cut": {
      "command": "node",
      "args": [
        "C:/Users/liqijun/Desktop/canvas_cut/apps/cli/dist/index.js",
        "mcp",
        "--project",
        "C:/Users/liqijun/Desktop/canvas_cut/demo-project"
      ]
    }
  }
}
```

| 工具 | 参数 | 用途 |
| --- | --- | --- |
| agent_send_prompt | prompt | 向会话发送 prompt，立即返回 runId |
| agent_get_run | after（可选） | 查询最新运行、增量事件与 cursor |
| agent_history | 无必填参数 | 读取完整持久化对话与工具历史 |
| agent_cancel | 无必填参数 | 停止当前会话的 Agent 运行 |
| ui_screenshot | fresh（可选） | 保留原有桌面截图能力 |
| search_tools | query、offset、limit（均可选） | 搜索可在代码中调用的工具，返回 JSON Schema 与 TypeScript 调用提示 |
| execute | code | 在隔离运行时执行 JavaScript，编排 Agent、画布编辑和生成任务工具 |

四个 Agent 工具都可传 projectPath 覆盖启动参数，以及 conversationId 指定会话；默认 conversationId 为 `default`，对应桌面当前显示的对话。桌面打开同一项目时会自动同步外部 prompt 和结果，并切到聊天视图；其他项目不会自动切换。自定义会话可通过 MCP 查询，桌面暂没有会话切换入口。

### Code Mode

沿用上述 MCP 启动配置，无需另外启动服务。先调用 `search_tools({"query":"agent"})` 发现工具；空 query 列出全部可编排工具。搜索按名称和描述匹配，空格分隔的词必须全部匹配。返回的 `nextOffset` 用于继续分页。

`initialize` 的 `instructions`、工具描述和参数 Schema 都包含使用约束。`canvas_*` / `job_*` 是内部方法，只能在 `execute` 中调用 `tools.<方法名>`，不能把它们作为顶层 MCP `tools/call` 的名称。原生画布操作无需调用 `agent_send_prompt` 启动另一轮 Agent 对话。修改描述并重新构建后，客户端需要重连 MCP；已经缓存的旧工具描述不会自动更新。

stdio 使用 **UTF-8、无 BOM、每行一个 JSON-RPC 消息**。优先使用 MCP SDK 的 stdio transport。手写 PowerShell/.NET 客户端时，必须在启动子进程前显式设置重定向流编码；仅设置控制台编码或 `$OutputEncoding` 不会设置 `Process.StandardInput` 的编码：

```powershell
$utf8 = [System.Text.UTF8Encoding]::new($false)
$startInfo.StandardInputEncoding = $utf8
$startInfo.StandardOutputEncoding = $utf8
$startInfo.StandardErrorEncoding = $utf8
```

曾发生默认 `ibm437` 把中文在进入 MCP 前替换为 `?` 的问题。服务无法恢复已经丢失的字符；提交生成前先用 `canvas_get` 重读提示词并与原文比较，不要仅凭请求代码判断中文传输正确。

再调用 `execute({"code":"..."})`。code 是异步函数体，直接写 JavaScript，支持顶层 await、return、循环、Promise.all 和 try/catch；TypeScript 类型只是调用提示，不接受 TypeScript 语法。例：

```javascript
const responses = await Promise.all([
  tools.agent_history({}),
  tools.agent_get_run({})
]);
const [history, status] = responses.map(r => JSON.parse(r.content[0].text));
console.log('读取会话完成');
return { messages: history.messages, run: status.run };
```

`execute` 的 text 内容是 JSON：`{result, logs, calls}`，只把脚本返回值、console.log 和调用次数交给模型。`tools.*` 保留原 MCP 返回格式；工具 isError 转成可捕获的异常。截图的图片仍在 content 中，以 base64 返回，较大图片可能触及结果限制；需要直接显示图片时使用原 `ui_screenshot` 工具。

注意两层返回值：脚本内部通过 `r.structuredContent` 读取画布/任务数据；客户端收到的 `execute` 响应通过 `JSON.parse(response.content[0].text).result` 取得脚本返回值，先检查 `response.isError` 再解析。每次执行的变量都会清空，后续调用所需的 `canvasId` / `nodeId` / `jobId` 必须由客户端保存并再次传入代码。

执行器位于 `packages/codemode`，采用独立 Worker 中的 QuickJS/WASM。每次执行新建运行时，不提供 process、require、fetch、文件、模块或定时器能力，只能通过注册工具访问宿主。默认限制：30 秒、32 MiB QuickJS 堆、32 次工具调用、1 MiB 输出、64 KiB 代码、最多 4 个并发执行；日志最多 64 KiB，上游返回数据累计最多 4 MiB。工具参数在宿主再次按 JSON Schema 验证。

MCP `notifications/cancelled` 与 stdin 关闭会终止代码执行。已经提交的 Agent 或生成任务不会自动回滚；查询状态后按需调用 `agent_cancel` 或 `tools.job_cancel`。代码隔离限制的是 JavaScript 自身；`agent_send_prompt` 仍授予现有桌面 Agent 的本地文件和 Shell 能力。脚本不是事务，中途失败会保留此前成功的修改。

`npm run test:codemode` 验证编排、参数校验、隔离与资源限制；`npm test` 同时覆盖真实 stdio → Code Mode → 桌面 IPC 会话调用。

### Code Mode 画布与生成

桌面运行、项目已初始化时，调用 `search_tools({"query":"canvas"})` 获取画布工具，按 `nextOffset` 分页。对外 MCP 仍是上述 7 个工具；以下方法仅供 `execute` 中调用，不会单独出现在 `tools/list` 中。

| 方法 | 参数与结果 |
| --- | --- |
| `canvas_list` / `canvas_get` | 列出画布；按 `canvasId` 读取完整图与版本 |
| `canvas_node_types` | 返回 10 种节点类型、端口、参数 Schema、必需输入与示例 |
| `canvas_create` | 创建空画布，返回 `canvasId`、`version`、`canvas` |
| `canvas_node_add` | `canvasId`、`type`、可选 `params`；返回 `nodeId`、`version`、`node` |
| `canvas_node_set_params` | `canvasId`、`nodeId`、`params`；合并更新，返回节点与版本 |
| `canvas_node_remove` | `canvasId`、`nodeId`；删除节点及关联边 |
| `canvas_edge_connect` | `canvasId`、`source`、`sourcePort`、`target`、`targetPort`；返回 `edgeId`、`version`、`edge` |
| `canvas_edge_remove` | `canvasId`、`edgeId`；删除边 |
| `canvas_render` | `canvasId`、可选 `nodeId` / `force` / `idempotencyKey`；提交生成，立即返回 `jobId` |
| `job_status` / `job_cancel` | `jobId`；查询或取消生成任务 |

这些方法支持可选绝对路径 `projectPath`，默认取 MCP `--project`，不随桌面当前项目切换；`canvas_node_types` 不需要项目。结果同时放在 `structuredContent` 和 JSON text 中，推荐读取 `structuredContent`。搜索结果提供输入、输出 Schema 及返回类型提示。编辑和生成结果写回会自动刷新对应项目的桌面列表和当前画布，保留节点位置、选择和视图；不会自动打开新画布。

先读取 `(await tools.canvas_node_types({})).structuredContent`，再提交以下异步函数体给 `execute`，创建并生成一张图片：

```javascript
const data = r => r.structuredContent;
const { canvasId } = data(await tools.canvas_create({}));
const input = data(await tools.canvas_node_add({
  canvasId, type: 'text-input', params: { text: '山间日出，电影感' }
}));
const gen = data(await tools.canvas_node_add({ canvasId, type: 'text-to-image' }));
const output = data(await tools.canvas_node_add({ canvasId, type: 'output' }));
await tools.canvas_edge_connect({
  canvasId, source: input.nodeId, sourcePort: 'text', target: gen.nodeId, targetPort: 'text'
});
await tools.canvas_edge_connect({
  canvasId, source: gen.nodeId, sourcePort: 'image', target: output.nodeId, targetPort: 'image'
});
await tools.canvas_node_set_params({
  canvasId, nodeId: input.nodeId, params: { text: '山间日出，薄雾缓慢流动' }
});
const job = data(await tools.canvas_render({ canvasId, idempotencyKey: `first-render-${canvasId}` }));
return { canvasId, inputNodeId: input.nodeId, imageNodeId: gen.nodeId, outputNodeId: output.nodeId, jobId: job.jobId };
```

在后续 `execute` 中写 `return (await tools.job_status({jobId: '上一步的 jobId'})).structuredContent;` 查询结果；不要在同一脚本里长时间轮询。需要生成视频时，把生成节点改为 `text-to-video`，参数使用 `durationMs`，连接生成节点与 output 的 `video` 端口。生成会调用已配置的真实 Provider；测试使用模拟 Provider。

`canvas_render` **始终执行整张图**，包括图中的其他生成节点。`nodeId` 是缓存绕过的起点：强制重算该节点及其下游，不是“只生成这个节点”，也不会在这个节点暂停。`force: true` 会绕过所有生成节点的缓存；普通继续生成应省略 `nodeId` 和 `force`，让未修改的参考图从缓存复用。

“先参考图，再视频”有两种流程：一次构建 `文本 → text-to-image → image-to-video → output`，会按依赖自动生成图片、再生成视频，中间不等待确认；如果需要先检查参考图，先只创建并生成图片画布，确认图像后再添加视频节点。即使未连接到 output，预先添加的视频生成节点也会被整图执行，不能靠断开输出实现暂停。

图片任务成功且已查看实际参考图后，可在另一次 `execute` 中扩展上述图片画布。把下面三个 ID 替换为客户端保存的返回值；图片生成节点和提示词保持不变：

```javascript
const canvasId = '上一步的 canvasId';
const imageNodeId = '上一步的 imageNodeId';
const outputNodeId = '上一步的 outputNodeId';
const graph = (await tools.canvas_get({ canvasId })).structuredContent;
const oldOutputEdge = graph.edges.find(edge => edge.target === outputNodeId);
const video = (await tools.canvas_node_add({
  canvasId,
  type: 'image-to-video',
  params: {
    prompt: '保持参考图场景，薄雾缓慢流动，固定机位，无文字',
    durationMs: 4000, width: 1920, height: 1080
  }
})).structuredContent;
await tools.canvas_edge_connect({
  canvasId, source: imageNodeId, sourcePort: 'image', target: video.nodeId, targetPort: 'image'
});
await tools.canvas_edge_remove({ canvasId, edgeId: oldOutputEdge.id });
await tools.canvas_edge_connect({
  canvasId, source: video.nodeId, sourcePort: 'video', target: outputNodeId, targetPort: 'video'
});
return (await tools.canvas_render({
  canvasId, idempotencyKey: `video-stage-v1-${canvasId}`
})).structuredContent;
```

`durationMs` 的单位是毫秒，`4000` 表示请求 4 秒。Schema 只校验参数形状，不保证已配置模型支持该时长；一次真实调用中 Seedance 2.5 的参考图视频模式拒绝 3 秒、接受 4 秒，这不是所有模型或模式的能力承诺。遇到 Provider 参数错误需先读 `job_status.error`，修正参数后以新幂等键提交，不能原样重试。视频的宽高会映射为 Provider 支持的比例和分辨率档位；图片的 `sizeMode` 或项目 `imageResolution` 会优先于自定义宽高。需要精确 3 秒成片时，应生成模型支持的时长并在宿主外部裁剪；本 Code Mode 没有裁剪/导出或文件工具。

`job_status` 的父任务 `succeeded` 才表示整图完成。父任务失败时也要检查 `children`：参考图可能已成功生成，可从子任务的 `result.path` 找到；整图失败时它未必已经写回 `canvas_get.cachedResult`。返回的 AssetRef 是本地文件引用，不包含媒体像素；用宿主媒体查看工具检查真实主体，用媒体探测工具检查时长和尺寸，不能把“任务成功”直接等同于“满足用户要求”。

`text-input` 修改 `params.text`；生成节点修改 `params.prompt`，但非空的已连接文本输入优先，应该修改该输入节点。参数更新保留未指定字段并使节点和输出缓存失效；不自动重新生成。构建中的不完整画布可以保存，`canvas_render` 会验证完整图。相同幂等键用于重试同一次提交，会返回原来的任务（包括已失败/成功任务）；仅修改提示词不会让旧键变成新提交。新的生成意图必须使用新键；超时后先查任务状态，不能盲目重复提交。本次不提供画布整体删除、时间线编辑或导出工具。

发送示例：`agent_send_prompt({"prompt":"读取 canvas-cut skill，查看当前项目有哪些画布"})`。随后调用 agent_get_run，以返回的 cursor 作为下次 after，直到 status 离开 running；最终文本见 run.text，完整内容可用 agent_history 获取。get-run/cancel 针对会话的最新运行，runId 用于核对运行身份，不是可查询任意旧运行的参数。

同一会话只允许一个运行；运行中继续发送会返回 MCP isError。提交后连接中断不会自动停止任务，也不要盲目重发，应先查历史确认。停止 Agent 不会取消已提交的生成任务。MCP 使用现有带 token 的本地 IPC，不新增网络监听端口；授权发送 prompt 即允许桌面 Agent 按本地可信模式使用文件和 Shell 工具。
