# TickerGarden V2 Treasury 架构

> 状态：`CORE CODE COMPLETE / LOCAL VERIFIED / V2 INTEGRATION PENDING / NOT PART OF V1 / NOT DEPLOYABLE`
> 执行域：`V2-TREASURY-EXEC-1`
> 本文只冻结未来 V2 的 Treasury 接口和安全边界，不确定任何手续费比例。

## 1. 最终形态

V2 只部署一个共享 `TreasuryDistributorV2`。每个毕业市场在共享合约中登记独立账本，不为每个 Meme 市场创建 Treasury 合约。

- Quote Treasury：按 `marketId + 30 天 epoch` 隔离金额和负债；共享托管地址不代表共享账本。
- Meme 销毁：Meme 先精确转入 Distributor，再调用该 Meme Token 的 Treasury 专用 burn；必须同时验证 Distributor 余额恢复及 `totalSupply` 精确减少。
- TWAB：平台从 Meme Token 的标准 `Transfer` 日志重放 `[windowStart, windowEnd)` 的 raw-token balance-seconds，不在每次交易中写链上 checkpoint。
- Merkle：每个叶子固定包含账户、TWAB numerator、Quote 分配金额和完整 replay domain。
- Root 服务：当前持有人支付配置的原生币或 ERC-20 服务费来发起请求；平台发布 Root；独立审阅角色可在延迟期取消；延迟结束后任何人可最终确认。
- Claim：任何人可以代提交 proof，但 Quote 永远支付到叶子中固定的持有人地址，不支持任意 recipient。

## 2. 与 V1 的隔离

本 V2 子系统不导入、调用或要求修改 V1 的 Factory、Hook、FeeVault、MarketRegistry、ABI、事件和手续费规则；工作树中其他既有 V1 改造不属于这条 V2 Treasury 链路。

未来 V2 手续费模块只需对接两个接口：

```solidity
fundQuoteTreasury(marketId, amount, fundingId)
burnMeme(marketId, amount, burnId)
```

两个接口都采用 caller-scoped idempotency key，但不编码任何费率或分配比例。因此后续统一修改手续费方案时，不需要重写 Treasury 的托管、Root 或 Claim 状态机。

## 3. 市场与周期

```text
V2 Factory registerMarket
          |
          v
REGISTERED -- V2 GraduationExecutor activateMarket --> ACTIVE (不可逆)
                                                       |
                                                       v
                                  epoch N = [start, start + 30 days)
```

`activateMarket` 是毕业对接点。毕业前不能注入 Quote Treasury、销毁 Treasury Meme 或发起 Root。

Quote 入账时直接归属当前 epoch。周期结束后的新入账自动进入下一个 epoch，避免“Root 生成较慢时把新资金分给旧持有人”的时间错配。

## 4. Root 与服务费状态机

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

## 5. TWAB 与 Merkle 冻结规则

TWAB schema 为 `TRANSFER_LOG_TWAB_30D_V1`：

```text
accountTwab = sum(balanceAtIntervalStart * intervalSeconds)
```

这里保存的是未除以 30 天的精确 numerator。所有账户使用同一窗口，因此比例不变，同时避免提前整数除法造成精度损失。

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

这是为了避免在每次 Meme 转账/Swap 中增加 TWAB checkpoint SSTORE。代价是 Root 正确性依赖平台 publisher、独立 review role 和公开数据复算。后续可以在 V2 发布前增加 zk verifier 或可证明的 source root；不得在没有 validity/fraud proof 时宣传为“无需信任”。

合约已采用以下资金防线：

- Quote 注入、ERC-20 服务费和所有 ERC-20 支付均检查发送方与接收方的精确余额差；
- fee-on-transfer token 会回滚，rebase/proxy 行为仍需部署准入和 codehash 检查；
- Quote liability 与 service liability 独立统计，即使两者使用同一资产也必须由真实余额共同覆盖；
- Claim 先消耗 bitmap/account 标记和负债，再进行 `nonReentrant` 支付，失败会整笔回滚；
- 没有通用 `execute`、delegatecall、任意 recipient、市场 pause/retire 或管理员提取 holder liability 的入口；
- Root 最终确认后不可更换。

## 7. V2 发布前仍需冻结的产品输入

以下内容故意没有写死在本轮代码中：

1. 买卖两侧及各资产侧最终手续费比例；
2. 哪个 V2 FeeVault/Hook 是 `fundQuoteTreasury`、`burnMeme` 的 canonical caller；
3. eligibility policy 的排除地址，尤其是 PoolManager、Curve、Locker、Distributor、桥和不可领取系统地址；
4. Root 服务费资产与价格；
5. RH 链 finalized 秒数/区块数、publisher/reviewer Safe、claim window；
6. 是否在发布前升级为 zk 或可验证 fraud-proof Root。
7. 某周期 eligible TWAB 为零，或没有可签名持有人时，是滚入下一周期还是在超时后开放 permissionless trigger。
8. 平台 Root worker 的 RH RPC、索引数据源、签名/广播和持久化幂等运行环境。

这些值完成产品、安全、法律和目标链验证之前，本模块维持 `NOT DEPLOYABLE`。

## 8. 代码与验证入口

- 合约：`contracts/src/v2/modules/TreasuryDistributorV2.sol`
- Token：`contracts/src/v2/modules/TickerMemeTokenV2.sol`
- 对接接口：`contracts/src/v2/interfaces/ITreasuryV2.sol`
- Root 生成器：`services/treasury-root-generator/`
- 独立构建：`npm run build:v2-treasury`
- 独立测试：`npm run test:v2-preview`

本地门禁结果：25 个单元/边界测试及 1 个 invariant suite 全部通过；5 条不变量完成 256 runs、128,000 次随机调用且 0 revert；Root 生成器 6 个测试及 TypeScript 构建通过。该结果只表示本地实现门禁通过，不替代第三方审计或 RH 测试链验证。
