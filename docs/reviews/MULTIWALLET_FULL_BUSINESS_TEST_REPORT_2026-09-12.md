# TickerGarden 多钱包全业务链路测试报告

- 执行日期：2026-09-12（Asia/Shanghai）
- 环境：Robinhood Chain Testnet，chainId `46630`
- Release：`0x5c2c656b1b23e895ea268c34b187cd267e0f4fdcc1759c726cbca7fafb7c9c12`
- 前端：<https://tickergarden-web-test.vercel.app>
- Read API：<https://tickergarden-read-api-test.vercel.app>
- 结论：**测试环境核心业务链路通过；生产环境保持关闭，不构成生产发布批准。**

## 1. 测试策略与资产使用

本轮复用 2026-09-11 已创建的 12 个测试市场及其可恢复交易日志，继续执行此前尚未到达时间条件的奖励领取、正常退出、紧急退出和延迟结算。这样可以验证长生命周期状态，又避免重复消耗测试 ETH。主钱包执行前约有 `1.373 ETH`，重新创建完整 12 市场矩阵预计需要约 `1.98 ETH`；现有 Bob、Dave 仓位已具备足够 Stock 本金，因此没有到测试池额外购买 Stock。

参与钱包均为独立测试 EOA，私钥未写入报告或 Git：

| 角色 | 地址 | 主要职责 |
|---|---|---|
| main | `0xA6c3298a5559544c3b4cf8e6DC5f349f4be524ea` | 测试资金、跨角色编排 |
| alice | `0x2a795156A8afBDC72B33935A09a0B35A5312BF71` | 创建者、交易参与者 |
| bob | `0xFdae1f6297a5b92953faBC8C6A832988eC473c0F` | 交易、质押、奖励领取、正常退出 |
| carol | `0x0228732c15E572DD364695C4eE957d2894b104c6` | 创建者、交易参与者 |
| dave | `0xc67d7F7e4d25e850013bFC8A4465Fba2D6cEC2a2` | 交易、质押、奖励领取、rage quit 与结算 |

## 2. 业务链路覆盖

| 业务域 | 覆盖场景 | 结果 |
|---|---|---|
| 市场创建 | 4 个创建者角色、12 个参数组合、Stock/Quote 绑定、staking/holder 开关 | 通过 |
| 曲线交易 | Buy、Sell、零金额、毕业后曲线交易拒绝 | 通过 |
| Bloom/毕业 | 3 个市场毕业、真实 Uniswap v4 池绑定、池内买卖及内部转换区分 | 通过 |
| 费用 | creator/staker/holder/platform 分配、51 笔曲线成交、9 笔池记账、15 次 sweep | 通过，303 项断言 |
| 质押 | Stock 本金入 Vault、Gauge 仓位、2 个钱包/2 个市场 | 通过 |
| 奖励 | 到期前拒绝、到期后 4 次 staker claim、creator claim、资产选择与转换分支 | 通过 |
| 正常退出 | Bob 在两个市场执行 `unstakeAndWithdraw`，本金精确返还 | 通过 |
| 紧急退出 | Dave 在两个市场执行 `rageQuit`，先返本金，再 permissionless settle 清理奖励状态 | 通过 |
| 偿付能力 | FeeVault 各资产余额不低于总负债 | 通过 |
| 索引与恢复 | Alchemy 事件后补、队列投递、最终区块投影、重复执行幂等 | 通过 |
| API 安全 | CORS allow/deny、只读 POST 拒绝、伪造 relay 401、并发健康请求 | 通过 |
| 浏览器 | 桌面/移动端核心路由、钱包连接、账户切换、错误网络失效、CSP/cache/404 | 通过，18 个路由检查 |

链上日志累计记录 **179 笔成功交易、0 笔失败交易**。本轮新增 10 笔确认交易：

| 操作 | 交易哈希 | 区块 |
|---|---|---:|
| Bob claim market 0 | `0x58e4391f17e765f728bf6662ce1eece0073df80164bcd46fe2f6c19f3a9ffb2b` | 117660157 |
| Dave claim market 0 | `0x6e9fff782b4d2ed1070e0042bb1921e69a8a343698b1e8a4ccc795ca5b08ab44` | 117660186 |
| Bob claim market 2 | `0x33a1097ea985c364726183894b0562e5d999bf4898f72fbaeac3e02a5e1ede10` | 117660233 |
| Dave claim market 2 | `0x775bc0f5e8bd1ec02209fad3a37de983efa7de7c8c68ece1219aa02859000fbe` | 117660261 |
| Bob normal exit market 0 | `0xb9db2520291eb85aeed59f700cca66a24e232872867bca77bf19661e254c1940` | 117660930 |
| Dave rage quit market 0 | `0x1b1ede02ded2ca6cacadbaccdba1db25ed897587513be1f155599f54168a0855` | 117660947 |
| Dave settle market 0 | `0xcb3a3b3f685025b61733340b834d7ca2ef2e06fa33e6fc7192771cc3f43e2b0e` | 117661364 |
| Bob normal exit market 2 | `0x1c7027652f49e08ef6cb7564dced860a98b7b71a075e8153087cb18b9d74feaa` | 117661378 |
| Dave rage quit market 2 | `0x3ee408d4a6313799c3f56ca8e174254e232e9ef4b8330393f5496e56591d2e3e` | 117661397 |
| Dave settle market 2 | `0x1f7aa3421850e971fc0d558c79c0243732613c43f86a5a465d31ca0ec3477adc` | 117661418 |

投影检查点已到区块 `117663114`，高于本轮最后一笔交易区块；退出后的最终状态已经进入 Read API。

## 3. 自动化与一致性结果

| 检查 | 结果 |
|---|---|
| Solidity 普通测试 | 934/934 通过 |
| Solidity 产品轨 | 315/315 通过 |
| Robinhood mainnet 固定区块 Fork | fixture 6/6、E2E 2/2 通过 |
| TypeScript serverless/offchain | 9/9、45/45、62/62 通过 |
| Web | 326/326 通过 |
| RPC capability gateway | 8/8 通过 |
| 链上最终状态审计 | 100 项通过，0 deferred |
| 费用与收据审计 | 303 项通过 |
| API/数据库统计审计 | 23 项通过 |
| Analytics DB 定向集成测试 | 1/1 通过 |
| 全仓构建 | 通过 |

统计中的历史 USD 覆盖当前不可用，API 按设计返回 `null/Unavailable`，没有伪造为 `$0`；原始链上数量、市场数、Bloom 数、staking 当前状态和费用桶一致性均通过。

## 4. 测试中发现并完成的修改

1. 多阶段测试恢复时，已完成的 creator claim 会使旧的“中间余额保持不变”断言失效。测试器现在根据已确认的下游交易跳过过期中间断言。
2. 签名能力文件会过期。所有非 prepare 模式现在都会刷新精确约束的 capability，重跑不再因 stale token 获得 RPC 502。
3. 新增可幂等恢复的 `exits` 测试模式，覆盖 normal exit、rage quit 的本金优先语义和后续 permissionless settle。
4. 状态与统计审计改为从已确认退出交易推导当前仓位，避免把历史质押量错误当成当前质押量；市场目录改用当前 `/v1/markets` 接口；24 小时费用按窗口内自洽性验证。
5. 浏览器验收支持代理网络路径，忽略 AbortController 和页面跳转产生的预期 `net::ERR_ABORTED`，平台 header 与 404 也通过浏览器网络验证。
6. `/v1/market-statistics` 去除逐市场 N+1 查询；latest trade、latest buy、volume 改为批量查询，覆盖、价格和市场读取并行。
7. `/v1/protocol-statistics` 的 checkpoint、ingestion point、费用、市场和持仓读取并行。
8. `/v1/stats/series` 从每个时间桶重复访问数据库，改为一次读取后在内存分桶。集成测试中的接口耗时由约 **10.14 秒降至 0.36 秒**。
9. 部署计划 JSON Schema 的 `configurationInputs` 上限从 22 扩展至 27，使当前 27 项配置能进入语义一致性校验；保存的旧 testnet plan 仍被部署门禁明确拒绝。
10. Vercel 独立部署仓库的范围检查会误报 CLI 自己创建的 `.vercel` 目录，现已将该本地元数据目录排除；`.env.local` 仍严格拒绝并已删除。

修复后的 Read API 已发布到测试别名。VPS 对测试域名的四接口并发测试均返回 200：冷实例约 3.91–5.73 秒，热实例约 0.11–0.14 秒；24 桶 series 冷请求为 2.30 秒。浏览器部署后复测无失败。

## 5. 未关闭的门禁与边界

- 当前保存的 `robinhood-testnet-46630.v1.plan.json` 仍是旧部署计划，ordinary component order 包含 `TreasuryDistributorV1`，而当前代码要求 `HolderRewardsDistributorV1`。因此 `check:deployment-track` 的 live-plan 步骤继续失败。这是有效的发布阻断，不能把本轮测试结论升级为生产就绪。
- 完整数据库集成套件并发执行时出现一次 PostgreSQL lock timeout，串行执行时又出现 VPS 公网连接 timeout；相关 analytics 定向集成测试随后通过。它暴露的是跨公网直连数据库的稳定性风险，生产前应把 Vercel Function 与数据库放在低延迟私网/托管连接池路径，并保留 statement timeout。
- 自动化浏览器使用注入式测试 provider 验证连接、切换账户和错误网络，未自动点击真实 MetaMask/OKX 扩展确认窗口。真实链上写入由 5 个独立 EOA 的受限签名测试器完成。生产前仍需一次真实扩展钱包人工验收。
- 前端构建仍提示主入口约 667 kB、Phosphor SVG 约 3.0 MB；不影响本轮正确性，但属于下一轮资源拆分与图标裁剪目标。
- 生产链事件读取与生产 worker 保持关闭，本轮没有启用或测试生产资金路径。

## 6. 证据位置

- 完整交易日志：`outputs/reviews/asset-selection-2026-09-11-matrix/results.json`
- 链状态：`outputs/reviews/asset-selection-2026-09-11-matrix/chain-state-audit.json`
- 费用审计：`outputs/reviews/asset-selection-2026-09-11-matrix/fee-split-audit.json`
- 统计审计：`outputs/reviews/asset-selection-2026-09-11-matrix/statistics-audit.json`
- 本轮命令日志、浏览器证据、API 压测与构建输出：`outputs/reviews/multiwallet-full-2026-09-12/`
