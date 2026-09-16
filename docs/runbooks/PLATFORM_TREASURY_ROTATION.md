# Platform Treasury 延迟迁移

适用：2026-09-13 新生产候选。未部署、未广播；旧 release 不支持此流程。

## 角色与地址

- 初始 `V1_PLATFORM_TREASURY`：已部署在目标链的 Treasury Safe。
- FeeVault `authority()`：与四个治理 Registry 相同的 AccessManager，部署后不可替换。
- Governance：活跃角色 1；Guardian：活跃角色 2。Guardian 必须独立于 Governance/Unpause，允许 Treasury 与 Guardian 共用地址。
- Treasury 状态位于 FeeVault；Factory 每次收取创建费时读取它。

## 提议、确认、生效

1. 核对 chain ID、FeeVault/Factory 实例、当前收款地址和新 Safe 的 owners/threshold、singleton、modules、guard、fallback handler、ETH/ERC20 收款/转出能力。不要只比对外层 codehash。
2. Governance Safe 以普通 CALL 直接调用 FeeVault 的 `proposePlatformTreasury(newSafe)`。读取 `PlatformTreasuryProposed` 的 nonce、readyAt、old/new 地址和 codeHash；合约设置 `readyAt = block.timestamp + 172800`。
3. 新 Treasury Safe 通过自身多签交易以 CALL 调用 `acceptPlatformTreasury(nonce)`。第三方不能代替，EIP-712 的 Safe 地址和链 ID 必须与新 Safe 匹配。可在等待期内确认，确认本身不会切换。
4. 到达 readyAt 且确认成功后，任意执行钱包可调用 `executePlatformTreasury(nonce)`。合约重新验证提议者仍为活跃治理成员、新地址代码存在且 codehash 未变。
5. 检查 `PlatformTreasuryChanged` 及同一区块 Factory/FeeVault 的 `platformTreasury()` 返回值一致。使用一笔平台费用领取核对新收款人和余额，再更新运维/财务登记。

Treasury 的 48 小时由目标合约状态机实施；这些方法**不使用 AccessManager.schedule/execute**。其他普通治理方法仍遵循 AccessManager 的执行延迟，不受此例外影响。已撤销成员应同时取消其待执行提议；若以后重新授予同一地址角色，活跃成员检查本身不会永久封禁它的历史提议。

## 取消和重试

Governance 或 Guardian Safe 可直接调用 `cancelPlatformTreasury(nonce)`，无需等待。已被新地址确认或已经到期但尚未执行的提议也可取消。取消不能撤销先被打包执行的切换，应在截止前留出足够响应时间。

一个时间点只允许一个提议。修改候选地址必须先取消旧提议，再重新发起；新的 nonce 和 48 小时计时都重新生成。旧 nonce 的确认、取消和执行全部拒绝。重复执行已完成提议也拒绝。

## 财务边界

- 创建费：切换生效前支付旧 Treasury，生效后支付新 Treasury；接收方拒收 ETH 仍会让创建回滚。
- 交易费：所有尚留在 FeeVault 的平台负债在实际领取时支付当前 Treasury，不按迁移时间拆分旧、新平台归属。
- Creator/Staker/Holder 权益、本金、LP 均不受迁移权限控制。
- 已进入旧 Safe 的资金不能由本流程取回。更换 Treasury 不能解除发行方对 FeeVault 或用户地址的冻结，也不能补回外部扣减造成的缺口。
- 新地址确认和外层 codehash 不是完整 Safe 安全证明；生产监控必须覆盖提议事件、取消、生效、Safe 配置变化及角色变更。

## 发布核验

首次发布 preflight 强制核对 FeeVault authority、两处 Treasury 一致、48 小时常量、pending=0、proposal nonce=0，以及现有权限交接证据。运行中合法迁移后应制作新的状态登记，不能拿初始部署清单当当前 Treasury 状态。

仅将生产治理角色授权给审核过的 Safe，并撤销部署者 bootstrap ADMIN_ROLE。更换地址需要新的治理/接收方签名；本 runbook 不构成任何广播授权。
