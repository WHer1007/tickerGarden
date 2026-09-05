# 创作者与质押者收益内部兑换

更新：2026-09-05。开发版本实现；未部署、未广播交易。

## 产品行为

收益以市场自身的 Quote 作为默认领取资产。已经以 Quote 收到的手续费直接进入已结算余额；毕业池收到的 Meme 收益先记入原受益人的待兑换余额，由独立执行者批量兑换为 Quote。用户不需要先领 Meme、授权 DEX、再手动卖出。

前端奖励页分别展示「Settled」与「Pending conversion」。已结算余额可以按原有领取条件领取；质押锁定仍然适用。这里的 settled 表示已兑换入账，不表示质押锁已到期。不同市场的 Quote 不强制兑换为同一种稳定币。

## 权益归属与合约路径

1. 手续费产生时沿用原有 Gauge 累计器与 creator epoch 账本。创作者附加税上限仍为 500 bps，100% 归原 creator epoch。启用 holder fee sharing 时，仅 creator base fee share 的固定 50%（不含 creator tax）进入持有人分配；creator 保留其余 50%。
2. `ProtocolFeeVault.settleRewards` 接收最多 32 项 `(user, creatorEpoch, maximumMeme)`。epoch 为 0 代表质押者，其他值代表对应历史创作者。只能提取已经归属该用户的 Meme 收益，不使用兑换时的新质押权重。
3. Gauge 先结算该用户原有累计器，再扣减待兑换余额。锁定收益可以兑换，但不能提前领取。正常退出保留收益，rage quit 继续执行原有罚没规则。
4. FeeVault 临时授权该市场 Hook；Hook 经真实 PoolManager unlock/swap 路径，在自身已激活的 canonical pool 内将 Meme 卖为 Quote。Hook 作为调用者，v4 跳过该 Hook 自身回调，因此不会对内部兑换递归征收平台费或 Creator tax。核心池的 protocolFee/lpFee 必须为零，否则拒绝兑换。
5. 按本批实际消耗与实际收到的 Quote 分配，逐项累计舍入确保总额守恒。部分成交时剩余 Meme 退回原用户/原 creator epoch；不会把收益分给后来加入的质押者。若某项消耗 Meme 但舍入后 Quote 为零，整批回滚，执行者需调整批量或合并积累。
6. FeeVault 校验前后余额差、清除授权，将 Quote 直接记入对应用户或历史创作者的负债。兑换不会成为一笔新的手续费分成，并保留原 creator epoch。Holder period 从市场创建开始按 30 天计算；Quote 在 FeeVault credit 时归属当期，包含 curve sweep 入账时点。

兑换是独立交易，不嵌入用户交易、退出或已结算收益领取。兑换失败会原子回滚；无法兑换的 Meme 不应显示成已结算 Quote。请求 Root 前，待兑换 Meme 与待结算 Quote 必须清空；不能把未完成的内部兑换纳入可领取快照。国库与持有人 Merkle 奖励继续使用既有机制。

## 执行权限与价格约束

`settlementOperator` 初始为固定平台国库地址，仅该固定地址可以更换执行者。执行者能选择处理批次与时机，但不能修改受益人、资产、池子或提款地址。此角色具有价格执行与公平调度的信任责任；并非无权限自动卖出。

链上要求正数 `minimumQuote`，deadline 不早于当前时间、不超过当前时间加 5 分钟。Hook 将单次 sqrtPrice 变化限制约 100 bps（约 2% 的现货价格变化，不能宣称为 1% 成交滑点）。这只是相对执行时池价的边界，不能独立防止被操纵的池价或夹击。执行者必须使用独立价格参考、限额和预模拟来设定最小到账；源价格异常或流动性不足时暂停并重新报价。

maintenance-runner 提供独立的 `reward-settlement` 规划器、执行器和 CLI：默认只输出计划；显式执行时加载部署环境注入的 transport。报价绑定 chain、market、用户顺序、epoch 与金额的摘要，最多接受 30 秒前报价；默认滑点参数范围 0–100 bps。一个报价只对应一批，不把总报价误用于多个拆分批次。无收益不需要报价。

该包不内置真实签名器或报价源。部署运维仍需接入独立报价、链上用户状态读取、运营 signer、持久化提交记录与调度。`referenceId` 是来源记录，不是价格正确性的证明。transport 必须在广播前持久化占用幂等键，模糊广播结果只能查询，不能盲目重发。CLI 的 submitted 只说明提交，不代表已确认成功。调度应轮转市场和受益人，避免大户独占批次；每批按最新未结算额度重新报价。

## 原币领取兜底

用户可以为自己在某市场申请原币领取，等待 7 天后生效。该开关按市场和地址生效，同时覆盖该地址的创作者与质押者收益。等待期间仍允许正常自动兑换；届时剩余 Meme 才可原币领取。生效后该用户不再参与自动兑换；取消后恢复自动兑换。不存在面向全体持有人的 collective raw fallback。

7 天从申请时算起，并不是每笔奖励生成后的固定期限。申请不会解除质押锁、不允许领取其他人的收益，也不影响 Quote 领取。创作者仍按历史 epoch 固定收款地址支付；代领只能支付给记录的受益人。申请/取消由受益人本人操作。此兜底不会更改既有 principal 退出规则。

## 验证与发布边界

新增真实 PoolManager 测试覆盖 Meme 两种币种排序、原生 Quote、部分成交退款、最低到账回滚及未授权回调；账本测试覆盖历史创作者、用户独立权益、锁定与退出语义、原币等待期、余额校验及权限。

接口、Gauge 实现 runtime hash、Factory pin、前端 ABI、索引事件和产品制品需一起更新。开发阶段采用协同新部署，不提供旧部署混用新 ABI 的兼容路径。最终回归结果见本次交付记录；本文件不构成主网部署或线上执行证据。

### 本次验证记录

- 普通合约全回归（不含 live Fork）：770 通过。随后补充总负债不足时禁止优先兑换测试；最终兑换两套专项共 14 通过（包括该新增测试）。
- Spec 62、Web 48、Backend 21、Indexer 31、Deployments 53、Maintenance runner 18、CI gate 单元测试 17 全部通过。
- 前端生产构建及各服务 TypeScript 构建通过；桌面/手机奖励页、断开钱包时的写入限制与图片加载已做浏览器检查。QA 阻断 Google Fonts CDN，使用回退字体。
- 接口、产品制品、fixture 和编译接口清单校验通过。
- `check:tracks` 的产品轨道 308 通过；live Fork 轨道因未配置 `ROBINHOOD_RPC_URL` 停止，不能报告通过。新版奖励路径的 live Fork 和运营 transport 尚未完成环境接入。
- 当前 readiness 为 `DEPLOYMENT_ELIGIBLE`。本轮重新执行验证后关闭七个部署门槛，独立新证据为 `deployments/evidence/v1-deployment-gates-current.json`；原部署证据仍标记 `STALE`，保留原 hash 和历史结果。尚未广播，生产门槛仍开放。
