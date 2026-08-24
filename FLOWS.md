# 流程图与时序图（FLOWS）

> 状态：设计阶段，尚未实现
> 更新日期：2026-08-15

本文档统一定义核心流程与时序。

## 1. 整体架构

```mermaid
graph TD
    U[用户] --> UI[Electron 渲染进程<br/>主界面 + 右侧 Agent 对话窗口]
    UI -->|IPC| M[Electron 主进程]
    M --> A[Agent 编排<br/>Mastra]
    A -->|spawn| C[CLI]
    C -->|本地 IPC| M
    C --> JSON[项目 JSON 状态文件]
    M --> DB[(jobs.sqlite)]
    M --> W[Job Worker]
    W --> DB
    W --> P[Provider 适配层]
    P --> API[火山方舟 Ark API]
    W --> FF[FFmpeg sidecar]
```

## 2. 用户创作主流程

```mermaid
sequenceDiagram
    participant U as 用户
    participant UI as 右侧 Agent 窗口
    participant A as Agent
    participant C as CLI
    participant W as Job Worker
    participant API as Provider

    U->>UI: 输入创作需求
    UI->>A: 发送消息
    A->>A: 选择 SKILL.md
    A->>C: 调用生成 / 画布命令
    C-->>A: jobId
    A-->>UI: 展示任务进度
    W->>API: 执行生成
    W-->>UI: 推送生成进度
    A->>C: 组装时间线
    A->>C: 导出成片
    UI-->>U: 返回结果
```

## 3. 生成任务时序

```mermaid
sequenceDiagram
    participant Caller as 调用方
    participant C as CLI
    participant M as Electron 主进程
    participant DB as jobs.sqlite
    participant W as Job Worker
    participant P as Provider

    Caller->>C: spawn generate
    C->>M: 本地 IPC 投递任务
    M->>DB: INSERT job(pending)
    M-->>C: { jobId }
    C-->>Caller: { jobId }
    M->>W: 通知 Job Worker
    W->>DB: 读取 pending job
    W->>P: 调用生成 API
    P-->>W: taskId / result
    W->>DB: UPDATE running / succeeded
    Note over Caller,M: 调用方轮询 job status；UI 经 webContents 订阅 job:update
```

说明：CLI 不直接访问 jobs.sqlite，所有任务通过本地 IPC 投递给主进程；主进程唯一拥有 jobs.sqlite 和 Job Worker。

## 4. 画布渲染时序（父子任务树）

```mermaid
sequenceDiagram
    participant Caller as 调用方
    participant C as CLI
    participant M as Electron 主进程
    participant DB as jobs.sqlite
    participant W as Job Worker

    Caller->>C: canvas render
    C->>M: 本地 IPC 投递
    M->>DB: INSERT parent job + child jobs
    M-->>C: { jobId, childJobIds }
    C-->>Caller: { jobId, childJobIds }
    M->>W: 通知 Job Worker
    loop 每个子任务
        W->>DB: 读取子任务
        W->>W: 执行节点生成
        W->>DB: 更新子任务状态
    end
    W->>DB: 更新父任务状态
    Note over Caller,M: 调用方轮询 job status；UI 经 webContents 订阅 job:update
```

## 5. CLI 与 Electron 通信

### 5.1 一次性命令

```mermaid
sequenceDiagram
    participant R as 渲染进程
    participant B as Preload Bridge
    participant M as 主进程
    participant C as CLI

    R->>B: runCli(command, args)
    B->>M: ipcRenderer.invoke
    M->>C: spawn canvas-cut --json
    C-->>M: stdout JSON
    M-->>B: 结果
    B-->>R: 返回结果
```

### 5.2 长任务命令

```mermaid
sequenceDiagram
    participant R as 渲染进程
    participant M as 主进程
    participant C as CLI
    participant DB as jobs.sqlite
    participant W as Job Worker

    R->>M: 发起生成 / 渲染
    M->>DB: 写入 job
    M->>W: 通知 Job Worker
    M-->>R: { jobId }
    W->>DB: 读取并执行
    W-->>R: webContents 推送进度
```

## 6. Agent 编排时序

### 6.1 简单任务

```mermaid
sequenceDiagram
    participant U as 用户
    participant UI as 右侧 Agent 窗口
    participant A as Agent
    participant C as CLI

    U->>UI: 输入简单任务
    UI->>A: 消息
    A->>A: 选择 SKILL.md
    A->>C: 直接调用 CLI 工具
    A-->>UI: 返回结果
    UI-->>U: 展示结果
```

### 6.2 复杂任务

```mermaid
sequenceDiagram
    participant U as 用户
    participant UI as 右侧 Agent 窗口
    participant A as Agent
    participant C as CLI

    U->>UI: 输入复杂任务
    UI->>A: 消息
    A->>A: 选择 SKILL.md
    A->>A: 生成执行计划
    A-->>UI: 展示计划，等待确认
    U->>UI: 确认 / 修改
    UI->>A: 返回确认结果
    A->>C: 逐步调用 CLI 工具
    A-->>UI: 执行进度
    UI-->>U: 完成结果
```

## 7. 时间线渲染流程

```mermaid
graph LR
    TL[时间线数据] --> RESOLVE[解析画布片段]
    RESOLVE --> SEG[分段算法]
    SEG --> PLAN[渲染计划]
    PLAN --> FF[FFmpeg 命令构建]
    FF --> EXEC[FFmpeg 执行]
    EXEC --> CONCAT[拼接分段]
    CONCAT --> OUT[输出文件]
```

## 8. 项目状态读写时序

```mermaid
sequenceDiagram
    participant P as 写入方
    participant L as .lock
    participant F as JSON 文件

    P->>L: 获取锁
    P->>F: 写临时文件
    P->>F: fsync
    P->>F: rename 原子替换
    P->>L: 释放锁
```
