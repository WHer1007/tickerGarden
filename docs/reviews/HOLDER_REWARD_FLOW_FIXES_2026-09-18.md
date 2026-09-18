# Holder 奖励链路修复与本地验收

日期：2026-09-18。对应 `HOLDER_REWARD_FLOW_AUDIT_2026-09-18.md` 的 H1–H7。开发分支：`codex/holder-flow-hardening`；基线 `be485c3f43ebdeb2abe14fecb881cf09b5a56e69`。本次为代码实现和本地验证，未发布测试/生产，未执行真实钱包交易，未开启定时归集、快照发布或 Keeper 自动复投。

## 修复内容

| 项目 | 实现 | 验收证据 |
| --- | --- | --- |
| H1 分页失效 | 游标绑定 generation 和已发布轮次承诺，领取位图/市场观察区块改变不使其失效。新发布/重组返回 409 时，只重取一次第一页，保留钱包、市场及请求代次隔离 | 他人领取并推进区块、新发布、generation 变化、跨钱包游标、前端 409 恢复测试 |
| H2 轮次顺序与空中间页 | SQL 按当前钱包的实际权益分页，轮次从新到旧；默认选择已加载列表中最新的可领取轮次，保留手动选择；合并旧页时保持降序 | 钱包只有第 21 轮权益可直接读到；旧页合并、重复轮次/跨账户拒绝及 Quote/Meme 独立领取测试 |
| H3 坏轮次隔离 | 单轮归档/证明损坏不会阻塞健康轮次；返回 `complete`、`unavailableRounds`，复用现有状态区，不新增页面组件。增加分页 `audit` 和可恢复 `repair` 操作 | 缺失 dataset、坏 header、坏 proof、健康奖励可读、修复后恢复完整状态测试 |
| H4 重复全量工作和账户上限 | 持久余额账本按页复制/重放；后续快照只 RPC 核对发生变化的账户，包括清零账户。Merkle 节点和 wallet proofs 分片落库；完整 header 最后发布。历史校验证据绑定 artifact digest、区块及 generation，发布预验复用 | 分页中断恢复、增量核验两个变动账户、generation 失效、100,001 Holder 合成容量测试 |
| H5 发布吞吐及确认 | CLI 一笔支持 1–32 个不同市场。最终在新锚点模拟完整批次；签名前重读 nonce；回执逐个匹配发布事件。默认依据 `finalized`，明确选用 `delay` 时默认/最低 60 秒。Holder 与 Locker 同钱包使用共享持久 signer lane | 两市场精确 calldata/回执、混合已发布拒绝、最终确认不可用、nonce 变化、不确定广播原文保留/恢复、跨服务互斥测试 |
| H6 投影扩容 | 日志每次最多暂存 500 条，市场 RPC 保持每次最多 128 个；按完整区块范围推进检查点，最终用 SQL 集合操作提交，避免把全部暂存事件/市场重新装入 JS。续作标识包含区块和阶段，避免重复任务键阻断后续窗口 | 129 市场续作、两个稀疏繁忙区块共 2,002 个事件、5 次不同续作标识、未完成阶段不公开、重组回滚测试 |
| H7 锁恢复 | 新锁记录 host/PID/token。显式恢复必须匹配 token 且本机 owner PID 已死亡；不按锁龄删除，不删除 journal，也不解除未决 signer reservation | 活跃进程、错误 token、外部主机拒绝；死亡进程解锁且 pending 文件原文保留；原服务恢复/跨服务阻止测试 |

排序选择：分页采用稳定的轮次降序，默认选中最新未领轮次；不按实时领取位图重排整个分页集合，避免领取发生时把轮次移出游标范围而造成遗漏。已领轮次仍可在原位置查看。

H6 的原子边界是完整链上区块。常规窗口约 1,000 个事件；超过此数量的单个繁忙区块仍按 500 条暂存，但整块使用一次 SQL 事务公开。它不把历史全部加载入内存，也不会在同一块内公开半份结算状态；不承诺每次最终 SQL 提交严格只有 1,000 行。

## 新的数据格式与权限

新增迁移 `services/backend-ts/packages/db/migrations/0024_holder_recovery.sql`：

- `holder_snapshot_work`、`holder_snapshot_balances`、`holder_snapshot_nodes`：私有计算进度、余额及树；Pipeline 可读写，Read API 不可读取。
- `holder_snapshot_evidence`：已验证 artifact 的区块/generation 证据；Pipeline 只允许 SELECT/INSERT，不允许 UPDATE/DELETE。
- 事件暂存游标、待核验余额索引和钱包降序轮次索引。

默认 CLI 生成 `TICKERGARDEN_HOLDER_MANIFEST_V2`；不改变链上 Merkle leaf 或合约接口。旧 V1 完整 dataset 仍可验证、发布与修复，旧格式兼容构建器保留 100,000 账户上限；新的 V2 准备流程没有此上限。

V2 manifest 自身不是完整领取档案。必须保留 dataset、wallet proofs、work、balances、nodes 和 evidence。修复依赖这些归档；不能通过修改已经发布的 Root 来修复归档。新轮次复制基线和生成全部证明仍有与账户数成比例的数据库工作量，但分页执行，不重复重放全部历史或核验所有未变账户。

`audit` 是显式分页运维检查，未新增自动监控或备份计划；`complete` 反映读取时的轮次/归档头及可见证明检查，不代替对整个归档逐页审计。

## 本地测试

使用 Node v24.19.0、本地 PostgreSQL 独立临时 schema；没有连接生产数据库或发送主网交易。

| 检查 | 结果 |
| --- | --- |
| 前端全量测试及生成文件/类型检查 | 626/626 通过 |
| 后端完整门禁 | 174/174 单元测试，13/13 HTTP/接口测试通过；OpenAPI、覆盖检查、打包边界及类型检查通过 |
| 数据库全量集成 | 41/41 常规用例通过；容量用例默认跳过，另行显式运行通过 |
| 100,001 Holder 容量回归 | SQL 注入已核验余额账本，318 个有界步骤，生成 100,001 个证明，约 53 秒；步骤边界采样 JS heap 约 33.2–98.7 MB |
| Locker 原有测试 | 8/8 通过 |
| Solidity 钱包快照及后端向量 | 21/21 通过 |
| Web/Backend 构建 | 通过；Web 资源预算、12 个预渲染页面和 SEO 检查通过 |
| 差异检查 | `git diff --check` 通过 |

容量测试发现并修复了数据库把节点序号的文本别名按字典序排序的问题，树/证明现在显式按数值排序。该容量数据是合成账本，验证分片生成与恢复能力，不代表实际主网 100,001 次 RPC 核验的耗时或生产吞吐量。

第一次全量数据库测试与并行容量任务重叠，出现 analytics 测试数据库语句超时；未放宽数据库超时或断言，停止容量并发后重跑全套通过。新权限、归档修复及最后的发布校验修改也分别做了针对性复测。

主要命令：

```sh
npm --prefix apps/web test
npm --prefix apps/web run build
npm --prefix services/backend-ts test
npm --prefix services/backend-ts run build
TG_TEST_DATABASE_URL='postgresql:///postgres?host=/tmp' \
TG_MIGRATION_DATABASE_URL='postgresql:///postgres?host=/tmp' \
npm --prefix services/backend-ts run test:integration
TG_HOLDER_CAPACITY_TEST=1 TG_TEST_DATABASE_URL='postgresql:///postgres?host=/tmp' \
node --experimental-strip-types --test services/backend-ts/tests/integration/holder-sharded.test.ts
npm run test:locker-worker
# contracts 目录
FOUNDRY_PROFILE=v1 forge test --match-path 'test/v1/treasury/product/*Snapshot*.t.sol'
```

## 发布前置条件与边界

1. 测试、生产各自先执行 `0024_holder_recovery` 并更新数据库权限，再按环境分支规则更新 Worker、Read API、前端。
2. Holder publisher 与 Locker Keeper 如共用一个钱包，必须在同主机配置相同的 `TG_SIGNER_COORDINATION_DIR`；首次接入前核对旧 journal 和未决交易。未接入协调的外部钱包程序仍不能并行发交易。多机执行需另做分布式 signer 协调。
3. V2 准备/修复返回退出码 2 表示进度已保存，继续相同命令；不是丢弃已完成工作重来。
4. 自动发布、自动复投和数据库自动备份保持原有启用状态，本次未开启。无合约修改或重新部署要求。
5. 尚未做浏览器真实钱包签名验收、主网 Fork 发布流程或线上部署验证。此报告不是独立外部安全审计，也不是生产发布完成证明。

操作细节见 `docs/operations/HOLDER_SNAPSHOT_BACKEND.md`。
