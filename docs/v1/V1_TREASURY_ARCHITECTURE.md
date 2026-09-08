# TickerGarden V1 Treasury 架构

> 状态：`RUNTIME_COMPLETE / DEPLOYMENT_ELIGIBLE / ACTIVATION_PENDING / NOT_BROADCAST / NOT_PRODUCTION_READY`
> 执行域：`V1-TREASURY-EXEC-1`
> Treasury 属于 V1 发布范围；本文冻结 Treasury 的接口和安全边界。当前可进入受控测试网部署，但具体 Safe、服务费、finality、eligibility 与资金来源必须作为签字后的 release 配置，且不表示生产激活。

## 1. 最终形态

V1 的部署形态是一个共享 `TreasuryDistributorV1`；每个毕业市场在共享合约中登记独立账本，不为每个 Meme 市场创建 Treasury 合约。该 runtime 已进入确定性部署图；实际 release 参数和生产激活仍受本文列出的签字输入约束。

- Quote Treasury：按 `marketId + 7 天 epoch` 隔离金额和负债；共享托管地址不代表共享账本。
- Meme 销毁：Meme 先精确转入 Distributor，再调用该 Meme Token 的 Treasury 专用 burn；必须同时验证 Distributor 余额恢复及 `totalSupply` 精确减少。
- TWAB：平台从 Meme Token 的标准 `Transfer` 日志重放 `[windowStart, windowEnd)` 的 raw-token balance-seconds，不在每次交易中写链上 checkpoint。
- Merkle：每个叶子固定包含账户、TWAB numerator、Quote 分配金额和完整 replay domain。
- Root 服务：平台可以在周期关闭及 finality delay 后触发 Root；无人触发时，既有 permissionless 流程在额外等待窗口后开放请求；平台发布 Root；独立审阅角色可在延迟期取消；延迟结束后任何人可最终确认。
- Claim：任何人可以代提交 proof，但 Quote 永远支付到叶子中固定的持有人地址，不支持任意 recipient。

## 2. V1 发布边界

Treasury 是 V1 发布的一部分，接口、登记、资金隔离、7 天（`604800` 秒）TWAB Merkle Root、持有人领取及 permissionless finalize/expire/rollover 范围已经实现并接入 Rewards 页面。当前源码中的周期长度仅在新的 release 部署后生效；Arbitrum Sepolia R2 的历史链上快照仍采用 30 天 epoch/TWAB，源码改动不会回写或改变该已部署事实。Treasury runtime 已纳入确定性部署图，当前状态为 `DEPLOYMENT_ELIGIBLE`；本轮已重新验证七个部署门槛，证据见 `deployments/evidence/v1-optional-staking-gates.json`。旧部署证据仍保留为 STALE。启用不可变 holder fee sharing 后，creator base fee share 的固定 50%（不含 creator tax）进入持有人账本，creator 保留另外 50% 及 100% creator tax；platform/staker split 不变。Holder period 从市场创建开始，Quote 在 FeeVault credit 时（包括 curve sweep）归属当前 period。当前没有广播或 holder 写操作上线批准，这不表示 Treasury 属于未来 V2 或仅为 preview。

V1 手续费模块只需对接两个接口：

```solidity
fundQuoteTreasury(marketId, amount, fundingId)
burnMeme(marketId, amount, burnId)
```

两个接口都采用 caller-scoped idempotency key，但不编码任何费率或分配比例。它们是完整的显式资金入口，而不是自动注资承诺；未来若增加自动触发、来源和调度，必须另行冻结并验证，不能把该可选激活策略描述为当前 runtime 缺失。

## 3. 市场与周期

```text
V1 Factory 创建 canonical 市场
          |
          v
治理延迟调用 Treasury.registerMarket
          |
          v
REGISTERED -- 任意人于 PoolCreated 后调用 activateMarket --> ACTIVE (不可逆)
                                                              |
                                                              v
                                         epoch N = [start, start + 7 days)
```

Factory 仅在创建参数启用 holder fee sharing 时调用 `registerFeeSharingMarket(marketId, protocolFeeVault, predictedLaunchLocker)`，并由 Treasury 校验 canonical MarketConfig 与 Hook 绑定；禁用时保持原有流程，不发生登记调用。资金注入和 Meme 销毁仍由显式、receipt-bound 流程执行。Rewards 只在链上已经完成 canonical 登记与激活后开放读取，并在独立发布批准门关闭前保持所有 Treasury 写操作禁用。

`activateMarket` 是毕业对接点。毕业前不能注入 Quote Treasury、销毁 Treasury Meme 或发起 Root。

Holder period 从市场创建时间开始，每个周期持续 7 天（`604800` 秒）。Quote 在 FeeVault credit 时直接归属当时的 period；curve sweep 的入账时间决定归属周期。周期结束后的新入账进入下一个 period，避免 Root 生成较慢时把新资金分给旧持有人。Meme 转 Quote 保留原 creator epoch。`claimWindow` 仍为 30 天（`2592000` 秒），从 Root finalize 起计算，与 epoch 周期独立。

### 3.1 AccessManager 权限闭环

Treasury 只把真正的特权入口交给不可变 `AccessManager`，用户资金入口和状态到期后的推进保持 permissionless：

- `registerMarket`、`setRootServiceFee`：`PROTOCOL_ADMIN_ROLE`，固定 48 小时执行延迟；
- `publishRoot`：独立 `ROOT_PUBLISHER_ROLE`，即时执行；
- `cancelPendingRoot`：独立 `ROOT_REVIEW_ROLE`，即时执行；
- `activateMarket` 不配置 AccessManager role。任何 keeper 都可在 canonical `PoolCreated` 事实成立后触发一次，不能提前激活或重复激活；
- fund、burn、request、finalize、expire、claim、rollover 和领取本人 service credit 均不属于管理员权限。

Root Publisher 与 Reviewer 必须使用互不相同、且不与 Governance/Guardian/Security 角色复用的 Safe。部署顺序固定为 selector 绑定、角色授予、role admin/guardian 冻结、最后撤销 bootstrap `ADMIN_ROLE`。本地 preflight 还必须读取并证明 `TreasuryDistributorV1.authority() == AccessManager` 以及 `marketRegistry() == canonical MarketRegistryV1`；只验证 AccessManager 内存在 selector 映射并不足以证明 Treasury 实际绑定正确。

当前仓库已完成上述实现级配置、延迟执行/取消/角色隔离测试和只读 preflight 规则。真实 Safe 地址、链上配置交易、最终区块回执与 deployed E2E 仍是部署证据，不得用本地 fixture 代替。

## 4. Root 与服务费状态机（Rewards 页面）

```text
UNREQUESTED
   | holder + exact service fee + closed/finalized epoch
   v
REQUESTED ---------------- timeout ----------------> UNREQUESTED + requester refund credit
   | authorized platform publisher
   v
ROOT_PENDING ------------ review cancel ----------> UNREQUESTED + requester refund credit
   | review delay elapsed; permissionless finalize
   v
CLAIMING ---------------- claim deadline ----------> ROLLED_OVER
                                                         |
                                                         +--> remainder enters current epoch
```

服务费始终与 Quote holder liability 分账：

- 请求时进入 escrow；
- Root 最终确认后才记入平台服务 Treasury 的可提额度；
- 平台未按时生成或 Root 被取消时，费用归还请求人；
- 所有退款和服务费使用 pull withdrawal，外部收款失败不会锁死状态机。

Rewards 页面承载 holder-facing 的 request、claim、permissionless finalize、expire、rollover、请求人服务费退款 credit 查询/提取及状态展示。`publish` 只属于授权平台 publisher，`cancel` 只属于独立 review/cancellation role；两者不是普通用户操作，也不应在 Rewards 页面作为普通用户权限暴露。

## 5. TWAB 与 Merkle 冻结规则

TWAB schema 为 `TRANSFER_LOG_TWAB_7D_V1`：

```text
accountTwab = sum(balanceAtIntervalStart * intervalSeconds)
```

这里保存的是未除以 7 天的精确 numerator。所有账户使用同一窗口，因此比例不变，同时避免提前整数除法造成精度损失。

Root 输出 schema 为 `TICKERGARDEN_V1_TREASURY_ROOT_V1`，dataset hash 的 schema 为 `TICKERGARDEN_V1_TREASURY_DATASET_V1`；claim domain 为 `TICKERGARDEN_V1_TREASURY_CLAIM_V1`，eligibility policy domain 为 `TICKERGARDEN_V1_TREASURY_ELIGIBILITY_POLICY_V1`。

平台生成器必须：

1. 使用从 Token 部署到已提交 `sourceBlockNumber/sourceBlockHash` 的完整 canonical Transfer 历史，并验证该区块头 timestamp 不早于 `windowEnd`；
2. 按 block、transaction、log index 排序；
3. 将 mint、普通转账和 burn 全部纳入重放；
4. 验证资格排除列表的 hash 与市场登记值一致；
5. 使用 largest-remainder 方法处理 wei 级舍入，使所有叶子金额之和精确等于该 epoch Quote 金额，并剔除无法领取的零金额叶子；
6. 输出公开 dataset hash、source block timestamp、root、每个 leaf 和 proof。

叶子采用双重哈希并绑定：

- leaf domain、TWAB schema；
- `chainId`、Distributor 地址；
- `marketId`、`epochId`；
- Meme Token、Quote Token；
- eligibility policy hash；
- 7 天窗口（`604800` 秒）；
- finalized source block number/hash；
- leaf index、account、TWAB、amount。

bitmap 和 account mapping 同时阻止重复 index 与重复账户领取。

## 6. 信任与安全边界

当前 Root 模型是 `ATTESTED + PUBLICLY REPRODUCIBLE + REVIEW DELAY`，不是 zk validity proof，也不是具备链上 fraud proof 的 trustless optimistic root。

这是为了避免在每次 Meme 转账/Swap 中增加 TWAB checkpoint SSTORE。代价是 Root 正确性依赖平台 publisher、独立 review role 和公开数据复算。后续可以在 V1 发布前增加 zk verifier 或可证明的 source root；不得在没有 validity/fraud proof 时宣传为“无需信任”。

合约已采用以下资金防线：

- Quote 注入、ERC-20 服务费和所有 ERC-20 支付均检查发送方与接收方的精确余额差；
- fee-on-transfer token 会回滚，rebase/proxy 行为仍需部署准入和 codehash 检查；
- Quote liability 与 service liability 独立统计，即使两者使用同一资产也必须由真实余额共同覆盖；
- Claim 先消耗 bitmap/account 标记和负债，再进行 `nonReentrant` 支付，失败会整笔回滚；
- 没有通用 `execute`、delegatecall、任意 recipient、市场 pause/retire 或管理员提取 holder liability 的入口；
- Root 最终确认后不可更换。

## 7. Treasury 激活与生产前仍需冻结的输入

以下内容故意没有写死在本轮代码中：

1. Treasury 的具体资金来源与 release 配置；holder fee sharing 的 50% creator base-fee share 规则已冻结，creator tax 不进入持有人账本；
2. 哪个调用方及哪种 receipt/idempotency 规则负责 `fundQuoteTreasury`、`burnMeme` 的触发、来源和调度；不得将其描述为已部署的自动 keeper；
3. eligibility policy 的排除地址，尤其是 PoolManager、Curve、Locker、Distributor、桥和不可领取系统地址；
4. Root 服务费资产与价格；
5. RH 链 finalized 秒数/区块数、publisher/reviewer Safe、claim window；
6. 是否在发布前升级为 zk 或可验证 fraud-proof Root。
7. 零 eligible TWAB 周期采用下述审查后结转规则；worker 的完整历史校验与 reviewer 运行检查仍须在生产激活前验收。
8. 平台 Root worker 的 RH RPC、索引数据源、签名/广播和持久化幂等运行环境。

这些值不影响 runtime 完成度，但会限制 Treasury activation 或 production release。未签字前可以部署并验证空账本 runtime，不得注册生产市场、开放 holder 写操作或宣传自动注资。

## 8. 代码与验证入口

- 合约：`contracts/src/v1/modules/TreasuryDistributorV1.sol`
- Token：`contracts/src/v1/modules/TickerMemeTokenV1.sol`
- 对接接口：`contracts/src/v1/interfaces/IV1Protocol.sol`（`ITreasuryDistributorV1`）
- Root 生成器：`services/backend-go/cmd/treasury-worker/`
- 独立构建：`npm run build:v1-root-generator`
- 独立测试：`npm run test:v1-root-generator`

门禁必须覆盖普通业务、Token/leaf 边界、生产式 AccessManager handoff 以及 invariant suite；测试数量以当前 CI 输出为准。当前结果支持受控测试网部署验证，但不替代第三方审计、部署后 receipt/source 验证或生产 RH 链路验收。


## 2026-09-05 业务修复：零资格周期与无人触发

- 周期关闭并达到 finality delay 后，当前持有人可请求 Root；再等待一个 `rootPublicationWindow` 后，任何地址都可支付同样服务费请求，其他校验不变。
- 零资格结果必须使用 `keccak256("TICKERGARDEN_V1_TREASURY_EMPTY_EPOCH_V1")`，`totalTwab = leafCount = totalAllocated = 0`，且 `datasetHash` 非零。普通 Root 仍必须完整分配该周期 Quote。
- 零资格结果经过同样的 publisher 权限、review delay 和 reviewer 撤销/退费流程。`finalizeRoot` 将全部 Quote 结转到同一市场当前周期，终态为 `ROLLED_OVER`，不进入 CLAIMING、不改变总 Quote 负债、不进行外部资金转出。
- 最终确认依次发出 `RootFinalized(..., claimUntil=0)` 与 `EpochRemainderRolledOver`。客户端必须识别该分支，不能将零领取期误判为普通领奖成功。
- Root Generator 默认拒绝零资格输入。显式 `emptyEpochPolicy: "reviewed-rollover"` 才输出零资格承诺，数据 hash 包含上下文、资金金额及零权重结果。worker 必须核实完整 canonical transfer 历史、初始供应与排除地址；RPC 暂不可用或历史缺失不是零资格证明。
- 该机制延续现有 attested Root 信任边界，不是链上 TWAB 证明。发布者/审查者需要独立复算。新代码的部署字节码及运行证据必须重新验证，旧部署 rehearsal 证据不能自动覆盖此修改。
