# TickerGarden V1 开发计划

> 当前规范：`V1-EXEC-11`；readiness：`DEPLOYMENT_ELIGIBLE / NOT_PRODUCTION_READY / NOT_BROADCAST`。

## V1-ARCH-006：删除旧市场干预架构

状态：`DONE / LOCAL VERIFIED`（2026-09-04）。

本项作为独立、破坏性架构改造完成：

- 删除市场级暂停、恢复、退休、紧急接管和恢复分配状态；
- 删除 `MarketController` 及 FeeVault 的 recovery cap/root/claim 组件；
- `MarketRuntime` 收敛为 `poolId + sourceVersion + launchPhase`；
- `launchPhase` 只允许 `NotGraduated -> PoolCreated`；最终买入与毕业全原子，删除持久 `Swept`、重试、终态救援和市场资产接收人；
- Hook、Gauge、Curve、FeeVault、Vault 和 Allocation 不再读取或接受市场管理员状态；
- 用户 `rageQuit` 始终先返还完整 STOCK 本金，奖励清理由 permissionless 路径异步完成；
- Asset、Quote、Pons baseline、Launch template 的对象级 pause/unpause/retire 继续用于新增准入或新增敞口，不影响既有市场交易或本金退出；
- Solidity ABI、权限矩阵、部署 schema、Indexer、Backend、Website、Rewards/Treasury 前端、maintenance runner 和文档全部同步到 `V1-EXEC-11`。

当前 canonical 产品模块为 19 个（含共享 `TreasuryDistributorV1`）；接口和事件数量以 `spec/v1_execution_manifest.json` 为准。Gauge clone immutable identity 从 8 个 word 收敛为 7 个 word，runtime 为 269 bytes；共享 MultiAsset Vault schema 为 v6。部署权限面现为84个协议 mutation：23个由5类冻结角色门控，61个为 immutable direct/public/module caller，且所有业务状态延迟为0；Treasury Root publisher 与 independent reviewer 必须使用相互独立且不复用治理/Guardian/Unpause 成员的 Safe。

## V1-QUOTE-001：RH Stock Quote 创建时价格参考与专用准入

状态：`IMPLEMENTED_FORK_VERIFIED / NO_ACTIVE_CONFIG`（2026-09-05）。`V1-EXEC-11` 已实现 BeaconProxy Stock Quote 专用准入、官方 UID/canonical token/Beacon/implementation 指纹钉死、身份漂移 fail-closed 与部署 preflight；固定区块 Fork 已对真实 Stock Token 代理/实现、专用 Quote admission、真实 v4 原子毕业与 Vault/rageQuit 会计执行 E2E。普通 native/direct immutable ERC-20 Quote 门禁不变。194 个 Base 不自动成为 Quote。价格生成器与首批 allowlist 仍是 `PENDING_PRODUCT_ACTIVATION`。

Robinhood 官方 `/rhj/prices/{symbol}` 已确认可以为创建页面和受约束的 Quote Config Generator 提供底层股票 USD `bid/ask`。生成 Stock Token 参考价时必须乘一次 `/rhj/assets` 的 `currentMultiplier`；RH Chain Chainlink Feed 已经包含 multiplier，不得再次相乘。API/Oracle 不进入 Curve、毕业、FeeVault 或 Treasury 的链上运行路径，市场创建后 raw 参数保持冻结。

仍需按顺序关闭：

1. 实现确定性的 Quote Config Generator、价格证据 hash、定点数换算、舍入和 REST/Chainlink 交叉校验；
2. 冻结产品价格参数与首批有限 Quote allowlist，并定义价格最大时效、偏差阈值、停牌、pending multiplier、公司行动、Oracle 与 Sequencer 的 fail-closed 规则；
3. 在首批 ACTIVE Stock Quote 配置前，补齐 pause/blocklist/adminBurn、Beacon 升级、链下价格生成与浏览器交易的专项行为测试；真实代理转账、Quote admission、原子毕业及 Vault/rageQuit 主路径已由固定区块 Fork 覆盖；
4. 上述证据与批准完成后，才允许新增 ACTIVE Stock Quote config。

权威设计见 [`V1_STOCK_QUOTE_PRICE_REFERENCE.md`](./V1_STOCK_QUOTE_PRICE_REFERENCE.md)，RH 资料与动态字段见 [`research/rh-chain-stock-tokens/README.md`](../../research/rh-chain-stock-tokens/README.md)。

## 正式用户前端边界

`apps/web/` 是 V1 面向用户的唯一正式前端。页面与用户能力以该目录为准；`Rewards` 保持产品名称，并承载 Position、Staker、Creator、Treasury 四个面板。原辅助前端位于 `archive/legacy-website/`，只保留历史追溯用途，不参与构建、测试、CI、部署或功能对接，也不改变本计划的 readiness 结论。

前端的链上与链下接入必须 fail closed：read API、Factory、LaunchRouter、AllocationManager、FeeVault、CreatorRegistry、TreasuryDistributor 与 Treasury Proof API 的配置、健康状态和 Factory/Registry 绑定任一不满足时，不得报价、模拟、签名或提交资金敏感操作。Treasury 合约已达到技术部署资格但尚未实际部署或取得 holder 写操作上线批准，因此仍须通过独立的 `V1-TREASURY-EXEC-1:DEPLOYED_E2E_APPROVED` 发布门；未批准时 Rewards 只读展示 Treasury，不影响其余 V1 用户操作。

曲线阶段的买卖、创建与首买已经使用 canonical V1 ABI 接入。测试网计划已固定 v4 Router/Quoter/Permit2 地址与 runtime codehash，合约级 Fork 已通过；毕业后的 Pool 页面仍须等实际 release manifest、精确前端 ABI/settlement/deadline 复核和浏览器实链 E2E 后开放。正式前端在此之前继续锁定 Pool swap，禁止用推测 calldata 或非 canonical 第三方 Router 补齐。

## 本地验收

- 根门禁：以仓库根目录 `npm test` 为唯一聚合验收入口；它必须同时通过执行规范、全部 Foundry 测试、fixture/interface/product artifact 漂移检查、CI 三轨、Backend、Indexer、Deployments、Maintenance runner 与正式 `apps/web`。具体 suite/case 数量以当次 CI 输出为准，避免文档硬编码计数漂移。
- 状态化验证：Vault/Gauge、Treasury 与多资产恶意 Token 不变量均固定执行 256 runs、128,000 calls，并要求 0 handler revert。
- 旧管理 selector 只允许出现在“不可调用”的负向测试和明确的已删除迁移记录中；源码、生成 ABI、事件、客户端、部署 `dist` 与编译 artifact 均不得包含它们。

## 后续工作与外部支持

技术 deployment gates 已关闭；以下是实际广播与生产发布工作：

1. 按测试网 runbook 显式接受 chain 46630 的 project-pinned test-only v4 dependencies，并在广播前重新核验 latest codehash/binding；
2. 签字冻结 deployer、Governance、Guardian、Security/Unpause、Treasury Root Publisher、Independent Root Reviewer、Platform Treasury、Root Service Treasury 及全部 Treasury 时间/费用参数；
3. 先执行无私钥 deterministic preview，再执行无 `--broadcast` 的完整模拟；只有预测地址、payload hash、余额和 gas 审核通过后才允许测试网 broadcast；
4. 部署后生成 receipt-bound manifest，完成源码验证、AccessManager 安装/撤权、浏览器全链路 E2E 与 canary；
5. 独立安全审计关闭 Critical/High，并完成 Pons 来源/许可及 Stock 收益产品的法律签字；
6. 完成生产监控、告警、事故演练和至少72小时 canary soak 后，才可推进 `PRODUCTION_READY`。

## 历史归档

旧 V1-EXEC-5 的市场状态、Controller、管理型 Recovery、force-release 和状态乘积任务均为 `SUPERSEDED / ARCHIVED`。它们不属于当前能力、模块数或测试结论；移除边界见 [V1_MARKET_AUTONOMY_AND_RAGE_QUIT.md](./V1_MARKET_AUTONOMY_AND_RAGE_QUIT.md)。
