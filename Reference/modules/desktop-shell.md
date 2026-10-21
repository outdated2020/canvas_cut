# 桌面启动与设置

## 作用

Electron 应用的装配入口，负责窗口和应用级配置生命周期。它选择并注入服务，业务算法通过其他模块调用。

## 对应源码

[main.ts](../../apps/desktop/src/main/main.ts)、[model-api-transfer.ts](../../apps/desktop/src/main/model-api-transfer.ts)（可迁移配置格式与文件导入导出）。构建和启动配置归[工程支持](engineering.md)，IPC 传输归[桥接](desktop-bridge.md)。

## 负责事项

- 获取单实例锁、处理第二实例聚焦、创建主窗口、activate/window-all-closed/before-quit 生命周期。
- 配置 contextIsolation、nodeIntegration、preload 和开发/生产页面地址。
- 装配 DaemonService、LocalIpcServer、AgentSessionService，注入凭证、截图及白模执行器。
- 保存运行时设置，处理项目打开/选择、系统文件对话框、导出路径与设置交互。

## 不负责事项

不定义图、时间线、缓存或 Provider 规则；不定义任务状态机、Agent 模型循环或 React 状态。主进程处理函数中的参数/返回形态兼容属于适配，不是新的业务规则来源。

## 接口与依赖

依赖 Electron、Node 文件/路径能力、core 和 agent。通过注册的 canvas-cut:invoke handler 将 UI 请求路由到[画布](core-canvas.md)、[任务](desktop-jobs.md)、[存储](core-storage.md)和[Runtime](agent-runtime.md)。关闭时等待 Agent shutdown、停止 IPC、调用 Daemon shutdown；Worker 排空能力的不足见[任务偏差](desktop-jobs.md)。

画布创建/重命名的 name 不由装配层丢弃或处理，随参数传入共享 CanvasOperations；重命名返回结构与通知协议见[桥接](desktop-bridge.md)，名称规则见[画布](core-canvas.md)。

## 数据和副作用

`settings.export-model-api` 接收当前表单 settings 和显式布尔 includeSecrets，通过保存对话框写 JSON；`settings.import-model-api` 通过打开对话框返回 `{cancelled,settings?}`，只填草稿，不持久化或修改环境变量。两者取消均返回 cancelled:true。格式为 `{format:"canvas-cut-model-api",version:1,settings:{...}}`；白名单为 ARK 地址/图片模型/视频模型/API Key，Agent 地址/模型/API Key，以及 TOS ID/Secret/bucket/region/endpoint。默认导出剔除全部四个凭证字段；显式包含时导出明文，导入保存复用 settings.set-runtime 和本机 safeStorage。FFmpeg、Agent Runtime/Langfuse/MCP、项目内容不在格式内。导入拒绝错误格式/版本、未知字段、非字符串、超过 8192 字符的值、本机 encrypted:v1 数据和超过 256 KB 文件，错误不包含字段值。不重定义 Provider 模型规则，端点等保存校验仍归原有保存入口。

应用 userData/runtime-settings.json 保存 ARK、TOS、Agent 和 FFmpeg 等运行设置。指定敏感字段使用 safeStorage 和 encrypted:v1 前缀；旧明文仅在加密可用时迁移，写入非空敏感字段时要求加密可用。项目 config.json 的非凭证字段归项目存储。Agent Runtime 配置的脱敏/合并契约归[Runtime](agent-runtime.md)，宿主提供实际存储。创建窗口、弹出系统对话框、写设置和退出应用都属于本模块副作用。

## 验证入口

[model-api-transfer.test.mjs](../../tests/model-api-transfer.test.mjs)验证凭证可选、字段隔离、跨设备可读往返、缺省字段保留、非法输入、取消和文件 I/O；桌面构建后运行 `node --test tests/model-api-transfer.test.mjs`。隔离 UI 验证见[桌面 UI](desktop-ui.md)。

[runtime.test.mjs](../../tests/runtime.test.mjs)包含配置校验/脱敏测试；桌面构建和真实启动用于检查装配。safeStorage、旧凭证迁移、双平台窗口与退出流程仍需实机验收；本轮未执行这些验证。

## 已知边界偏差

main.ts 还包含时间线事务和预设实例化，目标是调用统一领域入口，见 [H-03](../issues.md#h-03)。凭证迁移失败恢复与加密不可用交互尚待完善，见 [PLAN](../../PLAN.md)。
