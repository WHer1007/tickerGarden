RH 测试网本地阅读材料：[网络、官方资产、v4 池、部署快照与自动首买](./v1/V1_ROBINHOOD_TESTNET_REFERENCE.md)。

# Documentation

Documentation is separated by authority and lifecycle:

| Path | Status | Purpose |
| --- | --- | --- |
| [`v1/`](./v1/README.md) | Canonical | Current V1 product, architecture, security decisions, and readiness gates |
| [`test-prototype/`](./test-prototype/README.md) | Historical | Superseded pre-V1 prototype records retained for audit context |

The user-facing explanation of how the Platform uses its share of protocol-fee revenue is available in [`PLATFORM_REVENUE_USE.md`](./PLATFORM_REVENUE_USE.md): 70% for a stock development reserve, 20% for a weekly Meme buyback and burn, and 10% for platform expenses. This is a use-of-revenue policy for the Platform share, not a change to contract fee allocation.

Machine-readable protocol truth remains under [`spec/`](../spec/). Research evidence, brand assets, generated analysis outputs, and retired application code remain in their dedicated top-level directories.

后续开发研究参考：[BNB Chain bStocks 质押发射台可行性](../research/BNB_BSTOCKS_INTEGRATION_FEASIBILITY.md)。该文档不属于已冻结的 V1 执行规格，不改变当前部署目标或生产准入状态。

人工管理入口：[合约管理员安全操作与参数设置手册](./v1/V1_ADMIN_OPERATIONS_MANUAL.md)。包含当前 Arbitrum Sepolia R2 地址、权限移交、延迟执行、白名单、奖励兑换与持有人分配操作。

代币详情页开发参考：[冻结页面结构](./planning/TOKEN_DETAIL_FRONTEND_BASELINE.md)、[数据接口与统计口径](./planning/TOKEN_DETAIL_DATA_CONTRACT.md)、[Dune 测试网接入](./planning/DUNE_TESTNET_SETUP.md)、[SQL 与上传工具](./dune/README.md)。
