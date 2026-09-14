# LP 运行闭环与空 Staking 优化

2026-09-13。基于当前未提交工作区，只修改本轮相关代码与产物，不包含提交、线上部署、Keeper 配置或周期任务启用。状态：**本地实现与验证完成，NOT_BROADCAST**。

## LP 后台运行闭环

新增 `tools/locker-compounding/`，以及根 package 的 `locker:preview`、`locker:execute`、`locker:status`、`test:locker-worker`。

完整单次流程：读取已验证的部署 manifest → 固定区块验证五个运行码哈希、Registry/Executor 依赖、Keeper、canonical Locker、NFT 所有权及 PoolKey → 模拟收手续费 → 整数计算真实价格/范围下的新增流动性与逐资产投入上限 → 模拟完整 compound → 限制 Gas 总预算 → 签名前刷新 nonce/期限并再次模拟 → 先持久化签名再发送 → 确认回执与精确业务事件 → 更新可查询状态。

新工具不把 Token 原始余额当成可投入费用，不增加换币或转移本金权限。历史隔离余额缺口可能消耗模拟收集的费用；最终 compound 模拟必须成功，不能通过扩大预算绕过缺口检查。单边不足或收益小于配置阈值跳过；阈值为 liquidity 单位，没有虚构 USD 收益。

同链同 Keeper 全市场串行，使用持久目录中的独占锁。签名原文在发送前 fsync；网络结果不明时保留原意图，重启只重发同一原文。nonce 已消费却无回执、过期状态不明、事件异常时停止对账，不生成替代交易。状态查询不显示签名原文，失败原因脱敏后保存。

交付是**本机持久进程可调用的手动后台入口及 CLI 状态查询**；没有声称已上线公共 API、网页运维面板或分布式周期 worker。后续 Serverless/多机运行需要数据库事务锁和集中 nonce 管理。具体配置、操作和恢复见 `tools/locker-compounding/README.md`。未配置或使用真实 Keeper 私钥。

## 空 Staking Gas 门槛

`ProtocolFeeVaultV4Accounting._tryStakerSettlement` 先以最多 100,000 Gas 做 `effectiveTotalActiveStock()` staticcall，输出复制限 32 bytes。只有调用成功、返回长度恰为 32 且值为零时提前返回无活跃 Staker。

非零、回滚、Gas 用尽、过长/过短返回值均进入原有 4,000,000 Gas 自调用及父调用余量检查。未降低原结算预算，没有删除防止调用者故意低配 Gas 将 Staker 收益改记平台的保护；自调用仍同时隔离权重读取和 Gauge 写入。

回归证明原来失败的“stakingEnabled=true、活跃权重为零、提供 1,000,000 Gas”的交易现在成功。活跃 Stake 低 Gas 拒绝、恶意返回数据/耗尽 Gas/后期写入回滚、30 桶激活、缺口补足等边界继续通过。

权衡：活跃 Stake 会多一次只读探测；匹配既有 mock 权重基准的 `_sell` 区间从 588,290 增至 591,711（+3,421，约 0.58%）。无 Staking 的单次 swap `lastCallGas` 仍为 473,177。它们是本地测试口径，不是 RH 数据费报价；不声称本优化让所有交易的实际 Gas 都下降。

## 合约体积如何继续优化

| 编译配置 | Factory bytes | FeeVault bytes |
| --- | ---: | ---: |
| 现行 runs=200 | 23,583 | 23,148 |
| 独立试验 runs=50 | 23,096 | 22,933 |
| 试验减少 | 487 | 215 |

本轮空 Staking 探测让 FeeVault 比修改前增加 108 bytes。现行项目预算仍通过：Factory 距 24,000 剩 417 bytes，FeeVault 距 23,500 剩 352 bytes；均低于 EIP-170 的 24,576 bytes 硬上限。

推荐分三步：

1. **短期可验证方案：评估 runs=50。** 已实际编译测量，但没有修改正式 foundry 配置。必须补充相同交易场景的 Gas 对比，重新生成所有相关 runtime/CREATE2/实现固定 codehash 和部署材料，再过全套验证才能采用。这一候选不能把体积收益当成免费收益。
2. **继续精简重复编码与固定返回值处理。** Factory 某些部署编码、delegatecall 返回处理有候选；Solidity 优化器可能已经合并部分编码，需要逐项编译与差分验证。保留失败返回及 malformed data 的现有语义，不直接重写高风险 assembly 以凑体积数字。
3. **功能持续增加时做模块边界调整。** Factory 已把组件创建代码移到外部实现锚点，不能重复计算这项收益。进一步拆分 FeeVault、部署模块或将每市场合约 clone 化，是独立架构变更，涉及调用开销、存储/权限边界和代码身份；应比较全生命周期成本。不要移除偿付、来源、重放或治理检查，也不通过放宽体积预算掩盖增长。

因此本轮没有未经测量便切换编译参数，也没有新增不必要的部署架构。runs=50 产物仅在 `.codex_tmp/size-runs50`，不能用作直接部署材料。

## 验证与证据

证据目录：`docs/reviews/evidence/lp-runtime-gas-2026-09-13/`。

- 合约全量：**96 suites，1,046 passed，0 failed/skipped**。
- RH 固定区块 Fork：**3 passed**，链 4663，区块 55,747,994，hash `0xd7bc428f76e456752aed5c129204b1aed67239a2cb824f1be544d41dcd60df78`。只读代理访问，无链上广播。
- 定向审计回归：205 passed；Gas 基准补测 2 passed。
- 新 worker 数学、确认事件、超时重启、nonce/过期停止、文件锁、签名脱敏和失败持久化：**8 passed**。
- 本地 Anvil：真实 Locker、PoolManager、PositionManager，使用 fixture Registry/Executor/Permit2/资产，通过 v4 donate 生成费用增长。执行器签名并成功发送本地交易 `0x3b550ec88fd85ff172cb6baed9011cf51819247534f7b6dbe339a58ecc0c0b34`，LP liquidity 精确增加 `994999999999999999`，回执和 journal 均 confirmed。它不是线上 Keeper 验收；四档 swap LP 费率与 native 组合由合约/Fork 覆盖。专用 Anvil 已停止。
- Spec / current surface：66 passed；Deployment：68 passed。
- Web：390 passed，生产构建通过；保持既有 bundle 大小提示，未将其误报为测试失败。
- 生成 ABI、前后端接口绑定、编译及产品 artifact manifest、源码边界与 runtime size 检查通过。更新两个编译产物 manifest，未更改线上 release 身份。

最终产品 artifact manifest hash 为 `0xd3258b357a82ca86289eaa8342a84d46600a4f4c86e706cd7cbdfbd62b27cae0`。70 个生产源文件指纹已保存；相对上一轮成本优化后的版本，只有 `ProtocolFeeVaultV4Accounting.sol` 发生生产源码变化。

本地导出工具使用独立临时 Foundry 配置/产物目录；早期尝试受 Foundry 路径权限、脚本地址限制和自定义配置根目录影响，已改为明确本地 fixture exporter 与绝对路径，并恢复标准生产编译产物后重新校验。没有放宽仓库正式配置或使用外部链写入绕过验证。
