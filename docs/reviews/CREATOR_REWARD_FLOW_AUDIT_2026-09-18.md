# Creator 奖励全链路审查

日期：2026-09-18。工作树：TickerGarden-alignment，codex/holder-flow-hardening，基线 be485c3f43ebdeb2abe14fecb881cf09b5a56e69，含本地未提交 Holder 修复。

本次为源码及本地测试审查，只新增本报告，未修改产品代码、迁移数据库或部署。未检查生产进程和真实钱包交易；源码缺口不能据此直接断言生产资金丢失。本报告不替代独立外部审计。

## 结论

当前核心合约的分账、历史受益人隔离、领取权限、双资产领取及失败回滚在所查代码和测试中没有发现新的资金安全漏洞。但 Creator 领取链路尚未与 Stake/Holder 新数据机制对齐，存在费用归集缺口、展示和领取依赖全局状态、目录延迟及异步错误处理问题。收益交接属于合约已支持、产品入口未接通的能力，不能算作已上线完整功能。

## 链路与已验证行为

1. 创建：Factory 初始化 Creator epoch 1，初始受益人与注册市场一致。
2. Growing：买卖手续费先累积在 Curve；permissionless sweepCurveFees 将费用转入 FeeVault，并写入当时的 Creator epoch。普通买卖并非每笔自动 sweep；Bloom 和接受收益交接会归集此前 Curve 费用。
3. Bloomed：V4 费用通过受约束的 begin/finalize credit 入账。基础费按有有效质押时 Creator 40%、Staker 30%、Platform 30%；无有效质押或 Curve 时 Creator 70%、Platform 30%。整数余数归 Creator。
4. Creator tax 全部计入 Creator；启用 Holder 分享时仅 Creator 基础费份额的一半转 Holder，Creator tax 不参与该次分拆。LP fee 不应与 Creator 的基础费分账混为同一指标。
5. FeeVault 按 marketId、creatorEpoch、asset 分离负债。收益交接需提名、接收两步；接受前先把旧 Curve 收益归入旧 epoch，旧余额不随交接迁移。
6. 领取：当前原资产模式校验 msg.sender 是该 epoch 的受益人；支持 Quote、Meme 或两者。burn 模式领取同时结算 Meme 销毁，不能将其当作发给用户的收入。重入、重复消费、资产守恒及转账失败回滚有测试覆盖。
7. 后端：Creator 市场目录来自事件投影和数据库；但 epoch、可领取余额及交接状态仍由浏览器读 RPC。

## C1 高：Growing 的费用归集与普通领取链路没有闭环

证据：`contracts/src/v1/modules/TickerGardenCurve.sol:203` 的 sweep 是独立调用；`contracts/src/v1/shared/ProtocolFeeVaultUserClaims.sol:72` 领取仅消费 Vault 负债；`apps/web/src/app.ts:3321` 读取 creatorLiability，`:3831` 根据该余额决定领取按钮。浏览器无 sweepCurveFees 调用；当前 TypeScript Worker 中未找到该执行任务。

触发：Growing 已有交易、Curve 有 accruedCurveFees，但尚未 Bloom、交接或外部 sweep。页面可能显示零可领并禁用领取，已有交易收益仍停留在 Curve。不是费用丢失，亦不应把未归集金额伪装成 Vault 可领余额。

仓库确有 `tools/holder-rewards/worker.mjs:90-97` 旧工具，但它先要求 ASSET_SELECTION claim mode，当前合约返回 RAW_ASSETS；不能用该文件的存在证明当前生产归集已运行。本次未验证远程额外任务。

建议：补当前版本的有预算、资产最小阈值、幂等回执及失败恢复的归集任务；数据库区分待归集与可领取。测试覆盖 ETH/ERC20、税费、Holder 分享、低额费用、多市场失败隔离和交接竞争。不要通过恢复旧转换领取接口解决。

## C2 高：Creator 展示及领取仍被全局状态和分析接口耦合

证据：`apps/web/src/app.ts:3046` getRewardMarketDetail 对非 Stake 页面请求指定全局 revision 的市场详情并校验；`:3338` Creator 每次刷新先等待它，再开始余额读取。`:4047` 仅 role=1 获取独立最新领取区块，Creator 仍用 foundation.sync；`:701` 在 Claim 页面执行前还请求全局 health；`:890` 统一执行入口要求 foundation.writeReady。

影响：即使市场合约和 Creator 余额正常，分析接口、全局健康状态或目录 revision 异常仍可使展示和领取不可用。普通 Creator 展示首次还会逐项查询最多 20 个 epoch，另加余额、受益人及市场校验读取。

建议：Creator 建独立数据库读模型，页面读取已持久化数据；事件只使相关钱包/市场/epoch 失效。签名前按具体市场、资产和受益人校验当前链上状态及规范区块，不以统计健康状态作为资产领取前提。保留钱包身份、合约绑定、回执、资产与重组校验。

## C3 中：Creator 目录有 10 分钟缓存，并存在整页详情请求阻塞

证据：`apps/web/src/app.ts:2798` 同钱包目录在 600000ms 内直接返回；`:2822-2832` 对未在 foundation 的条目逐个 getMarket，任意条目失败会使整批失败。每页 50 条，最大 4 并发。

影响：同一页面生命周期内的新创建或新接受市场可能迟迟不出现；一个详情失败可能阻碍其他正常市场出现在选择列表。不是合约 10 分钟确认要求。

建议：目录返回可直接展示的必要字段；创建、交接确认及相关事件后定向更新目录；单条数据异常隔离。不要依靠提高全量轮询频率，也不要新增用户页面组件。

## C4 中：分页失败重试后旧错误残留，旧请求可污染新选择

证据：`apps/web/src/app.ts:2834-2838` more=true 成功未清空 creatorDirectoryError；`:3791` 仍可把旧错误写回状态。`:2547` View earlier periods 的 catch/finally 未校验钱包、市场及请求世代，虽然底层 loadCreatorEpochs 有部分保护，外层错误仍可能覆盖切换后的状态。

建议：成功清空所属请求的错误；错误、finally 和成功更新统一校验捕获的钱包、市场、页面及 generation。测试加入分页失败→重试成功、切换钱包/市场时旧请求失败及卸载页面场景。

## C5 中：Creator 读模型与查询索引不完整，扩容后查询成本上升

证据：`services/backend-ts/packages/read-store/src/index.ts:246` 从 aggregate_records 的 JSON creator 字段过滤；现有 migrations 没有针对该表达式的 Creator 目录索引（markets_creator 是另一张表，不能代替）。`history-projector/src/index.ts:116` 奖励历史归一化覆盖 Staker/Holder，未提供 Creator 专属领取/epoch 历史闭环。

建议：新增按 deployment、beneficiary、market、epoch、asset 查询的结构化表和索引，累计入账、已领取、销毁、剩余余额分开；处理 credit、claim、handoff 及重组撤销，后台对账。数据库持久化展示不能替代合约实际领取权限。先做查询计划和 20,000+ 市场多轮受益人的容量验收。

## C6 中，潜在功能缺口：收益交接未形成可用页面闭环

证据：`apps/web/src/pages/rewards.ts` 无提名、接受或取消交接按钮；app.ts 却保留相应控制代码。后端 `history-projector/src/index.ts:104` 仅记录初始化和已接受的受益人，忽略 Proposed/Cancelled；`app.ts:3347` 没有已归属 epoch 时提前返回，pending beneficiary 的读取在其后。

因此，一个从未获得过该市场收益的新接收钱包，即使合约上已被提名，也不能依赖当前页面完成发现与接受。不能把这个描述成当前普通领取按钮的已复现故障。

建议：如运营需要交接，先确认是否开放产品入口，再增加 pending 的独立读模型和权限判断，接受步骤不能要求已有历史收益；否则明确该能力暂不开放，整理未使用控制代码。未经用户确认不要新增页面元素。合约交接权限本身在现有测试中正确。

## C7 低：规范文件仍描述旧单步交接和 permissionless 领取

证据：`docs/v1/V1_CREATOR_REVENUE_EPOCH.md:27` 描述 transfer 后直接更换 epoch；`:51-55` 写 claimCreator 及任意人触发。实际是 proposal/accept，当前 raw claim 要求受益人本人调用，旧领取入口测试明确拒绝。

建议：更新内部规范、运维说明和验收矩阵；区分当前与历史版本，避免错误脚本或错误测试继续沿用。未据此认定公开页面已经展示这些旧说明。

## 验证结果

- Foundry v1 分账/Registry/Vault/Curve/V4：82 项通过。
- Foundry v1 UserRewardClaims、SelectedRewardClaims、ClaimAvailabilityAudit、FeeClaimSafetyBoundary、MemeFeeBurn：62 项通过。两个集合合计 144 次测试执行（部分套件继承基础用例，不等于 144 个独立业务场景）。
- 前端 Creator directory、ownership、claim dialog 和兼容 reward：19 项通过。
- Node 24 + 本地 PostgreSQL 独立临时 schema，history-projector 集成：2 项通过、0 跳过，覆盖 burn/non-burn、目录查询及重组恢复。
- 现有测试通过不代表 C1-C7 已修复。尚缺 Creator 提名/取消/接受投影、交接事件重组、未归集 Curve 普通领取、目录事件刷新及上述 UI 异步竞态的专门验收。

建议实施顺序：C1 归集闭环 → C2 独立读模型和交易校验 → C3/C4 目录与异步状态 → C5 容量与历史 → C7 文档。C6 先确定是否开放交接产品功能，不擅自添加页面入口。
