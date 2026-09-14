# RH 主链 Stock Token 与 UserStockVault 兼容性复核

日期：2026-09-12。性质：生产研究参考；不改变生产准入状态，不包含生产交易或部署。

## 结论

**当前 RH Stock Token 的分红、拆股与合股采用股份乘数，不会因乘数变化自动增减 ERC20 原始余额。因此，这部分机制与我们的原始 Token 数量记账 Vault 兼容，不需要为正常公司行动改成 rebase 份额金库。**

**但是，不能得出“不会产生问题”的结论。已验证的当前实现允许发行方授权角色销毁任意地址的 Token，另有冻结、暂停及整体升级能力。外部本金扣减是实际存在的合约能力，不能再作为“不可能发生”的前提。** 本轮没有发现发行方已经针对我们的 Vault 执行销毁；这里确认的是权限与代码路径。

## 证据与覆盖

- 网络：Robinhood 主链，chain ID `4663`。
- finalized 区块：`61170228`，区块哈希 `0xf913b7beff47025dad1ff47677917d71139c16809b33db273275aeb00c15c78e`。
- 采集时间：`2026-09-12T14:34:52.503Z`（UTC）。
- 对前次官方名录的 **194 个 Token** 逐一重新读取运行时代码，均指向同一 Beacon 与实现；不是把测试网结果外推到主网。
- Beacon / AccessControlsRegistry：`0xe10b6f6b275de231345c20d14ab812db62151b00`。
- Stock 实现：`0xb35490d6f9163DE4F80d88dc75c3516eb64C5aE2`。
- Beacon runtime keccak256：`0x8b465c0b53a2ba499566e9b4ca67d8c90ed6131743df806a570d156956a7e90e`。
- 实现 runtime keccak256：`0xdc07e86ee482f99641bdafb9a0d772846b167401e094d90a666b94dbdcd1eec7`。
- 两份 Sourcify 验证结果均为 `exact_match`，其链上 runtime bytecode 哈希与上述现场读取结果相同。
- 同一区块：全局 `paused=false`；194 个 Token 的 `paused`、`oraclePaused` 均为 false；读取失败 0 项。**这不是对任意用户/Vault 未被冻结的证明，也不是未来可交易保证。**
- 19 个 Token 的有效乘数不等于 1；例如 CRWD 为 4，AAPL 为 `1.000566080061092436`，NVDA 为 `1.000775159164630595`。此时未发现 `newUIMultiplier` 与当前乘数不同的待生效值。

完整身份、状态、验证源码及本地回归日志保存在 [证据目录](./evidence/rh-stock-vault-2026-09-12/)。本轮没有完整枚举当前角色持有人、验证其多签阈值或操作政策，因此不对发行方的实际审批强度作判断。

## 1. Rebase、乘数和本金的区别

官方说明与验证源码 `ERC20ScaledUIUpgradeable.sol` 一致：

```text
raw principal = balanceOf(account)
displayed underlying shares = raw principal × uiMultiplier / 1e18
```

`_updateUIMultiplier` 只更新乘数及生效时间，不写入 ERC20 余额或总供应量。`balanceOfUI` / `totalSupplyUI` 是换算视图；实际 `transfer` 仍以原始 Token 数量执行。源码的存储命名包含 `ERC20Rebase`，不能据此认定余额会 rebase。

例如用户存入 100 个 Token，乘数从 1 变为 1.1：Vault 仍持有 100 个 Token，用户本金账仍为 100；对应股份变为 110。退出时转回 100 个 Token，用户继续持有当时乘数对应的经济敞口。分红按该机制反映在乘数中，不意味着 Vault 收到了可单独分配的 10 个新增 Token 或现金。拆合股还可能伴随标的每股价格变化，乘数增长本身不等于资产价值同比增长。

当前实现的普通转账没有发现转账税、按比例扣费或自动 rebase 路径；标准 mint/burn 仍会改变余额和总供应量。上述“总供应量不变”仅指乘数更新本身。

## 2. 与我们 Vault 的逐项对照

| 情况 | 当前 Vault 行为 | 判断 |
| --- | --- | --- |
| 正常股份乘数变化 | `_deposited` / `_totalDeposited` 按原始 ERC20 数量保存，存取不调用 UI 换算余额 | 兼容，无需自动改写本金 |
| 普通转账 | 存入校验精确到账；退出同时校验 Vault 扣减与用户到账；使用重入保护 | 与当前 Token 转账语义相符 |
| 外部销毁导致余额低于总本金 | `StockPrincipalDeficit` 在新转账前阻止新增存款 | 已保护新存款，不能补回已有损失 |
| 发行方冻结/暂停 | Token 拒绝 transfer / transferFrom，Vault 调用回滚，账本一并恢复 | 账本不因失败被扣掉，但用户可能暂时无法取回本金 |
| Beacon 实现升级 | 新资金路径检查实现地址和 codehash；不匹配则拒绝 | 防止未经复核继续接收存款，不能约束发行方的新代码 |
| 正常退出 / rageQuit | 仍调用外部 Token.transfer；本协议资产暂停不应无故阻断可行的退出 | 都不能绕过发行方冻结、暂停或已发生的本金损失 |

代码依据：[存款](../../contracts/src/v1/shared/UserStockVaultDeposits.sol)、[退出](../../contracts/src/v1/shared/UserStockVaultExits.sol)、[身份校验](../../contracts/src/v1/shared/UserStockVaultIdentity.sol)、[Stock Registry](../../contracts/src/v1/modules/OfficialStockRegistryV1.sol)。

质押与最低总仓位同样应保持原始 Token 数量口径。若产品未来希望门槛按“标的股份数”或 USD 固定，需要单独制定调整策略，不能直接拿 UI 余额替换现有本金账。同一资产内共同乘数不改变单纯按原始数量计算的相对持仓比例。

## 3. 已确认的发行方权限风险

### 3.1 任意地址销毁：现实的本金缺口来源

验证源码 `Stock.sol`：

- `burn(from, amount)`：要求 `BURNER_ROLE`，检查未暂停及相关地址未冻结，然后直接 `_burn(from, amount)`；**不消耗 from 的 allowance，不要求其签名**。
- `adminBurn(from, amount)`：仅要求 `ADMIN_BURNER_ROLE`，直接 `_burn(from, amount)`；**不要求 allowance，且没有上述暂停/冻结检查**。

因此，授权角色在余额足够时可以扣减 Vault 持有的 Token，而我们不会收到相应的本金账更新。这里是发行方受权操作风险，不是任何普通地址都能发起的无权限漏洞。

现有保护的剩余边界：假设两位用户各存 100，外部销毁后 Vault 只剩 150。新存款会被拒绝，但第一位用户仍可能先提走 100，第二位只剩 50 的实际覆盖。当前退出设计保留剩余本金可退出性，**没有自动按比例分摊损失**。先前本金缺口修复是必要的，但不等于完全解决外部减记。

### 3.2 冻结与暂停：应急退出不能绕过

`Stock.transferFrom` 检查 from、to 和 spender 是否被 Registry 冻结；`transfer` 检查发送者和接收者。冻结 Vault 可能同时阻断存取，冻结用户可能阻断该用户取款。Token 自身及 Registry 全局暂停均会阻断普通转账。

`oraclePaused` 是单独的价格可用性状态，不应与 Token 转账暂停混为一谈；涉及价格消费的后台需独立处理。

### 3.3 共用 Beacon 升级：风险覆盖全部 194 个资产

`AccessControlsRegistry.upgradeTo` 由 `BEACON_UPGRADER_ROLE` 控制，仅要求新地址存在代码；该合约自身没有升级等待期。当前角色持有人是否另外执行多签或时间锁，本轮未验证。

我们的实现指纹检查会阻断漂移后的新资金路径；重新接受实现必须在本协议资产 PAUSED 状态下，经受限治理入口登记预期地址与 codehash。旧资产能否退出仍受新实现控制。冻结、销毁和暂停不改变代码哈希，因此不能仅靠指纹监控发现。

### 3.4 乘数错误配置的额外边界

当前乘数更新只限制大于零及生效时间不早于当前时间，没有业务上限。`_update` 会计算并发出缩放后的转账事件；极端异常乘数下，`Math.mulDiv` 结果超出 uint256 可使转账回滚。这是授权角色错误配置边界，不是正常拆股/分红会触发的问题。

## 4. 生产接入建议与未关闭项

1. **保留原始单位本金账及现有缺口保护。** 不为 UI 乘数引入份额重算，也不把 `balanceOfUI` 用于存取精确余额检查。
2. **明确接受发行方权限风险。** 如果产品要求“任何情况下本金都不能被第三方扣减或冻结”，当前 RH Stock Token 不满足这一条件，包装成另一层 Vault 也不能消除底层资产权限。
3. **上线前确定存量缺口处理政策。** 当前允许先退出者获取剩余覆盖，不是损失按比例分配模型。如要改变，需要专门设计资产级亏损状态、损失分配与恢复流程，避免临时全局停提扩大影响；本轮未修改这一政策或代码。
4. **后端监控实际本金覆盖、销毁、冻结、暂停与升级。** 关注 Vault 的 `Transfer(..., zero, ...)`、Registry 的 `Blocked` / `Unblocked`、暂停事件、`Upgraded` 和角色变更；定期核对 `balanceOf(vault)` 与总本金，并在异常时告警和禁用新增资金操作。事件监控不能阻止授权方操作，也不能取代链上存款保护。WebSocket 需配合重放、finality 与周期核对。
5. **乘数及价格由后端更新数据库。** 索引 `UIMultiplierUpdated`，保存当前值、计划值和 `effectiveAt`；预定值生效只依赖时间，不保证该时刻有新事件，必须安排到点更新/周期核对。UI Token 数、对应股份和 USD 价值分栏。REST 标的价格乘一次乘数，Chainlink Token 价格不重复乘。前端统计读取数据库，遵守既定数据边界。
6. **针对最终部署地址完成真实资产 Fork 验收。** 核对实际用户/Vault 冻结状态、资产 UID、decimals、指纹、存入、质押、正常退出及 rageQuit；补充用实际实现模拟乘数变更、授权销毁、冻结和升级的集成测试。当前普通本地回归不能替代此门槛。

## 5. 本轮验证

执行：

```sh
node tools/run-forge.mjs test --match-contract 'StockVaultCustodyBoundaryTest|UserStockVaultTest|OfficialStockRegistryV1Test'
```

结果：**69 passed / 0 failed / 0 skipped**。覆盖原始本金记账、精确转账、外部余额损失拒绝新存款、剩余本金退出、身份漂移与实现接受等既有本地测试。外部余额损失由测试资产模拟；没有在 RH 主链执行 burn、暂停、升级或任何签名交易，也没有把本轮认定为完整生产 Fork 验收。

## 主要来源

- [Robinhood Stock Tokens：公司行动与股份乘数](https://docs.robinhood.com/chain/stock-tokens/)
- [Robinhood Building with Stock Tokens：原始余额、缩放视图与生效时间](https://docs.robinhood.com/chain/building-with-stock-tokens/)
- [Robinhood Stock Token APIs：REST 与链上价格口径](https://docs.robinhood.com/chain/stock-token-apis/)
- [Stock 当前实现的 Sourcify 验证源码与字节码](https://sourcify.dev/server/v2/contract/4663/0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2?fields=all)
- [AccessControlsRegistry 当前源码与字节码](https://sourcify.dev/server/v2/contract/4663/0xe10b6f6b275de231345c20d14ab812db62151b00?fields=all)
