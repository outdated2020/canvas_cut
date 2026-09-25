---
name: canvas-cut
description: 操作 Canvas Cut 项目、素材、画布节点、生成任务、时间线和导出。用于创建或修改视频作品；普通文件任务无需加载。
version: 1.0.0
---

# Canvas Cut CLI

通过 exec_command 运行 `canvas-cut`。默认 cwd 为当前项目，也可在命令中显式加 `--project "项目绝对路径"`。业务编辑必须使用 CLI，不直接覆盖 project/config/canvases/timeline JSON 或任务数据库。辅助提示词、分镜和参数文件可以使用文件工具。

辅助文件用 `write_file` 新建；默认不会覆盖已有文件。局部修改使用 `apply_patch`，先用 `read_file` 读完当前文件的所有分页。完整覆盖需指定 `mode: overwrite` 并传入读取结果中的 `expectedHash`。没有 `edit_file` 工具。

先读取现状：

```text
canvas-cut project status --json
canvas-cut canvas list --json
canvas-cut asset list --json
canvas-cut timeline get --json
canvas-cut manifest --json
```

只有首次创建新项目才运行 `project init`。不要重复 init 已有时间线。对单条命令使用 `--help --json` 获取参数。命令输出为 `{ok,data,error,requestId}`；日志在 stderr。命令退出码、ok 和 job.status 分别检查。命令进程仍运行时用 read_process_output 的字节游标读取，不要重新提交命令。

## 创建与编辑画布

以下尖括号均需替换为真实返回值，不可照抄。每次 Shell 调用不保留变量；跨调用 ID 应从工具历史取得或写入辅助文件。

```text
canvas-cut canvas create --name "镜头一" --json
canvas-cut canvas node add --canvas <canvasId> --type text-input --params-file prompt.json --json
canvas-cut canvas node add --canvas <canvasId> --type text-to-video --params-file generation.json --json
canvas-cut canvas node add --canvas <canvasId> --type output --json
canvas-cut canvas edge connect --canvas <canvasId> --from <textNodeId>:text --to <generationNodeId>:text --json
canvas-cut canvas edge connect --canvas <canvasId> --from <generationNodeId>:video --to <outputNodeId>:video --json
canvas-cut canvas get <canvasId> --json
```

用 write_file 创建 `prompt.json`，如 `{"text":"夕阳下的海岸，镜头缓慢推进"}`；`generation.json` 如 `{"durationMs":5000}`。根据需求设置时长和生成类型，不固定模板。

支持节点：text-input、image-input、video-input、canvas-reference、text-to-image、text-to-video、image-to-image、image-to-video、video-to-video、output。文本端口为 text，图像端口为 image，视频端口为 video；output 可连接 image 或 video。通过 canvas get 查看实际端口。

图片/视频输入：先 `canvas-cut asset import --file "素材路径" --json`，将返回的整个 data AssetRef 写入 `{"asset": <AssetRef>}` 参数文件，再添加 image-input/video-input。canvas-reference 参数为 `{"canvasId":"..."}`，最多两层且不得循环引用。

修改参数用 `canvas node set-param --canvas <id> --node <id> --params-file changes.json --json`；删除节点用 `canvas node remove --canvas <id> --node <id> --json`；删除边用 `canvas edge remove --canvas <id> --edge <id> --json`。

## 生成与等待

```text
canvas-cut canvas render <canvasId> --dry-run --json
canvas-cut canvas render <canvasId> --idempotency-key <stable-operation-key> --json
canvas-cut job wait <jobId> --timeout-ms 1800000 --json
canvas-cut job status <jobId> --json
canvas-cut job list --json
canvas-cut job cancel <jobId> --json
```

等待命令可能持续较久；exec_command 超时设为 1800000，使用 read_process_output 等待进程。临近超时可先终止等待命令，再用 job status 查询；终止 Shell 不等于取消生成。

同一次提交重试复用幂等键；新参数用新键。未知提交结果先查询 job list/status。生成失败时读取错误并修正，不盲目重跑；强制重生成才使用 `canvas render <id> --force`，可能产生费用。

`--dry-run` 只用于 generate、canvas render、timeline export。其他命令不支持，不要将其当成全局预览机制。

## 时间线与导出

读取 timeline get，选择兼容轨道，按 `max(startMs + durationMs)` 计算追加位置。不存在视频轨时：

```text
canvas-cut timeline add-track --type video --name V1 --json
canvas-cut timeline add-clip --track <trackId> --kind canvas --canvas <canvasId> --start-ms <position> --duration-ms <duration> --json
canvas-cut timeline add-clip --track <trackId> --kind media --asset "素材绝对路径" --start-ms <position> --duration-ms <duration> --json
```

画布必须生成成功再加入。时长参考输出资产与用户要求。画布修改后，先重新渲染，再运行 `timeline refresh-canvases --clip <clipId> --json`；不指定 clip 会更新所有画布片段。更新保留裁剪长度。

```text
canvas-cut timeline split-clip --clip <clipId> --at-ms <timelineTime> --json
canvas-cut timeline trim-clip --clip <clipId> --in-ms <sourceIn> --out-ms <sourceOut> --json
canvas-cut timeline move-clip --clip <clipId> --start-ms <timelineStart> --json
canvas-cut timeline set-speed --clip <clipId> --speed 2 --json
canvas-cut timeline add-track --type subtitle --name S1 --json
canvas-cut timeline add-subtitle --track <subtitleTrackId> --text "字幕" --start-ms 0 --duration-ms 5000 --json
canvas-cut timeline add-track --type audio --name A1 --json
canvas-cut timeline add-audio --track <audioTrackId> --asset "音乐路径" --start-ms 0 --json
canvas-cut timeline export --output "成片.mp4" --width 1920 --height 1080 --fps 30 --crf 18 --json
```

导出也返回 jobId，必须等到 succeeded 才能报告完成。FFmpeg/ffprobe 必须可用；当前转场仅单片段淡入淡出，不宣称完整交叉转场。音乐来源必须实际存在，不编造文件或下载授权。

## Windows 引号

PowerShell 与 Bash 示例都优先使用参数文件：用 write_file 写 UTF-8 JSON，然后 `--params-file "参数 文件.json"`。避免跨平台拼接内联 JSON。PowerShell 原生程序失败后，复合脚本应显式 `exit $LASTEXITCODE`。不同命令间不依赖 `$变量` 或 cd；每次设置 cwd 或 --project。
