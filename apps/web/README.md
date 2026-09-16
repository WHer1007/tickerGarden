> 当前测试站（2026-09-13）已切换 RH 46630 release `685b5c20`，ETH 配对、0.42 ETH 毕业目标、原资产领取。Stock 准入与 Holder 快照发布尚未启用。见 [最新发布验收](../../docs/reviews/FRONTEND_LATEST_RH_RELEASE_2026-09-13.md)。下文早期版本状态与部署记录为历史资料。

> R3 测试链更新（2026-09-06）：7 天持有人周期，0.42 ETH 测试毕业门槛，当前链上地址和测试边界见 [R3 报告](../../outputs/reviews/arbitrum-r3-scenarios/REPORT.md)。下文 R2 和未部署候选记录保留为历史说明。

> Historical 2026-09-05 reward conversion checkpoint: that revision was `IMPLEMENTATION_ALLOWED`, not deployment eligible. Previous deployment evidence is historical (`STALE`); all seven deployment gates must be refreshed for the changed runtime. No broadcast performed.

Current brand-renamed candidate: `IMPLEMENTATION_ALLOWED / NOT_BROADCAST`. Gate `V1-DEPLOY-ARTIFACT-CODEHASH-01` requires new release identity, ABI/codehash review and deployment rehearsal. Earlier R2 evidence is historical and does not certify these renamed sources.

# TickerGarden V1 正式用户前端

`apps/web/` 是 TickerGarden V1 面向用户的唯一正式前端。原辅助前端位于 `archive/legacy-website/`，只作历史追溯，不参与活动构建、测试、CI、部署或功能对接。

当前品牌重命名候选为 `IMPLEMENTATION_ALLOWED / NOT_PRODUCTION_READY / NOT_BROADCAST`。已重新打开发布产物门禁；旧 R2 已部署事实保留，但不能作为新 ABI、哈希和字节码的部署证明。

## 页面

- 正式构建为单 `index.html` 的 History API SPA，页面路由为：`/`（首页与产品入口）、`/explore`（市场浏览）、`/trade`（市场交易）、`/create`（创建市场）、`/stats`（统计）、`/docs`（文档与边界说明）、`/claim`（Claim，承载 Position、Staker、Creator、Treasury）、`/privacy`（Privacy Policy）、`/terms`（Terms of Use）、`/docs#docs-risks`（风险说明）。旧 `/market`、`/markets` 书签会保留查询参数和片段并归一化到 `/explore`。
- 旧 `/rewards` 和 `/rewards.html` 地址兼容跳转至 `/claim`。旧的 `.html` 地址由客户端路由替换为对应的新地址，并保留原 query/hash；例如 `trade.html?marketId=...` → `/trade?marketId=...`，`rewards.html#positions` → `/claim#positions`。`marketId` 通过 `/trade` 的 query 传递，Rewards 的标签和定位继续通过 hash 传递。
- 本地运行：`npm run dev` 启动 Vite 开发服务器；`npm run build` 生成生产产物；`npm run preview` 预览 `dist/`。Vite dev/preview 支持 SPA History API deep-link 回退。
- 生产托管必须为站点路由配置 deep-link fallback：支持该格式的平台可使用 `dist/_redirects`；Nginx 可参考 `try_files $uri $uri/ /index.html`（仅站点路由，不覆写独立 API）；其他平台配置等价 rewrite。生产托管规则尚未部署验证。

自动浏览器回归：`npm run test:browser:lifecycle` 启动独立本地 Vite 和 Chrome，运行下面三项 lifecycle fixture；不加载保存的环境变量，不签名或广播。可通过 `TG_BROWSER_EXECUTABLE` 指定 Chrome 路径。

部署构建：先编译合约并执行 `npm run check:generated`；ABI 生成器同时核对 `build-inputs/v1-abis.json` 与真实编译产物。上传前的 `deployment-boundary ... --source-only` 对 Web 强制执行该检查。Vercel 使用 `npm run build:vercel`，校验已提交 ABI 输入与接口源码、产品 manifest 及生成客户端的一致性，不依赖部署机的 Foundry 缓存。更新 ABI 时必须从编译产物运行 `npm run generate:abis`。

路由回归：`npm test` 包含路由解析与旧链接兼容测试。Vite dev 下打开 `/tests/browser/router-lifecycle.html`，验证真实 History API、返回/前进、页面内 URL 更新及导航阻止。打开 `/tests/browser/app-routing-lifecycle.html` 验证真实应用切页、单实例钱包、轮询清理和深链接；此 fixture 要求 `VITE_V1_READ_API_URL` 与 `VITE_V1_FACTORY_ADDRESS` 为空，使用仅支持连接的内存钱包并禁用网络，不能签名或广播。两者须显示 PASS，且不进入正式构建。

Privacy 与 Terms 已按正式页面接入全站页脚，但在运营主体、法定联系邮箱、适用法律、争议解决机制和地区准入规则经律师确认前，必须保持 `Pre-launch legal draft` 标识，不能作为已经生效的最终法律文本发布。

## 真实接入能力

- read API：健康、同步状态、配置、市场与用户 Position 读取
- Factory：canonical 市场创建、预览及运行时绑定校验
- LaunchRouter：原生币/ERC-20 launch-and-buy 路径
- Curve：买入/卖出报价、精确授权、模拟、提交及 canonical 事件/回执确认
- AllocationManager：市场搜索 → 单金额钱包质押 `stake` → 解锁后整仓退回钱包 `unstakeAndWithdraw`；保留 rageQuit 与奖励清理。正常退出不自动领取奖励，STOCK allowance 仅授予 Vault；底层 deposit/allocate 接口不再出现在默认 V1 表单。
- UserStockVault direct principal exit：只依赖钱包、配置的 rageQuit Factory 和链上 Factory→Registry→Vault 不可变身份图；即使 read API、Gauge、奖励读取或市场阶段不可用，仍可模拟并直接提出完整已分配本金
- FeeVault：Staker/Creator 费用读取与领取
- CreatorRegistry：Creator beneficiary 与 epoch 读取/更新
- TreasuryDistributor：Treasury epoch、Merkle root、领取状态、claim 与 Root 服务费退款 credit 提取
- Treasury Proof API：按账户/epoch 获取并在本地重建校验 Treasury proof

这些是真实运行时接入边界；它们不表示目标链已部署或生产交易已完成。毕业后的 Pool route 可以被读取和展示，但 Pool swap 当前保持锁定：技术 evidence 已固定测试网 v4 依赖并通过合约级 live Fork，正式开放仍要求签字后的实际部署 manifest、浏览器实链 E2E、生产 Router/Quoter/Permit2 绑定与发布批准。前端不会猜测 calldata 或使用未经实际 release evidence 绑定的 Router。

## Vite 环境变量

```text
VITE_V1_READ_API_URL
VITE_V1_FACTORY_ADDRESS
VITE_V1_LAUNCH_ROUTER_ADDRESS
VITE_V1_ALLOCATION_MANAGER_ADDRESS
VITE_V1_PROTOCOL_FEE_VAULT_ADDRESS
VITE_V1_CREATOR_REVENUE_REGISTRY_ADDRESS
VITE_V1_TREASURY_DISTRIBUTOR_ADDRESS
VITE_V1_TREASURY_PROOF_API_URL
VITE_V1_TREASURY_RELEASE_APPROVAL
```

缺少、格式非法、健康检查失败或配置地址无法与 Factory/Registry canonical 绑定一致时，前端必须 fail closed：不报价、不模拟、不签名、不提交资金敏感操作。

唯一有意独立于 read API 发布门的是 `Rewards > Positions > Direct vault principal exit`。该入口只使用 `VITE_V1_FACTORY_ADDRESS` 作为 rageQuit Factory，从 Factory 的 immutable `runtimeBindings()` 解析 MarketRegistry 与 OfficialStockRegistry，再核验 market→assetUid、asset→Stock/Vault、`vaultIdentity()`、Registry schema 反向绑定及用户实际 allocation。它不读取 Gauge、奖励、lock、minimumAllocation、asset active 状态或 market phase；回执必须同时包含 canonical `AllocationRageQuit`/`StockWithdrawn`，并证明 receipt block 的 allocation 已归零且钱包收到精确本金。

`VITE_V1_TREASURY_RELEASE_APPROVAL` 是独立的 Treasury 写操作上线门。只有完成目标链部署、真实链路 E2E 与上线批准后，部署方才可将其精确设置为 `V1-TREASURY-EXEC-1:EMPTY_EPOCH_V1:DEPLOYED_E2E_APPROVED`。未设置时 Rewards 仍可读取并校验 Treasury 状态与 proof，但 `requestRoot`、`claim`、`finalizeRoot`、`expireRootRequest`、`rolloverExpiredEpoch` 和 `withdrawServiceCredit` 全部保持禁用；该开关不会误锁 Position、Staker 或 Creator 功能。

## Treasury 状态

Treasury 前端与合约能力均属于 V1 范围，技术状态为 `DEPLOYMENT_ELIGIBLE`，但尚未实际部署，也未通过独立的生产发布门，因此发布构建默认只读。Treasury Root 是 attested、publicly reproducible、review-delayed 的承诺，不是 trustless validity proof。此 README 不宣称部署完成、生产就绪或上线批准。


## 2026-09-05 业务修复与运行方式

- `VITE_V1_CHAIN_ID` 仅接受 `4663`（默认 RH 主网）、`46630`（RH 测试网）或 `421614`（Arbitrum Sepolia 集成测试网），统一决定钱包网络、RPC、快照和 proof 域。地址仍须来自同一目标链真实部署清单，测试网计划不是已部署清单。
- 交易 hash 在浏览器 localStorage 按账户/链持久化。回执等待或后续对账失败保留记录；同一请求恢复查询，不再次签名；不同请求先要求处理旧交易。页面顶部 **Check existing transaction** 可在重开页面并连接钱包后查询原交易，无需重新广播。
- 此保护针对钱包返回 hash 后的流程；浏览器存储被清除、在返回 hash 前关闭页面、多个独立设备等情况仍须先核对钱包历史。不要将本地 journal 描述为链上订单幂等性。
- 新区块推进时通过 RPC 验证原报价快照仍 canonical，保留报价过期、最低到手、钱包上下文、实时合约验证。重组、索引落后和链不符仍拒绝。
- Read API 支持 `revision` 固定读取；初始化最多读取首批 100 市场，Explore/Rewards 可继续加载。列表筛选和排序由服务端在完整 revision 目录上执行；Rewards 可按 marketId 直接加载。统计页单独遍历完整目录，普通页面无需等待全量目录。
- **Refresh chain data** 刷新基础状态并保留交易金额；有效输入自动重新报价。奖励仓位应在刷新后重新选择/核实。
- 新 Treasury 零资格结转分支改变了 finalize 的终态，旧批准标识不再开启写入。需要对新字节码重新完成部署与真实 E2E 后使用本文指定的新标识。
- Pool 真实买卖仍未实现/开启：缺少已部署、版本与 codehash 绑定的 Router/Quoter/Permit2 清单及用户 Pool swap E2E。此轮没有把冻结测试地址当成生产配置。

Create now uses product fields and the shared release paired-asset list at
`deployments/manifests/robinhood-mainnet-4663.paired-assets.json`. Pending assets
remain previewable but cannot launch. For automatic image/details publication,
configure `VITE_LAUNCH_METADATA_ORIGIN` and the backend's durable metadata service;
Metadata URIs are prepared automatically; Advanced exposes treasury opt-in and a draft creator tax (nonzero launch gated until contract support). See
`../../docs/v1/V1_CREATE_PONS_V2_ALIGNMENT.md` for economics, treasury boundaries,
and required production configuration.

## Reward conversion

Rewards now distinguish settled market Quote from Meme pending internal conversion for both creators and stakers. Original-token access requires a user request and seven-day wait; existing claim locks remain. Claims validate the authenticated receipt rather than a stale displayed amount because settlement may run before inclusion. Contract and operator details: [V1_REWARD_CONVERSION.md](../../docs/v1/V1_REWARD_CONVERSION.md).

Arbitrum Sepolia integration uses `VITE_V1_CHAIN_ID=421614` with a separate matching Read API. The default remains RH mainnet 4663. See `deployments/ARBITRUM_SEPOLIA.md`; RH paired-asset addresses are not activated on Arbitrum.

B14 display references: create.html and trade.html show a separate USD reference for the selected verified Quote token via the Go API's `listDisplayPriceReferences()`. Responses are checked for chain/token identity, provider/unit, decimal strings, bid/ask order and freshness before rendering. REST multipliers are already applied by Go and are never applied again in the browser. The widget polls every 30 seconds, expires locally, aborts after 8 seconds and clears prior data on target changes or request failure. It supplies no transaction or launch authorization inputs. The Go API needs TG_DISPLAY_PRICES_CONFIG; the legacy TS API has no implementation. Browser inspection covered unavailable-state layout; configured live-price page integration remains a release check.


Rewards 的 `#activity` 标签在钱包已连接、标签/页面可见且在线时，每次读取完成后等待 30 秒检查活动历史。相同 revision 保留加载过的分页；revision 改变重新显示第一页。失败清空旧记录并按 60/120 秒重试，手动刷新和重新联网可立即恢复；隐藏、断网、断开或切换钱包会取消旧读取。活动版本独立于首页发布快照。该页面仍仅展示 finalized 事件引用和合约原始单位。

交易历史生命周期浏览器回归：启动本地 Vite 后打开 `/tests/browser/history-lifecycle.html`，页面自动运行真实 mountTrades/mountCandles/mountHolders 与 DOM 断言，标题及结果区必须显示 PASS。受控 fetch 故意忽略 AbortSignal，可验证初次渲染、stop 清成交表/图/持有人列表、刷新不复用已暂停身份、旧市场迟到响应不覆盖新市场、stop 后迟到响应不恢复旧数据、显式 setMarket 后恢复。测试结束恢复原 fetch 并停止组件；这是组件浏览器回归，不替代正式交易页/RPC/钱包联调。

### 生命周期文案口径

前端状态统一为 `Growing`（未毕业）和 `Bloomed`（已毕业），不再使用 `Graduated`、`In Bloom` 作为展示状态。过程文案使用 `bloom`，进度与金额目标分别为 `Bloom progress`、`Bloom target`。内部讨论、协议与接口仍使用“毕业／未毕业”及既有 `graduation`、`NOT_GRADUATED`、`readyToGraduate` 等标识；只在展示边界转换诊断信息，不改业务状态或数据字段。
