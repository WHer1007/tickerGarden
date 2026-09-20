# RPC 事件路径优化实施记录 — 2026-09-20

## 已实现

1. Relay 将过滤后的事件写入业务库 display_event_inbox，再发送数据库通知。原有持久队列和资金结算入口保留。重复消息幂等，removed 消息独立留存。两个数据库之间不假设跨库事务；中途失败关闭 WS，由恢复扫描补齐。
2. 展示 Worker 直接读取 inbox，按 txHash 合并回执核验。同一交易的完整回执用于补齐仅部分送达的事件；支持同交易创建、铸币与首买的识别。普通推送更新不调用 eth_getLogs。所有记录仍核对成功回执、日志内容、区块归属与 canonical hash。
3. 维护独立的完整范围 coverage；收到推送绝不等于整块或整段完整。30 秒低频恢复扫描保留。晚到或漏推交易触发展示 journal 回滚至完整 coverage 边界，按顺序重放未核验尾段；不向已有账本乱序追加。即便节点已 finalized，尚未补漏核验的展示 journal 也保留，直到同时满足最终确认与完整覆盖才清理。
4. 普通项目模块合并地址+topic0 日志查询，每批最多 256 地址；本地再次校验地址对应事件。工厂先查以发现新合约；共享 PoolManager 单独按项目 poolId 查 Swap，避免读取其他项目成交。响应过大继续二分区块/地址。
5. WS 每 30 秒执行一次 eth_blockNumber 存活探测，10 秒未响应或 RPC 错误即关闭连接，沿用 QuickNode→Alchemy 的重连与回切。心跳不重叠、关闭时清理定时器，不增加全链 newHeads 订阅。新地址或池注册后立即通知恢复覆盖订阅切换间隙。

实际 Relay 进程测试额外发现并修复：HTTP RPC 请求 ID 原先误放在队列发送函数，导致 removed 事件的 HTTP 核验尚未发出就失败；WebSocket 错误关闭分支改用 WHATWG 支持的应用关闭码。关闭连接后立即唤醒连接循环，不再等待目录刷新定时器。

没有更改交易确认规则、奖励结算权限/最终确认策略、前端数据来源或页面元素。

## 数据库与发布次序

新增迁移：`services/backend-ts/packages/db/migrations/0026_display_event_inbox.sql`。

部署前先在对应环境执行迁移，再执行标准 permissionsSql 更新 Pipeline/展示 Worker 对新表的读写权限；另用 displayRelayPermissionsSql(schemaName, sourceRole) 为现有 CHAIN_SOURCE_DATABASE_URL 角色追加 display_event_inbox 的 INSERT 权限。原有合约目录 SELECT 权限继续保留，不新增奖励、资金表权限，不给 Relay 新表 UPDATE/DELETE 权限。

然后更新展示 Worker 与 Relay。按后续分阶段要求，新展示 Worker 仅在 `TG_DISPLAY_EVENT_DRIVEN=true` 时启用 eventDriven；第一阶段保留扫描模式。不要在迁移和权限完成之前启动新版本。新 Relay 启动及重连会发 recover 通知，展示 Worker 启动也强制补漏。现有 Vercel 区域、test/master 分支发布门槛继续适用。

回滚可恢复旧 Relay/Worker 二进制；新增表暂留，不删除账本或历史记录。不要将新版本的非完整展示游标直接当作旧扫描器的完整覆盖：回退展示 Worker 前应先由新版强制恢复至无 coverage 差距，并确认该 blockHash；否则需从已核验 baseline 重建展示投影。资金结算游标不受此次修改影响。

本次只进行了本地实现和验证，没有对测试/生产执行迁移或发布。

## 验证范围

- 后端完整 npm test：生成物、OpenAPI/契约、打包、TypeScript 和单元测试。
- 本地真实 PostgreSQL：直接事件处理、重复/晚到/漏事件、回执失败、覆盖空洞拒绝、范围恢复、重组回滚、finalized 与 coverage 分离、只追加权限和迁移幂等。
- 有效 MarketCreated 编码识别新合约；旧分叉及 removed 创建事件不能形成有效市场。
- 20,000 市场补漏分片与持久覆盖复用；Stats、Explore 和展示准备的回归测试。
- Relay 心跳的超时、失败、清理和不重叠测试，及实际 Relay 进程与本地 WSS/PostgreSQL 集成。

性能结论限定于测试：正常推送路径 0 次 eth_getLogs；同交易两条相关事件只收到一条通知时，1 次回执核验补齐。小规模普通地址恢复为工厂+合并模块两类查询，共享池另算。不是生产账单降幅承诺；上线后需对比 provider 方法统计和更新延迟。

本地验收记录：后端完整单元测试 222 项通过，相关 PostgreSQL 集成测试 11 项通过、0 跳过；后端构建与 Relay 源码严格 TypeScript 检查通过。大规模测试夹具分批写入 20,000 条记录，保留原生产 5 秒 SQL 超时，没有通过调大运行时超时绕过检查。

Relay 的 Node 24 完整测试 14 项通过、0 跳过，包含真实子进程在第一次心跳无响应后自动重连，以及持久化先于通知、重复事件去重和 removed 事件留存。最后的展示 Worker 定向回归及后端 TypeScript 检查再次通过。

只读 QuickNode 主网验证：chainId 4663，最近 10 个区块、16 个项目地址、91 个事件 topic 的合并 eth_getLogs 请求被正常接受（该范围返回 0 条日志）。此项只验证提供商接受过滤格式，不代表业务吞吐或生产费用降幅。
