# FeeVault 领取优化与兑换 Gas 储备 — 2026-09-12

## 改动

1. `ProtocolFeeVaultLiabilities._payFeeAsset` 复用精确付款检查已经读取的 `vaultBalanceAfter`，用于本次付款后的偿付检查。原生币路径在付款回调返回后记录实际 ETH 余额。保留精确转出、精确到账、负债断言以及统一领取结束时的分资产偿付检查。
2. `ProtocolFeeVaultUserClaims._attemptUserConversion` 为权益恢复、两种资产付款、事件及最终检查保留 300,000 Gas，另外扣除 30,000 Gas 作为编码/调用开销余量。只有剩余预算超过上述两项再加 100,000 Gas 的最低兑换尝试预算时才发起兑换；实际转发预算为剩余 Gas 减去 330,000。EIP-150 只会进一步压低子调用获得的 Gas。
3. 预算不足时跳过兑换，标记 conversionFailed，并执行用户已选择的路径：`rawFallback=true` 支付剩余 Meme，false 恢复其 Meme 权益；已有 Quote 正常进入付款路径。没有增加管理员权限、修改收益归属或恢复最低兑换输出限制。成功与部分成交路径保持原有精确结算和 allowance 清零。

## 边界

Gas 储备在权益消费结束后计算。外层交易必须首先有足够 Gas 完成市场查询、权限/锁定检查和权益消费，并有足够预算完成 fallback。极低交易 Gas、拒收 ETH 的收款合约、冻结或任意高耗时的外部 token 仍可能导致原子回滚；储备不构成对任意外部代码的付款保证。跳过兑换也不代表获得了成功兑换报价，事件会标记失败。

调用方需用一致且充足的 Gas 预算进行兑换模拟和发送；由于 fallback 本身可以成功，`estimateGas` 的成功只表示交易可完成，不保证兑换被执行或完成。应以回执中的实际兑换量和失败标记确认结果。

300,000 是针对当前三类恢复/付款路径的保守固定预算，30,000 是固定形状 MarketView 编码及 CALL 余量，100,000 是低预算下避免无效尝试的门槛，不是保证任意真实池兑换成功的最低 Gas。未来修改恢复链路、支持的 token 或调用编码时必须重跑矩阵并重新评估。

## 回归证据

- `ClaimCompletionGas.t.sol`：Creator、真实 MemeStockGauge 克隆 Staker、真实 HolderRewardsDistributorV1 + TickerMemeTokenV1 Holder，共 3 × 2 种 Quote × 2 种 fallback × 冷/热访问 = 24 组。每组外层预算 1,500,000 Gas，并要求 Hook 调用实际出现；Hook 的 `invalid()` 消耗子调用 Gas。验证 Quote 付款、Meme 支付/恢复、另一 Creator epoch 负债、授权清零、再次领取与不重复付款。
- Gas 测试中的 FeeVault 使用继承实际领取实现的账本注入 harness，Registry/管理器及耗尽 Gas 的 Hook 是测试替身。真实 Gauge/Holder 的恢复和结算逻辑没有被替换。不是线上 RPC/Fork 性能数据。
- 原始 Creator 500,000 Gas 两种 fallback 回归通过；另有 300,000 Gas 两种低预算跳过兑换测试，明确断言没有调用兑换 Hook。
- 新增跨资产回归：第二种资产付款时恶意扣减第一种资产，最终偿付检查仍捕获缺口，用户付款和权益消费全部回滚。
- 原币 Creator 双资产调用对每个 ERC20 的 `balanceOf(FeeVault)` 读取从 5 次降至 4 次。相同本地 harness 测量由 192,347 Gas 降到 190,274 Gas，约减少 2,073 Gas（1.08%）。该数字含当前完整改动，不是链上交易费用承诺。

## 验证记录

- 完整本地 Foundry 回归：88 suites，984 passed，0 failed，0 skipped，含资金账本不变量；真实 Fork 路径排除。
- execution spec：63 passed；当前合约 surface：3 passed；CI 工具单元测试：24 passed。
- boundary、fixture、interface 与编译接口 manifest 检查通过；产品 artifact manifest 已生成并校验，哈希 `0xe963a5aba15473a585f77d07d75459a011da280b0abaa29691023d78f85d4c69`。
- FeeVault runtime template 20,655 bytes，低于 EIP-170 的 24,576 bytes 限制；本轮增加 163 bytes。
- `git diff --check` 通过。
- 证据：`outputs/reviews/fee-claim-optimization-2026-09-12/` 的日志与文件 SHA-256。

真实 Fork 及部署未在本轮执行；合约逻辑变更不会自动更新已部署合约。产品产物清单已按当前本地源码重新生成，历史发布与部署证据不作改写。
