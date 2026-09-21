---
name: image-to-video
description: 根据一张本地图片与提示词生成短视频，并按需加入 Canvas Cut 时间线和导出。
version: 1.0.0
inputs:
  - name: image_path
    type: string
    required: true
  - name: prompt
    type: text
    required: true
  - name: duration_ms
    type: number
    default: 5000
triggers:
  - 图生视频
  - 图片动起来
---

# 图片生成短视频

先从 Skill 索引定位并读取 canvas-cut 的 SKILL.md，了解 CLI 端口、等待和入轨规则。

1. 通过 asset list 或用户给定路径找到真实图片；缺少图片时向用户说明，不虚构素材。
2. `canvas-cut asset import --file "图片路径" --json`，保留 data AssetRef。
3. 创建画布，添加 image-input、text-input、image-to-video、output。用 write_file 写参数文件：图片输入的 asset 为完整 AssetRef，文本输入的 text 为提示词，生成参数的 durationMs 为请求时长。
4. 连接 image-input:image → image-to-video:image，text-input:text → image-to-video:text，image-to-video:video → output:video。所有 ID 来自 CLI 返回值。
5. canvas render 的 dry-run 通过后提交，保存稳定幂等键和 jobId；用 job wait/status 等到成功。
6. 需要入轨时读取时间线，选择视频轨并计算追加位置；需要导出时提交 export 并等待完成。

直接生成而不保留画布仅在用户明确需要素材时使用：

```text
canvas-cut generate image-to-video --image "图片路径" --prompt "动作描述" --duration-ms 5000 --idempotency-key <operation-key> --json
```

失败时保留画布与 jobId，先检查状态再修正。停止 Agent 不会自动取消远端生成，取消用 job cancel。
