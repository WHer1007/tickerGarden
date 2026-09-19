# 前端功能与交互审查 — 2026-09-19

基线：`test` 分支 `e660ddbd4bd4cafce90b6934526e3af1052e2f7c`。本次为代码审查与本地测试，不含浏览器截图、钱包真实签名、主网交易或线上故障复现。未修改产品代码、未部署。

## 结论与优先级

优先统一非 Trade 操作的等待恢复，再处理奖励页的数据保留与初始化依赖。无需增加页面组件，可复用已有按钮、提示区域、后台核对和请求管理。

### F1 高：短时钱包等待处理只覆盖 Trade，奖励和质押仍可能长期处于忙碌状态

- 证据：`apps/web/src/v1/transaction.ts:488,503-509,532`。`waitForWalletSubmission` 和独立回执等待截止仅在 `tradeScope` 下使用；其他操作直接等待钱包 Promise。
- `apps/web/src/app.ts:899-924` 的 activeOperations 在执行器返回后才清除；Creator、Holder 和 Stake 自身也在 finally 中复位准备状态。
- 条件：钱包没有返回哈希，也没有 reject，或回执请求持续等待。此时无法靠失败文案解决，执行流程尚未进入 catch/finally。
- 建议：抽出通用前台等待预算与持久恢复机制，覆盖 Launch、三类领取、质押和授权。结束前台等待不等于链上回滚；已被节点确认的 pending 保留防重复提交保护，迟到结果不得自动续执行旧流程。

### F2 中高：Launch、Claim、Stake 的部分刷新仍经过全局 health

- 证据：`apps/web/src/app.ts:4693-4701`。除 Trade、Explore、Stats 和静态页外，`refreshCurrentPage(false)` 先请求 health，失败后把 foundation 置空并失效其他读取。
- Launch 首次基础配置路径还有 `app.ts:617-640` 的 health/finalized 校验。Claim/Stake 首次 bootstrap 已单独处理，不能笼统称为它们每次首次加载都等待 health。
- 默认客户端 `apps/web/src/v1/generated/read-api.ts:121` 和 `app.ts:248` 没有配置应用级超时；不响应的 health 会拖延该刷新路径。
- 建议：页面读取采用本页配置和数据接口，保留已有可显示结果；网络/合约有效性检查在提交准备阶段独立执行。统一只读请求超时，不把全局 health 作为浏览门槛。

### F3 中：Holder 自动刷新会清空状态并丢失已加载的历史轮次

- 证据：`apps/web/src/app.ts:2596-2602,4339-4344,3567-3573,3593-3595`。30 秒刷新调用 `refreshTreasuryReward(false)`，仍清空 snapshotReward，然后调用没有 prior 的 `loadSnapshotReward`。
- `app.ts:3469-3489` 会重新读取第一页并重建轮次下拉框；旧轮次若不在第一页，会改选其他可领取轮次。刷新失败时原有 snapshot 也不能保留。
- 已有防护：进入领取选择后暂停常规定时刷新；领取根、证明、资金与重复领取校验存在。问题主要发生在浏览奖励时。
- 建议：同账户同市场保留已加载页和当前选择，后台刷新相关轮次；仅身份切换时清空。不能以此取消领取安全核验。

### F4 中：Holder 的空搜索结果缓存十分钟，新市场可能持续搜不到

- 证据：`apps/web/src/v1/holderMarkets.ts:4-13`；空数组和非空结果采用相同 600000ms 缓存，没有事件失效机制。
- 条件：用户在后台索引完成前搜索新代币，首次得到空结果；即便后台已经补齐，同一浏览器相同关键词仍命中空缓存。
- 本地隔离验证：替换 fetch 为先返回空、下次返回一个代币；连续两次搜索结果均为空，fetch 实际调用一次。
- 建议：空结果不缓存或仅短暂缓存；新市场/奖励发布事件失效对应目录缓存。复用现有搜索交互。

### F5 中：进入 Holder 页面也先等待 Creator 目录

- 证据：`apps/web/src/app.ts:4390-4395`，只要是 rewards 页面就先 await refreshCreatorDirectory，没有区分当前 Holder 标签。
- Creator 目录设置 20 秒超时（`app.ts:2838`）；本账户首次请求慢时，后续 Holder 初始化和 refreshActiveReward 被串行延后。
- 建议：按当前标签加载对应目录；另一个标签需要时再读取。保留账户隔离和请求去重。

### F6 中：交易退出前台等待后的后续观察不能跨刷新恢复

- 证据：`apps/web/src/app.ts:4549-4561`，归档交易只在内存里每 30 秒核对，10 分钟后停止，pagehide 停止；`apps/web/src/v1/transaction.ts:336,506` 保存了归档，但该观察流程没有启动时恢复归档扫描。
- 影响：重新载入页面后，迟到的交易可能不再由该流程自动识别并更新结果。
- 建议：持久化有限期观察任务，按钱包和链恢复，合并查回执/nonce/替换交易。后台观察不重新锁住整个买入区，也不自动重新提交。

### F7 中：Confirm trade 的 Price impact 只展示项目买入腿

- 证据：`apps/web/src/controllers/trade.ts:911-915` 的交易区分别显示 Market 与 Conversion impact；确认框 `:1126-1132` 仅传入 quote.impactBps，conversion 内容只传路线、最低到账和费用。
- 条件：ETH → Stock → 项目代币，Stock 池影响显著而项目池影响较小时，用户可能把确认框唯一 impact 理解为整条路线。
- 建议：在确认框已有信息行内区分兑换影响和项目买入影响；不要将两者简单相加。无需新增页面模块或额外确认步骤。

### F8 中低：Stats Stock 详情会在刷新时自动折叠

- 证据：`apps/web/src/ui/stats-stock-list.ts:77,91-102` 每次 update 都 replaceChildren，并重新创建 details；`apps/web/src/v1/statsUpdates.ts:20,59` 默认 60 秒补漏，也会响应事件。
- 用户展开的精确美元金额及行内焦点因此丢失，搜索和隐藏零值状态则已保留。
- 建议：按资产 ID 更新已有行，保存 details.open 和焦点；未变化的数据不重建 DOM。

### F9 中低：部分非领取操作仍使用面向 Trade 的通用错误文案

- 证据：`apps/web/src/app.ts:4310-4317`，非 claim 的退出/清理操作调用 publicError(...,'transaction')；`apps/web/src/ui/public-error.ts:22-27` 的链上回滚文案为 “This trade failed on-chain. Refresh the quote…”；余额/连接等兜底仍可能要求用户查交易历史。
- 领取已有 rewardErrorNotice，普通 stake 有 stakeErrorMessage，不能误称所有奖励错误提示都未处理。
- 建议：公共错误分类与业务文案分离，退出、清理、授权按动作给出下一步；是否提交取自执行阶段，未知结果由系统自动核对。

### F10 低：Docs 锚点视觉定位与键盘焦点不一致

- 证据：`apps/web/src/routing/router.ts:30-38,41-49`；同页 hash 切换依然把焦点移到 h1/main，之后只 scrollIntoView 到目标章节。
- 已有挂载后定位、目录高亮、搜索解除隐藏等处理。问题是键盘/读屏接续位置，非章节滚动功能缺失。
- 建议：跨页聚焦主标题；同页章节导航聚焦对应章节或标题。无需视觉改版。

## 覆盖与已有保护

| 范围 | 检查内容与结果 |
| --- | --- |
| 首页、Docs、Privacy、Terms、404 | 路由、元数据、锚点、静态入口、加载失败入口；本轮未确认新的阻断缺陷，Docs 焦点见 F10 |
| Explore | 搜索、Stock 筛选、排序、分页、事件通知、缓存、请求取消、失败保留；已有较完整的防旧响应覆盖及交互期间避免列表跳动处理 |
| Launch | 表单、草稿、图片读取、预览、二次确认、进度与恢复；共性问题见 F1/F2。本轮未确认新的图片读取死锁，catch 后仍会执行状态复位 |
| Trade | 报价、资产切换、二次确认、授权、回执及恢复；上轮 1–7 项修复已在基线中，本轮不重复列为未修复；剩余见 F6/F7 |
| Claim | Creator 目录/周期、Holder 搜索/轮次、刷新及领取恢复；见 F1–F5/F9 |
| Stake | 位置/奖励读取、倒计时、提交、退出及错误分流；已有同块资金一致性、账户变化隔离、解锁后再核验；见 F1/F2/F9 |
| Stats | 分区读取、SSE、低频补漏、失败保留、明细交互；见 F8 |
| 全局 | 钱包变化、路由卸载、确认框和请求生命周期；关键共性问题见 F1/F2/F6 |

另有两个低优先观察项未计入主要清单：移动导航 Escape 只在 header 内处理；Stats 各区域并行返回时，共享 revision 元数据可被较早版本覆盖，但当前页面未发现使用该共享 revision 的业务门槛。需保留区域独立更新，不能为追求同 revision 引入全页等待。

## 验证与限制

- `npm --prefix apps/web test`：生成产物检查、TypeScript、734 个测试全部通过。
- 日志：`/tmp/tg-frontend-audit-tests.log`。
- Holder 空缓存隔离验证：`{first:0, second:0, fetchCalls:1, emptyResultCached:true}`，未连接生产 API。
- 本轮未执行浏览器视觉/移动触控/屏幕阅读器验收，未连接钱包交易；上述触发条件来自代码路径，不能据此声称生产已经全部复现。
- 建议补充用例：各业务钱包永不返回、迟到哈希跨刷新、Holder 翻到历史轮次后定时刷新、Creator 目录卡住时进入 Holder、空搜索后新市场可用、Stats 展开后事件更新、Docs 锚点后的键盘焦点。
