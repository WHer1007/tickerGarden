# 用户选择兑换或原币领取

状态：源码与本地验证完成，未部署、未广播，未进行链上 RPC 检查。现有不可升级部署不改变行为。

## 完成内容

- Creator、Staker、Holder 通过 claimUserRewards 选择兑换或两种原资产直接领取，原币兜底默认不授权。
- 按用户最后确认，不恢复最低到账保护：minimumQuote=0；保留最长 5 分钟有效期，前端使用 4 分钟。池子模拟只表示预计到账。
- Hook 兑换放入仅 FeeVault 自身可进入的子调用，余额校验或兑换失败会回滚子调用；已有 Quote 仍可在外层领取。
- 部分成交按真实 spent/received 支付，剩余 Meme 按授权发放或恢复本人权益。回执及前端区分部分成交、失败保留和原币付款。
- Creator 使用历史 creator epoch 固定归属；Staker 继续执行 Gauge 本金锁和 rage-quit 门槛；新增领取不需要额外原币 7 天等待。
- Holder V4 使用 Quote/Meme 独立累计器、释放队列和个人余额，权重均来自相同有效持仓。新进入者不继承已释放权益，卖出者保留过去收益。退款恢复本人已赚取余额，不重新分配或重新释放。
- 后台跳过新版 operator 兑换，只按配置归集和注入。两个资产均检查独立待启动队列，避免只有 Meme 待释放时无人推进。
- 新增 HolderAssetFunded 按真实注入扣减 FeeVault 两种资产负债。历史统计用 UserRewardsClaimed 的实际发放量，排除同交易内分配器的中间提取，不能把保留 Meme 计作已领取。
- 前端含选择弹框、余额/预计输出、明确兜底授权、重复提交锁定及加载状态；确认后只刷新相关数据。

## 验证

- 非 Fork 合约全量：974 通过、0 失败。最后补充 Meme 队列开始时间只读接口后，Holder 专项 45 通过。
- 真实本地 PoolManager、FeeVault、Holder distributor、Meme token 联合验证：本人 Meme 领取时兑换及释放后立即原币领取均通过。
- 专项覆盖：原币立即领取、其他用户资产隔离、失败保留/授权兜底、部分兑换、错误到账回滚、授权清理、Staker 锁及同人退款、Holder 买卖前后权益归属。
- 前端全套 307 通过；新增及持续奖励专项 9 通过，最终类型检查和生产构建通过。
- Go 后端全量通过。额外使用本机 PostgreSQL 创建并自动清理隔离数据库，实际执行双资产领取历史测试，验证保留资产不计为已领取。
- Worker 测试 13 通过；Spec 63 通过；部署工具测试 62 通过；产品 ABI/制品、后端契约、fixture 与权限接口生成检查通过。
- FeeVault runtime 为 24,302 bytes，Holder distributor 为 15,243 bytes，均低于 EIP-170 的 24,576 bytes 上限。FeeVault 余量较小，后续新增功能仍需检查体积。

## 发布边界

FeeVault 模式为 TICKERGARDEN_USER_CLAIM_V1，Holder 模式为 TICKERGARDEN_HOLDER_DUAL_ASSET_24H_V4。新模式须使用新部署、匹配的 Factory/Hook/Gauge pins 与发行目录，并取得独立前端 release approval；未擅自填写该批准或调整测试/master 参数。

旧单资产 Holder 历史重放内核不能用作 V4 的领取授权。V4 当前余额与资产覆盖直接读取链上双资产状态，展示历史使用实际付款事件。本次不包含旧市场迁移或新部署后的钱包签名 E2E，因此不宣称线上已启用或已达到广播门槛。
