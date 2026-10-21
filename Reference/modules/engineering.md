# 工程、启动、测试与内置工作流

## 作用

唯一维护仓库构建/启动配置、验证组织和内置 Skill 内容；不定义业务算法或 Skill 加载机制。

## 对应源码

根目录 [package.json](../../package.json)、[lockfile](../../package-lock.json)、[tsconfig.base.json](../../tsconfig.base.json)、[tsconfig.json](../../tsconfig.json)和各包 manifest/tsconfig；[Vite 配置](../../apps/desktop/vite.config.ts)、[scripts](../../scripts)、[tests](../../tests)、[Code Mode tests](../../packages/codemode/test)、[skills](../../skills)。

## 负责事项

- npm workspaces 和 TS references、CommonJS 包输出、Vite renderer 多页面打包；桌面构建还引用 CLI。
- Windows 正式/开发启动、日志与本次 Vite 进程管理、Electron 原生依赖重建。
- 按模块组织 Node test runner 行为/集成/原生 smoke 和真实媒体脚本。
- 维护 canvas-cut、image-to-video、storyboard-to-video 等内置 Skill 工作流正文，与实际 CLI 命令同步；加载/覆盖机制归[集成模块](agent-integrations.md)。

## 不负责事项

不定义模型/节点/剪辑行为，也不把脚本通过当作真实创作效果完成。历史修补脚本不是日常启动/修复入口；不因本轮文档整理去运行它们或清理用户资料。

## 接口与依赖

| 命令 | 作用/选择依据 |
| --- | --- |
| npm install | 安装 workspaces；桌面 postinstall 用 electron-rebuild 重建 better-sqlite3 |
| npm run typecheck | tsc -b 检查 project references，可写构建产物/缓存 |
| npm run build | 构建全部有 build 的 workspace；不生成安装包 |
| npm run build:core / build:cli / build:agent / build:desktop | 分包构建；desktop 为 tsc -b + vite build |
| npm test | 强制编译 core/cli/agent/desktop（含引用依赖），运行 tests/*.test.mjs 与 codemode/test，单测试 timeout 30s |
| npm run test:codemode | 构建并运行 Code Mode 独立行为测试 |
| npm run start:desktop -- -SkipBuild | 已构建的正式应用；省略 SkipBuild 先构建 |
| npm run dev:desktop:app -- -SkipBuild | 启动完整开发桌面；可传 -Port，默认自动分配可用端口 |
| npm run dev:desktop | 仅 Vite 页面开发服务，不是完整 Electron/Daemon |
| npm run dev:cli | tsx 运行 CLI 源码 |

TS 目标 ES2022、strict/noUncheckedIndexedAccess/noImplicitOverride，声明/源码映射和增量构建；Vite 输出 dist/renderer，app 与 whiteModel 页面为当前生产入口。白模与 Provider 模型目录的 browser-safe 深层入口通过 Vite 别名解析到 TS 源码，避免 CommonJS 主入口引入 Node I/O；这是已有 workaround 的延伸，见 [H-05](../issues.md#h-05)。

Agent 依赖 @ai-sdk/deepseek ^3.0.67 以保留思考字段。2026-10-17 的 lockfile 在现有 manifest 范围内将 ai/OpenAI 适配器补丁对齐至 7.0.143/4.0.96，与 DeepSeek 3.0.67 共用 provider 4.0.29、provider-utils 5.0.62；避免新旧 provider JSON 类型不兼容。依赖安装跳过原生 rebuild 脚本，不改变 SQLite/PTY ABI。

维护启动入口为 start-desktop.ps1/cmd 与 dev-desktop.ps1。开发脚本打印实际 Vite URL 并传给 Electron，每次使用独立日志，关闭应用后清理本次 Vite 进程；固定 -Port 遇到 EACCES（权限/系统保留端口）或 EADDRINUSE（占用）时，去掉 -Port 使用默认可用端口重试。

scripts/test-generate.mjs、test-video.mjs 是可调用真实生成服务的手动联调脚本，不纳入纯文档验收。scripts/patch-*.mjs、fix-*.mjs 属一次性历史修补，保留但不要当作自动迁移工具。

## 数据和副作用

构建产生各包 dist、*.tsbuildinfo，开发脚本产生 logs/并启动 Electron/Vite；测试可生成临时项目、模拟服务与原生进程。demo-project/agent-smoke 是已有项目材料；评审目录、截图、设计 HTML、tmp/out 和历史脚本保留原位，不能认定可全部删除。

仓库根目录的 `.workbuddy/` 和 `demo-project/` 由 [.gitignore](../../.gitignore) 排除，不跟踪本机辅助状态、项目数据、生成媒体和任务数据库；取消跟踪只移除 Git 索引记录，本地文件保留。README 示例媒体单独维护在 `docs/examples/`。

## 验证入口

模型 API 配置迁移：桌面构建后运行 `node --test tests/model-api-transfer.test.mjs` 和 `electron tests/fixtures/model-api-transfer-smoke.cjs out/model-api-transfer-ui`；协议与字段规则见[桌面设置](desktop-shell.md)，UI 验证边界见[桌面 UI](desktop-ui.md)。测试只使用隔离临时目录和虚拟凭证，不读取用户配置或访问模型服务。

业务验证按变更选取：画布/存储/Provider 用 core/canvas/white-model，队列/导出用 audit，CLI/MCP 用 cli/mcp/canvas-codemode，Agent 用 agent/runtime/conversations/runtime-mcp/runtime-native，UI 状态用 canvas-sync/context-usage。名称指 tests 中对应文件；独立 Code Mode 测试在 packages/codemode/test。

DeepSeek 思考回传回归入口为 [deepseek.test.mjs](../../tests/deepseek.test.mjs)，编译 agent 后运行 `node --test tests/deepseek.test.mjs tests/runtime.test.mjs tests/agent.test.mjs tests/conversations.test.mjs tests/context-usage.test.mjs`；严格模拟 API，不需要模型凭证，不访问真实生成服务。具体协议与持久化验证见[Runtime](agent-runtime.md)。

白模真实验收需完整 FFmpeg 和 Electron，输出仅写隔离测试目录：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
& ./apps/desktop/node_modules/electron/dist/electron.exe ./tests/fixtures/white-model-smoke.cjs ./out/white-model-smoke "C:/tools/ffmpeg/bin/ffmpeg.exe"
```

FFmpeg 路径为示例，必须选实际安装且含 image2/PNG/libx264 的版本；UI 脚本为 [white-model-ui-smoke.cjs](../../tests/fixtures/white-model-ui-smoke.cjs)，参数以 fixture 源码为准。真实生成/上传、字幕与音轨、取消、预览/导出一致性、双平台原生行为和安装包均要独立验收。

右键添加节点交互使用隔离的内存桥接测试，不访问用户项目或生成服务；先构建 desktop，再运行 `electron tests/fixtures/canvas-context-menu-smoke.cjs out/canvas-context-menu-smoke`。覆盖范围和脚本链接见 [桌面 UI](desktop-ui.md#验证入口)。

吸附/分组验证：编译 desktop 后运行 `node --test tests/canvas-layout.test.mjs tests/canvas-sync.test.mjs`；构建桌面页面后运行 `electron tests/fixtures/canvas-layout-smoke.cjs out/canvas-layout-smoke`。交互脚本使用隔离内存画布与 localStorage，Windows 隐藏窗口启用离屏渲染，确保动画帧/尺寸测量继续运行；不会调用生成服务。覆盖范围见 [桌面 UI](desktop-ui.md#验证入口)。

节点模型验证：编译 core/cli/desktop 后运行 `node --test tests/node-model.test.mjs`，覆盖模型目录供应商/生成能力过滤、自定义 ID 不受目录限制、五类请求和 HTTP body、默认回退、缓存隔离、共享编辑接口及模拟 Worker 混合模型执行。构建页面后运行 `electron tests/fixtures/node-model-ui-smoke.cjs out/node-model-ui-smoke`，其 [内存桥接](../../tests/fixtures/node-model-ui-preload.cjs) 不访问用户项目/凭证或生成服务，检查五类节点的目录选项隔离、选择保存/重开、自定义输入及旧 ID 保留、底部模型展示和恢复默认。

画布命名验证：canvas-operations/cli/canvas-codemode/canvas-sync 覆盖名称持久化、并发/缓存保持、离线 CLI 与在线 CLI/MCP。页面构建后运行 `electron tests/fixtures/canvas-name-smoke.cjs out/canvas-name-ui`；[测试桥接](../../tests/fixtures/canvas-name-preload.cjs)只访问输出目录中的隔离项目，验证列表/工具栏编辑、中文、取消、非法名称、失败重试、通知和重载持久化，不访问用户项目或生成服务。Vite 会清空 dist/renderer，若随后运行引用 renderer 模块的 Node 测试，需要先强制 TS 编译补齐产物。

文档验收：检查模块八栏目、索引源码覆盖/唯一归属、Markdown 本地链接、迁移表、旧引用及 git diff --check；比对非文档文件未被本轮修改。历史结果保留在 [PLAN](../../PLAN.md)并标日期，本轮只记录实际执行的文档检查。

## 已知边界偏差

独立 CLI 可执行分发、Electron 安装包、FFmpeg 随包、签名/自动更新/诊断包/CI 和 macOS 原生验收仍待建设。node-pty 1.1.0 和 SQLite 的原生兼容不要靠纯 TS 检查判断。根目录重复依赖/Zod 版本声明尚未统一，各包范围独立维护，精确安装版本以 lockfile 为准。
