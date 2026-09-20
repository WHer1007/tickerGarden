# RPC 复用、共享预算与计量 — 2026-09-20

## 范围与实施次序

本次仅本地实现、只读节点探测及本地验收，未改线上配置、执行线上迁移或发布。保留 QuickNode 主源、Alchemy 故障备用，以及原有交易 20 秒交互期限；未增加页面元素。

第一阶段先上线日志合并、固定区块复用、重复调用去重、统一计量及共享预算；`TG_DISPLAY_EVENT_DRIVEN` 不设或为 `false`，维持范围扫描模式。

第二阶段在同负载对比和恢复验收完成后设置 `TG_DISPLAY_EVENT_DRIVEN=true`，启用已实现的持久事件消费；仍保留独立完整覆盖、30 秒补漏、回执核验和重组撤销。启用不是本次工具动作。

## 已实现

| 项目 | 行为及边界 |
| --- | --- |
| 日志合并 | 展示模块按合法地址分批合并事件过滤。工厂先发现新合约，共享 PoolManager 仍独立限制 poolId；解析时检查地址对应模块。 |
| 固定区块复用 | `atBlock` 前后重新核验区块；上下文中的 call/code/balance 使用 `{blockHash, requireCanonical:true}`，相同完整参数共享。仅两端核验通过后写共享缓存。latest、pending、nonce、gas 模拟不做完成结果缓存。 |
| 重复读取 | canonicalPoolKey 只取一次原始返回值，用同一份字节解码并校验 PoolId。相同交易哈希的 Read API 观察请求合并；跨进程回执查询使用数据库租约合并。空回执不缓存，非空回执共享 500ms，资金流程继续核验所属区块及最终确认。 |
| 报价上下文 | Developer buy 和 Trade 兑换报价绑定同一区块哈希，共用池状态；完整参数不同不混用。提交时的重新报价、模拟、余额和授权校验保留。 |
| 展示/结算共享 | 完整扫描记录包括范围、地址、topics、结束区块哈希及原始日志。只有范围和每个 topic 位置均覆盖请求时才复用；分片只有相同结束区块/哈希才能合并。每次复用重新核验 canonical anchor。不同 RPC 来源保持隔离，结算的 finalized 和资金检查不变。 |
| 跨服务预算 | PostgreSQL 原子令牌桶 + 过期并发租约。Web、Read API、Pipeline、两个 Worker、Relay 按环境/链/供应商共用预算。交易保留令牌，实时和历史限制并发；本地预算耗尽不触发供应商故障切换。 |
| WS | 30 秒心跳、10 秒响应期限；超时关闭并重连。逐条计量收到的 WS 帧与订阅通知，消息持久化后再通知 Worker。 |
| 计量 | 物理 HTTP 尝试（含身份检查）、重试/备用、字节、耗时、失败、完成缓存命中、在途合并、预算拒绝、WS 请求/收到消息分别记录。日志不包含 RPC URL、Key、完整参数或钱包地址。 |

QuickNode 和 Alchemy 主网只读探测均确认支持按区块哈希的读取。成功请求复用不意味着可以复用最终确认判定；重组检查没有完成缓存。

## 数据库及配置

先执行 `0026_display_event_inbox`、`0027_rpc_control` 及权限更新。

- `permissionsSql` 为 Pipeline、Read API 赋予 RPC 协调表权限；无新资金表权限。
- `displayRelayPermissionsSql` 给 Relay 源目录角色追加 inbox INSERT，继续保留既有目录读取权限。
- RPC 缓存和租约是操作数据，按有效期清理，不用来删除奖励、交易审计或重组账本。
- 每个使用共享控制的后端进程新增独立 **1 条连接**的独立协调 pool（`read-api-rpc-control`、`pipeline-rpc-control`、`resident-worker-rpc-control`、`confirmed-display-worker-rpc-control`；运维命令归入 `tooling-rpc-control`），必须加入连接预算及角色上限（含 Vercel 最大实例、滚动实例）。不能借用已被 Worker 事务或 LISTEN 占用的连接池。

后端：

- `TG_RPC_CONTROL_ENABLED=true`
- `TG_RPC_BUDGETS_JSON`：各环境/服务采用相同配置；不一致会拒绝扣减，不能由某个实例放大预算。
- `TG_RPC_CONTROL_DATABASE_URL` 可省略并使用本服务数据库凭据；如提供则必须为同环境的协调数据库，并授予仅协调表权限。schema 使用 `TG_DATABASE_SCHEMA`。
- Read API 设置私密 `TG_RPC_BUDGET_TOKEN`，长度至少 32；不得使用 `VITE_` 前缀。

Web 与 Relay：

- `TG_RPC_CONTROL_ENABLED=true`
- `TG_RPC_BUDGET_URL` 指向同环境 Read API HTTPS 源地址。
- `TG_RPC_BUDGET_TOKEN` 与该环境 Read API 一致，仅服务端保存。
- 私有 `/v1/internal/rpc-budget` 只发放/释放限流租约，不执行 RPC，不签名，不读取金融数据。协调异常时不会绕过预算，也不会把它当成节点故障去消耗备用额度。

预算参考文件：`infra/vps/rpc-control/budgets.example.json`。用户确认 QuickNode 为 50 requests/second；参考配置为 40 RPS + 10 突发令牌，其中 4 个令牌预留交互请求，后台 4 并发、非交互总计 8 并发。这限制主动请求；WS 被动收到消息不能被令牌桶提前限速，仍需计量和监控。Alchemy 的 8 RPS/2 突发只是保守示例，发布前按其实际套餐核对。

更改共享预算策略时，应先排空调用、停相关发起服务，再重置对应 `rpc_budgets` 策略行并统一配置，不能在运行中让不同实例用不同预算。订阅事件不因预算不足被主动丢弃。

## 计量与账单对照

导出相同 UTC 起止范围的 Web/Read API/Pipeline/VPS JSONL 日志，执行：

```sh
node services/backend-ts/scripts/summarize-rpc-usage.ts web.jsonl read-api.jsonl pipeline.jsonl worker.jsonl relay.jsonl
```

输出按 service/provider/method 分组；逻辑完成日志不再计为额外请求，订阅消息的 received/delivered 两条业务日志不重复计费。单独统计请求、重试、缓存命中、合并及 WS 收到消息。QuickNode 70M credits 不能直接当成 70M 请求；工具不拿 Alchemy 的 CU 权重推算 QuickNode credits。

对照 QuickNode 的 Method Call Breakdown（HTTP/WS）和 Usage & Billing，选择稳定空闲、正常交易及历史追赶三个独立窗口。供应商按实际账单规则计算 credits；网络请求发出但客户端未收到响应仍可能计费，不能仅统计成功请求。

官方依据：

- [Method Call Breakdown](https://support.quicknode.com/articles/9223695305-understanding-my-method-call-breakdown-in-metrics-tab)：WS 按收到的 response 计量。
- [Credits per second](https://support.quicknode.com/articles/7146659276-error-credits-limited-to-x-sec)：方法权重不同，batch 内每个方法分别计量。

边界：用户钱包自带节点不是本项目付费节点，项目服务端无法完整观测；未部署的旧 Go 服务、临时本机一次性诊断脚本不计入常驻生产服务计量。不能把本地节省的请求数直接外推为生产账单降幅。

## 验收

覆盖：单源去重和双源隔离；固定哈希缓存及重组不落缓存；共享范围/过滤条件/分片锚点；两个数据库协调客户端竞争预算；交易预留和后台并发；重复回执、失败/空结果；私有接口认证与共享拒绝；重复/乱序/漏推、移除事件、断线及重组恢复；20,000 项目的分片补漏；Stats/Explore/详情数据库读取回归。

本地验收结果（2026-09-20）：

- Web 全量测试：762 通过；后续预算/代理相关定向回归及类型检查通过。
- Backend `npm test`：228 通过、0 跳过；包括类型、生成产物、契约覆盖及打包检查。`npm run build` 通过。
- Relay：15 通过、0 跳过，包含预算不足时跳过心跳而不误断开健康连接。
- 本地 PostgreSQL 事件入口、权限、展示、20,000 项目补漏及 Stats/Explore 等集成测试：12 通过、0 跳过；最终数据库、跨实例预算/缓存和结算相关回归：4 通过、0 跳过。
- QuickNode、Alchemy 只读主网探测：均支持绑定区块哈希的 `eth_getCode` 和 `eth_call`。未广播交易。

以上是代码及本地验收结果，不代表已启用线上共享预算，也不代表已取得生产账单节省数据。
