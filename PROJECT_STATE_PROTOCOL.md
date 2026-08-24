# 项目状态文件协议（PROJECT STATE PROTOCOL）

> 状态：设计阶段，尚未实现
> 更新日期：2026-08-15

## 1. 总体原则

- 项目结构类数据使用 JSON 文件，便于阅读、diff、导入导出
- JSON 写入采用原子写 + 文件锁
- 任务状态使用 SQLite，启用 WAL
- API Key / TOS AK/SK 不写入项目文件，保存在系统 Keychain

## 2. 项目目录结构

```text
<project>/
  project.json
  config.json
  .lock
  canvases/
    <canvasId>.json
  presets/
  timeline/
    timeline.json
  assets/
  cache/
  jobs.sqlite
```

## 3. JSON Schema

### 3.1 project.json

```ts
{
  schemaVersion: 1,
  id: string,
  name: string,
  createdAt: number,
  updatedAt: number,
  settings: {
    width: number,
    height: number,
    fps: number,
    previewResolution: string
  }
}
```

### 3.2 config.json

```ts
{
  schemaVersion: 1,
  provider: {
    default: 'volcengine',
    volcengine: {
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      imageModel: 'doubao-seedream-5-0-pro-260628',
      videoModel: 'doubao-seedance-2-5-260628'
    }
  },
  tos: {
    endpoint: 'https://tos-cn-beijing.volces.com',
    region: 'cn-beijing',
    bucket: '',
    urlTtlSeconds: 7200
  },
  concurrency: {
    maxGenerationJobs: 3
  }
}
```

TOS 的 AK/SK 不写入 `config.json`，与 API Key 一样保存在系统 Keychain；`bucket / region / endpoint` 由用户提供。参考文档：https://docs.volcengine.com/docs/6349/74837?lang=zh

### 3.3 canvases/<canvasId>.json

```ts
{
  schemaVersion: 1,
  id: string,
  version: number,
  graphHash: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
}
```

画布图结构、节点注册表、端口校验、graphHash 与 preset schema 见 `CANVAS_PROTOCOL.md`。

### 3.4 timeline/timeline.json

```ts
{
  schemaVersion: 1,
  id: string,
  tracks: Track[]
}
```

`width / height / fps` 的唯一来源是 `project.json`；`timeline.json` 不重复存储这三项，
只保留轨道结构。渲染时从 `project.json` 读取，避免双来源漂移。

节点、边、轨道、片段的具体结构见 `CORE_ENGINE_DESIGN.md`。

## 4. 锁协议

- 项目根目录使用 `.lock` 文件
- 获取锁：以独占方式创建 `.lock`，写入 PID 和时间戳
- 锁已被占用：等待并重试，超时后报错
- 释放锁：删除 `.lock`
- 陈旧锁处理：PID 不存在或超过阈值时间，视为无效锁
- 所有写入方（CLI 短命令、Electron 主进程、Job Worker）统一通过同一个 `.lock` 串行化
- 主进程侧持有锁的典型时机：编辑落盘、渲染结果回写、`canvas version` 递增

## 5. 原子写规则

所有 JSON 文件写入遵循：

1. 写入同目录临时文件 `<file>.tmp-<random>`
2. `fsync` 落盘
3. `rename` 覆盖目标文件
4. 失败时清理临时文件

避免写入过程中崩溃导致文件损坏。

## 6. jobs.sqlite

- 开启 WAL 模式
- 设置 `busy_timeout`
- 仅由 Electron 主进程读写，CLI 通过本地 IPC 投递，不直接访问
- 核心表：jobs

```text
id TEXT PRIMARY KEY
parent_id TEXT
type TEXT
status TEXT
progress REAL
provider_task_id TEXT
request_snapshot TEXT
canvas_id TEXT
node_id TEXT
result TEXT
error TEXT
created_at INTEGER
updated_at INTEGER
```

父子任务关系通过 `parent_id` 表达。

预设存储：

- 项目预设：`<project>/presets/`
- 全局预设：`~/.canvas-cut/presets/`
- `preset apply` 查找顺序：项目预设优先，其次全局预设
- 预设 JSON schema（节点结构 + 参数 + 输入槽位如何序列化）需在 Phase 1 前补全

## 7. Schema 版本迁移

- 每个 JSON 文件包含 `schemaVersion`
- 打开项目时按版本执行迁移
- 未知的更高版本：只读打开并提示用户

## 8. 资产引用

- 资产存放于项目 `assets/` 目录
- JSON 中优先使用相对路径
- 资产文件一旦生成视为不可变，修改通过新建版本处理
