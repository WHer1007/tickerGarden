# 单资产领取与检查点优化 — 2026-09-11

本轮完成用户指定的三项改进：单资产领取、空激活队列快速返回、Holder 无效读取及账本定位优化。没有实施上一轮审计中的兑换 Gas 储备改造，没有恢复兑换最低到账或历史价格窗口。未部署、未广播、未请求链上 RPC。

## 1. 单资产领取

- 新入口 `claimUserRewardAssets(bytes32,uint8,uint32,uint8,bool,bool,uint256)`：资产位图 1=Quote、2=Meme、3=两者，其他值拒绝。现有 `claimUserRewards` 是默认选择两者的便利入口，调用同一内部实现。
- Creator 仅消费被选资产的对应 epoch 负债；Staker 一次检查权限、锁和退出状态，一次结算，但仅清除被选奖励；Holder 仅从所选奖励账本消费和付款。未选权益保留，不转入新的释放周期。
- FeeVault 对未选资产跳过余额查询和偿付检查。仅领 Meme 原币时，异常 Quote 不再阻塞；仅领 Quote 时不触发 Meme 付款。
- 仅选 Meme 但要求兑换时，Quote 偿付检查在可捕获的兑换子调用内。兑换失败时按用户授权领取原币或保留 Meme；兑换所得 Quote 不消费原有未选 Quote 权益。实际输出和精确到账仍检查，不设置最低成交价格。
- Holder 的 Meme 同时是持有人权重来源：存在未结算指数差时仍须读取其持币余额。因此该优化不承诺屏蔽所有对权重代币本身的依赖；它隔离的是未选奖励资产的消费、付款和独立偿付检查。
- 默认选择两者仍是原子领取，一种被选资产失败会整笔回滚；故障隔离通过显式单资产选择实现，不是吞掉付款失败。

前端领取弹框新增资产选择，使用实际 Quote/Meme Symbol。仅 Quote 禁用兑换及兜底；原币领取不等待兑换预估，原币模式切换资产不发无用兑换预估；异步响应不能覆盖后续选择或已关闭弹框。用户符号用 textContent 写入。

当前版本标识改为 `TICKERGARDEN_USER_CLAIM_ASSET_SELECTION_V1`，同步前端、Go 观察器、Holder worker 与部署检查脚本。旧部署不会被误认为支持新入口。事件仍报告本次 paid/retained/converted，不代表用户所有未选权益的余额。

主要代码：

- `contracts/src/v1/shared/ProtocolFeeVaultUserClaims.sol`
- `contracts/src/v1/shared/ProtocolFeeVaultUserConversion.sol`
- `contracts/src/v1/modules/MemeStockGauge.sol`
- `contracts/src/v1/modules/HolderRewardsDistributorV1.sol`
- `apps/web/src/app.ts`、`ui/reward-claim-dialog.ts`、`v1/features/userClaims.ts`

## 2. 空激活队列

`MemeStockGaugeActivationWheel._checkpointActivations` 在 `_totalPendingStock == 0` 时返回零；`UserStockVaultRewardAccounting` 的有效权重读取和队列检查点在 `_rewardPending == 0` 时直接返回，不扫描 32 槽。

复用已有计数器，没有新增缓存或后台任务。外围 cohort/退出检查、非空队列的到期处理和激活快照仍保留；Vault 与 Gauge 的独立本金/收益职责未合并。

## 3. Holder 读取与账本定位

- 转账先推进两套释放指数，再检查用户是否存在指数差；无指数差时不调用 token.balanceOf。需要余额时仍只读一份，供两套奖励共用。
- `_account` 在账户指数等于市场指数时直接返回，避免无效 earned/index 写入。
- `_checkpoint`、`_pendingRelease`、`_append`、`releaseState` 在函数内复用 ledger key，避免循环中反复定位。
- 未使用 `rate == 0` 作为跳过结算条件：已经释放但尚未入账的历史收益仍会正确结算。供应量变更、excluded 账户、self-transfer、idle 重启、余数和释放批次保持现有规则。

## 4. 接口与构建同步

已同步 ABI 源规范、权限矩阵、生成 Solidity 接口/草案、canonical ABI、compiled/product manifest、前端生成 ABI、后端事件来源及 golden。新增两个规范入口后，部署清单权限数量由 81 改为 83（管理员控制的 selector 仍为 19，固定调用者/公开入口由 62 改为 64）。Holder 的 Vault-only 方法不开放用户任意代领。

Factory 固定 Gauge 实现代码哈希更新为 `0x699e74280e4c14847f5a3b71b37b8e9aeb4db7d8aab13a0463cc15f3c34c81b0`。当前 runtime template 字节数：FeeVault 20,492；Gauge 13,220；Holder 15,872。均未超过 EIP-170 的 24,576 字节上限；仍须使用目标链的新部署和对应清单，不是原地址升级。

## 5. 验证

证据目录：`outputs/reviews/asset-claim-optimization-2026-09-11/`。

| 检查 | 最终结果 | 日志 |
| --- | --- | --- |
| 全部本地非 Fork 合约测试 | 84 suites，934 通过，0 失败、0 跳过；invariant 64 runs × 64 depth，普通 fuzz 256 | `contracts-final.log` |
| 前端测试 / 类型 / 构建 | 313 通过，构建通过 | `web-final.log` |
| 规范及当前合约表面 | 66 通过，生成接口/产物一致 | `spec-final.log` |
| 当前奖励 guard / worker | 11 通过 | `spec-final.log` |
| 部署工具测试 / 构建 | 62 通过，构建通过 | `deploy-complete.log` |
| 后端 API/事件生成与 golden | 29 通过，生成检查通过 | `backend-final.log` 前半部分 |
| 本次受影响 Go 版本识别及收益模型 | 通过，包含拒绝旧 all-assets-only mode | `go-affected.log` |
| 编译来源证明 | 37 个产物，405 个源码 hash 校验通过 | `build-inputs.log` |
| 源码边界 / diff 空白 | 通过 | `boundary.log` |

新增测试覆盖 Creator/Staker/Holder 单资产选择、异常 Quote 的 balanceOf/transfer、未选 Meme 转账失败、真实 Holder→FeeVault 路径、兑换保留未选 Quote、重复领取、锁和权限、非法位图，以及无收益指数时禁止任何外部持币余额读取。计数包含继承重跑的用例，不等于全部为新增测试。

**扩展检查的已知限制：** Go 的整个 `internal/deployment` 包仍有 `treasury-activate`、旧 Treasury pending/claim、旧 market identity 夹具失败，报错为不支持的部署合约或维护操作；未把此扩展包称为全部通过。相关完整失败证据在 `go-final.log`。本次改动的版本识别与收益模型定向测试通过。最初沙箱阻止 httptest 临时监听端口，获准在本机运行后才得到上述真实夹具失败；不是 RPC 超时。没有为通过检查恢复旧 Treasury 业务或放宽当前清单验证。

初次整套验证发现的一份 Gauge 模拟器旧调用签名，以及两处部署测试旧数量断言，均已更新并通过最终回归。Foundry 的测试 mock 弃用/缓存告警、Vite 大 bundle 告警仍存在，不影响上述命令成功结果。

## 6. Gas 对照及口径

优化前后同一编译器 0.8.26、optimizer 200。以下为未修改业务动作的同名 **Foundry 测试函数 Gas，包含测试内部署、辅助操作和断言，不是单笔生产交易 Gas**。修改了测试动作的余额调用次数测试不参与对比。

| 测试场景 | 优化前 | 优化后 | 变化 |
| --- | ---: | ---: | ---: |
| 同秒添加激活批次 | 599,301 | 394,729 | -34.14% |
| Holder 六批过期处理 | 1,595,436 | 1,585,619 | -0.62% |
| Holder 同交易借入归还 | 968,114 | 949,815 | -1.89% |
| 全部原币领取及其他用户隔离 | 370,367 | 372,035 | +0.45% |

资产选择增加分支，不能承诺所有 Claim 更省 Gas；主要降低的是激活/Holder 高频空操作，并增加故障时可领取性。详情保存于 `gas-comparison.json`。源码指纹保存于 `source-sha256.json`。

当前结果为源码及本地验证完成。未执行真实链 Fork 或新部署，不能据此宣告链上版本已更新或生产发布门禁全部通过。
