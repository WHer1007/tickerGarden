# Claim 与 Holder 记账优化（2026-09-11）

范围：本次五项合约优化，基于 test 工作区现有最新业务。没有部署、广播或 RPC 历史读取。与上一轮离链旧模块清理的未完成项分开记录；本报告不提供整个项目的部署放行结论。

## 实施

1. Gauge 双资产扣账：`consumeClaimable(address)` 返回 `(quote,meme)`，一次读取 clone 身份、一次验证调用者/退出状态/锁、一次结算，然后分别清空两套 pendingFee。旧 `consumeClaimable(address,address)` 删除；小数余数、已支付指数、Creator epoch、各资产总负债不合并。
2. Holder 余额复用：转账前每个非排除地址只读一次 balanceOf，两套奖励复用。self-transfer 只读一次；排除地址不读余额。`claimableAssets` 共用余额；`consumeUserRewards` 在任何付款回调前结算两个账本，然后分别付款，避免跨付款回调继续使用旧余额结算。
3. 市场信息复用：Claim 只从 Registry 读取一次 MarketView，并验证和传递到仅 self 可调用的兑换子调用；Holder 资金注入也共用同次读取。Curve 完成入账时把刚复核的市场传到手续费分配，省掉第三次读取；begin/finalize 两次来源复核、nonce/feeId、余额差和入账锁完整保留。
4. 有效期：只在非零 Meme 的兑换子调用内检查 `[block.timestamp, block.timestamp + 5 minutes]`。直接原币领取与仅有 Quote 的领取不受 deadline 限制。兑换 deadline 无效时沿现有失败语义处理：Quote 支付，Meme 经授权则原币支付，否则恢复用户权益。没有增加最低到账、滑点或历史价格窗口。
5. 无用函数：六个无生产调用、仅测试使用的内部读取/参考计算 helper 从 src 移到 test：`_rewardState`、`_claimable`（Gauge accumulator）、`_effectiveTotalActiveStock`（activation wheel）、`_lastV4FeeNonce`、`_lastCurveSweepNonce`、`_pendingV4Credit`。必要测试直接检查内部状态；存储槽及运行时 nonce、锁和资产保护不变。该项主要改善可维护性，不把编译器本就剔除的函数计作交易 Gas 节省。

## ABI 和部署影响

- Gauge 当前接口：`consumeClaimable(address) -> (uint256,uint256)`。
- FeeVault 仅 self 可调用的子入口：`convertUserClaim(bytes32,MarketView,uint256,uint256)`。MarketView 由同一受保护 Claim 提供；外部调用者不能指定该快照触发兑换。
- 用户入口 `claimUserRewards(bytes32,uint8,uint32,bool,bool,uint256)` 不变。
- 已更新 ABI 规范、权限表及生成接口/清单，并按编译后的 Gauge 实现更新 Factory 的固定代码哈希。旧链上合约不会因源码修改而升级；需要新部署对应版本。

## 验证证据

证据目录：`outputs/reviews/claim-gas-optimization-2026-09-11/`。

新增/更新用例包括：只消费一次 Gauge、Quote/Meme 第二笔扣账失败全事务回滚、锁/退出阻塞、重复领取为零、保留 Meme 的用户隔离、兑换过期/过远/原币无限 deadline/仅 Quote、Claim 一次市场读取、Curve 两次来源复核、Holder 普通/self-transfer 余额读取次数，以及当前 ABI 禁止旧单资产入口。

最终验证：

- 全部非 Fork 合约测试：81 个套件、884 项通过，0 失败、0 跳过。命令显式设置 `FOUNDRY_INVARIANT_RUNS=64 FOUNDRY_INVARIANT_DEPTH=64`，普通 fuzz 保持 256 次。证据 `contracts-final.log`。
- Holder 独立现金流/偿付能力/供给/批次边界不变量另通过 256 次、128,000 个随机操作，0 reverts；证据 `contracts-full.log` 中对应套件。该较深的广范围运行曾遇到待更新的部署 manifest 测试，并在更新测试夹具后中止，不将整次运行计为全量通过；最新全量结论只引用上一条。
- Gas 专项重跑：3 个套件、63 项通过；是既有场景重跑，不与 884 相加。
- 规范及当前 ABI/实现代码哈希校验：66 项通过。
- 当前产品清单对应的 37 个编译产物、405 个来源 hash 校验通过；ABI、接口、权限表、产物清单、前端生成文件、后端事件来源/golden 校验通过。
- 前端 308 项测试及构建通过；部署工具 62 项测试及构建通过；后端生成文件检查的 29 项测试通过；当前奖励入口 guard/worker 的 11 项测试通过；源码边界及 diff 空白检查通过。
- 未运行链上 Fork、广播或完整发布 CI。Foundry 有预处理重复符号与签名缓存写入提示，最终上述命令退出 0；未为清除缓存提示提升文件权限。

另一次可选的旧 `verify-v1-build-inputs.mjs` 默认入口仍枚举已退役的 `TreasuryDistributorV1` 产物，因此其失败日志保留为 `build-inputs-check.log`。本次对当前产物使用同一来源校验函数、按当前 product manifest 枚举 37 个产物独立完成校验（`current-build-inputs-check.log`）；不把旧部署工具当作已经修复，也不据此宣称旧发布流水线可直接部署。

## Gas 实测与口径

同一编译器 Solidity 0.8.26、优化 200 runs、同名确定性测试场景前后对比。下表为 **Foundry 测试函数 Gas（包含断言等测试开销），不是单笔生产交易 Gas**。修改了测试业务/断言的用例在 `gas-comparison.json` 标为不可直接对比，不将其纳入收益结论。

| 未改变业务动作的 Claim 测试场景 | 优化前 | 优化后 | 差值 |
| --- | ---: | ---: | ---: |
| 原币领取及另一用户权益隔离 | 381,681 | 370,367 | -11,314（2.96%） |
| 部分兑换、保留剩余 Meme | 238,894 | 232,616 | -6,278（2.63%） |
| 兑换失败、支付已有 Quote | 218,778 | 212,473 | -6,305（2.88%） |
| 兑换失败、授权领取原币 | 255,285 | 244,695 | -10,590（4.15%） |

现有 Holder 六批过期转账测试的 `gasleft()` 测量区间从 258,869 降至 257,754，减少 1,115（约 0.43%）。该区间包括 `_send` 测试辅助调用；批次清理的存储成本占比很大，不能据此承诺普通买卖同样降幅。

更稳定的验收是实际调用次数：Staker 的 Gauge 消费从 2 次变为 1 次；一般非排除双方 Holder 转账的余额读取从 4 次变为 2 次，自转账从 2 次变为 1 次；兑换 Claim 的完整市场读取从 3 次变为 1 次；Curve 入账保持两次跨转账边界验证、移除第三次重复查询。
