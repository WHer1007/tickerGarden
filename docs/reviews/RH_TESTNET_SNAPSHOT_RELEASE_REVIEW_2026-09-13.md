# RH 测试网快照版本复核与部署（2026-09-13）

状态：`DEPLOYED_VERIFIED_ACTIVE_TEST_ONLY`。RH Testnet（46630）已部署并启用基础 ETH 配置，完成链上验收；不构成生产发布批准。

## 复核范围与结论

复核当前源码的 Stock Vault 存取及身份绑定、Gauge 故障隔离、统一 FeeVault 分账与偿付、Holder 快照预算及证明、Creator 权益转移、仅 Quote 首买、治理权限，以及分步确定性部署的构造参数、运行时代码、交易顺序、nonce、费用上限和重试日志。

未发现新的阻止本次测试网部署的合约漏洞。保留用户已确认的业务选择：统一 FeeVault；Holder 从 FeeVault 归集至 Distributor 后发布快照；仅钱包余额；失败的新 Staker 奖励允许放弃并按现有 forfeiture 流程归属 Platform，未来交易仍尝试记账；Stock 外部损失后保持现有退出规则。CO-06、CO-08 不重新列为待修复问题。

## 本轮修正

- 部署准备改用 `wallet-snapshot-v1`，发布标识更新为当前快照及 Staker 隔离版本。
- 部署及激活验收的 `userClaimMode` 更新为当前 `TICKERGARDEN_USER_CLAIM_RAW_ASSETS_V1`，补充源码模式一致性回归。
- 链上验收移除已不存在的 Router `poolManager()`、Holder `STREAM_DURATION/FUNDING_INTERVAL`；检查快照模式、初始 publisher 为零、Staker 子调用 Gas 上限为 4,000,000。
- 统一 Solidity 格式并重建产物，废弃格式变更前的候选证书，重新生成地址、payload、模拟和证书。
- 增加部署工具 ABI 一致性回归测试。
- 新增只读近期固定块 Fork 运行器；不修改生产部署 pin，不执行主网交易。

## 验证证据

目录：`outputs/reviews/rh-snapshot-audit-2026-09-13` 与同名 `-simulation` 目录。

- 格式规范后的完整非 Fork 回归：933 项通过，0 失败、0 跳过，见 `contracts-final.log`。
- Spec：63 项；当前合约表面：3 项；部署：66 项；优化工具：12 项；新增部署工具：4 项。
- 编译、运行时大小、依赖锁、格式、生成接口和产品产物一致性检查通过。
- 旧生产固定块 Fork 返回 `metadata is not found`，不能用作本轮成功证据。
- 新取得、核对链 ID 与哈希的近期主网区块：`fresh-mainnet-fork-pin.json`；真实业务 Fork 两项通过，见 `fresh-mainnet-fork.log`。使用真实官方合约状态；测试账户资金由 Foundry 合成，不是自然链上余额。
- RH 测试网 19 笔无签名部署交易真实状态模拟成功；全部地址、构造参数、payload、nonce 和调用顺序通过核对。
- 模拟 RPC 的 Gas 数值低于部分创建交易的 EVM 代码存储成本，不能直接广播这些 Gas 值。受控发送器在每笔交易前重新估算，并使用运行时代码存储下限和余量，整套核心部署费用上限 0.02 测试 ETH。

## 保留的限制与优化空间

1. 发布者是链下分配正确性的信任点。预算与证明验证不能证明历史钱包余额计算正确；Guardian 撤销只能阻止后续发布，不撤销已发布轮次。用户尚未提供 publisher 地址，因此本次不设置。
2. Stock/Quote 的外部发行方升级、冻结或扣减余额风险仍存在。Vault 缺口阻止新存款，但现有退出规则不按比例分摊旧损失；这是明确保留的规则。
3. Factory 运行时 23,880 字节，距 EIP-170 尚余 696 字节，距项目 24,000 字节预算仅余 120 字节。后续功能扩展应先拆分代码，不能继续无约束增加。
4. 部署发送器在恢复时存在保守的费用重复计数空间，会提前触发费用上限，不会增加授权花费；本次使用无历史交易的新 release。
5. 不启用后台自动快照，不更改主网 Safe、生产参数或网站/数据库版本。核心部署验收与前后端切换、资产启用、角色交接分别记录。
6. 当前工作区包含此前已授权的多个模块改动；发布身份以重新生成的 payload、编译产物及逐文件 SHA-256 为准，不将旧 HEAD 冒充本次完整源码版本。证书绑定所有生产 Solidity 源码；任何变化必须重新审查和签发。

## 部署结果

- Release：`0xc3fe24f129cdb1a7084d57a1b2c0fcc14bc6aae9c045d7e9519ee0aa96715d44`。
- 核心合约 21 个：19 笔部署交易成功；另部署 1 个测试 Baseline fixture 并完成配置，共 4 笔激活交易成功。合计 23 笔，均逐笔核对 sender、nonce、input、receipt 和所在区块哈希。
- 核心部署费用：0.00053814895 ETH；基础配置费用：0.00007153119 ETH；合计 **0.00060968014 测试 ETH**。
- ETH 测试配置：毕业阈值 0.42 ETH，虚拟储备 0.168 ETH，供应量 1,000,000,000。未修改生产的 3 ETH / 1.2 ETH 参数。
- 创建及首买 `eth_call` 模拟通过；未创建真实新市场，因此不声称已完成公开测试网全业务实盘 E2E。
- 新 release 尚未注册 Stock 资产、设置 snapshotPublisher 或交接治理角色。测试管理员仍为既有测试部署者；生产 Safe 未参与。
- 网站、Read API、数据库、Indexer 和现有市场尚未切换到新 release。此记录交付的是已验证合约及基础 ETH 配置，不能将其理解为整个测试站已更新。
- 最终核对确认：证书绑定的所有文件 SHA-256 未漂移；源码包位于本轮 review 目录 `contract-source.tar.gz`。

[完整部署清单](../../deployments/releases/0xc3fe24f129cdb1a7084d57a1b2c0fcc14bc6aae9c045d7e9519ee0aa96715d44/robinhood-testnet-46630.v1.deployed.json) · [交易记录](../../deployments/releases/0xc3fe24f129cdb1a7084d57a1b2c0fcc14bc6aae9c045d7e9519ee0aa96715d44/robinhood-testnet-continuous-transactions.json) · [基础配置与模拟](../../deployments/releases/0xc3fe24f129cdb1a7084d57a1b2c0fcc14bc6aae9c045d7e9519ee0aa96715d44/activation.json) · [最终汇总](../../deployments/releases/0xc3fe24f129cdb1a7084d57a1b2c0fcc14bc6aae9c045d7e9519ee0aa96715d44/review-summary.json)

| 合约 | 测试网地址 |
| --- | --- |
| AccessManager | [`0xDC07C13FE0e3FF981f36F167bDbF758852b90DF9`](https://explorer.testnet.chain.robinhood.com/address/0xDC07C13FE0e3FF981f36F167bDbF758852b90DF9) |
| OfficialStockRegistryV1 | [`0xe910D0D392c50f7B5057851b10872997b7617d19`](https://explorer.testnet.chain.robinhood.com/address/0xe910D0D392c50f7B5057851b10872997b7617d19) |
| ApprovedQuoteRegistry | [`0x3d8CC9ca77891E112dFF6Ad0c84EFe0839Ab1D0E`](https://explorer.testnet.chain.robinhood.com/address/0x3d8CC9ca77891E112dFF6Ad0c84EFe0839Ab1D0E) |
| TickerGardenBaselineRegistry | [`0xF5A23220645ddBcb358D6a186D1B5F7FCcAC3bE7`](https://explorer.testnet.chain.robinhood.com/address/0xF5A23220645ddBcb358D6a186D1B5F7FCcAC3bE7) |
| LaunchTemplateRegistry | [`0x24CEDae1dcDa7c914799a5952C4Fcc72321685f7`](https://explorer.testnet.chain.robinhood.com/address/0x24CEDae1dcDa7c914799a5952C4Fcc72321685f7) |
| LaunchConfigResolver | [`0xdb5111899F0E83d619c39b8cB61132A046E185Ab`](https://explorer.testnet.chain.robinhood.com/address/0xdb5111899F0E83d619c39b8cB61132A046E185Ab) |
| TickerMemeTokenV1Implementation | [`0x398Cd33588aD0d2EbeECCFee26AcdACE7ffD4CB6`](https://explorer.testnet.chain.robinhood.com/address/0x398Cd33588aD0d2EbeECCFee26AcdACE7ffD4CB6) |
| TickerGardenCurveImplementation | [`0xEC5Ef661e615298Ec636F97209160Cb900d671ed`](https://explorer.testnet.chain.robinhood.com/address/0xEC5Ef661e615298Ec636F97209160Cb900d671ed) |
| MemeStockGauge | [`0x4976DCB40f866c49aE7F59B53B5495D7d35930fB`](https://explorer.testnet.chain.robinhood.com/address/0x4976DCB40f866c49aE7F59B53B5495D7d35930fB) |
| LaunchAndBuyRouter | [`0xAbB92b57Be652f210E41F662525A695836A8A2eC`](https://explorer.testnet.chain.robinhood.com/address/0xAbB92b57Be652f210E41F662525A695836A8A2eC) |
| MarketRegistryV1 | [`0x4D9dF59754c274B5c7740cFB82456118F1F79C56`](https://explorer.testnet.chain.robinhood.com/address/0x4D9dF59754c274B5c7740cFB82456118F1F79C56) |
| CreatorRevenueRegistry | [`0x5d3634E60E6970422c7A582FAbfCB92Ddc76b0D2`](https://explorer.testnet.chain.robinhood.com/address/0x5d3634E60E6970422c7A582FAbfCB92Ddc76b0D2) |
| AllocationManager | [`0xD765f638f674627fE8FAD8ad498AdE80460C6af9`](https://explorer.testnet.chain.robinhood.com/address/0xD765f638f674627fE8FAD8ad498AdE80460C6af9) |
| UserStockVault | [`0xf9773510f690503d5cC36D1B36BaD8283D4dFa52`](https://explorer.testnet.chain.robinhood.com/address/0xf9773510f690503d5cC36D1B36BaD8283D4dFa52) |
| HolderRewardsDistributorV1 | [`0x89F36F889f050790aC5CE9a60A2428c93d6b9108`](https://explorer.testnet.chain.robinhood.com/address/0x89F36F889f050790aC5CE9a60A2428c93d6b9108) |
| ProtocolFeeVault | [`0x70Ae70F98125567317C4eEA05967E8Eb52bd0986`](https://explorer.testnet.chain.robinhood.com/address/0x70Ae70F98125567317C4eEA05967E8Eb52bd0986) |
| V1RobinhoodTestnetDeploymentOrchestrator | [`0xDAaFd689a9946dB676fDBb0F843019513BfCA961`](https://explorer.testnet.chain.robinhood.com/address/0xDAaFd689a9946dB676fDBb0F843019513BfCA961) |
| V1HookExecutorDeployer | [`0x76724A530E6DC081CEb0e376F342904f6655e528`](https://explorer.testnet.chain.robinhood.com/address/0x76724A530E6DC081CEb0e376F342904f6655e528) |
| TickerGardenMemeHook | [`0xAB979ecb013d93dE831C895D471452d882386044`](https://explorer.testnet.chain.robinhood.com/address/0xAB979ecb013d93dE831C895D471452d882386044) |
| GraduationExecutor | [`0xfabe27aeDD521e03Ef3497DB8359cD0f1D035c68`](https://explorer.testnet.chain.robinhood.com/address/0xfabe27aeDD521e03Ef3497DB8359cD0f1D035c68) |
| TickerGardenFactoryV1 | [`0x28c4A042417D75c6580030eea08FE4b63b0eC6cb`](https://explorer.testnet.chain.robinhood.com/address/0x28c4A042417D75c6580030eea08FE4b63b0eC6cb) |
