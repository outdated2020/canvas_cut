# 时间线领域与渲染计划

## 作用

唯一定义轨道/片段剪辑语义、画布片段解析和渲染计划。预览和编码消费这些数据，各自实现展示与媒体执行。

## 对应源码

[timeline.ts](../../packages/core/src/timeline/timeline.ts)、[render-plan.ts](../../packages/core/src/timeline/render-plan.ts)，结构载体为 [types.ts](../../packages/core/src/types.ts)。

## 负责事项

- 轨道和媒体/画布/字幕片段的增删、查找、分割、裁剪、移动、变换、透明度、速度、音量、转场配置和时长计算。
- 从项目画布读取并解析 CanvasClip 素材，保护用户的入点/裁剪时长和输入对象。
- 将时间线边界转换为活动片段集合，构造 RenderPlan、检查渲染素材存在性。

## 不负责事项

不写时间线文件、不调度 job、不构造 FFmpeg filter graph，不负责播放头/HTML 媒体元素。时间线编辑保存事务应统一由领域服务组织，CLI/UI 适配不重新定义剪辑规则。

## 接口与依赖

TimelineFile 为 schemaVersion/id/tracks；Track 为 id/type/name/clips，type 是 video/audio/subtitle/image。MediaClip 保存 asset/startMs/durationMs/inMs/outMs/opacity，及可选 transform/blendMode/speed/volume/transition；CanvasClip 保存 canvasId/canvasVersion/canvasGraphHash/renderedAsset/status，另有剪辑字段；SubtitleClip 保存 text/startMs/durationMs。Transform 为 x/y/scale/rotation。

split/trim 在速度变化时正确换算素材源时间；startMs/durationMs 描述时间线区间，inMs/outMs 描述素材源区间。CanvasClip 引用的 fresh/stale 等状态基于画布版本/hash；读取与手动更新当前由 ProjectStore/应用适配实现，不自动重跑生成。

buildRenderPlan(timeline,{outputPath,projectRoot,settings,crf}) 接收项目 settings 或经任务显式覆盖后的值；验证偶数正分辨率、帧率等，收集 0、总时长和片段起止边界形成 segments；每段记录 activeVideo/activeAudio/activeSubtitles。RenderPlan 含 projectPath/outputPath/width/height/fps/crf/segments/tracks。render-plan 解析项目文件会用文件 I/O，不能描述为全模块纯函数。

resolveCanvasClipsInTimeline 复制/解析素材而不覆盖原输入或用户裁剪；未生成/素材缺失时导出必须失败。刷新画布引用是用户显式操作，不自动把时间线改成新素材。

## 数据和副作用

编辑函数修改调用方的内存时间线；解析函数读取项目图和检查文件，但文件保存归[存储](core-storage.md)。派生计划不提交媒体任务。时间线不持有一套独立 width/height/fps 字段，输出配置由项目/任务注入。

## 验证入口

[core.test.mjs](../../tests/core.test.mjs)覆盖基本剪辑/计划，[audit.test.mjs](../../tests/audit.test.mjs)覆盖速度/入点/裁剪、非破坏性引用解析和导出参数，[cli.test.mjs](../../tests/cli.test.mjs)覆盖命令适配。本轮未运行。

## 已知边界偏差

CLI/主进程重复读取/编辑/保存编排，ProjectStore 派生状态，见 [H-03](../issues.md#h-03)、[H-06](../issues.md#h-06)。crossfade 仅有数据配置，真正双片段转场尚未实现；分段独立渲染/concat/段落缓存是旧设计待办，当前 RenderPlan 分段不意味着后端分段编码。
