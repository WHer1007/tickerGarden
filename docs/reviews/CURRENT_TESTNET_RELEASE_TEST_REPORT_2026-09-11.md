# 最新合约测试链部署与测试报告

日期：2026-09-11（Asia/Shanghai）。链：Robinhood Testnet，Chain ID 46630。

## 结论

最新版本已经部署、激活并切换到独立测试数据。部署前复核及本轮测试未发现阻止测试网联调的合约资金安全问题；这不是主网上线批准，也不是无风险保证。

**合约及核心链路通过；统计展示存在 2 项未解决限制。公共链自然到期的 4 个质押仓位尚未领取，到期行为已经在新部署状态的本地分叉验证。**

发布标识：`0x5c2c656b1b23e895ea268c34b187cd267e0f4fdcc1759c726cbca7fafb7c9c12`。

本次运行使用新合约、新数据库和 4 个新测试钱包；前端与后端仅加载这一发布。旧数据库及历史文件保留为历史记录，不参与当前查询，不迁移旧市场或兼容旧奖励接口。master 环境未改动。

## 验证结果

| 范围 | 结果 | 证据 |
|---|---|---|
| 合约单元、模糊及不变量测试 | 934 通过，84 个测试套件，0 失败/跳过；不变量 runs=128、depth=128 | [local-contracts.log](/Users/dear/Documents/code/TickerGarden/outputs/reviews/asset-selection-2026-09-11/local-contracts.log) |
| 真实部署状态分叉 | 11 通过，0 失败/跳过；锁到期以本地时间推进验证 | [deployed-fork-tests.log](/Users/dear/Documents/code/TickerGarden/outputs/reviews/asset-selection-2026-09-11/deployed-fork-tests.log) |
| 公开测试链业务 | 169 笔交易成功，57 项断言；含预期回滚的负面用例 | [results.json](/Users/dear/Documents/code/TickerGarden/outputs/reviews/asset-selection-2026-09-11-matrix/results.json) |
| 独立手续费回执复算 | 291 项通过；51 笔曲线交易、9 次池手续费入账、15 次归集 | [fee-split-audit.json](/Users/dear/Documents/code/TickerGarden/outputs/reviews/asset-selection-2026-09-11-matrix/fee-split-audit.json) |
| 固定区块状态及资金检查 | 100 项通过；4 项自然到期用例待公共链解锁 | [chain-state-audit.json](/Users/dear/Documents/code/TickerGarden/outputs/reviews/asset-selection-2026-09-11-matrix/chain-state-audit.json) |
| 后端统计对账 | 67 项通过，1 项失败：24h-fee-coverage；USD 源不可用另列 | [statistics-audit.json](/Users/dear/Documents/code/TickerGarden/outputs/reviews/asset-selection-2026-09-11-matrix/statistics-audit.json) |
| 前端测试 | 314 通过，0 失败/跳过 | [web-tests.log](/Users/dear/Documents/code/TickerGarden/outputs/reviews/asset-selection-2026-09-11/web-tests.log) |
| 前端生产构建 | 通过；存在已有 chunk 大小提示 | [web-build.log](/Users/dear/Documents/code/TickerGarden/outputs/reviews/asset-selection-2026-09-11/web-build.log) |
| 部署与环境工具测试 | 21 通过，0 失败/跳过 | [tooling-tests.log](/Users/dear/Documents/code/TickerGarden/outputs/reviews/asset-selection-2026-09-11/tooling-tests.log) |
| Go 后端 | go test ./... 通过；需专用环境的集成用例可能按自身条件跳过，不能等同全部 Postgres 集成测试 | [backend-full-tests.log](/Users/dear/Documents/code/TickerGarden/outputs/reviews/asset-selection-2026-09-11/backend-full-tests.log) |

产品产物清单、前端 ABI、后端事件生成检查通过，git diff --check 通过。当前公开 API 使用新数据库完成实测。没有将旧 Treasury 测试删除后的通过数冒充新增业务覆盖：本次保留当前奖励、Creator 与候选快照测试，并移除了不再适用的旧业务断言。

## 部署与参数

部署前首次预检识别出旧编译缓存，未广播；强制重新编译后再完成模拟、部署及代码核验。19 笔部署交易、4 笔核心激活、10 笔 Stock 登记/批准成功，21 个部署组件的运行时代码与本地构建匹配。

| 参数 | 本次测试配置 |
|---|---|
| ETH 毕业门槛 | 0.42 ETH |
| ETH 虚拟储备 | 0.168 ETH |
| 代币发行量 | 每个市场 1,000,000,000 枚，18 位小数 |
| 曲线基础手续费 / v4 poolFee | 1% / 0 |
| Creator tax 测试范围 | 0%、0.25%、1%、1.25%、2.5%、5% |
| Anti-snipe | 5 秒 |
| 质押本金锁 / 权重激活 | 24 小时 / 30 秒 |
| Holder 释放 / 注入间隔 | 24 小时 / 默认 4 小时，可配置 |
| 质押最低数量 | 1 Stock |
| 领取 | Quote / Meme / 两者；原币或领取时兑换 |
| 兑换最低到账 | 未设置价格下限，按既定业务规则 |

部署 Gas 费用 0.00057858847 ETH；核心激活 0.00008448513 ETH；Stock 登记/批准 0.00064015125 ETH，合计 **0.00130322485 ETH**。以上不含业务交易 Gas。主钱包向 4 个测试钱包共划转 1.98 测试 ETH，这是测试资金划转，并非全部费用。

### 合约地址

| 组件 | 地址 |
|---|---|
| AccessManager | `0x1a957fd74ef4d8b910C1a8BF9Fd0e603f528eaf7` |
| OfficialStockRegistryV1 | `0xB214ffa2D11f6B0bd117bc41D6D51800c52eF928` |
| ApprovedQuoteRegistry | `0x93c8Ce0e44C2eD39399ff12821454D681C0b5353` |
| TickerGardenBaselineRegistry | `0x78C1526860e0Da4acDc6f32A4F4F8d45bbDE0933` |
| LaunchTemplateRegistry | `0x7b0Be869B940c61CBB1Cb90655dC34aac329fc63` |
| LaunchConfigResolver | `0xec83F932b08f8cb6120B2E38eBA5B9CEa9c9a4Ad` |
| TickerMemeTokenV1Implementation | `0xceE84a87Cfb105A7fBf2095D7BFcdb7cB62E69b8` |
| TickerGardenCurveImplementation | `0xe1203B34dc94539c9D9038A51FBFe072D6FBDF98` |
| MemeStockGauge | `0x576a9311aE4c142269ED3d9047893682a3350037` |
| LaunchAndBuyRouter | `0x0923719faaF02f1e512FB62f69Bda312447CBD60` |
| MarketRegistryV1 | `0x03F8A6E75Ce7BF707076d7339968F8FDf5703B16` |
| CreatorRevenueRegistry | `0x789aeed3c72E58CF09AD0F325EC62148a958A0Af` |
| AllocationManager | `0xe737F06BffA94F4Bd9Eb233ca344fdEa4D796452` |
| UserStockVault | `0xA608276C7273373A7961cdb01e7505C385744EAa` |
| HolderRewardsDistributorV1 | `0x88DfA615583AbFBffed04a40E902d41cc550c992` |
| ProtocolFeeVault | `0x9cba4929745077198393f09AD2F409DB43C90da9` |
| V1RobinhoodTestnetDeploymentOrchestrator | `0x4244AF68283F0C695ded583D3EAB82f13b386C95` |
| V1HookExecutorDeployer | `0xA673d432732ea932438FF1Ad076d9e627A3E5558` |
| TickerGardenMemeHook | `0xf5e89AF0949745FE497b22D1214FEA3DAA75A044` |
| GraduationExecutor | `0xed1E7c1256e848D520677A017263d75f5377706C` |
| TickerGardenFactoryV1 | `0x496A3cB9Fd8a045c590F311e948b2b4382F17904` |

完整部署和代码哈希：[robinhood-testnet-46630.v1.deployed.json](/Users/dear/Documents/code/TickerGarden/deployments/manifests/robinhood-testnet-46630.v1.deployed.json)

## 实际创建的市场

ETH 与 TSLA、AMZN、PLTR、NFLX、AMD 均有市场。8 个启用质押、4 个关闭；6 个启用 Holder 分成、6 个关闭。交易参数和钱包交叉组合，使用确定性测试矩阵，便于复现。

| Symbol | Quote | Creator tax | 质押 | Holder | 阶段 | Token |
|---|---|---|---|---|---|---|
| GQA01 | ETH | 0% | 开 | 开 | Bloomed | `0x1fB7490f212d5b13E4fc8CdF287c4Fc83545dCaB` |
| GQA02 | ETH | 0.25% | 关 | 关 | Bloomed | `0xc9B61e23a79bd7A95254487ADa4f1f5e6393F413` |
| GQA03 | ETH | 1% | 开 | 开 | Bloomed | `0xE4676f8b4c4Df9F66F0c833c5ee57cD588bD5ed0` |
| GQA04 | ETH | 2.5% | 开 | 关 | Growing | `0x7F4fa8AAAcaF7D4aB18B6b806e2aa810dd318476` |
| GQA05 | ETH | 5% | 关 | 开 | Growing | `0x833C32C692C23402Ef89FFCdCB46D01684D96F5D` |
| GQA06 | ETH | 1.25% | 开 | 关 | Growing | `0xe531a2315BB1e2DA3ECB471E1CAf5C29cf349354` |
| GQA07 | ETH | 0% | 开 | 开 | Growing | `0x41cC7A41b782B14Ca0f986748478Fb9C8286f68D` |
| GQA08 | TSLA | 0.25% | 关 | 关 | Growing | `0x43A463d42B12EF0BEE8650df9FB507E90E49c43B` |
| GQA09 | AMZN | 1% | 开 | 开 | Growing | `0x4AD72115752a3928711cb5fbC79C93DdDDf6df57` |
| GQA10 | PLTR | 2.5% | 开 | 关 | Growing | `0xEefaD68D1A078594f6ECc10D5CF5bBA18b7deE38` |
| GQA11 | NFLX | 5% | 关 | 开 | Growing | `0x8985e768B85385a271db84808B81f4dfb6C2e9b3` |
| GQA12 | AMD | 1.25% | 开 | 关 | Growing | `0x7FE0961DC76fFD5817378D7637076C53C910b2Fe` |

完整 marketId、池参数、创建区块、钱包地址及交易哈希保存在 results.json，后续测试应直接复用此清单。测试钱包密钥保存在本机受限权限文件中，不包含在报告。

## 业务与安全测试覆盖

- 创建：不同 Quote、税率、质押及 Holder 开关；固定发行量和创建者归属。
- 交易：曲线买卖、跨越毕业门槛、实际 v4 池买卖、Permit2/Router 授权；已毕业市场拒绝继续曲线交易。
- 手续费：独立按回执复算基础费、Creator tax、Platform、Creator、Staker、Holder 的分账和舍入；按资产分别核算，不混合 raw 数量。
- 质押：2 个钱包在 2 个市场共质押 4 Stock；激活、锁定期间拒绝领取/退出、到期本金精确退还和提前退出。
- Creator / Holder：实际原币与兑换领取；角色权限、单资产扣账、未选资产及其他用户权益保留。
- 负面场景：零值、超额税率、非法资产位图、非创建者领取、锁期限制；均检查预期回滚。
- 分叉故障注入：异常 ETH 接收方、Meme 余额读取故障；验证单资产领取隔离，双资产模式整体回滚。故障仅注入本地分叉。
- 分叉奖励：到期双资产领取、防重复领取、真实池内兑换、过期兑换保留 Meme 或授权原币兜底、Quote 正常支付。
- 资金：固定区块验证 FeeVault 各资产余额覆盖负债，以及市场状态、本金和用户归属。

分叉固定区块：117044123，哈希 `0x9f21ecac5a1c3e78983421f1521ae98bbfc43dd302d9a830b7f8715fdc8687b4`。分叉时间推进 2 天不改变公开测试链。首次分叉测试有 1 个测试脚本接口名错误，修正为当前 rageQuit 后，完整重跑 11 项全部通过；初次日志亦保留。

### 公共链尚未自然到期的仓位

| 市场 | 用户 | 解锁时间（北京时间） |
|---|---|---|
| `0x5a35d5356017546ac2e9714bc4aa7c77daef8db859660938ab3ce3f04ec5f9cc` | bob | 2026-09-12T03:42:38+08:00 |
| `0x5a35d5356017546ac2e9714bc4aa7c77daef8db859660938ab3ce3f04ec5f9cc` | dave | 2026-09-12T03:42:44+08:00 |
| `0xe596600919dc0beb84a6e5a3660d6dba13c0424f20550f453d4cf7cd8dfdebf1` | bob | 2026-09-12T03:42:55+08:00 |
| `0xe596600919dc0beb84a6e5a3660d6dba13c0424f20550f453d4cf7cd8dfdebf1` | dave | 2026-09-12T03:43:05+08:00 |

这些仓位仍保留在测试链，可继续联调。不能将分叉到期测试称作公开链已完成领取。

## 本轮发现与处理

| 问题 | 处理 / 状态 |
|---|---|
| 编译缓存与当前构建输入不一致 | 广播前强制重编译，再模拟及核验 |
| 部署工具仍识别旧奖励模式 | 改为当前单资产 Claim 模式检查 |
| 当前 RPC 白名单禁止共享 PoolManager 日志 | 按当前市场 poolId 放行；无全历史扫描 |
| Go 启动路径使 Stock 定价文件找不到 | 环境入口规范化相对路径 |
| 从最新区块启动遗漏早先 5 个 Stock 登记 | 校验当前发布与规范区块后，仅导入 5 笔已知登记事件 |
| 部分测试仍调用旧 Treasury / operator 接口 | 改用当前接口并清理纯旧业务测试 |
| 成交量测试基准错误地包含曲线费/税 | 按当前实际执行额口径修正，12 个市场与回执全部相等 |
| USD 主源不可达 | 增加 Kraken 备用源和超时/格式测试；本机主备均超时，仍未恢复 |
| 新发布 24h feeCoverage 仍为 false | 未解决。startTime 必须早于完整 24h 窗口，导致新部署尚不足一天时误判覆盖不足；原始手续费与分账已全部对账成功 |

## 剩余风险及验收边界

1. **统计展示尚未全绿**：67 项统计断言通过，覆盖标记 1 项失败。不能据此宣称 /stats 全面验收通过。新发布应以经过验证的合约生效起点计算覆盖，后续修复必须携带起点证明，不能直接绕过覆盖检查。
2. **USD 依赖**：Coinbase、Kraken 从本机均超时，市值、USD 成交量、Stock USD 总值不可用；原始链上数量和费用正常，不填假价格或假零。
3. **兑换 Gas 可用性**：子调用极端耗尽 Gas 可能使授权原币兜底也整体回滚；权益恢复，不证明可保证兜底完成。原币单资产领取提供替代路径。
4. **兑换经济风险**：按用户要求不设最低价格保护；极差价格但成功的兑换不会触发失败兜底。
5. **外部资产**：发行方暂停、拉黑或升级仍可能阻断实际转账；单资产隔离不等于所有异常资产都能强制退出。
6. **覆盖边界**：本轮包括编译、自动化、API 对账、公开链及分叉，不等于逐个浏览器钱包交互的完整人工视觉验收。未部署主网，未以此报告批准主网。

## RPC 与数据范围

当前运行入口按需查询，独立数据库仅有这一发布。登记补录限已知交易区块，市场数据从本次创建起采集。分叉最终运行上游 332 次请求；连同初次运行共 656 次，不是全轮 RPC 总量。分叉限额 1,000 CU/s，普通网关 9,000 CU/s，总预算不超过 10,000 CU/s。没有通过扫描旧版本区块获取测试数据。

## 复现与证据

- 测试矩阵：[results.json](/Users/dear/Documents/code/TickerGarden/outputs/reviews/asset-selection-2026-09-11-matrix/results.json)
- 统计断言（保留失败）：[statistics-audit.json](/Users/dear/Documents/code/TickerGarden/outputs/reviews/asset-selection-2026-09-11-matrix/statistics-audit.json)
- 费用断言：[fee-split-audit.json](/Users/dear/Documents/code/TickerGarden/outputs/reviews/asset-selection-2026-09-11-matrix/fee-split-audit.json)
- 资金状态：[chain-state-audit.json](/Users/dear/Documents/code/TickerGarden/outputs/reviews/asset-selection-2026-09-11-matrix/chain-state-audit.json)
- 分叉测试：[CurrentReleasePublicState.t.sol](/Users/dear/Documents/code/TickerGarden/contracts/test/v1/fork/CurrentReleasePublicState.t.sol)
- 日志目录：[asset-selection-2026-09-11](/Users/dear/Documents/code/TickerGarden/outputs/reviews/asset-selection-2026-09-11)

普通合约测试：`FOUNDRY_INVARIANT_RUNS=128 FOUNDRY_INVARIANT_DEPTH=128 node tools/run-forge.mjs test --no-match-path 'test/v1/fork/**'`。

回执/统计复核需显式设置 `TG_RH_MATRIX_RUN=asset-selection-2026-09-11-matrix`，分别运行 tools/audit-rh-matrix-fee-splits.mjs、tools/verify-rh-matrix-state.mjs、tools/verify-rh-matrix-statistics.mjs。复查时优先读取已保存证据；不要再次广播已经完成的创建、交易或领取步骤。
