# 项目存储、资产与文件写入

## 作用

管理项目目录、JSON 文件、媒体文件与预设的物理存储，并提供文件锁/原子写。当前 ProjectStore 还含跨领域逻辑，这些现状保留为偏差而非目标归属。

## 对应源码

[project-store.ts](../../packages/core/src/project/project-store.ts)、[atomic.ts](../../packages/core/src/fs/atomic.ts)、[lock.ts](../../packages/core/src/fs/lock.ts)。

## 负责事项

- 项目根定位、初始化、打开、路径生成与状态文件读写；canvas/preset ID 路径检查。
- 项目资产复制与按内容 SHA-256 命名、已有文件复用；本地资产引用构造。
- 项目级预设 JSON 列表/读写，项目摘要及 updatedAt 维护。
- 原子 JSON/text 写、UTF-8 BOM 容忍读取、.lock 获取/等待/释放。

## 不负责事项

不拥有图规则、时间线剪辑、预设业务实例化、job 数据库、节点缓存索引、Agent 日志或运行凭证。画布删除引用保护、时间线过期判定和媒体探测调用当前在 ProjectStore 中，应由相应业务层组织，见偏差。

## 接口与依赖

ProjectStore.requireOpen/init/readProject/readConfig/writeConfig/readCanvas/writeCanvas/removeCanvas/readTimeline/writeTimeline/listPresets/readPreset/writePreset/importAsset/assetFromLocalPath/summary 是现行接口，签名以源码为准。调用方用 withProjectLock 围住读改写事务；单个 atomicWriteJson 不自动获得项目锁，也不是多文件原子事务。

```text
<project>/
  project.json       # schemaVersion/id/name/createdAt/updatedAt/settings
  config.json        # Provider、TOS 非凭证配置、concurrency、可选 ffmpeg.path
  .lock
  canvases/<id>.json
  presets/<id>.json
  timeline/timeline.json
  assets/
  cache/             # 索引归对应缓存/任务模块
  jobs.sqlite        # 由桌面任务模块拥有
  skills/            # 项目自定义说明，由 Agent SkillRegistry 读取
```

project.json 的 settings 含 width/height/fps/previewResolution；timeline.json 不重复保存输出分辨率。节点和导出请求可有显式覆盖，具体优先级归对应领域。config 的当前默认值来自源码 createDefaultConfigFile：新项目默认生图模型为 Seedream 5.0 Flash（doubao-seedream-5-0-flash-260915），默认视频模型为 Seedance 2.0 Mini（doubao-seedance-2-0-mini-260615）；已有 config.json 保留原设置，需要通过项目配置单独更新。模型 ID 默认值不表示固定云端能力或账号已开通；节点模型覆盖与继承语义见[画布](core-canvas.md)。

锁以独占创建 .lock 写 pid/timestamp/token，默认 timeout 10s、stale 60s、重试间隔 100ms；当前锁超过 staleMs 或 PID 不存活即尝试删除，释放接受 token 匹配或同 PID。没有续租，不能宣称长事务必然保持互斥，见 [H-09](../issues.md#h-09)。JSON 写入同目录临时文件、sync、rename；每次替换只保护单文件。

## 数据和副作用

读写项目 JSON、复制 assets、更新 project 时间戳。AssetRef 为 id/path/type/sizeBytes 及可选尺寸/时长，当前常用绝对路径，并非旧协议声称的统一相对路径。importAsset 对音视频 best-effort 调 ffprobe，失败可无元数据，不等于导出前严格探测。readTimeline 在文件不存在时会初始化文件；读取已有时间线还派生 canvas stale/failed 状态。removeCanvas 检查时间线及其他画布引用后删除图文件，保留媒体资产。

## 验证入口

[core.test.mjs](../../tests/core.test.mjs)覆盖项目/导入/画布删除保护，[canvas-operations.test.mjs](../../tests/canvas-operations.test.mjs)覆盖并发编辑，[audit.test.mjs](../../tests/audit.test.mjs)覆盖非破坏性时间线解析。本轮未运行。

## 已知边界偏差

[H-06](../issues.md#h-06)：读接口存在初始化副作用和跨域判断；建议将业务引用保护/过期策略迁入统一领域服务，保留存储 I/O。[H-09](../issues.md#h-09)：陈旧锁与释放的所有者判断待收紧。版本字段存在，但完整迁移、未知高版本只读、项目备份/恢复、跨项目引用/相对路径重定位、全局预设、资产 GC 尚未完整实现，见 [PLAN](../../PLAN.md)。
