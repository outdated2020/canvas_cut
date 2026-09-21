---
name: storyboard-to-video
description: 将分镜脚本转为多镜头 Canvas Cut 画布、顺序时间线、字幕和可选成片。
version: 1.0.0
inputs:
  - name: storyboard
    type: text
    required: true
  - name: output_path
    type: string
    required: false
triggers:
  - 分镜脚本
  - 多镜头视频
---

# 多镜头创作

先读取索引中的 canvas-cut SKILL.md，所有业务操作通过 CLI。

1. 用 read_file 读取脚本或解析用户输入，整理镜头描述、时长、参考素材和字幕。将辅助计划写入 storyboard-plan.json，逐镜头记录 canvasId、jobId、clipId、状态和稳定幂等键。
2. 读取 canvas list、asset list、timeline get，识别已有结果；继续任务时复用计划中的 ID，先查任务状态，不重复创建或生成。
3. 按每个镜头的输入选择节点链：纯文本可用 text-to-video；参考图用 image-input → image-to-video；需要先生成参考图可用 text-to-image → image-to-video。文本/图片端口按基础 Skill 连接。
4. 每个画布先 dry-run 校验，再提交 render，记录 jobId。可以先提交多个任务，但不要突破主进程的任务调度与模型步数限制；较长脚本分批完成并留下明确进度。
5. 等待成功后按脚本顺序入轨，位置为现有目标轨末尾加已插入镜头时长。每次成功写入 clipId，再处理下一个镜头。
6. 根据明确请求添加字幕；音乐只使用用户指定或项目已有音频。未请求的音乐不自行下载。当前转场实现不等于完整交叉溶解，明确说明限制。
7. 用户要求导出时提交 timeline export 并等待成功。报告已完成镜头、失败/未完成镜头、输出路径及需要处理的问题。

遇到失败先查询实际状态；修改提示词后使用新生成操作键。中断后的进度以 CLI 和计划文件为依据，不把旧助手文本当成成功证据。
