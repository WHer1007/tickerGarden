RH 测试网本地阅读材料：[网络、官方资产、v4 池、部署快照与自动首买](./v1/V1_ROBINHOOD_TESTNET_REFERENCE.md)。

RH 主链生产研究参考：[Stock Token 全量名录](./references/RH_MAINNET_STOCK_TOKEN_CATALOG_2026-09-12.md)、[交易池与深度登记](./references/RH_MAINNET_STOCK_POOL_DEPTH_2026-09-12.md)。2026-09-12 快照覆盖 194 个官方资产，附地址、价格、图标、池状态、分档双向报价及 CSV/JSON；数据覆盖边界和待核实项见报告，不改变生产准入状态。

# Documentation

生产准备与发布索引：[2026-09-15 生产发布准备报告](./reviews/PRODUCTION_RELEASE_PREPARATION_2026-09-15.md)；[RH 主网发布 Runbook](./runbooks/RH_MAINNET_RELEASE_2026-09-15.md)。旧版[2026-09-14 生产部署检查单](./reviews/PRODUCTION_DEPLOYMENT_CHECKLIST_2026-09-14.md)仅作历史证据保留。

前端最新版合约对齐：[功能、提示、Docs 与验证记录](./reviews/FRONTEND_CONTRACT_ALIGNMENT_2026-09-13.md)。快照领取后端接口及上线前提见文内说明。

RH 测试网新快照合约：[2026-09-13 再审查、验证与部署记录](./reviews/RH_TESTNET_SNAPSHOT_RELEASE_REVIEW_2026-09-13.md)。

生产 Stock Quote 参数：[194 个资产的 7,000 USD 等价毕业阈值与 40% 虚拟储备](./references/RH_ALL_STOCK_QUOTE_THRESHOLDS_2026-09-12.md)。生产共 196 种 Quote（194 Stock + ETH + USDG），194 种 Stake 最低总仓位均为 0.5。含两位小数毕业阈值、价格乘数、来源时间与舍入误差，尚未链上激活。见[全量资产激活说明](./runbooks/RH_MAINNET_ALL_ASSETS.md)。

生产 Quote 明确选择：[RH 官方 USDG 接入记录](./runbooks/RH_MAINNET_USDG_QUOTE.md)。资产已在候选清单；毕业阈值 7,000 USDG、虚拟储备 2,800 USDG 已批准，待完成链上激活。

RH Stock Vault 生产兼容性补充：[Rebase、股份乘数与发行方权限复核](./reviews/RH_STOCK_TOKEN_VAULT_COMPATIBILITY_2026-09-12.md)。当前乘数机制兼容原始 Token 本金账；验证实现具有任意地址销毁、冻结、暂停及 Beacon 升级能力，不能据此承诺本金绝无外部减记。

Documentation is separated by authority and lifecycle:

| Path | Status | Purpose |
| --- | --- | --- |
| [`v1/`](./v1/README.md) | Canonical | Current V1 product, architecture, security decisions, and readiness gates |
| [`test-prototype/`](./test-prototype/README.md) | Historical | Superseded pre-V1 prototype records retained for audit context |

The user-facing explanation of how the Platform uses its share of protocol-fee revenue is available in [`PLATFORM_REVENUE_USE.md`](./PLATFORM_REVENUE_USE.md): 70% for asset reserves and liquidity, 20% for weekly community-project market buybacks and burns, and 10% for platform operations. It also explains the planned future airdrop; no platform token has been launched. This is a use-of-revenue policy for the Platform share, not a change to contract fee allocation.

Machine-readable protocol truth remains under [`spec/`](../spec/). Research evidence, brand assets, generated analysis outputs, and retired application code remain in their dedicated top-level directories.

V1 当前 Serverless 开发任务见 [`v1/V1_TYPESCRIPT_SERVERLESS_DEVELOPMENT_TASKS.md`](./v1/V1_TYPESCRIPT_SERVERLESS_DEVELOPMENT_TASKS.md)：采用 TypeScript + Node.js 24 + Hono、PostgreSQL、持久队列，以及 VPS 上的 Alchemy WebSocket `eth_subscribe("logs")` relay；两个 Custom Webhook 已因逐块投递实测删除。只实现 `apps/web` 所需功能；测试 relay 与 Pipeline Preview 已部署，真实匹配事件及重组恢复仍待验收，生产链读取保持关闭。

后续开发研究参考：[BNB Chain bStocks 质押发射台可行性](../research/BNB_BSTOCKS_INTEGRATION_FEASIBILITY.md)。该文档不属于已冻结的 V1 执行规格，不改变当前部署目标或生产准入状态。

人工管理入口：[合约管理员安全操作与参数设置手册](./v1/V1_ADMIN_OPERATIONS_MANUAL.md)。包含当前 Arbitrum Sepolia R2 地址、权限移交、延迟执行、白名单、奖励兑换与持有人分配操作。

代币详情页开发参考：[冻结页面结构](./planning/TOKEN_DETAIL_FRONTEND_BASELINE.md)、[数据接口与统计口径](./planning/TOKEN_DETAIL_DATA_CONTRACT.md)、[Dune 测试网接入](./planning/DUNE_TESTNET_SETUP.md)、[SQL 与上传工具](./dune/README.md)。

Holder 后台自动化待办：[批量归集、到账确认、快照发布与领取联调 TODO](./planning/HOLDER_AUTOMATED_SNAPSHOT_DESIGN_2026-09-13.md)。合约批量入口已完成，自动化暂不实施或启用。

当前合约复核：[安全边界与 11 项优化建议](./reviews/CONTRACT_OPTIMIZATION_REVIEW_2026-09-13.md)。基于 Holder 快照和批量归集后的工作区，含交易与 Gauge 耦合、发布钱包应急撤销、资产异常影响及回归证据。

实施结果：[交易优先、发布者撤销、偿付补足与独立校验工具](./reviews/CONTRACT_OPTIMIZATIONS_IMPLEMENTED_2026-09-13.md)。CO-06／08 保持已确认设计，CO-05 暂时维持原退出规则；自动化仍为 TODO。

日常规模优化验收：[21,500 个市场的事件、增量索引、统计、Holder 与推送测试报告](./reviews/CAPACITY_OPTIMIZATION_REPORT_2026-09-14.md)；[迁移和运行要求](./operations/CAPACITY_INDEXING.md)。本地证据不等同于 RH/Vercel 生产就绪。
