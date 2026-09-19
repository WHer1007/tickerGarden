# 代币详情交易区代码审查 — 2026-09-19

## 范围与验证

审查 test `eb8737d9416ea1284875749c60a79fc322d4c2f1` / master `8423fe7479728f5bb749d499fafbab095d6d7bc3`，两者产品 tree 相同：`5d396619c36c8b3b95b130e28674eeafec793fe1`。
覆盖 Growing / Bloomed 买卖、配对资产 / ETH 支付、报价与最低到账、授权、钱包响应、回执、恢复记录、余额刷新和错误文案。检查兑换接口的入参与固定路由约束。本次只做代码审查与本地隔离验证；未执行真实交易、未做浏览器或生产故障复现，也未审计合约全量逻辑。

现有前端套件重新运行：713 项通过。隔离复现脚本 `.codex_tmp/reviews/trade-area-audit.mjs`，结果 `.codex_tmp/reviews/trade-area-audit-results.txt`。现有测试通过不代表以下集成缺口不存在。

## 确定的问题

### 1. 高：20 秒不是完整流程的最大等待时间

证据：`apps/web/src/v1/transaction.ts:508,537` 只有 businessType=trade 才套钱包响应超时与 5 秒回执等待。`transaction.ts:225` 将 pool-approval 归为 approval，`controllers/trade.ts:1192` 的 ERC20 独立授权也使用 approval scope。授权阶段仍可能长时间等待。
`v1/pendingNetwork.ts:31` 的 20 秒为最早释放条件，另要求两次 unobserved；RPC unavailable 会重置计时。`app.ts:4597` 先查回执，再逐条探测，单个探测还包含多个最多 8 秒的串行 RPC。因此不能承诺端到端最多 20 秒。
建议：按一次交易流程建立统一截止时间，覆盖授权、兑换、项目买入；区分结束前台等待与认定链上失败，超时不得虚构回滚结果。后台核对独立运行，不靠连续轮询叠加时限。

### 2. 高：无哈希时刷新页面，兑换进度仍可能永久锁定

证据：`controllers/trade.ts:1025` 在请求钱包前保存 submitting；`:1070` 保存 buy_submitting。`trade/conversion.ts:23` 的记录没有 createdAt / deadline / attemptId。`controllers/trade.ts:124` 恢复逻辑在没有 hash / buyHash、没有 executor pending 记录时保留该状态；`:934` 禁用按钮。20 秒超时仅存在于当前页面的 Promise；刷新页面会失去计时和迟到回调。
建议：持久化请求阶段、起始时间、deadline 与 attemptId。刷新后恢复同一时间预算，孤立记录进入可重试的提交异常状态，不恢复为无限 pending。保留诊断记录及可能迟到的链上结果。

### 3. 高：兑换恢复没有严格绑定交易哈希

证据：`trade/conversion.ts:41-53` 按 wallet / market / state 更新记录，没有比较 r.hash/r.buyHash 与 pending.hash/receipt.transactionHash。
隔离复现：保存 buyHash=B 的 buy_pending，输入同钱包同市场、目标合约相同的成功回执 A，B 的恢复记录被删除。失败回执也可能把不相关订单改成 funded。
建议：所有恢复变更必须同时匹配 attempt、leg、hash；替换交易显式保存关联；不能仅凭同市场回执清理当前订单。

### 4. 高：手动恢复与自动恢复的校验和状态清理不一致

证据：`app.ts:4565` 手动入口调用 executor.reconcilePending，之后没有调用 reconcileConversionJournal；自动路径在 `app.ts:4642` 调用。`transaction.ts:370-384` 手动恢复拿到回执即删除 pending，没有自动路径提供的 canonical block/from/业务校验回调。
可能结果：手动检查后 executor 已解除，但 conversion 仍为 pending，交易区继续灰显。restoreConversion 也复用了该手动方法。
建议：统一恢复处理函数，先验回执与区块，再原子更新 executor/兑换记录，最后刷新 UI；手动按钮仅触发同一个恢复入口。

### 5. 中：已知回滚、授权失败、替换取消仍提示“结果未知”

证据：`trade/submission-error.ts:4` walletRequested=true 时直接走 publicError；`ui/public-error.ts` 没有 transaction_reverted、approval_reverted、replacement_cancelled 的交易专用映射。
隔离复现：上述三个明确结果都返回要求检查交易历史、不要重复提交的通用文案。
建议：按确定结果直接显示“交易失败”“授权失败”“交易已取消”，恢复对应余额/授权状态；未知结果单独处理。复用现有提示区域。

### 6. 中：后台刷新会误伤 Bloomed 交易的授权后检查

证据：`controllers/trade.ts:948-957` 即使业务字段相同也替换 ctx.tradeMarket 对象；`:1208` 通过 ctx.tradeMarket!==market 判定操作已变化。
触发：用户正在完成 ERC20/Permit2 授权，此时正常后台刷新返回同市场的新对象，授权后的交易被拒绝。
建议：比较 marketId、链、钱包、交易方向和 tradeContextKey/实际路由版本，保留字段层面的安全检查，移除对象引用比较。

### 7. 中：Growing 授权成功后仍可能被旧报价过期拦住

证据：报价有效期约 30 秒；`controllers/trade.ts:1147` 将原报价期限传入整个包含授权的执行流程；`transaction.ts:420` 授权后再次检查原期限，却没有刷新项目报价。
隔离复现：授权在 31 秒成功后，执行器抛出 stale_quote，买入没有提交。Bloomed 路径已有授权后刷新，Growing 未对齐。
建议：授权完成后重新取报价与模拟；新报价满足原确认最低到账即可继续，不降低用户确认条件。只有实质条件不满足才要求重新确认。

### 8. 中：归档后的后台核对不是持久任务

证据：`app.ts:4504` observeArchivedTrade 只在内存中运行，10 分钟后/切换钱包/页面卸载即停止；归档写入独立 localStorage key，没有启动时读取这些 archive 的恢复入口。无哈希迟到结果回调也会随页面退出丢失。
建议：可恢复的归档观察队列或有权限边界的后台任务；归档只解除前台等待，不丢失诊断与最终结果跟踪。不要恢复已超时流程的自动买入。

### 9. 中：确认框价格影响只显示项目池这一段

证据：`controllers/trade.ts:1117` 确认框 impact 取 quote.impactBps；兑换 priceImpactBps 只在常规报价区域展示，未传给确认框。确认框已有两步最低到账，但 ETH→Stock 的价格影响可能很大，用户最后确认时看到的单一 impact 不覆盖两步。
建议：复用确认框现有价格影响行，明确“兑换 / 项目买入”，不要将两段百分比简单相加，也不增加新组件。

## 已具备的有效保护

- 配对资产直接买入；非配对 ETH 使用配置池兑换，再执行项目买入。
- 兑换接口校验主网、输入资产、数量、受支持输出资产；前端根据固定路由组装调用，不执行接口传来的任意 calldata。
- 兑换最低到账受 1% 容差约束；项目买入保留用户确认的最低到账，刷新时不应降低。
- 报价结果具备 generation / 钱包 / 业务上下文 / 方向检查；支付余额读取隔离账户和所选资产。
- 写入前模拟、钱包网络核验、授权检查、正常成功路径的事件检查均保留。
- 迟到的钱包结果不会自动重启已结束的买入流程。此点不等于链上绝不会执行迟到的旧交易。

## 建议处理顺序

先统一交易尝试状态和恢复入口，补 attempt/hash 绑定与刷新恢复；再覆盖所有交易步骤的前台截止时间、修正文案；随后修复授权后对象比较与报价刷新，最后补归档跟踪和确认框价格影响。

需要补充的跨流程验收：钱包等待超过 20 秒、授权成功但报价过期、无哈希刷新、兑换成功/买入失败、历史回执与新订单并存、手动/自动恢复等价、切换钱包/市场、后台刷新发生在授权期间、RPC 故障与迟到哈希。

本次没有修改产品代码，没有发布。
