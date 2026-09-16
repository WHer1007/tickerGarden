# Holder 钱包快照合约改进与复核

日期：2026-09-13。范围：当前本地合约、部署构建、ABI 与权限接口；不包含后端快照发布器、证明 API、领取页面的完整迁移。

状态：**合约实现完成；NOT_PRODUCTION_READY；NOT_BROADCAST**。这是内部代码复核与测试记录，不是独立第三方安全审计。已有不可变部署不能原地升级，必须新 release。

## 已落地的业务链路

1. Meme 转账使用标准 ERC20 余额更新，删除 Holder checkpoint 回调及其启用接口。奖励发布、领取、故障都不参与代币转账路径。
2. 仅钱包直接 Meme 余额参与快照。Safe 等智能合约钱包允许参与；LP、借贷、质押等间接权益不计入。零地址、销毁地址及登记的协议库存地址排除。
3. 原 FeeVault 将真实 Holder Quote／Meme 资金转入 Distributor。保持原手续费比例与原资产结算，不加入兑换路由。
4. 治理 AccessManager 通过 `setSnapshotPublisher(address)` 配置／轮换专用普通发布钱包；默认零地址，未代填部署者或多签。治理调用遵循权限配置的延迟；每轮不需要治理签名。
5. 发布钱包调用 `publishSnapshots`，一笔支持 1–32 个市场／轮次记录，批次原子执行。每个市场轮次从 1 严格递增，快照区块递增，不可覆盖已有 Root。预算只能来自该市场已入账、尚未分配的真实资金。
6. Root 同时绑定 Quote 和 Meme 金额；leaf 双哈希，并绑定域、链 ID、Distributor、市场、轮次与领取钱包。用户直接调用 `claimSnapshot`，支持 Quote／Meme 分别领取。原 FeeVault Holder role=2 路径明确拒绝并要求快照证明。
7. 快照后卖出不丢失已确定的当轮奖励，买入者不能领取卖出者的旧权益。领取记录独立防重放，轮次余额限制总支出。
8. RH/Nitro 使用 ArbSys 的 canonical L2 编号／哈希，避免误用父链估计编号。最近 256 个区块验证哈希；更早区块由发布者承诺。区块哈希匹配不代表已证明最终性。

## 安全复核结论与限制

- 领取采用先扣账后付款、重入保护、精确 ERC20 收支差额检查及最终偿付检查。付款失败回滚该次权益扣账；Quote 故障时允许单独领取健康的 Meme 资产。
- 市场、轮次预算独立，不能借用其他市场资金；共享资产的总负债也必须被实际余额覆盖。
- **发布者仍受信任**：可在已授权 Holder 预算内生成错误或恶意分配。合约不重新计算历史持仓，Merkle proof 不证明数据计算正确。发布者不因此获得协议治理、Stock 本金或 Treasury 提款权限。
- Root 生效后不支持改写、管理员回收或过期销毁。错误名单、金额总和与预算不符、丢失证明等可能导致当轮资金无法正常领取；本版没有管理员纠错逃生通道。发布前必须独立复算并永久保留完整数据和证明。
- 对非标准转账／余额扣减资产采取失败回滚与偿付保护，不能保证此类外部资产本身永远可用。奖励失败不影响 Meme 的 ERC20 转账。
- 本版没有宣称随机抽样已经实现；周期和随机取样规则仍是待确认的链下政策。

## 验证记录

证据目录：`docs/reviews/evidence/holder-wallet-snapshot-2026-09-13/`。

| 检查 | 结果 |
| --- | --- |
| 完整非 Fork 合约回归 | 83 suites，873 passed，0 failed，0 skipped；`contracts-final.log` |
| 钱包快照专项 | 19 passed，包括 fuzz、RH L2 编号、权限延迟、重放、预算隔离和异常付款；`unit-final.log` |
| 真实本地 Uniswap v4 池 | 奖励合约所有调用强制失败时卖出仍成功；Root 领取通过；包含在完整回归 |
| Python ABI/spec | 66 passed；`spec-final.log` |
| 部署 schema／权限／preflight | 66 passed；`deployment-final.log` |
| 当前奖励接口工具测试 | 5 passed；`integration-surface.log` |
| 生成物 | canonical、Solidity interface、mutation draft、compiled/product manifest、Web ABI 已同步；生成器 check 通过 |
| 构建 | Web 与 deployment TypeScript 构建通过；Web 仍有已有大 chunk 提示 |
| 本地边界／差异空白检查 | 通过 |
| CI all tracks | Product track 318 项通过；通用 Fork gate 因未配置 `ROBINHOOD_RPC_URL` 阻断；未宣称全部 gate 通过。另已使用主网专用 runner 尝试公共 RPC，结果见下文。 |

单次冷接收地址的普通 Token 转账测量为 **54,452 Gas**（单元环境，不是链上交易报价）。运行时代码模板大小：Holder Distributor 11,551 bytes、Token 2,102 bytes、FeeVault 19,447 bytes、Factory 23,880 bytes，均小于 EIP-170 的 24,576 bytes。Factory 剩余空间较小，后续修改应继续检查尺寸。

旧 continuous-stream/checkpoint 专项测试不再适用于新业务，已保存到 `archive/holder-continuous-2026-09-13/`，由快照证明、预算、权限、异常领取和交易隔离测试替换；不能将归档测试计作新版本通过证据。

## 尚需完成才能上线

- 提供发布钱包公开地址，确认周期和随机区块取样规则。
- 后端从完整、已确认索引数据重建钱包余额，供应量和排除名单复核，生成／持久保存完整分配数据、proof 和摘要，自动化签名前模拟、幂等重试与监控。
- Read API 从数据库提供 proofs；领取页面迁移到新接口。旧连续奖励 worker 与旧页面接口不能直接用于新部署。
- 新字节码导致 Factory codehash、部署地址、payload、构建摘要与旧计划不同，必须重新生成生产部署计划、证书与权限验收；不能复用旧签名或旧 readiness 结论。
- 完成新版本的真实 Fork 与端到端快照流程验收，以及生产上线前独立安全复核。本轮未部署、未广播、未读取私钥。

### 本轮主网 Fork 实际结果

运行 `node tools/check-rh-mainnet-candidate-fork.mjs`，新版本编译成功，但公共 RPC 返回 `error code -32000: metadata is not found, 61361541`，测试未能建立所需历史状态。详见 `mainnet-fork.log`。不能用本地 873 项测试代替此项；需要可读该固定区块状态的 RPC，或重新选择并验证完整的新 pin 后重跑。Fork 中的快照轮次推进使用显式模拟 ArbSys 元数据，仅用于领取联调，不是历史余额复算或最终性证明。
