# 合约开销优化实施与验证

日期：2026-09-13。基于包含 Creator 可选 LP 费率的未提交工作区。状态：源码与产物已更新、验证通过，**NOT_BROADCAST**。本轮没有提交、部署、更改 RH/Vercel 指向或启用周期任务。

## 实际完成的优化

1. **FeeVault 交易内上下文**：V4/Curve 的 pending 记录和共享 credit 状态使用独立命名空间的 transient storage。仍执行 begin → 精确到账 → finalize；正常完成显式清空，支持同交易连续入账。来源、sourceVersion、Creator epoch、nonce、feeId、余额差、负债、偿付和重入检查保留。跨交易的 consumed feeId、nonce、权益和余额账本仍是持久存储。
2. **Factory 构造上下文**：Curve 构造时需要的 16 个静态内存字段及唯一允许回调的 Curve 地址使用 transient storage，构造后清空。固定部署 delegate target、CREATE2 预测、初始化身份与原子创建语义保留。
3. **Curve、Factory、Locker 的重入锁**：采用仓库已有 OpenZeppelin `ReentrancyGuardTransient`，不升级依赖。锁在入口设置、正常返回清理；失败回滚由 EVM 保证。不能把交易结束自动清空当作省略正常清理的理由。
4. **Gauge 激活快照 4 → 3 个存储槽**：内部只存 Quote 指数、Meme 指数和完整 uint256 引用数。外部 `ActivationSnapshot` 结构与 `processed` 字段保留，由 `refs != 0` 计算。金额、指数、引用数均未缩窄。
5. **Gauge/Vault 队列按需读取**：先读 generation，只在桶成熟时读取 amount/refs。保持 32 槽、30 秒激活与既有空队列提前返回；没有增加需随 Stake/退出维护的位图或最早时间索引。
6. **Hook 精简 PoolKey 读取**：校验哈希时使用 Registry 已有 `canonicalPoolId()`，避免完整 PoolKey 跨合约返回后再次编码。Registry 内仍通过 canonicalPoolKey 和 baseline 验证计算哈希，不引入可漂移的缓存。完整 MarketView 的三处来源复核保留。
7. **Holder 批量发布**：每批只读取一次 `CanonicalBlockClock.number()`，逐项 block hash、轮次、预算和偿付验证保留，后项失败仍整批回滚。

FeeVault 字段重排也进行了独立试验，见 `packed-v4-gas.log`；最终方案采用 transient 上下文，因此不把“7→6 个持久槽”与 transient 的节省重复相加。

## Gas 结果与口径

最可靠的一组比较使用**独立本地 Anvil Cancun 交易回执**：分别导入优化前后的 fixture 状态，发送相同 calldata。两笔交易均成功，五条业务日志逐项一致。

| 场景 | 优化前 | 优化后 | 减少 |
| --- | ---: | ---: | ---: |
| 未启用 Stake 的 swap，Anvil receipt gasUsed | 503,630 | 473,177 | 30,453，约 **6.05%** |

回执 gasUsed 已包含该交易的退款结算，不能再减一次 refund。该 fixture 使用真实 PoolManager、Hook、FeeVault 和 Meme Token，含 mock Registry/Quote/Creator 配置；LP 费率为 0、Holder 分享开启。它不是 RH 数据发布费或所有配置的统一报价。

另两组为 Foundry 指定调用区间，不与交易回执直接混用：

| 场景 | 优化前 | 优化后 | 区间减少 |
| --- | ---: | ---: | ---: |
| 活跃 Stake、无待激活桶的 `_sell()` | 605,229 | 588,290 | 16,939，约 **2.80%** |
| 30 个成熟桶、双资产指数非零的整次 swap 区间 | 3,253,289 | 2,561,877 | 691,412，约 **21.25%** |

30 桶测试使用真实 Gauge clone，但 Allocation 权重来源是 mock，不是生产最坏上界。4,000,000 的 Staker 结算预算和 300,000 的父调用保留预算没有降低。

新增诊断还记录了 `lastCallGas` 的 total/refund，见 `refund-aware-before.log`、`refund-aware-after.log`。在当前 Forge 1.8.1 的隔离执行模式下，测试函数汇总 Gas 与被测交易回执口径不同；此次以 Anvil receipt 独立核实普通交易收益，没有把测试函数总量当作钱包费用。诊断 getter 在当前工具中已标记 deprecated，仅用于测试，不进入产品合约。

## 字节码体积

| 合约 | 优化前 bytes | 优化后 bytes | 说明 |
| --- | ---: | ---: | --- |
| Factory | 23,824 | 23,583 | 项目 24,000 预算剩 417 |
| FeeVault | 23,104 | 23,040 | 项目 23,500 预算剩 460 |
| MemeStockGauge | 12,997 | 12,905 | 激活快照压缩 |
| Hook | 8,738 | 8,657 | 使用既有哈希 getter |
| Curve | 17,829 | 17,838 | transient guard 的体积/执行成本权衡 |
| Locker | 8,771 | 8,802 | 同上 |
| Holder Distributor | 12,491 | 12,493 | 批量复用区块高度 |
| UserStockVault | 12,307 | 12,310 | 队列读取顺序调整 |

全部通过既有 runtime gate，没有放宽预算或修改编译器优化参数。较小 Gas 不要求每个模块字节码同时缩小。

## 安全等价性与测试

Gauge 表示的等价条件是：新快照只以正引用数创建；有多个引用时只递减为正数；最后一个引用移除时删除全部字段。因此可达状态中 `processed` 与 `refs != 0` 等价。新测试覆盖完整 uint256 引用范围，没有用缩小 refs 换空间；零引用孤立快照的故障注入仍拒绝物化。不同 generation 的旧快照不合并、不覆盖。

Transient 测试覆盖同交易连续 V4 credit、失败子调用后使用相同 feeId 重试、finalize 中重入被拒绝、同交易 Curve 连续 sweep 的 epoch 归属、pending 时禁止领取/治理，以及同交易连续创建两个独立市场且构造上下文不能事后读取。Native/ERC20、来源版本漂移、到账不足/过量、后续记账失败等既有场景保留。

部分旧测试曾直接在测试根函数依次调用 begin/finalize。当前 Foundry `isolate=true` 将这些根级外部调用视为不同交易；改为一个外层原子辅助调用，以匹配生产 Curve/Hook。没有关闭隔离模式来掩盖问题，也没有允许生产跨交易完成 pending credit。修正前的失败日志保留为 `contracts-initial.log`。

验证结果：

- 全量非 Fork Solidity：**95 suites、1,036 passed、0 failed/ skipped**，见 `contracts-final.log`。之后补充的同交易连续创建、完整引用数两个边界测试另通过；没有把继承重跑用例都当作新增独立覆盖。
- Gauge 定向回归：81 项通过；新 Holder 测试确认两条发布只调用一次 ArbSys number，且第二条无效时整批回滚。它们亦被上述全量覆盖。
- RH 主网固定区块 Fork：**3 项通过**，链 4663，区块 55,747,994，hash `0xd7bc428f76e456752aed5c129204b1aed67239a2cb824f1be544d41dcd60df78`。覆盖四档 LP 费率的真实创建、毕业、swap、Locker 收费，以及 Stock 本金退出、快照领取、Creator 交接。包含本次新 transient 指令路径；使用现有只读 RPC 代理，没有广播。
- Spec 63 项、当前 surface 3 项、CI 工具 24 项、优化工具 12 项通过。
- Web 390 项测试与构建通过；Backend 63 项 unit、10 项 contract 测试与构建通过；Deployment 68 项测试与构建通过。
- 接口、fixture、产品编译产物、前后端生成文件、源码边界、runtime gate 通过。

更新了 Factory 对 Curve 部署实现/Gauge 的固定 codehash 和产品 artifact manifest。产品 manifest hash 为 `0x17a32c34972b1ec5c122ce92b60b62c22e2ac35029c8c911351ac8a4bc24aa64`。公开业务入口、事件、费率和奖励分配未更改；现有链上实例不会自动获得优化，需要后续新部署。

## 本轮明确未采用的候选

- 不删除 consumed feeId 表；它还有公开历史查询语义与防重放边界。
- 不把 Curve/Locker 换成 clone。此项需要独立的部署架构和生命周期成本验证，本轮只降低现有创建流程上下文成本。
- 不新增精简 MarketView ABI，不删除 Hook/begin/finalize 的市场复核；本轮只复用了既有 canonicalPoolId 接口。
- 不修改 Holder leaf 为带 index 的位图协议；保持现有 proof 和双资产独立领取兼容。
- 不引入新 Keeper 周期。`compoundLockedFees` 已内含 collect，未来运行时应直接复投并按需跳过无收益调用，但本轮未更改后台周期授权。

这些是审查报告中列为独立版本研究的候选，不计入本轮已完成或节省数字。资金安全检查、永久 LP 锁定、捐赠隔离、销毁时机及原子毕业均维持已批准设计。

## 证据与复现

[证据目录](evidence/contract-cost-implementation-2026-09-13/) 保存命令日志、源码指纹、优化前源码压缩包、Anvil 前后回执/调用参数、压缩 fixture 状态、导出 harness 和本地测量脚本。`changed-production-files.json` 只列本轮相对优化前的 13 个生产源码文件，避免混入此前 LP 费率改动。

Anvil 复现：使用专属空白节点 `anvil --port 18665 --hardfork cancun --timestamp 1800000000`，将对应 `anvil-before-state.jsonl.gz`/`anvil-after-state.jsonl.gz` 解压后，以 `node anvil-receipt.mjs <绝对目录>/anvil-before` 和 `.../anvil-after` 顺序执行。脚本固定 localhost，检查 chainId=31337，每轮会重置该专属节点，不能指向已有工作节点。该过程不访问 RH，也不花费真实资产。
