# Arbitrum Receiver Fix R2 Test Record

日期：2026-09-06。网络：Arbitrum Sepolia（chainId 421614）。本文记录接收器修复的测试范围与当前发布状态；不构成生产发布或公开链毕业结论。

## 修复边界

`ArbitrumTestTreasury.configureSettlementOperator(address feeVault, address operator)` 为 owner-only。调用前验证 operator 非零且不等于 receiver，feeVault 有运行时代码，且 `feeVault.platformTreasury()` 等于 receiver。接收器随后调用 `setSettlementOperator(operator)`，再读取 `settlementOperator()` 并要求等于目标 operator；任一校验失败都回滚并使用 `Unauthorized` 或 `InvalidSettlementConfiguration`。

由于 treasury 是 FeeVault 的不可变平台接收方，旧接收器无法原地升级。本次修复需要随关联核心图重新部署；旧 release 已归档于 `deployments/releases/<old-release>`。新的预览清单为 `deployments/manifests/arbitrum-sepolia-421614.v1.preview.json`，新的接收器记录为 `deployments/manifests/arbitrum-sepolia-421614.test-treasury-r2.json`。

R2 不改变原 4.2 ETH 毕业门槛或 1.68 ETH 相关经济参数，也不构成生产权限已去中心化的声明。当前核心已完成 19 笔广播，执行者与 3 项业务配置均已上链；完整公开链毕业测试未执行。

## 已覆盖的测试

本地 deployment 单元套件共通过 24 个测试。接收器配置用例使用最小真实行为 vault stub，覆盖：

- owner 配置成功，以及 operator rotation；
- 非 owner 拒绝；
- 零地址 operator 与 receiver 自身作为 operator 拒绝；
- EOA vault、错误 `platformTreasury` 拒绝；
- vault setter 后 getter 不匹配时拒绝，并验证状态回滚；
- 既有提款、owner 与网络部署约束继续通过。

Fork 测试在本地 Fork 部署修复后的 receiver 合约和真实链上依赖路径，验证 owner 配置、vault 绑定、setter 调用者约束及 getter postcondition。Fork 通过不等同于 Arbitrum Sepolia 已完成完整公开链验收。

## 激活工具边界

本次 activation tool 已按新的清单配置 settlement operator，然后配置 fixture、quote 与 template，并执行只读的 `launchAndBuy` smoke。该步骤用于确认新 release 的短链路和配置一致性，不代替完整公开链毕业、费用对账、持有人分配或 30 天长周期测试。

每个实际链上步骤应保存 chainId、交易哈希、区块号/哈希、receipt、代码哈希、配置清单和前后状态；本次 receipts 已取得；旧 preview 文件仍只表示地址预测，实际状态以部署/激活清单为准。

## 当前结论

状态：DEPLOYED_VERIFIED_ACTIVE_TEST_ONLY。

- Release：`0x52e3a1752759c8af00047af2b2e1d8b091cc4d7abab6d6f6cd2097e209c247d9`。
- Factory：`0x53cbd5050e05901Ee0A3D7525e534a5A84e357F3`；Router：`0x363dDF1FFcDb5D57B0AbEc1e1F89F5D45FD7340B`。
- Receiver：`0xB39BD5e7BB13CF2C0EA513e8bE69b6DCa3a42dE9`；operator：`0xA6c3298a5559544c3b4cf8e6DC5f349f4be524ea`。
- 19 笔核心部署 + 1 笔 receiver + 5 笔权限/激活交易均确认。
- 21 个核心/部署地址 runtime 与绑定已验证。24 项部署测试、1 项真实 v4 依赖的本地 Fork 集成、57 项前端测试及 Arbitrum Sepolia 前端构建通过；Fork 的持有人根仍是明确标注的合成数据。
- 链上执行者配置回执：`0x7d6d6ca49a5dbcf2d852923db3eca12ecbc30426fd048504f7bcdb3aebba5d3b`。
- 授权 operator 到达参数校验、非 operator 被拒绝、非 owner 不能配置：只读 RPC 探测通过。
- 测试基线、native ETH quote、模板均为 ACTIVE；只读 launchAndBuy 模拟通过，没有创建额外市场。
- 毕业参数仍为 4.2 ETH / phantom 1.68 ETH；公开链完整兑换、真实 TWAB 根和长周期领取未执行，生产多签/角色拆分不在此次修复内。

部署与激活分别见 `deployments/manifests/arbitrum-sepolia-421614.v1.deployed.json` 和 `.v1.activation.json`；日志见 `outputs/reviews/arbitrum-wallet-deployment/receiver-r2-*` 及 `receiver-fix-*`。
