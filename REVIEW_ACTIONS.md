# 设计评审修订记录（REVIEW ACTIONS）

> 状态：已按第二轮外部复检（r2）整理
> 更新日期：2026-08-15

## 1. 复检结论

第二轮复检确认 5 个高危问题（H1–H5）全部收敛，架构基本稳定；剩余工作主要是文档同步与少量小设计缺口。本轮已把 r2 列出的纯文档项落地，见下面各表。

- 新增决策（2026-08-15）：Seedance 2.5 全能力纳入 MVP——文生视频（t2v）、视频编辑/延长（v2v）、多模态参考；新增 `text-to-video` 与 `video-to-video` 节点及对应 CLI。
- 新增决策（2026-08-15）：本地素材先上传 TOS 换公网 URL 再提交 Ark；抽象 `AssetUploader`，先实现 `TosUploader`；鉴权 MVP 先用 AK/SK，STS 后置。

## 2. 已解决并写入文档

| 编号 | 问题 | 处理 |
| --- | --- | --- |
| H1 | 任务执行模型自相矛盾 | CLI → 本地 IPC → 主进程；主进程唯一拥有 jobs.sqlite 与 Job Worker |
| H2 | 缓存键阻止重新生成 | `--force` / reroll 绕过缓存；新增节点级 `--node` |
| H3 | 画布版本语义缺失 | version + graphHash；规范化序列化 |
| H4 | SQLite 选型风险 | better-sqlite3，主进程独占，CLI 不触库 |
| H5 | 预览/导出一致性 | 按导出分辨率一次生成 + 本地低清代理 |
| M1 | jobs 表缺字段 | 补 provider_task_id / request_snapshot / canvas_id / node_id；新增 §3.9 重启 reconcile |
| M3 | 时间线命令与字段缺口 | 补 remove-* / set-volume / volume / 时长语义 |
| M4 | 子画布执行与校验 | 递归渲染 + 失效传播 + 正向两层校验 + 反向校验 |
| M5 | prompt 双通道与缓存键 | 缓存键含输入文本；「连线优先，params 作为默认值」写入 CORE_ENGINE |
| M8 | 取消链路 | DELETE 端点确认；仅 queued 可取消；状态枚举修正 queued→pending、expired→failed；级联取消 |
| M10 | 预设无存储位置 | 项目/全局目录 + 查找顺序 |
| L3 | 中文字幕字体/转义 | ASS + libass + 字体路径转义 |
| L4 | 音频转场缺失 | acrossfade |
| L7 | width/height/fps 双来源 | 收敛为 project.json 唯一来源，timeline.json 与 Timeline interface 移除三字段 |
| L9 | Seedream size 映射 | 适配层 size 映射 + 不支持尺寸取整/报错 + watermark 默认 false |
| D1 | 预览方案文档矛盾 | 统一为「一次生成 + 本地代理」 |
| D2 | 执行模型矛盾 | 随 H1 闭环 |
| D3 | run_shell 表述冲突 | 标注「显式例外」 |
| D4 | 模型名不一致 | config.json 使用完整 Model ID |
| D5 | presets 目录缺失 | 随 M10 闭环 |
| D6/D8 | TECH_DESIGN 未同步 | 整份刷新 |

## 3. 本轮新发现并处理（r2）

| 编号 | 问题 | 处理 |
| --- | --- | --- |
| N1 | 本地 IPC 机制零设计 | CLI_DESIGN §13.5 补摘要；完整设计单独成文 LOCAL_IPC_PROTOCOL.md；确认单实例 + 多对话（conversationId 路由） |
| N2 | 「CLI 暴露所有能力」口径冲突 | 改为「CLI 暴露全部命令接口；生成/渲染需桌面端运行」 |
| N3 | 节点级重 roll 无入口 | `canvas render --node <id> --force` |
| N4 | Agent 工具清单与 CLI 脱节 | 补齐 timeline 工具；注明以 CLI manifest 自动生成为准 |
| N5 | PRD 稳定阶段 Qt 表达 | 确认为有意（用户此前「MVP 后切 Qt」），同步 TECH_DESIGN / OVERVIEW |

## 4. 小项清理（S1–S7）

| 编号 | 事项 | 处理 |
| --- | --- | --- |
| S1 | PRD §7 缓存键旧口径 | 同步为新公式 |
| S2 | PRD §6 CanvasClip 缺 canvasGraphHash | 已补 |
| S3 | TIMELINE_RENDER §1 两种分辨率 | 改为一次生成 + 本地代理 |
| S4 | CORE_ENGINE §4.2 重复项 | 去重 |
| S5 | FLOWS Worker→Caller 推送 | 改为调用方轮询 / UI 订阅 |
| S6 | presets 无 JSON schema | 已定义 preset schema，见 CANVAS_PROTOCOL.md §10 |
| S7 | OVERVIEW 决策表缺一次生成 | 已补 |

## 5. 待办 / 归档

### 待拍板

| 编号 | 问题 | 建议 |
| --- | --- | --- |
| M6 | 背景音乐来源 | 先暂缓；MVP 建议改为用户提供音乐文件 |

### 有意暂缓

| 编号 | 问题 | 说明 |
| --- | --- | --- |
| M9 | Agent 成本护栏 | 先不考虑，后续评估 |

### 低风险归档待办

- L1：Agent 调用 CLI 的 spawn 开销（N1 路径统一可顺带缓解）
- L2：渲染进程读取本地媒体的自定义 protocol
- L5：FFmpeg 二进制许可与自动更新签名
- L6：资产 GC / LRU 清理
- L8：API Key 注入 CLI 子进程方式
- L10：Phase 0 范围收窄

### Phase 1 前待办

- 暂无（原 S6 preset schema 已在 CANVAS_PROTOCOL.md §10 定义）
