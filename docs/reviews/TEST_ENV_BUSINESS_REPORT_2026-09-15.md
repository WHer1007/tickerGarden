# 测试环境业务测试报告

测试日期：2026-09-15（北京时间；原始证据使用 UTC）。被测产品版本：`8711bc7e33c2c25d19d86bcd7c3d5a7c48c468bb`，`test` 分支。

测试入口：https://tickergarden-web-test.vercel.app 。链：Robinhood Testnet，chain ID `46630`。

## 结论

**当前环境通过基础服务、接口校验和多数页面交互检查，但尚未通过完整业务验收，不能据此认定具备生产发布条件。**

发现一项高优先级浏览器故障：价格参考接口的 CDN 缓存响应可能缺少 CORS 许可头。另有 Stats 异常态文案问题。当前测试数据只有 ETH 配对配置，没有 Stock 资产、Growing/Bloomed 项目或可用持仓/奖励样本，无法覆盖项目创建后的一整套交易、质押、领取闭环。

本轮没有广播链上交易，没有更改生产环境、合约、线上业务代码或测试数据库中的业务数据。未授权请求均在鉴权处被拒绝。异常注入仅在独立浏览器会话拦截 API 响应；数据库集成测试运行于本地独立 PostgreSQL。

## 实际执行范围与结果

| 测试层 | 本轮结果 | 证据边界 |
|---|---|---|
| 线上业务 API | 38/38 符合预期 | 包括正常查询、无结果、非法参数和不存在项目；不是 38 个资金闭环 |
| 服务验收 | 20/20 通过 | 三服务 live/ready、CORS 预检、方法限制、伪造回调、10 个并发健康请求 |
| Content/Pipeline 鉴权 | 7/7 通过 | 无签名上传和无凭证的 repair/generation/metrics 请求均为 401 |
| 前端回归 | 468/468 通过 | 当前代码的生成物、类型和单元测试；包含模拟数据 |
| 后端回归 | 89/89 通过 | 当前代码；生成物、类型和接口契约检查一并执行 |
| PostgreSQL 集成 | 27/27 通过，0 跳过 | 本地独立数据库；首次环境变量不足导致部分跳过，补齐后完整重跑，以最后一次为准 |
| 浏览器业务验收 | 未全通过 | 16 条路由/草稿/旧路由检查成功；钱包模拟器三项通过；Trade 数据断言失败且捕获 CORS 请求失败 |
| 桌面/手机扩展巡检 | 18 次页面访问 HTTP 200，无横向溢出及未捕获 JS 异常 | 1440/390 宽度；页面出现不代表数据业务完成 |
| 链上身份 | 17/17 固定模块匹配 | 两个 RPC 核对部署激活区块 codehash；不是本轮合约审计或真实交易执行 |
| 配置来源 | 3 条 bootstrap、3 个来源区块，双 RPC 验证通过 | 当前版本的 baseline/template/ETH quote；不能外推为 194 个 Stock 已就绪 |
| VPS Worker | 就绪、无重试/死信积压 | 观测时 generation 1 有 618 个成功链任务；本轮期间 Worker 新完成 2 个任务 |
| 同步 | API 报告 synced、lagBlocks=0 | 以 API 所用已确认头为基准，不宣称与即时链尖零延迟 |

浏览器使用独立无资金测试上下文。钱包连接、账户切换、错误网络清理使用模拟 EIP-1193 provider，未将其作为 MetaMask 真签名验收。没有可用市场，浏览器 Trade 用例使用明确不存在的 `0x11…11` 市场 ID 检查失败路径；它不能替代有效市场交易验收。

## 分页面业务结果

| 页面/环节 | 已验证 | 未完成或问题 |
|---|---|---|
| 首页 | 桌面/手机入口、页面资源加载、无横向溢出 | 本轮未逐个验证所有第三方外链目的页 |
| Explore | Growing/Bloomed 查询；Newest/Oldest/Market cap/Recent buys 交互；搜索无结果；参数及游标拒绝；未加载数值使用“-” | 无项目样本，不能证明排名顺序、买入置顶、跨页去重和 Bloom 进度数值正确；价格请求出现 CORS 故障 |
| Create | ETH 配对显示、0.42 ETH Bloom 目标、1% base fee、名称/ticker 编辑、草稿刷新恢复、未连接及异常时禁止提交；可选字段折叠 | 没有 Stock 选项，质押资产为“No eligible staking assets”；真实上传签名、发布元数据、创建/原子买入未执行 |
| Trade | 无效市场路径和页面安全展示；接口不存在项目返回 404 | 缺少有效市场，价格/图表/成交/余额/买卖/毕业后池路由均不能做真实正向验收；详情查询对不存在样本返回 503，已有浏览器脚本正确判失败 |
| Claim | 未连接引导、钱包模拟连接、账户切换、错误链失效；空账户查询、非法 snapshot/reward 参数拒绝 | 无 creator/holder 奖励样本；尚未执行领取、拒签、重复领取、proof、解锁、领取后余额和历史回写 |
| Stake | 未连接引导、空 positions/accounts/activity 查询 | 无 Stock、无启用质押项目；授权、存入、分配、生效、锁定、退出、rageQuit 和费用结算未做线上交易验收 |
| Stats | 空状态下有完整覆盖标记，数值为 0；统计与质押时间都显示；手动 Refresh 仅请求 `/v1/protocol-statistics`；503 时数字为“-” | 无非零数据，无法验证金额归因/精度和真实分配；失败时仍显示“No allocated Stock yet”；状态仍出现 unavailable 文案 |
| Docs/Privacy/Terms/Risks | 桌面/手机直达 HTTP 200、页面渲染、无横向溢出 | 未将页面能打开等同于法律文本审阅或全部生产地址的本轮逐项核验 |
| 内容服务 | 无签名上传被 401 拒绝；内部接口鉴权有效 | 图片→上传→存储→元数据→创建的正向链路需要测试钱包签名 |
| 后台链任务 | 常驻消费、已有任务完成、18 个数据库迁移记录 | 未对运行中的测试服务做强杀、重组或灾难恢复演练；恢复逻辑由本地集成测试覆盖 |

## 问题与复现

### BIZ-01 — 高：价格参考接口存在缓存相关跨域故障

现象：在真实测试网页打开 Explore/Create/Claim/Stake/Stats，浏览器会对 `/v1/prices/references` 报错：

> No 'Access-Control-Allow-Origin' header is present on the requested resource.

独立浏览器复核得到 `net::ERR_FAILED`。同一阶段 VPS 发送带测试网页 Origin 的 GET，收到 HTTP 200、`x-vercel-cache: HIT`、`age: 155`，但响应没有 `Access-Control-Allow-Origin` 和 `Vary: Origin`。缓存刷新后再次检查则出现正确许可头和 `Vary: Origin`。因此这不是价格服务 HTTP 500，也不是所有时间都失败。

代码线索：`services/backend-ts/packages/http/src/index.ts:116` 仅在请求携带且命中允许名单的 Origin 时设置 CORS 与 Vary；`services/backend-ts/apps/read-api/src/index.ts:56` 对价格目录启用共享缓存。本轮服务端检查包含不带 Origin 的 GET，暴露了这一缓存变体问题。需要同时处理无 Origin、允许 Origin、拒绝 Origin 的缓存行为，或采用经验证的同源代理；不能仅凭预检通过判定修复完成。

影响：浏览器参考价格读取不稳定，可能令美元展示/依赖价格的页面功能降级。当前测试数据为空，没有证据说明发生错误链上结算；不能据此宣称资金受损。

复测门槛：分别冷缓存和热缓存、先无 Origin 后允许 Origin、多个允许来源交替、拒绝来源交替；验证 GET 的实际响应头与浏览器读取结果，而非只测 OPTIONS。

证据：`outputs/business-test-20260916/browser-acceptance.json`、`network-diagnostic.log`；恢复后的头保存在 `cors-cache-headers.log`。

### BIZ-02 — 高：测试业务样本和 Stock 配置不足（验收阻塞项）

API 实际结果：`/v1/markets` 为 0 项；Growing/Bloomed 均为 0；`/v1/config/asset` 为 0；`/v1/config/quote` 只有 ETH；baseline/template 各 1。Create 也只提供 ETH。

这说明当前发布数据不足以验证股票相关产品能力，不直接证明注册合约出错，也不应把生产环境 194 个 Stock 的要求直接推断为本测试部署已有同样数据。双 RPC 仅确认当前三条 bootstrap 来源，未独立重放全部历史以证明链上永远没有其他登记。

补齐门槛：至少有 ETH/Stock 两种配对、启用/关闭质押、启用/关闭 Holder 分成、Growing/Bloomed、零/非零可领取、锁定/可退出等代表性样本。然后执行真实钱包闭环并保存交易哈希、回执、余额差额和读 API 更新证据。

### BIZ-03 — 中：Stats 把读取失败误写为没有 Stock 分配

在独立浏览器将业务 API 返回 503，等待 16 秒后，Stats 正确将指标显示为“-”，但“Staking value by Stock”下仍展示 **No allocated Stock yet**。无法读取与确实为零的语义不同。

此外状态栏仍显示 **Live data unavailable. Reconnecting…**，与此前希望数据展示避免 Unavailable 字样的措辞要求存在差距。

建议：区分 loading/error/empty 三种状态；失败时显示“-”或清晰的重试说明，仅在数据完整且条目确实为空时显示“无分配”。相关位置：`apps/web/src/ui/stats-stock-list.ts:69`、`apps/web/src/app.ts:4660`。

证据：`outputs/business-test-20260916/fault-states.json`、`fault-final-stats.png`。此故障注入没有修改远端 API。

## 需要进一步复核的页面表现

- 在额外一次正常 Create 访问中，等待 16 秒后出现“Launch Unavailable / Read API Health Is Not The Expected Finalized Robinhood Chain Snapshot”，ETH 被标记 Pending activation。其他访问曾正常显示配置，因此记录为间歇性快照/读取问题，尚未将其认定为配置未激活；需要结合请求和对应健康快照复核，不能将这一轮 Create 判定为稳定可用。
- 对明确不存在的市场 ID，Trade 显示“backend is verifying the creation transaction”，但此次请求没有提供创建交易证据。建议区分未知市场与确有待确认创建的市场，避免给出未经证实的处理状态。这是无效链接 UX 观察，不是有效市场丢失的证据。

证据：`outputs/business-test-20260916/edge-pages.json`、`edge-create.png`、`edge-trade.png`。额外等待也确认 Explore 最终收敛为“No tokens yet”，并非持续加载。

## 性能、恢复与测试限制

38 个业务 API 请求从 VPS 发起，单次样本中 p50 约 60 ms、p95 约 604 ms、最慢约 4.75 s，包含缓存/冷启动影响。10 个并发健康请求 p95 178.53 ms。**这些是低负载观测，且市场人口为零，不是 20,000+ 项目的负载测试。**

本地数据库集成覆盖增量投影、分页/续作、事务一致性、排名和统计缓存、重复/编辑/删除/重组交易 rollup、Worker lease/fencing/mode 等。没有在共享测试 VPS 上进行破坏性故障注入、恢复备份或高压压测。

本轮未完成合约 Foundry/Fork 全套重跑：alignment 工作区缺少 `contracts/lib` 依赖，相关入口不能运行。既有用例文档/脚本已梳理，但旧 R5 文档和历史链上交易证据不作为本次当前版本通过证据。真实 Holder 自然等待和 Stake 解锁窗口也没有被模拟钱包替代。

## 下一轮验收清单

1. 修复 BIZ-01，复测冷/热缓存下浏览器 GET。
2. 修复 BIZ-03，并验证错误→恢复→空结果转换。
3. 确认专用测试钱包地址/本机已有配置与测试资产；无需提供私钥文本。
4. 补齐 Stock 配置与代表性项目样本，并核对链、部署版本、资产和测试资金边界。
5. 完成 Create→内容发布→曲线买卖→Bloom→池内买卖，以及 Stake→奖励生效→Claim/退出；逐笔核验费用、最低到账、余额、回执和前端更新。
6. 单独执行非零统计对账、20,000+ 项目容量测试和故障恢复演练，再给最终业务验收结论。

## 原始证据

本地证据目录：`outputs/business-test-20260916/`（目录名仅为本轮批次标识，实际测试时间以文件中的 observedAt 为准）。

- `service-acceptance.json`、`api-matrix.json`、`auth-boundaries.json`
- `browser-acceptance.json`、`interactions.json`、`fault-states.json`、页面 PNG
- `network-diagnostic.log`、`cors-cache-headers.log`
- `chain-identity.json`、`runtime.log`
- `web-tests.log`、`backend-tests.log`、`integration-full.log`

本报告为内部测试交付，不应直接加入面向用户的公开 Docs。
