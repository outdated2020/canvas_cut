# 架构与边界问题记录

分析日期：2026-10-11；证据为当前工作区源码，包含未提交改动。本轮仅做文档治理，没有重跑业务测试、复现运行故障或修改业务代码。下列“已确认”指静态结构/实现事实，影响和整改是分析建议。目标边界不是当前代码已经满足的声明。

## H-01

**架构文档与实现漂移。状态：本轮已纠正文档；后续持续维护。**

- 证据：旧总览/技术/目录/流程设计描述 Mastra、Agent→core 依赖、WebGL 时间线/代理、UI spawn CLI 和尚未实现状态；[包声明](../packages/agent/package.json)、[模型循环](../packages/agent/src/runtime.ts)、[时间线 UI](../apps/desktop/src/renderer/TimelinePreview.tsx)、[主进程](../apps/desktop/src/main/main.ts)采用不同实现。
- 影响：Agent 或维护者会选错入口、依赖和完成边界；设计阶段“解决”被误读为实机验收。
- 归属与整改：AGENTS/索引做入口，各模块是详细规则的唯一来源；旧设计合并重写，未实现条款标注待办，保留必要背景。
- 验证：本轮检查新文档、迁移覆盖和链接；不以历史测试记录宣称当前代码已验收。

## H-02

**画布编辑事务存在两个入口。状态：待代码整改。**

- 证据：[CLI 画布命令](../apps/cli/src/commands/canvas.ts)直接调用 addNode/setNodeParams 和 store.writeCanvas；[CanvasOperations](../packages/core/src/canvas/operations.ts)额外做输入/参数 Schema、白模限制和提交后通知；桌面与 MCP 走后者。
- 影响：相同意图可能经历不同校验，传统 CLI 编辑缺少同一变更通知链；不在本轮宣称已复现全部异常。
- 归属与整改：图/参数/读改写事务唯一归[画布领域](modules/core-canvas.md)，CLI 只适配命令和返回。把传统命令接入统一服务，保留现有命令返回兼容和离线短命令能力，通知可由宿主注入。
- 验证建议：同组有效/无效参数分别从 CLI、UI、MCP 操作，比较图版本、缓存失效、错误及刷新；本轮仅静态核对。

## H-03

**时间线及预设的应用层编排重复。状态：待代码整改。**

- 证据：[CLI 时间线](../apps/cli/src/commands/timeline.ts)、[预设命令](../apps/cli/src/commands/preset.ts)和[主进程 handler](../apps/desktop/src/main/main.ts)分别组织项目锁、读取、编辑/实例化、保存和返回；底层函数已经共享。
- 影响：新增剪辑、刷新引用或预设规则要改多个入口，锁范围和错误可能漂移；正常调用共享算法不是职责重叠，重复事务编排才是。
- 归属与整改：时间线编辑事务归[时间线领域](modules/core-timeline.md)，预设实例化归[画布](modules/core-canvas.md)，文件保存归[存储](modules/core-storage.md)；引入统一操作入口并保持 UI/CLI 协议兼容，应用层仅适配。
- 验证建议：对分割/裁剪/速度/画布刷新/预设应用做入口一致性与并发检查。本轮没有新增或运行测试。

## H-04

**IPC 接口缺少完整共享类型。状态：待代码整改。**

- 证据：[preload](../apps/desktop/src/preload/preload.ts)以 string/Record 接收通道/负载；[App](../apps/desktop/src/renderer/App.tsx)声明通用 invoke 并大量使用 AnyRecord，[CanvasGraphView](../apps/desktop/src/renderer/CanvasGraphView.tsx)也使用 any。
- 影响：通道/输入/返回变更难被 TS 完整检测；白名单与部分 Schema 仍有效，不能据此断言已有安全漏洞。
- 归属与整改：[桥接](modules/desktop-bridge.md)维护共享通道→输入/输出/事件契约，适配调用方使用它；领域 Schema 仍归所属模块，不能再复制一套业务规则。
- 验证建议：TS 验证错误通道/payload/返回类型，并保留运行时未知方法/参数和事件过滤测试。当前仅确认类型约束不足。

## H-05

**浏览器入口依赖 core 构建内部路径。状态：待代码整改。**

- 证据：[WhiteModelParams](../apps/desktop/src/renderer/WhiteModelParams.tsx)等引用 @canvas-cut/core/dist/canvas/white-model；[Vite](../apps/desktop/vite.config.ts)把该路径别名到源码，core 默认 CommonJS 主入口包含 Node 模块。
- 影响：dist 内部结构/构建变化可破坏 UI；框架无关不能自动证明包主入口 browser-safe。
- 归属与整改：[core 公共契约](modules/core-foundation.md)维护显式浏览器安全导出，[画布](modules/core-canvas.md)仍拥有参数语义；UI/构建消费稳定入口，移除内部路径依赖前保持现有行为。
- 验证建议：检查新导出无 Node 内置依赖，验证生产/开发白模页面和 Node/Electron 调用。本轮未调整导出或构建。

## H-06

**ProjectStore 混合存储与跨域逻辑。状态：待代码整改。**

- 证据：[ProjectStore](../packages/core/src/project/project-store.ts)的 readTimeline 在缺失文件时初始化，并派生 stale/failed；removeCanvas 检查画布/时间线引用；importAsset 调用 probeMedia。
- 影响：不能将所有读方法当作无副作用查询或把该模块描述为纯存储；引用/状态策略与其他领域入口耦合。
- 归属与整改：[存储](modules/core-storage.md)保留 I/O、资产复制/锁；图引用保护与时间线状态判定由统一领域服务组织，媒体探测由[媒体](modules/core-media.md)实现。显式区分初始化与查询，迁移时保护兼容。
- 验证建议：覆盖缺失文件、读副作用、并发写、引用保护与素材探测策略，确认迁移不改变数据。当前仅记录混合职责，未证明独立故障。

## H-07

**App.tsx 多领域 UI 协调集中。状态：待代码整改。**

- 证据：[App.tsx](../apps/desktop/src/renderer/App.tsx)集中项目、素材、画布、任务、时间线、设置与对话状态/事件，已有子组件和 hooks 但仍承担多个视图协调。
- 影响：项目/视图切换与异步刷新易耦合，后续新增能力会扩大回归范围；文件行数本身不作为缺陷证明。
- 归属与整改：[UI](modules/desktop-ui.md)内部按项目/画布/时间线/任务/设置/对话拆协调 hooks 和组件，App 保留装配；避免把领域规则搬到 hooks。
- 验证建议：项目/画布/会话切换、旧请求返回、草稿/选择保留、后台任务与停止目标隔离。已有相关测试入口不等于本轮通过。

## H-08

**旧设计中尚未兑现的能力需要明确标识。状态：能力待办，未在本轮修复。**

| 事实/缺口 | 当前证据与唯一归属 | 后续要求 |
| --- | --- | --- |
| TOS remove 空实现，签名过期不删除对象 | [uploader](../apps/desktop/src/main/uploader.ts)，[桌面任务](modules/desktop-jobs.md) | 显式对象清理/保留策略、上传取消/分片/复用与真实验收；不能宣称已自动 TTL 清理。 |
| crossfade 只处理片段自身 fade | [FFmpeg](../packages/core/src/ffmpeg/ffmpeg.ts)，[媒体](modules/core-media.md) | 双片段 xfade/acrossfade 及预览/导出实测。 |
| 有 segments，但当前单 filter_complex 编码 | [计划](../packages/core/src/timeline/render-plan.ts)和 FFmpeg | 段落渲染/concat/缓存、ASS/软字幕属于后续媒体建设。 |
| 通用 state 方法、大 payload 引用、job:update 推送无完整实现 | [IPC server](../apps/desktop/src/main/ipc-server.ts)，[桥接](modules/desktop-bridge.md) | 保留为旧设计方向；只描述现行方法/轮询。 |
| 预设输入槽位存在类型但应用未绑定，项目版本迁移未完整实现 | [预设命令](../apps/cli/src/commands/preset.ts)、ProjectStore | 槽位实例化归画布，迁移/全局预设/重定位归存储。 |
| 画布节点远端续跑、全局 Agent 预算/审批/恢复待补 | [Worker](../apps/desktop/src/main/job-worker.ts)、[Runtime](../packages/agent/src/runtime.ts) | 分别处理业务 job 恢复与 Agent Run 恢复，避免概念混用。 |

这组内容来自旧设计/现有计划和静态源码核对，未另做真实故障复现。优先级与执行顺序继续由 [PLAN](../PLAN.md)管理；本文件记录事实和责任，不形成另一份完成状态清单。

## H-09

**项目锁的过期与释放条件不足以保护长事务所有权。状态：本轮新增静态发现，待代码整改。**

- 证据：[lock.ts](../packages/core/src/fs/lock.ts)的 tryRemoveStale 在 stale 或 dead 时删除锁，默认 staleMs=60000 且没有续租；release 在 token 匹配或 pid 等于当前进程时删除锁。
- 影响推断：持锁进程仍存活但操作超过阈值时，其他调用可能移除其锁；同 PID 的旧持有者也可能删除已更换 token 的锁。原子写本身不能防止这种读改写事务交错；本轮没有运行并发故障复现。
- 归属与整改：[项目存储](modules/core-storage.md)唯一维护锁协议，明确存活进程过期策略/续租，并以锁实例 token 校验释放；调用方不各自增加一套互斥实现。
- 验证建议：长事务超过阈值、同 PID 多个锁实例、旧持有者释放新锁、死进程锁恢复和跨进程读改写测试；本轮仅记录，不修改锁实现。
