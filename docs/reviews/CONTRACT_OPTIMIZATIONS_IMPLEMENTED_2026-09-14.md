# 合约 Gas、体积与规范一致性优化

日期：2026-09-14。承接 [全面审查](./CONTRACT_COMPREHENSIVE_REVIEW_2026-09-14.md) 的 R-01、R-02 与 O-01。仅修改当前候选源码；未部署、未广播、未启用 worker，也未修改现有本金缺口或 Holder 发布权限政策。

## 实现结果

### 1. 零权重探测覆盖真实冷调用链

[ProtocolFeeVaultV4Accounting.sol](/Users/dear/Documents/code/TickerGarden/contracts/src/v1/shared/ProtocolFeeVaultV4Accounting.sol) 将只读权重探测从100,000提高至300,000 Gas，覆盖 Gauge → AllocationManager → Registry → Vault 的32槽遍历。固定4字节 calldata 和32字节 returndata 使用 scratch memory，移除动态 bytes 分配。

只有 staticcall 成功、返回长度恰好32字节且权重为零，才进入轻量结算。空返回、短返回、多余字节、revert 和耗尽 Gas 均不能被当成零。失败或非零权重仍进入原来的4,000,000 Gas self-call；EIP-150 余量、300,000 reserve、子调用回滚和防故意低配 Gas 的规则均保留。没有降低健康 Staker 的奖励结算预算或改变奖励归属。

复现测试改为要求30个未来桶在外层1,000,000 Gas 上限内成交，并增加1–30桶 fuzz、冷/热路径、首次激活时间边界、异常返回和资金回滚验证。已有30个成熟桶、双资产非零指数及故障隔离测试继续通过。

| 调用区间观测 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 本地真实双账本，30个未来桶 | 1m上限回滚；8m上限下实耗703,793 | 1m上限成功，实耗605,336 |
| 本地真实双账本，30个成熟桶 | 2,920,292 | 2,856,233 |
| 主网 Fork，真实 Registry/Stock，30个未来桶的冷权重读取 | 本轮未测旧版该组合 | 151,448，250k限额内成功，低于300k探测预算 |
| 同一主网 Fork 场景的池交易 | 本轮未测旧版该组合 | 1m上限成功，实耗548,418 |

这些是测试调用区间，不是实际广播 receipt、RH L1数据费或全部生产组合的最坏上界。主网 Fork 仅以本地合成余额资助测试用户，随后执行真实 Stock 和当前完整合约图。

测试：[Review20260914RewardGas.t.sol](/Users/dear/Documents/code/TickerGarden/contracts/test/v1/audit/Review20260914RewardGas.t.sol)、[V1ProductForkE2E.t.sol](/Users/dear/Documents/code/TickerGarden/contracts/test/v1/fork/V1ProductForkE2E.t.sol)。

### 2. 减少重复计算和身份查询

FeeVault 在验证费用时计算一次 Creator tax，并将结果传给分账函数，避免对同一费用重复执行计算。基础费与 Creator tax 仍分别向下取整；税额仍全部归 Creator。

[V1FactoryValidation.sol](/Users/dear/Documents/code/TickerGarden/contracts/src/v1/shared/V1FactoryValidation.sol) 保留 `assetIdentityCurrent` 的完整 Stock/Vault 身份校验。随后针对 Factory 的二次校验使用明确的已登记 runtime codehash、非空代码、schema、reverse binding 和 Vault 自报依赖，不再调用一次完整 `vaultIdentityCurrent`。因此省去重复 Registry 查询及其内部 `vaultIdentity()` 调用，而 Factory 所需的 Registry/MarketRegistry/AllocationManager/schema 绑定仍逐项验证。

新增测试在 Registry 报告身份有效的情况下，分别改变 runtime 承诺、移除 Vault 代码、改变 Vault 依赖，均确认预览拒绝。已有旧 schema、身份漂移、创建回滚和真实 Registry Fork 测试继续通过。

| 合约 | 原 runtime | 当前 runtime | 减少 | 当前项目预算余量 |
| --- | ---: | ---: | ---: | ---: |
| Factory | 23,583 | 23,515 | 68 bytes | 485 / 24,000 |
| FeeVault | 23,148 | 23,107 | 41 bytes | 393 / 23,500 |

体积改善有限，原有项目预算继续执行，没有放宽上限。此次未改变外部函数、事件、权限或存储布局；产品 manifest 仅更新这两个模块的 creation/runtime 代码身份和整体 hash。新代码身份需要新的部署计划，不能复用旧计划中的预测地址或 codehash。

### 3. 规范正文与验收同步

统一执行规范、协议参数、LP fee、Creator tax 文档中的当前规则，并把指定旧 release 的奖励兑换文档明确标记为历史说明：

- 通用 Quote 可经管理员风险审查准入可升级 ERC20；实现指纹承诺是更强的可选 Stock Quote 路径，不能混为同一种保证。
- 当前领取为 Quote/Meme 原资产选择；没有内部兑换、98%输出规则或兑换 deadline。Staker24小时锁和 `burnMemeFees` 继续有效。
- 实际 PoolKey/slot0 LP fee 使用创建时冻结的0/1000/2000/3000 pips；协议 LP 分成为零，策略占位 `poolKeyFee=0` 不覆盖市场选择。
- Creator tax 为创建时冻结的0–500 bps，独立计算且全额归 Creator。公式区分基础费、税额与总额：只有基础费参与 Staker/Platform 比例和 Holder 的 Creator 基础份额分成。
- 验收引用当前 ABI、权限矩阵、执行 manifest 与编译产物，移除旧 Treasury reviewer、旧 mutation 数量和没有绑定当前候选版本的“已通过”断言。历史计划拒绝规则保留。

[规范测试](/Users/dear/Documents/code/TickerGarden/spec/test_v1_execution_spec.py) 新增4个章节级回归，检查准入保证、税额/LP公式、原资产领取和产物验收边界；不是全文件关键词存在性检查。在内存中替换为修改前的文档后，4项全部失败；当前文档4项全部通过。见 [语义回归证据](./evidence/contract-optimization-2026-09-14/semantic-regression-evidence.json)。

## 验证与边界

| 检查 | 结果 |
| --- | --- |
| 完整非 Fork 合约测试 | 97 suites，1,062 passed，0 failed，0 skipped；包括相关 invariant suites |
| Robinhood mainnet candidate Fork | 4 passed，0 failed，0 skipped |
| Spec | 67 passed |
| Web 构建、生成文件、类型检查及测试 | 通过；430 tests passed |
| Backend/部署包构建和测试 | 通过；Backend unit86、contract10、部署包68 passed，包含重叠验证，不合计为独立覆盖数 |
| runtime、接口、fixtures、product artifacts、boundary | 通过 |
| 干净重编译与产物来源 | 22个产物、582项源码hash核验通过；没有检查或生成待广播交易batch |
| runtime/CI/RPC代理/构建来源工具测试 | 36 passed |
| 当前收益直接消费者检查 | 5 passed |
| 新修改 Solidity 格式 | 通过 |
| deployment track | build和68项部署测试通过；live-plan阶段拒绝历史legacy plan，整体未通过 |

Fork：chain4663，区块61,361,538，hash `0xb934dc407b452ecba77ea28f4187f223a3de508d7211f74ec62a983c26ca92ce`。使用已有内部 RPC 与固定区块兼容代理，只读执行，没有关闭 TLS 校验。

默认 deployment track 的旧计划仍触发 `/configurationInputs must NOT have more than 21 items`。这不是本轮合约回归失败，也没有通过放宽 schema 绕过。新的候选计划、生产账户检查、外部独立审计、浏览器 E2E、数据库集成环境与生产发布验证不由上述通过项替代；本轮没有执行部署。

额外的编译来源核验曾发现增量编译遗留的旧部署脚本产物。已用 `node tools/run-forge.mjs build --force` 干净重编译，并重新通过 runtime、接口、product manifest 与源码来源检查；见 [来源核验](./evidence/contract-optimization-2026-09-14/build-provenance.json) 和 [干净构建检查](./evidence/contract-optimization-2026-09-14/clean-build-checks.json)。代码身份没有因重编译发生额外变化。

主要证据：[合约完整测试](./evidence/contract-optimization-2026-09-14/contracts-full.log)、[Gas优化前](./evidence/contract-optimization-2026-09-14/gas-before.log)、[专项优化后](./evidence/contract-optimization-2026-09-14/targeted.log)、[主网Fork](./evidence/contract-optimization-2026-09-14/mainnet-fork.log)、[门禁结果](./evidence/contract-optimization-2026-09-14/contract-checks.json)、[源码与文档变更](./evidence/contract-optimization-2026-09-14/implementation.diff)。
