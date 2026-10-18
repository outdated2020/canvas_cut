# 桌面 UI 与预览

## 作用

呈现项目、画布、时间线、素材、任务和对话，维护交互状态并适配服务返回；负责 HTML 媒体预览和本地 three.js 场景绘制。

## 对应源码

[renderer 目录](../../apps/desktop/src/renderer)、[index.html](../../apps/desktop/index.html)、[node-preview.html](../../apps/desktop/node-preview.html)、[white-model.html](../../apps/desktop/white-model.html)。App.tsx 是当前协调入口；CanvasGraphView/NodeParamsInline/WhiteModelParams 管理节点界面，TimelineView 管理时间线交互，Player/TimelinePreview/usePlayer/timelinePlayback 管理播放；其余会话组件、hooks、样式和图标均归本模块。

## 负责事项

- 画布优先的暗色创作界面、左侧 Agent/素材/画布/任务区域、播放器/属性交互和时间线；具体 CSS/布局以当前代码为准。
- React Flow 节点/端口/连线展示、节点参数草稿、位置和选择；UI 可做即时提示，最终校验仍由领域接口负责。
- CanvasName 在画布列表和打开后的工具栏显示已保存名称，旧画布回退 Canvas 序号。双击名称、点击铅笔或聚焦名称后按 Enter/F2 进入编辑，Enter/勾选保存、Escape/取消放弃；中文输入法组词时 Enter 不提交。失败保留草稿并显示重试提示。保存调用 canvas.rename，不在 renderer 写文件或定义名称规范化；外部变更通过既有通知刷新，改名不重置节点布局。列表打开按钮与名称编辑器为独立的同级元素，编辑名称不会打开画布。窄画布的工具栏按完整控件换行，按钮文字保持单行。
- 五类云端生成节点由 NodeModelSelect 提供模型下拉框，使用 [Provider 模型目录](core-provider.md)按供应商/生成方式筛选，支持「使用项目默认」、目录型号和「自定义模型 ID / 接入点 ID」。选择目录项保存其 ID，自定义输入保留原有未收录型号；输入过程中不会因恰好匹配目录项而关闭输入框。默认项可显示已知型号名称，卡片底部继续显示实际模型 ID；留空继承项目默认，保存仍走既有节点参数接口。目录为固定快照，界面说明实际可用取决于账号开通情况。本地白模无需模型设置，模型请求/缓存优先级由 core 定义。
- canvas-layout.ts 负责界面布局计算：拖动单节点接近同类型节点时，预览高亮并在松开后按上下/左右吸附，间隔 24 场景单位，容差 32 屏幕像素按缩放换算，使用实际节点尺寸并避开重叠。吸附可关闭，只在同一分组内部或未分组节点之间发生；多选/整组移动不吸附。
- 吸附命中期间展示淡蓝色虚线引导线和预期落点轮廓：横向排列显示共同顶边，等高时补底边；纵向排列显示共同左边，等宽时补右边。引导线几何由 canvas-layout 的 buildSnapPreview 计算，SnapGuides 使用 React Flow useViewport 同步缩放/平移，线宽保持屏幕 1px，覆盖层不截获鼠标。离开候选点、松开鼠标或关闭吸附立即隐藏。
- 布局控件采用紧凑的中性色界面：默认只显示 34px 磁铁图标按钮，通过 aria-pressed、状态点和悬停标题表达吸附状态。多选或选中组内节点时才显示选中数量和可执行的打组/解组按钮，不常驻禁用操作或多选说明；吸附落点提示仅在拖动命中时显示于画布底部。
- Shift/Ctrl 多选或空白拖动框选后可打组（工具按钮、右键或 Ctrl+G），支持混合类型、名称编辑、拖动组标题整体移动和成员单独调整。解组使用按钮或 Ctrl+Shift+G；删除分组框仅解散组。分组是 renderer 合成的展示节点，不进入业务图或生成缓存，也不改变连线。
- 画布空白处右键打开添加节点菜单，菜单和工具栏复用 nodeLabels 中的全部节点选项（含素材输入、画布引用和白模）；创建仍调用既有 canvas.node.add。使用 React Flow 的 screenToFlowPosition 换算缩放/平移后的落点，创建返回节点 ID 后定位并选中，兼容变更通知先于创建返回；位置沿用 UI 会话内保存策略。菜单支持方向键/Home/End、Escape、外部点击和视口移动关闭，边缘避让以及失败提示/重试。
- 切换项目/画布、刷新项目数据、轮询任务与 Agent 增量事件，处理错误与进度展示。
- canvas-sync 合并变更通知、按项目过滤，以请求版本防止旧响应覆盖新视图，保留存续节点位置/选择；外部新建画布不自动打开。
- 多会话列表、创建/切换/管理、流式文本、工具活动和用量展示；草稿按会话存在内存，所选会话本地记忆。
- WhiteModelScene 的几何体、灯光、相机和逐帧线性插值；white-model-export 页面按桥接协议回传 PNG。

## 不负责事项

不读写项目文件/SQLite/凭证、不直接启动系统进程、不调用生成服务。画布参数/缓存规则归[画布](core-canvas.md)，剪辑规则归[时间线](core-timeline.md)，会话生命周期归[Runtime](agent-runtime.md)。UI 白模预览不承担最终 MP4 输出生命周期。

## 接口与依赖

依赖 React、React Flow、three.js、React Markdown/GFM，调用[preload](desktop-bridge.md)的 invoke/onCanvasChanged。跨进程输入做 UI 适配，不复制服务契约。当前 white-model 参数共享入口来自 core 深层 dist 导入，构建别名见[工程](engineering.md)。

预览有素材模式和时间线模式：素材读取 AssetRef 路径，时间线根据播放头组合活动图像/视频/音频/字幕，并应用基础变换、裁剪、变速与音量。后端是 HTML video/audio/img + DOM/CSS，不是时间线 WebGL 合成或低清代理。three.js WebGL 仅负责白模场景。

## 数据和副作用

保存组件状态、节点位置/选择和草稿，调用服务产生业务副作用；播放/暂停/seek 更新媒体元素。节点绝对位置、分组 ID/名称/成员以版本 1 的展示数据写入浏览器 localStorage，键按项目绝对路径和画布 ID 隔离；不保存素材、凭证或执行状态。恢复会过滤失效成员，损坏存储回退默认布局；存储不可用时仅维护当前会话。刷新保留测量尺寸、位置和选择，离开视图/卸载页面时保存最后布局。布局未写入项目 JSON，换设备或清除应用本地存储不会携带。会话切换不会停止后台 Run，停止按钮针对当前会话。时间线 stale/fresh 等状态来自服务结果；不要在 UI 定义另一套数据版本协议。

## 验证入口

[canvas-sync.test.mjs](../../tests/canvas-sync.test.mjs)、[conversations.test.mjs](../../tests/conversations.test.mjs)、[context-usage.test.mjs](../../tests/context-usage.test.mjs)、[audit.test.mjs](../../tests/audit.test.mjs)覆盖刷新与部分播放/会话行为。白模 UI 脚本为 [white-model-ui-smoke.cjs](../../tests/fixtures/white-model-ui-smoke.cjs)。右键菜单隔离 Electron 验证脚本为 [canvas-context-menu-smoke.cjs](../../tests/fixtures/canvas-context-menu-smoke.cjs)，使用 [内存 preload](../../tests/fixtures/canvas-context-menu-preload.cjs)，检查全部 11 类节点、默认参数、缩放/平移落点与通知竞态、菜单关闭、边缘避让和失败重试；构建后用 Electron 运行并传入隔离输出目录。该脚本不调用 Provider，也不写用户项目；完整交互和预览/导出一致性仍须独立验收。

2026-10-13：desktop 构建通过；右键菜单隔离 Electron 脚本通过，包含真实鼠标右键、空画布首次添加保持点击落点和画布切换关闭菜单；既有白模 UI 回归与 canvas-sync 的 4 项测试通过。位置仍只在当前视图会话中维护，未新增位置持久化协议。

布局计算测试为 [canvas-layout.test.mjs](../../tests/canvas-layout.test.mjs)，覆盖类型/分组隔离、缩放容差、四方向间距与避碰、包围框、失效成员和损坏存储；[canvas-layout-smoke.cjs](../../tests/fixtures/canvas-layout-smoke.cjs) 使用 [内存桥接](../../tests/fixtures/canvas-layout-preload.cjs) 在隔离 Electron 离屏窗口验证实际鼠标吸附、多选打组、改名、整组/成员移动、刷新与重载恢复，以及解组/删除组框不改变业务图和连线。

2026-10-14：desktop 构建与强制 TS 编译通过，布局/canvas-sync 共 8 项测试通过；隔离 Electron 布局与右键菜单交互脚本通过，含混合类型分组、组框删除保留业务图。上述验证只覆盖 UI 排布，不证明新的模型生成质量。

2026-10-15：精简布局工具条后 desktop 构建与隔离布局交互脚本通过；验证默认仅保留吸附图标、开关状态可切换、多选显示数量与打组、选中组只显示可执行操作，并检查默认/多选截图。吸附、整组移动和本地布局恢复行为保留。

同日加入引导线后：desktop 构建与强制 TS 编译通过，布局/canvas-sync 共 9 项测试通过；隔离 Electron 验证引导线在缩放/平移视口内对齐目标边缘、不拦截拖拽，以及离开候选和松开隐藏，原分组回归仍通过，并检查拖拽截图。

2026-10-16：节点模型面板由 [node-model-ui-smoke.cjs](../../tests/fixtures/node-model-ui-smoke.cjs) 和 [隔离 preload](../../tests/fixtures/node-model-ui-preload.cjs) 验证，五类云端节点均通过模型覆盖保存、卡片名称更新和恢复默认；desktop 构建/强制 TS 编译与相关 32 项模拟业务测试通过。未配置用户项目模型或提交真实生成。

同日改为模型下拉框后：desktop 构建和 6 项节点模型测试通过；隔离 Electron 验证五类节点的目录筛选、保存/重开、已有自定义 ID 保留、自定义输入不跳出及恢复默认，检查节点截图。目录未查询用户账号权限，也未提交真实生成。

画布命名隔离脚本为 [canvas-name-smoke.cjs](../../tests/fixtures/canvas-name-smoke.cjs)，通过 [测试桥接](../../tests/fixtures/canvas-name-preload.cjs) 调用真实 CanvasOperations/ProjectStore，但将所有项目 I/O 定位到 out 下独立目录。2026-10-17：列表/工具栏改名、中文、取消、非法名称、失败草稿重试、外部通知和页面重载后持久化验证通过；不访问用户项目或生成服务。

## 已知边界偏差

[H-07](../issues.md#h-07)：App.tsx 多域协调集中；[H-04](../issues.md#h-04)：any 和弱类型 IPC；[H-05](../issues.md#h-05)：浏览器入口依赖构建内部路径。待补能力包括 Undo/Redo、媒体缩略图/真实波形/代理、附件链路、占位菜单、批量编辑及跨类型辅助对齐线；当前分组布局仅属于本设备 UI，不是可移植的项目/CLI/MCP 分组协议。历史快捷键、固定尺寸和模板行为不作为当前功能承诺。HTML volume 上限等差异需要与 FFmpeg 实测对照，具体待办保留于 [PLAN](../../PLAN.md)。
