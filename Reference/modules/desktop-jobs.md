# 桌面任务调度与执行

## 作用

唯一拥有 Canvas Cut 业务 job 的队列、持久化、进度、取消和重启处理；执行外部生成、画布计划、时间线导出及本地白模输出。

## 对应源码

[daemon.ts](../../apps/desktop/src/main/daemon.ts)、[job-store.ts](../../apps/desktop/src/main/job-store.ts)、[job-worker.ts](../../apps/desktop/src/main/job-worker.ts)、[uploader.ts](../../apps/desktop/src/main/uploader.ts)、[white-model-renderer.ts](../../apps/desktop/src/main/white-model-renderer.ts)。

## 负责事项

- Daemon 按项目装配 store/worker，串行提交，维护幂等和活动画布渲染去重。
- JobStore 保存 job；Worker 调度根任务，按画布依赖执行并更新节点子任务，聚合进度/结果，保护取消终态。
- 为 Provider 注入素材下载/上传，下载生成结果到 assets；TosUploader 执行 SDK 上传并生成预签名 URL。
- 执行[画布计划](core-canvas.md)和[时间线计划](core-timeline.md)，在锁内回写结果并发出画布变更回调。
- 白模执行器管理独立隐藏窗口、帧接收/落盘、FFmpeg 能力检查与编码、输出探测和临时文件清理。

## 不负责事项

不定义图规则、缓存键、时间线剪辑、供应商字段或 three.js 场景；不承担 Agent run 的状态管理。FFmpeg 通用参数/子进程实现归[媒体](core-media.md)，任务模块只组织调用。

## 接口与依赖

DaemonService 的 submitJob/getJob/waitJob/cancelJob/listJobs/clearJobs/shutdown 提供任务接口。提交类型包括五种 generate.*、canvas.render、timeline.export。submitJob 返回 jobId/type，画布任务另有 childJobIds，返回不代表完成。

同一项目、相同 idempotencyKey 派生稳定 ID；提交摘要随 request_snapshot 保存，同键异参拒绝。画布当前版本的活动渲染另有去重逻辑。幂等依赖保留的 job 记录，清理后没有独立 TTL 去重库。waitJob 默认 30 分钟，每 500ms 查询，超时是等待失败，不能据此推断任务未执行。

JobWorker 用 GenerationExecutor 连接 core、Provider 与 WhiteModelRenderer。renderWhiteModelVideo(request, context) 接收 assetsDir/cacheDir、ffmpegPath、signal、onProgress，返回 AssetRef。白模参数规则只由[画布](core-canvas.md)定义。

画布提交检查和 Worker 开始执行时读取项目图像/视频默认模型，以 modelDefaults 注入 core 计划；实际节点模型由 core 解析，随请求传给共享 Provider，Worker 不修改 Provider 全局模型。执行计划同时用于模型相关缓存查找。默认配置按执行时读取，已在运行的生成不因 UI 改值而切换模型。

## 数据和副作用

默认项目 jobs.sqlite，WAL、busy_timeout=5000；SQLite 不可用时使用 cache/jobs.json。InMemoryJobStore 用于测试。记录字段为 id、parent_id、type、status、progress、provider_task_id、request_snapshot、canvas_id、node_id、result、error、created_at、updated_at。查询返回解码的 result/error 和 children；外部 CLI 不直接访问数据库。

任务状态为 pending → running → succeeded/failed/cancelled。取消级联未结束子任务、通知执行器；不撤销已完成结果或远端费用。重启可恢复有 provider_task_id 的独立 generate.* 轮询，不能自动恢复任意画布节点执行。画布结果仅在 graphHash 仍匹配时写回，避免覆盖并发编辑。

TOS 当前读取整个素材、putObject 上传、按内容 hash 构造 key、返回签名 URL；remove 是空实现。URL 到期不等于对象已删除，当前没有实际 TTL 清理、上传缓存索引、分片或断点续传。

白模窗口限制页面导航和 IPC sender/frame，按顺序接收 PNG 帧；检查 image2、PNG 解码、libx264，编码为 H.264 MP4。结束/取消关闭窗口、移除处理器和帧目录，失败清理未完成输出。

## 验证入口

[audit.test.mjs](../../tests/audit.test.mjs)覆盖根任务、幂等、恢复和取消；[canvas-codemode.test.mjs](../../tests/canvas-codemode.test.mjs)覆盖 IPC 到任务；[white-model.test.mjs](../../tests/white-model.test.mjs)覆盖缓存/执行器/取消。真实 Electron + FFmpeg 白模脚本为 [white-model-smoke.cjs](../../tests/fixtures/white-model-smoke.cjs)，运行方法见[工程](engineering.md)。源码中的测试入口不是本轮通过记录。

## 已知边界偏差

画布节点远端恢复、下载/上传 AbortSignal、退出排空、可安全重试的有界退避待补；任务完成后的远端对象清理未实现。白模和 Provider 两种执行后端需要共用任务语义，不能将白模当作新的 Provider。后续事项见 [H-08](../issues.md#h-08) 和 [PLAN](../../PLAN.md)。
