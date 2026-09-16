# 前端业务文案审查 — 2026-09-12

范围：当前 `test` 分支，HEAD `b0f0541a15`，正式前端 `apps/web`。审查首页、Docs、Create、Explore、Trade、Stake、Claim、Stats、Terms、Privacy、Risks，以及 `app.ts` 的动态提示。web-v2/web-v3 和 archive 不属于本次正式前端范围。

交付为文案审查与替换建议，未修改产品代码。当前工作区原有未提交变更保持原样。事实以本次读取的前端执行路径和合约源码为依据，不将历史 README 的部署、交易可用性、收益规则直接当作当前事实，也不据此认定线上部署与本地源码一致。

## 结论

需要优化，而且首先要修正业务准确性。首页仍沿用“所有市场绑定 STOCK”的旧叙事；部分收益文案仍暗示必须等待后台兑换；Docs、Terms 和创建表单对 Holder 的规则并不一致。其次才是品牌表达、术语和句式风格。

建议保留 `Stake the ticker. Grow the culture.` 和花园品牌语言，让首屏解释实际能做什么，让 Docs 解释操作条件和结果，让操作页显示当前资产、余额及限制。无需重新设计视觉或更改协议经济规则。

## 1. 核对后的实际业务链路

1. **发现与创建**：用户浏览市场，或填写名称、ticker、图片并选择 paired asset 创建。Stock 质押与 Holder 分成是两个独立的创建选项。关闭质押时不绑定 Stock Asset UID。
2. **创建提交**：发布图片和详情需要钱包签署上传授权；元数据发布发生在链上创建之前。可选 Developer buy 是首买，部分资产可能需要额外的资产购买步骤。钱包签名、代币授权、链上交易确认不能统称一次“approve”。
3. **交易与 Bloom**：Growing 阶段用 paired asset 在曲线上买卖。最终买入完成曲线并原子创建池，成功后状态为 Bloomed；初始流动性永久锁定。Bloom 不是价格、收益或市场深度保证。
4. **Stock 质押**：只在已启用质押且 Bloomed 的市场开放；新增部分等 30 秒激活，已有 active stake 继续计奖。每次新增重置全仓 24 小时正常退出/领取锁。最低限制作用于加仓后的总仓位。正常退出为整仓，奖励另领。
5. **手续费与领取**：Creator、Staker、Holder 的权益不同。Holder 来自 Creator 基础费份额的一半，不是总基础费的 50%。当前领取支持选择 Quote、Meme 或两者，支持原币领取或 Meme 兑换，并可授权原币 fallback。兑换没有价格下限保护。
6. **持有人释放**：当前双资产分发分别释放 Quote/Meme，每批 24 小时；入批等待与释放时长不同。持有期间按 eligible balance 归属，卖出后已归属权益保留；不能据此宣称卖出后继续获得未来收益。旧市场另有分发模式。
7. **数据显示**：成交、费用记账、Holder funding/release、个人 claimable、统计缓存是不同阶段。统计金额不等于个人到账金额；缺失或过期数据保持 Unavailable。

关键依据：`app.ts:2945–3031, 2680–2703, 2141–2178, 2421–2422`；`shared/V1FactoryValidation.sol:109–124`；`libraries/MarketFeeAccounting.sol`；`shared/ProtocolFeeVaultLiabilities.sol:178–207`；`modules/HolderRewardsDistributorV1.sol`；`ui/reward-claim-dialog.ts`。合约路径均在 `contracts/src/v1` 下。

## 2. 应优先修正的业务文案

### F01 · 首页把可选 Stock 绑定写成必经步骤 — 高优先级

- 原文：`From an eligible Stock Token...`、`Bind a fixed-supply market to one official Stock Token.`、`After blooming, matching STOCK can share actual market fees.`
- 位置：`apps/web/src/pages/home.ts:61–65`；Terms 的 `terms.ts:99` 也沿用必选关系。
- 事实：`V1FactoryValidation.sol:109–124` 在 stakingEnabled=false 时要求 assetUid 为零；前端 `app.ts:3030–3031` 同样仅启用时提交 Stock 资产。
- 影响：用户会误以为创建/交易必须先拥有 Stock Token，或每个 Bloomed 市场都能质押。
- 建议：创建步骤描述发行 fixed-supply Ticker Meme 和选择 paired asset；质押步骤明确 `Where staking is enabled`。文化关联仍可保留，但不能写成所有市场都有链上 Stock 绑定。

### F02 · 创建表单的“50%”缺少分母 — 高优先级

- 原文：`Share 50% of base fees with holders. Creator tax stays yours.`
- 位置：`pages/create.ts:58` 和动态覆盖 `app.ts:2932`，两处必须一起修改。
- 事实：`ProtocolFeeVaultLiabilities.sol:196` 是 `(creatorAmount - creatorTaxAmount) / 2`。分母是 Creator 的基础手续费份额。
- 建议：`Share 50% of your creator base-fee share with eligible holders. You keep all creator tax. This choice is fixed at launch.` 若允许独立收款人，最后交付时将 You 改成 creator recipient。
- 示例：每 100 单位基础费，Growing/无 active stake 且启用 Holder 时为 Creator35 / Holder35 / Platform30；有 active stake 时为 Creator20 / Holder20 / Staker30 / Platform30。Creator tax 独立计算。此处是费额分配比例，不是额外交易费率；整数舍入按合约执行。

### F03 · 交易价格保护披露过弱 — 高优先级

- 原文：Docs `The trading form currently has no user-set slippage limit.`；Trade 输出标题 `Receive`。
- 位置：`pages/docs.ts:19`、`pages/trade.ts` 交易表单。
- 事实：`app.ts:2141,2163,2178` 的 Pool/Curve 报价均设 minimum=0，Curve 请求在 `2421–2422` 传入该值。当前不是“用户不能调节一个默认滑点”，而是没有正数最低到账保护。
- 建议 Docs：`The displayed output is an estimate. This trading form does not enforce a minimum amount received, so the final output may be substantially lower if prices move before execution.`
- 建议操作页：`Estimated receive`，并在确认按钮附近显示 `No minimum received protection. Final output may be lower.`
- 边界：本项仅要求准确披露当前行为，不擅自新增滑点参数。创建首买另有独立 minimum 计算，不应把普通交易结论套到所有入口。

### F04 · Stake 仍把 Meme 权益说成必须等待兑换 — 高优先级

- 原文：`Awaiting conversion`；`Rewards Are Awaiting Conversion To The Paired Asset.`
- 位置：`pages/staking.ts:27`、`v1/flowUx.ts:15`，后者由 `app.ts:4906` 显示。
- 事实：`ui/reward-claim-dialog.ts` 已允许原币领取、仅选 Meme、兑换及 fallback。Creator 页面已改成 `Meme rewards`，Stake 尚未同步。
- 建议卡片：`Meme rewards`；帮助：`Meme rewards are available. Choose original assets or conversion when claiming.` 锁定或其他前置条件不满足时继续优先显示真实限制。
- 影响：现有文案会让用户等待一个不再必要的后台转换步骤。

### F05 · Terms 的 Holder 规则仍停留在旧版 — 高优先级

- 原文：`settled in Quote`、`Eligibility uses 7-day balance-time-weighted records`、`Root process`。
- 位置：`pages/terms.ts:126–127`。
- 对照：`pages/docs.ts:28`、`modules/HolderRewardsDistributorV1.sol:26`、`docs/operations/HOLDER_CONTINUOUS_REWARDS.md:7–17,55`。
- 建议：通用条款说明按市场绑定的分发规则执行；当前市场解释双资产、每批24小时释放；7天资格/Root/claim window 仅放在明确的 legacy 说明。不要让用户把24小时理解为持有锁定期或付款 SLA。
- 同时修正 Terms 的必选 Stock 关联（F01）。保留现有 `Pre-launch legal draft` 标识；本次是技术事实一致性审查，不是法律有效性审核。

### F06 · Docs 把最低总仓位写成每次投入都必须超过最低值 — 中优先级

- 原文：`Enter an amount ... above the displayed minimum`。
- 位置：`pages/docs.ts:23`。
- 事实：`v1/features/vault.ts:111–117` 检查 `currentStake + amount < minimum`；等于 minimum 合法，加仓额本身可低于 minimum。
- 建议：`Enter an amount within your wallet balance. Your total stake after adding must meet the displayed minimum.`

### F07 · 流通量标签实际显示总供应量 — 高优先级

- 原文：`Circ. Supply`，tooltip 却是 `Current onchain total supply`。
- 位置：`pages/trade.ts` 的 About；`app.ts:1735` 读取 totalSupply，`v1/tokenDetailWidget.ts:62` 直接显示该 supply。
- 建议：改为 `Total supply`。如果确实需要 circulating supply，必须先定义并计算排除曲线/锁仓等库存的口径，不能仅改 tooltip。
- 相关 Market cap 也按当前 supply 计算；应说明采用总供应量估值，或在确认产品口径后使用 `Fully diluted value`。

## 3. 首页：保留品牌，重写业务解释

首屏目前连续使用 `Community signal markets`、`open, expressive layer`、`ticker story`，读者能感到股票文化，却不容易知道可以买卖什么、Stock 的作用是什么。CTA 已有清晰动词，无需全部推倒。

建议可直接替换的英文稿：

| 位置 | 建议英文 |
|---|---|
| Kicker | `Meme markets for stock communities` |
| 主标题 | 保留 `Stake the ticker. Grow the culture.` |
| 首屏说明 | `Create and trade Ticker Memes inspired by stock communities. In markets with staking enabled, stake the selected Stock Token after Bloom to share that market’s trading fees.` |
| 简短身份说明 | `Ticker Memes are community tokens. They do not represent company equity or track stock prices.` |
| 主 CTA | 保留 `Explore markets` |
| 次 CTA | `Launch a Ticker Meme`，并同步全站创建语义 |
| 文化横幅 | 保留 `One stock. Many cultures.`；它是文化表达，不作为链上绑定承诺 |
| How 副文案 | `Launch a token, trade toward Bloom, and participate in market fee sharing.` |
| 步骤 1 | `Launch a Ticker Meme` / `Create a fixed-supply token, choose its paired asset, and set optional fee-sharing features.` |
| 步骤 2 | `Trade toward Bloom` / `When the curve target is reached, the market moves to a pool with permanently locked initial liquidity.` |
| 步骤 3 | `Stake Stock, share fees` / `Where staking is enabled, stake the selected Stock Token after Bloom to share fees as your stake becomes active.` |

第三步的 Stake Stock 是品类表达；进入具体市场后必须使用 TSLA、AMZN 等具体资产符号。不要写 `Allocate`，现有用户操作就是 `Stake`；底层 allocate 留在技术文档。

如果希望首页完整展示 Creator/Holder/Staker 三种参与方式，可在 How 下加一行短说明，而不是塞进第三步：`Creators earn fees from their markets. Eligible holders can also share fees when holder sharing is enabled.`

## 4. Docs：按用户问题补齐，而非增加协议术语

### D01 · Getting Started 应先界定三类资产

`docs.ts:8–10` 已区分 paired/staking，方向正确；但随后突然改用 Quote/Meme。建议首处定义：

- **Ticker Meme**：用户创建与买卖的社区代币。
- **Paired asset (Quote)**：买入支付、卖出收到的计价资产。
- **Stock Token**：仅在启用质押的市场使用的指定质押资产。

补一句 `You do not need Stock Tokens just to browse or trade. Buying requires the market’s paired asset and ETH for network fees.` Stock 恰好同时被选为 paired asset 的情况按具体市场解释，避免“交易永远不用Stock”的绝对表述。

### D02 · 创建签名步骤和不可变设置说明不完整

`docs.ts:11,13,15` 应区分上传授权签名、可能的资产授权/购买、链上 launch。发布成功不等于创建成功；在链上创建失败或取消后，先前已发布内容不应被承诺自动撤回。

建议：`You may first sign a message to authorize publishing your image and details. This does not launch the token. Review any required asset approvals, then confirm the launch transaction.`

固定设置列表增加“启用质押时选择的 Stock Token”。名称/图片等能否后改也应给出明确回答，依据元数据和合约更新能力逐项说明，不把所有设置泛称永久不可更改。

### D03 · Bloom 说明补充条件，不暗示保证完成

`docs.ts:16–17` 的生命周期与退款主线基本正确。增加：`A market may never reach its Bloom target. Locked initial liquidity does not guarantee a stable price or sufficient liquidity for your trade.`

使用 `initial liquidity`，不要把所有未来用户流动性都说成永久锁定。反狙击5秒已与当前规则对齐，不应因历史文档写3秒而回退。

### D04 · 手续费问答给具体例子

`docs.ts:21` 解释了分配延迟，但没有直接回答各角色拿多少。建议使用 F02 的分配表，并标注“基础手续费如何分配”，独立说明 Creator tax 和 pool protocol fee。避免将费率、分成比例和实际领取金额放在一列。

### D05 · 把 Holder 大段拆成三个问题

`docs.ts:28` 一段同时覆盖资格、资金释放、卖出后归属、三个角色领取、fallback、价格风险和历史版本，页面搜索实查也显示为单块长段。

建议拆为：

1. `Who earns holder rewards?` — 必须启用 sharing；无需质押；在释放期间按 eligible balance 归属；卖出后已归属奖励保留。
2. `When do holder rewards become available?` — 费用先入分发，再按批释放24小时；等待入批的时间另算；不是从买入开始倒计时，也不是固定24小时内到账。旧市场按明确的模式说明处理。
3. `Which assets can I claim?` — 三个角色通用说明移到独立问答：可选 paired asset、Ticker Meme 或两者；原币领取不经过兑换；选择兑换时未授权 fallback 的剩余 Meme 保留待领，已选 Quote 仍可正常发放；未选资产不受该次领取影响。

建议通用领取文案：`Choose the paired asset, the Ticker Meme, or both. Claim them as earned, or convert selected Meme rewards into the paired asset. If conversion is incomplete, the remaining Meme stays claimable unless you choose to receive it directly. Conversion has no minimum received protection.`

### D06 · 正常退出与应急退出需要分开解释

`docs.ts:25` 正常24小时锁及整仓退出说明正确，应保留。缺少合约的 emergency principal exit 及永久放弃未领收益的代价。

依据 `app.ts:4220–4320,5421` 和 Vault 路径，可以增加应急机制说明；但当前 `pages/staking.ts` 没有对应可见应急按钮，不能凭历史 README 告诉用户去点不存在的 Advanced 入口。先核定实际可用入口，再提供直达链接。本次列为文档/入口衔接缺口，不声称已完成浏览器应急操作验证。

### D07 · Pending 提示应指向控件名称而非固定位置

`docs.ts:30` 的 `at the bottom of the page` 对各页/弹窗不够稳定。建议 `Check the transaction status panel or open the transaction in the explorer. If a transaction hash was returned, check that transaction before submitting again.`

保留“刷新恢复”，但说明是同一浏览器保存的记录，不暗示清空存储或换设备也一定能恢复。

### D08 · 统计刷新和 unavailable 不应承诺固定 SLA

`docs.ts:31` 的10–20分钟可作为正常缓存描述，异常同步/价格覆盖缺失时不能保证。建议 `Statistics refresh periodically and may lag behind confirmed transactions. Check the latest update time. Unavailable means the data or price coverage is missing or stale; it does not mean zero.`

## 5. 其他页面与全站一致性

| 编号 | 页面 / 证据 | 现状与建议 |
|---|---|---|
| O01 | Stake `app.ts:4463`、`staking.ts:30` | 退出预览 `Full return: ... STOCK` 硬编码品类，实际应显示所选具体 symbol；改为 `Withdraw all: {amount} {symbol} to your wallet.` 并保留正常退出不自动领取奖励的说明。 |
| O02 | Stake `app.ts:4465–4467` | 锁定时 Available to claim=0 在语义上成立，但已有收益只在小字显示，易让用户漏看。建议单列 `Locked rewards` 或锁定状态下显示 `Rewards — unlocks {time}`；不得把锁定资产描述为可立即领。 |
| O03 | Claim `rewards.ts:23` | `Earn while holding. Claim even after selling.` 增加 enabled/earned 边界：`Earn a share of fees in eligible markets. Rewards already earned remain yours after selling.` 旧分发的 claim window 仅在对应市场解释，不泛化到当前连续分发。 |
| O04 | Claim `rewards.ts:35` | 已有“市场总额并非个人收益”的辅助语，保留；`Last injection` 改 `Last funding`，`Releasing` 改 `Currently releasing`。需要额外解释等待入批，不承诺即时付款。 |
| O05 | Stats `stats.ts:3,9` | `Testnet data`、`Current testnet pool valuation` 是静态写死，不能适配其他链。按真实网络生成；`updates every 20 minutes` 改 `Refreshes approximately every 20 minutes` 并展示更新时点；改 `Staked Stock Token value`，说明按当前参考价估值。 |
| O06 | Stats `stats.ts` | `Allocated in 24h` 缺对象，建议 `Fees allocated in 24h`；`24h fee revenue` 可改 `Trading fees generated · 24h`，避免被读成平台独得收入。保留钱包口径，不把钱包数改成独立人数。 |
| O07 | Trade `trade.ts`、`tokenDetailWidget.ts:62` | `Holders` 包含池与协议合约余额，不能等同 Docs 的 eligible reward holders。推荐 tooltip 清楚说明，Docs 补“reward eligibility differs from holder count”。当前已存在说明，注意动态状态渲染可能覆盖 title。 |
| O08 | Create / Claim | `Creator tax` 建议保留字段名并解释为额外交易费；收款人用 `Creator recipient`，避免 beneficiary/creator wallet/You 交替出现而改变读者对收款人的理解。 |
| O09 | 动态消息 `flowUx.ts:15`、`app.ts:3727`、`rewards.ts:25` | 正文句式大小写统一；比如 `Select a market to start staking.`。术语统一 Stock Token、Ticker Meme、paired asset；具体资金金额始终带实际资产 symbol。 |
| O10 | Privacy / Risks | 保留法律草案标识、公开链记录及第三方风险说明。本次未发现需要凭空替换的法律主体信息；Risks 可链接实际价格保护和质押退出说明，不能用通用风险段落替代操作当下的具体告知。 |

Explore 的 Growing/Bloomed 分类及 Create/Explore 动词入口可以保留。不要为了统一品牌而把所有菜单改成 Seed/Harvest 等隐喻。内部历史品牌文档曾使用 In Bloom，当前前端统一 Bloomed，应更新历史规范的适用状态，避免后续按旧稿回退。

## 6. 本次页面证据与验证范围

本次使用独立本地 Vite 预览及 Codex 内置浏览器，未连接钱包、签名、发布元数据或广播交易。截图为当前源码的1280×720桌面视口。正常数据与资金操作的文案按源代码分支审查，不声称已逐个实链触发。

1. **首页首屏：品牌表达完整，业务解释不足。** CTA 可辨识；Stock/Meme 身份边界没有出现在首屏。

![首页首屏](/Users/dear/Documents/code/TickerGarden/outputs/reviews/frontend-copy-2026-09-12/01-home.png)

2. **首页机制与页脚：需要修正必选 Stock 绑定和可选质押。** 三步结构清楚，但条件被压缩掉。

![首页机制](/Users/dear/Documents/code/TickerGarden/outputs/reviews/frontend-copy-2026-09-12/01b-home-mechanics.png)

3. **Docs 入门：目录和搜索可辨识，资产说明可加强。** 搜索有可访问名称；本次不作全面无障碍合规判断。

![Docs 入门](/Users/dear/Documents/code/TickerGarden/outputs/reviews/frontend-copy-2026-09-12/02-docs-start.png)

4. **Docs Holder 搜索结果：可找到内容，但单段承载过多问题。** 截图显示搜索焦点与长段结构。目录 Claim Rewards 点击在本次视口未滚动到目标，搜索可用；此项为附带的导航复核候选，不作为纯文案问题或已确定根因。

![Docs Holder 搜索](/Users/dear/Documents/code/TickerGarden/outputs/reviews/frontend-copy-2026-09-12/03-docs-rewards.png)

首次整页截图发生拼接重复，已拒绝作为证据；报告仅使用以上逐视口截图。未进行手机排版、屏幕阅读器、真实钱包全流程或部署就绪验证。

检查方式：rg 定位静态/动态文案，逐项阅读对应函数与合约，再复核子代理发现。未运行全套测试，因为本次仅新增审查报告；没有将未修改的运行时或现有工作区变更宣称为已验证。

子代理提供的“统计费用是否已分配”疑点缺少后端依据，未作为确定错误收录；锁定时0可领取额也未标为数值错误。只保留有当前证据的差异与明确标注的表达优化。

## 7. 后续实施顺序及验收

1. 先修 F01–F07：可选绑定、Holder分母、无价格保护、Meme可原币领、Terms版本、最低总仓位、供应量标签。
2. 更新首页说明和三步稿；保持视觉、口号和 CTA 层级。
3. 拆分 Docs 的 Holder/领取问答，补齐创建签名、角色/资产、退出和状态说明。
4. 统一跨页静态文案与动态覆盖；风险条款保持草案状态。
5. 真正改代码时运行现有文案/功能回归和构建，检查桌面/手机；必要用例应覆盖静态与动态文案的一致性，不仅检查新字符串存在。所有条件以实际运行网络、市场配置和合约版本生成。

本次审查完成；以上是待实施建议，不是已部署修复。
