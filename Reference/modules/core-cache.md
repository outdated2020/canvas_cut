# 节点缓存存储

## 作用

唯一负责节点缓存索引的文件存取与结果素材存在性检查。缓存键和重跑策略由[画布](core-canvas.md)决定。

## 对应源码

[file-node-cache.ts](../../packages/core/src/cache/file-node-cache.ts)。

## 负责事项

- 实现 CacheLookup 的 get/put，保存 cacheKey → AssetRef、createdAt。
- get 只在缓存记录和素材文件都存在时返回命中。
- 通过共享原子 JSON 写入更新索引；读取失败当前视为空缓存。

## 不负责事项

不计算缓存键、不决定 force/nodeId、不保存任务进度，不清理素材或上传对象。时间线分段缓存不是当前节点缓存。

## 接口与依赖

FileNodeCacheStore(cacheDir).get(cacheKey) / put(cacheKey,asset)。接口类型来自画布 engine，文件存在性 helper 当前从 ProjectStore 引入，写入使用[项目存储](core-storage.md)的 atomicWriteJson。

## 数据和副作用

项目 cache/nodes.json 存 {cacheKey,asset,createdAt} 字典，媒体文件不复制。读改写/单文件原子替换没有独立的多写入方事务；调用方必须考虑并发，不能把原子 rename 当作合并保护。缺失/损坏索引触发重新生成的风险由任务/调用方处理。

## 验证入口

[core.test.mjs](../../tests/core.test.mjs)覆盖索引持久化，[white-model.test.mjs](../../tests/white-model.test.mjs)覆盖任务复用和 force。本轮未运行；并发索引合并不视为已验证。

## 已知边界偏差

未实现保留策略、LRU、损坏诊断与资产 GC；旧设计的 SQLite 节点缓存元数据、时间线分段缓存都不是此实现。后续待办见 [PLAN](../../PLAN.md)。
