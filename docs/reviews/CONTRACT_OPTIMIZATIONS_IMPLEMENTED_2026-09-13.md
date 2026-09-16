# 合约优化实施记录

日期：2026-09-13。范围为 CO-01～11，按用户后续决定执行。未部署、未广播；生产 Fork 和实际资产验收没有因此自动通过。

## 已确认的范围

- **CO-06、CO-08 是已确认的设计：**奖励支付给受益人自己、最后买入与毕业原子执行。保持原行为，不再作为待修问题。
- **CO-05 暂时保留现有退出规则：**不引入按比例本金折价、损失分摊或全面冻结提现。
- **CO-01：**用户允许故障时放弃该笔失败奖励，优先继续交易。失败份额沿用现有 Staker 罚没规则归入 Platform；不补发到之后的质押群体，不永久禁用市场奖励。
- 后台自动化继续 TODO，本轮仅增加手动调用的独立检查工具。

## CO-01：Gauge 故障隔离

`ProtocolFeeVaultV4Accounting` 将总有效 Stake 读取与 `creditStakerFee` 放到固定、自身才能调用的 `settleV4StakerFee` 子调用中。父交易已验证来源、到账、费用与 nonce；子调用中的 Gauge 写账、cohort 更新和下游状态变更要么全部成功，要么一起回滚。

- 子调用 Gas 上限 4,000,000；父调用还需预留 300,000 Gas 和 EIP-150 余量。这是 Gas 上限检查，不代表每笔会消耗全部预算。
- 余量不足直接回滚，不能故意少给 Gas 来跳过健康奖励。交易客户端应模拟并估算完整交易；Gas limit 可能比过去高，但未使用的额度不收费。
- 返回／错误只复制 32 bytes；错误事件保留前 4 bytes。权重读取失败、OOG、超大 revert data、写账后失败都受同一个回滚边界保护。
- 失败时只有本次新 Staker 份额进入现有 `forfeitureReserve`，由 Platform 既有领取流程转换；已赚奖励不扣减。权重读取失败时按存在 Staker 的固定 30% 份额罚没，避免错误地扩大 Creator／Holder 分配。
- `StakerFeeAbandoned(marketId,feeId,feeAsset,amount,errorSelector)` 标识放弃。`FeeBucketsCredited` 记录原始入账，`ForfeitureReserved` 记录该份额转入罚没保留额；索引必须结合事件重建最终分账，不能把原始 Staker 入账当成仍可领取的余额。
- feeId／nonce 正常消费，不能重放失败的旧费用；之后的每笔交易仍会尝试正常记账。

容量测试使用真实 Gauge clone、双资产非零累计值和 30 个成熟激活桶，并清理相关账户／存储热访问状态；整笔 swap 的执行段约 3,251,494 Gas，未触发奖励放弃。Allocation 权重来源为测试替身，因此这是保守容量回归的一部分，仍需生产资产及真实 Vault Fork 验证。初始 1,000,000 子调用预算已在容量复核后提高为 4,000,000。

这个优化只隔离奖励子调用。无效交易、滑点、费用到账错误、外部 Token 转账故障及 FeeVault 资不抵债仍会使交易回滚，不能宣称任意外部故障下都能交易。

## CO-02、CO-10：发布者撤销及余额读取

新增 `HolderRewardsDistributorV1.revokeSnapshotPublisher(expectedPublisher)`：

1. 仅 AccessManager 的有效 `PAUSE_GUARDIAN_ROLE`（角色 2）成员直接调用。当前生产分工对应 Treasury Safe。
2. 要求参数与当前非零发布者一致，旧撤销交易不能意外撤销新发布者。
3. 即使 AccessManager target 已关闭，Guardian 仍能撤销。不要把关闭 target 当成撤销的替代品。
4. 撤销后不能发布新 Root，但旧 Root 的领取继续开放。没有管理员改 Root、提走 Holder 资金的入口。
5. 后续由治理 Safe 经原有 48 小时执行延迟调用 `setSnapshotPublisher` 更换／恢复。若此前关闭 target，需按治理权限先恢复可调用状态。

撤销是直接角色成员检查，不需要给这个选择器配置延迟执行角色；部署计划已记录此边界，原有角色授权仍必须完成。

Distributor ERC20 付款复用实际付款后的余额完成局部偿付检查，同一付款对 Distributor 余额读取从五次降为四次；外层双资产回调后的最终偿付检查保留。原生 ETH 支付也保留外层最终检查。

## CO-04：明确偿付状态与补足入口

新增 FeeVault：

- `assetCoverage(asset)` 返回实际余额、总负债、缺口，均为原始单位。
- `coverAssetDeficit(asset,amount)` 允许任何人自愿补足既有缺口，**不产生新权益、可退款债权或手续费负债**。可部分补足；拒绝零金额、超过缺口、错误 `msg.value`、非精确 ERC20 收支及重入。

ETH 使用零地址，`msg.value == amount`；ERC20 先授权对应金额，`msg.value == 0`。执行前读取并模拟；缺口已经被其他人补足时交易会回滚，不能把超过缺口的资金留在 Vault。贡献者支付 Gas 且没有向平台追偿的链上权利。

补足后再次检查覆盖率，再重试受影响的领取／交易。用户原有权益及 Creator、Staker、Holder、Platform 的归属不变。该入口不删除负债，不按先到先得绕过偿付检查，也不解决外部发行方继续冻结或扣减余额的问题。

## CO-03：离线快照独立复算

工具：`tools/contract-review/wallet-snapshot-preflight.mjs`。

```sh
node tools/contract-review/wallet-snapshot-preflight.mjs independent-reference.json proposed-publication.json
```

独立 reference 必需字段：

| 字段 | 格式／来源 |
| --- | --- |
| chainId、round、lastRound、snapshotBlock、lastSnapshotBlock、registeredBlock、finalizedBlock | 十进制整数字符串；来自独立索引和已确认链状态 |
| distributor、marketId、snapshotBlockHash | 合约地址、bytes32 市场 ID、bytes32 区块哈希 |
| token、curve、poolManager、locker、vault、hook | 该市场的真实协议绑定地址，必须全部出现在 excluded 中 |
| excluded | 本轮完整排除地址清单；工具还强制排除零地址、dead、Distributor |
| balances | 全量余额行 `{account,balance}`；地址不得重复，balance 为原始单位字符串 |
| totalSupply | 该快照区块的原始总供应量；所有余额之和必须相等 |
| quoteTarget、memeTarget | 希望分配的原始数量字符串 |
| unallocatedQuote、unallocatedMeme | 独立核验的 Distributor 当前可分配余额字符串 |

先按排除规则得到钱包余额权重，逐人向下取整，Root 预算使用叶子金额实际总和；舍入尾差留在未分配资金中。工具复算 domain-separated 双哈希 leaves、sorted-pair proofs、Root、数据摘要、轮次／区块边界及资金预算，再与 proposed 文件对应字段逐一比较。输出 proofs 供后续领取联调使用。

`proposed-publication.json` 应含 chainId、distributor、marketId、round、snapshotBlock、snapshotBlockHash、root、dataHash、quoteBudget、memeBudget，格式与规范化结果一致。JS 构建函数 `buildWalletSnapshot(reference)` 可用于离线准备，CLI 校验必须另给独立 reference，不能拿同一份待发布结果自证正确。

**安全边界：**工具不下载历史余额，不自行证明 finality，也不能判断所有地址是否属于 LP／非钱包。它验证的是独立 reference 与待发 payload 的一致性；reference 的完整性、钱包范围和链状态真实性必须由未来后台及独立复核提供。链上 publisher 仍受信任，恶意发布者可以绕过这个离线工具。因此这是发布前防错措施，不是无信任分配证明；不增加链上固定周期、发布延迟或第二个签名人。

## CO-07：代理实现与资产覆盖检查

工具：`tools/contract-review/asset-risk-preflight.mjs`。使用环境变量 `ASSET_AUDIT_RPC_URL`，命令为：

```sh
node tools/contract-review/asset-risk-preflight.mjs reviewed-asset-reference.json
```

reference 格式：`{chainId,assets:[...],vaultAssets:[{vault,asset}]}`。`chainId` 是字符串。每个 assets 项必须有 `asset,kind,codeHash,decimals,implementation,admin,beacon`；`kind` 为 `direct`、`erc1967` 或 `beacon`，不适用的地址填零地址。代理还需 `implementationCodeHash`，beacon 类型需 `beaconCodeHash`。这些期望值必须来自受审查的资产准入档案，不能在发现变化后自动覆盖为新值。

工具在同一个 finalized block 读取代理外壳、ERC1967 implementation/admin/beacon 槽、实现／beacon 代码和 decimals，并与 reference 比较。vaultAssets 检查 FeeVault 或 Distributor 的同资产余额与 `totalLiability`。最后重读区块哈希；无法读取、链不符、实现变化、区块变化或存在缺口时不输出健康结论。

只读取，不交易、不签名、不启动定时任务。它不能识别所有自定义代理结构；`direct` 的不可升级性仍需准入源码复核。它也不会阻止外部资产升级，或用资产准入开关去冻结已存在的市场。上线应保存真实 reference，并将执行、告警和人工审查接入后台 TODO。

## CO-09、CO-11：配置读取与体积 gate

首买 Router 将首次读取的 Quote 配置传给内部 Native／ERC20 分支，消除同一次调用中外部变更前的重复读取；状态、资产、金额、退款校验和 Factory 的独立校验保留。

`build:contracts` 已接入 `tools/check-contract-runtime-size.mjs`：所有 product modules 检查 EIP-170 上限；Factory 预算 24,000 bytes，FeeVault 预算 23,500 bytes。超限直接使构建失败。预算余量与 EIP-170 余量分别理解，不能把 120 bytes 的 Factory 预算余量误报成协议硬上限余量。

## 验证与剩余生产工作

日志位于 `docs/reviews/evidence/contract-optimizations-2026-09-13/`；最终结果见该目录验证摘要。覆盖 Gauge 失败隔离／Gas 耗尽／返回数据／晚期回滚／恢复／nonce、防低 Gas 跳过、Guardian 撤销／旧 Root 领取／旧撤销拒绝、ERC20 与原生补足、余额读取次数及 JS／Solidity 叶子向量一致性。

最终非 Fork 回归 **933 passed、0 failed、0 skipped（87 suites）**；spec／接口 66 项、部署 66 项、优化工具 12 项通过。Web／部署构建、后端契约检查、接口及产物校验通过。当前 runtime：Factory 23,880 bytes、FeeVault 22,306、Distributor 12,223，均通过体积 gate。

生成的接口、权限矩阵、canonical ABI、编译／product manifests 和 Web ABI 已同步；canonical mutation 数量从 82 增为 84，新增两项均为直接权限约束，治理选择器仍为 19 项。

生产仍需真实 Fork、当前 release 部署计划重生成、发布钱包、真实资产 reference 与后台 TODO 的最终验收。本轮没有新生产部署、资金转移或后台自动化启用。
