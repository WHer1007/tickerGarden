# Holder 批量归集与失败隔离

日期：2026-09-13。范围仅限用户批准的前两项：批量归集入口、失败隔离及回归测试。未改造后台调度、未发布快照、未部署或广播。

## 资金链路与新增入口

保留 **FeeVault → Distributor 实际到账 → 单独发布 Root → 从 Distributor 领取**。Creator／Staker／Platform 的资金归属与领取入口不变；本批次不能发布 Root，也不能指定收款地址或金额。

新增 `ProtocolFeeVault.fundHolderRewardsBatch(bytes32[] marketIds, uint8 assets, uint256 gasPerAsset)`，任何人可支付 Gas 触发。每个子调用复用原有 `fundHolderRewards(id, 1)` 或 `fundHolderMemeRewards(id)`，金额取该市场、资产尚未归集的 Holder 账目，目标为 Token 绑定的 Distributor。

| 参数 | 本版实现 |
| --- | --- |
| 每批市场列表长度 | 1–32；允许重复 ID，已归集的余额再次处理为零 |
| assets | 1=Quote，2=Meme，3=两者；按市场顺序先 Quote 后 Meme |
| gasPerAsset | 每个子调用转发 100,000–2,000,000 Gas，调用方在范围内指定 |
| 调用前余量 | 子调用 Gas + EIP-150 余量 + 80,000 Gas，用于记录结果及提前结束 |
| 单项接口 | 保留；特殊资产超过批次 Gas 上限时可单项模拟并重试 |
| 时间条件 | 无固定周期或间隔 |

同一批次的 Quote 和 Meme 是独立回滚边界。某个资产失败并不使同市场另一个健康资产自动失败。

## 回滚、重入与 Gas 边界

- 每项通过固定选择器调用 FeeVault 自身，不接受任意目标或 calldata。
- 每项完整复用共享操作状态保护、资产偿付和精确收支差额检查。失败时该项的扣账、ERC20 allowance、实际转账和 Distributor 入账一起回滚；父批次随后记录失败。
- 父批次入口也要求共享操作状态空闲。每个子调用持有操作保护期间，Token／Distributor 回调不能重入批次。父批次不在子调用之外访问外部资产或 Registry。
- 只复制 32 字节返回数据，失败日志仅保留前 4 字节错误 selector；OOG 或空 revert 的 selector 为零。不会为了记录错误而复制无上限的 revert data。
- 零 Holder 余额仍核验市场／Distributor 绑定，但不再读取该资产余额、执行偿付检查、approve 或转账。单资产入口同样受益。
- 当剩余 Gas 不足以安全发起下一项时，正常返回续跑位置，保留已成功项。此时未尝试项不是失败项。
- 以上不保证极低交易 Gas、父调用自身 OOG 或网络交易失败时仍保留进度；整笔交易回滚时，全部变更仍一起回滚。
- 失败隔离不修复原有同资产偿付缺口，也不使外部 Token 的全局冻结／rebase 风险消失。相同问题涉及的多个市场可能分别失败。

## 结果与重试约定

每个尝试项发出 `HolderFundingResult(marketId, asset, status, amount, errorSelector)`：

- status=0：余额为零，未转移。
- status=1：实际归集成功，amount 为该资产原始单位数量。
- status=2：该子调用回滚，amount=0；需要按原因单独重试。

Gas 不足时发出 `HolderFundingBatchStopped(nextMarket, nextAsset)`，并返回相同游标；全部项目都尝试完返回 `(marketIds.length, 0)`。**完成不代表全部成功，必须检查每项 status。** 已广播交易以 receipt 日志为准，不能仅依赖发送前模拟的返回值。

nextMarket 是本次输入的索引。如果 nextAsset=2，表示同市场 Quote 已经尝试，Meme 尚未尝试；可以先用 mask=2 处理这个市场，再处理余下列表。也可以重交原列表；已转移资金不会被重复转移，但新的手续费若已产生，重交会归集这些新增金额，故重试并不是金额固定的请求重放。归集仍不决定本轮快照预算。

建议后台未来只选有待归集资金的记录、先模拟、按实际 Gas 动态分批；这些调度实现不属于本轮。批次大小上限不是每笔必须提交 32 个市场，更不是 Gas 消耗保证。

## 验证

证据目录：`docs/reviews/evidence/holder-batch-funding-2026-09-13/`。

- 专项测试：20 passed（17 项新增测试及 3 项继承的真实 FeeVault 流程回归），包含 256 次 fuzz；`focused.log`。
- 覆盖：Quote/Meme 分别选择、重复调用、无余额跳过异常 balanceOf、原生 ETH、跨市场账目、Creator/Platform 账目与领取不变、单资产资不抵债、非精确转账、授权清理失败后恢复、Gas 耗尽、128 KiB revert data、明确的重入拒绝错误、Gas 中断及 Meme 续跑、32 市场/64 资产、到账后才可发布并领取。
- 完整非 Fork 回归：84 suites，893 passed，0 failed，0 skipped；`contracts.log`。
- Python ABI/spec：66 passed；部署 schema／权限／preflight：66 passed；当前奖励接口工具测试 5 passed。
- Web 构建通过，保留已有大 chunk 提示。新 ABI 已生成；未接入后台或页面批量按钮。
- canonical/interface/mutation draft/compiled manifest/product manifest 与权限表已同步。只增加 Holder 归集这一项批量 mutation；保留其他业务的批量范围限制。
- 当前 FeeVault runtime 为 20,580 bytes，低于 EIP-170 的 24,576 bytes；Factory runtime 为 23,880 bytes。
- 32 市场、64 项资产的本地执行段测得约 8,194,364 Gas（最新专项测试已用 vm.cool 清理相关账户和存储的热访问状态，给批次 15,000,000 Gas 上限）。这仍是合成 fixture，不是完整的真实链交易测量，不包含外层交易固有开销，也未覆盖所有 RH 资产成本；不能当作 RH 生产 Gas 报价。仍需逐资产与真实交易模拟确定批次大小。

完整非 Fork 回归结果已记录于 `contracts.log`。本轮未执行新的 RH 实际 Fork；不能将本地回归作为生产部署证书。新 FeeVault 字节码使旧部署 payload／地址计划失效，需要上线前重新生成并验收。
