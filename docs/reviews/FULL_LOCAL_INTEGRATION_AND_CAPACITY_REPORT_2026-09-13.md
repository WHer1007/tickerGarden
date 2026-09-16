# 本地联调与容量测试报告

测试日期：2026-09-13 至 2026-09-14（Asia/Shanghai）。对象：本次工作区最新源码，包含既有未提交修改；不是已部署版本的验收。

**结论：核心功能回归通过，但目标规模验收不通过。** 已构造 **10,001 个未毕业 + 1,000 个已毕业市场**的数据库测试人口，复现三处规模硬上限、Relay 同一区块断线补偿缺口，以及串行发布、数据库往返和目录查询的扩展瓶颈。不能据此标记生产就绪，也不能声称全部钱包操作已经经过完整三端端到端验收。

## 1. 测试范围和证据可信度

本次分四层执行，避免把合成数据测试当作实际链上部署：

| 层级 | 实际执行 | 局限 |
| --- | --- | --- |
| 合约 | 当前 Solidity 普通测试、产品轨；专用 Anvil 中实际签名执行 Holder 发布和 Locker 复投 | 大规模市场不是逐笔链上创建；部分依赖为 fixture |
| 后端 | 当前 TypeScript 后端、真实 PostgreSQL、生产 Hono Read API、生产 projector/publisher | 大规模读模型通过测试 SQL 注入；正常发布链路的硬上限另行复现 |
| 事件入口 | 实际 Relay 进程、真实数据库、本地 TLS WebSocket/RPC/队列模拟服务 | 没有访问真实供应商，也没有证明外部供应商接受近 1 MB 订阅 |
| 前端 | 实际 Chrome、构建后的页面、真实本地 API 和数据库，桌面与移动尺寸 | 外部请求被阻止，没有钱包插件授权交易；测试配置未绑定真实部署写入口 |

机器为 Apple M2、8 核、8 GB 内存；PostgreSQL 14；后端 Node 24.19.0。根 `npm test` 由 Node 22.22.0 启动，后端及数据库测试另以要求的 Node 24 执行。测试机器同时运行其他应用，部分批次与合约测试重叠；延迟存在明显同机争用，**本文数字用于定位瓶颈，不是生产吞吐量或 SLA 承诺**。

未访问公共链、未部署或提交代码、未启用定时快照。Creator 收益权交接和紧急退出不新增前端入口，LP 复投仍仅在前端文档说明，符合已确认业务边界。

## 2. 功能回归结果

| 测试轨 | 结果 | 证据文件 |
| --- | --- | --- |
| 普通合约测试 | **1,046 通过，0 失败，0 跳过；96 suites** | `root-tests.log` |
| 产品轨重复验证 | 332 通过，0 失败，0 跳过；是上述覆盖的子集，不另计独立总数 | `root-tests.log` |
| 后端单元测试 | **74 通过，0 失败，0 跳过** | `backend-tests.log` |
| 后端 API contract 测试 | 10 通过；与单元轨有重叠 | `backend-tests.log` |
| 实际数据库集成 | **11 通过，0 失败，0 跳过**，Node 24 复跑 | `db-tests-node24.log` |
| 前端测试 | **390 通过，0 失败，0 跳过** | `web-tests.log` |
| 部署工具本地测试 | **68 通过，0 失败，0 跳过**；不是实际部署 | `deployment-tests.log` |
| Holder / Locker / 当前收益 / 环境工具 | **32 通过，0 失败，0 跳过** | `operator-tests.log` |
| 编译、生成物与类型检查 | 后端构建、后端测试内置检查、根命令到 Fork 前检查通过；独立前端测试构建通过 | `backend-build.log`、`local-web-build.log`、各测试日志 |

根 `npm test` 最终停在必须提供 `ROBINHOOD_RPC_URL` 的 live Fork 门禁，**整条根命令没有通过**。本次明确限定本地，因此没有加载已保存的公共 RPC；后端、前端、部署工具和数据库轨已分别执行，不因根命令提前停止而遗漏。公共链 Fork、真实部署绑定和正式发布门禁不在本次已通过范围。

### 业务覆盖矩阵

| 业务域 | 已执行的验证 | 尚未由本次证实的部分 |
| --- | --- | --- |
| 创建、参数校验、LP 费率、初始购买 | Factory、Registry、Curve 合约测试；前端 draft/launch/文案测试；创建页浏览器检查 | 钱包插件创建→全链索引→页面出现的完整实签流程 |
| 曲线买卖、报价、滑点、毕业边界 | Curve、毕业执行、Hook、费用分配相关合约测试；前端价格与池交易测试 | 大规模并发真实交易及真实外部 Stock 路由 |
| 毕业池、LP 和额外业务手续费 | 产品轨、FeeVault/V4/Hook/Locker 相关回归；毕业市场页面读取 | 1,000 个真实部署池的连续交易压测 |
| Staking、激活、领取、正常退出 | Gauge、Vault、锁仓及收益结算测试；Stake/Claim 页面加载与单元测试 | 多浏览器钱包同时操作与真实链最终性时延 |
| 紧急退出、罚没、Creator 交接 | 合约测试；保持无前端操作入口的既定边界 | 邮件申请属于人工业务流程，本次没有发送邮件 |
| Holder 快照、排除账户、分配、签名、回执恢复 | 快照与发布单元测试；实际 Anvil 签名交易；持久日志重载后确认；claim eth_call | 独立 RPC 提供商一致性；全部市场周期作业（仍禁用） |
| LP 复投 | 实际 Anvil 执行、实际 LP liquidity 增量；worker 回归 | 长期 keeper 运行及真实跨供应商网络故障 |
| API 分页、过滤、游标、最终性 | 11,001 市场全遍历无重复；阶段数量精确；篡改/换过滤游标 409；孤块发布 503 | 连续多日增量、历史数据无限增长、跨进程滚动升级 |
| 页面展示、局部刷新、错误恢复 | 18 个页面/尺寸组合；8 项交互验证 | 所有浏览器、辅助技术、钱包错误分支的穷尽组合 |
| Relay 去重、removed、重试、重连 | 真实进程验证；跨区块补偿通过；同一区块缺口失败 | 全链深重组、真实队列交付到生产 pipeline 的长期联调 |

测试清单可追溯至 `contract-test-inventory.json` 和各轨日志。测试数量说明执行覆盖，不代表所有业务状态组合均已穷尽。

### 实际本地合约操作

- Holder：真实 Distributor / Token / AccessManager，其他依赖使用 fixture；本地签名发布从 pending/confirming，经 journal 重载对账到 confirmed；预期领取 `1e18` Quote 的调用验证通过。两条 RPC transport 指向同一 Anvil，不能视为独立提供商验证。
- Locker：真实 Locker / PoolManager / PositionManager，Registry / Executor / Permit2 / token 等使用 fixture，v4 donate 构造手续费增长；实际签名复投 confirmed，流动性增加 **994999999999999999**。

对应交易、余额和操作结果保存在 `holder-local.json`、`locker-local.json`。它们是 localhost 交易，不是 RH 链交易。

## 3. 目标规模构造与验收

最终测试人口：**11,001 市场、110,010 交易记录、22,002 Holder balance 记录**；10,001 个未毕业，1,000 个已毕业。另构造 ABI 编码的 MarketCreated / Holder 注册事件，直接调用实际 projector 验证规模边界。

规模阶段为 100、1,000、1,001、11,001。每个阶段的端点探测重复 5 次；数据完整遍历为 111 页，恰好返回 11,001 个唯一市场。`capacity.json` 中 cap 检查的 `pass:true` 表示“成功复现拒绝行为”，**不表示容量需求通过**。

| 路径 | 100 / 1,000 市场 | 1,001 / 11,001 市场 |
| --- | --- | --- |
| 市场目录、单市场详情 | 200 | 200 |
| 显式传 market IDs 的市场统计 | 200 | 200（测试限定小范围 IDs） |
| protocol-statistics、stats/holders、stats/series | 200 | **503：statistics market bound exceeded** |
| 不传 IDs 的 market-statistics | 200 | **503：statistics market bound exceeded** |
| 正常市场 projector / publication | 小规模工作 | **11,001 条被拒绝** |
| Holder projector | 小规模工作 | **1,001 个注册市场被拒绝** |

正常生产 publisher 无法发布这批 11,001 市场，所以测试专用批量 SQL 越过该入口，仅用于检验后续真实 API/页面。**没有更改生产上限，也没有完成 11,001 市场正常摄取→发布的端到端成功流程。**

## 4. 已确认问题与优化优先级

### P1：全局统计在 1,001 市场时直接不可用

位置：`services/backend-ts/packages/statistics-store/src/index.ts:148`。`currentMarkets` 最多读 1,001 条，超过 1,000 抛错，导致多个全局统计端点一并 503。此项是稳定的功能性规模阻断，与机器快慢无关。

建议将全市场聚合改成有 revision / finalized 边界的增量汇总或数据库聚合，查询只读需要的结果。不能只把 LIMIT 改大而保留每次全量加载。验收应包含 999/1,000/1,001/11,001 市场及修订、撤销、最终性一致性。

### P1：市场投影与通用发布限制 10,000 条

位置：`packages/market-projector/src/index.ts:221`、`packages/projection/src/index.ts:171`（均位于 `services/backend-ts`）。11,001 条实际 ABI 解码创建事件触发 `bounded release scope`；publisher 触发 `projection bounds`。

建议分页读取、分批物化到同一候选 revision，完整性校验后原子切换 pointer；保留旧版本只读与回滚能力，避免“发布一半”可见。必须同时处理 projector 和 publisher，单改前端分页无效。

### P1：Holder 投影超过 1,000 注册市场失败

位置：`services/backend-ts/packages/chain-worker/src/holder-snapshots.ts:38`。1,001 个注册事件已复现 `holder market bound`。建议按市场持久 checkpoint 增量推进，发布仍按当前人工签名策略执行。另有事件历史、Transfer 历史、持有人数量上限，见该文件；本次没有逐项填满这些上限，不作已验证容量结论。

### P1：Relay 同一区块断线后漏补事件，健康状态仍显示正常

位置：`infra/vps/chain-event-relay/src/server.ts:137`、`:157`。收到单条日志就把 checkpoint 推至该区块；重连从 `last_block + 1` 补偿。如果已收到同一区块一条日志、另一条在断线期间遗漏，重连不会补读该区块。

实际测试等待前一 checkpoint 稳定，再放入一条同高度遗漏日志并断开 WSS；重连后 **新增 eth_getLogs 调用 0，新增 inbox 记录 0**，但健康状态 `ok:true, pending:0, dead:0`。跨区块补偿、重复去重、removed 独立入队和队列 503 重试均通过。证据：`relay-recovery.json`。

建议 checkpoint 表达“完整扫描完成区块”，不要表达“看见过某条日志的区块”；重连重扫最近区块并依靠事件键幂等，对 reorg 保留重叠窗口。本次证明的是 **Relay 自身耐久 inbox 缺口**；下游 whole-block RPC 扫描可能恢复，尚未证明整个协议永久丢数。

### P2：Relay 串行队列发布形成可测积压

位置：`infra/vps/chain-event-relay/src/server.ts:169`。每条消息串行 claim→HTTP publish→数据库确认。

| 本地队列额外延迟 | 100 条完成耗时 | 该批平均吞吐 |
| --- | --- | --- |
| 0 ms | 6.23 秒 | 16.04 条/秒 |
| 50 ms | 19.04 秒 | 5.25 条/秒 |
| 200 ms | 41.96 秒 | 2.38 条/秒 |

不同批次因同机争用波动较大；这些不是固定极限。更直接的积压测试：**100 条/秒持续 10 秒，队列额外延迟 50 ms，1,000 条中已交付 161、待交付 839、dead 0**（`relay-burst.json`）。不能把“接收入库成功”当作推送已经完成。

建议在保留租约、幂等和失败恢复的前提下有界并发发布，按相关顺序键约束并发；增加最老待交付年龄、积压增长率、恢复排空时间指标。长时间压力测试应验证停止输入后确实排空。

### P2：动态订阅路由计算与超大订阅

位置：`infra/vps/chain-event-relay/src/server.ts:89` 附近，新增地址/池使用 `filter + some`，差异比较为 O(n²)。测试初始 22,019 sources、1,000 pools；普通订阅约 **997,183 字节 / 22,018 地址**，池订阅 **69,208 字节 / 1,000 pool topics**。

完整压力批次一次路由刷新超出 30 秒观察窗口；独立恢复复测约 **9.18 秒**。建议 Set/Map 差集、分片订阅、分批回填，记录路由版本与切换覆盖。真实 provider 的请求大小限制和订阅配额没有测试，不能宣称这些订阅在 RH provider 可用。

### P2：投影发布逐条数据库往返

位置：`services/backend-ts/packages/projection/src/index.ts:55` 附近。真实 publisher 的查询计数：100 条 **109 次**，500 条 **509 次**。

| 规模 | 本地无注入延迟 | 每次查询注入 50 ms |
| --- | --- | --- |
| 100 条 | 80.9 ms | 7.27 秒 |
| 500 条 | 279.0 ms | 28.37 秒 |

这是可控延迟注入，说明网络数据库下逐行 await 的代价。建议批量 INSERT / COPY 至候选版本，保留事务、digest 校验、冲突检查和原子发布。不要以移除金融一致性检查换吞吐。原始大批次还有受争用影响的 64/117 秒耗时，保存在 capacity 证据中，不作为稳定基准。

### P2：目录排序与搜索存在全扫描

生产 Read API 的 EXPLAIN ANALYZE 显示：名称排序取 50 条仍扫描 11,001 当前市场并过滤另外 11,103 条投影记录，top-N 排序约 **55.61 ms**；子串搜索扫描 22,104 条投影记录寻找一条，约 **184.25 ms**。

建议抽取可索引排序/搜索字段，按部署、scope、revision、阶段建立适合实际查询的复合索引；搜索可另评估前缀或 trigram，游标继续绑定 revision/filter。查询计划和缓冲区证据保存在 `diagnostics.json`。

### P2 / 待隔离：并发读取时出现部分 500

初始 Hono 混合负载每档 128 请求，含 50 市场统计批量读取：并发 64 时 **101 成功、27 个 500，P95 16.33 秒**；真实 HTTP 复测分别在并发 1 和 4 各观察到 1 个 500。默认连接池 4，查询和连接等待超时均 5 秒，但本次没有捕获足以确定原因的原始异常，因此不能直接判定为某一种超时。

在合约轨结束后，额外带查询错误采集的较轻负载（单市场统计）并发 4/16/64 均 **128/128 成功**，P95 约 313/446/2,691 ms；这不是对原 50 市场批量负载的同条件推翻。建议专用机器顺序复跑同一 workload，记录连接等待、SQL 时间、事件循环、错误类别，再决定池大小和限流。证据分别为 `capacity.json`、`http-load.json`、`query-errors.json`。

## 5. 前端展示与刷新

桌面 1440×1000、移动 390×844，检查 Home、Explore、曲线 Trade、毕业池 Trade、Create、Stake、Claim、Stats、Docs，共 **18 个页面/尺寸组合**，未发现 JS pageerror 或横向溢出；截图与每页请求、DOM、LCP/long tasks 记录已保存。

Explorer 当前展示 **50 张卡片（10 已毕业 + 40 未毕业）**，不是把 11,001 个市场渲染到 DOM。桌面/移动各执行四项交互，共 **8 项通过**：下一页只更新对应阶段；精确搜索；接口注入 503 后错误可见、恢复请求可恢复；快速切换图表周期保持交易输入与最终选择，仅请求 candles 和必要 updates。

初版浏览器检查使用固定 1.5 秒等待，移动翻页出现一次假阴性；已用实际 DOM 条件等待复测，桌面 256 ms、移动 209 ms 完成，另一阶段保持不变。原结果保留为 `browser-fixed-wait-before.json`，交互复测见 `browser-flows.json`；修正等待条件后再次完整运行 18 个页面/尺寸组合，最终 `browser.json` 为 passed，6 项内置检查全部通过。早期 fixture 超过新鲜度门槛导致详情拒绝显示，属于正确 fail-closed；改为新增合成 publication 刷新测试时间，未修改旧不可变记录，原结果见 `browser-stale-fixture.json`。

**Stats 的永久容量错误却显示“still syncing / automatically”语义，属于待修 UX 问题**：数据没有伪造为 0 是正确的，但持续轮询无法消除硬上限。应区分暂时同步、服务容量不可用和真正无数据。

当前前端更新是 API revision **轮询**（基础约 5 秒、无变化逐渐退避到约 60 秒），不是直接 WebSocket 推送到浏览器。链事件路径为 WSS→Relay→队列→pipeline→已确认发布→前端轮询。端到端延迟应按这些阶段分别测量，不能用 Relay 收到消息时间代表页面已更新；最终性等待本身仍应保留。

## 6. 剩余验收与修复后复测要求

当前不建议直接以“增加机器配置”应对：前三处硬上限会在再快的机器上失败。建议按以下顺序处理：

1. 修复 Relay 完整区块 checkpoint 与重扫语义；补齐同区块多日志、断线、重组、重复重放和进程重启的长期回归。
2. 重构市场/Holder 分批增量物化和统计汇总，保留原子发布与最终性验证；用正常事件入口重新生成全部 11,001 市场，消除本次 SQL 注入绕行。
3. 批量数据库写入、索引与 Relay 有界并发；用相同人口在空闲专用主机测 1/4/16/64 并发，记录所有 5xx 原因。
4. 增加至少小时级持续输入、停止后排空、历史增长、数据库重启、pipeline 重启、租约恢复、深重组、磁盘/连接压力等验收。当前 10 秒 burst 不能替代 soak test。
5. 在独立本地完整部署上绑定前端钱包及 pipeline，从创建→交易→毕业→Staking→领取→Holder 手动签名→Locker 复投→退出完成实际多钱包闭环，并自动逐项核对链状态、API、页面。

这些仍未完成的组合不能由本次分层回归替代。当前报告交付的是已执行的广覆盖回归和明确的规模失败定位，**整体“所有功能流程 + 目标规模完整三端闭环”验收仍不通过**。

## 7. 交付与复现

- 可执行脚本：`tools/full-local-integration/`，命令见该目录 README。
- 原始证据：`docs/reviews/evidence/full-local-integration-2026-09-13/`，含 JSON、测试日志、SQL 计划、18 张截图。
- `SHA256SUMS.json` 固定本次证据及相关源码校验值；不包含本地签名 journal 内容。
- 本次仅新增测试工具、报告和为本地 operator 测试增加证据输出路径选项；未修复以上生产问题。原有工作区修改保留。
- 本次创建的专用 API、页面预览、Anvil 和可确认归属的测试 schema 在结束时清理；已有 PostgreSQL 保留。无法确定是否本次首次创建的早期 Relay schema / public 表不擅自删除，具体清理结果见 `cleanup.json`。
