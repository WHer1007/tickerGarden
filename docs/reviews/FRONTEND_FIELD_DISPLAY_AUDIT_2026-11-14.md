# 生产前端字段显示审查 — 2026-11-14

检查时间跨越 2026-11-13 / 14，时区 Asia/Shanghai。应用发布版本 `75dc280b3ae797e674cac46ace8644043f4b8f3b`；本次隔离审查基线 `9b8ad10c89a1d1f7601c60cb29d4077c3894ae26`。没有修改产品代码、样式、生产配置或链上状态。

结论：正常数据展示已明显改善，BSC ticker、RH Explore 市值及 Links 修复已经生效。但仍有 **1 项 P1、5 项 P2、2 项 P3**。主要风险是链身份丢失、旧数据被当作新周期或当前估值，以及缺少明确的数据状态。已有测试全绿不能覆盖这些问题。

## 检查范围与验证

- RH 4663 / BSC 56：Explore、Launch、详情、Stake、Claim、Stats、Stock Stats、首页及 Docs；1440px 桌面与 390px 手机，共 26 组页面访问。
- 真实生产样本：RH Genesis Seed / SEED，BSC Ticker Bull / TBULL。对照公开 API、DOM、截图及当前源码；额外验证新标签页、链切换、卖出单位、Quote 切换、Holder 标签和图片延迟加载。
- 浏览器故障注入：12H 请求 503、详情局部刷新失败、Stats 全部 503。只拦截独立浏览器上下文的响应，未改变服务器。
- 现有前端测试 **826 / 826 通过**；TypeScript、生成 Read Client 和资产目录一致性检查通过。另写一个隔离回归用例，确认失效 USD 估值未清除；该用例按正确行为断言，当前源码失败。
- 26 组页面无未捕获 JS 错误、无主页面加载失败、无文档级横向溢出。手机详情表格使用内部横向滚动，不作为页面溢出问题。
- 未连接有资金钱包；钱包余额、个人仓位、可领取金额没有本轮实账验收。相关代码有既有回归覆盖，不等于逐个实际仓位都已验证。没有进行链上交易或扫块。

## 已确认问题

### D1 · P1：市场链接与分享 URL 丢失链参数

位置：`apps/web/src/app.ts:1667`（另见 1349）、`apps/web/src/routing/router.ts:56`、`apps/web/src/routing/metadata.ts:27`。

生产 BSC Explore 的 TBULL 卡片实际 href 为 `/trade?marketId=0x3422…80f4a`，没有 `chain=bsc`。普通左键由 SPA 路由补链，因此可以打开；复制链接或新标签页直接打开则落到 Robinhood Chain，显示 **This market could not be loaded**。canonical 和 `og:url` 同样漏链。

修复：链接生成时携带链身份，集中维护市场 URL；覆盖卡片、相关市场、分享、canonical、直接访问及刷新，保留旧 RH 链接兼容性。不要依赖点击拦截补参数。

证据：[navigation.json](evidence/frontend-fields-2026-11-14/navigation.json)。

### D2 · P2：图表请求失败，旧数据被标成新周期

位置：`apps/web/src/v1/tokenDetailWidget.ts:72`、109、117、166。

生产 bundle 加载正常 1H 数据后，拦截 12H 请求返回 503：曲线仍为原来的两条观测点，图表标签与涨跌幅却变为 **12H / +0.31% (12H)**，没有失败提示。confirmed 请求失败设置为 `pending`，而同周期按钮仅在 `error` 时允许重试。

修复：数据绑定市场、周期和时间窗；旧图保留时保留旧周期身份，明确新请求失败并允许局部重试。切周期不刷新交易表单或无关区域。

证据：[截图](evidence/frontend-fields-2026-11-14/chart-period-failure.png)、[failure-states.json](evidence/frontend-fields-2026-11-14/failure-states.json)。

### D3 · P2：USD 报价失效后，收益估值仍使用旧价格

位置：`apps/web/src/app.ts:5203`、`apps/web/src/controllers/trade.ts:349`、`apps/web/src/v1/tokenDetailWidget.ts:196`。

行情不可用时，调用方传入 `usd: undefined`；`setOverview` 跳过 undefined，导致上一笔 USD 价格无法清除。费用估值继续读取旧 `overview.usd`，仍显示“Estimated at current prices”。

隔离用例：1 个 Quote 的 Creator 已入账收益，USD 单价 2000，先显示 `$2,000.00`；再通知报价失效，仍为 `$2,000.00`，正确期望为不可用状态。生产两个样本当前没有正数已分账收益，因此这不是一次实际领取金额错误的现场证据，而是当前源码可复现的展示缺陷；不影响合约按原资产结算。

修复：区分“字段未更新”和“明确失效”，显式清空 USD；保留原资产数量，美元估值标记不可用或过期。补 available → stale → unavailable → available 测试。

证据：[失败回归结果](evidence/frontend-fields-2026-11-14/expired-valuation-test.txt)；复现脚本 `.codex_tmp/field-audit/fee-stale.test.ts`。

### D4 · P2：市值、人数、成交量与 Stats 缺少可靠的更新状态

位置：`apps/web/src/v1/tokenDetailWidget.ts:37`、174；`apps/web/src/v1/statsUpdates.ts:25`；`apps/web/src/controllers/stats.ts:59`。

- confirmed 详情直接隐藏数据来源/状态；局部刷新失败时旧市值 `$2,375.86`、Holder `1` 保留，状态和错误提示为空。
- Stats 初次请求全部 503 时只显示 `-`，`aria-busy=false`，没有失败说明或重试。
- RH 初次详情读取 `marketCapUsd=null`，显示 `-`，即使 AAPL 报价已 available；后续复查恢复为约 `$3,099.18`。因此这是可恢复的投影/刷新延迟，**不是“RH 详情市值永久无法获取”**。页面缺少等待/不可用状态，用户无法分辨。
- RH 详情统计来源时间仍为 `2026-11-01T19:22:53Z`，24h volume 窗口也截止该时间；当前页面只写“24h volume”。有旧链快照不能证明最新 24h 已完整覆盖。1H 图在无近期成交时按代码设计回退到 9 月 19 日最后成交的历史窗口，横轴有日期，但缺少明确“历史最后成交”说明。

修复：各区域独立展示 loading、ready、stale、missing/error，区分链状态时间与美元报价时间；保留有效旧值时标出其时间范围。历史最后成交视图应明确说明。无需、也不应通过持续 RPC 扫块来解决字段状态问题。

### D5 · P2：BSC 的链名、资产数量、帮助参数和分享标题仍有 RH 文案

位置：`apps/web/src/pages/home.ts:38`、`apps/web/src/pages/docs.ts:15`、20、24；`apps/web/src/routing/metadata.ts:13`、16；`apps/web/api/market-page.ts:10`。

- BSC Launch 浏览器标题为 **Launch a Token on Robinhood Chain**。
- BSC 首页仍写 **194 Stock tokens / Official Robinhood assets**。
- BSC Docs 仍围绕 ETH、USDG、3 ETH / 7,000 USDG、194 个 RH Stock 与 RH 合约说明，缺少当前 BSC 参数。
- BSC 详情 server metadata 查询只用默认 `VITE_V1_READ_API_URL` / chain ID，没有按 URL 链参数选择 API，无法正常取得 BSC 市场标题；客户端也显示通用 `Trade a market`。

修复：保持页面结构与样式，按当前链选择已验证的文案、资产范围和合约表；metadata 也必须按链解析。BSC BNB 目标使用部署时冻结值，不能改成随美元行情浮动。

### D6 · P2：BSC Holder 未开放状态没有在页面入口显示

位置：`apps/web/src/pages/rewards.ts:6`、`apps/web/src/v1/evmContext.ts:23`、`apps/web/src/app.ts:4122`。

当前 BSC Holder 领取仍按既定策略关闭，后端/执行门禁没有发现绕过。生产页面 Holder 标签仍显示“选择代币 / 连接钱包”，未明确告诉用户该链尚未开放，容易被理解为连接后即可领取。

修复：在现有状态区域显示“BSC Holder 领取暂未开放”，保留已开放的只读信息。不要通过打开批准或领取开关来修复展示。

### D7 · P3：历史成交只有时分秒，跨日期记录无法辨识

位置：`apps/web/src/v1/tokenDetailWidget.ts:85`。

SEED 实际成交来自 9 月 19 日、9 月 17 日；页面分别只显示 `19:35:33`、`20:58:57`，时间单元格没有完整日期 tooltip。用户无法仅凭列表判断交易日期，容易把历史成交当作当天记录。

修复：当天显示时间，历史显示日期 + 时间；补完整时间及时区说明。已有交易链接保持不变。

### D8 · P3：部分字段单位及数量格式不统一

位置：`apps/web/src/pages/trade.ts:12`、13；`apps/web/src/controllers/trade.ts:598`；`apps/web/src/v1/tokenDetailWidget.ts:85`、94。

- Fixed supply 显示 `1000000000`，相邻 Circ. Supply 显示 `1,000,000,000`。
- Recent trades 的 Price / Amount / Value 列未明确标出 Quote/MEME 单位；例如 TBULL 的 Value `0.00198` 实际是 BNB，而不是美元。
- `Circ. Supply` 当前展示链上 totalSupply，并非扣除池/协议库存后的自由流通量；相关说明以及 Holders 的原始 tooltip 又会被统一 render 覆盖为空。当前持有人统计按协议排除表计算，不能用“包括所有池/协议地址”解释。

修复：统一数量格式、明确列单位，恢复准确口径说明。优先调整文字/tooltip，不改变计算或奖励资格；需要布局改动时另行确认。

## 已确认正常或不应误报的项目

- BSC Explore 显示 NVDAB 与股票图标；RH Explore 显示市值。RH 详情市值后续能够恢复。
- TBULL / SEED 图标在延长等待后全部加载成功，初次加载缓慢不能当作图片永久失效。
- Links 的 Website / X 按钮在未填写时仍显示、禁用，符合用户要求。
- BSC 默认 Quote 为 BNB，菜单前部为 BNB、USDT、USDC 与优先股票；GPROB 不在开放 Quote 菜单。Quote 共 80 项：3 个基础资产 + 77 个开放股票。
- BSC 创建费显示 `0.0005 BNB`；USDT / USDC 毕业阈值分别显示 `7000`；BNB 为冻结配置约 `9.325982`，NVDAB 样本约 `30.370557`。本次验证页面读取，不重算部署参数、不广播发币。
- 买卖切换后的输入/输出单位正确：RH SEED → AAPL，BSC TBULL → BNB。
- 未连接钱包时 Balance、Your stake、Claim 等显示 `-` 属于预期，不应伪造为 0。
- 极小价格使用零数量下标，DOM textContent 中的 `0.08862968` 不是实际价格 0.08862968；精确值在 title 中为 `0.000000008629680991…`，截图渲染正确。
- Stats 有交易费收入而分账/Creator 显示 0，当前对应“已发生交易费”与“已 sweep/已入账分配”的区别；没有据此判定漏费或资金丢失。
- 隐藏原生 select 的地址占位文本、源码中不存在于当前页面的 `data-stats-network`，未列为用户可见错误。

## 建议顺序

1. D1 链身份与 D2 图表周期，消除直接访问失败和错标。
2. D3 失效估值与 D4 各字段状态，补失败、过期、恢复测试。
3. D5 / D6 链相关文案与开放状态。
4. D7 / D8 日期、单位、数量格式和统计口径说明。

本次只形成审查材料。原始浏览器数据、截图、故障脚本和测试日志位于 `.codex_tmp/field-audit/`；精选证据位于本文相邻 `evidence/frontend-fields-2026-11-14/`（按既有规则本地保留、不强制加入 Git）。[结构化摘要](evidence/frontend-fields-2026-11-14/summary.json)。
