# 时间线编辑 & 渲染功能完善计划

> 日期：2026-08-28
> 目标：从当前的"基础骨架"升级到"可用的时间线编辑器 + 可导出的渲染管线"

## 1. 现状分析

### 已实现

| 层级 | 已有 | 说明 |
|------|------|------|
| **数据模型** | `TimelineFile` / `Track` / `Clip` (Media/Canvas/Subtitle) | 类型完整，在 `packages/core/src/types.ts` |
| **Core 编辑函数** | addTrack, removeTrack, addMediaClip, addCanvasClip, addSubtitleClip, splitClip, trimClip, moveClip, setClipTransform, setClipOpacity, setClipSpeed, setClipVolume, removeClip, addTransition, removeTransition | 在 `packages/core/src/timeline/timeline.ts`，**全部已实现但大部分未暴露** |
| **渲染计划** | buildRenderPlan, resolveCanvasClipsInTimeline, assertRenderAssetsExist | 在 `packages/core/src/timeline/render-plan.ts` |
| **FFmpeg 导出** | buildFfmpegArgs, runFfmpeg | 在 `packages/core/src/ffmpeg/ffmpeg.ts`，转场显式抛错 |
| **IPC Handler** | timeline.get, timeline.add-track, timeline.add-clip, timeline.add-subtitle, timeline.move-clip, timeline.export | 在 `apps/desktop/src/main/main.ts` |
| **UI** | TimelineView.tsx | 轨道/片段渲染、拖拽移动、播放头、缩放、工具条按钮 |
| **Job Worker** | processTimelineExport | 在 `apps/desktop/src/main/job-worker.ts`，调用 FFmpeg |

### 未实现 / 缺失

| 缺口 | 影响 |
|------|------|
| **IPC 未暴露的 core 函数** | removeClip, splitClip, trimClip, setClipTransform, setClipOpacity, setClipSpeed, setClipVolume, addTransition, removeTransition, removeTrack — core 有代码但 IPC 和 UI 没接 |
| **片段拖拽调整大小** | TimelineView 只支持拖拽移动，没有 resize handle |
| **片段选中 / 多选** | 无选中状态，所有操作无法定向到具体片段 |
| **Razor（分割）UI** | 工具条有按钮但未接线 |
| **删除片段/轨道** | 无 UI 操作 |
| **转场 FFmpeg 实现** | buildFfmpegArgs 遇到 transition 直接抛错 |
| **播放预览** | playhead 是假的定时器递增，无实际媒体播放 |
| **Canvas 片段生命周期** | 加 canvas clip 时不检查是否已渲染，durationMs 硬编码 5000 |
| **导出设置 UI** | 导出路径硬编码，无分辨率/帧率/码率选择 |
| **AnyRecord 类型** | 前端 timeline 状态全是 `AnyRecord`，无类型安全 |

## 2. 实施步骤

按优先级分 4 轮，每轮可独立验证。

---

### 第一轮：IPC 补全 + 片段编辑基础（核心通路）

目标：把 core 已有的编辑函数暴露到 IPC + preload + 前端，让片段可以删除、分割、裁剪。

#### 2.1 补全 IPC handler

**文件**：`apps/desktop/src/main/main.ts`

新增 case 分支：

```
case 'timeline.remove-clip':
  // 读 timeline -> removeClip(timeline, clipId) -> 写回

case 'timeline.remove-track':
  // 读 timeline -> removeTrack(timeline, trackId) -> 写回

case 'timeline.split-clip':
  // 读 timeline -> splitClip(timeline, clipId, atMs) -> 写回

case 'timeline.trim-clip':
  // 读 timeline -> trimClip(timeline, clipId, inMs, outMs) -> 写回

case 'timeline.set-clip-param':
  // 通用参数设置：读 timeline -> 根据 param 名调用 setClipTransform/Opacity/Speed/Volume -> 写回
  // payload: { path, clipId, param: 'transform'|'opacity'|'speed'|'volume', value }
```

所有 case 复用 `withLockedProject` 模式，与现有 `timeline.move-clip` 一致。

#### 2.2 补全 preload 白名单

**文件**：`apps/desktop/src/preload/preload.ts`

在 allowedChannels 数组中添加：
```
'timeline.remove-clip',
'timeline.remove-track',
'timeline.split-clip',
'timeline.trim-clip',
'timeline.set-clip-param'
```

#### 2.3 前端调用封装

**文件**：`apps/desktop/src/renderer/App.tsx`

新增函数：
```ts
async function removeTimelineClip(clipId: string)
async function removeTimelineTrack(trackId: string)
async function splitTimelineClip(clipId: string, atMs: number)
async function trimTimelineClip(clipId: string, inMs: number, outMs: number)
async function setClipParam(clipId: string, param: string, value: unknown)
```

每个函数调用对应 IPC 后 `await refreshTimeline()`。

---

### 第二轮：Timeline UI 增强（选中、删除、分割、调整大小）

目标：让用户能在时间线上选中片段、删除、用 Razor 分割、拖拽边缘调整时长。

#### 2.4 片段选中状态

**文件**：`apps/desktop/src/renderer/App.tsx`

- 新增 `selectedClipId: string | null` 状态
- 点击片段时 `setSelectedClipId(clip.id)`
- 点击空白区域 `setSelectedClipId(null)`
- 选中片段高亮（CSS border 或 outline）

#### 2.5 TimelineView 增强

**文件**：`apps/desktop/src/renderer/TimelineView.tsx`

新增 props：
```ts
interface TimelineViewProps {
  timeline: AnyRecord | null;
  onMoveClip: (clipId: string, startMs: number) => void;
  onRemoveClip?: (clipId: string) => void;        // 新增
  onSplitClip?: (clipId: string, atMs: number) => void;  // 新增
  onTrimClip?: (clipId: string, inMs: number, outMs: number) => void;  // 新增
  selectedClipId?: string | null;                 // 新增
  onSelectClip?: (clipId: string | null) => void; // 新增
  zoom?: number;
  playheadMs?: number;
  onSeek?: (ms: number) => void;
  razorMode?: boolean;                            // 新增
}
```

具体实现：

1. **选中高亮**：选中的 clip 加 `selected` className
2. **删除快捷键**：选中状态下按 Delete/Backspace → `onRemoveClip(selectedClipId)`
3. **Razor 模式**：`razorMode=true` 时点击片段 → `onSplitClip(clipId, playheadMs)`
4. **Resize handle**：每个 clip 左右各加一个 6px 宽拖拽条：
   - 左拖 → 调整 startMs + durationMs（向左扩展）或 trim inMs
   - 右拖 → 调整 durationMs（向右扩展）或 trim outMs
   - 拖拽中实时显示 ghost 位置，松手后调用 `onTrimClip` 或 `onMoveClip`

#### 2.6 工具条按钮接线

**文件**：`apps/desktop/src/renderer/App.tsx`

- Razor 按钮 → toggle `razorMode` 状态
- Delete 按钮 / 快捷键 → `removeTimelineClip(selectedClipId)`
- 轨道右键菜单 → 删除轨道

---

### 第三轮：转场 FFmpeg 实现 + Canvas 片段生命周期

目标：转场能真正导出；Canvas 片段加入时间线时自动检查渲染状态。

#### 2.7 转场 FFmpeg 实现

**文件**：`packages/core/src/ffmpeg/ffmpeg.ts`

当前代码遇到 transition 直接抛错。改为：

1. 检测同轨道相邻片段是否有 `transition.type === 'crossfade'`
2. 对有转场的相邻片段对，使用 `xfade` filter 合成
3. 音频使用 `acrossfade`
4. 移除现有的 "Transitions are not implemented" 抛错

实现策略：
- 在 `buildFfmpegArgs` 中，先收集有 transition 的片段对
- 对这些片段对，先各自 trim/transform，再 xfade 合成
- 无 transition 的片段走原有 overlay 逻辑
- 分段渲染 + concat 策略（如设计文档所述）

#### 2.8 Canvas 片段生命周期改进

**文件**：`apps/desktop/src/renderer/App.tsx` → `addCanvasClipToTimeline`

当前：硬编码 `durationMs: 5000`，不检查是否已渲染。

改为：
1. 读取 canvas 的 output node `cachedResult`
2. 如果有 `cachedResult.durationMs`，用作默认时长
3. 如果 canvas 未渲染（无 cachedResult），弹出确认："画布尚未渲染，是否先渲染再加入时间线？"
4. 如果用户确认，先 `canvas.render` 等待完成后再添加

**文件**：`apps/desktop/src/renderer/TimelineView.tsx`

Canvas 片段视觉状态：
- `status === 'stale'` → 橙色边框 + 斜线纹理
- `status === 'rendering'` → 蓝色脉冲动画
- `status === 'failed'` → 红色边框
- `status === 'fresh'` → 正常颜色

---

### 第四轮：类型安全 + 导出设置 + 播放预览基础

目标：前端类型安全、导出可选参数、基础播放预览。

#### 2.9 类型安全

**文件**：`apps/desktop/src/renderer/App.tsx`

将 `timeline: AnyRecord | null` 替换为 `timeline: TimelineFile | null`。
将 TimelineView props 中的 `AnyRecord` 替换为对应的 `Track`、`Clip` 类型。
从 `@canvas-cut/core` 导入类型。

#### 2.10 导出设置 UI

**文件**：`apps/desktop/src/renderer/App.tsx`

导出按钮改为打开一个导出设置弹窗：
- 分辨率（从 project.settings 读取默认，可改）
- 帧率（默认 30）
- 码率/CRF
- 输出路径选择
- 导出按钮 → 调用 `timeline.export` IPC

#### 2.11 播放预览基础

**文件**：`apps/desktop/src/renderer/TimelineView.tsx` + `App.tsx`

当前 playhead 只是定时器递增。改为：
1. 根据当前 playheadMs 计算当前活动的视频片段
2. 在 Viewer 面板显示当前帧（图片片段直接显示，视频片段抽帧显示）
3. 播放时定时（每 33ms = 30fps）推进 playhead
4. 到达片段边界时切换显示的资产

这只是基础预览（图片切换 + 简单计时），不是实时视频合成。WebGL 实时合成留到 Phase 1。

## 3. 文件变更清单

| 文件 | 轮次 | 变更 |
|------|------|------|
| `apps/desktop/src/main/main.ts` | R1 | 新增 5 个 IPC case |
| `apps/desktop/src/preload/preload.ts` | R1 | 白名单加 5 个 channel |
| `apps/desktop/src/renderer/App.tsx` | R1-R4 | 新增编辑函数、选中状态、Razor、导出弹窗、类型安全 |
| `apps/desktop/src/renderer/TimelineView.tsx` | R2-R4 | 选中、resize、razor、Canvas 状态显示、播放预览 |
| `packages/core/src/ffmpeg/ffmpeg.ts` | R3 | xfade 转场实现 |
| `apps/desktop/src/renderer/style.css` | R2-R3 | 选中高亮、resize handle、Canvas 状态样式 |

## 4. 假设与决策

1. **不引入新的 npm 依赖**：所有功能用现有 React + ReactFlow 基础设施实现
2. **转场 MVP 只做 crossfade**：其他转场类型留到后续
3. **播放预览是帧切换而非实时合成**：真正的 WebGL 合成留到 Phase 1
4. **导出设置弹窗替代硬编码路径**：但不做完整的导出预设系统
5. **AnyRecord → 类型安全 逐步替换**：优先 timeline 相关，其他地方暂不动

## 5. 验证步骤

### R1 验证
- 在 UI 中添加片段，通过快捷键/按钮删除、分割、裁剪
- 检查 timeline.json 文件内容正确更新

### R2 验证
- 点击片段选中高亮
- Razor 模式下点击片段执行分割
- 拖拽片段左右边缘调整时长
- Delete 键删除选中片段

### R3 验证
- 给相邻片段加 crossfade 转场，导出不报错
- 未渲染的 Canvas 片段加入时间线时有提示
- Canvas 片段在时间线上显示 stale/rendering/fresh 状态

### R4 验证
- TypeScript 编译无 AnyRecord 相关 timeline 报错
- 导出弹窗可设置分辨率/帧率/输出路径
- 播放时 Viewer 面板根据 playhead 位置切换显示图片
