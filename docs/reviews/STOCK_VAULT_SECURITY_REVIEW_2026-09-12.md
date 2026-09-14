# Stock Vault 安全与优化检查
> 后续实现更新：已有本金缺口仍接受新存款的问题已加入本地保护，详见 [本金缺口保护与验证](STOCK_VAULT_PRINCIPAL_GUARD_2026-09-12.md)。下文保留审计时证据；不代表旧损失已补回或已部署修复。

日期：2026-09-12。对象：当前工作区 `contracts/src/v1/modules/UserStockVault.sol`（MultiAsset.v6）及其 Identity / Deposits / Ledger / RewardAccounting / Exits，连同 OfficialStockRegistryV1、AllocationManager 和 Vault–Gauge 退出链路。

## 结论与边界

本次未发现普通用户无权限提取他人本金、重复取款或凭空增加自身本金的可复现路径。发现一项显著的 Gas 优化问题，以及两个需要明确代币信任前提的托管风险和一项误转资产处理限制。

这不是无风险证明或生产准入结论。检查针对本地源码和测试，未核对生产部署字节码，未进行新的真实 STOCK 主网 Fork，也没有验证每个发行方的管理员、冻结、扣款和升级权限。条件性风险的测试使用 mock 状态变化，不能据此认定当前真实 STOCK 存在相应恶意功能。

初次审计只新增复现测试和报告。后续按用户要求修复了下述重复扫描问题，详见文末；未部署合约或迁移资金。

## 1. P1 性能：重复扫描同一 Vault 字节码，Gas 开销极大

证据：`OfficialStockRegistryV1.sol:461` 的 `_vaultIdentityCurrent` 已校验注册时固定的 runtime codehash，但第 467 行仍调用 `_containsForbiddenVaultOpcode`，逐字节扫描完整 runtime。注册时 `_registerVaultIdentityIfNeeded` 已执行同样的扫描。

调用链：

- `depositStock` → `_activeCanonicalAsset` → `assetIdentityCurrent` → `_vaultIdentityCurrent` → 完整扫描。
- `stake` 先经 AllocationManager 的 `_openAllocationMarket` 校验身份，再经 Vault deposit 校验身份；至少有两次这样的检查。

本地 Foundry v1 配置（Solc 0.8.26，optimizer 200）隔离测量：

| 操作 | 测量 |
| --- | ---: |
| Vault runtime 字节数 | 12,171 |
| 单次 opcode scan | 3,350,314 Gas |
| assetIdentityCurrent | 3,393,870 Gas |
| deposit 调用本身 | 3,489,915 Gas |

这是本地测试调用的 gasleft 差值，排除了前置 mint/approve，但受测试冷热访问顺序影响；不是线上交易报价，也未测量修改后的节省量。

建议：注册时执行完整 opcode 校验，后续仅验证固定 codehash、schema、Vault/Registry/Manager 绑定与必要依赖。相同 codehash 下重复解析相同代码没有增加身份保障。保留注册扫描、运行时代码哈希和依赖绑定检查，不要为省 Gas 跳过这些边界。对 codehash 漂移、非法 opcode 注册和身份返回值变化补回归后，再比较 stake/deposit Gas。

优先级理由：这是确定存在的日常业务开销，不依赖恶意代币；会显著增加用户费用和复杂交易所需 Gas。

## 2. P1 条件性托管风险：已有余额亏损时，仍接受新存款

证据：`UserStockVaultDeposits.sol:31–44` 只验证本次 `afterBalance - beforeBalance == amount`，没有检查 `beforeBalance >= _totalDeposited[assetUid]`。Vault 使用原始数量账本，没有份额制或损失分摊机制。代码哈希、UID 和 decimals 也无法检测发行方通过既有状态控制发生的余额扣减。

复现：

1. Alice、Bob 各存 100，实际余额和总账均为 200。
2. 模拟 Vault 余额被外部扣减为 150，代码和身份字段不变，`assetIdentityCurrent` 仍为 true。
3. Charlie 再存 100，被正常接受：实际余额 250，总账 300。
4. Alice、Bob 各取回 100 后，Charlie 的 100 无法完整取回，实际余额只剩 50；失败交易回滚，其账面存款仍为 100。

这不是 Alice/Bob 可以自行执行的无权限攻击：前提是入库 STOCK 能在正常 Vault 转账以外损失余额，例如发行方强制扣款、负向 rebasing 或有害升级。没有证据表明本次列出的真实股票代币已发生该行为。

建议：

- 存款前使用已经读到的余额检查是否足额覆盖既有本金；发现缺口时拒绝新资金进入，并监测每个资产的 `balanceOf(vault)` 与 `totalDeposited`。
- 为支持的真实 STOCK 明确并验证发行方扣款、冻结、升级及 rebasing 行为；仅检查 fingerprint 不足以覆盖这些能力。
- 不要简单把“全部余额必须足额”的条件加到所有提现路径：这可能连剩余可退出资金也全部冻结。异常损失的处理机制需要单独设计和批准；阻止新增存款不能补回已经发生的损失。

## 3. P2 条件性退出可用性：紧急退出无法绕过代币自身限制

证据：`UserStockVaultExits.sol:35–62` 要求 `transfer` 返回恰好 32 字节且值为 1，并要求 Vault 扣减和用户增加都精确等于 amount。`rageQuit` 最终执行相同转账。

新增测试让同一 mock token 在存入后改为 transfer 无返回数据：身份检查仍通过，但 free withdrawal 和 rageQuit 都回滚，账本保持完整。既有测试也覆盖返回 false、畸形返回、转账税和余额异常。

因此“无条件退出”准确含义应是绕过锁定期、最低仓位和 Gauge 结算可用性；并不保证在 STOCK 冻结、禁转、黑名单或转账语义变化时仍能成功。接收方固定为用户本人，也不能绕过发行方对该地址的限制。

建议：明确支持资产的返回值/转账政策，升级后重新测试实际存取款；若业务决定兼容标准 no-return ERC-20，可评估 SafeERC20 风格的可选返回值检查，同时保留双向精确余额检查。不要直接删除精确到账校验；它正在防止错误记账。发行方禁止转账的情形无法靠这种兼容性优化解决。

## 4. P3 使用风险：直接转入 Vault 的 STOCK 不会记为存款

`depositStock` 成功完成精确拉款后才增加用户账本。直接调用 token.transfer(vault, amount) 只增加实际余额，不增加任何人的 deposited/freeBalance。

复现：直接转入 100 后，Vault 实际余额为 100、总账为 0、转账用户 freeBalance 为 0，其提现失败。当前 Vault 没有 rescue/skim 或认领误转的公开入口。

建议在存款界面和文档明确只使用存款/质押入口。监测 `actual > totalDeposited` 的差额，偿付能力不变量应表达为 `actual >= liabilities` 并单独统计 surplus；现有等式不变量是受控 handler 假设，不覆盖外部误转。不能按余额差直接给下一个存款人补记，否则会允许抢占他人的误转。也不建议为恢复误转随意加入可提取用户本金的管理员入口。

## 已确认有效的保护

- 只有固定 AllocationManager 能操作他人的 allocation；Manager 公开存款、质押、退出绑定 msg.sender，Vault 转出接收方也是该用户。
- 存入验证实际到账，转出验证 Vault 和用户两侧变化；失败原子回滚。
- 资金流和本金账本变更有 nonReentrant 防护；重入、错误返回、跨资产和超额释放已有测试。
- paused/retired 禁止新增资金活动但保留退出；身份漂移不会直接禁止原资产退出。
- 直接 Vault rageQuit 不调用 Gauge，先设置收益放弃标记并移除本金权重，再精确转回本金。Gauge 故障不会阻塞这条本金路径；未清算 tombstone 会阻止同市场重新进入和陈旧收益领取。
- Manager 的收益清理是有 Gas 上限的 best-effort；可由任何人重试清理，不能修改本金接收方。
- 奖励激活轮固定 32 格、30 秒延迟，不是随用户数增长的无界遍历；本金/Gauge 权重和 cohort 边界有针对性验证。

## 再次确认最低投入规则

Vault 的直接 depositStock 只要求 amount > 0。AllocationManager 的要求是 `currentPosition + amount >= minimumAllocation`，不是每次追加都必须超过最低值，等于最低值也允许。

`AllocationManagerIncreases.t.sol:307` 已验证：最低值 0.5 时，首次 0.5 成功；之后追加 1 个最小原始单位也成功。追加会按既有规则刷新整仓解锁时间，不能把最低仓位限制和锁定期混淆。

## 验证记录

主审执行：

- Vault/AllocationManager 的 product/shared 测试：95 passed，0 failed，0 skipped；fuzz 1,000 次。
- VaultGauge、MultiAssetMaliciousSettlement、RewardCohortBoundary：23 passed，0 failed，0 skipped；两套状态不变量各 256 runs × 64 depth，16,384 calls，0 reverts。
- 新增 `contracts/test/v1/audit/StockVaultCustodyBoundary.t.sol`：4 passed。覆盖余额缺口与新存款、误转、返回值变化、重复扫描 Gas 测量。

独立测试清点后额外运行的 VaultGaugeInvariant：11 passed，256 runs / 128,000 calls / 0 reverts。它不是生产 Fork 证据。

主要命令（contracts 目录）：

```sh
FOUNDRY_PROFILE=v1 forge test --match-path 'test/v1/{product,shared}/*{UserStockVault,AllocationManager}*.t.sol' --fuzz-runs 1000
FOUNDRY_PROFILE=v1 FOUNDRY_INVARIANT_RUNS=256 FOUNDRY_INVARIANT_DEPTH=64 forge test --match-path 'test/v1/{product/VaultGaugeInvariant,product/MultiAssetMaliciousSettlementInvariant,audit/RewardCohortBoundary}.t.sol'
FOUNDRY_PROFILE=v1 forge test --match-path test/v1/audit/StockVaultCustodyBoundary.t.sol --match-test testAudit_ -vv
```

覆盖限制：状态不变量的本金 handler 未随机生成全部奖励 credit/claim/settlement 交错；这些主要由独立定向测试覆盖。后续应补跨本金/奖励的组合状态不变量，以及真实支持 STOCK 升级/冻结/转账兼容性的 Fork 验证。


## 后续修复：注册时扫描，日常身份校验复用固定 codehash

2026-09-12，按用户要求实施。`OfficialStockRegistryV1._vaultIdentityCurrent` 去掉重复的 `_containsForbiddenVaultOpcode` 调用。首次注册仍完整扫描 runtime，验证通过后才记录 codehash；同一 Vault 后续注册资产及每次日常使用继续校验固定哈希、schema 双向绑定、reported Registry/MarketRegistry/AllocationManager 地址和依赖代码存在性。没有改变代币 fingerprint 检查、权限、存款账本或退出逻辑。

安全依据：已经扫描并固定 codehash 的字节码内容没有变化时，重复 opcode 解析不能提供额外保证。身份返回值可以随状态变化，所以这些动态检查没有缓存或移除。

同一工作区、Solc 0.8.26 / optimizer 200 / Foundry v1，修改前后重新测量：

| 操作 | 修改前 Gas | 修改后 Gas | 降幅 |
| --- | ---: | ---: | ---: |
| assetIdentityCurrent | 3,393,870 | 49,049 | 98.6% |
| deposit 调用 | 3,489,915 | 145,094 | 95.8% |
| stake 调用 | 7,213,533 | 523,891 | 92.7% |

数值为本地调用的 gasleft 差值，不包含准备阶段 mint/approve，不是链上交易报价。Stake 使用真实 Registry、AllocationManager、Vault，以及测试用 MarketRegistry/Gauge；用于隔离这次扫描优化，不代表完整生产 Gauge 的交易费用。每次身份检查约节省 334 万 Gas，Stake 的两次检查合计约节省 669 万 Gas。首次注册的扫描成本仍存在。

新增 Gas 上限回归防止日常链路重新引入扫描；补充固定字节码下的 Registry、schema、Manager、MarketRegistry 返回值变化以及依赖代码消失的回归。既有测试继续覆盖 codehash 漂移、注册时拒绝 delegatecall、扫描器 PUSH/INVALID/跳转边界和 Vault schema 唯一性。

定向测试 52 项通过；完整非 Fork 合约测试 86 个套件、956 项全部通过（0 失败、0 跳过），包含 Vault–Gauge 本金/分配账本和权重不变量。产品编译清单已重新生成，只更新 Registry 源码及 creation/runtime template 哈希；ABI、存储布局没有变化。边界、fixtures、产品产物、接口及后端事件/引导产物一致性检查通过。

这是未部署的源码修复。当前已部署 Registry 的 runtime 不会因此改变；新版本部署需要重新计算部署字节码、确定性地址及依赖绑定，不能沿用旧版本的部署证据。本次未执行新的真实链 Fork 或广播。
