# Test Prototype 权限、暂停与退出矩阵

> 历史归档：本文权限模型不属于当前 V1 的权限或部署配置。

> 任务：`P-005`
>
> 状态：`REVIEW`。角色模型、延迟、函数级行为和机器检查已经完成；实际 Safe 成员、链上地址及产品/安全签字仍是上线门禁。
>
> 历史机器可读矩阵路径：`spec/permissions_matrix.json`；自动检查路径：`spec/test_permissions_matrix.py`（当前仓库已不再保留）。合约 ABI 可调整命名，但不得改变矩阵的权限与退出语义。

## 1. 最小角色模型

```text
3/5 Protocol Safe
        │ propose
        ▼
ProtocolTimelock ── 48h 普通操作 / 7d 退休与国库迁移
        │
        ├── Registry / Factory / Market 配置与恢复
        ├── Worker 角色轮换
        └── 已批准的 Treasury 迁移

2/3 Pause Guardian ── 只能 pause 或 cancel Timelock 操作

Execution Worker ── 只能提交 Stock/TGARD 两类受约束回购

EmissionController ── 唯一 Token minter；只响应两个绑定 Gauge

NamingExecutor ── 只执行一次社区最终命名
```

Test Prototype 不增加 DAO 通用执行器、代理管理员、市场创建者管理员或“超级管理员”。创建者只提交创建参数并支付创建费，创建成功后不获得增发、暂停、改池、改排放、转国库或重定向奖励的权限。

## 2. Safe 与 Timelock

### 2.1 Protocol Safe

- 采用 3/5 Safe。
- Safe 只能成为 `ProtocolTimelock` 的 proposer/canceller，不直接持有协议目标合约的配置角色。
- 普通配置、恢复、资产登记和 Worker 轮换最短延迟 48 小时。
- 市场退休与 StockTreasuryVault 迁移必须以同一 Timelock 的 7 天自定义 delay 排队，不部署第二套迁移 Timelock 或内部 schedule 状态机。
- Timelock operation 到期后允许任何人 execute，避免 Safe 在线状态成为执行依赖；执行目标和 calldata 必须与排队内容完全一致。

### 2.2 Pause Guardian

- 采用独立于 Protocol Safe 的 2/3 Safe。
- 仅拥有 `pauseFactory`、`pauseAsset`、`pauseMarket`、`pauseExecution` 和 Timelock `cancel` 权限。
- 不能 unpause、改参数、增发、授予角色、执行回购、移动国库、退休市场或改名。
- pause 重复调用必须幂等；Guardian 被攻破最多造成可恢复的新增操作停机，不能冻结用户本金或既得权益。

### 2.3 Timelock 自管理

部署完成后：

1. Timelock 自身持有 admin；Protocol Safe 获得 proposer/canceller。
2. Guardian 只获得 canceller 以及各模块 pause-only 权限。
3. executor 向公众开放，任何人只能执行已到期且 calldata 匹配的 operation。
4. 部署 EOA、脚本地址和临时测试角色全部撤销。
5. 任何角色轮换也必须通过 Timelock；不得保留隐藏 owner 或双重管理入口。

## 3. 暂停域

Test Prototype 只保留四个独立暂停域，避免一个开关停止所有用户退出：

| 暂停域 | 暂停内容 | 明确不暂停 |
|---|---|---|
| Factory | 新市场创建 | 已有市场、Token 转账、全部用户退出 |
| Asset | 使用该 Stock Token 创建/激活新市场及新增股票质押 | 既有 Stock Token withdraw、claim、Escrow release |
| Market | 新 stake、LP subscribe、官方池 initialize、官方协议 swap | 现有排放 checkpoint、withdraw、claim、unsubscribe、modify/remove/collect/transfer/burn LP NFT、Escrow release |
| Execution | FeeExecutor 的四类 Bucket 消费 | Bucket 继续安全留在 Vault；用户 swap 是否开放由 Market 状态决定；全部用户退出不受影响 |

普通 `PAUSED` 状态不移动排放起止时间。现有有效股票份额和 LP 份额继续按照 P-002 固定时间轴结算；零份额区间仍永久错过。若要永久停止未来排放，必须走 7 天延迟的 `RETIRED`，不能把 pause 偷换成退休。

Token 本身没有全局 transfer pause、黑名单或管理员扣押能力。外部非官方池无法由 TickerGarden 暂停，前端必须明确区分“官方协议暂停”和“Token 不可转移”。

## 4. 市场状态转换权限

| 转换 | Caller | 延迟 | 执行前动作 | 执行后约束 |
|---|---|---:|---|---|
| REGISTERED → ACTIVE | ProtocolTimelock | 48h | 重跑资产/Feed/manifest 门禁；开始时间不可修改 | 开放新风险操作 |
| REGISTERED → PAUSED | Guardian 或 Timelock | 0 | 无 | 禁止激活前风险操作 |
| REGISTERED → RETIRED | ProtocolTimelock | 7d | 确认无用户资金或给出迁移说明 | 终态 |
| ACTIVE → PAUSED | Guardian 或 Timelock | 0 | 先 checkpoint | 现有份额继续计奖，退出开放 |
| PAUSED → ACTIVE | ProtocolTimelock | 48h | 修复证据、preflight 和恢复公告 | 不补偿暂停期间零份额排放 |
| ACTIVE/PAUSED → RETIRED | ProtocolTimelock | 7d | 先 checkpoint；公开退休原因和用户退出说明 | 停止未来 ReleasedBudget；历史权益永久可领 |

`RETIRED` 没有出边。退休不自动转移 StockTreasuryVault、不销毁用户 Token、不取消 pending/tranche，也不要求用户在截止日期前退出。

## 5. 函数级权限摘要

完整逐函数字段以 JSON 矩阵为准。下表列出必须直接反映在 ABI 与测试中的关键边界。

| 模块/函数族 | Caller | 暂停时 | 收款或状态目标 |
|---|---|---|---|
| Registry `registerAsset/setAssetStatus` | Timelock 48h | blocked | 仅批准 manifest 参数 |
| Factory `createMarket` | public | blocked | 标准化模块，创建者无管理权 |
| Token `mint` | EmissionController | allowed | 仅登记 beneficiary + Escrow |
| Token `burn` | Token holder 自身 | allowed | 只能减少调用者持有量 |
| Token `finalizeMetadata` | NamingExecutor | allowed | 只能成功一次，不能改变 marketId |
| Emission `bindGaugesOnce` | Factory 原子创建阶段 | blocked | 一次绑定后永不可替换 |
| Emission `recordRelease/mintClaim/finalizeEmission` | 绑定 Gauge / public finalizer | allowed | 受 PoolReleased/PoolMinted 上限约束 |
| Stock Gauge `stake` | public | blocked | 调用者自己的仓位 |
| Stock Gauge `withdraw` | beneficiary | allowed | 本金固定回 beneficiary |
| 两 Gauge `claim` | beneficiary | allowed | 20% 固定 beneficiary，80% 固定 Escrow |
| LP `notifySubscribe` | canonical PositionManager | blocked | 订阅时链上 owner 固定为 beneficiary |
| LP modify/unsubscribe/burn callbacks | canonical PositionManager | allowed | 先结算登记 beneficiary，不接受 data 重定向 |
| LP `syncPosition` | public | allowed | 只能停止不一致仓位未来计奖，不改历史 beneficiary |
| Escrow `createTranche` | EmissionController | allowed | 登记 beneficiary |
| Escrow `releaseVested` | beneficiary | allowed | 固定 beneficiary |
| Escrow `releaseVestedFor` | public | allowed | 仍固定支付 beneficiary，不支付 caller |
| Initializer `initializeAndAddLiquidity` | public | blocked | LP NFT 固定归调用者 |
| FeeVault `creditBucket` | TickerGarden Hook | blocked | 固定 BucketKey |
| FeeVault `consumeBucket` | FeeExecutor | blocked | 固定操作目的地 |
| Stock/TGARD buyback | Execution Worker | blocked | StockTreasuryVault / TGARD burn |
| Ticker Meme burn / revenue forward | public | blocked | Token burn / 固定 ProtocolTreasury |
| StockTreasuryVault `migrateTo` | Timelock 7d | allowed | 仅批准的同资产 successor Vault |
| Naming propose/vote | 合格公众 | allowed | 无资产移动 |
| Naming execute | 成功提案 + 7d 后 public execute | allowed | NamingExecutor → Token 一次性入口 |

## 6. 领取与退出的不可剥夺性

以下路径不得使用 `whenNotPaused`，不得依赖 Worker、Backend API、Indexer、管理员或活跃前端：

- `StockStakingGauge.withdraw`；
- Stock/LP Gauge 已产生奖励的 `claim`；
- `RewardEscrow.releaseVested` 与固定收款人的 `releaseVestedFor`；
- PositionManager `unsubscribe`、modify/remove liquidity、collect、transfer 和 burn；
- `CanonicalLPNFTGauge.notifyModifyLiquidity/notifyUnsubscribe/notifyBurn`；
- permissionless `syncPosition`；
- permissionless `finalizeEmission`。

Claim 不提供任意 `recipient`，也不提供无签名 `claimFor`，避免第三方通过频繁小额 claim 重置 7 天 cooldown 或耗尽 tranche 槽位。`releaseVestedFor` 可以 permissionless，因为它不创建 tranche、不更新时间锁，且只能把已解锁 Token 发给登记 beneficiary。

Stock withdraw 不允许把本金重定向到调用者提供的任意地址。若未来确需代理退出，只能增加带 nonce/deadline 的用户签名授权，不得让管理员代填收款人。

## 7. Execution Worker 边界

Worker 热钱包只获得两个函数：

```text
executeStockBuyback(...)
executeTgardBuybackAndBurn(...)
```

它不能：

- 调用通用 `execute`、任意 target/calldata 或任意 approve；
- 修改 Router、Path、slippage、deadline 上限或 Treasury；
- 消费 Ticker Meme burn / protocol revenue 之外的错误 Bucket；
- 把输出发送给自身或任意地址；
- mint Token、暂停/恢复协议、创建/退休市场或管理角色。

Ticker Meme Bucket burn 与固定 ProtocolTreasury 划拨不需要报价，允许任何人触发，但仍受 execution pause、Bucket 类型、固定目的地、幂等 batchId 和资产守恒约束。

## 8. 国库迁移

StockTreasuryVault 正常状态没有 withdraw、approve 或 execute。唯一迁移入口 `migrateTo(successor)` 必须：

- 通过 ProtocolTimelock 排队至少 7 天；
- successor 已由 Registry/Factory 版本清单批准；
- successor 绑定同一 `marketId`、Asset UID 和 canonical Stock Token；
- 一次性转移全部对应 Stock Token，不接受任意资产/数量/calldata；
- 发出旧/新 Vault、资产、余额、原因哈希和 Timelock operationId；
- 迁移后旧 Vault 永久关闭接收以外的状态变化，但历史可查询。

Guardian 可取消排队 operation 或先暂停相关市场/执行器，但不能指定 successor 或自行迁移。

## 9. 禁止接口

任何 Test Prototype 生产合约不得暴露以下能力或等价变体：

```text
execute(address target, uint256 value, bytes data)
withdrawToken(address token, address to, uint256 amount)
approveToken(address token, address spender, uint256 amount)
setMinter(address)
setMaximumSupply(uint256)
setEmissionEnd(uint256)
setRewardBeneficiary(address)
```

不得通过 fallback/delegatecall、代理升级、任意 multicall target 或角色可授予的插件绕过该禁令。

## 10. 自动验收

运行：

```bash
python3 -m unittest discover -s spec -p 'test_*.py' -v
```

权限矩阵测试至少证明：

1. 每个 module/function 键唯一；
2. 所有 exit、claim 和 PositionManager 生命周期回调在暂停时仍允许；
3. Guardian 只有 pause/cancel；
4. Worker 只有两类需要报价的 buyback；
5. 配置和 unpause 至少延迟 48 小时；
6. retirement 与 Treasury migration 至少延迟 7 天；
7. claim/exit 收款人不可由 caller 重定向；
8. Token 只有 EmissionController 一个 minter；
9. 不存在通用特权 selector。

## 11. 仍待上线前提供

- Protocol Safe 与 Guardian 的真实成员、阈值确认和地址；二者成员重叠上限及硬件钱包要求；
- Timelock、ProtocolTreasury 和首发市场各模块真实地址；
- Worker signer 的 KMS/HSM、余额上限、轮换和撤销演练；
- TGARD 与 Stock Token 允许路径冻结后，补齐 FeeExecutor 函数参数和负向测试；
- 产品与安全负责人对本矩阵及 P-002 同一规格版本签字。
