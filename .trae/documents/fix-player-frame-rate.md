# 修复播放器帧率问题

## 问题总结

当前播放器存在三个核心问题导致帧率低、体验差：

1. **时间线用 `setInterval(100ms)` 驱动 playhead** → 只有 10 FPS 的 UI 更新频率，看起来卡顿
2. **视频元素没有真正播放** → `<video>` 只有 `controls`，没有 `autoPlay`，也没有和 playhead 同步 `currentTime`，时间线播放时视频不动
3. **片段切换重建 DOM** → playhead 跨过片段边界时 `previewAsset` 变化，React 卸载/重建 `<video>` 元素，导致闪烁和加载延迟

## 当前代码分析

### 播放循环（App.tsx ~684 行）
```tsx
useEffect(() => {
  if (!playing) return;
  const timer = setInterval(() => {
    setPlayheadMs((current) => {
      const next = current + 100;
      if (timelineDurationMs > 0 && next >= timelineDurationMs) {
        setPlaying(false);
        return timelineDurationMs;
      }
      return next;
    });
  }, 100);
  return () => clearInterval(timer);
}, [playing, timelineDurationMs]);
```
- 每 100ms 更新一次 → 10 FPS
- 不用 `requestAnimationFrame` → 不同步显示器刷新率
- 每个 tick 触发完整 React 重渲染

### 视频元素（App.tsx ~1082 行）
```tsx
<video className="viewer-media" src={fileUrl(previewAsset.path)} controls playsInline />
```
- 没有 `autoPlay`，没有 `ref`，没有和 playhead 绑定
- 时间线播放时，视频不播放，只是显示第一帧

### 片段查找（App.tsx ~740 行）
```tsx
const timelinePreviewAsset = (() => {
  if (!playing || !timeline) return null;
  for (const track of timeline.tracks ?? []) {
    if (track.type !== 'video' && track.type !== 'image') continue;
    for (const clip of track.clips ?? []) {
      if (playheadMs >= clip.startMs && playheadMs < clip.startMs + clip.durationMs) {
        if (clip.kind === 'canvas' && clip.renderedAsset) return clip.renderedAsset;
        if (clip.kind === 'media') return clip.asset;
      }
    }
  }
  return null;
})();
```
- 每次 playhead 变化都重新遍历所有 track/clip
- 切换片段时 previewAsset 变化 → React 重建 `<video>` DOM

## 修复方案

### 1. 用 `requestAnimationFrame` 替代 `setInterval`（核心修复）

**文件**: `apps/desktop/src/renderer/App.tsx` ~684 行

**改为**:
```tsx
useEffect(() => {
  if (!playing) return;
  let rafId: number;
  let lastTs = performance.now();
  const tick = (ts: number) => {
    const elapsed = ts - lastTs;
    lastTs = ts;
    setPlayheadMs((current) => {
      const next = current + elapsed;
      if (timelineDurationMs > 0 && next >= timelineDurationMs) {
        setPlaying(false);
        return timelineDurationMs;
      }
      return next;
    });
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(rafId);
}, [playing, timelineDurationMs]);
```

**效果**: 60 FPS 平滑更新，基于真实时间差累加，不会因帧率波动导致播放速度不准。

### 2. 视频/音频元素绑定播放控制

**文件**: `apps/desktop/src/renderer/App.tsx`

**新增 ref 和 effect**:
- 新增 `videoRef` / `audioRef`（`useRef<HTMLVideoElement | null>`）
- 新增 useEffect：当 `playing` 状态变化时，调用 `videoRef.current.play()` / `.pause()`
- 当 `playing` 从 true→false 时暂停视频
- 当 `playing` 从 false→true 且当前预览是视频时自动播放

**视频元素改为**:
```tsx
<video
  ref={videoRef}
  className="viewer-media"
  src={fileUrl(previewAsset.path)}
  controls
  playsInline
  // 移除 autoPlay，由 ref 控制
/>
```

### 3. 稳定片段切换，避免 DOM 重建闪烁

**文件**: `apps/desktop/src/renderer/App.tsx`

**方案**: 给 `<video>` 和 `<img>` 加 `key` 属性，但用资产路径而非索引，这样同一资产的片段切换不会重建 DOM。同时，当片段切换时保持视频播放连续性。

- `key={previewAsset.path}` → 相同资产不重建
- 片段切换时如果新资产也是视频，在 useEffect 中调用 `videoRef.current.play()`

### 4. playhead 更新优化（避免不必要的重渲染）

**文件**: `apps/desktop/src/renderer/App.tsx`

- `timelinePreviewAsset` 计算用 `useMemo` 包裹，依赖 `[playing, timeline, playheadMs]`
- 只有当 previewAsset 真正变化时才更新 DOM
- 减少 console.log 等不必要的输出

## 实施步骤

### Step 1: 替换播放循环为 rAF
- 编辑 `apps/desktop/src/renderer/App.tsx` ~684 行
- `setInterval(100)` → `requestAnimationFrame` + `performance.now()`

### Step 2: 添加视频 ref 和播放控制
- 新增 `videoRef = useRef<HTMLVideoElement | null>(null)`
- 新增 useEffect 同步 `playing` → video.play()/pause()

### Step 3: 优化 previewAsset 计算和 DOM 稳定性
- `timelinePreviewAsset` 包 `useMemo`
- video/img 加 `key={previewAsset.path}`

### Step 4: 编译验证
- `npx tsc --noEmit -p apps/desktop/tsconfig.json`

## 验证方式

1. 启动应用，添加视频素材到时间线
2. 点击播放 → 检查：
   - playhead 移动是否平滑（应该是 60fps 而非 10fps 跳动）
   - 视频是否跟随播放（不是只显示第一帧）
   - 片段切换时是否闪烁
3. 暂停 → 视频也暂停
4. TypeScript 编译通过
