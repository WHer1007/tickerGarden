# 手续费领取安全检查
> 后续实现更新：本报告中的兑换 Gas 兜底风险与付款余额复用优化已在本地代码处理，详见 [领取优化与验证](FEE_CLAIM_OPTIMIZATION_2026-09-12.md)。以下保留审计时的证据；收款地址限制等其他项目不因此视为已修复。

日期：2026-09-12。对象：当前工作树的 ProtocolFeeVault、UserClaims / UserConversion / Liabilities、Curve/v4 入账、HolderRewardsDistributor、MemeStockGauge、CreatorRevenueRegistry，以及 Factory Launch fee 转账。

结论：本轮未复现未经授权领取他人手续费、重入重复付款、跨资产挪用或转换失败后丢失账面权益的路径。确认两个领取可用性问题、一个外部资产亏损时的影响范围，以及两项可优化的开销。兑换不设价格下限属于已有业务决定，另行标注经济风险，不作为新增漏洞或要求恢复旧规则。

这是源码与本地测试结论，不是生产安全认证。未查询新链上部署、未执行新真实链 Fork、未广播交易。本轮只新增测试和报告，没有修改合约运行代码。

## 1. P2：兑换耗尽 Gas 时，catch 无法保证兑现兜底

证据：[ProtocolFeeVaultUserClaims.sol:95](../../contracts/src/v1/shared/ProtocolFeeVaultUserClaims.sol#L95)。`this.convertUserClaim` 没有显式后处理 Gas 储备；catch 后还需恢复 Meme 权益、转账和偿付检查。

复现：用耗尽子调用 Gas 的 Hook 替身，在 500,000 Gas 的外层调用预算下，Creator 的“兑换失败保留 Meme”和“兑换失败直接领取 Meme”两种模式都整笔回滚，已有 30 Quote 未付款。Creator 的 100 Meme / 30 Quote 负债完整恢复，同样预算直接领取原币成功。已有审计测试曾覆盖 fallback=true；本轮补充 fallback=false 及权益/Quote 状态核验。

影响：这是可用性及提示语准确性问题，不是已复现资金盗取。测试不表示攻击者可以替换固定 Hook，也不证明正常池必然耗尽 Gas。高耗时兑换、复杂池路径或不足的交易 Gas 预算可能触及这个边界。Creator、Staker、Holder 共享此 try/catch，三种角色的恢复成本不同；本轮耗尽 Gas 的直接复现为 Creator。

建议：在发起兑换前保留经测试确定的后处理预算；余额不足以覆盖最低兑换预算与恢复预算时，进入用户已授权的保留/原币路径。不要笼统承诺任何兑换异常都会支付 Quote。必须以三种角色 × 原生/ERC20 Quote × 保留/原币 × 冷访问成本验证，并保留直接领取原币入口。即使预留 Gas，也不能保证所有拒收款或恶意代币回调都可成功。

## 2. P2：收益所有者与收款地址绑定，拒收 ETH 的合约可能无法领出旧收益

证据：[UserClaims.sol:110](../../contracts/src/v1/shared/ProtocolFeeVaultUserClaims.sol#L110)、[Liabilities.sol:330](../../contracts/src/v1/shared/ProtocolFeeVaultLiabilities.sol#L330)。付款固定给 `msg.sender`，接口没有由权益所有者指定 recipient 的能力。Creator 旧 epoch 的受益人记录不会随新 epoch 转移。

复现：已登记 Creator 为无 payable receive/fallback 的合约，给其记入 1 ETH 和 100 Meme。双资产领取回滚；建立新受益人 epoch 后，新受益人仍无法领取旧 epoch 的 ETH，这是正确的归属保护。旧受益人可以选择仅领取 Meme，但 ETH 没有现有接口支持的重定向路径。如果该合约自身不能升级或改变收款能力，这部分 ETH 可长期锁住。

建议：增加“由权益所有者调用、只改变收款地址”的领取入口，继续使用 `msg.sender` 判断 Creator/Staker/Holder 权益。禁止外部调用者替他人任意设置 recipient。允许所有者授权 WETH 收款是另一种接口方案。需要明确事件中的 owner/recipient，并回归恶意 recipient 重入、地址为零、选择单资产、旧 epoch 归属和转换返还。

Platform 则固定支付不可变 Treasury，任何人调用也只能把钱送到该地址。若 Treasury 拒收 ETH，不仅 Platform 原生币手续费无法领取，Factory 的 Launch fee 支付也会导致创建回滚；这是收款地址配置/合约能力的条件性风险，本轮没有证据表明当前 Treasury 存在这种故障。不要为了可恢复性直接增加任意管理员改写收款地址的后门。

## 3. 条件性风险：同一资产的总负债缺口会阻止该资产的多方领取

证据：[Liabilities.sol:357](../../contracts/src/v1/shared/ProtocolFeeVaultLiabilities.sol#L357)、[HolderRewardsDistributorV1.sol](../../contracts/src/v1/modules/HolderRewardsDistributorV1.sol)。两处都以 `totalLiability[asset]` 检查该资产总偿付能力，而不只检查本次 claim。

复现：FeeVault 的 Quote 余额由 60 被外部调整为 59、总 Quote 负债仍为 60。Alice 只领取自身 30 Quote 也失败，虽然实际余额大于本次领取额；单独领取 Meme 成功，Bob 的未领取权益不变。

这是避免先到先得耗尽他人资金的安全选择，不能通过取消偿付检查来“修复”。前提是外部资产余额被扣减、负向 rebasing、异常升级或转账限制等；本轮没有复现普通用户自行制造该缺口。建议按资产监测余额与总负债，并明确受支持资产的发行方信任边界；亏损恢复或损失分配需要独立方案。现有资产选择已经避免把坏 Quote 的故障强加给正常 Meme；选择同时领取两种资产时，付款仍保持原子回滚。

## 4. P3 优化：每次原币领取有可收敛的余额读取

测试确认 Creator 同时原币领取 Quote/Meme 时，每个 ERC20 对 `balanceOf(FeeVault)` 各读取五次：领取前偿付检查、付款前余额、付款后余额、付款后偿付检查、整个领取末尾偿付检查。另有受益人余额前后检查。

可优化点是 [Liabilities.sol:339](../../contracts/src/v1/shared/ProtocolFeeVaultLiabilities.sol#L339) 已经取得 `vaultBalanceAfter`，随后在 350 行为本次付款的偿付断言又读取同一余额。可评估复用这个观测值，保留精确转出/到账检查。**不要直接删除整个双资产领取末尾的检查**：第二种资产付款存在外部调用，最终再次校验第一种资产仍有意义。预计收益只是减少少量外部读取，本轮未修改代码或做优化前后 A/B，不能宣称百分比节省。

## 5. 设计优化候选：Holder 原币领取往返、全额消费与批量操作

- Holder 当前先从 Distributor 转给 FeeVault，再由 FeeVault 转给用户；失败且保留 Meme 时还会送回 Distributor。每段都有精确转账验证。可评估只在直接原币领取模式下由 Distributor 向所有者授权的 recipient 支付；转换模式继续走 FeeVault。此项会改变跨合约调用与事件语义，需要独立实施和测量，不能只删除中间检查。
- `assets=1/2/3` 是资产选择，并非数量选择；选中的余额会全部消费。浅池中全额 Meme 转换可能有较大价格冲击。可评估由用户指定本次领取/转换数量，上限仍是自身已赚收益，并验证小额多次领取的舍入和返还。该方案不要求恢复已取消的最低输出规则。
- Holder Quote/Meme 注入、多个市场/Creator epoch 领取仍需分别调用。若增加批量入口，应有明确数量上限，保留单市场/单资产入口，且不能因一项失败吞掉其他项权益。

上述三项是源码确认的流程成本/能力限制，不是已量化 Gas 改善或资金漏洞。

## 已批准的经济风险：无兑换最低到账保护

[TickerGardenRewardConversion.sol](../../contracts/src/v1/shared/TickerGardenRewardConversion.sol) 使用池价格边界，FeeVault 只要求正数输出和精确资产流量。成交很差仍可被视为成功，不会触发 rawFallback。真实 PoolManager 本地测试 `test_adverseSpotDoesNotBlockConversion`、`test_highImpactPartialFillRefundBothTokenOrders` 覆盖这一行为。

这与已批准的不设预置价格下限决定一致。本轮不恢复价格窗口或默认最低输出。可改进领取前报价与影响展示、原币领取选择，以及用户可控数量；私有提交能否采用需结合部署基础设施验证。

## 核对通过的资金边界

| 类别 | 当前归属及主要保障 |
| --- | --- |
| Creator 基础手续费、Creator tax | 按 market / creator epoch / asset 记账；只有该 epoch 受益人可消费；新受益人不能拿旧 epoch 余额。交接在 Curve 阶段先 sweep 再切 epoch。 |
| Staker | Gauge 仅允许固定 FeeVault 消费；检查锁、退出结算标记；统一结算一次，按所选资产分别扣账；失败恢复仍归原用户。 |
| Holder | 只从固定 FeeVault 调用消费；两套已释放权益先结算再付款；资产独立负债、整数余数保留；转换剩余返回原用户账本，不重开释放流。 |
| Platform | 可由任意人触发，但收款永远是固定 Treasury；先扣负债后付款；转账失败回滚。Staker forfeiture 先预留、再一次性转入 Platform 桶。 |
| Curve / v4 收费入账 | 固定来源、market/sourceVersion/feeId/nonce、实际余额差校验；统一操作锁防止 begin/finalize 过程中插入领取。不能只凭事件或参数铸造可领负债。 |
| Launch fee | Factory 创建时直接发往 Treasury，不在 FeeVault 内等待领取；支付失败则创建回滚。 |

新增测试确认原生币付款回调不能重入统一 Claim，第二次成功领取返回零，分次选择资产不会再次消费同一余额或另一 Creator epoch 的余额。既有测试覆盖部分兑换、错误 Hook 报账回滚、allowance 清零、Holder 非授权调用、Gauge 锁、手续费代币税、跨资产偿付和多用户账本不变量。

## 验证记录

- 新增文件：[FeeClaimSafetyBoundary.t.sol](../../contracts/test/v1/audit/FeeClaimSafetyBoundary.t.sol)，6 个新增审计用例全部通过。
- 指令：`node tools/run-forge.mjs test --match-contract FeeClaimSafetyBoundaryTest --match-test testAudit -vv`。
- 完整非 Fork 合约回归：`npm run test:contracts`，87 个套件、978 项全部通过，0 失败、0 跳过。包括各手续费资产独立偿付、Holder 128,000 次调用、Vault–Gauge 本金账本和权重不变量。
- Gas 耗尽和余额扣减是测试注入的异常前提；接收方测试为合约能力限制；不据此认定线上曾发生攻击。
- 本轮未修改协议运行代码、ABI、权限或部署文件。
