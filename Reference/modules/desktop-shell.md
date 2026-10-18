# 桌面启动与设置

## 作用

Electron 应用的装配入口，负责窗口和应用级配置生命周期。它选择并注入服务，业务算法通过其他模块调用。

## 对应源码

[main.ts](../../apps/desktop/src/main/main.ts)。构建和启动配置归[工程支持](engineering.md)，IPC 传输归[桥接](desktop-bridge.md)。

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

应用 userData/runtime-settings.json 保存 ARK、TOS、Agent 和 FFmpeg 等运行设置。指定敏感字段使用 safeStorage 和 encrypted:v1 前缀；旧明文仅在加密可用时迁移，写入非空敏感字段时要求加密可用。项目 config.json 的非凭证字段归项目存储。Agent Runtime 配置的脱敏/合并契约归[Runtime](agent-runtime.md)，宿主提供实际存储。创建窗口、弹出系统对话框、写设置和退出应用都属于本模块副作用。

## 验证入口

[runtime.test.mjs](../../tests/runtime.test.mjs)包含配置校验/脱敏测试；桌面构建和真实启动用于检查装配。safeStorage、旧凭证迁移、双平台窗口与退出流程仍需实机验收；本轮未执行这些验证。

## 已知边界偏差

main.ts 还包含时间线事务和预设实例化，目标是调用统一领域入口，见 [H-03](../issues.md#h-03)。凭证迁移失败恢复与加密不可用交互尚待完善，见 [PLAN](../../PLAN.md)。
