# Explore 长时间停留后列表消失

## 已确认的前端原因

1. `createSnapshotPoller` 周期读取 `/v1/updates`，任何请求失败、准备新快照失败或超过 15 秒都会通知 `unavailable`。原回调置空 foundation，然后 `invalidateSnapshotReads()` 调用 `clearMarketDirectoryView()`，删除两组所有 `[data-runtime-market]` 卡片。一次暂时故障即可造成整个列表消失；等待后续成功恢复期间保持空白。
2. 原 `visibilitychange` hidden 回调直接清空市场 DOM，切换标签页、最小化或设备休眠会触发。`pagehide` 也曾清空 DOM，影响浏览器页面缓存恢复。

以上为源码确认的触发机制，未取得用户该次消失时的网络日志，因此不能确定当次是超时、HTTP 错误、快照准备失败还是页面可见性事件。

## 修改

- Explore 的快照失效默认保留已成功渲染的卡片和分页缓存；其他交易/账户状态仍按原规则失效。
- 没有可用 foundation 时暂停当前分页请求、拒绝旧请求回写，保留已有页面。显示 `Market updates unavailable. Showing the last loaded list. Reconnecting…`，并暂时禁用翻页。
- 尚未加载过列表的情况仍显示不可用提示，不伪装成空市场或捏造缓存。
- 恢复成功后刷新列表并重新启用分页，复用相同页面时也恢复按钮状态。
- 隐藏页面和 pagehide 仅停止快照轮询，不再清空卡片；重新可见/BFCache 恢复后重连。真正路由卸载仍显式清理视图。
- 没有新增 RPC 请求或后端接口，仍从 Read API 获取展示数据。

## 验证

- Web 351 项测试通过，类型检查、生成文件一致性检查及生产构建通过。
- 新的行为测试：分页到第 2 页后，中断第 3 页请求；保留当前页，忽略旧请求迟到结果，再成功重试，不重复加载当前页。
- 生命周期回归检查覆盖隐藏/pagehide 不清空、失效保留旧列表并提示、恢复按钮、路由卸载仍清理。
- 独立只读复核确认上述调用路径；未提交钱包交易。
- CUA 浏览器连接在 30 秒后超时，因此尚未完成本轮真实浏览器长时间停留和离线/恢复交互验收。自动化测试不等于浏览器实测。

## 测试部署

已发布 `https://tickergarden-web-test.vercel.app`，部署 ID `dpl_4sUykrWnCoGY1jGRgWcADvhzcPjj`。发布前 region gate 确认 1 个运行函数位于 sin1。仅测试环境，无生产发布。
