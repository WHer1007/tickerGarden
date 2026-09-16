# 当前奖励业务：七处离链旧逻辑修复记录

日期：2026-09-11。范围：用户列出的前端领取、Holder worker、Go 奖励观察与模型、构建入口、旧激活脚本。基于 test 工作区；工作区包含此前未提交修改，本记录不把全部 git diff 归为本次修改。

状态：七处指定修改已落地；当前相关测试与构建通过。**全量 Go 回归未通过，不能认定全项目旧业务清理完成，不能作为部署放行。NOT_BROADCAST。**

## 修改对应表

| 项目 | 当前实现 | 主要文件 |
| --- | --- | --- |
| Creator 旧领取回退 | Creator、Staker、Holder 当前领取统一调用 claimUserRewards；模式读取失败或不匹配直接报错，不调用旧 claimCreator/claimStaker 或 Holder 直接 claim | apps/web/src/app.ts；features/creator.ts、vault.ts、continuousRewards.ts |
| 原币 7 天等待 | 移除 rawRewardExitAt 读取、申请/取消、等待与解锁文案和按钮分支；用户选择原币时直接进入统一领取。保留已归属金额、Creator epoch 归属、质押锁与退出待处理约束 | apps/web/src/app.ts |
| Holder 任务 | 只接受当前双资产模式与 userClaimMode；只进行 sweep、fund、fund-meme、checkpoint。只通过 holderRewardsDistributor 获取地址；不进行操作员兑换或 settleHolderRewards。已签名旧操作在重播前会被拒绝，要求先核对回执，避免自动发送旧交易 | tools/holder-rewards/worker.mjs、policy.mjs |
| Go 兑换观察器 | 删除旧 reward_conversion_state 观察器、settlement 包与执行程序；当前奖励读取只探测当前领取模式，不读取 settlementOperator/rawRewardExitAt。保留按资产负债的覆盖检查。另移除要求 RewardBatchConverted 的旧批次观察流程，当前事件继续经过现有事件认证、解码和归档 | internal/deployment、internal/projector、internal/rewards |
| Go 奖励数据模型 | 不再要求/输出原币退出时间和解锁标志；Creator 原币按可领取权益返回，Staker 仍受本金锁与退出状态约束。保留观察时间、区块一致性、资产及权益校验 | internal/rewards/positions.go；creator_candidate.go、creator_rpc.go |
| 构建入口 | root package scripts 不再构建旧 Treasury/Merkle root 生成任务；Go build 移除旧 settlement/treasury worker、lifecycle、jobs、review 程序，并清理其遗留二进制；CI Holder job 改为当前 HolderBatchedInvariant。旧 Treasury 证明 HTTP 路由及 API 启动装配一并移除 | package.json、services/backend-go/Makefile、.github/workflows/ci.yml、internal/httpapi/router.go、internal/app/api.go |
| 旧激活脚本 | 删除 activate-arbitrum-release.mjs、activate-arbitrum-continuous.mjs、configure-robinhood-testnet-settlement-operator.mjs，避免配置已不存在的操作员角色 | tools/ |

API 删除字段属于破坏性变更，OpenAPI 版本升为 3.0.0，已同步 Go 模型与前端生成客户端。当前事件目录由现行接口产物重新生成，共 69 个事件；同步 TypeScript 测试参考实现中三个删去 bool 参数的退出事件签名，更新 golden fixture。没有伪造旧事件目录或手工修改来源 hash。

## 验证

证据目录：outputs/reviews/current-rewards-cleanup-2026-09-11/。

- 前端：308 项测试通过；生产构建通过（现有 chunk 体积提示仍在）。
- Holder worker 与当前业务防回归：11 项通过，包含禁止旧模式/旧签名任务重播和旧源码入口检查。
- 部署工具：62 项测试及 TypeScript 构建通过。
- CI 工具单元测试：24 项通过。
- 后端生成文件/API 合约检查：通过，包含 29 项测试、OpenAPI/模型/事件来源与 projection golden 一致性检查。
- 后端 Go 构建：通过。
- 奖励观察器定向测试、rewards、httpapi、app、projector、candidate-inspect、events、projection、useractivity：通过。
- 全量 Go 测试：45 个包通过，4 个包失败，见下节。普通无需测试的命令包不计入 45。
- test:ci-gates 曾进入耗时的 Solidity product/invariant 路径后被中止；只认定独立完成的 CI 工具单元测试通过，**不认定完整 CI 或 Fork 通过**。

本轮没有广播交易、执行 Holder worker、部署合约或重启服务；未通过 RPC 重扫链上历史。不得将本次本地代码验证解释为测试链已升级。

## 扩大验证发现的剩余旧模块

以下范围仍在源码中；不属于表中原始七处的具体调用，但意味着更大范围的“全项目仅当前业务”尚未完成。没有为获得绿灯而恢复旧合约兼容，也没有删除这些模块的失败测试。

1. internal/deployment：旧 treasury-activate 维护操作、Treasury request/pending/claim epoch 观察逻辑；MarketIdentity 测试复用了带旧 Treasury 模块的夹具。
2. internal/feeledger：旧 Holder epoch 兑换/注资与 Treasury rollover 账本分支及其测试仍期待当前 ABI 已移除的事件。
3. internal/readmodel：旧 Holder Merkle claim、publication、request、service history 路径仍保留。
4. internal/treasury：旧根证明生成库与部分 candidate-inspect 审核依赖仍存在。公开证明 API 和任务可执行入口已删除，但整个库及其审核依赖尚未移除。

前端也仍有旧 Treasury/Merkle 辅助页面代码，不应把本次 Creator/raw-exit/统一领取调用修复表述成整个 app.ts 的旧业务已全部清空。

下一次完整清理需要按调用链移除这些旧历史模型与审核依赖，替换为当前双资产 Holder 权益验证，并保留资金覆盖、归属、回执、重组与本金隔离检查。完成后重新运行全量 Go/工程检查，才可作整体放行判断。
