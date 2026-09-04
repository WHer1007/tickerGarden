# TickerGarden V1 Treasury 架构

> 状态：`V1 RELEASE / CORE CODE COMPLETE / LOCAL VERIFIED / FEE POLICY AND AUTO-FUNDING PENDING / NOT DEPLOYABLE`
> 执行域：`V1-TREASURY-EXEC-1`
> Treasury 属于 V1 发布范围；本文冻结 Treasury 的接口和安全边界，但手续费比例与自动注资规则仍未冻结，因此不表示可以部署。

## 1. 最终形态

V1 的目标部署形态是一个共享 `TreasuryDistributorV1`；每个毕业市场在共享合约中登记独立账本，不为每个 Meme 市场创建 Treasury 合约。该目标形态仍受本文列出的未冻结输入约束，并不表示当前可部署。

- Quote Treasury：按 `marketId + 30 天 epoch` 隔离金额和负债；共享托管地址不代表共享账本。
- Meme 销毁：Meme 先精确转入 Distributor，再调用该 Meme Token 的 Treasury 专用 burn；必须同时验证 Distributor 余额恢复及 `totalSupply` 精确减少。
- TWAB：平台从 Meme Token 的标准 `Transfer` 日志重放 `[windowStart, windowEnd)` 的 raw-token balance-seconds，不在每次交易中写链上 checkpoint。
- Merkle：每个叶子固定包含账户、TWAB numerator、Quote 分配金额和完整 replay domain。
- Root 服务：当前持有人支付配置的原生币或 ERC-20 服务费来发起请求；平台发布 Root；独立审阅角色可在延迟期取消；延迟结束后任何人可最终确认。
- Claim：任何人可以代提交 proof，但 Quote 永远支付到叶子中固定的持有人地址，不支持任意 recipient。

## 2. V1 发布边界

Treasury 是 V1 发布的一部分，接口、登记、资金隔离、30 天 TWAB Merkle Root、持有人领取及 permissionless finalize/expire/rollover 范围已经实现并接入 Rewards 页面。当前统一手续费比例与自动注资触发/来源/调度仍由后续产品决策冻结，因此 Treasury 仍为 `NOT_DEPLOYABLE`；这不再表示 Treasury 属于未来 V2 或仅为 preview。

V1 手续费模块只需对接两个接口：

```solidity
fundQuoteTreasury(marketId, amount, fundingId)
burnMeme(marketId, amount, burnId)
```

两个接口都采用 caller-scoped idempotency key，但不编码任何费率或分配比例。手续费比例以及自动注资触发、来源和调度规则仍未冻结；在这些输入批准前，不得把接口当作已部署的自动注资承诺。

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
                                         epoch N = [start, start + 30 days)
```

当前 Factory 与 GraduationExecutor 都不会自动调用上述两个 Treasury 入口；登记、激活、手续费注资和 Meme 销毁的生产编排仍是 V1 上线阻塞项。Rewards 只在链上已经完成 canonical 登记与激活后开放读取，并在发布批准门关闭时保持所有 Treasury 写操作禁用。

`activateMarket` 是毕业对接点。毕业前不能注入 Quote Treasury、销毁 Treasury Meme 或发起 Root。

Quote 入账时直接归属当前 epoch。周期结束后的新入账自动进入下一个 epoch，避免“Root 生成较慢时把新资金分给旧持有人”的时间错配。

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

TWAB schema 为 `TRANSFER_LOG_TWAB_30D_V1`：

```text
accountTwab = sum(balanceAtIntervalStart * intervalSeconds)
```

这里保存的是未除以 30 天的精确 numerator。所有账户使用同一窗口，因此比例不变，同时避免提前整数除法造成精度损失。

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
- 30 天窗口；
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

## 7. V1 发布前仍需冻结的产品输入

以下内容故意没有写死在本轮代码中：

1. 买卖两侧及各资产侧最终手续费比例；
2. 哪个 V1 FeeVault/Hook 是 `fundQuoteTreasury`、`burnMeme` 的 canonical caller，以及自动注资的触发、来源和调度；
3. eligibility policy 的排除地址，尤其是 PoolManager、Curve、Locker、Distributor、桥和不可领取系统地址；
4. Root 服务费资产与价格；
5. RH 链 finalized 秒数/区块数、publisher/reviewer Safe、claim window；
6. 是否在发布前升级为 zk 或可验证 fraud-proof Root。
7. 某周期 eligible TWAB 为零，或没有可签名持有人时，是滚入下一周期还是在超时后开放 permissionless trigger。
8. 平台 Root worker 的 RH RPC、索引数据源、签名/广播和持久化幂等运行环境。

这些值完成产品、安全、法律和目标链验证之前，本模块维持 `NOT DEPLOYABLE`；V1 发布归属不等于部署批准。

## 8. 代码与验证入口

- 合约：`contracts/src/v1/modules/TreasuryDistributorV1.sol`
- Token：`contracts/src/v1/modules/TickerMemeTokenV1.sol`
- 对接接口：`contracts/src/v1/interfaces/IV1Protocol.sol`（`ITreasuryDistributorV1`）
- Root 生成器：`services/treasury-root-generator/`
- 独立构建：`npm --prefix services/treasury-root-generator run build`
- 独立测试：`npm --prefix services/treasury-root-generator test`

本地门禁必须覆盖普通业务、Token/leaf 边界、生产式 AccessManager handoff 以及 invariant suite；测试数量以当前 CI 输出为准。该结果只表示本地实现门禁通过，不替代第三方审计或 RH 测试链验证。
