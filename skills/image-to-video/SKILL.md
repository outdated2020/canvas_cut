---
name: image-to-video
description: 将单张图片转为动态短视频
version: 0.1.0
inputs:
  - name: image_path
    type: string
    required: true
    description: 输入图片路径
  - name: prompt
    type: text
    required: true
    description: 动作与氛围描述
  - name: duration_ms
    type: number
    required: false
    default: 5000
    description: 视频时长，毫秒
triggers:
  - 图生视频
  - 图片动起来
  - image to video
---

# 执行步骤

1. 调用 `generate image-to-video --image {image_path} --prompt {prompt} --duration-ms {duration_ms}`。
2. 使用 `job wait` 等待任务结束。
3. 将结果作为媒体片段加入时间线。
4. 按需导出 `timeline export`。
