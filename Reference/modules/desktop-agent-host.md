# Canvas Cut Agent 宿主

## 作用

将通用 Agent Runtime 接到桌面产品，唯一负责 Canvas Cut 应用提示、模型配置和 CLI/项目/技能目录注入。

## 对应源码

[agent-service.ts](../../apps/desktop/src/main/agent-service.ts)。main.ts 装配、Runtime 设置的保存归[启动与设置](desktop-shell.md)；Agent 服务请求传输归[桥接](desktop-bridge.md)。

## 负责事项

- createAgentService 检查 CLI 构建入口，为 Agent 创建固定运行时 launcher。
- configure 从桌面设置注入 apiKey/baseUrl/model 和 RuntimeConfig；验证项目含 project.json。
- createHost 注入 cwd/logDir/journalDir、Shell 路径及 launcher 的 PATH；skillDirectories 提供内置、用户、项目目录。
- applicationPrompt 指导发现 CLI、加载工作流、查询异步业务任务终态；不将业务提示嵌入通用 agent 包。

## 不负责事项

不实现模型循环、会话持久化、Skill YAML 解析或工具执行，也不定义画布/时间线规则和任务取消。不要按 CLI manifest 自动生成一组业务模型工具；当前模型使用通用工具调用 CLI。

## 接口与依赖

createAgentService({userDataDir, appRoot, executable, settings}) 返回 AgentSessionService。依赖 Node 和 @canvas-cut/agent；使用 appRoot 相邻 apps/cli/dist/index.js，Windows launcher 是 cmd，其他平台是 sh，以 Electron 可执行程序配合 ELECTRON_RUN_AS_NODE=1 执行 CLI。

技能目录按内置 → ~/.canvas-cut/skills → 项目 skills 顺序注入；优先级和加载规则只由[集成模块](agent-integrations.md)定义。模型/会话配置契约只由[Runtime](agent-runtime.md)定义。

## 数据和副作用

在 userData/agent/bin 写 launcher，sessions/patches/logs 路径分别注入所属服务；运行调用可以启动 CLI，CLI 的业务副作用归对应服务。Shell 环境清理归[工具执行](agent-tools.md)。该宿主是可信本地模式，cwd 不是目录隔离。

## 验证入口

[agent.test.mjs](../../tests/agent.test.mjs)包含安装 CLI 与 Skill 调用；[agent-e2e.test.mjs](../../tests/agent-e2e.test.mjs)覆盖 Agent Shell → CLI → IPC → fake Provider → 时间线的链路。本轮未运行；真实付费模型的规划质量不能由 mock 验证替代。

## 已知边界偏差

依赖相邻 CLI dist 和运行时路径，独立分发需重新验收。SandboxAgentHost、附件、Web Search、多 Agent 和审批/暂停接口仍属[后续计划](../../PLAN.md)，不是当前宿主承诺。
