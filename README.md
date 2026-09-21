# Canvas Cut

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

四个 Agent 工具都可传 projectPath 覆盖启动参数，以及 conversationId 指定会话；默认 conversationId 为 `default`，对应桌面当前显示的对话。桌面打开同一项目时会自动同步外部 prompt 和结果，并切到聊天视图；其他项目不会自动切换。自定义会话可通过 MCP 查询，桌面暂没有会话切换入口。

发送示例：`agent_send_prompt({"prompt":"读取 canvas-cut skill，查看当前项目有哪些画布"})`。随后调用 agent_get_run，以返回的 cursor 作为下次 after，直到 status 离开 running；最终文本见 run.text，完整内容可用 agent_history 获取。get-run/cancel 针对会话的最新运行，runId 用于核对运行身份，不是可查询任意旧运行的参数。

同一会话只允许一个运行；运行中继续发送会返回 MCP isError。提交后连接中断不会自动停止任务，也不要盲目重发，应先查历史确认。停止 Agent 不会取消已提交的生成任务。MCP 使用现有带 token 的本地 IPC，不新增网络监听端口；授权发送 prompt 即允许桌面 Agent 按本地可信模式使用文件和 Shell 工具。
