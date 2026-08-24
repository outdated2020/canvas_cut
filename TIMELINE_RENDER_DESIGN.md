# 时间线渲染计划设计（TIMELINE RENDER DESIGN）

> 状态：设计阶段，尚未实现
> 更新日期：2026-08-15

## 1. 目标

- 把时间线数据转换为可执行的渲染计划
- 支持多轨视频合成、音频混音、字幕、转场
- 画布片段按导出分辨率一次生成；预览使用本地低清代理，避免重复生成
- 支持片段级缓存，避免重复渲染

## 2. 渲染管线总览

```mermaid
graph LR
    TL[时间线数据] --> RESOLVE[解析画布片段<br/>确保资产已生成]
    RESOLVE --> SEG[分段算法]
    SEG --> PLAN[渲染计划]
    PLAN --> FF[FFmpeg 命令构建]
    FF --> EXEC[FFmpeg sidecar 执行]
    EXEC --> CONCAT[拼接分段]
    CONCAT --> OUT[输出文件]
```

## 3. 分段算法

将时间线切分为「活动片段集合不变」的分段：

1. 收集所有片段的 `startMs`、`endMs`、转场边界
2. 排序得到事件点
3. 相邻事件点之间形成分段
4. 每个分段记录当前活动的视频、音频、字幕片段

```ts
interface RenderSegment {
  id: string
  startMs: number
  endMs: number
  activeVideo: ActiveClip[]
  activeAudio: ActiveClip[]
  activeSubtitles: ActiveClip[]
}
```

## 4. 视频合成

每个分段按轨道层级从下到上合成：

1. 解码活动片段
2. 应用源裁剪（in / out）
3. 应用变换：位置、缩放、旋转
4. 应用透明度和混合模式
5. 叠加到输出画面

FFmpeg 对应能力：

- 裁剪：`trim`、`setpts`
- 缩放：`scale`
- 旋转：`rotate`
- 透明度：`format=rgba`、`colorchannelmixer`、`fade`
- 叠加：`overlay`
- 混合：`blend`

## 5. 转场

MVP 先支持同轨道相邻片段的交叉淡化：

- 使用 `xfade` 过渡
- 音频使用 `acrossfade` 成对处理
- 需要两个输入流和过渡时长
- 转场区间单独处理，避免破坏常规分段

后续再扩展更多转场类型。

## 6. 音频混音

音频片段按时间偏移混音：

- 每个音频片段：`adelay` 设置偏移
- 音量：`volume`
- 淡入淡出：`afade`
- 多轨混音：`amix=inputs=N`

## 7. 字幕

- 文本字幕：`drawtext`
- 样式字幕：`subtitles` 或 ASS
- 导出时烧录进画面
- 中文字幕优先 ASS + libass 构建，注意字体路径转义

## 8. FFmpeg 实现策略

推荐：分段渲染 + 拼接，而不是单个超大 filter_complex。

优点：

- 单段 filter graph 简单可控
- 支持段落级缓存
- 内存占用低
- 某段失败可单独重试

流程：

1. 每个分段渲染为中间文件
2. 中间文件使用 mezzanine 或无损格式
3. 最后用 `concat` 拼接

## 9. 缓存

- 缓存键：分段内容哈希
- 时间线某段未变化时复用中间文件
- 画布片段重新生成后，相关分段缓存失效

## 10. 预览与导出

- 预览：WebGL 实时合成，在渲染进程完成，不经过 FFmpeg
- 导出：FFmpeg / 未来 C++ 全分辨率渲染
- 画布片段按导出分辨率生成一次，预览使用本地低清代理
- 两者共享时间线数据模型，但实现后端不同，需控制特效/贴纸一致性

## 11. 待确认

1. 转场类型范围
2. 中间文件格式
3. 字幕是否支持软字幕输出
