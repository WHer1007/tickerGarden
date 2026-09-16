# 日常规模索引、统计与推送优化报告

日期：2026-09-14。范围：本地 TypeScript 后端、Read API、Chain Relay、Explore 翻页联调；基准 **20,000 未毕业 + 1,500 已毕业市场**。本轮没有提交、远程迁移、RH 部署、Vercel 发布或启用周期快照发布。

## 结论与验收边界

五个阶段的实现已经落地，最终结果为 **LOCAL_SCOPED_ACCEPTANCE_PASSED**，生产状态仍为 **NOT_PRODUCTION_READY**。本报告以分阶段证据判断本地验收，不能等同于 RH/Vercel 生产就绪。最后验收汇总见 `evidence/capacity-optimization-2026-09-14/acceptance.json`。

人口规模通过正常 Market/Holder 投影器的 ABI 日志和无网络双 RPC 模拟器构造，不是 21,500 次真实链上部署。215,000 笔交易为 SQL 读模型容量 fixture；另外用 43,000 条 ABI Transfer 经正常分析投影器重建 21,500 市场余额，并逐市场核对供应量。没有将 SQL 灌数冒充交易全链摄取，也没有将浏览器无钱包写入测试称为完整交易签名验收。

## 按顺序完成的优化

| 阶段 | 实现与保留的约束 |
|---|---|
| 事件完整性 | Relay 单条 WSS 日志不再推进“整块完成”水位；初次连接、重连与周期对账采用 HTTP 重叠回扫，覆盖同块断线。canonical/removed 分别幂等；最终性仍由下游双 RPC 和完整范围校验负责。 |
| 增量索引与发布 | 市场按事件相关标识重读；有 staking、缺 display 或全局治理变更时保守刷新。每任务最多观察 128 个、并发 8 个；候选按 block hash/generation 暂存，冲突拒绝。可靠队列续跑最早候选、跳过已完成 scope，续跑也处理重组。仅新增/变更市场写新版本；完整 manifest、逐条 payload 核验、不可变历史及单调发布指针保留。 |
| 统计与查询索引 | 交易汇总与明细原子增删改；保留金额整数精度、区块哈希、时间与手续费资产维度。改用集合聚合、查询索引和 trigram 搜索，移除市场总量截断。分析投影按单笔交易涉及的市场绑定处理，避免把全体 21,500 市场传入每笔交易归一化。Holder 覆盖与全局排除集合检查避免重复扫描。 |
| Holder 调度 | 移除 1,000 市场入口限制，按新增奖励事件选择市场并分批续跑；空区间不逐市场读 RPC。发布/领取事件 checkpoint 原子推进；同 anchor 重试不重复 round/claim；重组保留证明归档。手动签名和资金核对不变，周期发布仍禁用。 |
| 推送与容量验收 | 地址/pool 订阅每片最多 500；Relay 发布并发默认 8，带 attempt 租约围栏和积压健康指标。Read API 合并同时进行的相同公共请求，完成后移除，不缓存过期最终性结论。全局重查询采用每实例 1 个执行槽 / 8 个排队候选，过载返回 503；市场范围读取用独立执行队列。修复后台 revision 变化、新市场提示重置第一页取消进行中翻页的竞态。补上空闲数据库连接断开处理，下一请求重新获取连接。 |

浏览器仍为 `/v1/updates` HTTP 版本轮询，常态 5 秒并带退避；**未改成浏览器 WebSocket/SSE**。WSS 用于服务端链事件接入。

## 功能与安全回归

- 后端完整门禁：79 单元测试，通过 OpenAPI/合约覆盖、生成物、Vercel 打包及 TypeScript 检查；构建通过。
- PostgreSQL 集成：16/16，通过，0 跳过。最终采用 `--test-concurrency=1`，包括发布不可变性、旧 revision、移除/重入、跨 generation、孤块拒绝、交易汇总增删改、旧 0001–0004 schema 升级回填/再应用幂等、供应量/领取核对、队列 continuation 与自有空闲连接终止后恢复。
- 前端：393/393 通过，包含后台 revision 与翻页并发的新增回归；本地测试构建显式设置 chain 46630，不加载保存的公开 RPC 环境。
- 浏览器：桌面/手机 18 个页面检查、8 项交互检查及 6 项页面内断言通过；未发现横向溢出或未捕获页面异常。只覆盖本地读路径和无需钱包的交互。
- Relay 单元：6/6；完整恢复与突发验收见下节及最终汇总。
- 与上一轮本地报告的 hash 清单比较：70 个 `contracts/src` 文件全部相同。本轮未重新跑 1,046 条合约测试，不把上一轮结果记为本轮新执行。

续跑入口遗漏、暂存冲突核对、重组恢复、共同 Creator 引起的过度重读、冷启动 SQL 慢路径、翻页竞态和空闲数据库连接退出问题均在本轮测试中发现并修复。金额、领取和最终性校验没有为通过性能测试而关闭。

## 日常规模实测

环境：Apple M2、8 CPU、8 GB RAM；Node 24.19.0；本地 PostgreSQL 14；隔离 schema。单条 Runtime SQL 超时保持 5 秒，事务总墙钟耗时与 SQL 超时分开记录。以下是短时本地观测，不是生产 SLA。

| 项目 | 结果与证据 |
|---|---|
| 正常市场投影 | 21,500 个全部发布；168 批、双 RPC 合计 1,075,000 次模拟调用。第二轮首建约 316.6 秒。`capacity.json` |
| 完整分页 | 215 页，21,500 个唯一 marketId，无重复/遗漏；阶段准确为 20,000 / 1,500。`capacity.json` |
| Holder 初始化 | 21,500 个已注册市场全部完成，168 批；第二轮约 670.9 秒。不是单次函数运行 11 分钟。`capacity.json` |
| Transfer 与供应量 | 43,000 条 Transfer 正常回放，21,500/21,500 市场总量对平，约 5.39 秒；单笔增量后余额精确变化 1 raw unit。`daily-incremental.json` |
| 单市场变化 | 只重读一个市场，双 RPC 50 次；版本总行数仅增加 1，旧、新 revision 均各含 21,500 市场。中途版本发布从约 17.5 秒降至约 6.96 秒；随后修复旧版本关闭步骤对大 identity 数组的重复扫描，并将 payload 核验分为每批 250 条。`daily-incremental.json`、`daily-publish-retest.json`、`quiet-block.json` |
| Holder 空区间 | 0 市场 RPC 调用；推进覆盖 checkpoint，不发送快照交易。`daily-incremental.json` |
| 普通 HTTP 混合负载 | 并发 1/4/16/64，各 128 请求均 200；最新实测 64 并发 P95 约 1.03 秒。`http-load.json` |
| 全局统计 HTTP 负载 | 并发 16/64，各 64 请求均 200；64 并发 P95 约 6.25 秒（含重查询排队）。`daily-stats-load.json` |
| 冷库新查询复测 | 未对新 schema 手动 ANALYZE Holder 元数据；Holder/协议统计/全局 series/创建时间排序各 3 次全部 200；与初始化同时运行时 series 最大约 4.52 秒。`daily-cold-read.json` |
| Relay 日常路由 | 43,000 个动态地址、1,500 个池子，约 90 订阅，每片 ≤500。`relay-load.json` |
| Relay 持续短时输入 | 队列 RTT 50ms，100 事件/秒 ×10 秒，1,000 条全部排空，无死信。`relay-burst.json` |

Read API 的同一批混合 Hono 128 请求中，64 并发数据库查询数由无合并时 640 降至 117（第二轮观测）。该指标受请求重叠比例影响，不能推导为所有真实流量固定减少同一比例。

## 对失败记录的解释

`capacity-before-query-fix.json` 和 `capacity.json` 都保留了当时正在运行的旧模块结果，后者 `pass:false` 来自 5 次旧 Holder SQL 超时，不能直接称其整份报告通过。该进程运行中发现并修复冷库慢路径后，以最新模块对同一个新 schema 复测，见 `daily-cold-read.json`，并在后续最新 Read API 验收中再次覆盖。这是带明确替代证据的分阶段验收，没有改写原始失败。

`daily-stats-load-before-admission.json` 保留了最后一轮统计并发中的 21 个 500：全局 series SQL 与其他重查询争抢资源，触发 5 秒限制。加入有界执行队列后，16/64 并发分别 64 请求全部 200；等待时间转为显式 HTTP 延迟，不能将 6.25 秒 P95 描述成亚秒统计。队列仅为单实例控制，多实例总量仍需验证。

浏览器重跑也暴露了后台新市场提示取消分页的问题，补上仅空闲首页允许刷新后再验收。图表测试从固定等待改为等待初始化完成，避免将初始化请求归因于图表切换。

本地 PostgreSQL 在并行创建/销毁测试 schema 期间发生 `Interrupted system call` / `cannot abort transaction ... already committed` PANIC，并自动恢复。保留 `postgres-recovery-excerpt.log`、`db-postgres-recovery-failure.log`、`browser-flows-db-recovery-failure.json`；这一组结果作废。数据库底层异常根因未在本轮确认，不能声称已修复 PostgreSQL 引擎。应用层发现的 idle pool error 导致进程退出已修复，并用只终止自有数据库连接的测试验证；随后串行数据库集成 16/16 通过。

第一次本地浏览器构建未指定测试链导致链身份拒绝；补充 `VITE_V1_CHAIN_ID=46630` 后验证。长时间 fixture 停在旧区块也会被前端 20 分钟新鲜度门槛拒绝；后续通过正常投影推进新的合成最终区块，不修改不可变旧记录或放宽新鲜度校验。

## 运行与剩余边界

1. 尚未远程迁移、RH/Vercel 部署或真实双提供商压测。部署前必须应用完整 `0005_capacity.sql`，迁移角色具备 pg_trgm 权限，历史汇总回填与 trigger 安装期间锁住交易写入；不得在回填窗口漏记新交易。Vercel 仍要求 `sin1` 实际函数检查。
2. 首次初始化仍较重。市场发现/manifest 核对仍有全人口成本；Holder 首次事件解码在多次续跑中仍有重复工作。活跃 staking 或全局配置变更可能引发较大重读集。本轮解决容量截断和可续跑性，不宣称完成无限规模优化。
3. Relay 8 并发在 200ms 队列 RTT 下，本地批次交付约 32 条/秒；不能承诺在该延迟下持续处理 100 条/秒。提高并发需结合队列配额、数据库连接和实测，监控积压年龄及 dead。超过 HTTP 补偿范围需受控补历史，不能跳块。
4. 21,500 市场规模不等于任意数量的 staking 账户或单市场 Holder。本轮未解除 principal 的 10,000 账户/分配上限、手动单市场快照的 10,000 地址/1,000,000 Transfer 回放上限，以及部分历史回放边界；大账户规模需独立方案和资金对账验收。
5. 暂未完成 50,000/100,000 市场增长档、24/72 小时持续压力、真实 RPC 限流/订阅配额、服务端多实例与公网浏览器流量验收。USD 无可信价格/历史覆盖仍显示不可用，不以 `$0` 填充。
6. Creator 收益权交接及紧急退出仍无前端入口；LP 复投保留文档说明；Holder 周期发布保持禁用。

复现命令：`tools/full-local-integration/README.md`。运行与迁移说明：`docs/operations/CAPACITY_INDEXING.md`。

本轮收尾：当前 Read API、Vite 与容量构造进程已停止，两个容量人口 schema 已移除，原有 PostgreSQL 保留（`cleanup.json`）。源码指纹见 `source-sha256.json`，证据完整性见 `SHA256SUMS.json`；工作区未提交，文件 hash 用于标识本次实际测试代码。
