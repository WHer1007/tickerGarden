# 前端交互修复 — 2026-09-19

对应 `FRONTEND_INTERACTION_AUDIT_2026-09-19.md` 的 F1–F10。改动在本地，未提交或部署；不增加页面模块或额外确认步骤。

## 前三项

1. **等待恢复**：共享交易执行器现在对 Launch、领取、质押及授权同样采用每笔交易 20 秒的钱包响应/回执前台预算。超时结束当前执行，不把未知结果误判为回滚；迟到哈希归档观察，不自动执行后续步骤。奖励待确认记录使用独立截止任务；新鲜的节点 pending 证据保留防重复保护。
2. **页面初始化**：Launch 复用现有数据库配置 bootstrap，读取完整 baseline/template；Claim、Stake、Launch 的页面刷新不再先请求 health，Launch 也不再参加全局快照失效轮询。只读客户端有 12 秒请求上限。Launch 准备时从当前链读取区块上下文，依然核验链、区块、Factory 绑定、配置及经济参数。
3. **Holder 状态保留**：同钱包同市场的后台刷新保留原数据和选择；重新读取用户已展开的历史范围后再替换，保留当前历史轮次，失败保留旧视图。根、证明、身份、资金和已领取状态校验保持。

## 后续项

- F4：Holder 空搜索结果不缓存，正结果缓存缩至 60 秒。
- F5：进入 Holder 不再串行等待 Creator 目录。
- F6：归档交易按链和钱包持久化，重新连接后恢复观察；最多观察最近 50 条、24 小时内记录，成功核验后清理。使用既有回执/区块/业务验证，不重启旧购买流程。关闭浏览器期间不会运行，重新打开并连接对应钱包后恢复。
- F7：Confirm trade 的现有 Price impact 行分别显示 Market 和 Conversion 影响；不相加，不新增信息模块。
- F8：Stats 按资产 ID 复用明细节点，保留展开状态；排名移动时恢复仍存在的焦点。
- F9：退出、清理使用对应业务错误文案；钱包超时在领取、质押、Launch 中有明确说明。
- F10：Docs 同页锚点导航将焦点放到目标章节；跨页仍先聚焦主标题。

## 验证

- `npm --prefix apps/web test`：746 个测试通过，包括生成产物检查、TypeScript、钱包永不返回与迟到结果、奖励回执预算、归档隔离/到期、Holder 历史刷新、空搜索重试和 Stats 状态保留。
- `npm --prefix apps/web run test:browser:lifecycle`：router 16 项、app routing 63 项断言及 history lifecycle 全部通过。修正旧夹具的三轮询器假设及已移除的 `.html` 路由引用；保留定时器不增长、钱包不重复连接和旧请求不回写等验收。
- `npm --prefix apps/web run build`：构建、资源预算、预渲染、ABI/控制器拆分及 SEO 检查通过。
- 本地日志：`/tmp/tg-interaction-fixes-tests.log`、`/tmp/tg-interaction-browser.log`、`/tmp/tg-interaction-fixes-build.log`。
- 浏览器测试使用隔离的本地模拟环境。未进行真实钱包签名、主网交易或线上验收；超时不能取消钱包已发起的请求，也不代表资金操作必然失败。

审查报告另列的两个低优先观察项（移动菜单 Escape 的作用范围、Stats 共享 revision 元数据）不属于本轮 F1–F10 修复清单，未改动。
