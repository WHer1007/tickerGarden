# BSC 前端生产发布版本梳理 — 2026-11-08

结论：**发布基线已确定，最终上线版本仍需补一项跨链通知修复；本次未发布。**

本次核验于北京时间 11 月 7 日深夜至 11 月 8 日凌晨进行。读取 Vercel、生产公开接口和 VPS 服务状态，在独立工作区运行回归与构建；没有修改线上环境变量、切换别名、推送分支、广播交易、启动签名 Worker 或改变页面样式。

## 1. 应使用的版本

| 对象 | 本次确认的版本 | 发布处理 |
| --- | --- | --- |
| 当前生产 Web | `082eb229236882bde0acc2a1dc8f783ab070f88a`；`dpl_BozQjCvVJayzpUo8ePshsjEJxhuH` | 保留为回滚基线；`tickergarden.com` 与 Web 生产别名解析到同一部署，两个运行函数均为 `sin1` |
| 共用 Web 发布源码基线 | 本地 `master` / `test` 均为 `042f46e55a8a86e04ded0ac79dc34e5f2c659c06` | 从此干净基线补本报告第 4 节修复，再经 `test → master` 固定最终 SHA；不要从原脏工作区打包 |
| BSC 前端业务候选 | `f022a820982442280f4951a0053d476b9434b136` | 已包含在上述基线内；`apps/web` Git tree 与当前 `master`、`test` 完全相同：`28d52e590e2a433313490ddb5222319e63a3c2ff` |
| BSC Read API / Pipeline | `39217f4fb4112a28647d1932e67d24aa82dbadfa` | 已部署，保留；本轮 Web 开放不需要重复发布这两个服务 |
| BSC Content | `b8a1d17e7a6084c3e7779a12e6617f08d9514a87` | 已部署，保留 |
| 统一 EVM Gateway | `8c0428ae6d60c874b1d0106ef0557fc64d3b5570` | 需要最小新增 `POST /v1/launches` 的链路转发，见第 4 节；当前代码不能仅靠填写地址支持这条路由 |
| BSC 合约 | 已部署的现有正式地址及 release `0x182de16882fbe6f2305871fbdf4f21f64ae5404a43d8ff0d434096bbce067d64` | 此次没有发现需要因前端开放重新部署合约的理由；本轮未重新执行链上全量安全审计 |

`f022a82` 之后的两个提交仅修改 RH resident Worker、相关测试和运维文档，不改变 Web 产品树。采用当前 `master` 不等于重新部署这些服务。真正可开放的最终提交尚未生成，不能把此处的源码基线或已导出的源包当作最终上线批准。

## 2. 本次 Web 差异范围

相对当前线上 `082eb22923`，Web 差异仅来自两项提交：

1. `a55d751212e2e618d169b0a7255e7404b209698d`：BSC 资产列表、入金前发行方限制及额度检查、BNB 资金单位、质押首次加载与深链恢复。
2. `f022a820982442280f4951a0053d476b9434b136`：按链 ID + 地址关闭 GPROB 的 Quote、Stake 新增入口和交易提交，保留已有仓位退出与领奖路径。

共 17 个 Web 文件变化，其中 11 个产品源码、6 个测试；17 个 CSS 文件逐一比较均未变化，公共静态资源及依赖锁文件没有差异。保留原 RH 页面、默认链和业务行为。原工作区未提交的 Solana、RWA 聚合/借贷、其他页面和历史代码清理均不纳入。

发布源包已由现有 `tools/stage-vercel-source.mjs production web` 从干净 `master` 导出；源分支、与 `test` 的产品树一致性和编译 ABI 输入门禁通过。此包用于核对基线，修复后应重新导出，禁止沿用它冒充最终修复版本。

## 3. 建议首批开放及配置

| 功能 | 本轮建议范围 |
| --- | --- |
| BSC Explore、市场详情、行情和统计 | 开放；数据库展示状态与交易时的实时核验分开处理 |
| 发币、曲线/毕业后买卖 | 完成通知分流及最终联合验收后开放 |
| 股票质押、正常/提前/紧急退出 | 开放已验收路径，最低质押量保留 `0.5`，无总量和单用户额度上限 |
| Creator / Staker 领奖 | 开放用户主动交易路径，依链上真实可领金额和解锁条件判断 |
| Holder 快照领取与自动发布、LP Keeper 自动操作 | 继续关闭，沿用用户此前决定；不能宣称这部分运营闭环已开放 |

链上/后端仍登记 **81 Quote + 78 Stake**；页面首批可选 **80 Quote + 77 Stake**，排除 GPROB。BNB、USDT、USDC 及其余 77 项股票 Quote 保留。前端目录与生产 API 中全部 159 条 Quote/Stake 的身份、精度、最低质押量、phantom 和毕业阈值比较无不一致。这个结果是对当前持久化投影的核对，不是新一轮全资产主网扫描。

中央维护源继续是 `/Users/dear/Documents/code/TickerGarden-BSC/config/workspace.json`，其中 `productionResources.frontend.candidate` 已保存候选地址。发布时从中央源生成 Web 环境配置，不另建手工维护的配置文件。需要审定的变化：

- `VITE_BSC_USER_WRITES`: `disabled → approved`，与实际发布一起生效。本轮仍为 disabled。
- 核对并绑定六个 BSC 地址：Factory `0x186d0c4b6f9f33a30545c0acff8e0cd90cc20578`、LaunchRouter `0x0ba79b15d7cfd640fa19d591ce4055b80269a76c`、AllocationManager `0x074d660831eab9ebd8323443487bc2f30ad0aff6`、FeeVault `0x24fbfa2679698fae4f5cf34d8b937045deb271d5`、CreatorRegistry `0x6a0378d04e9b67fab9579a1e30a007b875029a5a`、HolderDistributor `0x81ad9c2ad391c95c3a45e4ba20d146fb59392e6c`。
- `VITE_BSC_READ_API_URL` / `VITE_BSC_CONTENT_ORIGIN` 保持 `https://tickergarden-evm-api.vercel.app`，经统一接口附带 `chainId=56`。
- 绑定 BSC 专属 `VITE_BSC_RELEASE_CATALOG`，不继承 RH 目录。
- **不要直接采用旧候选中的 `VITE_BSC_HOLDER_SNAPSHOT_RELEASE_APPROVAL`。** 它声明领取已批准，但当前代码 `app.ts:3551` 仍明确拒绝 BSC Holder 提交。首批保持未设置该批准值；本轮构建验证也是如此。要全面开放 Holder 时，另做权限、原生轮次结构、证明和正向领取验收。
- RH 保持默认 `4663`、原 API/Content/合约地址；不覆盖 RH Pipeline 参数以绕开 BSC 路由问题。
- 生产 Web 的 BSC RPC 经 `/api/rpc?chain=bsc`，后端 `TG_BSC_WEB_RPC_URL` 已核对为 QuickNode；没有自动 Alchemy 备用配置。不得将私有 RPC URL 放入公开 `VITE_*` 变量。

## 4. 上线前必须补齐的链路

**发币完成与刷新恢复后的通知仍指向 RH Pipeline。**

- `apps/web/src/controllers/create.ts:137`、`:1056` 都调用 `notifyLaunchDatabase(hash, import.meta.env.VITE_V1_PIPELINE_URL)`。
- 生产此值为 `https://pipeline.tickergarden.com`。BSC 选择不会修改原始构建环境值；离线复现实际生成 `POST https://pipeline.tickergarden.com/v1/launches`，请求没有 BSC 链参数。
- `pendingMarket.ts` 默认使用未做链隔离的 fetch。只给一个含 `?chainId=56` 的 base URL 也不够，`new URL('/v1/launches', base)` 会丢弃 base 的查询参数。
- 当前生产 Gateway 源码只转发读取接口及 Content POST；使用线上提交 `8c0428a` 的路由器离线重放 `POST /v1/launches?chainId=56`，得到 **405**，上游调用为 0。

应发布的最小补丁范围：

1. Web 的发币通知函数及两个调用点绑定目标链、目标统一接口，恢复流程同样处理；通知去重键包含链，不将 BSC 哈希发往 RH。
2. Gateway 仅增加明确的 `POST /v1/launches` 转发到各链独立 Pipeline；保留链冲突拒绝、来源限制、请求体限制、私有上游认证、禁止重定向与链身份校验，不开放通用写代理或 `/internal/*`。
3. 中央配置增加相应 Pipeline 路由并移除首批 Holder 批准；对 Web/Gateway 的 RH 原有行为增加回归。

BSC Pipeline 已实现该发币观察接口，因此预计不需要因此重新部署合约或重写 Pipeline。通知是事件推送之外的补充；错误通知不意味着发币交易会回滚，但会破坏链隔离并导致投影恢复依赖 Relay。不能用“有事件订阅”代替这条请求恢复路径的验收。

本轮仅复现并固定问题，未修改 Web/Gateway 产品代码。最终发布组成应为 **共用 Web 最小修复版 + EVM Gateway 最小路由修复版 + 中央配置的对应生成物**，而不是只重新部署旧 Web 候选。

## 5. 本次验证与证据边界

- Web **778/778** 测试通过，0 失败/跳过；ABI、客户端、资产目录、TypeScript 通过。18 个编译 ABI 输入与已冻结哈希一致。
- 使用拟上线的公开 BSC 参数、Holder 批准关闭进行 `build:vercel`，构建、资源预算、SEO 通过；没有修改源码或样式。
- 当前线上 Web 版本、部署 ID 和实际两个函数的 `sin1` 均重新核实。
- BSC 配置 API 返回 78/78 Stake ACTIVE，全部最低质押量 `500000000000000000`；81/81 Quote、正式模板和经济基线为 ACTIVE。
- 主动请求价格 API 返回 **80/81 available**，GPROB 为 `unavailable / book_spread_exceeded`。不放宽价差或新鲜度要求；这一瞬时样本不是连续 SLA。
- 生产 BSC 市场数仍为 0、队列 dead 为 0。健康接口明确显示持久化检查点 `131638020`、`status=lagging`、`liveChainHeadVerified=false`，不能把 `lagBlocks=0` 当作已核对最新链头。没有为刷新健康状态主动扫块。
- RH 两个 Worker 均 active，检查窗口最近 15 分钟无结构化警告；BSC Display/Dispatcher active 且同窗口无警告。BSC Relay active，同窗口有 1 条 `database_slow_query`，保留为后续运行验收观察项，本轮未修改服务。
- Vercel 导出环境时两个 sensitive 值为占位符，本地完整运行环境门禁因此未通过 `TG_RPC_BUDGET_TOKEN` 校验。不能推断线上缺失密钥，也不能用假值宣称通过；应在后续 Vercel 实际构建的服务环境中运行门禁。源码门禁和本地 Web 构建已经通过。
- 10 月 28 日全资产 Fork 的 10 组业务和 11 项页面验收是历史证据，不能代替新的通知补丁及最终配置验收。本轮未重新执行 Fork、浏览器资金操作或主网小额交易；不要求真实钱包扩展作为新增条件。

聚合证据见同目录 `BSC_FRONTEND_PRODUCTION_RELEASE_PLAN_2026-11-08.json`；完整日志、导出的私有配置和原始 API 结果在本工作区忽略目录 `.codex_tmp/bsc-web-release-plan/`，不进入 Git。

## 6. 后续发布顺序与回滚

1. 以上述 clean master 为 Web 基线、当前生产 Gateway 源码为网关基线，只修第 4 节，更新中央候选声明并固定两个最终 SHA。
2. 经 `test` 完成回归，使用最终配置验证 BSC 发币/IPFS/通知/投影/交易/质押退出/Creator 与 Staker 领奖，及 RH 隔离。交易只在 Fork；禁止以自动扫块弥补事件/请求链路缺陷。
3. 将验收通过的同一产品树晋级 `master`，运行各自源码/配置门禁。只打包明确范围，不推送原脏工作区或混入其他链/页面更新。
4. 获得最终发布指令后，先发布向后兼容的 Gateway 小补丁，再部署 Web 候选；每个 Vercel 部署显式 `--regions sin1`。域名切换前逐函数跑区域门禁，并检查 RH/BSC 导航、Content、真实环境 RPC 代理与拒绝状态。
5. 失败时 Web 回到本报告记录的部署 ID；Gateway 回到当前独立部署 `dpl_GT9jwqBNrV7KTeW1y13gcKPFM45G`。回滚前端不改变合约状态或撤销已提交交易，保留已有仓位退出路径。不要恢复已废弃的扫块/Alchemy 配置。

**当前状态：RELEASE_SCOPE_IDENTIFIED / PATCH_AND_FINAL_ACCEPTANCE_REQUIRED / NOT_DEPLOYED。**
