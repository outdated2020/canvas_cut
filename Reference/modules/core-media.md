# FFmpeg 与媒体探测

## 作用

唯一负责将 RenderPlan 转换为实际 FFmpeg 参数、执行媒体子进程并用 ffprobe 探测媒体。它不拥有队列和时间线数据规则。

## 对应源码

[ffmpeg.ts](../../packages/core/src/ffmpeg/ffmpeg.ts)。

## 负责事项

- buildFfmpegArgs 确定输入顺序、视频 filter graph、音轨混合、字幕烧录和输出编码。
- runFfmpeg 执行进程、采集输出、处理 timeout/AbortSignal 和退出错误。
- probeMedia 返回媒体尺寸、时长、音轨等信息；FFprobe 定位和任务校验由调用方提供配置。

## 不负责事项

不生成时间线 segments、不改剪辑或项目数据、不提交 job。白模帧/窗口管理归[任务](desktop-jobs.md)，three.js 绘制归[UI](desktop-ui.md)。

## 接口与依赖

buildFfmpegArgs(plan,audioAssetPaths) 消费[时间线 RenderPlan](core-timeline.md)；audioAssetPaths 标识可混入原声的媒体。runFfmpeg(ffmpegPath,args,{signal,timeoutMs,...}) 接收调用方参数，probeMedia 的实际 options/返回值见源码。依赖 Node spawn/fs/path，不依赖 Electron 或 React。

当前按计划收集素材，输出一个整体 filter_complex：trim/setpts、scale/rotate/alpha、全时长黑底 overlay，静态图 loop；字幕使用 drawtext 与转义；音频使用源裁剪、atempo、volume、adelay、afade、amix，包含经探测的视频原声。按整条时间线总时长输出，保留开头/中间空隙、裁剪与轨道顺序，编码配置以生成参数为准。

## 数据和副作用

启动 FFmpeg/ffprobe、读取素材并写输出路径；失败/超时/取消抛结构化错误。调用方负责导出路径选择与结果归档。探测失败对导出应明确失败，资产导入的 best-effort 容忍策略归[存储](core-storage.md)。不能根据可执行文件存在推断编码器/滤镜齐全。

## 验证入口

[audit.test.mjs](../../tests/audit.test.mjs)检查参数、原声、完整时长和进程中止，[core.test.mjs](../../tests/core.test.mjs)包含基础 render plan/FFmpeg 参数测试。真实编码需完整 FFmpeg/ffprobe，检查字幕、原声、旋转、变速、轨道叠加和音画同步；本轮未运行。

## 已知边界偏差

crossfade 当前转换为片段自身淡入淡出，没有相邻两片段 xfade/acrossfade；段落中间文件/concat/分段缓存、ASS/libass 与软字幕、特效双后端一致性未实现，保留在 [PLAN](../../PLAN.md)。这些不应从旧渲染设计迁成当前承诺。
