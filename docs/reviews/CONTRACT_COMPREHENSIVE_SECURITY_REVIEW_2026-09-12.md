# 合约全面安全与优化复核 — 2026-09-12
> 后续实现更新：已有本金缺口仍接受新存款的问题已加入本地保护，详见 [本金缺口保护与验证](STOCK_VAULT_PRINCIPAL_GUARD_2026-09-12.md)。下文保留审计时证据；不代表旧损失已补回或已部署修复。
> 后续实现更新：本报告中的兑换 Gas 兜底风险与付款余额复用优化已在本地代码处理，详见 [领取优化与验证](FEE_CLAIM_OPTIMIZATION_2026-09-12.md)。以下保留审计时的证据；收款地址限制等其他项目不因此视为已修复。

## 结论与范围

检查当前本地工作区 `contracts/src/v1` 的 72 个 Solidity 文件，按创建、交易、毕业、LP 托管、Stock 本金、奖励及治理链路检查权限、资金流、外部调用与金额边界；结合既有测试、历史报告和新增反例测试。不是对第三方依赖全量源码的独立审计，也不是形式化证明或线上字节码认证。

当前未新增复现普通用户盗取他人本金、重复领取、凭空铸币、提走锁定 LP 或替换任意 delegatecall 目标的路径。仍有三项应优先处理的条件性风险，以及一项本轮新增测试明确的代理资产准入信任边界。以下 P1/P2/P3 是处理优先级，不表示全部属于无权限攻击漏洞。

本轮仅新增一个测试及本报告/证据文件；没有修改合约运行逻辑、部署或广播交易。工作区已有其他修改，本报告基于当前未提交快照，不等同于已发布版本。

## 待处理风险

### R1 — P1：Stock 本金已有缺口时仍接受新存款

位置：`contracts/src/v1/shared/UserStockVaultDeposits.sol:31`。只验证本次精确到账，没有验证存款前实际余额能否覆盖 `_totalDeposited[assetUid]`。

既有反例测试本轮重新通过：Alice/Bob 合计存入 200，测试模拟发行方将 Vault 余额扣减到 150；身份检查仍通过，Charlie 的新存款 100 仍被接受。此前两人各取回 100 后只剩 50，Charlie 账面仍有 100，却不能完整取回。

前提是外部资产能在正常 Vault 转账以外丢失余额，例如发行方扣减、负向 rebasing 或有害升级。没有证据表明普通用户能自行触发，也不表示线上股票代币已发生此事。

建议使用已经读取的 `beforeBalance` 检查既有本金覆盖率，缺口时拒绝新存款；后端按资产监测实际余额与总本金。该措施只能阻止风险扩散，不能修复旧损失。不要直接给所有退出增加“必须全额偿付”的条件，导致剩余本金也无法退出；损失分配需要单独设计。

证据：`contracts/test/v1/audit/StockVaultCustodyBoundary.t.sol:51`。

### R2 — P2：兑换耗尽子调用 Gas 时，catch 不保证兜底付款

位置：`contracts/src/v1/shared/ProtocolFeeVaultUserClaims.sol:95`。兑换 self-call 没有显式保留足够的恢复、支付及末尾检查 Gas。

既有反例在本轮通过：500,000 Gas 外层预算下，耗尽子调用 Gas 的 Hook 替身使“保留 Meme”和“原币 fallback”两种模式都回滚，已赚 Quote 也未付款；权益完整回滚，同预算直接领取原币成功。直接复现角色为 Creator，不能扩称三种角色均已单独复现。

这是领取可用性风险，没有复现资金丢失，也不意味着攻击者能替换固定 Hook。建议为转换设置经过测试的调用预算并保留后处理 Gas，覆盖 Creator/Staker/Holder、原生/ERC20 Quote、冷热访问和不同 fallback 路径。保留原币领取入口；不恢复已明确取消的最低输出限制。

证据：`contracts/test/v1/audit/FeeClaimSafetyBoundary.t.sol:77`。

### R3 — P2：不能接收 ETH 的权益所有者可能无法提取旧收益

位置：`contracts/src/v1/shared/ProtocolFeeVaultUserClaims.sol:110`。付款固定给权益调用人，没有所有者授权的独立 recipient。

既有反例在本轮通过：Creator 是无法接收 ETH 的合约时，其 ETH 领取回滚；更换后续 epoch 的受益人不能改变旧 epoch 的归属，因此不能修复旧收益收款能力。单独领取 Meme 仍可成功。

建议增加由权益所有者调用并指定 recipient 的入口，仍以 `msg.sender` 核定权益，验证恶意收款人重入、零地址、资产选择、旧 epoch 和返还。不能允许管理员或第三方任意改写所有者。

Platform 领取始终支付不可变 Treasury。若 Treasury 无法接收 ETH，会影响平台原生手续费领取，也会使 Launch fee 支付和创建回滚；本轮没有证据表明当前 Treasury 拒收 ETH。发布前应实测收款能力。

证据：`contracts/test/v1/audit/FeeClaimSafetyBoundary.t.sol:100`。

## 本轮新增确认：代理 Quote 的治理信任边界

位置：`contracts/src/v1/modules/ApprovedQuoteRegistry.sol:207`。

普通 `addQuoteConfig` 路径只固定 token 外层 runtime codehash 和 decimals；实现升级后这两项可以保持不变。源码明确允许普通代理资产准入，Stock 指纹绑定是可选路径，因此这不是绕过现有权限或违反当前接口承诺的漏洞。

新增 `test_auditGenericProxyQuoteDoesNotDetectImplementationUpgrade` 使用真实 Registry 与测试 Beacon 代理，验证同一个 token 升级实现后：

- 外层代理 codehash 不变。
- 普通 Quote 的 `quoteIdentityCurrent` 仍为 true。
- 显式 Stock 绑定的 Quote 身份变为 false，Stock Registry 身份也变为 false。

建议对每个代理 Quote 明确记录升级管理员、冻结/扣款/rebase 能力及监控责任。需要绑定实现的 Stock Quote 应使用已有显式绑定路径；不能把普通 codehash 检查描述为“已固定底层实现”。是否将所有 Stock Quote 强制走绑定路径属于资产准入政策变更，不能在审计中擅自修改。

此外，Quote/Template/Baseline 的暂停主要阻止后续准入，不等同于暂停现有市场交易。现有市场继续运行符合当前无平台运行时暂停设计；外部发行方异常时不能假设平台能即时冻结全部交易。指纹也不能识别同一实现通过状态权限进行的所有冻结或扣款。

证据：`contracts/test/v1/product/ApprovedQuoteRegistry.t.sol:501`，单独测试 1 passed，并包含于完整产品测试。

## 其他边界与优化候选

| 项目 | 当前结论与建议 |
| --- | --- |
| Stock 应急退出 | 绕过锁定、最低仓位和部分奖励结算阻塞，但不能绕过 token 自身冻结、黑名单或异常转账语义；不要承诺无条件到账。 |
| FeeVault 同资产偿付检查 | 外部扣减导致总负债缺口时，即便够付某一个人也会拒绝该资产领取，这是避免先到先得的保护；不可删除。现有资产选择可让正常另一资产继续领取。 |
| P3：领取余额读取 | 双资产原币 Creator claim 每个 ERC20 对 FeeVault 余额读取五次。付款后已获取的余额可评估复用于紧邻偿付检查；保留跨资产外部调用后的最终检查。本轮未实施 A/B，不能声称具体节省。 |
| P3：创建身份读取 | `V1FactoryValidation.resolve` 先检查 `assetIdentityCurrent`，随后 `_validateVaultIdentity` 再调用 `vaultIdentityCurrent`、`vaultIdentity`。可评估单次返回已验证身份并复用；不能去掉 Factory 对预期 Manager/MarketRegistry 的独立绑定要求。未量化收益。 |
| Holder 原币领取路径 | Distributor → FeeVault → 用户有额外转账成本；可单独评估原币直付，转换路径仍需独立验证。涉及接口与事件，不是直接删检查。 |
| 数量选择与批量领取 | 当前选择资产不等于选择领取数量；可评估数量上限与有界批量，验证舍入、失败隔离及权限。属于功能提案，不是已修复缺陷。 |
| 误转资产 | 未经存款入口转入 Vault 不自动记账；Locker 资产不可提取符合永久锁定设计。不要用任意 rescue 破坏本金或 LP 锁定边界。 |

## 本轮核对的主要安全控制

| 业务面 | 已核对内容 |
| --- | --- |
| Factory / LaunchConfigResolver / 三类准入 Registry | 创建参数、经济域、代码哈希与依赖绑定、CREATE2 预测、固定部署包装器；权限准入与延迟解除暂停。 |
| LaunchAndBuyRouter | 固定 creator、精确 native/ERC20 资金、受限退款源、兑换路径、授权清零、重入保护。 |
| Curve / 数学库 | 买卖 minOut、储备与费用独立记账、边界运算、税费上限、末笔买入与毕业原子回滚。 |
| GraduationExecutor / Hook / MarketRegistry | 固定调用方与 PoolManager、预期 PoolKey、状态单向转换、手续费来源版本切换、精确资产消费。 |
| LaunchLocker | NFT ID、PoolKey、所有权与流动性校验；无 LP 提取或任意 approve/call 管理入口。 |
| Stock Registry / Vault / AllocationManager / Gauge | 资产与 Vault 身份、精确到账、调用者归属、跨账本一致性、激活窗口、正常/应急退出及延迟清理。 |
| FeeVault / CreatorRevenueRegistry / Holder Distributor | 费用唯一性、来源、负债、epoch 归属、分资产领取、转换返还、重入和部分失败原子性。 |
| AccessManager 绑定及部署 | immutable authority 与 restricted 调用；权限角色和大部分操作延迟还依赖实际部署配置。源码不能替代链上角色核验。 |

边界说明：第三方 PoolManager、PositionManager、Permit2、发行方代理及权限管理员属于依赖信任范围；本轮未对其全部源码重新审计。没有新复现漏洞不等于不存在遗漏。

## 已修复，不能再次列为待处理

当前代码已包含此前优化，本轮相关回归通过：

- Vault 全字节码扫描留在注册环节；日常身份检查保留 codehash 与依赖绑定。
- Vault/Gauge 没有待激活数量时跳过 32 槽扫描。
- Staker 双资产领取复用一次结算；Holder 余额与统一领取 market 查询已有复用。
- 原币领取不再受兑换 deadline 限制。
- 分资产领取不会因为未选择的坏资产而一并阻断；同时选择两种资产仍保持原子性。

历史报告正文中的旧成本应结合后续修复附录阅读。先前 opcode 扫描优化的 Gas 数字不是本轮重新做的 A/B，不用作本轮新结论。

## 验证结果及生产限制

| 检查 | 结果 |
| --- | --- |
| Foundry 产品测试 | 20 suites，317 passed，0 failed，0 skipped。 |
| Foundry 非产品、非真实 Fork 测试 | 67 suites，662 passed，0 failed，0 skipped。 |
| 合计（两组路径互斥） | **87 suites，979 passed**；含 fuzz/invariant，新增代理测试已包含，不重复计数。 |
| Python execution spec | 63 passed。 |
| 当前合约 surface | 3 passed。 |
| CI 工具 Node 单元测试 | 24 passed。 |
| boundary / fixture / product artifact | 通过；产品 manifest 校验 18 个模块。该数量不是源码目录模块文件总数。 |
| 部署模块本地测试 | 62 passed。 |
| 完整 CI tracks | **未通过**：真实 Fork 阶段要求 `ROBINHOOD_RPC_URL`，本轮未配置。 |
| 单独 deployment track | **未通过**：默认历史 `deployments/manifests/robinhood-testnet-46630.v1.plan.json` 被当前校验器以 `Invalid V1 deterministic ordinary component order` 拒绝，发生在 live RPC 核验前。 |
| git diff --check | 通过。 |

旧部署计划被拒绝是 fail-closed 行为，不能简单改校验器或改旧证据来获取绿灯。需针对最终源码重新生成候选计划，再完成代码哈希、地址顺序、链 ID/区块、权限/延迟、资产身份及收款能力核验。真实 Fork 和生产权限/外部合约状态本轮未验证，不能宣称生产准入完成。

证据目录：`outputs/reviews/contracts-comprehensive-2026-09-12/`，含 `source-sha256.json`、`gates.log`、`nonproduct.log`、`proxy.log`、`deployment.log`。源码指纹对应未提交工作区，后续代码变化需重新验证。

建议实施顺序：R1 存款前本金覆盖保护 → R2 兑换 Gas 储备矩阵 → R3 所有者授权 recipient → 小范围余额/身份读取优化；部署准入和资产治理核验独立完成。
