# 原币奖励领取与链下交易服务审查（2026-09-13）

状态：本次改造已实施；生产仍为 **NOT_PRODUCTION_READY / NOT_BROADCAST**。此报告取代上一轮外部性审查中 E1（Registry 交易服务）和 E2（奖励兑换）尚未实施的建议，不修改旧部署及旧验证证据。

## 最终边界

| 环节 | 当前候选行为 |
| --- | --- |
| MarketRegistry | 只保存和返回市场、PoolKey、PoolId、Hook、Curve、Gauge、Locker 和生命周期；删除 SwapRouter/Quoter 字段、getter、构造参数及其部署环境变量 |
| 首买 | 用户准备好 Quote，合约按金额执行创建及首买；保持上一轮 wallet-quote-only 方案 |
| 奖励领取 | Creator / Staker / Holder 只领取已归属的 Quote、Meme 或两者，直接支付调用者；无兑换目标、calldata、滑点或 deadline 参数 |
| 外部交易 | 通过 `services/backend-ts/packages/chain/src/external-trading.ts` 配置服务与适配器；前端不会把 API 中任意 router/quoter 地址当作钱包目标 |
| 领取后兑换 | 用户另行使用钱包交易；独立授权、报价、最小到账和有效期由交易流程处理；兑换失败不回滚已完成领取，也不会把奖励留在中间转换合约 |
| 协议 V4 结算 | 保留 PoolManager、PositionManager、毕业建池、LP 锁仓和 Hook 手续费记账，它们是协议实际业务依赖 |

更换外部交易服务需要审查其 calldata 适配器并发布客户端/后端配置，不需要重部署核心合约。手续费领取完全不依赖交易服务是否配置或可用。

## 领取接口与移除项

- `claimUserRewards(bytes32 id,uint8 role,uint32 epoch)` 返回 `(quotePaid,memePaid)`。
- `claimUserRewardAssets(bytes32 id,uint8 role,uint32 epoch,uint8 assets)` 返回 `(quotePaid,memePaid)`，assets 为 1/2/3。
- `userClaimMode()` 为 `keccak256("TICKERGARDEN_USER_CLAIM_RAW_ASSETS_V1")`。
- `UserRewardsClaimed` 只报告市场、用户、角色、epoch、Quote 实付及 Meme 实付。
- 删除 FeeVault `convertUserClaim`、Hook `convertRewards` 和兑换专用 `unlockCallback`；删除 Gauge / Holder 的兑换失败恢复入口及 RewardConverted / HolderMemeRestored 事件。
- 删除两层转换实现。协议权限表由 86 变为 82 个 selector，治理 selector 仍为 19 个，immutable direct 为 63 个。Holder 扩展 ABI 同步移除 restore。

## 安全复查

1. **不能领取其他用户权益。** 接收者固定为 `msg.sender`；Creator 仍核验指定历史 epoch 的受益人，Staker 仍由 Gauge 检查授权、锁定及退出状态，Holder 消费同一用户的已释放权益。
2. **保持资产隔离与原子性。** 未选资产不扣账、不付款，也不执行该资产的独立余额检查。选中资产在付款前、付款后均检查偿付；第二种资产付款导致第一种资产余额扣减时整笔回滚。Holder 返回 FeeVault 的资产仍按精确余额增量校验。
3. **保留重入保护与 native 来源约束。** 领取的 operation guard 覆盖消费和支付；仅在领取上下文接受固定 Holder distributor 的 native 回款。转换 Hook 的 native 回款豁免已删除。
4. **移除兑换授权与恢复风险。** 领取不再 approve 外部 Hook，不进入 Swap/Quoter 子调用，也不需要依赖预留 Gas 来恢复权益。原先专门测试转换、部分成交、deadline/fallback 的用例随功能退休；保留偿付、重入、隔离、锁定、不变量测试，并补充旧入口不可调用及失败 Hook 不影响原币领取的回归。
5. **交易配置不能改写核心池身份。** 前端选择审查过的链下交易配置，仍核验 Registry 的 PoolKey/PoolId 与市场绑定；交易时 Router/Quoter 的 PoolManager 必须与 FeeVault 的 PoolManager 一致。未知网络没有默认可执行服务。
6. **原有生产参数没有改变。** Treasury/治理/Guardian/Unpause 分配、3 ETH / 1.2 ETH、USDG 7000 / 2800、Stock Quote 参考表和最低总 Stake 0.5 均沿用批准配置。此次不执行资产激活或权限交接。

## 前后端与历史兼容

旧测试部署不可变，客户端通过 claim mode 显式识别：旧 ABI 只发送 `false,false,0` 原币领取，新候选使用精简 ABI。界面不再显示转换或 fallback 选项；不能把旧测试部署描述成已经换用新合约。

同一 canonicalRoute 原始结果支持严格区分旧 18-word 和新 16-word 编码，旧服务字段被丢弃，只留下协议字段。后端 projector 不再调用 Registry 的 SwapRouter/Quoter getter，API 兼容字段来源改为链下配置。展示仍从数据库投影读取，本次没有引入前端统计 RPC 或同步 HTTP 链上刷新。

Go 后端是 `services/README.md` 明确冻结的历史参考，不是当前 runtime；其历史市场路由 fixture 保留。无调用方的旧奖励兑换 observer 已退休。旧 ABI 和历史证据保留用于正确识别已部署版本，不能复用于生产新版本。

## 验证及证据

证据目录：[`evidence/raw-claims-offchain-services-2026-09-13/`](evidence/raw-claims-offchain-services-2026-09-13/)。首次主网 Fork / staged 模拟受公共 RPC HTTP 502 账户读取超时影响，保留 `*-first-rpc-timeout.log`；不得把该失败当作成功或掩盖。

- 完整本地合约：963 通过，0 失败，0 跳过；随后旧入口精确 selector 和长期持有测试调整的 10 项定向回归通过。
- 工作区 Web：366 通过；后端单元：51 通过；部署工具：66 通过；规范/当前合约边界：66 通过。
- 隔离的 staged tree：前端/后端类型与构建通过，后端单元 46 通过；前端 328 项中 326 通过，2 项为未改动的旧资产目录测试（196 与旧预期 56 不符、CIEN 图标未进入 Git）。工作区已有相关资产修复，未混入本次协议提交，因此不声称本次提交的全量前端测试全绿。
- 前后端 TypeScript、ABI/OpenAPI/Bootstrap 生成契约检查通过；冻结 Go deployment 包测试通过。
- 实际 Safe / 部署者地址分阶段模拟通过，最大单步执行 Gas 13,252,642。该数值不含 intrinsic calldata Gas，不是最终签名交易 gasLimit。
- 真实主网业务 Fork：2 通过，区块 61361538 / `0xb934dc407b452ecba77ea28f4187f223a3de508d7211f74ec62a983c26ca92ce`；实际地址 staged 模拟与 Fork 均使用本次代码，未复用上一轮结果。
- CI 工具独立单测：24 通过；只包含本次改造的 staged tree 前端类型检查和后端构建通过。
- 通用 `npm run test:ci-gates`：工具单测和 product track 318 项通过，随后旧通用 fork track 因未配置 `ROBINHOOD_RPC_URL` 停止，因此不报告整个通用 gate 通过。本次另行运行并通过显式新区块主网 candidate Fork；旧默认历史 Fork 的可用性未宣称已解决。
- 通用 deployment track 的单测通过，但 `check:testnet-plan-live` 因历史测试部署计划仍含旧构造输入、超出新 schema 的 21 项上限而拒绝；历史计划保留为旧证据，不伪装为当前可执行计划。本次主网计划已另行重新生成并通过实际地址模拟。

## 发布限制

本次没有签名、广播、部署、Safe 交易、资产注册或权限交接。生产仍需独立安全审计、逐交易 calldata/gas 审查、196 Quote / 194 Stake 激活计划、对应新地址与 ABI 的生产 release catalog、未签名交易包及 Safe 执行演练。业务 Fork 使用隔离的测试配置验证链上机制，不等于 196 种实际资产已完成逐项生产激活验收。

## 编译体积变化

| 合约 | 上一候选 bytes | 当前 bytes |
| --- | ---: | ---: |
| MarketRegistryV1 | 8854 | 8610 |
| MemeStockGauge | 13220 | 12997 |
| ProtocolFeeVault | 22850 | 19885 |
| TickerGardenMemeHook | 13737 | 8632 |
| TickerGardenFactoryV1 | 23880 | 23880 |
