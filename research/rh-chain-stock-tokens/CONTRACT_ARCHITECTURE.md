# Robinhood Stock Token 合约架构与 TickerGarden 风险边界

> 调研日期：2026-09-04
>
> 网络：Robinhood Chain Mainnet，chainId `4663`
>
> 性质：点时研究资料，不是 Robinhood 权限主体审计报告，也不是生产准入证明

## 1. 结论

当前 194 个官方 Stock Token 并不是 194 套相互独立的业务逻辑。链上观测显示，它们采用同一套共享 Beacon 架构：每个资产有一个独立 ERC-20 代理地址，但全部代理固定指向同一个 `AccessControlsRegistry / IBeacon`，再由该 Beacon 指向同一个 `Stock` implementation。

```text
194 个 canonical Stock Token 地址
        │
        └─ BeaconProxy.delegatecall
                    │
                    ▼
共享 AccessControlsRegistry + IBeacon
  ├─ 全局角色
  ├─ 全局 pause
  ├─ 全局地址 blocklist
  └─ implementation() / upgradeTo()
                    │
                    ▼
           共享 Stock implementation
```

这套架构的管理效率很高，但安全含义也很明确：一次 Beacon implementation 升级可以同时改变 194 个 Token 的运行逻辑；一次对 TickerGarden 共享 Vault 地址的全局 blocklist，也可能同时影响该 Vault 中全部官方 Stock Token 的转出能力。

## 2. 链上与已验证源码证据

| 层 | 地址或数量 | 2026-09-04 观测 |
|---|---|---|
| Token Proxy | 194 个官方地址 | 194/194 runtime 均为 283 bytes，Keccak-256 `0x6c1fdd40002dcb440c7fff6a84171404d279ccb057803b65826f7546acd65630` |
| 共享 Registry / Beacon | `0xe10b6f6b275de231345c20d14ab812db62151b00` | runtime 2332 bytes，Keccak-256 `0x8b465c0b53a2ba499566e9b4ca67d8c90ed6131743df806a570d156956a7e90e` |
| 共享 Stock implementation | `0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2` | runtime 11614 bytes，Keccak-256 `0xdc07e86ee482f99641bdafb9a0d772846b167401e094d90a666b94dbdcd1eec7` |

194 个 Token 的 EIP-1967 implementation/admin 槽均为零，Beacon 槽均指向上述共享 Beacon；这不表示 Token 不可升级，而是表示升级入口集中在共享 Beacon。

Blockscout 的浏览器页面给出的源码验证状态：

- [`Stock` implementation](https://robinhoodchain.blockscout.com/address/0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2?tab=contract)：exact match；`src/Stock.sol`；Solidity `0.8.33`；Cancun；optimizer 200 runs；2026-06-16 验证。
- [`AccessControlsRegistry`](https://robinhoodchain.blockscout.com/address/0xe10b6f6b275de231345c20d14ab812db62151b00?tab=contract)：exact match；`src/AccessControlsRegistry.sol`；Solidity `0.8.33`；Cancun；optimizer 200 runs；2026-06-16 验证。Blockscout 因存在 `implementation()` getter 将其标成 generic proxy，但源码本身同时承担 AccessControl registry 与 `IBeacon`。
- [`CRM` Token Proxy 示例](https://robinhoodchain.blockscout.com/address/0xd95b44124e475743a7589e68f3d74008a5536d44?tab=contract)：OpenZeppelin `BeaconProxy` partial match；构造参数 Beacon 为上述 Registry/Beacon。194 个 Token 的 runtime 指纹与 Beacon 绑定已通过链上批量检查。

机器可读记录见 [`snapshots/2026-09-04/contract-architecture.json`](./snapshots/2026-09-04/contract-architecture.json)。

## 3. `Stock` 实现的主要行为

`Stock` 继承 `IStock`、`AccessControlled`、`OraclePausable`、`ERC20ScaledUIUpgradeable`。以下是对已验证源码和链上 selector/getter 的归纳；它不是完整 ABI 的替代品。

| 能力 | 入口 | 行为及权限含义 |
|---|---|---|
| ERC-20 | `transfer`、`transferFrom`、`approve` | 执行 Token/全局 pause 与相关地址 blocklist 检查；被暂停或被阻断时可拒绝普通转账/授权 |
| Permit | `permit`、`nonces`、`DOMAIN_SEPARATOR` | 支持 EIP-2612；同样受实现中的暂停/地址规则约束 |
| 身份 | `uid()` | 稳定的资产主身份；TickerGarden 应使用 `chainId + uid + canonical token`，不能只信 symbol/name |
| 展示元数据 | `name()`、`symbol()`、`terms()`、`setMetadata(...)` | 元数据可由角色更新，因此不能作为不可变身份 |
| 发行 | `mint(address,uint256)` | `MINTER_ROLE`；同时执行暂停/目标地址检查 |
| 常规销毁 | `burn(address,uint256)` | `BURNER_ROLE`；同时执行暂停/地址检查 |
| 管理销毁 | `adminBurn(address,uint256)` | `ADMIN_BURNER_ROLE`；源码路径直接销毁指定地址余额，不依赖持有人 allowance，并绕开普通 transfer 的暂停/blocklist 门禁 |
| Token 暂停 | `pause()`、`unpause()`、`tokenPaused()` | `TOKEN_PAUSER_ROLE`；作用于单个 Token |
| 全局暂停 | `paused()` | 有效暂停为 Token 自身暂停或共享 Registry 全局暂停 |
| 地址阻断 | `isBlocked(address)` | 读取共享 Registry 的全局地址 blocklist |
| 公司行动 | `uiMultiplier()`、`updateMultiplier(...)` | `MULTIPLIER_UPDATER_ROLE`；支持当前/待生效 multiplier。raw ERC-20 balance 保持不变，UI shares-per-token 与价值解释会变化 |
| Oracle 状态 | `pauseOracle()`、`unpauseOracle()` | `ORACLE_PAUSER_ROLE`；独立的 oracle pause 标志，不应与 Token transfer pause 混淆 |

当前官方 API 的所有 194 个资产均为 18 decimals。协议记账必须使用 raw ERC-20 数量；面向用户显示“对应股数”或估值时才应用 ERC-8056 multiplier，并明确时间戳。

## 4. 共享 Registry / Beacon 的主要行为

`AccessControlsRegistry` 同时提供：

- OpenZeppelin `AccessControl` 风格的角色判断；
- 全局 `pause/unpause`；
- 全局 `isBlocked` 地址集合；
- `IBeacon.implementation()`；
- `BEACON_UPGRADER_ROLE` 保护的 `upgradeTo(address)`。

源码中存在的业务角色包括：`DEFAULT_ADMIN`、`MINTER`、`BURNER`、`PAUSER`、`TOKEN_DEPLOYER`、`BEACON_UPGRADER`、`FACTORY_UPGRADER`、`MULTIPLIER_UPDATER`、`METADATA_UPDATER`、`BLOCKER`、`ADMIN_BURNER`、`TOKEN_PAUSER`、`ORACLE_PAUSER`。

本轮没有可靠闭合每个角色的当前成员、签名阈值、延迟或密钥托管方式。因此资料库只能确认“能力存在”，不能据此断言其运营治理安全。角色 hash 已保存在 `contract-architecture.json`，后续应通过当前 `hasRole` 状态、RoleGranted/RoleRevoked 全历史和 Robinhood 正式治理披露三方交叉验证。

## 5. 对 TickerGarden MultiAsset Stock Vault 的影响

### 5.1 精确转账检查能解决什么

Vault 在每次存取时比较调用前后实际余额，并要求精确收到/付出预期数量，可以拒绝 fee-on-transfer、异常返回值、静默少付、多付等恶意 ERC-20 行为。这仍然是必要不变量。

### 5.2 精确转账检查解决不了什么

外部发行方权限发生在两次 TickerGarden 交易之间，无法由单次 balance-delta 检查阻止：

- `adminBurn(vault, amount)` 可减少 Vault 的某一 Stock Token 实际余额，但 TickerGarden 内部用户负债不会同步减少，形成 `actualBalance < liability`；
- Beacon 升级可一次改变全部 194 个 Token 的行为；
- Token/global pause 或 Vault/user 被 blocklist 时，Stock `transfer` 可直接回滚；
- 共享 Vault 只有一个地址，若该地址进入共享 blocklist，影响面可能从单一资产扩大到 Vault 中的所有官方 Stock Token。

因此，“rageQuit 不受 TickerGarden 自身状态、奖励结算或市场状态阻塞”可以由项目保证；“即使外部 Stock Token 自己拒绝转账，也一定能立即收到本金”在技术上无法由 TickerGarden 强制保证。正确的失败语义应是整笔交易原子回滚、用户本金债权和放弃奖励动作都不被部分写入，待外部 Token 恢复后可重试。

### 5.3 上线前必须落实的控制

1. 监听共享 Beacon `implementation()`、Beacon/runtime codehash 和 194 个 Token proxy runtime；漂移时立即停止新市场、新存款和新增 allocation，但不得在 TickerGarden 层阻断退出。
2. 逐资产持续检查 `actualBalanceOf(vault) >= totalLiability(assetUid)`；发现赤字后隔离该资产的新敞口，不能用其他资产余额掩盖。
3. 监听 `Transfer(vault, 0x0, amount)`、全局/Token pause、Vault 地址 blocklist、角色成员变化与 multiplier 变更。
4. 前端把“TickerGarden 内部限制”和“Robinhood Token 外部限制”分别展示；外部 transfer revert 时不得错误显示为奖励或锁仓问题。
5. 在正式承诺 24/7 即时退出前，取得 Robinhood 关于 Vault 地址准入、blocklist政策、`ADMIN_BURNER_ROLE` 使用条件、Beacon 升级预告与应急联系人书面说明。
6. 对共享 Vault 的单地址集中风险做明确接受；如果运营上无法取得外部保障，再评估按风险域分仓，而不是假设一个地址永远不会被阻断。

## 6. 未闭合项

- 角色实际成员、是否多签、签名阈值与延迟；
- 194 个 Token 当前逐项 `tokenPaused/oraclePaused` 与 Vault/user `isBlocked` 状态的同一区块快照；
- `adminBurn` 的正式法律/运营触发条件；
- 下一次 Beacon 升级通知渠道与可用响应窗口；
- Robinhood 对第三方合约 Vault 的地址合规政策。

这些未闭合项不影响本次“当前合约架构是什么”的结论，但会直接影响 TickerGarden Stock Vault 的生产风险评级。
