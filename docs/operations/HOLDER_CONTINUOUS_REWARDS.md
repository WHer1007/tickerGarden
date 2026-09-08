# 持有人 24 小时连续收益操作说明

状态：已实现源码与前端领取路径；尚未广播，尚未完成测试网验证。操作人员不得据此宣称生产已完成。

## 规则

新连续收益市场由 `HolderRewardsDistributorV1` 管理。每次 `fundCreatorFees(id, 1, amount)` 将已核验到账的 Quote 独立放入一条 24 小时 stream。bucket `1` 是永久兼容性编号，不是 epoch，也不是时间周期。每条 stream 有独立 deadline，追加 funding 不会延长已有 stream。

创建者基础手续费在扣除 Creator tax 后，固定 50% 进入持有人收益；Creator tax 仍归创建者。其他平台、质押者和创建者账本不因连续模式改变。

最多同时保留 64 条 stream。达到容量时，FeeVault 的 funding 调用会回退；资金不会被静默吞掉，后续应重新触发 funding。容量回退不阻塞 Token 转账，也不阻塞已有收益的 checkpoint 或 claim。

## 持有人行为

用户可随时调用分配器 `claim(marketId)` 领取已累计的 Quote，不需要等待 24 小时。`claimable` 是只读估算入口。用户卖出或转出 Token 后，转出前已经累计的收益仍留在该账户，不会随 Token 转给买家。

Curve、PoolManager、Locker、分配器、vault、graduated hook 等协议地址在注册时排除，不作为普通持有人参与有效供应。有效供应为零时，释放资金进入 `idle`；恢复有效供应且 stream 尚未达到 64 条时，idle 会重新开启一条新的 24 小时 stream，不会追溯奖励首个买家。

## 部署与识别

连续模式必须使用新 release 的 `V1DeterministicDeploymentBuilder.buildContinuous`。该路径只替换 Treasury distributor init code 为 `HolderRewardsDistributorV1`，并通过 Token 一次性启用连续检查点。既有部署使用旧 builder 和旧 distributor，行为不变；不能通过前端或 ABI 更新把旧 Token 改成连续模式。

## 当前限制与值班检查

本实现尚未广播，也没有测试网验证记录。广播前必须完成部署产物、地址/代码哈希、链 ID、权限和 funding/claim/转账边界验证。若 funding 因 `StreamCapacity` 回退，应保留待处理 liability 并在容量释放后重试；不要重复扣账或手工转账绕过 FeeVault。

相关源码：`contracts/src/v1/modules/HolderRewardsDistributorV1.sol`、`contracts/src/v1/modules/TickerMemeTokenV1.sol`、`contracts/script/v1/V1DeterministicDeploymentBuilder.sol`。

## 发布开关与发布前边界

新模式使用独立脚本 `contracts/script/v1/DeployV1ContinuousHolders.s.sol`；旧 `DeployV1Deterministic` 不会因环境变量误切换。两者继承同一 release certificate、链 ID、依赖代码哈希和 payload 校验。新模式需要生成新的发布证据，不能复用 R5 证书。

前端只有在新 release 部署、链上 E2E 批准后才设置 `VITE_CONTINUOUS_HOLDER_RELEASE_APPROVAL=HOLDER_STREAM_24H_V1:DEPLOYED_E2E_APPROVED`。旧 `VITE_V1_TREASURY_RELEASE_APPROVAL` 只开放旧 Merkle 模式，不开放连续模式。前端以链上 `rewardMode()` 识别模式，以链上读取计算可领余额；每 30 秒刷新一次。

目前旧 release manifest/preflight 的 Treasury 项仍校验旧分配器的 `authority()`。新分配器没有管理员提款或改收益参数能力，不能伪造此 getter 来套用旧证据。新 release 的模式专用 manifest、实时 Fork、链上转账/毕业/兑换/领取及浏览器签名联调，必须在广播前另行完成；本次不会改写历史部署记录。

持续释放仍使用 `block.timestamp`。链时间停滞会延迟新增收益，已累计收益在链可处理交易时可领取。24 小时是链上时间，不保证墙钟时间。该规则不等于永久累积持仓年龄：每段释放按该段有效持仓比例分配。

建议归集服务每市场每小时执行一次；超过 64 条未到期资金流时，等待早期 stream 到期后重试，24 小时并发上限应纳入监控。不要通过持续提交微额注入占满容量。
