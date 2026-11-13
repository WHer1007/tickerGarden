# RH Explore 市值缺失排查与修复

状态：本地修复与回归通过；未发布生产。

## 生产证据

2026-11-13 15:28–15:35 UTC，使用公开查询接口和只读 SSH 检查：

- RH `chainId=4663` Explore 当前返回 Genesis Seed / SEED，市场 ID 为 `0x01f5eb9ec14492bcefcc4598d9ac8ed3f1c2a2e7eca7b217b2e7b60576448476`。
- Quote 是 AAPL：`0xaf3d76f1834a1d425780943c99ea8a608f8a93f9`。市场已有 `priceQuote` 与 `totalSupplyRaw`，但 `metrics.marketCapUsd=null`、`quoteUsdMidpoint=null`，原因为 `valuation_inputs_unavailable`。前端按约定显示 `-`。
- 项目缓存的 AAPL 报价生成于 2026-11-12 19:17:38.512 UTC，19:22:38.512 UTC 到期；ETH 报价仍在刷新。RH 官方 `/rhj/prices` 与 `/rhj/assets` 的 AAPL 数据正常，资产有效、未停牌、倍率为 `1.001090616965388660`。
- RH Read API 的按需行情回调已配置，Display Worker 正常运行并处理价格通知。问题不在 CSS 或卡片格式化。
- 一次针对 AAPL 的普通公开 GET 行情请求返回 `invalid_timestamp`；未调用管理修复接口、写入数据库或重启服务。普通 GET 会按服务既有设计更新报价缓存。

## 根因和修复

1. Explore 使用后端计算好的 MC，没有调用价格 Store 的 `get()`，因此没有登记 Quote 消费需求。首次读取全目录只提供缓存，后续请求仅包含 ETH。新增可见 Quote 需求：合并 Growing / Bloomed 当前页，去重，只请求目录内有效地址；翻页替换、离开清空。持续停留不受旧 `get()` 需求两分钟清理影响。BSC 和测试链的既有选价策略不变。
2. RH 行情适配器以 HTTP 请求发出前的时间判断 `generatedAt`。请求过程中生成的新报价可能被当成未来报价。现在用两个 HTTP 响应读取完成后的时间校验。真实未来时间、过期价格、停牌、错误身份及到期倍率切换仍拒绝。

MC 仍由后端 `totalSupply × priceQuote × quoteUsd` 生成，倍率仅应用一次。价格通知只刷新数据库展示快照，经现有 SSE 更新对应卡片，不授权任何链上 RPC 或扫块。没有改动 HTML/CSS、合约、交易参数、过期阈值或生产配置。

## 验证

- 前端全套测试：814/814 通过，包含可见需求去重、静默停留、翻页、离开、在途请求及 BSC 隔离。
- 后端单元测试：267 通过、1 项因默认测试链环境跳过；该文件在 `TG_ENVIRONMENT=production TG_CHAIN_ID=4663` 下单独运行 2/2 通过，确认选定主网股票的报价无需 RPC。
- 后端 TypeScript、前端 ABI/source、生成客户端、目录、TypeScript、Vite、包体积和 SEO 检查通过。
- Chrome 1440px / 390px：使用生产公开响应作为本地 fixture，旧需求行为显示 `-` 且没有 AAPL 刷新；修复后只发一次含 AAPL 的请求，模拟后端价格通知后显示 `$3.09K`。这是固定测试报价结果，不是当前生产估值。两种宽度均无页面异常、无 RPC。
- 接收时钟回归覆盖：请求途中生成报价可用；响应到达后仍在未来的报价、途中到期价格、途中生效倍率仍拒绝。
- 修复适配器在本机读取 RH 官方实时 AAPL 数据，返回 `available`；只读上游 HTTP，未写入生产。

本地原始响应、测试日志和浏览器前后截图保存在 `.codex_tmp/rh-explore-mc/`（不入 Git）。

## 发布范围

基于生产源码基线 `1f1e20718a0ba1e3e17bfd67cab84fb74c234f85` 的独立工作区 `TickerGarden-rh-explore-market-cap`。此提交仅含 RH Explore 需求登记、RH 行情接收时钟修复及测试文档；不包含待发布的 BSC ticker 或 RPC 成本优化。

后续如获发布授权，须经 `test → master` 发布 RH Pipeline 和 Web，并用真实 AAPL 按需刷新、Display Worker 通知及 Explore 读回验收。无需改动 BSC、合约或数据库结构。当前未晋级、未部署。
