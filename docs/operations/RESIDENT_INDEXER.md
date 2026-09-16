# 常驻索引与连接预算

本实现保留 TypeScript、PostgreSQL 持久 inbox/jobs/outbox、最终性和 generation/fencing。没有启用 Holder 周期签名，也没有改合约。默认执行模式仍为 `qstash`，部署新代码不会自动切换消费端。

## 减少工作量

- `holder_snapshots` 的区块代表最后一次余额变化；`holder_snapshots_covered` 将其与原子更新的 analytics checkpoint 组合，表示已完成覆盖的区块。两者的锚点都必须 canonical/finalized。消费者读取 covered view，不能把基表 mutation 区块误认为落后覆盖。
- 安静区块只推进一次 checkpoint，不更新全部 Holder 行。全量绑定读取、排除策略验证和部分检查点计数仍存在，未声称所有流程 O(1)。
- Analytics、statistics 查询只取需要的市场字段。
- OpenAPI 5.1.0：`GET /v1/market-statistics` 必须提供 1–100 个 `markets`。无参数请求返回 400，不能静默截断返回部分市场。前端既有按可见市场分批请求保持；外部调用者应先分页列举市场，再分批查询。全局汇总继续使用 `/v1/protocol-statistics`、`/v1/stats/*`。

## 常驻运行

入口：`services/backend-ts/scripts/resident-worker.ts`。直接运行已安装依赖的 Node 24 源码，不增添另一套业务逻辑。systemd 模板在 `infra/vps/systemd/tickergarden-resident-worker-test.service`，配置样例在 `infra/vps/resident-worker/test.env.example`。

每 schema 一条链队列只允许一个活跃 Worker，另一个实例会因数据库 advisory lock 拒绝运行；可由 systemd 重试作为待机恢复。独立控制连接占用 1 个连接，必须直连或使用 session pooling，不能使用 PgBouncer transaction pooling。其余工作连接默认 4 个。

Worker 每秒检查持久任务，空闲轮询可中断；不依赖一次新的 QStash 通知来继续处理已入库任务。任务使用 300 秒租约、240 秒执行上限，超过上限或控制连接失效时整个进程退出，防止旧执行者继续工作。systemd 重启后恢复过期租约，重试仍遵守原指数退避和最大尝试次数；死信不会自动无限重放。SIGTERM 停止领取，等待当前任务完成；systemd 270 秒后强制停止。

`/healthz` 默认仅绑定 127.0.0.1:8082。执行状态、最后轮询、成功/重试/死信计数可读；日志禁止输出 RPC URL 和数据库凭据。单任务失败保持队列重试，数据库故障退出后由进程监管恢复。

链上日志 Relay、Pipeline 入库接口、安静区块 bootstrap 定时器继续负责产生任务。Worker 执行已入库的持续索引和投影续作；它不替代链头发现，也不自行广播交易。

## 切换与回退

先在测试库备份副本应用 0012/0013 及角色权限，部署兼容的新 Pipeline/Read API，再切换。必须先升级所有消费者：旧版 Pipeline 不认识执行模式，不能与 resident 同时运行。

1. 核验实际云实例区域、数据库 TLS、连接预算；安装 Node 24 及锁定依赖，准备专用低权限系统用户和 EnvironmentFile。不要启用生产 profile。
2. 停止旧消费者领取并等待现有 job/outbox leases 排空；过期租约可由已有 repair 路径恢复。保留所有持久任务与日志。
3. 在保护的环境变量下执行 `node --experimental-strip-types scripts/resident-worker.ts --activate`。切换与领取共享 generation 行锁；数据库同时检查未完成租约，未排空则拒绝。
4. 启动测试 systemd Worker，验证健康、任务延迟、投影检查点、重复事件及资金核对。QStash callback 和 outbox dispatcher 在 resident 模式不再领取链任务；Content 队列不受影响。
5. 回退时先停止 Worker 并排空/恢复租约，再执行同一入口 `--rollback`，恢复 QStash dispatch。pending/retry 数据保持，已成功任务不重做。generation 没有因切换而递增，原有递增门槛仍保留。

不能使用删队列、跳过 canonical/finalized、取消代际检查的方式加速切换。

## 连接预算与区域

`connection-budget.example.json` 是规划样例，不是线上事实：100 个总连接、20 个保留、计划使用 63 个、剩余 17 个。服务实例数必须包含 Vercel 扩容上限与滚动发布的重叠实例。样例按单环境计算，测试/生产各自单独校验。

`TG_DB_BUDGET_JSON` 给出统一预算；各服务用 `TG_DB_POOL_MAX_READ_API`、`TG_DB_POOL_MAX_PIPELINE`、`TG_DB_POOL_MAX_CONTENT` 等覆盖池上限。配置超过预算即在建立连接前拒绝。Worker 启动强制要求预算，现有 API 未设置预算时保留旧兼容配置。

预检（从计划运行主机执行，环境变量从安全配置加载）：

```sh
node --experimental-strip-types scripts/check-database-runtime.ts /path/to/verified-budget.json --database
```

使用只读的 `TG_DATABASE_PREFLIGHT_URL`；读取 PostgreSQL 实际 max_connections、保留连接、当前连接数与 TLS，并测 10 次 SELECT 往返。区域变量必须显式声明为 Singapore；配置声明不能替代云厂商实例元数据。所有 Vercel 发布仍必须显式 `--regions sin1`，alias 前执行已有 `check-vercel-region.mjs`。

应用内池上限不能限制 Vercel 总实例数。必须另行配置平台并发/实例上限，或按真实数据库角色汇总预算并设置 PostgreSQL CONNECTION LIMIT；共用角色的多个服务必须合计。不同 URL/角色的连接池应分成独立预算项（样例中的 chain-relay 与 chain-relay-source 已拆开）。`TG_DB_ROLE_MAP_JSON` 将预算服务名映射到实际数据库角色，预检会输出合并后的 `ALTER ROLE ... CONNECTION LIMIT` SQL，供管理员审核应用；不会自动修改远程角色。角色必须为非 superuser，已有连接需要排空或核对。未落实这一层之前，预检只代表配置计算通过，不能声称全局连接数已被强制限制。

本轮不默认引入 PgBouncer：当前缺实际连接饱和证据。后续使用 transaction pooling 时，验证 startup options、事务内 SET LOCAL 和预备语句；控制连接使用独立直连 URL，不能通过调大连接池规避限制。

## 本轮容量补充

0014 把 Holder 余额引用计数改为按 SQL 语句聚合，同时保留跨零、删除、资产分组与事务回滚语义。全量重放必须复测；不能通过提高 SQL 超时掩盖逐行维护成本。

前端 Global Holder 校验已移除历史 1,000 市场上限，仍检查安全整数、去重数量和排除关系。协议统计只返回实际手续费 Meme 资产的精度映射。全局 Holder 的完整排除地址集合仍随市场增长：21,500 市场的真实排除策略约 64,505 个地址、2.9 MB 响应；后续可独立改为按需分页，不能无标记截断集合。
