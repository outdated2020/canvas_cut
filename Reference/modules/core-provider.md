# Provider 与素材传输适配

## 作用

唯一定义内部生成请求到外部服务字段/状态的转换，屏蔽供应商协议差异；声明素材传输接口并提供下载实现。

## 对应源码

[types.ts](../../packages/core/src/provider/types.ts)、[factory.ts](../../packages/core/src/provider/factory.ts)、[volcengine.ts](../../packages/core/src/provider/volcengine.ts)、[model-catalog.ts](../../packages/core/src/provider/model-catalog.ts)。生成请求和 GenerationProvider 类型载体为 [共享 types.ts](../../packages/core/src/types.ts)。

## 负责事项

- createProvider 根据项目配置和注入的 apiKeys/downloader/uploader 创建适配器，当前只支持 volcengine。
- VolcengineProvider 实现五种生成方法、远端 getJob/cancelJob、鉴权、请求超时、错误归一化。
- AssetDownloader/AssetUploader 传输契约，FileAssetDownloader 保存 URL/data URL 结果到本地并构造内容 hash 的 AssetRef。

## 不负责事项

不创建业务 job、不持有数据库、定义并发队列或决定图执行顺序；不存凭证。TosUploader SDK 和上传生命周期归[桌面任务](desktop-jobs.md)，这里只调用注入接口。

## 接口与依赖

GenerationProvider 为 id/capabilities、textToImage/textToVideo/imageToImage/imageToVideo/videoToVideo、getJob(jobId,type?)、cancelJob(jobId)。请求字段包含 prompt、negativePrompt、width/height、seed，按类型另有 image/video、durationMs/fps、strength/style/motionStrength、mode:edit/extend、extra；具体字段是否转换由当前适配器决定，声明可选字段不等于云端采用。

返回 GenerationJob 含 jobId/providerId/type/status/progress/result/error/extra/createdAt/updatedAt。图像通常同步获得结果并下载；视频先返回远端 ID 后轮询。queued→pending、running→running、succeeded→succeeded、cancelled→cancelled、failed/expired→failed。

Ark baseUrl 和模型来自项目 config，以 Bearer API Key 请求。当前使用 /images/generations 与 /contents/generations/tasks 的 POST/GET/DELETE；文生/图生图可读取 URL/base64 输出及图层数据。imageResolution/sizeMode 优先于显式尺寸，适配器有像素/比例判断；视频将 durationMs 转为整秒，宽高转换为比例/分辨率档位，edit/extend 使用 adaptive 和 omni_reference_task_type。具体映射函数以源码为准，实际媒体尺寸/时长可能不同；结构 Schema 不是模型能力发现。

五类生成请求均接受可选 model:string。VolcengineProvider 将非空 request.model（去首尾空白）写入单次 HTTP 请求，否则使用项目 imageModel/videoModel，不修改共享 Provider 配置。因此同一画布或同一 Provider 实例可以交替使用不同模型。节点解析与缓存隔离由[画布](core-canvas.md)负责；覆盖模型仍共用当前供应商、baseUrl 和凭证，不表示支持其他供应商或自动能力验证。

listGenerationModels(providerId,type) 提供浏览器可用的只读模型目录，按供应商和五类 GenerationType 筛选。目录依据 [方舟官方模型列表](https://docs.volcengine.com/docs/ark/model-list?lang=zh)，核对日期由 GENERATION_MODEL_CATALOG_CHECKED_AT 记录（2026-10-16）；当前列入未标注即将下线的 Seedream 5.0 Pro/Flash 与 Seedance 2.0 Mini、2.5、2.0、2.0 Fast。仅提供名称、ID 和生成方式，不承担账号开通、API Key 权限、余额或具体尺寸/时长验证；不限制手工输入其他模型/接入点 ID。没有联网刷新或账号模型枚举接口；账号开通查询需要额外 AK/SK 管控面接入，当前未实现。

参考视频需可访问 URL；本地素材通过注入 AssetUploader 转换。cancelJob 请求远端 DELETE，但不能保证运行中任务或费用撤销。fetchJson 用独立 AbortController，默认请求超时 300000ms，当前没有完整 Run 信号穿透或有界重试。

## 数据和副作用

HTTP 生成/查询/删除、URL/data URL 下载写文件；FileAssetDownloader 将结果全量读入内存后保存。API Key 从宿主注入，不写项目 config。签名 URL 是传输引用，生命周期归上传实现。没有自动声明云端模型价格/规格/URL 保留时限，需真实服务联调确认。

## 验证入口

[core.test.mjs](../../tests/core.test.mjs)包含 mock HTTP 图像下载，[agent-e2e.test.mjs](../../tests/agent-e2e.test.mjs)包含 fake Provider 闭环。本轮未调用付费服务或重新测试；图生图、文/图/视频生成、TOS、失败和取消需分别真实验收。

2026-10-16：模型覆盖的 [node-model.test.mjs](../../tests/node-model.test.mjs) 使用 mock fetch 检查五种生成方法的 HTTP model 字段和回退值，交替调用不会泄漏模型配置；相关 32 项回归通过，未验证各云端型号的真实能力或费用。

同日增加目录后，节点模型 6 项测试通过，包含供应商/生成方式过滤和目录外 ID 继续可用；桌面构建与五类节点下拉框隔离 UI 验证通过。没有联网探测账号模型权限。

## 已知边界偏差

高级多模态角色、额外生成字段、STS、上传复用/分片/清理、错误分类/退避与完整取消穿透仍需补齐；旧设计的通用多 Provider 和明确规格承诺不是当前能力。历史 Seedream/Seedance 型号是配置样例，不能代替官方能力或实际输出验证，见 [H-08](../issues.md#h-08)。
