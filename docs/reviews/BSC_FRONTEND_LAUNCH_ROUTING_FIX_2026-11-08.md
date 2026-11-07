# BSC 发币通知与首发前端候选修复 — 2026-11-08

状态：**LOCAL_ACCEPTANCE_PASSED / PREPARED_NOT_PUBLISHED**。

本轮修复发币通知串链和 Holder 批准不一致，并按用户要求恢复顶部栏链切换版本。代码固定在两个独立工作区；未推送、发布 Vercel、切换别名、改变线上环境变量或广播交易。RH 原有服务和数据库未修改。

## 固定版本

| 对象 | 提交 / 树 | 范围 |
| --- | --- | --- |
| Web 产品提交 | `657682fdb8268551b674b8429c41cbc4ab9569da` | 本轮修复及顶部链切换；基于已梳理的共用 Web 发布基线 |
| Web 产品树 | `109501256597a986edba7d16bcc75c098271fb74` | `apps/web` |
| Gateway 产品提交 | `249254a3e1a258fe61dee8d2515c97142d25e8ff` | 新增发币观察路由和对应生产装配 |
| Gateway 产品树 | `066476e8c04e1a9b55a4e6d6b5a4bb58ced9ff6e` | `services/evm-gateway` |
| 顶部栏设计来源 | `a8f564e1d90a9ef0615fdbe654d36158e3f9aee3` | 已有顶部链图标 + 钱包图标方案，Robinhood 图标为圆形 |

开发分支为 `codex/bsc-web-release-plan-20261107` 和 `codex/bsc-launch-routing-20261108`。它们是候选开发提交，不能直接部署或绑定环境别名；`test`、`master` 本轮均未改动。

## 修复结果

### 发币通知按链分流

- 普通发币完成使用当前链 ID；刷新恢复使用已保存发币状态的链 ID。
- BSC 只请求统一 Gateway 的 `POST /v1/launches?chainId=56`，由网关转发至独立 BSC Pipeline。不会继承 RH 的 `VITE_V1_PIPELINE_URL`，缺配置时不发送请求。
- RH 既有直接 Pipeline 通知行为保持不变。Gateway 同时支持显式 `4663` 和既有默认 RH 请求。
- 去重包含链、目标 URL 和交易哈希；同一哈希不会跨链互相覆盖。已完成通知可以重新尝试恢复；临时错误有限重试，永久校验错误立即停止。
- 请求只含一个 32 字节交易哈希，最大 1 KiB；不接受市场参数、用户指定上游、额外查询参数、重定向或错误链响应。
- 网关只开放这一条新增 POST，不开放通用写代理、队列回调、修复或内部接口。BSC 的上游访问凭据只在服务端加到 BSC 目标，不能传到 RH 或浏览器。
- 此路由是一次明确用户操作引发的交易观察，不新增定时 RPC、区块扫描或跨链回退。Pipeline 自身继续负责核验交易和正式市场身份。

### Holder 首期关闭

- 已从中央候选配置移除 `VITE_BSC_HOLDER_SNAPSHOT_RELEASE_APPROVAL`；连续 Holder 批准同样保持未设置。
- BSC 客户端作用域额外清除残留的两种 Holder 批准，与现有 BSC Holder 执行拒绝保持一致；RH 批准原样保留。
- Creator、Staker 领取未被此修改关闭；Holder、LP Keeper 自动签名运行状态未修改。

### 用户指定的顶部链切换版本

- 导航为原版本的 Explore、Launch、Stats、Claim、Stake、Docs；顶部右侧为链图标和简化钱包图标。没有导入后来的 Stocks/RWA/借贷导航或页面内链筛选器。
- 下拉完整显示 Robinhood、BNB Chain；Solana 保持 Coming soon。默认链不变。
- 链切换清除原市场、资产、收益轮次及 hash；详情页返回目标链市场列表。进行中的业务操作会阻止切链。
- BSC `View only` 提示仅在未批准写操作时出现；候选批准不会改变当前生产开关。
- `subpages.css`、切换器模块及两个图标与历史提交逐字节相同；CSS 变化仅为恢复该版本的 39 行顶部栏样式，没有改动页面布局。

浏览器检查附带发现并修复创建费预览仍写死 ETH：BSC 现在显示 `0.0005 BNB`，RH 保持 `0.0005 ETH`；已有链上读取值优先显示，交易金额仍由原交易准备流程读取合约决定，没有添加 RPC。修正一项旧浏览器样式断言，使其符合现有 Creator 页面先选收益周期、后领取的顺序，没有为通过测试移动控件。

## 配置登记

唯一维护源仍为 `/Users/dear/Documents/code/TickerGarden-BSC/config/workspace.json`：

- `productionResources.frontend.candidate.sourceCommit` 指向上述 Web 产品提交，状态 `PREPARED_NOT_PUBLISHED`。
- 候选 `VITE_BSC_PIPELINE_URL=https://tickergarden-evm-api.vercel.app`；Holder 批准未设置。
- 当前生效的 `productionResources.frontend.bscUserWrites` 仍为 `disabled`；只有待发布候选中为 `approved`。
- 已登记 RH 既有 Pipeline 域名 `pipeline.tickergarden.com`，生成网关的两个独立 Pipeline 路由，并为 BSC Pipeline 生成服务端访问头。
- 中央配置的 backend、全局运行开关、已部署版本字段均未改变；没有创建另一份手工维护环境文件。

## 验证

| 检查 | 结果 |
| --- | --- |
| Web 完整测试、生成一致性与 TypeScript | **792/792 通过**，0 失败、0 跳过 |
| Gateway 全部测试及 production-resources 定向测试 | **30/30 通过** |
| 使用候选公开参数的 `build:vercel` | 通过，含资源预算、图标覆盖、SEO；没有上传 |
| 浏览器路由生命周期 | 通过，含 16 项路由断言、63 项应用断言及过期响应隔离 |
| 页面样式检查 | 1440 px / 390 px 均通过 |
| Web 通知 → 实际 Gateway 代码 → 隔离模拟 Pipeline | BSC、RH、BSC 恢复均走正确上游，私有访问头仅 BSC 可见 |
| 真实 Chromium 页面交互 | 桌面/手机链切换、圆形 RH 图标、写操作提示、创建费单位、禁用 Solana、切链保护通过；无页面异常 |
| 配置投影 | 两链上游隔离、Holder 批准关闭、当前写开关关闭、backend 未改变 |

联调脚本为 `apps/web/scripts/check-bsc-release-routing.mjs`，参数为 Gateway 源目录和本地证据输出目录的绝对路径；需要 Node 24 和本机 Chromium。测试全程不使用真实钱包、线上凭据或链 RPC，模拟上游不等于生产已部署验证。

曾尝试扩大到 BSC `tools/tests/*.test.mjs`；该新工作区缺忽略的私有配置及独立后端依赖，且存在旧双 RPC 测试预期，未通过。未更改这些无关项，也不宣称 BSC 仓库全量测试通过。本轮只将受修改影响的 Gateway 全套及生产资源装配定向测试计入通过范围。

聚合证据及日志哈希见同名 JSON；完整日志和桌面/手机截图位于忽略目录 `.codex_tmp/bsc-launch-routing/evidence/`。

## 发布前仍需执行

1. 将上述明确范围纳入 `test`，完成最终 Fork / 环境联合验收，再按规则晋级同一产品树至 `master`；不混入原工作区的其他链和 RWA 更新。
2. 正式部署时先发布 Gateway 和其新的 Pipeline 配置，再发布 Web 候选；先检查 RH/BSC 路由，再开放用户入口。Read API、Pipeline、Content 本轮无代码修改，不需要为本补丁重复发布。
3. 所有 Vercel 命令显式 `--regions sin1`，运行源码与构建环境门禁，域名切换前验证每个函数的实际区域。仍需生产发布指令。
4. 旧报告中的生产基线和回滚 ID 继续保留。本轮没有刷新生产价格、主网 Fork、线上队列/投影或运行时区域证据，因此不把本地修复通过等同于全量生产验收通过。
