# 前端字段修复与本地验收 — 2026-11-14

状态：**IMPLEMENTED_AND_LOCALLY_VALIDATED / NOT_DEPLOYED**。

范围来自 [字段审查报告](FRONTEND_FIELD_DISPLAY_AUDIT_2026-11-14.md) 的 D1–D8。工作在隔离分支 `codex/frontend-fields-audit-20261113`，基于生产应用 `75dc280b3ae797e674cac46ace8644043f4b8f3b` 及材料版本 `9b8ad10c89a1d1f7601c60cb29d4077c3894ae26`。未混入原开发工作区的其他修改。

## 修复内容

| 项目 | 实现与验收 |
|---|---|
| D1 链身份 | 统一生成市场 URL；卡片、发币完成入口、仓位详情入口携带链参数。静态导航链接在渲染后按链补齐，保留显式跨链链接。canonical/OG 保留链和市场身份，过滤跟踪参数。BSC 新标签页已打开 TBULL，标题和链身份正确。 |
| D2 图表周期 | 跨周期请求不再沿用旧曲线；失败显示当前周期不可用及重试。同周期按钮可重新请求，成功后恢复涨跌幅。重试只读取相应区域；已有缓存和旧响应隔离仍保留。 |
| D3 失效估值 | 用 `null` 明确撤销不可用的美元价格；不再用 `undefined` 留下旧值。费用估值失效后显示 `-`，行情恢复后重新估值；USD 来源时间与链快照时间分别显示。未改原资产结算金额。 |
| D4 字段状态 | 详情展示快照时间、24h 窗口、历史图说明；分区失败保留旧值并明确提示，提供局部重试。Stats 分区维护 loading/ready/error、最后成功读取时间及缺失估值说明；初次失败不伪造零值。Stats 的 Last read 指 HTTP 读取时间，不冒充链数据时间。 |
| D5 分链内容 | BSC 首页、Launch 标题、Docs、gas 资产、毕业说明、合约链接按链选择。BSC 展示 78 个登记资产、77 个当前开放资产；GPROB 保持关闭。Docs 中 6 个 BSC 公开合约引用与已发布配置一致。服务器分享 metadata 从 BSC API 读取并核验 chain ID；客户端显示代币名称和 ticker。 |
| D6 Holder 状态 | BSC Holder 入口明确提示尚未开放、信息只读。没有更改领取批准、执行门禁或 Creator/Staker 功能。 |
| D7 成交日期 | 当天显示时间，历史成交显示日期和时间，跨年增加年份；链接 tooltip 保留完整 UTC 时间。 |
| D8 格式与口径 | Fixed supply 使用千分位；Current supply 明确表示链上总供应量；Holders 说明协议账户排除口径，并区分奖励资格。成交 Price/Amount/Value 标出 Quote/MEME ticker。 |

## 验证结果

- 前端单元与回归：**834 / 834 通过**。新增覆盖链 URL、BSC 服务端 metadata、分链 Docs/首页、Holder 提示、历史日期、失效收益估值恢复、图表失败与重试、confirmed 快照失败恢复、Stats 分区错误状态。
- TypeScript、ABI 源码一致性、生成 Read Client、资产目录一致性检查通过。
- 本地执行 `build:vercel` 构建命令通过。仅构建，没有调用 Vercel 部署。资源预算、懒加载边界、公共入口隔离、12 页 SEO 检查通过；业务入口约 **452.58 KB**，低于 500 KB 门禁。
- 独立 Chrome 验证 RH/BSC 页面、BSC 复制/新标签页、两条链的首页/Docs/Launch/Claim/Stats、桌面和手机字段展示，以及 503 后的图表/详情/Stats 恢复。生产 API 只作公开 GET 读取；浏览器拦截所有非 GET 请求。
- 故障场景只影响本地独立浏览器上下文。图表 12H 失败时旧 1H 涨跌幅不再显示；恢复后展示新 12H 数据。Stats 在 1440px 和 390px 下显示不可用状态，Retry 成功后清除错误。
- **CSS 文件修改数为 0**。沿用既有组件和样式，在原区域补充必要的状态、时间及单位。桌面和手机未发现文档级横向溢出，交易表保留内部滚动。
- 未连接有资金钱包，未签名、广播交易或改变链上配置；个人钱包余额及实际领奖交易不属于本轮实账验证范围。

原始证据：`.codex_tmp/field-fixes/` 中的 `tests.log`、`build.log`、`typecheck.log`、`targeted-final.log`、`browser-results.json`、浏览器截图及复现脚本。精选浏览器证据保留在 [本地证据目录](evidence/frontend-field-fixes-2026-11-14/summary.json)，遵循仓库忽略规则，不强制加入 Git。

## 发布边界

本轮未推送或晋级 `test/master`，未部署 Web、Gateway、Worker、数据库或合约；生产仍运行原版本。后续获得发布指令后，应仅晋级本次候选并执行既有部署门禁，不携带其他本地更新。若使用 Vercel，仍须显式指定并核验 `sin1` 后才能切换域名。
