# 当前合约业务清理复审（2026-09-11）

本报告检查当前工作树的 `contracts/src/v1`、部署脚本及其 ABI/权限模型，不代表测试链上已部署的新版本。之前的 2026-09-10 审计是清理前的记录；其中保留兼容适配器的建议已被用户“当前源码只保留最新业务”的决定取代。

## 版本边界

旧合约源代码已保存到 Git 分支 `codex/legacy-contracts-20260910`，提交 `0f1eda025f67134151a20e4f7f703affef1dc2b8`。当前源码不设置 legacy 合约目录或兼容适配器。已有链上合约不可被本地修改替换；已有 release 记录保留为历史部署证据。

## 本次清理

| 发现 | 处理 |
| --- | --- |
| 旧 Treasury/Merkle 分发、销毁路径进入当前源树 | 删除 TreasuryDistributorV1、TreasuryClaimLeafV1 和相关旧部署分支。删除 token 的 burnTreasury。 |
| FeeVault 继承操作员兑换、原币退出申请、7 天等待 | 删除旧继承层、状态、接口和事件，仅保留用户领取时兑换。 |
| Creator/Staker/Holder 旧领取入口与统一 Claim 并存 | 删除 claimCreator、claimStaker、claimStakerFor 和 Holder 的直接 claim。保留 claimUserRewards 和独立的平台收益领取。 |
| Gauge 残留预先消耗收益/记入兑换结果的接口 | 删除 consumeForConversion、creditConversion，仅允许 FeeVault 将本次未兑换 Meme 归还原用户。 |
| Hook 仍带最低输出参数 | 删除该参数，遵循用户不预设价格保护的决定。保留有效期、来源权限、精确资产流入流出验证。 |
| rageQuit 的 redistributed、forfeitureRedistributable 永远为 false | 删除返回槽及对应事件字段，保留本金先退出、收益异步清理和平台罚没储备。 |
| Treasury 名称被用于当前 Holder 地址 | Factory/Token 改为 holderRewardsDistributor；Holder 桶查询/Quote 注资接口改为 rewardBucket/fundQuoteRewards。 |
| 部署配置仍要求旧 root 发布/审核/领取窗口 | 当前部署构造参数与计划删除这些字段，构建器只构造当前 Holder 模块。 |
| 生成接口可能重新引入旧业务 | 新增源码和编译 ABI 双重回归检查。旧 selector 调用测试用于确认其失败，不是兼容实现。 |

## 必须保留的当前业务

- `platformTreasury` 是平台费用接收地址，不是旧 Holder Treasury 分发合约。
- Creator beneficiary epoch 用于创作者收益转让后的归属隔离，不是七天奖励周期。
- Holder 的 Quote/Meme 独立记账，按当前持有权重释放 24 小时；批次间隔默认 4 小时，可由治理配置为 1–24 小时。
- `enableContinuousRewards` 在市场注册后启用 token 转账前的 Holder 检查点，避免新买入者获得过去收益。
- 质押锁、收益释放、退出清算标记、资产偿付能力与到账证明继续保留。

## 验证与发布状态

已完成的本地检查：

- 非 Fork、非不变量合约回归：866 项通过，0 失败。
- Holder 批次释放不变量、Vault/Gauge 本金和权重不变量通过；修正恶意资产测试的调用者模拟后，恶意多资产不变量复验通过（256 轮、128,000 次随机调用）。
- 规范测试：63 项通过。
- 当前源码/编译 ABI/Factory 实现哈希回归：3 项通过，已接入产品产物检查。
- 部署工具测试：62 项通过；TypeScript 编译通过。测试使用独立的当前版本夹具，历史计划明确拒绝作为当前发布计划。
- 环境配置测试：10 项通过；实际 test 配置检查通过（毕业金额 0.42 ETH、Holder 释放 24 小时、默认批次间隔 4 小时）。
- 前端生产构建通过。
- 当前 Fork 入口编译通过，保留两个真实链测试入口；本轮未执行真实 Fork。
- 生成产品产物校验通过：18 个核心模块，加当前 Holder 扩展。
- FeeVault 运行时代码：19,704 字节，比清理前已部署版本的 24,302 字节减少 4,598 字节；距 EIP-170 上限余 4,872 字节。字节码大小不是逐笔 Gas 节省量。

首轮失败已定位并修正：Factory 的固定实现哈希随 Token/Gauge 代码更新；测试中的旧部署模式比较改为当前确定性复现与错误参数拒绝；重复的 prank 和被参数 getter 提前消耗的 prank 已修正；独立 Holder 测试 harness 保持与生产领取入口一致的防重入边界。

完整 CI 发布流程、实际 Fork 和新的部署证明尚未完成。上述本地验证不能作为新 release 的部署资格证明。

本次尚未广播部署交易，也没有启动链上历史扫描。清理改变 ABI、字节码和确定性部署地址，需要新的 release；不能将旧测试链部署标记为已更新。

本地验证摘要及日志：`outputs/reviews/current-only-contracts-2026-09-11/summary.json`。
