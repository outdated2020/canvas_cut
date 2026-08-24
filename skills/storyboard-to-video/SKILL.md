---
name: storyboard-to-video
description: 把分镜脚本转成完整视频
version: 0.1.0
inputs:
  - name: storyboard
    type: text
    required: true
    description: 分镜脚本文本
  - name: output_path
    type: string
    required: true
    description: 导出路径
triggers:
  - 分镜脚本
  - 多镜头视频
  - storyboard
---

# 执行步骤

1. 解析 storyboard，提取镜头列表：描述、时长、风格。
2. 为每个镜头调用 `canvas create`，并添加文本/图片输入与生成节点。
3. 调用 `canvas render` 获取 jobId，用 `job wait` 等待完成。
4. 调用 `timeline add-clip --kind canvas` 按顺序加入。
5. 调用 `timeline add-subtitle` 和 `timeline add-audio`。
6. 调用 `timeline export --output {output_path}`。
